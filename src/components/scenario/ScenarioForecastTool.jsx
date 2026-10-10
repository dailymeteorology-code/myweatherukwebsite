/**
 * ScenarioForecastTool — Premium edition
 *
 * Three-scenario synoptic forecast graphic for the Graphic Studio.
 * Scenarios run Most Likely → Less Likely → Least Likely, each with a
 * North-West Europe map (UK centred, Atlantic shown). On each map the
 * forecaster can place a full kit of synoptic furniture:
 *
 *   • Jet stream      — flowing, animated, speed-feathered ribbon + arrowhead
 *   • Pressure systems — High (H) / Low (L) with optional central pressure
 *   • Wind arrows      — single direction arrows
 *   • Isobars          — smooth lines with optional pressure value
 *   • Warm / cold / occluded fronts — proper met symbols along the path
 *   • Trough lines     — bold dashed
 *   • Storm risk areas — translucent convective polygons (UK speciality)
 *   • Text labels      — click to drop, type to edit
 *
 * Any scenario can open FULL SCREEN with the full tool palette docked at the
 * bottom. Liquid-glass theme throughout. Exports a combined 3-up PNG.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Wind, Type, Undo2, Eraser, Maximize2, Minimize2, Download, Loader2,
  Save, FolderOpen, Check, X, MousePointer, Spline, Navigation, Trash2,
  Zap, Waves, CloudLightning, Copy, Layers, Sparkles, PenLine,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { base44 } from '@/api/base44Client';
import NWEuropeMap, { SCN_VIEW_W, SCN_VIEW_H } from './NWEuropeMap';

// ── Liquid-glass helper (mirrors StormOutlookGraphicTool) ───────────────────
const glass = (extra = {}, exportMode = false) => ({
  background: exportMode
    ? 'linear-gradient(155deg, rgba(46,58,88,0.93) 0%, rgba(28,38,62,0.94) 45%, rgba(18,26,46,0.95) 100%)'
    : 'linear-gradient(155deg, rgba(70,86,124,0.40) 0%, rgba(40,54,86,0.34) 45%, rgba(16,24,44,0.46) 100%)',
  border: '1px solid rgba(255,255,255,0.26)',
  boxShadow: exportMode
    ? '0 10px 34px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255,255,255,0.34)'
    : '0 12px 40px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255,255,255,0.40), inset 0 0 22px rgba(120,150,210,0.12)',
  ...(exportMode ? {} : { backdropFilter: 'blur(22px) saturate(180%) brightness(1.08)', WebkitBackdropFilter: 'blur(22px) saturate(180%) brightness(1.08)' }),
  borderRadius: 14, position: 'relative', overflow: 'hidden', ...extra,
});

// ── Tools ───────────────────────────────────────────────────────────────────
const TOOLS = [
  { id: 'select',  label: 'Select / Move', Icon: MousePointer,   color: '#94a3b8' },
  { id: 'jet',     label: 'Jet Stream',    Icon: Spline,         color: '#38bdf8' },
  { id: 'isobar',  label: 'Isobar',        Icon: Spline,         color: '#cbd5e1' },
  { id: 'trough',  label: 'Trough',        Icon: PenLine,        color: '#a78bfa' },
  { id: 'wind',    label: 'Wind Arrow',    Icon: Navigation,     color: '#34d399' },
  { id: 'warm',    label: 'Warm Front',    Icon: Waves,          color: '#ef4444' },
  { id: 'cold',    label: 'Cold Front',    Icon: Waves,          color: '#3b82f6' },
  { id: 'occluded',label: 'Occluded',      Icon: Waves,          color: '#a855f7' },
  { id: 'storm',   label: 'Storm Risk',    Icon: CloudLightning, color: '#f59e0b' },
  { id: 'high',    label: 'High (H)',      Icon: null,           color: '#3b82f6', glyph: 'H' },
  { id: 'low',     label: 'Low (L)',       Icon: null,           color: '#ef4444', glyph: 'L' },
  { id: 'text',    label: 'Text',          Icon: Type,           color: '#facc15' },
];

const SCENARIO_DEFS = [
  { id: 'most',  title: 'Most Likely',  pct: 55, color: '#34d399', accent: 'rgba(52,211,153,0.5)' },
  { id: 'less',  title: 'Less Likely',  pct: 30, color: '#fbbf24', accent: 'rgba(251,191,36,0.5)' },
  { id: 'least', title: 'Least Likely', pct: 15, color: '#f87171', accent: 'rgba(248,113,113,0.5)' },
];

// Smooth a polyline of [x,y] (0..1 norm) into an SVG path via Catmull-Rom.
function smoothLine(pts) {
  if (!pts || pts.length < 2) return '';
  const P = pts.map(p => [p[0] * SCN_VIEW_W, p[1] * SCN_VIEW_H]);
  if (P.length === 2) return `M ${P[0][0]} ${P[0][1]} L ${P[1][0]} ${P[1][1]}`;
  let d = `M ${P[0][0]} ${P[0][1]}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6},` +
         ` ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6},` +
         ` ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// Closed smooth path (for storm risk polygons).
function smoothClosed(pts) {
  if (!pts || pts.length < 3) return '';
  const P = pts.map(p => [p[0] * SCN_VIEW_W, p[1] * SCN_VIEW_H]);
  const n = P.length;
  let d = `M ${(P[0][0] + P[n - 1][0]) / 2} ${(P[0][1] + P[n - 1][1]) / 2}`;
  for (let i = 0; i < n; i++) {
    const p1 = P[i], p2 = P[(i + 1) % n];
    d += ` Q ${p1[0]} ${p1[1]} ${(p1[0] + p2[0]) / 2} ${(p1[1] + p2[1]) / 2}`;
  }
  return d + ' Z';
}

// Arrowhead polygon at the end of a line. Direction is taken from a point a
// few samples back (not just the last segment) so jitter at the pen-up moment
// doesn't make the head point the wrong way.
function arrowHead(pts, size = 16) {
  if (!pts || pts.length < 2) return null;
  const n = pts.length;
  const b = pts[n - 1];
  const a = pts[Math.max(0, n - 4)]; // look back a few points for a stable heading
  const ax = a[0] * SCN_VIEW_W, ay = a[1] * SCN_VIEW_H;
  const bx = b[0] * SCN_VIEW_W, by = b[1] * SCN_VIEW_H;
  let ang = Math.atan2(by - ay, bx - ax);
  if (ax === bx && ay === by) ang = 0;
  const p1 = [bx, by];
  const p2 = [bx - size * Math.cos(ang - 0.42), by - size * Math.sin(ang - 0.42)];
  const p3 = [bx - size * Math.cos(ang + 0.42), by - size * Math.sin(ang + 0.42)];
  return `${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;
}

// Distance from a point (norm 0..1) to the nearest vertex of an item — used
// for hit-testing in Select/Move mode.
function itemAnchor(it) {
  if (it.x != null) return [it.x, it.y];
  if (it.points?.length) {
    const mid = it.points[Math.floor(it.points.length / 2)];
    return mid;
  }
  return [0.5, 0.5];
}
function hitTest(items, px, py) {
  // Search topmost first (last drawn = on top)
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.points?.length) {
      for (const p of it.points) {
        if (Math.hypot(p[0] - px, p[1] - py) < 0.04) return it.id;
      }
    } else if (it.x != null) {
      if (Math.hypot(it.x - px, it.y - py) < 0.05) return it.id;
    }
  }
  return null;
}

// Build a tapered ribbon polygon along a smoothed path — wide in the middle,
// pinched at the source, flaring slightly toward the arrow. This gives the
// Met-Office "jet stream river" look rather than a plain stroke.
function jetRibbon(pts, maxW = 17) {
  if (!pts || pts.length < 2) return '';
  const P = pts.map(p => [p[0] * SCN_VIEW_W, p[1] * SCN_VIEW_H]);
  const n = P.length;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const prev = P[Math.max(0, i - 1)], next = P[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    // Normal
    const nx = -dy, ny = dx;
    // Taper profile: thin at start, full through the body, taper to the tip.
    const t = i / (n - 1);
    const env = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI); // 0→1→0
    const w = (0.35 + 0.65 * env) * (maxW / 2);
    left.push([P[i][0] + nx * w, P[i][1] + ny * w]);
    right.push([P[i][0] - nx * w, P[i][1] - ny * w]);
  }
  let d = `M ${left[0][0]} ${left[0][1]}`;
  for (let i = 1; i < left.length; i++) d += ` L ${left[i][0]} ${left[i][1]}`;
  for (let i = right.length - 1; i >= 0; i--) d += ` L ${right[i][0]} ${right[i][1]}`;
  return d + ' Z';
}

// Total on-screen length of a normalised polyline (for dash animation timing).
function polyLen(pts) {
  if (!pts || pts.length < 2) return 0;
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0] * SCN_VIEW_W, ay = pts[i - 1][1] * SCN_VIEW_H;
    const bx = pts[i][0] * SCN_VIEW_W, by = pts[i][1] * SCN_VIEW_H;
    L += Math.hypot(bx - ax, by - ay);
  }
  return L;
}

// Front / trough symbols along the path. warm=semicircles, cold=triangles,
// occluded=alternating, trough handled separately (plain bold dash).
function FrontShapes({ pts, kind }) {
  const P = pts.map(p => [p[0] * SCN_VIEW_W, p[1] * SCN_VIEW_H]);
  if (P.length < 2) return null;
  const warmCol = '#ef4444', coldCol = '#2563eb', occCol = '#a855f7';
  let acc = 0;
  for (let i = 1; i < P.length; i++) acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const step = 26;
  const shapes = [];
  let dist = 14, seg = 1, segStart = 0, idx = 0;
  while (dist < acc && seg < P.length) {
    const segLen = Math.hypot(P[seg][0] - P[seg - 1][0], P[seg][1] - P[seg - 1][1]) || 1;
    if (dist <= segStart + segLen) {
      const t = (dist - segStart) / segLen;
      const x = P[seg - 1][0] + (P[seg][0] - P[seg - 1][0]) * t;
      const y = P[seg - 1][1] + (P[seg][1] - P[seg - 1][1]) * t;
      const ang = Math.atan2(P[seg][1] - P[seg - 1][1], P[seg][0] - P[seg - 1][0]);
      shapes.push({ x, y, ang, idx: idx++ });
      dist += step;
    } else { segStart += segLen; seg++; }
  }
  const warmBump = (s, col) => {
    const r = 7;
    const nx = -Math.sin(s.ang), ny = Math.cos(s.ang);
    const a = [s.x - Math.cos(s.ang) * r, s.y - Math.sin(s.ang) * r];
    const b = [s.x + Math.cos(s.ang) * r, s.y + Math.sin(s.ang) * r];
    return <path key={`w${s.idx}`} d={`M ${a[0]} ${a[1]} A ${r} ${r} 0 0 1 ${b[0]} ${b[1]}`}
      fill={col} stroke={col} strokeWidth="1" transform={`translate(${nx * 0} ${ny * 0})`} />;
  };
  const coldTri = (s, col) => {
    const r = 7;
    const nx = -Math.sin(s.ang), ny = Math.cos(s.ang);
    const a = [s.x - Math.cos(s.ang) * r, s.y - Math.sin(s.ang) * r];
    const b = [s.x + Math.cos(s.ang) * r, s.y + Math.sin(s.ang) * r];
    const c = [s.x + nx * r * 1.5, s.y + ny * r * 1.5];
    return <polygon key={`c${s.idx}`} points={`${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]}`} fill={col} />;
  };
  return (
    <g>
      {shapes.map((s) => {
        if (kind === 'warm') return warmBump(s, warmCol);
        if (kind === 'cold') return coldTri(s, coldCol);
        // occluded: alternate bump and triangle in purple
        return s.idx % 2 === 0 ? warmBump(s, occCol) : coldTri(s, occCol);
      })}
    </g>
  );
}

// ── Layer renderer (shared by preview + fullscreen + export) ────────────────
function ScenarioLayers({ items, draft, tool, draftColor, selectedId, animate = true }) {
  return (
    <svg viewBox={`0 0 ${SCN_VIEW_W} ${SCN_VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3, overflow: 'visible' }}>
      <defs>
        <filter id="scnGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id="scnJetGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="scnStormFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.20" />
        </linearGradient>
        {/* diagonal hatch for severe storm areas */}
        <pattern id="scnStormHatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="9" height="9" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="9" stroke="#f59e0b" strokeWidth="2.2" strokeOpacity="0.55" />
        </pattern>
      </defs>

      {items.map((it) => {
        const sel = it.id === selectedId;

        if (it.type === 'storm') {
          const dd = smoothClosed(it.points);
          const severe = it.severe;
          return (
            <g key={it.id} opacity={sel ? 0.85 : 1} filter="url(#scnGlow)">
              <path d={dd} fill="url(#scnStormFill)" stroke="#f59e0b" strokeWidth="2.4"
                strokeOpacity="0.9" strokeLinejoin="round" />
              {severe && <path d={dd} fill="url(#scnStormHatch)" stroke="none" />}
            </g>
          );
        }

        if (it.type === 'jet') {
          const col = it.color || '#38bdf8';
          const d = jetRibbon(it.points, 18);
          const core = smoothLine(it.points);
          const L = polyLen(it.points);
          return (
            <g key={it.id} filter="url(#scnJetGlow)" opacity={sel ? 0.85 : 1}>
              {/* soft outer haze */}
              <path d={d} fill={col} fillOpacity="0.22" stroke="none" />
              {/* main ribbon body */}
              <path d={d} fill={col} fillOpacity="0.55" stroke={col} strokeOpacity="0.5" strokeWidth="1" />
              {/* bright flowing core */}
              <path d={core} fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              {/* animated flow dashes that travel down the jet */}
              {animate && L > 4 && (
                <path d={core} fill="none" stroke="#eaf7ff" strokeOpacity="0.85" strokeWidth="2.6"
                  strokeLinecap="round" strokeDasharray="2 26">
                  <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="0.9s" repeatCount="indefinite" />
                </path>
              )}
              {arrowHead(it.points, 26) && <polygon points={arrowHead(it.points, 26)} fill={col} stroke="#fff" strokeWidth="1" />}
            </g>
          );
        }
        if (it.type === 'isobar') {
          return (
            <g key={it.id}>
              <path d={smoothLine(it.points)} fill="none" stroke={it.color || '#e2e8f0'}
                strokeWidth={sel ? 3.5 : 2} strokeOpacity="0.9" strokeLinecap="round" filter="url(#scnGlow)" />
              {it.label && it.points?.length > 1 && (() => {
                const m = it.points[Math.floor(it.points.length / 2)];
                return <text x={m[0] * SCN_VIEW_W} y={m[1] * SCN_VIEW_H} textAnchor="middle"
                  dominantBaseline="central" fontSize="11" fontWeight="800" fill="#fff"
                  stroke="#0b1830" strokeWidth="3" paintOrder="stroke"
                  fontFamily="'DM Mono',monospace">{it.label}</text>;
              })()}
            </g>
          );
        }
        if (it.type === 'trough') {
          return <path key={it.id} d={smoothLine(it.points)} fill="none" stroke={it.color || '#a78bfa'}
            strokeWidth={sel ? 5 : 3.5} strokeOpacity="0.95" strokeLinecap="round"
            strokeDasharray="1 7" filter="url(#scnGlow)" />;
        }
        if (it.type === 'warm' || it.type === 'cold' || it.type === 'occluded') {
          const fc = it.type === 'warm' ? '#ef4444' : it.type === 'cold' ? '#2563eb' : '#a855f7';
          return (
            <g key={it.id} filter="url(#scnGlow)" opacity={sel ? 0.85 : 1}>
              <path d={smoothLine(it.points)} fill="none" stroke={fc} strokeWidth="3" strokeLinecap="round" />
              <FrontShapes pts={it.points} kind={it.type} />
            </g>
          );
        }
        if (it.type === 'wind') {
          const col = it.color || '#34d399';
          return (
            <g key={it.id} filter="url(#scnGlow)" opacity={sel ? 0.85 : 1}>
              <path d={smoothLine(it.points)} fill="none" stroke={col} strokeWidth="3.5" strokeLinecap="round" />
              {arrowHead(it.points, 17) && <polygon points={arrowHead(it.points, 17)} fill={col} />}
            </g>
          );
        }
        if (it.type === 'high' || it.type === 'low') {
          const [x, y] = [it.x * SCN_VIEW_W, it.y * SCN_VIEW_H];
          const col = it.color || (it.type === 'high' ? '#3b82f6' : '#ef4444');
          return (
            <g key={it.id} filter="url(#scnGlow)" opacity={sel ? 0.8 : 1}>
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                fontSize="42" fontWeight="900" fill={col} stroke="#fff" strokeWidth="2.5" paintOrder="stroke"
                fontFamily="'Archivo','DM Sans',sans-serif">{it.type === 'high' ? 'H' : 'L'}</text>
              {it.pressure && (
                <text x={x} y={y + 28} textAnchor="middle" dominantBaseline="central"
                  fontSize="13" fontWeight="800" fill="#fff" stroke="#0b1830" strokeWidth="3" paintOrder="stroke"
                  fontFamily="'DM Mono',monospace">{it.pressure}</text>
              )}
            </g>
          );
        }
        if (it.type === 'text') {
          const [x, y] = [it.x * SCN_VIEW_W, it.y * SCN_VIEW_H];
          return (
            <text key={it.id} x={x} y={y} textAnchor="middle" dominantBaseline="central"
              fontSize="17" fontWeight="800" fill={it.color || '#fff'} stroke="#0b1830" strokeWidth="3.5" paintOrder="stroke"
              fontFamily="'Archivo','DM Sans',sans-serif" filter="url(#scnGlow)" opacity={sel ? 0.8 : 1}>{it.text}</text>
          );
        }
        return null;
      })}

      {/* Selection ring on the moved item */}
      {selectedId != null && (() => {
        const it = items.find(i => i.id === selectedId);
        if (!it) return null;
        const a = itemAnchor(it);
        return <circle cx={a[0] * SCN_VIEW_W} cy={a[1] * SCN_VIEW_H} r="16" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="4 3" />;
      })()}

      {/* In-progress draft line */}
      {draft && draft.length > 1 && (
        tool === 'storm'
          ? <path d={smoothClosed(draft)} fill="rgba(251,191,36,0.18)" stroke="#f59e0b"
              strokeWidth="2.5" strokeDasharray="8 5" strokeLinejoin="round" opacity="0.9" />
          : <path d={smoothLine(draft)} fill="none"
              stroke={draftColor || (tool === 'jet' ? '#7dd3fc' : tool === 'wind' ? '#34d399' : '#e2e8f0')}
              strokeWidth={tool === 'jet' ? 6 : 3} strokeDasharray="8 5" strokeLinecap="round" opacity="0.85" />
      )}
    </svg>
  );
}

