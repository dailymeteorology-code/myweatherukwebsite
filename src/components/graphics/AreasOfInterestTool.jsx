/* ════════════════════════════════════════════════════════════════════════════
   AreasOfInterestTool — "things to keep an eye on", drawn on a map of the UK.

   Draw an area (freehand: press and drag round it; or click its corners), and
   the moment it closes a box in that area's colour opens beside it to say what
   it is for ("High rainfall totals") and when: one day, or from one day to
   another. Each area is numbered on the map and listed in the key with its what
   and when, so "eastern Scotland, Friday and Saturday, risk of high rainfall
   totals" reads at a glance.

   The graphic is the house format, 1080 x 1920 and vertical, dark or light,
   with the site logo; it downloads as a PNG at full size. The work in progress
   is kept in this browser, so a reload does not lose an afternoon's drawing.

   Coordinates come from the SVG's own screen matrix (getScreenCTM), so a point
   lands under the pointer however the preview is scaled or letterboxed.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import html2canvas from 'html2canvas';
import { Check, Download, Loader2, MousePointer2, PenLine, Trash2, Undo2, X } from 'lucide-react';
import { loadSynopticGeo, MAP_EXTENTS } from '@/lib/synopticGeo';
import { smoothPath } from '@/components/synoptic/synopticDraw';
import { inkOn } from '@/components/graphics/GraphicMeta';

const GW = 1080, GH = 1920;                // the graphic
const VW = 1080, VH = 1300;                // the map's drawing space
const STORE = 'mwuk_aoi_graphic_v1';
const PALETTE = ['#f97316', '#3b82f6', '#a855f7', '#ef4444', '#22c55e', '#eab308', '#06b6d4', '#ec4899'];
const IDEAS = ['High rainfall totals', 'Heavy rain', 'Strong winds', 'Gales', 'Thunderstorms', 'Snow', 'Ice', 'Fog', 'Frost', 'Heat', 'Flooding', 'Coastal gales'];
const TZ = 'Europe/London';
const DAY = 864e5;

const THEMES = {
  dark: {
    bg: 'linear-gradient(180deg, #0b1526 0%, #09111e 100%)', sea: '#0f1d31', land: '#24344b', coast: 'rgba(170,196,226,0.5)',
    ink1: '#f3f7fc', ink2: '#9fb2c8', ink3: '#6f8399', accent: '#7dd3fc',
    card: 'rgba(255,255,255,0.06)', cardEdge: 'rgba(255,255,255,0.12)', rule: 'rgba(255,255,255,0.12)',
  },
  light: {
    bg: 'linear-gradient(180deg, #f2f6fb 0%, #e8eff7 100%)', sea: '#d4e2f0', land: '#ffffff', coast: '#93aac2',
    ink1: '#0b1220', ink2: '#475569', ink3: '#7a8aa0', accent: '#0369a1',
    card: 'rgba(255,255,255,0.78)', cardEdge: 'rgba(15,23,42,0.09)', rule: 'rgba(15,23,42,0.12)',
  },
};

/* ── days ──────────────────────────────────────────────────────────────────── */
const isoDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const fmt = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
function nextDays(n) {
  const base = new Date(`${isoDay(new Date())}T12:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => new Date(base + i * DAY).toISOString().slice(0, 10));
}
/** "Friday 23 Oct", "Fri 23 – Sat 24 Oct", or short "Fri–Sat" for the map */
function whenText(from, to, short = false) {
  if (!from) return '';
  const end = to && to !== from ? to : null;
  if (short) return end ? `${fmt(from, { weekday: 'short' })}–${fmt(end, { weekday: 'short' })}` : fmt(from, { weekday: 'long' });
  if (!end) return fmt(from, { weekday: 'long', day: 'numeric', month: 'short' });
  const sameMonth = from.slice(0, 7) === end.slice(0, 7);
  return `${fmt(from, { weekday: 'short', day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) })} – ${fmt(end, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

/* ── geometry ──────────────────────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9);
function simplify(pts, tol) {                                     // Ramer-Douglas-Peucker
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > dmax) { dmax = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** where an area's number sits: its centroid, or a point inside it when the shape is a crescent */
function anchorOf(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  const mean = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const c = Math.abs(a) < 1e-6 ? mean : [cx / (3 * a), cy / (3 * a)];
  if (inside(pts, c[0], c[1])) return c;
  if (inside(pts, mean[0], mean[1])) return mean;
  let best = pts[0], bd = Infinity;                                // the inside point nearest the centroid
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 2) % pts.length;
    const m = [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2];
    const d = Math.hypot(m[0] - c[0], m[1] - c[1]);
    if (d < bd && inside(pts, m[0], m[1])) { bd = d; best = m; }
  }
  return best;
}

/* ── the tool ──────────────────────────────────────────────────────────────── */
const lbl = { display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#64748b', marginBottom: 7 };
const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: 'rgba(148,163,184,0.06)', border: '1.5px solid rgba(148,163,184,0.18)', color: '#a8b5c7' };
const field = { padding: '8px 10px', borderRadius: 10, background: '#101c2e', border: '1px solid rgba(148,163,184,0.2)', color: '#f1f5f9', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', outline: 'none' };
const seg = (on) => ({ ...btn, padding: '7px 11px', background: on ? 'rgba(56,189,248,0.16)' : btn.background, borderColor: on ? '#38bdf8' : btn.border, color: on ? '#7dd3fc' : btn.color });

/* the first palette colour not already on the map, so each new area stands apart */
const nextColour = (list) => PALETTE.find((c) => !list.some((a) => a.colour === c)) || PALETTE[list.length % PALETTE.length];

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
}

export default function AreasOfInterestTool({ siteLogoUrl = '' }) {
  const saved = useMemo(loadSaved, []);
  const [areas, setAreas] = useState(saved?.areas || []);
  const [title, setTitle] = useState(saved?.title ?? 'Areas of interest');
  const [subtitle, setSubtitle] = useState(saved?.subtitle ?? '');
  const [themeId, setThemeId] = useState(saved?.themeId || 'dark');
  const [extent, setExtent] = useState(saved?.extent || 'uk');
  const [clip, setClip] = useState(saved?.clip ?? true);
  const [mapLabels, setMapLabels] = useState(saved?.mapLabels ?? true);
  const [handle, setHandle] = useState(saved?.handle ?? '@MyWeatherUK');
  const [mode, setMode] = useState('free');                        // free | points
  const [colour, setColour] = useState(() => nextColour(saved?.areas || []));
  const [draft, setDraft] = useState([]);
  const [editing, setEditing] = useState(null);                    // area id with its box open
  const [geo, setGeo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [scale, setScale] = useState(0.4);

  const svgRef = useRef(null), graphicRef = useRef(null), wrapRef = useRef(null);
  const drawing = useRef(null);
  const T = THEMES[themeId];

  /* keep the work in this browser */
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ areas, title, subtitle, themeId, extent, clip, mapLabels, handle })); } catch { /* quota */ }
  }, [areas, title, subtitle, themeId, extent, clip, mapLabels, handle]);

  useEffect(() => {
    let live = true;
    loadSynopticGeo({ extent, viewW: VW, viewH: VH }).then((g) => { if (live) setGeo(g); }).catch(() => {});
    return () => { live = false; };
  }, [extent]);

  /* the preview: as large as the panel allows, never larger than the real thing */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const fit = () => setScale(Math.min(1, el.clientWidth / GW, (window.innerHeight * 0.92) / GH));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, []);

  const toView = useCallback((e) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }, []);

  const addArea = (pts) => {
    const last = areas[areas.length - 1];
    const tomorrow = nextDays(2)[1];
    const a = { id: uid(), points: pts, colour, what: '', note: '', from: last?.from || tomorrow, to: last?.to || null };
    const list = [...areas, a];
    setAreas(list);
    setColour(nextColour(list));
    setEditing(a.id);
  };
  const updArea = (id, patch) => setAreas((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const delArea = (id) => { setAreas((list) => list.filter((a) => a.id !== id)); setEditing(null); };

  /* freehand: press, drag round the area, let go; points: click its corners, then Finish */
  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = toView(e);
    if (!p) return;
    const hit = e.target.closest?.('[data-area]')?.getAttribute('data-area') || null;
    if (mode === 'points') { drawing.current = { hit, pts: [p], points: true }; return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = { hit, pts: [p] };
    setDraft([p]);
  };
  const onMove = (e) => {
    const d = drawing.current;
    if (!d || d.points) return;
    const p = toView(e);
    const lastP = d.pts[d.pts.length - 1];
    if (p && Math.hypot(p[0] - lastP[0], p[1] - lastP[1]) > 5) { d.pts.push(p); setDraft([...d.pts]); }
  };
  const onUp = (e) => {
    const d = drawing.current;
    drawing.current = null;
    if (!d) return;
    if (d.points) {                                                // points mode: a click is a corner, or opens an area
      if (d.hit && draft.length === 0) { setEditing(d.hit); return; }
      const p = toView(e) || d.pts[0];
      setDraft((dr) => [...dr, p]);
      return;
    }
    const pts = d.pts;
    const span = pts.reduce((m, p) => Math.max(m, Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])), 0);
    setDraft([]);
    if (pts.length < 6 || span < 25) { if (d.hit) setEditing(d.hit); return; }   // a tap, not a drawing
    addArea(simplify(pts, 2.2));
  };
  const finishPoints = () => { if (draft.length >= 3) { addArea(draft); setDraft([]); } };

  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') { setDraft([]); drawing.current = null; setEditing(null); }
      if (e.key === 'Enter' && mode === 'points' && draft.length >= 3 && !editing) finishPoints();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  /* drag an area's number to a better spot */
  const dragBadge = (id) => (e) => {
    e.stopPropagation();
    const move = (ev) => { const p = toView(ev); if (p) updArea(id, { labelAt: p }); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const download = async () => {
    if (!graphicRef.current) return;
    setExporting(true);
    setEditing(null);
    try {
      await new Promise((r) => requestAnimationFrame(() => r()));
      const canvas = await html2canvas(graphicRef.current, {
        backgroundColor: null, scale: 1, useCORS: true, logging: false, width: GW, height: GH, windowWidth: GW, windowHeight: GH,
        onclone: (doc) => { const g = doc.querySelector('[data-aoi-graphic]'); if (g) g.style.transform = 'none'; },
      });
      const a = document.createElement('a');
      a.download = `areas-of-interest-${isoDay(new Date())}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } finally { setExporting(false); }
  };

  /* the dates the whole graphic covers, for the subtitle when none is typed */
  const span = useMemo(() => {
    const ds = areas.flatMap((a) => [a.from, a.to || a.from]).filter(Boolean).sort();
    if (!ds.length) return '';
    const [a, b] = [ds[0], ds[ds.length - 1]];
    return a === b ? fmt(a, { weekday: 'long', day: 'numeric', month: 'long' })
      : `${fmt(a, { weekday: 'long', day: 'numeric', ...(a.slice(0, 7) === b.slice(0, 7) ? {} : { month: 'long' }) })} – ${fmt(b, { weekday: 'long', day: 'numeric', month: 'long' })}`;
  }, [areas]);

  const many = areas.length > 4;
  const open = areas.find((a) => a.id === editing) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#f1f5f9' }}>
      {/* ══ controls ══ */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.1)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <span style={lbl}>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...field, width: '100%' }} />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <span style={lbl}>Subtitle</span>
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder={span || 'The days covered, filled in from the areas'} style={{ ...field, width: '100%' }} />
          </div>
          <div>
            <span style={lbl}>Look</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={seg(themeId === 'dark')} onClick={() => setThemeId('dark')}>Dark</button>
              <button type="button" style={seg(themeId === 'light')} onClick={() => setThemeId('light')}>Light</button>
            </div>
          </div>
          <div>
            <span style={lbl}>Map</span>
            <select value={extent} onChange={(e) => setExtent(e.target.value)} style={field}>
              <option value="uk">{MAP_EXTENTS.uk.label}</option>
              <option value="uk-france">{MAP_EXTENTS['uk-france'].label}</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={seg(mode === 'free')} onClick={() => { setMode('free'); setDraft([]); }}><PenLine size={13} />Freehand</button>
            <button type="button" style={seg(mode === 'points')} onClick={() => { setMode('points'); setDraft([]); }}><MousePointer2 size={13} />Click points</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Next area</span>
            {PALETTE.map((c) => (
              <button key={c} type="button" onClick={() => setColour(c)} aria-label={`Draw in ${c}`}
                style={{ width: 24, height: 24, borderRadius: 8, background: c, cursor: 'pointer', border: colour === c ? '2.5px solid #fff' : '1.5px solid rgba(255,255,255,0.25)', boxShadow: colour === c ? `0 0 0 2px ${c}66` : 'none' }} />
            ))}
            <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} title="Any colour"
              style={{ width: 30, height: 26, borderRadius: 8, background: 'transparent', border: '1px solid rgba(148,163,184,0.3)', cursor: 'pointer' }} />
          </div>
          {mode === 'points' && draft.length > 0 && (
            <>
              <button type="button" onClick={finishPoints} disabled={draft.length < 3} style={{ ...btn, color: '#86efac', borderColor: 'rgba(74,222,128,0.4)', opacity: draft.length < 3 ? 0.5 : 1 }}>
                <Check size={13} />Finish area ({draft.length})
              </button>
              <button type="button" onClick={() => setDraft((d) => d.slice(0, -1))} style={btn}><Undo2 size={13} />Undo point</button>
            </>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a8b5c7' }}>
            <input type="checkbox" checked={clip} onChange={(e) => setClip(e.target.checked)} /> Keep areas on land
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a8b5c7' }}>
            <input type="checkbox" checked={mapLabels} onChange={(e) => setMapLabels(e.target.checked)} /> Name areas on the map
          </label>
        </div>

        {areas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {areas.map((a, i) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 11, background: editing === a.id ? `${a.colour}1f` : 'rgba(148,163,184,0.05)', border: `1.5px solid ${editing === a.id ? a.colour : 'rgba(148,163,184,0.12)'}` }}>
                <span style={{ width: 24, height: 24, borderRadius: 99, background: a.colour, color: inkOn(a.colour), display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, flex: 'none' }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.what || <span style={{ color: '#64748b', fontWeight: 600 }}>Not described yet</span>}
                  <span style={{ marginLeft: 8, fontWeight: 600, color: '#94a3b8' }}>{whenText(a.from, a.to)}</span>
                </span>
                <button type="button" onClick={() => setEditing(a.id)} style={{ ...btn, padding: '5px 10px' }}>Edit</button>
                <button type="button" onClick={() => delArea(a.id)} aria-label={`Delete area ${i + 1}`} style={{ ...btn, padding: '5px 8px', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => setAreas((l) => l.slice(0, -1))} disabled={!areas.length} style={{ ...btn, opacity: areas.length ? 1 : 0.5 }}><Undo2 size={13} />Undo last area</button>
          <button type="button" onClick={() => { if (window.confirm('Remove every area?')) { setAreas([]); setEditing(null); } }} disabled={!areas.length}
            style={{ ...btn, color: '#f87171', borderColor: 'rgba(248,113,113,0.35)', opacity: areas.length ? 1 : 0.5 }}><Trash2 size={13} />Clear all</button>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} style={{ ...field, width: 160, marginLeft: 'auto' }} aria-label="Handle on the graphic" />
          <button type="button" onClick={download} disabled={exporting} style={{ ...btn, fontWeight: 800, background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', borderColor: 'transparent', color: '#fff' }}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}{exporting ? 'Exporting…' : 'Download PNG (1080 × 1920)'}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 11.5, color: '#64748b', lineHeight: 1.55 }}>
          <b style={{ color: '#94a3b8' }}>Freehand:</b> press on the map and drag round the area, then let go. <b style={{ color: '#94a3b8' }}>Click points:</b> click its corners, then Finish (or press Enter).
          When an area closes, a box in its colour opens beside it: say what it is for and pick one day, or a first and last day. Click an area (or Edit) to change it, drag its number to move it, Escape to close the box.
          {!geo && <b style={{ color: '#fbbf24' }}> Loading the coastline…</b>}
        </p>
      </div>

      {/* ══ the graphic ══ */}
      <div ref={wrapRef} style={{ width: '100%', height: GH * scale, display: 'flex', justifyContent: 'center' }}>
        <div ref={graphicRef} data-aoi-graphic style={{
          width: GW, height: GH, flexShrink: 0, position: 'relative', overflow: 'hidden',
          transform: `scale(${scale})`, transformOrigin: 'top center',
          background: T.bg, color: T.ink1, display: 'flex', flexDirection: 'column',
          fontFamily: "'Archivo','DM Sans',system-ui,-apple-system,sans-serif",
        }}>
          {/* header */}
          <div style={{ padding: '78px 76px 18px', flexShrink: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '0.24em', textTransform: 'uppercase', color: T.accent }}>MyWeatherUK · Heads-up</div>
            <div style={{ marginTop: 14, fontSize: 88, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1 }}>{title || 'Areas of interest'}</div>
            {(subtitle || span) && <div style={{ marginTop: 18, fontSize: 36, fontWeight: 600, color: T.ink2, letterSpacing: '-0.01em' }}>{subtitle || span}</div>}
          </div>

          {/* map */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative', background: T.sea }}>
            <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%"
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}>
              <defs>
                <clipPath id="aoi-land"><path d={geo?.landPathD || ''} /></clipPath>
              </defs>
              <rect x={-VW} y={-VH} width={VW * 3} height={VH * 3} fill={T.sea} />
              <g clipPath="url(#aoi-land)"><rect x={0} y={0} width={VW} height={VH} fill={T.land} /></g>

              {/* the areas: a wash of colour with a firm edge, on land unless asked otherwise */}
              <g clipPath={clip ? 'url(#aoi-land)' : undefined}>
                {areas.map((a) => {
                  const d = smoothPath(a.points, true);
                  return (
                    <g key={a.id} data-area={a.id} style={{ cursor: 'pointer' }}>
                      <path d={d} fill={a.colour} fillOpacity={themeId === 'dark' ? 0.44 : 0.38} />
                      <path d={d} fill="none" stroke={a.colour} strokeWidth={5} strokeLinejoin="round" />
                    </g>
                  );
                })}
              </g>
              <g fill="none" stroke={T.coast} strokeWidth={1.3} strokeLinejoin="round" pointerEvents="none">
                {(geo?.paths || []).map((d, i) => <path key={i} d={d} />)}
              </g>
              {editing && (() => {
                const a = areas.find((x) => x.id === editing);
                return a ? <path d={smoothPath(a.points, true)} fill="none" stroke={themeId === 'dark' ? '#fff' : '#0b1220'} strokeWidth={3} strokeDasharray="10 8" pointerEvents="none" /> : null;
              })()}

              {/* the shape being drawn */}
              {draft.length > 0 && (
                <g pointerEvents="none">
                  <path d={mode === 'free' ? `M${draft.map((p) => p.join(',')).join(' L')}` : smoothPath(draft, draft.length > 2)}
                    fill={`${colour}33`} stroke={colour} strokeWidth={4} strokeDasharray="12 8" strokeLinejoin="round" />
                  {mode === 'points' && draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={7} fill="#fff" stroke={colour} strokeWidth={3} />)}
                </g>
              )}

              {/* each area's number, and its name if wanted */}
              {areas.map((a, i) => {
                const [x, y] = a.labelAt || anchorOf(a.points);
                const ink = inkOn(a.colour);
                const name = mapLabels && a.what ? `${a.what}${a.from ? ` · ${whenText(a.from, a.to, true)}` : ''}` : '';
                const w = name ? Math.min(560, 26 + name.length * 13.6) : 0;
                const flip = name && x + 18 + w > VW - 12;                 // near the east edge the name goes to the left
                const nx = flip ? x - 18 - w : x + 18;
                return (
                  <g key={a.id} onPointerDown={dragBadge(a.id)} style={{ cursor: 'grab' }}>
                    {name && (
                      <g>
                        <rect x={nx} y={y - 22} width={w} height={44} rx={22} fill={themeId === 'dark' ? 'rgba(8,14,26,0.86)' : 'rgba(255,255,255,0.94)'} stroke={a.colour} strokeWidth={2.5} />
                        <text x={nx + 20} y={y + 8.5} fontSize={24} fontWeight={700} fill={T.ink1} fontFamily="'Archivo','DM Sans',system-ui,sans-serif">{name}</text>
                      </g>
                    )}
                    <circle cx={x} cy={y} r={30} fill={a.colour} stroke={themeId === 'dark' ? '#0b1526' : '#fff'} strokeWidth={5} />
                    <text x={x} y={y + 11} textAnchor="middle" fontSize={32} fontWeight={800} fill={ink} fontFamily="'Archivo','DM Sans',system-ui,sans-serif">{i + 1}</text>
                  </g>
                );
              })}
            </svg>
            {areas.length === 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 40, textAlign: 'center', fontSize: 30, fontWeight: 600, color: T.ink3, pointerEvents: 'none' }}>
                Draw an area on the map to begin
              </div>
            )}
          </div>

          {/* the key */}
          {areas.length > 0 && (
            <div style={{ padding: '34px 56px 0', display: 'grid', gridTemplateColumns: many ? '1fr 1fr' : '1fr', gap: many ? 14 : 16, flexShrink: 0 }}>
              {areas.map((a, i) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: many ? 16 : 22, padding: many ? '16px 18px' : '20px 24px', borderRadius: 26, background: T.card, border: `1.5px solid ${T.cardEdge}`, borderLeft: `8px solid ${a.colour}` }}>
                  <span style={{ width: many ? 46 : 56, height: many ? 46 : 56, borderRadius: 99, background: a.colour, color: inkOn(a.colour), display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontSize: many ? 24 : 30, fontWeight: 800, flex: 'none' }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: many ? 27 : 34, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{a.what || 'Area of interest'}</span>
                    {a.note && <span style={{ display: 'block', marginTop: 4, fontSize: many ? 19 : 23, lineHeight: 1.3, color: T.ink2 }}>{a.note}</span>}
                    {many && a.from && <span style={{ display: 'block', marginTop: 6, fontSize: 19, fontWeight: 700, color: T.ink2 }}>{whenText(a.from, a.to)}</span>}
                  </span>
                  {!many && a.from && (
                    <span style={{ flex: 'none', padding: '10px 18px', borderRadius: 99, fontSize: 24, fontWeight: 800, background: `${a.colour}29`, border: `2px solid ${a.colour}`, color: T.ink1, whiteSpace: 'nowrap' }}>{whenText(a.from, a.to)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '34px 64px 0', padding: '26px 0 58px', borderTop: `2px solid ${T.rule}`, flexShrink: 0 }}>
            {siteLogoUrl
              ? <img src={siteLogoUrl} alt="" crossOrigin="anonymous" style={{ width: 58, height: 58, borderRadius: '50%', objectFit: 'cover' }} />
              : <span style={{ width: 58, height: 58, borderRadius: '50%', background: T.accent }} />}
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <b style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.01em' }}>MyWeatherUK</b>
              <span style={{ fontSize: 22, color: T.ink2 }}>{handle}</span>
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 21, color: T.ink3, textAlign: 'right', lineHeight: 1.35 }}>Areas to keep an eye on,<br />not a weather warning</span>
          </div>
        </div>
      </div>

      {open && <AreaBox key={open.id} area={open} number={areas.indexOf(open) + 1} svgRef={svgRef}
        onChange={(patch) => updArea(open.id, patch)} onDelete={() => delArea(open.id)} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ── the box that opens when an area is finished ──────────────────────────────
   In the area's own colour, beside it on screen: what it is for, and when. */
function AreaBox({ area, number, svgRef, onChange, onDelete, onClose }) {
  const days = useMemo(() => nextDays(10), []);
  const [range, setRange] = useState(!!(area.to && area.to !== area.from));
  const [step, setStep] = useState('first');                       // in "From – to": which day the next click sets
  const [pos, setPos] = useState(null);
  const whatRef = useRef(null);
  const ink = inkOn(area.colour);

  /* beside the area: right of it if there is room, else left, kept on screen */
  useEffect(() => {
    const place = () => {
      const svg = svgRef.current, m = svg?.getScreenCTM();
      if (!m) return;
      const [ax, ay] = area.labelAt || anchorOf(area.points);
      const pt = svg.createSVGPoint(); pt.x = ax; pt.y = ay;
      const p = pt.matrixTransform(m);
      const w = Math.min(380, window.innerWidth - 24), h = 520;
      const left = p.x + 40 + w < window.innerWidth - 12 ? p.x + 40 : Math.max(12, p.x - 40 - w);
      const top = Math.min(Math.max(12, p.y - 120), Math.max(12, window.innerHeight - h - 12));
      setPos({ left, top, w });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [area.id, area.labelAt, area.points, svgRef]);

  useEffect(() => { setTimeout(() => whatRef.current?.focus(), 30); }, [area.id]);

  /* one day: a click is the day. From – to: the first click is the first day and the second the
     last (either order); a third starts again */
  const pick = (iso) => {
    if (!range) { onChange({ from: iso, to: null }); return; }
    if (step === 'first' || !area.from) { onChange({ from: iso, to: null }); setStep('last'); return; }
    if (iso !== area.from) onChange(iso < area.from ? { from: iso, to: area.from } : { to: iso });
    setStep('first');
  };
  const inRange = (iso) => area.from && iso >= area.from && iso <= (area.to || area.from);

  if (!pos) return null;
  return createPortal(
    <div role="dialog" aria-label={`Area ${number}`} onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: pos.w, zIndex: 2000, borderRadius: 22, overflow: 'hidden',
        background: 'rgba(14,20,32,0.86)', WebkitBackdropFilter: 'blur(26px) saturate(170%)', backdropFilter: 'blur(26px) saturate(170%)',
        border: `1.5px solid ${area.colour}88`, boxShadow: `0 30px 70px -20px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 40px -12px ${area.colour}66`,
        color: '#f1f5f9', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Inter,sans-serif", animation: 'aoi-pop .22s cubic-bezier(.22,1,.36,1) both',
      }}>
      <style>{'@keyframes aoi-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 12px 14px', background: area.colour, color: ink }}>
        <span style={{ width: 28, height: 28, borderRadius: 99, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, background: ink === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)' }}>{number}</span>
        <b style={{ flex: 1, fontSize: 15 }}>Area {number}</b>
        <button type="button" onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 10, border: 0, display: 'grid', placeItems: 'center', cursor: 'pointer', background: ink === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)', color: ink }}><X size={16} /></button>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div>
          <span style={{ ...lbl, marginBottom: 6 }}>What is it for?</span>
          <input ref={whatRef} value={area.what} onChange={(e) => onChange({ what: e.target.value })} placeholder="e.g. Risk of high rainfall totals"
            onKeyDown={(e) => { if (e.key === 'Enter') onClose(); }}
            style={{ ...field, width: '100%', fontSize: 15, background: 'rgba(255,255,255,0.06)', borderColor: `${area.colour}66` }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
            {IDEAS.map((t) => (
              <button key={t} type="button" onClick={() => onChange({ what: t })}
                style={{ padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit', color: area.what === t ? ink : '#cbd5e1', background: area.what === t ? area.colour : 'rgba(255,255,255,0.06)', border: `1px solid ${area.what === t ? area.colour : 'rgba(255,255,255,0.12)'}` }}>{t}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <span style={{ ...lbl, marginBottom: 0, flex: 1 }}>When</span>
            <div style={{ display: 'inline-flex', padding: 2, borderRadius: 9, background: 'rgba(255,255,255,0.06)' }}>
              {[['One day', false], ['From – to', true]].map(([t, r]) => (
                <button key={t} type="button" onClick={() => { setRange(r); setStep('first'); if (!r) onChange({ to: null }); }}
                  style={{ padding: '4px 10px', borderRadius: 7, border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, background: range === r ? area.colour : 'transparent', color: range === r ? ink : '#94a3b8' }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
            {days.map((iso, i) => {
              const on = inRange(iso), end = iso === area.from || iso === (area.to || area.from);
              return (
                <button key={iso} type="button" onClick={() => pick(iso)}
                  style={{ padding: '6px 2px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                    background: on ? (end ? area.colour : `${area.colour}44`) : 'rgba(255,255,255,0.05)', color: on && end ? ink : '#e2e8f0',
                    border: `1px solid ${on ? area.colour : 'rgba(255,255,255,0.1)'}` }}>
                  <span style={{ fontSize: 11, fontWeight: 800 }}>{i === 0 ? 'Today' : fmt(iso, { weekday: 'short' })}</span>
                  <span style={{ fontSize: 10.5, opacity: 0.8 }}>{fmt(iso, { day: 'numeric', month: 'short' })}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 7, fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>
            {area.from ? whenText(area.from, area.to) : 'Pick a day'}
            {range && <span style={{ fontWeight: 500, color: '#94a3b8' }}>{step === 'last' ? ' · now pick the last day' : area.to ? '' : ' · pick the first day'}</span>}
          </div>
        </div>

        <div>
          <span style={{ ...lbl, marginBottom: 6 }}>More detail (optional)</span>
          <input value={area.note || ''} onChange={(e) => onChange({ note: e.target.value })} placeholder="e.g. 40–60 mm on high ground"
            style={{ ...field, width: '100%', background: 'rgba(255,255,255,0.06)' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginRight: 2 }}>Colour</span>
          {PALETTE.map((c) => (
            <button key={c} type="button" onClick={() => onChange({ colour: c })} aria-label={c}
              style={{ width: 22, height: 22, borderRadius: 7, background: c, cursor: 'pointer', border: area.colour === c ? '2.5px solid #fff' : '1.5px solid rgba(255,255,255,0.2)' }} />
          ))}
          <input type="color" value={area.colour} onChange={(e) => onChange({ colour: e.target.value })}
            style={{ width: 28, height: 24, borderRadius: 7, background: 'transparent', border: '1px solid rgba(148,163,184,0.3)', cursor: 'pointer' }} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onDelete} style={{ ...btn, color: '#f87171', borderColor: 'rgba(248,113,113,0.35)' }}><Trash2 size={13} />Delete</button>
          <button type="button" onClick={onClose} style={{ ...btn, marginLeft: 'auto', fontWeight: 800, background: area.colour, borderColor: 'transparent', color: ink }}><Check size={14} />Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
