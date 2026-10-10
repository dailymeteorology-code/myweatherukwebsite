/* UK grid sampling of the Open-Meteo UKMO 10 km run.

   The page shows a MAP, so the model has to be sampled across the whole country
   rather than at one point. Open-Meteo accepts a comma-separated list of
   coordinates in a single request and answers with one object per location, so
   the whole grid is one call — a request per cell would be hundreds of calls and
   would be rate-limited immediately.

   Grid spacing is a compromise: fine enough to read as a field, coarse enough
   that the URL stays sane and the response is a few hundred KB rather than tens
   of megabytes. */
import { MODEL_ID, MODEL_LABEL } from '@/lib/openMeteoModel';
import { base44 } from '@/api/base44Client';

export { MODEL_LABEL };

export const GRID_BBOX = { lonMin: -11.0, lonMax: 2.2, latMin: 49.6, latMax: 60.9 };
/* Spacing is also a QUOTA decision, not just a visual one. Open-Meteo charges a
   request by locations x variables x days, and a fine grid over three days was
   enough to earn a 429 after a couple of variable switches. This spacing, two
   days, and the cache below keep the page usable. */
const LON_STEP = 1.0;
const LAT_STEP = 0.65;

export const GRID = (() => {
  const pts = [];
  for (let lat = GRID_BBOX.latMin; lat <= GRID_BBOX.latMax + 1e-9; lat += LAT_STEP) {
    for (let lon = GRID_BBOX.lonMin; lon <= GRID_BBOX.lonMax + 1e-9; lon += LON_STEP) {
      pts.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
    }
  }
  return pts;
})();
export const GRID_LON_STEP = LON_STEP;
export const GRID_LAT_STEP = LAT_STEP;

/* Which fields can be drawn as a map. A direction or a weather code is a
   category rather than a magnitude, so those are not offered here — shading them
   on a colour ramp would invent a scale that does not exist. */
export const MAP_VARIABLES = [
  { key: 'temperature_2m', label: 'Temperature 2m', unit: '°C', dp: 1,
    stops: [[-10, '#4c1d95'], [0, '#3b82f6'], [5, '#22d3ee'], [10, '#4ade80'], [15, '#fde047'], [20, '#fb923c'], [25, '#ef4444'], [32, '#7f1d1d']] },
  { key: 'dew_point_2m', label: 'Dew point 2m', unit: '°C', dp: 1,
    stops: [[-10, '#4c1d95'], [0, '#3b82f6'], [5, '#22d3ee'], [10, '#4ade80'], [14, '#fde047'], [18, '#fb923c'], [22, '#ef4444']] },
  /* `floor` marks a field where "nothing" is a real answer. Without it, an
     interpolated trace of 0.01 mm still picked up the first colour at full
     strength, so a couple of showers washed the entire country pale blue. */
  { key: 'precipitation', label: 'Precipitation', unit: 'mm/h', dp: 1, floor: 0.08,
    stops: [[0.08, '#bae6fd'], [0.5, '#38bdf8'], [1, '#2563eb'], [2, '#7c3aed'], [4, '#db2777'], [8, '#f87171']] },
  { key: 'snowfall', label: 'Snowfall', unit: 'cm/h', dp: 1, floor: 0.05,
    stops: [[0.05, '#e0f2fe'], [0.5, '#a5b4fc'], [1, '#818cf8'], [2, '#6d28d9'], [4, '#db2777']] },
  { key: 'cloud_cover', label: 'Cloud cover', unit: '%', dp: 0,
    stops: [[0, '#0ea5e9'], [25, '#7dd3fc'], [50, '#cbd5e1'], [75, '#94a3b8'], [100, '#475569']] },
  { key: 'wind_speed_10m', label: 'Wind 10m', unit: 'mph', dp: 0,
    stops: [[0, '#0f766e'], [10, '#22d3ee'], [20, '#4ade80'], [30, '#fde047'], [40, '#fb923c'], [55, '#ef4444'], [75, '#7f1d1d']] },
  { key: 'wind_gusts_10m', label: 'Gusts 10m', unit: 'mph', dp: 0,
    stops: [[0, '#0f766e'], [15, '#22d3ee'], [30, '#4ade80'], [45, '#fde047'], [60, '#fb923c'], [80, '#ef4444'], [100, '#7f1d1d']] },
  { key: 'pressure_msl', label: 'MSLP', unit: 'hPa', dp: 0,
    stops: [[960, '#7c3aed'], [980, '#3b82f6'], [1000, '#22d3ee'], [1013, '#4ade80'], [1025, '#fde047'], [1040, '#fb923c']] },
  { key: 'cape', label: 'CAPE', unit: 'J/kg', dp: 0, floor: 40,
    stops: [[40, '#bae6fd'], [100, '#7dd3fc'], [300, '#4ade80'], [600, '#fde047'], [1000, '#fb923c'], [1800, '#ef4444'], [3000, '#7f1d1d']] },
  { key: 'visibility', label: 'Visibility', unit: 'm', dp: 0,
    stops: [[0, '#7f1d1d'], [1000, '#ef4444'], [4000, '#fb923c'], [10000, '#fde047'], [25000, '#4ade80'], [50000, '#22d3ee']] },

  /* Fields below are offered by the higher-resolution and ECMWF runs. */
  { key: 'rain', label: 'Rain', unit: 'mm/h', dp: 1, floor: 0.08,
    stops: [[0.08, '#bae6fd'], [0.5, '#38bdf8'], [1, '#2563eb'], [2, '#7c3aed'], [4, '#db2777'], [8, '#f87171']] },
  { key: 'showers', label: 'Showers', unit: 'mm/h', dp: 1, floor: 0.08,
    stops: [[0.08, '#bae6fd'], [0.5, '#38bdf8'], [1, '#2563eb'], [2, '#7c3aed'], [4, '#db2777'], [8, '#f87171']] },
  { key: 'hail', label: 'Hail', unit: 'mm/h', dp: 2, floor: 0.02,
    stops: [[0.02, '#e0f2fe'], [0.2, '#a5b4fc'], [0.6, '#818cf8'], [1.5, '#6d28d9'], [3, '#db2777']] },
  { key: 'surface_pressure', label: 'Surface pressure', unit: 'hPa', dp: 0,
    stops: [[940, '#7c3aed'], [970, '#3b82f6'], [995, '#22d3ee'], [1010, '#4ade80'], [1025, '#fde047'], [1040, '#fb923c']] },
  { key: 'cloud_cover_low', label: 'Low cloud', unit: '%', dp: 0,
    stops: [[0, '#0ea5e9'], [25, '#7dd3fc'], [50, '#cbd5e1'], [75, '#94a3b8'], [100, '#475569']] },
  { key: 'cloud_cover_mid', label: 'Mid cloud', unit: '%', dp: 0,
    stops: [[0, '#0ea5e9'], [25, '#7dd3fc'], [50, '#cbd5e1'], [75, '#94a3b8'], [100, '#475569']] },
  { key: 'cloud_cover_high', label: 'High cloud', unit: '%', dp: 0,
    stops: [[0, '#0ea5e9'], [25, '#7dd3fc'], [50, '#cbd5e1'], [75, '#94a3b8'], [100, '#475569']] },
  { key: 'cloud_cover_2m', label: 'Cloud 2m', unit: '%', dp: 0,
    stops: [[0, '#0ea5e9'], [25, '#7dd3fc'], [50, '#cbd5e1'], [75, '#94a3b8'], [100, '#475569']] },
  /* CIN is reported as a negative number (or zero). Drawn on magnitude, so the
     ramp runs from "no cap" to "strongly capped". */
  { key: 'convective_inhibition', label: 'CIN', unit: 'J/kg', dp: 0,
    stops: [[-400, '#7f1d1d'], [-200, '#ef4444'], [-100, '#fb923c'], [-50, '#fde047'], [-10, '#4ade80'], [0, '#22d3ee']] },
  { key: 'lightning_density', label: 'Lightning', unit: '1/km²', dp: 2, floor: 0.01,
    stops: [[0.01, '#fef9c3'], [0.1, '#fde047'], [0.5, '#fb923c'], [1.5, '#ef4444'], [4, '#7f1d1d']] },
];

