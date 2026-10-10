// ─────────────────────────────────────────────────────────────────────────────
// TCM CALIBRATION HARNESS  —  "train" the risk engine against historical data.
//
// The TCM engine (lib/tcmEngineScores.js) is a DETERMINISTIC physics engine, not
// an ML model. It cannot be "trained" in the neural-net sense. What CAN be tuned,
// WITHOUT touching the ingredient physics, are two calibration knobs:
//
//   1. THUNDER_OCCUR_SCORE — the 0–100 thunderstorm-score cut-off above which we
//      declare "a thunderstorm occurs".
//   2. The thunderProb logistic — thunderProb = 100 / (1 + e^-((score - C)/S)).
//      C (centre) and S (slope) map the raw score onto a calibrated probability.
//
// This harness pulls historical hours from a SELF-HOSTED Open-Meteo /v1/archive
// node, runs the UNCHANGED engine on each hour to get its thunderstorm score,
// reads an "outcome" field from the same archive as the truth (did a storm
// happen), and measures how well the score predicts the outcome. From that it
// recovers the best occurrence cut-off (max CSI / Youden's J) and re-fits the
// probability logistic (weighted logistic regression). Nothing here mutates the
// engine — the panel shows the recommended numbers; a human bakes them in.
//
// FIDELITY: it reuses the engine's OWN buildEnv() + HOURLY_FULL variable list +
// the exact fetch units (timezone=UTC, wind_speed_unit=mph) so the scores it
// produces are byte-identical to what the live site would compute.
//
// EFFICIENCY: instead of holding millions of {score,hit} records, every hour is
// folded into a 101-bucket SCORE→OUTCOME HISTOGRAM (tot[s], hit[s] for score
// s = 0..100). That tiny structure is a sufficient statistic — every metric
// (base rate, Brier, reliability diagram, threshold sweep, logistic fit) is
// reconstructable from it, and histograms from different years simply ADD, which
// is how "1 year at a time, up to 5 years" combines exactly.
// ─────────────────────────────────────────────────────────────────────────────

import { engineScores } from '@/lib/tcmEngineScores';
import { buildEnv, HOURLY_FULL, dayOfYear } from '@/lib/openMeteoTCM';

// ── Region grid — UK & Ireland (engine is UK&IE-calibrated) ──────────────────
export const UK_IE_GRID = [
  { name: 'London',      lat: 51.51, lon: -0.13 },
  { name: 'Brighton',    lat: 50.82, lon: -0.14 },
  { name: 'Plymouth',    lat: 50.38, lon: -4.14 },
  { name: 'Cardiff',     lat: 51.48, lon: -3.18 },
  { name: 'Birmingham',  lat: 52.48, lon: -1.90 },
  { name: 'Nottingham',  lat: 52.95, lon: -1.15 },
  { name: 'Norwich',     lat: 52.63, lon:  1.30 },
  { name: 'Manchester',  lat: 53.48, lon: -2.24 },
  { name: 'Newcastle',   lat: 54.98, lon: -1.61 },
  { name: 'Glasgow',     lat: 55.86, lon: -4.25 },
  { name: 'Aberdeen',    lat: 57.15, lon: -2.09 },
  { name: 'Inverness',   lat: 57.48, lon: -4.22 },
  { name: 'Belfast',     lat: 54.60, lon: -5.93 },
  { name: 'Dublin',      lat: 53.35, lon: -6.26 },
  { name: 'Cork',        lat: 51.90, lon: -8.47 },
  { name: 'Galway',      lat: 53.27, lon: -9.05 },
];

