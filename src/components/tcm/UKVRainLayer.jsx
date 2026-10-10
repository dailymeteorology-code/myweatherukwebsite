// UKVRainLayer — overlays UK Met Office UKV (ukmo_uk_deterministic_2km) hourly
// rain on the Storm Outlook graphic, synced to the animation playhead.
//
// REGION-SCOPED TRUE 2 km: the overlay is fetched at ~2 km grid spacing over the
// SELECTED outlook region only (not the whole UK). A per-toggle point budget
// keeps Open-Meteo request count bounded; if a region's 2 km grid would exceed
// the budget the spacing is nudged just enough to fit, so small regions get a
// genuine 2 km field and only the very large regions (Scotland / UK-wide)
// auto-coarsen. The raster is bilinearly resampled (not squares) onto a canvas
// pre-warped to Mercator-y, colour-mapped through a continuous radar palette,
// and placed at the region's projected rect so it registers exactly with the
// map. Rendered above all risk areas (z-index 7, above risk outlines at 6).
import { useEffect, useMemo, useState } from 'react';
import { VIEW_W, VIEW_H, MAP_BBOX, Y_TOP, Y_BOT } from '@/components/tcm/stormOutlookHelpers';

const MIN_STEP  = 0.018;         // ~2 km — the target native spacing
const POINT_BUDGET = 60000;      // cap per toggle (~375 Open-Meteo requests @ BATCH)
const BATCH       = 160;          // coords per fetch (URL-length safety)
const CONCURRENCY = 5;           // parallel fetches in flight
const RNDR        = 3;           // sub-grid sampling factor for the raster image

