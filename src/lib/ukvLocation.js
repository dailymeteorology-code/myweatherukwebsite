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
   when the cloud is broken), then fog, then cloud. Day or night from the sun. */
const RANK = { thunder: 9, hail: 8, heavySnow: 8, snow: 7, sleet: 7, snowShowers: 7, heavyRain: 6, heavyShowers: 6, rain: 5, showers: 4, lightRain: 3, drizzle: 2, fog: 1.5, mist: 1, overcast: 0.8, cloudy: 0.6, partly: 0.4, mostlyClear: 0.2, clear: 0 };
const LABEL = {
  thunder: 'Thunderstorms', hail: 'Hail', heavySnow: 'Heavy snow', snow: 'Snow', snowShowers: 'Snow showers', sleet: 'Sleet',
  heavyRain: 'Heavy rain', heavyShowers: 'Heavy showers', rain: 'Rain', showers: 'Showers', lightRain: 'Light rain', drizzle: 'Drizzle',
  fog: 'Fog', mist: 'Mist', overcast: 'Overcast', cloudy: 'Cloudy', partly: 'Partly cloudy',
};
export function condLabel(key, day) {
  if (key === 'clear') return day ? 'Sunny' : 'Clear';
  if (key === 'mostlyClear') return day ? 'Mostly sunny' : 'Mostly clear';
  return LABEL[key] || 'Cloudy';
}
export function classify(h) {
  const rate = h.span > 0 && h.precip != null ? h.precip / h.span : h.precipRate ?? 0;
  const wet = rate >= 0.1 || (h.precipRate ?? 0) >= 0.2;
  const showery = (h.tcc ?? 100) < 85 || (h.cape ?? 0) >= 150;
  const snowShare = (h.precip ?? 0) > 0 && h.snow != null ? h.snow / h.precip : (h.precipRate ? (h.snowRate ?? 0) / h.precipRate : 0);
  if (wet && ((h.pThunder ?? 0) >= 30 || (h.lightning ?? 0) >= 0.01 || (h.lightning == null && (h.cape ?? 0) >= 600 && rate >= 1))) return 'thunder';
  if (wet) {
    if ((h.hailRate ?? 0) >= 0.05) return 'hail';
    if (snowShare >= 0.7) return rate >= 2 ? 'heavySnow' : showery && rate < 1 ? 'snowShowers' : 'snow';
    if (snowShare >= 0.3) return 'sleet';
    if (rate >= 4) return showery ? 'heavyShowers' : 'heavyRain';
    if (rate >= 1) return showery ? 'showers' : 'rain';
    if (rate >= 0.25) return showery ? 'showers' : 'lightRain';
    return showery ? 'showers' : 'drizzle';
  }
  if (h.vis != null && (h.vis < 1 || (h.fog ?? 0) >= 60)) return 'fog';
  if (h.vis != null && h.vis < 5) return 'mist';
  const c = h.tcc ?? 50;
  if (c < 12) return 'clear';
  if (c < 40 || ((h.lcc ?? 0) + (h.mcc ?? 0) < 20 && c < 70)) return 'mostlyClear';
  if (c < 75) return 'partly';
  if (c < 95) return 'cloudy';
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

export function shape(resp) {
  const { location: loc, forecast: fc, now: an, observed } = resp;
  const { lat, lon } = loc;
  const V = fc.v;
  if (!fc.times.length) throw new Error('This forecast has no hours yet. Try again in a few minutes.');
  const at = (k, i) => (V[k] ? V[k][i] : null);
  const hours = fc.times.map((t, i) => {
    const h = {
      t, i, day: ukDay(t), run: fc.src[i], span: fc.span[i],
      t2: at('t2', i), td: at('td2', i), rh: at('rh2', i), ground: at('tskin', i),
      wind: at('wind10', i), gust: at('gust10', i), wdir: at('wdir10', i), mslp: at('mslp', i),
      precipRate: at('precip_rate', i), precip: at('precip_step', i), snowRate: at('snow_rate', i), snow: at('snow_step', i),
      hailRate: at('hail_rate', i), tcc: at('tcc', i), lcc: at('lcc', i), mcc: at('mcc', i), hcc: at('hcc', i),
      cloudBase: at('cloud_base', i), vis: at('vis', i), fog: at('fog', i), cape: at('cape_mu', i), lightning: at('lightning', i),
      frz: at('frz', i), snowLying: at('snow_swe', i), sw: at('sw_down', i), uvi: uvIndex(at('uv_down', i)),
      pRain: fc.p_rain[i], pThunder: fc.p_thunder[i],
    };
    h.full = h.tcc != null && h.wind != null;
    h.feels = feelsLike(h.t2, h.td, h.wind);
    h.sun = sunElevation(t, lat, lon);
    h.isDay = h.sun > -0.833;
    h.cond = h.full ? classify(h) : null;
    return h;
  });
  /* a temperature-only hour borrows the look of the nearest full hour */
  const full = hours.filter((h) => h.full);
  for (const h of hours) {
    if (h.full) continue;
    let best = null;
    for (const f of full) if (!best || Math.abs(f.t - h.t) < Math.abs(best.t - h.t)) best = f;
    if (best) h.cond = best.cond;
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
    precipRate: radarRate ?? cur.precipRate, span: radarRate != null ? 0 : cur.span, precip: radarRate != null ? null : cur.precip,
    sun: sunElevation(nowMs, lat, lon), analysed: !!an,
  };
  nowHour.isDay = nowHour.sun > -0.833;
  nowHour.feels = an?.feels ?? feelsLike(nowHour.t2, nowHour.td, nowHour.wind);
  nowHour.cond = classify(nowHour);

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
    const rain = fullHs.reduce((s, h) => s + (h.span > 0 ? h.precip ?? 0 : 0), 0);
    const snow = fullHs.reduce((s, h) => s + (h.span > 0 ? h.snow ?? 0 : 0), 0);
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
        cond = fogs >= Math.max(2, dry.length / 2) ? 'fog' : c < 15 ? 'clear' : c < 40 ? 'mostlyClear' : c < 75 ? 'partly' : c < 93 ? 'cloudy' : 'overcast';
      }
    }
    const max = (k) => { const v = fullHs.map((h) => h[k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const strongest = fullHs.reduce((a, b) => ((b.wind ?? 0) > (a?.wind ?? -1) ? b : a), null);
    return {
      day, label: dayLabel(day, today), isToday, hi, lo, cond, rain, snow,
      pRain: max('pRain'), pThunder: max('pThunder'), gust: max('gust'), wind: max('wind'), wdir: strongest?.wdir ?? null,
      uvi: max('uvi'), cape: max('cape'), sun: sunTimes(day, lat, lon), hours: hs,
      partial: hs.length && (hs[hs.length - 1].t - hs[0].t) < 18 * 36e5 && !isToday,
    };
  });

  return {
    location: loc, hours, full, days, now: nowHour, nowIdx, observed, analysis: an, minutely,
    runs: fc.runs, cell: fc.cell, lat, lon,
  };
}

