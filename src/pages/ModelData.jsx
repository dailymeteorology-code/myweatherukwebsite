/* Weather Model Data: every AWS-published model on the UKV 2 km grid.

   Data: Met Office UKV 2 km and Global 10 km, ECMWF IFS and AIFS, NOAA GFS — all from the
   providers' AWS open-data buckets, gridded by tools/modeldata on this server (never
   Open-Meteo). UKV is drawn cell for cell at its real 2 km; coarser models show their own
   cells. The map, title block and legend are one canvas, so a PNG or GIF export is exactly
   what is on screen. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Pause, ChevronLeft, ChevronRight, Download, Film, ImageIcon, ZoomIn, ZoomOut, Layers, Database } from 'lucide-react';
import {
  API, NX, NY, REGIONS, scaleFor, loadFrame, runTag, frameCanvas, frameContours, drawScene, fmtValue, download, makeGif,
} from '@/lib/modelViewer';

const GROUP_ORDER = ['Precipitation', 'Temperature', 'Wind & pressure', 'Cloud & visibility', 'Convection', 'Snow & ice', 'Upper air', 'Radiation & surface'];
const SIZES = { square: [1080, 1080, '1080 × 1080 (square)'], wide: [1920, 1080, '1920 × 1080 (wide)'], story: [1080, 1920, '1080 × 1920 (vertical)'], small: [720, 720, '720 × 720 (small GIF)'] };
const TOP_PAD = 0.13, FOOT_PAD = 0.15;          // share of the canvas the title band and legend take

function defaultRun(m) {
  const most = Math.max(0, ...m.runs.map((r) => r.steps.length));
  return m.runs.find((r) => r.steps.length >= 0.6 * most) || m.runs[0];
}
const runLabel = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit' }).replace(',', '') + 'Z';

const imgCache = {};
const loadImage = (src) => (imgCache[src] ||= new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));

export default function ModelData() {
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState(null);
  const [modelId, setModelId] = useState('ukv');
  const [runIso, setRunIso] = useState(null);
  const [varKey, setVarKey] = useState('precip_rate');
  const [status, setStatus] = useState(null);
  const [frames, setFrames] = useState({});             // step -> frame
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(450);              // ms per frame, for playback and the GIF
  const [smooth, setSmooth] = useState(false);
  const [showContours, setShowContours] = useState(true);
  const [showCities, setShowCities] = useState(true);
  const [view, setView] = useState(null);
  const [size, setSize] = useState(0);              // bumps when the canvas is resized (a resize clears it)
  const [hover, setHover] = useState(null);
  const [statics, setStatics] = useState(null);
  const [exp, setExp] = useState({ open: false, size: 'square', from: 0, to: null, busy: null });
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const colourCache = useRef(new Map());
  const contourCache = useRef(new Map());
  const shellRef = useRef(null);
  const [shellH, setShellH] = useState('calc(100dvh - 56px)');

  useEffect(() => {
    const measure = () => {
      const top = shellRef.current?.getBoundingClientRect().top ?? 0;
      setShellH(`calc(100dvh - 56px - ${Math.max(0, Math.round(top + window.scrollY))}px)`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /* catalogue + static map layers */
  useEffect(() => {
    let stop = false;
    const get = () => fetch(`${API}/catalog`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalogue ${r.status}`))))
      .then((c) => { if (!stop) { setCat(c); setErr(null); } })
      .catch((e) => { if (!stop) { setErr(e.message); setTimeout(get, 15000); } });
    get();
    const t = setInterval(get, 5 * 60 * 1000);
    Promise.all([loadImage(`${API}/static/basemap.png`), fetch(`${API}/static/lines.json`).then((r) => r.json()),
      fetch(`${API}/static/cities.json`).then((r) => r.json()), loadImage('/logo.png').catch(() => null)])
      .then(([basemap, lines, cities, logo]) => !stop && setStatics({ basemap, lines, cities, logo }))
      .catch(() => {});
    return () => { stop = true; clearInterval(t); };
  }, []);

  const model = cat?.models?.find((m) => m.id === modelId);
  const run = model?.runs?.find((r) => r.run === runIso) || (model?.runs?.length ? defaultRun(model) : null);
  const vmeta = cat?.variables?.[varKey];

  /* keep the variable when switching model if that model has it */
  useEffect(() => {
    if (model && !model.variables.includes(varKey)) setVarKey(model.variables.includes('precip_rate') ? 'precip_rate' : model.variables[0]);
  }, [model, varKey]);

  /* load the run's frames for this variable: the server makes them on demand */
  const key = run && model ? `${model.id}/${runTag(run.run)}/${varKey}` : null;
  useEffect(() => {
    if (!key) return undefined;
    const [m, rt, v] = key.split('/');
    const ac = new AbortController();
    const want = new Set();
    let alive = true;
    setFrames({}); setStatus(null); colourCache.current.clear(); contourCache.current.clear();
    const pull = async (step) => {
      want.add(step);
      try {
        const f = await loadFrame(m, rt, v, step, ac.signal);
        if (alive) setFrames((o) => ({ ...o, [step]: f }));
      } catch { want.delete(step); }
    };
    const poll = async () => {
      if (!alive) return;
      try {
        const st = await fetch(`${API}/frames/${m}/${rt}/${v}/status`, { signal: ac.signal }).then((r) => r.json());
        if (!alive) return;
        setStatus(st);
        const todo = (st.done || []).filter((s) => !want.has(s));
        for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(pull));
        if (st.state !== 'complete') setTimeout(poll, 1500);
      } catch { if (alive) setTimeout(poll, 3000); }
    };
    poll();
    return () => { alive = false; ac.abort(); };
  }, [key]);

  const steps = useMemo(() => {
    if (!run) return [];
    const miss = new Set(status?.missing || []);
    return run.steps.filter((s) => !miss.has(s));
  }, [run, status]);
  const step = steps[Math.min(idx, Math.max(0, steps.length - 1))];
  const frame = frames[step];
  const loadedCount = steps.filter((s) => frames[s]).length;

  useEffect(() => { setIdx(0); setPlaying(false); }, [key]);

  /* fit a region into the canvas, leaving the title band and the legend clear */
  const fit = useCallback((box) => {
    const c = canvasRef.current;
    if (!c) return;
    const W = c.width, H = c.height;
    const [x0, y0, x1, y1] = box;
    const usable = H * (1 - TOP_PAD - FOOT_PAD);
    const s = Math.min(W / (x1 - x0), usable / (y1 - y0)) * 0.98;
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - ((FOOT_PAD - TOP_PAD) * H) / 2 / s, s });
  }, []);

  /* canvas size follows its box */
  useEffect(() => {
    const el = wrapRef.current, c = canvasRef.current;
    if (!el || !c) return undefined;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
      if (w && h && (c.width !== w || c.height !== h)) {
        c.width = w; c.height = h;
        setSize((n) => n + 1);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (!view && size) fit(REGIONS.uk.box); }, [size, view, fit]);

  const chromeFor = useCallback((f) => (f && model && vmeta ? {
    variable: vmeta.label, unit: vmeta.unit, valid: f.head.valid, step: f.head.step, model: model.label,
    runLabel: `run ${runLabel(run.run)}`, scale: scaleFor(varKey), logo: statics?.logo,
    gridNote: model.id === 'ukv' ? 'UKV native 2 km grid · Met Office data via AWS' : `${model.res_km} km model on the 2 km display grid · data via AWS`,
  } : null), [model, vmeta, run, varKey, statics]);

  const layersFor = useCallback((f, pixelRatio = 1) => ({
    basemap: statics?.basemap, lines: statics?.lines, cities: showCities ? statics?.cities : null,
    data: f ? frameCanvas(f, varKey, colourCache.current) : null, smooth,
    contours: f && showContours ? frameContours(f, varKey, model?.res_km, contourCache.current) : null,
    contourLabels: true, chrome: chromeFor(f), pixelRatio,
  }), [statics, showCities, varKey, smooth, showContours, model, chromeFor]);

  /* draw */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !view || !statics) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    drawScene(c.getContext('2d'), c.width, c.height, view, layersFor(frame, dpr));
  }, [view, frame, statics, layersFor, size]);

  /* playback */
  useEffect(() => {
    if (!playing || steps.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => {
      const n = (i + 1) % steps.length;
      return frames[steps[n]] ? n : i;
    }), speed);
    return () => clearInterval(t);
  }, [playing, steps, frames, speed]);

  /* zoom, pan, hover */
  const drag = useRef(null);
  const toGrid = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect();
    const dpr = c.width / r.width;
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    return { px, py, gx: (px - c.width / 2) / view.s + view.cx, gy: (py - c.height / 2) / view.s + view.cy };
  };
  const onWheel = (e) => {
    if (!view) return;
    const { px, py, gx, gy } = toGrid(e);
    const s = Math.max(0.3, Math.min(24, view.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    const c = canvasRef.current;
    setView({ s, cx: gx - (px - c.width / 2) / s, cy: gy - (py - c.height / 2) / s });
  };
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, v: view }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => {
    if (!view) return;
    if (drag.current) {
      const c = canvasRef.current, dpr = c.width / c.getBoundingClientRect().width;
      const d = drag.current;
      setView({ ...d.v, cx: d.v.cx - ((e.clientX - d.x) * dpr) / d.v.s, cy: d.v.cy - ((e.clientY - d.y) * dpr) / d.v.s });
      return;
    }
    const { gx, gy } = toGrid(e);
    const i = Math.floor(gx), j = Math.floor(gy);
    if (!frame || i < 0 || j < 0 || i >= NX || j >= NY) { setHover(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, v: frame.table[frame.q[j * NX + i]] });
  };
  const onUp = () => { drag.current = null; };
  const zoomBy = (k) => view && setView({ ...view, s: Math.max(0.3, Math.min(24, view.s * k)) });

  /* exports: exactly the scene on screen, at a chosen size */
  const renderAt = useCallback(async (f, ctx, W, H) => {
    const c = canvasRef.current;
    const k = Math.min(W, H) / Math.min(c.width, c.height);
    drawScene(ctx, W, H, { cx: view.cx, cy: view.cy, s: view.s * k }, layersFor(f, Math.max(1, k * (Math.min(window.devicePixelRatio || 1, 2)))));
  }, [view, layersFor]);

  const fileBase = () => `MyWeatherUK_${model.id}_${runTag(run.run)}_${varKey}`;
  const exportPng = async () => {
    if (!frame) return;
    const [W, H] = SIZES[exp.size];
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    await renderAt(frame, cv.getContext('2d'), W, H);
    cv.toBlob((b) => download(b, `${fileBase()}_T${frame.head.step}.png`), 'image/png');
  };
  const gifCancel = useRef(false);
  const exportGif = async () => {
    const lo = exp.from, hi = exp.to ?? steps.length - 1;
    const list = steps.slice(lo, hi + 1).filter((s) => frames[s]);
    if (!list.length) return;
    const [W, H] = SIZES[exp.size];
    gifCancel.current = false;
    setExp((e) => ({ ...e, busy: 0 }));
    try {
      const blob = await makeGif({
        count: list.length, W, H, delayMs: speed, cancelled: () => gifCancel.current,
        render: (i, ctx) => renderAt(frames[list[i]], ctx, W, H),
        onProgress: (p) => setExp((e) => ({ ...e, busy: p })),
      });
      if (blob) download(blob, `${fileBase()}_T${list[0]}-T${list[list.length - 1]}.gif`);
    } finally {
      setExp((e) => ({ ...e, busy: null }));
    }
  };

  /* ── UI ── */
  const panel = { background: 'rgba(10,18,32,0.82)', border: '1px solid rgba(148,163,184,0.16)', borderRadius: 14, backdropFilter: 'blur(12px)' };
  const chip = (on) => ({ padding: '6px 11px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
    background: on ? 'rgba(56,189,248,0.18)' : 'rgba(148,163,184,0.06)', border: `1px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.18)'}`, color: on ? '#bae6fd' : '#94a3b8' });
  const iconBtn = { ...chip(false), padding: 7, lineHeight: 0 };
  const groups = useMemo(() => {
    if (!model || !cat) return [];
    const g = {};
    for (const k of model.variables) { const v = cat.variables[k]; if (v) (g[v.group] ||= []).push([k, v]); }
    return GROUP_ORDER.filter((n) => g[n]).map((n) => [n, g[n]]);
  }, [model, cat]);
  const pending = status && status.state !== 'complete' ? Math.max(0, steps.length - loadedCount) : 0;

  return (
    <div ref={shellRef} style={{ height: shellH, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#070d18', color: '#e2e8f0' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 10, padding: 10 }} className="flex-col lg:flex-row">
        {/* controls */}
        <aside style={{ ...panel, padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flexShrink: 0 }} className="w-full lg:w-[290px] max-h-[38vh] lg:max-h-none">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database style={{ width: 17, height: 17, color: '#38bdf8' }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>Model Data</div>
              <div style={{ fontSize: 11, color: '#7f93ab' }}>Straight from AWS · drawn on the UKV 2 km grid</div>
            </div>
          </div>
          {err && !cat && <div style={{ fontSize: 12, color: '#fca5a5' }}>{err}</div>}
          {!cat && !err && <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />Finding the latest runs…</div>}
          {cat && (
            <>
              <section>
                <Label>Model</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {cat.models.filter((m) => m.runs?.length).map((m) => (
                    <button key={m.id} onClick={() => { setModelId(m.id); setRunIso(null); }} style={{ ...chip(m.id === modelId), textAlign: 'left', padding: '7px 9px' }}>
                      <div>{m.label.replace('Met Office ', 'MO ').replace(' (AI)', '')}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.75 }}>{m.res_km === 2 ? '2 km · native' : m.id === 'mo_global' ? '10 km' : '0.25°'}</div>
                    </button>
                  ))}
                </div>
              </section>
              {model && (
                <section>
                  <Label>Run</Label>
                  <select value={run?.run || ''} onChange={(e) => setRunIso(e.target.value)} style={selectStyle}>
                    {model.runs.map((r) => <option key={r.run} value={r.run}>{runLabel(r.run)} · to T+{r.steps[r.steps.length - 1]}</option>)}
                  </select>
                  <div style={{ fontSize: 10.5, color: '#7f93ab', marginTop: 5 }}>{model.source}</div>
                </section>
              )}
              <section>
                <Label>Variable</Label>
                {groups.map(([g, list]) => (
                  <div key={g} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0' }}>{g}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {list.map(([k, v]) => <button key={k} onClick={() => setVarKey(k)} style={chip(k === varKey)}>{v.label}</button>)}
                    </div>
                  </div>
                ))}
              </section>
              <section>
                <Label>Map</Label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  <button onClick={() => setSmooth(false)} style={chip(!smooth)}>Native grid</button>
                  <button onClick={() => setSmooth(true)} style={chip(smooth)}>Smooth</button>
                  <button onClick={() => setShowContours((x) => !x)} style={chip(showContours)}>Contours</button>
                  <button onClick={() => setShowCities((x) => !x)} style={chip(showCities)}>Places</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                  {Object.entries(REGIONS).map(([k, r]) => <button key={k} onClick={() => fit(r.box)} style={chip(false)}>{r.label}</button>)}
                </div>
              </section>
            </>
          )}
        </aside>

        {/* map + timeline */}
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div ref={wrapRef} style={{ ...panel, flex: 1, minHeight: 260, position: 'relative', overflow: 'hidden', padding: 0 }}>
            <canvas ref={canvasRef} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { onUp(); setHover(null); }}
              style={{ width: '100%', height: '100%', display: 'block', cursor: drag.current ? 'grabbing' : 'crosshair', touchAction: 'none' }} />
            <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => zoomBy(1.4)} style={{ ...iconBtn, background: 'rgba(10,18,32,0.85)' }} aria-label="Zoom in"><ZoomIn style={{ width: 15, height: 15 }} /></button>
              <button onClick={() => zoomBy(1 / 1.4)} style={{ ...iconBtn, background: 'rgba(10,18,32,0.85)' }} aria-label="Zoom out"><ZoomOut style={{ width: 15, height: 15 }} /></button>
              <button onClick={() => fit(REGIONS.uk.box)} style={{ ...iconBtn, background: 'rgba(10,18,32,0.85)' }} aria-label="Reset view"><Layers style={{ width: 15, height: 15 }} /></button>
            </div>
            {hover && vmeta && (
              <div style={{ position: 'absolute', left: hover.x + 14, top: hover.y + 10, pointerEvents: 'none', ...panel, padding: '4px 9px', fontSize: 12.5, fontWeight: 800 }}>
                {fmtValue(hover.v, vmeta.unit)}
              </div>
            )}
            {(!frame || pending > 0) && key && (
              <div style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', ...panel, padding: '6px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: '#38bdf8' }} />
                {!status ? 'Starting…' : `Fetching from AWS · ${loadedCount}/${steps.length} frames`}
              </div>
            )}
          </div>

          <div style={{ ...panel, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} style={iconBtn} aria-label="Previous step"><ChevronLeft style={{ width: 15, height: 15 }} /></button>
            <button onClick={() => setPlaying((p) => !p)} style={{ ...iconBtn, ...(playing ? chip(true) : {}), padding: 7, lineHeight: 0 }} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause style={{ width: 15, height: 15 }} /> : <Play style={{ width: 15, height: 15 }} />}
            </button>
            <button onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))} style={iconBtn} aria-label="Next step"><ChevronRight style={{ width: 15, height: 15 }} /></button>
            <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.min(idx, Math.max(0, steps.length - 1))}
              onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} style={{ flex: 1, minWidth: 140, accentColor: '#38bdf8' }} aria-label="Forecast step" />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#7dd3fc', fontVariantNumeric: 'tabular-nums', minWidth: 140, textAlign: 'right' }}>
              {frame ? `${new Date(frame.head.valid).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · T+${step}` : step != null ? `T+${step}` : ''}
            </span>
            <label style={{ fontSize: 11.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
              Speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ ...selectStyle, width: 'auto', padding: '4px 6px' }}>
                {[120, 200, 300, 450, 650, 900, 1300, 2000].map((v) => <option key={v} value={v}>{(1000 / v).toFixed(v > 500 ? 1 : 0)} fps</option>)}
              </select>
            </label>
            <button onClick={() => setExp((e) => ({ ...e, open: !e.open }))} style={chip(exp.open)}><Download style={{ width: 13, height: 13, verticalAlign: '-2px', marginRight: 4 }} />Export</button>
          </div>

          {exp.open && (
            <div style={{ ...panel, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12, flexShrink: 0 }}>
              <label style={lab}>Size
                <select value={exp.size} onChange={(e) => setExp((x) => ({ ...x, size: e.target.value }))} style={{ ...selectStyle, width: 'auto' }}>
                  {Object.entries(SIZES).map(([k, [, , l]]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <button onClick={exportPng} disabled={!frame} style={chip(false)}><ImageIcon style={{ width: 13, height: 13, verticalAlign: '-2px', marginRight: 4 }} />PNG of this step</button>
              <span style={{ width: 1, height: 22, background: 'rgba(148,163,184,0.2)' }} />
              <label style={lab}>From
                <select value={exp.from} onChange={(e) => setExp((x) => ({ ...x, from: Number(e.target.value) }))} style={{ ...selectStyle, width: 'auto' }}>
                  {steps.map((s, i) => <option key={s} value={i}>T+{s}</option>)}
                </select>
              </label>
              <label style={lab}>To
                <select value={exp.to ?? steps.length - 1} onChange={(e) => setExp((x) => ({ ...x, to: Number(e.target.value) }))} style={{ ...selectStyle, width: 'auto' }}>
                  {steps.map((s, i) => <option key={s} value={i}>T+{s}</option>)}
                </select>
              </label>
              <label style={lab}>Frame time
                <input type="number" min={40} max={5000} step={10} value={speed} onChange={(e) => setSpeed(Math.max(40, Math.min(5000, Number(e.target.value) || 450)))}
                  style={{ ...selectStyle, width: 80 }} /> ms
              </label>
              {exp.busy == null
                ? <button onClick={exportGif} disabled={pending > 0} style={chip(true)}><Film style={{ width: 13, height: 13, verticalAlign: '-2px', marginRight: 4 }} />{pending > 0 ? `GIF (waiting for ${pending} frames)` : 'GIF of the run'}</button>
                : <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 140, height: 6, borderRadius: 3, background: 'rgba(148,163,184,0.2)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.round(exp.busy * 100)}%`, background: '#38bdf8' }} /></span>
                    {Math.round(exp.busy * 100)}%
                    <button onClick={() => { gifCancel.current = true; }} style={chip(false)}>Cancel</button>
                  </span>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const selectStyle = { width: '100%', background: 'rgba(15,23,42,0.9)', color: '#e2e8f0', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' };
const lab = { display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' };
function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{children}</div>;
}
