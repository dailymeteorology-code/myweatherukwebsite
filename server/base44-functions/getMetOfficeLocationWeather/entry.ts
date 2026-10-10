/* Met Office DataHub site-specific forecast for ONE searched location, UK only.

   COST PER SEARCH: exactly two DataHub calls — hourly and daily, for the single
   point the user typed. Nothing here fetches a grid. (The 300-point pull that
   can exhaust the daily allowance is getMetOfficeForecast, which powers the TCM
   forecast grid and shares this key unless MET_OFFICE_SITESPECIFIC_API_KEY is
   set. That is why a location search can start returning 403 without anything
   about this function having changed.)

   THE KEY LIVES IN THE ENVIRONMENT, never in source. It used to be a literal at
   the top of this file and, worse, a second copy sat in the React page and so
   shipped inside the browser bundle where anyone could read it. Same variable
   name as getMetOfficeForecast so both functions share one secret.

   Set it in the Base44 dashboard: MET_OFFICE_DATAHUB_API_KEY

   A DEDICATED KEY CAN BE GIVEN TO THIS PAGE, and should be. getMetOfficeForecast
   fetches up to 300 site-specific points in a single run, and the free DataHub
   tier allows only a few hundred calls a day with stopOnQuotaReach set — so one
   forecast-grid run can spend the whole allowance and leave every location
   search returning 403 for the rest of the day. Setting
   MET_OFFICE_SITESPECIFIC_API_KEY puts this page on its own budget; without it
   we fall back to the shared key and the starvation risk remains. */
const API_KEY_VARS = ['MET_OFFICE_SITESPECIFIC_API_KEY', 'MET_OFFICE_DATAHUB_API_KEY'];

/* Short-lived response cache, keyed by rounded coordinate.

   The free DataHub tier counts requests and stops dead when the allowance runs
   out, so the cheapest call is the one never made. Site-specific data refreshes
   hourly, so serving a 20-minute-old answer costs the user nothing they would
   notice while removing every repeat lookup of the same town — and repeats are
   the common case: someone checking their home town, a shared link being opened
   several times, a page refresh.

   Rounded to 2 dp (~1 km) so "Dunstable" and "dunstable, beds" land on one
   entry rather than two. In-memory, so it only survives while the isolate does;
   that is enough to blunt bursts and needs no storage or cleanup. */
const CACHE_TTL_MS = 20 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  // Bound it. An isolate serving many distinct towns would otherwise grow
  // without limit; oldest-out is fine when every entry expires in 20 minutes.
  if (cache.size > 200) cache.delete(cache.keys().next().value);
}

/* The site-specific product covers the United Kingdom, so anything outside it
   is refused HERE rather than being passed to the Met Office and coming back as
   an opaque error. `code` lets the page show its own dialog instead of parsing
   prose. Crown dependencies are accepted: the Isle of Man and the Channel
   Islands are not in the UK constitutionally but are inside the forecast
   domain, and refusing Douglas or St Helier would just look broken. */
const UK_COUNTRY_CODES = new Set(['gb', 'im', 'je', 'gg']);

