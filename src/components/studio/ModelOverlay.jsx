/* The Met Office UKV under an outlook graphic's drawing: rain on a thunderstorm outlook, snowfall
   or lying-snow totals on a snow graphic, gusts on a wind graphic, each in the colours of that
   graphic's own key so the model and the forecast read on one scale.

   The data are the Model Data page's frames (the UKV 2 km from the Met Office's AWS bucket,
   built by this server), not Open-Meteo. It replaces the old UKV rain layer, which asked Open-Meteo
   for up to 60,000 points at every toggle and only showed anything while the timeline played.

   The frame is the newest UKV run holding the hour asked for, or over a period (`span`) the highest
   value of every hour in it, from the newest run reaching its end. A field the server has not built
   for that run yet is queued (the status call does that) and drawn as soon as its step is ready.

   `look` shapes it like the TCM NOVA import's areas: Detailed is the 2 km field as it is; Smooth and
   Broad first spread each value over its neighbours (SHAPES' grow) and then blur it, so the bands
   come out as fewer, rounder areas. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { laea } from '@/lib/ukRadar';
import { FINE as GRID, runCovering, waitFrame, decode, detStat, maxWithin, blur } from '@/lib/modelGuide';
import { SHAPES } from '@/lib/novaOutlook';
import { VIEW_W, VIEW_H, MAP_BBOX, projectPt } from '@/components/studio/studioGeo';

const HOUR = 3600e3;

/* per output pixel: its top-left grid cell and bilinear weights (cached per box and size) */
const MAPS = new Map();
function pixelMap(box, W, H) {
  const key = `${box.lonMin.toFixed(3)}|${box.lonMax.toFixed(3)}|${box.latMin.toFixed(3)}|${box.latMax.toFixed(3)}|${W}|${H}`;
  if (MAPS.has(key)) return MAPS.get(key);
  const D = Math.PI / 180, my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
  const yt = my(box.latMax), yb = my(box.latMin);
  const idx = new Int32Array(W * H).fill(-1), tx = new Float32Array(W * H), ty = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const lat = Math.atan(Math.sinh(yt - ((py + 0.5) / H) * (yt - yb))) / D;
    for (let px = 0; px < W; px++) {
      const lon = box.lonMin + ((px + 0.5) / W) * (box.lonMax - box.lonMin);
      const [x, y] = laea(lon, lat);
      const fx = (x - GRID.x0) / GRID.dx, fy = (GRID.yTop - y) / GRID.dx;
      const i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i >= GRID.nx - 1 || j >= GRID.ny - 1) continue;
      const k = py * W + px;
      idx[k] = j * GRID.nx + i; tx[k] = fx - i; ty[k] = fy - j;
    }
  }
  const m = { idx, tx, ty };
  MAPS.set(key, m);
  if (MAPS.size > 6) MAPS.delete(MAPS.keys().next().value);
  return m;
}

const hexRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };

