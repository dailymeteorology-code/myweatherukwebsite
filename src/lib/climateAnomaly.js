/* ════════════════════════════════════════════════════════════════════════════
   climateAnomaly — monthly UK climate values vs a 1991-2020 baseline.

   Powers the "Monthly Climate Anomaly" graphic: for a chosen month it fetches a
   grid of ERA5 reanalysis values over the UK & Ireland and compares each grid
   point against that point's own 30-year average for the same calendar month —
   the same construction the Met Office publishes its monthly anomaly maps with.

   DATA SOURCE
   -----------
   Open-Meteo's public ERA5 archive, always — deliberately NOT the self-hosted
   node the TCM model uses. That box carries forecast models rather than ERA5
   reanalysis, and mixing sources would make the month and its normals
   incomparable. One source, one set of units.

   COST / CACHING
   --------------
   One load = one variable, one month, one request per grid chunk. Open-Meteo
   weights a request by locations x variables x days, so asking for the whole
   field list on every load (as this once did) cost about nine times what the
   selected variable actually needed and drained the daily quota on fields
   nobody had asked to see.

   Fetched variables are merged into the month held in localStorage rather than
   replacing it, so a month builds up as variables are visited and going back to
   one already loaded costs nothing. The cache key embeds the grid signature, so
   changing the grid misses the cache and refetches rather than silently drawing
   old values against new points.
   ════════════════════════════════════════════════════════════════════════════ */

import { UK_BBOX } from '@/lib/ukCoastline';

export const BASELINE = { start: 1991, end: 2020 };
export const BASELINE_LABEL = `${BASELINE.start}–${BASELINE.end}`;

// Grid resolution over the UK box. Coarse enough to keep the baseline build
// affordable, fine enough to read as a map at the size the graphic renders.
// Finer than the original 0.55/0.85. Narrow ground — Cornwall, the Welsh
// peninsulas, the Highlands, Northern Ireland — caught too few points at the
// old spacing and rendered patchy.
export const GRID = { dLat: 0.35, dLon: 0.55 };

// How many grid points go in one multi-coordinate archive request. Open-Meteo
// accepts comma-separated lat/lon lists and returns an ARRAY of per-location
// objects; chunking keeps each URL comfortably short.
const CHUNK = 55;
/* Concurrency.
   Open-Meteo enforces a CONCURRENT-request cap, not just a rate cap, and replies
   429 "Too many concurrent requests" when it is exceeded. These two pools NEST
   during a baseline build, so what the API actually sees is
   YEAR_CONCURRENCY x CONCURRENCY. That product was 8 and tripped the guard —
   especially with the hourly-cloud month requests, which take ~6 s each and so
   sit in flight far longer than the daily ones. Product is now 2. Slower per
   request, but it finishes instead of failing, and the retry below absorbs any
   remaining bursts. */
const CONCURRENCY = 2;
const YEAR_CONCURRENCY = 1;

/* Retry. 429 and transient 5xx are expected under load rather than fatal, so
   back off and try again instead of failing the whole month. Honours Retry-After
   when the server sends one; otherwise exponential backoff with jitter so
   parallel workers don't retry in lockstep and re-trigger the same burst. */
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

/* Open-Meteo answers 429 for two very different things, and they need opposite
   handling:

     concurrency / per-minute   transient. Back off and retry; it clears in
                                seconds, which is what the retry loop is for.
     hourly / daily quota       a cap. No amount of retrying clears it before the
                                hour or the day rolls over, and every attempt
                                spends more of an allowance already exhausted.

   The response body says which. Read it instead of treating all 429s alike. */
const QUOTA_LIMIT = /hourly|daily/i;

/** The server's own explanation for a failed response, or '' if it gave none. */
async function failureReason(r) {
  // Cloned: the caller still needs to read the body to build its own message.
  try { return (await r.clone().json())?.reason || ''; } catch { return ''; }
}

/**
 * Turn a failed archive/forecast response into an error worth showing.
 *
 * Open-Meteo's own wording is far more use than anything invented here — it
 * distinguishes a momentary rate-limit from an hourly or daily cap, and says
 * when the cap lifts. An earlier version threw that away for 429 and told the
 * user to "wait a minute", which is simply wrong when the daily limit is spent.
 */
async function archiveError(r, what = 'archive') {
  const reason = await failureReason(r);
  if (r.status === 429) {
    return new Error(reason
      ? `Open-Meteo: ${reason}`
      : 'Open-Meteo is rate-limiting this browser (429) — wait a moment and try again.');
  }
  return new Error(`${what} ${r.status}${reason ? ` — ${reason}` : ''}`);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  function onAbort() { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }
  signal?.addEventListener('abort', onAbort, { once: true });
});

const backoffMs = (attempt) => Math.min(10_000, 500 * 2 ** attempt) + Math.random() * 400;