const VAR_BY_KEY = Object.fromEntries(MAP_VARIABLES.map(v => [v.key, v]));

/* The three runs on offer. Each names the fields it can actually draw and how
   far ahead it goes, so the picker only ever offers real combinations. */
export const MODELS = [
  {
    id: 'ukmo_global_deterministic_10km', label: 'UKMO Global 10 km', short: 'Global 10 km', days: 2,
    variableKeys: ['temperature_2m', 'dew_point_2m', 'precipitation', 'snowfall', 'cloud_cover',
      'wind_speed_10m', 'wind_gusts_10m', 'pressure_msl', 'cape', 'visibility'],
  },
  {
    id: 'ukmo_uk_deterministic_2km', label: 'UKMO UKV 2 km', short: 'UKV 2 km', days: 5,
    variableKeys: ['temperature_2m', 'dew_point_2m', 'precipitation', 'rain', 'showers', 'snowfall',
      'hail', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'cloud_cover_2m',
      'wind_speed_10m', 'wind_gusts_10m', 'pressure_msl', 'surface_pressure', 'cape',
      'convective_inhibition', 'visibility'],
  },
  {
    id: 'ecmwf_ifs025', label: 'ECMWF IFS 0.25°', short: 'ECMWF', days: 10,
    variableKeys: ['temperature_2m', 'dew_point_2m', 'precipitation', 'rain', 'showers', 'snowfall',
      'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
      'wind_speed_10m', 'wind_gusts_10m', 'pressure_msl', 'surface_pressure',
      'convective_inhibition', 'lightning_density', 'visibility'],
  },
];

/** The drawable fields for one model, in display order. */
export function variablesFor(model) {
  return model.variableKeys.map(k => VAR_BY_KEY[k]).filter(Boolean);
}

