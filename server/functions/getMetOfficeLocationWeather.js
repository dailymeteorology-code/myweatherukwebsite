/**
 * Self-hosted `getMetOfficeLocationWeather`, with two sources and one contract.
 *
 * MET OFFICE DATAHUB FIRST. With MET_OFFICE_DATAHUB_API_KEY (or a dedicated
 * MET_OFFICE_SITESPECIFIC_API_KEY) set, a point inside the UK and the Crown
 * Dependencies is answered from DataHub's site-specific product — the same
 * three feeds the Base44 original used, hourly, three-hourly and daily, handed
 * back untouched. That is the Met Office's own published forecast, and it is
 * what `transformMetOfficeData` on the page was written to parse.
 *
 * OPEN-METEO OTHERWISE, and the reason it is not merely a fallback: DataHub's
 * site-specific product covers the UK, and its free allowance is a few hundred
 * calls a day. Every lookup outside the domain — and every lookup at all, if
 * the key is missing, revoked or out of quota — is served from Open-Meteo's
 * `ukmo_seamless` model, which *is* the Met Office's own UKV/Global data served
 * without a key, reshaped here into the same DataHub GeoJSON envelope. The page
 * cannot tell the two apart; `source` on the response says which it got.
 *
 * Set USE_ORIGINAL_LOCATION_WEATHER=true to run the Base44 original instead.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const UA = 'MyWeatherUK-selfhost/1.0';

/**
 * UK plus the Crown Dependencies. No longer a gate — searches anywhere in the
 * world are answered — but still the tie-break when a name is ambiguous, so
 * "London" means London, England rather than London, Ontario.
 */
const UK_COUNTRIES = new Set(['GB', 'IM', 'JE', 'GG']);

/**
 * The Base44 original refused anything outside the UK, because Met Office
 * DataHub's site-specific product only covers it. This port reads the Met
 * Office model from Open-Meteo instead, and that model's global component has
 * worldwide coverage (verified against Dublin, Paris, New York and Sydney), so
 * the restriction no longer buys anything. Set LOCATION_WEATHER_UK_ONLY=true to
 * put it back.
 */
const UK_ONLY = process.env.LOCATION_WEATHER_UK_ONLY === 'true';

/* ── weather codes ──────────────────────────────────────────────────────────
 * Open-Meteo speaks WMO; the page's icon table is keyed by Met Office
 * significantWeatherCode. Day and night differ for the clear/shower codes, so
 * the mapping takes an is_day flag.
 */
function wmoToMetOffice(wmo, isDay) {
  const d = (day, night) => (isDay ? day : night);
  switch (wmo) {
    case 0:
    case 1:
      return d(1, 0); // Sunny / Clear night
    case 2:
      return d(3, 2); // Partly cloudy
    case 3:
      return 8; // Overcast
    case 45:
    case 48:
      return 6; // Fog
    case 51:
    case 53:
      return 11; // Drizzle
    case 55:
      return 12; // Light rain
    case 56:
    case 57:
    case 66:
    case 67:
      return 18; // Freezing drizzle / freezing rain -> Sleet
    case 61:
    case 63:
      return 12; // Light rain
    case 65:
      return 15; // Heavy rain
    case 71:
    case 73:
    case 77:
      return 24; // Light snow
    case 75:
      return 27; // Heavy snow
    case 80:
    case 81:
      return d(10, 9); // Light rain shower
    case 82:
      return d(14, 13); // Heavy rain shower
    case 85:
      return d(23, 22); // Light snow shower
    case 86:
      return d(26, 25); // Heavy snow shower
    case 95:
    case 96:
    case 99:
      return d(29, 28); // Thunder shower
    default:
      return 7; // Cloudy
  }
}

