/**
 * TCM Geometry Engine — v9 (production)
 *
 * Turns a scattered field of scored grid points into SPC / SOTUK-style smooth,
 * nested risk polygons. The pipeline is:
 *
 *   scored points → Gaussian-kernel fine field → 3×3 Gaussian blur
 *                 → marching squares (integer-keyed edges) → closed-ring stitch
 *                 → coastline clip → Chaikin smoothing → SVG path
 *
 * The correctness-critical core is unchanged from v8:
 *   • Gaussian interpolation kernel (bounded, C∞) — no 1/d² singularities, so no
 *     radial "star" artefacts around data points.
 *   • Integer-keyed marching-squares stitcher — two cells sharing an edge get the
 *     SAME integer id, eliminating the floating-point near-miss that fragmented
 *     rings; only CLOSED rings are emitted (open bbox-edge chains are dropped).
 *
 * v9 cleanup:
 *   • The two near-identical fine-grid builders (risk + precipitation) are unified
 *     into one parameterised Gaussian-field builder; buildFineGrid and the precip
 *     path are thin wrappers over it.
 *   • A small content-keyed field cache avoids rebuilding an identical smoothed
 *     field when the same scored set is contoured again in a render pass.
 *   • ~180 lines of dead legacy code removed — the cluster/convex-hull/"blob"
 *     builders (buildOutlookLayers, buildBlobs, buildProbabilityLayers,
 *     clusterToPath, convexHull) had no importers; the live outlook layers are
 *     built by lib/tcmOutlookLayers.js via buildContourRiskLayers.
 *
 * Live exports (imported by WeatherPatterns / tcmOutlookLayers / AnimatedMap):
 *   buildContourRiskLayers, buildPrecipContourLayers,
 *   buildFineGrid, buildSmoothedField, ringToSvgPath.
 */

import { clipRingToUKIreland } from './ukIrelandMask';

// ── Constants ──────────────────────────────────────────────────────────────
// FINE_RES drives the contouring field resolution — the biggest lever on output
// sharpness. 0.05° (~5.5 km) traces silky marching-squares contours; it is cheap
// because the field is a Float32Array built via a spatial bucket index.
const FINE_RES           = 0.05;
const SMOOTH_PASSES      = 5;
const FIELD_BLUR_PASSES  = 5;
const MIN_POLY_VERTS     = 6;

// Gaussian kernel: w = exp(-(d/σ)²). σ = source spacing × SIGMA_MULT gives strong
// overlap between adjacent cells so the field is continuous (no point spikes).
// Contributions beyond 3σ are negligible (weight < 0.0002).
const KERNEL_SIGMA_MULT  = 1.15;
const KERNEL_REACH_MULT  = 3.0;

// ═══════════════════════════════════════════════════════════════════════════
// SPATIAL INDEX + GAUSSIAN FIELD
// ═══════════════════════════════════════════════════════════════════════════
// Bin scored points into square buckets of side ~= reach so each fine cell only
// scans its local neighbourhood, making the field O(cells × k) instead of
// O(cells × all points) — the difference between ~1 s and ~10 ms at dense grids.
function buildSpatialIndex(scoredPoints, reach) {
  const cell = reach > 0 ? reach : 1;
  let minLat = Infinity, minLon = Infinity;
  for (const p of scoredPoints) { if (p.lat < minLat) minLat = p.lat; if (p.lon < minLon) minLon = p.lon; }
  // Collision-free integer bucket key (offset non-negative, packed into one int).
  const OFF = 4096, STRIDE = 1 << 20;
  const bk = (bi, bj) => (bi + OFF) * STRIDE + (bj + OFF);
  const buckets = new Map();
  for (const p of scoredPoints) {
    const key = bk(Math.floor((p.lat - minLat) / cell), Math.floor((p.lon - minLon) / cell));
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(p);
  }
  return { buckets, cell, minLat, minLon, bk };
}