// ── A single scenario map (drawable surface) ────────────────────────────────
function ScenarioMap({ scn, state, setState, tool, color, fullscreen, selectedId, setSelectedId, hideBadge, stormSevere }) {
  const wrapRef = useRef(null);
  const drawingRef = useRef(false);
  const dragRef = useRef(null); // { id, lastPt } when moving an item in select mode
  const [draft, setDraft] = useState(null);

  const items = state.items || [];
  const setItems = (updater) =>
    setState(prev => ({ ...prev, items: typeof updater === 'function' ? updater(prev.items || []) : updater }));

  const toNorm = (e) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return null;
    const src = e.touches?.[0] || e;
    return [
      Math.max(0, Math.min(1, (src.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (src.clientY - r.top) / r.height)),
    ];
  };

  const lineTools = ['jet', 'isobar', 'trough', 'wind', 'warm', 'cold', 'occluded', 'storm'];

  const onDown = (e) => {
    const pt = toNorm(e); if (!pt) return;
    if (tool === 'select') {
      const id = hitTest(items, pt[0], pt[1]);
      setSelectedId?.(id);
      if (id != null) { e.preventDefault(); dragRef.current = { id, lastPt: pt }; }
      return;
    }
    if (lineTools.includes(tool)) {
      e.preventDefault();
      drawingRef.current = true;
      setDraft([pt]);
    } else if (tool === 'high' || tool === 'low') {
      const pressure = window.prompt('Central pressure (hPa) — leave blank for none:', '');
      setItems(prev => [...prev, { id: Date.now(), type: tool, x: pt[0], y: pt[1], color, pressure: (pressure && pressure.trim()) || '' }]);
    } else if (tool === 'text') {
      const txt = window.prompt('Label text:', '');
      if (txt && txt.trim()) setItems(prev => [...prev, { id: Date.now(), type: 'text', x: pt[0], y: pt[1], text: txt.trim(), color }]);
    }
  };
  const onMove = (e) => {
    const pt = toNorm(e); if (!pt) return;
    if (dragRef.current) {
      e.preventDefault();
      const { id, lastPt } = dragRef.current;
      const dx = pt[0] - lastPt[0], dy = pt[1] - lastPt[1];
      dragRef.current.lastPt = pt;
      setItems(prev => prev.map(it => {
        if (it.id !== id) return it;
        if (it.points?.length) return { ...it, points: it.points.map(([x, y]) => [x + dx, y + dy]) };
        return { ...it, x: it.x + dx, y: it.y + dy };
      }));
      return;
    }
    if (!drawingRef.current) return;
    e.preventDefault();
    setDraft(prev => prev ? [...prev, pt] : [pt]);
  };
  const onUp = () => {
    if (dragRef.current) { dragRef.current = null; return; }
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (draft && draft.length > 1) {
      const min = tool === 'storm' ? 3 : 2;
      if (draft.length >= min) {
        const extra = tool === 'storm' ? { severe: !!stormSevere } : {};
        setItems(prev => [...prev, { id: Date.now(), type: tool, points: draft, color, ...extra }]);
      }
    }
    setDraft(null);
  };

  // Delete / Backspace removes the selected item while in select mode.
  useEffect(() => {
    if (tool !== 'select' || selectedId == null) return;
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setItems(prev => prev.filter(it => it.id !== selectedId));
        setSelectedId?.(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, selectedId]); // eslint-disable-line

  const isSelectMode = tool === 'select';

  return (
    <div
      ref={wrapRef}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
      style={{
        position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden',
        cursor: isSelectMode ? 'move' : 'crosshair',
        touchAction: 'none', userSelect: 'none',
      }}
    >
      <NWEuropeMap />
      <ScenarioLayers items={items} draft={draft} tool={tool} draftColor={color} selectedId={isSelectMode ? selectedId : null} />
      {!fullscreen && !hideBadge && (
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5,
          ...glass({ padding: '5px 11px', borderRadius: 999 }) }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: scn.color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {scn.title}
          </span>
        </div>
      )}
      {isSelectMode && selectedId != null && (
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
          ...glass({ padding: '4px 10px', borderRadius: 999 }) }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#cbd5e1' }}>Drag to move · press Delete to remove</span>
        </div>
      )}
    </div>
  );
}