/* ── the next hour, minute by minute (the radar nowcast) ────────────────────
   The server sends 90 minutes from when it was asked; the page re-derives every minute, so
   the hour shown always starts at this minute. Rain or snow from the hour's model snow share. */
export const RAIN_BANDS = [['Light', 0.1], ['Moderate', 1], ['Heavy', 4]];      // mm/h, as classify() words them
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
const at = (ms) => hhmm(ms);
/** One or two sentences for the hourly card, about the next 24 hours. */
export function nextHoursText(m) {
  const end = Date.now() + 24 * 36e5;
  const hs = m.full.filter((h) => h.t >= Date.now() - 30 * 60e3 && h.t <= end);
  if (!hs.length) return '';
  const wetNow = isWet(m.now.cond);
  const firstWet = hs.find((h) => isWet(h.cond));
  const parts = [];
  if (wetNow) {
    const dryAgain = hs.find((h) => h.t > Date.now() && !isWet(h.cond));
    parts.push(dryAgain ? `${condLabel(m.now.cond, true)} easing around ${at(dryAgain.t)}.` : `${condLabel(m.now.cond, true)} on and off through the next 24 hours.`);
  } else if (firstWet) {
    const wettest = hs.filter((h) => isWet(h.cond)).reduce((a, b) => ((b.precip ?? 0) / Math.max(1, b.span || 1) > (a.precip ?? 0) / Math.max(1, a.span || 1) ? b : a));
    parts.push(`${condLabel(firstWet.cond, firstWet.isDay)} likely from around ${at(firstWet.t)}${wettest !== firstWet ? `, heaviest near ${at(wettest.t)}` : ''}.`);
  } else {
    const c = hs.reduce((s, h) => s + (h.tcc ?? 50), 0) / hs.length;
    parts.push(`Dry for the next 24 hours${c < 30 ? ' with plenty of clear sky' : c > 85 ? ', staying mostly cloudy' : ''}.`);
  }
  const gust = Math.max(...hs.map((h) => h.gust ?? 0));
  if (gust >= 35) parts.push(`Gusts up to ${Math.round(gust)} mph.`);
  const thunder = hs.find((h) => h.cond === 'thunder');
  if (thunder && !parts[0].startsWith('Thunder')) parts.push(`A chance of thunder around ${at(thunder.t)}.`);
  const frost = hs.find((h) => (h.ground ?? 9) <= 0 || (h.t2 ?? 9) <= 0);
  if (frost) parts.push(`${(frost.t2 ?? 9) <= 0 ? 'Freezing' : 'A ground frost'} by ${at(frost.t)}.`);
  return parts.join(' ');
}

export function dayText(d) {
  const bits = [condLabel(d.cond, true)];
  if (d.rain >= 0.2) bits.push(`${d.rain >= 10 ? Math.round(d.rain) : d.rain.toFixed(1)} mm of ${d.snow > d.rain / 2 ? 'snow (water equivalent)' : 'rain'}`);
  if ((d.gust ?? 0) >= 35) bits.push(`gusts ${Math.round(d.gust)} mph`);
  return bits.join(' · ');
}
