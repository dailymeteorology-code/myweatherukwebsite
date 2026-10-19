/**
 * ScenarioForecastTool — three-scenario synoptic board in the MyWeather style:
 * white card, big Baloo title, three black maps with white land, vertical
 * "Scenario 1/2/3" labels, "Probability:NN%" pills, logo + issue date, and a key
 * bottom-middle that lists whatever has been drawn.
 *
 * DRAWING
 *   • Everything is stored in lon/lat, so the NW Europe ↔ UK view switch keeps
 *     every drawing on its place.
 *   • Every stroke is smoothed on pen-up: jitter is decimated, corners are cut
 *     (Chaikin) and the result is drawn as a Catmull-Rom curve.
 *   • "Land only" clips a drawing to the white land; "Everywhere" doesn't.
 *   • The jet stream is a broadcast-style ribbon: soft cyan halo, blue body and
 *     violet core (fastest in the middle), tapered ends and white chevrons that
 *     stream along it.
 *
 * DATA: "Load ECMWF ensemble" groups the 50 ECMWF runs into three scenarios
 * (server/pastFuture/ens_scenarios.py) and draws each one's isobars, highs and
 * lows; percentages are the share of runs. Pick one day, or a run of up to 7: a
 * range clusters the runs on every day's 12 UTC chart together, and each scenario
 * is drawn on its windiest day (worst case). Every scenario also carries the track
 * of its main low across the period.
 *
 * STORY CARDS: one 1080×1920 card per scenario (scenarioCards.jsx) — pastel UK, the
 * low's track and L, a title/percentage pill and a description panel.
 *
 * EXPORT: html-to-image (browser-native rendering), 3840 px wide JPG.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Type, Undo2, Eraser, Maximize2, Minimize2, Download, Loader2, Save, FolderOpen, Check, X,
  MousePointer, Spline, Navigation, Trash2, Waves, CloudLightning, Copy, Layers, Sparkles, PenLine, Wind, Map as MapIcon, Shapes,
} from 'lucide-react';
import { toJpeg } from 'html-to-image';
import { base44 } from '@/api/base44Client';
import NWEuropeMap, { VIEWS, VIEW_W, VIEW_H, useLandPaths, legacyToGeo } from './NWEuropeMap';
import { EnsembleLayer } from './ensembleLayer';
import { StoryCardsPanel, defaultCards, ecmwfTrack } from './scenarioCards';

const FONT = "'Baloo 2', 'Poppins', system-ui, sans-serif";
const ORANGE = '#f5a623', BLUE = '#3d8ef0';

const TOOLS = [
  { id: 'select', label: 'Move', Icon: MousePointer, group: 'edit' },
  { id: 'eraser', label: 'Delete', Icon: Eraser, group: 'edit' },
  { id: 'jet', label: 'Jet stream', Icon: Wind, color: '#2563eb', group: 'line' },
  { id: 'isobar', label: 'Isobar', Icon: Spline, color: '#9a9a9a', group: 'line' },
  { id: 'trough', label: 'Trough', Icon: PenLine, color: BLUE, group: 'line' },
  { id: 'ridge', label: 'Ridge', Icon: PenLine, color: ORANGE, group: 'line' },
  { id: 'wind', label: 'Wind arrow', Icon: Navigation, color: ORANGE, group: 'line' },
  { id: 'warm', label: 'Warm front', Icon: Waves, color: '#ef4444', group: 'line' },
  { id: 'cold', label: 'Cold front', Icon: Waves, color: '#2563eb', group: 'line' },
  { id: 'occluded', label: 'Occluded', Icon: Waves, color: '#a855f7', group: 'line' },
  { id: 'area', label: 'Area', Icon: Shapes, color: '#38bdf8', group: 'area' },
  { id: 'storm', label: 'Storm risk', Icon: CloudLightning, color: '#f59e0b', group: 'area' },
  { id: 'high', label: 'High', glyph: 'H', color: ORANGE, group: 'mark' },
  { id: 'low', label: 'Low', glyph: 'L', color: BLUE, group: 'mark' },
  { id: 'text', label: 'Text', Icon: Type, color: '#ffffff', group: 'mark' },
];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
const LINE_TOOLS = new Set(['jet', 'isobar', 'trough', 'ridge', 'wind', 'warm', 'cold', 'occluded']);
const AREA_TOOLS = new Set(['area', 'storm']);

const SWATCHES = [
  ['#38bdf8', 'Rain'], ['#2563eb', 'Heavy rain'], ['#e0f2fe', 'Snow'], ['#a78bfa', 'Sleet'], ['#22c55e', 'Showers'],
  ['#f5a623', 'Warm'], ['#ef4444', 'Hot'], ['#facc15', 'Sunny'], ['#94a3b8', 'Cloud'], ['#ec4899', 'Wind'],
];
const AREA_NAME = Object.fromEntries(SWATCHES);

const SCENARIO_DEFS = [
  { id: 'most', pct: 55 },
  { id: 'less', pct: 30 },
  { id: 'least', pct: 15 },
];

const KEY_DEFAULTS = {
  jet: 'Jet stream', isobar: 'Isobars', trough: 'Trough', ridge: 'Ridge', wind: 'Wind direction',
  warm: 'Warm front', cold: 'Cold front', occluded: 'Occluded front', storm: 'Thunderstorm risk',
  'storm-severe': 'Severe thunderstorm risk', high: 'High pressure', low: 'Low pressure',
};
const keyOf = (it) => (it.type === 'text' ? null : it.type === 'area' ? `area:${it.color}` : it.type === 'storm' && it.severe ? 'storm-severe' : it.type);
const defaultKeyLabel = (k) => (k.startsWith('area:') ? AREA_NAME[k.slice(5)] || 'Area' : KEY_DEFAULTS[k] || k);

/* ── geometry ─────────────────────────────────────────────────────────── */

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function decimate(P, min) {
  if (P.length < 3) return P;
  const out = [P[0]];
  for (const p of P) if (dist(p, out[out.length - 1]) >= min) out.push(p);
  if (dist(out[out.length - 1], P[P.length - 1]) > 0.5) out.push(P[P.length - 1]);
  return out;
}
function chaikin(P, iters, closed) {
  let r = P;
  for (let k = 0; k < iters; k++) {
    if (r.length < 3) return r;
    const n = r.length, out = closed ? [] : [r[0]];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = r[i], b = r[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(r[n - 1]);
    r = out;
  }
  return r;
}
/** Smooth a freshly drawn stroke (pixel space). */
const smoothStroke = (P, closed) => chaikin(decimate(P, closed ? 7 : 6), closed ? 3 : 2, closed);

/** Points along a Catmull-Rom curve through P, about every `step` px. */
function sampleCurve(P, closed = false, step = 4) {
  if (P.length < 2) return P;
  const n = P.length, out = [];
  const pt = (i) => (closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
    const k = Math.max(1, Math.ceil(dist(p1, p2) / step));
    for (let s = 0; s < k; s++) {
      const t = s / k, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(closed ? P[0] : P[n - 1]);
  return out;
}
const toD = (S, closed) => (S.length ? `M${S.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}${closed ? 'Z' : ''}` : '');
const curveD = (P, closed = false) => toD(sampleCurve(P, closed), closed);

/** Tapered ribbon around a sampled centre line. */
function ribbonD(S, maxW) {
  const n = S.length;
  if (n < 2) return '';
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const t = i / (n - 1), e = Math.sin((Math.min(1, t / 0.2, (1 - t) / 0.16) * Math.PI) / 2);
    const w = (maxW / 2) * (0.12 + 0.88 * Math.max(0, e));
    L.push([S[i][0] - dy * w, S[i][1] + dx * w]); R.push([S[i][0] + dy * w, S[i][1] - dx * w]);
  }
  return toD([...L, ...R.reverse()], true);
}

/** Positions + headings every `step` px along a sampled line. */
function along(S, step, start = step / 2) {
  const out = []; let acc = 0, next = start;
  for (let i = 1; i < S.length; i++) {
    const seg = dist(S[i - 1], S[i]);
    while (acc + seg >= next) {
      const t = (next - acc) / (seg || 1);
      out.push({ x: S[i - 1][0] + (S[i][0] - S[i - 1][0]) * t, y: S[i - 1][1] + (S[i][1] - S[i - 1][1]) * t, a: Math.atan2(S[i][1] - S[i - 1][1], S[i][0] - S[i - 1][0]) });
      next += step;
    }
    acc += seg;
  }
  return out;
}
const lengthOf = (S) => S.reduce((t, p, i) => (i ? t + dist(S[i - 1], p) : 0), 0);

/* ── item renderers (pixel space) ─────────────────────────────────────── */

function JetStream({ P, animate = true }) {
  const S = sampleCurve(P, false, 3);
  const L = lengthOf(S);
  if (L < 10) return null;
  const centre = toD(S, false);
  const n = Math.max(2, Math.floor(L / 44)), dur = Math.max(2.5, L / 75);
  return (
    <g>
      <path d={ribbonD(S, 50)} fill="#a5f3fc" opacity="0.2" />
      <path d={ribbonD(S, 36)} fill="#38bdf8" opacity="0.55" />
      <path d={ribbonD(S, 23)} fill="#2563eb" opacity="0.88" />
      <path d={ribbonD(S, 10)} fill="#7c3aed" opacity="0.95" />
      {Array.from({ length: n }, (_, k) => {
        const begin = `${(-(k / n) * dur).toFixed(2)}s`;
        return (
          <path key={k} d="M -7 -8 L 3 0 L -7 8" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            {animate && <animateMotion dur={`${dur}s`} begin={begin} repeatCount="indefinite" rotate="auto" path={centre} />}
            {animate && <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur={`${dur}s`} begin={begin} repeatCount="indefinite" />}
          </path>
        );
      })}
    </g>
  );
}

function FrontSymbols({ S, kind }) {
  const col = kind === 'warm' ? '#ef4444' : kind === 'cold' ? '#2563eb' : '#a855f7';
  return along(S, 30, 16).map((s, i) => {
    const r = 8, ca = Math.cos(s.a), sa = Math.sin(s.a), nx = -sa, ny = ca;
    const a = [s.x - ca * r, s.y - sa * r], b = [s.x + ca * r, s.y + sa * r];
    const warm = kind === 'warm' || (kind === 'occluded' && i % 2 === 0);
    return warm
      ? <path key={i} d={`M${a[0]} ${a[1]} A ${r} ${r} 0 0 0 ${b[0]} ${b[1]}Z`} fill={col} />
      : <polygon key={i} points={`${a[0]},${a[1]} ${b[0]},${b[1]} ${s.x - nx * r * 1.6},${s.y - ny * r * 1.6}`} fill={col} />;
  });
}

function Item({ it, view, selected, uid, animate }) {
  const P = it.pts ? it.pts.map(([lo, la]) => view.project(lo, la)) : null;
  const at = it.at ? view.project(it.at[0], it.at[1]) : null;
  const clip = it.clip ? `url(#${uid}-land)` : undefined;
  const body = (() => {
    switch (it.type) {
      case 'jet': return <JetStream P={P} animate={animate} />;
      case 'isobar': {
        const S = sampleCurve(P);
        const mid = S[Math.floor(S.length / 2)];
        return (
          <g>
            <path d={toD(S)} fill="none" stroke={it.color || '#9a9a9a'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            {it.label && mid && <g><rect x={mid[0] - 20} y={mid[1] - 11} width="40" height="22" rx="7" fill="#151515" /><text x={mid[0]} y={mid[1] + 1} textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="700" fill="#e5e5e5" fontFamily={FONT}>{it.label}</text></g>}
          </g>
        );
      }
      case 'trough': case 'ridge':
        return <path d={curveD(P)} fill="none" stroke={it.color || (it.type === 'ridge' ? ORANGE : BLUE)} strokeWidth="4" strokeLinecap="round" strokeDasharray="12 10" />;
      case 'wind': {
        const S = sampleCurve(P); const col = it.color || ORANGE;
        if (S.length < 2) return null;
        const e = S[S.length - 1], b = S[Math.max(0, S.length - 6)], a = Math.atan2(e[1] - b[1], e[0] - b[0]), h = 22;
        const tip = [e[0] + Math.cos(a) * 6, e[1] + Math.sin(a) * 6];
        return (
          <g>
            <path d={toD(S.slice(0, -3))} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <polygon points={`${tip[0]},${tip[1]} ${tip[0] - h * Math.cos(a - 0.5)},${tip[1] - h * Math.sin(a - 0.5)} ${tip[0] - h * 0.62 * Math.cos(a)},${tip[1] - h * 0.62 * Math.sin(a)} ${tip[0] - h * Math.cos(a + 0.5)},${tip[1] - h * Math.sin(a + 0.5)}`} fill={col} strokeLinejoin="round" />
          </g>
        );
      }
      case 'warm': case 'cold': case 'occluded': {
        const S = sampleCurve(P, false, 3);
        const col = it.type === 'warm' ? '#ef4444' : it.type === 'cold' ? '#2563eb' : '#a855f7';
        return <g><path d={toD(S)} fill="none" stroke={col} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" /><FrontSymbols S={S} kind={it.type} /></g>;
      }
      case 'area': {
        const d = curveD(P, true), col = it.color || '#38bdf8';
        return <g><path d={d} fill={col} fillOpacity="0.5" stroke={col} strokeWidth="3" strokeLinejoin="round" /></g>;
      }
      case 'storm': {
        const d = curveD(P, true);
        return (
          <g>
            <path d={d} fill="#f59e0b" fillOpacity="0.38" stroke="#f59e0b" strokeWidth="3" strokeLinejoin="round" />
            {it.severe && <path d={d} fill={`url(#${uid}-hatch)`} />}
          </g>
        );
      }
      case 'high': case 'low':
        return (
          <g>
            <text x={at[0]} y={at[1]} textAnchor="middle" dominantBaseline="central" fontSize="76" fontWeight="600" fill={it.color || (it.type === 'high' ? ORANGE : BLUE)} fontFamily={FONT}>{it.type === 'high' ? 'H' : 'L'}</text>
            {it.pressure && <text x={at[0]} y={at[1] + 44} textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="700" fill={it.color || (it.type === 'high' ? ORANGE : BLUE)} fontFamily={FONT}>{it.pressure}</text>}
          </g>
        );
      case 'text':
        return <text x={at[0]} y={at[1]} textAnchor="middle" dominantBaseline="central" fontSize="26" fontWeight="800" fill={it.color || '#fff'} stroke="#151515" strokeWidth="5" paintOrder="stroke" fontFamily={FONT}>{it.text}</text>;
      default: return null;
    }
  })();
  return (
    <g clipPath={clip} opacity={selected ? 0.75 : 1}>
      {body}
      {selected && P && <path d={curveD(P, AREA_TOOLS.has(it.type))} fill="none" stroke="#facc15" strokeWidth="2" strokeDasharray="5 5" />}
      {selected && at && <circle cx={at[0]} cy={at[1]} r="34" fill="none" stroke="#facc15" strokeWidth="2" strokeDasharray="5 5" />}
    </g>
  );
}

/* ── one scenario map: base map + ensemble + drawings + pointer drawing ── */

let uidSeq = 0;
function ScenarioMap({ view, state, setState, tool, opts, selectedId, setSelectedId, interactive = true, animate = true }) {
  const uid = useMemo(() => `scn${++uidSeq}`, []);
  const land = useLandPaths(view);
  const svgRef = useRef(null);
  // The stroke lives in a ref (events can outrun re-renders); state only drives the preview.
  const [draft, setDraftState] = useState(null);
  const draftRef = useRef(null);
  const setDraft = (d) => { draftRef.current = d; setDraftState(d); };
  const dragRef = useRef(null);
  const capture = (e) => { try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ } };
  const items = state.items || [];
  const setItems = (fn) => setState((prev) => ({ ...prev, items: fn(prev.items || []) }));

  const toPx = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * VIEW_W, ((e.clientY - r.top) / r.height) * VIEW_H];
  };
  const toGeo = ([x, y]) => view.unproject(x, y);
  const hit = (p) => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.at && dist(view.project(...it.at), p) < 30) return it.id;
      if (it.pts) {
        const S = sampleCurve(it.pts.map((q) => view.project(...q)), AREA_TOOLS.has(it.type), 6);
        if (S.some((q) => dist(q, p) < 12)) return it.id;
      }
    }
    return null;
  };

  const onDown = (e) => {
    if (!interactive) return;
    const p = toPx(e);
    if (tool === 'select') {
      const id = hit(p); setSelectedId?.(id);
      if (id != null) { capture(e); dragRef.current = p; }
      return;
    }
    if (tool === 'eraser') { const id = hit(p); if (id != null) setItems((xs) => xs.filter((x) => x.id !== id)); return; }
    if (tool === 'high' || tool === 'low') { setItems((xs) => [...xs, { id: Date.now(), type: tool, at: toGeo(p), color: opts.color, pressure: opts.pressure || '' }]); return; }
    if (tool === 'text') {
      const t = window.prompt('Label text:', ''); if (t?.trim()) setItems((xs) => [...xs, { id: Date.now(), type: 'text', at: toGeo(p), text: t.trim(), color: opts.color }]);
      return;
    }
    if (LINE_TOOLS.has(tool) || AREA_TOOLS.has(tool)) { capture(e); setDraft([p]); }
  };
  const onMove = (e) => {
    if (dragRef.current && selectedId != null) {
      const p = toPx(e), [dx, dy] = [p[0] - dragRef.current[0], p[1] - dragRef.current[1]]; dragRef.current = p;
      const shift = (q) => { const [x, y] = view.project(...q); return view.unproject(x + dx, y + dy); };
      setItems((xs) => xs.map((it) => (it.id !== selectedId ? it : it.pts ? { ...it, pts: it.pts.map(shift) } : { ...it, at: shift(it.at) })));
      return;
    }
    const cur = draftRef.current;
    if (!cur) return;
    const p = toPx(e);
    if (dist(p, cur[cur.length - 1]) >= 2.5) setDraft([...cur, p]);
  };
  const onUp = () => {
    dragRef.current = null;
    const stroke = draftRef.current;
    if (!stroke) return;
    const closed = AREA_TOOLS.has(tool);
    const P = smoothStroke(stroke, closed);
    if (P.length >= (closed ? 4 : 2) && lengthOf(P) > 12) {
      setItems((xs) => [...xs, {
        id: Date.now(), type: tool, pts: P.map(toGeo), color: opts.color, clip: opts.landOnly,
        ...(tool === 'storm' ? { severe: opts.severe } : {}), ...(tool === 'isobar' && opts.label ? { label: opts.label } : {}),
      }]);
    }
    setDraft(null);
  };

  useEffect(() => {
    if (!interactive || tool !== 'select' || selectedId == null) return undefined;
    const onKey = (e) => { if (e.key === 'Delete' || e.key === 'Backspace') { setItems((xs) => xs.filter((x) => x.id !== selectedId)); setSelectedId?.(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, selectedId, interactive]); // eslint-disable-line

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <NWEuropeMap view={view} />
      <EnsembleLayer ens={state.ens} view={view} />
      <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: !interactive ? 'default' : tool === 'select' ? 'move' : tool === 'eraser' ? 'not-allowed' : 'crosshair' }}>
        <defs>
          <clipPath id={`${uid}-land`}>{(land || []).map((d, i) => <path key={i} d={d} />)}</clipPath>
          <pattern id={`${uid}-hatch`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="10" stroke="#b45309" strokeWidth="3" />
          </pattern>
        </defs>
        {items.map((it) => <Item key={it.id} it={it} view={view} uid={uid} animate={animate} selected={interactive && it.id === selectedId} />)}
        {draft && draft.length > 1 && (
          <path d={curveD(smoothStroke(draft, AREA_TOOLS.has(tool)), AREA_TOOLS.has(tool))}
            fill={AREA_TOOLS.has(tool) ? opts.color : 'none'} fillOpacity="0.35" stroke={tool === 'jet' ? '#38bdf8' : opts.color}
            strokeWidth={tool === 'jet' ? 10 : 3} strokeDasharray="8 6" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        )}
      </svg>
    </div>
  );
}