// Colour swatches for arrows / isobars / jet / text.
const SWATCHES = ['#38bdf8', '#7dd3fc', '#34d399', '#facc15', '#f97316', '#ef4444', '#ec4899', '#a78bfa', '#ffffff', '#0b1830'];

// ── Tool palette (bottom bar) ───────────────────────────────────────────────
function ToolPalette({ tool, setTool, onUndo, onClear, canUndo, color, setColor, stormSevere, setStormSevere }) {
  return (
    <div style={{ ...glass({ padding: '10px 12px', borderRadius: 16 }), display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
      {TOOLS.map(t => {
        const on = tool === t.id;
        const TIcon = t.Icon;
        return (
          <button key={t.id} type="button" onClick={() => setTool(t.id)} title={t.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 10,
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
            background: on ? `${t.color}22` : 'rgba(148,163,184,0.08)',
            border: `1.5px solid ${on ? t.color : 'rgba(148,163,184,0.22)'}`,
            color: on ? t.color : '#cbd5e1', position: 'relative', zIndex: 1,
            transition: 'all 0.15s ease',
          }}>
            {TIcon ? <TIcon style={{ width: 14, height: 14 }} />
              : <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, color: t.color }}>{t.glyph}</span>}
            {t.label}
          </button>
        );
      })}

      {/* Storm severity toggle — only meaningful for the storm tool */}
      {setStormSevere && tool === 'storm' && (
        <button type="button" onClick={() => setStormSevere(v => !v)} title="Toggle severe hatching" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10,
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
          background: stormSevere ? 'rgba(245,158,11,0.22)' : 'rgba(148,163,184,0.08)',
          border: `1.5px solid ${stormSevere ? '#f59e0b' : 'rgba(148,163,184,0.22)'}`,
          color: stormSevere ? '#fbbf24' : '#cbd5e1', position: 'relative', zIndex: 1,
        }}>
          <Zap style={{ width: 13, height: 13 }} /> {stormSevere ? 'Severe ✓' : 'Severe'}
        </button>
      )}

      {/* Colour picker — applies to the next item drawn */}
      {setColor && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, position: 'relative', zIndex: 1, marginLeft: 2 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Colour</span>
          {SWATCHES.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)} title={c} style={{
              width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
              border: color === c ? '2px solid #f1f5f9' : '2px solid rgba(148,163,184,0.3)',
            }} />
          ))}
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
            style={{ width: 24, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
        </span>
      )}

      <div style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />
      <button type="button" onClick={onUndo} disabled={!canUndo} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10,
        cursor: canUndo ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
        background: 'rgba(148,163,184,0.08)', border: '1.5px solid rgba(148,163,184,0.22)',
        color: '#cbd5e1', opacity: canUndo ? 1 : 0.4, position: 'relative', zIndex: 1,
      }}>
        <Undo2 style={{ width: 14, height: 14 }} /> Undo
      </button>
      <button type="button" onClick={onClear} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10,
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
        background: 'rgba(248,113,113,0.10)', border: '1.5px solid rgba(248,113,113,0.35)',
        color: '#f87171', position: 'relative', zIndex: 1,
      }}>
        <Eraser style={{ width: 14, height: 14 }} /> Clear
      </button>
    </div>
  );
}

