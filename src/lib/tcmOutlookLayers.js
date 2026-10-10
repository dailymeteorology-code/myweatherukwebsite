// ─────────────────────────────────────────────────────────────────────────────
// TCM OUTLOOK LAYERS — the canonical builders that turn a scored grid into the
// map's polygon layers (Outlook, High-Resolution, Animated step, Severe overlay).
//
// This is the ONE place the outlook geometry is assembled. WeatherPatterns.jsx
// previously carried its own ~300-line copies of these builders (buildOutlookLayers
// / buildOutlookLayersConservative / buildOutlookLayersForStep / buildSevereOverlay)
// while this module sat unused; the page now imports from here so there is a single
// implementation to reason about and tune.
//
// Everything reads the canonical risk scale and levels from components/tcm/
// riskConfig.jsx, so the contour thresholds always match the bands the map keys
// and the verification backend use. Score accessors default to the standard
// perDay/perStep readers but can be overridden per call.
// ─────────────────────────────────────────────────────────────────────────────

import { isInUKIreland } from '@/components/tcm/ukIrelandMask';
import {
  buildContourRiskLayers, ringToSvgPath, buildFineGrid, buildSmoothedField,
} from '@/components/tcm/geometryEngine';
import { RISK_META, CONTOUR_LEVELS } from '@/components/tcm/riskConfig';

// Re-exported so callers (WeatherPatterns / AnimatedMap) can pull the geometry
// primitives from one module alongside the layer builders.
export { ringToSvgPath, buildFineGrid, buildSmoothedField };
export { CONTOUR_LEVELS };

// Contour thresholds for the filled bands (Severe is a hatched overlay, not a
// fill — see buildSevereOverlay). Derived once from the canonical scale.
const CONTOUR_THRESHOLDS = CONTOUR_LEVELS
  .map(level => ({ level, threshold: RISK_META.find(r => r.level === level)?.min ?? 0 }))
  .filter(t => t.threshold > 0);

// Padding (deg) around the region bbox: neighbouring points just offshore keep
// the coastal interpolation from collapsing to zero. Rings are clipped to the
// coastline afterwards, so the pad never leaks risk onto the sea in the output.
const BBOX_PAD = 0.5;

// ── Grid-step detection ──────────────────────────────────────────────────────
// A loaded grid (esp. one restored from the DB) may not carry its own step, so
// infer it as the modal nearest-neighbour spacing, snapped to a known value.
const KNOWN_GRID_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
function snapGridStep(v) {
  let best = v, bestDiff = Infinity;
  for (const s of KNOWN_GRID_STEPS) { const d = Math.abs(v - s); if (d < bestDiff) { bestDiff = d; best = s; } }
  return bestDiff <= 0.15 ? best : v;
}
export function detectGridStep(grid, fallback) {
  if (!grid?.length || grid.length < 2) return fallback;
  const sample = grid.slice(0, Math.min(grid.length, 200));
  const counts = {};
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const dLat = Math.abs(sample[i].lat - sample[j].lat);
      const dLon = Math.abs(sample[i].lon - sample[j].lon);
      if (dLat >= 0.05 && dLat <= 3.0) { const b = Math.round(dLat * 100) / 100; counts[b] = (counts[b] || 0) + 1; }
      else if (dLat < 0.05 && dLon >= 0.05 && dLon <= 3.0) { const b = Math.round(dLon * 100) / 100; counts[b] = (counts[b] || 0) + 2; }
    }
  }
  const entries = Object.entries(counts);
  if (!entries.length) return fallback;
  const step = parseFloat(entries.sort((a, b) => b[1] - a[1])[0][0]);
  if (!Number.isFinite(step)) return fallback;
  return snapGridStep(Math.max(0.1, Math.min(3.0, step)));
}

// ── Default score accessors (overridable per call) ───────────────────────────
const defaultDayScore = (pt, riskType, dayIdx) => pt.perDay?.[dayIdx]?.scores?.[riskType] ?? 0;
const defaultStepScore = (pt, riskType, stepIdx) => {
  let scores = pt.perStep?.[stepIdx]?.scores;
  if (!scores) scores = pt.perDay?.[Math.floor(stepIdx / 8)]?.scores;   // DB grids strip perStep
  if (!scores) return 0;
  if (riskType === 'hail')     return scores.sub?.hail ?? scores.hail ?? 0;
  if (riskType === 'tornado')  return scores.sub?.tornado ?? scores.tornado ?? 0;
  if (riskType === 'lightning') return scores.lightning ?? 0;
  return scores[riskType] ?? 0;
};

