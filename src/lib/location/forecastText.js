/* The written forecast for a place (Location Weather, 15 Nov 2026): Today, Tonight and Tomorrow in
   a few plain sentences, and the handful of things that matter most today (the Today card's chips).

   Built only from the page's own shaped forecast (ukvLocation.js shape): every time, temperature and
   amount it names is the forecast's own, rounded as the rest of the page rounds it, so the words never
   say a number the hours and charts do not show. The day's parts are the days card's (the MWUK Mix and
   the Met Office Global: 06:00-18:00 and 18:00-06:00); the times inside them are the UKV's hours
   (hourly to T+54, then three-hourly), which carry the visibility, the ground temperature and TCM NOVA. */
import { condLabel, isWet, hhmm, thunderRisk, snowChance, rateOf, bandOf, uvWord } from '@/lib/ukvLocation';

const DIRS = ['northerly', 'north-easterly', 'easterly', 'south-easterly', 'southerly', 'south-westerly', 'westerly', 'north-westerly'];
const dirWord = (deg) => (deg == null ? '' : DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
const clock = (ms) => (hhmm(ms) === '00:00' ? 'midnight' : hhmm(ms));
const low = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const sum = (hs, k) => hs.reduce((s, h) => s + (h.span > 0 ? h[k] ?? 0 : 0), 0);
const maxBy = (hs, f) => hs.reduce((a, b) => ((f(b) ?? -Infinity) > (f(a) ?? -Infinity) ? b : a), hs[0]);

/* the sky over a part's dry hours, as the days card words it */
function skyWord(hs, isDay) {
  if (!hs.length) return null;
  const c = hs.reduce((s, h) => s + (h.tcc ?? 50), 0) / hs.length;
  if (hs.filter((h) => h.cond === 'fog').length >= Math.max(2, hs.length / 2)) return 'Foggy';
  if (isDay && hs.filter((h) => h.cond === 'hot').length >= 2) return 'Hot and sunny';
  return c < 15 ? (isDay ? 'Sunny' : 'Clear')
    : c < 38 ? (isDay ? 'Mostly sunny' : 'Mostly clear')
      : c < 62 ? (isDay ? 'Sunny spells' : 'Clear spells')
        : c < 82 ? 'Mostly cloudy' : c < 94 ? 'Cloudy' : 'Overcast';
}

/* the wet spell in a part: when it starts, peaks and clears (two dry hours in a row), and whether more
   follows; worded like the hourly card's summary, with each time once */
function wetWords(hs, isDay) {
  const wet = hs.map((h) => isWet(h.cond));
  const i0 = wet.indexOf(true);
  if (i0 < 0) return null;
  let k = -1;
  for (let j = i0; j < hs.length; j++) if (!wet[j] && (j === hs.length - 1 || !wet[j + 1])) { k = j; break; }
  const spell = hs.slice(i0, k < 0 ? hs.length : k);
  const peak = maxBy(spell, rateOf);
  const start = spell[0];
  const what = condLabel(start.cond, isDay);
  const again = k >= 0 && wet.slice(k).some(Boolean);
  let s;
  if (i0 === 0 && k < 0) s = `${what} at times throughout`;
  else if (i0 === 0) s = `${what}, clearing by ${clock(hs[k].t)}`;
  else {
    s = `${what} from about ${clock(start.t)}`;
    if (peak !== start && bandOf(rateOf(peak)) > bandOf(rateOf(start))) s += `, heaviest around ${clock(peak.t)}`;
    if (k >= 0) s += `, clearing by ${clock(hs[k].t)}`;
  }
  if (again) s += ', with more later';
  /* wet from the start: the sky to say is the one after it clears */
  return { text: s, spell, all: i0 === 0 && k < 0, first: i0 === 0, after: k >= 0 ? hs.slice(k) : [] };
}

const FORCE = ['calm', 'light', 'light', 'light', 'moderate', 'fresh', 'strong', 'very strong', 'gale-force', 'severe gale-force', 'storm-force', 'storm-force', 'hurricane-force'];
const forceOf = (mph) => { const lim = [1, 3, 7, 12, 18, 24, 31, 38, 46, 54, 63, 72]; const f = lim.findIndex((x) => (mph ?? 0) < x); return f < 0 ? 12 : f; };

/* one part of the day (from..to, ms): two or three sentences */
function partWords(model, part, from, to, U) {
  /* the part's hours; one that starts now begins with now itself (the radar and the analysis), so the
     words agree with the hero and the hourly summary */
  const nowMs = Date.now();
  const startsNow = from <= nowMs + 60e3 && to > nowMs;
  const later = model.full.filter((h) => h.t > from && h.t <= to + 1 && (!startsNow || h.t > nowMs + 30 * 60e3));
  const hs = startsNow && model.now?.cond ? [{ ...model.now, t: nowMs }, ...later] : later;
  if (!hs.length && !part) return null;
  const isDay = part ? part.kind === 'day' : true;
  const deg = (c) => (c == null ? null : `${Math.round(U.temp(c))}${U.tempUnit}`);
  const out = [];

  /* the weather: the sky, and the wet spell if there is one; a frosty start to a day */
  const wet = wetWords(hs, isDay);
  const dry = hs.filter((h) => !isWet(h.cond));
  const sky = skyWord(dry.length ? dry : hs, isDay) || (part ? condLabel(part.cond, isDay) : null);
  const firstHours = hs.filter((h) => h.t <= from + 3 * 36e5);
  const frostyStart = isDay && firstHours.some((h) => (h.ground ?? 9) <= 0 || (h.t2 ?? 9) <= 0.5);
  let weather;
  if (wet?.all) weather = wet.text;
  else if (wet?.first) { const then = skyWord(wet.after.filter((h) => !isWet(h.cond)), isDay); weather = then ? `${wet.text}, then ${low(then)}` : wet.text; }
  else if (wet) weather = `${sky}, with ${low(wet.text)}`;
  else weather = sky ? `${sky}${hs.length >= 4 ? ' and dry' : ''}` : null;
  if (weather && frostyStart) weather = `A frosty start, then ${low(weather)}`;
  if (weather) {
    /* how much, when it is worth saying: rain in mm, snow as its depth (10 mm of water ~ 10 cm) */
    const rain = sum(hs, 'precip'), snow = sum(hs, 'snow');
    if (snow >= 0.5 && snow >= rain / 2) weather += `, ${snow >= 10 ? Math.round(snow) : snow.toFixed(snow >= 1 ? 0 : 1)} cm of snow possible`;
    else if (rain >= 2) weather += `, around ${U.fmtRain(rain, rain >= 10 ? 0 : 1)} in all`;
    out.push(`${weather}.`);
  }

  /* the temperature: the day's high or the night's low, and the feel when the wind takes much off it */
  const hi = part?.hi ?? (hs.length ? Math.max(...hs.map((h) => h.t2).filter((v) => v != null)) : null);
  const lo = part?.lo ?? (hs.length ? Math.min(...hs.map((h) => h.t2).filter((v) => v != null)) : null);
  if (isDay && hi != null && Number.isFinite(hi)) {
    /* the feel at the warmest hour, when the wind takes 4 degrees or more off it (not the morning's
       coldest feel beside the afternoon's high) */
    const warm = hs.length ? maxBy(hs, (h) => h.t2) : null;
    const feels = warm?.feels;
    out.push(`Highs of ${deg(hi)}${feels != null && warm.t2 - feels >= 4 ? `, feeling more like ${deg(feels)} in the wind` : ''}.`);
  } else if (!isDay && lo != null && Number.isFinite(lo)) {
    const frost = lo <= -3 ? 'A hard frost' : lo <= 0 ? 'A frost' : hs.some((h) => (h.ground ?? 9) <= 0) ? 'A ground frost' : null;
    out.push(`${frost ? `${frost}, with lows` : 'Lows'} of ${deg(lo)}.`);
  }

  /* the wind, when it is worth a mention */
  const strongest = hs.length ? maxBy(hs, (h) => h.wind) : null;
  const gust = hs.length ? Math.max(...hs.map((h) => h.gust ?? 0)) : 0;
  if (strongest && (forceOf(strongest.wind) >= 5 || gust >= 30)) {
    const f = FORCE[forceOf(strongest.wind)];
    out.push(`${f[0].toUpperCase() + f.slice(1)} ${dirWord(strongest.wdir)} winds${gust >= 30 ? `, gusting ${U.fmtWind(gust)}` : ''}.`);
  }

  /* the one hazard most worth knowing in the part: thunder (TCM NOVA), snow, ice, fog, then high UV */
  const nova = (model.nova?.hours || []).filter((x) => x.t > from && x.t <= to && x.t >= Date.now() - 36e5);
  const storm = nova.length ? maxBy(nova, (x) => x.p) : null;
  const sc = snowChance(Math.max(0, ...hs.map((h) => h.snowCond ?? 0)));
  const icy = hs.find((h, i) => (h.ground ?? 9) <= 0 && hs.slice(Math.max(0, i - 3), i + 1).some((x) => (x.precip ?? 0) >= 0.2 || (x.rh ?? 0) >= 97));
  const fog = hs.find((h) => h.vis != null && h.vis < 1);
  const uv = isDay && hs.length ? Math.max(...hs.map((h) => h.uvi ?? 0)) : 0;
  if (storm && storm.p >= 15) out.push(`A ${thunderRisk(storm.p).word.toLowerCase()} risk of thunderstorms, mainly around ${clock(storm.t)}.`);
  else if (sc && sc.level >= 3 && !(wet && wet.spell.some((h) => h.kind === 'snow'))) out.push(`A ${sc.word.toLowerCase()} chance of snow.`);
  else if (icy) out.push(`Icy patches on untreated surfaces from about ${clock(icy.t)}.`);
  else if (fog) out.push(`${fog.vis < 0.2 ? 'Dense fog' : 'Fog patches'} ${isDay && fog.t <= from + 4 * 36e5 ? 'slow to clear' : `forming by ${clock(fog.t)}`}.`);
  else if (uv >= 6) out.push(`UV ${uvWord(uv).toLowerCase()} around the middle of the day.`);
  return out.join(' ');
}

/* the parts to write: today (what is left of 06:00-18:00), tonight (18:00-06:00), tomorrow (06:00-18:00) */
export function writtenForecast(model, U) {
  const ol = model?.outlook?.days || [];
  const nowMs = Date.now();
  const today = ol.find((d) => d.isToday) || null;
  const iToday = today ? ol.indexOf(today) : -1;
  const tomorrow = iToday >= 0 ? ol[iToday + 1] || null : ol[0] || null;
  const parts = [];
  if (today?.dayPart && today.dayPart.to > nowMs + 30 * 60e3) {
    const p = today.dayPart;
    const text = partWords(model, p, Math.max(nowMs, p.from), p.to, U);
    if (text) parts.push({ key: 'today', label: 'Today', text });
  }
  if (today?.nightPart) {
    const p = today.nightPart;
    const text = partWords(model, p, Math.max(nowMs, p.from), p.to, U);
    if (text) parts.push({ key: 'tonight', label: 'Tonight', text });
  }
  if (tomorrow?.dayPart) {
    const p = tomorrow.dayPart;
    const text = partWords(model, p, p.from, p.to, U);
    if (text) parts.push({ key: 'tomorrow', label: 'Tomorrow', text });
  }
  return parts;
}

/* ── what matters most today ─────────────────────────────────────────────────────────────────────
   From now until 06:00 tomorrow: the warnings for the place, then the weather in order of how much it
   changes a day: thunderstorms, snow, ice, heavy rain, fog, gales, heat, cold, frost, strong gusts,
   high UV. Each names the card that says more. Three at most. */
export function mattersToday(model, warnings, U) {
  if (!model) return [];
  const nowMs = Date.now();
  const ol = model.outlook?.days || [];
  const today = ol.find((d) => d.isToday);
  const end = today?.nightPart?.to ?? nowMs + 18 * 36e5;
  const hs = model.full.filter((h) => h.t > nowMs - 30 * 60e3 && h.t <= end);
  const deg = (c) => `${Math.round(U.temp(c))}${U.tempUnit}`;
  const out = [];
  for (const w of warnings || []) {
    if (w.startMs && w.endMs && w.startMs < end && w.endMs > nowMs) {
      out.push({ key: `w${w.id}`, kind: 'warning', warning: w, label: `${w.severity} warning: ${String(w.type).toLowerCase()}`, card: 'warnings', rank: 0 });
    }
  }
  if (!hs.length) return out.slice(0, 3);
  const nova = (model.nova?.hours || []).filter((x) => x.t > nowMs - 36e5 && x.t <= end);
  const storm = nova.length ? maxBy(nova, (x) => x.p) : null;
  if (storm && storm.p >= 15) out.push({ key: 'thunder', kind: 'thunder', label: `Thunderstorms: ${thunderRisk(storm.p).word.toLowerCase()} risk`, sub: `around ${clock(storm.t)}`, card: 'thunder', rank: 1 });
  const scH = maxBy(hs, (h) => h.snowCond ?? 0);
  const sc = snowChance(scH?.snowCond);
  if (sc && sc.level >= 3) out.push({ key: 'snow', kind: 'snow', label: `Snow: ${sc.word.toLowerCase()} chance`, sub: `around ${clock(scH.t)}`, card: 'snow', rank: 2 });
  const icy = hs.find((h, i) => (h.ground ?? 9) <= 0 && hs.slice(Math.max(0, i - 3), i + 1).some((x) => (x.precip ?? 0) >= 0.2 || (x.rh ?? 0) >= 97));
  if (icy) out.push({ key: 'ice', kind: 'ice', label: 'Icy patches', sub: `from ${clock(icy.t)}`, card: 'snow', rank: 3 });
  const wetPeak = maxBy(hs, rateOf);
  const total = sum(hs, 'precip');
  if (rateOf(wetPeak) >= 4 || total >= 15) out.push({ key: 'rain', kind: 'rain', label: 'Heavy rain', sub: `around ${clock(wetPeak.t)}`, card: 'precip', rank: 4 });
  const fog = hs.find((h) => h.vis != null && h.vis < 1);
  if (fog) out.push({ key: 'fog', kind: 'fog', label: fog.vis < 0.2 || hs.some((h) => h.vis != null && h.vis < 0.2) ? 'Dense fog' : 'Fog', sub: `from ${clock(fog.t)}`, card: 'tiles', rank: 5 });
  const gusty = maxBy(hs, (h) => h.gust);
  if ((gusty.gust ?? 0) >= 50) out.push({ key: 'gale', kind: 'wind', label: `Gusts of ${U.fmtWind(gusty.gust)}`, sub: `around ${clock(gusty.t)}`, card: 'tiles', rank: 6 });
  const hot = maxBy(hs, (h) => h.t2);
  if ((hot.t2 ?? 0) >= 27) out.push({ key: 'heat', kind: 'heat', label: `Hot: up to ${deg(hot.t2)}`, sub: `around ${clock(hot.t)}`, card: 'tiles', rank: 7 });
  const cold = hs.reduce((a, b) => ((b.feels ?? 99) < (a.feels ?? 99) ? b : a), hs[0]);
  if ((cold.feels ?? 99) <= -5) out.push({ key: 'cold', kind: 'cold', label: `Feels like ${deg(cold.feels)}`, sub: `around ${clock(cold.t)}`, card: 'tiles', rank: 8 });
  const frost = hs.find((h) => (h.t2 ?? 9) <= 0);
  if (frost && !icy) out.push({ key: 'frost', kind: 'frost', label: 'Frost', sub: `from ${clock(frost.t)}`, card: 'tiles', rank: 9 });
  if ((gusty.gust ?? 0) >= 40 && (gusty.gust ?? 0) < 50) out.push({ key: 'gusts', kind: 'wind', label: `Gusts of ${U.fmtWind(gusty.gust)}`, sub: `around ${clock(gusty.t)}`, card: 'tiles', rank: 10 });
  const uvH = maxBy(hs, (h) => h.uvi ?? 0);
  if ((uvH.uvi ?? 0) >= 6) out.push({ key: 'uv', kind: 'uv', label: `UV ${uvWord(uvH.uvi).toLowerCase()}`, sub: `around ${clock(uvH.t)}`, card: 'tiles', rank: 11 });
  return out.sort((a, b) => a.rank - b.rank).slice(0, 3);
}
