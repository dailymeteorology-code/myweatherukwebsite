/* A forecast graphic with the lightning of its period drawn over it. The graphic's map is placed by
   `bounds` (the longitudes of the picture's left and right edges and the latitudes of its top and
   bottom, in Web Mercator, the Graphic Studio's projection), so a strike lands where it fell. */
import React, { useEffect, useRef, useState } from 'react';
import { mercator } from './landOutline';
import { strikeColour } from './VfMap';

/** The strikes inside the graphic's picture. */
export const insideBounds = (strikes, b) => (strikes || []).filter(([, la, lo]) => lo >= b.west && lo <= b.east && la >= b.south && la <= b.north);

/** Draw strikes over a w x h picture of `bounds`, coloured over the whole period (so a replay keeps its
    colours), or all in `color`. */
export function drawStrikes(ctx, strikes, bounds, w, h, { upTo = Infinity, byTime = true, dot = 1, color = '#facc15' } = {}) {
  if (!strikes?.length) return;
  const P = mercator(bounds, w, h);
  const t0 = strikes[0][0], span = Math.max(strikes[strikes.length - 1][0] - t0, 1);
  /* a dark halo and a light rim keep each dot clear on a dark sea and on white land alike */
  const r = Math.max(2.2, w / 260) * dot, halo = r + Math.max(1, r * 0.45);
  ctx.lineWidth = Math.max(0.6, r * 0.22);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  for (const [t, la, lo] of strikes) {
    if (t > upTo) break;
    const [x, y] = P(lo, la);
    if (x < -halo || y < -halo || x > w + halo || y > h + halo) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(x, y, halo, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = byTime ? strikeColour((t - t0) / span) : color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
}

/** The size that fits a w x h picture in `outer`'s width and `maxVh` of the window's height (null: just the width). */
export function useFitted(outer, w, h, maxVh) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    if (!maxVh) return undefined;
    const fit = () => {
      const el = outer.current;
      if (!el) return;
      const s = Math.min(el.clientWidth / w, (window.innerHeight * maxVh) / 100 / h);
      setSize([Math.floor(w * s), Math.floor(h * s)]);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer.current);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [outer, w, h, maxVh]);
  return size;
}

export default function GraphicOverlay({ item, strikes, show = true, upTo = Infinity, byTime = true, dot = 1, color = '#facc15', lazy = false, maxVh = null }) {
  const outer = useRef(null), box = useRef(null), cv = useRef(null);
  const w = item.image_w || 1080, h = item.image_h || 1920;
  const size = useFitted(outer, w, h, maxVh);
  useEffect(() => {
    const draw = () => {
      const el = box.current, c = cv.current;
      if (!el || !c) return;
      const cw = el.clientWidth, ch = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      if (show) drawStrikes(ctx, strikes, item.bounds, cw, ch, { upTo, byTime, dot, color });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [item.bounds, strikes, show, upTo, byTime, dot, color]);
  return (
    <div ref={outer} className="fv-fit">
      <div ref={box} className="fv-pic" style={size ? { width: size[0], height: size[1] } : { aspectRatio: `${w} / ${h}` }}>
        <img src={item.image_url} alt={item.title || 'Forecast graphic'} loading={lazy ? 'lazy' : 'eager'} draggable={false} />
        <canvas ref={cv} aria-hidden="true" />
      </div>
    </div>
  );
}
