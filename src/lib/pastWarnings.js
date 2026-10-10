/* Selection and day-bucketing for the Past Warnings panel.
 *
 * Kept out of the component so the date handling is plain, testable code.
 */

export const LOOKBACK_DAYS = 5;
const DAY_MS = 86400000;

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** When a warning actually stopped being in force. */
export const endedAt = (w) => new Date(w.endedAt || w.validTo || 0);

/**
 * Everything no longer in force within the retention window, newest first.
 *
 * Filtering on `validTo < now` alone silently drops every CANCELLED warning,
 * because a warning withdrawn early still has a future end time. The backend
 * stamps a status, so trust that where it exists and fall back to the clock
 * only for records saved before it did.
 */
export function selectPast(warnings = [], now = Date.now(), lookbackDays = LOOKBACK_DAYS) {
  const cutoff = now - lookbackDays * DAY_MS;
  return warnings
    .filter((w) => {
      if (w.status === 'active') return false;
      const ended = endedAt(w).getTime();
      if (!ended || ended < cutoff) return false;
      if (w.status === 'cancelled' || w.status === 'expired') return true;
      return ended < now;                    // legacy records with no status
    })
    .sort((a, b) => endedAt(b) - endedAt(a));
}

/**
 * Calendar-day buckets covering the whole retention window, oldest first.
 *
 * Built by stepping the calendar date rather than subtracting a fixed 24 hours:
 * the UK clock change makes one day 23 or 25 hours long, and millisecond
 * arithmetic would slide every bucket off midnight for half the year.
 *
 * There are lookbackDays + 1 buckets, because a rolling window of
 * lookbackDays x 24h always touches one more calendar day than that (the oldest
 * of them only partially). That guarantees every retained warning lands in
 * exactly one bucket, so the bars add up to the headline total.
 */
export function bucketDays(pastWarnings = [], now = Date.now(), lookbackDays = LOOKBACK_DAYS) {
  const base = startOfDay(new Date(now));
  const out = [];
  for (let i = lookbackDays; i >= 0; i -= 1) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const inDay = pastWarnings.filter((w) => startOfDay(endedAt(w)).getTime() === start);
    out.push({ start, count: inDay.length, warnings: inDay });
  }
  return out;
}