function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** Colour for a value on a variable's ramp. Returns null where nothing is drawn. */
export function colourFor(value, variable) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  // Below the floor there is nothing to draw at all (dry air, no snow, no CAPE).
  if (variable.floor != null && value < variable.floor) return null;
  const stops = variable.stops;
  if (value <= stops[0][0]) return stops[0][1] === 'transparent' ? null : stops[0][1];
  const last = stops[stops.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i], [v1, c1] = stops[i + 1];
    if (value >= v0 && value <= v1) {
      // A "transparent" low stop means "nothing here" rather than a colour to
      // blend from, so the next colour simply fades in from clear.
      const t = (value - v0) / (v1 - v0 || 1);
      if (c0 === 'transparent') return t < 0.02 ? null : c1;
      const a = hex2rgb(c0), b = hex2rgb(c1);
      return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
    }
  }
  return last[1];
}

/**
 * One request, every grid point, one variable.
 * Resolves to { times: string[], values: number[][] } where values[pointIndex]
 * is that point's series — aligned to GRID.
 */
const gridCache = new Map();   // variableKey_days_run -> { times, values }

/* Which model cycle we should be looking at. UKMO deterministic runs every six
   hours and lands on Open-Meteo a few hours later, so the newest cycle that can
   realistically be available is the 6-hourly slot ~5h back. Two page loads in
   the same cycle share one saved run instead of re-billing the API. */
export function currentRunKey(now = new Date()) {
  const t = new Date(now.getTime() - 5 * 3600 * 1000);
  const h = Math.floor(t.getUTCHours() / 6) * 6;
  return `${t.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}Z`;
}

export async function fetchModelGrid({ variableKey, days = 2, modelId = MODEL_ID }) {
  const runKey = currentRunKey();
  const cacheKey = `${modelId}_${variableKey}_${days}_${runKey}`;
  if (gridCache.has(cacheKey)) return gridCache.get(cacheKey);

  // Saved run first — if this cycle is already in the database, the data has not
  // changed and Open-Meteo must not be called again.
  const saved = await base44.entities.ModelRunCache
    .filter({ variable_key: variableKey, run_key: runKey, days, model: modelId }).catch(() => []);
  if (saved?.[0]?.data_url && saved[0].times?.length) {
    const rec = saved[0];
    const values = await fetch(rec.data_url).then(r => r.ok ? r.json() : null).catch(() => null);
    if (values) {
      const out = { times: rec.times, values, source: 'saved', runKey };
      gridCache.set(cacheKey, out);
      return out;
    }
  }

  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${GRID.map(p => p.lat).join(',')}`
    + `&longitude=${GRID.map(p => p.lon).join(',')}`
    + `&hourly=${variableKey}`
    + `&models=${modelId}`
    + '&timezone=Europe%2FLondon'
    + `&forecast_days=${days}`
    + '&wind_speed_unit=mph';

  const res = await fetch(url);
  if (!res.ok) {
    /* Live data is unavailable — an older saved run is far better than an error
       page, so fall back to the newest one on file for this variable. */
    const prev = await loadNewestSaved(variableKey, modelId).catch(() => null);
    if (prev) { gridCache.set(cacheKey, prev); return prev; }
    if (res.status === 429) throw new Error('the free Open-Meteo request allowance has been reached — try again in a few minutes.');
    throw new Error(`Open-Meteo returned ${res.status}`);
  }
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  const times = list[0]?.hourly?.time;
  if (!times?.length) throw new Error('No hourly data returned for the grid.');
  const values = list.map(l => (l.hourly?.[variableKey] || []).map(v =>
    v === null || v === undefined ? null : Math.round(v * 100) / 100));
  const out = { times, values, source: 'live', runKey };
  // Switching back to a variable already fetched must not spend another
  // request — that is what earned the rate limit.
  gridCache.set(cacheKey, out);
  saveRun({ variableKey, runKey, days, times, values, modelId });
  return out;
}

async function loadNewestSaved(variableKey, modelId) {
  const list = await base44.entities.ModelRunCache.filter({ variable_key: variableKey, model: modelId }, '-fetched_at', 1);
  const rec = list?.[0];
  if (!rec?.data_url || !rec.times?.length) return null;
  const values = await fetch(rec.data_url).then(r => r.ok ? r.json() : null);
  return values ? { times: rec.times, values, source: 'saved', runKey: rec.run_key } : null;
}

/* Persist the run so later visits (and later variable switches) read it back out
   of the database. Older cycles for the same variable are dropped — only the
   current run is ever needed. */
async function saveRun({ variableKey, runKey, days, times, values, modelId = MODEL_ID }) {
  try {
    // The grid is far bigger than an entity field allows, so it goes to storage
    // and the record keeps the link.
    const file = new File([JSON.stringify(values)], `${modelId}_${variableKey}_${runKey}.json`, { type: 'application/json' });
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await base44.entities.ModelRunCache.create({
      variable_key: variableKey, run_key: runKey, model: modelId, days,
      times, data_url: file_url, fetched_at: new Date().toISOString(),
    });
    const stale = await base44.entities.ModelRunCache.filter({ variable_key: variableKey, model: modelId });
    await Promise.all(stale.filter(r => r.run_key !== runKey)
      .map(r => base44.entities.ModelRunCache.delete(r.id).catch(() => {})));
  } catch { /* caching is an optimisation — a failure must not break the map */ }
}