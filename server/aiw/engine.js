/**
 * The forecasting cycle. Runs centrally, once a minute, on the server — never
 * in users' browsers — so every visitor sees the same warnings and the work is
 * done once. A cycle never overlaps the previous one (single-flight); if a
 * cycle overruns, the next simply starts late.
 *
 *   1. feed health        is the lightning feed live?  (no -> issue nothing)
 *   2. cells + tracks     cluster the last 15 min, match to existing storms
 *   3. motion             history + cross-correlation + steering wind
 *   4. fields + model     probability rasters for +5 … +30 min
 *   5. assess + decide    polygons, timing, exposure, severity
 *   6. lifecycle          issue / update / escalate / downgrade / end
 *   7. verify             score finished warnings against what happened
 */
import path from 'node:path';
import { getState, saveState, readStrikes, MODEL_DIR, readJson, pruneArchive, flushArchive } from './store.js';
import { coverageAt } from './ingest.js';
import {
  clusterStrikes, summariseCluster, updateTracks, crossCorrelationMotion, historyMotion, blendMotion,
  buildFields, trendOf, LEADS, HIT_RADIUS_KM,
} from './nowcast.js';
import { BASELINE, makeLogistic } from './model.js';
import { envPeek, envHealth, ENV_SOURCE } from './env.js';
import { assess, reconcile, tickTests } from './warnings.js';
import { getLiveConfig, setModelThresholds } from './config.js';
import { pointInGeo, geoBBox, haversineKm } from './geometry.js';
import { groupSystems, mergeSystem } from './systems.js';

const CYCLE_MS = 60e3;

