/**
 * The warning decision engine and lifecycle.
 *
 * Input, once a minute per storm: the model's probability rasters for every
 * lead time, the observed strike statistics, motion, model-atmosphere context,
 * feed health and coverage. Output: warning records, lifecycle events and
 * announcement events — every one persisted, every decision with its reasons.
 *
 *   ASSESS     probability rasters -> polygons (now, +5…+30, uncertainty
 *              corridor), exposure, timing, confidence
 *   DECIDE     the severity the evidence supports, from the configurable
 *              criteria in config.js — never from text
 *   HYSTERESIS escalate only after `escalateCycles` consecutive cycles at the
 *              higher level; downgrade only after `downgradeCycles` below the
 *              (lower) exit thresholds — so a warning does not flicker
 *   LIFECYCLE  issue / update / escalate / downgrade / extend / shorten /
 *              cancel / expire, one persistent record per storm, with a
 *              version history and an audit trail of events
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getState, saveState, AIW_DIR } from './store.js';
import { getConfig, levelRank, SEVERITIES } from './config.js';
import { LEADS } from './nowcast.js';
import {
  fieldToGeoJSON, geoCentroid, geoAreaKm2, isValidGeometry, overlapFraction, bearingDeg, haversineKm, pointInGeo,
  geoBBox as geoBBoxImport, simplify,
} from './geometry.js';
import { describeGeography } from './geo.js';
import { describe, shortSummary, title, announcementText, regionLabel } from './describe.js';

const ARCHIVE_DIR = path.join(AIW_DIR, 'warnings');
const CONF_RANK = { low: 1, medium: 2, high: 3 };

/* ── ASSESS ───────────────────────────────────────────────────────────── */

/** Element-wise maximum of several rasters. */
function maxOf(arrs) {
  const out = new Float32Array(arrs[0].length);
  for (const a of arrs) for (let i = 0; i < a.length; i += 1) if (a[i] > out[i]) out[i] = a[i];
  return out;
}

/**
 * Turn one track's probability rasters into the measurable quantities the
 * decision uses. Pure function of its inputs (unit-tested).
 *
 *   probs      { [lead]: Float32Array }   P(lightning within 8 km) per lead
 *   fields     the feature rasters (now10 = observed density per 100 km²)
 */
export function assess({ track, probs, fields, motion, trend, env, coverage, feedOk, model, now, cfg }) {
  const grid = fields.grid;
  const near10 = maxOf([probs[5], probs[10]]);
  const geometry = fieldToGeoJSON(near10, grid, cfg.areaProbability, { minAreaKm2: cfg.minAreaKm2 / 2 });
  const forecast = [];
  for (const L of LEADS) {
    const g = fieldToGeoJSON(probs[L], grid, cfg.areaProbability, { minAreaKm2: cfg.minAreaKm2 / 3 });
    if (g && isValidGeometry(g)) {
      const [clat, clon] = geoCentroid(g);
      forecast.push({ lead: L, validAt: now + L * 60e3, geometry: g, centroid: [+clat.toFixed(4), +clon.toFixed(4)] });
    }
  }
  const corridorG = fieldToGeoJSON(maxOf(LEADS.map((L) => probs[L])), grid, cfg.corridorProbability, { minAreaKm2: cfg.minAreaKm2 / 2, smooth: 3, tolKm: 1 });

  let peakP = 0; let peakLead = 5;
  for (const L of LEADS) {
    let m = 0; for (const v of probs[L]) if (v > m) m = v;
    if (m > peakP + 0.02) { peakP = m; peakLead = L; }
  }
  let peakDensity100 = 0;
  for (const v of fields.now10) if (v > peakDensity100) peakDensity100 = v;

  const ok = geometry && isValidGeometry(geometry);
  const areaKm2 = ok ? geoAreaKm2(geometry) : 0;
  const centroid = ok ? geoCentroid(geometry) : [track.lat, track.lon];
  const geo = ok ? describeGeography(geometry, centroid, forecast.map((f) => f.geometry)) : null;

  // When does the forecast area first cover each populated place ahead?
  let timeToPopMin = null; let popReached = 0;
  if (geo) {
    for (const p of geo.placesAhead) {
      const f = forecast.find((fc) => pointInGeo(p.lon, p.lat, fc.geometry));
      if (f) {
        popReached += p.pop;
        if (timeToPopMin == null || f.lead < timeToPopMin) timeToPopMin = f.lead;
      }
    }
  }

  const ratePerMin = trend.latest10 / 10;
  const previousRatePerMin = trend.previous10 / 10;
  let phase = 'steady';
  if (track.cycles <= 3 && trend.previous10 <= 2) phase = 'developing';
  else if (trend.logRatio >= 0.5) phase = 'intensifying';
  else if (trend.logRatio <= -0.5) phase = 'weakening';

  const towardDeg = (Math.atan2(motion.vx, motion.vy) * 180) / Math.PI;
  const last = forecast[forecast.length - 1];

  // Confidence: a transparent points score, recorded with its parts.
  const conf = [];
  let score = 0;
  if (!feedOk) conf.push('lightning feed not live (-)'); else { score += 1; conf.push('lightning feed live (+)'); }
  if (coverage.quality === 'good') { score += 1; conf.push('good network coverage (+)'); } else conf.push(`${coverage.quality} network coverage (-)`);
  if (track.cycles >= 5) { score += 1; conf.push(`storm tracked for ${track.cycles} minutes (+)`); } else conf.push(`storm only ${track.cycles} minute(s) old (-)`);
  if (motion.spreadKmh != null && motion.spreadKmh > 25) { score -= 1; conf.push(`motion estimates disagree by ${Math.round(motion.spreadKmh)} km/h (-)`); }
  if (model.trained && model.skillPositive) { score += 1; conf.push('trained model with verified skill (+)'); } else conf.push('baseline model (-)');
  if (env && Number.isFinite(env.cape)) { score += 0.5; conf.push('model atmosphere available (+)'); }
  const confidence = score >= 3.5 ? 'high' : score >= 2 ? 'medium' : 'low';

  return {
    ok, geometry, areaKm2, centroid, forecast, corridor: corridorG && isValidGeometry(corridorG) ? corridorG : null,
    peakP, peakLead, peakAt: now + peakLead * 60e3, peakDensity100,
    ratePerMin, previousRatePerMin, trendLogRatio: trend.logRatio, strikes10: trend.latest10, phase,
    motion: { speedKmh: motion.speedKmh, towardDeg: (towardDeg + 360) % 360, vx: motion.vx, vy: motion.vy, sources: motion.sources, spreadKmh: motion.spreadKmh },
    track: {
      points: [{ lead: 0, lat: centroid[0], lon: centroid[1] }, ...forecast.map((f) => ({ lead: f.lead, lat: f.centroid[0], lon: f.centroid[1] }))],
      bearingDeg: last ? bearingDeg(centroid[0], centroid[1], last.centroid[0], last.centroid[1]) : null,
    },
    geo, exposedPopulation: geo ? geo.population : 0, populationAhead: popReached, timeToPopMin,
    confidence, confidenceReasons: conf,
    coverage: coverage.quality,
  };
}

