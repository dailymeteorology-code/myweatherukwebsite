/* Picking the right forecast hour for an eclipse marker.
 *
 * Kept apart from the component so it can be exercised directly: choosing the
 * nearest hour to each location's own peak time is the whole point of the
 * fetch, and choosing the wrong one would be invisible on the finished card.
 */

const HALF_DAY_MS = 12 * 3600000;

/**
 * The forecast hour closest to `hhmm` on `isoDate`, from a rawHourly payload.
 *
 * Times on the card are local (BST in August); the series is stamped UTC.
 * Comparing instants sidesteps having to reason about the offset at all.
 *
 * Returns null when the series does not reach that date — beyond half a day the
 * "nearest" hour is not a forecast for that moment in any meaningful sense, and
 * labelling a marker with the wrong day's weather would be worse than leaving
 * it as it was.
 */
export function hourNearest(rawHourly, isoDate, hhmm) {
  const series = rawHourly?.features?.[0]?.properties?.timeSeries || [];
  if (!series.length || !isoDate) return null;

  const [h, m] = String(hhmm || '12:00').split(':').map(Number);
  const hh = Number.isFinite(h) ? h : 12;
  const mm = Number.isFinite(m) ? m : 0;
  const target = new Date(
    `${isoDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`,
  ).getTime();
  if (Number.isNaN(target)) return null;

  let best = null;
  let bestGap = Infinity;
  for (const entry of series) {
    const t = new Date(entry.time).getTime();
    if (Number.isNaN(t)) continue;
    const gap = Math.abs(t - target);
    if (gap < bestGap) { bestGap = gap; best = entry; }
  }
  return bestGap <= HALF_DAY_MS ? best : null;
}
