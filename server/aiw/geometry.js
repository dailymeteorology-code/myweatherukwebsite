/**
 * Geometry for warning areas — written here rather than pulled in as a
 * dependency, because the project has no geo library and needs only a handful
 * of well-understood operations.
 *
 * Everything works on a LOCAL GRID: a small equirectangular raster centred on
 * one storm, in kilometres. At storm scale (tens to a few hundred km) the
 * equirectangular distortion is well under 1%, which is far below the
 * uncertainty in where lightning will be in 30 minutes.
 *
 * Coordinates in GeoJSON are [lon, lat], always.
 */

export const KM_PER_DEG_LAT = 111.32;
export const kmPerDegLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bearing in degrees clockwise from north. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x = Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180)
    - Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compass16(deg) {
  const d = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east',
    'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
  return d[Math.round(deg / 22.5) % 16];
}
export function compass8(deg) {
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
}

/* ── local grid ───────────────────────────────────────────────────────── */

/**
 * A raster of `nx` x `ny` cells of `res` km, whose cell (0,0) has its centre
 * at (lat0, lon0) minus half the extent — i.e. the grid is centred on the
 * given point.
 */
export function makeGrid(centreLat, centreLon, halfWidthKm, halfHeightKm, res) {
  const nx = Math.max(4, Math.ceil((2 * halfWidthKm) / res));
  const ny = Math.max(4, Math.ceil((2 * halfHeightKm) / res));
  const kx = kmPerDegLon(centreLat);
  return {
    nx, ny, res, centreLat, centreLon, kx,
    x0: -halfWidthKm, y0: -halfHeightKm,       // km of cell (0,0) corner
    toXY(lat, lon) { return [(lon - centreLon) * kx, (lat - centreLat) * KM_PER_DEG_LAT]; },
    toLatLon(x, y) { return [centreLat + y / KM_PER_DEG_LAT, centreLon + x / kx]; },
    cellCentre(i, j) { return [this.x0 + (i + 0.5) * res, this.y0 + (j + 0.5) * res]; },
  };
}

/* ── marching squares ─────────────────────────────────────────────────── */

/**
 * Closed contour rings of `field >= level` on a grid, in grid km coords.
 * The field is padded with a border of zero so every ring closes.
 * Returns an array of rings (each [[x,y],...], closed).
 */
