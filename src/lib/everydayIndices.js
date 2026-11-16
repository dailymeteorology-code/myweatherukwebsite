/* Everyday indices for Location Weather (16 Nov 2026, at the user's request: washing line, BBQ, dog walk
   and running, cycling headwind; garden frost alert, school snow-day chance; solar and wind-farm output;
   heat and cold stress). Worked out hour by hour from the place's own forecast (lib/ukvLocation's
   shaped hours: t2 C, td, rh %, ground C, wind and gust mph, wdir degrees, precipRate mm/h, pRain %,
   snow cm a step, snowLying mm, sw W/m2, tcc %, vis km, feels C, sun elevation degrees).

   scoreHours(hours, activity, opts) -> [{ t, score 0..1, why }] is what the card draws and what the best-
   time finder (Location Weather) builds on. Every number shown comes from the forecast's own values;
   the scores are rules of thumb, said as such. */

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const es = (t) => 6.112 * Math.exp((17.67 * t) / (t + 243.5));            // hPa, over water
/* the rain an hour brings: the rate at the hour, or what falls through it (the rate alone misses showers between the hours) */
const rain = (h) => Math.max(h.precipRate ?? 0, (h.precip ?? 0) / (h.span || 1));
const wet = (h) => rain(h) >= 0.1;
const chanceWet = (h) => (h.pRain ?? 0) / 100;
const icy = (h) => ((h.ground ?? h.t2 ?? 9) <= 0.5 && (rain(h) > 0 || (h.rh ?? 0) >= 95)) || ((h.t2 ?? 9) <= 0 && (h.snowRate ?? 0) > 0);

export const ACTIVITIES = [
  ['washing', 'Washing out', 'drying'],
  ['bbq', 'BBQ', 'barbecue'],
  ['walk', 'Dog walk', 'walking'],
  ['run', 'Running', 'running'],
  ['cycle', 'Cycling', 'cycling'],
];

