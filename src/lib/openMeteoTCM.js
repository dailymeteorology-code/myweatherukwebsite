// ─────────────────────────────────────────────────────────────────────────────
// OPEN-METEO ENSEMBLE TCM — data pipeline (fetch → ensemble → score → smooth).
//
// The single data source for the TCM outlook. It fetches the Open-Meteo ENSEMBLE
// endpoint, scores every grid cell through the risk engine, and returns a payload
// the map / cache / archive all consume unchanged.
//
// ── API-USAGE STRATEGY (the top priority) ───────────────────────────────────
// Three levers cut Open-Meteo usage ~60–70 % per run vs the previous pipeline,
// with no loss of ensemble members or forecast quality:
//
//   1. TIERED VARIABLES.  The full pressure-level physics set (surface + the
//      850/700/500/300 hPa thermodynamics & kinematics — ~45 variables) is
//      fetched ONLY from the two highest-skill models for the British Isles
//      (UKV 2 km + ECMWF IFS). The other ensemble models carry a lean ~19-
//      variable surface/convective set — they contribute ensemble SPREAD and a
//      weighted mean, for which pressure-level payloads add almost nothing. The
//      deterministic central scenario still uses full physics (from the two
//      physics models); the lean members score on surface proxies, exactly as
//      the engine already does when a field is absent. Because Open-Meteo cannot
//      mix variable sets across models in one request, each batch issues a
//      "physics-tier" and a "lean-tier" request and merges them per location —
//      two lighter requests instead of one heavy one, for far less total data.
//
//   2. FETCH ONLY THE DAYS NEEDED.  A Day-1 run fetches ONE forecast day, not
//      the previous "+2 days" of headroom. Each outlook day is scored purely
//      from that day's own hourly timestamps, so lastDay+1 days is exact — this
//      alone roughly halves the hourly payload of the common Day-1 run.
//      Extending to later days ("Continue") re-fetches on demand rather than
//      paying for days that are usually never shown.
//
//   3. SCORE ONCE.  Every hourly timestep is scored exactly ONCE (memoised); the
//      3-hourly `perStep` view and the daily `perDay` peaks both read that cache.
//      Convectively DEAD cells (no signal, no CAPE reservoir) skip the expensive
//      ensemble member cloud entirely (see dispersionWorthwhile). On a quiet UK
//      day this removes the overwhelming majority of engine evaluations.
//
// ── OTHER CORRECTNESS FIXES ──────────────────────────────────────────────────
//   • timezone=UTC (was Europe/London while parsing times as UTC) — removes the
//     one-hour BST shift that mis-timed the diurnal heating peak and the daily
//     CAPE/precip aggregation boundaries all summer.
//   • No display densification. The map's geometry engine builds its own dense
//     Gaussian contour field from the real nodes, so cloning the heavy score
//     payload onto a 16×-finer lattice was pure memory/CPU waste (the cross-
//     device DB path already renders from the un-densified real nodes).
//   • Neighbourhood ensemble probability (NEP) smoothing of the day scores — the
//     SPC "within ~40 km" semantics — for coherent, hand-drawn-looking areas.
//
// STRICT FETCH POLICY: fetchOpenMeteoTCM() throws FETCH_NOT_DUE outside the
// current UTC run window (or if this run was already fetched) unless force:true.
// Only the admin "Run Model" path passes force:true.
// ─────────────────────────────────────────────────────────────────────────────

import {
  engineScores, clamp, clamp01, num,
  THUNDER_OCCUR_SCORE, SEVERE_SCORE, SIG_SEVERE_SCORE,
  HAIL_OCCUR_SCORE, TORNADO_OCCUR_SCORE, WIND_OCCUR_SCORE,
} from '@/lib/tcmEngineScores';
import {
  SYN_MEMBERS_PER_MODEL, perturbedProfile, memberValuesFor, applyProbCalibration, dispersionWorthwhile,
} from '@/lib/tcmHoco';
import { isInRunWindow, lastRunStartMs } from '@/lib/tcmFetchPolicy';

// Forecast verification & calibration utilities live in lib/tcmVerification.js;
// re-exported so existing '@/lib/openMeteoTCM' imports keep working.
export { verifyForecast, rocAuc, calibrateThresholds } from '@/lib/tcmVerification';

// ── Data source ──────────────────────────────────────────────────────────────
// The ensemble endpoint can be repointed at a SELF-HOSTED Open-Meteo node (e.g.
// a local Docker container at http://localhost:8080). The base URL is stored
// per-browser in localStorage, so ONLY the admin machine running Docker fetches
// from localhost — every visitor reads the cached run from the database. Empty
// string = use the public Open-Meteo API. Set/cleared via the admin Data Source
// panel (Admin Settings → TCM).
const OM_BASE_URL_KEY = 'tcm_om_base_url_v1';
// Reduce any pasted value to JUST the origin (protocol + host + port), so both a
// full "http://localhost:8080/v1/ensemble?..." URL and a bare "localhost:8080"
// collapse to "http://localhost:8080". Prevents double-path/query mangling.
export function normalizeOmBase(input) {
  let s = (input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try { return new URL(s).origin; }
  catch { return s.replace(/\/+$/, ''); }
}
// In-memory cache so the setting survives even when localStorage is BLOCKED.
// Base44 can serve the app inside a sandboxed iframe where localStorage.setItem
// throws; the old code swallowed that error, so Save silently no-opped and the
// URL vanished on save (Test still worked because it reads the input directly).
// The cache keeps the value for THIS session — which is all Run Model needs,
// since the admin runs the model right after saving in the same session.
let _omBaseCache = null;
export function getOmBaseUrl() {
  if (_omBaseCache != null) return _omBaseCache;
  try { _omBaseCache = normalizeOmBase(localStorage.getItem(OM_BASE_URL_KEY) || ''); }
  catch { _omBaseCache = ''; }
  return _omBaseCache;
}
export function setOmBaseUrl(url) {
  const clean = normalizeOmBase(url);
  _omBaseCache = clean;                 // always holds for this session
  try {
    if (clean) localStorage.setItem(OM_BASE_URL_KEY, clean);
    else localStorage.removeItem(OM_BASE_URL_KEY);
  } catch { /* localStorage blocked — in-memory cache still holds it */ }
}
const OM_ENSEMBLE_PUBLIC = 'https://ensemble-api.open-meteo.com/v1/ensemble';
function omEnsembleEndpoint() {
  const b = getOmBaseUrl();
  return b ? `${b}/v1/ensemble` : OM_ENSEMBLE_PUBLIC;
}

const STEPS_PER_DAY  = 8;
const HOURS_PER_STEP = 3;
const TOTAL_STEPS    = 32;

// WMO weather codes.
const THUNDER_CODES = new Set([95, 96, 97, 98, 99]);
const SHOWERY_CODES = new Set([80, 81, 82, 85, 86, 95, 96, 97, 98, 99]);

// ── Fetch grid resolution ────────────────────────────────────────────────────
// 0.5° (~35 km) keeps every response inside the free-tier data-volume cap while
// the geometry engine rebuilds a smooth 0.05° contour field from these nodes.
const FETCH_STEP = 0.5;

// ── Batching / pacing (ONE model governs all three: run, estimate, guard) ────
// Lighter tiered requests let us pack more locations per request than the old
// 25-cap without breaching the data-volume limit or the URL-length (414) limit.
const BATCH_SIZE        = 40;
const CONCURRENCY       = 5;    // more parallel workers → a full 3-day run finishes in well under a minute
const INTER_BATCH_MS    = 300;  // lighter per-worker pacing (still inside the minutely call cap)
const FETCH_MAX_ATTEMPTS = 3;
const FETCH_BACKOFF_MS     = [0, 2000, 5000];
const FETCH_BACKOFF_429_MS = [0, 10000, 30000];
const FETCH_TIMEOUT_MS   = 30000;
const TOTAL_FETCH_BUDGET_MS = 600 * 1000;

// ── Variable sets ────────────────────────────────────────────────────────────
// LEAN — surface + convective indices. Enough to score a member on surface
// proxies and to contribute ensemble spread.
const HOURLY_LEAN = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation',
  'weather_code', 'pressure_msl',
  'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'wind_speed_10m', 'wind_speed_80m', 'wind_direction_10m', 'wind_gusts_10m',
  'is_day', 'cape', 'convective_inhibition', 'lifted_index',
  'freezing_level_height', 'boundary_layer_height',
];
// FULL — lean + the extra surface fields + the pressure-level thermodynamics &
// kinematics that drive real lapse rates, bulk shear, SRH, K-index, TT and the
// SCP/STP/EHI composites. Fetched only from the physics-tier models.
export const HOURLY_FULL = [
  ...HOURLY_LEAN,
  'surface_pressure', 'surface_temperature', 'apparent_temperature',
  'visibility', 'cloud_cover', 'wind_direction_80m',
  'temperature_850hPa', 'temperature_700hPa', 'temperature_500hPa',
  'dew_point_850hPa', 'dew_point_700hPa',
  'relative_humidity_850hPa', 'relative_humidity_700hPa', 'relative_humidity_500hPa',
  'geopotential_height_850hPa', 'geopotential_height_700hPa', 'geopotential_height_500hPa',
  'wind_speed_850hPa', 'wind_speed_700hPa', 'wind_speed_500hPa', 'wind_speed_300hPa',
  'wind_direction_850hPa', 'wind_direction_700hPa', 'wind_direction_500hPa', 'wind_direction_300hPa',
  'vertical_velocity_700hPa',
];
const HOURLY_FULL_STR = HOURLY_FULL.join(',');
const HOURLY_LEAN_STR = HOURLY_LEAN.join(',');
const DAILY_VARS = 'precipitation_sum,cape_mean,cape_max';