// Continuous precip palette: [mm/h, [r,g,b]] — light blues → teal → green →
// yellow → orange → red → pink → purple, matching the UKV reference ramp.
const STOPS = [
  [0.05, [150, 210, 255]],
  [0.3,  [95, 175, 240]],
  [0.6,  [50, 155, 230]],
  [1.0,  [30, 160, 205]],
  [1.6,  [60, 200, 180]],
  [2.2,  [120, 215, 120]],
  [3.0,  [205, 220, 90]],
  [4.5,  [245, 205, 60]],
  [6.5,  [255, 165, 45]],
  [9,    [245, 110, 40]],
  [13,   [225, 65, 50]],
  [20,   [185, 35, 95]],
  [30,   [150, 55, 165]],
  [45,   [120, 70, 185]],
];
function rampRGB(v) {
  if (!(v > 0)) return null;
  const last = STOPS[STOPS.length - 1];
  if (v >= last[0]) return last[1];
  let i = 0;
  while (i < STOPS.length - 1 && v > STOPS[i + 1][0]) i++;
  const [v0, c0] = STOPS[i], [v1, c1] = STOPS[i + 1];
  const t = (v - v0) / (v1 - v0);
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * t),
    Math.round(c0[1] + (c1[1] - c0[1]) * t),
    Math.round(c0[2] + (c1[2] - c0[2]) * t),
  ];
}
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const invMerc = (my) => (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI;

// Resolve the fetch step: 2 km where it fits the budget, nudged coarser only as
// much as the region's area demands (so larger regions never blow the quota).
function resolveStep(bbox) {
  const area = (bbox.lonMax - bbox.lonMin) * (bbox.latMax - bbox.latMin);
  const fit = Math.sqrt(area / POINT_BUDGET);
  return Math.max(MIN_STEP, fit);
}

function buildGrid(bbox, step) {
  const pts = [];
  let latCount = 0, lonCount = 0, firstRow = true;
  for (let lat = bbox.latMin; lat <= bbox.latMax + 1e-6; lat += step) {
    latCount++;
    let rowN = 0;
    for (let lon = bbox.lonMin; lon <= bbox.lonMax + 1e-6; lon += step) {
      pts.push([Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000]);
      rowN++;
    }
    if (firstRow) { lonCount = rowN; firstRow = false; }
  }
  return { pts, latCount, lonCount };
}

async function fetchBatch(la, lo) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${la.join(',')}&longitude=${lo.join(',')}`
    + '&hourly=precipitation,rain,showers&models=ukmo_uk_deterministic_2km'
    + '&timezone=Europe%2FLondon&forecast_days=7';
  const r = await fetch(url);
  if (!r.ok) throw new Error('UKV ' + r.status);
  return r.json();
}

function useTargetHour(grid, playhead, validDate, timelineGran) {
  return useMemo(() => {
    if (!grid || playhead == null) return null;
    const stepH = timelineGran === '1h' ? 1 : timelineGran === '2h' ? 2 : 3;
    const base = new Date(validDate + 'T06:00:00');
    if (isNaN(base.getTime())) return null;
    const want = new Date(base.getTime() + Math.round(playhead) * stepH * 3600000);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < grid.times.length; i++) {
      const d = Math.abs(new Date(grid.times[i]) - want);
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD <= 2 * 3600000 ? best : null;
  }, [grid, playhead, validDate, timelineGran]);
}

export default function UKVRainLayer({ enabled, validDate, timelineGran, playhead, region }) {
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(false);

  const bbox = region || MAP_BBOX;
  const regionKey = region ? `${region.lonMin}:${region.lonMax}:${region.latMin}:${region.latMax}` : 'uk';

  useEffect(() => {
    if (!enabled) { setGrid(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const step = resolveStep(bbox);
        const { pts, latCount, lonCount } = buildGrid(bbox, step);
        const times = [];
        const field = new Array(pts.length);
        const batches = [];
        for (let i = 0; i < pts.length; i += BATCH) batches.push(pts.slice(i, i + BATCH));
        let pos = 0;
        for (let b = 0; b < batches.length; b += CONCURRENCY) {
          const group = batches.slice(b, b + CONCURRENCY);
          const res = await Promise.all(group.map(batch => {
            const la = batch.map(p => p[0]), lo = batch.map(p => p[1]);
            return fetchBatch(la, lo).catch(() => null);
          }));
          if (cancelled) return;
          for (let g = 0; g < group.length; g++) {
            const data = res[g];
            if (!data) { pos += group[g].length; continue; }
            const arr = Array.isArray(data) ? data : [data];
            if (!times.length && arr[0]?.hourly?.time) {
              for (const t of arr[0].hourly.time) times.push(t);
            }
            for (let k = 0; k < arr.length; k++) {
              const h = arr[k]?.hourly;
              const p = h ? (h.precipitation || []) : [];
              const row = new Array(times.length || p.length);
              for (let t = 0; t < row.length; t++) row[t] = p[t] ?? 0;
              field[pos + k] = row;
            }
            pos += group[g].length;
          }
        }
        if (!cancelled && times.length) {
          const g2d = new Array(latCount);
          for (let li = 0; li < latCount; li++) {
            g2d[li] = new Array(lonCount);
            for (let lo = 0; lo < lonCount; lo++) g2d[li][lo] = field[li * lonCount + lo];
          }
          setGrid({ g2d, latCount, lonCount, times, step, lonMin: bbox.lonMin, latMin: bbox.latMin,
                    latMax: bbox.latMax, lonMax: bbox.lonMax });
        }
      } catch { /* skip — overlay just stays off */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, regionKey]);

  const targetIdx = useTargetHour(grid, playhead, validDate, timelineGran);

  const { dataUrl, x, y, w, h } = useMemo(() => {
    if (!grid || targetIdx == null) return { dataUrl: null };
    const { g2d, latCount, lonCount, step, lonMin, lonMax, latMin, latMax } = grid;
    const imgW = lonCount * RNDR, imgH = latCount * RNDR;
    const off = document.createElement('canvas');
    off.width = imgW; off.height = imgH;
    const ox = off.getContext('2d');
    const img = ox.createImageData(imgW, imgH);
    const myTop = mercY(latMax), myBot = mercY(latMin);
    const sample = (lat, lon) => {
      let fi = (lat - latMin) / step, fj = (lon - lonMin) / step;
      if (fi < 0) fi = 0; else if (fi > latCount - 1) fi = latCount - 1;
      if (fj < 0) fj = 0; else if (fj > lonCount - 1) fj = lonCount - 1;
      const i0 = Math.floor(fi), j0 = Math.floor(fj);
      const i1 = Math.min(latCount - 1, i0 + 1), j1 = Math.min(lonCount - 1, j0 + 1);
      const ti = fi - i0, tj = fj - j0;
      const a = g2d[i0][j0]?.[targetIdx] ?? 0;
      const b = g2d[i0][j1]?.[targetIdx] ?? 0;
      const c = g2d[i1][j0]?.[targetIdx] ?? 0;
      const d = g2d[i1][j1]?.[targetIdx] ?? 0;
      return a * (1 - ti) * (1 - tj) + b * (1 - ti) * tj + c * ti * (1 - tj) + d * ti * tj;
    };
    for (let r = 0; r < imgH; r++) {
      const t = r / (imgH - 1);
      const my = myTop + t * (myBot - myTop);
      const lat = invMerc(my);
      for (let c = 0; c < imgW; c++) {
        const lon = lonMin + (c / (imgW - 1)) * (lonMax - lonMin);
        const v = sample(lat, lon);
        const o = (r * imgW + c) * 4;
        if (v <= 0.05) { img.data[o + 3] = 0; continue; }
        const rgb = rampRGB(v) || [0, 0, 0];
        const alpha = Math.min(0.95, 0.62 + v * 0.012);
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
        img.data[o + 3] = Math.round(alpha * 255);
      }
    }
    ox.putImageData(img, 0, 0);
    // Project the region rect into the shared map viewBox so the image lands
    // exactly over the region the data covers.
    const px = (lon) => ((lon - MAP_BBOX.lonMin) / (MAP_BBOX.lonMax - MAP_BBOX.lonMin)) * VIEW_W;
    const py = (lat) => ((Y_TOP - mercY(lat)) / (Y_TOP - Y_BOT)) * VIEW_H;
    const x0 = px(lonMin), x1 = px(lonMax), y0 = py(latMax), y1 = py(latMin);
    return { dataUrl: off.toDataURL(), x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }, [grid, targetIdx]);

  if (!enabled || !dataUrl) return null;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 7 }}>
      <image href={dataUrl} x={x} y={y} width={w} height={h} preserveAspectRatio="none" />
      {loading && (
        <text x={VIEW_W / 2} y={24} textAnchor="middle"
          style={{ fill: 'rgba(186,230,253,0.9)', fontSize: 16, fontWeight: 700, fontFamily: "'Archivo',system-ui,sans-serif",
                   letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Fetching 2 km UKV rain…
        </text>
      )}
    </svg>
  );
}