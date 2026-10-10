/* ════════════════════════════════════════════════════════════════════════════
   ukWarningAreas — real council boundaries for Met Office warning areas.

   WHY THIS EXISTS. The warning map used to overlay a PNG published by the Met
   Office at PWSCache/WarningsMaps/UK. That URL now returns 404, so the overlay
   silently failed and the map showed nothing but the dark base layer inside its
   border — a box around the UK. An image overlay was always fragile: it is a
   single raster on someone else's server, aligned by a hardcoded bounding box,
   with no way to tell a blank sky from a dead link.

   WHAT REPLACES IT. The warnings feed names the council areas each warning
   covers ("Aberdeen, Aberdeenshire, Moray"). Those names are matched against
   the actual administrative boundaries — the same TopoJSON the storm outlook
   already draws — and the matched shapes are filled in the warning's colour.
   Accurate to the council boundary, drawn from data we hold, and it fails
   visibly rather than silently.

   NOT EXACT WARNING POLYGONS. The Met Office draws smooth freehand areas that
   can cut across a council. Those are only published through a paid DataHub
   subscription, so this is council-resolution: it always covers the right
   places and sometimes covers a little more. WarningMap says so on the map.
   ════════════════════════════════════════════════════════════════════════════ */

/* Same sources the storm outlook uses, so a file already in the browser cache
   serves both. GB carries an England-only fallback; NI is separate. */
const GB_SOURCES = [
  'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/gb/topo_lad.json',
  'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/eng/topo_lad.json',
];
const NI_SOURCE = 'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/ni/topo_lgd.json';

const CACHE_KEY = 'uk_warning_areas_v1';

/* Every point is a rendering cost and these draw at ~220px tall, so rings are
   thinned hard. 0.012 degrees is roughly a kilometre — invisible at this size,
   and it takes the payload from megabytes to something localStorage accepts. */
const SIMPLIFY_TOL = 0.012;

/** Property that holds the area's name, across the three source schemas. */
const NAME_KEYS = ['LAD13NM', 'LAD16NM', 'LGDNAME', 'lad13nm', 'name', 'NAME'];

function nameOf(props) {
  if (!props) return null;
  for (const k of NAME_KEYS) if (props[k]) return String(props[k]);
  // Fall back to the first string property that looks like a name.
  for (const v of Object.values(props)) {
    if (typeof v === 'string' && v.length > 2 && !/^[A-Z]\d{8}$/.test(v)) return v;
  }
  return null;
}

/* Names are compared with punctuation, case and common suffixes removed, so
   "City of Edinburgh", "Edinburgh, City of" and "Edinburgh" all agree. The feed
   writes them the way a forecaster would, not the way the ONS does. */
export function normaliseAreaName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(city|county|council|borough|district|the|of|and)\b/g, ' ')
    .replace(/[^a-z]+/g, '')
    .trim();
}

/** Ramer-Douglas-Peucker on a lon/lat ring. */
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Array(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const [ax, ay] = ring[lo], [bx, by] = ring[hi];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1, farD = tol;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = ring[i];
      // Closed rings make the baseline zero-length; fall back to radial
      // distance or the whole ring collapses to its two identical endpoints.
      const d = len < 1e-9
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > farD) { farD = d; far = i; }
    }
    if (far > 0) { keep[far] = true; stack.push([lo, far], [far, hi]); }
  }
  return ring.filter((_, i) => keep[i]);
}

/**
 * Decode a quantised TopoJSON into named areas of Leaflet-ready rings.
 * Returns [{ name, rings: [[[lat, lng], ...], ...] }].
 */
function decode(topo) {
  const out = [];
  try {
    const t = topo?.transform;
    const obj = topo?.objects && Object.values(topo.objects)[0];
    if (!t || !obj || !Array.isArray(topo.arcs)) return out;
    const [sx, sy] = t.scale, [tx, ty] = t.translate;
    const arcs = topo.arcs.map((arc) => {
      let x = 0, y = 0; const pts = [];
      for (const [dx, dy] of arc) { x += dx; y += dy; pts.push([x * sx + tx, y * sy + ty]); }
      return pts;
    });
    const arcAt = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());

    for (const geom of (obj.geometries || [])) {
      const name = nameOf(geom.properties);
      if (!name) continue;
      const polys = geom.type === 'Polygon' ? [geom.arcs]
        : geom.type === 'MultiPolygon' ? geom.arcs : null;
      if (!polys) continue;
      const rings = [];
      for (const poly of polys) {
        for (const ring of poly) {
          const raw = [];
          ring.forEach((ai, k) => {
            const c = arcAt(ai);
            // Each arc repeats the previous arc's last point; drop it.
            for (let i = k > 0 ? 1 : 0; i < c.length; i++) raw.push(c[i]);
          });
          const thin = simplify(raw, SIMPLIFY_TOL);
          // Leaflet takes [lat, lng]; TopoJSON stores [lng, lat].
          if (thin.length > 3) rings.push(thin.map(([lng, lat]) => [+lat.toFixed(4), +lng.toFixed(4)]));
        }
      }
      if (rings.length) out.push({ name, rings });
    }
  } catch { /* malformed source — return whatever decoded */ }
  return out;
}

let memo = null;
let inflight = null;

/**
 * Every UK council area, decoded once and cached.
 * Resolves to [] rather than rejecting if every source fails, so the map can
 * still say so instead of throwing inside render.
 */
export async function loadWarningAreas() {
  if (memo) return memo;
  if (inflight) return inflight;

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) { memo = parsed; return memo; }
    }
  } catch { /* unreadable cache — refetch */ }

  inflight = (async () => {
    const areas = [];
    for (const url of GB_SOURCES) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const decoded = decode(await r.json());
        if (decoded.length) { areas.push(...decoded); break; }   // first working GB source wins
      } catch { /* try the fallback */ }
    }
    try {
      const r = await fetch(NI_SOURCE);
      if (r.ok) areas.push(...decode(await r.json()));
    } catch { /* NI is best-effort */ }

    memo = areas;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(areas)); } catch { /* quota */ }
    inflight = null;
    return areas;
  })();

  return inflight;
}

/**
 * Areas matching any of `names`.
 *
 * Matching is exact-on-normalised-name first, then a contains test both ways —
 * the feed writes "Highland" where the boundary file says "Highland Council",
 * and "Na h-Eileanan Siar" turns up under half a dozen spellings. A substring
 * match is loose enough to catch those without pulling in unrelated councils,
 * because council names rarely contain one another.
 */
export function matchAreas(areas, names) {
  if (!Array.isArray(areas) || !Array.isArray(names) || !names.length) return [];
  const wanted = names.map(normaliseAreaName).filter(n => n.length > 2);
  if (!wanted.length) return [];
  const hit = [];
  for (const a of areas) {
    const n = normaliseAreaName(a.name);
    if (!n) continue;
    if (wanted.some(w => w === n || (w.length > 4 && n.includes(w)) || (n.length > 4 && w.includes(n)))) {
      hit.push(a);
    }
  }
  return hit;
}
