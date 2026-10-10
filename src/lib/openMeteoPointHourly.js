// ── Open-Meteo Point Hourly Fetcher ───────────────────────────────────────────
// Fetches real hourly atmospheric data for a SINGLE lat/lon point.
// Used by:
//   • SkewT sounding (vertical profile derived from ensemble means)
//   • DiurnalTimingSection (real per-hour CAPE/shear through the day)
//   • LocationPanel deep-dive (when the user clicks the outlook map)
//
// Single endpoint: ensemble-api.open-meteo.com — matching the canonical TCM
// data link exactly. The previous api.open-meteo.com primary has been removed.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://ensemble-api.open-meteo.com/v1/ensemble';

// 5 models — identical to openMeteoTCM.js canonical URL.
const MODELS = [
  'ncep_gefs05_ensemble_mean',
  'ecmwf_aifs025_ensemble_mean',
  'ecmwf_ifs025_ensemble_mean',
  'ukmo_uk_ensemble_mean_2km',
  'ukmo_global_ensemble_mean_20km',
].join(',');

// Hourly variables — identical order to canonical URL.
const HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'pressure_msl',
  'surface_pressure',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'visibility',
  'wind_speed_10m',
  'wind_speed_80m',
  'wind_direction_80m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'surface_temperature',
  'cape',
  'convective_inhibition',
  'freezing_level_height',
].join(',');

const DAILY_VARS = [
  'precipitation_sum',
  'cape_mean',
  'cape_max',
].join(',');

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

/**
 * Fetch real hourly Open-Meteo data for one point.
 * Returns { hourly: {...arrays}, daily: {...arrays}, pressure: [] } or null.
 */
