// ─────────────────────────────────────────────────────────────────────────────
// HOCO-STYLE PROBABILITY HELPERS — synthetic dispersion + reliability calibration.
//
// These turn a deterministic environment into a well-CALIBRATED probability by
// sampling a distribution of outcomes (a synthetic Gaussian member cloud drawn
// from mean + spread) and remapping the result through a stored reliability
// calibration. When Open-Meteo only serves model MEANS (our standard case), the
// probability-of-exceedance can otherwise land only on 0/20/40/…/100 %; the
// synthetic cloud fills in a smooth, calibrated distribution.
//
// WHAT CHANGED IN THIS REWRITE:
//   • dispersionWorthwhile() — a cheap gate the pipeline calls BEFORE building
//     a 14-draw member cloud. On a typical UK day the vast majority of grid
//     cells (open sea, stable anticyclonic land) are convectively dead: the
//     deterministic mean already scores ~0 and there is no CAPE reservoir a
//     warmer/moister perturbation could tap. Sampling 14 draws × 5 members × 32
//     steps on those cells is pure waste. This predicate skips them while STILL
//     sampling every marginal / conditional cell (a capped "loaded gun" with a
//     large daily-max CAPE, any cell the mean already lit, or observed radar
//     convection), so no genuine spread is ever thrown away. This is one of the
//     largest single CPU savings in the engine.
//   • NORMAL_STENCIL_14 is presented sorted (identical value set; the aggregate
//     probability is order-invariant, and CAPE and profile draws stay coherent
//     because both index the stencil by the same draw index k).
//
// Deterministic throughout: the member stencil is fixed (not RNG), so a cell's
// probability is STABLE between renders and reproducible for verification.
// ─────────────────────────────────────────────────────────────────────────────

// Tiny self-contained math helpers (duplicated so this module has no cyclic dep).
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// Number of synthetic draws per model-mean when we only have (mean, spread).
export const SYN_MEMBERS_PER_MODEL = 14;

// Fixed low-discrepancy standard-normal quantiles (symmetric, mean 0, sd ≈ 1).
// A deterministic stencil (not RNG) keeps a cell's probability stable between
// renders. Sorted for readability — the set is identical to before, and the
// probability is a mean over all draws, so ordering does not affect any output.
export const NORMAL_STENCIL_14 = [
  -1.8627, -1.4758, -1.1503, -0.7916, -0.5249, -0.3030, -0.0993,
   0.0993,  0.3030,  0.5249,  0.7916,  1.1503,  1.4758,  1.8627,
];

// Per-variable 1-sigma climatological ensemble spread, used ONLY when the API
// does not return an explicit `<var>_spread` field for that variable.
const CLIMO_SPREAD = {
  cape:                  140,
  convective_inhibition:  35,
  temperature_2m:          1.4,
  dew_point_2m:            1.6,
  wind_gusts_10m:          4.0,
  lifted_index:            1.2,
  precipitation:           1.0,
};

// 1σ British-Isles convective-season spreads for the coherent profile perturbation.
const CLIMO_PROFILE_SPREAD = {
  t850:   0.45,
  t700:   0.60,
  t500:   0.80,
  td850:  1.20,
  td700:  1.40,
  windKappa: 0.10,
  w700:   0.12,
};

// ── Dispersion gate ──────────────────────────────────────────────────────────
// Thresholds below which a cell is treated as convectively dead and the
// synthetic member cloud is skipped in favour of the deterministic mean.
// Deliberately conservative so only genuinely inert cells are skipped.
export const DISPERSION_THRESHOLDS = {
  meanScoreFloor: 2,     // deterministic mean thunderstorm score at/under which…
  capeReservoirJ: 80,    // …AND max available CAPE (J/kg) under which we skip
};

// dispersionWorthwhile — should we build the synthetic member cloud for this
// cell/step? Returns true whenever there is ANY plausible convective signal:
//   • observed convection (thunder / showery weather code), OR
//   • the deterministic mean already produced a non-trivial score, OR
//   • a CAPE reservoir (now or the day's max) a perturbation could realise.
// Only cells failing all three — the dead majority of a quiet grid — are skipped.
export function dispersionWorthwhile({
  meanThunder = 0, cape = 0, capeMax = 0, isThunder = false, isShowery = false,
} = {}) {
  if (isThunder || isShowery) return true;
  if (meanThunder > DISPERSION_THRESHOLDS.meanScoreFloor) return true;
  const reservoir = Math.max(cape || 0, capeMax || 0);
  return reservoir > DISPERSION_THRESHOLDS.capeReservoirJ;
}

// z-value of the fixed stencil at draw index k (mean 0, sd ≈ 1).
export function stencilZ(k) {
  return NORMAL_STENCIL_14[k] ?? 0;
}