/**
 * Build a Gaussian-interpolated field over the bbox at FINE_RES. `sigmaMult` and
 * `reachMult` are multiples of the source `gridStep`. r=0 → south, c=0 → west;
 * values[r * cols + c]. When `maskFn` is given, masked cells are left 0 and a
 * companion `mask` Uint8Array is returned.
 */
function buildGaussianField(scoredPoints, bbox, gridStep, { sigmaMult, reachMult, maskFn = null }) {
  const step = FINE_RES;
  const lat0 = Math.floor(bbox.latMin / step) * step;
  const lon0 = Math.floor(bbox.lonMin / step) * step;
  const rows = Math.round((Math.ceil(bbox.latMax / step) * step - lat0) / step) + 1;
  const cols = Math.round((Math.ceil(bbox.lonMax / step) * step - lon0) / step) + 1;
  const values = new Float32Array(rows * cols);

  const sigma = gridStep * sigmaMult;
  const twoSigmaSq = 2 * sigma * sigma;
  const reach = gridStep * reachMult;
  const maxReachSq = reach * reach;
  const { buckets, cell, minLat, minLon, bk } = buildSpatialIndex(scoredPoints, reach);
  const rad = Math.ceil(reach / cell) + 1;

  for (let r = 0; r < rows; r++) {
    const lat = lat0 + r * step;
    for (let c = 0; c < cols; c++) {
      const lon = lon0 + c * step;
      if (maskFn && !maskFn(lat, lon)) continue;
      const bi = Math.floor((lat - minLat) / cell), bj = Math.floor((lon - minLon) / cell);
      let wsum = 0, vsum = 0;
      for (let di = -rad; di <= rad; di++) {
        for (let dj = -rad; dj <= rad; dj++) {
          const arr = buckets.get(bk(bi + di, bj + dj));
          if (!arr) continue;
          for (let n = 0; n < arr.length; n++) {
            const p = arr[n];
            const d2 = (p.lat - lat) ** 2 + (p.lon - lon) ** 2;
            if (d2 > maxReachSq) continue;
            const w = Math.exp(-d2 / twoSigmaSq);
            wsum += w; vsum += w * p.score;
          }
        }
      }
      values[r * cols + c] = wsum > 0 ? vsum / wsum : 0;
    }
  }

  const base = { values, cols, rows, lat0, lon0, step };
  if (!maskFn) return base;
  const mask = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) mask[r * cols + c] = maskFn(lat0 + r * step, lon0 + c * step) ? 1 : 0;
  return { ...base, mask };
}

/** Public risk-field builder — Gaussian kernel at the standard σ/reach. */
export function buildFineGrid(scoredPoints, bbox, gridStep, maskFn) {
  return buildGaussianField(scoredPoints, bbox, gridStep, {
    sigmaMult: KERNEL_SIGMA_MULT, reachMult: KERNEL_REACH_MULT, maskFn,
  });
}

// Weighted 3×3 Gaussian blur (kernel 1-2-1/2-4-2/1-2-1). Rounds the field
// isotropically each pass without flattening genuine gradients.
function blurField(fine, passes = FIELD_BLUR_PASSES) {
  const { values, cols, rows } = fine;
  const KW = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  let cur = values;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let sum = 0, wsum = 0, ki = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++, ki++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) { const w = KW[ki]; sum += cur[rr * cols + cc] * w; wsum += w; }
      }
      next[r * cols + c] = wsum ? sum / wsum : 0;
    }
    cur = next;
  }
  return { ...fine, values: cur };
}