export async function fetchPointHourly({ lat, lon, run, forecastDays = 4 }) {
  const key = `${lat.toFixed(2)}_${lon.toFixed(2)}_${run?.toISOString?.()?.slice(0, 13) ?? ''}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const params = new URLSearchParams({
    latitude:        String(lat),
    longitude:       String(lon),
    hourly:          HOURLY_VARS,
    daily:           DAILY_VARS,
    models:          MODELS,
    timezone:        'Europe/London',
    wind_speed_unit: 'mph',
    forecast_days:   String(forecastDays),
  });

  const ctl   = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.hourly?.time?.length) throw new Error('Empty hourly payload');
    const flat = collapseEnsembleHourly(json.hourly);
    const data = { hourly: flat, daily: json.daily ?? null, pressure: [], source: 'ensemble' };
    cache.set(key, { ts: Date.now(), data });
    return data;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[fetchPointHourly] ensemble fetch failed:', e?.message);
    return null;
  }
}

// Collapse the ensemble endpoint's per-model arrays into a single mean array
// per variable. Variable list matches the canonical URL exactly.
function collapseEnsembleHourly(hourly) {
  const time = hourly.time || [];
  const out = { time };
  const variables = [
    'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
    'precipitation', 'weather_code', 'pressure_msl', 'surface_pressure',
    'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility',
    'wind_speed_10m', 'wind_speed_80m', 'wind_direction_80m', 'wind_direction_10m',
    'wind_gusts_10m', 'surface_temperature',
    'cape', 'convective_inhibition', 'freezing_level_height',
  ];

  for (const v of variables) {
    const keys = Object.keys(hourly).filter(k => k === v || k.startsWith(`${v}_`));
    if (!keys.length) { out[v] = new Array(time.length).fill(0); continue; }
    const arr = new Array(time.length).fill(0);
    const cnt = new Array(time.length).fill(0);
    for (const k of keys) {
      const series = hourly[k];
      if (!Array.isArray(series)) continue;
      for (let i = 0; i < time.length; i++) {
        const x = series[i];
        if (x != null && Number.isFinite(Number(x))) {
          arr[i] += Number(x);
          cnt[i] += 1;
        }
      }
    }
    out[v] = arr.map((val, i) => cnt[i] ? val / cnt[i] : 0);
  }

  // Approximate 180m wind from 80m for DiurnalTimingSection shear calculation
  // (canonical URL has 80m as highest wind level).
  out.wind_speed_180m    = out.wind_speed_80m.map(v => v * 1.15);
  out.wind_direction_180m = out.wind_direction_80m.slice();
  // lifted_index not in canonical URL — callers fall back to default of 5.
  return out;
}

/**
 * Extract real per-hour atmospheric values for a single calendar day.
 * Returns 24 hourly entries with CAPE/shear/LI/temp etc — used by DiurnalTimingSection.
 */
export function extractDailyHourly(pointData, dayIdx, run) {
  if (!pointData?.hourly?.time) return null;
  const times = pointData.hourly.time;
  const h = pointData.hourly;

  // Day 0 = the calendar day that contains the run start (UTC)
  const dayStart = new Date(run);
  dayStart.setUTCHours(0, 0, 0, 0);
  dayStart.setUTCDate(dayStart.getUTCDate() + dayIdx);
  const dayEnd = dayStart.getTime() + 24 * 3600_000;

  const out = [];
  for (let i = 0; i < times.length; i++) {
    const tstr = times[i];
    const tms = Date.parse(tstr.includes('T') ? tstr + 'Z' : tstr + 'T00:00:00Z');
    if (tms < dayStart.getTime() || tms >= dayEnd) continue;

    const ws10 = Number(h.wind_speed_10m?.[i] || 0);
    const ws180 = Number(h.wind_speed_180m?.[i] || h.wind_speed_80m?.[i] || 0);
    const shear = Math.abs(ws180 - ws10);

    out.push({
      time: tstr,
      hour: new Date(tms).getUTCHours(),
      cape: Math.max(0, Number(h.cape?.[i] || 0)),
      cin: Math.abs(Number(h.convective_inhibition?.[i] || 0)),
      li: Number(h.lifted_index?.[i] ?? 5),
      shear,
      temp: Number(h.temperature_2m?.[i] || 0),
      dewpoint: Number(h.dew_point_2m?.[i] || 0),
      rh: Number(h.relative_humidity_2m?.[i] || 0),
      precip: Math.max(0, Number(h.precipitation?.[i] || 0)),
      wxCode: Number(h.weather_code?.[i] || 0),
      freezingLvl: Number(h.freezing_level_height?.[i] || 0),
      pressureMsl: Number(h.pressure_msl?.[i] || 1013),
      cloudLow: Number(h.cloud_cover_low?.[i] || 0),
      cloudMid: Number(h.cloud_cover_mid?.[i] || 0),
      cloudHigh: Number(h.cloud_cover_high?.[i] || 0),
    });
  }
  return out;
}

/**
 * Extract a real vertical pressure-level sounding at the time of peak CAPE
 * for the given day. Returns levels = [{ p, T, Td, windSpeed, windDir, z }].
 */
export function extractSoundingAtPeakCape(pointData, dayIdx, run) {
  const daily = extractDailyHourly(pointData, dayIdx, run);
  if (!daily?.length) return null;

  let peakIdx = 0, peakCape = -1;
  for (let i = 0; i < daily.length; i++) {
    if (daily[i].cape > peakCape) { peakCape = daily[i].cape; peakIdx = i; }
  }
  const peakHour = daily[peakIdx];

  const times = pointData.hourly.time;
  const h = pointData.hourly;
  let absoluteIdx = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i] === peakHour.time) { absoluteIdx = i; break; }
  }
  if (absoluteIdx < 0) return null;

  const pressures = pointData.pressure || [];
  const levels = pressures.map(p => {
    const T = Number(h[`temperature_${p}hPa`]?.[absoluteIdx]);
    const Td = Number(h[`dew_point_${p}hPa`]?.[absoluteIdx]);
    const windSpeed = Number(h[`wind_speed_${p}hPa`]?.[absoluteIdx] || 0);
    const windDir = Number(h[`wind_direction_${p}hPa`]?.[absoluteIdx] || 0);
    const z = (1 - Math.pow(p / 1013.25, 0.190284)) * 44307.7;
    return {
      p, z,
      T:  Number.isFinite(T)  ? T  : null,
      Td: Number.isFinite(Td) ? Td : null,
      windSpeed, windDir,
    };
  }).filter(l => l.T != null && l.Td != null);

  return {
    levels,
    cape: Math.round(peakHour.cape),
    cin: Math.round(peakHour.cin),
    li:  Math.round(peakHour.li * 10) / 10,
    surfaceT:  peakHour.temp,
    surfaceTd: peakHour.dewpoint,
    peakHour:  peakHour.hour,
    peakTime:  peakHour.time,
  };
}