async function fetchWithRetry(url, signal) {
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let r = null;
    try {
      r = await fetch(url, { signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (++attempt >= MAX_ATTEMPTS) throw e;      // network blip
      await sleep(backoffMs(attempt), signal);
      continue;
    }
    if (r.ok) return r;
    // A quota cap is not transient — hand it straight back so the caller can
    // report it, rather than burning four more requests against a spent budget.
    if (r.status === 429 && QUOTA_LIMIT.test(await failureReason(r))) return r;
    if (!RETRY_STATUSES.has(r.status) || attempt + 1 >= MAX_ATTEMPTS) return r;
    attempt++;
    const retryAfter = Number(r.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt), signal);
  }
}

/* ── Variables ──────────────────────────────────────────────────────────────
   `mode` decides how the anomaly is expressed:
     'ratio' -> percent of average  (rainfall, sunshine)
     'diff'  -> difference from average in the variable's own unit (temp, cloud)
   `agg` is how daily values roll up to a monthly figure.
   `scale` converts the API's unit to the display unit.                       */
export const CLIMATE_VARS = [
  {
    // precipitation_sum, NOT rain_sum. rain_sum is the liquid-rain component
    // only — it drops snow, so a snowy month reads far too dry against a
    // rainfall normal built from total precipitation. This is also the field
    // the reference archive URL uses.
    id: 'rain', label: 'Rainfall', short: 'Rainfall',
    daily: 'precipitation_sum', agg: 'sum', scale: 1,
    unit: 'mm', mode: 'ratio',
    highLabel: 'Wetter than average', lowLabel: 'Drier than average',
  },
  {
    id: 'temp', label: 'Temperature', short: 'Temp',
    daily: 'temperature_2m_mean', agg: 'mean', scale: 1,
    unit: '°C', mode: 'diff',
    highLabel: 'Warmer than average', lowLabel: 'Colder than average',
  },
  {
    id: 'sun', label: 'Sunshine', short: 'Sun',
    daily: 'sunshine_duration', agg: 'sum', scale: 1 / 3600,   // seconds -> hours
    unit: 'hrs', mode: 'ratio',
    highLabel: 'Sunnier than average', lowLabel: 'Duller than average',
  },
  {
    id: 'cloud', label: 'Cloudiness', short: 'Cloud',
    daily: 'cloud_cover_mean', agg: 'mean', scale: 1,
    unit: '%', mode: 'diff',
    highLabel: 'Cloudier than average', lowLabel: 'Clearer than average',
  },
  {
    id: 'tmax', label: 'Max temp', short: 'Max',
    daily: 'temperature_2m_max', agg: 'mean', scale: 1,
    unit: '°C', mode: 'diff',
    highLabel: 'Warmer days than average', lowLabel: 'Cooler days than average',
  },
  {
    id: 'tmin', label: 'Min temp', short: 'Min',
    daily: 'temperature_2m_min', agg: 'mean', scale: 1,
    unit: '°C', mode: 'diff',
    highLabel: 'Milder nights than average', lowLabel: 'Colder nights than average',
  },
  {
    // Counted from daily precipitation_sum, using the Met Office definition of
    // a rain day (>= 1 mm). It shares one field with Rainfall, so selecting
    // either fills in both at no extra cost.
    id: 'rainDays', label: 'Rain days', short: 'Rain days',
    daily: null, agg: null, scale: 1,
    unit: 'days', mode: 'diff',
    highLabel: 'More rain days than average', lowLabel: 'Fewer rain days than average',
  },
  {
    // Threshold counting happens CLIENT-SIDE from the retained daily max/min
    // arrays, so changing the temperature or the direction re-renders instantly
    // without spending another request against the daily quota.
    id: 'threshold', label: 'Days above/below', short: 'Threshold',
    daily: null, agg: null, scale: 1,
    unit: 'days', mode: 'count',
    highLabel: '', lowLabel: '',
  },
  {
    id: 'pressure', label: 'Pressure', short: 'Pressure',
    daily: 'pressure_msl_mean', agg: 'mean', scale: 1,
    unit: 'hPa', mode: 'diff',
    highLabel: 'Higher than average', lowLabel: 'Lower than average',
  },
  {
    // Precipitation inside a chosen hour window. The fetch is hourly and so is
    // ~10x the cost of a daily field, which is why it is opt-in: nothing is
    // requested until the user presses Load hourly rain. Once loaded, the month
    // is bucketed by hour-of-day, so changing the window is instant and free.
    id: 'rainHours', label: 'Rain by hour', short: 'Hourly rain',
    daily: null, agg: null, scale: 1,
    unit: 'mm', mode: 'hourly',
    highLabel: '', lowLabel: '',
  },
  {
    id: 'windSpeed', label: 'Wind speed', short: 'Speed',
    daily: 'wind_speed_10m_mean', agg: 'mean', scale: 1,
    unit: 'mph', mode: 'diff',
    highLabel: 'Windier than average', lowLabel: 'Calmer than average',
  },
  {
    // Direction is CIRCULAR, so it is never averaged or interpolated as a
    // scalar: 350 deg and 10 deg average to 180 deg, the exact opposite of the
    // truth. Per-point unit vectors are carried on `wind` instead (see
    // fetchChunk) and the map draws arrows rather than a shaded field.
    id: 'wind', label: 'Wind direction', short: 'Wind',
    daily: 'wind_direction_10m_dominant', agg: null, scale: 1,
    unit: '°', mode: 'direction',
    highLabel: 'Veered from usual', lowLabel: 'Backed from usual',
  },
];
export const VAR_BY_ID = Object.fromEntries(CLIMATE_VARS.map(v => [v.id, v]));