// Denser curated mesh (~50 towns) — ~3× the spatial coverage for users who want
// extra confidence. NOTE: calibration only fits 2–3 GLOBAL constants, so this
// mainly narrows the confidence interval; it does NOT change the model's map
// resolution (that stays your full grid at run time). More points = a longer run
// (each point = 12 monthly archive requests).
export const UK_IE_GRID_DENSE = [
  ...UK_IE_GRID,
  { name: 'Exeter',       lat: 50.72, lon: -3.53 },
  { name: 'Truro',        lat: 50.26, lon: -5.05 },
  { name: 'Bournemouth',  lat: 50.72, lon: -1.88 },
  { name: 'Southampton',  lat: 50.91, lon: -1.40 },
  { name: 'Reading',      lat: 51.45, lon: -0.97 },
  { name: 'Oxford',       lat: 51.75, lon: -1.26 },
  { name: 'Bristol',      lat: 51.45, lon: -2.59 },
  { name: 'Cambridge',    lat: 52.20, lon:  0.12 },
  { name: 'Ipswich',      lat: 52.06, lon:  1.16 },
  { name: 'Peterborough', lat: 52.57, lon: -0.24 },
  { name: 'Leicester',    lat: 52.64, lon: -1.13 },
  { name: 'Lincoln',      lat: 53.23, lon: -0.54 },
  { name: 'Sheffield',    lat: 53.38, lon: -1.47 },
  { name: 'Leeds',        lat: 53.80, lon: -1.55 },
  { name: 'York',         lat: 53.96, lon: -1.08 },
  { name: 'Hull',         lat: 53.77, lon: -0.34 },
  { name: 'Liverpool',    lat: 53.41, lon: -2.99 },
  { name: 'Preston',      lat: 53.76, lon: -2.70 },
  { name: 'Carlisle',     lat: 54.89, lon: -2.93 },
  { name: 'Middlesbrough',lat: 54.57, lon: -1.23 },
  { name: 'Swansea',      lat: 51.62, lon: -3.94 },
  { name: 'Aberystwyth',  lat: 52.41, lon: -4.08 },
  { name: 'Bangor',       lat: 53.23, lon: -4.13 },
  { name: 'Edinburgh',    lat: 55.95, lon: -3.19 },
  { name: 'Dundee',       lat: 56.46, lon: -2.97 },
  { name: 'Perth',        lat: 56.40, lon: -3.44 },
  { name: 'Fort William', lat: 56.82, lon: -5.11 },
  { name: 'Stornoway',    lat: 58.21, lon: -6.39 },
  { name: 'Wick',         lat: 58.44, lon: -3.09 },
  { name: 'Dumfries',     lat: 55.07, lon: -3.60 },
  { name: 'Londonderry',  lat: 54.99, lon: -7.31 },
  { name: 'Limerick',     lat: 52.66, lon: -8.63 },
  { name: 'Waterford',    lat: 52.26, lon: -7.11 },
  { name: 'Sligo',        lat: 54.27, lon: -8.48 },
  { name: 'Letterkenny',  lat: 54.95, lon: -7.73 },
];

export const GRID_PRESETS = [
  { id: 'standard', label: 'Standard', grid: UK_IE_GRID },
  { id: 'dense',    label: 'Dense',    grid: UK_IE_GRID_DENSE },
];

// ── Outcome (truth) definitions — read from the same archive ─────────────────
export const THUNDER_WX_CODES = [95, 96, 99]; // WMO: thunderstorm (+ hail variants)

export const OUTCOME_PRESETS = [
  { id: 'wxcode',     label: 'Thunderstorm weather-code (95 / 96 / 99)', vars: ['weather_code'],   kind: 'wxcode' },
  { id: 'lightning',  label: 'Lightning potential ≥ threshold',          vars: ['lightning_potential'], kind: 'numeric', defaultThr: 5,   unit: 'J/kg' },
  { id: 'cape',       label: 'CAPE ≥ threshold (proxy)',                 vars: ['cape'],           kind: 'numeric', defaultThr: 150, unit: 'J/kg' },
  { id: 'convprecip', label: 'Precipitation ≥ threshold (proxy)',        vars: ['precipitation'],  kind: 'numeric', defaultThr: 2,   unit: 'mm/h' },
];

// Engine defaults we are trying to improve on (kept in sync with the engine).
export const ENGINE_DEFAULTS = { thunderOccurScore: 15, probCenter: 34, probSlope: 11 };

// ── small utils ──────────────────────────────────────────────────────────────
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const arrAt = (arr, i) => (arr && arr[i] != null && Number.isFinite(Number(arr[i])) ? Number(arr[i]) : null);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Open-Meteo emits e.g. "2023-06-01T13:00" (already UTC because timezone=UTC).
// Parse the components explicitly so it never depends on the browser timezone.
function parseOmTime(s) {
  const y = +s.slice(0, 4), mo = +s.slice(5, 7), d = +s.slice(8, 10);
  const h = +s.slice(11, 13), mi = +(s.slice(14, 16) || 0);
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}
function lastDayOfMonth(year, m /* 1-12 */) { return new Date(Date.UTC(year, m, 0)).getUTCDate(); }

