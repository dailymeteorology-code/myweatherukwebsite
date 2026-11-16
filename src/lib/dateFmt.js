/* Dates in words, with the formatter kept (16 Nov 2026, Model Data's first-load speed).

   `new Date(t).toLocaleString(locale, options)` makes a new Intl.DateTimeFormat on every call, and with
   a time zone that costs a tenth of a millisecond or more. Model Data called these thousands of times
   while a page first loaded: the timeline's days (every quarter hour of a 5-day run), and the run
   lists on every render while frames arrived. These give the same words as those three methods (the
   same default fields when none are named) from one formatter per locale and options, kept. */
const kept = new Map();
const DATE = ['weekday', 'year', 'month', 'day'];
const TIME = ['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits'];
const has = (o, list) => !!o && (o.dateStyle != null || o.timeStyle != null || list.some((k) => o[k] != null));

function formatter(locale, options, kind) {
  const key = `${kind}|${locale}|${JSON.stringify(options || {})}`;
  let f = kept.get(key);
  if (!f) {
    const o = { ...(options || {}) };
    /* the fields each Date method adds when none of its own are named */
    if (kind === 'date' && !has(o, DATE)) Object.assign(o, { year: 'numeric', month: 'numeric', day: 'numeric' });
    if (kind === 'time' && !has(o, TIME)) Object.assign(o, { hour: 'numeric', minute: 'numeric', second: 'numeric' });
    if (kind === 'all' && !has(o, [...DATE, ...TIME])) Object.assign(o, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    f = new Intl.DateTimeFormat(locale, o);
    kept.set(key, f);
  }
  return f;
}
const say = (kind) => (t, locale, options) => {
  const ms = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime();
  return Number.isFinite(ms) ? formatter(locale, options, kind).format(ms) : 'Invalid Date';
};

/** new Date(t).toLocaleDateString(locale, options), quicker */
export const dateWords = say('date');
/** new Date(t).toLocaleTimeString(locale, options), quicker */
export const timeWords = say('time');
/** new Date(t).toLocaleString(locale, options), quicker */
export const dateTimeWords = say('all');