Deno.serve(async (req) => {
  try {
    const DATAHUB_API_KEY = API_KEY_VARS.map(v => Deno.env.get(v)).find(Boolean);
    if (!DATAHUB_API_KEY) {
      console.error(`none of ${API_KEY_VARS.join(' / ')} is set`);
      return Response.json(
        { error: 'Met Office API key is not configured on the server.', code: 'NO_API_KEY' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const { location, latitude: reqLat, longitude: reqLon } = body;

    const hasCoords = Number.isFinite(reqLat) && Number.isFinite(reqLon);
    if (!hasCoords && (!location || typeof location !== 'string')) {
      return Response.json({ error: 'Location parameter required' }, { status: 400 });
    }

    /* 1. Resolve to a point.

       When the caller picked a suggestion it already knows the exact
       coordinates, so re-geocoding the display name would be both wasteful and
       WRONG — the suggestions come from a different gazetteer, and a search for
       one of the seven UK villages called Dunston could easily land on a
       different one than the reader tapped.

       The country still has to be established HERE. A client is free to post
       any coordinates it likes, so trusting a country code sent alongside them
       would hand anyone a way past the UK-only rule. A reverse lookup costs the
       same single Nominatim request the forward search did, and it happens on
       submit rather than per keystroke. */
    const locationData = hasCoords
      ? await reverseLocation(reqLat, reqLon, location)
      : await searchLocation(location);

    if (!locationData) {
      return Response.json(
        { error: `Location "${location || `${reqLat}, ${reqLon}`}" not found. Please check the spelling and try again.` },
        { status: 404 }
      );
    }

    const { latitude, longitude, name, countryCode, country } = locationData;

    if (!countryCode || !UK_COUNTRY_CODES.has(countryCode)) {
      return Response.json({
        error: 'Only towns and cities in the UK are available.',
        code: 'OUTSIDE_UK',
        resolvedName: name,
        resolvedCountry: country || null,
      }, { status: 422 });
    }

    /* The version prefix is part of the key on purpose. Entries cached before
       `rawDaily` was added carry no daily feed, and a page that fell back to
       grouping the hourly series would silently show three days instead of
       seven. Bumping this makes those entries unreachable rather than
       mysteriously stale. */
    const cacheKey = `v2|${latitude.toFixed(2)},${longitude.toFixed(2)}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return Response.json({ ...cached, cached: true });
    }

    // This function is UK-only (refused above for anything outside UK_COUNTRY_CODES),
    // so the timezone is always Europe/London — no need to look it up per-location.
    const locationTimeZone = 'Europe/London';

    /* 2. Fetch from DataHub only — no third-party dependency.

       Three products, because they cover different ranges: hourly runs about
       two days, three-hourly carries the same detail out to the end of the
       week at a coarser step, and daily gives the seven-day summary. Without
       the three-hourly feed, days three onwards have a summary and nothing to
       show hour by hour. */
    const point = (product) =>
      `https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/${product}` +
      `?datasource=BD1&includeLocationName=true&latitude=${latitude}&longitude=${longitude}` +
      `&excludeParameterMetadata=true`;

    const [hourlyRes, dailyRes, threeHourlyRes] = await Promise.all([
      fetch(point('hourly'), { headers: { apikey: DATAHUB_API_KEY } }),
      fetch(point('daily'), { headers: { apikey: DATAHUB_API_KEY } }),
      // Tolerated separately below: this one is an enhancement, and losing it
      // must not cost the reader the forecast the other two already provide.
      fetch(point('three-hourly'), { headers: { apikey: DATAHUB_API_KEY } }).catch(() => null),
    ]);

    /* Say WHICH failure this is. "Met Office API error: 502" told the user
       nothing and told whoever debugged it less — 401 and 403 mean the key is
       missing, revoked or not subscribed to the site-specific product, which is
       a completely different fix from a genuine upstream outage. */
    const upstreamFailure = async (res, which) => {
      const errText = await res.text().catch(() => '');
      console.error(`DataHub ${which} error:`, res.status, errText.slice(0, 400));

      /* Pass Met Office's own words through. 401 and 403 both looked like "bad
         key" from the status alone, but 403 is usually the DAILY QUOTA on the
         free site-specific tier rather than anything wrong with the key — a
         completely different fix, and one nobody would guess from the number.
         Redact anything token-shaped first so a chatty upstream error can never
         hand the credential back to the browser. */
      let detail = '';
      try {
        const j = JSON.parse(errText);
        detail = j?.message || j?.description || j?.error?.message || j?.fault?.faultstring || '';
      } catch { detail = errText.slice(0, 200); }
      detail = String(detail).replace(/[A-Za-z0-9_-]{40,}={0,2}/g, '[redacted]').trim();

      const quota = res.status === 403 || /quota|limit|exceed/i.test(detail);
      const keyProblem = res.status === 401 || (res.status === 403 && !quota);

      let error;
      if (quota) {
        error = 'The Met Office daily request allowance has been used up. ' +
                'It resets at midnight UTC. (The forecast grid shares this same key and can spend the whole allowance in one run.)';
      } else if (keyProblem) {
        error = `Met Office rejected the request (${res.status}). The API key is missing, revoked, or not subscribed to the site-specific forecast product.`;
      } else {
        error = `Met Office ${which} data is unavailable right now (HTTP ${res.status}). Please try again shortly.`;
      }

      return Response.json({
        error,
        code: quota ? 'QUOTA_EXCEEDED' : keyProblem ? 'BAD_API_KEY' : 'UPSTREAM_ERROR',
        upstreamStatus: res.status,
        upstreamMessage: detail || null,
      }, { status: 502 });
    };

    if (!hourlyRes.ok) return await upstreamFailure(hourlyRes, 'hourly');
    if (!dailyRes.ok) return await upstreamFailure(dailyRes, 'daily');

    const hourlyData = await hourlyRes.json();
    const dailyData = await dailyRes.json();
    const threeHourlyData = threeHourlyRes?.ok
      ? await threeHourlyRes.json().catch(() => null)
      : null;

    // 3. Parse and shape the data
    const result = parseWeatherData(hourlyData, dailyData, name, latitude, longitude, locationTimeZone);
    /* The raw hourly GeoJSON goes back too. The Location Weather page has its
       own transform built around this exact payload; passing it through means
       moving the key server-side did not also require rewriting that page's
       rendering, which is where the risk would have been. */
    result.rawHourly = hourlyData;
    /* The daily GeoJSON goes back as well. DataHub's hourly product only runs
       about 48 hours ahead, so a page building its day list purely from hourly
       data can never show more than two or three days however many it asks for.
       The seven-day view is built from this feed, with hourly detail attached
       to whichever days it reaches. */
    result.rawDaily = dailyData;
    // Null when the product is unavailable; the page falls back to showing the
    // day's summary alone rather than breaking.
    result.rawThreeHourly = threeHourlyData;

    cacheSet(cacheKey, result);
    return Response.json(result);
  } catch (error) {
    console.error('Error fetching Met Office weather:', error);
    return Response.json({ error: 'Failed to fetch weather data. Please try again.' }, { status: 500 });
  }
});

/* Country lookup for a known point. `fallbackName` is the label the reader
   already saw in the suggestion list, kept so the heading does not change under
   them just because the reverse lookup words it differently. */
async function reverseLocation(lat, lon, fallbackName) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`,
      { headers: { 'User-Agent': 'WeatherApp/1.0' } }
    );
    if (!response.ok) throw new Error('Reverse lookup failed');
    const result = await response.json();
    if (!result || result.error) return null;
    const addr = result.address || {};
    return {
      name: fallbackName
        || addr.town || addr.city || addr.village || addr.county
        || result.display_name?.split(',')[0] || 'Selected location',
      latitude: lat,
      longitude: lon,
      countryCode: addr.country_code?.toLowerCase() || null,
      country: addr.country || null,
    };
  } catch (error) {
    console.error('Reverse location error:', error);
    return null;
  }
}

async function searchLocation(query) {
  try {
    // First try worldwide search (no country restriction)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': 'WeatherApp/1.0' } }
    );
    if (!response.ok) throw new Error('Location search failed');
    const results = await response.json();
    if (!results || results.length === 0) return null;
    const result = results[0];
    return {
      name: result.display_name?.split(',')[0] || result.name || query,
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      // Searched worldwide on purpose: we need to know a place resolved to
      // France in order to say so. Restricting the query to GB would instead
      // return the nearest British match for "Paris", which is worse.
      countryCode: result.address?.country_code?.toLowerCase() || null,
      country: result.address?.country || null,
    };
  } catch (error) {
    console.error('Location search error:', error);
    return null;
  }
}

// Met Office significant weather codes → description strings
// Even codes = night variants, odd codes = day variants (for shower types)
function significantWeatherCodeToDescription(code, isNight = false) {
  const map = {
    0: isNight ? 'Clear Night' : 'Sunny',
    1: 'Sunny',
    2: 'Partly Cloudy',
    3: 'Partly Cloudy',
    4: 'Dusty',
    5: 'Mist',
    6: 'Fog',
    7: 'Cloudy',
    8: 'Overcast',
    9: 'Light Showers',
    10: 'Light Showers',
    11: 'Drizzle',
    12: 'Light Rain',
    13: 'Heavy Showers',
    14: 'Heavy Showers',
    15: 'Heavy Rain',
    16: 'Sleet Showers',
    17: 'Sleet Showers',
    18: 'Sleet',
    19: 'Hail Showers',
    20: 'Hail Showers',
    21: 'Hail',
    22: 'Light Snow Showers',
    23: 'Light Snow Showers',
    24: 'Light Snow',
    25: 'Heavy Snow Showers',
    26: 'Heavy Snow Showers',
    27: 'Heavy Snow',
    28: 'Thundery Shower',
    29: 'Thundery Shower',
    30: 'Thunderstorm with Hail',
  };
  return map[code] ?? 'Cloudy';
}

function weatherCodeToIconKey(code, isNight, precipProb) {
  if (code == null) return 'Cloudy';
  // For partly cloudy, show sun/moon when precip ≤ 50%
  const showCelestialPartly = (precipProb ?? 0) <= 50;
  // For shower/precipitation icons, only show sun/moon peeking when precip ≤ 50%
  const showCelestialShower = (precipProb ?? 100) <= 50;

  switch (code) {
    case 0: case 1:
      return isNight ? 'Clear Night' : 'Sunny';
    case 2: return showCelestialPartly ? (isNight ? 'Sunny Intervals Night' : 'Sunny Intervals') : 'Cloudy';
    case 3: return showCelestialPartly ? (isNight ? 'Sunny Intervals Night' : 'Sunny Intervals') : 'Cloudy';
    case 4: return 'Cloudy';
    case 5: return 'Mist';
    case 6: return 'Fog';
    case 7: return 'Cloudy';
    case 8: return 'Overcast';
    case 9: return showCelestialShower ? (isNight ? 'Rain Shower Night' : 'Rain Shower') : 'Rain Shower Cloud';
    case 10: return showCelestialShower ? (isNight ? 'Rain Shower Night' : 'Rain Shower') : 'Rain Shower Cloud';
    case 11: return isNight ? 'Drizzle Night' : 'Drizzle';
    case 12: return isNight ? 'Light Rain Night' : 'Light Rain';
    case 13: return showCelestialShower ? (isNight ? 'Heavy Showers Night' : 'Heavy Showers') : 'Heavy Showers Cloud';
    case 14: return showCelestialShower ? (isNight ? 'Heavy Showers Night' : 'Heavy Showers') : 'Heavy Showers Cloud';
    case 15: return isNight ? 'Heavy Rain Night' : 'Heavy Rain';
    case 16: return showCelestialShower ? (isNight ? 'Sleet Night' : 'Sleet') : 'Sleet Cloud';
    case 17: return showCelestialShower ? (isNight ? 'Sleet Night' : 'Sleet') : 'Sleet Cloud';
    case 18: return isNight ? 'Sleet Night' : 'Sleet';
    case 19: return showCelestialShower ? (isNight ? 'Hail Night' : 'Hail') : 'Hail Cloud';
    case 20: return showCelestialShower ? (isNight ? 'Hail Night' : 'Hail') : 'Hail Cloud';
    case 21: return isNight ? 'Hail Night' : 'Hail';
    case 22: return showCelestialShower ? (isNight ? 'Light Snow Night' : 'Light Snow') : 'Light Snow Cloud';
    case 23: return showCelestialShower ? (isNight ? 'Light Snow Night' : 'Light Snow') : 'Light Snow Cloud';
    case 24: return isNight ? 'Light Snow Night' : 'Light Snow';
    case 25: return showCelestialShower ? (isNight ? 'Heavy Snow Night' : 'Heavy Snow') : 'Heavy Snow Cloud';
    case 26: return showCelestialShower ? (isNight ? 'Heavy Snow Night' : 'Heavy Snow') : 'Heavy Snow Cloud';
    case 27: return isNight ? 'Heavy Snow Night' : 'Heavy Snow';
    case 28: return showCelestialShower ? (isNight ? 'Thundery Shower Night' : 'Thundery Shower') : 'Thundery Shower Cloud';
    case 29: return showCelestialShower ? (isNight ? 'Thundery Shower Night' : 'Thundery Shower') : 'Thundery Shower Cloud';
    case 30: return 'Thunderstorms';
    default: return 'Cloudy';
  }
}

// Calculate sunrise/sunset using the sunrise equation for a given lat/lon and date
function calcSunriseSunset(lat, lon, dateStr) {
  const date = new Date(dateStr + 'T12:00:00Z');
  const JD = date / 86400000 + 2440587.5;
  const n = Math.round(JD - 2451545.0 - 0.0009 - lon / 360);
  const Jstar = 2451545.0 + 0.0009 + lon / 360 + n;
  const M = (357.5291 + 0.98560028 * (Jstar - 2451545)) % 360;
  const Mr = M * Math.PI / 180;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const lr = lambda * Math.PI / 180;
  const Jtransit = Jstar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr);
  const sinDec = Math.sin(lr) * Math.sin(23.45 * Math.PI / 180);
  const cosDec = Math.cos(Math.asin(sinDec));
  const latr = lat * Math.PI / 180;
  const cosHa = (Math.sin(-0.8333 * Math.PI / 180) - Math.sin(latr) * sinDec) / (Math.cos(latr) * cosDec);
  if (cosHa < -1 || cosHa > 1) return { sunrise: null, sunset: null };
  const Ha = Math.acos(cosHa) * 180 / Math.PI;
  const Jrise = Jtransit - Ha / 360;
  const Jset = Jtransit + Ha / 360;
  const toISO = (jd) => {
    const ms = (jd - 2440587.5) * 86400000;
    return new Date(ms).toISOString();
  };
  return { sunrise: toISO(Jrise), sunset: toISO(Jset) };
}

function getWindDirection(degrees) {
  if (degrees == null) return 'N/A';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

function formatHour(hour) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period}`;
}

function mpsToMph(mps) {
  if (mps == null) return null;
  return Math.round(mps * 2.23694);
}

// Pre-compute sun times for all dates in the dataset to avoid repeated calls
function buildSunTimesCache(lat, lon, dates) {
  const cache = {};
  for (const dateStr of dates) {
    cache[dateStr] = calcSunriseSunset(lat, lon, dateStr);
  }
  return cache;
}

function parseWeatherData(hourlyGeoJson, dailyGeoJson, locationName, lat, lon, locationTimeZone) {
  const hourlyProps = hourlyGeoJson?.features?.[0]?.properties || {};
  const dailyProps = dailyGeoJson?.features?.[0]?.properties || {};

  const hourlyTimeSeries = hourlyProps.timeSeries || [];
  const dailyTimeSeries = dailyProps.timeSeries || [];

  // Use the detected timezone from Open-Meteo (accurate for any global location)
  // Fallback chain: detected -> Met Office metadata -> UTC
  const timeZone = locationTimeZone || hourlyProps.metadata?.location?.timeZone || 'UTC';

  const now = new Date();
  // Use local date string (not UTC) so todayStr matches the localDateStr grouping
  const todayStr = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
    .format(now).split('/').reverse().join('-');
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(now));

  // Pre-compute sun times for every unique date in the hourly series
  const allDates = [...new Set(hourlyTimeSeries.map(h => h.time.split('T')[0]))];
  const sunCache = buildSunTimesCache(lat, lon, allDates);

  const hourlyByDate = {};
  let nextHourRain = null;
  let currentHourData = null;

  for (const h of hourlyTimeSeries) {
    const t = new Date(h.time);
    // Use the LOCAL date for grouping (so 11 PM local doesn't flip to next UTC day)
    const localDateStr = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
      .format(t).split('/').reverse().join('-');
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(t));

    const isRelevant = (localDateStr === todayStr && hour >= nowHour) || localDateStr > todayStr;

    if (isRelevant) {
      if (!hourlyByDate[localDateStr]) hourlyByDate[localDateStr] = [];

      const windDeg = h.windDirectionFrom10m ?? null;
      const precipProb = Math.min(100, Math.round(h.probOfPrecipitation ?? 0));
      const code = h.significantWeatherCode;

      // Determine isNight using calculated sunrise/sunset
      // Use the UTC date for sun lookup since calcSunriseSunset works in UTC
      const utcDateStr = h.time.split('T')[0];
      const sunTimes = sunCache[utcDateStr] || calcSunriseSunset(lat, lon, utcDateStr);
      let isNight = false;
      if (sunTimes.sunrise && sunTimes.sunset) {
        const slotTime = t.getTime();
        const sunriseMs = new Date(sunTimes.sunrise).getTime();
        const sunsetMs = new Date(sunTimes.sunset).getTime();
        isNight = slotTime < sunriseMs || slotTime >= sunsetMs;
      } else {
        isNight = hour < 6 || hour >= 21;
      }

      hourlyByDate[localDateStr].push({
        time: h.time,
        hour: formatHour(hour),
        temp: h.screenTemperature != null ? Math.round(h.screenTemperature) : null,
        rainChance: precipProb,
        precipRate: h.precipitationRate != null ? Math.round(h.precipitationRate * 10) / 10 : null,
        windSpeed: mpsToMph(h.windSpeed10m),
        windGust: mpsToMph(h.windGustSpeed10m),
        windDeg,
        windDirection: getWindDirection(windDeg),
        humidity: h.screenRelativeHumidity != null ? Math.round(h.screenRelativeHumidity) : null,
        visibility: h.visibility ?? null,
        description: significantWeatherCodeToDescription(code, isNight),
        iconKey: weatherCodeToIconKey(code, isNight, precipProb),
        significantWeatherCode: code,
        isNight,
      });

      if (hour === nowHour) currentHourData = h;
      if (hour === nowHour + 1) nextHourRain = precipProb;
    }
  }

  const hourly = hourlyByDate[todayStr] || [];

  // Past 24h rain
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let past24hRain = 0;
  for (const h of hourlyTimeSeries) {
    const t = new Date(h.time);
    const dateStr = t.toISOString().split('T')[0];
    const hour = t.getUTCHours();
    const isYesterday = dateStr === yesterdayStr && hour >= nowHour;
    const isToday = dateStr === todayStr && hour <= nowHour;
    if ((isYesterday || isToday) && h.precipitationRate != null) {
      past24hRain += h.precipitationRate;
    }
  }
  past24hRain = Math.round(past24hRain * 10) / 10;

  // Daily forecast
  const forecast = [];
  const dailyByDate = {};
  for (const d of dailyTimeSeries) {
    const dateStr = d.time.split('T')[0];
    if (!dailyByDate[dateStr]) dailyByDate[dateStr] = [];
    dailyByDate[dateStr].push(d);
  }

  // Seven, not five: the daily product runs a full week and the page shows it.
  const sortedDates = Object.keys(dailyByDate).filter(d => d >= todayStr).sort().slice(0, 7);

  for (const date of sortedDates) {
    const dayEntry = dailyByDate[date][0];
    const isToday = date === todayStr;

    const maxTemp = dayEntry?.dayMaxScreenTemperature ?? null;
    const minTemp = dayEntry?.nightMinScreenTemperature ?? null;
    const rainChance = dayEntry?.dayProbabilityOfPrecipitation ?? 0;
    const windSpeedMps = dayEntry?.midday10MWindSpeed ?? dayEntry?.midnight10MWindSpeed ?? null;
    const windSpeed = mpsToMph(windSpeedMps);
    const windGustMps = dayEntry?.midday10MWindGust ?? dayEntry?.midnight10MWindGust ?? null;
    const windGust = mpsToMph(windGustMps);
    const windDeg = dayEntry?.midday10MWindDirection ?? dayEntry?.midnight10MWindDirection ?? null;
    const sunTimes = calcSunriseSunset(lat, lon, date);

    // Determine isNight for the daily card icon (only for today, based on current time vs sunrise/sunset)
    let dailyIsNight = false;
    if (date === todayStr && sunTimes.sunrise && sunTimes.sunset) {
      const nowMs = now.getTime();
      const sunriseMs = new Date(sunTimes.sunrise).getTime();
      const sunsetMs = new Date(sunTimes.sunset).getTime();
      dailyIsNight = nowMs < sunriseMs || nowMs >= sunsetMs;
    }

    // Use night code + isNight flag after sunset today; day code otherwise
    const daySigCode = dayEntry?.daySignificantWeatherCode ?? null;
    const nightSigCode = dayEntry?.nightSignificantWeatherCode ?? null;
    const significantCode = dailyIsNight ? (nightSigCode ?? daySigCode) : (daySigCode ?? nightSigCode);
    const description = significantWeatherCodeToDescription(significantCode, dailyIsNight);
    const iconKey = weatherCodeToIconKey(significantCode, dailyIsNight, Math.round(rainChance));
    const uvIndex = dayEntry?.maxUvIndex ?? null;
    const humidity = dayEntry?.middayRelativeHumidity ?? dayEntry?.midnightRelativeHumidity ?? null;
    const visibility = dayEntry?.middayVisibility ?? dayEntry?.midnightVisibility ?? null;
    const pressure = dayEntry?.middayMslp != null ? Math.round(dayEntry.middayMslp / 100) : null;

    const dayForecast = {
      date,
      dayName: new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }),
      temperature: {
        max: maxTemp != null ? Math.round(maxTemp) : null,
        min: minTemp != null ? Math.round(minTemp) : null,
      },
      rainChance: Math.round(rainChance),
      precipitation: dayEntry?.dayPrecipitationAmount != null ? Math.round(dayEntry.dayPrecipitationAmount * 10) / 10 : null,
      snowfall: dayEntry?.daySnowfallAmount != null ? Math.round(dayEntry.daySnowfallAmount * 10) / 10 : null,
      windSpeed: windSpeed ?? 0,
      windSpeedMax: windSpeed ?? 0,
      windDirection: getWindDirection(windDeg),
      windDeg,
      windGust: windGust ?? 0,
      description,
      iconKey,
      significantWeatherCode: significantCode,
      uvIndex,
      sunrise: sunTimes.sunrise,
      sunset: sunTimes.sunset,
      humidity: humidity != null ? Math.round(humidity) : null,
      pressure,
      visibility,
      aqi: null,
      aqiLabel: 'Unknown',
    };

    if (isToday) {
      dayForecast.nextHourRain = nextHourRain;
      dayForecast.feelsLike = currentHourData?.screenTemperature != null
        ? Math.round(currentHourData.screenTemperature)
        : null;
    }

    dayForecast.hourly = hourlyByDate[date] || [];
    forecast.push(dayForecast);
  }

  return {
    location: {
      name: locationName,
      latitude: hourlyGeoJson?.features?.[0]?.geometry?.coordinates?.[1] ?? null,
      longitude: hourlyGeoJson?.features?.[0]?.geometry?.coordinates?.[0] ?? null,
    },
    forecast,
    hourly,
    past24h: { rain: past24hRain, snow: 0 },
    dataSource: 'Met Office DataHub',
  };
}