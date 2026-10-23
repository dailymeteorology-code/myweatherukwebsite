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
  thunder: 9, thunderShowers: 9, blizzard: 8.5, hail: 8, heavySnow: 8, freezingRain: 7.5, torrentialRain: 7, snow: 7, sleet: 7, snowShowers: 7,
  heavyRain: 6, heavyShowers: 6, rain: 5, showers: 4, lightRain: 3, drizzle: 2,
  fog: 1.5, mist: 1, windy: 0.9, overcast: 0.8, cloudy: 0.6, mostlyCloudy: 0.5, partly: 0.4, mostlyClear: 0.2, hot: 0.1, clear: 0,
};
const LABEL = {
  thunder: 'Thunderstorms', thunderShowers: 'Thundery showers', blizzard: 'Blizzard', hail: 'Hail', heavySnow: 'Heavy snow', snow: 'Snow',
  snowShowers: 'Snow showers', sleet: 'Sleet', freezingRain: 'Freezing rain', torrentialRain: 'Torrential rain',
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
    if (snowShare >= 0.3) return 'sleet';
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

/* ── the response -> hours and days ──────────────────────────────────────── */
export async function fetchLocation(params, signal) {
  const qs = new URLSearchParams();
  if (Number.isFinite(params.lat) && Number.isFinite(params.lon)) {
    qs.set('lat', params.lat.toFixed(4)); qs.set('lon', params.lon.toFixed(4));
    if (params.name) qs.set('name', params.name);
  } else qs.set('q', params.name || '');
  const r = await fetch(`/api/location/forecast?${qs}`, { signal });
  const body = await r.json().catch(() => null);
  if (!body) throw new Error('The forecast server did not answer. Try again in a moment.');
  if (!r.ok && !body.code) throw new Error(body.error || `The forecast could not be loaded (${r.status}).`);
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
      pRain: fc.p_rain[i], pThunder: fc.p_thunder[i], nova: novaAt.get(t) ?? null,
    };
    h.full = h.tcc != null && h.wind != null;
    h.feels = feelsLike(h.t2, h.td, h.wind);
    h.sun = sunElevation(t, lat, lon);
    h.isDay = h.sun > -0.833;
    h.cond = h.full ? classify(h) : null;
    h.windy = h.full && windyOf(h);
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
  nowHour.cond = classify(nowHour);
  nowHour.windy = windyOf(nowHour);

  /* days, in UK time */
  const today = ukDay(nowMs);
  const byDay = new Map();
  for (const h of hours) {
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
  });

  return {
    location: loc, hours, full, days, now: nowHour, nowIdx, observed, analysis: an, minutely,
    runs: fc.runs, cell: fc.cell, lat, lon, anchor: fc.anchor || null,
    /* every NOVA hour (not only the UKV's: hourly to the end of the Main Run) */
    nova: nova ? { ...nova, hours: nova.times.map((t, k) => ({ t, p: nova.p[k], src: nova.src[k], nb: nova.nb_km[k] })) } : null,
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
  const mins = [];
  for (let k = 0; k <= 60; k++) {
    const i = from + k;
    if (i >= nc.rate.length || nc.rate[i] == null) break;
    mins.push({ t: Date.parse(nc.start) + i * 60e3, rate: nc.rate[i], chance: nc.chance[i] ?? 0 });
  }
  if (mins.length < 31) return null;                                // too stale to say anything about the hour
  const snowShare = (cur.precip ?? 0) > 0 && cur.snow != null ? cur.snow / cur.precip : cur.precipRate ? (cur.snowRate ?? 0) / cur.precipRate : 0;
  return { mins, snow: snowShare >= 0.6, scan: Date.parse(nc.scan), motion: nc.motion };
}
export const wetMinute = (m) => m.rate >= 0.1 && m.chance >= 25;
/** One sentence for the next hour, e.g. "Heavy rain now, easing to rain in about 20 min and stopping in
    about 35 min." `nowLabel`: the hero's word for now when it is wet, so the two never disagree. */
export function minutelyText(mm, nowLabel) {
  if (!mm) return '';
  const { mins } = mm;
  const word = (b) => (mm.snow ? ['', 'Light snow', 'Snow', 'Heavy snow'] : ['', 'Light rain', 'Rain', 'Heavy rain'])[b];
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
  const { stop, peak } = scan(start);
  return `${word(Math.max(1, bandOf(mins[peak].rate)))} starting ${inMin(start)}${stop > 0 ? `, stopping ${inMin(stop)}` : ''}.`;
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
