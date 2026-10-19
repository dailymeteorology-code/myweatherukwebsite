/* Weather Model Data: every AWS-published model on the UKV 2 km grid.

   Data: Met Office UKV 2 km and Global 10 km, ECMWF IFS and AIFS, NOAA GFS — from the
   providers' AWS open-data buckets, gridded by tools/modeldata on this server (never
   Open-Meteo). UKV is drawn cell for cell at its real 2 km.

   Layout: the map fills the page; the controls float over it as glass bars. The bright
   frame in the middle IS the graphic: the same renderer draws it here and into a PNG or
   GIF, so what you frame (screen, square, wide, vertical, 4:5) is what you download. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Play, Pause, ChevronLeft, ChevronRight, Download, Film, ImageIcon, ZoomIn, ZoomOut, Maximize,
  LayoutGrid, Waves, MapPin, Search, ChevronDown, X, Layers,
} from 'lucide-react';
import {
  API, NX, NY, REGIONS, MAP_STYLES, FONT, scaleFor, loadFrame, runTag, frameCanvas, frameContours, drawScene,
  realtimeBasemap, fmtValue, download, makeGif,
} from '@/lib/modelViewer';

const GROUP_ORDER = ['Precipitation', 'Temperature', 'Wind & pressure', 'Cloud & visibility', 'Convection', 'Snow & ice', 'Upper air', 'Radiation & surface'];
const FRAMES = { screen: { label: 'Fit', a: null }, square: { label: '1:1', a: 1 }, wide: { label: '16:9', a: 16 / 9 }, story: { label: '9:16', a: 9 / 16 }, portrait: { label: '4:5', a: 4 / 5 } };
const SHORT_NAMES = { ukv: 'UKV', mo_global: 'MO Global', ifs: 'ECMWF', aifs: 'AIFS', gfs: 'GFS' };

function defaultRun(m) {
  const most = Math.max(0, ...m.runs.map((r) => r.steps.length));
  return m.runs.find((r) => r.steps.length >= 0.6 * most) || m.runs[0];
}
const runLabel = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit' }).replace(',', '') + 'Z';
const imgCache = {};
const loadImage = (src) => (imgCache[src] ||= new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));

/* ── liquid glass ── */
const glass = {
  background: 'linear-gradient(140deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.09))',
  backdropFilter: 'blur(26px) saturate(185%)', WebkitBackdropFilter: 'blur(26px) saturate(185%)',
  border: '1px solid rgba(255,255,255,0.16)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(255,255,255,0.05), 0 12px 32px rgba(0,0,0,0.38)',
  color: '#f5f7fa',
};
const capsule = { ...glass, borderRadius: 999 };
const ink2 = 'rgba(240,244,250,0.62)';

function Seg({ items, value, onChange, small }) {
  return (
    <div style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 999, background: 'rgba(0,0,0,0.22)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)' }}>
      {items.map(([k, label]) => {
        const on = k === value;
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: small ? 11.5 : 12.5, fontWeight: 650, letterSpacing: '-0.01em',
            padding: small ? '5px 9px' : '6px 12px', borderRadius: 999, whiteSpace: 'nowrap', transition: 'all .18s ease',
            color: on ? '#fff' : ink2,
            background: on ? 'linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0.14))' : 'transparent',
            boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 8px rgba(0,0,0,0.25)' : 'none',
          }}>{label}</button>
        );
      })}
    </div>
  );
}
const IconBtn = ({ on, title, onClick, children, style }) => (
  <button title={title} aria-label={title} onClick={onClick} style={{
    border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center',
    color: on ? '#fff' : ink2, background: on ? 'linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0.12))' : 'rgba(0,0,0,0.18)',
    boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,0.45)' : 'inset 0 1px 2px rgba(0,0,0,0.3)', ...style,
  }}>{children}</button>
);