/* the field (values on the 2 km grid) painted in the graphic's bands: each band a flat colour from its `min` up */
function paint(data, bands, scale, box, W, H, alpha) {
  const { idx, tx, ty } = pixelMap(box, W, H);
  const cols = bands.map((b) => [...hexRgb(b.color), Math.round(255 * (b.alpha ?? alpha))]);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const val = (k) => { const v = data[k]; return v === v ? v * scale : 0; };
  for (let p = 0; p < idx.length; p++) {
    const i0 = idx[p];
    if (i0 < 0) continue;
    const a = tx[p], b = ty[p];
    const v = (val(i0) * (1 - a) + val(i0 + 1) * a) * (1 - b) + (val(i0 + GRID.nx) * (1 - a) + val(i0 + GRID.nx + 1) * a) * b;
    let band = -1;
    for (let k = bands.length - 1; k >= 0; k--) if (v >= bands[k].min) { band = k; break; }
    if (band < 0) continue;
    const c = cols[band];
    d[p * 4] = c[0]; d[p * 4 + 1] = c[1]; d[p * 4 + 2] = c[2]; d[p * 4 + 3] = c[3];
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

const when = (ms, o) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', ...o });

/** `field`: { v (Model Data variable), scale (to the bands' unit), bands: [{ min, color }] }.
    `timeMs`: the hour to show, or `span` ({ from, to } in ms): the highest of its hours.
    `look`: 'detailed', 'smooth' or 'broad'. `box`: the lon/lat box on screen (null: the whole map). */
export default function ModelOverlay({ enabled, field, timeMs, span = null, look = 'detailed', box, k = 1, opacity = 0.78, onStatus, zIndex = 7 }) {
  const [frame, setFrame] = useState(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const fieldKey = field ? `${field.v}|${field.scale}` : '';

  const spanKey = span ? `${span.from}|${span.to}` : '';

  useEffect(() => {
    if (!enabled || !field || (!span && !Number.isFinite(timeMs))) { setFrame(null); statusRef.current?.(null); return undefined; }
    let live = true;
    const say = (s) => live && statusRef.current?.(s);
    (async () => {
      try {
        say({ state: 'loading', text: 'Finding the UKV run…' });
        if (span) {
          const f = await detStat('ukv', field.v, span.from, span.to, 'peak', { alive: () => live, onStatus: (text) => say({ state: 'building', text }) });
          if (!live) return;
          setFrame(f ? { data: f.data } : null);
          say(f ? { state: 'ok', text: `${f.used.join(' + ')} run, highest from ${when(span.from)} to ${when(span.to)}` }
            : { state: 'none', text: 'No UKV run covers that period yet.' });
          return;
        }
        const valid = Math.round(timeMs / HOUR) * HOUR;
        const at = await runCovering('ukv', [valid]);
        if (!live) return;
        if (!at) { setFrame(null); say({ state: 'none', text: 'That time is beyond the newest UKV runs (up to T+120).' }); return; }
        const f = await waitFrame('ukv', at.tag, field.v, at.steps[0], { alive: () => live, onStatus: (text) => say({ state: 'building', text }) });
        if (!live) return;
        setFrame(f ? { data: decode(f) } : null);
        say(f ? { state: 'ok', text: `UKV ${at.run.slice(11, 13)}Z run, valid ${when(valid)}` } : { state: 'none', text: 'This UKV run has no field for that hour (a past-hour value has none at the start of a run).' });
      } catch (e) {
        if (live) { setFrame(null); say({ state: 'error', text: e.message || 'UKV unavailable' }); }
      }
    })();
    return () => { live = false; };
  }, [enabled, fieldKey, span ? spanKey : timeMs]); // eslint-disable-line react-hooks/exhaustive-deps -- field and span are read through their keys

  /* the look: Smooth and Broad grow and blur the field the way the NOVA import shapes its areas */
  const shaped = useMemo(() => {
    if (!frame) return null;
    const sh = SHAPES[look];
    if (!sh || look === 'detailed') return frame.data;
    const r = (km) => Math.round(km / (GRID.dx / 1000) / 2);
    let g = { nx: GRID.nx, ny: GRID.ny, k: 1, data: frame.data };
    if (r(sh.grow) >= 1) g = maxWithin(g, r(sh.grow));
    if (r(sh.blur) >= 1) g = blur(g, r(sh.blur));
    return g.data;
  }, [frame, look]);

  /* drawn over the part of the map on screen, about two pixels a screen pixel */
  const img = useMemo(() => {
    if (!enabled || !shaped || !field) return null;
    const b = box ? { lonMin: Math.max(MAP_BBOX.lonMin, box.lonMin - 0.6), lonMax: Math.min(MAP_BBOX.lonMax, box.lonMax + 0.6), latMin: Math.max(MAP_BBOX.latMin, box.latMin - 0.4), latMax: Math.min(MAP_BBOX.latMax, box.latMax + 0.4) } : MAP_BBOX;
    const [x0, y0] = projectPt(b.lonMin, b.latMax), [x1, y1] = projectPt(b.lonMax, b.latMin);
    const W = Math.max(60, Math.min(1100, Math.round((x1 - x0) * k * 2.2))), H = Math.max(60, Math.min(1500, Math.round((y1 - y0) * k * 2.2)));
    return { href: paint(shaped, field.bands, field.scale ?? 1, b, W, H, 0.92), x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [enabled, shaped, field, box, k]);

  if (!img) return null;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex, opacity }}>
      <image href={img.href} x={img.x} y={img.y} width={img.w} height={img.h} preserveAspectRatio="none" style={{ imageRendering: 'auto' }} />
    </svg>
  );
}
