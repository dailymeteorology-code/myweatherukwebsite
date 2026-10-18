/* TCM NOVA region picker: a lit 3-D globe (orthographic projection on canvas).
   Drag to spin, it idles with a slow rotation, and each forecast region is a marked
   area on the surface. UK & Ireland is live; the rest are locked as "coming soon".
   Picking a region flies the globe to it, then hands over to the model view. */
import React, { useEffect, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoGraticule10, geoContains, geoDistance, geoInterpolate } from 'd3-geo';
import { feature } from 'topojson-client';
import land50 from 'world-atlas/land-50m.json';
import countries50 from 'world-atlas/countries-50m.json';
import { Lock, CloudLightning, ChevronRight } from 'lucide-react';

export const NOVA_REGIONS = [
  { id: 'uk-ireland', name: 'UK & Ireland', centre: [-4.5, 54.5], live: true,
    bbox: [[-11, 49.5], [2.2, 61]], countries: ['826', '372'] },
  { id: 'europe', name: 'Europe', centre: [12, 50], live: false, countries: ['250', '276', '724', '380', '056', '528', '040', '756', '616', '203', '348', '620'] },
  { id: 'scandinavia', name: 'Scandinavia', centre: [16, 63], live: false, countries: ['578', '752', '208', '246'] },
  { id: 'north-america', name: 'North America', centre: [-98, 40], live: false, countries: ['840', '124'] },
  { id: 'australia', name: 'Australia', centre: [134, -25], live: false, countries: ['036'] },
  { id: 'south-america', name: 'South America', centre: [-58, -15], live: false, countries: ['076', '032'] },
  { id: 'asia', name: 'East Asia', centre: [115, 33], live: false, countries: ['156', '392', '410'] },
];

const LAND = feature(land50, land50.objects.land);
const COUNTRIES = feature(countries50, countries50.objects.countries).features;
const SPHERE = { type: 'Sphere' };
const GRAT = geoGraticule10();

export default function NovaGlobe({ onSelect }) {
  const cv = useRef(null);
  const rot = useRef([20, -40, 0]);
  const drag = useRef(null);
  const anim = useRef(null);
  const [hover, setHover] = useState(null);
  const [locked, setLocked] = useState(null);
  const hoverRef = useRef(null);
  hoverRef.current = hover;

  useEffect(() => {
    const c = cv.current;
    const ctx = c.getContext('2d');
    let raf;
    let last = performance.now();
    const draw = (now) => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = Math.min(w * 0.42, h * 0.34);
      const cy = h / 2 + h * 0.04;
      if (!drag.current && !anim.current) rot.current[0] += (now - last) * 0.006;
      if (anim.current) {
        const t = Math.min(1, (now - anim.current.t0) / 1400);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const p = anim.current.interp(e);
        rot.current = [-p[0], -p[1], 0];
        if (t >= 1) { const done = anim.current.done; anim.current = null; done(); }
      }
      last = now;
      const proj = geoOrthographic().scale(r).translate([w / 2, cy]).rotate(rot.current).clipAngle(90);
      const path = geoPath(proj, ctx);
      ctx.clearRect(0, 0, w, h);
      // atmosphere glow
      const glow = ctx.createRadialGradient(w / 2, cy, r * 0.95, w / 2, cy, r * 1.18);
      glow.addColorStop(0, 'rgba(56,189,248,0.35)'); glow.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(w / 2, cy, r * 1.18, 0, 2 * Math.PI); ctx.fill();
      // ocean with light from upper-left
      const sea = ctx.createRadialGradient(w / 2 - r * 0.4, cy - r * 0.45, r * 0.1, w / 2, cy, r);
      sea.addColorStop(0, '#2b6cb0'); sea.addColorStop(0.7, '#123a6b'); sea.addColorStop(1, '#071a33');
      ctx.beginPath(); path(SPHERE); ctx.fillStyle = sea; ctx.fill();
      ctx.beginPath(); path(GRAT); ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.beginPath(); path(LAND); ctx.fillStyle = '#3f6b4a'; ctx.fill();
      // regions
      for (const reg of NOVA_REGIONS) {
        const feats = COUNTRIES.filter((f) => reg.countries.includes(String(f.id).padStart(3, '0')));
        const hov = hoverRef.current === reg.id;
        ctx.beginPath(); feats.forEach((f) => path(f));
        ctx.fillStyle = reg.live ? (hov ? 'rgba(56,189,248,0.95)' : 'rgba(56,189,248,0.75)') : (hov ? 'rgba(148,163,184,0.75)' : 'rgba(148,163,184,0.45)');
        ctx.fill();
        ctx.strokeStyle = reg.live ? '#e0f2fe' : 'rgba(226,232,240,0.6)'; ctx.lineWidth = reg.live ? 1.4 : 0.7; ctx.stroke();
      }
      ctx.beginPath(); path(LAND); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.5; ctx.stroke();
      // terminator-style shading for depth
      const shade = ctx.createRadialGradient(w / 2 - r * 0.35, cy - r * 0.4, r * 0.2, w / 2, cy, r * 1.02);
      shade.addColorStop(0, 'rgba(255,255,255,0.10)'); shade.addColorStop(0.6, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.beginPath(); path(SPHERE); ctx.fillStyle = shade; ctx.fill();
      // labels for regions on the visible hemisphere
      ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const reg of NOVA_REGIONS) {
        const centre = [-rot.current[0], -rot.current[1]];
        if (geoDistance(reg.centre, centre) > Math.PI / 2 - 0.15) continue;
        const [x, y] = proj(reg.centre);
        const label = reg.live ? reg.name : `🔒 ${reg.name}`;
        const tw = ctx.measureText(label).width + 16;
        ctx.fillStyle = reg.live ? 'rgba(2,132,199,0.92)' : 'rgba(15,23,42,0.75)';
        ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 26, tw, 20, 10); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, x, y - 12);
      }
      c.__proj = proj;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const regionAt = (e) => {
    const c = cv.current, proj = c.__proj;
    if (!proj) return null;
    const b = c.getBoundingClientRect();
    const ll = proj.invert([e.clientX - b.left, e.clientY - b.top]);
    if (!ll || geoDistance(ll, [-rot.current[0], -rot.current[1]]) > Math.PI / 2) return null;
    return NOVA_REGIONS.find((r) => COUNTRIES.some((f) => r.countries.includes(String(f.id).padStart(3, '0')) && geoContains(f, ll))) || null;
  };
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
      <canvas ref={cv} style={{ width: '100%', height: 'calc(100vh - 60px)', minHeight: 560, display: 'block', cursor: hover ? 'pointer' : drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, r: [...rot.current], moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (drag.current) {
            const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
            rot.current = [drag.current.r[0] + dx * 0.3, Math.max(-80, Math.min(80, drag.current.r[1] - dy * 0.3)), 0];
          } else { setHover(regionAt(e)?.id || null); }
        }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) choose(regionAt(e)); }}
      />
      <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', padding: '0 16px', zIndex: 2 }}>
        {NOVA_REGIONS.map((r) => (
          <button key={r.id} type="button" onClick={() => choose(r)}
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
