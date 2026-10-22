/* ════════════════════════════════════════════════════════════════════════════
   WeatherTypeMapTool — click-to-draw weather-type areas over the UK.

   Click the map to drop points; the ring closes into an area filled with the
   selected weather type. The fill is CLIPPED TO LAND via an SVG <clipPath>
   built from the coastline, so a sloppy offshore click still produces a clean
   coastal edge instead of colour bleeding into the sea. That is the whole
   reason the areas live inside <g clipPath> rather than being intersected
   against the coastline in JS — the browser does it exactly, every frame, for
   free.

   Types are user-defined: any number, any colour, solid or striped. Palettes
   save to localStorage as presets so the same scheme comes back next time
   rather than being rebuilt from memory each week.

   The header pill (likelihood + percentage) and the horizontal key at the foot
   mirror the broadcast layout this is meant to sit alongside.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import html2canvas from 'html2canvas';
import {
  Download, Loader2, Undo2, Trash2, Check, X, Plus, Pipette, Save, Map as MapIcon, Palette, PenLine,
} from 'lucide-react';
import { StudioStyles, Section, Btn, Seg, Field } from '@/components/studio/StudioUI';
import { loadSynopticGeo, MAP_EXTENTS } from '@/lib/synopticGeo';
import { smoothPath, PressureCentre, FlowArrow, StripePattern } from './synopticDraw';

const GRAPHIC_W = 760, GRAPHIC_H = 1010;
const VIEW_W = 700, VIEW_H = 760;

const PRESET_KEY = 'wxtype_presets_v1';

/* Likelihood tiers. The lime is taken from the broadcast reference; each tier
   keeps its own colour so a set of three graphics reads as a series, and every
   one is overridable from the colour row. */
const LIKELIHOODS = [
  { id: 'most', label: 'Most likely',  color: '#c8e619' },
  { id: 'less', label: 'Less likely',  color: '#c8e619' },
  { id: 'least', label: 'Least likely', color: '#c8e619' },
];

const DEFAULT_TYPES = [
  { id: 't1', name: 'Rain',          color: '#a855f7', fill: 'solid',  thickness: 6, gap: 8 },
  { id: 't2', name: 'Heavy rain',    color: '#f472b6', fill: 'stripe', thickness: 6, gap: 8 },
  { id: 't3', name: 'Showers',       color: '#7dd3fc', fill: 'stripe', thickness: 5, gap: 9 },
  { id: 't4', name: 'Dry & bright',  color: '#d1d5db', fill: 'solid',  thickness: 6, gap: 8 },
];

const uid = () => Math.random().toString(36).slice(2, 9);


