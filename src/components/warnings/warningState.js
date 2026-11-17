/* Where a warning stands (17 Nov 2026, the Warnings tab): in force or still to come, whether the Met Office has
   changed it since it was first issued, and its area as GeoJSON polygons for a map. */

/** 'upcoming' before it starts, 'inforce' while it runs, 'ended' after. */
export function phaseOf(w, now = Date.now()) {
  const from = w?.validFrom ? Date.parse(w.validFrom) : NaN;
  const to = w?.validTo ? Date.parse(w.validTo) : NaN;
  if (Number.isFinite(to) && to <= now) return 'ended';
  if (Number.isFinite(from) && from > now) return 'upcoming';
  return 'inforce';
}

/** Has the Met Office reissued it with changes? Its version goes 1.0, 2.0, 3.0… with each update, and an update
    carries the Met Office's own note of what changed. */
export function isUpdated(w) {
  const v = parseFloat(w?.warningVersion);
  return (Number.isFinite(v) && v > 1) || !!w?.updateDescription;
}

/** When it was last changed (the Met Office's modifiedDate), for an updated warning. */
export function updatedAt(w) {
  if (!isUpdated(w) || !w?.modifiedDate) return null;
  const d = new Date(w.modifiedDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** One warning's identity across refreshes and versions. */
export const warningKey = (w) => String(w?.warningId || w?.id || `${w?.type}|${w?.severity}|${w?.validFrom}|${w?.validTo}`);

/** The warning's area as a list of GeoJSON Polygon/MultiPolygon geometries, or null when it has none to draw.
    Met Office warnings carry theirs as `polygons` or `geometry`; our own keep a hand-drawn area under
    `area_drawing` as [lat, lng] rings. */
export function areaOf(w) {
  if (Array.isArray(w?.polygons) && w.polygons.length) return w.polygons;
  if (w?.geometry && (w.geometry.type === 'Polygon' || w.geometry.type === 'MultiPolygon')) return [w.geometry];
  const drawn = (w?.area_drawing || [])
    .map((s) => (s?.latLngs || []).filter((p) => Array.isArray(p) && p.length === 2))
    .filter((ring) => ring.length >= 3)
    .map((ring) => ({ type: 'Polygon', coordinates: [ring.map(([lat, lng]) => [lng, lat])] }));
  return drawn.length ? drawn : null;
}