/* ── key swatches ─────────────────────────────────────────────────────── */

function KeySwatch({ k }) {
  const w = 54, h = 24, mid = h / 2;
  const line = (props) => <path d={`M4 ${mid + 4} C 18 ${mid - 6}, 34 ${mid + 8}, 50 ${mid - 2}`} fill="none" strokeLinecap="round" {...props} />;
  let g;
  if (k.startsWith('area:')) { const c = k.slice(5); g = <rect x="6" y="3" width="42" height="18" rx="7" fill={c} fillOpacity="0.55" stroke={c} strokeWidth="2.5" />; }
  else switch (k) {
    case 'jet': g = <g>{line({ stroke: '#38bdf8', strokeWidth: 12, opacity: 0.6 })}{line({ stroke: '#2563eb', strokeWidth: 7 })}{line({ stroke: '#7c3aed', strokeWidth: 3 })}</g>; break;
    case 'isobar': g = line({ stroke: '#9a9a9a', strokeWidth: 2.6 }); break;
    case 'trough': g = line({ stroke: BLUE, strokeWidth: 3.6, strokeDasharray: '8 6' }); break;
    case 'ridge': g = line({ stroke: ORANGE, strokeWidth: 3.6, strokeDasharray: '8 6' }); break;
    case 'wind': g = <g><path d={`M6 ${mid} L40 ${mid}`} stroke={ORANGE} strokeWidth="5" strokeLinecap="round" /><polygon points={`50,${mid} 38,${mid - 8} 41,${mid} 38,${mid + 8}`} fill={ORANGE} /></g>; break;
    case 'warm': g = <g><path d={`M4 ${mid + 5} L50 ${mid + 5}`} stroke="#ef4444" strokeWidth="3" /><path d={`M14 ${mid + 5} A6 6 0 0 1 26 ${mid + 5}Z M32 ${mid + 5} A6 6 0 0 1 44 ${mid + 5}Z`} fill="#ef4444" /></g>; break;
    case 'cold': g = <g><path d={`M4 ${mid + 5} L50 ${mid + 5}`} stroke="#2563eb" strokeWidth="3" /><polygon points={`13,${mid + 5} 25,${mid + 5} 19,${mid - 5}`} fill="#2563eb" /><polygon points={`31,${mid + 5} 43,${mid + 5} 37,${mid - 5}`} fill="#2563eb" /></g>; break;
    case 'occluded': g = <g><path d={`M4 ${mid + 5} L50 ${mid + 5}`} stroke="#a855f7" strokeWidth="3" /><path d={`M12 ${mid + 5} A6 6 0 0 1 24 ${mid + 5}Z`} fill="#a855f7" /><polygon points={`30,${mid + 5} 42,${mid + 5} 36,${mid - 5}`} fill="#a855f7" /></g>; break;
    case 'storm': g = <rect x="6" y="3" width="42" height="18" rx="7" fill="#f59e0b" fillOpacity="0.45" stroke="#f59e0b" strokeWidth="2.5" />; break;
    case 'storm-severe': g = <g><rect x="6" y="3" width="42" height="18" rx="7" fill="#f59e0b" fillOpacity="0.45" stroke="#f59e0b" strokeWidth="2.5" />{[12, 22, 32, 42].map((x) => <line key={x} x1={x - 6} y1="20" x2={x + 4} y2="5" stroke="#b45309" strokeWidth="2.5" />)}</g>; break;
    case 'high': case 'low': g = <text x={w / 2} y={mid + 1} textAnchor="middle" dominantBaseline="central" fontSize="26" fontWeight="700" fill={k === 'high' ? ORANGE : BLUE} fontFamily={FONT}>{k === 'high' ? 'H' : 'L'}</text>; break;
    default: g = null;
  }
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0 }}>{g}</svg>;
}

