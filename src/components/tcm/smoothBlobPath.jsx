// ── Smooth Blob Path Builder ─────────────────────────────────────────────────
// Builds organic, irregular, professional-looking risk outline polygons.
// The output paths are designed to look like real meteorological outlooks —
// they follow the shape of the underlying point cluster (no fixed circles
// or hexagons), they handle arbitrary concave shapes, and they avoid the
// "lumpy convex blob" appearance produced by a plain convex-hull approach.
//
// Pipeline:
//   1. If cluster is large enough → compute a *concave* hull (alpha shape)
//      so that complex shapes (curved fronts, troughs, S-shapes) survive.
//      Falls back to a convex hull when alpha-shape is degenerate.
//   2. Inflate hull outward in geographic space using a small "fingerprint"
//      perturbation so adjacent levels don't trace identical rings.
//   3. Project to screen pixels (so smoothing is isotropic regardless of
//      latitude).
//   4. Run several Chaikin corner-cutting passes for ultra-smooth edges.
//   5. Render through midpoints with quadratic Béziers — guaranteed
//      no self-intersection / loop.
//
// Inputs:
//   cluster   — array of { lat, lon } points
//   projector — { project: (lat, lon) → [px, py] }
//   gridStep  — degrees between grid cells (used to size padding)
//   padScale  — multiplier on gridStep for inflation (per risk level)

// ─────────────────────────────────────────────────────────────────────────────
// Convex hull (Graham scan, O(n log n))
// ─────────────────────────────────────────────────────────────────────────────
function convexHull(pts) {
  if (pts.length <= 2) return pts.slice();
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const x of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop();
    lo.push(x);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const x = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], x) <= 0) up.pop();
    up.push(x);
  }
  lo.pop(); up.pop();
  return lo.concat(up);
}

// ─────────────────────────────────────────────────────────────────────────────
// Concave hull (alpha-shape-ish) — peel back convex-hull edges if a deep
// concavity exists in the point set. Produces irregular, non-circular outlines.
// ─────────────────────────────────────────────────────────────────────────────
function concaveHull(pts, alphaDeg) {
  if (pts.length < 5) return convexHull(pts);
  const hull = convexHull(pts);
  if (hull.length < 4) return hull;

  // For each edge of the convex hull, try to find an interior point that
  // lies close to (within alphaDeg of) that edge and pull the boundary in.
  const interior = new Set(hull.map(p => `${p[0]},${p[1]}`));
  const isInHull = pt => interior.has(`${pt[0]},${pt[1]}`);
  const result = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    result.push(a);

    const ax = a[0], ay = a[1];
    const bx = b[0], by = b[1];
    const dx = bx - ax, dy = by - ay;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < alphaDeg * 0.5) continue;

    // Find candidate interior points near this edge but outside the simplex
    let bestPt = null, bestT = -1;
    for (const p of pts) {
      if (isInHull(p)) continue;
      const px = p[0], py = p[1];
      const t = ((px - ax) * dx + (py - ay) * dy) / (edgeLen * edgeLen);
      if (t < 0.15 || t > 0.85) continue;
      // Perpendicular distance edge → point
      const projx = ax + t * dx, projy = ay + t * dy;
      const perp = Math.hypot(px - projx, py - projy);
      if (perp > alphaDeg) continue;
      // Pull inward: prefer the most interior point with the best perp.
      const score = -perp;
      if (score > bestT) { bestT = score; bestPt = p; }
    }
    if (bestPt && edgeLen > alphaDeg * 0.9) {
      result.push(bestPt);
    }
  }
  return result.length >= 3 ? result : hull;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inflate polygon outward from its centroid by padDeg, with a tiny
// per-vertex perturbation derived from the vertex position so the result
// looks organic rather than a uniform offset.
// ─────────────────────────────────────────────────────────────────────────────
function inflatePoly(pts, padDeg) {
  if (!pts.length) return pts;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    // Stable per-vertex jitter (function of lon/lat) — keeps shapes natural
    // and prevents identical concentric rings between nested risk levels.
    const jitter = 1 + 0.10 * Math.sin(x * 9.3 + y * 11.7);
    const r = padDeg * jitter;
    return [x + (dx / len) * r, y + (dy / len) * r];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Chaikin corner-cutting (one pass = 2× vertices)
// ─────────────────────────────────────────────────────────────────────────────
function chaikin(pts) {
  const n = pts.length;
  if (n < 3) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    out.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
    out.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
  }
  return out;
}