/* ── DECIDE ───────────────────────────────────────────────────────────── */

/**
 * The severity the evidence supports, with the reasons. `relax` < 1 loosens
 * the thresholds — that is how the (lower) exit criteria for hysteresis are
 * evaluated, from the same rules.
 */
export function decide(a, cfg, relax = 1) {
  const reasons = [];
  if (!a.ok || a.areaKm2 < cfg.minAreaKm2 * relax) {
    return { level: null, reasons: [`no warning-sized area above ${cfg.areaProbability} probability`] };
  }
  const pAdj = (p) => (relax < 1 ? p - (1 - relax) * 0.25 : p);
  const y = cfg.yellow;
  if (a.strikes10 < y.minStrikes10 * relax || a.peakP < pAdj(y.minPeakProbability)) {
    return { level: null, reasons: [`${a.strikes10} strikes in 10 min / peak probability ${a.peakP.toFixed(2)} below yellow criteria`] };
  }
  let level = 'yellow';
  reasons.push(`${a.strikes10} strikes in the last 10 minutes; peak lightning probability ${(a.peakP * 100).toFixed(0)}% within ${a.peakLead} min`);

  const am = cfg.amber;
  const sustained = a.ratePerMin >= am.minStrikesPerMin * relax && a.peakP >= pAdj(am.minPeakProbability);
  const approaching = a.populationAhead + a.exposedPopulation >= am.approachPopulation && a.timeToPopMin != null
    && a.timeToPopMin <= am.approachMinutes && a.ratePerMin >= am.approachMinStrikesPerMin * relax;
  const rapid = a.trendLogRatio >= am.rapidTrendLogRatio * relax && a.ratePerMin >= am.rapidMinStrikesPerMin * relax;
  if (sustained || approaching || rapid) {
    level = 'amber';
    if (sustained) reasons.push(`sustained rate of ${a.ratePerMin.toFixed(1)} strikes/min`);
    if (approaching) reasons.push(`forecast to reach populated areas (${Math.round((a.populationAhead + a.exposedPopulation) / 1000)}k people) within ${a.timeToPopMin} min`);
    if (rapid) reasons.push(`rapid intensification (rate x${Math.exp(a.trendLogRatio).toFixed(1)} in 10 min)`);

    const r = cfg.red;
    const core = a.ratePerMin >= r.minStrikesPerMin * relax && a.peakDensity100 >= r.minPeakDensity100 * relax
      && a.peakP >= pAdj(r.minPeakProbability);
    const exposed = a.exposedPopulation + a.populationAhead >= r.minExposedPopulation || a.ratePerMin >= r.exceptionalStrikesPerMin * relax;
    const confOk = CONF_RANK[a.confidence] >= CONF_RANK[r.minConfidence];
    if (core && exposed && confOk) {
      level = 'red';
      reasons.push(`intense core: ${a.ratePerMin.toFixed(0)} strikes/min, ${a.peakDensity100.toFixed(1)} per 100 km² in 10 min`);
    } else if (core && exposed && !confOk) {
      reasons.push(`red criteria met but confidence is ${a.confidence} — held at amber`);
    }
  }
  if (a.coverage === 'partial' && levelRank(level) > levelRank(cfg.partialCoverageCap)) {
    reasons.push(`capped at ${cfg.partialCoverageCap}: lightning detection here is partial`);
    level = cfg.partialCoverageCap;
  }
  return { level, reasons };
}

/* ── timing ───────────────────────────────────────────────────────────── */

/**
 * The warning's own expiry, from the forecast: how long until the storm has
 * either moved off the area or decayed below warning level, plus a margin.
 */