/* how well washing dries outside: the air's thirst (vapour-pressure deficit), the breeze and the sun */
function washing(h) {
  if (h.sun != null && h.sun < 2) return [0, 'after dark'];
  if (wet(h)) return [0, 'rain'];
  if ((h.vis ?? 10) < 1) return [0.15, 'fog'];
  const vpd = es(h.t2) * (1 - clamp((h.rh ?? 80) / 100));
  let s = clamp(vpd / 8);
  const w = h.wind ?? 5;
  s *= w < 3 ? 0.6 : w <= 22 ? 0.8 + 0.2 * clamp((w - 3) / 10) : w <= 32 ? 0.7 : 0.35;
  s *= 0.7 + 0.3 * clamp((h.sw ?? 0) / 400);
  s *= (h.t2 ?? 10) < 3 ? 0.35 : (h.t2 ?? 10) < 8 ? 0.65 : 1;
  s *= 1 - 0.7 * chanceWet(h);
  return [clamp(s), s < 0.3 ? (vpd < 2 ? 'damp air' : w >= 32 ? 'too windy' : 'little drying') : null];
}
function bbq(h) {
  if (wet(h)) return [0, 'rain'];
  const t = h.feels ?? h.t2 ?? 0, w = h.wind ?? 0;
  let s = t < 10 ? 0 : t < 16 ? 0.25 + 0.6 * ((t - 10) / 6) : t <= 26 ? 1 : t <= 32 ? 0.85 : 0.55;
  s *= w > 30 ? 0 : w > 20 ? 0.5 : 1;
  s *= 1 - 0.8 * chanceWet(h);
  if (h.sun != null && h.sun < -6) s *= 0.6;
  return [clamp(s), t < 10 ? 'too cold' : w > 20 ? 'too windy' : chanceWet(h) > 0.4 ? 'showers about' : null];
}
function walk(h) {
  const t = h.feels ?? h.t2 ?? 10, r = rain(h), g = h.gust ?? 0;
  let s = t < -8 ? 0.2 : t < -2 ? 0.55 : t <= 22 ? 1 : t <= 27 ? 0.6 : 0.25;
  s *= r >= 2 ? 0.15 : r >= 0.2 ? 0.55 : 1;
  s *= g >= 50 ? 0.15 : g >= 40 ? 0.5 : 1;
  s *= 1 - 0.4 * chanceWet(h);                            // rain about, even where none is forecast at the spot
  if ((h.pThunder ?? 0) >= 30) s *= 0.2;
  if (icy(h)) s *= 0.5;
  return [clamp(s), (h.pThunder ?? 0) >= 30 ? 'thunder' : r >= 2 ? 'heavy rain' : g >= 40 ? 'gales' : icy(h) ? 'icy' : t > 27 ? 'too hot' : t < -2 ? 'bitter' : null];
}
function run(h) {
  const t = h.feels ?? h.t2 ?? 10, r = rain(h), g = h.gust ?? 0;
  let s = t < -6 ? 0.25 : t < 2 ? 0.7 : t <= 14 ? 1 : t <= 20 ? 0.8 : t <= 26 ? 0.4 : 0.1;
  s *= r >= 2 ? 0.25 : r >= 0.2 ? 0.7 : 1;
  s *= g >= 45 ? 0.3 : g >= 35 ? 0.7 : 1;
  s *= 1 - 0.4 * chanceWet(h);
  if ((h.pThunder ?? 0) >= 30) s *= 0.2;
  if (icy(h)) s *= 0.35;
  return [clamp(s), (h.pThunder ?? 0) >= 30 ? 'thunder' : icy(h) ? 'icy paths' : t > 20 ? 'too warm' : r >= 2 ? 'heavy rain' : g >= 35 ? 'gusty' : null];
}
/* the wind against you riding towards `heading` (degrees): + headwind, - tailwind (mph) */
export const headwind = (h, heading) => (h.wind ?? 0) * Math.cos((((h.wdir ?? 0) - heading) * Math.PI) / 180);
function cycle(h, heading = 0) {
  const hw = headwind(h, heading), r = rain(h), g = h.gust ?? 0, t = h.feels ?? h.t2 ?? 10;
  let s = hw <= 0 ? 1 : hw < 8 ? 0.85 : hw < 15 ? 0.55 : 0.3;
  s *= r >= 1 ? 0.25 : r >= 0.1 ? 0.65 : 1;
  s *= g >= 45 ? 0.15 : g >= 35 ? 0.5 : 1;
  s *= t < -4 ? 0.5 : t > 28 ? 0.6 : 1;
  s *= 1 - 0.4 * chanceWet(h);
  if (icy(h)) s *= 0.2;
  return [clamp(s), icy(h) ? 'icy roads' : hw >= 15 ? 'strong headwind' : r >= 1 ? 'rain' : g >= 35 ? 'gusty' : hw <= -5 ? 'tailwind' : null];
}
const FN = { washing, bbq, walk, run, cycle };

/** Each hour's score for an activity (0 poor .. 1 ideal) and the main reason when it is low. */
export function scoreHours(hours, activity, opts = {}) {
  const f = FN[activity];
  if (!f) return [];
  return (hours || []).filter((h) => h.t2 != null).map((h) => { const [score, why] = f(h, opts.heading ?? 0); return { t: h.t, score, why }; });
}

/** The good spells (score >= `min` for at least `minHours`, a gap of an hour bridged), first ones first. */
export function goodSpells(scored, min = 0.6, minHours = 2) {
  const out = [];
  scored = scored.map((x, i) => (x.score < min && i && i < scored.length - 1 && scored[i - 1].score >= min && scored[i + 1].score >= min ? { ...x, score: min } : x));
  let a = null;
  scored.forEach((x, i) => {
    if (x.score >= min) { if (!a) a = { from: x.t, to: x.t, best: x.score, n: 0 }; a.to = x.t; a.n += 1; a.best = Math.max(a.best, x.score); }
    if ((x.score < min || i === scored.length - 1) && a) { if (a.n >= minHours) out.push(a); a = null; }
  });
  return out;
}

