/* ════════════════════════════════════════════════════════════════════════════
   synopticGeo — coastlines for the synoptic + weather-type graphics.

   Three map extents, because the two tools want different framing:

     'uk'        UK and Ireland only. The tightest frame — used when the graphic
                 is about UK weather types and nothing else needs to be in shot.
     'uk-france' UK, Ireland, the northern tip of France and a slab of Atlantic.
                 Enough sea to put a low in without it sitting on the coast.
     'nw-europe' UK through to Scandinavia, Iberia and well out into the
                 Atlantic. The frame for a full synoptic chart, where fronts and
                 the jet need somewhere to come from.

   WHAT THIS RETURNS
   -----------------
   Two views of the same land, because the tools need both:

     paths   SVG path strings already projected into view pixels, for drawing.
     rings   the same polygons in lon/lat, for point-in-land tests.

   The `landPathD` concatenation is what makes "fill the land, not the sea"
   work: it goes straight into an SVG <clipPath>, so a drawn area is clipped to
   the coastline instead of the tool having to intersect polygons itself.

   CACHING
   -------
   Projected paths are meaningless against a different bbox or view size, so the
   cache key embeds a signature of every projection input. Change the extent or
   the canvas and it misses and re-projects rather than silently drawing an
   off-register coastline — the same discipline as lib/ukCoastline.js.
   ════════════════════════════════════════════════════════════════════════════ */

export const MAP_EXTENTS = {
  'uk': {
    id: 'uk', label: 'UK & Ireland',
    bbox: { lonMin: -11.0, lonMax: 2.5, latMin: 49.5, latMax: 61.0 },
    countries: ['united_kingdom', 'ireland'],
  },
  'uk-france': {
    id: 'uk-france', label: 'UK + N France + Atlantic',
    bbox: { lonMin: -18.0, lonMax: 8.0, latMin: 47.0, latMax: 62.0 },
    countries: ['united_kingdom', 'ireland', 'france', 'belgium', 'netherlands'],
  },
  'nw-europe': {
    id: 'nw-europe', label: 'NW Europe + Atlantic',
    bbox: { lonMin: -32.0, lonMax: 20.0, latMin: 42.0, latMax: 68.0 },
    countries: [
      'united_kingdom', 'ireland', 'france', 'belgium', 'netherlands',
      'luxembourg', 'germany', 'denmark', 'norway', 'sweden',
      'spain', 'portugal', 'switzerland', 'austria', 'czech_republic', 'poland',
    ],
  },
};

export const EXTENT_LIST = Object.values(MAP_EXTENTS);

// Both branches of the same repo act as independent mirrors, so a transient
// failure on one doesn't leave the graphic with no coastline at all.
const BRANCHES = ['develop', 'master'];
const urlFor = (branch, country) =>
  `https://raw.githubusercontent.com/georgique/world-geojson/${branch}/countries/${country}.json`;

/* ── Projection ──────────────────────────────────────────────────────────── */

export const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
export const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

/* ASPECT IS PRESERVED and the map is letterboxed inside the view.

   Stretching the bbox to fill the canvas is the obvious thing and it is wrong.
   The UK frame is 13.5 deg of longitude against 0.37 rad of Mercator y, a true
   aspect near 0.64; forcing that into a 700x760 box widened the country by
   about 45% and Britain came out visibly fat. Fitting by the tighter axis and
   centring the remainder keeps every extent correctly shaped, and lets a new
   extent be added without hand-tuning a view size to match it. */
function fit({ bbox, viewW, viewH }) {
  const yTop = mercY(bbox.latMax), yBot = mercY(bbox.latMin);
  const lonSpan = bbox.lonMax - bbox.lonMin;            // degrees
  const ySpan = (yTop - yBot) * 180 / Math.PI;          // degree-equivalents
  const s = Math.min(viewW / lonSpan, viewH / ySpan);   // px per degree
  return { yTop, s, offX: (viewW - lonSpan * s) / 2, offY: (viewH - ySpan * s) / 2 };
}

/** lon/lat -> [x, y] in view pixels, Mercator so the shapes look right. */
export function makeProjector({ bbox, viewW, viewH }) {
  const { yTop, s, offX, offY } = fit({ bbox, viewW, viewH });
  const k = 180 / Math.PI;
  return (lon, lat) => [
    offX + (lon - bbox.lonMin) * s,
    offY + (yTop - mercY(lat)) * k * s,
  ];
}

/** [x, y] in view pixels -> [lon, lat]. Exact inverse of makeProjector. */
export function makeInverseProjector({ bbox, viewW, viewH }) {
  const { yTop, s, offX, offY } = fit({ bbox, viewW, viewH });
  const k = 180 / Math.PI;
  return (x, y) => [
    bbox.lonMin + (x - offX) / s,
    invMercY(yTop - ((y - offY) / s) / k),
  ];
}

const sig = ({ extent, viewW, viewH }) => `${extent}_${viewW}x${viewH}`;

/* ── Geometry helpers ────────────────────────────────────────────────────── */