// Daily fields fetched purely to describe the month (not mapped as anomalies).
const SUMMARY_DAILY = ['weather_code', 'wind_direction_10m_dominant'];
// Local time, so daily aggregation lands on UK days rather than UTC days.
const TZ = 'Europe/London';

/* WMO weather codes grouped into the categories a monthly summary should talk
   in. Grouping matters: July 2026 at the UK centroid has code 3 (overcast) as
   the single most common code on 11 days, but the drizzle family (51/53/55)
   spans 15 days — "a drizzly month" is the truer description. */
export const WEATHER_GROUPS = [
  { id: 'clear',    label: 'Clear',         codes: [0] },
  { id: 'fair',     label: 'Mainly clear',  codes: [1] },
  { id: 'partly',   label: 'Partly cloudy', codes: [2] },
  { id: 'overcast', label: 'Overcast',      codes: [3] },
  { id: 'fog',      label: 'Fog',           codes: [45, 48] },
  { id: 'drizzle',  label: 'Drizzle',       codes: [51, 53, 55, 56, 57] },
  { id: 'rain',     label: 'Rain',          codes: [61, 63, 65, 66, 67] },
  { id: 'showers',  label: 'Showers',       codes: [80, 81, 82] },
  { id: 'snow',     label: 'Snow',          codes: [71, 73, 75, 77, 85, 86] },
  { id: 'thunder',  label: 'Thunderstorms', codes: [95, 96, 99] },
];
const CODE_TO_GROUP = (() => {
  const m = {};
  for (const g of WEATHER_GROUPS) for (const c of g.codes) m[c] = g.id;
  return m;
})();
export const GROUP_BY_ID = Object.fromEntries(WEATHER_GROUPS.map(g => [g.id, g]));

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function degToCardinal(deg) {
  return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* ── Grid ─────────────────────────────────────────────────────────────────── */

/**
 * Row/column dimensions of the grid. buildGrid() is defined in terms of this so
 * the point order and the [row, col] indexing used by the map renderer can never
 * drift apart (and so repeated `lat += dLat` float accumulation can't shift a
 * row off by one).
 */
export function gridDims({ bbox = UK_BBOX, dLat = GRID.dLat, dLon = GRID.dLon } = {}) {
  return {
    nLat: Math.floor((bbox.latMax - bbox.latMin) / dLat + 1e-9) + 1,
    nLon: Math.floor((bbox.lonMax - bbox.lonMin) / dLon + 1e-9) + 1,
    lat0: bbox.latMin, lon0: bbox.lonMin, dLat, dLon,
  };
}

/**
 * Regular lon/lat grid covering the UK box, ordered row-major from the SOUTH
 * edge north: index = latIndex * nLon + lonIndex.
 */
export function buildGrid(opts = {}) {
  const { nLat, nLon, lat0, lon0, dLat, dLon } = gridDims(opts);
  const pts = [];
  for (let j = 0; j < nLat; j++) {
    for (let i = 0; i < nLon; i++) {
      pts.push({ lat: +(lat0 + j * dLat).toFixed(4), lon: +(lon0 + i * dLon).toFixed(4) });
    }
  }
  return pts;
}

export function gridSignature({ bbox = UK_BBOX, dLat = GRID.dLat, dLon = GRID.dLon } = {}) {
  return [bbox.lonMin, bbox.lonMax, bbox.latMin, bbox.latMax, dLat, dLon].join('_');
}

/* ── Fetching ─────────────────────────────────────────────────────────────── */

/* Open-Meteo's public ERA5 archive — always. This tool deliberately does NOT
   use the self-hosted node the TCM model reads from: that box is populated by
   the download-* loop, which pulls forecast models rather than ERA5 reanalysis,
   and the climate normals and monthly values must come from one consistent
   source to be comparable. An earlier version probed the self-host first and
   fell back; that only added a failing round-trip per session.

   Consequence worth designing around: the public API enforces a daily request
   quota per IP. Keep fetches on the cheap daily fields, and make any hourly
   variable strictly opt-in (see fetchHourlyRainGrid). */
export const PUBLIC_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

const pad = (n) => String(n).padStart(2, '0');
export function monthBounds(year, month /* 1-12 */) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

/** Roll a daily array up to one monthly figure, ignoring nulls. */
function aggregate(values, agg, scale) {
  if (!Array.isArray(values)) return null;
  let sum = 0, n = 0;
  for (const v of values) { if (v == null || Number.isNaN(v)) continue; sum += v; n++; }
  if (!n) return null;
  return (agg === 'mean' ? sum / n : sum) * scale;
}

/*  ONE VARIABLE PER REQUEST.
    Every load used to ask for the whole daily field list, so choosing Rainfall
    also downloaded temperature, pressure, wind, cloud and the rest. Open-Meteo
    weights a request by locations x variables x days, which made each month
    about nine times dearer than it needed to be and spent the daily quota on
    fields nobody had asked to see.

    A load now requests only what the SELECTED variable needs. `varId` names it
    and FIELDS_FOR covers the variables whose data comes from somewhere other
    than their own `daily` entry. Results merge into the month already held, so
    returning to a variable loaded earlier still costs nothing.                */
const FIELDS_FOR = {
  // Same field answers both, so loading either one fills in the other.
  rain:      ['precipitation_sum'],
  rainDays:  ['precipitation_sum'],
  // Counted client-side from the retained daily series.
  threshold: ['temperature_2m_max', 'temperature_2m_min'],
  // Hourly — fetchHourlyRainGrid handles this one.
  rainHours: [],
};

/** The daily fields one variable needs. Nothing else is ever requested. */
export function dailyFieldsFor(varId) {
  if (FIELDS_FOR[varId]) return FIELDS_FOR[varId];
  const v = VAR_BY_ID[varId];
  return v?.daily ? [v.daily] : [];
}

async function fetchChunk(endpoint, points, start, end, signal, {
  varId = 'rain', includeSummary = false,
} = {}) {
  const lats = points.map(p => p.lat).join(',');
  const lons = points.map(p => p.lon).join(',');

  const dailyFields = [...dailyFieldsFor(varId)];
  if (includeSummary) dailyFields.push(...SUMMARY_DAILY);
  // wind_direction_10m_dominant is both a variable and a summary field, so the
  // two lists overlap; a duplicated parameter makes the API reject the request.
  const uniqueDaily = Array.from(new Set(dailyFields));
  if (!uniqueDaily.length) return points.map(() => ({}));

  const url = `${endpoint}?latitude=${lats}&longitude=${lons}` +
    `&start_date=${start}&end_date=${end}&daily=${uniqueDaily.join(',')}` +
    `&timezone=${encodeURIComponent(TZ)}&wind_speed_unit=mph`;

  const r = await fetchWithRetry(url, signal);
  if (!r.ok) throw await archiveError(r);
  const j = await r.json();
  // One coordinate returns an object; several return an array. Normalise.
  const rows = Array.isArray(j) ? j : [j];

  return rows.map(row => {
    const d = row?.daily || {};
    // Only fields that were actually requested get written. A key left absent
    // (rather than set to null) is what lets a newly fetched variable merge
    // into a month already held without blanking the ones fetched before it.
    const out = {};

    const v = VAR_BY_ID[varId];
    if (v?.daily && v.mode !== 'direction') {
      out[varId] = aggregate(d[v.daily], v.agg, v.scale);
    }

    // Rain days: the Met Office counts a day with at least 1 mm of
    // precipitation. Free whenever precipitation_sum was fetched.
    if (Array.isArray(d.precipitation_sum)) {
      out.rainDays = d.precipitation_sum
        .reduce((n, x) => n + (x != null && x >= 1 ? 1 : 0), 0);
    }

    // Keep the daily max/min series so the threshold count can be recomputed
    // client-side for any temperature the user picks, with no refetch.
    if (varId === 'threshold') {
      out.tmaxDaily = Array.isArray(d.temperature_2m_max) ? d.temperature_2m_max : null;
      out.tminDaily = Array.isArray(d.temperature_2m_min) ? d.temperature_2m_min : null;
    }

    if (includeSummary) {
      // Weather-code tally, kept per point so points can be merged later.
      const codes = {};
      for (const c of (d.weather_code || [])) {
        if (c == null) continue;
        const g = CODE_TO_GROUP[c];
        if (g) codes[g] = (codes[g] || 0) + 1;
      }
      out.codes = codes;

      // Wind direction as SUMMED UNIT VECTORS, never as an averaged angle.
      // Direction is circular: the arithmetic mean of 350 deg and 10 deg is 180
      // deg, the exact opposite of the truth. Carrying the vector components
      // lets grid points combine correctly too. (On the reference month the
      // circular mean is 269 deg / W; the arithmetic mean would say 211 deg /
      // SSW - a 58 deg error.)
      let sx = 0, sy = 0, n = 0;
      for (const deg of (d.wind_direction_10m_dominant || [])) {
        if (deg == null) continue;
        const rad = deg * Math.PI / 180;
        sx += Math.sin(rad); sy += Math.cos(rad); n++;
      }
      // Per-point circular mean, so the map can draw one arrow per grid point.
      out.wind = n ? { sx, sy, n } : null;
      if (n) {
        const mx = sx / n, my = sy / n;
        out.windDeg = ((Math.atan2(mx, my) * 180 / Math.PI) + 360) % 360;
        out.windSteadiness = Math.hypot(mx, my);
      }
    }
    return out;
  });
}

/** Run tasks with a small concurrency cap, reporting completions as they land. */
async function pool(tasks, limit, onDone) {
  const results = new Array(tasks.length);
  let next = 0, done = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      done++;
      onDone?.(done, tasks.length);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * One variable's monthly value at every grid point, for one year+month.
 *
 * Returns { values: [{<varId>: number}|null], vars: string[], source }. `vars`
 * records which variables this payload actually carries so the caller can tell
 * "not loaded yet" apart from "loaded and genuinely empty".
 */
export async function fetchMonthGrid({
  year, month, points, varId = 'rain', onProgress, signal,
  includeSummary = true,
} = {}) {
  const { start, end } = monthBounds(year, month);
  const chunks = [];
  for (let i = 0; i < points.length; i += CHUNK) chunks.push(points.slice(i, i + CHUNK));

  const opts = { varId, includeSummary };
  const parts = await pool(
    chunks.map(c => () => fetchChunk(PUBLIC_ARCHIVE, c, start, end, signal, opts)),
    CONCURRENCY, onProgress,
  );
  return { values: parts.flat(), vars: varsCoveredBy(varId), source: 'open-meteo' };
}

/** Variables a single fetch of `varId` populates — some share one daily field. */
export function varsCoveredBy(varId) {
  if (varId === 'rain' || varId === 'rainDays') return ['rain', 'rainDays'];
  if (varId === 'threshold') return ['threshold'];
  return [varId];
}

/**
 * Hourly precipitation for a month, bucketed by HOUR OF DAY per grid point.
 *
 * Returns one 24-element array per point: index h holds the month's total
 * precipitation that fell during hour h. Any window the user picks is then just
 * a sum over a slice — so this is fetched once and every window after that is
 * free. That matters because hourly is roughly ten times the payload of a daily
 * field, and the public API enforces a daily request quota.
 */
export async function fetchHourlyRainGrid({ year, month, points, onProgress, signal } = {}) {
  const { start, end } = monthBounds(year, month);
  const chunks = [];
  for (let i = 0; i < points.length; i += CHUNK) chunks.push(points.slice(i, i + CHUNK));

  const one = async (c) => {
    const url = `${PUBLIC_ARCHIVE}?latitude=${c.map(p => p.lat).join(',')}` +
      `&longitude=${c.map(p => p.lon).join(',')}` +
      `&start_date=${start}&end_date=${end}&hourly=precipitation` +
      `&timezone=${encodeURIComponent(TZ)}`;
    const r = await fetchWithRetry(url, signal);
    if (!r.ok) throw await archiveError(r);
    const j = await r.json();
    return (Array.isArray(j) ? j : [j]).map(row => {
      const t = row?.hourly?.time, v = row?.hourly?.precipitation;
      if (!Array.isArray(t) || !Array.isArray(v)) return null;
      const buckets = new Array(24).fill(0);
      for (let i = 0; i < t.length; i++) {
        if (v[i] == null) continue;
        // Local-time ISO string, so characters 11-12 are the local hour.
        const h = Number(t[i].slice(11, 13));
        if (h >= 0 && h < 24) buckets[h] += v[i];
      }
      return buckets;
    });
  };

  const parts = await pool(chunks.map(c => () => one(c)), CONCURRENCY, onProgress);
  return parts.flat();
}

/* ── Saved months ─────────────────────────────────────────────────────
   Anything fetched is kept, so it can be revisited without spending another
   request. That matters more here than usual: the public API has a daily quota
   and no fallback, so re-fetching something already paid for is pure waste.

   A load now covers ONE variable, so a stored month accumulates: each fetch is
   merged into whatever that month already holds (see mergeMonthPayload) and the
   payload's `vars` list records what is in there.

   Stored per grid signature — a grid change makes old payloads meaningless, so
   they simply stop matching rather than being drawn against the wrong points.
   Oldest entries are evicted when the browser refuses a write, which is how
   localStorage reports being full.                                            */

const STORE_PREFIX = 'climo_month_v2_';
const INDEX_KEY = 'climo_month_index_v2';

const monthKey = (gridSig, year, month) => `${STORE_PREFIX}${gridSig}_${year}_${month}`;

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; } catch { return []; }
}
function writeIndex(list) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch { /* full */ }
}