// ── Map legend (rendered onto the board) ────────────────────────────────────
function BoardLegend({ exportMode }) {
  const items = [
    { c: '#38bdf8', label: 'Jet' },
    { c: '#ef4444', label: 'Warm front' },
    { c: '#2563eb', label: 'Cold front' },
    { c: '#a855f7', label: 'Occluded' },
    { c: '#f59e0b', label: 'Storm risk' },
    { c: '#cbd5e1', label: 'Isobar' },
  ];
  return (
    <div style={{ ...glass({ padding: '6px 11px', borderRadius: 999 }, exportMode), display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {items.map(it => (
        <span key={it.label} style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 3, borderRadius: 2, background: it.c, boxShadow: `0 0 6px ${it.c}` }} />
          <span style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(226,232,240,0.85)' }}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

// ── Likelihood comparison bar (rendered onto the board) ─────────────────────
function LikelihoodBar({ pcts, exportMode }) {
  const total = SCENARIO_DEFS.reduce((s, d) => s + (Number(pcts[d.id]) || 0), 0) || 1;
  return (
    <div style={{ ...glass({ padding: '8px 12px', borderRadius: 12 }, exportMode), display: 'flex', flexDirection: 'column', gap: 6, minWidth: 230 }}>
      <span style={{ position: 'relative', zIndex: 1, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(148,163,184,0.95)' }}>Likelihood split</span>
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(0,0,0,0.3)' }}>
        {SCENARIO_DEFS.map(d => {
          const w = ((Number(pcts[d.id]) || 0) / total) * 100;
          return <div key={d.id} title={`${d.title} ${pcts[d.id]}%`} style={{ width: `${w}%`, background: d.color, boxShadow: `inset 0 0 6px rgba(0,0,0,0.25)` }} />;
        })}
      </div>
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        {SCENARIO_DEFS.map(d => (
          <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.color }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#cbd5e1', fontFamily: 'monospace' }}>{pcts[d.id]}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
const blankScenarios = () => SCENARIO_DEFS.reduce((acc, s) => { acc[s.id] = { items: [] }; return acc; }, {});

export default function ScenarioForecastTool({ siteLogoUrl = '' }) {
  const [title, setTitle] = useState('Forecast Scenarios');
  const [subtitle, setSubtitle] = useState('Possible synoptic setups & their likelihood');
  const [validDate, setValidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [handle, setHandle] = useState('@MyWeatherUK');
  const [scenarios, setScenarios] = useState(blankScenarios);
  const [pcts, setPcts] = useState(() => SCENARIO_DEFS.reduce((a, s) => { a[s.id] = s.pct; return a; }, {}));
  const [tool, setTool] = useState('jet');
  const [color, setColor] = useState('#38bdf8');
  const [stormSevere, setStormSevere] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const [fullscreenId, setFullscreenId] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState(false);

  // Save / load to Studio
  const [savedList, setSavedList] = useState([]);
  const [showSave, setShowSave] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const [logo, setLogo] = useState(siteLogoUrl || null);
  useEffect(() => {
    if (!siteLogoUrl) base44.entities.SiteSettings.list().then(l => { if (l[0]?.logo_url) setLogo(l[0].logo_url); }).catch(() => {});
  }, [siteLogoUrl]);

  const setScenarioState = (id, updater) =>
    setScenarios(prev => ({ ...prev, [id]: typeof updater === 'function' ? updater(prev[id]) : updater }));

  const undoScenario = (id) =>
    setScenarioState(id, prev => ({ ...prev, items: (prev.items || []).slice(0, -1) }));
  const clearScenario = (id) => {
    if (window.confirm('Clear everything drawn on this scenario?')) setScenarioState(id, { items: [] });
  };
  // Copy one scenario's drawing onto the next (handy starting point).
  const copyScenarioTo = (fromId, toId) => {
    setScenarioState(toId, { items: JSON.parse(JSON.stringify(scenarios[fromId]?.items || [])) });
  };

  const captureState = () => ({ title, subtitle, validDate, handle, scenarios, pcts });
  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      await base44.entities.WeatherGraphic.create({
        title: saveName.trim(),
        graphic_tool_state: { _scenarioTool: true, ...captureState() },
        published: false, is_forecast: false,
      });
      setSaveOk(true); setSaveName('');
      setTimeout(() => { setSaveOk(false); setShowSave(false); }, 1500);
    } finally { setSaving(false); }
  };
  const openLoad = async () => {
    setShowLoad(true); setLoadingList(true);
    try {
      const list = await base44.entities.WeatherGraphic.filter({}, '-created_date', 50);
      setSavedList(list.filter(g => g.graphic_tool_state?._scenarioTool));
    } finally { setLoadingList(false); }
  };
  const loadState = (g) => {
    const s = g.graphic_tool_state; if (!s) return;
    if (s.title !== undefined) setTitle(s.title);
    if (s.subtitle !== undefined) setSubtitle(s.subtitle);
    if (s.validDate !== undefined) setValidDate(s.validDate);
    if (s.handle !== undefined) setHandle(s.handle);
    if (s.scenarios !== undefined) setScenarios(s.scenarios);
    if (s.pcts !== undefined) setPcts(s.pcts);
    setShowLoad(false);
  };

  const tzAbbr = useMemo(() => {
    try { return new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''; }
    catch { return ''; }
  }, []);

  // ── PNG export of the full 3-up board ──
  const boardRef = useRef(null);
  const GRAPHIC_W = 1280, GRAPHIC_H = 760;
  const handleDownload = async () => {
    if (!boardRef.current) return;
    setIsExporting(true); setExportMode(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 120));
    const src = boardRef.current;
    const clone = src.cloneNode(true);
    clone.style.transform = 'none'; clone.style.margin = '0'; clone.style.flexShrink = '0';
    clone.style.width = `${GRAPHIC_W}px`; clone.style.height = `${GRAPHIC_H}px`;
    const sandbox = document.createElement('div');
    Object.assign(sandbox.style, { position: 'fixed', top: '0', left: '-99999px', width: `${GRAPHIC_W}px`, height: `${GRAPHIC_H}px`, overflow: 'hidden', zIndex: '-1', pointerEvents: 'none' });
    sandbox.appendChild(clone); document.body.appendChild(sandbox);
    try {
      const imgs = Array.from(clone.querySelectorAll('img'));
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = res; img.onerror = res; setTimeout(res, 2000); })));
      await new Promise(r => requestAnimationFrame(r));
      const canvas = await html2canvas(clone, { backgroundColor: null, scale: 2, useCORS: true, logging: false, width: GRAPHIC_W, height: GRAPHIC_H, windowWidth: GRAPHIC_W, windowHeight: GRAPHIC_H });
      const link = document.createElement('a');
      link.download = `forecast-scenarios-${validDate}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      document.body.removeChild(sandbox); setExportMode(false); setIsExporting(false);
    }
  };

  const dateLabel = useMemo(() => new Date(validDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), [validDate]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#f1f5f9' }}>

      {/* ── Controls ── */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <Field label="Board title"><input value={title} onChange={e => setTitle(e.target.value)} style={inputCss} /></Field>
          <Field label="Subtitle"><input value={subtitle} onChange={e => setSubtitle(e.target.value)} style={inputCss} /></Field>
          <Field label="Valid date"><input type="date" value={validDate} onChange={e => setValidDate(e.target.value)} style={{ ...inputCss, colorScheme: 'dark' }} /></Field>
          <Field label="Handle"><input value={handle} onChange={e => setHandle(e.target.value)} style={inputCss} /></Field>
        </div>

        {/* Per-scenario likelihood % */}
        <div>
          <p style={{ ...labelCss, margin: '0 0 8px' }}>Scenario likelihood (%)</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {SCENARIO_DEFS.map(s => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', minWidth: 92 }}>{s.title}</span>
                <input type="number" min={0} max={100} value={pcts[s.id]} onChange={e => setPcts(p => ({ ...p, [s.id]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                  style={{ ...inputCss, width: 64, textAlign: 'center' }} />
                <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
              </span>
            ))}
          </div>
        </div>

        {/* Active tool */}
        <div>
          <p style={{ ...labelCss, margin: '0 0 8px' }}>Active drawing tool — applies to all scenario maps</p>
          <ToolPalette tool={tool} setTool={(t) => { setTool(t); setSelectedId(null); }} onUndo={() => {}} onClear={() => {}} canUndo={false}
            color={color} setColor={setColor} stormSevere={stormSevere} setStormSevere={setStormSevere} />
          <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
            Pick a tool and colour, then draw on any scenario map below. Jet / isobar / trough / fronts / wind = click-drag to draw a line.
            <strong style={{ color: '#94a3b8' }}> Storm Risk</strong> = drag to enclose a convective area (toggle Severe for hatching).
            H / L = click to drop a pressure centre (optionally enter a central pressure). Text = click to add a label.
            <strong style={{ color: '#94a3b8' }}> Select / Move</strong> = click an item to drag it, press Delete to remove it.
          </p>
        </div>

        {/* Export / save / load */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={handleDownload} disabled={isExporting} style={{
            ...btnCss, marginLeft: 'auto', background: isExporting ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: '#fff', fontWeight: 700,
          }}>
            {isExporting ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <Download style={{ width: 14, height: 14 }} />}
            {isExporting ? 'Generating PNG…' : 'Download PNG'}
          </button>
          <button type="button" onClick={() => { setShowSave(v => !v); setShowLoad(false); }} style={{
            ...btnCss, background: showSave ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.08)', borderColor: showSave ? 'rgba(74,222,128,0.5)' : 'rgba(148,163,184,0.2)', color: showSave ? '#86efac' : '#94a3b8',
          }}><Save style={{ width: 13, height: 13 }} /> Save to Studio</button>
          <button type="button" onClick={() => { openLoad(); setShowSave(false); }} style={{
            ...btnCss, background: showLoad ? 'rgba(251,191,36,0.15)' : 'rgba(148,163,184,0.08)', borderColor: showLoad ? 'rgba(251,191,36,0.5)' : 'rgba(148,163,184,0.2)', color: showLoad ? '#fbbf24' : '#94a3b8',
          }}><FolderOpen style={{ width: 13, height: 13 }} /> Load Saved</button>
        </div>

        {showSave && (
          <div style={{ padding: '12px 14px', borderRadius: 10, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.25)' }}>
            <input value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} placeholder="Name this scenario board" style={{ ...inputCss, flex: 1 }} />
            <button type="button" onClick={handleSave} disabled={saving || !saveName.trim()} style={{ ...btnCss, padding: '8px 16px', fontWeight: 700, background: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.4)', color: '#86efac', opacity: (!saveName.trim() || saving) ? 0.5 : 1 }}>
              {saving ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : saveOk ? <Check style={{ width: 13, height: 13 }} /> : <Save style={{ width: 13, height: 13 }} />}
              {saveOk ? 'Saved!' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        {showLoad && (
          <div style={{ padding: 14, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)', maxHeight: 240, overflowY: 'auto' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Saved Scenario Boards</span>
            {loadingList && <span style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</span>}
            {!loadingList && savedList.length === 0 && <span style={{ color: '#64748b', fontSize: 12 }}>No saved scenario boards yet.</span>}
            {savedList.map(g => (
              <button key={g.id} type="button" onClick={() => loadState(g)} style={{ ...btnCss, justifyContent: 'flex-start', textAlign: 'left', background: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.22)', color: '#f1f5f9' }}>
                <FolderOpen style={{ width: 12, height: 12, color: '#fbbf24', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{g.title}</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>{new Date(g.created_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── The board (exported area) ── */}
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <div ref={boardRef} style={{
          width: GRAPHIC_W, maxWidth: '100%', minWidth: 760, margin: '0 auto',
          aspectRatio: `${GRAPHIC_W} / ${GRAPHIC_H}`,
          position: 'relative', borderRadius: 24, overflow: 'hidden',
          background: 'radial-gradient(ellipse at 50% -10%, #16284a 0%, #0b1730 50%, #050b1a 100%)',
          border: '3px solid rgba(125,140,232,0.45)', fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        }}>
          {/* Aurora light bleeds */}
          <div style={{ position: 'absolute', top: -120, left: -80, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(56,189,248,0.16), transparent 70%)', filter: 'blur(20px)', pointerEvents: 'none', zIndex: 0 }} />
          <div style={{ position: 'absolute', top: -100, right: -60, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(167,139,250,0.14), transparent 70%)', filter: 'blur(20px)', pointerEvents: 'none', zIndex: 0 }} />
          <div style={{ position: 'absolute', bottom: -110, left: '40%', width: 380, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,211,153,0.10), transparent 70%)', filter: 'blur(24px)', pointerEvents: 'none', zIndex: 0 }} />

          {/* Header */}
          <div style={{ padding: '22px 28px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, zIndex: 2 }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                <span style={{ width: 22, height: 3, borderRadius: 2, background: 'linear-gradient(90deg, #38bdf8, #818cf8)' }} />
                <p style={{ margin: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#7dd3fc' }}>Synoptic Outlook</p>
              </div>
              <h2 style={{ margin: 0, fontSize: 34, fontWeight: 800, color: '#fff', letterSpacing: '-0.025em', lineHeight: 1 }}>{title}</h2>
              <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'rgba(203,213,225,0.85)' }}>{subtitle}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ ...glass({ padding: '11px 20px', borderRadius: 16 }, exportMode), textAlign: 'center', flexShrink: 0 }}>
                <p style={{ position: 'relative', zIndex: 1, margin: 0, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(148,163,184,0.95)' }}>Valid</p>
                <p style={{ position: 'relative', zIndex: 1, margin: '3px 0 0', fontSize: 17, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap' }}>{dateLabel}</p>
              </div>
              <LikelihoodBar pcts={pcts} exportMode={exportMode} />
            </div>
          </div>

          {/* Three scenarios — bigger maps, minimal chrome */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '4px 24px 8px', zIndex: 2, minHeight: 0 }}>
            {SCENARIO_DEFS.map((scn, idx) => (
              <div key={scn.id} style={{ ...glass({ borderRadius: 18, padding: 0, display: 'flex', flexDirection: 'column' }, exportMode), border: `1.5px solid ${scn.accent}`, boxShadow: `0 8px 28px rgba(0,0,0,0.35), inset 0 0 0 1px ${scn.accent}` }}>
                {/* Top accent rail */}
                <div style={{ height: 3, borderRadius: '18px 18px 0 0', background: `linear-gradient(90deg, transparent, ${scn.color}, transparent)`, opacity: 0.85, position: 'relative', zIndex: 1 }} />

                {/* Scenario header */}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 6, background: `${scn.color}22`, border: `1px solid ${scn.accent}`, fontSize: 11, fontWeight: 900, color: scn.color, fontFamily: 'monospace' }}>{idx + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: scn.color, letterSpacing: '0.01em' }}>{scn.title}</span>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 1, padding: '3px 9px', borderRadius: 999, background: `${scn.color}1f`, border: `1px solid ${scn.accent}` }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: '#fff', fontFamily: 'monospace', lineHeight: 1 }}>{pcts[scn.id]}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>%</span>
                  </span>
                </div>

                {/* Map — now fills the rest of the card */}
                <div style={{ position: 'relative', zIndex: 1, flex: 1, margin: '0 10px 12px', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.14)', minHeight: 0 }}>
                  <ScenarioMap scn={scn} state={scenarios[scn.id]} setState={(u) => setScenarioState(scn.id, u)}
                    tool={tool} color={color} stormSevere={stormSevere} fullscreen={false} selectedId={selectedId} setSelectedId={setSelectedId} hideBadge />
                </div>
              </div>
            ))}
          </div>

          {/* Legend strip above the footer */}
          <div style={{ padding: '0 24px 8px', display: 'flex', justifyContent: 'center', zIndex: 2 }}>
            <BoardLegend exportMode={exportMode} />
          </div>

          {/* Footer */}
          <div style={{ padding: '11px 28px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', zIndex: 2, background: 'linear-gradient(0deg, rgba(8,12,24,0.85), transparent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {logo
                ? <img src={logo} alt="" crossOrigin="anonymous" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.18)' }} />
                : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#5b6ee8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Wind style={{ width: 16, height: 16, color: '#fff' }} /></div>}
              <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{handle}</span>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(203,213,225,0.7)', letterSpacing: '0.04em' }}>
              Issued {new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', hour12: false })} {tzAbbr}
            </span>
          </div>
        </div>
      </div>

      {/* ── Per-scenario control strip (separate from the graphic) ── */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 16, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {SCENARIO_DEFS.map((scn, idx) => {
          const count = (scenarios[scn.id]?.items || []).length;
          const nextId = SCENARIO_DEFS[(idx + 1) % SCENARIO_DEFS.length].id;
          return (
            <div key={scn.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, background: 'rgba(148,163,184,0.05)', border: `1px solid ${scn.accent}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 800, color: scn.color }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: scn.color, boxShadow: `0 0 8px ${scn.color}` }} />
                  {scn.title}
                </span>
                <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>{count} item{count === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <StripBtn onClick={() => setFullscreenId(scn.id)} icon={Maximize2} label="Edit full screen" primary />
                <StripBtn onClick={() => undoScenario(scn.id)} icon={Undo2} label="Undo" disabled={!count} />
                <StripBtn onClick={() => clearScenario(scn.id)} icon={Trash2} label="Clear" danger />
              </div>
              <button type="button" onClick={() => copyScenarioTo(scn.id, nextId)} disabled={!count} title={`Copy this drawing onto ${SCENARIO_DEFS[(idx + 1) % SCENARIO_DEFS.length].title}`} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
                cursor: count ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700,
                background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.18)', color: '#94a3b8', opacity: count ? 1 : 0.4,
              }}>
                <Copy style={{ width: 11, height: 11 }} /> Copy → {SCENARIO_DEFS[(idx + 1) % SCENARIO_DEFS.length].title}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Full-screen scenario editor ── */}
      {fullscreenId && (() => {
        const scn = SCENARIO_DEFS.find(s => s.id === fullscreenId);
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(4,8,18,0.92)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', padding: '18px 20px', gap: 14 }}>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: scn.color, boxShadow: `0 0 10px ${scn.color}` }} />
                <span style={{ fontSize: 18, fontWeight: 800, color: scn.color }}>{scn.title}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', fontFamily: 'monospace' }}>· {pcts[scn.id]}%</span>
              </div>
              <button type="button" onClick={() => setFullscreenId(null)} style={{ ...btnCss, background: 'rgba(148,163,184,0.1)', color: '#f1f5f9' }}>
                <Minimize2 style={{ width: 14, height: 14 }} /> Exit Full Screen
              </button>
            </div>

            {/* Big map */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0 }}>
              <div style={{ position: 'relative', height: '100%', aspectRatio: `${SCN_VIEW_W} / ${SCN_VIEW_H}`, maxWidth: '100%', borderRadius: 18, overflow: 'hidden', border: `2px solid ${scn.accent}`, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
                <ScenarioMap scn={scn} state={scenarios[fullscreenId]} setState={(u) => setScenarioState(fullscreenId, u)}
                  tool={tool} color={color} stormSevere={stormSevere} fullscreen selectedId={selectedId} setSelectedId={setSelectedId} />
              </div>
            </div>

            {/* Tool palette docked at the bottom */}
            <ToolPalette
              tool={tool} setTool={(t) => { setTool(t); setSelectedId(null); }}
              onUndo={() => undoScenario(fullscreenId)}
              onClear={() => clearScenario(fullscreenId)}
              canUndo={!!(scenarios[fullscreenId]?.items || []).length}
              color={color} setColor={setColor} stormSevere={stormSevere} setStormSevere={setStormSevere}
            />
          </div>
        );
      })()}
    </div>
  );
}

// ── Local primitives ──
const inputCss = { width: '100%', padding: '8px 10px', borderRadius: 8, background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)', color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none' };
const labelCss = { fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' };
const btnCss = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)', color: '#f1f5f9', fontFamily: 'inherit' };

function Field({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={labelCss}>{label}</span>{children}</div>;
}

function StripBtn({ onClick, icon: Icon, label, danger, primary, disabled }) {
  const bg = primary ? 'linear-gradient(135deg, rgba(14,165,233,0.22), rgba(2,132,199,0.22))'
    : danger ? 'rgba(248,113,113,0.10)' : 'rgba(148,163,184,0.10)';
  const bd = primary ? 'rgba(56,189,248,0.45)' : danger ? 'rgba(248,113,113,0.3)' : 'rgba(148,163,184,0.22)';
  const fg = primary ? '#7dd3fc' : danger ? '#f87171' : '#cbd5e1';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} style={{
      flex: primary ? 1 : 'initial',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 11px', borderRadius: 9,
      cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
      background: bg, border: `1px solid ${bd}`, color: fg, opacity: disabled ? 0.4 : 1, whiteSpace: 'nowrap',
    }}>
      <Icon style={{ width: 13, height: 13 }} /> {label}
    </button>
  );
}