/** Every linear ring in a GeoJSON feature collection, as [lon, lat][] arrays. */
function ringsOf(gj) {
  const out = [];
  for (const f of (gj?.features || [gj])) {
    const g = f?.geometry || f;
    if (!g?.coordinates) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) if (ring?.length > 2) out.push(ring);
  }
  return out;
}

/* France's file carries French Guiana, Réunion and the rest; Norway carries
   Svalbard. Dropping rings that miss the frame entirely keeps the path data
   (and the localStorage entry) to a sane size, and costs nothing visually —
   they would project far outside the viewBox anyway. */
function intersectsBbox(ring, bbox, pad = 4) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < x0) x0 = lon; if (lon > x1) x1 = lon;
    if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
  }
  return x1 >= bbox.lonMin - pad && x0 <= bbox.lonMax + pad &&
         y1 >= bbox.latMin - pad && y0 <= bbox.latMax + pad;
}

/* Ramer-Douglas-Peucker, in degrees. The source coastlines carry far more
   vertices than a 900px-wide graphic can show; thinning them keeps the SVG
   small enough that html2canvas exports quickly. */
function simplify(ring, tol) {
  if (ring.length < 4 || !tol) return ring;
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
      /* Coastline rings are CLOSED, so on the first pass ring[lo] and ring[hi]
         are the same point and the baseline has no length. Perpendicular
         distance to a zero-length line is 0 for every vertex, so the split
         never happens and the whole ring collapses to its two identical
         endpoints. Fall back to radial distance from that point, which is what
         Douglas-Peucker needs for a closed curve. */
      const d = len < 1e-9
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > farD) { farD = d; far = i; }
    }
    if (far > 0) { keep[far] = true; stack.push([lo, far], [far, hi]); }
  }
  return ring.filter((_, i) => keep[i]);
}

function ringToPath(ring, project) {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1]);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d + 'Z';
}

/** Even-odd point-in-ring. */
function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/* ── Load ────────────────────────────────────────────────────────────────── */

const memCache = new Map();

/**
 * Coastline for one extent, projected to viewW x viewH.
 *
 * Resolves to { paths, landPathD, rings, bbox, project, unproject, isLand }.
 * `paths` is per-ring for drawing; `landPathD` is all of them concatenated for
 * use as a <clipPath>, which is what confines a filled area to land.
 * Resolves with empty paths rather than rejecting if every mirror fails, so the
 * tool still renders its controls and the user isn't left with a blank panel.
 */
export async function loadSynopticGeo({ extent = 'uk', viewW, viewH, simplifyTol = 0.008 } = {}) {
  const def = MAP_EXTENTS[extent] || MAP_EXTENTS.uk;
  const key = sig({ extent, viewW, viewH });
  if (memCache.has(key)) return memCache.get(key);

  const project = makeProjector({ bbox: def.bbox, viewW, viewH });
  const unproject = makeInverseProjector({ bbox: def.bbox, viewW, viewH });

  const build = (rings) => {
    const paths = rings.map(r => ringToPath(r, project));
    const res = {
      extent: def.id, bbox: def.bbox, rings, paths,
      landPathD: paths.join(' '),
      project, unproject,
      isLand: (lon, lat) => {
        let hits = 0;
        for (const r of rings) if (inRing(r, lon, lat)) hits++;
        return hits % 2 === 1;
      },
    };
    memCache.set(key, res);
    return res;
  };

  // Raw lon/lat rings are cached, NOT the projected paths — the same download
  // then serves any view size, and a resize costs a re-project rather than a
  // refetch of a dozen countries.
  const ringKey = `synoptic_rings_v1_${def.id}`;
  try {
    const raw = localStorage.getItem(ringKey);
    if (raw) {
      const rings = JSON.parse(raw);
      if (Array.isArray(rings) && rings.length) return build(rings);
    }
  } catch { /* unreadable cache — refetch */ }

  for (const branch of BRANCHES) {
    try {
      const results = await Promise.all(def.countries.map(c =>
        fetch(urlFor(branch, c))
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)));
      const rings = [];
      for (const gj of results) {
        if (!gj) continue;
        for (const ring of ringsOf(gj)) {
          if (!intersectsBbox(ring, def.bbox)) continue;
          const thin = simplify(ring, simplifyTol);
          if (thin.length > 2) rings.push(thin.map(([lo, la]) => [+lo.toFixed(3), +la.toFixed(3)]));
        }
      }
      if (rings.length) {
        try { localStorage.setItem(ringKey, JSON.stringify(rings)); } catch { /* quota */ }
        return build(rings);
      }
    } catch { /* try the next mirror */ }
  }
  return build([]);
}

/** Drop a cached extent so the next load refetches it. */
export function clearSynopticGeoCache(extent) {
  try { localStorage.removeItem(`synoptic_rings_v1_${extent}`); } catch { /* noop */ }
  for (const k of Array.from(memCache.keys())) if (k.startsWith(`${extent}_`)) memCache.delete(k);
}