/** Months already fetched for this grid, newest first. */
export function savedMonths(gridSig) {
  return readIndex()
    .filter(e => e.gridSig === gridSig)
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

export function loadSavedMonth(gridSig, year, month) {
  try {
    const raw = localStorage.getItem(monthKey(gridSig, year, month));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return Array.isArray(p?.values) ? p : null;
  } catch { return null; }
}

/**
 * Fold a freshly fetched variable into the month already stored.
 *
 * Per grid point the two records merge key by key, so loading Sunshine after
 * Rainfall leaves both in place. fetchChunk only writes keys it actually
 * requested, which is what makes this safe — an absent key means "not fetched",
 * never "fetched and empty".
 */
export function mergeMonthPayload(prev, next) {
  if (!prev?.values?.length) return next;
  if (!next?.values?.length) return prev;
  const values = next.values.map((n, i) => {
    const p = prev.values[i];
    if (!p) return n;
    if (!n) return p;
    return { ...p, ...n };
  });
  return {
    ...prev, ...next, values,
    vars: Array.from(new Set([...(prev.vars || []), ...(next.vars || [])])),
  };
}

/** Persist a fetched month, evicting the oldest entries if storage is full. */
export function saveMonth(gridSig, year, month, payload) {
  const key = monthKey(gridSig, year, month);
  const body = JSON.stringify({ ...payload, savedAt: Date.now() });
  let index = readIndex().filter(e => !(e.gridSig === gridSig && e.year === year && e.month === month));
  index.push({ gridSig, year, month, savedAt: Date.now() });

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      localStorage.setItem(key, body);
      writeIndex(index);
      return true;
    } catch {
      // Full: drop the oldest stored month and try again.
      const others = index.filter(e => !(e.gridSig === gridSig && e.year === year && e.month === month))
        .sort((a, b) => a.savedAt - b.savedAt);
      if (!others.length) return false;
      const victim = others[0];
      try { localStorage.removeItem(monthKey(victim.gridSig, victim.year, victim.month)); } catch { /* noop */ }
      index = index.filter(e => e !== victim);
    }
  }
  return false;
}

