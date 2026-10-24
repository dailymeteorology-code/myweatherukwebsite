/* The outlook timeline: a window from one date and time to another, with a stamp every 1, 2, 3
   or 6 hours from the start up to AND including the end (06 09 12 15 18 21 00 for 06:00 to
   midnight, 3-hourly).

   A stamp is a moment, not a block of hours: colour over 21 means the risk runs to 21:00, so the
   Valid line runs from the first coloured stamp to the last, never on to the next one.

   What the forecaster marks is kept by the HOUR ({ 'YYYY-MM-DDTHH': level id }, `v: 2`): a marked
   stamp marks its own hour, and the hours between two marked neighbours take the lower of their
   two levels. A stamp shows the most severe mark within half a step of it. So 3-hourly marks read
   the same hourly (06 to 21 stays 06 to 21), a window can run over two or three days, and moving
   the window never shuffles marks onto the wrong hours. Timelines saved before (`v` missing) kept
   each cell as the block of hours after its stamp; savedTimeline turns them into stamps. */

export const GRANS = [['1h', 'Hourly'], ['2h', '2-hourly'], ['3h', '3-hourly'], ['6h', '6-hourly']];
export const stepHours = (g) => ({ '1h': 1, '2h': 2, '3h': 3, '6h': 6 }[g] || 3);
const HOUR = 3600e3;
const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DDTHH:mm' in local time, the value a datetime-local input takes. */
export const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseLocal = (s) => { const d = s ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
export const hourKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`; };
/** 'YYYY-MM-DDTHH' -> ms (local), or null. */
export const keyMs = (k) => (k ? parseLocal(`${k}:00`)?.getTime() ?? null : null);
/** An hour key moved by whole days (null stays null). */
export const shiftKey = (k, days) => { const t = keyMs(k); if (t == null || !days) return k; const d = new Date(t); d.setDate(d.getDate() + days); return hourKey(d.getTime()); };
/** "Thu 21:00" */
export const stampLabel = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');

/** `d` moved on by whole hours or days of the clock, not of elapsed time: across a clock change
    06:00 + 1 day is still 06:00, and 00:00 + 3 hours is 03:00 (four hours after, the night the
    clocks go back). */
const clockAdd = (d, { hours = 0, days = 0 }) => { const x = new Date(d); if (days) x.setDate(x.getDate() + days); if (hours) x.setHours(x.getHours() + hours); return x; };

/** The usual outlook window: 06:00 on the day to 06:00 the next, 3-hourly. */
export function defaultTimeline(day) {
  const a = parseLocal(`${day}T06:00`) || new Date();
  return { v: 2, from: toLocalInput(a), to: toLocalInput(clockAdd(a, { days: 1 })), gran: '3h', risk: {}, over: {} };
}

export const MAX_CELLS = 73;

/** The window's stamp times, the end included (an end off the step gets its own last stamp). The
    stamps keep to the clock (00, 03, 06…) through a clock change; the hour the clocks go back
    repeats is one hour of the timeline, as its marks are kept by the clock's hour. */
function stampTimes(tl) {
  const a = parseLocal(tl?.from);
  let b = parseLocal(tl?.to);
  if (!a) return { times: [], step: HOUR };
  if (!b || b <= a) b = clockAdd(a, { days: 1 });
  const stepH = stepHours(tl.gran), step = stepH * HOUR, end = b.getTime(), times = [];
  for (let d = a; d.getTime() < end && times.length < MAX_CELLS - 1; d = clockAdd(d, { hours: stepH })) times.push(d.getTime());
  if (hourKey(end) !== hourKey(times[times.length - 1])) times.push(end);
  return { times, step };
}

/** The stamps of a window: { ms, end (the next stamp), at (its hour), hours (the hours it shows:
    within half a step), label ('HH'), newDay, weekday }. */
export function buildCells(tl) {
  const { times, step } = stampTimes(tl);
  const reach = Math.ceil(step / HOUR / 2) - 1;
  return times.map((t, i) => {
    const d = new Date(t);
    const hours = [];
    for (let k = -reach; k <= reach; k++) hours.push(hourKey(t + k * HOUR));
    return {
      ms: t, end: times[i + 1] ?? t + step, at: hourKey(t), hours, label: pad(d.getHours()),
      newDay: i > 0 && new Date(times[i - 1]).getDate() !== d.getDate(),
      weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    };
  });
}

/** Each stamp's level: the most severe mark within half a step of it. */
export function cellLevels(cells, map, severity) {
  return cells.map((c) => {
    let best = null;
    for (const h of c.hours) {
      const v = map?.[h];
      if (v && (best == null || (severity[v] ?? -1) > (severity[best] ?? -1))) best = v;
    }
    return best;
  });
}

/* the hours strictly between two neighbouring stamps: the lower level when both are marked */
function fillBetween(map, cells, i, lv, severity) {
  const x = lv[i], y = lv[i + 1];
  const fill = x && y ? ((severity[x] ?? 0) <= (severity[y] ?? 0) ? x : y) : null;
  for (let h = cells[i].ms + HOUR; h < cells[i + 1].ms; h += HOUR) {
    const k = hourKey(h);
    if (fill) map[k] = fill; else delete map[k];
  }
}

/** Marks (value) or clears (null) stamps a..b, and joins them to marked neighbours. */
export function markCells(map, cells, a, b, value, severity = {}) {
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(cells.length - 1, Math.max(a, b));
  const lv = cellLevels(cells, map, severity);
  const next = { ...map };
  for (let i = lo; i <= hi; i++) {
    lv[i] = value || null;
    for (const h of cells[i].hours) delete next[h];
    if (value) next[cells[i].at] = value;
  }
  for (let i = Math.max(0, lo - 1); i < Math.min(cells.length - 1, hi + 1); i++) fillBetween(next, cells, i, lv, severity);
  return next;
}

/** Hour marks from one level (or null) per stamp, as if each had been clicked. */
export function marksFromStamps(cells, levels, severity = {}) {
  const map = {};
  cells.forEach((c, i) => { if (levels[i]) map[c.at] = levels[i]; });
  for (let i = 0; i < cells.length - 1; i++) fillBetween(map, cells, i, levels, severity);
  return map;
}

/** The timeline made the window from `from` to `to` ('YYYY-MM-DDTHH:mm'), its marks kept, in its
    own steps unless they would give more than `max` stamps (then coarser) or fewer than 4 (finer). */
export function periodTimeline(tl, from, to, max = 25) {
  const out = { ...tl, v: 2, from, to }, g = GRANS.map(([k]) => k), stamps = (i) => buildCells({ ...out, gran: g[i] }).length;
  let gi = Math.max(0, g.indexOf(out.gran));
  while (gi < g.length - 1 && stamps(gi) > max) gi++;
  while (gi > 0 && stamps(gi) < 4) gi--;
  return { ...out, gran: g[gi] };
}
/** The outlook day and second day ('' when it is the same day) a span of time (ms) covers; an end
    at midnight closes the day before. */
export function periodDays(from, to) {
  const a = toLocalInput(new Date(from)).slice(0, 10), b = toLocalInput(new Date(to - 60e3)).slice(0, 10);
  return [a, b === a ? '' : b];
}

/** Moves the window and its marks by whole days (when the outlook day changes). */
export function shiftTimeline(tl, days) {
  if (!days) return tl;
  const mv = (s) => { const d = parseLocal(s); if (!d) return s; d.setDate(d.getDate() + days); return toLocalInput(d); };
  const mvMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [shiftKey(k, days), v]));
  return { ...tl, from: mv(tl.from), to: mv(tl.to), risk: mvMap(tl.risk), over: mvMap(tl.over) };
}

/* A version-1 timeline (each cell the block of hours after its stamp, the end not stamped) as
   stamps: each stamp takes its old cell's level, and the end stamp starts clear. */
function fromV1(tl, severity) {
  const a = parseLocal(tl.from), b = parseLocal(tl.to);
  const step = stepHours(tl.gran) * HOUR;
  const out = { ...tl, v: 2 };
  const cells = buildCells(out);
  for (const key of ['risk', 'over']) {
    const levels = cells.map((c) => {
      if (!a || !b || c.ms >= b.getTime()) return null;
      let best = null;
      for (let h = c.ms; h < Math.min(c.ms + step, b.getTime()); h += HOUR) {
        const v = tl[key]?.[hourKey(h)];
        if (v && (best == null || (severity[v] ?? -1) > (severity[best] ?? -1))) best = v;
      }
      return best;
    });
    out[key] = marksFromStamps(cells, levels, severity);
  }
  return out;
}

/** A saved graphic's timeline: as saved, a version-1 one turned into stamps, or one saved before
    the timeline had dates (one slot per stamp from 06:00, or its start time, on the outlook day,
    the last slot on the end time). */
export function savedTimeline(s, fallbackDay, severity = {}) {
  if (s?.timeline?.from) {
    const tl = { risk: {}, over: {}, gran: '3h', ...s.timeline };
    return tl.v === 2 ? tl : fromV1(tl, severity);
  }
  const day = s?.validDate || fallbackDay;
  const gran = s?.timelineGran || '3h';
  const startHH = s?.timelineStart || '06:00', endHH = s?.timelineEnd || '06:00';
  const a = parseLocal(`${day}T${startHH}`);
  if (!a) return defaultTimeline(fallbackDay);
  const [sh, sm] = startHH.split(':').map(Number), [eh, em] = endHH.split(':').map(Number);
  let span = (eh * 60 + em) - (sh * 60 + sm);
  if (span <= 0) span += 1440;
  const stepH = stepHours(gran);
  const n = Math.floor(span / 60 / stepH) + 1;                       // the slots, by the clock
  const tl = { v: 2, from: toLocalInput(a), to: toLocalInput(clockAdd(a, { hours: Math.max(1, n - 1) * stepH })), gran, risk: {}, over: {} };
  const cells = buildCells(tl);
  tl.risk = marksFromStamps(cells, cells.map((_, i) => s?.stampRisks?.[i] || null), severity);
  tl.over = marksFromStamps(cells, cells.map((_, i) => s?.stampOverlays?.[i] || null), severity);
  return tl;
}

/** "Thu 12:00 → Thu 21:00" from the first coloured stamp to the last (one stamp: its time), or null. */
export function markedSpan(cells, risks, overlays) {
  let first = -1, last = -1;
  cells.forEach((c, i) => { if (risks[i] || overlays[i]) { if (first < 0) first = i; last = i; } });
  if (first < 0) return null;
  const from = cells[first].ms, to = cells[last].ms;
  return { from, to, label: first === last ? stampLabel(from) : `${stampLabel(from)} → ${stampLabel(to)}` };
}