// ── Content-keyed field cache ────────────────────────────────────────────────
// A blurred field is expensive to build and read-only downstream. When the same
// scored set is contoured again in a render pass (e.g. the outlook overlay and a
// derived layer), rebuilding it is waste. The signature includes the score SUM,
// so any change to the data (not just its length or endpoints) is a cache miss —
// there is no staleness risk short of an astronomically unlikely checksum
// collision. Skipped when a maskFn is involved (a function can't be keyed).
const _fieldCache = new Map();
const FIELD_CACHE_MAX = 8;
function fieldSignature(points, bbox, step, tag) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].score;
  const f = points[0], l = points[points.length - 1];
  return `${tag}|${points.length}|${Math.round(sum)}|${f?.lat},${f?.lon}|${l?.lat},${l?.lon}`
    + `|${bbox.latMin},${bbox.lonMin},${bbox.latMax},${bbox.lonMax}|${step.toFixed(4)}`;
}
function cachedField(sig, build) {
  const hit = _fieldCache.get(sig);
  if (hit) { _fieldCache.delete(sig); _fieldCache.set(sig, hit); return hit; }  // LRU touch
  const field = build();
  _fieldCache.set(sig, field);
  if (_fieldCache.size > FIELD_CACHE_MAX) _fieldCache.delete(_fieldCache.keys().next().value);
  return field;
}

/** Public smoothed scalar field (fine grid + blur), cached by content. */
export function buildSmoothedField(scoredPoints, bbox, gridStep, blurPasses = FIELD_BLUR_PASSES) {
  if (!scoredPoints?.length) return buildFineGrid([], bbox, gridStep, null);
  const sig = fieldSignature(scoredPoints, bbox, gridStep, `smooth:${blurPasses}`);
  return cachedField(sig, () => blurField(buildFineGrid(scoredPoints, bbox, gridStep, null), blurPasses));
}

// ═══════════════════════════════════════════════════════════════════════════
// MARCHING SQUARES — segments with INTEGER edge IDs (shared edges → same id)
// ═══════════════════════════════════════════════════════════════════════════
function marchingSquares(fine, threshold) {
  const { values, cols, rows, lat0, lon0, step } = fine;
  const v = (r, c) => values[r * cols + c];
  const t = (va, vb) => { const d = vb - va; return Math.abs(d) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (threshold - va) / d)); };
  const V_BASE = rows * (cols - 1);
  const hId = (r, c) => r * (cols - 1) + c;         // horizontal edge (r,c)–(r,c+1)
  const vId = (r, c) => V_BASE + r * cols + c;      // vertical   edge (r,c)–(r+1,c)
  const segs = [];

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const vSW = v(r, c), vSE = v(r, c + 1), vNE = v(r + 1, c + 1), vNW = v(r + 1, c);
      const idx = ((vNW >= threshold) << 3) | ((vNE >= threshold) << 2) | ((vSE >= threshold) << 1) | (vSW >= threshold);
      if (idx === 0 || idx === 15) continue;
      const xW = lon0 + c * step, xE = xW + step, yS = lat0 + r * step, yN = yS + step;
      const N = () => ({ id: hId(r + 1, c), pt: [xW + t(vNW, vNE) * step, yN] });
      const S = () => ({ id: hId(r, c),     pt: [xW + t(vSW, vSE) * step, yS] });
      const E = () => ({ id: vId(r, c + 1), pt: [xE, yS + t(vSE, vNE) * step] });
      const W = () => ({ id: vId(r, c),     pt: [xW, yS + t(vSW, vNW) * step] });
      const cc = (vSW + vSE + vNE + vNW) / 4;
      const push = (a, b) => segs.push({ idA: a.id, idB: b.id, ptA: a.pt, ptB: b.pt });
      switch (idx) {
        case  1: push(W(), S()); break;
        case  2: push(S(), E()); break;
        case  3: push(W(), E()); break;
        case  4: push(N(), E()); break;
        case  5: if (cc >= threshold) { push(W(), N()); push(S(), E()); } else { push(W(), S()); push(N(), E()); } break;
        case  6: push(S(), N()); break;
        case  7: push(W(), N()); break;
        case  8: push(N(), W()); break;
        case  9: push(N(), S()); break;
        case 10: if (cc >= threshold) { push(N(), E()); push(W(), S()); } else { push(N(), W()); push(S(), E()); } break;
        case 11: push(N(), E()); break;
        case 12: push(E(), W()); break;
        case 13: push(E(), S()); break;
        case 14: push(S(), W()); break;
      }
    }
  }
  return segs;
}