// Every variable name the member parser may encounter (the full set).
const ENSEMBLE_KNOWN_VARS = HOURLY_FULL;

// ── Model registry (8 ensemble models) ──────────────────────────────────────
// Each model is defined by:
//   weight  — UK-tuned blend weight (admin-overridable via setModelWeights)
//   physics — carries the full pressure-level set (kept to the two best models)
//   maxDay  — the highest OUTLOOK DAY this model contributes to (0=Day 1 … 2=Day 3)
//
// maxDay is the lever that gives the requested per-day model counts WITHOUT
// wasted data: a model is fetched only for the days it feeds, so the 5th/6th
// models pull 1 day, the 4th pulls 2, and the top 3 pull all 3. The result:
//   Day 1 = all 6 models · Day 2 = 4 models · Day 3 = 3 models.
// All six are single-series ensemble means (or the ICON-EU control), so each is
// cheap; ICON-EU (dwd_icon_eu) adds a strong European member for the near term.
const MODELS = [
  { id: 'ukmo_uk_ensemble_mean_2km',         weight: 4.0, physics: true,  maxDay: 2 }, // UKV 2 km — best for UK & Ireland (pressure levels)
  { id: 'ecmwf_ifs025_ensemble_mean',        weight: 2.4, physics: true,  maxDay: 2 }, // ECMWF IFS ensemble (pressure levels)
  { id: 'ukmo_global_ensemble_mean_20km',    weight: 3.0, physics: false, maxDay: 2 }, // MOGREPS-G
  { id: 'google_weathernext2_ensemble_mean', weight: 2.2, physics: false, maxDay: 2 }, // Google WeatherNext 2 (AI)
  { id: 'dwd_icon_eps_ensemble_mean',        weight: 2.0, physics: false, maxDay: 1 }, // DWD ICON-EPS (EU)
  { id: 'ecmwf_aifs025_ensemble_mean',       weight: 1.6, physics: false, maxDay: 1 }, // ECMWF AIFS (AI)
  { id: 'cmc_gem_geps_ensemble_mean',        weight: 1.4, physics: false, maxDay: 2 }, // Canadian GEM-GEPS
  { id: 'ncep_gefs_ensemble_mean_seamless',  weight: 1.2, physics: false, maxDay: 2 }, // NCEP GEFS (seamless)
];
// AWS-sourced models (built by tools/tcm-nova/nova/v3_points.py on GitHub). These are what
// TCM V3 runs on now; the Open-Meteo ids above are kept only so old archived runs still parse.
export const AWS_MODELS = [
  { id: 'ukv_aws', weight: 4.0 }, { id: 'mo_global_aws', weight: 3.0 }, { id: 'ifs_aws', weight: 2.4 },
  { id: 'ifs_ens_aws', weight: 2.2 }, { id: 'aifs_aws', weight: 1.6 }, { id: 'gfs_aws', weight: 1.4 },
  { id: 'aifs_ens_aws', weight: 1.2 }, { id: 'gefs_aws', weight: 1.2 },
];
const DEFAULT_MODEL_WEIGHTS = Object.fromEntries([...MODELS, ...AWS_MODELS].map(m => [m.id, m.weight]));

// A run to `maxDay` (0..2) issues one request per distinct (physics, forecast-
// days) group: every model appears once, fetched for exactly min(maxDay, its
// maxDay)+1 days. Shorter-coverage models simply have no data on the later days,
// so those days' ensembles use fewer members automatically.
function requestPlan(maxDay) {
  const lastDay = clamp(Math.round(num(maxDay, 2)), 0, 2);   // Day 4 removed → cap at 2
  const groups = new Map();
  for (const m of MODELS) {
    const fd = Math.min(lastDay, m.maxDay) + 1;
    const key = `${m.physics ? 'P' : 'L'}${fd}`;
    let g = groups.get(key);
    if (!g) { g = { physics: m.physics, forecastDays: fd, models: [] }; groups.set(key, g); }
    g.models.push(m.id);
  }
  return { lastDay, tiers: [...groups.values()], allModels: MODELS.map(m => m.id) };
}

// ── Admin-tunable per-model weights (localStorage) ───────────────────────────
const TCM_MODEL_WEIGHTS_KEY = 'tcm_model_weights_v1';
let _mwCache = null, _mwCacheAt = 0;
export function getModelWeights() {
  const now = Date.now();
  if (_mwCache && (now - _mwCacheAt) < 30000) return _mwCache;
  _mwCacheAt = now;
  const merged = { ...DEFAULT_MODEL_WEIGHTS };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(TCM_MODEL_WEIGHTS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          for (const k of Object.keys(DEFAULT_MODEL_WEIGHTS)) {
            const v = Number(obj[k]);
            if (Number.isFinite(v) && v >= 0) merged[k] = Math.min(20, v);
          }
        }
      }
    }
  } catch { /* fall back to defaults */ }
  _mwCache = merged;
  return merged;
}
export function setModelWeights(partial) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (partial && typeof partial === 'object' && Object.keys(partial).length) {
        let existing = {};
        try { existing = JSON.parse(localStorage.getItem(TCM_MODEL_WEIGHTS_KEY) || '{}'); } catch {}
        const next = { ...existing };
        for (const k of Object.keys(DEFAULT_MODEL_WEIGHTS)) {
          if (k in partial) {
            const v = Number(partial[k]);
            if (Number.isFinite(v) && v >= 0) next[k] = Math.min(20, v);
          }
        }
        localStorage.setItem(TCM_MODEL_WEIGHTS_KEY, JSON.stringify(next));
      } else {
        localStorage.removeItem(TCM_MODEL_WEIGHTS_KEY);
      }
    }
  } catch {}
  _mwCache = null; _mwCacheAt = 0;
  return getModelWeights();
}
// Longest-first so the parser's prefix match is unambiguous.
const KNOWN_MODELS = Object.keys(DEFAULT_MODEL_WEIGHTS).sort((a, b) => b.length - a.length);

