/* The model field, drawn over the whole UK.

   The shading is a continuous interpolated raster (ModelFieldCanvas); this
   component owns the geography — the projection, the coastline, the hover
   readout — and, importantly, the SIZE. The map is fitted into whatever box its
   parent gives it, so the whole country is visible at a glance instead of
   running off the bottom of the page and having to be scrolled to. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadUKCoastline, makeProjector } from '@/lib/ukCoastline';
import { GRID, GRID_BBOX, GRID_LON_STEP, GRID_LAT_STEP } from '@/lib/modelGrid';
import ModelFieldCanvas from '@/components/model/ModelFieldCanvas';

const VIEW_W = 620;
// Conformal height for this bbox — a stretched projection would misplace every
// coastline against the cells.
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const VIEW_H = Math.round(VIEW_W *
  ((mercY(GRID_BBOX.latMax) - mercY(GRID_BBOX.latMin)) /
   ((GRID_BBOX.lonMax - GRID_BBOX.lonMin) * Math.PI / 180)));
const ASPECT = VIEW_W / VIEW_H;

export default function ModelMap({ variable, values, timeLabel, showValues }) {
  const [coast, setCoast] = useState([]);
  const [hover, setHover] = useState(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const wrapRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadUKCoastline({ bbox: GRID_BBOX, viewW: VIEW_W, viewH: VIEW_H })
      .then(paths => { if (!cancelled) setCoast(paths); });
    return () => { cancelled = true; };
  }, []);

  /* Fit-to-box. The parent hands us a width and a height; the map takes the
     largest conformal rectangle that fits inside both, so it is never taller
     than the space available — which is what forced the scroll before. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const h = Math.min(r.height || Infinity, r.width / ASPECT);
      setBox({ w: Math.round(h * ASPECT), h: Math.round(h) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const project = useMemo(() => makeProjector({ bbox: GRID_BBOX, viewW: VIEW_W, viewH: VIEW_H }), []);

  // Nearest grid point to the pointer, in view units — cheap for a few hundred.
  const onMove = (e) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX ?? e.touches?.[0]?.clientX;
    const cy = e.clientY ?? e.touches?.[0]?.clientY;
    const x = (cx - rect.left) / rect.width * VIEW_W;
    const y = (cy - rect.top) / rect.height * VIEW_H;
    let best = null, bestD = Infinity;
    GRID.forEach((p, i) => {
      const [px, py] = project(p.lon, p.lat);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) { bestD = d; best = { p, i }; }
    });
    if (!best || bestD > 1600) { setHover(null); return; }
    setHover({ ...best, left: cx - rect.left, top: cy - rect.top });
  };

  const hoverValue = hover ? values?.[hover.i] : null;

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div
        ref={mapRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{
          position: 'relative', width: box.w || '100%', height: box.h || 'auto',
          borderRadius: 14, overflow: 'hidden', background: '#0a1526',
          border: '1px solid rgba(148,163,184,0.18)', touchAction: 'pan-y',
        }}
      >
        {box.w > 0 && (
          <ModelFieldCanvas
            variable={variable}
            values={values}
            width={box.w}
            height={box.h}
            coastPaths={coast}
            viewW={VIEW_W}
            viewH={VIEW_H}
          />
        )}

        {/* Coastline and hover marker sit above the raster. vectorEffect keeps
            the stroke hairline-thin at any map size. */}
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {coast.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgba(226,240,255,0.55)" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          ))}
          {hover && (() => {
            const [px, py] = project(hover.p.lon, hover.p.lat);
            return <circle cx={px} cy={py} r="4" fill="none" stroke="#fff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />;
          })()}
        </svg>

        {/* Per-cell readings. These are HTML rather than SVG text so the type
            stays a fixed pixel size however small the map is drawn, and every
            other point is skipped on a narrow map so the numbers never collide.
            The dark halo keeps them readable over both ends of every ramp. */}
        {showValues && GRID.map((p, i) => {
          const v = values?.[i];
          if (v === null || v === undefined || Number.isNaN(v)) return null;
          const stride = box.w < 430 ? 2 : 1;
          if (stride > 1) {
            const col = Math.round((p.lon - GRID_BBOX.lonMin) / GRID_LON_STEP);
            const row = Math.round((p.lat - GRID_BBOX.latMin) / GRID_LAT_STEP);
            if (col % stride || row % stride) return null;
          }
          const [px, py] = project(p.lon, p.lat);
          // A number half off the edge, or sitting under the time stamp, reads
          // worse than no number at all.
          const sx = (px / VIEW_W) * (box.w || VIEW_W);
          const sy = (py / VIEW_H) * (box.h || VIEW_H);
          if (sx < 18 || sx > (box.w || VIEW_W) - 18 || sy < 10 || sy > (box.h || VIEW_H) - 10) return null;
          if (sx < 155 && sy < 46) return null;
          return (
            <span key={`v${i}`} style={{
              position: 'absolute', left: `${(px / VIEW_W) * 100}%`, top: `${(py / VIEW_H) * 100}%`,
              transform: 'translate(-50%,-50%)', pointerEvents: 'none',
              fontSize: 10, fontWeight: 800, lineHeight: 1, color: '#fff',
              textShadow: '0 0 3px #020814, 0 0 3px #020814, 0 1px 2px #020814',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {Number(v).toFixed(variable.dp)}
            </span>
          );
        })}

        {/* Time stamp, top-left of the map */}
        <div style={{ position: 'absolute', top: 10, left: 10, padding: '5px 10px', borderRadius: 9, background: 'rgba(8,17,31,0.8)', border: '1px solid rgba(148,163,184,0.22)', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
          {timeLabel}
        </div>

        {hover && (
          <div style={{
            position: 'absolute', left: hover.left + 14, top: hover.top + 10, pointerEvents: 'none',
            padding: '6px 10px', borderRadius: 9, background: 'rgba(8,17,31,0.94)',
            border: '1px solid rgba(56,189,248,0.4)', fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap',
          }}>
            <b>{hoverValue === null || hoverValue === undefined ? '—' : `${Number(hoverValue).toFixed(variable.dp)} ${variable.unit}`}</b>
            <span style={{ color: '#64748b', marginLeft: 7 }}>
              {hover.p.lat.toFixed(2)}, {hover.p.lon.toFixed(2)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}