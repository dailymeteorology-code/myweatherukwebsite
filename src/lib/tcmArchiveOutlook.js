// ─────────────────────────────────────────────────────────────────────────────
// TCM ARCHIVE OUTLOOK — run the (unchanged) TCM engine on HISTORICAL weather for a
// past event date, producing the outlook grid the TCM Verification page overlays
// on the observed lightning strikes.
//
// Historical CAPE + upper-air come from the PUBLIC Open-Meteo archive API
// (archive-api.open-meteo.com, ERA5) — the free self-host S3 doesn't carry those
// fields, but the public archive does, and it's reachable from the browser. This
// runs client-side (admin only) exactly like "Run Model", just for a past date.
//
// Reuses the engine's own buildEnv + dayOfYear + the exact fetch units, so the
// scores match what the live site would compute.
// ─────────────────────────────────────────────────────────────────────────────
import { engineScores } from '@/lib/tcmEngineScores';
import { buildEnv, dayOfYear } from '@/lib/openMeteoTCM';

const ARCHIVE_ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive';

// ERA5-archive-supported hourly fields the engine consumes (conservative set —
// avoids variables ERA5 archive may 400 on, e.g. lifted_index / weather_code).
// Wind speed/direction at levels + dew point are derived by the API; the engine
// falls back cleanly for anything missing (and the physical-necessity gate keeps
// data-starved cells at No Risk).
const HOURLY = [
  'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation',
  'pressure_msl', 'surface_pressure', 'cloud_cover', 'cloud_cover_low',
  'cloud_cover_mid', 'cloud_cover_high', 'wind_speed_10m', 'wind_direction_10m',
  'wind_speed_100m', 'wind_direction_100m', 'wind_gusts_10m', 'cape',
  'temperature_850hPa', 'temperature_700hPa', 'temperature_500hPa',
  'relative_humidity_850hPa', 'relative_humidity_700hPa', 'relative_humidity_500hPa',
  'geopotential_height_850hPa', 'geopotential_height_700hPa', 'geopotential_height_500hPa',
  'wind_speed_850hPa', 'wind_speed_700hPa', 'wind_speed_500hPa', 'wind_speed_300hPa',
  'wind_direction_850hPa', 'wind_direction_700hPa', 'wind_direction_500hPa', 'wind_direction_300hPa',
  'vertical_velocity_700hPa',
];

const arrAt = (a, i) => (a && a[i] != null && Number.isFinite(Number(a[i])) ? Number(a[i]) : null);
function parseOmTime(s) {
  const y = +s.slice(0, 4), mo = +s.slice(5, 7), d = +s.slice(8, 10), h = +s.slice(11, 13);
  return new Date(Date.UTC(y, mo - 1, d, h));
}
function makeGrid(bbox, step) {
  const pts = [];
  for (let lat = bbox.latMin; lat <= bbox.latMax + 1e-9; lat += step) {
    for (let lon = bbox.lonMin; lon <= bbox.lonMax + 1e-9; lon += step) {
      pts.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3) });
    }
  }
  return pts;
}

async function fetchArchiveBatch(pts, date, signal, timeoutMs = 45000) {
  const lats = pts.map((p) => p.lat).join(',');
  const lons = pts.map((p) => p.lon).join(',');
  const url = `${ARCHIVE_ENDPOINT}?latitude=${lats}&longitude=${lons}`
    + `&start_date=${date}&end_date=${date}`
    + `&hourly=${HOURLY.join(',')}&timezone=UTC&wind_speed_unit=mph`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const reason = body && (body.reason || body.error_message);
      throw new Error(`Archive API HTTP ${res.status}${reason ? ` — ${reason}` : ''}`);
    }
    // Multi-coordinate requests return an array (one object per location);
    // a single coordinate returns a bare object.
    return Array.isArray(body) ? body : [body];
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Score one location's day → daily PEAK hazard scores (the outlook value).
function scoreLocationDay(hourly, pt) {
  const times = hourly?.time || [];
  let best = null, bestTs = -1;
  for (let i = 0; i < times.length; i++) {
    const at = (name) => arrAt(hourly[name], i);
    if (at('temperature_2m') == null) continue;
    const dt = parseOmTime(times[i]);
    const env = buildEnv(at, 0, {}, dayOfYear(dt), dt.getUTCHours());
    const sc = engineScores(env);
    const ts = sc.thunderstorm || 0;
    if (ts > bestTs) { bestTs = ts; best = sc; }
  }
  return {
    lat: pt.lat, lon: pt.lon,
    thunderstorm: best ? Math.round(best.thunderstorm || 0) : 0,
    hail:         best ? Math.round(best.hail || 0) : 0,
    tornado:      best ? Math.round(best.tornado || 0) : 0,
    lightning:    best ? Math.round(best.lightning || 0) : 0,
  };
}

// Run the engine over the event's region for its date → grid_data.
// onProgress({ done, total }) fires after each batch.
export async function runArchiveOutlook(event, { step = 0.5, batchSize = 50, onProgress, signal } = {}) {
  const bbox = event?.bbox || { latMin: 49.5, latMax: 61.5, lonMin: -10.5, lonMax: 2.5 };
  const date = (event?.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Event has no valid YYYY-MM-DD date.');

  const grid = makeGrid(bbox, step);
  const out = [];
  let done = 0;
  for (let b = 0; b < grid.length; b += batchSize) {
    if (signal?.aborted) throw new Error('Cancelled.');
    const chunk = grid.slice(b, b + batchSize);
    const results = await fetchArchiveBatch(chunk, date, signal);
    for (let k = 0; k < chunk.length; k++) {
      const hourly = results[k]?.hourly;
      out.push(hourly ? scoreLocationDay(hourly, chunk[k])
                      : { lat: chunk[k].lat, lon: chunk[k].lon, thunderstorm: 0, hail: 0, tornado: 0, lightning: 0 });
    }
    done += chunk.length;
    onProgress?.({ done, total: grid.length });
    await new Promise((r) => setTimeout(r, 200)); // gentle pacing for the public API
  }
  return out;
}
