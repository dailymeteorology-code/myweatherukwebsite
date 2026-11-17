/* ════════════════════════════════════════════════════════════════════════════
   LOCATION WEATHER — the Met Office UKV forecast for one place, shaped for the page
   ────────────────────────────────────────────────────────────────────────────
   Every number comes from /api/location/forecast (server/locationWeather.js): the
   UKV 2 km model from the Met Office's AWS bucket, read at the place's grid cell,
   plus the 15-minute UKV + METAR analysis for "now" and the observed day so far.
   Nothing here fetches anything else; it only derives (feels-like, the weather
   type, sun and moon, summaries) from those numbers.

   UKV publishes most fields hourly to T+54 and three-hourly beyond (screen
   temperature stays hourly), so an hour can carry only a temperature: `full` marks
   the hours that have the whole picture.
   ════════════════════════════════════════════════════════════════════════════ */

const D = Math.PI / 180;

/* ── calendar and clock, always in UK time ───────────────────────────────── */
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const HM_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const H_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });
export const ukDay = (ms) => DAY_FMT.format(new Date(ms));
/** The hours from the one we are in onwards (it began within the last hour): at 21:44 the list
    starts at 21:00, shown as "Now", and 22:00 is next. Taking the nearest hour instead put 22:00
    under "Now" from half past, so the strip seemed an hour ahead of the clock. */
export const fromThisHour = (hours, nowMs = Date.now()) => hours.filter((h) => h.t > nowMs - 36e5);
export const hhmm = (ms) => HM_FMT.format(new Date(ms));
export const hourOf = (ms) => Number(H_FMT.format(new Date(ms)));
export function dayLabel(day, today = ukDay(Date.now())) {
  if (day === today) return 'Today';
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  if (Math.round((d - t) / 864e5) === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}
export const longDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/* ── the sun (NOAA's algorithm) and the moon ────────────────────────────── */
function solar(ms) {
  const jd = ms / 864e5 + 2440587.5, t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * D) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * D) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * D) * 0.000289;
  const lam = l0 + c - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * D);
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos((125.04 - 1934.136 * t) * D);
  const decl = Math.asin(Math.sin(eps * D) * Math.sin(lam * D));
  const y = Math.tan((eps * D) / 2) ** 2;
  const eqt = 4 * (y * Math.sin(2 * l0 * D) - 2 * e * Math.sin(m * D) + 4 * e * y * Math.sin(m * D) * Math.cos(2 * l0 * D)
    - 0.5 * y * y * Math.sin(4 * l0 * D) - 1.25 * e * e * Math.sin(2 * m * D)) / D;
  return { decl, eqt };
}
/** The sun's elevation (degrees) over a place at an instant. */
export function sunElevation(ms, lat, lon) {
  const { decl, eqt } = solar(ms);
  const d = new Date(ms);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const ha = ((mins + eqt + 4 * lon) / 4 - 180) * D;
  return Math.asin(Math.sin(lat * D) * Math.sin(decl) + Math.cos(lat * D) * Math.cos(decl) * Math.cos(ha)) / D;
}
/** Sunrise, solar noon and sunset (ms) for a UK calendar day; null when the sun never crosses. */
export function sunTimes(day, lat, lon) {
  const noonUtc = Date.parse(`${day}T12:00:00Z`);
  const { decl, eqt } = solar(noonUtc);
  const noon = Date.parse(`${day}T00:00:00Z`) + (720 - 4 * lon - eqt) * 60e3;
  const cosH = (Math.sin(-0.833 * D) - Math.sin(lat * D) * Math.sin(decl)) / (Math.cos(lat * D) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return { rise: null, set: null, noon, length: cosH < -1 ? 24 : 0 };
  const h = (Math.acos(cosH) / D) * 4 * 60e3;
  return { rise: noon - h, set: noon + h, noon, length: (2 * h) / 36e5 };
}
const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
/** The moon's phase (0 new … 0.5 full … 1), lit fraction and name. */
export function moonPhase(ms) {
  const p = ((((ms / 864e5 + 2440587.5) - 2451550.1) / 29.530588853) % 1 + 1) % 1;
  return { phase: p, lit: (1 - Math.cos(2 * Math.PI * p)) / 2, name: MOON_NAMES[Math.round(p * 8) % 8] };
}

/* ── derived quantities ──────────────────────────────────────────────────── */
/** Met Office-style feels-like: wind chill at 10 °C and below, apparent temperature at 26 °C and above. */
export function feelsLike(t, td, mph) {
  if (t == null) return null;
  const v = (mph ?? 0) * 1.609344;
  if (t <= 10) {
    const p = Math.max(v, 4.8) ** 0.16;
    return Math.min(13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p, t);
  }
  if (t >= 26 && td != null) {
    const e = 6.105 * Math.exp((17.27 * td) / (237.7 + td));
    return Math.max(t + 0.33 * e - 0.7 * (v / 3.6) - 4, t);
  }
  return t;
}
/* UKV's surface UV flux is close to the UV-B band: clear-sky noon on 20 Oct 2026 was
   0.34 W/m² at 52°N and 0.25 at 56°N, where the UV index is about 1.9 and 1.4. */
export const uvIndex = (uv) => (uv == null ? null : Math.max(0, uv * 5.5));
export const uvWord = (u) => (u == null ? '—' : u < 2.5 ? 'Low' : u < 5.5 ? 'Moderate' : u < 7.5 ? 'High' : u < 10.5 ? 'Very high' : 'Extreme');
export const visWord = (km) => (km == null ? '—' : km < 1 ? 'Very poor' : km < 4 ? 'Poor' : km < 10 ? 'Moderate' : km < 20 ? 'Good' : km < 40 ? 'Very good' : 'Excellent');
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 22.5) % 16]);
export function beaufort(mph) {
  const lim = [1, 3, 7, 12, 18, 24, 31, 38, 46, 54, 63, 72];
  const names = ['Calm', 'Light air', 'Light breeze', 'Gentle breeze', 'Moderate breeze', 'Fresh breeze', 'Strong breeze', 'Near gale', 'Gale', 'Strong gale', 'Storm', 'Violent storm', 'Hurricane force'];
  const f = lim.findIndex((x) => (mph ?? 0) < x);
  return { force: f < 0 ? 12 : f, name: names[f < 0 ? 12 : f] };
}

/* ── the weather type of an hour ─────────────────────────────────────────────
   From the model's own fields, in order of what matters most: thunder, then what
   is falling (type from the snow share, intensity from the hour's amount, showers
   when the cloud is broken; snow in a strong wind is a blizzard, rain at or below
   freezing is freezing rain, 16 mm/h and over is torrential), then fog, then a
   gale on a dry hour, heat, and the cloud. Day or night from the sun.

   Wind is also a mark on its own (windyOf): an hour can be "Rain" and windy, and its
   symbol then carries the wind. Speeds are mph, the page's unit. */
