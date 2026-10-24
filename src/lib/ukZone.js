/* "BST" or "GMT": the UK's clock at a moment, for the labels beside UK times.

   Worked out from the UK's offset from UTC at that moment, not from the browser's name for the zone:
   browsers differ (some call British winter time "GMT+0"), and the label has to change at exactly
   01:00 UTC on the last Sundays of March and October, whenever the page was opened. */
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });

/** The UK's offset from UTC (minutes) at a moment: 60 in summer, 0 in winter. */
export function ukOffset(d = new Date()) {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return 0;
  const p = Object.fromEntries(LONDON.formatToParts(t).map((x) => [x.type, x.value]));
  const diff = (Number(p.hour) * 60 + Number(p.minute)) - (t.getUTCHours() * 60 + t.getUTCMinutes());
  return ((diff + 2160) % 1440) - 720;   // into -720..720 across midnight
}

/** 'BST' or 'GMT' at a moment (a Date, ms or ISO string; now by default). */
export const ukZone = (d = new Date()) => (ukOffset(d) === 60 ? 'BST' : 'GMT');
