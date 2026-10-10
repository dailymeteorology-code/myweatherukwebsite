/**
 * Training and evaluation pipeline for the lightning nowcast model.
 *
 *   node server/aiw/train.js                 train on everything archived
 *   node server/aiw/train.js --from 2026-10-01 --to 2026-10-20
 *   node server/aiw/train.js --deploy        deploy if it passes the gate
 *
 * Reproducible: the same archive and arguments give the same model (the
 * negative-sampling RNG is seeded).
 *
 * METHOD
 *   1. Replay the strike archive minute by minute (every `--step` minutes)
 *      through exactly the same clustering, tracking, motion and field code
 *      the live engine uses — so the model trains on the inputs it will see.
 *   2. For every storm, every lead time and every grid point near it, the
 *      label is whether a strike actually fell within 8 km of that point in
 *      the 5 minutes ending at the lead time. The future is in the archive.
 *   3. Split CHRONOLOGICALLY: the earliest 70% of the period trains, the
 *      latest 30% tests, with a 35-minute gap between them so no test label
 *      overlaps a training feature window (labels look 30 minutes ahead).
 *   4. Fit weighted logistic regression. Negatives are sub-sampled at a fixed
 *      rate and up-weighted by its inverse, so probabilities stay calibrated.
 *   5. Score the trained model AND two reference forecasts on the held-out
 *      period: persistence (lightning stays where it was in the last ten
 *      minutes) and the baseline (advected persistence). Brier, Brier skill,
 *      POD, FAR, CSI and reliability — overall, per lead time and per region.
 *   6. Save the model with its metrics and the facts of its training. It is
 *      DEPLOYED only if it passes the gate below; otherwise it is kept as a
 *      research model and the engine stays on the baseline.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStrikes, archiveSummary, writeJsonAtomic, MODEL_DIR, getState, saveState } from './store.js';
import {
  clusterStrikes, summariseCluster, updateTracks, crossCorrelationMotion, historyMotion, blendMotion,
  buildFields, trendOf, LEADS, observedHits, HIT_RADIUS_KM,
} from './nowcast.js';
import { featureVector, fitLogistic, BASELINE, createScorer, FEATURE_NAMES } from './model.js';
import { coverageAt } from './ingest.js';
import { envAt } from './env.js';
import { haversineKm } from './geometry.js';

/** The deployment gate. A model that fails any of these stays in research. */
export const GATE = {
  minArchiveHours: 24,        // at least a day of data, so more than one storm regime is seen
  minTestPositives: 2000,     // enough lightning in the test period to measure anything
  mustBeatBaseline: true,     // lower Brier score than advected persistence…
  mustBeatPersistence: true,  // …and than plain persistence, on held-out data
};

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Replay [from, to) and yield, per cycle, every assessed storm's fields and
 * the observed outcome rasters. Uses the live engine's code paths.
 */
export async function* replay({ from, to, stepMin = 2, withEnv = true, onProgress }) {
  const all = readStrikes(from - 35 * 60e3, to + 31 * 60e3);
  const tracks = new Map();
  let seq = 0;
  const nextId = () => `R${seq++}`;
  let lo = 0;
  const total = Math.ceil((to - from) / (stepMin * 60e3));
  let k = 0;
  for (let now = from; now < to; now += stepMin * 60e3) {
    k += 1;
    while (lo < all.length && all[lo].time < now - 35 * 60e3) lo += 1;
    let hi = lo;
    while (hi < all.length && all[hi].time <= now) hi += 1;
    const recent = all.slice(lo, hi);
    const last15 = recent.filter((s) => s.time >= now - 15 * 60e3);
    const cells = clusterStrikes(last15).map((m) => ({ ...summariseCluster(m, now), members: m })).filter((c) => c.count15 >= 6);
    updateTracks(tracks, cells, now, nextId);
    const live = [...tracks.values()].filter((t) => !t.dead && t.lastSeen === now && t.n10 >= 3);
    // Future strikes for labels.
    let fh = hi;
    while (fh < all.length && all[fh].time <= now + 31 * 60e3) fh += 1;
    const future = all.slice(hi, fh);
    for (const track of live) {
      const local = recent.filter((s) => Math.abs(s.lat - track.lat) < 3 && Math.abs(s.lon - track.lon) < 4);
      const env = withEnv ? await envAt(track.lat, track.lon, now) : null;
      const motion = blendMotion({
        hist: historyMotion(track.history),
        xcorr: crossCorrelationMotion(local.filter((x) => haversineKm(track.lat, track.lon, x.lat, x.lon) < track.radiusKm + 60), track, now),
        steering: env?.steering || null,
      });
      track.vx = motion.vx; track.vy = motion.vy;
      const fields = buildFields(track, local, now, motion, { motionUncKmh: motion.spreadKmh ?? 15 });
      const trend = trendOf(local, track, now);
      const localFuture = future.filter((s) => Math.abs(s.lat - track.lat) < 4 && Math.abs(s.lon - track.lon) < 5);
      const outcomes = {};
      for (const L of LEADS) outcomes[L] = observedHits(fields.grid, localFuture, now + (L - 5) * 60e3, now + L * 60e3);
      const persistence = observedHits(fields.grid, local, now - 10 * 60e3, now + 1);
      yield {
        now, track, fields, outcomes, persistence,
        ctx: { trend: trend.logRatio, n10: track.n10, cape: env?.cape, cycles: track.cycles },
        region: coverageAt(track.lat, track.lon).id,
        ratePerMin: trend.latest10 / 10,
      };
    }
    if (onProgress && k % 20 === 0) onProgress(k, total);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt && !nxt.startsWith('--')) { out[key] = nxt; i += 1; } else out[key] = true;
    }
  }
  return out;
}