export function createEngine({ ingest, broadcast = () => {} }) {
  const tracks = new Map();
  let trackSeq = 0;
  const nextTrackId = () => `T${Date.now().toString(36)}${(trackSeq++).toString(36)}`;
  let running = false;
  let timer = null;
  const status = {
    lastCycleAt: null, lastCycleMs: null, lastError: null, cycles: 0,
    cells: 0, tracksLive: 0, assessed: 0, feedOk: false, modelVersion: null,
  };

  /* ── model registry ── */
  let model = BASELINE;
  function loadModel() {
    const s = getState();
    const v = s.activeModel;
    if (!v) { model = BASELINE; setModelThresholds(null); return; }
    const spec = readJson(path.join(MODEL_DIR, `${v}.json`), null);
    if (!spec?.weights) { console.warn(`[aiw] model ${v} missing — using baseline`); model = BASELINE; setModelThresholds(null); return; }
    model = makeLogistic(spec);
    setModelThresholds(spec.thresholds || null);
  }
  function modelInfo() {
    if (model.kind === 'baseline') return { version: model.version, kind: 'baseline', trained: false, skillPositive: false };
    const test = model.metrics?.test?.overall;
    return {
      version: model.version, kind: model.kind, trained: true,
      skillPositive: !!(test && test.brierSkill > 0 && model.metrics?.beatsBaselines),
      trainedAt: model.createdAt,
    };
  }

  /* ── one cycle ── */
  async function cycle() {
    if (running) return;
    running = true;
    const t0 = Date.now();
    const now = t0;
    try {
      const feeds = ingest.status(now);
      const feedOk = Object.values(feeds).some((f) => f.status === 'live');
      status.feedOk = feedOk;
      const s = getState();
      s.health = { at: now, feeds, environment: { ...envHealth }, engine: { ...status } };

      const recent = ingest.window(now - 35 * 60e3, now + 60e3);
      const last15 = recent.filter((x) => x.time >= now - 15 * 60e3);
      const clusters = clusterStrikes(last15);
      const cells = clusters
        .map((m) => ({ ...summariseCluster(m, now), members: m }))
        .filter((c) => c.count15 >= 6);
      updateTracks(tracks, cells, now, nextTrackId);
      status.cells = cells.length;

      const live = [...tracks.values()].filter((t) => !t.dead && t.lastSeen === now);
      status.tracksLive = live.length;
      const cfg = getLiveConfig();
      const info = modelInfo();
      status.modelVersion = info.version;
      const assessed = [];

      // Spatial index of recent strikes, so each storm only scans its own area.
      const bucket = new Map();
      for (const st of recent) {
        const k = `${Math.floor(st.lat)},${Math.floor(st.lon)}`;
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push(st);
      }
      const localStrikes = (lat, lon, radiusKm) => {
        const dLat = Math.ceil(radiusKm / 111) + 1;
        const dLon = Math.ceil(radiusKm / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))) + 1;
        const out = [];
        for (let i = Math.floor(lat) - dLat; i <= Math.floor(lat) + dLat; i += 1) {
          for (let j = Math.floor(lon) - dLon; j <= Math.floor(lon) + dLon; j += 1) {
            const b = bucket.get(`${i},${j}`);
            if (b) out.push(...b);
          }
        }
        return out;
      };

      const prof = { fields: 0, predict: 0, systems: 0, assess: 0, reconcile: 0 };
      let tq = Date.now();
      const lap = (k) => { const n2 = Date.now(); prof[k] += n2 - tq; tq = n2; };
      const cellItems = [];
      for (const track of live) {
        if (!track.dead) track.mergedInto = undefined; // re-decided each cycle below
        const coverage = coverageAt(track.lat, track.lon);
        track.coverage = coverage.quality;
        // Only storms with enough activity to possibly warrant a warning get
        // the full probability calculation; the rest are tracked only.
        if (track.n10 < Math.max(3, cfg.yellow.minStrikes10 * 0.5)) continue;
        const env = envPeek(track.lat, track.lon, now);
        const local = localStrikes(track.lat, track.lon, 320);
        const motion = blendMotion({
          hist: historyMotion(track.history),
          xcorr: crossCorrelationMotion(local.filter((x) => haversineKm(track.lat, track.lon, x.lat, x.lon) < track.radiusKm + 60), track, now),
          steering: env?.steering || null,
        });
        track.vx = motion.vx; track.vy = motion.vy; track.motion = motion;
        lap('fields');
        const fields = buildFields(track, local, now, motion, { motionUncKmh: motion.spreadKmh ?? 15 });
        lap('fields');
        const trend = trendOf(local, track, now);
        const ctx = { trend: trend.logRatio, n10: track.n10, cape: env?.cape, cycles: track.cycles,
          liftedIndex: env?.liftedIndex, shearKmh: env?.shear0_6kmKmh, showersMmH: env?.showersMmH };
        const probs = {};
        const n = fields.grid.nx * fields.grid.ny;
        for (const L of LEADS) {
          const p = new Float32Array(n);
          /* Most of a storm's grid is empty sky, where every density feature is
             ~0 and the model gives the same 'floor' value. Compute that once
             and only evaluate the model where there is activity — several
             times faster on a busy day. */
          const d10 = fields.leads[L].d10; const d30 = fields.leads[L].d30; const nw = fields.now10;
          let floor = null;
          for (let k = 0; k < n; k += 1) {
            if (d10[k] < 1e-4 && d30[k] < 1e-4 && nw[k] < 1e-4) {
              if (floor === null) floor = model.predict(fields, L, k, ctx);
              p[k] = floor;
            } else {
              p[k] = model.predict(fields, L, k, ctx);
            }
          }
          probs[L] = p;
        }
        lap('predict');
        cellItems.push({ track, probs, fields, motion, trend, env, coverage });
      }

      /* One warning per storm SYSTEM: cells whose risk areas touch are merged
         and assessed together (see systems.js). A cell absorbed into another
         system that was carrying its own warning has that warning merged. */
      const withWarning = new Set(getState().warnings.filter((w) => w.status === 'active').map((w) => w.trackId));
      for (const sys of groupSystems(cellItems, cfg.corridorProbability)) {
        lap('fields');
        const { item, absorbed } = mergeSystem(sys.members, withWarning);
        lap('systems');
        for (const t of absorbed) t.mergedInto = item.track.id;
        const a = assess({
          track: item.track, probs: item.probs, fields: item.fields, motion: item.motion, trend: item.trend,
          env: item.env, coverage: item.coverage, feedOk, model: info, now, cfg,
        });
        lap('assess');
        item.track.lastAssessment = { at: now, peakP: a.peakP, ratePerMin: a.ratePerMin, cells: sys.members.length };
        assessed.push({ track: item.track, a, env: item.env });
      }
      status.assessed = assessed.length;

      const dataQuality = {
        feed: feedOk ? 'live' : 'stale',
        feeds: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, { status: v.status, lastStrikeAgeMs: v.lastStrikeAgeMs, sockets: v.sockets }])),
        environment: envHealth.lastOkAt ? { source: ENV_SOURCE, lastOkAgeMs: now - envHealth.lastOkAt } : { source: ENV_SOURCE, status: envHealth.cached ? 'from disk' : 'unavailable' },
        radar: 'not integrated', satellite: 'not integrated',
        at: now,
      };
      tq = Date.now();
      const changed = reconcile({ assessed, tracks, now, feedOk, modelInfo: info, dataQuality, paused: !!s.paused });
      lap('reconcile');
      status.profileMs = prof;
      tickTests(now);
      verifyFinished(now);

      status.cycles += 1;
      status.lastCycleAt = now;
      status.lastCycleMs = Date.now() - t0;
      status.lastError = null;
      s.health.engine = { ...status };
      saveState();
      broadcast({ type: 'cycle', at: now, changed, feedOk, active: s.warnings.filter((w) => w.status === 'active').length });
    } catch (err) {
      status.lastError = String(err.stack || err);
      console.error('[aiw] cycle failed:', err);
    } finally {
      running = false;
    }
  }

  /* ── verification ── */

  /**
   * Once a finished warning's forecast window has fully passed, score each
   * logged 30-minute forecast against the lightning that actually followed:
   *   capture  share of the storm's later strikes that fell inside the polygon
   *            forecast for that time — did we put the area in the right place?
   *   falseArea share of the forecast polygon with no strike within 8 km —
   *            how much area was warned for nothing?
   */
  function verifyFinished(now) {
    const s = getState();
    for (const w of s.warnings) {
      if (w.isTest || w.status === 'active' || w.verification) continue;
      const logs = w.trackLog || [];
      const lastAt = logs.length ? logs[logs.length - 1].at : w.issuedAt;
      if (now - lastAt < 35 * 60e3) continue; // wait for the outcome
      if (!logs.length) { w.verification = { skipped: 'no forecast logged' }; continue; }
      const byLead = {};
      for (const L of LEADS) byLead[L] = { capturedStrikes: 0, nearbyStrikes: 0, sampledArea: 0, emptyArea: 0, forecasts: 0 };
      const from = logs[0].at; const to = lastAt + 31 * 60e3;
      const strikes = readStrikes(from, to);
      for (const log of logs) {
        for (const f of log.forecast) {
          if (!f.geometry) continue;
          const bb = geoBBox(f.geometry);
          const pad = 0.6;
          const win = strikes.filter((st) => st.time > log.at + (f.lead - 5) * 60e3 && st.time <= log.at + f.lead * 60e3
            && st.lon > bb[0] - pad && st.lon < bb[2] + pad && st.lat > bb[1] - pad && st.lat < bb[3] + pad);
          const b = byLead[f.lead];
          b.forecasts += 1;
          for (const st of win) { b.nearbyStrikes += 1; if (pointInGeo(st.lon, st.lat, f.geometry)) b.capturedStrikes += 1; }
          // sample the polygon for empty area
          for (let i = 0; i < 12; i += 1) for (let j = 0; j < 12; j += 1) {
            const lon = bb[0] + ((i + 0.5) / 12) * (bb[2] - bb[0]);
            const lat = bb[1] + ((j + 0.5) / 12) * (bb[3] - bb[1]);
            if (!pointInGeo(lon, lat, f.geometry)) continue;
            b.sampledArea += 1;
            if (!win.some((st) => haversineKm(lat, lon, st.lat, st.lon) <= HIT_RADIUS_KM)) b.emptyArea += 1;
          }
        }
      }
      w.verification = {
        at: now,
        byLead: Object.fromEntries(Object.entries(byLead).map(([L, b]) => [L, {
          forecasts: b.forecasts,
          capture: b.nearbyStrikes ? +(b.capturedStrikes / b.nearbyStrikes).toFixed(3) : null,
          falseAreaFraction: b.sampledArea ? +(b.emptyArea / b.sampledArea).toFixed(3) : null,
          strikes: b.nearbyStrikes,
        }])),
      };
      saveState();
    }
  }

  return {
    status,
    tracks,
    get model() { return model; },
    modelInfo,
    loadModel,
    cycle,
    start() {
      loadModel();
      const kick = () => {
        // Align to the minute so cycles happen at predictable times.
        const wait = CYCLE_MS - (Date.now() % CYCLE_MS) + 2000;
        timer = setTimeout(async () => { await cycle(); kick(); }, wait);
        timer.unref?.();
      };
      kick();
      // Housekeeping: prune the archive daily.
      const hk = setInterval(() => { pruneArchive(); }, 6 * 3600e3);
      hk.unref?.();
      process.on('SIGINT', () => { flushArchive(); saveState({ now: true }); process.exit(0); });
    },
    stop() { clearTimeout(timer); },
  };
}