// ── Stitch segments into CLOSED rings (integer keys) ─────────────────────────
function segmentsToRings(segs) {
  if (!segs.length) return [];
  const adj = new Map(), pts = new Map();
  for (const s of segs) {
    if (s.idA === s.idB) continue;
    pts.set(s.idA, s.ptA); pts.set(s.idB, s.ptB);
    if (!adj.has(s.idA)) adj.set(s.idA, new Set());
    if (!adj.has(s.idB)) adj.set(s.idB, new Set());
    adj.get(s.idA).add(s.idB); adj.get(s.idB).add(s.idA);
  }
  const usedEdge = new Set();
  const ek = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const rings = [];

  const walk = (startId) => {
    const startNbrs = adj.get(startId);
    if (!startNbrs) return;
    for (const firstNbr of [...startNbrs]) {
      if (usedEdge.has(ek(startId, firstNbr))) continue;
      usedEdge.add(ek(startId, firstNbr));
      const chain = [startId, firstNbr];
      let prev = startId, cur = firstNbr, closed = false;
      for (let safety = 0; safety < 500000; safety++) {
        if (cur === startId) { closed = true; break; }
        const nbrs = adj.get(cur);
        if (!nbrs) break;
        let next = null;
        for (const nb of nbrs) {
          if (nb === prev) continue;
          const e = ek(cur, nb);
          if (!usedEdge.has(e)) { next = nb; usedEdge.add(e); break; }
        }
        if (next === null) break;
        chain.push(next); prev = cur; cur = next;
      }
      if (closed && chain.length >= MIN_POLY_VERTS) {
        const raw = chain[chain.length - 1] === chain[0] ? chain.slice(0, -1) : chain;
        if (raw.length >= MIN_POLY_VERTS) rings.push(raw.map(id => pts.get(id)));
      }
    }
  };

  // Pass 1 drains open (bbox-edge) chains so they don't corrupt closed walks;
  // pass 2 emits the closed rings.
  const degOne = [], others = [];
  for (const [id, nb] of adj.entries()) (nb.size === 1 ? degOne : others).push(id);
  for (const id of degOne) walk(id);
  for (const id of others) walk(id);
  return rings;
}

function polygonArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
function chaikinClosed(pts) {
  const n = pts.length; if (n < 3) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
    out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  return out;
}
function smoothRing(ring, passes = SMOOTH_PASSES) {
  let r = ring;
  for (let i = 0; i < passes; i++) r = chaikinClosed(r);
  return r;
}