// Build a coherent perturbed sounding for stencil index k from a member's
// CENTRAL pressure-level values. Each field is nudged along z_k so the draw is a
// single self-consistent atmosphere (a warm-and-moist draw is warm AND moist at
// every level, not a random mix). A null central value stays null.
export function perturbedProfile(v, i, k) {
  const z = stencilZ(k);
  const S = CLIMO_PROFILE_SPREAD;
  const get = (key) => {
    const a = v[key];
    return (a && a[i] != null && isFinite(a[i])) ? a[i] : null;
  };
  const nudge = (val, coef, sigma) => (val == null ? null : val + coef * z * sigma);
  const windScale = 1 + S.windKappa * z;
  const scaleWind = (key) => { const val = get(key); return val == null ? null : Math.max(0, val * windScale); };
  return {
    t850:  nudge(get('temperature_850hPa'), +0.3, S.t850),
    t700:  nudge(get('temperature_700hPa'), -0.5, S.t700),
    t500:  nudge(get('temperature_500hPa'), -1.0, S.t500),
    td850: nudge(get('dew_point_850hPa'),   +1.0, S.td850),
    td700: nudge(get('dew_point_700hPa'),   +0.5, S.td700),
    rh850: get('relative_humidity_850hPa'),
    rh700: get('relative_humidity_700hPa'),
    rh500: get('relative_humidity_500hPa'),
    z850:  get('geopotential_height_850hPa'),
    z700:  get('geopotential_height_700hPa'),
    z500:  get('geopotential_height_500hPa'),
    spd850: scaleWind('wind_speed_850hPa'),
    spd700: scaleWind('wind_speed_700hPa'),
    spd500: scaleWind('wind_speed_500hPa'),
    spd300: scaleWind('wind_speed_300hPa'),
    dir850: get('wind_direction_850hPa'),
    dir700: get('wind_direction_700hPa'),
    dir500: get('wind_direction_500hPa'),
    dir300: get('wind_direction_300hPa'),
    w700:  nudge(get('vertical_velocity_700hPa'), +1.0, S.w700),
  };
}

// Standard-normal CDF (Abramowitz–Stegun 7.1.26 erf approximation).
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
        + t * (-1.821255978 + t * 1.330274429))));
  p = 1 - p;
  return z >= 0 ? p : 1 - p;
}

// Recover an explicit per-member value list for a variable from whatever the API
// gave us: true members → served spread → climatological spread.
export function memberValuesFor(meanVal, spreadVal, variable, trueMemberVals) {
  if (Array.isArray(trueMemberVals) && trueMemberVals.length >= 3) {
    const vals = trueMemberVals.filter(v => v != null && isFinite(v));
    if (vals.length >= 3) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      let s = 0; for (const v of vals) s += (v - m) * (v - m);
      return { values: vals, spread: Math.sqrt(s / vals.length), synthetic: false };
    }
  }
  if (meanVal == null || !isFinite(meanVal)) return { values: [], spread: 0, synthetic: true };
  const sigma = (spreadVal != null && isFinite(spreadVal) && spreadVal > 0)
    ? spreadVal
    : (CLIMO_SPREAD[variable] ?? Math.max(1e-6, Math.abs(meanVal) * 0.18));
  const floorAtZero = (variable === 'cape' || variable === 'precipitation'
                    || variable === 'wind_gusts_10m');
  const out = new Array(NORMAL_STENCIL_14.length);
  for (let k = 0; k < NORMAL_STENCIL_14.length; k++) {
    let val = meanVal + sigma * NORMAL_STENCIL_14[k];
    if (floorAtZero && val < 0) val = 0;
    out[k] = val;
  }
  return { values: out, spread: sigma, synthetic: true };
}

// ── Reliability calibration (verification → forecast feedback) ───────────────
// A stored piecewise reliability curve remaps raw forecast probabilities so
// "30 %" verifies near 30 %. The curve is written by the verification loop and
// read here (cached 60 s). Absent ⇒ identity mapping.
const TCM_CALIB_KEY = 'tcm_prob_calibration_v1';
let _calibCache = null, _calibCacheAt = 0;
function loadCalibration() {
  const now = Date.now();
  if (_calibCache !== null && (now - _calibCacheAt) < 60000) return _calibCache;
  _calibCacheAt = now;
  _calibCache = undefined;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(TCM_CALIB_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') _calibCache = obj;
      }
    }
  } catch { /* ignore — stay on identity */ }
  if (_calibCache === undefined) _calibCache = null;
  return _calibCache;
}

// Apply the stored reliability remap for a given lead day to a 0–100 probability.
export function applyProbCalibration(prob0to100, leadDay) {
  const calib = loadCalibration();
  if (!calib) return prob0to100;
  const node = calib[`day${leadDay}`] || calib.global || null;
  const pts = node && Array.isArray(node.points) ? node.points : null;
  if (!pts || pts.length < 2) return prob0to100;
  const p = clamp01(prob0to100 / 100);
  const sorted = pts
    .filter(q => Array.isArray(q) && q.length === 2 && isFinite(q[0]) && isFinite(q[1]))
    .sort((a, b) => a[0] - b[0]);
  if (sorted.length < 2) return prob0to100;
  if (p <= sorted[0][0]) return clamp(sorted[0][1] * 100, 0, 100);
  if (p >= sorted[sorted.length - 1][0]) return clamp(sorted[sorted.length - 1][1] * 100, 0, 100);
  for (let i = 0; i < sorted.length - 1; i++) {
    const [f0, o0] = sorted[i], [f1, o1] = sorted[i + 1];
    if (p >= f0 && p <= f1) {
      const t = f1 === f0 ? 0 : (p - f0) / (f1 - f0);
      return clamp((o0 + t * (o1 - o0)) * 100, 0, 100);
    }
  }
  return prob0to100;
}