function Firework({ size = 90, flip = false }) {
  const rays = Array.from({ length: 64 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2, r0 = 6 + (i % 3) * 3, r1 = 30 + ((i * 7) % 13) + (i % 2 ? 8 : 0);
    const col = ['#c0392b', '#e67e22', '#8e8e8e', '#d35400', '#7f8c8d'][i % 5];
    return <line key={i} x1={50 + r0 * Math.cos(a)} y1={50 + r0 * Math.sin(a)} x2={50 + r1 * Math.cos(a)} y2={50 + r1 * Math.sin(a)} stroke={col} strokeWidth={0.8 + (i % 3) * 0.3} strokeLinecap="round" />;
  });
  return <svg width={size} height={size} viewBox="0 0 100 100" style={flip ? { transform: 'scaleX(-1)' } : undefined}>{rays}</svg>;
}

// A frame, or 120 ms if the page isn't painting (a background tab never fires requestAnimationFrame).
const nextFrame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 120); });

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const blobToDataUrl = (b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
/**
 * Baloo 2 for the export, subset by Google to just the characters on the board
 * (a few KB), as an @font-face CSS string with the fonts inlined. Handing this to
 * html-to-image stops it crawling every web font on the site, which is slow and
 * can hang on a blocked font host.
 */
async function balooEmbedCss(text) {
  const chars = [...new Set(text + '0123456789%:.')].join('');
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&text=${encodeURIComponent(chars)}`)).text();
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
  let out = css;
  for (const u of urls) out = out.split(u).join(await blobToDataUrl(await (await fetch(u)).blob()));
  return out;
}

/** Old saves held 0..1 coordinates of the earlier 600-wide map; bring them into lon/lat. */
function migrateItems(items = []) {
  return items.map((it) => {
    if (it.pts || it.at) return it;
    const out = { ...it };
    if (it.points) { out.pts = it.points.map(legacyToGeo); delete out.points; }
    if (it.x != null) { out.at = legacyToGeo([it.x, it.y]); delete out.x; delete out.y; }
    return out;
  });
}

/* ── the tool ─────────────────────────────────────────────────────────── */

const GRAPHIC_W = 1500, GRAPHIC_H = 650;
const blankScenarios = () => Object.fromEntries(SCENARIO_DEFS.map((s) => [s.id, { items: [] }]));

const inputCss = { width: '100%', padding: '8px 11px', borderRadius: 9, background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)', color: '#f1f5f9', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const labelCss = { fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'block', marginBottom: 6 };
const btnCss = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(148,163,184,0.2)', color: '#f1f5f9', fontFamily: 'inherit', background: 'rgba(148,163,184,0.06)' };
const chip = (on, col = '#38bdf8') => ({ ...btnCss, padding: '7px 11px', background: on ? `${col}24` : 'rgba(148,163,184,0.06)', borderColor: on ? `${col}88` : 'rgba(148,163,184,0.18)', color: on ? col : '#94a3b8' });

function Palette({ tool, pickTool, opts, setOpts }) {
  const groups = [['edit', 'Edit'], ['line', 'Lines'], ['area', 'Areas'], ['mark', 'Markers']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map(([g, title]) => (
        <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...labelCss, margin: 0, width: 62 }}>{title}</span>
          {TOOLS.filter((t) => t.group === g).map((t) => {
            const on = tool === t.id;
            return (
              <button key={t.id} type="button" onClick={() => pickTool(t.id)} style={chip(on, t.color && t.color !== '#ffffff' ? t.color : '#38bdf8')}>
                {t.glyph ? <span style={{ fontWeight: 900, fontSize: 14, color: t.color, fontFamily: FONT }}>{t.glyph}</span> : t.Icon ? <t.Icon style={{ width: 14, height: 14 }} /> : null}
                {t.label}
              </button>
            );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...labelCss, margin: 0, width: 62 }}>Colour</span>
        {SWATCHES.map(([c, name]) => (
          <button key={c} type="button" title={name} onClick={() => setOpts((o) => ({ ...o, color: c }))} style={{
            width: 26, height: 26, borderRadius: 8, background: c, cursor: 'pointer',
            border: opts.color === c ? '3px solid #fff' : '1px solid rgba(148,163,184,0.35)', boxShadow: opts.color === c ? '0 0 0 2px #38bdf8' : 'none',
          }} />
        ))}
        <input type="color" value={opts.color} onChange={(e) => setOpts((o) => ({ ...o, color: e.target.value }))} style={{ width: 34, height: 28, border: 'none', background: 'none', cursor: 'pointer' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...labelCss, margin: 0, width: 62 }}>Draw on</span>
        <button type="button" style={chip(!opts.landOnly)} onClick={() => setOpts((o) => ({ ...o, landOnly: false }))}><MapIcon style={{ width: 13, height: 13 }} /> Everywhere</button>
        <button type="button" style={chip(opts.landOnly)} onClick={() => setOpts((o) => ({ ...o, landOnly: true }))}><MapIcon style={{ width: 13, height: 13 }} /> Land only (white)</button>
        {tool === 'storm' && <button type="button" style={chip(opts.severe, '#f59e0b')} onClick={() => setOpts((o) => ({ ...o, severe: !o.severe }))}>Severe (hatched)</button>}
        {(tool === 'high' || tool === 'low') && <input placeholder="Pressure, e.g. 1036" value={opts.pressure} onChange={(e) => setOpts((o) => ({ ...o, pressure: e.target.value }))} style={{ ...inputCss, width: 170 }} />}
        {tool === 'isobar' && <input placeholder="Isobar value (optional)" value={opts.label} onChange={(e) => setOpts((o) => ({ ...o, label: e.target.value }))} style={{ ...inputCss, width: 190 }} />}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
        Draw freehand; every line and area smooths itself when you let go. Move: drag a drawing (Delete removes it). Delete: click a drawing.
      </p>
    </div>
  );
}

export default function ScenarioForecastTool({ siteLogoUrl = '' }) {
  const [title, setTitle] = useState('Forecast Scenarios');
  const [validDate, setValidDate] = useState(() => new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');            // '' = one day; otherwise the last day of a range
  const rangeDays = endDate && endDate > validDate ? Math.round((Date.parse(endDate) - Date.parse(validDate)) / 864e5) + 1 : 1;
  const [cards, setCards] = useState(defaultCards);
  const [version, setVersion] = useState('V5.00');
  const [fireworks, setFireworks] = useState(false);
  const [viewId, setViewId] = useState('nweu');
  const view = VIEWS[viewId];
  const [scenarios, setScenarios] = useState(blankScenarios);
  const [pcts, setPcts] = useState(() => Object.fromEntries(SCENARIO_DEFS.map((s) => [s.id, s.pct])));
  const [tool, setTool] = useState('jet');
  const [opts, setOpts] = useState({ color: TOOL.jet.color, landOnly: false, severe: false, pressure: '', label: '' });
  const [selectedId, setSelectedId] = useState(null);
  const [keyLabels, setKeyLabels] = useState({});
  const [showKey, setShowKey] = useState(true);
  const [fullscreenId, setFullscreenId] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [logo, setLogo] = useState(siteLogoUrl || null);
  useEffect(() => {
    if (!siteLogoUrl) base44.entities.SiteSettings.list().then((l) => { if (l[0]?.logo_url) setLogo(l[0].logo_url); }).catch(() => {});
  }, [siteLogoUrl]);

  const pickTool = (t) => { setTool(t); setSelectedId(null); if (TOOL[t]?.color) setOpts((o) => ({ ...o, color: TOOL[t].color })); };
  const setScenarioState = (id, updater) => setScenarios((prev) => ({ ...prev, [id]: typeof updater === 'function' ? updater(prev[id]) : updater }));

  // ── ECMWF ensemble ──
  const [ensBusy, setEnsBusy] = useState(false);
  const [ensInfo, setEnsInfo] = useState(null);
  const [ensError, setEnsError] = useState('');
  const loadEnsemble = async () => {
    setEnsBusy(true); setEnsError('');
    try {
      if (rangeDays > 7) throw new Error('Pick at most 7 days');
      const r = await fetch(`/api/pastfuture/ensemble?date=${validDate}&hour=12${rangeDays > 1 ? `&end=${endDate}` : ''}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setPcts(Object.fromEntries(SCENARIO_DEFS.map((d, i) => [d.id, j.clusters[i]?.pct ?? 0])));
      setScenarios((prev) => Object.fromEntries(SCENARIO_DEFS.map((d, i) => [d.id, { ...(prev[d.id] || { items: [] }), ens: j.clusters[i] ? { cluster: j.clusters[i], grid: j.grid } : null }])));
      // each card follows its scenario's main low (where it has one)
      setCards((prev) => Object.fromEntries(SCENARIO_DEFS.map((d, i) => [d.id, { ...prev[d.id], track: ecmwfTrack(j.clusters[i]) || prev[d.id].track }])));
      setEnsInfo({ run: j.run, step: j.step, steps: j.steps, members: j.members, days: j.days || 1, valid: j.valid, end: j.end });
    } catch (e) { setEnsError(e.message || 'Could not load the ensemble'); } finally { setEnsBusy(false); }
  };
  const clearEnsemble = () => { setScenarios((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, ens: null }]))); setEnsInfo(null); };

  // ── key: one row per kind of thing drawn on any scenario ──
  const keyEntries = useMemo(() => {
    const seen = [];
    for (const s of SCENARIO_DEFS) for (const it of scenarios[s.id]?.items || []) { const k = keyOf(it); if (k && !seen.includes(k)) seen.push(k); }
    if (Object.values(scenarios).some((s) => s?.ens)) for (const k of ['isobar', 'high', 'low']) if (!seen.includes(k)) seen.push(k);
    return seen.map((k) => ({ k, label: keyLabels[k] ?? defaultKeyLabel(k) }));
  }, [scenarios, keyLabels]);

  // ── save / load ──
  const [savedList, setSavedList] = useState([]);
  const [showSave, setShowSave] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      await base44.entities.WeatherGraphic.create({
        title: saveName.trim(),
        graphic_tool_state: { _scenarioTool: true, v: 3, title, validDate, endDate, version, viewId, scenarios, pcts, keyLabels, fireworks, cards },
        published: false, is_forecast: false,
      });
      setSaveOk(true); setSaveName(''); setTimeout(() => { setSaveOk(false); setShowSave(false); }, 1500);
    } finally { setSaving(false); }
  };
  const openLoad = async () => {
    setShowLoad(true); setLoadingList(true);
    try { setSavedList((await base44.entities.WeatherGraphic.filter({}, '-created_date', 50)).filter((g) => g.graphic_tool_state?._scenarioTool)); } finally { setLoadingList(false); }
  };
  const loadState = (g) => {
    const s = g.graphic_tool_state; if (!s) return;
    if (s.title !== undefined) setTitle(s.title);
    if (s.validDate) setValidDate(s.validDate);
    setEndDate(s.endDate || '');
    if (s.cards) setCards((prev) => ({ ...prev, ...s.cards }));
    if (s.version) setVersion(s.version);
    if (s.viewId && VIEWS[s.viewId]) setViewId(s.viewId);
    if (s.pcts) setPcts(s.pcts);
    if (s.keyLabels) setKeyLabels(s.keyLabels);
    if (s.fireworks !== undefined) setFireworks(s.fireworks);
    if (s.scenarios) setScenarios(Object.fromEntries(SCENARIO_DEFS.map((d) => [d.id, { ...(s.scenarios[d.id] || {}), items: migrateItems(s.scenarios[d.id]?.items), auto: undefined }])));
    setShowLoad(false);
  };

  // ── export ──
  const boardRef = useRef(null);
  const handleDownload = async () => {
    if (!boardRef.current) return;
    setIsExporting(true); setSelectedId(null);
    await nextFrame(); await nextFrame();
    try {
      await document.fonts?.ready;
      const fontEmbedCSS = await withTimeout(balooEmbedCss(boardRef.current.innerText), 10000).catch(() => null);
      const dataUrl = await withTimeout(toJpeg(boardRef.current, {
        quality: 0.94, pixelRatio: 3840 / GRAPHIC_W, width: GRAPHIC_W, height: GRAPHIC_H, backgroundColor: '#ffffff',
        ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }),
      }), 90000);
      const a = document.createElement('a'); a.download = `forecast-scenarios-${validDate}${rangeDays > 1 ? `-to-${endDate}` : ''}.jpg`; a.href = dataUrl; a.click();
    } catch (e) {
      window.alert(`Could not make the JPG: ${e.message}`);
    } finally { setIsExporting(false); }
  };

  const issued = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Europe/London' }).replace(/\//g, '.');
  const mapProps = (id) => ({ view, state: scenarios[id], setState: (u) => setScenarioState(id, u), tool, opts, selectedId, setSelectedId });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#f1f5f9' }}>
      {/* ── Controls ── */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <label><span style={labelCss}>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} style={inputCss} /></label>
          <label><span style={labelCss}>{rangeDays > 1 ? 'First day' : 'Valid date'}</span><input type="date" value={validDate} onChange={(e) => setValidDate(e.target.value)} style={{ ...inputCss, colorScheme: 'dark' }} /></label>
          <div><span style={labelCss}>Last day (range, optional)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="date" value={endDate} min={validDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...inputCss, colorScheme: 'dark' }} />
              {endDate && <button type="button" title="Back to one day" onClick={() => setEndDate('')} style={{ ...btnCss, padding: '6px 9px' }}><X style={{ width: 12, height: 12 }} /></button>}
            </div>
          </div>
          <label><span style={labelCss}>Version</span><input value={version} onChange={(e) => setVersion(e.target.value)} style={inputCss} /></label>
          <div><span style={labelCss}>Map view</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.values(VIEWS).map((v) => <button key={v.id} type="button" style={chip(viewId === v.id)} onClick={() => setViewId(v.id)}>{v.label}</button>)}
            </div>
          </div>
          <div><span style={labelCss}>Extras</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={chip(fireworks, '#fbbf24')} onClick={() => setFireworks((v) => !v)}><Sparkles style={{ width: 13, height: 13 }} /> Fireworks</button>
              <button type="button" style={chip(showKey)} onClick={() => setShowKey((v) => !v)}>Key</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 12, borderRadius: 12, background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.22)' }}>
          <button type="button" onClick={loadEnsemble} disabled={ensBusy} style={{ ...btnCss, background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', border: 'none', color: '#fff' }}>
            {ensBusy ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 0.8s linear infinite' }} /> : <Layers style={{ width: 14, height: 14 }} />}
            {ensBusy ? `Reading 50 ensemble runs${rangeDays > 1 ? ` over ${rangeDays} days` : ''}…` : rangeDays > 1 ? `Load ECMWF ensemble for the ${rangeDays} days` : 'Load ECMWF ensemble for the valid date'}
          </button>
          {ensInfo && <button type="button" onClick={clearEnsemble} style={btnCss}><X style={{ width: 13, height: 13 }} /> Remove isobars</button>}
          <span style={{ fontSize: 11.5, color: ensError ? '#fca5a5' : '#94a3b8' }}>
            {ensError || (ensInfo
              ? `${new Date(ensInfo.run).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC run, ${ensInfo.days > 1 ? `T+${ensInfo.steps[0]}–${ensInfo.steps[1]} h over ${ensInfo.days} days` : `T+${ensInfo.step} h`}, ${ensInfo.members} runs. Percentages = share of runs.${ensInfo.days > 1 ? ' Runs are grouped by how the whole period plays out; each scenario is drawn on its windiest day.' : ''}`
              : rangeDays > 1
                ? `Groups the 50 ECMWF ensemble runs into three outcomes across all ${rangeDays} days (each day's 12:00 UTC chart together). Each scenario is shown on its windiest day, with its low's track through the period.`
                : 'Groups the 50 ECMWF ensemble runs into three outcomes at 12:00 UTC on the valid date (up to 15 days ahead), with real isobars, highs and lows.')}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...labelCss, margin: 0 }}>Probability %</span>
          {SCENARIO_DEFS.map((s, i) => (
            <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1', fontWeight: 700 }}>
              Scenario {i + 1}
              <input type="number" min={0} max={100} value={pcts[s.id] ?? ''} onChange={(e) => setPcts((p) => ({ ...p, [s.id]: e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} style={{ ...inputCss, width: 62, textAlign: 'center' }} />
            </label>
          ))}
        </div>

        <Palette tool={tool} pickTool={pickTool} opts={opts} setOpts={setOpts} />

        {keyEntries.length > 0 && (
          <div>
            <span style={labelCss}>Key labels</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {keyEntries.map(({ k, label }) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 9, background: '#f8fafc' }}>
                  <KeySwatch k={k} />
                  <input value={label} onChange={(e) => setKeyLabels((m) => ({ ...m, [k]: e.target.value }))} style={{ ...inputCss, background: '#fff', color: '#111', border: '1px solid #e2e8f0' }} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={handleDownload} disabled={isExporting} style={{ ...btnCss, marginLeft: 'auto', background: isExporting ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: '#fff' }}>
            {isExporting ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : <Download style={{ width: 14, height: 14 }} />}
            {isExporting ? 'Generating JPG…' : 'Download JPG (3840 px)'}
          </button>
          <button type="button" onClick={() => { setShowSave((v) => !v); setShowLoad(false); }} style={btnCss}><Save style={{ width: 13, height: 13 }} /> Save to Studio</button>
          <button type="button" onClick={() => { openLoad(); setShowSave(false); }} style={btnCss}><FolderOpen style={{ width: 13, height: 13 }} /> Load Saved</button>
        </div>
        {showSave && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSave()} placeholder="Name this scenario board" style={{ ...inputCss, flex: 1 }} />
            <button type="button" onClick={handleSave} disabled={saving || !saveName.trim()} style={btnCss}>
              {saving ? <Loader2 style={{ width: 13, height: 13 }} /> : saveOk ? <Check style={{ width: 13, height: 13 }} /> : <Save style={{ width: 13, height: 13 }} />}{saveOk ? 'Saved!' : 'Save'}
            </button>
          </div>
        )}
        {showLoad && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {loadingList && <span style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</span>}
            {!loadingList && savedList.length === 0 && <span style={{ color: '#64748b', fontSize: 12 }}>No saved scenario boards yet.</span>}
            {savedList.map((g) => (
              <button key={g.id} type="button" onClick={() => loadState(g)} style={{ ...btnCss, justifyContent: 'flex-start' }}>
                <FolderOpen style={{ width: 12, height: 12 }} /><span style={{ flex: 1, textAlign: 'left' }}>{g.title}</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>{new Date(g.created_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── The board (exported area) ── */}
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <div ref={boardRef} style={{ width: GRAPHIC_W, minWidth: GRAPHIC_W, height: GRAPHIC_H, margin: '0 auto', position: 'relative', overflow: 'hidden', background: '#ffffff', fontFamily: FONT, color: '#1c1c1c' }}>
          <div style={{ height: 112, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            {fireworks && <Firework size={96} />}
            <h2 style={{ margin: 0, fontSize: 72, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.01em', whiteSpace: 'nowrap', maxWidth: fireworks ? 1220 : 1420, overflow: 'hidden', textOverflow: 'ellipsis', paddingTop: 10 }}>{title}</h2>
            {fireworks && <Firework size={96} flip />}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 26, padding: '0 28px' }}>
            {SCENARIO_DEFS.map((scn, idx) => (
              <div key={scn.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 54, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 54, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap' }}>Scenario {idx + 1}</div>
                  </div>
                  <div style={{ position: 'relative', flex: 1, aspectRatio: `${VIEW_W} / ${VIEW_H}`, borderRadius: 14, overflow: 'hidden', background: '#151515' }}>
                    <ScenarioMap {...mapProps(scn.id)} />
                  </div>
                </div>
                <div style={{ marginTop: 14, paddingLeft: 60, display: 'flex', alignItems: 'center', gap: 10, minHeight: 43 }}>
                  {pcts[scn.id] !== '' && pcts[scn.id] != null && (
                    <span style={{ display: 'inline-block', padding: '6px 22px 4px', borderRadius: 999, background: '#1c1c1c', color: '#fff', fontSize: 28, fontWeight: 800, lineHeight: 1.25 }}>
                      Probability:{pcts[scn.id]}%
                    </span>
                  )}
                  {ensInfo?.days > 1 && scenarios[scn.id]?.ens?.cluster?.valid && (
                    <span style={{ fontSize: 17, fontWeight: 700, color: '#555' }}>
                      {new Date(scenarios[scn.id].ens.cluster.valid).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} 12Z
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Bottom row: brand left, key centred */}
          <div style={{ position: 'absolute', left: 12, bottom: 10, display: 'flex', alignItems: 'flex-end', gap: 14, width: 420 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              {logo ? <img src={logo} alt="" crossOrigin="anonymous" style={{ width: 58, height: 58, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 58, height: 58, borderRadius: '50%', background: '#5b6ee8' }} />}
              <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>MyWeather</span>
              <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>{version}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 2 }}>
              <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>Issued: {issued}</span>
              {ensInfo && <span style={{ fontSize: 11, fontWeight: 600, color: '#737373' }}>From the ECMWF ensemble, © ECMWF CC BY 4.0</span>}
            </div>
          </div>
          {showKey && keyEntries.length > 0 && (
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', maxWidth: 640, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 16px', padding: '8px 16px', borderRadius: 16, background: '#f3f4f6' }}>
              {keyEntries.map(({ k, label }) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
                  <KeySwatch k={k} />{label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Per-scenario strip ── */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 16, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {SCENARIO_DEFS.map((scn, idx) => {
          const count = (scenarios[scn.id]?.items || []).length;
          const next = SCENARIO_DEFS[(idx + 1) % 3];
          return (
            <div key={scn.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.15)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>Scenario {idx + 1}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{count} drawing{count === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setFullscreenId(scn.id)} style={{ ...btnCss, background: 'rgba(56,189,248,0.15)', color: '#7dd3fc' }}><Maximize2 style={{ width: 13, height: 13 }} /> Edit large</button>
                <button type="button" disabled={!count} onClick={() => setScenarioState(scn.id, (p) => ({ ...p, items: (p.items || []).slice(0, -1) }))} style={btnCss}><Undo2 style={{ width: 13, height: 13 }} /> Undo</button>
                <button type="button" onClick={() => window.confirm(`Clear everything drawn on Scenario ${idx + 1}?`) && setScenarioState(scn.id, (p) => ({ ...p, items: [] }))} style={{ ...btnCss, color: '#fca5a5' }}><Trash2 style={{ width: 13, height: 13 }} /> Clear</button>
                <button type="button" disabled={!count} onClick={() => setScenarioState(next.id, (p) => ({ ...p, items: JSON.parse(JSON.stringify(scenarios[scn.id].items)).map((it, i) => ({ ...it, id: Date.now() + i })) }))} style={btnCss}><Copy style={{ width: 13, height: 13 }} /> Copy → {(idx + 1) % 3 + 1}</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Story cards (1080×1920, one per scenario) ── */}
      <StoryCardsPanel cards={cards} setCards={setCards} pcts={pcts} setPcts={setPcts} defs={SCENARIO_DEFS}
        ensClusters={SCENARIO_DEFS.map((d) => scenarios[d.id]?.ens?.cluster || null)} ensInfo={ensInfo} logoUrl={logo}
        fileStem={`forecast-scenarios-${validDate}${rangeDays > 1 ? `-to-${endDate}` : ''}`} />

      {/* ── Large editor ── */}
      {fullscreenId && (() => {
        const idx = SCENARIO_DEFS.findIndex((s) => s.id === fullscreenId);
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(4,8,18,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 20px', gap: 12, overflowY: 'auto' }}>
            <div style={{ width: 'min(1100px, 100%)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 20, fontWeight: 800, fontFamily: FONT }}>Scenario {idx + 1} · {pcts[fullscreenId]}% · {view.label}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setScenarioState(fullscreenId, (p) => ({ ...p, items: (p.items || []).slice(0, -1) }))} style={btnCss}><Undo2 style={{ width: 14, height: 14 }} /> Undo</button>
                <button type="button" onClick={() => setFullscreenId(null)} style={btnCss}><Minimize2 style={{ width: 14, height: 14 }} /> Done</button>
              </div>
            </div>
            <div style={{ position: 'relative', width: 'min(1100px, 100%, calc((100vh - 290px) * 600 / 540))', aspectRatio: `${VIEW_W} / ${VIEW_H}`, borderRadius: 16, overflow: 'hidden', flexShrink: 0 }}>
              <ScenarioMap {...mapProps(fullscreenId)} />
            </div>
            <div style={{ width: 'min(1100px, 100%)', background: '#0c1422', borderRadius: 14, padding: 14, border: '1px solid rgba(148,163,184,0.15)' }}>
              <Palette tool={tool} pickTool={pickTool} opts={opts} setOpts={setOpts} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
