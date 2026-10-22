/* ════════════════════════════════════════════════════════════════════════════
   SynopticChartTool — draw a pressure chart.

   Fronts, isobars, the jet, pressure centres, flow arrows and weather symbols,
   over a choice of three map extents (see lib/synopticGeo.js). Everything is
   drawn in the SVG's own view coordinates, so the exported PNG is identical to
   what is on screen regardless of how wide the admin panel happens to be.

   TWO KINDS OF ELEMENT, and they behave differently on purpose:

     PATH elements (front, isobar, jet, arrow) are built by clicking a run of
     control points and then finishing. They can be reshaped afterwards by
     dragging any handle, because a front almost never lands right first time.

     POINT elements (pressure centre, weather symbol) drop where you click and
     drag freely.

   Weather symbols render in an HTML layer above the SVG rather than inside it:
   they are existing React icon components from the shared library, and
   nesting those in an <svg> would mean re-authoring every one. The overlay
   shares the map's exact pixel box, so the two stay registered, and
   html2canvas rasterises both together.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';
import { Download, Loader2, Undo2, Trash2, Check, X, Wind, PenLine } from 'lucide-react';
import { StudioStyles, Section, Btn, Field } from '@/components/studio/StudioUI';
import { loadSynopticGeo, EXTENT_LIST } from '@/lib/synopticGeo';
import { weatherIcons } from '@/components/WeatherIcons';
import {
  Front, Isobar, JetStream, FlowArrow, PressureCentre, FRONT_TYPES, smoothPath,
} from './synopticDraw';

const GRAPHIC_W = 900, GRAPHIC_H = 900;
const VIEW_W = 840, VIEW_H = 720;

const SYMBOL_CHOICES = [
  'Sunny', 'Sunny Intervals', 'Partly Cloudy', 'Cloudy', 'Overcast',
  'Light Rain', 'Moderate Rain', 'Heavy Rain', 'Rain Shower', 'Heavy Showers',
  'Thundery Shower', 'Thunderstorms', 'Light Snow', 'Snow', 'Sleet', 'Hail', 'Fog', 'Windy',
];

const PATH_TOOLS = {
  'front-warm':       { kind: 'front', frontType: 'warm',       label: 'Warm front' },
  'front-cold':       { kind: 'front', frontType: 'cold',       label: 'Cold front' },
  'front-occluded':   { kind: 'front', frontType: 'occluded',   label: 'Occluded front' },
  'front-stationary': { kind: 'front', frontType: 'stationary', label: 'Stationary front' },
  'isobar':           { kind: 'isobar', label: 'Isobar' },
  'jet':              { kind: 'jet',    label: 'Jet stream' },
  'arrow':            { kind: 'arrow',  label: 'Arrow' },
};

const uid = () => Math.random().toString(36).slice(2, 9);


export default function SynopticChartTool({ siteLogoUrl = '' }) {
  const [extent, setExtent] = useState('uk-france');
  const [geo, setGeo]       = useState(null);
  const [busy, setBusy]     = useState(false);

  const [tool, setTool]     = useState('front-warm');
  const [draft, setDraft]   = useState([]);
  const [els, setEls]       = useState([]);
  const [selected, setSelected] = useState(null);

  const [isobarValue, setIsobarValue] = useState('1012');
  const [symbolName, setSymbolName]   = useState('Sunny');
  const [jetWidth, setJetWidth]       = useState(22);
  const [title, setTitle]   = useState('Pressure chart');
  const [subtitle, setSubtitle] = useState('');
  const [handle, setHandle] = useState('@MyWeatherUK');
  const [exporting, setExporting] = useState(false);

  const svgRef = useRef(null);
  const graphicRef = useRef(null);
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const m = () => setScale(Math.min(1, (wrapRef.current?.offsetWidth || GRAPHIC_W) / GRAPHIC_W));
    m(); window.addEventListener('resize', m);
    return () => window.removeEventListener('resize', m);
  }, []);

  useEffect(() => {
    let live = true;
    setBusy(true);
    loadSynopticGeo({ extent, viewW: VIEW_W, viewH: VIEW_H })
      .then(g => { if (live) { setGeo(g); setBusy(false); } })
      .catch(() => live && setBusy(false));
    return () => { live = false; };
  }, [extent]);

  const toView = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const src = e.touches?.[0] || e;
    return [((src.clientX - r.left) / r.width) * VIEW_W, ((src.clientY - r.top) / r.height) * VIEW_H];
  }, []);

  const isPathTool = !!PATH_TOOLS[tool];

  const onMapClick = (e) => {
    const p = toView(e);
    if (!p) return;
    if (isPathTool) { setDraft(d => [...d, p]); return; }
    if (tool === 'low' || tool === 'high') {
      setEls(x => [...x, { id: uid(), kind: 'pressure', ctr: tool === 'low' ? 'L' : 'H', x: p[0], y: p[1], value: '' }]);
    }
    if (tool === 'symbol') {
      setEls(x => [...x, { id: uid(), kind: 'symbol', name: symbolName, x: p[0], y: p[1], size: 56 }]);
    }
  };

  const finishPath = () => {
    const def = PATH_TOOLS[tool];
    if (!def || draft.length < 2) return;
    const base = { id: uid(), kind: def.kind, points: draft };
    if (def.kind === 'front')  Object.assign(base, { frontType: def.frontType, side: 1 });
    if (def.kind === 'isobar') Object.assign(base, { value: isobarValue, dashed: false });
    if (def.kind === 'jet')    Object.assign(base, { width: jetWidth });
    if (def.kind === 'arrow')  Object.assign(base, { color: '#ffffff' });
    setEls(x => [...x, base]);
    setDraft([]);
  };

  /* Drag any point element, or any control handle of a selected path. Pointer
     capture is what keeps the drag alive once the cursor leaves the handle —
     at 5px radius it leaves immediately. */
  const startDrag = (apply) => (e) => {
    e.stopPropagation();
    const move = (ev) => { const p = toView(ev); if (p) apply(p); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const movePoint = (id) => startDrag(p => setEls(x => x.map(el => (el.id === id ? { ...el, x: p[0], y: p[1] } : el))));
  const moveHandle = (id, i) => startDrag(p => setEls(x => x.map(el => (
    el.id === id ? { ...el, points: el.points.map((q, j) => (j === i ? p : q)) } : el))));

  const update = (id, patch) => setEls(x => x.map(el => (el.id === id ? { ...el, ...patch } : el)));
  const remove = (id) => { setEls(x => x.filter(el => el.id !== id)); setSelected(null); };

  const download = async () => {
    if (!graphicRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(graphicRef.current, {
        backgroundColor: null, scale: 2, useCORS: true, logging: false,
        width: GRAPHIC_W, height: GRAPHIC_H, windowWidth: GRAPHIC_W, windowHeight: GRAPHIC_H,
        x: 0, y: 0, scrollX: 0, scrollY: 0,
      });
      const a = document.createElement('a');
      a.download = `synoptic-${extent}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } finally { setExporting(false); }
  };

  const selEl = els.find(e => e.id === selected) || null;

  return (
    <div className="sg" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StudioStyles />

      {/* ══ Controls ══ */}
      <div className="sg-controls">
        <Section id="syn-chart" icon={Wind} color="#5b6ee8" title="Chart" sub={title}>
          <Field label="Map extent">
            <select className="sg-input" value={extent} onChange={e => setExtent(e.target.value)}>
              {EXTENT_LIST.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </Field>
          <div className="sg-grid2">
            <Field label="Title"><input className="sg-input" value={title} onChange={e => setTitle(e.target.value)} /></Field>
            <Field label="Subtitle"><input className="sg-input" value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="e.g. Valid 12:00 Tuesday" /></Field>
          </div>
          <Field label="Handle"><input className="sg-input" value={handle} onChange={e => setHandle(e.target.value)} /></Field>
        </Section>

        <Section id="syn-draw" icon={PenLine} color="#a78bfa" title="Draw" sub={(PATH_TOOLS[tool]?.label) || ({ low: 'Low (L)', high: 'High (H)', symbol: 'Weather symbol' })[tool]}>
          <div className="sg-row">
            {Object.entries(PATH_TOOLS).map(([id, d]) => (
              <Btn key={id} sm on={tool === id} color={d.kind === 'front' ? FRONT_TYPES[d.frontType].color : d.kind === 'jet' ? '#22d3ee' : '#94a3b8'}
                onClick={() => { setTool(id); setDraft([]); }}>{d.label}</Btn>
            ))}
            {[['low', 'Low (L)', '#ef4444'], ['high', 'High (H)', '#2563eb'], ['symbol', 'Weather symbol', '#facc15']].map(([id, label, colour]) => (
              <Btn key={id} sm on={tool === id} color={colour} onClick={() => { setTool(id); setDraft([]); }}>{label}</Btn>
            ))}
          </div>
          {tool === 'isobar' && <Field label="Isobar value (mb)"><input className="sg-input" style={{ width: 110 }} value={isobarValue} onChange={e => setIsobarValue(e.target.value)} /></Field>}
          {tool === 'jet' && (
            <Field label={`Jet width — ${jetWidth}px`}>
              <input type="range" className="sg-range" min="10" max="46" value={jetWidth} onChange={e => setJetWidth(Number(e.target.value))} style={{ width: 180 }} />
            </Field>
          )}
          {tool === 'symbol' && (
            <Field label="Symbol">
              <select className="sg-input" value={symbolName} onChange={e => setSymbolName(e.target.value)}>
                {SYMBOL_CHOICES.filter(n => weatherIcons[n]).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          )}
          {isPathTool && draft.length > 0 && (
            <div className="sg-row">
              <Btn sm on color="#22c55e" icon={Check} disabled={draft.length < 2} onClick={finishPath}>Finish ({draft.length} pts)</Btn>
              <Btn sm icon={Undo2} onClick={() => setDraft(d => d.slice(0, -1))}>Undo point</Btn>
              <Btn sm danger icon={X} onClick={() => setDraft([])}>Cancel</Btn>
            </div>
          )}

          {/* Selected-element editor */}
          {selEl && (
            <div className="sg-panel" style={{ borderColor: 'color-mix(in srgb, var(--sg-accent) 45%, transparent)' }}>
              <div className="sg-row" style={{ justifyContent: 'space-between' }}>
                <span className="sg-note" style={{ textTransform: 'capitalize' }}><b>Selected</b> · {selEl.kind}</span>
                <Btn sm onClick={() => setSelected(null)}>Done</Btn>
              </div>
              <div className="sg-row">
                {selEl.kind === 'front' && (
                  <>
                    <select className="sg-input" style={{ width: 'auto' }} value={selEl.frontType} onChange={e => update(selEl.id, { frontType: e.target.value })}>
                      {Object.values(FRONT_TYPES).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                    <Btn sm onClick={() => update(selEl.id, { side: -selEl.side })}>Flip symbols</Btn>
                  </>
                )}
                {selEl.kind === 'isobar' && (
                  <>
                    <input className="sg-input" style={{ width: 90 }} value={selEl.value ?? ''} onChange={e => update(selEl.id, { value: e.target.value })} placeholder="mb" />
                    <Btn sm on={!!selEl.dashed} onClick={() => update(selEl.id, { dashed: !selEl.dashed })}>Dashed</Btn>
                  </>
                )}
                {selEl.kind === 'jet' && (
                  <input type="range" className="sg-range" min="10" max="46" value={selEl.width} onChange={e => update(selEl.id, { width: Number(e.target.value) })} style={{ width: 150 }} />
                )}
                {selEl.kind === 'arrow' && <input type="color" className="sg-color" value={selEl.color} onChange={e => update(selEl.id, { color: e.target.value })} />}
                {selEl.kind === 'pressure' && (
                  <>
                    <Btn sm onClick={() => update(selEl.id, { ctr: selEl.ctr === 'L' ? 'H' : 'L' })}>Switch to {selEl.ctr === 'L' ? 'H' : 'L'}</Btn>
                    <input className="sg-input" style={{ width: 90 }} value={selEl.value ?? ''} onChange={e => update(selEl.id, { value: e.target.value })} placeholder="mb" />
                  </>
                )}
                {selEl.kind === 'symbol' && (
                  <input type="range" className="sg-range" min="28" max="120" value={selEl.size} onChange={e => update(selEl.id, { size: Number(e.target.value) })} style={{ width: 150 }} />
                )}
                <Btn sm danger icon={Trash2} onClick={() => remove(selEl.id)}>Delete</Btn>
              </div>
            </div>
          )}

          <div className="sg-row">
            <Btn sm danger icon={Trash2} onClick={() => { setEls([]); setDraft([]); setSelected(null); }}>Clear chart</Btn>
          </div>
          <p className="sg-note">
            Pick a tool, click along the map to lay control points, then <b>Finish</b>.
            Click any finished element to edit it — its handles appear and can be dragged to reshape.
            {busy && <b style={{ color: 'var(--sg-amber)' }}> Loading coastline…</b>}
          </p>
        </Section>

        <Section id="syn-export" icon={Download} color="#0ea5e9" title="Export">
          <Btn primary color="#0ea5e9" icon={exporting ? Loader2 : Download} disabled={exporting} onClick={download}>{exporting ? 'Exporting…' : 'Download PNG'}</Btn>
        </Section>
      </div>

      {/* ══ Graphic ══ */}
      <div ref={wrapRef} style={{ width: '100%', height: GRAPHIC_H * scale, display: 'flex', justifyContent: 'center' }}>
        <div ref={graphicRef} style={{
          width: GRAPHIC_W, height: GRAPHIC_H, position: 'relative', overflow: 'hidden', flexShrink: 0,
          transform: `scale(${scale})`, transformOrigin: 'top center',
          background: 'linear-gradient(165deg,#0a1327 0%,#0d1a30 55%,#08101f 100%)',
          borderRadius: 18, border: '2px solid rgba(125,140,232,0.4)',
          fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
          display: 'flex', flexDirection: 'column', padding: '22px 26px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexShrink: 0 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em' }}>{title}</h2>
              {subtitle && <p style={{ margin: '5px 0 0', fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>{subtitle}</p>}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: '#64748b', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              {EXTENT_LIST.find(x => x.id === extent)?.label}
            </span>
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0, marginTop: 10 }}>
            {/* Fixed pixel box shared by the SVG and the symbol overlay, so the
                two coordinate spaces cannot drift apart. */}
            <div style={{ position: 'relative', width: VIEW_W, height: VIEW_H }}>
              <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width={VIEW_W} height={VIEW_H}
                   onClick={onMapClick}
                   style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}>
                {/* Sea first, then land distinctly LIGHTER on top of it, so the
                    coast reads from the tonal step rather than from the hairline
                    outline. Land stops short of white on purpose: isobars, the
                    jet and the front casings are all pale, and they have to stay
                    legible where they cross the coast. */}
                <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#071020" rx={10} />
                <g fill="#5a6883" stroke="#93a3bd" strokeWidth={0.8} strokeLinejoin="round">
                  {(geo?.paths || []).map((d, i) => <path key={i} d={d} />)}
                </g>

                {/* Isobars sit under the fronts — a front crossing an isobar
                    should read as the front continuing, not the isobar. */}
                {els.filter(e => e.kind === 'isobar').map(e => (
                  <g key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }} style={{ cursor: 'pointer' }}>
                    <Isobar points={e.points} value={e.value} dashed={e.dashed} />
                  </g>
                ))}
                {els.filter(e => e.kind === 'jet').map(e => (
                  <g key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }} style={{ cursor: 'pointer' }}>
                    <JetStream points={e.points} width={e.width} />
                  </g>
                ))}
                {els.filter(e => e.kind === 'arrow').map(e => (
                  <g key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }} style={{ cursor: 'pointer' }}>
                    <FlowArrow points={e.points} color={e.color} />
                  </g>
                ))}
                {els.filter(e => e.kind === 'front').map(e => (
                  <g key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }} style={{ cursor: 'pointer' }}>
                    <Front points={e.points} type={e.frontType} side={e.side} />
                  </g>
                ))}
                {els.filter(e => e.kind === 'pressure').map(e => (
                  <g key={e.id} onPointerDown={movePoint(e.id)}
                     onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }} style={{ cursor: 'grab' }}>
                    <PressureCentre x={e.x} y={e.y} kind={e.ctr} value={e.value} />
                  </g>
                ))}

                {/* Handles for the selected path, so it can be reshaped */}
                {selEl?.points && selEl.points.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={5.5} fill="#38bdf8" stroke="#fff" strokeWidth={1.6}
                          onPointerDown={moveHandle(selEl.id, i)} style={{ cursor: 'grab' }} />
                ))}

                {/* Draft */}
                {draft.length > 0 && (
                  <g>
                    <path d={smoothPath(draft)} fill="none" stroke="#38bdf8" strokeWidth={2} strokeDasharray="6 4" />
                    {draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="#fff" stroke="#38bdf8" strokeWidth={1.8} />)}
                  </g>
                )}
              </svg>

              {/* Weather symbols — HTML layer, same pixel box as the SVG */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {els.filter(e => e.kind === 'symbol').map(e => {
                  const Icon = weatherIcons[e.name];
                  if (!Icon) return null;
                  return (
                    <div key={e.id}
                         onPointerDown={movePoint(e.id)}
                         onClick={(ev) => { ev.stopPropagation(); setSelected(e.id); }}
                         style={{
                           position: 'absolute', left: e.x, top: e.y, width: e.size, height: e.size,
                           transform: 'translate(-50%,-50%)', pointerEvents: 'auto', cursor: 'grab',
                           filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.55))',
                         }}>
                      <Icon style={{ width: '100%', height: '100%' }} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Legend + footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, paddingTop: 11, borderTop: '1px solid rgba(148,163,184,0.2)', flexShrink: 0, flexWrap: 'wrap' }}>
            {siteLogoUrl
              ? <img src={siteLogoUrl} alt="" crossOrigin="anonymous" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#5b6ee8' }} />}
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{handle}</span>
            <div style={{ display: 'flex', gap: 14, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {Object.values(FRONT_TYPES).filter(f => els.some(e => e.kind === 'front' && e.frontType === f.id)).map(f => (
                <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 18, height: 4, borderRadius: 2, background: f.color }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>{f.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