export function computeExpiry(a, now, issuedAt, cfg) {
  const extentKm = Math.sqrt(Math.max(a.areaKm2, 1));
  let transitMin = Infinity;
  if (a.motion.speedKmh >= 5) transitMin = ((extentKm * 1.5) / a.motion.speedKmh) * 60;
  let lifetimeMin;
  if (a.trendLogRatio < -0.15 && a.ratePerMin > 0) {
    const k = -a.trendLogRatio / 10; // per minute exponential decay
    lifetimeMin = Math.log(Math.max(1.05, a.ratePerMin / 0.3)) / k;
  } else {
    // Steady or growing: ordinary cells live ~30–60 min, organised systems
    // hours; strike rate is the best available proxy for organisation.
    lifetimeMin = 40 + Math.min(100, a.ratePerMin * 4);
  }
  const remaining = Math.min(lifetimeMin, transitMin + 20) + 15;
  const minEnd = issuedAt + cfg.minDurationMin * 60e3;
  const maxEnd = issuedAt + cfg.maxDurationMin * 60e3;
  const at = Math.round(Math.min(maxEnd, Math.max(minEnd, now + remaining * 60e3)) / 60e3) * 60e3;
  return { expiresAt: at, basis: { lifetimeMin: Math.round(lifetimeMin), transitMin: Number.isFinite(transitMin) ? Math.round(transitMin) : null } };
}

/* ── records & events ─────────────────────────────────────────────────── */

function newId(isTest, now) {
  const s = getState();
  s.seq = (s.seq || 0) + 1;
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  return `${isTest ? 'TEST' : 'AIW'}-${d}-${String(s.seq).padStart(5, '0')}`;
}

function tzOf(geo) {
  const tz = (geo?.places?.[0] || geo?.anchor)?.tz || 'UTC';
  let label = tz;
  try {
    label = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch { /* fall back to the id */ }
  return { tz, tzLabel: label };
}

export function pushEvent(type, w, { from = null, to = null, reason = null, actor = 'engine', now = Date.now() } = {}) {
  const s = getState();
  const ev = {
    id: crypto.randomUUID(), at: now, type, warningId: w.id, isTest: !!w.isTest,
    from, to, reason, actor, severity: w.severity, expiresAt: w.expiresAt,
  };
  s.events.push(ev);
  if (s.events.length > 20000) s.events.splice(0, s.events.length - 20000);
  appendLog('events', ev);
  return ev;
}

function pushAnnouncement(kind, w, ev, facts, prevSeverity, now) {
  const s = getState();
  const a = {
    id: crypto.randomUUID(), eventId: ev.id, warningId: w.id, at: now, kind,
    severity: w.severity, priority: levelRank(w.severity) + (kind === 'escalated' ? 1 : 0),
    text: announcementText(kind, facts, prevSeverity), isTest: !!w.isTest,
    country: w.countries?.[0] || null, continent: w.continents?.[0] || null,
    centroid: w.centroid,
  };
  s.announcements.push(a);
  if (s.announcements.length > 5000) s.announcements.splice(0, s.announcements.length - 5000);
  appendLog('announcements', a);
  return a;
}

function appendLog(kind, obj) {
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    fs.appendFileSync(path.join(ARCHIVE_DIR, `${kind}-${new Date(obj.at).toISOString().slice(0, 7)}.ndjson`), JSON.stringify(obj) + '\n');
  } catch (err) { console.error('[aiw] log append failed', err.code || err.message); }
}

/** The fact sheet text generation works from. Only measured/computed values. */
function buildFacts(w, a, now) {
  return {
    severity: w.severity, phase: a.phase, ratePerMin: a.ratePerMin, previousRatePerMin: a.previousRatePerMin,
    motion: a.motion, geo: a.geo, issuedAt: w.issuedAt, expiresAt: w.expiresAt, peakAt: a.peakAt,
    confidence: a.confidence, coverage: a.coverage, modelTrained: !!w.model?.trained,
    tz: w.tz, tzLabel: w.tzLabel, isTest: w.isTest, now,
  };
}

/**
 * A light copy of an area for the version history, the forecast log and the archive: about a
 * kilometre of detail and three decimals. The live polygons carry a vertex every few hundred
 * metres, and keeping every version and every logged forecast of them at that detail is what
 * made state.json tens of MB (rewritten every minute) and a month's archive 788 MB — past the
 * largest string Node can read, so the warning history stopped loading.
 */
export function lightGeo(g, tolDeg = 0.008) {
  if (!g || !g.coordinates) return g;
  // simplify() measures each point against the line between a run's two ends; a closed ring's ends
  // are the same point, so every distance is zero and nothing would go. Simplify it open, then close.
  const ring = (r) => {
    const closed = r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
    const open = closed ? r.slice(0, -1) : r;
    const s = simplify(open, tolDeg).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
    if (closed) s.push(s[0]);
    return s.length >= 4 ? s : r;
  };
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map(ring) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(ring)) };
  return g;
}

/** What a finished warning keeps in the archive: everything shown or scored later. Its forecast
 *  log (already scored by then) goes, its shapes are lightened, and of its versions every detail is
 *  kept but only the original's shape (the original is never overwritten; the rest repeat it). */
