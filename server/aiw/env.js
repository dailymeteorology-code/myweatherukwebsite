/**
 * Model-atmosphere inputs for each storm, from Open-Meteo (no key needed; the
 * project already uses it). Open-Meteo blends the best available national and
 * global NWP models for each location, so the same call works worldwide.
 *
 *   cape                Convective Available Potential Energy, J/kg
 *   liftedIndex         stability; negative = unstable
 *   cin                 convective inhibition, J/kg
 *   steering            700 hPa wind — a reasonable proxy for storm motion
 *   shear0_6kmKmh       vector difference, 10 m to 500 hPa — organisation
 *   showersMmH          model convective precipitation
 *
 * Cached per 0.5° tile per hour, and rate-limited, because a busy day can
 * have a few hundred storms worldwide and the free tier is generous but not
 * unlimited. A failed call returns null, which the model treats as "CAPE
 * unavailable" — it never invents a value.
 */
const BASE = 'https://api.open-meteo.com/v1/forecast';
const VARS = ['cape', 'lifted_index', 'convective_inhibition', 'wind_speed_700hPa', 'wind_direction_700hPa',
  'wind_speed_500hPa', 'wind_direction_500hPa', 'wind_speed_10m', 'wind_direction_10m', 'showers'];

const cache = new Map(); // tileKey|hour -> { at, value }
let callsThisMinute = 0; let minuteStart = Date.now();
const MAX_PER_MINUTE = Number(process.env.AIW_OPENMETEO_PER_MIN || 30);

export const envHealth = { lastOkAt: null, lastError: null, calls: 0, failures: 0, cached: 0 };

function vec(speedKmh, dirDeg) {
  // Meteorological direction is where the wind comes FROM; motion is toward.
  const toward = ((dirDeg + 180) * Math.PI) / 180;
  return { vx: (speedKmh / 60) * Math.sin(toward), vy: (speedKmh / 60) * Math.cos(toward) };
}

export async function envAt(lat, lon, now = Date.now()) {
  const tile = `${(Math.round(lat * 2) / 2).toFixed(1)},${(Math.round(lon * 2) / 2).toFixed(1)}`;
  const hour = Math.floor(now / 3600e3);
  const key = `${tile}|${hour}`;
  if (cache.has(key)) { envHealth.cached += 1; return cache.get(key).value; }
  if (now - minuteStart > 60e3) { minuteStart = now; callsThisMinute = 0; }
  if (callsThisMinute >= MAX_PER_MINUTE) return null; // try again next cycle
  callsThisMinute += 1;
  const [tlat, tlon] = tile.split(',').map(Number);
  // Request exactly the hour wanted. start_hour/end_hour work for the past
  // ~3 months as well as the future, so training on archived strikes gets the
  // same inputs, from the same source, as the live engine.
  const hh = new Date(hour * 3600e3).toISOString().slice(0, 13) + ':00';
  const url = `${BASE}?latitude=${tlat}&longitude=${tlon}&hourly=${VARS.join(',')}&start_hour=${hh}&end_hour=${hh}&timezone=UTC&wind_speed_unit=kmh`;
  try {
    envHealth.calls += 1;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'MyWeatherUK-AIW/1.0' } });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const j = await res.json();
    const times = j.hourly?.time || [];
    // The hour containing `now`.
    const iso = new Date(hour * 3600e3).toISOString().slice(0, 13);
    let idx = times.findIndex((t) => t.startsWith(iso));
    if (idx < 0) idx = 0;
    const h = (v) => { const a = j.hourly?.[v]; const x = a ? a[idx] : null; return Number.isFinite(x) ? x : null; };
    const s700 = h('wind_speed_700hPa'); const d700 = h('wind_direction_700hPa');
    const s500 = h('wind_speed_500hPa'); const d500 = h('wind_direction_500hPa');
    const s10 = h('wind_speed_10m'); const d10 = h('wind_direction_10m');
    let shear = null;
    if (s500 != null && d500 != null && s10 != null && d10 != null) {
      const a = vec(s500, d500); const b = vec(s10, d10);
      shear = Math.hypot(a.vx - b.vx, a.vy - b.vy) * 60;
    }
    const value = {
      source: 'open-meteo', model: 'best-match', validHour: new Date(hour * 3600e3).toISOString(),
      tile,
      cape: h('cape'), liftedIndex: h('lifted_index'), cin: h('convective_inhibition'),
      showersMmH: h('showers'),
      steering: s700 != null && d700 != null ? { ...vec(s700, d700), speedKmh: s700, fromDeg: d700, source: 'steering-700hPa' } : null,
      shear0_6kmKmh: shear,
    };
    cache.set(key, { at: now, value });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    envHealth.lastOkAt = now;
    return value;
  } catch (err) {
    envHealth.failures += 1; envHealth.lastError = String(err.message || err);
    return null;
  }
}


/* In-flight requests, so a busy cycle never asks for the same tile twice. */
const inflight = new Map();

/**
 * Non-blocking lookup for the live engine: returns the cached value at once
 * (or null) and, if there is none, starts fetching it in the background so it
 * is ready next cycle. The forecasting cycle must never wait on the network —
 * fetching inputs for 40 storms one after another took over half a minute.
 */
export function envPeek(lat, lon, now = Date.now()) {
  const tile = `${(Math.round(lat * 2) / 2).toFixed(1)},${(Math.round(lon * 2) / 2).toFixed(1)}`;
  const hour = Math.floor(now / 3600e3);
  const key = `${tile}|${hour}`;
  const hit = cache.get(key);
  if (hit) { envHealth.cached += 1; return hit.value; }
  // The previous hour's values are a far better prior than nothing while the
  // new hour is being fetched.
  const prev = cache.get(`${tile}|${hour - 1}`);
  if (!inflight.has(key)) {
    inflight.set(key, envAt(lat, lon, now).finally(() => inflight.delete(key)));
  }
  return prev ? prev.value : null;
}
