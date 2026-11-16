/* Time travel (Location Weather, 16 Nov 2026, Phase F): the page as it will be at another hour.

   The hours to travel to are the forecast's full hours from the one after now to the end: hourly to
   T+54, then three-hourly from the UKV, then the outlook's own steps to the last day (the same hours the
   hourly strip shows). A travelled model is the page's model with "now" swapped for that hour, so the
   hero, the tiles and the sky read it unchanged; the observed analysis, the radar's next hour and today's
   observed extremes belong to the real now and are left out. Story mode (StoryMode.jsx) travels the
   same way, card by card. */
import { ukDay } from '@/lib/ukvLocation';

/** The hours the slider steps through, after the hour now. */
export function travelSteps(model) {
  if (!model) return [];
  const t0 = model.now?.t ?? Date.now();
  return model.full.filter((h) => h.t > t0 && h.t2 != null && h.cond);
}

/** The full hour nearest to `t` (ms), from now on; null before the forecast starts or past its end. */
export function nearestStep(model, t) {
  const steps = travelSteps(model);
  if (!steps.length || t == null) return null;
  if (t > steps[steps.length - 1].t + 3 * 36e5) return null;
  return steps.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
}

/** The model as it will be at the full hour `t`; the model itself for null (now) or an hour it lacks. */
export function travelModel(model, t) {
  if (!model || t == null) return model;
  const h = model.full.find((x) => x.t === t);
  if (!h) return model;
  const di = model.days.findIndex((d) => d.day === h.day);
  const idx = model.hours.findIndex((x) => x.t === t);
  return {
    ...model,
    now: { ...h, analysed: false },
    nowIdx: idx >= 0 ? idx : model.nowIdx,
    at: t,
    analysis: null,
    minutely: null,
    observed: di === 0 ? model.observed : null,
    days: di > 0 ? model.days.slice(di) : model.days,
  };
}

/** The day's high and low for the hour's day: the days card's (the Mix), else the UKV's. */
export function dayRange(model, t) {
  const day = ukDay(t ?? Date.now());
  const ol = model?.outlook?.days?.find((d) => d.day === day);
  if (ol) return { hi: ol.hi, lo: ol.lo };
  const d = model?.days?.find((x) => x.day === day);
  return d ? { hi: d.hi, lo: d.lo } : null;
}

const WHEN_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });
const LONG_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });
/** "Tue 15:00", and the long form for screen readers. */
export const travelLabel = (t) => WHEN_FMT.format(new Date(t)).replace(',', '');
export const travelLabelLong = (t) => LONG_FMT.format(new Date(t)).replace(',', '');