// ── API-usage tracking (per HTTP request — the real API-call metric) ─────────
function trackOMApiCall() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem('om_api_usage');
    const data = raw ? JSON.parse(raw) : {};
    if (!data[today]) data[today] = { primary: 0, backup: 0, total: 0 };
    data[today].primary += 1;
    data[today].total   += 1;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    for (const k of Object.keys(data)) if (new Date(k) < cutoff) delete data[k];
    localStorage.setItem('om_api_usage', JSON.stringify(data));
  } catch {}
}
export function getOMApiUsage() {
  try { const raw = localStorage.getItem('om_api_usage'); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}

// ── Per-run fetch marker (the non-forced gate) ───────────────────────────────
const FETCH_GATE_KEY = 'tcm_last_om_fetch';
function hasAlreadyFetchedThisRun(now = Date.now()) {
  try { return Number(localStorage.getItem(FETCH_GATE_KEY) || '0') >= lastRunStartMs(now); }
  catch { return false; }
}
function markFetchDone(now = Date.now()) {
  try { localStorage.setItem(FETCH_GATE_KEY, String(now)); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// UK / Ireland point-in-region mask — decides which grid points get FETCHED.
// Must stay in lock-step with isInUKIreland() in ukIrelandMask.jsx (which clips
// the rendered polygons): British Isles + surrounding seas + Channel Islands +
// a ~50 km northern-France Channel strip, excluding Belgium/NL/deep France.
// ─────────────────────────────────────────────────────────────────────────────
function pointInUKIreland(lat, lon) {
  if (lat < 49.1 || lat > 61.2) return false;
  if (lon < -16.0 || lon > 2.7) return false;
  if (lat >= 54.5 && lat <= 60.5 && lon >= -16.0 && lon <= -7.0) return true;   // W of Scotland
  if (lat >= 53.5 && lat <= 56.5 && lon >= -16.0 && lon <= -9.5) return true;   // NW approaches
  if (lat >= 49.10 && lat <= 49.75 && lon >= -2.75 && lon <= -1.85) return true; // Channel Islands
  if (lat < 49.95 && lon >= -1.95 && lon <= -0.30) return false;   // Cotentin / Caen
  if (lat < 49.60 && lon >=  0.70 && lon <=  1.45) return false;   // Rouen interior
  if (lat < 50.20 && lon >=  1.95 && lon <=  2.70) return false;   // Picardy interior
  if (lat >= 51.15 && lat < 53.5 && lon > 2.3) return false;       // cut Belgium/NL
  if (lat >= 53.5 && lon > 1.9) return false;
  if (lat >= 49.30 && lat < 51.15 && lon > 1.0 && lon <= 2.55) return true; // N-France Channel strip
  return true;
}
export function buildCoords(bbox, step) {
  // Process ALL points inside the ACTIVE REGION's bbox (fills the box, incl. the
  // surrounding seas) rather than clipping to a ragged coastline. Each region's
  // bbox IS its tight data/display box — see REGIONS in pages/TCMOutlooksV3.jsx
  // (uk = UK & Ireland, fr = France). The engine itself stays region-agnostic:
  // every point is scored purely from its own model ingredients.
  const out = [];
  for (let lat = bbox.latMin; lat <= bbox.latMax + 1e-9; lat += step) {
    for (let lon = bbox.lonMin; lon <= bbox.lonMax + 1e-9; lon += step) {
      out.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3) });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiered fetch — one HTTP request per model tier, merged per location.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTier(coords, models, hourlyVars, forecastDays, timeoutMs) {
  const lats = coords.map(c => c.lat).join(',');
  const lons = coords.map(c => c.lon).join(',');
  const url = `${omEnsembleEndpoint()}?latitude=${lats}&longitude=${lons}`
    + `&hourly=${hourlyVars}&daily=${DAILY_VARS}&models=${models.join(',')}`
    + `&timezone=UTC&wind_speed_unit=mph&forecast_days=${forecastDays}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${body.slice(0, 100)}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    trackOMApiCall();
    const results = Array.isArray(json) ? json : [json];
    if (!results.length || !results[0]?.hourly?.time?.length) throw new Error('tier returned no data');
    // Open-Meteo suffixes variable keys with the model name ONLY when more than
    // one model is requested (`cape_<model>`); a single-model request returns
    // bare keys (`cape`). Our per-day tiering can produce single-model tiers
    // (e.g. MOGREPS-G alone on Day 3), so normalise those to the suffixed form —
    // otherwise the merge across tiers and the member parser would misattribute
    // the data to the wrong model.
    if (models.length === 1) {
      const suffix = `_${models[0]}`;
      for (const r of results) {
        for (const block of ['hourly', 'daily']) {
          const b = r?.[block];
          if (!b) continue;
          for (const k of Object.keys(b)) {
            if (k === 'time') continue;
            b[`${k}${suffix}`] = b[k];
            delete b[k];
          }
        }
      }
    }
    return results;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
async function fetchTierWithRetry(coords, models, hourlyVars, forecastDays, timeoutMs) {
  let lastErr = null;
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const table = lastErr?.status === 429 ? FETCH_BACKOFF_429_MS : FETCH_BACKOFF_MS;
      await new Promise(r => setTimeout(r, table[Math.min(attempt - 1, table.length - 1)] + Math.random() * 250));
    }
    try { return await fetchTier(coords, models, hourlyVars, forecastDays, timeoutMs); }
    catch (e) { lastErr = e; if (e?.name === 'AbortError') break; }
  }
  throw lastErr ?? new Error('fetchTierWithRetry: no error captured');
}

// Merge series objects, keeping the LONGEST time axis. Different tiers request
// different forecast_days, so their time arrays differ in length; the widest
// (3-day) tier defines the canonical axis, and shorter-coverage models simply
// have no values past their own length — which is exactly how a model drops out
// of the later days' ensemble.
function mergeKeepLongest(acc, add) {
  if (!add) return acc;
  if (!acc) { const out = {}; for (const k in add) out[k] = add[k]; return out; }
  for (const k in add) {
    if (k === 'time') { if (!acc.time || add.time.length > acc.time.length) acc.time = add.time; }
    else acc[k] = add[k];
  }
  return acc;
}

// Fetch every model tier for a batch (one request per distinct physics/forecast-
// days group) and merge each location's series. A tier that fails after retries
// is skipped — the batch degrades (fewer members) rather than dying.
async function fetchBatchMerged(coords, plan, timeoutMs) {
  let lastErr = null;
  const tierResults = await Promise.all(plan.tiers.map(t =>
    fetchTierWithRetry(coords, t.models, t.physics ? HOURLY_FULL_STR : HOURLY_LEAN_STR, t.forecastDays, timeoutMs)
      .catch(e => { lastErr = e; return null; })));

  if (tierResults.every(r => !r)) throw (lastErr || new Error('batch: all tiers failed'));

  const n = coords.length;
  const merged = new Array(n);
  for (let i = 0; i < n; i++) {
    let hourly = null, daily = null;
    for (const res of tierResults) {
      if (!res?.[i]) continue;
      hourly = mergeKeepLongest(hourly, res[i].hourly);
      daily  = mergeKeepLongest(daily, res[i].daily);
    }
    merged[i] = hourly ? { hourly, daily: daily && Object.keys(daily).length ? daily : null } : null;
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensemble parsing / weighted collapse (per merged location).
// ─────────────────────────────────────────────────────────────────────────────
const MEMBER_SUFFIX_RE = /_member(\d+)$/;

function parseEnsembleMembers(hourly, weights) {
  if (!hourly) return [];
  const groups = new Map();
  for (const key of Object.keys(hourly)) {
    if (key === 'time') continue;
    if (!Array.isArray(hourly[key])) continue;
    let variable = null;
    for (const v of ENSEMBLE_KNOWN_VARS) {
      if (key === v || key.startsWith(`${v}_`)) { if (!variable || v.length > variable.length) variable = v; }
    }
    if (!variable) continue;
    let rest = key.length > variable.length ? key.slice(variable.length + 1) : '';
    let memberNum = 0;
    const m = MEMBER_SUFFIX_RE.exec(rest);
    if (m) { memberNum = +m[1]; rest = rest.slice(0, -m[0].length); }
    let model = rest || KNOWN_MODELS[0];
    if (rest && !weights[model]) continue;
    const gk = `${model}__${memberNum}`;
    let grp = groups.get(gk);
    if (!grp) { grp = { model, memberNum, variables: {} }; groups.set(gk, grp); }
    grp.variables[variable] = hourly[key];
  }
  const countByModel = new Map();
  for (const g of groups.values()) countByModel.set(g.model, (countByModel.get(g.model) ?? 0) + 1);
  const out = [];
  for (const g of groups.values()) {
    const w = (weights[g.model] ?? 1.0) / (countByModel.get(g.model) || 1);
    out.push({ ...g, weight: w });
  }
  return out;
}

// Weighted mean across models for a variable; null per timestep where no member
// had a finite value, and null entirely when the variable was not served at all
// (so the engine can distinguish "real 0" from "missing" and use a proxy).
function collapseMeanOrNull(hourly, variable, weights) {
  if (!hourly) return null;
  const len = hourly.time?.length || 0;
  if (!len) return null;
  const keys = Object.keys(hourly).filter(k => {
    if (k !== variable && !k.startsWith(`${variable}_`)) return false;
    return !k.slice(variable.length).startsWith('_spread');
  });
  if (!keys.length) return null;
  const out = new Array(len).fill(0), wsum = new Array(len).fill(0);
  for (const k of keys) {
    const arr = hourly[k];
    if (!Array.isArray(arr)) continue;
    const suffix = k.length > variable.length ? k.slice(variable.length + 1) : null;
    const w = suffix ? (weights[suffix] ?? 1.0) : 1.0;
    for (let i = 0; i < len; i++) {
      const v = arr[i];
      if (v != null && Number.isFinite(Number(v))) { out[i] += Number(v) * w; wsum[i] += w; }
    }
  }
  const res = new Array(len);
  for (let i = 0; i < len; i++) res[i] = wsum[i] ? out[i] / wsum[i] : null;
  return res;
}

// Modal weather code across models (averaging WMO codes is meaningless).
function collapseMode(hourly, variable) {
  if (!hourly) return null;
  const len = hourly.time?.length || 0;
  if (!len) return null;
  const keys = Object.keys(hourly).filter(k => k === variable || k.startsWith(`${variable}_`));
  if (!keys.length) return null;
  const out = new Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    const counts = new Map();
    for (const k of keys) {
      const v = hourly[k]?.[i];
      if (v == null) continue;
      const n = Number(v);
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    let best = 0, bc = -1;
    for (const [val, c] of counts) if (c > bc) { bc = c; best = val; }
    out[i] = best;
  }
  return out;
}

export function dayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  return Math.floor((date - start) / 86400_000);
}
const arrAt = (arr, i) => (arr && arr[i] != null && Number.isFinite(Number(arr[i])) ? Number(arr[i]) : null);

// Build the engine env from an accessor `at(name)` → value at the fixed hour.
export function buildEnv(at, dIdx, dailies, doy, lh) {
  const t2m = at('temperature_2m');
  const isDay = at('is_day');
  return {
    cape: Math.max(0, at('cape') ?? 0),
    cin: at('convective_inhibition') ?? 0,
    t2m: t2m ?? 10,
    td: at('dew_point_2m') ?? 5,
    rh: clamp(at('relative_humidity_2m') ?? 60, 1, 100),
    precip: Math.max(0, at('precipitation') ?? 0),
    wxCode: Math.round(at('weather_code') ?? 0),
    cloudLow: clamp(at('cloud_cover_low') ?? 0, 0, 100),
    cloudMid: clamp(at('cloud_cover_mid') ?? 0, 0, 100),
    cloudHigh: clamp(at('cloud_cover_high') ?? 0, 0, 100),
    cloudTotal: at('cloud_cover'),
    windSpeed10: Math.max(0, at('wind_speed_10m') ?? 0),
    windSpeed80: at('wind_speed_80m'),
    windDir10: at('wind_direction_10m') ?? at('wind_direction_80m') ?? 0,
    windDir80: at('wind_direction_80m') ?? 0,
    gust: Math.max(0, at('wind_gusts_10m') ?? 0),
    freezingLvl: at('freezing_level_height'),  // null when missing → engine uses its 2500 m default (0 would read as arctic and fabricate a steep lapse rate)
    pressureMsl: at('pressure_msl') ?? 1013,
    surfacePres: at('surface_pressure') ?? at('pressure_msl') ?? 1013,
    apparentTemp: at('apparent_temperature') ?? t2m ?? 10,
    surfaceTemp: at('surface_temperature') ?? t2m ?? 10,
    wetBulb: null,
    isDay: isDay != null ? Math.round(isDay) : null,
    dayOfYear: doy, localHour: lh,
    visibility: at('visibility') ?? 24000,
    blHeight: at('boundary_layer_height'),
    liftedIndex: at('lifted_index'),
    capeMax: dailies.capeMax?.[dIdx] ?? null,
    capeMean: dailies.capeMean?.[dIdx] ?? null,
    precipSum: dailies.precipSum?.[dIdx] ?? null,
    gustMean: null,
    t850: at('temperature_850hPa'), t700: at('temperature_700hPa'), t500: at('temperature_500hPa'),
    td850: at('dew_point_850hPa'), td700: at('dew_point_700hPa'),
    rh850: at('relative_humidity_850hPa'), rh700: at('relative_humidity_700hPa'), rh500: at('relative_humidity_500hPa'),
    z850: at('geopotential_height_850hPa'), z700: at('geopotential_height_700hPa'), z500: at('geopotential_height_500hPa'),
    spd850: at('wind_speed_850hPa'), spd700: at('wind_speed_700hPa'), spd500: at('wind_speed_500hPa'), spd300: at('wind_speed_300hPa'),
    dir850: at('wind_direction_850hPa'), dir700: at('wind_direction_700hPa'), dir500: at('wind_direction_500hPa'), dir300: at('wind_direction_300hPa'),
    w700: at('vertical_velocity_700hPa'),
    oroLift: null,
  };
}

function emptyScore() {
  return {
    thunderstorm: 0, hail: 0, tornado: 0, lightning: 0,
    stormMode: 'None', confidence: 0, thunderProb: 0,
    limitingIngredient: 'instability', dominantHazard: 'none', flashRate: 0,
    sub: { tornado: 0, hail: 0, flashFlood: 0, strongWinds: 0, supercell: 0 }, metrics: {},
  };
}
// A convectively-dead cell: the deterministic mean IS the answer; the ensemble
// adds nothing. Stamp the probability fields the UI reads with quiet defaults.
function stampQuiet(meanScores, nMembers) {
  return {
    ...meanScores,
    metrics: {
      ...meanScores.metrics,
      ensembleMembers: nMembers, syntheticMembers: false,
      poeThunder: 0, poeSevere: 0, poeSigSevere: 0, poeHail: 0, poeTornado: 0, poeWind: 0,
      ensembleAgreement: 1,
      thunderProbHigh: meanScores.thunderProb, thunderProbLow: meanScores.thunderProb,
      thunderProbMean: meanScores.thunderProb, thunderProbRaw: null,
      confidenceCentral: meanScores.confidence,
    },
  };
}

// ── Full ensemble scoring (member cloud + HOCO synthetic dispersion) ─────────
// Only invoked on cells the dispersion gate deems worthwhile.
function ensembleScore(ctx) {
  const { i, dIdx, doy, lh, meanScores, members, spread, dailies } = ctx;
  const memAt = (mem) => (name) => arrAt(mem.variables[name], i);
  const scoreMember = (mem) => engineScores(buildEnv(memAt(mem), dIdx, dailies, doy, lh));

  // Only members with data at THIS hour contribute. A model fetched for fewer
  // forecast days has no values on the later days, so it drops out of their
  // ensemble automatically — this is what yields Day 1 = 6, Day 2 = 4, Day 3 = 3.
  const present = members.filter(m => arrAt(m.variables.temperature_2m, i) != null);
  const totalW = present.reduce((s, m) => s + m.weight, 0);
  if (!present.length || totalW <= 0) return stampQuiet(meanScores, members.length);

  let sumT = 0, sumH = 0, sumTor = 0, sumL = 0;
  let sST = 0, sSH = 0, sSF = 0, sSW = 0, sSS = 0;
  let wOccur = 0, wSevere = 0, wSig = 0, wHail = 0, wTorn = 0, wWind = 0, sumTProb = 0;
  const memTP = [];

  for (const mem of present) {
    const s = scoreMember(mem), w = mem.weight, sub = s.sub || {};
    sumT += w * s.thunderstorm; sumH += w * s.hail; sumTor += w * s.tornado; sumL += w * s.lightning;
    sST += w * (sub.tornado || 0); sSH += w * (sub.hail || 0); sSF += w * (sub.flashFlood || 0);
    sSW += w * (sub.strongWinds || 0); sSS += w * (sub.supercell || 0);
    const tp = clamp(s.thunderProb || 0, 0, 100);
    sumTProb += w * tp; memTP.push({ w, tp });
    const mts = s.thunderstorm || 0;
    if (mts >= THUNDER_OCCUR_SCORE) wOccur += w;
    if (mts >= SEVERE_SCORE) wSevere += w;
    if (mts >= SIG_SEVERE_SCORE) wSig += w;
    if ((s.hail || 0) >= HAIL_OCCUR_SCORE) wHail += w;
    if ((s.tornado || 0) >= TORNADO_OCCUR_SCORE) wTorn += w;
    if ((sub.strongWinds || 0) >= WIND_OCCUR_SCORE) wWind += w;
  }

  const wmean = (x) => Math.round(x / totalW);
  const wnorm = (x) => (totalW ? x / totalW : 0);
  const nMem = present.length;
  const ensActive = nMem >= 2 && totalW > 0;

  const ensThunderProb = ensActive ? clamp(Math.round(wnorm(sumTProb)), 0, 100) : meanScores.thunderProb;
  const poeThunder = ensActive ? Math.round(100 * wnorm(wOccur))  : null;
  const poeSevere  = ensActive ? Math.round(100 * wnorm(wSevere)) : null;
  const poeSig     = ensActive ? Math.round(100 * wnorm(wSig))    : null;
  const poeHail    = ensActive ? Math.round(100 * wnorm(wHail))   : null;
  const poeTorn    = ensActive ? Math.round(100 * wnorm(wTorn))   : null;
  const poeWind    = ensActive ? Math.round(100 * wnorm(wWind))   : null;

  let agreement = null, tpHigh = null, tpLow = null;
  if (ensActive && memTP.length) {
    const meanTP = wnorm(sumTProb);
    let va = 0; tpHigh = -Infinity; tpLow = Infinity;
    for (const m of memTP) { va += m.w * (m.tp - meanTP) ** 2; if (m.tp > tpHigh) tpHigh = m.tp; if (m.tp < tpLow) tpLow = m.tp; }
    agreement = +Math.max(0, Math.min(1, 1 - Math.sqrt(Math.max(0, wnorm(va))) / 50)).toFixed(2);
  }

  // ── HOCO synthetic dispersion (dense, calibrated PoE from model-means) ──────
  const haveTrueMembers = (() => {
    const per = new Map();
    for (const m of present) per.set(m.model, (per.get(m.model) || 0) + 1);
    for (const c of per.values()) if (c >= 3) return true;
    return false;
  })();

  let hocoThunderProb = null, hocoPoE = null, hocoPoESevere = null, hocoPoESig = null,
      hocoPoEHail = null, hocoPoETorn = null, hocoPoEWind = null,
      hocoAgreement = null, hocoHigh = null, hocoLow = null, hocoTsTail = null;

  if (!haveTrueMembers && totalW > 0) {
    let wAll = 0, pSum = 0, pOcc = 0, pSev = 0, pSig = 0, pHail = 0, pTorn = 0, pWind = 0;
    let hi = -Infinity, lo = Infinity, tailAcc = 0, tailW = 0;
    const tpDraws = [];
    for (const mem of present) {
      const v = mem.variables;
      const baseAt = memAt(mem);
      const baseEnv = buildEnv(baseAt, dIdx, dailies, doy, lh);
      const baseCape = arrAt(v.cape, i), baseCin = arrAt(v.convective_inhibition, i);
      const baseLI = arrAt(v.lifted_index, i), baseGust = arrAt(v.wind_gusts_10m, i);
      const capeMV = memberValuesFor(baseCape, spread.cape?.[i], 'cape', null);
      const cinMV  = memberValuesFor(baseCin,  spread.cin?.[i],  'convective_inhibition', null);
      const liMV   = baseLI != null ? memberValuesFor(baseLI, spread.li?.[i], 'lifted_index', null) : { values: [] };
      const gustMV = baseGust != null ? memberValuesFor(baseGust, spread.gust?.[i], 'wind_gusts_10m', null) : { values: [] };
      const nDraw = capeMV.values.length || SYN_MEMBERS_PER_MODEL;
      const drawW = mem.weight / Math.max(1, nDraw);
      for (let k = 0; k < nDraw; k++) {
        const prof = perturbedProfile(v, i, k);
        const sc = engineScores({
          ...baseEnv,
          cape: Math.max(0, capeMV.values[k] ?? baseEnv.cape),
          cin: cinMV.values[k] ?? baseEnv.cin,
          gust: Math.max(0, gustMV.values[k] ?? baseEnv.gust),
          liftedIndex: liMV.values[k] ?? baseEnv.liftedIndex,
          t850: prof.t850, t700: prof.t700, t500: prof.t500,
          td850: prof.td850, td700: prof.td700,
          rh850: prof.rh850, rh700: prof.rh700, rh500: prof.rh500,
          z850: prof.z850, z700: prof.z700, z500: prof.z500,
          spd850: prof.spd850, spd700: prof.spd700, spd500: prof.spd500, spd300: prof.spd300,
          dir850: prof.dir850, dir700: prof.dir700, dir500: prof.dir500, dir300: prof.dir300,
          w700: prof.w700,
        });
        const mts = sc.thunderstorm || 0, mtp = clamp(sc.thunderProb || 0, 0, 100);
        wAll += drawW; pSum += drawW * mtp;
        if (mts >= THUNDER_OCCUR_SCORE) pOcc += drawW;
        if (mts >= SEVERE_SCORE) pSev += drawW;
        if (mts >= SIG_SEVERE_SCORE) pSig += drawW;
        if ((sc.hail || 0) >= HAIL_OCCUR_SCORE) pHail += drawW;
        if ((sc.tornado || 0) >= TORNADO_OCCUR_SCORE) pTorn += drawW;
        if ((sc.sub?.strongWinds || 0) >= WIND_OCCUR_SCORE) pWind += drawW;
        if (mtp > hi) hi = mtp; if (mtp < lo) lo = mtp;
        tpDraws.push({ w: drawW, tp: mtp });
        tailAcc += drawW * mts; tailW += drawW;
        if (mts >= SEVERE_SCORE) { tailAcc += 0.6 * drawW * mts; tailW += 0.6 * drawW; }
      }
    }
    if (wAll > 0) {
      const nz = (x) => x / wAll;
      hocoThunderProb = clamp(Math.round(nz(pSum)), 0, 100);
      hocoPoE = Math.round(100 * nz(pOcc));
      hocoPoESevere = Math.round(100 * nz(pSev));
      hocoPoESig = Math.round(100 * nz(pSig));
      hocoPoEHail = Math.round(100 * nz(pHail));
      hocoPoETorn = Math.round(100 * nz(pTorn));
      hocoPoEWind = Math.round(100 * nz(pWind));
      hocoHigh = hi === -Infinity ? null : Math.round(hi);
      hocoLow  = lo === Infinity ? null : Math.round(lo);
      const meanTP = nz(pSum);
      let va = 0; for (const d of tpDraws) va += d.w * (d.tp - meanTP) ** 2;
      hocoAgreement = +Math.max(0, Math.min(1, 1 - Math.sqrt(Math.max(0, nz(va))) / 50)).toFixed(2);
      hocoTsTail = tailW > 0 ? tailAcc / tailW : null;
    }
  }

  // Headline probability: blend dense PoE with the central logistic, then apply
  // the stored reliability calibration so the published % verifies.
  const centralLogistic = meanScores.thunderProb ?? 0;
  let finalThunderProb;
  if (hocoThunderProb != null) {
    finalThunderProb = applyProbCalibration(clamp(Math.round(0.65 * hocoPoE + 0.35 * centralLogistic), 0, 100), dIdx);
  } else if (ensActive) {
    finalThunderProb = applyProbCalibration(clamp(Math.round(0.5 * (poeThunder ?? ensThunderProb) + 0.5 * ensThunderProb), 0, 100), dIdx);
  } else {
    finalThunderProb = applyProbCalibration(ensThunderProb, dIdx);
  }

  const outPoeThunder = hocoPoE ?? poeThunder;
  const outPoeSevere  = hocoPoESevere ?? poeSevere;
  const outPoeSig     = hocoPoESig ?? poeSig;
  const outPoeHail    = hocoPoEHail ?? poeHail;
  const outPoeTornado = hocoPoETorn ?? poeTorn;
  const outPoeWind    = hocoPoEWind ?? poeWind;
  const outAgreement  = hocoAgreement ?? agreement;
  const outHigh = hocoHigh ?? (tpHigh === -Infinity ? null : tpHigh);
  const outLow  = hocoLow ?? (tpLow === Infinity ? null : tpLow);
  const outConfidence = outAgreement != null
    ? Math.round(0.6 * (meanScores.confidence ?? 0) + 0.4 * outAgreement * 100)
    : meanScores.confidence;

  // Tail-aware headline score: lift a member-mean that under-calls a hot minority
  // — bounded upward only and gated by occurrence probability.
  const baseTs = wmean(sumT);
  let outThunderstorm = baseTs;
  if (hocoTsTail != null && outPoeThunder != null) {
    const occ01 = clamp01(outPoeThunder / 100);
    const tailLift = clamp(hocoTsTail - baseTs, 0, 100);
    outThunderstorm = clamp(Math.round(baseTs + 0.45 * occ01 * tailLift), 0, 100);
  }

  return {
    thunderstorm: outThunderstorm,
    hail: wmean(sumH), tornado: wmean(sumTor), lightning: wmean(sumL),
    stormMode: meanScores.stormMode,
    confidence: outConfidence,
    thunderProb: finalThunderProb,
    limitingIngredient: meanScores.limitingIngredient,
    dominantHazard: meanScores.dominantHazard,
    flashRate: meanScores.flashRate,
    stormMotionDir: meanScores.stormMotionDir,
    stormMotionMph: meanScores.stormMotionMph,
    spanishPlume: meanScores.spanishPlume,
    sub: {
      tornado: wmean(sST), hail: wmean(sSH), flashFlood: wmean(sSF),
      strongWinds: wmean(sSW), supercell: wmean(sSS),
    },
    metrics: {
      ...meanScores.metrics,
      ensembleMembers: nMem,
      syntheticMembers: hocoThunderProb != null,
      thunderProbMean: meanScores.thunderProb,
      thunderProbRaw: hocoThunderProb,
      poeThunder: outPoeThunder, poeSevere: outPoeSevere, poeSigSevere: outPoeSig,
      poeHail: outPoeHail, poeTornado: outPoeTornado, poeWind: outPoeWind,
      ensembleAgreement: outAgreement,
      thunderProbHigh: outHigh, thunderProbLow: outLow,
      confidence: outConfidence, confidenceCentral: meanScores.confidence,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build one grid point from its merged JSON — score-once, perStep + perDay.
// ─────────────────────────────────────────────────────────────────────────────
function buildPointFromJSON(lat, lon, json, runStartMs, maxDay) {
  const hourly = json?.hourly;
  if (!hourly?.time?.length) return null;
  const weights = getModelWeights();
  const members = parseEnsembleMembers(hourly, weights);
  const totalW = members.reduce((s, m) => s + m.weight, 0);

  const daily = json?.daily ?? null;
  const dailies = {
    capeMax:   daily ? collapseMeanOrNull(daily, 'cape_max', weights)          : null,
    capeMean:  daily ? collapseMeanOrNull(daily, 'cape_mean', weights)         : null,
    precipSum: daily ? collapseMeanOrNull(daily, 'precipitation_sum', weights) : null,
  };
  const spread = {
    cape: collapseMeanOrNull(hourly, 'cape_spread', weights),
    cin:  collapseMeanOrNull(hourly, 'convective_inhibition_spread', weights),
    li:   collapseMeanOrNull(hourly, 'lifted_index_spread', weights),
    gust: collapseMeanOrNull(hourly, 'wind_gusts_10m_spread', weights),
  };

  const times = hourly.time;
  const timeMs = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    const raw = times[i];
    timeMs[i] = Date.parse(raw.includes('T') ? raw + 'Z' : raw + 'T00:00:00Z');
  }
  const nearestIdx = (t) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < timeMs.length; i++) { const d = Math.abs(timeMs[i] - t); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  const runDate = new Date(runStartMs);
  const runDayMidnight = Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate());

  const collapsed = new Map();
  const getMean = (name) => {
    if (collapsed.has(name)) return collapsed.get(name);
    const arr = name === 'weather_code' ? collapseMode(hourly, name) : collapseMeanOrNull(hourly, name, weights);
    collapsed.set(name, arr);
    return arr;
  };

  const scoreCache = new Map();
  function scoreAt(i) {
    const hit = scoreCache.get(i);
    if (hit) return hit;
    const t = timeMs[i], dt = new Date(t);
    const doy = dayOfYear(dt), lh = dt.getUTCHours();
    const dIdx = clamp(Math.floor((t - runDayMidnight) / 86400_000), 0, 3);
    const meanEnv = buildEnv((name) => arrAt(getMean(name), i), dIdx, dailies, doy, lh);
    const meanScores = engineScores(meanEnv);

    let result;
    if (!members.length || totalW <= 0) {
      result = meanScores;
    } else {
      const wx = meanEnv.wxCode;
      const isThunder = THUNDER_CODES.has(wx);
      const isShowery = !isThunder && SHOWERY_CODES.has(wx);
      if (!dispersionWorthwhile({ meanThunder: meanScores.thunderstorm, cape: meanEnv.cape, capeMax: meanEnv.capeMax, isThunder, isShowery })) {
        result = stampQuiet(meanScores, members.length);
      } else {
        result = ensembleScore({ i, dIdx, doy, lh, meanScores, members, spread, dailies });
      }
    }
    scoreCache.set(i, result);
    return result;
  }

  const lastDay = clamp(Math.round(num(maxDay, 2)), 0, 2);   // 3-day outlook (Day 4 removed)
  const stepHorizon = (lastDay + 1) * STEPS_PER_DAY;

  // perStep is DAY-ANCHORED: step s covers day floor(s/8) at clock hour (s%8)×3
  // (00, 03, … 21 UTC). This keeps every step inside a day we actually fetched
  // (so fetching lastDay+1 days is exactly sufficient) and aligns the 3-hourly
  // timeline to clock hours regardless of the run hour — a cleaner diurnal view
  // than the old run-anchored steps, which drifted with the run time and (once
  // the fetch was trimmed to the needed days) would have pointed past the data.
  const perStep = [];
  for (let s = 0; s < TOTAL_STEPS; s++) {
    if (s >= stepHorizon) { perStep.push(null); continue; }
    const d = Math.floor(s / STEPS_PER_DAY);
    const hourInDay = (s % STEPS_PER_DAY) * HOURS_PER_STEP;
    const target = runDayMidnight + d * 86400_000 + hourInDay * 3600_000;
    perStep.push({ scores: scoreAt(nearestIdx(target)) });
  }

  // Ensemble-mean 2 m temperature per hour — used for the daily max/min temp
  // maps (computed here so the temperature layer needs NO extra API request).
  const t2mMean = getMean('temperature_2m');
  const perDay = [];
  for (let d = 0; d <= lastDay; d++) {
    const dayStart = runDayMidnight + d * 86400_000, dayEnd = dayStart + 86400_000;
    let peakHour = null, peakIdx = -1, maxThunder = -1;
    const hazMax = { thunderstorm: 0, hail: 0, tornado: 0, lightning: 0 };
    const subMax = { tornado: 0, hail: 0, flashFlood: 0, strongWinds: 0, supercell: 0 };
    let tMax = -Infinity, tMin = Infinity;
    for (let i = 0; i < timeMs.length; i++) {
      if (timeMs[i] < dayStart || timeMs[i] >= dayEnd) continue;
      const tv = arrAt(t2mMean, i);
      if (tv != null) { if (tv > tMax) tMax = tv; if (tv < tMin) tMin = tv; }
      const sc = scoreAt(i);
      hazMax.thunderstorm = Math.max(hazMax.thunderstorm, sc.thunderstorm);
      hazMax.hail = Math.max(hazMax.hail, sc.hail);
      hazMax.tornado = Math.max(hazMax.tornado, sc.tornado);
      hazMax.lightning = Math.max(hazMax.lightning, sc.lightning);
      for (const k in subMax) subMax[k] = Math.max(subMax[k], sc.sub?.[k] || 0);
      if (sc.thunderstorm > maxThunder) { maxThunder = sc.thunderstorm; peakHour = sc; peakIdx = i; }
    }
    const basis = peakHour || emptyScore();
    const lead = d === 0 ? 1.00 : d === 1 ? 0.92 : 0.82;   // lead-time confidence decay (Day 1–3)
    perDay.push({
      scores: {
        ...basis,
        thunderstorm: Math.round(hazMax.thunderstorm * lead),
        hail: Math.round(hazMax.hail * lead),
        tornado: Math.round(hazMax.tornado * lead),
        lightning: Math.round(hazMax.lightning * lead),
        sub: {
          tornado: Math.round(subMax.tornado * lead),
          hail: Math.round(subMax.hail * lead),
          flashFlood: Math.round(subMax.flashFlood * lead),
          strongWinds: Math.round(subMax.strongWinds * lead),
          supercell: Math.round(subMax.supercell * lead),
        },
        metrics: { ...basis.metrics },
        peakHourUTC: peakIdx >= 0 ? new Date(timeMs[peakIdx]).getUTCHours() : null,
      },
      temp: {
        max: tMax > -Infinity ? Math.round(tMax * 10) / 10 : null,
        min: tMin <  Infinity ? Math.round(tMin * 10) / 10 : null,
      },
    });
  }
  return { lat, lon, perStep, perDay };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spatial convergence enhancement — light up sea-breeze / terrain / confluence
// boundaries over an already-unstable, moist airmass. GATED by each cell's own
// instability × moisture so convergence can only RELEASE latent potential, never
// manufacture a storm from a stable/dry airmass.
// ─────────────────────────────────────────────────────────────────────────────
const MPS_PER_MPH = 0.44704;
function applyConvergenceEnhancement(grid, gridStep) {
  if (!Array.isArray(grid) || grid.length < 6) return grid;
  const key = (ri, ci) => `${ri},${ci}`;
  // reduce, not Math.min(...spread): spreading a resolution-scaled array overflows
  // the call stack on large grids ("Maximum call stack size exceeded").
  const latMin = grid.reduce((m, p) => (p.lat < m ? p.lat : m), Infinity);
  const lonMin = grid.reduce((m, p) => (p.lon < m ? p.lon : m), Infinity);
  const idx = new Map();
  for (const p of grid) {
    p.__ri = Math.round((p.lat - latMin) / gridStep);
    p.__ci = Math.round((p.lon - lonMin) / gridStep);
    idx.set(key(p.__ri, p.__ci), p);
  }
  const windUV = (scores) => {
    const m = scores?.metrics; if (!m) return null;
    const spd = num(m.windSpeed, null), dir = num(m.windDir, null);
    if (spd == null) return null;
    const d = (dir == null ? 0 : dir) * Math.PI / 180;
    return [-spd * Math.sin(d) * MPS_PER_MPH, -spd * Math.cos(d) * MPS_PER_MPH];
  };
  const meanLat = grid.reduce((s, p) => s + p.lat, 0) / grid.length;
  const dyM = gridStep * 111_000;
  const dxM = gridStep * 111_000 * Math.cos(meanLat * Math.PI / 180);

  for (const p of grid) {
    for (let d = 0; d < (p.perDay || []).length; d++) {
      const sc = p.perDay[d]?.scores; if (!sc) continue;
      const E = idx.get(key(p.__ri, p.__ci + 1)), W = idx.get(key(p.__ri, p.__ci - 1));
      const N = idx.get(key(p.__ri + 1, p.__ci)), S = idx.get(key(p.__ri - 1, p.__ci));
      if (!E || !W || !N || !S) continue;
      const uvE = windUV(E.perDay?.[d]?.scores), uvW = windUV(W.perDay?.[d]?.scores);
      const uvN = windUV(N.perDay?.[d]?.scores), uvS = windUV(S.perDay?.[d]?.scores);
      if (!uvE || !uvW || !uvN || !uvS) continue;
      const convergence = -((uvE[0] - uvW[0]) / (2 * dxM) + (uvN[1] - uvS[1]) / (2 * dyM));
      const qOf = (node) => { const m = node?.perDay?.[d]?.scores?.metrics; return m ? num(m.dewPoint, 0) : 0; };
      const qE = qOf(E), qW = qOf(W), qN = qOf(N), qS = qOf(S);
      const mfc = -((qE * uvE[0] - qW * uvW[0]) / (2 * dxM) + (qN * uvN[1] - qS * uvS[1]) / (2 * dyM));
      const boundary = clamp01(0.7 * clamp01(convergence / 1.2e-4) + 0.3 * clamp01(mfc / 2.5e-3));
      if (boundary < 0.12) continue;
      const inst01 = clamp01(num(sc.metrics?.instability, 0) / 100);
      const moist01 = clamp01(num(sc.metrics?.moisture, 0) / 100);
      const latent = Math.sqrt(inst01 * moist01);
      if (latent < 0.22) continue;
      const boost = boundary * latent * 24;
      if (boost < 1) continue;
      const before = sc.thunderstorm || 0;
      const after = clamp(before + boost, 0, 100);
      sc.thunderstorm = Math.round(after);
      const ratio = before > 0 ? after / before : 1 + boost / 20;
      sc.lightning = Math.round(clamp((sc.lightning || 0) * Math.min(ratio, 1.8), 0, 100));
      if (sc.sub) {
        sc.sub.flashFlood = Math.round(clamp((sc.sub.flashFlood || 0) * Math.min(ratio, 1.6), 0, 100));
        sc.sub.hail = Math.round(clamp((sc.sub.hail || 0) * Math.min(ratio, 1.4), 0, 100));
      }
      if (sc.metrics) {
        sc.metrics.convergence = Math.round(boundary * 100);
        if (boundary > 0.4 && latent > 0.3) sc.metrics.convergenceBoundary = true;
      }
    }
    delete p.__ri; delete p.__ci;
  }
  return grid;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEIGHBOURHOOD ENSEMBLE PROBABILITY (NEP) — the SPC "within ~40 km" smoothing.
// Replaces each day's hazard scores with a distance-weighted blend of itself and
// its neighbours (60 % neighbourhood mean for coherent areas + 40 % neighbourhood
// max to keep genuine local peaks). Removes single-cell speckle so the outlook
// reads as coherent, hand-drawn areas. Applied to perDay only (the outlook); the
// 3-hourly perStep animation keeps cell-level detail.
// ─────────────────────────────────────────────────────────────────────────────
function applyNEP(grid, gridStep) {
  if (!Array.isArray(grid) || grid.length < 6) return grid;
  const RADIUS_KM = 40, radiusDeg = RADIUS_KM / 111;
  const win = Math.max(1, Math.ceil(radiusDeg / gridStep));
  // reduce, not Math.min(...spread): spreading a resolution-scaled array overflows
  // the call stack on large grids ("Maximum call stack size exceeded").
  const latMin = grid.reduce((m, p) => (p.lat < m ? p.lat : m), Infinity);
  const lonMin = grid.reduce((m, p) => (p.lon < m ? p.lon : m), Infinity);
  const key = (gi, gj) => `${gi},${gj}`;
  const idx = new Map();
  for (const p of grid) {
    p.__gi = Math.round((p.lat - latMin) / gridStep);
    p.__gj = Math.round((p.lon - lonMin) / gridStep);
    idx.set(key(p.__gi, p.__gj), p);
  }
  const cosLat = Math.cos(((latMin + 1) * Math.PI) / 180);
  const sigma = radiusDeg / 2;
  const offsets = [];
  for (let di = -win; di <= win; di++) for (let dj = -win; dj <= win; dj++) {
    const dist = Math.hypot(di * gridStep, dj * gridStep * cosLat);
    if (dist > radiusDeg) continue;
    offsets.push({ di, dj, w: Math.exp(-(dist * dist) / (2 * sigma * sigma)) });
  }
  const HAZ = ['thunderstorm', 'hail', 'tornado', 'lightning'];
  const SUBS = ['tornado', 'hail', 'flashFlood', 'strongWinds', 'supercell'];

  // Snapshot raw values so neighbours read pre-smoothed inputs (no bleeding).
  const raw = new Map();
  for (const p of grid) {
    raw.set(key(p.__gi, p.__gj), (p.perDay || []).map(d => ({
      thunderstorm: d.scores.thunderstorm, hail: d.scores.hail,
      tornado: d.scores.tornado, lightning: d.scores.lightning, sub: { ...d.scores.sub },
    })));
  }
  const neighbourhood = (p, get) => {
    let wsum = 0, vsum = 0, vmax = 0;
    for (const o of offsets) {
      const np = idx.get(key(p.__gi + o.di, p.__gj + o.dj));
      if (!np) continue;
      const v = get(np) ?? 0;
      wsum += o.w; vsum += o.w * v;
      if (v > vmax) vmax = v;
    }
    if (wsum <= 0) return get(p) ?? 0;
    return 0.6 * (vsum / wsum) + 0.4 * vmax;
  };
  for (const p of grid) {
    for (let d = 0; d < p.perDay.length; d++) {
      const sc = p.perDay[d].scores;
      for (const h of HAZ) sc[h] = Math.round(neighbourhood(p, (np) => raw.get(key(np.__gi, np.__gj))?.[d]?.[h]));
      for (const k of SUBS) sc.sub[k] = Math.round(neighbourhood(p, (np) => raw.get(key(np.__gi, np.__gj))?.[d]?.sub?.[k]));
    }
    delete p.__gi; delete p.__gj;
  }
  return grid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid summary (p95 hazard, p05/p95 metric ranges) over the REAL nodes.
// ─────────────────────────────────────────────────────────────────────────────
function buildSummary(grid) {
  return [0, 1, 2].map(d => {
    const ts = [], hl = [], tn = [], lg = [];
    const subT = [], subH = [], subF = [], subW = [], subS = [];
    const capes = [], rains = [], cins = [], gusts = [], frz = [];
    let stormyCells = 0;
    for (const p of grid) {
      const sc = p.perDay[d]?.scores; if (!sc) continue;
      ts.push(sc.thunderstorm); hl.push(sc.hail); tn.push(sc.tornado); lg.push(sc.lightning);
      if (sc.thunderstorm >= 8) {
        stormyCells++;
        subT.push(sc.sub.tornado); subH.push(sc.sub.hail); subF.push(sc.sub.flashFlood);
        subW.push(sc.sub.strongWinds); subS.push(sc.sub.supercell);
        capes.push(sc.metrics.cape); rains.push(sc.metrics.precip || 0);
        cins.push(sc.metrics.cin || 0); gusts.push(sc.metrics.gust || 0);
        frz.push(sc.metrics.freezingLvl || 0);
      }
    }
    const p95 = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)]; };
    const p05 = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.05)]; };
    return {
      thunderstorm: p95(ts), hail: p95(hl), tornado: p95(tn), lightning: p95(lg),
      stormyCells, totalCells: grid.length,
      sub: { tornado: p95(subT), hail: p95(subH), flashFlood: p95(subF), strongWinds: p95(subW), supercell: p95(subS) },
      ranges: {
        cape: { min: p05(capes), max: p95(capes) },
        cin: { min: p05(cins), max: p95(cins) },
        shear: { min: 0, max: 0 },
        gust: { min: p05(gusts), max: p95(gusts) },
        freezingLvl: { min: p05(frz), max: p95(frz) },
        precip: { min: p05(rains), max: p95(rains) },
        hailMm: { min: 0, max: Math.round((subH.length ? subH.reduce((m, x) => (x > m ? x : m), 0) : 0) * 0.7) },
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Run-time estimator — mirrors the fetch plan so the UI countdown is honest.
// ─────────────────────────────────────────────────────────────────────────────
export function estimateRunSeconds({ bbox, gridStep, maxDay = 0 }) {
  const step = Math.min(gridStep || FETCH_STEP, FETCH_STEP);
  const total = buildCoords(bbox, step).length || 1;
  const plan = requestPlan(maxDay);
  const nBatches = Math.ceil(total / BATCH_SIZE);
  const batchesPerWorker = Math.ceil(nBatches / CONCURRENCY);
  // All tiers fire in parallel per batch, so the round-trip scales with the
  // widest (3-day physics) request — more forecast days ⇒ a larger response.
  const perBatchMs = 2500 + 400 * (plan.lastDay + 1);
  const totalMs = batchesPerWorker * perBatchMs + Math.max(0, batchesPerWorker - 1) * INTER_BATCH_MS;
  return Math.max(5, Math.round(totalMs / 1000) + 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — fetch, score, enhance, smooth, summarise.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Met Office temperature — the daily max/min shown on the temperature maps (and
// used as the app's temperature everywhere) is the UK Met Office model (UKMO
// "seamless": the 2 km UKV near-term, backed by the Met Office global model so
// all three days are covered), pulled through Open-Meteo's CORS-friendly gateway
// ONCE per run and baked onto every grid cell — overwriting the coarse ensemble-
// mean temperature. Best-effort: if a chunk fails, its ensemble temp is kept.
// ─────────────────────────────────────────────────────────────────────────────
async function assignMetOfficeTemps(grid, lastDay) {
  if (!Array.isArray(grid) || !grid.length) return 0;
  const days = Math.max(1, Math.min(3, lastDay + 1));
  // Pick the national high-res temperature model for the active region: Météo-
  // France's seamless (AROME 1.3 km + ARPEGE) over France, the Met Office's
  // seamless (UKV) over the UK & Ireland. Inferred from the grid's mean latitude
  // (France box ~46°N, UK box ~55°N — cleanly split at 48°N) so no extra plumbing.
  const meanLat = grid.reduce((s, p) => s + p.lat, 0) / grid.length;
  const tempModel = meanLat < 48 ? 'meteofrance_seamless' : 'ukmo_seamless';
  const CHUNK = 100;
  const deadline = Date.now() + 20000; // hard cap so a slow response can't stall the run
  let assigned = 0;
  for (let i = 0; i < grid.length; i += CHUNK) {
    if (Date.now() > deadline) break;
    const slice = grid.slice(i, i + CHUNK);
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${slice.map(p => p.lat.toFixed(3)).join(',')}`
      + `&longitude=${slice.map(p => p.lon.toFixed(3)).join(',')}`
      + `&daily=temperature_2m_max,temperature_2m_min&models=${tempModel}&forecast_days=${days}&timezone=UTC`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const arr = await res.json();
      const list = Array.isArray(arr) ? arr : [arr];
      for (let j = 0; j < slice.length && j < list.length; j++) {
        const dly = list[j]?.daily; const mx = dly?.temperature_2m_max, mn = dly?.temperature_2m_min;
        if (!Array.isArray(mx)) continue;
        const pt = slice[j];
        for (let d = 0; d < pt.perDay.length && d < mx.length; d++) {
          const hi = mx[d], lo = mn?.[d];
          if (hi == null && lo == null) continue;
          pt.perDay[d].temp = {
            max: hi != null ? Math.round(hi * 10) / 10 : null,
            min: lo != null ? Math.round(lo * 10) / 10 : null,
          };
        }
        assigned++;
      }
    } catch { /* keep the ensemble temp for this chunk */ }
  }
  return assigned;
}

/* ── TCM V3 now runs on AWS data ─────────────────────────────────────────────
   GitHub Actions builds each run at 03:00 and 15:00 UK time from AWS open data
   (.github/workflows/tcm-v3.yml) with this same engine (buildTCMFromPoints), and the
   site serves the newest one at /api/tcm-v3/latest. "Run Model" and the page's own
   due-checks now load that run; nothing calls Open-Meteo any more. The name is kept so
   every existing caller keeps working unchanged. */
export async function fetchOpenMeteoTCM({ onProgress } = {}) {
  onProgress?.(0.1);
  const r = await fetch('/api/tcm-v3/latest', { cache: 'no-store' });
  if (!r.ok) {
    const e = new Error(r.status === 404 ? 'FETCH_NOT_DUE: no AWS run published yet (runs at 03:00 and 15:00 UK)' : `TCM V3 run unavailable (${r.status})`);
    e.code = r.status === 404 ? 'FETCH_NOT_DUE' : 'FETCH_FAILED';
    throw e;
  }
  const payload = await r.json();
  onProgress?.(1);
  return payload;
}

/** Legacy Open-Meteo pipeline — no longer called by the site. */
export async function fetchOpenMeteoTCMLegacy({ bbox, gridStep, run, onProgress, fastMode = false, force = false, maxDay = 2 }) {
  const now = Date.now();
  const plan = requestPlan(maxDay);

  if (!force) {
    if (!isInRunWindow(now)) { const e = new Error('FETCH_NOT_DUE: outside 00/06/12/18 UTC window'); e.code = 'FETCH_NOT_DUE'; throw e; }
    if (hasAlreadyFetchedThisRun(now)) { const e = new Error('FETCH_NOT_DUE: this run already fetched'); e.code = 'FETCH_NOT_DUE'; throw e; }
  }

  const effectiveStep = Math.min(gridStep || FETCH_STEP, FETCH_STEP);
  const coords = buildCoords(bbox, effectiveStep);
  // Shuffle so failures/rate-limits spread evenly across the region.
  for (let i = coords.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [coords[i], coords[j]] = [coords[j], coords[i]];
  }

  const runStartMs = run.getTime();
  const grid = [];
  const failures = [];
  let failedCount = 0, failedRateLimit = 0, done = 0, cursor = 0, pauseUntil = 0;
  const total = coords.length;
  const fetchStart = Date.now(), fetchDeadline = fetchStart + TOTAL_FETCH_BUDGET_MS;
  let budgetExceeded = false;

  async function worker() {
    while (cursor < total) {
      if (Date.now() >= fetchDeadline) { budgetExceeded = true; break; }
      const wait = pauseUntil - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const start = cursor;
      cursor = Math.min(cursor + BATCH_SIZE, total);
      const batch = coords.slice(start, cursor);
      if (!batch.length) break;
      try {
        const merged = await fetchBatchMerged(batch, plan, FETCH_TIMEOUT_MS);
        for (let i = 0; i < batch.length; i++) {
          if (!merged[i]) continue;
          const pt = buildPointFromJSON(batch[i].lat, batch[i].lon, merged[i], runStartMs, plan.lastDay);
          if (pt) grid.push(pt);
        }
        if (cursor < total) await new Promise(r => setTimeout(r, INTER_BATCH_MS));
      } catch (e) {
        for (const c of batch) {
          failedCount++;
          if (e?.status === 429) failedRateLimit++;
          if (failures.length < 25) failures.push({ lat: c.lat, lon: c.lon, msg: e?.message, status: e?.status });
        }
        if (e?.status === 429) pauseUntil = Math.max(pauseUntil, Date.now() + FETCH_BACKOFF_429_MS[FETCH_BACKOFF_429_MS.length - 1]);
      }
      done += batch.length;
      onProgress?.(Math.min(0.95, (done / total) * 0.95));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const fetchElapsedMs = Date.now() - fetchStart;
  const requested = cursor, skipped = total - requested;
  const coverage = requested > 0 ? grid.length / requested : 0;
  if (grid.length < 80 || coverage < 0.40) {
    throw new Error(
      `Open-Meteo fetch unusable: ${grid.length} cells, ${(coverage * 100).toFixed(0)}% of attempted, ` +
      `${failedRateLimit} 429s, ${(fetchElapsedMs / 1000).toFixed(1)}s${budgetExceeded ? ' (budget exceeded)' : ''}`);
  }
  if (failedCount || skipped) {
    console.warn(`[TCM] Fetched ${grid.length}/${total} cells · ${failedCount} failed · ${skipped} skipped · ${(fetchElapsedMs / 1000).toFixed(1)}s`);
  }
  markFetchDone(now);

  // Bake the Met Office (UKMO) temperature onto every cell — this is the app's
  // temperature source everywhere (temperature maps + any temp readout on any
  // view). Best-effort; ensemble temp remains as the fallback.
  onProgress?.(0.955);
  let metOfficeTempCells = 0;
  try { metOfficeTempCells = await assignMetOfficeTemps(grid, plan.lastDay); } catch { /* keep ensemble temp */ }

  onProgress?.(0.96);
  await new Promise(r => setTimeout(r, 0));
  applyConvergenceEnhancement(grid, effectiveStep);
  onProgress?.(0.98);
  await new Promise(r => setTimeout(r, 0));
  applyNEP(grid, effectiveStep);
  const summary = buildSummary(grid);
  onProgress?.(1);

  return {
    grid,
    summary,
    builtAt: Date.now(),
    source: 'open-meteo-ensemble',
    tempSource: metOfficeTempCells > 0 ? 'metoffice-ukmo-seamless' : 'ensemble-mean',
    metOfficeTempCells,
    cellCount: grid.length,
    realCellCount: grid.length,
    models: plan.allModels,
    requestedCells: total,
    attemptedCells: requested,
    skippedCells: skipped,
    failedCells: failedCount,
    failedRateLimit,
    coveragePct: Math.round(100 * grid.length / total),
    fetchElapsedMs,
    budgetExceeded,
    gridStep: effectiveStep,
    fineGridStep: effectiveStep,     // no densification — geometry engine builds the fine field
    maxDay: plan.lastDay,
    daysAvailable: plan.lastDay + 1,
    runStartMs,
    bbox,                            // enables continueTCM to re-fetch the extended range
    // A tiny in-memory marker so the "Continue" control stays enabled this
    // session (stripped before persistence). continueTCM re-fetches on demand.
    _rawById: { __continue: true },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// continueTCM — extend an existing run to a higher day. Under the tiered-variable
// policy a fresh fetch of the extended range is cheap, so we re-fetch rather than
// pay upfront for days that are usually never displayed.
// ─────────────────────────────────────────────────────────────────────────────
export async function continueTCM({ payload, toDay, onProgress }) {
  if (!payload || typeof payload !== 'object') throw new Error('continueTCM: no payload');
  if (payload.source === 'aws') {                // AWS runs are built with all days up front
    const fresh = await fetchOpenMeteoTCM({ onProgress });
    return { ...fresh, region: payload.region, run: fresh.run ?? payload.run };
  }
  const target = clamp(Math.round(num(toDay, 2)), 0, 2);
  const already = clamp(Math.round(num(payload.maxDay, 2)), 0, 2);
  if (target <= already) return payload;

  const bbox = payload.bbox;
  const runStartMs = Number(payload.runStartMs);
  if (!bbox || !Number.isFinite(runStartMs)) {
    const err = new Error('continueTCM: payload missing bbox/run — re-run the model to extend');
    err.code = 'NO_RAW';
    throw err;
  }
  const extended = await fetchOpenMeteoTCMLegacy({
    bbox,
    gridStep: payload.gridStep || FETCH_STEP,
    run: new Date(runStartMs),
    onProgress,
    force: true,
    maxDay: target,
  });
  return { ...extended, region: payload.region, run: payload.run ?? new Date(runStartMs).toISOString() };
}


// ─────────────────────────────────────────────────────────────────────────────
// buildTCMFromPoints — the same scoring as the live pipeline, from pre-built point
// series (AWS). Runs on GitHub (tools/tcm-v3/build.mjs); no network calls.
// ─────────────────────────────────────────────────────────────────────────────
export function buildTCMFromPoints({ input, bbox, gridStep = FETCH_STEP, maxDay = 2 }) {
  const runStartMs = Date.parse(input.init_utc);
  const lastDay = clamp(Math.round(num(maxDay, 2)), 0, 2);
  const grid = [];
  for (const pt of input.points) {
    if (!pointInUKIreland(pt.lat, pt.lon)) continue;
    const p = buildPointFromJSON(pt.lat, pt.lon, { hourly: pt.hourly, daily: pt.daily }, runStartMs, lastDay);
    if (p) grid.push(p);
  }
  applyConvergenceEnhancement(grid, gridStep);
  applyNEP(grid, gridStep);
  return {
    grid, summary: buildSummary(grid), builtAt: Date.now(), source: 'aws',
    tempSource: 'aws-model-blend (UKV-weighted)', cellCount: grid.length, realCellCount: grid.length,
    models: input.models, modelRuns: input.model_runs, requestedCells: input.points.length,
    coveragePct: Math.round(100 * grid.length / Math.max(1, input.points.length)),
    gridStep, fineGridStep: gridStep, maxDay: lastDay, daysAvailable: lastDay + 1,
    runStartMs, run: new Date(runStartMs).toISOString(), bbox,
  };
}
export { pointInUKIreland, FETCH_STEP };