export function deleteSavedMonth(gridSig, year, month) {
  try { localStorage.removeItem(monthKey(gridSig, year, month)); } catch { /* noop */ }
  writeIndex(readIndex().filter(e => !(e.gridSig === gridSig && e.year === year && e.month === month)));
}

/* ── Forecast ───────────────────────────────────────────────────────────
   A different endpoint from the archive: /v1/forecast, which serves today
   forwards rather than the reanalysis. Everything downstream is shared — same
   grid, same projection, same colour pipeline — only the source and the
   reference normal differ (a single day compares against dayNormal(), not the
   monthly figure).                                                            */
export const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
export const FORECAST_DAYS = 16;

/**
 * The whole forecast window for every point, for ONE variable, in one pass.
 *
 * Returns { dates: ['YYYY-MM-DD', ...], values: [ perPoint[] ] } where each
 * point holds one record per forecast day. Fetching the full window rather than
 * a single day means switching day is instant and costs nothing further — the
 * same reasoning as the hour buckets, and it matters for the same reason (the
 * public API enforces a daily request quota). Restricting it to the selected
 * variable is the same economy the monthly path makes, for the same reason.
 */
export async function fetchForecastGrid({ points, varId = 'rain', onProgress, signal } = {}) {
  const chunks = [];
  for (let i = 0; i < points.length; i += CHUNK) chunks.push(points.slice(i, i + CHUNK));

  const fields = Array.from(new Set(dailyFieldsFor(varId)));
  if (!fields.length) return { dates: [], values: [] };
  const varDef = VAR_BY_ID[varId];

  let dates = null;
  const one = async (c) => {
    const url = `${FORECAST_API}?latitude=${c.map(p => p.lat).join(',')}` +
      `&longitude=${c.map(p => p.lon).join(',')}` +
      `&daily=${fields.join(',')}&forecast_days=${FORECAST_DAYS}` +
      `&timezone=${encodeURIComponent(TZ)}&wind_speed_unit=mph`;
    const r = await fetchWithRetry(url, signal);
    if (!r.ok) throw await archiveError(r, 'forecast');
    const j = await r.json();
    return (Array.isArray(j) ? j : [j]).map(row => {
      const d = row?.daily;
      if (!d?.time) return null;
      if (!dates) dates = d.time;
      return d.time.map((_, k) => {
        const rec = {};
        if (varDef?.daily) {
          const raw = d[varDef.daily]?.[k];
          rec[varId] = raw == null ? null : raw * (varDef.scale ?? 1);
        }
        // Rain days come free with precipitation_sum, same as the monthly path,
        // but a forecast DAY is a single day — counting rain days over it is
        // meaningless, so only the total is carried.
        return rec;
      });
    });
  };

  const parts = await pool(chunks.map(c => () => one(c)), CONCURRENCY, onProgress);
  const values = parts.flat();
  const allDates = dates || [];

  /* Trim days with no usable data. The final day of the window comes back with
     null daily aggregates — the run does not cover a complete local day, so the
     daily roll-up has nothing to average. Left in, that day would offer itself
     in the picker and then render a blank map with no explanation. Verified
     against a live 16-day request: days 1-15 populated, day 16 entirely null. */
  const usable = allDates.map((_, k) =>
    values.some(pt => pt?.[k] && pt[k][varId] != null));
  let last = usable.length - 1;
  while (last >= 0 && !usable[last]) last--;

  return {
    dates: allDates.slice(0, last + 1),
    values: values.map(pt => (pt ? pt.slice(0, last + 1) : null)),
  };
}

