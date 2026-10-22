/* The outlook timeline: a window from one date and time to another, cut into cells of 1, 2, 3 or
   6 hours.

   What the forecaster marks is kept by the HOUR ({ 'YYYY-MM-DDTHH': level id }), not by cell. A
   cell shows the highest level among its hours, and marking a cell marks all of its hours. So
   switching from 3-hourly to hourly keeps every mark where it was, a window can run over two or
   three days, and moving the window never shuffles marks onto the wrong hours. (The old timeline
   kept one array slot per cell and re-matched them by clock label, which mixed up the two "06"s
   and lost marks whenever the cell count changed.) */

export const GRANS = [['1h', 'Hourly'], ['2h', '2-hourly'], ['3h', '3-hourly'], ['6h', '6-hourly']];
export const stepHours = (g) => ({ '1h': 1, '2h': 2, '3h': 3, '6h': 6 }[g] || 3);
const HOUR = 3600e3;
const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DDTHH:mm' in local time, the value a datetime-local input takes. */
export const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseLocal = (s) => { const d = s ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
export const hourKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`; };

/** The usual outlook window: 06:00 on the day to 06:00 the next, 3-hourly. */
export function defaultTimeline(day) {
  const a = parseLocal(`${day}T06:00`) || new Date();
  return { from: toLocalInput(a), to: toLocalInput(new Date(a.getTime() + 24 * HOUR)), gran: '3h', risk: {}, over: {} };
}

export const MAX_CELLS = 72;

/** The cells of a window: { ms, end, label ('HH'), newDay, weekday, hours: [keys] }. */
export function buildCells(tl) {
  const a = parseLocal(tl?.from);
  let b = parseLocal(tl?.to);
  if (!a) return [];
  if (!b || b <= a) b = new Date(a.getTime() + 24 * HOUR);
  const step = stepHours(tl.gran) * HOUR;
  const out = [];
  for (let t = a.getTime(); t < b.getTime() && out.length < MAX_CELLS; t += step) {
    const end = Math.min(t + step, b.getTime());
    const hours = [];
    for (let h = t; h < end; h += HOUR) hours.push(hourKey(h));
    const d = new Date(t);
    const prev = out[out.length - 1];
    out.push({
      ms: t, end, hours, label: pad(d.getHours()),
      newDay: !!prev && new Date(prev.ms).getDate() !== d.getDate(),
      weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    });
  }
  return out;
}

/** Each cell's level: the most severe of its hours (base levels), or the overlay on any of them. */
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

/** Marks (value) or clears (null) every hour of cells a..b. */
export function markCells(map, cells, a, b, value) {
  const next = { ...map };
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
    for (const h of cells[i]?.hours || []) { if (value) next[h] = value; else delete next[h]; }
  }
  return next;
}

/** Moves the window and its marks by whole days (when the outlook day changes). */
export function shiftTimeline(tl, days) {
  if (!days) return tl;
  const mv = (s) => { const d = parseLocal(s); if (!d) return s; d.setDate(d.getDate() + days); return toLocalInput(d); };
  const mvMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [mv(`${k}:00`).slice(0, 13), v]));
  return { ...tl, from: mv(tl.from), to: mv(tl.to), risk: mvMap(tl.risk), over: mvMap(tl.over) };
}

/** A saved graphic's timeline, including those saved before the timeline had dates: those kept
    one slot per cell from 06:00 (or their start time) on the outlook day. */
export function savedTimeline(s, fallbackDay) {
  if (s?.timeline?.from) return { risk: {}, over: {}, gran: '3h', ...s.timeline };
  const day = s?.validDate || fallbackDay;
  const gran = s?.timelineGran || '3h';
  const startHH = s?.timelineStart || '06:00', endHH = s?.timelineEnd || '06:00';
  const a = parseLocal(`${day}T${startHH}`);
  if (!a) return defaultTimeline(fallbackDay);
  const [sh, sm] = startHH.split(':').map(Number), [eh, em] = endHH.split(':').map(Number);
  let span = (eh * 60 + em) - (sh * 60 + sm);
  if (span <= 0) span += 1440;
  const step = stepHours(gran) * HOUR;
  /* the old layout had a cell on the end time too, covering the hours just after it */
  const n = Math.floor((span * 60e3) / step) + 1;
  const tl = { from: toLocalInput(a), to: toLocalInput(new Date(a.getTime() + n * step)), gran, risk: {}, over: {} };
  const put = (arr, key) => (arr || []).forEach((v, i) => {
    if (!v || i >= n) return;
    for (let h = a.getTime() + i * step; h < a.getTime() + (i + 1) * step; h += HOUR) tl[key][hourKey(h)] = v;
  });
  put(s?.stampRisks, 'risk');
  put(s?.stampOverlays, 'over');
  return tl;
}

/** "Thu 12:00 → Fri 03:00" for the span of the marked cells, or null. */
export function markedSpan(cells, risks, overlays) {
  let first = -1, last = -1;
  cells.forEach((c, i) => { if (risks[i] || overlays[i]) { if (first < 0) first = i; last = i; } });
  if (first < 0) return null;
  const fmt = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
  return { from: cells[first].ms, to: cells[last].end, label: `${fmt(cells[first].ms)} → ${fmt(cells[last].end)}` };
}