// Estimate the effective spacing of a scattered set as the median nearest-
// neighbour distance, so the kernel adapts to the ACTUAL density rather than a
// possibly-stale gridStep argument.
function estimateSpacing(points, fallback) {
  const n = points.length;
  if (n < 2) return fallback;
  const sample = n > 200 ? points.filter((_, i) => i % Math.ceil(n / 200) === 0) : points;
  const dists = [];
  for (let i = 0; i < sample.length; i++) {
    let best = Infinity; const a = sample[i];
    for (let j = 0; j < points.length; j++) {
      if (points[j] === a) continue;
      const d2 = (points[j].lat - a.lat) ** 2 + (points[j].lon - a.lon) ** 2;
      if (d2 > 0 && d2 < best) best = d2;
    }
    if (best < Infinity) dists.push(Math.sqrt(best));
  }
  if (!dists.length) return fallback;
  dists.sort((x, y) => x - y);
  const med = dists[Math.floor(dists.length / 2)];
  return med > 0 ? med : fallback;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC CONTOUR BUILDERS
// ═══════════════════════════════════════════════════════════════════════════
export function buildContourRiskLayers(scoredPoints, bbox, gridStep, levels, maskFn, options = {}) {
  if (!scoredPoints?.length || !levels?.length) return [];

  // Adapt the kernel to the real point density (use the smaller of the passed
  // gridStep and the measured spacing so a coarse/stale step can't over-blur).
  const measured = estimateSpacing(scoredPoints, gridStep || 0.35);
  const effStep = Math.min(gridStep || measured, measured * 1.5);

  const blurPasses   = Math.max(options.blurPasses   ?? 4, 3);
  const smoothPasses = Math.max(options.smoothPasses ?? 4, 3);
  const minPolyArea  = Math.max(options.minPolyArea  ?? 0.10, 0.06);
  const clipRing     = options.clipRing === undefined ? clipRingToUKIreland : options.clipRing;

  // Build the smoothed field once (cached), then march every threshold against it.
  const sig = fieldSignature(scoredPoints, bbox, effStep, `contour:${blurPasses}`);
  const fine = cachedField(sig, () => blurField(buildFineGrid(scoredPoints, bbox, effStep, null), blurPasses));

  const result = [];
  for (const { level, threshold } of levels) {
    if (threshold <= 0) continue;
    const segs = marchingSquares(fine, threshold);
    if (!segs.length) continue;
    const raw = segmentsToRings(segs);
    const clipped = clipRing ? raw.flatMap(r => clipRing(r)) : raw;
    const rings = clipped
      .filter(r => r.length >= MIN_POLY_VERTS && polygonArea(r) >= minPolyArea)
      .map(r => smoothRing(r, smoothPasses));
    if (rings.length) result.push({ level, polygons: rings });
  }
  return result;
}

export function ringToSvgPath(ring, projector) {
  if (!ring?.length) return '';
  const screen = ring.map(([lon, lat]) => projector.project(lat, lon));
  if (screen.length < 3) return '';
  const n = screen.length;
  const sm = [(screen[n - 1][0] + screen[0][0]) / 2, (screen[n - 1][1] + screen[0][1]) / 2];
  let d = `M${sm[0].toFixed(1)},${sm[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const cur = screen[i], nxt = screen[(i + 1) % n];
    const mid = [(cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2];
    d += ` Q${cur[0].toFixed(1)},${cur[1].toFixed(1)} ${mid[0].toFixed(1)},${mid[1].toFixed(1)}`;
  }
  return d + ' Z';
}

// Precipitation / hail contours — same engine, wider kernel so rain/hail fields
// spread into broad, smooth coverage. Animation frames are each unique, so these
// fields are not cached (they would only pollute the risk-field cache).
export function buildPrecipContourLayers(pts, bbox, gridStep, bands, maskFn, options = {}) {
  if (!pts?.length || !bands?.length) return [];
  const blurPasses   = options.blurPasses   ?? 5;
  const smoothPasses = options.smoothPasses ?? 4;
  const minPolyArea  = options.minPolyArea  ?? 0.02;
  const reachMult    = options.reachMult    ?? 4.0;
  const clipRing     = options.clipRing === undefined ? clipRingToUKIreland : options.clipRing;

  const scored = pts.map(p => ({ lat: p.lat, lon: p.lon, score: p.value || 0 }));
  const fineRaw = buildGaussianField(scored, bbox, gridStep, {
    sigmaMult: Math.max(1.0, reachMult * 0.45), reachMult,
  });
  const fine = blurField(fineRaw, blurPasses);

  const result = [];
  for (const band of bands) {
    if (band.threshold <= 0) continue;
    const segs = marchingSquares(fine, band.threshold);
    if (!segs.length) continue;
    const raw = segmentsToRings(segs);
    const clipped = clipRing ? raw.flatMap(r => clipRing(r)) : raw;
    const rings = clipped
      .filter(r => r.length >= MIN_POLY_VERTS && polygonArea(r) >= minPolyArea)
      .map(r => smoothRing(r, smoothPasses));
    if (rings.length) result.push({ ...band, polygons: rings });
  }
  return result;
}