export default function ModelData() {
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState(null);
  const [modelId, setModelId] = useState('ukv');
  const [runIso, setRunIso] = useState(null);
  const [varKey, setVarKey] = useState('precip_rate');
  const [status, setStatus] = useState(null);
  const [frames, setFrames] = useState({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(450);
  const [smooth, setSmooth] = useState(false);
  const [showContours, setShowContours] = useState(true);
  const [showCities, setShowCities] = useState(true);
  const [style, setStyle] = useState('dark');
  const [frameKey, setFrameKey] = useState('screen');
  const [view, setView] = useState(null);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState(null);
  const [imgs, setImgs] = useState({});
  const [statics, setStatics] = useState(null);
  const [fontsOk, setFontsOk] = useState(0);
  const [varOpen, setVarOpen] = useState(false);
  const [q, setQ] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [exp, setExp] = useState({ open: false, png: 1080, gif: 720, from: 0, to: null, busy: null });
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const topRef = useRef(null);
  const botRef = useRef(null);
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

  /* the graphic's typeface, so the canvas, the PNG and the GIF all use it */
  useEffect(() => {
    if (!document.getElementById('md-inter')) {
      const l = document.createElement('link');
      l.id = 'md-inter'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap';
      document.head.appendChild(l);
    }
    Promise.all(['400', '600', '700', '800'].map((w) => document.fonts.load(`${w} 20px Inter`))).then(() => setFontsOk((n) => n + 1)).catch(() => {});
  }, []);

  /* catalogue + static layers */
  useEffect(() => {
    let stop = false;
    const get = () => fetch(`${API}/catalog`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalogue ${r.status}`))))
      .then((c) => { if (!stop) { setCat(c); setErr(null); } })
      .catch((e) => { if (!stop) { setErr(e.message); setTimeout(get, 15000); } });
    get();
    const t = setInterval(get, 5 * 60 * 1000);
    const layers = () => Promise.all([fetch(`${API}/static/lines.json`).then((r) => r.json()), fetch(`${API}/static/cities.json`).then((r) => r.json()),
      loadImage('/logo.png').catch(() => null)])
      .then(([lines, cities, logo]) => !stop && setStatics({ lines, cities, logo }))
      .catch(() => { if (!stop) setTimeout(layers, 5000); });
    layers();
    return () => { stop = true; clearInterval(t); };
  }, []);

  /* basemap images for the chosen style, loaded on demand */
  useEffect(() => {
    const need = style === 'realtime' ? ['sat_day.jpg', 'night_lights.png'] : [MAP_STYLES[style].base];
    need.forEach((f) => !imgs[f] && loadImage(`${API}/static/${f}`).then((im) => setImgs((o) => ({ ...o, [f]: im })))
      .catch(() => { delete imgCache[`${API}/static/${f}`]; setTimeout(() => setImgs((o) => ({ ...o })), 5000); }));
  }, [style, imgs]);

  const model = cat?.models?.find((m) => m.id === modelId);
  const run = model?.runs?.find((r) => r.run === runIso) || (model?.runs?.length ? defaultRun(model) : null);
  const vmeta = cat?.variables?.[varKey];

  useEffect(() => {
    if (model && !model.variables.includes(varKey)) setVarKey(model.variables.includes('precip_rate') ? 'precip_rate' : model.variables[0]);
  }, [model, varKey]);

  /* frames for this model / run / variable (made on demand on the server) */
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

  /* canvas follows the stage; the frame sits between the top and bottom bars */
  useEffect(() => {
    const el = stageRef.current, c = canvasRef.current;
    if (!el || !c) return undefined;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
      if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
      setSize((n) => n + 1);
    });
    ro.observe(el);
    if (topRef.current) ro.observe(topRef.current);
    if (botRef.current) ro.observe(botRef.current);
    return () => ro.disconnect();
  }, []);

  const frameRect = useCallback(() => {
    const c = canvasRef.current, st = stageRef.current;
    if (!c || !st) return null;
    const dpr = c.width / Math.max(1, st.clientWidth);
    const m = 12 * dpr;
    const top = ((topRef.current?.offsetHeight || 0) + 10) * dpr + m;
    const bot = ((botRef.current?.offsetHeight || 0) + 10) * dpr + m;
    const safe = { x: m, y: top, w: c.width - 2 * m, h: Math.max(80, c.height - top - bot) };
    const a = FRAMES[frameKey].a;
    if (!a) return safe;
    const w = Math.min(safe.w, safe.h * a), h = w / a;
    return { x: safe.x + (safe.w - w) / 2, y: safe.y + (safe.h - h) / 2, w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, size]);

  const fit = useCallback((box) => {
    const R = frameRect();
    if (!R) return;
    const [x0, y0, x1, y1] = box;
    const s = Math.min(R.w / (x1 - x0), (R.h * 0.8) / (y1 - y0));
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (R.h * 0.02) / s, s });
  }, [frameRect]);
  useEffect(() => { if (!view && size) fit(REGIONS.uk.box); }, [size, view, fit]);
  /* a new frame shape keeps the same area in view */
  const lastFrame = useRef(frameKey);
  useEffect(() => {
    if (lastFrame.current === frameKey || !view) { lastFrame.current = frameKey; return; }
    lastFrame.current = frameKey;
    fit(REGIONS.uk.box);
  }, [frameKey, view, fit]);

  const basemapFor = useCallback((f) => {
    if (style === 'realtime') {
      const d = imgs['sat_day.jpg'], n = imgs['night_lights.png'];
      return d && n && f ? realtimeBasemap(d, n, Date.parse(f.head.valid)) : d || null;
    }
    return imgs[MAP_STYLES[style].base] || null;
  }, [style, imgs]);

  const chromeFor = useCallback((f) => (f && model && vmeta ? {
    variable: vmeta.label, unit: vmeta.unit, valid: f.head.valid, step: f.head.step, model: model.label,
    runLabel: runLabel(run.run), scale: scaleFor(varKey), logo: statics?.logo,
    credit: model.id === 'ukv' ? 'UKV 2 km native grid · Met Office via AWS' : `${model.label} · ${model.id === 'mo_global' ? '10 km' : '0.25°'} · via AWS`,
  } : null), [model, vmeta, run, varKey, statics]);

  const layersFor = useCallback((f) => ({
    style, basemap: basemapFor(f), lines: statics?.lines, cities: showCities ? statics?.cities : null,
    data: f ? frameCanvas(f, varKey, colourCache.current) : null, smooth,
    contours: f && showContours ? frameContours(f, varKey, model?.res_km, contourCache.current) : null,
    contourLabels: true, chrome: chromeFor(f),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [style, basemapFor, statics, showCities, varKey, smooth, showContours, model, chromeFor, fontsOk]);

  /* draw: the map everywhere, dimmed outside the frame, the finished graphic inside it */
  useEffect(() => {
    const c = canvasRef.current, R = frameRect();
    if (!c || !view || !R) return;
    const ctx = c.getContext('2d');
    const full = { x: 0, y: 0, w: c.width, h: c.height };
    const L = layersFor(frame);
    ctx.clearRect(0, 0, c.width, c.height);
    drawScene(ctx, R, view, { ...L, chrome: null, cities: null, contours: null }, { clip: full });
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,12,0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    const r = 18 * (c.width / Math.max(1, stageRef.current.clientWidth));
    ctx.roundRect ? ctx.roundRect(R.x, R.y, R.w, R.h, r) : ctx.rect(R.x, R.y, R.w, R.h);
    ctx.fill('evenodd');
    ctx.restore();
    drawScene(ctx, R, view, L, { round: r });
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, r) : ctx.rect(R.x, R.y, R.w, R.h);
    ctx.stroke();
    ctx.restore();
  }, [view, frame, layersFor, frameRect]);

  /* playback */
  useEffect(() => {
    if (!playing || steps.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => {
      const n = (i + 1) % steps.length;
      return frames[steps[n]] ? n : i;
    }), speed);
    return () => clearInterval(t);
  }, [playing, steps, frames, speed]);

  /* zoom, pan, pinch, hover */
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const toGrid = (clientX, clientY) => {
    const c = canvasRef.current, rr = c.getBoundingClientRect(), R = frameRect();
    const dpr = c.width / rr.width;
    const px = (clientX - rr.left) * dpr, py = (clientY - rr.top) * dpr;
    return { px, py, R, gx: (px - (R.x + R.w / 2)) / view.s + view.cx, gy: (py - (R.y + R.h / 2)) / view.s + view.cy };
  };
  const zoomAt = (clientX, clientY, k) => {
    if (!view) return;
    const { px, py, R, gx, gy } = toGrid(clientX, clientY);
    const s = Math.max(0.3, Math.min(30, view.s * k));
    setView({ s, cx: gx - (px - (R.x + R.w / 2)) / s, cy: gy - (py - (R.y + R.h / 2)) / s });
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18); };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  });
  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = pts.length === 2
      ? { pinch: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), v: view }
      : { x: e.clientX, y: e.clientY, v: view };
  };
  const onMove = (e) => {
    if (!view) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const dpr = canvasRef.current.width / canvasRef.current.getBoundingClientRect().width;
    if (g && pointers.current.size === 2 && g.pinch) {
      const pts = [...pointers.current.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setView({ ...g.v, s: Math.max(0.3, Math.min(30, g.v.s * (d / g.pinch))) });
      return;
    }
    if (g && pointers.current.size === 1 && !g.pinch) {
      setView({ ...g.v, cx: g.v.cx - ((e.clientX - g.x) * dpr) / g.v.s, cy: g.v.cy - ((e.clientY - g.y) * dpr) / g.v.s });
      return;
    }
    const { gx, gy } = toGrid(e.clientX, e.clientY);
    const i = Math.floor(gx), j = Math.floor(gy);
    if (!frame || i < 0 || j < 0 || i >= NX || j >= NY) { setHover(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, v: frame.table[frame.q[j * NX + i]] });
  };
  const onUp = (e) => { pointers.current.delete(e.pointerId); gesture.current = null; };
  const zoomBy = (k) => { const r = canvasRef.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, k); };

  /* exports: the frame, enlarged (short side = chosen size) */
  const exportSize = (short) => {
    const R = frameRect();
    const a = R.w / R.h;
    return a >= 1 ? [Math.round(short * a / 2) * 2, short] : [short, Math.round(short / a / 2) * 2];
  };
  const renderAt = useCallback((f, ctx, W, H) => {
    const R = frameRect();
    const k = W / R.w;
    drawScene(ctx, { x: 0, y: 0, w: W, h: H }, { cx: view.cx, cy: view.cy, s: view.s * k }, layersFor(f));
  }, [view, layersFor, frameRect]);
  const fileBase = () => `MyWeatherUK_${model.id}_${runTag(run.run)}_${varKey}_${frameKey}`;
  const exportPng = () => {
    if (!frame) return;
    const [W, H] = exportSize(exp.png);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    renderAt(frame, cv.getContext('2d'), W, H);
    cv.toBlob((b) => download(b, `${fileBase()}_T${frame.head.step}.png`), 'image/png');
  };
  if (import.meta.env.DEV) window.__mdExport = (short = 1080) => { const [W, H] = exportSize(short); const cv = document.createElement('canvas'); cv.width = W; cv.height = H; renderAt(frame, cv.getContext('2d'), W, H); return cv.toDataURL('image/jpeg', 0.85); };
  const gifCancel = useRef(false);
  const exportGif = async () => {
    const lo = exp.from, hi = exp.to ?? steps.length - 1;
    const list = steps.slice(lo, hi + 1).filter((s) => frames[s]);
    if (!list.length) return;
    const [W, H] = exportSize(exp.gif);
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

  const groups = useMemo(() => {
    if (!model || !cat) return [];
    const g = {};
    const qq = q.trim().toLowerCase();
    for (const k of model.variables) {
      const v = cat.variables[k];
      if (v && (!qq || v.label.toLowerCase().includes(qq) || v.group.toLowerCase().includes(qq))) (g[v.group] ||= []).push([k, v]);
    }
    return GROUP_ORDER.filter((n) => g[n]).map((n) => [n, g[n]]);
  }, [model, cat, q]);
  const pending = status && status.state !== 'complete' ? Math.max(0, steps.length - loadedCount) : 0;
  const sel = { ...glass, appearance: 'none', borderRadius: 999, padding: '7px 30px 7px 12px', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, cursor: 'pointer', color: '#fff', background: 'rgba(0,0,0,0.22)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)' };
  const validLabel = frame ? new Date(frame.head.valid).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const varButton = (
    <button onClick={() => setVarOpen((o) => !o)} style={{ ...sel, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0, background: varOpen ? 'rgba(255,255,255,0.22)' : sel.background }}>
      {vmeta?.label || 'Variable'} <ChevronDown style={{ width: 14, height: 14, opacity: 0.7, transform: varOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
    </button>
  );
  const mapControls = (
    <>
      <Seg small items={Object.entries(MAP_STYLES).map(([k, s]) => [k, s.label])} value={style} onChange={setStyle} />
      <Seg small items={Object.entries(FRAMES).map(([k, f]) => [k, f.label])} value={frameKey} onChange={setFrameKey} />
      <div style={{ display: 'flex', gap: 6 }}>
        <IconBtn on={!smooth} title={smooth ? 'Smooth (click for the native grid)' : 'Native grid cells (click to smooth)'} onClick={() => setSmooth((x) => !x)}><LayoutGrid size={15} /></IconBtn>
        <IconBtn on={showContours} title="Contours" onClick={() => setShowContours((x) => !x)}><Waves size={15} /></IconBtn>
        <IconBtn on={showCities} title="Places" onClick={() => setShowCities((x) => !x)}><MapPin size={15} /></IconBtn>
      </div>
    </>
  );

  return (
    <div ref={shellRef} style={{ height: shellH, position: 'relative', overflow: 'hidden', fontFamily: FONT, color: '#f5f7fa',
      background: 'radial-gradient(120% 80% at 50% 0%, #142238 0%, #070c16 60%, #04070d 100%)' }}>
      <div ref={stageRef} style={{ position: 'absolute', inset: 0 }}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerLeave={(e) => { onUp(e); setHover(null); }}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' }} />
      </div>

      {/* top bar */}
      <div ref={topRef} style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
        <div className="md-noscroll" style={{ ...capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0, maxWidth: '100%', pointerEvents: 'auto' }}>
          {cat ? (
            <>
              {narrow && varButton}
              <Seg items={cat.models.filter((m) => m.runs?.length).map((m) => [m.id, SHORT_NAMES[m.id] || m.label])} value={modelId}
                onChange={(id) => { setModelId(id); setRunIso(null); }} />
              {model && (
                <div style={{ position: 'relative' }}>
                  <select value={run?.run || ''} onChange={(e) => setRunIso(e.target.value)} style={sel} title={model.source}>
                    {model.runs.map((r) => <option key={r.run} value={r.run} style={{ color: '#111' }}>{runLabel(r.run)} · T+{r.steps[r.steps.length - 1]}</option>)}
                  </select>
                  <ChevronDown style={{ position: 'absolute', right: 10, top: 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
                </div>
              )}
              {!narrow && varButton}
            </>
          ) : (
            <span style={{ padding: '6px 10px', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', color: err ? '#fca5a5' : ink2 }}>
              {!err && <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />}{err || 'Finding the latest runs…'}
            </span>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {narrow
          ? <div style={{ ...capsule, padding: 5, pointerEvents: 'auto', flexShrink: 0 }}><IconBtn on={mapOpen} title="Map, frame and layers" onClick={() => setMapOpen((o) => !o)}><Layers size={15} /></IconBtn></div>
          : <div style={{ ...capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', flexShrink: 0 }}>{mapControls}</div>}
      </div>
      {narrow && mapOpen && (
        <div style={{ ...glass, borderRadius: 24, position: 'absolute', right: 10, top: (topRef.current?.offsetHeight || 46) + 18, padding: 12, display: 'grid', gap: 10, zIndex: 6, maxWidth: 'calc(100% - 20px)' }}>
          {mapControls}
        </div>
      )}

      {/* variable picker */}
      {varOpen && cat && (
        <div style={{ ...glass, borderRadius: 24, position: 'absolute', left: 10, top: (topRef.current?.offsetHeight || 46) + 18, width: 'min(560px, calc(100% - 20px))',
          maxHeight: '62%', overflowY: 'auto', padding: 14, zIndex: 5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.25)' }}>
              <Search size={14} style={{ opacity: 0.6 }} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search variables"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontFamily: FONT, fontSize: 13 }} />
            </div>
            <IconBtn title="Close" onClick={() => setVarOpen(false)}><X size={15} /></IconBtn>
          </div>
          {groups.map(([g, list]) => (
            <div key={g} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: ink2, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '2px 4px 6px' }}>{g}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {list.map(([k, v]) => (
                  <button key={k} onClick={() => { setVarKey(k); setVarOpen(false); }} style={{
                    border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 600, padding: '7px 12px', borderRadius: 999,
                    color: k === varKey ? '#fff' : 'rgba(240,244,250,0.82)',
                    background: k === varKey ? 'linear-gradient(180deg, rgba(110,180,255,0.55), rgba(60,130,240,0.4))' : 'rgba(255,255,255,0.07)',
                    boxShadow: k === varKey ? 'inset 0 1px 0 rgba(255,255,255,0.5)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
                  }}>{v.label}</button>
                ))}
              </div>
            </div>
          ))}
          {model && <div style={{ fontSize: 11, color: ink2, margin: '4px 4px 0' }}>{model.source}</div>}
        </div>
      )}

      <style>{'.md-noscroll::-webkit-scrollbar{display:none}.md-noscroll{scrollbar-width:none}'}</style>
      {/* zoom */}
      <div className="hidden sm:flex" style={{ ...capsule, position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', padding: 5, flexDirection: 'column', gap: 5 }}>
        <IconBtn title="Zoom in" onClick={() => zoomBy(1.35)}><ZoomIn size={15} /></IconBtn>
        <IconBtn title="Zoom out" onClick={() => zoomBy(1 / 1.35)}><ZoomOut size={15} /></IconBtn>
        <IconBtn title="UK & Ireland" onClick={() => fit(REGIONS.uk.box)}><Maximize size={14} /></IconBtn>
      </div>

      {hover && vmeta && (
        <div style={{ ...capsule, position: 'absolute', left: hover.x + 14, top: hover.y + 12, pointerEvents: 'none', padding: '5px 11px', fontSize: 12.5, fontWeight: 700 }}>
          {fmtValue(hover.v, vmeta.unit)}
        </div>
      )}
      {(!frame || pending > 0) && key && (
        <div style={{ ...capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: (topRef.current?.offsetHeight || 46) + 18, padding: '6px 14px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
          {!status ? 'Starting…' : `Fetching from AWS · ${loadedCount}/${steps.length}`}
        </div>
      )}

      {/* export sheet */}
      {exp.open && (
        <div style={{ ...glass, borderRadius: 24, position: 'absolute', right: 10, bottom: (botRef.current?.offsetHeight || 56) + 18, width: 'min(380px, calc(100% - 20px))', padding: 14, display: 'grid', gap: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Export <span style={{ color: ink2, fontWeight: 500 }}>· {FRAMES[frameKey].a ? FRAMES[frameKey].label : 'as framed'} · exactly as previewed</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <Seg small items={[[1080, '1080p'], [2160, '4K']]} value={exp.png} onChange={(v) => setExp((x) => ({ ...x, png: v }))} />
            <button onClick={exportPng} disabled={!frame} style={{ ...sel, padding: '7px 14px', display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,0.18)' }}><ImageIcon size={14} />PNG of this step</button>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.12)' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ color: ink2 }}>From</span>
            <select value={exp.from} onChange={(e) => setExp((x) => ({ ...x, from: Number(e.target.value) }))} style={{ ...sel, padding: '6px 10px' }}>
              {steps.map((s, i) => <option key={s} value={i} style={{ color: '#111' }}>T+{s}</option>)}
            </select>
            <span style={{ color: ink2 }}>to</span>
            <select value={exp.to ?? steps.length - 1} onChange={(e) => setExp((x) => ({ ...x, to: Number(e.target.value) }))} style={{ ...sel, padding: '6px 10px' }}>
              {steps.map((s, i) => <option key={s} value={i} style={{ color: '#111' }}>T+{s}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ color: ink2 }}>Frame</span>
            <input type="number" min={40} max={5000} step={10} value={speed} onChange={(e) => setSpeed(Math.max(40, Math.min(5000, Number(e.target.value) || 450)))}
              style={{ ...sel, width: 84, padding: '6px 10px', cursor: 'text' }} />
            <span style={{ color: ink2 }}>ms</span>
            <Seg small items={[[540, '540p'], [720, '720p'], [1080, '1080p']]} value={exp.gif} onChange={(v) => setExp((x) => ({ ...x, gif: v }))} />
          </div>
          {exp.busy == null
            ? <button onClick={exportGif} disabled={pending > 0} style={{ ...sel, justifySelf: 'stretch', padding: '9px 14px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', background: pending > 0 ? 'rgba(255,255,255,0.08)' : 'linear-gradient(180deg, rgba(110,180,255,0.6), rgba(60,130,240,0.45))' }}>
                <Film size={14} />{pending > 0 ? `GIF — waiting for ${pending} frames` : 'GIF of the run'}
              </button>
            : <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(exp.busy * 100)}%`, background: 'linear-gradient(90deg,#7cc8ff,#3d8bff)' }} /></div>
                {Math.round(exp.busy * 100)}%
                <button onClick={() => { gifCancel.current = true; }} style={{ ...sel, padding: '5px 10px' }}>Cancel</button>
              </div>}
        </div>
      )}

      {/* timeline */}
      <div ref={botRef} style={{ ...capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 10, width: 'min(980px, calc(100% - 20px))', padding: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconBtn title="Previous step" onClick={() => setIdx((i) => Math.max(0, i - 1))}><ChevronLeft size={16} /></IconBtn>
        <IconBtn on={playing} title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} style={{ width: 38, height: 38 }}>{playing ? <Pause size={16} /> : <Play size={16} />}</IconBtn>
        <IconBtn title="Next step" onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}><ChevronRight size={16} /></IconBtn>
        <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.min(idx, Math.max(0, steps.length - 1))}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} style={{ flex: 1, minWidth: 80, accentColor: '#7cc8ff' }} aria-label="Forecast step" />
        <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', padding: '0 4px' }}>
          {validLabel}<span style={{ color: ink2, fontWeight: 600 }}>{step != null ? ` · T+${step}` : ''}</span>
        </span>
        <div style={{ position: 'relative' }} className="hidden sm:block">
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ ...sel, padding: '7px 26px 7px 10px' }} title="Playback and GIF speed">
            {[120, 200, 300, 450, 650, 900, 1300, 2000].map((v) => <option key={v} value={v} style={{ color: '#111' }}>{(1000 / v).toFixed(v > 500 ? 1 : 0)} fps</option>)}
          </select>
          <ChevronDown style={{ position: 'absolute', right: 8, top: 9, width: 13, height: 13, pointerEvents: 'none', opacity: 0.7 }} />
        </div>
        <IconBtn on={exp.open} title="Export PNG / GIF" onClick={() => setExp((e) => ({ ...e, open: !e.open }))} style={{ width: 38, height: 38 }}><Download size={16} /></IconBtn>
      </div>
    </div>
  );
}
