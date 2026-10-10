/**
 * Current conditions for the home page's UK city cards, from Met Office
 * DataHub's site-specific product.
 *
 * WHY THIS IS A SERVER ROUTE AND NOT A BROWSER FETCH: the cards are drawn from
 * a single batched Open-Meteo call the page makes directly, which is fine
 * because that API needs no key. DataHub does, and a key in the page is a key
 * in the bundle — which is exactly how this project's Met Office credential
 * leaked once before. So the browser asks here and the key never leaves Node.
 *
 * WHY IT IS OFF BY DEFAULT. Open-Meteo answers all fifteen cities in ONE
 * request. DataHub site-specific is one request PER POINT, and the free tier
 * allowance is a few hundred calls a day shared with the Location Weather page
 * and the forecast grid. Five cities on a 30-minute cache is 5 x 2 x 24 = 240
 * calls a day before a single location search is made, and when the allowance
 * runs out DataHub returns 403 for everything — so switching this on can take
 * the Location Weather page down with it. That is a judgement about how the
 * budget should be spent, so it is a setting rather than a default:
 *
 *     HOME_CITIES_FROM_DATAHUB=true
 *
 * With it off, this route reports `enabled: false` and the page keeps the
 * Open-Meteo values it already has. Nothing else changes.
 */

const DATAHUB_KEY_VARS = ['MET_OFFICE_SITESPECIFIC_API_KEY', 'MET_OFFICE_DATAHUB_API_KEY'];
const DATAHUB_POINT = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point';

/* Longer than the Location Weather cache (20 min), because this is a summary
   tile rather than a forecast someone is reading closely, and because the cost
   here is multiplied by the number of cities. */
const TTL_MS = 30 * 60 * 1000;
const cache = new Map();

/* One point in flight at a time. Without this, two visitors landing together
   on a cold cache each fire five requests and the allowance is spent twice for
   one set of answers. */
const inflight = new Map();

function key() {
  return DATAHUB_KEY_VARS.map((v) => process.env[v]).find(Boolean) || null;
}

function enabled() {
  return process.env.HOME_CITIES_FROM_DATAHUB === 'true' && !!key();
}

async function pointNow(apikey, lat, lon) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inflight.has(k)) return inflight.get(k);

  const job = (async () => {
    const url = `${DATAHUB_POINT}/hourly?datasource=BD1&includeLocationName=true`
      + `&latitude=${lat}&longitude=${lon}&excludeParameterMetadata=true`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    try {
      const res = await fetch(url, {
        headers: { apikey, accept: 'application/json' },
        signal: ac.signal,
      });
      if (!res.ok) {
        console.warn(`[ukCityConditions] ${k}: HTTP ${res.status}`
          + (res.status === 403 ? ' (allowance used up, or key not subscribed)' : ''));
        return null;
      }
      const j = await res.json();
      const series = j?.features?.[0]?.properties?.timeSeries;
      if (!Array.isArray(series) || !series.length) return null;

      /* The step covering now. DataHub publishes from the model run hour, so
         the first entry can already be an hour or two old; picking the latest
         step at or before now keeps the card honest rather than showing the
         run's opening hour all afternoon. */
      const now = Date.now();
      let step = series[0];
      for (const s of series) {
        const ts = Date.parse(s.time);
        if (Number.isFinite(ts) && ts <= now) step = s; else break;
      }

      const value = {
        /* Shaped like one entry of Open-Meteo's `current` block, because that
           is what the card already reads — except `weather_code`, which is a
           Met Office significantWeatherCode here and is flagged as such so the
           page skips its WMO translation rather than mangling it. */
        time: step.time,
        temperature_2m: step.screenTemperature ?? null,
        apparent_temperature: step.feelsLikeTemperature ?? null,
        relative_humidity_2m: step.screenRelativeHumidity ?? null,
        // DataHub publishes wind in m/s; the card's fmtWind takes mph.
        wind_speed_10m: step.windSpeed10m != null ? step.windSpeed10m * 2.2369362920544 : null,
        wind_direction_10m: step.windDirectionFrom10m ?? null,
        weather_code: step.significantWeatherCode ?? null,
        metOfficeCode: true,
      };
      cache.set(k, { at: Date.now(), value });
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      return value;
    } catch (err) {
      console.warn(`[ukCityConditions] ${k}: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
      return null;
    } finally {
      clearTimeout(t);
      inflight.delete(k);
    }
  })();

  inflight.set(k, job);
  return job;
}

/**
 * POST body: `{ points: [{ lat, lon }, ...] }`
 * Returns:   `{ enabled, results: [current | null, ...] }` in the same order.
 *
 * A null means "no Met Office answer for this point" — the page keeps whatever
 * it already had rather than blanking the card.
 */
export default async function ukCityConditions(body = {}) {
  if (!enabled()) return { enabled: false, results: [] };

  const apikey = key();
  const points = Array.isArray(body.points) ? body.points.slice(0, 8) : [];
  const results = await Promise.all(points.map((p) => {
    const lat = Number(p?.lat);
    const lon = Number(p?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return pointNow(apikey, lat, lon);
  }));

  return { enabled: true, results };
}