/* ── the situational ones ── */
const DAY = 86400e3;
/** Tonight's frost (dusk to 9 am): the coldest air and ground, under a clearish sky. */
export function frostAlert(hours, now = Date.now()) {
  const night = (hours || []).filter((h) => h.t >= now && h.t <= now + 20 * 3600e3 && (h.sun ?? -10) < 5);
  if (!night.length) return null;
  const air = night.reduce((m, h) => (h.t2 != null && (m == null || h.t2 < m.t2) ? h : m), null);
  const grd = night.reduce((m, h) => (h.ground != null && (m == null || h.ground < m.ground) ? h : m), null);
  if (!air) return null;
  const level = air.t2 <= 0 ? 'air' : (grd?.ground ?? 9) <= 0 || air.t2 <= 2 ? 'ground' : null;
  if (!level) return null;
  return { level, air, ground: grd, clear: (air.tcc ?? 100) < 50 };
}
/** A school snow day: fresh snow overnight into the morning, snow lying, and below freezing at 8 am,
    for the next two weekday mornings. A rough guide only: schools decide. */
export function snowDays(hours) {
  const out = [];
  const byDay = new Map();
  for (const h of hours || []) { const d = h.day ?? new Date(h.t).toISOString().slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(h); }
  for (const [day, hs] of byDay) {
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const local = (h) => Number(new Date(h.t).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }));
    const morning = hs.filter((h) => local(h) <= 9);
    const before = (hours || []).filter((h) => h.t < hs[0].t && h.t >= hs[0].t - 9 * 3600e3);
    const fresh = [...before, ...morning].reduce((s, h) => s + (h.snow ?? 0), 0);
    const at8 = morning.find((h) => local(h) === 8) || morning[morning.length - 1];
    const lying = at8?.snowLying ?? 0;                       // mm of water: about as many cm of snow
    const cold = (at8?.t2 ?? 5) <= 0.5;
    const score = fresh * (cold ? 1.2 : 0.7) + lying * 0.6;
    const level = score >= 6 ? 'High' : score >= 2.5 ? 'Moderate' : score >= 0.8 ? 'Low' : null;
    if (level) out.push({ day, level, fresh: Math.round(fresh * 10) / 10, lying: Math.round(lying * 10) / 10, t8: at8?.t2 });
    if (out.length >= 2) break;
  }
  return out;
}
/** Solar panels: about how many kWh each kWp of panels makes on each day (the sunshine reaching the
    ground at 80 % performance, panels near flat), and wind turbines: about what share of their rating
    they run at (the 10 m wind raised to hub height, a typical power curve). */
export function energy(hours) {
  const days = new Map();
  for (const h of hours || []) {
    const d = h.day ?? new Date(h.t).toISOString().slice(0, 10);
    if (!days.has(d)) days.set(d, { day: d, kwh: 0, cf: [], n: 0 });
    const e = days.get(d);
    if (h.sw != null) e.kwh += (Math.max(0, h.sw) / 1000) * 0.8 * (h.span ?? 1);
    if (h.wind != null) {
      const v = h.wind * 0.44704 * 1.4;                    // mph at 10 m -> m/s at about 100 m
      e.cf.push(v < 3 ? 0 : v < 12 ? (v ** 3 - 27) / (1728 - 27) : v < 25 ? 1 : 0);
    }
    e.n += 1;
  }
  return [...days.values()].filter((e) => e.n >= 12).slice(0, 3)
    .map((e) => ({ day: e.day, kwh: Math.round(e.kwh * 10) / 10, wind: e.cf.length ? Math.round((100 * e.cf.reduce((a, b) => a + b, 0)) / e.cf.length) : null }));
}
/** Heat and cold stress from the feels-like (the UTCI's bands, as a guide): the worst of each day. */
export function stress(hours) {
  const out = [];
  const days = new Map();
  for (const h of hours || []) { const d = h.day ?? new Date(h.t).toISOString().slice(0, 10); if (h.feels == null) continue; if (!days.has(d)) days.set(d, []); days.get(d).push(h); }
  for (const [day, hs] of [...days].slice(0, 3)) {
    const hot = hs.reduce((m, h) => (h.feels > m.feels ? h : m)), cold = hs.reduce((m, h) => (h.feels < m.feels ? h : m));
    const heat = hot.feels >= 38 ? 'Very strong' : hot.feels >= 32 ? 'Strong' : hot.feels >= 26 ? 'Moderate' : null;
    const chill = cold.feels <= -27 ? 'Very strong' : cold.feels <= -13 ? 'Strong' : cold.feels <= -5 ? 'Moderate' : null;   // from -5: a UK winter night at -2 is ordinary
    if (heat || chill) out.push({ day, heat, hot, chill, cold });
  }
  return out;
}
