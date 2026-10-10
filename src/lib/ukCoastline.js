/* ════════════════════════════════════════════════════════════════════════════
   ukCoastline — UK + Ireland coastline, projected to an arbitrary view box.

   Shared by any graphic that needs to draw or CLIP to the UK landmass (the
   monthly climate-anomaly map uses it to clip its grid cells to land so the
   anomaly shading stops at the coast).

   Two things this module is deliberately careful about:

   1. PROJECTION-KEYED CACHE. The cached paths are already projected into pixel
      space, so a cache built against one bbox/view size is meaningless for
      another. The cache key therefore embeds a signature of every projection
      input. Changing the bbox or view size simply misses the cache and
      re-projects, instead of silently drawing an off-register coastline.
      (This is the same class of bug that once pushed the storm outlook's
      county borders off the map.)

   2. DETAIL FLOOR. The high-detail sources carry thousands of vertices; a
      well-known fallback source is a ~56-vertex blob. Anything below the floor
      is rejected so a flaky mirror can never silently downgrade the map.
   ════════════════════════════════════════════════════════════════════════════ */

// Matches the TCM / storm-outlook UK box so graphics register with each other.
export const UK_BBOX = { lonMin: -10.8, lonMax: 2.5, latMin: 49.5, latMax: 61.0 };

// Tried in order; each entry is a [UK, Ireland] pair fetched together.
const GEO_SOURCES = [
  ['https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/ireland.json'],
  ['https://raw.githubusercontent.com/georgique/world-geojson/master/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/master/countries/ireland.json'],
];

const MIN_DETAIL_VERTICES = 800;

export const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
/** Inverse of mercY — Mercator y back to latitude in degrees. */
export const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

/** Build a lon/lat -> [x,y] projector for a bbox rendered at viewW x viewH. */
export function makeProjector({ bbox = UK_BBOX, viewW, viewH }) {
  const yTop = mercY(bbox.latMax), yBot = mercY(bbox.latMin);
  return (lon, lat) => [
    ((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin)) * viewW,
    ((yTop - mercY(lat)) / (yTop - yBot)) * viewH,
  ];
}

/** Pixel [x,y] -> [lon,lat]. Used to walk a raster and sample a lat/lon field. */
export function makeInverseProjector({ bbox = UK_BBOX, viewW, viewH }) {
  const yTop = mercY(bbox.latMax), yBot = mercY(bbox.latMin);
  return (x, y) => [
    bbox.lonMin + (x / viewW) * (bbox.lonMax - bbox.lonMin),
    invMercY(yTop - (y / viewH) * (yTop - yBot)),
  ];
}

/** Signature of everything the projection depends on — drives the cache key. */
function projSig({ bbox, viewW, viewH }) {
  return [bbox.lonMin, bbox.lonMax, bbox.latMin, bbox.latMax, viewW, viewH].join('_');
}

function countVertices(paths) {
  let n = 0;
  for (const d of paths) { const m = d.match(/[ML]/g); if (m) n += m.length; }
  return n;
}

function geoToPath(geometry, project) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      d += 'Z';
    }
  }
  return d;
}

const memCache = new Map();   // projSig -> string[]

/**
 * Fetch + project the UK/Ireland coastline as an array of SVG path strings.
 * Resolves to [] only if every mirror fails, so callers can still render.
 */
export async function loadUKCoastline({ bbox = UK_BBOX, viewW, viewH } = {}) {
  const sig = projSig({ bbox, viewW, viewH });
  if (memCache.has(sig)) return memCache.get(sig);

  const cacheKey = `uk_coastline_v1_${sig}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && countVertices(arr) >= MIN_DETAIL_VERTICES) {
        memCache.set(sig, arr);
        return arr;
      }
    }
  } catch { /* unreadable cache — just refetch */ }

  const project = makeProjector({ bbox, viewW, viewH });
  for (const urls of GEO_SOURCES) {
    try {
      const results = await Promise.all(urls.map(u => fetch(u).then(r => {
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      })));
      const paths = [];
      for (const gj of results) {
        for (const f of (gj.features || [gj])) if (f.geometry) paths.push(geoToPath(f.geometry, project));
      }
      if (countVertices(paths) >= MIN_DETAIL_VERTICES) {
        memCache.set(sig, paths);
        try { localStorage.setItem(cacheKey, JSON.stringify(paths)); } catch { /* quota */ }
        return paths;
      }
    } catch { /* try the next mirror */ }
  }
  return [];
}