// ── Shared helpers ───────────────────────────────────────────────────────────
function inPaddedBox(p, bbox) {
  return p.lat >= bbox.latMin - BBOX_PAD && p.lat <= bbox.latMax + BBOX_PAD
      && p.lon >= bbox.lonMin - BBOX_PAD && p.lon <= bbox.lonMax + BBOX_PAD;
}
function gatherScored(grid, bbox, score) {
  const out = [];
  for (const p of grid) {
    if (!inPaddedBox(p, bbox)) continue;
    const s = score(p);
    if (s > 1) out.push({ lat: p.lat, lon: p.lon, score: s });
  }
  return out;
}
// Contour a scored set to filled bands, returning both the SVG-ready `polygons`
// (rings of [lon,lat]) and `clusters` (rings as {lat,lon}) the renderer reads.
function contour(scored, bbox, step, levels, options) {
  return buildContourRiskLayers(scored, bbox, step, levels, (lat, lon) => isInUKIreland(lat, lon), options)
    .map(l => ({
      level: l.level,
      polygons: l.polygons,
      clusters: l.polygons.map(ring => ring.map(([lon, lat]) => ({ lat, lon }))),
    }));
}

// ── Public builders ──────────────────────────────────────────────────────────

// Broad, smooth nested bands for the Outlook tab.
export function buildOutlookLayers({ grid, riskType, dayIdx, bbox, gridStep, getRiskScore = defaultDayScore }) {
  if (!bbox || !grid?.length) return [];
  const step = detectGridStep(grid, gridStep);
  const scored = gatherScored(grid, bbox, p => getRiskScore(p, riskType, dayIdx));
  if (scored.length < 4) return [];
  return contour(scored, bbox, step, CONTOUR_THRESHOLDS, { blurPasses: 6, smoothPasses: 5, minPolyArea: 0.20 });
}

// Crisper, higher-detail bands for the High-Resolution tab (less blur, larger
// minimum area so only genuine structure survives).
export function buildHiResOutlookLayers({ grid, riskType, dayIdx, bbox, gridStep, getRiskScore = defaultDayScore }) {
  if (!bbox || !grid?.length) return [];
  const step = detectGridStep(grid, gridStep);
  const scored = gatherScored(grid, bbox, p => getRiskScore(p, riskType, dayIdx));
  if (scored.length < 4) return [];
  return contour(scored, bbox, step, CONTOUR_THRESHOLDS, { blurPasses: 2, smoothPasses: 4, minPolyArea: 0.45 });
}

// One 3-hourly step for the Animated tab.
export function buildOutlookLayersForStep({ grid, riskType, stepIdx, bbox, gridStep, getRiskScore = defaultStepScore }) {
  if (!bbox || !grid?.length) return [];
  const step = detectGridStep(grid, gridStep);
  const scored = gatherScored(grid, bbox, p => getRiskScore(p, riskType, stepIdx));
  if (scored.length < 4) return [];
  return contour(scored, bbox, step, CONTOUR_THRESHOLDS, { blurPasses: 6, smoothPasses: 5, minPolyArea: 0.20 });
}

// Severe-thunderstorm hatch overlay — a single hazard-agnostic area driven by the
// severe sub-hazards (weighted) and a meaningful parent-storm score. Rendered on
// TOP of the colour bands, so it is not part of the CONTOUR_LEVELS stack.
export function buildSevereOverlay({ grid, dayIdx, bbox, gridStep }) {
  if (!bbox || !grid?.length) return [];
  const step = detectGridStep(grid, gridStep);
  const pts = [];
  for (const p of grid) {
    if (!inPaddedBox(p, bbox)) continue;
    const day = p.perDay?.[dayIdx];
    if (!day) continue;
    const sub = day.scores?.sub ?? {};
    const sev = Math.max(
      (sub.hail ?? 0) * 0.7,
      (sub.supercell ?? 0) * 0.9,
      (sub.tornado ?? 0) * 1.0,
      (sub.strongWinds ?? 0) * 0.5,
    );
    const ts = day.scores?.thunderstorm ?? 0;
    const combined = Math.max(sev, ts >= 35 ? sev : 0);
    if (combined >= 15) pts.push({ lat: p.lat, lon: p.lon, score: combined });
  }
  if (pts.length < 3) return [];
  return contour(pts, bbox, step, [{ level: 'Severe', threshold: 15 }], { blurPasses: 5, smoothPasses: 5, minPolyArea: 0.25 });
}