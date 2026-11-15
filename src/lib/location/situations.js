/* Situation cards for Location Weather (15 Nov 2026, Phase B): road ice and fog, whether snow will
   settle, the night sky (stargazing, aurora, meteor showers) and the weather for event days. Each
   function looks at the shaped forecast (ukvLocation.js shape) and returns null when it has nothing to
   say, so its card shows only when it matters. Every number comes from the forecast's own hours. */
import { hhmm, ukDay, dayLabel, rateOf, moonPhase, condLabel } from '@/lib/ukvLocation';

const clock = (ms) => (hhmm(ms) === '00:00' ? 'midnight' : hhmm(ms));
/* "23:00" today, "05:00 tomorrow", "05:00 Tue": said from now */
export function when(ms, nowMs = Date.now()) {
  const label = dayLabel(ukDay(ms), ukDay(nowMs));
  return label === 'Today' ? clock(ms) : label === 'Tomorrow' ? `${clock(ms)} tomorrow` : `${clock(ms)} ${label}`;
}
const within = (model, from, to) => model.full.filter((h) => h.t > from && h.t <= to);
/* "from 23:00 to 09:00 tomorrow", the day said once when both times share it; open-ended: "from 23:00" */
function fromTo(a, b, nowMs, open) {
  if (open) return `from ${when(a, nowMs)}`;
  const da = dayLabel(ukDay(a), ukDay(nowMs)), db = dayLabel(ukDay(b), ukDay(nowMs));
  if (da === db) {
    const tail = when(b, nowMs).slice(clock(b).length);
    return `from ${clock(a)} to ${clock(b)}${tail}`;
  }
  return `from ${when(a, nowMs)} to ${when(b, nowMs)}`;
}

/* runs of hours at or above a level: [{from, to, level, hours, broken}] (to = the end of the last hour).
   Runs with three hours or less between them are one spell, "on and off" */