export function archiveCopy(w) {
  return {
    ...w,
    trackLog: undefined,
    geometry: lightGeo(w.geometry, 0.004),
    corridor: lightGeo(w.corridor, 0.01),
    forecast: (w.forecast || []).map((f) => ({ ...f, geometry: lightGeo(f.geometry, 0.01) })),
    versions: (w.versions || []).map(({ geometry, forecastEnd: _end, ...v }, i) => (i === 0 ? { ...v, geometry: lightGeo(geometry) } : v)),
  };
}

function snapshot(w, now, reason) {
  w.versions = w.versions || [];
  w.versions.push({
    at: now, reason, severity: w.severity, expiresAt: w.expiresAt, description: w.description,
    geometry: lightGeo(w.geometry), forecastEnd: lightGeo(w.forecast?.[w.forecast.length - 1]?.geometry) || null, areaKm2: w.areaKm2,
    placeNames: (w.places || []).slice(0, 20),
  });
  if (w.versions.length > 40) w.versions.splice(1, w.versions.length - 40); // keep the original
}

/** Apply an assessment to a warning record (new or existing). */
function applyAssessment(w, a, now, ctx) {
  w.geometry = a.geometry;
  w.centroid = [+a.centroid[0].toFixed(4), +a.centroid[1].toFixed(4)];
  w.areaKm2 = Math.round(a.areaKm2);
  w.forecast = a.forecast;
  w.corridor = a.corridor;
  logForecast(w, now);
  w.track = { ...a.track, speedKmh: Math.round(a.motion.speedKmh), towardDeg: Math.round(a.motion.towardDeg) };
  w.peakAt = a.peakAt;
  w.geography = a.geo;
  w.places = a.geo.places.map((p) => p.name);
  w.countries = a.geo.countries.map((c) => c.country);
  w.countryCodes = a.geo.countries.map((c) => c.cc);
  w.continents = a.geo.continents;
  w.admin1 = [...new Set(a.geo.countries.flatMap((c) => c.admin1))];
  w.admin2 = [...new Set(a.geo.countries.flatMap((c) => c.admin2))];
  w.areaLabel = regionLabel(a.geo);
  Object.assign(w, tzOf(a.geo));
  w.evidence = {
    strikes10: a.strikes10, ratePerMin: +a.ratePerMin.toFixed(2), previousRatePerMin: +a.previousRatePerMin.toFixed(2),
    trendLogRatio: +a.trendLogRatio.toFixed(2), phase: a.phase,
    peakProbability: +a.peakP.toFixed(3), peakLeadMin: a.peakLead, peakDensity100: +a.peakDensity100.toFixed(2),
    exposedPopulation: a.exposedPopulation, populationAhead: a.populationAhead, timeToPopulationMin: a.timeToPopMin,
    motionSources: a.motion.sources, motionSpreadKmh: a.motion.spreadKmh != null ? Math.round(a.motion.spreadKmh) : null,
    trackCycles: ctx.track.cycles,
    environment: ctx.env ? {
      source: ctx.env.source, validHour: ctx.env.validHour, cape: ctx.env.cape, liftedIndex: ctx.env.liftedIndex,
      cin: ctx.env.cin, shear0_6kmKmh: ctx.env.shear0_6kmKmh != null ? Math.round(ctx.env.shear0_6kmKmh) : null,
      steeringKmh: ctx.env.steering?.speedKmh ?? null, showersMmH: ctx.env.showersMmH,
    } : null,
  };
  w.confidence = a.confidence;
  w.confidenceReasons = a.confidenceReasons;
  w.coverage = a.coverage;
  w.dataQuality = ctx.dataQuality;
  w.model = ctx.modelInfo;
  w.updatedAt = now;
  w.lastActivityAt = now;
  const ex = computeExpiry(a, now, w.issuedAt, ctx.cfg);
  const prevExp = w.expiresAt;
  if (prevExp == null) { w.expiresAt = ex.expiresAt; w.expiryBasis = ex.basis; }
  else if (ctx.feedOk) {
    /* Move the expiry towards the newly computed one gradually — at most 10
       minutes later or 5 earlier per cycle — so one noisy minute of data
       does not swing it back and forth. A sustained change still arrives
       within a few cycles. Never extended while the feed is down. */
    const step = Math.max(-5 * 60e3, Math.min(10 * 60e3, ex.expiresAt - prevExp));
    w.expiresAt = Math.round((prevExp + step) / 60e3) * 60e3;
    w.expiryBasis = ex.basis;
  }
  w.predictedExpiresAt = w.expiresAt;
  const facts = buildFacts(w, a, now);
  w.description = describe(facts);
  w.summary = shortSummary(facts);
  w.title = title(facts);
  return { facts, prevExp };
}

/**
 * Keep a 30-minute forecast every ten minutes for the life of the warning, so
 * that once it is over the forecast can be scored against what happened.
 */
function logForecast(w, now) {
  w.trackLog = w.trackLog || [];
  const last = w.trackLog[w.trackLog.length - 1];
  if (last && now - last.at < 10 * 60e3) return;
  w.trackLog.push({ at: now, severity: w.severity, forecast: (w.forecast || []).map((f) => ({ lead: f.lead, geometry: lightGeo(f.geometry) })) });
  if (w.trackLog.length > 24) w.trackLog.shift();
}

/* ── RECONCILE: the per-cycle lifecycle ───────────────────────────────── */

/**
 * Called once per cycle with every assessed track. Mutates persistent state.
 * Returns the list of changed warning ids (for the live stream).
 */
