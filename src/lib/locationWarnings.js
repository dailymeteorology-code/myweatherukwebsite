/* Met Office warnings that actually cover ONE point.
 *
 * The warnings themselves are already scraped, parsed and cached server-side by
 * the getMetOfficeWarnings function (entity: CachedWarnings), including the real
 * freehand polygons the Met Office draws on its own map. Nothing here fetches
 * anything from the Met Office — it reads that cache and answers a single
 * question: is this town inside any of those shapes, and on which day.
 *
 * Region/county name matching is deliberately NOT used as a fallback. A
 * warning's county list is far coarser than its polygon, so falling back to it
 * would tell somebody in a county's far corner that they are warned when the
 * shape plainly misses them — worse than saying nothing.
 */
import { base44 } from '@/api/base44Client';

export const SEVERITY_COLOUR = {
  Yellow: '#facc15',
  Amber: '#f97316',
  Red: '#ef4444',
};

const SEVERITY_RANK = { Yellow: 1, Amber: 2, Red: 3 };

export function severityColour(severity) {
  return SEVERITY_COLOUR[severity] || SEVERITY_COLOUR.Yellow;
}

/** Ray casting on one ring of [lon, lat] pairs. */
function inRing(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
function inPolygon(rings, lat, lon) {
  if (!rings?.length || !inRing(rings[0], lat, lon)) return false;
  for (let i = 1; i < rings.length; i += 1) if (inRing(rings[i], lat, lon)) return false;
  return true;
}

export function pointInGeometry(geometry, lat, lon) {
  if (!geometry?.coordinates) return false;
  if (geometry.type === 'Polygon') return inPolygon(geometry.coordinates, lat, lon);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(rings => inPolygon(rings, lat, lon));
  }
  return false;
}

/**
 * Every currently-published warning whose area contains this point.
 *
 * Expired and cancelled warnings are dropped — this sits above a forecast, so
 * only what is in force or still to come belongs here.
 */
export async function fetchWarningsForPoint(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const records = await base44.entities.CachedWarnings.list('-fetched_at', 1).catch(() => []);
  const all = Array.isArray(records?.[0]?.all_warnings) ? records[0].all_warnings : [];
  const now = Date.now();

  return all
    .filter(w => (w.status ?? 'active') === 'active')
    .filter(w => !w.validTo || new Date(w.validTo).getTime() >= now)
    .filter(w => Array.isArray(w.polygons) && w.polygons.some(g => pointInGeometry(g, lat, lon)))
    .map(w => ({
      id: w.id || `${w.type}-${w.severity}-${w.validFrom}`,
      type: w.type || 'Weather',
      severity: w.severity || 'Yellow',
      colour: severityColour(w.severity),
      headline: w.headline || '',
      description: w.description || '',
      whatToExpect: Array.isArray(w.whatToExpect) ? w.whatToExpect : [],
      validFrom: w.validFrom || null,
      validTo: w.validTo || null,
      startMs: w.validFrom ? new Date(w.validFrom).getTime() : null,
      endMs: w.validTo ? new Date(w.validTo).getTime() : null,
    }))
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
}

/* ─── Manual (admin-authored) warnings ───────────────────────────────────────
 *
 * The Met Office never issues wildfire warnings — they are a TCM-specific
 * product the admin authors through ManualWarningsAdmin. A manual warning may
 * either carry a hand-drawn `area_drawing` ring (admin drew the exact area) or
 * list `areas` as text chips, so a point is "in" the warning when it falls
 * inside any of its drawn rings OR the admin left it with no geometry at all
 * (treated as nation-wide — that is the wildfire use case).
 */
/** Inside any of a manual warning's drawn rings (array of {latLngs}). */
function inManualDrawing(warning, lat, lon) {
  const drawing = Array.isArray(warning.area_drawing) ? warning.area_drawing : [];
  if (!drawing.length) return null; // no geometry → treat as nationwide
  for (const shape of drawing) {
    const ring = Array.isArray(shape.latLngs) ? shape.latLngs : [];
    const poly = ring.map(([la, lo]) => [lo, la]);
    if (poly.length >= 3 && inPolygon(poly, lat, lon)) return true;
  }
  return false;
}

/**
 * Every currently-published manual warning covering this point. A manual
 * warning with no drawn geometry is treated as nation-wide (wildfire) and
 * always matches. Active/upcoming status and valid window are honoured.
 */
export async function fetchManualWarningsForPoint(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const rows = await base44.entities.ManualWarning.list().catch(() => []);
  const now = Date.now();
  return rows
    .filter(w => w.is_published !== false)
    .filter(w => {
      const to = w.valid_to ? new Date(w.valid_to).getTime() : null;
      const from = w.valid_from ? new Date(w.valid_from).getTime() : null;
      if (to && to < now) return false;
      if (from && from > now) return false; // upcoming not yet in force
      return true;
    })
    .map(w => {
      const drawn = inManualDrawing(w, lat, lon);
      return { w, matchesPoint: drawn !== null ? drawn : true };
    })
    .filter(x => x.matchesPoint)
    .map(({ w }) => ({
      id: w.id || `${w.type}-${w.severity}-${w.valid_from}`,
      type: w.type || 'Weather',
      severity: w.severity || 'Yellow',
      colour: severityColour(w.severity),
      headline: w.title || '',
      description: w.description || '',
      whatToExpect: [],
      validFrom: w.valid_from || null,
      validTo: w.valid_to || null,
      startMs: w.valid_from ? new Date(w.valid_from).getTime() : null,
      endMs: w.valid_to ? new Date(w.valid_to).getTime() : null,
      isManual: true,
    }))
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
}

/** Merge Met Office and manual warnings, keeping the single highest-severity
 *  duplicate per type. Manual warnings of a type override Met Office ones of
 *  the same type when an admin has drawn the exact area, mirroring the Home
 *  page's override behaviour. */
export async function fetchAllWarningsForPoint(lat, lon) {
  const [met, manual] = await Promise.all([
    fetchWarningsForPoint(lat, lon),
    fetchManualWarningsForPoint(lat, lon),
  ]);
  return mergeLocationWarnings(met, manual);
}

export function mergeLocationWarnings(met = [], manual = []) {
  // Manual warnings whose type also exists among the Met Office ones WIN: the
  // admin drew the authoritative area, so drop the coarser auto one.
  const manualTypes = new Set(manual.map(w => (w.type || '').toLowerCase()));
  const keptMet = met.filter(w => !manualTypes.has((w.type || '').toLowerCase()));
  const merged = [...keptMet, ...manual];
  merged.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  return merged;
}