/* ── Anomaly + colour ──────────────────────────────────────────────────────── */



/* ── Departure scales ───────────────────────────────────────────────────
   How far the month sat from the monthly average: percent for rainfall and
   sunshine (0% = average, -100% = nothing fell at all), and native units for
   temperature, cloud and pressure.

   Control points, not bands. Colour is interpolated continuously between them
   so the field reads as a smooth wash rather than stepped contour blocks.

   NOTE ON REFERENCE: the comparison is against the UK-wide monthly average,
   because that is the only baseline held (per-grid-point normals would need the
   30-year fetch that was removed). So a permanently wet place like the western
   Highlands sits positive even in a dry month — the map answers "how did this
   spot compare with a normal UK month", not "how did this spot compare with its
   own normal". */
const DEP_SCALES = {
  rain: {
    pts: [[-100, '#8c510a'], [-60, '#bf812d'], [-30, '#dfc27d'], [-10, '#f6e8c3'],
          [0, '#f7f7f7'], [15, '#c7eae5'], [40, '#80cdc1'], [90, '#35978f'], [180, '#01665e']],
    ticks: ['-100%', '-50%', '0%', '+50%', '+180%'], label: '% difference from average rainfall',
  },
  sun: {
    pts: [[-60, '#374151'], [-35, '#6b7280'], [-15, '#d1d5db'], [0, '#f7f7f7'],
          [15, '#fde68a'], [35, '#fbbf24'], [60, '#d97706']],
    ticks: ['-60%', '-30%', '0%', '+30%', '+60%'], label: '% difference from average sunshine',
  },
  temp: {
    pts: [[-4, '#2166ac'], [-2.5, '#4393c3'], [-1, '#92c5de'], [-0.3, '#d1e5f0'],
          [0, '#f7f7f7'], [0.3, '#fddbc7'], [1, '#f4a582'], [2.5, '#d6604d'], [4, '#b2182b']],
    ticks: ['-4°C', '-2°C', '0°C', '+2°C', '+4°C'], label: '°C difference from average',
  },
  cloud: {
    pts: [[-20, '#d97706'], [-10, '#fbbf24'], [-3, '#fde68a'], [0, '#f7f7f7'],
          [3, '#dbeafe'], [10, '#93c5fd'], [20, '#2563eb']],
    ticks: ['-20pp', '-10pp', '0', '+10pp', '+20pp'], label: 'cloud cover vs average',
  },
  pressure: {
    pts: [[-10, '#4338ca'], [-5, '#6366f1'], [-1.5, '#c7d2fe'], [0, '#f5f5f5'],
          [1.5, '#fecaca'], [5, '#ef4444'], [10, '#991b1b']],
    ticks: ['-10hPa', '-5', '0', '+5', '+10hPa'], label: 'hPa difference from average',
  },
  tmax: {
    pts: [[-4, '#2166ac'], [-2.5, '#4393c3'], [-1, '#92c5de'], [-0.3, '#d1e5f0'],
          [0, '#f7f7f7'], [0.3, '#fddbc7'], [1, '#f4a582'], [2.5, '#d6604d'], [4, '#b2182b']],
    ticks: ['-4°C', '-2°C', '0°C', '+2°C', '+4°C'], label: '°C difference from average daily max',
  },
  tmin: {
    pts: [[-4, '#2166ac'], [-2.5, '#4393c3'], [-1, '#92c5de'], [-0.3, '#d1e5f0'],
          [0, '#f7f7f7'], [0.3, '#fddbc7'], [1, '#f4a582'], [2.5, '#d6604d'], [4, '#b2182b']],
    ticks: ['-4°C', '-2°C', '0°C', '+2°C', '+4°C'], label: '°C difference from average daily min',
  },
  rainDays: {
    pts: [[-10, '#8c510a'], [-6, '#bf812d'], [-2, '#f6e8c3'], [0, '#f7f7f7'],
          [2, '#c7eae5'], [6, '#35978f'], [10, '#01665e']],
    ticks: ['-10', '-5', '0', '+5', '+10 days'], label: 'rain days vs average',
  },
  windSpeed: {
    pts: [[-4, '#1e3a8a'], [-2, '#60a5fa'], [-0.6, '#dbeafe'], [0, '#f7f7f7'],
          [0.6, '#fed7aa'], [2, '#fb923c'], [4, '#c2410c']],
    ticks: ['-4mph', '-2', '0', '+2', '+4mph'], label: 'mph difference from average',
  },
  // Absolute total for the chosen hours. No published normal exists for
  // "rain between 12:00 and 18:00", so this shades the raw millimetres.
  rainHours: {
    pts: [[0, '#f8fafc'], [2, '#e0f2fe'], [6, '#7dd3fc'], [15, '#0ea5e9'],
          [30, '#0369a1'], [60, '#075985'], [120, '#082f49']],
    ticks: ['0', '2', '6', '15', '30', '60', '120mm'], label: 'mm in the selected hours',
  },
  // Absolute count, not a departure — no published normal exists for an
  // arbitrary threshold, so this shades the raw number of days.
  threshold: {
    pts: [[0, '#f8fafc'], [2, '#e0f2fe'], [5, '#bae6fd'], [10, '#38bdf8'],
          [16, '#0284c7'], [24, '#075985'], [31, '#0c2d48']],
    ticks: ['0', '5', '10', '16', '24', '31 days'], label: 'days meeting the threshold',
  },
};