export function reconcile({ assessed, tracks, now, feedOk, modelInfo, dataQuality, paused }) {
  const s = getState();
  const cfg = getConfig();
  const changed = new Set();
  const active = s.warnings.filter((w) => w.status === 'active' && !w.isTest);

  for (const item of assessed) {
    const { track, a, env } = item;
    let w = active.find((x) => x.trackId === track.id);
    // A storm already under a warning that has acquired a new track id (a
    // re-identified cell) is recognised by overlap, not issued twice.
    if (!w && a.ok) {
      w = active.find((x) => x.geometry && !assessed.some((o) => o.track.id === x.trackId && o !== item)
        && (overlapFraction(a.geometry, x.geometry) > 0 || overlapFraction(x.geometry, a.geometry) > 0));
      if (w) {
        // Same area as an existing warning: EXPAND that warning rather than
        // issuing a second one on top of it.
        pushEvent('updated', w, { reason: `expanded to cover adjacent storm activity (track ${w.trackId} -> ${track.id})`, now });
        w.trackId = track.id;
      }
    }
    const entry = decide(a, cfg, 1);
    const stay = decide(a, cfg, cfg.exitFactor);
    const ctx = { track, env, cfg, feedOk, modelInfo, dataQuality };
    track.hyst = track.hyst || { up: 0, down: 0, upLevel: null };
    const cur = w ? w.severity : null;
    const curRank = levelRank(cur);
    let target = cur;

    if (levelRank(entry.level) > curRank) {
      track.hyst.down = 0;
      track.hyst.up = track.hyst.upLevel === entry.level ? track.hyst.up + 1 : 1;
      track.hyst.upLevel = entry.level;
      const need = cur ? cfg.escalateCycles : 1;
      if (track.hyst.up >= need && (cur || track.cycles >= cfg.minCyclesToIssue)) target = entry.level;
    } else if (levelRank(stay.level) < curRank) {
      track.hyst.up = 0;
      track.hyst.down += 1;
      if (track.hyst.down >= cfg.downgradeCycles) target = stay.level;
    } else {
      track.hyst.up = 0; track.hyst.down = 0;
    }

    if (!w) {
      if (!target) continue;
      if (paused || !feedOk || a.coverage === 'none' || !a.ok) continue; // never issue blind
      w = {
        id: newId(false, now), trackId: track.id, isTest: false, status: 'active', state: 'issued',
        severity: target, issuedAt: now, validFrom: now, createdAt: now,
        relatedTo: track.parentId ? { parentTrackId: track.parentId, parentWarningId: s.warnings.find((x) => x.trackId === track.parentId)?.id || null } : null,
        configUsed: cfg,
      };
      const { facts } = applyAssessment(w, a, now, ctx);
      w.reasons = entry.reasons;
      s.warnings.push(w);
      active.push(w);
      snapshot(w, now, 'issued');
      const ev = pushEvent('issued', w, { to: target, reason: entry.reasons.join('; '), now });
      pushAnnouncement('issued', w, ev, facts, null, now);
      changed.add(w.id);
      track.hyst.up = 0;
      continue;
    }

    // Existing warning.
    const lastV = w.versions?.[w.versions.length - 1];
    const before = {
      severity: w.severity, expiresAt: w.expiresAt,
      // Compare with the last RECORDED version, not the previous minute, so
      // a storm that drifts slowly still registers once it has really moved.
      eventExpiresAt: lastV?.expiresAt ?? w.expiresAt,
      geometry: lastV?.geometry || w.geometry, areaKm2: lastV?.areaKm2 || w.areaKm2,
      places: new Set(w.places || []),
    };
    if (target == null) {
      endWarning(w, 'cancelled', `lightning risk fell below warning criteria for ${cfg.downgradeCycles} consecutive minutes (${stay.reasons.join('; ')})`, now);
      changed.add(w.id);
      continue;
    }
    if (!a.ok) continue; // keep the last good geometry this cycle
    w.severity = target;
    const { facts, prevExp } = applyAssessment(w, a, now, ctx);
    w.reasons = (levelRank(target) >= levelRank(entry.level) ? entry : stay).reasons;
    changed.add(w.id);

    if (levelRank(target) > levelRank(before.severity)) {
      w.state = 'escalated';
      snapshot(w, now, 'escalated');
      const ev = pushEvent('escalated', w, { from: before.severity, to: target, reason: entry.reasons.join('; '), now });
      pushAnnouncement('escalated', w, ev, facts, before.severity, now);
      track.hyst.up = 0;
      continue;
    }
    if (levelRank(target) < levelRank(before.severity)) {
      w.state = 'downgraded';
      snapshot(w, now, 'downgraded');
      const ev = pushEvent('downgraded', w, { from: before.severity, to: target, reason: stay.reasons.join('; '), now });
      pushAnnouncement('downgraded', w, ev, facts, before.severity, now);
      track.hyst.down = 0;
      continue;
    }
    // Same level: is the change material?
    void prevExp;
    const shift = (w.expiresAt - before.eventExpiresAt) / 60e3;
    const newPlaces = (w.geography?.places || []).filter((p) => !before.places.has(p.name) && p.pop >= 50000
      && !(lastV?.placeNames || []).includes(p.name));
    const areaChange = before.areaKm2 ? Math.abs(w.areaKm2 - before.areaKm2) / before.areaKm2 : 0;
    const moved = before.geometry ? 1 - overlapFraction(w.geometry, before.geometry, 225) : 0;
    if (Math.abs(shift) >= 20 || newPlaces.length || areaChange > 0.6 || moved > 0.6) {
      const type = shift >= 20 ? 'extended' : shift <= -20 ? 'shortened' : 'updated';
      w.state = type;
      snapshot(w, now, type);
      const why = [
        Math.abs(shift) >= 20 ? `expiry moved ${shift > 0 ? 'later' : 'earlier'} by ${Math.round(Math.abs(shift))} min` : null,
        newPlaces.length ? `now covers ${newPlaces.map((p) => p.name).join(', ')}` : null,
        areaChange > 0.6 ? `area changed by ${Math.round(areaChange * 100)}%` : null,
        moved > 0.6 ? 'warning area has moved' : null,
      ].filter(Boolean).join('; ');
      const ev = pushEvent(type, w, { reason: why, now });
      const lastAnn = [...s.announcements].reverse().find((x) => x.warningId === w.id);
      if (cfg.announceUpdates && (Math.abs(shift) >= 20 || newPlaces.length) && (!lastAnn || now - lastAnn.at > 10 * 60e3)) {
        pushAnnouncement('updated', w, ev, facts, null, now);
      }
    } else {
      w.state = 'updated';
    }
  }

  // Warnings whose storm is gone, merged, quiet, or past expiry.
  for (const w of s.warnings) {
    if (w.status !== 'active' || w.isTest) continue;
    const t = tracks.get(w.trackId);
    if (t?.mergedInto) {
      const host = s.warnings.find((x) => x.status === 'active' && x.trackId === t.mergedInto);
      if (host && host.id !== w.id) {
        host.relatedTo = { ...(host.relatedTo || {}), mergedFrom: [...(host.relatedTo?.mergedFrom || []), w.id] };
        endWarning(w, 'cancelled', `storm merged with the storm under ${host.id}`, now, 'merged');
        changed.add(w.id); changed.add(host.id);
        continue;
      }
      w.trackId = t.mergedInto; // the surviving storm carries this warning
    }
    /* After a server restart the in-memory storm tracks are gone. That is not
       evidence the storm has stopped, so measure quiet time from the last
       time this warning was matched to activity; overlap re-identification
       (above) reattaches it to its storm on the next cycle. */
    const quietFor = t ? now - t.lastSeen : now - (w.lastActivityAt || w.updatedAt || w.issuedAt);
    if (feedOk && quietFor > cfg.quietCancelMin * 60e3) {
      endWarning(w, 'cancelled', `no lightning from this storm for ${Math.round(quietFor / 60e3)} minutes`, now);
      changed.add(w.id); continue;
    }
    if (now >= w.expiresAt) {
      endWarning(w, 'expired', feedOk ? 'reached its expiry time' : 'reached its expiry time while the lightning feed was unavailable (not extended)', now);
      changed.add(w.id); continue;
    }
    w.dataStale = !feedOk;
  }
  mergeOverlapping(now, changed, new Set(assessed.map((x) => x.track.id)));
  archiveFinished(now);
  saveState();
  return [...changed];
}

