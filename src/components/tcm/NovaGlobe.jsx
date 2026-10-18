/* TCM NOVA region picker: a lit 3-D globe (orthographic projection on canvas).
   Drag to spin, it idles with a slow rotation, and each forecast region is a marked
   area on the surface. UK & Ireland is live; the rest are locked as "coming soon".
   Picking a region flies the globe to it, then hands over to the model view.

   Kept light on purpose (it is the first thing every visitor sees, on any machine):
   - coastlines at 1:110m (at globe scale finer data costs 16x the work for no visible gain)
   - every region's countries are merged into one geometry once, at load
   - the glow, ocean and shading gradients are painted once per size into offscreen
     canvases and blitted each frame instead of rebuilt
   - idle rotation is capped at 20 fps and stops after 15 s untouched (zero cost at rest); full rate only while dragging or flying
   - nothing is drawn while the tab is hidden or the globe is scrolled out of view,
     and the globe holds still for people who prefer reduced motion
   - hover hit-testing runs at most once per frame and only re-renders React when the
     hovered region actually changes; device pixel ratio is capped at 1.25 */
import React, { useEffect, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoGraticule, geoContains, geoDistance, geoInterpolate } from 'd3-geo';
import { feature, merge } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json';
import countries110 from 'world-atlas/countries-110m.json';
import { Lock, CloudLightning, ChevronRight } from 'lucide-react';

export const NOVA_REGIONS = [
  { id: 'uk-ireland', name: 'UK & Ireland', centre: [-4.5, 54.5], live: true, countries: ['826', '372'] },
  { id: 'europe', name: 'Europe', centre: [12, 50], live: false, countries: ['250', '276', '724', '380', '056', '528', '040', '756', '616', '203', '348', '620'] },
  { id: 'scandinavia', name: 'Scandinavia', centre: [16, 63], live: false, countries: ['578', '752', '208', '246'] },
  { id: 'north-america', name: 'North America', centre: [-98, 40], live: false, countries: ['840', '124'] },
  { id: 'australia', name: 'Australia', centre: [134, -25], live: false, countries: ['036'] },
  { id: 'south-america', name: 'South America', centre: [-58, -15], live: false, countries: ['076', '032'] },
  { id: 'asia', name: 'East Asia', centre: [115, 33], live: false, countries: ['156', '392', '410'] },
];

const LAND = feature(land110, land110.objects.land);
const SPHERE = { type: 'Sphere' };
const GRAT = geoGraticule().step([20, 20])();
const pad = (id) => String(id).padStart(3, '0');
/* one merged geometry per region, computed once */
const REGION_GEOMS = NOVA_REGIONS.map((r) => {
  const topo = countries110;
  const geoms = topo.objects.countries.geometries.filter((g) => r.countries.includes(pad(g.id)));
  return { ...r, geom: merge(topo, geoms) };
});
const IDLE_FRAME_MS = 1000 / 20;
const SPIN_FOR_MS = 15000;          // idle spin stops after this; any interaction restarts it
const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function paintStatic(w, h, r, cy, dpr) {
  const mk = () => { const c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr; const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, x]; };
  const [back, b] = mk();
  const glow = b.createRadialGradient(w / 2, cy, r * 0.95, w / 2, cy, r * 1.18);
  glow.addColorStop(0, 'rgba(56,189,248,0.35)'); glow.addColorStop(1, 'rgba(56,189,248,0)');
  b.fillStyle = glow; b.beginPath(); b.arc(w / 2, cy, r * 1.18, 0, 2 * Math.PI); b.fill();
  const sea = b.createRadialGradient(w / 2 - r * 0.4, cy - r * 0.45, r * 0.1, w / 2, cy, r);
  sea.addColorStop(0, '#2b6cb0'); sea.addColorStop(0.7, '#123a6b'); sea.addColorStop(1, '#071a33');
  b.fillStyle = sea; b.beginPath(); b.arc(w / 2, cy, r, 0, 2 * Math.PI); b.fill();
  const [front, f] = mk();
  const shade = f.createRadialGradient(w / 2 - r * 0.35, cy - r * 0.4, r * 0.2, w / 2, cy, r * 1.02);
  shade.addColorStop(0, 'rgba(255,255,255,0.10)'); shade.addColorStop(0.6, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  f.fillStyle = shade; f.beginPath(); f.arc(w / 2, cy, r, 0, 2 * Math.PI); f.fill();
  return { back, front };
}