export function depScaleFor(varId) { return DEP_SCALES[varId] || DEP_SCALES.rain; }

/** Continuous colour for a departure value — linear blend between control points. */
export function depColorRgb(pts, x) {
  if (x <= pts[0][0]) return hexToRgb(pts[0][1]);
  const last = pts[pts.length - 1];
  if (x >= last[0]) return hexToRgb(last[1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [v0, c0] = pts[i], [v1, c1] = pts[i + 1];
    if (x >= v0 && x <= v1) {
      const t = v1 === v0 ? 0 : (x - v0) / (v1 - v0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return hexToRgb(last[1]);
}

/** CSS gradient for the legend, using the same control points as the map. */
export function depGradientCss(pts) {
  const lo = pts[0][0], hi = pts[pts.length - 1][0], span = hi - lo || 1;
  return `linear-gradient(90deg, ${pts.map(([v, c]) => `${c} ${(100 * (v - lo) / span).toFixed(1)}%`).join(', ')})`;
}



const _rgbCache = new Map();
export function hexToRgb(hex) {
  let c = _rgbCache.get(hex);
  if (!c) {
    c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    _rgbCache.set(hex, c);
  }
  return c;
}







export function formatValue(varDef, v) {
  if (v == null) return '—';
  const dp = varDef.id === 'temp' ? 1 : varDef.id === 'rain' ? 1 : 0;
  return `${v.toFixed(dp)} ${varDef.unit}`;
}

/**
 * Most common weather category across the whole area for the month, merging
 * every grid point's per-category day tally.
 */
export function dominantWeather(values, mask = null) {
  const tally = {};
  let total = 0;
  (values || []).forEach((v, i) => {
    if (mask && !mask[i]) return;
    if (!v?.codes) return;
    for (const [g, n] of Object.entries(v.codes)) { tally[g] = (tally[g] || 0) + n; total += n; }
  });
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  return {
    id: best[0],
    label: GROUP_BY_ID[best[0]]?.label || best[0],
    share: total ? best[1] / total : 0,
  };
}

/**
 * Dominant wind direction for the month, as a proper circular (vector) mean of
 * every grid point's daily dominant directions. `steadiness` is the resultant
 * length: 1 = every day from the same quarter, near 0 = no prevailing direction.
 */
export function dominantWind(values, mask = null) {
  let sx = 0, sy = 0, n = 0;
  (values || []).forEach((v, i) => {
    if (mask && !mask[i]) return;
    if (!v?.wind) return;
    sx += v.wind.sx; sy += v.wind.sy; n += v.wind.n;
  });
  if (!n) return null;
  const mx = sx / n, my = sy / n;
  const deg = ((Math.atan2(mx, my) * 180 / Math.PI) + 360) % 360;
  return { deg, cardinal: degToCardinal(deg), steadiness: Math.hypot(mx, my) };
}

/**
 * Area-average of a field across grid points, ignoring gaps.
 *
 * `mask` restricts the average to LAND points and should almost always be
 * supplied. The grid spans the whole bounding box so the interpolated map stays
 * continuous up to the coast, but that means only 104 of its 336 points are
 * land — averaging all of them is really averaging 69% ocean. Measured on July
 * 2026 that pulled the area-mean temperature from 17.1 C down to 15.9 C, which
 * would also have made the on-graphic figure incomparable with the Met Office
 * UK normal printed beside it. (The anomaly itself is far less affected, since
 * month and baseline are diluted alike and the bias largely cancels.)
 */
export function areaMean(values, varId, mask = null) {
  let sum = 0, n = 0;
  (values || []).forEach((v, i) => {
    if (mask && !mask[i]) return;
    const x = v?.[varId];
    if (x == null || Number.isNaN(x)) return;
    sum += x; n++;
  });
  return n ? sum / n : null;
}