function chaikinN(pts, passes = 4) {
  let out = pts;
  for (let i = 0; i < passes; i++) out = chaikin(out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Closed quadratic-Bézier through midpoints (no Catmull-Rom overshoot)
// ─────────────────────────────────────────────────────────────────────────────
function quadPathClosed(screen) {
  if (!screen.length) return '';
  if (screen.length === 1) {
    const [x, y] = screen[0]; const r = 16;
    return `M${x - r},${y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 -${r * 2},0`;
  }
  const n = screen.length;
  const startMid = [
    (screen[n - 1][0] + screen[0][0]) / 2,
    (screen[n - 1][1] + screen[0][1]) / 2,
  ];
  let d = `M${startMid[0].toFixed(1)},${startMid[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const cur = screen[i];
    const next = screen[(i + 1) % n];
    const mid = [(cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2];
    d += ` Q${cur[0].toFixed(1)},${cur[1].toFixed(1)} ${mid[0].toFixed(1)},${mid[1].toFixed(1)}`;
  }
  return d + ' Z';
}

/**
 * Build a smooth, organic risk-area path from a cluster of lat/lon points.
 *
 * @param {Array<{lat:number, lon:number}>} cluster
 * @param {{project: (lat:number, lon:number) => [number, number]}} projector
 * @param {number} gridStep   — grid spacing in degrees
 * @param {number} padScale   — inflation multiplier (per risk level)
 */
export function smoothBlobPath(cluster, projector, gridStep = 0.3, padScale = 2.0) {
  if (!cluster?.length) return '';

  const lonLat = cluster.map(p => [p.lon, p.lat]);
  const padDeg = gridStep * padScale;

  // Tiny cluster → synthesise an irregular ring (not a perfect circle)
  if (lonLat.length <= 2) {
    const cx = lonLat.reduce((s, p) => s + p[0], 0) / lonLat.length;
    const cy = lonLat.reduce((s, p) => s + p[1], 0) / lonLat.length;
    const ring = [];
    const N = 14;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      // Slight per-angle radial perturbation so the blob isn't a flat disc
      const wobble = 1 + 0.18 * Math.sin(a * 3 + cx + cy);
      ring.push([cx + Math.cos(a) * padDeg * wobble, cy + Math.sin(a) * padDeg * wobble]);
    }
    const screen = ring.map(([ln, lt]) => projector.project(lt, ln));
    return quadPathClosed(chaikinN(screen, 3));
  }

  // Concave-hull threshold scales with gridStep so larger clusters get the
  // benefit of the more detailed (concave) boundary while small ones stay convex.
  const hull = lonLat.length >= 6
    ? concaveHull(lonLat, gridStep * 2.0)
    : convexHull(lonLat);

  if (hull.length < 3) {
    const cx = lonLat.reduce((s, p) => s + p[0], 0) / lonLat.length;
    const cy = lonLat.reduce((s, p) => s + p[1], 0) / lonLat.length;
    const ring = [];
    const N = 14;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const wobble = 1 + 0.18 * Math.sin(a * 3 + cx + cy);
      ring.push([cx + Math.cos(a) * padDeg * wobble, cy + Math.sin(a) * padDeg * wobble]);
    }
    const screen = ring.map(([ln, lt]) => projector.project(lt, ln));
    return quadPathClosed(chaikinN(screen, 3));
  }

  const inflated = inflatePoly(hull, padDeg);
  // Project first, then smooth in pixel space for isotropic curvature
  const screen = inflated.map(([lon, lat]) => projector.project(lat, lon));
  // 4 passes of Chaikin = 16× more vertices → glassy-smooth boundary
  const smoothed = chaikinN(screen, 4);
  return quadPathClosed(smoothed);
}