/**
 * Active warnings must never overlap. Any two that do are merged: the more
 * severe one survives (on a tie, the one still being fed by a live storm,
 * then the older) and the other is closed as merged into it. Runs every
 * cycle, so overlap left over from any cause is cleaned up within a minute.
 */
function mergeOverlapping(now, changed, liveTracks) {
  const act = getState().warnings.filter((x) => x.status === 'active' && !x.isTest && x.geometry);
  const box = new Map(act.map((x) => [x.id, geoBBoxSafe(x.geometry)]));
  for (let i = 0; i < act.length; i += 1) {
    for (let j = i + 1; j < act.length; j += 1) {
      const A = act[i]; const B = act[j];
      if (A.status !== 'active' || B.status !== 'active') continue;
      const a = box.get(A.id); const b = box.get(B.id);
      if (!(a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3])) continue;
      if (!(overlapFraction(A.geometry, B.geometry, 900) > 0 || overlapFraction(B.geometry, A.geometry, 900) > 0)) continue;
      const score = (x) => levelRank(x.severity) * 10 + (liveTracks.has(x.trackId) ? 5 : 0) - x.issuedAt / 1e13;
      const [keep, drop] = score(A) >= score(B) ? [A, B] : [B, A];
      keep.relatedTo = { ...(keep.relatedTo || {}), mergedFrom: [...(keep.relatedTo?.mergedFrom || []), drop.id] };
      if (!liveTracks.has(keep.trackId) && liveTracks.has(drop.trackId)) keep.trackId = drop.trackId;
      if (drop.expiresAt > keep.expiresAt) keep.expiresAt = drop.expiresAt;
      endWarning(drop, 'cancelled', `merged into ${keep.id} — overlapping warnings are combined into one`, now, 'merged');
      pushEvent('updated', keep, { reason: `expanded: absorbed overlapping warning ${drop.id}`, now });
      changed.add(keep.id); changed.add(drop.id);
    }
  }
}
function geoBBoxSafe(g) { try { return geoBBoxImport(g); } catch { return [180, 90, -180, -90]; } }

export function endWarning(w, status, reason, now, eventType = null, actor = 'engine') {
  w.status = status;
  w.state = status;
  w.endedAt = now;
  w.endReason = reason;
  snapshot(w, now, status);
  pushEvent(eventType || status, w, { reason, now, actor });
}