const RANK = {
  thunder: 9, thunderShowers: 9, blizzard: 8.5, hail: 8, heavySnow: 8, freezingRain: 7.5, torrentialRain: 7, snow: 7, sleet: 7, mix: 6.9, snowShowers: 7,
  heavyRain: 6, heavyShowers: 6, rain: 5, showers: 4, lightRain: 3, drizzle: 2,
  fog: 1.5, mist: 1, windy: 0.9, overcast: 0.8, cloudy: 0.6, mostlyCloudy: 0.5, partly: 0.4, mostlyClear: 0.2, hot: 0.1, clear: 0,
};
const LABEL = {
  thunder: 'Thunderstorms', thunderShowers: 'Thundery showers', blizzard: 'Blizzard', hail: 'Hail', heavySnow: 'Heavy snow', snow: 'Snow',
  snowShowers: 'Snow showers', sleet: 'Sleet', mix: 'Rain and snow', freezingRain: 'Freezing rain', torrentialRain: 'Torrential rain',
  heavyRain: 'Heavy rain', heavyShowers: 'Heavy showers', rain: 'Rain', showers: 'Showers', lightRain: 'Light rain', drizzle: 'Drizzle',
  fog: 'Fog', mist: 'Mist', windy: 'Windy', overcast: 'Overcast', cloudy: 'Cloudy', mostlyCloudy: 'Mostly cloudy', partly: 'Partly cloudy', hot: 'Hot and sunny',
  sunrise: 'Sunrise', sunset: 'Sunset',
};
/* windy: a mean wind of 25 mph or gusts of 40 (Beaufort 6, near-gale gusts); a gale on a dry
   hour (35 mph, or gusts of 50) is the weather itself */
export const windyOf = (h) => (h?.gust ?? 0) >= 40 || (h?.wind ?? 0) >= 25;
const galeOf = (h) => (h?.gust ?? 0) >= 50 || (h?.wind ?? 0) >= 35;
/** The words for a weather type; `windy` adds the wind where the type does not already say it. */
export function condLabel(key, day, windy = false) {
  const base = key === 'clear' ? (day ? 'Sunny' : 'Clear') : key === 'mostlyClear' ? (day ? 'Mostly sunny' : 'Mostly clear')
    : key === 'hot' && !day ? 'Warm night' : LABEL[key] || 'Cloudy';
  return windy && !['windy', 'blizzard', 'sunrise', 'sunset'].includes(key) ? `${base} and windy` : base;
}
export function classify(h) {
  const rate = h.span > 0 && h.precip != null ? h.precip / h.span : h.precipRate ?? 0;
  const wet = rate >= 0.1 || (h.precipRate ?? 0) >= 0.2;
  const showery = (h.tcc ?? 100) < 85 || (h.cape ?? 0) >= 150;
  const snowShare = (h.precip ?? 0) > 0 && h.snow != null ? h.snow / h.precip : (h.precipRate ? (h.snowRate ?? 0) / h.precipRate : 0);
  if (wet && ((h.pThunder ?? 0) >= 30 || (h.lightning ?? 0) >= 0.01 || (h.lightning == null && (h.cape ?? 0) >= 600 && rate >= 1))) return showery && (h.tcc ?? 100) < 85 ? 'thunderShowers' : 'thunder';
  if (wet) {
    if ((h.hailRate ?? 0) >= 0.05) return 'hail';
    if (snowShare >= 0.7) {
      if (rate >= 0.7 && windyOf(h)) return 'blizzard';
      return rate >= 2 ? 'heavySnow' : showery && rate < 1 ? 'snowShowers' : 'snow';
    }
    if (snowShare >= 0.5) return 'sleet';                   // mostly wet snow
    if (snowShare >= 0.3) return 'mix';                     // rain and snow together, mostly rain
    if (h.t2 != null && h.t2 <= 0) return 'freezingRain';
    if (rate >= 16) return 'torrentialRain';
    if (rate >= 4) return showery ? 'heavyShowers' : 'heavyRain';
    if (rate >= 1) return showery ? 'showers' : 'rain';
    if (rate >= 0.25) return showery ? 'showers' : 'lightRain';
    return showery ? 'showers' : 'drizzle';
  }
  if (h.vis != null && (h.vis < 1 || (h.fog ?? 0) >= 60)) return 'fog';
  if (h.vis != null && h.vis < 5) return 'mist';
  if (galeOf(h)) return 'windy';
  const c = h.tcc ?? 50;
  if (c < 40 && (h.t2 ?? 0) >= 27 && (h.isDay ?? (h.sun ?? 0) > 0)) return 'hot';
  /* six steps of cloud, the way the sky reads from the ground: sunny, mostly sunny, partly cloudy,
     mostly cloudy (breaks of sun), cloudy, overcast (a closed grey sheet) */
  if (c < 12) return 'clear';
  /* only high cloud (thin cirrus, the sun shining through) reads as mostly sunny, where the
     layers are known: the observed "now" has the total alone */
  if (c < 35 || (h.lcc != null && h.mcc != null && h.lcc + h.mcc < 20 && c < 65)) return 'mostlyClear';
  if (c < 62) return 'partly';
  if (c < 85) return 'mostlyCloudy';
  if (c < 96) return 'cloudy';
  return 'overcast';
}
export const isWet = (k) => RANK[k] >= 2 && !['fog', 'mist'].includes(k);

/* ── the freezing level as it reads at the place ──────────────────────────────
   The UKV's freezing level is the height above the ground of the 0 C level in the air. On a frosty
   night under milder air (an inversion) that level sits hundreds of metres up while the air at the
   ground is below freezing (Aviemore, 16 Nov 2026: -2.2 C with the freezing level at 315 m). Read at
   the place, the freezing level is then the ground itself: 0 m. The height the model gives is kept as
   warmAloft, where it is worth saying (100 m or more): air above freezing over freezing ground, the
   layer that turns rain into freezing rain. Air within 0.3 C of freezing counts as freezing: under
   such a layer the 2 m temperature flickers either side of 0, and the level with it, between the ground
   and hundreds of metres (Aviemore 16 Nov 22:00, +0.1 C: 400 m for one hour between hours at 0 m). */
const AT_FREEZING = 0.3;
export const freezeLevel = (t2, frz) => (t2 != null && t2 <= AT_FREEZING ? 0 : frz ?? null);
export const warmAloft = (t2, frz) => (t2 != null && t2 <= AT_FREEZING && (frz ?? 0) >= 100 ? frz : null);

/* ── the response -> hours and days ──────────────────────────────────────── */
export async function fetchLocation(params, signal, raw = false) {
  const key = placeKey(params);
  if (!raw) {                                                // asked for ahead (prefetchLocation): that answer
    const hit = MEM.get(key);
    if (hit && Date.now() - hit.at < 60e3) {
      MEM.delete(key);
      const body = await hit.promise;
      if (body && !body.code) { writeStore(key, body); return body; }
    }
  }
  const qs = new URLSearchParams();
  if (Number.isFinite(params.lat) && Number.isFinite(params.lon)) {
    qs.set('lat', params.lat.toFixed(4)); qs.set('lon', params.lon.toFixed(4));
    if (params.name) qs.set('name', params.name);
  } else qs.set('q', params.name || '');
  const r = await fetch(`/api/location/forecast?${qs}`, { signal });
  const body = await r.json().catch(() => null);
  if (!body) throw new Error('The forecast server did not answer. Try again in a moment.');
  if (!r.ok && !body.code) throw new Error(body.error || `The forecast could not be loaded (${r.status}).`);
  if (!raw && r.ok && !body.code) writeStore(key, body);
  return body;
}

/* ── TCM NOVA thunderstorm risk ─────────────────────────────────────────────
   MyWeatherUK's own thunderstorm model (server/novaPoint.js): the chance of a thunderstorm near
   the place each hour, in the bands the TCM NOVA page uses. */
export const THUNDER_LEVELS = [
  { min: 60, key: 'HIGH', word: 'High', colour: '#c084fc' },
  { min: 45, key: 'MDT', word: 'Moderate', colour: '#f87171' },
  { min: 30, key: 'ENH', word: 'Enhanced', colour: '#fb923c' },
  { min: 15, key: 'SLGT', word: 'Slight', colour: '#facc15' },
  { min: 5, key: 'MRGL', word: 'Marginal', colour: '#4ade80' },
  { min: 2, key: 'TSTM', word: 'Low', colour: '#7dd3fc' },
];
/** The band for a chance (%): { key, word, colour }, or null under 2 %. */
export const thunderRisk = (p) => (p == null ? null : THUNDER_LEVELS.find((l) => p >= l.min) || null);