async function getJson(url, { timeout = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Resolve a typed place name to coordinates. Open-Meteo's geocoder is used
 * first and biased to the UK; results elsewhere are still returned so the
 * caller can report OUTSIDE_UK rather than silently forecasting the wrong
 * continent (there is a London in Ontario).
 */
async function geocode(query) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=10&language=en&format=json`;
  const body = await getJson(url).catch(() => null);
  const results = body?.results || [];
  if (!results.length) return null;
  // Prefer a UK hit when the name is ambiguous.
  return results.find((r) => UK_COUNTRIES.has(r.country_code)) || results[0];
}

/** Name a coordinate pair the user supplied from the suggestion list. */
async function reverseName(lat, lon) {
  try {
    const body = await getJson(
      `${NOMINATIM_REVERSE}?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`,
      { timeout: 8000 }
    );
    const a = body?.address || {};
    return {
      name: a.city || a.town || a.village || a.suburb || a.county || body?.name || null,
      countryCode: (a.country_code || '').toUpperCase() || null,
    };
  } catch {
    return { name: null, countryCode: null };
  }
}

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'visibility',
  'is_day',
  'surface_pressure',
  'uv_index',
];

const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'sunrise',
  'sunset',
  'uv_index_max',
];

/** Wrap a timeSeries in the DataHub GeoJSON envelope the page expects. */
function geoJson({ name, latitude, longitude, timeSeries }) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
        properties: { location: { name }, requestPointDistance: 0, modelRunDate: null, timeSeries },
      },
    ],
  };
}

/* ── Met Office DataHub, site-specific ──────────────────────────────────────
 *
 * THE REAL THING, when a key is available. Everything above this point is the
 * keyless Open-Meteo stand-in; this is the product the page was actually
 * written against, and its parameter names are the ones `transformMetOfficeData`
 * parses — so the three GeoJSON documents go back untouched rather than being
 * rebuilt. The shim stays as the fallback for points DataHub does not cover and
 * for installs with no key.
 *
 * THE KEY LIVES IN THE ENVIRONMENT, never in source and never in the browser
 * bundle. Same two variable names the Base44 original used, in the same order,
 * so a dedicated site-specific key still takes precedence over the shared one.
 */
const DATAHUB_KEY_VARS = ['MET_OFFICE_SITESPECIFIC_API_KEY', 'MET_OFFICE_DATAHUB_API_KEY'];
const DATAHUB_POINT = 'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point';

function datahubKey() {
  return DATAHUB_KEY_VARS.map((v) => process.env[v]).find(Boolean) || null;
}

/* Short-lived response cache, keyed by rounded coordinate.
 *
 * The free DataHub tier counts requests and stops dead when the allowance runs
 * out, so the cheapest call is the one never made. Site-specific data refreshes
 * hourly, so serving a 20-minute-old answer costs the reader nothing they would
 * notice while removing every repeat lookup of the same town — and repeats are
 * the common case. Rounded to 2 dp (~1 km) so "Dunstable" and "dunstable, beds"
 * land on one entry rather than two. */
const DATAHUB_TTL_MS = 20 * 60 * 1000;
const datahubCache = new Map();

function datahubCacheGet(key) {
  const hit = datahubCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DATAHUB_TTL_MS) { datahubCache.delete(key); return null; }
  return hit.value;
}

function datahubCacheSet(key, value) {
  datahubCache.set(key, { at: Date.now(), value });
  if (datahubCache.size > 200) datahubCache.delete(datahubCache.keys().next().value);
}

/**
 * Fetch the three site-specific products for one point.
 *
 * Three, because they cover different ranges: hourly runs about two days,
 * three-hourly carries the same detail to the end of the week at a coarser
 * step, and daily gives the seven-day summary. Without the three-hourly feed
 * days three onward have a summary and nothing to show hour by hour — which is
 * the one thing the Open-Meteo shim did better, since its hourly series ran the
 * full week. Losing three-hourly alone is tolerated; losing either of the other
 * two means falling back.
 *
 * Returns null on any failure, so the caller drops through to Open-Meteo rather
 * than showing the reader an error for something we can still answer.
 */
async function fetchDataHub(key, latitude, longitude) {
  const url = (product) =>
    `${DATAHUB_POINT}/${product}?datasource=BD1&includeLocationName=true`
    + `&latitude=${latitude}&longitude=${longitude}&excludeParameterMetadata=true`;

  const get = async (product, timeout) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url(product), {
        headers: { apikey: key, accept: 'application/json' },
        signal: ac.signal,
      });
      if (!res.ok) {
        /* Say WHICH failure this is in the log. 401 and 403 both look like a
           bad key from the status alone, but on the free tier 403 is usually
           the daily allowance rather than anything wrong with the key — a
           completely different fix, and one nobody would guess from the
           number. Never log the response body: an upstream error can be chatty
           enough to echo the credential back. */
        const why = res.status === 401 ? 'key rejected'
          : res.status === 403 ? 'forbidden — daily allowance used up, or the key is not subscribed to site-specific'
            : `HTTP ${res.status}`;
        console.warn(`[locationWeather] DataHub ${product}: ${why}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn(`[locationWeather] DataHub ${product}: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const [hourly, daily, threeHourly] = await Promise.all([
    get('hourly', 15000),
    get('daily', 15000),
    get('three-hourly', 15000),
  ]);

  if (!hourly?.features?.length || !daily?.features?.length) return null;
  return { hourly, daily, threeHourly: threeHourly?.features?.length ? threeHourly : null };
}

export default async function getMetOfficeLocationWeather(payload = {}) {
  const requested = String(payload.location || '').trim();
  let latitude = Number(payload.latitude);
  let longitude = Number(payload.longitude);
  let name = requested;
  let countryCode = null;

  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

  if (!hasCoords && !requested) {
    return { error: 'Location parameter required', status: 400 };
  }

  if (hasCoords) {
    // Trust the coordinates; only look up a name and country for the UK check.
    const rev = await reverseName(latitude, longitude);
    name = requested || rev.name || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
    countryCode = rev.countryCode;
  } else {
    const hit = await geocode(requested);
    if (!hit) {
      return { error: `Could not find "${requested}". Try a nearby town or postcode.`, status: 404 };
    }
    latitude = hit.latitude;
    longitude = hit.longitude;
    name = hit.name + (hit.admin1 && hit.admin1 !== hit.name ? `, ${hit.admin1}` : '');
    countryCode = hit.country_code;
  }

  // Same contract as the original when the restriction is switched back on:
  // the page renders its own "outside the UK" panel from this, not an error.
  if (UK_ONLY && countryCode && !UK_COUNTRIES.has(countryCode)) {
    return {
      code: 'OUTSIDE_UK',
      resolvedCountry: countryCode,
      resolvedName: name,
    };
  }

  /* ── Met Office first ─────────────────────────────────────────────────────
     Inside the site-specific domain, and with a key configured, the forecast
     comes from DataHub directly — the reader gets the Met Office's own
     published numbers rather than a model reconstruction of them, and the page
     gets the daily and three-hourly feeds the shim could not provide.

     THE DOMAIN GATE IS DELIBERATE, and it is not only about coverage. The free
     tier's allowance is a few hundred calls a day and a single request here
     spends three of them, so pointing every worldwide lookup at DataHub would
     exhaust the budget and start returning 403 for UK readers too. Outside the
     UK and the Crown Dependencies, Open-Meteo's `ukmo_seamless` — which is the
     Met Office's own global model — answers instead, exactly as before.

     An unknown country (coordinates given, reverse lookup failed) is tried
     rather than refused: DataHub either answers or it does not, and the
     fallback below catches it either way. */
  const key = datahubKey();
  if (key && (!countryCode || UK_COUNTRIES.has(countryCode))) {
    const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
    const cached = datahubCacheGet(cacheKey);
    if (cached) return { ...cached, location: { name, latitude, longitude }, cached: true };

    const dh = await fetchDataHub(key, latitude, longitude);
    if (dh) {
      const result = {
        source: 'metoffice/sitespecific',
        /* Straight through. These are the documents the page's transform was
           written against, so reshaping them could only lose fidelity. */
        rawHourly: dh.hourly,
        rawDaily: dh.daily,
        rawThreeHourly: dh.threeHourly,
      };
      datahubCacheSet(cacheKey, result);
      return { ...result, location: { name, latitude, longitude } };
    }
    /* Fell through on purpose: a quota exhaustion or a DataHub outage should
       cost the reader the provenance, not the forecast. */
    console.warn('[locationWeather] DataHub unavailable — falling back to open-meteo/ukmo_seamless');
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: HOURLY_FIELDS.join(','),
    daily: DAILY_FIELDS.join(','),
    // The page converts wind with `ms * 2.237`, so it must arrive in m/s.
    wind_speed_unit: 'ms',
    /* UTC, to match what DataHub returns. The page groups hours onto UK
     * calendar days itself (ukDate), which needs an unambiguous instant — a
     * naive local string would be read as the *viewer's* local time and shift
     * the whole forecast for anyone outside the UK. */
    timezone: 'GMT',
    forecast_days: '7',
    // The Met Office's own model, served without a key — so the page's
    // "Official Met Office data" label stays true.
    models: 'ukmo_seamless',
  });

  /* The Met Office model publishes no precipitation probability — every value
   * comes back null — and a rain chance is the single most-read number on the
   * page. Open-Meteo's default blend does carry it, so it is fetched alongside
   * and merged in by timestamp. Everything else stays Met Office. */
  const popParams = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: 'precipitation_probability',
    timezone: 'GMT',
    forecast_days: '7',
  });

  let data;
  let popByTime = new Map();
  try {
    const [main, pop] = await Promise.all([
      getJson(`${FORECAST_URL}?${params}`, { timeout: 20000 }),
      // Optional: a failure here costs the rain chance, not the forecast.
      getJson(`${FORECAST_URL}?${popParams}`, { timeout: 12000 }).catch(() => null),
    ]);
    data = main;
    const pt = pop?.hourly?.time || [];
    const pv = pop?.hourly?.precipitation_probability || [];
    popByTime = new Map(pt.map((t, i) => [t, pv[i] ?? null]));
  } catch (err) {
    return {
      error: `Forecast data is unavailable right now (${err.message}). Please try again shortly.`,
      code: 'UPSTREAM_ERROR',
      status: 502,
    };
  }

  const h = data.hourly || {};
  const times = h.time || [];
  const at = (arr, i) => (Array.isArray(arr) ? (arr[i] ?? null) : null);

  const hourlySeries = times.map((t, i) => {
    const isDay = at(h.is_day, i) === 1;
    const precip = at(h.precipitation, i);
    return {
      // Open-Meteo omits the zone designator; these are GMT (see the request),
      // so mark them as such rather than leaving them open to interpretation.
      time: `${t.length === 16 ? `${t}:00` : t}Z`,
      screenTemperature: at(h.temperature_2m, i),
      feelsLikeTemperature: at(h.apparent_temperature, i),
      screenRelativeHumidity: at(h.relative_humidity_2m, i),
      probOfPrecipitation: at(h.precipitation_probability, i) ?? popByTime.get(t) ?? 0,
      precipitationRate: precip,
      totalPrecipAmount: precip,
      significantWeatherCode: wmoToMetOffice(at(h.weather_code, i), isDay),
      windSpeed10m: at(h.wind_speed_10m, i),
      windGustSpeed10m: at(h.wind_gusts_10m, i),
      windDirectionFrom10m: at(h.wind_direction_10m, i),
      visibility: at(h.visibility, i),
      mslp: at(h.surface_pressure, i) != null ? Math.round(at(h.surface_pressure, i) * 100) : null,
      uvIndex: at(h.uv_index, i),
    };
  });

  /* Midday values for the daily feed. DataHub publishes explicit `midday*`
   * fields; Open-Meteo does not, so they are read off the 12:00 hour. */
  const middayIndexFor = (dayIso) => times.findIndex((t) => t.startsWith(`${dayIso}T12`));

  const d = data.daily || {};
  const days = d.time || [];

  /* `ukmo_seamless` does not publish precipitation_probability_max, so the
   * daily rain chance arrives null. Take the day's highest hourly probability
   * instead — the same thing the page falls back to, done once here so every
   * consumer of rawDaily gets it. */
  const dayPop = (dayIso) => {
    let max = null;
    times.forEach((t, i) => {
      if (!t.startsWith(dayIso)) return;
      const p = at(h.precipitation_probability, i) ?? popByTime.get(t) ?? null;
      if (p != null) max = max == null ? p : Math.max(max, p);
    });
    return max;
  };

  const dailySeries = days.map((day, i) => {
    const mid = middayIndexFor(day);
    return {
      time: `${day}T00:00:00Z`,
      dayMaxScreenTemperature: at(d.temperature_2m_max, i),
      nightMinScreenTemperature: at(d.temperature_2m_min, i),
      daySignificantWeatherCode: wmoToMetOffice(at(d.weather_code, i), true),
      dayProbabilityOfPrecipitation: at(d.precipitation_probability_max, i) ?? dayPop(day),
      totalPrecipAmount: at(d.precipitation_sum, i),
      midday10MWindSpeed: at(d.wind_speed_10m_max, i),
      midday10MWindGust: at(d.wind_gusts_10m_max, i),
      midday10MWindDirection: at(d.wind_direction_10m_dominant, i),
      middayRelativeHumidity: mid >= 0 ? at(h.relative_humidity_2m, mid) : null,
      middayVisibility: mid >= 0 ? at(h.visibility, mid) : null,
      maxUvIndex: at(d.uv_index_max, i),
      sunrise: at(d.sunrise, i),
      sunset: at(d.sunset, i),
    };
  });

  const envelope = { name, latitude, longitude };

  return {
    location: { name, latitude, longitude },
    source: 'open-meteo/ukmo_seamless',
    rawHourly: geoJson({ ...envelope, timeSeries: hourlySeries }),
    rawDaily: geoJson({ ...envelope, timeSeries: dailySeries }),
    // DataHub's separate three-hourly product has no Open-Meteo equivalent and
    // is not needed: the hourly feed here already runs the full seven days,
    // where DataHub's stops after about two.
    rawThreeHourly: null,
  };
}