export default function NovaGlobe({ onSelect }) {
  const cv = useRef(null);
  const rot = useRef([20, -40, 0]);
  const drag = useRef(null);
  const anim = useRef(null);
  const pointer = useRef(null);            // last pointer position awaiting a hit test
  const hoverRef = useRef(null);
  const dirty = useRef(true);
  const touched = useRef(performance.now());
  const [hover, setHover] = useState(null);
  const [locked, setLocked] = useState(null);

  useEffect(() => {
    const c = cv.current;
    const ctx = c.getContext('2d');
    let raf, last = 0, visible = true, size = '', statics = null, geom = null;
    const stats = { frames: 0, ms: 0 };
    window.__novaGlobeStats = stats;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(c);

    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden) return;
      const busy = drag.current || anim.current;
      const spinning = !reducedMotion && now - touched.current < SPIN_FOR_MS;
      if (!busy && !dirty.current && !pointer.current && (!spinning || now - last < IDLE_FRAME_MS)) return;
      const dt = last ? Math.min(now - last, 100) : 16;
      last = now;
      const t0 = performance.now();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const w = c.clientWidth, h = c.clientHeight;
      const key = `${w}x${h}@${dpr}`;
      if (key !== size) {
        size = key; c.width = w * dpr; c.height = h * dpr;
        const r0 = Math.min(w * 0.42, h * 0.34);
        geom = { r: r0, cy: h / 2 + h * 0.04 };
        statics = paintStatic(w, h, r0, geom.cy, dpr);
      }
      const { r, cy } = geom;
      if (!busy && spinning) rot.current[0] += dt * 0.006;
      if (anim.current) {
        const t = Math.min(1, (now - anim.current.t0) / 1400);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const p = anim.current.interp(e);
        rot.current = [-p[0], -p[1], 0];
        if (t >= 1) { const done = anim.current.done; anim.current = null; done(); }
      }
      const proj = geoOrthographic().scale(r).translate([w / 2, cy]).rotate(rot.current).clipAngle(90).precision(1.2);
      c.__proj = proj;
      // hover hit-test, at most once per frame
      if (pointer.current && !drag.current) {
        const id = hitTest(proj, pointer.current);
        pointer.current = null;
        if (id !== hoverRef.current) { hoverRef.current = id; setHover(id); c.style.cursor = id ? 'pointer' : 'grab'; }
      }
      const path = geoPath(proj, ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(statics.back, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath(); path(GRAT); ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.beginPath(); path(LAND); ctx.fillStyle = '#3f6b4a'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.5; ctx.stroke();
      const centre = [-rot.current[0], -rot.current[1]];
      for (const reg of REGION_GEOMS) {
        if (geoDistance(reg.centre, centre) > Math.PI / 2 + 0.6) continue;           // entirely on the far side
        const hov = hoverRef.current === reg.id;
        ctx.beginPath(); path(reg.geom);
        ctx.fillStyle = reg.live ? (hov ? 'rgba(56,189,248,0.95)' : 'rgba(56,189,248,0.75)') : (hov ? 'rgba(148,163,184,0.75)' : 'rgba(148,163,184,0.45)');
        ctx.fill();
        ctx.strokeStyle = reg.live ? '#e0f2fe' : 'rgba(226,232,240,0.6)'; ctx.lineWidth = reg.live ? 1.4 : 0.7; ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(statics.front, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const reg of REGION_GEOMS) {
        if (geoDistance(reg.centre, centre) > Math.PI / 2 - 0.15) continue;
        const [x, y] = proj(reg.centre);
        const label = reg.live ? reg.name : `🔒 ${reg.name}`;
        reg.tw = reg.tw || ctx.measureText(label).width + 16;
        ctx.fillStyle = reg.live ? 'rgba(2,132,199,0.92)' : 'rgba(15,23,42,0.75)';
        ctx.beginPath(); ctx.roundRect(x - reg.tw / 2, y - 26, reg.tw, 20, 10); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, x, y - 12);
      }
      dirty.current = false;
      stats.frames += 1; stats.ms += performance.now() - t0;
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, []);

  function hitTest(proj, pt) {
    const ll = proj.invert(pt);
    if (!ll || geoDistance(ll, [-rot.current[0], -rot.current[1]]) > Math.PI / 2) return null;
    const reg = REGION_GEOMS.find((r) => geoDistance(ll, r.centre) < 0.6 && geoContains(r.geom, ll));
    return reg ? reg.id : null;
  }
  const local = (e) => { const b = cv.current.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const choose = (reg) => {
    if (!reg) return;
    if (!reg.live) { setLocked(reg); return; }
    const from = [-rot.current[0], -rot.current[1]];
    anim.current = { t0: performance.now(), interp: geoInterpolate(from, reg.centre), done: () => onSelect(reg) };
  };

  return (
    <div style={{ position: 'relative', minHeight: 'calc(100vh - 60px)', background: 'radial-gradient(ellipse at 50% 40%, #0b1f3a 0%, #030712 70%)', color: '#e2e8f0', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 24, left: 0, right: 0, textAlign: 'center', zIndex: 2, pointerEvents: 'none', padding: '0 16px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.7rem', letterSpacing: '0.2em', color: '#7dd3fc', fontWeight: 800 }}>
          <CloudLightning style={{ width: 16, height: 16 }} /> TCM NOVA · THUNDERSTORM MODEL
        </div>
        <h1 style={{ margin: '8px 0 4px', fontSize: 'clamp(1.6rem, 4vw, 2.6rem)', fontWeight: 900, color: '#fff' }}>Choose your forecast region</h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8' }}>Drag to spin the globe · click a region</p>
      </div>
      <canvas ref={cv} style={{ width: '100%', height: 'calc(100vh - 60px)', minHeight: 560, display: 'block', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => { touched.current = performance.now(); drag.current = { x: e.clientX, y: e.clientY, r: [...rot.current], moved: false }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.style.cursor = 'grabbing'; }}
        onPointerMove={(e) => {
          touched.current = performance.now();
          if (drag.current) {
            const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
            rot.current = [drag.current.r[0] + dx * 0.3, Math.max(-80, Math.min(80, drag.current.r[1] - dy * 0.3)), 0];
          } else { pointer.current = local(e); }
        }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null; e.currentTarget.style.cursor = hoverRef.current ? 'pointer' : 'grab'; dirty.current = true;
          if (d && !d.moved) { const id = hitTest(cv.current.__proj, local(e)); choose(NOVA_REGIONS.find((r) => r.id === id)); }
        }}
        onPointerLeave={() => { if (hoverRef.current) { hoverRef.current = null; setHover(null); dirty.current = true; } }}
      />
      <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', padding: '0 16px', zIndex: 2 }}>
        {NOVA_REGIONS.map((r) => (
          <button key={r.id} type="button" onClick={() => choose(r)}
            onMouseEnter={() => { hoverRef.current = r.id; dirty.current = true; }} onMouseLeave={() => { hoverRef.current = hover; dirty.current = true; }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: '0.78rem',
              border: `1px solid ${r.live ? 'rgba(125,211,252,0.7)' : 'rgba(148,163,184,0.35)'}`,
              background: r.live ? 'linear-gradient(135deg,#0ea5e9,#6366f1)' : 'rgba(15,23,42,0.7)', color: r.live ? '#fff' : '#94a3b8' }}>
            {r.live ? <ChevronRight style={{ width: 14, height: 14 }} /> : <Lock style={{ width: 13, height: 13 }} />}
            {r.name}{!r.live && <span style={{ fontSize: '0.6rem', fontWeight: 700, opacity: 0.8 }}>· coming soon</span>}
          </button>
        ))}
      </div>
      {locked && (
        <div role="dialog" onClick={() => setLocked(null)}
          style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(2,6,23,0.55)', zIndex: 5 }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 16, padding: '20px 24px', textAlign: 'center', maxWidth: 340 }}>
            <Lock style={{ width: 22, height: 22, color: '#94a3b8' }} />
            <div style={{ fontWeight: 900, fontSize: '1.1rem', marginTop: 6, color: '#fff' }}>{locked.name} — coming soon</div>
            <div style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '6px 0 12px' }}>TCM NOVA currently forecasts the UK and Ireland. More regions are on the way.</div>
            <button type="button" onClick={() => choose(NOVA_REGIONS[0])} style={{ padding: '8px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontWeight: 800, background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', color: '#fff' }}>Open UK & Ireland</button>
          </div>
        </div>
      )}
    </div>
  );
}