/* ── the snow chance each hour: MyWeatherUK's snow conditions index ─────────────────────────────
   (tools/modeldata/mdata/derived.py snow_conditions: what snow needs coming together, something
   falling or about to and the temperatures right for it to settle as snow), in five steps and the
   colours of the user's own chart (15 Nov 2026). Shown as the "snow chance", the user's word. */
export const SNOW_CHANCE = [
  { level: 1, word: 'Very low', short: 'V low', colour: '#9ca3af', ink: '#0b1a2c' },
  { level: 2, word: 'Low', short: 'Low', colour: '#ffffff', ink: '#0b1a2c' },
  { level: 3, word: 'Moderate', short: 'Mod', colour: '#d9363e', ink: '#ffffff' },
  { level: 4, word: 'High', short: 'High', colour: '#8e3fbf', ink: '#ffffff' },
  { level: 5, word: 'Very high', short: 'V high', colour: '#7cc47f', ink: '#0b1a2c' },
];
/** The step for an index value (0 none .. 5 very high), or null. */
export const snowChance = (v) => (v == null || v < 0.5 ? null : SNOW_CHANCE[Math.min(5, Math.round(v)) - 1]);

/* ── what is falling: five kinds, each in its own colour ──────────────────────────────────────────
   By the share of it falling as snow, as the rest of the site types precipitation (rain under 30 %,
   snow from 70 %: mdata/derived.py), with the middle split in two, rain and snow mixed (mostly rain,
   under 50 %) and sleet (mostly wet snow); rain at or below freezing, and the model's hail, are ice. */
export const PRECIP_KINDS = {
  rain: { name: 'Rain', top: '#7cc9ff', bottom: '#2a7fff' },
  mix: { name: 'Mix', long: 'Rain and snow mixed', top: '#d2c4ff', bottom: '#7c4dff' },
  sleet: { name: 'Sleet', long: 'Sleet (wet snow)', top: '#9af0dd', bottom: '#12b09a' },
  snow: { name: 'Snow', top: '#f8d2f4', bottom: '#c450cf' },
  ice: { name: 'Ice', long: 'Freezing rain or hail', top: '#ffcf9c', bottom: '#e5660e' },
};
export const KIND_KEYS = ['rain', 'mix', 'sleet', 'snow', 'ice'];
/** The kind for a share falling as snow (0-1), the temperature, and the model's hail rate. */
export function kindOf(share, t2, hail = 0, rate = 0) {
  if ((hail ?? 0) >= 0.1 && hail >= rate / 3) return 'ice';
  const s = share ?? 0;
  if (s >= 0.7) return 'snow';
  if (s >= 0.5) return 'sleet';
  if (s >= 0.3) return 'mix';
  return t2 != null && t2 <= 0 ? 'ice' : 'rain';
}
/** The share of an hour's precipitation falling as snow (its amounts, else its rates). */
export const snowShareOf = (h) => ((h.precip ?? 0) > 0 && h.snow != null ? Math.min(1, h.snow / h.precip)
  : h.precipRate ? Math.min(1, (h.snowRate ?? 0) / h.precipRate) : 0);
/** mm/h over an hour (its amount over the hours it covers), or the rate at it. */
export const rateOf = (h) => (h.span > 0 && h.precip != null ? h.precip / h.span : h.precipRate ?? 0);

/* ── a place's forecast kept for a while and asked for ahead ─────────────────────────────────────
   A place opened again shows at once from what was last fetched (for up to 20 minutes, while the fresh
   one loads), and a suggestion the pointer rests on is fetched before it is clicked. */
const MEM = new Map();                                       // key -> { at, promise }
const CACHE_KEY = 'lw-forecast-cache-v2';
const placeKey = (p) => (Number.isFinite(p.lat) && Number.isFinite(p.lon) ? `${p.lat.toFixed(3)},${p.lon.toFixed(3)}` : `q:${(p.name || '').toLowerCase()}`);
function readStore() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } }
function writeStore(key, body) {
  try {
    const all = readStore();
    all[key] = { at: Date.now(), body };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const k of keys.slice(5)) delete all[k];            // the five places opened last
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* storage full or blocked: only the cache is lost */ }
}
/** What was last fetched for a place, if it is under 20 minutes old. */
export function cachedLocation(p) {
  const hit = readStore()[placeKey(p)];
  return hit && Date.now() - hit.at < 20 * 60e3 ? hit.body : null;
}
/** What was last fetched for a place at any age, with when ({ body, at }): shown offline (Phase F). */
export function cachedLocationAny(p) {
  const hit = readStore()[placeKey(p)];
  return hit?.body?.location ? hit : null;
}
/** The place opened last on this device ({ name, lat, lon }), for the installed app's first screen. */
export function lastOpenedPlace() {
  const all = Object.values(readStore()).filter((x) => x?.body?.location);
  if (!all.length) return null;
  const { location: l } = all.sort((a, b) => b.at - a.at)[0].body;
  return { name: l.name, lat: l.lat, lon: l.lon };
}
/** Start fetching a place before it is picked (a suggestion hovered or focused). */
export function prefetchLocation(p) {
  const key = placeKey(p);
  const hit = MEM.get(key);
  if (hit && Date.now() - hit.at < 60e3) return;
  const promise = fetchLocation(p, undefined, true).catch(() => null);
  MEM.set(key, { at: Date.now(), promise });
  while (MEM.size > 12) MEM.delete(MEM.keys().next().value);
}

