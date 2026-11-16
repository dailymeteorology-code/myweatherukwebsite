/* Story mode's cards (Location Weather, 16 Nov 2026, Phase F): the forecast told card by card, each with
   the hour the sky behind it shows (null: now).

     Now          the temperature, the weather, feels like, today's range and the wind
     Next hour    the radar's next hour minute by minute when anything is falling or due, else the next
                  few hours in words with their hours
     Today        \
     Tonight       } the forecast in words (src/lib/location/forecastText.js), with the part's numbers
     Tomorrow     /
     The weekend  Saturday and Sunday from Monday to Thursday; on other days the days ahead

   Every number is the page's own; nothing here is a second forecast. */
import { condLabel, minutelyText, nextHoursText, hourOf, isWet, wetMinute } from '@/lib/ukvLocation';
import { writtenForecast } from '@/lib/location/forecastText';
import { nearestStep, dayRange } from '@/lib/location/travel';

const dow = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();        // 0 Sunday .. 6 Saturday
/* a day's sky: its forecast hour nearest early afternoon */
function middayOf(model, day) {
  const hs = model.full.filter((h) => h.day === day && h.t > Date.now());
  if (!hs.length) return null;
  return hs.reduce((a, b) => (Math.abs(hourOf(b.t) - 13) < Math.abs(hourOf(a.t) - 13) ? b : a)).t;
}

export function storyCards(model, U) {
  if (!model) return [];
  const nowMs = Date.now();
  const n = model.now;
  const cards = [];

  /* now */
  const range = dayRange(model, nowMs);
  cards.push({
    key: 'now', label: 'Now', t: null,
    cond: n.cond, isDay: n.isDay, windy: n.windy,
    temp: n.t2, feels: n.feels, hi: range?.hi ?? null, lo: range?.lo ?? null,
    wind: n.wind, gust: n.gust, wdir: n.wdir,
  });

  /* the next hour, or the next few hours */
  const mins = model.minutely?.mins || [];
  const wetSoon = mins.some(wetMinute);
  if (wetSoon) {
    cards.push({
      key: 'next', label: 'The next hour', t: null,
      /* the hero's word for now when it is wet, as the precipitation card has it */
      text: minutelyText(model.minutely, isWet(n.cond) ? condLabel(n.cond, true) : null),
      mins: mins.slice(0, 61).map((m) => ({ t: m.t, rate: m.rate ?? 0, chance: m.chance ?? 100, kind: m.kind || 'rain' })),
    });
  } else {
    const hours = model.full.filter((h) => h.t > nowMs && h.t <= nowMs + 6.5 * 36e5).slice(0, 6);
    const text = nextHoursText(model, U);
    if (hours.length) {
      cards.push({
        key: 'next', label: 'The next few hours', t: hours[Math.min(2, hours.length - 1)].t,
        text: text || 'Dry for the next few hours.',
        hours: hours.map((h) => ({ t: h.t, cond: h.cond, isDay: h.isDay, windy: h.windy, temp: h.t2, pRain: h.pRain })),
      });
    }
  }

  /* today, tonight, tomorrow: the forecast in words, with the part's own numbers */
  const ol = model.outlook?.days || [];
  const today = ol.find((d) => d.isToday) || null;
  const tomorrow = today ? ol[ol.indexOf(today) + 1] || null : ol[0] || null;
  const windows = { today: today?.dayPart, tonight: today?.nightPart, tomorrow: tomorrow?.dayPart };
  for (const p of writtenForecast(model, U)) {
    const w = windows[p.key];
    if (!w) continue;
    const from = Math.max(nowMs, w.from);
    const sky = nearestStep(model, from + (w.to - from) * (p.key === 'tonight' ? 0.33 : 0.5));
    cards.push({
      key: p.key, label: p.label, t: sky?.t ?? null, text: p.text,
      cond: w.cond, isDay: p.key !== 'tonight', windy: w.windy,
      hi: p.key === 'tonight' ? null : w.hi, lo: p.key === 'tonight' ? w.lo : null,
      pRain: w.pRain, gust: w.gust, feelsLo: w.feelsLo,
    });
  }

  /* the weekend (Monday to Thursday), else the days ahead */
  const rest = ol.filter((d) => !d.isToday && d !== tomorrow && d.dayPart);
  const todayDow = dow(today?.day || ol[0]?.day || '2026-01-05');
  const weekend = rest.filter((d) => dow(d.day) === 6 || dow(d.day) === 0).slice(0, 2);
  const isWeekend = todayDow >= 1 && todayDow <= 4 && weekend.length > 0;
  const days = isWeekend ? weekend : rest.slice(0, 4);
  if (days.length) {
    cards.push({
      key: isWeekend ? 'weekend' : 'ahead', label: isWeekend ? 'The weekend' : 'The days ahead',
      t: middayOf(model, days[0].day),
      days: days.map((d) => ({
        day: d.day, label: d.label, date: d.date, cond: d.cond, windy: d.windy, hi: d.hi, lo: d.lo, pRain: d.pRain,
        words: condLabel(d.cond, true, d.windy),
      })),
    });
  }
  return cards;
}