export async function train({ from, to, stepMin = 2, negRate = 0.04, seed = 7, deploy = false, log = console.log } = {}) {
  const summary = archiveSummary();
  if (!summary.firstHour) throw new Error('No archived strikes yet — the server records them from the moment it starts.');
  from = from ?? summary.firstHour + 35 * 60e3;
  to = to ?? Math.min(Date.now() - 31 * 60e3, summary.lastHour + 3600e3);
  if (to - from < 90 * 60e3) throw new Error(`Only ${Math.round((to - from) / 60e3)} usable minutes archived; need at least 90.`);
  const split = from + 0.7 * (to - from);
  const gap = 35 * 60e3;
  const rnd = seededRandom(seed);
  log(`[train] period ${new Date(from).toISOString()} -> ${new Date(to).toISOString()}  split ${new Date(split).toISOString()}`);

  const X = []; const y = []; const w = [];
  const scorers = { model: null, baseline: createScorer(), persistence: createScorer() };
  const byLead = {}; const byRegion = {};
  for (const L of LEADS) byLead[L] = { baseline: createScorer(), persistence: createScorer(), model: createScorer() };
  const testItems = [];
  const rates = [];
  let trainPos = 0; let testPos = 0;

  for await (const item of replay({ from, to, stepMin, onProgress: (k, n) => log(`[train] replay ${k}/${n}`) })) {
    rates.push(item.ratePerMin);
    const isTrain = item.now < split;
    const isTest = item.now >= split + gap;
    if (!isTrain && !isTest) continue;
    const n = item.fields.grid.nx * item.fields.grid.ny;
    for (const L of LEADS) {
      const out = item.outcomes[L];
      for (let k = 0; k < n; k += 1) {
        const o = out[k];
        let weight = 1;
        if (!o) { if (rnd() > negRate) continue; weight = 1 / negRate; }
        if (isTrain) {
          X.push(featureVector(item.fields, L, k, item.ctx)); y.push(o); w.push(weight);
          if (o) trainPos += 1;
        } else {
          // Keep only the feature vector, not the rasters: memory stays
          // proportional to the sample count, not to the grid size.
          testItems.push([featureVector(item.fields, L, k, item.ctx), L, item.region, o, weight]);
          if (o) testPos += 1;
          const pb = BASELINE.predict(item.fields, L, k);
          const pp = item.persistence[k];
          scorers.baseline.add(pb, o, weight); scorers.persistence.add(pp, o, weight);
          byLead[L].baseline.add(pb, o, weight); byLead[L].persistence.add(pp, o, weight);
          byRegion[item.region] = byRegion[item.region] || { baseline: createScorer(), persistence: createScorer(), model: createScorer() };
          byRegion[item.region].baseline.add(pb, o, weight); byRegion[item.region].persistence.add(pp, o, weight);
        }
      }
    }
  }
  log(`[train] training samples ${X.length} (positives ${trainPos}); test samples ${testItems.length} (positives ${testPos})`);
  if (!X.length || !trainPos) throw new Error('No lightning in the training period — nothing to learn from.');

  const weights = fitLogistic(X, y, w, { l2: 1e-2, iters: 40 });
  const version = `logistic-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
  const spec = { version, weights, features: FEATURE_NAMES };
  scorers.model = createScorer();
  for (const [x, L, region, o, weight] of testItems) {
    let z = 0;
    for (let i = 0; i < x.length; i += 1) z += weights[i] * x[i];
    const p = 1 / (1 + Math.exp(-z));
    scorers.model.add(p, o, weight); byLead[L].model.add(p, o, weight); byRegion[region].model.add(p, o, weight);
  }

  const test = {
    overall: scorers.model.result(),
    baseline: scorers.baseline.result(),
    persistence: scorers.persistence.result(),
    byLead: Object.fromEntries(LEADS.map((L) => [L, { model: byLead[L].model.result(), baseline: byLead[L].baseline.result(), persistence: byLead[L].persistence.result() }])),
    byRegion: Object.fromEntries(Object.entries(byRegion).map(([r, s]) => [r, { model: s.model.result(), baseline: s.baseline.result(), persistence: s.persistence.result() }])),
  };
  const beatsBaseline = test.overall.brier < test.baseline.brier;
  const beatsPersistence = test.overall.brier < test.persistence.brier;
  const archiveHours = (summary.lastHour - summary.firstHour) / 3600e3 + 1;
  const gateFailures = [];
  if (archiveHours < GATE.minArchiveHours) gateFailures.push(`only ${archiveHours.toFixed(1)} h archived (need ${GATE.minArchiveHours})`);
  if (testPos < GATE.minTestPositives) gateFailures.push(`only ${testPos} lightning samples in the test period (need ${GATE.minTestPositives})`);
  if (GATE.mustBeatBaseline && !beatsBaseline) gateFailures.push('did not beat the advected-persistence baseline');
  if (GATE.mustBeatPersistence && !beatsPersistence) gateFailures.push('did not beat plain persistence');

  const sorted = rates.filter((r) => r > 0).sort((a, b) => a - b);
  const pct = (q) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2) : null);

  const record = {
    ...spec, kind: 'logistic', createdAt: Date.now(),
    hitRadiusKm: HIT_RADIUS_KM, leads: LEADS,
    data: {
      from, to, split, gapMin: gap / 60e3, stepMin, negRate, seed,
      archiveHours: +archiveHours.toFixed(1), trainSamples: X.length, trainPositives: trainPos,
      testSamples: testItems.length, testPositives: testPos,
    },
    metrics: { test, beatsBaselines: beatsBaseline && beatsPersistence },
    cellRatePercentiles: { p50: pct(0.5), p75: pct(0.75), p90: pct(0.9), p97: pct(0.97), p99: pct(0.99), cells: sorted.length },
    gate: { passed: gateFailures.length === 0, failures: gateFailures, criteria: GATE },
    status: 'research',
  };
  if (deploy && record.gate.passed) record.status = 'deployed';
  writeJsonAtomic(path.join(MODEL_DIR, `${version}.json`), record);
  /* When the server spawned this run it owns state.json and registers the
     model itself when we exit — two processes writing the same file would
     race. Run by hand, we register directly. */
  if (process.env.AIW_SPAWNED !== '1') { registerModel(record); saveState({ now: true }); }

  log(`[train] ${version}: Brier ${fmt(test.overall.brier)} (baseline ${fmt(test.baseline.brier)}, persistence ${fmt(test.persistence.brier)}), CSI ${fmt(test.overall.csi)}`);
  log(`[train] gate ${record.gate.passed ? 'PASSED' : 'not passed: ' + gateFailures.join('; ')} -> ${record.status}`);
  return record;
}

const fmt = (v) => (v == null ? 'n/a' : v.toFixed(4));

/** Add a trained model to the registry (and activate it if it was deployed). */
export function registerModel(record) {
  const s = getState();
  s.models = s.models || [];
  if (s.models.some((m) => m.version === record.version)) return;
  const t = record.metrics.test;
  s.models.push({
    version: record.version, createdAt: record.createdAt, kind: record.kind, status: record.status,
    gate: record.gate, brier: t.overall.brier, brierSkill: t.overall.brierSkill,
    baselineBrier: t.baseline.brier, persistenceBrier: t.persistence.brier, data: record.data,
  });
  if (record.status === 'deployed') s.activeModel = record.version;
}

/** Suggest strike-rate thresholds from the archive's own distribution. */
export function deriveThresholds(record) {
  const p = record?.cellRatePercentiles;
  if (!p || p.cells < 200) return null;
  return {
    amber: { minStrikesPerMin: Math.max(2, Math.round(p.p90)) },
    red: { minStrikesPerMin: Math.max(Math.round(p.p90) + 2, Math.round(p.p99)) },
  };
}

// CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  train({
    from: args.from ? Date.parse(args.from) : undefined,
    to: args.to ? Date.parse(args.to) : undefined,
    stepMin: args.step ? Number(args.step) : 2,
    deploy: !!args.deploy,
  }).then(() => process.exit(0)).catch((e) => { console.error('[train] failed:', e.message); process.exit(1); });
}
