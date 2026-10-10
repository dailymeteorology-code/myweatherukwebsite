/* The model field as a smooth, continuous raster.

   The field used to be one <rect> per grid point with a Gaussian blur over the
   top. That reads as blocks with soft edges — you can see the cells. A proper
   model chart is a CONTINUOUS field, so the value is interpolated between grid
   points instead: every pixel of a small offscreen buffer is bilinearly
   interpolated from the four surrounding grid points, then the buffer is drawn
   up to full device resolution with the browser's own smoothing.

   Interpolating a small buffer and letting the GPU scale it keeps this cheap
   enough to redraw on every frame while the run animates — interpolating each
   device pixel directly would be millions of colour lookups per hour step. */
import React, { useEffect, useRef } from 'react';
import { GRID_BBOX, GRID_LON_STEP, GRID_LAT_STEP, colourFor } from '@/lib/modelGrid';

const NX = Math.round((GRID_BBOX.lonMax - GRID_BBOX.lonMin) / GRID_LON_STEP) + 1;
const NY = Math.round((GRID_BBOX.latMax - GRID_BBOX.latMin) / GRID_LAT_STEP) + 1;

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const MY_MIN = mercY(GRID_BBOX.latMin);
const MY_MAX = mercY(GRID_BBOX.latMax);

// Samples per grid cell in the interpolation buffer. 10 is past the point where
// the upscale shows any structure of its own.
const SUB = 10;
const BUF_W = NX * SUB;
const BUF_H = NY * SUB;

/** colourFor returns a css colour; this turns it into bytes, memoised. */
function makeRgbaLookup(variable) {
  const cache = new Map();
  return (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    const k = Math.round(value * 20);
    let hit = cache.get(k);
    if (hit !== undefined) return hit;
    const css = colourFor(value, variable);
    let rgb = null;
    if (!css) rgb = null;
    else if (css[0] === '#') rgb = [parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16)];
    else {
      const m = css.match(/-?\d+/g);
      rgb = m ? [+m[0], +m[1], +m[2]] : null;
    }
    /* Fields with a floor fade IN just above it, so the edge of a shower looks
       like an edge instead of a hard wall of colour across the country. */
    let alpha = 235;
    if (rgb && variable.floor != null) {
      const f = variable.floor;
      alpha = Math.round(235 * Math.min(1, Math.max(0.25, (value - f) / (f * 5))));
    }
    hit = rgb ? [rgb[0], rgb[1], rgb[2], alpha] : null;
    cache.set(k, hit);
    return hit;
  };
}

export default function ModelFieldCanvas({ variable, values, width, height, coastPaths, viewW, viewH }) {
  const canvasRef = useRef(null);
  const bufRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // ── 1. Interpolate into the small buffer, in grid space ──────────────
    if (!bufRef.current) {
      bufRef.current = document.createElement('canvas');
      bufRef.current.width = BUF_W;
      bufRef.current.height = BUF_H;
    }
    const buf = bufRef.current;
    const bctx = buf.getContext('2d');
    const img = bctx.createImageData(BUF_W, BUF_H);
    const data = img.data;
    const rgba = makeRgbaLookup(variable);
    const at = (ix, iy) => {
      const v = values?.[iy * NX + ix];
      return v === null || v === undefined || Number.isNaN(v) ? null : v;
    };

    for (let by = 0; by < BUF_H; by++) {
      // Grid rows run south to north; the buffer is drawn top-down.
      const gy = (BUF_H - 1 - by) / SUB;
      const y0 = Math.min(NY - 1, Math.floor(gy));
      const y1 = Math.min(NY - 1, y0 + 1);
      const ty = gy - y0;
      for (let bx = 0; bx < BUF_W; bx++) {
        const gx = bx / SUB;
        const x0 = Math.min(NX - 1, Math.floor(gx));
        const x1 = Math.min(NX - 1, x0 + 1);
        const tx = gx - x0;

        // Bilinear over whichever corners have data — a missing corner must not
        // punch a hole, it just does not contribute.
        let sum = 0, wsum = 0;
        const corners = [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)],
                         [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]];
        for (const [cx, cy, w] of corners) {
          if (w <= 0) continue;
          const v = at(cx, cy);
          if (v === null) continue;
          sum += v * w; wsum += w;
        }
        if (wsum < 0.25) continue;            // mostly missing → leave clear
        const c = rgba(sum / wsum);
        if (!c) continue;
        const o = (by * BUF_W + bx) * 4;
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = c[3];
      }
    }
    bctx.putImageData(img, 0, 0);

    /* ── 2. Draw the buffer up to full size ────────────────────────────────
       The field is NOT clipped to the coastline: the model runs over the sea as
       well, and cutting it at the coast hid the offshore side of every system.
       The coastline is drawn as a line on top instead. */
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Half a grid cell of inset: buffer edges sit ON the outer grid points, so
    // drawing the buffer across the full box would shift the field half a cell.
    const insetX = (width / (NX - 1)) / 2;
    const insetY = (height / (NY - 1)) / 2;
    ctx.drawImage(buf, -insetX, -insetY, width + insetX * 2, height + insetY * 2);
    ctx.restore();
  }, [variable, values, width, height, coastPaths, viewW, viewH]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  );
}