export function contourRings(field, nx, ny, level, grid) {
  const W = nx + 2; const H = ny + 2;
  const v = (i, j) => (i <= 0 || j <= 0 || i > nx || j > ny) ? 0 : field[(j - 1) * nx + (i - 1)];
  // Corner values at padded indices; vertex positions in grid km.
  const px = (i) => grid.x0 + (i - 0.5) * grid.res;
  const py = (j) => grid.y0 + (j - 0.5) * grid.res;
  const segs = new Map(); // key "x,y" of start -> list of end points
  const addSeg = (a, b) => {
    const ka = `${a[0].toFixed(4)},${a[1].toFixed(4)}`;
    if (!segs.has(ka)) segs.set(ka, []);
    segs.get(ka).push(b);
  };
  const interp = (i1, j1, i2, j2) => {
    const a = v(i1, j1); const b = v(i2, j2);
    const t = a === b ? 0.5 : (level - a) / (b - a);
    return [px(i1) + (px(i2) - px(i1)) * t, py(j1) + (py(j2) - py(j1)) * t];
  };
  for (let j = 0; j < H - 1; j += 1) {
    for (let i = 0; i < W - 1; i += 1) {
      const a = v(i, j) >= level ? 1 : 0;        // bottom-left
      const b = v(i + 1, j) >= level ? 1 : 0;    // bottom-right
      const c = v(i + 1, j + 1) >= level ? 1 : 0;// top-right
      const d = v(i, j + 1) >= level ? 1 : 0;    // top-left
      const code = a | (b << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      const B = () => interp(i, j, i + 1, j);
      const R = () => interp(i + 1, j, i + 1, j + 1);
      const T = () => interp(i, j + 1, i + 1, j + 1);
      const L = () => interp(i, j, i, j + 1);
      // Orientation: inside on the left. Saddles resolved by the centre value.
      const centre = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 >= level;
      switch (code) {
        case 1: addSeg(L(), B()); break;
        case 2: addSeg(B(), R()); break;
        case 3: addSeg(L(), R()); break;
        case 4: addSeg(R(), T()); break;
        case 5: if (centre) { addSeg(L(), T()); addSeg(R(), B()); } else { addSeg(L(), B()); addSeg(R(), T()); } break;
        case 6: addSeg(B(), T()); break;
        case 7: addSeg(L(), T()); break;
        case 8: addSeg(T(), L()); break;
        case 9: addSeg(T(), B()); break;
        case 10: if (centre) { addSeg(B(), L()); addSeg(T(), R()); } else { addSeg(B(), R()); addSeg(T(), L()); } break;
        case 11: addSeg(T(), R()); break;
        case 12: addSeg(R(), L()); break;
        case 13: addSeg(R(), B()); break;
        case 14: addSeg(B(), L()); break;
        default: break;
      }
    }
  }
  // Chain segments into rings.
  const rings = [];
  const keyOf = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  while (segs.size) {
    const [startKey, ends] = segs.entries().next().value;
    const [sx, sy] = startKey.split(',').map(Number);
    const ring = [[sx, sy]];
    let next = ends.pop();
    if (!ends.length) segs.delete(startKey);
    let guard = 0;
    while (next && guard++ < 100000) {
      ring.push(next);
      const k = keyOf(next);
      if (k === startKey) break;
      const list = segs.get(k);
      if (!list) break;
      next = list.pop();
      if (!list.length) segs.delete(k);
    }
    if (ring.length >= 4) {
      const f = ring[0]; const l = ring[ring.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      rings.push(ring);
    }
  }
  return rings;
}

/** Signed area (km²) of a closed ring in km coordinates; positive = counter-clockwise. */
export function ringAreaKm(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

/** Chaikin corner-cutting: smooths the stair-steps of a raster contour. */
export function chaikin(ring, iterations = 2) {
  let pts = ring.slice(0, -1);
  for (let k = 0; k < iterations; k += 1) {
    const out = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i]; const q = pts[(i + 1) % pts.length];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    pts = out;
  }
  pts.push([pts[0][0], pts[0][1]]);
  return pts;
}

/** Douglas–Peucker simplification (tolerance in km). Keeps payloads small. */
export function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0; let idx = -1;
    const [ax, ay] = ring[a]; const [bx, by] = ring[b];
    const dx = bx - ax; const dy = by - ay; const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

/**
 * Turn a probability field into GeoJSON: outer rings above `level`, smoothed,
 * simplified, dropping specks smaller than `minAreaKm2`. Holes are discarded —
 * a warning area with a hole in it is not something anyone can act on.
 */
export function fieldToGeoJSON(field, grid, level, { minAreaKm2 = 30, smooth = 2, tolKm = 0.6 } = {}) {
  const rings = contourRings(field, grid.nx, grid.ny, level, grid)
    .filter((r) => Math.abs(ringAreaKm(r)) >= minAreaKm2)
    .map((r) => (ringAreaKm(r) < 0 ? r.slice().reverse() : r));
  // A contour that lies wholly inside another of the same level is a hole.
  const outers = rings.filter((r, i) => !rings.some((o, j) => j !== i
    && Math.abs(ringAreaKm(o)) > Math.abs(ringAreaKm(r)) && pointInRing(r[0][0], r[0][1], o)));
  if (!outers.length) return null;
  const polys = outers
    .sort((a, b) => Math.abs(ringAreaKm(b)) - Math.abs(ringAreaKm(a)))
    .map((r) => [simplify(chaikin(r, smooth), tolKm).map(([x, y]) => {
      const [lat, lon] = grid.toLatLon(x, y);
      return [+lon.toFixed(4), +lat.toFixed(4)];
    })]);
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

/* ── point / polygon ──────────────────────────────────────────────────── */

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Point-in-GeoJSON (Polygon / MultiPolygon), lon/lat. */
export function pointInGeo(lon, lat, geom) {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const p of polys) {
    if (!pointInRing(lon, lat, p[0])) continue;
    let inHole = false;
    for (let h = 1; h < p.length; h += 1) if (pointInRing(lon, lat, p[h])) inHole = true;
    if (!inHole) return true;
  }
  return false;
}

export function geoBBox(geom) {
  let w = 180; let s = 90; let e = -180; let n = -90;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of polys) for (const [lon, lat] of p[0]) {
    if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/** Area-weighted centroid of a GeoJSON polygon (approximate, local projection). */
export function geoCentroid(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let A = 0; let cx = 0; let cy = 0;
  const lat0 = polys[0][0][0][1];
  const kx = kmPerDegLon(lat0);
  for (const p of polys) {
    const r = p[0];
    for (let i = 0; i < r.length - 1; i += 1) {
      const x1 = r[i][0] * kx; const y1 = r[i][1] * KM_PER_DEG_LAT;
      const x2 = r[i + 1][0] * kx; const y2 = r[i + 1][1] * KM_PER_DEG_LAT;
      const f = x1 * y2 - x2 * y1;
      A += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
  }
  if (Math.abs(A) < 1e-9) { const [lon, lat] = polys[0][0][0]; return [lat, lon]; }
  return [cy / (3 * A) / KM_PER_DEG_LAT, cx / (3 * A) / kx];
}

export function geoAreaKm2(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let total = 0;
  for (const p of polys) {
    const lat0 = p[0][0][1]; const kx = kmPerDegLon(lat0);
    const ring = p[0].map(([lon, lat]) => [lon * kx, lat * KM_PER_DEG_LAT]);
    total += Math.abs(ringAreaKm(ring));
  }
  return total;
}

/** Validity check used before anything is stored or served. */
export function isValidGeometry(geom) {
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  if (!polys.length) return false;
  for (const p of polys) {
    const r = p?.[0];
    if (!Array.isArray(r) || r.length < 4) return false;
    for (const c of r) {
      if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return false;
      if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return false;
    }
    const f = r[0]; const l = r[r.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) return false;
  }
  return true;
}

/** Overlap fraction of two geometries, estimated by sampling (cheap and robust). */
export function overlapFraction(a, b, samples = 400) {
  const [w, s, e, n] = geoBBox(a);
  let inA = 0; let inBoth = 0;
  const side = Math.ceil(Math.sqrt(samples));
  for (let i = 0; i < side; i += 1) for (let j = 0; j < side; j += 1) {
    const lon = w + ((i + 0.5) / side) * (e - w);
    const lat = s + ((j + 0.5) / side) * (n - s);
    if (pointInGeo(lon, lat, a)) { inA += 1; if (pointInGeo(lon, lat, b)) inBoth += 1; }
  }
  return inA ? inBoth / inA : 0;
}