export function shape(resp) {
  const { location: loc, forecast: fc, now: an, observed, nova } = resp;
  const { lat, lon } = loc;
  const V = fc.v;
  if (!fc.times.length) throw new Error('This forecast has no hours yet. Try again in a few minutes.');
  const at = (k, i) => (V[k] ? V[k][i] : null);
  const novaAt = new Map((nova?.times || []).map((t, k) => [t, { p: nova.p[k], src: nova.src[k], nb: nova.nb_km[k] }]));
  const hours = fc.times.map((t, i) => {
    const h = {
      t, i, day: ukDay(t), run: fc.src[i], span: fc.span[i],
      t2: at('t2', i), td: at('td2', i), rh: at('rh2', i), ground: at('tskin', i),
      wind: at('wind10', i), gust: at('gust10', i), wdir: at('wdir10', i), mslp: at('mslp', i),
      precipRate: at('precip_rate', i), precip: at('precip_step', i), snowRate: at('snow_rate', i), snow: at('snow_step', i),
      hailRate: at('hail_rate', i), tcc: at('tcc', i), lcc: at('lcc', i), mcc: at('mcc', i), hcc: at('hcc', i),
      cloudBase: at('cloud_base', i), vis: at('vis', i), fog: at('fog', i), cape: at('cape_mu', i), lightning: at('lightning', i),
      frz: at('frz', i), snowLying: at('snow_swe', i), sw: at('sw_down', i), uvi: uvIndex(at('uv_down', i)),
      pRain: fc.p_rain[i], pThunder: fc.p_thunder[i], nova: novaAt.get(t) ?? null, snowCond: at('snow_cond', i),
    };
    h.full = h.tcc != null && h.wind != null;
    h.feels = feelsLike(h.t2, h.td, h.wind);
    h.sun = sunElevation(t, lat, lon);
    h.isDay = h.sun > -0.833;
    h.cond = h.full ? classify(h) : null;
    h.windy = h.full && windyOf(h);
    h.kind = kindOf(snowShareOf(h), h.t2, h.hailRate, rateOf(h));
    return h;
  });
  /* a temperature-only hour borrows the look of the nearest full hour */
  const full = hours.filter((h) => h.full);
  for (const h of hours) {
    if (h.full) continue;
    let best = null;
    for (const f of full) if (!best || Math.abs(f.t - h.t) < Math.abs(best.t - h.t)) best = f;
    if (best) { h.cond = best.cond; h.windy = best.windy; }
  }
  /* ...and its feels-like from the wind and dew point drawn between the full hours either side (past
     T+54 the UKV gives them every three hours, the temperature every hour): worked out as if calm, the
     feels-like line saw-toothed (-1.9 between hours of -3.9) */
  hours.forEach((h, i) => {
    if (h.full || h.t2 == null) return;
    let a = i - 1, b = i + 1;
    while (a >= 0 && !hours[a].full) a--;
    while (b < hours.length && !hours[b].full) b++;
    const A = hours[a], B = hours[b];
    if (!A && !B) return;
    const f = A && B ? (h.t - A.t) / (B.t - A.t) : 0;
    const mix = (k) => (A && B && A[k] != null && B[k] != null ? A[k] + (B[k] - A[k]) * f : (A || B)[k]);
    h.feels = feelsLike(h.t2, mix('td'), mix('wind'));
  });
  for (const h of hours) { h.freeze = freezeLevel(h.t2, h.frz); h.warmAloft = warmAloft(h.t2, h.frz); }

  const nowMs = Date.now();
  const nowIdx = Math.max(0, hours.findIndex((h) => h.t >= nowMs - 30 * 60e3));
  const cur = hours[nowIdx] || hours[0];
  const minutely = nextHour(resp.nowcast, cur, nowMs);
  /* NOW: the 15-minute analysis where it has the field (it is UKV corrected by the latest
     station reports), the forecast hour otherwise; the radar, carried forward to this minute,
     decides whether it is raining and how hard */
  const radarRate = minutely?.mins[0]?.rate ?? an?.radar;
  const nowHour = {
    ...cur,
    t2: an?.t2 ?? cur.t2, td: an?.td2 ?? cur.td, rh: an?.rh2 ?? cur.rh, wind: an?.wind10 ?? cur.wind,
    gust: an?.gust10 ?? cur.gust, wdir: an?.wdir10 ?? cur.wdir, mslp: an?.mslp ?? cur.mslp, tcc: an?.tcc ?? cur.tcc,
    /* the observed cloud has no layers: the forecast hour's would contradict it (an hour the UKV
       had cloudless read "Mostly clear" under the analysis' 64 %) */
    ...(an?.tcc != null ? { lcc: null, mcc: null, hcc: null } : {}),
    precipRate: radarRate ?? cur.precipRate, span: radarRate != null ? 0 : cur.span, precip: radarRate != null ? null : cur.precip,
    sun: sunElevation(nowMs, lat, lon), analysed: !!an,
  };
  nowHour.isDay = nowHour.sun > -0.833;
  nowHour.feels = an?.feels ?? feelsLike(nowHour.t2, nowHour.td, nowHour.wind);
  /* what is falling now: the radar's type at this minute where it has one (the current-conditions
     analysis'), else the hour's own snow share, applied to the radar's rate */
  const kind0 = minutely?.mins[0]?.rate >= 0.1 ? minutely.mins[0].kind : null;
  if (radarRate != null) {
    const share = kind0 ? { rain: 0, mix: 0.4, sleet: 0.6, snow: 1, ice: 0 }[kind0] : snowShareOf(cur);
    nowHour.snowRate = radarRate * share;
    nowHour.snow = null;
  }
  nowHour.cond = classify(nowHour);
  nowHour.windy = windyOf(nowHour);
  nowHour.kind = kind0 || kindOf(snowShareOf(nowHour), nowHour.t2, nowHour.hailRate, nowHour.precipRate ?? 0);
  nowHour.freeze = freezeLevel(nowHour.t2, cur.frz);
  nowHour.warmAloft = warmAloft(nowHour.t2, cur.frz);

  /* the days, Day and Night: the MWUK Mix, then the Met Office Global (outlookOf), from the UKV's own
     hours (for the UV), TCM NOVA, MWUK FROST and today so far */
  const novaModel = nova ? { ...nova, hours: nova.times.map((t, k) => ({ t, p: nova.p[k], src: nova.src[k], nb: nova.nb_km[k] })) } : null;
  let outlook = null;
  try { outlook = outlookOf(resp, { hours, nova: novaModel, frost: resp.frost || null, observed }, nowMs); } catch { outlook = null; }
  /* The hours past the UKV's end (T+120): the outlook's own steps, three- and six-hourly from the Met
     Office Global, so the hourly strip and the detailed forecast reach the last day too (the user:
     "add Saturday"). Marked `ext`, with the model they came from. */
  const lastT = hours.length ? hours[hours.length - 1].t : 0;
  const ext = (outlook?.steps || []).filter((x) => x.t > lastT && x.full).map((x) => ({
    ...x, i: -1, day: ukDay(x.t), run: null, ext: true, src: x.model, nova: novaAt.get(x.t) ?? null,
    pThunder: null, lightning: null, cloudBase: null, frz: null, freeze: null, warmAloft: null, snowLying: null,
  }));
  const allHours = [...hours, ...ext], allFull = [...full, ...ext];

  /* days, in UK time */
  const today = ukDay(nowMs);
  const byDay = new Map();
  for (const h of allHours) {
    if (h.day < today) continue;
    if (!byDay.has(h.day)) byDay.set(h.day, []);
    byDay.get(h.day).push(h);
  }
  const days = [...byDay.entries()].map(([day, hs]) => {
    const isToday = day === today;
    const ahead = isToday ? hs.filter((h) => h.t >= nowMs - 60 * 60e3) : hs;
    const temps = hs.map((h) => h.t2).filter((v) => v != null);
    let hi = temps.length ? Math.max(...temps) : null, lo = temps.length ? Math.min(...temps) : null;
    if (isToday && observed) {                                     // the hours already gone, as observed
      if (observed.t2_max != null) hi = Math.max(hi ?? -99, observed.t2_max);
      if (observed.t2_min != null) lo = Math.min(lo ?? 99, observed.t2_min);
    }
    const fullHs = hs.filter((h) => h.full);
    const sum = (list, k) => list.reduce((s, h) => s + (h.span > 0 ? h[k] ?? 0 : 0), 0);
    /* today: the radar's rain since midnight and the forecast for the hours still to come. The
       forecast's own total for the whole day counted the hours already gone as forecast, so a
       wet night under a dry morning still read as a rainy day. */
    const rainSoFar = isToday && observed?.precip_total != null ? observed.precip_total : null;
    const rainAhead = rainSoFar != null ? sum(fullHs.filter((h) => h.t > nowMs), 'precip') : null;
    const rain = rainSoFar != null ? rainSoFar + rainAhead : sum(fullHs, 'precip');
    const snow = sum(fullHs, 'snow');
    const daylight = fullHs.filter((h) => h.isDay);
    const pool = (isToday ? ahead.filter((h) => h.full) : daylight.length ? daylight : fullHs);
    /* the day's weather: the most telling daytime hour once rain is worth a mention, else the cloud */
    let cond = 'cloudy';
    if (pool.length) {
      const wetHours = pool.filter((h) => isWet(h.cond));
      if (wetHours.length && (rain >= 0.5 || wetHours.length >= 2)) cond = wetHours.reduce((a, b) => (RANK[b.cond] > RANK[a.cond] ? b : a)).cond;
      else {
        const dry = pool.filter((h) => !isWet(h.cond));
        const fogs = dry.filter((h) => h.cond === 'fog').length;
        const c = dry.reduce((s, h) => s + (h.tcc ?? 50), 0) / Math.max(1, dry.length);
        cond = fogs >= Math.max(2, dry.length / 2) ? 'fog' : c < 15 ? 'clear' : c < 38 ? 'mostlyClear' : c < 62 ? 'partly' : c < 82 ? 'mostlyCloudy' : c < 94 ? 'cloudy' : 'overcast';
        if (dry.filter((h) => h.cond === 'windy').length >= 2) cond = 'windy';
        else if (dry.filter((h) => h.cond === 'hot').length >= 2) cond = 'hot';
      }
    }
    const max = (k) => { const v = fullHs.map((h) => h[k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const strongest = fullHs.reduce((a, b) => ((b.wind ?? 0) > (a?.wind ?? -1) ? b : a), null);
    /* the day's thunderstorm risk: its riskiest NOVA hour still to come (every hour of the day,
       the 3-hourly UKV hours too) */
    const dayNova = (nova?.times || []).map((t, k) => ({ t, p: nova.p[k] })).filter((x) => ukDay(x.t) === day && x.t >= nowMs - 60 * 60e3);
    const thunderPeak = dayNova.length ? dayNova.reduce((a, b) => (b.p > a.p ? b : a)) : null;
    const windyHours = pool.filter((h) => h.windy).length;
    return {
      day, label: dayLabel(day, today), isToday, hi, lo, cond, rain, rainSoFar, rainAhead, snow, windy: windyHours >= 2,
      pRain: max('pRain'), pThunder: max('pThunder'), thunderPeak, gust: max('gust'), wind: max('wind'), wdir: strongest?.wdir ?? null,
      uvi: max('uvi'), cape: max('cape'), sun: sunTimes(day, lat, lon), hours: hs,
      partial: hs.length && (hs[hs.length - 1].t - hs[0].t) < 18 * 36e5 && !isToday,
    };
  /* a day the forecast only touches (the last step at midnight) is no day to show */
  }).filter((d) => d.isToday || (d.hours[d.hours.length - 1].t - d.hours[0].t) >= 6 * 36e5);

  return {
    location: loc, hours: allHours, full: allFull, days, now: nowHour, nowIdx, observed, analysis: an, minutely,
    /* yesterday's observed day at the place (its high, for "colder than yesterday": Phase E) */
    yesterday: resp.yesterday || null,
    runs: fc.runs, cell: fc.cell, lat, lon, anchor: fc.anchor || null, outlook,
    /* every NOVA hour (not only the UKV's: hourly to the end of the Main Run) */
    nova: novaModel,
    /* the place's snow from MWUK FROST, MyWeatherUK's snow model (server/tcmFrost.js frostPoint) */
    frost: resp.frost || null,
  };
}

/* ── the next hour, minute by minute (the radar nowcast) ────────────────────
   The server sends 90 minutes from when it was asked; the page re-derives every minute, so
   the hour shown always starts at this minute. Rain or snow from the hour's model snow share. */
/* rain bands, mm/h: light from 0.1, moderate from 1, heavy from 4 (as classify() words them) */
export const bandOf = (r) => (r == null || r < 0.1 ? 0 : r < 1 ? 1 : r < 4 ? 2 : 3);
function nextHour(nc, cur, nowMs) {
  if (!nc?.rate?.length) return null;
  const from = Math.max(0, Math.floor((nowMs - Date.parse(nc.start)) / 60e3));
  const snowShare = snowShareOf(cur);
  /* each minute's kind: the radar's type carried with the rain (server: 0 rain, 1 the sleet band,
     2 snow, 3 ice), the sleet band split by the hour's own snow share; the hour's kind without one */
  const hourKind = (cur.precip ?? 0) > 0 || (cur.precipRate ?? 0) > 0 ? cur.kind : (cur.t2 ?? 9) <= 1 ? 'snow' : 'rain';
  const kindAt = (c) => (c == null ? hourKind : c === 0 ? 'rain' : c === 2 ? 'snow' : c === 3 ? 'ice' : snowShare >= 0.5 ? 'sleet' : 'mix');
  const mins = [];
  for (let k = 0; k <= 90; k++) {
    const i = from + k;
    if (i >= nc.rate.length || nc.rate[i] == null) break;
    mins.push({ t: Date.parse(nc.start) + i * 60e3, rate: nc.rate[i], chance: nc.chance[i] ?? 0, kind: kindAt(nc.kind?.[i]) });
  }
  if (mins.length < 31) return null;                                // too stale to say anything about the hour
  /* the minutes after the hour shown are kept for the quarter hours (quartersOf) */
  const all = mins;
  const hour = all.slice(0, 61);
  const wetKinds = hour.filter((m) => m.rate >= 0.1).map((m) => m.kind);
  const main = wetKinds.length ? KIND_KEYS.reduce((a, b) => (wetKinds.filter((x) => x === b).length > wetKinds.filter((x) => x === a).length ? b : a)) : hourKind;
  return { mins: hour, all, kind: main, snow: ['snow', 'sleet'].includes(main), scan: Date.parse(nc.scan), motion: nc.motion };
}
export const wetMinute = (m) => m.rate >= 0.1 && m.chance >= 25;
/** One sentence for the next hour, e.g. "Heavy rain now, easing to rain in about 20 min and stopping in
    about 35 min." `nowLabel`: the hero's word for now when it is wet, so the two never disagree. */
const NOUN = { rain: 'rain', mix: 'rain and snow', sleet: 'sleet', snow: 'snow', ice: 'freezing rain' };
export function minutelyText(mm, nowLabel) {
  if (!mm) return '';
  const { mins } = mm;
  const noun = NOUN[mm.kind] || 'rain';
  const word = (b) => ['', `Light ${noun}`, noun.charAt(0).toUpperCase() + noun.slice(1), `Heavy ${noun}`][b];
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const inMin = (i) => `in about ${Math.max(1, Math.round(i))} min`;
  /* a change only counts once it lasts three minutes */
  const lasting = (i, test) => i + 3 <= mins.length && mins.slice(i, i + 3).every(test);
  const n = mins.length;
  const scan = (from) => {                                          // when it stops, and its heaviest minute before that
    let stop = -1, peak = from;
    for (let i = from + 1; i < n && stop < 0; i++) {
      if (lasting(i, (m) => !wetMinute(m))) stop = i;
      else if (mins[i].rate > mins[peak].rate) peak = i;
    }
    return { stop, peak };
  };
  if (nowLabel || wetMinute(mins[0])) {
    const b0 = bandOf(mins[0].rate);
    const { stop, peak } = scan(0);
    let ease = -1;
    for (let i = 1; i < (stop < 0 ? n : stop) && ease < 0 && b0 > 1; i++) if (lasting(i, (m) => bandOf(m.rate) < b0)) ease = i;
    const mid = ease > 0 && (stop < 0 || stop - ease >= 5) ? `easing to ${lower(word(Math.max(1, bandOf(mins[ease].rate))))} ${inMin(ease)}`
      : bandOf(mins[peak].rate) > b0 ? `turning ${lower(word(bandOf(mins[peak].rate)))} ${inMin(peak)}` : '';
    const end = stop > 0 ? `stopping ${inMin(stop)}` : n > 55 ? 'carrying on for at least the next hour' : `carrying on for the next ${n - 1} min`;
    return `${nowLabel || word(b0)} now, ${mid ? `${mid} and ${end}` : end}.`;
  }
  let start = -1;
  for (let i = 1; i < n && start < 0; i++) if (lasting(i, wetMinute)) start = i;
  if (start < 0) return `No ${mm.snow ? 'snow' : 'rain'} expected in the next hour.`;
  if (mins.slice(start).some((m) => wetMinute(m) && m.kind !== mm.kind)) {         // more than one kind on the way
    const { stop } = scan(start);
    return `Precipitation starting ${inMin(start)}${stop > 0 ? `, stopping ${inMin(stop)}` : ''}: ${[...new Set(mins.slice(start).filter(wetMinute).map((m) => NOUN[m.kind]))].join(', then ')}.`;
  }
  const { stop, peak } = scan(start);
  return `${word(Math.max(1, bandOf(mins[peak].rate)))} starting ${inMin(start)}${stop > 0 ? `, stopping ${inMin(stop)}` : ''}.`;
}

/* ── the quarter hours ─────────────────────────────────────────────────────────────────────────────
   Each of the next twelve hours opens into its quarters, 00, 15, 30 and 45. The model gives the hours:
   between them the temperature, wind, cloud and pressure are drawn straight from one hour to the next
   (the wind's direction through its components), and the precipitation falling in the hour (the next
   hour's amount, what falls in the hour up to it) is shared among its quarters by the model's rates at
   either end. While the radar carried forward reaches (the next hour and a half), each quarter's rain,
   its chance and what is falling are the radar's. Of the hour we are in, only the quarters still to
   begin are given. */
const QUARTER = 15 * 60e3;
const modeOf = (xs) => xs.reduce((a, b) => (xs.filter((x) => x === b).length > xs.filter((x) => x === a).length ? b : a), xs[0]);
const KIND_SHARE = { rain: 0, mix: 0.4, sleet: 0.6, snow: 1, ice: 0 };
export function quartersOf(model, h0, nowMs = Date.now()) {
  const list = model.full;
  const i = list.indexOf(h0);
  const h1 = list[i + 1];
  if (i < 0 || !h1 || h1.t - h0.t !== 36e5) return [];
  const lerp = (a, b, f) => (a == null ? b : b == null ? a : a + (b - a) * f);
  const amount = h1.span === 1 ? h1.precip : null;
  const r0 = h0.precipRate ?? 0, r1 = h1.precipRate ?? 0;
  const mids = [0, 1, 2, 3].map((k) => Math.max(0, lerp(r0, r1, (k + 0.5) / 4)));
  const sum = mids.reduce((s, x) => s + x, 0);
  const share = snowShareOf(h1);
  const mins = model.minutely?.all || [];
  const uv = (h) => [-(h.wind ?? 0) * Math.sin((h.wdir ?? 0) * D), -(h.wind ?? 0) * Math.cos((h.wdir ?? 0) * D)];
  const [u0, v0] = uv(h0), [u1, v1] = uv(h1);
  const out = [];
  for (let k = 0; k < 4; k++) {
    const t = h0.t + k * QUARTER;
    if (t < nowMs) continue;                                       // begun already
    const f = k / 4, near = k < 2 ? h0 : h1;
    const mm = amount == null ? mids[k] * 0.25 : sum > 0 ? amount * (mids[k] / sum) : amount / 4;
    let rate = mm * 4, chance = h1.pRain, kind = null, radar = false;
    const seen = mins.filter((m) => m.t >= t && m.t < t + QUARTER);
    if (seen.length >= 14) {                                       // the radar reaches this quarter
      rate = seen.reduce((s, m) => s + m.rate, 0) / seen.length;
      chance = Math.max(...seen.map((m) => m.chance));
      const wet = seen.filter((m) => m.rate >= 0.1).map((m) => m.kind);
      kind = wet.length ? modeOf(wet) : null;
      radar = true;
    }
    const uu = lerp(u0, u1, f), vv = lerp(v0, v1, f);
    const q = {
      t, quarter: true, radar, span: 0, day: ukDay(t),
      t2: lerp(h0.t2, h1.t2, f), td: lerp(h0.td, h1.td, f), rh: lerp(h0.rh, h1.rh, f),
      wind: Math.hypot(uu, vv), gust: lerp(h0.gust, h1.gust, f), wdir: (((Math.atan2(-uu, -vv) / D) % 360) + 360) % 360,
      mslp: lerp(h0.mslp, h1.mslp, f), tcc: lerp(h0.tcc, h1.tcc, f), lcc: lerp(h0.lcc, h1.lcc, f), mcc: lerp(h0.mcc, h1.mcc, f),
      hcc: lerp(h0.hcc, h1.hcc, f), vis: lerp(h0.vis, h1.vis, f), fog: near.fog, cape: near.cape, lightning: near.lightning,
      precipRate: rate, precip: null, snowRate: rate * (kind ? KIND_SHARE[kind] : share), snow: null, hailRate: h1.hailRate,
      pRain: chance, pThunder: near.pThunder, nova: near.nova, snowCond: near.snowCond,
    };
    q.feels = feelsLike(q.t2, q.td, q.wind);
    q.sun = sunElevation(t, model.lat, model.lon);
    q.isDay = q.sun > -0.833;
    q.cond = classify(q);
    q.windy = windyOf(q);
    q.kind = kind || kindOf(snowShareOf(q), q.t2, q.hailRate, rate);
    out.push(q);
  }
  return out;
}

/* ── the days: a Day (06:00-18:00) and a Night (18:00-06:00) for each ──────────────────────────────
   From the outlook (server/locationWeather.js outlookAt): the MWUK Mix of the UKV and ICON-EU for
   the first five days, then the Met Office Global as far as it reaches. Each part has its weather, its
   high or low, rain and its chance, what falls, wind and gusts, the snow from MWUK FROST, the
   thunderstorm risk from TCM NOVA, and (by day) the UV from the UKV. */
const londonAt = (day, hour) => {
  const guess = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  const off = (hourOf(guess) - new Date(guess).getUTCHours() + 24) % 24;   // 0 in GMT, 1 in BST
  return guess - off * 36e5;
};
const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
const SOURCE_NAMES = { mix: 'MWUK Mix', mo_global: 'Met Office Global', ukv: 'Met Office UKV' };
export const sourceName = (m) => SOURCE_NAMES[m] || m;

function skyCond(list) {
  const c = list.reduce((s, h) => s + (h.tcc ?? 50), 0) / Math.max(1, list.length);
  return c < 15 ? 'clear' : c < 38 ? 'mostlyClear' : c < 62 ? 'partly' : c < 82 ? 'mostlyCloudy' : c < 94 ? 'cloudy' : 'overcast';
}
/* MWUK FROST over a part: the highest chance of snow falling in its periods, and the snow expected to
   fall in it (the run's running total at its end less at its start) */
function frostOver(fr, from, to) {
  if (!fr?.steps?.length) return null;
  const run0 = Date.parse(fr.run);
  const ps = fr.steps.map((s) => ({ t: Date.parse(s.valid), chance: s.chance ?? 0, acc: s.acc_cm ?? 0, risk: s.risk ?? 0 }));
  const inside = ps.filter((p) => p.t > from && p.t <= to + 30 * 60e3);
  if (!inside.length || ps[ps.length - 1].t < to - 3 * 36e5) return null;
  const accAt = (t) => {
    if (t <= run0) return 0;
    let prev = { t: run0, acc: 0 };
    for (const p of ps) {
      if (p.t >= t) return prev.acc + (p.acc - prev.acc) * ((t - prev.t) / Math.max(1, p.t - prev.t));
      prev = p;
    }
    return prev.acc;
  };
  return { chance: Math.max(...inside.map((p) => p.chance)), cm: Math.max(0, accAt(to) - accAt(Math.max(from, run0))) };
}
function partOfDay(kind, from, to, ctx, start = from) {
  const { steps, base, nowMs } = ctx;
  const inst = steps.filter((s) => s.t >= from && s.t <= to);
  const amt = steps.filter((s) => s.t > from && s.t <= to + 1);
  if (!amt.length && !inst.length) return null;
  const first = steps[0].t - (steps[0].span || 1) * 36e5, last = steps[steps.length - 1].t;
  const cover = (Math.min(to, last) - Math.max(from, first)) / (to - from);
  if (cover < 0.6) return null;
  const vals = (k) => inst.map((s) => s[k]).filter((v) => v != null);
  const max = (xs) => (xs.length ? Math.max(...xs) : null), min = (xs) => (xs.length ? Math.min(...xs) : null);
  const hi = max([...vals('t2'), ...amt.map((s) => s.tmax).filter((v) => v != null)]);
  const lo = min([...vals('t2'), ...amt.map((s) => s.tmin).filter((v) => v != null)]);
  const rain = amt.reduce((s, x) => s + (x.precip ?? 0), 0);
  const snow = amt.reduce((s, x) => s + (x.snow ?? 0), 0);
  const pRain = max(amt.map((s) => s.pRain).filter((v) => v != null));
  const full = inst.filter((s) => s.cond);
  const wet = amt.filter((s) => s.cond && isWet(s.cond));
  const wetHours = wet.reduce((s, x) => s + (x.span || 1), 0);
  const kinds = amt.filter((s) => (s.precip ?? 0) >= 0.1);
  const byKind = {};
  for (const s of kinds) byKind[s.kind] = (byKind[s.kind] || 0) + s.precip;
  const fallKind = Object.keys(byKind).sort((a, b) => byKind[b] - byKind[a])[0] || null;
  /* the part's weather: its most telling wet hour of what falls most (a night of sleet with an hour of
     snow said "Snow" over "0.7 mm, falling as sleet"), else the sky */
  let cond = full.length ? skyCond(full) : 'cloudy';
  const mostly = wet.filter((s) => s.kind === fallKind);
  if (wet.length && (rain >= 0.5 || wetHours >= 2)) cond = (mostly.length ? mostly : wet).reduce((a, b) => (RANK[b.cond] > RANK[a.cond] ? b : a)).cond;
  else if (full.filter((s) => s.cond === 'fog').length >= Math.max(1, full.length / 2)) cond = 'fog';
  else if (full.filter((s) => s.cond === 'windy').length >= 2) cond = 'windy';
  const strongest = inst.reduce((a, b) => ((b.wind ?? -1) > (a?.wind ?? -1) ? b : a), null);
  /* the UV from the UKV's own hours where they reach (the Mix has none), the Global's beyond */
  const uvH = (base.hours || []).filter((h) => h.t >= from && h.t <= to && h.uvi != null).map((h) => h.uvi);
  const uvi = kind === 'day' ? max(uvH.length ? uvH : vals('uvi')) : null;
  const rhs = vals('rh');
  const nova = (base.nova?.hours || []).filter((x) => x.t >= from && x.t <= to && x.t >= nowMs - 36e5);
  const thunder = nova.length ? nova.reduce((a, b) => (b.p > a.p ? b : a)) : null;
  const sc = max(vals('snowCond'));
  return {
    kind, from, to, start, partial: cover < 0.95, hi, lo, cond, windy: inst.filter((s) => s.windy).length >= 2 || (strongest && windyOf(strongest)),
    rain, snow, pRain, fallKind, wind: strongest?.wind ?? null, wdir: strongest?.wdir ?? null, gust: max(vals('gust')),
    feelsLo: min(vals('feels')), feelsHi: max(vals('feels')), uvi, rh: rhs.length ? rhs.reduce((s, x) => s + x, 0) / rhs.length : null,
    vis: min(vals('vis')), snowCond: sc, thunder, frost: frostOver(base.frost, from, to),
    models: [...new Set([...inst, ...amt].map((s) => s.model).filter(Boolean))],
  };
}
export function outlookOf(resp, base, nowMs = Date.now()) {
  const ol = resp.outlook;
  if (!ol?.times?.length) return null;
  const { lat, lon } = resp.location;
  const V = ol.v;
  const at = (k, i) => (V[k] ? V[k][i] ?? null : null);
  const steps = ol.times.map((t, i) => {
    const run = ol.runs[ol.src[i]] || {};
    const s = {
      t, span: ol.span[i] || 1, model: run.model, t2: at('t2', i), tmax: at('tmax_step', i), tmin: at('tmin_step', i),
      td: at('td2', i), rh: at('rh2', i), ground: at('tskin', i), wind: at('wind10', i), gust: at('gust10', i), wdir: at('wdir10', i),
      mslp: at('mslp', i), precipRate: at('precip_rate', i), precip: at('precip_step', i), snowRate: at('snow_rate', i), snow: at('snow_step', i),
      hailRate: at('hail_rate', i), tcc: at('tcc', i), lcc: at('lcc', i), mcc: at('mcc', i), hcc: at('hcc', i), vis: at('vis', i),
      fog: at('fog', i), uvi: uvIndex(at('uv_down', i)), snowCond: at('snow_cond', i), pRain: ol.p_rain?.[i] ?? null,
      sw: at('sw_down', i), cape: at('cape_mu', i),
    };
    /* a field the Mix has no step amount for yet: its rate over the step */
    if (s.precip == null && s.precipRate != null) s.precip = s.precipRate * s.span;
    if (s.snow == null && s.precip != null) s.snow = s.precipRate ? s.precip * Math.min(1, (s.snowRate ?? 0) / s.precipRate) : 0;
    if (s.rh == null && s.t2 != null && s.td != null) s.rh = Math.min(100, 100 * Math.exp((17.625 * s.td) / (243.04 + s.td) - (17.625 * s.t2) / (243.04 + s.t2)));
    s.feels = feelsLike(s.t2, s.td, s.wind);
    s.sun = sunElevation(t, lat, lon);
    s.isDay = s.sun > -0.833;
    s.full = s.t2 != null && s.tcc != null;
    s.cond = s.full ? classify(s) : null;
    s.windy = s.full && windyOf(s);
    s.kind = kindOf(snowShareOf(s), s.t2, s.hailRate, rateOf(s));
    return s;
  });
  const ctx = { steps, base, nowMs };
  const today = ukDay(nowMs), last = steps[steps.length - 1].t;
  const obs = base.observed;
  const days = [];
  for (let day = today, n = 0; n < 12; day = nextDay(day), n++) {
    const d6 = londonAt(day, 6), d18 = londonAt(day, 18), n6 = londonAt(nextDay(day), 6);
    if (d6 > last) break;
    const isToday = day === today;
    /* today's parts from now on (the hour we are in), the hours gone being observed */
    const dayPart = isToday && nowMs >= d18 ? null : partOfDay('day', isToday ? Math.max(d6, nowMs - 36e5) : d6, d18, ctx, d6);
    const nightPart = partOfDay('night', isToday ? Math.max(d18, nowMs - 36e5) : d18, n6, ctx, d18);
    if (!dayPart && !nightPart) continue;
    if (isToday && dayPart && obs?.t2_max != null) dayPart.hi = Math.max(dayPart.hi ?? -99, obs.t2_max);   // the hours gone, as observed
    const fd = base.frost?.days?.find((x) => x.date === day) || null;
    const allNova = (base.nova?.hours || []).filter((x) => x.t >= d6 && x.t < n6 && x.t >= nowMs - 36e5);
    const thunder = allNova.length ? allNova.reduce((a, b) => (b.p > a.p ? b : a)) : null;
    const parts = [dayPart, nightPart].filter(Boolean);
    days.push({
      day, isToday, label: isToday && !dayPart ? 'Tonight' : dayLabel(day, today),
      date: new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      dayPart, nightPart,
      hi: dayPart?.hi ?? (isToday ? obs?.t2_max ?? null : null),
      lo: nightPart?.lo ?? dayPart?.lo ?? null,
      cond: (dayPart || nightPart).cond, windy: (dayPart || nightPart).windy,
      pRain: Math.max(...parts.map((p) => p.pRain ?? 0)),
      rain: parts.reduce((s, p) => s + p.rain, 0), snow: parts.reduce((s, p) => s + p.snow, 0),
      frost: fd, thunder, sun: sunTimes(day, lat, lon), moon: moonPhase(d18 + 6 * 36e5),
      models: [...new Set(parts.flatMap((p) => p.models))],
      partial: parts.some((p) => p.partial) || (!nightPart && !isToday),
    });
  }
  return { days, steps, runs: ol.runs, anchor: ol.anchor || null };
}

/* ── words ───────────────────────────────────────────────────────────────── */
/* When a time falls, as said from now: '' today, 'overnight', 'tomorrow morning', 'Sat'... */
function partOf(ms) {
  const label = dayLabel(ukDay(ms));
  if (label === 'Today') return '';
  if (label !== 'Tomorrow') return label;
  const h = hourOf(ms);
  return h < 6 ? 'overnight' : h < 12 ? 'tomorrow morning' : h < 18 ? 'tomorrow afternoon' : 'tomorrow evening';
}
const clock = (ms) => (hhmm(ms) === '00:00' ? 'midnight' : hhmm(ms));
const whenSaid = (ms) => (clock(ms) === 'midnight' || !partOf(ms) ? clock(ms) : `${clock(ms)} ${partOf(ms)}`);
/* "Drizzle from about 21:00, heaviest around midnight, clearing by 04:00 overnight": each time in
   turn, its part of the day said once, after the last time that shares it */
function sayTimes(bits) {
  return bits.map(([words, ms], i) => {
    const p = clock(ms) === 'midnight' ? '' : partOf(ms);
    const next = bits[i + 1] && partOf(bits[i + 1][1]);
    return `${words} ${clock(ms)}${p && p !== next ? ` ${p}` : ''}`;
  }).join(', ');
}
const SUMMARY_H = 12;
/** One or two short sentences for the hourly card about the next 12 hours: the rain as it comes
    and goes (or the sky when it stays dry), then the one other thing most worth knowing in those
    hours (thunderstorms, strong gusts or frost). It used to cover 24 hours and dropped the day:
    "Drizzle likely from around 21:00, heaviest near 13:00. Gusts up to 47 mph." meant 13:00 and
    the gusts tomorrow afternoon. Every time it names now says which day it is on. */
/* a speed or an amount in the visitor's units, when the page passes its useUnits (U); else mph and mm */
const windSaid = (mph, U) => (U ? U.fmtWind(mph) : `${Math.round(mph)} mph`);
const rainSaid = (mm, U) => (U ? U.fmtRain(mm, mm >= 10 ? 0 : 1) : `${mm >= 10 ? Math.round(mm) : mm.toFixed(1)} mm`);

export function nextHoursText(m, U) {
  const nowMs = Date.now(), end = nowMs + SUMMARY_H * 36e5;
  const hs = m.full.filter((h) => h.t > nowMs && h.t <= end);
  if (!hs.length) return '';
  const wet = hs.map((h) => isWet(h.cond));
  const rate = (h) => (h.span > 0 ? (h.precip ?? 0) / h.span : h.precipRate ?? 0);
  /* dry again: two dry hours in a row (or the last hour) */
  const dryFrom = (i) => { for (let k = i; k < hs.length; k++) if (!wet[k] && (k === hs.length - 1 || !wet[k + 1])) return k; return -1; };
  let first;
  if (isWet(m.now.cond)) {
    const k = dryFrom(0);
    first = k >= 0 ? `${sayTimes([[`${condLabel(m.now.cond, m.now.isDay)}, clearing by`, hs[k].t]])}.` : `${condLabel(m.now.cond, m.now.isDay)} for the next ${SUMMARY_H} hours.`;
  } else {
    const i0 = wet.indexOf(true);
    if (i0 >= 0) {
      const k = dryFrom(i0);
      const spell = hs.slice(i0, k < 0 ? hs.length : k);
      const peak = spell.reduce((a, b) => (rate(b) > rate(a) ? b : a));
      const start = spell[0];
      const bits = [[`${condLabel(start.cond, start.isDay)} from about`, start.t]];
      if (peak !== start && bandOf(rate(peak)) > bandOf(rate(start))) bits.push(['heaviest around', peak.t]);
      if (k >= 0) bits.push(['clearing by', hs[k].t]);
      first = `${sayTimes(bits)}.`;
    } else {
      const c = hs.reduce((s, h) => s + (h.tcc ?? 50), 0) / hs.length;
      const night = hs.filter((h) => !h.isDay).length > hs.length / 2;
      first = `Dry for the next ${SUMMARY_H} hours${c < 30 ? (night ? ' with clear skies' : ' with plenty of sunshine') : c > 85 ? ', staying cloudy' : c < 55 ? (night ? ' with clear spells' : ' with sunny spells') : ''}.`;
    }
  }
  /* one more thing, the most telling: thunderstorms (TCM NOVA), gusts, then frost */
  const ts = (m.nova?.hours || []).filter((x) => x.t > nowMs && x.t <= end);
  const storm = ts.length ? ts.reduce((a, b) => (b.p > a.p ? b : a)) : null;
  const gusty = hs.reduce((a, b) => ((b.gust ?? 0) > (a.gust ?? 0) ? b : a));
  const frost = hs.find((h) => (h.ground ?? 9) <= 0 || (h.t2 ?? 9) <= 0);
  let more = '';
  if (storm && storm.p >= 15 && !first.startsWith('Thunder')) more = `A ${thunderRisk(storm.p).word.toLowerCase()} risk of thunderstorms around ${whenSaid(storm.t)}.`;
  else if ((gusty.gust ?? 0) >= 35) more = `Gusts up to ${windSaid(gusty.gust, U)} around ${whenSaid(gusty.t)}.`;
  else if (frost) more = `${(frost.t2 ?? 9) <= 0 ? 'Freezing' : 'A ground frost'} by ${whenSaid(frost.t)}.`;
  return more ? `${first} ${more}` : first;
}

export function dayText(d, U) {
  const bits = [condLabel(d.cond, true, d.windy)];
  if (d.rainSoFar != null) {
    if (d.rainSoFar >= 0.2) bits.push(`${rainSaid(d.rainSoFar, U)} of rain so far`);
    if (d.rainAhead >= 0.2) bits.push(`${rainSaid(d.rainAhead, U)} more to come`);
  } else if (d.rain >= 0.2) bits.push(d.snow > d.rain / 2 ? `${rainSaid(d.rain, U)} of snow (water equivalent)` : `${rainSaid(d.rain, U)} of rain`);
  if ((d.gust ?? 0) >= 35) bits.push(`gusts ${windSaid(d.gust, U)}`);
  return bits.join(' · ');
}