function spells(cells, min = 1, gapH = 3) {
  const out = [];
  let cur = null, gap = 0;
  for (const c of cells) {
    if (c.level >= min) {
      if (cur && gap > 0 && gap <= gapH) cur.broken = true;
      if (!cur) cur = { from: c.t - (c.span || 1) * 36e5, to: c.t, level: c.level, hours: [c], broken: false };
      else { cur.to = c.t; cur.level = Math.max(cur.level, c.level); cur.hours.push(c); }
      gap = 0;
    } else if (cur) {
      gap += c.span || 1;
      if (gap > gapH) { out.push(cur); cur = null; gap = 0; }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ── 30 road ice: the model's ground (skin) temperature at or below freezing on wet or damp surfaces ──
   2: icy stretches likely (rain, sleet or snow in the last three hours, or lying snow, freezing)
   1: patches of frost or ice possible (dew or frost forming on frozen ground, or freezing just after rain) */
export function roadIce(model, nowMs = Date.now()) {
  const hs = within(model, nowMs - 30 * 60e3, nowMs + 36 * 36e5).filter((h) => h.ground != null);
  if (!hs.length) return null;
  const cells = hs.map((h, i) => {
    const g = h.ground;
    const recentWet = hs.slice(Math.max(0, i - 3), i + 1).some((x) => (x.precip ?? 0) >= 0.1 || rateOf(x) >= 0.1);
    const lying = (h.snowLying ?? 0) >= 0.5;
    const damp = (h.rh ?? 0) >= 95 || (h.td != null && h.td >= g - 0.5);
    let level = 0;
    if (g <= 0 && (recentWet || lying)) level = 2;
    else if (g <= 0 && damp) level = 1;
    else if (g <= 1 && recentWet && (h.t2 ?? 9) <= 1) level = 1;
    return { t: h.t, span: h.span || 1, level, ground: g };
  });
  const sp = spells(cells);
  if (!sp.length) return null;
  const first = sp[0];
  const cold = hs.reduce((a, b) => (b.ground < a.ground ? b : a));
  const span = `${first.broken ? 'on and off ' : ''}${fromTo(first.from, first.to, nowMs, first.to >= hs[hs.length - 1].t)}`;
  const headline = first.level >= 2 ? `Untreated roads and paths icy ${span}` : `Patches of frost or ice possible ${span}`;
  return { cells, spells: sp, headline, cold: { t: cold.t, v: cold.ground } };
}

/* ── 31 fog: the UKV's visibility. 2: dense fog (under 200 m), 1: fog (under 1 km) ── */
export function fogSpells(model, nowMs = Date.now()) {
  const hs = within(model, nowMs - 30 * 60e3, nowMs + 36 * 36e5).filter((h) => h.vis != null);
  if (!hs.length) return null;
  const cells = hs.map((h) => ({ t: h.t, span: h.span || 1, level: h.vis < 0.2 ? 2 : h.vis < 1 ? 1 : 0, vis: h.vis }));
  const sp = spells(cells);
  if (!sp.length) return null;
  const first = sp[0];
  const worst = first.hours.reduce((a, b) => (b.vis < a.vis ? b : a));
  const span = `${first.broken ? 'on and off ' : ''}${fromTo(first.from, first.to, nowMs, first.to >= hs[hs.length - 1].t)}`;
  const headline = `${first.level >= 2 ? 'Dense fog' : 'Fog'} ${span}, visibility down to ${worst.vis < 1 ? `${Math.round(worst.vis * 1000 / 10) * 10} m` : `${worst.vis.toFixed(1)} km`}`;
  return { cells, spells: sp, headline };
}

/* ── 32 will the snow settle? Hour by hour over the next three days: snow settles on ground at or
   below +0.5 C (or up to +2 C when it falls hard), sleet only on frozen ground; a covering melts on
   ground above +1.5 C. Depths at 10:1 (1 mm of water ~ 1 cm of fresh snow); lying snow from the UKV
   (water equivalent, settled ~ 0.4 cm a mm). ── */
export function snowSettle(model, nowMs = Date.now()) {
  const hs = within(model, nowMs - 30 * 60e3, nowMs + 72 * 36e5);
  if (!hs.length) return null;
  const snowy = (h) => ['snow', 'sleet', 'mix'].includes(h.kind) && rateOf(h) >= 0.1;
  const falling = hs.filter(snowy);
  const lying0 = (hs[0].snowLying ?? 0) * 0.4;
  if (!falling.length && lying0 < 1) return null;
  let depth = lying0, maxD = lying0, maxT = hs[0].t, settledHours = 0, firstSettle = null, firstFall = falling[0] || null;
  for (const h of hs) {
    const g = h.ground ?? h.t2 ?? 5;
    const rate = rateOf(h);
    const water = h.span > 0 && h.snow != null ? h.snow : (h.snowRate ?? 0) * Math.max(1, h.span || 1);
    const settles = snowy(h) && (h.kind === 'snow' ? g <= 0.5 || (g <= 2 && rate >= 1.5) : g <= 0 && rate >= 1);
    if (settles) {
      depth += water * (h.kind === 'snow' ? 1 : 0.5);
      settledHours += h.span || 1;
      if (!firstSettle) firstSettle = h;
    } else if (g > 1.5) depth -= (rate >= 0.5 && !snowy(h) ? 0.8 : 0.3) * (h.span || 1);
    else if (g > 0.5) depth -= 0.1 * (h.span || 1);
    depth = Math.max(0, depth);
    if (depth > maxD) { maxD = depth; maxT = h.t; }
  }
  const verdict = maxD >= 1 ? 'Likely' : settledHours > 0 || maxD > 0.2 ? 'Possible' : 'Unlikely';
  const cm = (v) => (v >= 10 ? `${Math.round(v)} cm` : `${Math.max(0.5, Math.round(v * 2) / 2)} cm`);
  let headline;
  if (lying0 >= 1 && !firstFall) headline = `About ${cm(lying0)} of snow lying now`;
  else if (verdict === 'Likely') headline = `Snow from about ${when((firstSettle || firstFall).t, nowMs)} is likely to settle, about ${cm(maxD)} by ${when(maxT, nowMs)}`;
  else if (verdict === 'Possible') headline = `Snow from about ${when(firstFall.t, nowMs)} may leave a thin covering on colder surfaces`;
  else headline = `Snow from about ${when(firstFall.t, nowMs)} is unlikely to settle: the ground is too warm`;
  /* sledging: 3 cm or more lying, from the first daylight hour once it is deepest */
  const sledge = maxD >= 3 ? hs.find((h) => h.isDay && h.t >= maxT) || null : null;
  return { verdict, headline, depth: maxD, at: maxT, lying: lying0, settledHours, falling: falling.length, sledge: sledge ? sledge.t : null };
}

/* ── 33 the night sky: the next three nights, darkness the sun 12 degrees below the horizon ── */
export const SHOWERS = [
  { name: 'Quadrantids', m: 1, d: 4, zhr: 110 }, { name: 'Lyrids', m: 4, d: 22, zhr: 18 }, { name: 'Eta Aquariids', m: 5, d: 6, zhr: 30 },
  { name: 'Perseids', m: 8, d: 12, zhr: 100 }, { name: 'Draconids', m: 10, d: 8, zhr: 10 }, { name: 'Orionids', m: 10, d: 21, zhr: 20 },
  { name: 'Leonids', m: 11, d: 17, zhr: 15 }, { name: 'Geminids', m: 12, d: 14, zhr: 150 }, { name: 'Ursids', m: 12, d: 22, zhr: 10 },
];
/* the Kp at which the aurora can be seen low on the northern horizon: 8 in the far south of England,
   about 6 across central Scotland, 4.5 in Shetland */
export const auroraKp = (lat) => Math.max(4, Math.min(8, 8 - (lat - 51) * 0.45));

export function nightSky(model, kp, nowMs = Date.now()) {
  const nights = [];
  const days = model.outlook?.days?.length ? model.outlook.days : model.days.map((d) => ({ day: d.day, sun: d.sun }));
  for (const d of days) {
    if (nights.length >= 3) break;
    const set = d.sun?.set;
    if (!set) continue;
    const next = days[days.indexOf(d) + 1];
    const rise = next?.sun?.rise ?? set + 14 * 36e5;
    if (rise < nowMs) continue;
    const hs = model.full.filter((h) => h.t > Math.max(set, nowMs - 36e5) && h.t <= rise && (h.sun ?? 0) < -12 && h.tcc != null);
    if (!hs.length) continue;
    const cloud = hs.reduce((s, h) => s + h.tcc, 0) / hs.length;
    const mid = (set + rise) / 2;
    const moon = moonPhase(mid);
    const clear = 1 - cloud / 100;
    const score = Math.max(0, Math.min(10, Math.round(10 * clear * (1 - 0.45 * moon.lit))));
    /* the longest run of dark hours with little cloud */
    let best = null, run = [];
    for (const h of hs) {
      if (h.tcc < 30) run.push(h); else run = [];
      if (run.length && (!best || run.length > best.length)) best = [...run];
    }
    const date = new Date(`${d.day}T12:00:00Z`);
    const showers = SHOWERS.filter((s) => {
      const peak = Date.UTC(date.getUTCFullYear(), s.m - 1, s.d);
      return Math.abs(peak - Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) <= 864e5;
    });
    const need = auroraKp(model.lat);
    const kpNight = (kp || []).filter((k) => k.t + 3 * 36e5 > set && k.t < rise);
    const kpMax = kpNight.length ? Math.max(...kpNight.map((k) => k.kp)) : null;
    let aurora = null;
    if (kpMax != null && kpMax >= need - 1) {
      aurora = kpMax >= need ? (clear >= 0.5 ? 'A good chance' : 'Possible, if the cloud breaks') : 'A small chance, perhaps only on a camera';
    }
    nights.push({
      day: d.day, label: dayLabel(d.day, ukDay(nowMs)) === 'Today' ? 'Tonight' : `${dayLabel(d.day, ukDay(nowMs))} night`,
      set, rise, cloud, moon, score, word: score >= 8 ? 'Excellent' : score >= 6 ? 'Good' : score >= 4 ? 'Fair' : 'Poor',
      best: best && best.length >= 2 ? { from: best[0].t - 36e5, to: best[best.length - 1].t } : null,
      showers, kpMax, kpNeed: need, aurora,
    });
  }
  if (!nights.length) return null;
  const worth = nights.some((n) => n.score >= 6 || n.aurora || n.showers.length);
  return worth ? { nights } : null;
}

/* ── 35 event days: fixed dates and the bank holidays for the place's part of the UK ── */
/* England and Wales, Scotland or Northern Ireland, by where the place is (the gov.uk divisions) */
export function divisionOf(lat, lon, country) {
  if (country && country !== 'GB') return null;
  if (lon < -5.4 && lat > 54.0 && lat < 55.4) return 'northern-ireland';
  const border = [[-7, 54.98], [-3.05, 54.98], [-2.65, 55.15], [-2.25, 55.42], [-2.03, 55.81], [1, 55.81]];
  let bl = 54.98;
  for (let i = 0; i < border.length - 1; i++) {
    const [x0, y0] = border[i], [x1, y1] = border[i + 1];
    if (lon >= x0 && lon <= x1) { bl = y0 + ((lon - x0) / (x1 - x0)) * (y1 - y0); break; }
  }
  return lat > bl ? 'scotland' : 'england-and-wales';
}
const FIXED = [
  { m: 10, d: 31, name: 'Halloween', from: 16, to: 21 },
  { m: 11, d: 5, name: 'Bonfire Night', from: 17, to: 22 },
  { m: 12, d: 24, name: 'Christmas Eve', from: 6, to: 23 },
  { m: 12, d: 25, name: 'Christmas Day', from: 6, to: 21, white: true },
  { m: 12, d: 31, name: 'New Year’s Eve', from: 20, to: 24 },
];
export function eventsAhead(model, holidays, nowMs = Date.now()) {
  const days = model.outlook?.days || [];
  if (!days.length) return null;
  const division = divisionOf(model.lat, model.lon, model.location?.country);
  const bank = new Map((holidays?.[division]?.events || []).map((e) => [e.date, e.title]));
  const out = [];
  for (const d of days) {
    const [y, m, dd] = d.day.split('-').map(Number);
    const fixed = FIXED.find((f) => f.m === m && f.d === dd);
    const bankName = bank.get(d.day);
    if (!fixed && !bankName) continue;
    const name = fixed ? fixed.name + (bankName && !/christmas/i.test(bankName) ? ` (${bankName})` : '') : bankName;
    /* the weather when it matters: the evening for an evening event, the day otherwise */
    const from = Date.UTC(y, m - 1, dd, (fixed?.from ?? 9)) - 36e5, to = Date.UTC(y, m - 1, dd, Math.min(23, fixed?.to ?? 18)) + 36e5;
    const hs = model.full.filter((h) => h.t >= from && h.t <= to);
    const part = (fixed && fixed.from >= 16 ? d.nightPart : d.dayPart) || d.dayPart || d.nightPart;
    if (!part && !hs.length) continue;
    const wet = hs.filter((h) => rateOf(h) >= 0.1);
    let white = null;
    if (fixed?.white) white = hs.some((h) => h.kind === 'snow' && rateOf(h) >= 0.1) || (hs[0]?.snowLying ?? 0) >= 1 ? 'Snow is in the forecast: a white Christmas is possible' : 'No snow in the forecast';
    out.push({
      day: d.day, label: d.label, date: d.date, name, part,
      cond: part ? condLabel(part.cond, part.kind !== 'night') : null,
      hi: part?.hi ?? null, lo: part?.lo ?? null, pRain: part?.pRain ?? null, gust: part?.gust ?? null,
      dry: hs.length ? wet.length === 0 : null, evening: !!(fixed && fixed.from >= 16), white,
    });
  }
  return out.length ? out : null;
}

/* ── 29 (part) nights too warm to sleep well: a low of 20 C or more (16 C: uncomfortable) ── */
export function warmNights(model) {
  const out = [];
  for (const d of model.outlook?.days || []) {
    const lo = d.nightPart?.lo;
    if (lo != null && lo >= 16) out.push({ day: d.day, label: d.label, lo, level: lo >= 20 ? 2 : 1 });
  }
  return out.length ? out : null;
}