export default function WeatherTypeMapTool({ siteLogoUrl = '' }) {
  const [extent, setExtent]   = useState('uk');
  const [geo, setGeo]         = useState(null);
  const [types, setTypes]     = useState(DEFAULT_TYPES);
  const [activeType, setActiveType] = useState('t1');
  const [areas, setAreas]     = useState([]);
  const [draft, setDraft]     = useState([]);            // area being drawn
  const [tool, setTool]       = useState('area');        // area | low | high | arrow
  const [symbols, setSymbols] = useState([]);
  const [arrows, setArrows]   = useState([]);
  const [arrowDraft, setArrowDraft] = useState([]);
  const [selected, setSelected]     = useState(null);    // { kind, id }

  /* Stripe overlay. Deliberately behind an arming toggle rather than being a
     property of the weather type: stripes here mean "and also this" over an
     area that already has a fill (a severe risk inside a rain area), so they
     are applied per area, by clicking the one you mean. Without the toggle a
     click would have to guess between selecting and striping. */
  const [stripeMode, setStripeMode] = useState(false);
  const [overlayColor, setOverlayColor] = useState('#ffffff');
  const [overlayThickness, setOverlayThickness] = useState(6);
  const [overlayGap, setOverlayGap] = useState(9);
  const [overlayLabel, setOverlayLabel] = useState('Risk of severe');

  const [likelihood, setLikelihood] = useState('least');
  const [likeColor, setLikeColor]   = useState('#c8e619');
  const [percent, setPercent]       = useState('20');
  const [title, setTitle]           = useState('');
  const [handle, setHandle]         = useState('@MyWeatherUK');
  const [showKey, setShowKey]       = useState(true);

  const [presets, setPresets] = useState([]);
  const [picking, setPicking] = useState(null);          // colour-reuse target
  const [busy, setBusy]       = useState(false);
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

  useEffect(() => {
    try { setPresets(JSON.parse(localStorage.getItem(PRESET_KEY)) || []); } catch { setPresets([]); }
  }, []);

  const activeDef = types.find(t => t.id === activeType) || types[0];

  /* Client coords -> view coords. The graphic is CSS-scaled to fit the panel,
     so the raw event position has to be divided back out or every click lands
     progressively further from the cursor as the panel narrows. */
  const toView = useCallback((e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const src = e.touches?.[0] || e;
    return [
      ((src.clientX - r.left) / r.width) * VIEW_W,
      ((src.clientY - r.top) / r.height) * VIEW_H,
    ];
  }, []);

  const onMapClick = (e) => {
    const p = toView(e);
    if (!p) return;
    if (tool === 'area')  setDraft(d => [...d, p]);
    if (tool === 'arrow') setArrowDraft(d => [...d, p]);
    if (tool === 'low' || tool === 'high') {
      setSymbols(s => [...s, { id: uid(), kind: tool === 'low' ? 'L' : 'H', x: p[0], y: p[1], value: '' }]);
      setTool('area');
    }
  };

  const finishArea = () => {
    if (draft.length < 3) return;
    setAreas(a => [...a, { id: uid(), typeId: activeType, points: draft }]);
    setDraft([]);
  };
  const finishArrow = () => {
    if (arrowDraft.length < 2) return;
    setArrows(a => [...a, { id: uid(), points: arrowDraft, color: '#ffffff' }]);
    setArrowDraft([]);
    setTool('area');
  };

  /* Drag a placed symbol. Pointer capture keeps the drag alive when the cursor
     leaves the small hit target, which it always does at this size. */
  const dragSymbol = (id) => (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const p = toView(ev);
      if (p) setSymbols(s => s.map(x => (x.id === id ? { ...x, x: p[0], y: p[1] } : x)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* Every colour currently on the graphic, de-duplicated. This is the reuse
     picker: pick a colour already down rather than trying to match a hex by
     eye, which is how two areas end up almost-but-not-quite the same. */
  const usedColours = useMemo(() => {
    const set = new Set([likeColor, overlayColor, ...types.map(t => t.color), ...arrows.map(a => a.color)]);
    areas.forEach(a => { if (a.overlay) set.add(a.overlay.color); });
    presets.forEach(p => p.types?.forEach(t => set.add(t.color)));
    return Array.from(set).filter(Boolean);
  }, [types, arrows, areas, likeColor, overlayColor, presets]);

  const applyPicked = (colour) => {
    if (!picking) return;
    if (picking.kind === 'type') setTypes(t => t.map(x => (x.id === picking.id ? { ...x, color: colour } : x)));
    if (picking.kind === 'like') setLikeColor(colour);
    if (picking.kind === 'overlay') setOverlayColor(colour);
    setPicking(null);
  };

  const savePreset = () => {
    const name = window.prompt('Name this palette', `Palette ${presets.length + 1}`);
    if (!name) return;
    const next = [...presets.filter(p => p.name !== name), { name, types }];
    setPresets(next);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch { /* quota */ }
  };
  const loadPreset = (name) => {
    const p = presets.find(x => x.name === name);
    if (!p) return;
    setTypes(p.types);
    setActiveType(p.types[0]?.id || '');
  };
  const deletePreset = (name) => {
    const next = presets.filter(p => p.name !== name);
    setPresets(next);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch { /* quota */ }
  };

  const addType = () => {
    const id = uid();
    setTypes(t => [...t, { id, name: `Type ${t.length + 1}`, color: '#38bdf8', fill: 'solid', thickness: 6, gap: 8 }]);
    setActiveType(id);
  };
  const updType = (id, patch) => setTypes(t => t.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const delType = (id) => {
    setTypes(t => t.filter(x => x.id !== id));
    setAreas(a => a.filter(x => x.typeId !== id));
    if (activeType === id) setActiveType(types.find(t => t.id !== id)?.id || '');
  };

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
      a.download = `weather-types-${likelihood}-${percent || '0'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } finally { setExporting(false); }
  };

  const likeLabel = LIKELIHOODS.find(l => l.id === likelihood)?.label || '';
  const usedTypes = types.filter(t => areas.some(a => a.typeId === t.id));

  return (
    <div className="sg" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StudioStyles />

      {/* ══ Controls ══ */}
      <div className="sg-controls">
        <Section id="wxt-graphic" icon={MapIcon} color="#a3c614" title="Graphic" sub={`${likeLabel}${percent ? ` · ${percent}%` : ''}`}>
          <div className="sg-grid2">
            <Field label="Map">
              <select className="sg-input" value={extent} onChange={e => setExtent(e.target.value)}>
                <option value="uk">{MAP_EXTENTS.uk.label}</option>
                <option value="uk-france">{MAP_EXTENTS['uk-france'].label}</option>
              </select>
            </Field>
            <Field label="Likelihood">
              <select className="sg-input" value={likelihood} onChange={e => setLikelihood(e.target.value)}>
                {LIKELIHOODS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Chance %"><input className="sg-input" value={percent} onChange={e => setPercent(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" /></Field>
            <Field label="Pill colour">
              <div className="sg-row" style={{ flexWrap: 'nowrap' }}>
                <input type="color" className="sg-color" value={likeColor} onChange={e => setLikeColor(e.target.value)} />
                <Btn sm on={picking?.kind === 'like'} icon={Pipette} onClick={() => setPicking({ kind: 'like' })} title="Reuse a colour already on the graphic" />
              </div>
            </Field>
          </div>
          <Field label="Strapline (optional)"><input className="sg-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Saturday afternoon" /></Field>
          <div className="sg-row">
            <Field label="Handle" style={{ flex: 1 }}><input className="sg-input" value={handle} onChange={e => setHandle(e.target.value)} /></Field>
            <Btn sm on={showKey} onClick={() => setShowKey(v => !v)}>Show key</Btn>
          </div>
          {/* Colour reuse row — appears only while picking, so it never competes
              with the normal colour inputs for attention. */}
          {picking && (
            <div className="sg-panel">
              <div className="sg-row">
                <span className="sg-note"><b>Pick a colour already in use:</b></span>
                {usedColours.map(c => (
                  <button key={c} type="button" onClick={() => applyPicked(c)} title={c} className="sg-swatch" style={{ background: c, borderRadius: 7 }} />
                ))}
                <span className="sg-grow" />
                <Btn sm icon={X} onClick={() => setPicking(null)}>Cancel</Btn>
              </div>
            </div>
          )}
        </Section>

        <Section id="wxt-types" icon={Palette} color="#38bdf8" title="Weather types" sub={`${types.length} types · ${areas.length} areas`}>
          <div className="sg-row">
            <Btn sm icon={Plus} onClick={addType}>Add</Btn>
            <Btn sm icon={Save} onClick={savePreset}>Save palette</Btn>
            {presets.length > 0 && (
              <select className="sg-input" style={{ width: 'auto', minHeight: 28, padding: '3px 8px' }} value="" onChange={e => { if (e.target.value) loadPreset(e.target.value); }}>
                <option value="">Load palette…</option>
                {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            )}
            {presets.length > 0 && (
              <select className="sg-input" style={{ width: 'auto', minHeight: 28, padding: '3px 8px' }} value="" onChange={e => { if (e.target.value) deletePreset(e.target.value); }}>
                <option value="">Delete palette…</option>
                {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            )}
          </div>
          <div className="sg-list" style={{ maxHeight: 'none' }}>
            {types.map(t => (
              <div key={t.id} className="sg-item" style={{ flexWrap: 'wrap', ...(activeType === t.id ? { borderColor: 'var(--sg-accent)' } : {}) }}>
                <Btn sm on={activeType === t.id} icon={activeType === t.id ? Check : undefined} onClick={() => setActiveType(t.id)} title="Draw with this type">{activeType === t.id ? null : 'Use'}</Btn>
                <input type="color" className="sg-color" value={t.color} onChange={e => updType(t.id, { color: e.target.value })} />
                <Btn sm icon={Pipette} onClick={() => setPicking({ kind: 'type', id: t.id })} title="Reuse a colour already on the graphic" />
                <input className="sg-input" style={{ flex: 1, minWidth: 90, minHeight: 30, padding: '4px 8px' }} value={t.name} onChange={e => updType(t.id, { name: e.target.value })} />
                <Seg value={t.fill} onChange={(v) => updType(t.id, { fill: v })} options={[['solid', 'Solid'], ['stripe', 'Stripes']]} />
                {t.fill === 'stripe' && (
                  <span className="sg-row" style={{ gap: 6 }}>
                    <span className="sg-note">Thick</span>
                    <input type="range" className="sg-range" min="2" max="16" value={t.thickness} onChange={e => updType(t.id, { thickness: Number(e.target.value) })} style={{ width: 70, accentColor: t.color }} />
                    <span className="sg-note">Gap</span>
                    <input type="range" className="sg-range" min="2" max="24" value={t.gap} onChange={e => updType(t.id, { gap: Number(e.target.value) })} style={{ width: 70, accentColor: t.color }} />
                  </span>
                )}
                <Btn sm danger icon={Trash2} onClick={() => delType(t.id)} aria-label={`Delete ${t.name}`} />
              </div>
            ))}
          </div>
        </Section>

        <Section id="wxt-draw" icon={PenLine} color="#a78bfa" title="Draw" sub={stripeMode ? 'Striping: click an area' : ({ area: 'Draw area', low: 'Place L', high: 'Place H', arrow: 'Arrow' })[tool]}>
          <div className="sg-row">
            <Seg value={tool} onChange={setTool} color="#a78bfa" options={[['area', 'Draw area'], ['low', 'Place L'], ['high', 'Place H'], ['arrow', 'Arrow']]} />
            <Btn sm on={stripeMode} color="#facc15" onClick={() => { setStripeMode(v => !v); setSelected(null); }}>{stripeMode ? 'Striping — click an area' : 'Add stripes'}</Btn>
          </div>
          {tool === 'area' && draft.length > 0 && (
            <div className="sg-row">
              <Btn sm on color="#22c55e" icon={Check} disabled={draft.length < 3} onClick={finishArea}>Finish area ({draft.length})</Btn>
              <Btn sm icon={Undo2} onClick={() => setDraft(d => d.slice(0, -1))}>Undo point</Btn>
              <Btn sm danger onClick={() => setDraft([])}>Cancel</Btn>
            </div>
          )}
          {tool === 'arrow' && arrowDraft.length > 0 && (
            <div className="sg-row">
              <Btn sm on color="#22c55e" icon={Check} disabled={arrowDraft.length < 2} onClick={finishArrow}>Finish arrow</Btn>
              <Btn sm danger onClick={() => setArrowDraft([])}>Cancel</Btn>
            </div>
          )}

          {/* Stripe settings, shown only while striping is armed so they don't
              compete with the weather-type colours the rest of the time. */}
          {stripeMode && (
            <div className="sg-panel" style={{ borderColor: 'color-mix(in srgb, #facc15 45%, transparent)' }}>
              <div className="sg-row">
                <span className="sg-note"><b>Stripe overlay</b></span>
                <input type="color" className="sg-color" value={overlayColor} onChange={e => setOverlayColor(e.target.value)} />
                <Btn sm icon={Pipette} onClick={() => setPicking({ kind: 'overlay' })} title="Reuse a colour already on the graphic" />
                <input className="sg-input" style={{ width: 150, minHeight: 30, padding: '4px 8px' }} value={overlayLabel} onChange={e => setOverlayLabel(e.target.value)} placeholder="Key label" />
              </div>
              <div className="sg-row">
                <span className="sg-note">Thickness {overlayThickness}</span>
                <input type="range" className="sg-range" min="2" max="18" value={overlayThickness} onChange={e => setOverlayThickness(Number(e.target.value))} style={{ width: 110, accentColor: overlayColor }} />
                <span className="sg-note">Gap {overlayGap}</span>
                <input type="range" className="sg-range" min="2" max="26" value={overlayGap} onChange={e => setOverlayGap(Number(e.target.value))} style={{ width: 110, accentColor: overlayColor }} />
              </div>
              <p className="sg-note">Click an area to add or remove its stripes.</p>
            </div>
          )}

          {selected?.kind === 'area' && (
            <div className="sg-panel" style={{ borderColor: 'color-mix(in srgb, var(--sg-accent) 45%, transparent)' }}>
              <div className="sg-row">
                <span className="sg-note"><b>Selected area</b></span>
                <select className="sg-input" style={{ width: 'auto', minHeight: 30, padding: '4px 8px' }} value={areas.find(a => a.id === selected.id)?.typeId || ''}
                  onChange={e => setAreas(a => a.map(x => (x.id === selected.id ? { ...x, typeId: e.target.value } : x)))}>
                  {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <Btn sm danger icon={Trash2} onClick={() => { setAreas(a => a.filter(x => x.id !== selected.id)); setSelected(null); }}>Delete</Btn>
                <span className="sg-grow" />
                <Btn sm onClick={() => setSelected(null)}>Done</Btn>
              </div>
            </div>
          )}

          <div className="sg-row">
            <Btn sm danger icon={Trash2} onClick={() => { setAreas([]); setDraft([]); setSymbols([]); setArrows([]); setArrowDraft([]); }}>Clear map</Btn>
          </div>
          <p className="sg-note">
            Click the map to drop points, then <b>Finish area</b>. Fills are clipped to the
            coastline, so colour never spills into the sea — click a little offshore and the edge still lands on the coast.
            Click a finished area to recolour or delete it. To lay stripes over an area, press <b>Add stripes</b> first, then click the area — click it again to take them off.
            {busy && <b style={{ color: 'var(--sg-amber)' }}> Loading coastline…</b>}
          </p>
        </Section>

        <Section id="wxt-export" icon={Download} color="#0ea5e9" title="Export">
          <Btn primary color="#0ea5e9" icon={exporting ? Loader2 : Download} disabled={exporting} onClick={download}>{exporting ? 'Exporting…' : 'Download PNG'}</Btn>
        </Section>
      </div>

      {/* ══ Graphic ══ */}
      <div ref={wrapRef} style={{ width: '100%', height: GRAPHIC_H * scale, display: 'flex', justifyContent: 'center' }}>
        <div ref={graphicRef} style={{
          width: GRAPHIC_W, height: GRAPHIC_H, position: 'relative', overflow: 'hidden', flexShrink: 0,
          transform: `scale(${scale})`, transformOrigin: 'top center',
          background: '#1b1b1b', borderRadius: 18,
          fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
          display: 'flex', flexDirection: 'column', padding: '26px 30px',
        }}>

          {/* Likelihood pill — split capsule, exactly the broadcast layout:
              tinted label on the left, white percentage on the right. */}
          <div style={{ display: 'flex', alignItems: 'stretch', alignSelf: 'flex-start', borderRadius: 14, overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ background: likeColor, padding: '11px 22px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 27, fontWeight: 800, color: '#111', letterSpacing: '-0.02em' }}>{likeLabel}</span>
            </div>
            <div style={{ background: '#fff', padding: '11px 22px', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 27, fontWeight: 800, color: '#111', letterSpacing: '-0.02em' }}>{percent || 0}% chance</span>
            </div>
          </div>

          {title && (
            <p style={{ margin: '14px 0 0', fontSize: 17, fontWeight: 700, color: '#e2e8f0' }}>{title}</p>
          )}

          {/* Map */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 0, marginTop: 8 }}>
            <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width={VIEW_W} height={VIEW_H}
                 onClick={onMapClick}
                 style={{
                   cursor: stripeMode ? 'cell' : (tool === 'area' || tool === 'arrow' ? 'crosshair' : 'copy'),
                   touchAction: 'none',
                 }}>
              <defs>
                {/* The land clip. Everything colour-filled goes through this, so
                    an area can never paint over the sea. */}
                <clipPath id="wxt-land"><path d={geo?.landPathD || ''} /></clipPath>
                {types.filter(t => t.fill === 'stripe').map(t => (
                  <StripePattern key={t.id} id={`wxt-stripe-${t.id}`} color={t.color}
                                 thickness={t.thickness} gap={t.gap} />
                ))}
                {/* One pattern per striped area — each carries its own colour and
                    thickness, so they cannot be shared by id. */}
                {areas.filter(a => a.overlay).map(a => (
                  <StripePattern key={a.id} id={`wxt-ov-${a.id}`} color={a.overlay.color}
                                 thickness={a.overlay.thickness} gap={a.overlay.gap} />
                ))}
              </defs>

              {/* Sea, then land. Land is deliberately much lighter than the
                  water so the coastline reads without an outline doing the work,
                  and so colour laid over it stays legible. */}
              <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#141a21" rx={10} />
              <g clipPath="url(#wxt-land)">
                <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#e6eaee" />
              </g>

              {/* Filled weather-type areas, clipped to land */}
              <g clipPath="url(#wxt-land)">
                {areas.map(a => {
                  const t = types.find(x => x.id === a.typeId);
                  if (!t) return null;
                  const d = smoothPath(a.points, true);
                  const onPick = (e) => {
                    e.stopPropagation();
                    // With the stripe toggle armed, a click paints stripes onto
                    // the area instead of selecting it — that is the whole point
                    // of arming it, and selecting as well would fight the intent.
                    if (stripeMode) {
                      setAreas(list => list.map(x => (x.id === a.id
                        ? { ...x, overlay: x.overlay ? null : { color: overlayColor, thickness: overlayThickness, gap: overlayGap } }
                        : x)));
                    } else {
                      setSelected({ kind: 'area', id: a.id });
                    }
                  };
                  return (
                    <g key={a.id}>
                      <path d={d} fill={t.fill === 'stripe' ? `url(#wxt-stripe-${t.id})` : t.color}
                            onClick={onPick} style={{ cursor: 'pointer' }} />
                      {a.overlay && (
                        <path d={d} fill={`url(#wxt-ov-${a.id})`} onClick={onPick} style={{ cursor: 'pointer' }} />
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Coast outline over the top so edges stay crisp */}
              <g fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.9} strokeLinejoin="round">
                {(geo?.paths || []).map((d, i) => <path key={i} d={d} />)}
              </g>

              {/* Selected-area highlight */}
              {selected?.kind === 'area' && (() => {
                const a = areas.find(x => x.id === selected.id);
                return a ? <path d={smoothPath(a.points, true)} fill="none" stroke="#38bdf8" strokeWidth={2.5} strokeDasharray="7 5" /> : null;
              })()}

              {/* Draft area in progress */}
              {draft.length > 0 && (
                <g>
                  <path d={smoothPath(draft, draft.length > 2)} fill={activeDef ? `${activeDef.color}55` : 'none'}
                        stroke={activeDef?.color || '#fff'} strokeWidth={2} strokeDasharray="6 4" />
                  {draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="#fff" stroke={activeDef?.color} strokeWidth={2} />)}
                </g>
              )}
              {arrowDraft.length > 0 && (
                <g>
                  <path d={smoothPath(arrowDraft)} fill="none" stroke="#fff" strokeWidth={2} strokeDasharray="6 4" />
                  {arrowDraft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="#fff" />)}
                </g>
              )}

              {arrows.map(a => <FlowArrow key={a.id} points={a.points} color={a.color} />)}

              {symbols.map(s => (
                <g key={s.id} onPointerDown={dragSymbol(s.id)} style={{ cursor: 'grab' }}>
                  <PressureCentre x={s.x} y={s.y} kind={s.kind} value={s.value} />
                </g>
              ))}
            </svg>
          </div>

          {/* Horizontal key */}
          {showKey && (usedTypes.length > 0 || areas.some(a => a.overlay)) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'center', marginTop: 10, flexShrink: 0 }}>
              {usedTypes.map(t => (
                <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 30, height: 15, borderRadius: 4, flexShrink: 0,
                    border: '1px solid rgba(255,255,255,0.35)',
                    background: t.fill === 'stripe'
                      ? `repeating-linear-gradient(45deg, ${t.color} 0 ${t.thickness}px, transparent ${t.thickness}px ${t.thickness + t.gap}px)`
                      : t.color,
                  }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{t.name}</span>
                </span>
              ))}
              {/* Striped areas get their own key entry — the stripes mean
                  something different from the fill they sit on top of. */}
              {areas.some(a => a.overlay) && overlayLabel.trim() && (() => {
                const ov = areas.find(a => a.overlay).overlay;
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 30, height: 15, borderRadius: 4, flexShrink: 0,
                      border: '1px solid rgba(255,255,255,0.35)',
                      background: `repeating-linear-gradient(45deg, ${ov.color} 0 ${ov.thickness}px, rgba(120,120,120,0.35) ${ov.thickness}px ${ov.thickness + ov.gap}px)`,
                    }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{overlayLabel}</span>
                  </span>
                );
              })()}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.14)', flexShrink: 0 }}>
            {siteLogoUrl
              ? <img src={siteLogoUrl} alt="" crossOrigin="anonymous" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 26, height: 26, borderRadius: '50%', background: likeColor }} />}
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{handle}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>Indicative areas — not a precise boundary</span>
          </div>
        </div>
      </div>

      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