/* ── history archive ──────────────────────────────────────────────────── */

/** Call fn for each line of a file, a few MB at a time, so a file of any size can be read. */
function eachLine(file, fn) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return; }
  const buf = Buffer.alloc(8 << 20);
  let rest = '';
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      const parts = (rest + buf.toString('utf8', 0, n)).split('\n');
      rest = parts.pop();
      for (const line of parts) if (line) fn(line);
    }
    if (rest) fn(rest);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * One-off repair: rewrite archive months that were written before archiveCopy (each warning with
 * every logged forecast at full detail) and lighten the shapes held in state.json. Streams a line
 * at a time and yields between lines, so the site keeps answering while it runs.
 */
const COMPACT_SCHEME = 2;
export async function compactArchive() {
  let files = [];
  try { files = fs.readdirSync(ARCHIVE_DIR); } catch { return; }
  const markFile = path.join(ARCHIVE_DIR, '.compacted.json');
  let mark = {};
  try { mark = JSON.parse(fs.readFileSync(markFile, 'utf8')); } catch { /* none yet */ }
  // a compaction the server died in the middle of: put the month back together first
  for (const f of files.filter((x) => x.startsWith('_old-warnings-'))) {
    const file = path.join(ARCHIVE_DIR, f.slice(5));
    const old = path.join(ARCHIVE_DIR, f);
    try { fs.appendFileSync(old, fs.readFileSync(file)); } catch { /* nothing newer */ }
    fs.renameSync(old, file);
    fs.rmSync(path.join(ARCHIVE_DIR, `_new-${f.slice(5)}`), { force: true });
  }
  files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.startsWith('warnings-') && f.endsWith('.ndjson'));
  for (const f of files) {
    const file = path.join(ARCHIVE_DIR, f);
    let size = 0;
    try { size = fs.statSync(file).size; } catch { continue; }
    if (size < 20 << 20 || mark[f] === COMPACT_SCHEME) continue;
    // move the month aside so warnings archived meanwhile start a new file, compact the old one,
    // then add whatever arrived and swap — the last two steps are synchronous, so nothing slips in
    const old = path.join(ARCHIVE_DIR, `_old-${f}`);
    const tmp = path.join(ARCHIVE_DIR, `_new-${f}`);
    fs.renameSync(file, old);
    const out = fs.createWriteStream(tmp);
    const rl = readline.createInterface({ input: fs.createReadStream(old), crlfDelay: Infinity });
    let lines = 0;
    for await (const line of rl) {
      if (!line) continue;
      let text;
      try { text = JSON.stringify(archiveCopy(JSON.parse(line))); } catch { continue; }   // a torn line
      lines += 1;
      if (!out.write(text + '\n')) await new Promise((r) => out.once('drain', r));
      await new Promise((r) => setImmediate(r));
    }
    await new Promise((r) => out.end(r));
    try { fs.appendFileSync(tmp, fs.readFileSync(file)); } catch { /* nothing arrived */ }
    fs.renameSync(tmp, file);
    fs.rmSync(old, { force: true });
    mark[f] = COMPACT_SCHEME;
    fs.writeFileSync(markFile, JSON.stringify(mark));
    console.log(`[aiw] compacted ${f}: ${(size / 1048576).toFixed(0)} MB -> ${(fs.statSync(file).size / 1048576).toFixed(0)} MB (${lines} warnings)`);
  }
  historyCache = null;
  const s = getState();
  for (const w of s.warnings) {
    w.versions = (w.versions || []).map((v) => ({ ...v, geometry: lightGeo(v.geometry), forecastEnd: lightGeo(v.forecastEnd) }));
    w.trackLog = (w.trackLog || []).map((l) => ({ ...l, forecast: (l.forecast || []).map((x) => ({ ...x, geometry: lightGeo(x.geometry) })) }));
  }
  saveState({ now: true });
}

let historyCache = null;

/** Finished warnings leave state.json for a monthly archive file after an hour. */
function archiveFinished(now) {
  const s = getState();
  const keep = []; const out = [];
  for (const w of s.warnings) {
    if (w.status !== 'active' && w.endedAt && now - w.endedAt > 60 * 60e3 && w.verification) out.push(w);
    else keep.push(w);
  }
  if (!out.length) return;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const w of out) {
    const slim = archiveCopy(w);
    fs.appendFileSync(path.join(ARCHIVE_DIR, `warnings-${new Date(w.issuedAt).toISOString().slice(0, 7)}.ndjson`), JSON.stringify(slim) + '\n');
    if (historyCache) historyCache.set(w.id, slim);
  }
  s.warnings = keep;
}

/** Months of archive held in memory for the lists; older warnings are still found by id. */
const HISTORY_MONTHS = 3;

/** Every warning in the last few months of the archive, plus current state. */
export function allWarnings() {
  if (!historyCache) {
    historyCache = new Map();
    let files = [];
    try { files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.startsWith('warnings-') && f.endsWith('.ndjson')).sort().slice(-HISTORY_MONTHS); } catch { /* none */ }
    for (const f of files) {
      eachLine(path.join(ARCHIVE_DIR, f), (line) => {
        try { const w = JSON.parse(line); historyCache.set(w.id, w.trackLog ? archiveCopy(w) : w); } catch { /* skip */ }
      });
    }
  }
  const map = new Map(historyCache);
  for (const w of getState().warnings) map.set(w.id, w);
  return [...map.values()];
}