export function buildArchiveUrl(base, { lat, lon, start, end, hourly }) {
  return `${base}/v1/archive?latitude=${lat}&longitude=${lon}`
    + `&start_date=${start}&end_date=${end}`
    + `&hourly=${encodeURIComponent(hourly)}`
    + `&timezone=UTC&wind_speed_unit=mph`;
}

// Fetch JSON, surfacing Open-Meteo's own {reason} on a 4xx so the UI can explain.
async function omFetchJson(url, { timeoutMs = 60000, signal } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const reason = body && (body.reason || body.error_message || body.message);
      throw new Error(`HTTP ${res.status}${reason ? ` — ${reason}` : ''}`);
    }
    return body;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// ── Probe — discover which variables THIS archive actually serves ────────────
// Unknown variable names make Open-Meteo 400 the whole request, so before a run
// we test each engine variable (+ candidate outcome variables) on a 1-day window
// and keep only the ones the node accepts. Missing vars are fine at run time —
// buildEnv() returns null for them and the engine falls back to surface proxies.
export async function probeArchive({ base, point, date, extraVars = [], concurrency = 6, signal }) {
  const p = point || UK_IE_GRID[0];
  const candidates = [...new Set([...HOURLY_FULL, ...extraVars])];
  const start = date, end = date;
  const details = {};
  let idx = 0;
  async function worker() {
    while (idx < candidates.length) {
      if (signal?.aborted) return;
      const v = candidates[idx++];
      const url = buildArchiveUrl(base, { lat: p.lat, lon: p.lon, start, end, hourly: v });
      try {
        const j = await omFetchJson(url, { timeoutMs: 25000, signal });
        const col = j?.hourly?.[v];
        const hasData = Array.isArray(col) && col.some((x) => x != null && Number.isFinite(Number(x)));
        details[v] = { ok: Array.isArray(col), hasData };
      } catch (e) {
        details[v] = { ok: false, hasData: false, error: String(e.message || e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  const supported = candidates.filter((v) => details[v]?.ok);
  const unsupported = candidates.filter((v) => !details[v]?.ok);
  return { supported, unsupported, details };
}

// ── Outcome evaluation ───────────────────────────────────────────────────────
function makeOutcomeTest(outcome) {
  if (!outcome || outcome.kind === 'wxcode') {
    const set = new Set(THUNDER_WX_CODES);
    return (at) => {
      const wx = at('weather_code');
      return wx != null && set.has(Math.round(wx)) ? 1 : 0;
    };
  }
  const field = outcome.vars[0];
  const thr = Number(outcome.threshold ?? outcome.defaultThr ?? 0);
  return (at) => {
    const v = at(field);
    return v != null && v >= thr ? 1 : 0;
  };
}

// ── Histogram helpers (the sufficient statistic) ─────────────────────────────
export function emptyHist() {
  return { tot: new Array(101).fill(0), hit: new Array(101).fill(0) };
}
export function addHist(a, b) {
  const out = emptyHist();
  for (let s = 0; s <= 100; s++) { out.tot[s] = (a.tot[s] || 0) + (b.tot[s] || 0); out.hit[s] = (a.hit[s] || 0) + (b.hit[s] || 0); }
  return out;
}
export function combineHists(hists) {
  return (hists || []).reduce((acc, h) => (h ? addHist(acc, h) : acc), emptyHist());
}

// ── Weighted logistic fit  hit ~ score  → thunderProb centre & slope ─────────
// Grouped Newton–Raphson on the 101 histogram buckets. Model in scaled space
// x = (score-50)/25 for conditioning, then unscaled to the engine's C,S form:
//   p = sigmoid((score - C)/S).
function fitLogistic(hist) {
  const pts = [];
  for (let s = 0; s <= 100; s++) {
    const n = hist.tot[s]; if (!n) continue;
    pts.push({ x: (s - 50) / 25, n, k: hist.hit[s] });
  }
  if (pts.length < 3) return null;
  let b0 = 0, b1 = 1;
  for (let iter = 0; iter < 40; iter++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const pt of pts) {
      const pr = sigmoid(b0 + b1 * pt.x);
      const w = pt.n * pr * (1 - pr);
      const resid = pt.n * pr - pt.k;
      g0 += resid; g1 += resid * pt.x;
      h00 += w; h01 += w * pt.x; h11 += w * pt.x * pt.x;
    }
    const det = h00 * h11 - h01 * h01;
    if (!isFinite(det) || Math.abs(det) < 1e-9) break;
    const d0 = (h11 * g0 - h01 * g1) / det;
    const d1 = (h00 * g1 - h01 * g0) / det;
    b0 -= d0; b1 -= d1;
    if (Math.abs(d0) < 1e-7 && Math.abs(d1) < 1e-7) break;
  }
  // unscale: sigmoid(b0 + b1*(score-50)/25) = sigmoid((score - C)/S)
  const slope = 25 / b1;              // S
  const center = 50 - b0 * 25 / b1;   // C
  if (!isFinite(slope) || !isFinite(center) || slope <= 0) return null;
  return { b0, b1, center: +center.toFixed(2), slope: +slope.toFixed(2) };
}

// ── Full metric block from a histogram ───────────────────────────────────────
// `probModel` = {center, slope} used to turn each score into a probability for
// the reliability diagram / Brier score. Defaults to the current engine logistic.
export function metricsFromHist(hist, { probCenter = ENGINE_DEFAULTS.probCenter, probSlope = ENGINE_DEFAULTS.probSlope, bins = 10 } = {}) {
  let N = 0, H = 0;
  for (let s = 0; s <= 100; s++) { N += hist.tot[s]; H += hist.hit[s]; }
  if (!N) return { n: 0 };
  const baseRate = H / N;

  // Threshold sweep on the score → best occurrence cut-off.
  let bestCSI = { thr: null, csi: -1 }, bestJ = { thr: null, j: -1 };
  const sweep = [];
  const P = H, Neg = N - H;
  // cumulative counts of tot/hit for score >= thr
  let cumTot = 0, cumHit = 0;
  const geTot = new Array(102).fill(0), geHit = new Array(102).fill(0);
  for (let s = 100; s >= 0; s--) { cumTot += hist.tot[s]; cumHit += hist.hit[s]; geTot[s] = cumTot; geHit[s] = cumHit; }
  for (let thr = 1; thr <= 99; thr++) {
    const tp = geHit[thr];
    const fp = geTot[thr] - geHit[thr];
    const fn = P - tp;
    const csi = (tp + fp + fn) ? tp / (tp + fp + fn) : 0;
    const tpr = P ? tp / P : 0, fpr = Neg ? fp / Neg : 0;
    const j = tpr - fpr;
    sweep.push({ thr, tp, fp, fn, csi: +csi.toFixed(4), j: +j.toFixed(4) });
    if (csi > bestCSI.csi) bestCSI = { thr, csi: +csi.toFixed(4), tp, fp, fn };
    if (j > bestJ.j) bestJ = { thr, j: +j.toFixed(4), tpr: +tpr.toFixed(4), fpr: +fpr.toFixed(4) };
  }

  // Reliability diagram + Brier / skill for the given probability model.
  const prob = (s) => 1 / (1 + Math.exp(-(s - probCenter) / probSlope));
  const binArr = Array.from({ length: bins }, () => ({ sumP: 0, sumH: 0, n: 0 }));
  let brier = 0;
  for (let s = 0; s <= 100; s++) {
    const n = hist.tot[s]; if (!n) continue;
    const k = hist.hit[s]; const p = prob(s);
    brier += k * (p - 1) * (p - 1) + (n - k) * p * p;
    let bi = Math.floor(p * bins); if (bi >= bins) bi = bins - 1; if (bi < 0) bi = 0;
    const b = binArr[bi]; b.sumP += p * n; b.sumH += k; b.n += n;
  }
  brier /= N;
  let reliability = 0, resolution = 0;
  const diagram = [];
  for (let i = 0; i < bins; i++) {
    const b = binArr[i];
    if (!b.n) { diagram.push({ binLo: +(i / bins).toFixed(2), binHi: +((i + 1) / bins).toFixed(2), forecast: null, observed: null, n: 0 }); continue; }
    const meanP = b.sumP / b.n, obsFreq = b.sumH / b.n;
    reliability += b.n * (meanP - obsFreq) * (meanP - obsFreq);
    resolution += b.n * (obsFreq - baseRate) * (obsFreq - baseRate);
    diagram.push({ binLo: +(i / bins).toFixed(2), binHi: +((i + 1) / bins).toFixed(2), forecast: +meanP.toFixed(4), observed: +obsFreq.toFixed(4), n: b.n });
  }
  reliability /= N; resolution /= N;
  const uncertainty = baseRate * (1 - baseRate);
  const bss = uncertainty > 0 ? 1 - brier / uncertainty : 0;

  const fit = fitLogistic(hist);

  return {
    n: N, hits: H, baseRate: +baseRate.toFixed(5),
    brier: +brier.toFixed(5), brierSkillScore: +bss.toFixed(4),
    reliability: +reliability.toFixed(5), resolution: +resolution.toFixed(5), uncertainty: +uncertainty.toFixed(5),
    diagram, sweep,
    bestByCSI: bestCSI, bestByYoudenJ: bestJ,
    logisticFit: fit,
    recommend: {
      thunderOccurScore: bestCSI.thr,
      probCenter: fit ? fit.center : probCenter,
      probSlope: fit ? fit.slope : probSlope,
    },
  };
}

// ── Run one YEAR of calibration ──────────────────────────────────────────────
// Folds every hour of every grid point into one histogram, then derives metrics.
// onProgress({done,total,label,hoursScored}) is called after each point/month.
export async function runCalibrationYear({
  base, year, grid = UK_IE_GRID, supportedVars, outcome,
  onProgress, signal, timeoutMs = 90000,
}) {
  if (!base) throw new Error('No self-host base URL set.');
  const outcomeTest = makeOutcomeTest(outcome);
  const outcomeVars = (outcome?.vars || ['weather_code']);
  // request only supported engine vars (+ the outcome var if it is servable)
  const engineVars = (supportedVars && supportedVars.length ? supportedVars : HOURLY_FULL)
    .filter((v) => !outcomeVars.includes(v));
  const hourly = [...engineVars, ...outcomeVars].join(',');

  const hist = emptyHist();
  let hoursScored = 0;
  const total = grid.length * 12;
  let done = 0;

  for (const pt of grid) {
    for (let m = 1; m <= 12; m++) {
      if (signal?.aborted) throw new Error('Cancelled.');
      const start = `${year}-${pad2(m)}-01`;
      const end = `${year}-${pad2(m)}-${pad2(lastDayOfMonth(year, m))}`;
      const url = buildArchiveUrl(base, { lat: pt.lat, lon: pt.lon, start, end, hourly });
      let j;
      try {
        j = await omFetchJson(url, { timeoutMs, signal });
      } catch (e) {
        done++;
        onProgress?.({ done, total, label: `${pt.name} ${start}`, hoursScored, error: String(e.message || e) });
        continue; // skip this month; keep going
      }
      const H = j?.hourly;
      const times = H?.time || [];
      for (let i = 0; i < times.length; i++) {
        const acc = (name) => arrAt(H[name], i);
        const dt = parseOmTime(times[i]);
        const doy = dayOfYear(dt), lh = dt.getUTCHours();
        const env = buildEnv(acc, 0, {}, doy, lh);
        const sc = engineScores(env);
        const s = clamp(Math.round(sc.thunderstorm || 0), 0, 100);
        const hit = outcomeTest(acc);
        hist.tot[s]++; if (hit) hist.hit[s]++;
        hoursScored++;
      }
      done++;
      onProgress?.({ done, total, label: `${pt.name} ${start}`, hoursScored });
    }
  }

  const metrics = metricsFromHist(hist);
  return {
    year, region: 'UK & Ireland', outcomeId: outcome?.id || 'wxcode',
    outcomeThreshold: outcome?.threshold ?? outcome?.defaultThr ?? null,
    gridPoints: grid.length, hoursScored,
    hist, metrics,
  };
}