/** One warning by id, wherever it is: in state, in the months held in memory, or else read from
 *  its own month's file (ids carry their issue date, AIW-YYYYMMDD-…). */
export function findWarning(id) {
  const hit = allWarnings().find((x) => x.id === id);
  if (hit) return hit;
  const m = /^AIW-(\d{4})(\d{2})\d{2}-/.exec(id);
  if (!m) return null;
  let found = null;
  eachLine(path.join(ARCHIVE_DIR, `warnings-${m[1]}-${m[2]}.ndjson`), (line) => {
    if (found || !line.includes(`"id":"${id}"`)) return;
    try { found = JSON.parse(line); } catch { /* torn line */ }
  });
  return found;
}

/* ── admin / test warnings ────────────────────────────────────────────── */

/**
 * A clearly-labelled TEST warning, so the full lifecycle — polygons, the
 * forecast track, voice, notifications — can be exercised without a real
 * public alert. Test warnings carry isTest, a TEST- id, "This is a test" in
 * every spoken line, and are excluded from public lists unless asked for.
 */
export function issueTestWarning({ lat, lon, severity = 'yellow', speedKmh = 40, towardDeg = 60, radiusKm = 18, durationMin = 30 }, actor, now = Date.now()) {
  if (!SEVERITIES.includes(severity)) throw Object.assign(new Error('bad severity'), { status: 400 });
  const s = getState();
  const circle = (clat, clon, r) => {
    const ring = [];
    for (let i = 0; i <= 48; i += 1) {
      const th = (i / 48) * 2 * Math.PI;
      const stretch = 1 + 0.25 * Math.sin(3 * th); // not a perfect circle, so the renderer is exercised
      ring.push([+(clon + (r * stretch * Math.cos(th)) / (111.32 * Math.cos(clat * Math.PI / 180))).toFixed(4), +(clat + (r * stretch * Math.sin(th)) / 111.32).toFixed(4)]);
    }
    ring[ring.length - 1] = ring[0];
    return { type: 'Polygon', coordinates: [ring] };
  };
  const vx = (speedKmh / 60) * Math.sin(towardDeg * Math.PI / 180);
  const vy = (speedKmh / 60) * Math.cos(towardDeg * Math.PI / 180);
  const geometry = circle(lat, lon, radiusKm);
  const forecast = LEADS.map((L) => {
    const clat = lat + (vy * L) / 111.32;
    const clon = lon + (vx * L) / (111.32 * Math.cos(lat * Math.PI / 180));
    return { lead: L, validAt: now + L * 60e3, geometry: circle(clat, clon, radiusKm + L * 0.3), centroid: [clat, clon] };
  });
  const geo = describeGeography(geometry, [lat, lon], forecast.map((f) => f.geometry));
  const w = {
    id: newId(true, now), trackId: null, isTest: true, status: 'active', state: 'issued', severity,
    issuedAt: now, validFrom: now, createdAt: now, updatedAt: now, expiresAt: now + durationMin * 60e3,
    geometry, centroid: [lat, lon], areaKm2: Math.round(geoAreaKm2(geometry)), forecast,
    corridor: null, track: { points: [{ lead: 0, lat, lon }, ...forecast.map((f) => ({ lead: f.lead, lat: f.centroid[0], lon: f.centroid[1] }))], speedKmh, towardDeg },
    geography: geo, places: geo.places.map((p) => p.name), countries: geo.countries.map((c) => c.country),
    countryCodes: geo.countries.map((c) => c.cc), continents: geo.continents,
    admin1: [...new Set(geo.countries.flatMap((c) => c.admin1))], admin2: [...new Set(geo.countries.flatMap((c) => c.admin2))],
    areaLabel: regionLabel(geo), confidence: 'low', confidenceReasons: ['TEST warning — not a forecast'], coverage: 'test',
    evidence: null, model: { version: 'test', kind: 'test', trained: false }, reasons: [`administrator test issued by ${actor}`],
    ...tzOf(geo),
  };
  const facts = {
    severity, phase: 'steady', ratePerMin: 0, previousRatePerMin: 0, motion: { speedKmh, towardDeg }, geo,
    issuedAt: now, expiresAt: w.expiresAt, peakAt: null, confidence: 'low', coverage: 'good', modelTrained: true,
    tz: w.tz, tzLabel: w.tzLabel, isTest: true,
  };
  w.title = `TEST — ${title(facts)}`;
  w.description = `THIS IS A TEST WARNING issued by an administrator to exercise the warning system. It is not a forecast. ${describe(facts)}`;
  w.summary = 'Administrator test warning — not a forecast.';
  s.warnings.push(w);
  snapshot(w, now, 'issued');
  const ev = pushEvent('issued', w, { to: severity, reason: 'administrator test', actor, now });
  pushAnnouncement('issued', w, ev, facts, null, now);
  saveState({ now: true });
  return w;
}

/** Expire test warnings on their clock; they have no storm behind them. */
export function tickTests(now) {
  let n = 0;
  for (const w of getState().warnings) {
    if (w.isTest && w.status === 'active' && now >= w.expiresAt) { endWarning(w, 'expired', 'test period ended', now); w.verification = { skipped: 'test' }; n += 1; }
  }
  if (n) saveState();
  return n;
}

export function haversine(a, b) { return haversineKm(a[0], a[1], b[0], b[1]); }
