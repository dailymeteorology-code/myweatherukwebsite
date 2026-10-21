/* Lightning — every strike, live and archived.

   The strikes come from the site's own server (server/lightning), which records them around the
   clock whether or not anyone has this page open: the Met Office for the UK & Ireland (its feed
   keeps 48 hours, so gaps while the server was off are filled in) and Blitzortung everywhere else.
   The page loads the chosen window in one request, then asks every few seconds for what has
   arrived since — by arrival, so Met Office strikes that land a few minutes late are not missed.

   Layout: the map fills the screen, with glass controls floating on it — the view (UK & Ireland,
   Europe, World) and tools along the top, and along the bottom the time bar: live windows (1 h,
   3 h, today, 24 h) or any past day, replayed with a scrubber. Beside the map (below it on a
   phone) a panel with three tabs: Activity (counts, the last 24 hours in 15-minute bars, how each
   feed is doing and the keys), Warnings (the AI lightning warnings and the Met Office's), World
   (every national service's alerts).

   Layers: strikes (coloured by age), strike density, rain radar (RainViewer — the one page that
   uses it), AI warnings and their 30-minute track, Met Office warnings, worldwide alerts. Click a
   strike for its time and place; right-click (or long-press) anywhere for what is happening there;
   draw a box to count the strikes in it. Liquid glass, in the site's light and dark themes. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity, CalendarDays, Globe, Layers, Loader2, Maximize2, Minimize2, Pause, Play, Square, Undo2, Volume2, VolumeX, X, Zap, ShieldAlert,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useAuth } from '@/lib/AuthContext';
import { AGE_BANDS, DOT_COLOURS, HEAT_GRADIENT, HEAT_TICKS, makeDotLayer, makeHeatLayer, flashAt, thunder } from '@/components/lightning/strikeLayers';
import { describePlace } from '@/components/lightning/places';
import { MO_LEVEL, fetchMetOfficeWarnings, MetOfficeDetail, WORLD_SEV, WorldAlertsList, WorldAlertDetail, MapPanel } from '@/components/lightning/Alerts';
import { MO_REGION_POLYS, moNormaliseRegion } from '@/components/tcm/metOfficeRegions';
import { useAiwLive, SEV, fmtAt } from '@/components/aiw/aiwClient';
import { useAiwMapLayer, AIW_MAP_CSS } from '@/components/aiw/useAiwMapLayer';
import { ForecastSlider, ForecastBanner, AiwLegend } from '@/components/aiw/AiwMapControls';
import IssuedWarningsCentre from '@/components/aiw/IssuedWarningsCentre';
import VoiceAlerts from '@/components/aiw/VoiceAlerts';
import AiwAdminPanel from '@/components/aiw/AiwAdminPanel';
import WarningDetail from '@/components/aiw/WarningDetail';

/* the AI-warnings map layer draws with the global Leaflet */
if (typeof window !== 'undefined' && !window.L) window.L = L;

const VIEWS = { uk: { center: [54.6, -3.8], zoom: 6 }, europe: { center: [50.5, 10], zoom: 4 }, world: { center: [22, 10], zoom: 2 } };
const REGION_LABEL = { uk: 'UK & Ireland', europe: 'Europe', world: 'World' };
const WINDOWS = [{ id: '1h', label: '1 h', mins: 60 }, { id: '3h', label: '3 h', mins: 180 }, { id: 'today', label: 'Today' }, { id: '24h', label: '24 h', mins: 1440 }];
const DEFAULT_WINDOW = { uk: 'today', europe: '3h', world: '1h' };
const LAYERS = [
  { id: 'strikes', label: 'Strikes' }, { id: 'heat', label: 'Strike density' }, { id: 'radar', label: 'Rain radar' },
  { id: 'aiw', label: 'AI warnings' }, { id: 'aiwTrack', label: 'AI warnings: 30-minute track' },
  { id: 'metoffice', label: 'Met Office warnings' }, { id: 'world', label: 'Worldwide alerts' },
];
const SPEEDS = [{ id: 5, label: '5 min/s' }, { id: 15, label: '15 min/s' }, { id: 45, label: '45 min/s' }];

/* RainViewer's own colour table for scheme 6, one entry per dBZ where it changes (the key is the
   map's palette exactly), drawn at the tiles' opacity; ticks in mm/h by Marshall–Palmer. */
const RV_STOPS = [[0, '#04e9e7'], [5, '#00efe7'], [10, '#009cf7'], [15, '#0000f7'], [20, '#00ff00'], [25, '#03b703'], [30, '#087305'], [35, '#ffff00'], [40, '#ecce00'], [45, '#fe9300'], [50, '#ff0000'], [55, '#bd0000'], [61, '#ca0032'], [65, '#fe00fe'], [70, '#9c52c6'], [75, '#fefefe'], [80, '#ffffff']];
const RV_GRADIENT = `linear-gradient(90deg, ${RV_STOPS.map(([d, c], i) => `${c} ${(d / 80) * 100}%, ${c} ${((RV_STOPS[i + 1]?.[0] ?? 80) / 80) * 100}%`).join(', ')})`;
const basemap = (light) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${light ? 'World_Light_Gray_Base' : 'World_Dark_Gray_Base'}/MapServer/tile/{z}/{y}/{x}`;
const RV_TICKS = [10, 20, 30, 40, 50, 60].map((dbz) => { const r = (10 ** (dbz / 10) / 200) ** (1 / 1.6); return { dbz, mm: r < 1 ? r.toFixed(1) : r < 10 ? r.toFixed(0) : String(Math.round(r / 5) * 5) }; });

/* ── preferences ──────────────────────────────────────────────────────────── */
const PREFS_KEY = 'lx_prefs_v1';
const DEFAULT_PREFS = { region: 'uk', layers: ['strikes', 'heat', 'aiw', 'aiwTrack'], colour: 'age', uk: 'mo', sound: false, windows: DEFAULT_WINDOW };
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p) return { ...DEFAULT_PREFS, ...p, windows: { ...DEFAULT_WINDOW, ...(p.windows || {}) } };
    const old = localStorage.getItem('tcm_region');                     // the page's previous setting
    if (['uk', 'europe', 'world'].includes(old)) return { ...DEFAULT_PREFS, region: old };
  } catch { /* defaults */ }
  return { ...DEFAULT_PREFS };
}

/* ── time ─────────────────────────────────────────────────────────────────── */
const ukFmt = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o });
function ukMidnight(ms = Date.now()) {
  const p = Object.fromEntries(ukFmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return ms - ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 - (ms % 1000);
}
const hhmm = (ms) => ukFmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const hhmmss = (ms) => ukFmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const dayLabel = (day) => ukFmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00Z`));
const shortDay = (day) => ukFmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`));
function ago(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min ago`;
}
const fmtN = (n) => (n == null ? '—' : n.toLocaleString('en-GB'));
const windowStart = (win, now = Date.now()) => (win === 'today' ? ukMidnight(now) : now - (WINDOWS.find((w) => w.id === win)?.mins || 60) * 60000);
function toStrikes(flat) {
  const out = new Array(flat.length / 4);
  for (let i = 0, j = 0; i < flat.length; i += 4, j += 1) out[j] = { time: flat[i], lat: flat[i + 1], lon: flat[i + 2], src: flat[i + 3] };
  return out;
}

/** Ticks once a second, for "x s ago" labels, without re-rendering the whole page. */
function Ago({ t, prefix = '' }) {
  const [, setN] = useState(0);
  useEffect(() => { const id = setInterval(() => setN((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  return <>{prefix}{ago(t)}</>;
}

/* ── the 24-hour activity chart ───────────────────────────────────────────── */
function ActivityChart({ bins, binStart, binMinutes = 15, from }) {
  const [hover, setHover] = useState(null);
  if (!bins?.length) return null;
  const max = Math.max(1, ...bins);
  const W = 288, H = 74;
  const bw = W / bins.length;
  return (
    <div className="lx-chart">
      <svg viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" role="img" aria-label="Strikes in each 15 minutes over the last 24 hours"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.min(bins.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * bins.length)))); }}>
        {[0.5, 1].map((f) => <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="lx-grid" />)}
        {bins.map((v, i) => {
          const t = binStart + i * binMinutes * 60000;
          const h = v ? Math.max(1.5, (Math.sqrt(v) / Math.sqrt(max)) * H) : 0;
          return <rect key={i} x={i * bw + 0.3} y={H - h} width={Math.max(0.6, bw - 0.6)} height={h} rx="0.8"
            className={`lx-bar${from && t + binMinutes * 60000 > from ? ' in' : ''}${hover === i ? ' on' : ''}`} />;
        })}
        {[0, 24, 48, 72].map((i) => <text key={i} x={i * bw + 1} y={H + 11} className="lx-axis">{hhmm(binStart + i * binMinutes * 60000)}</text>)}
        <text x={W - 1} y={H + 11} textAnchor="end" className="lx-axis">now</text>
      </svg>
      <div className="lx-chart-tip">
        {hover != null ? <><b>{fmtN(bins[hover])}</b> strikes, {hhmm(binStart + hover * binMinutes * 60000)}–{hhmm(binStart + (hover + 1) * binMinutes * 60000)}</>
          : <>Peak <b>{fmtN(max === 1 && !bins.some(Boolean) ? 0 : max)}</b> in 15 minutes · bars on a square-root scale</>}
      </div>
    </div>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */
export default function Lightning() {
  const { isDark } = useTheme();
  const light = !isDark;
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';

  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* fine */ } }, [prefs]);
  const set = (patch) => setPrefs((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) }));
  const region = prefs.region;
  const on = (id) => prefs.layers.includes(id);
  const radarOn = on('radar'), moOn = on('metoffice'), worldOn = on('world');
  const toggleLayer = (id) => set((p) => ({ layers: p.layers.includes(id) ? p.layers.filter((x) => x !== id) : [...p.layers, id] }));

  /* what is on the map: live (a window ending now) or a past day being replayed */
  const [mode, setMode] = useState({ kind: 'live' });
  const win = prefs.windows[region] || DEFAULT_WINDOW[region];
  const [replay, setReplay] = useState({ t: null, playing: false, speed: 15 });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [shown, setShown] = useState({ count: 0, from: null, to: null, thinned: 0 });
  const [summary, setSummary] = useState(null);
  const [days, setDays] = useState(null);
  const [daysOpen, setDaysOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [tab, setTab] = useState('activity');
  const [full, setFull] = useState(false);
  const [boxMode, setBoxMode] = useState(false);
  const [boxResult, setBoxResult] = useState(null);
  const [panel, setPanel] = useState(null);
  const [world, setWorld] = useState(null);
  const [worldLoading, setWorldLoading] = useState(false);
  const [worldDetail, setWorldDetail] = useState(null);
  const [moList, setMoList] = useState([]);
  const [lastLive, setLastLive] = useState(null);

  const mapEl = useRef(null);
  const stageEl = useRef(null);
  const map = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const tiles = useRef(null);
  const dots = useRef(null);
  const heat = useRef(null);
  const groups = useRef({});
  const warnRenderer = useRef(null);
  const strikes = useRef([]);
  const cursor = useRef(0);
  const audio = useRef(null);
  const lastThunder = useRef(0);
  const live = useRef({});
  live.current = { region, uk: prefs.uk, mode, win, sound: prefs.sound, colour: prefs.colour, light, replayT: replay.t, strikesOn: on('strikes') };

  /* ── the map ── */
  useEffect(() => {
    if (!mapEl.current || map.current) return undefined;
    const v = VIEWS[live.current.region];
    const m = L.map(mapEl.current, { center: v.center, zoom: v.zoom, zoomControl: false, attributionControl: false, preferCanvas: true, worldCopyJump: true, minZoom: 2 });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.control.attribution({ position: 'bottomleft', prefix: '' })
      .addAttribution('© Esri · Lightning: Met Office, Blitzortung.org · Radar: RainViewer').addTo(m);
    tiles.current = L.tileLayer(basemap(live.current.light), { maxZoom: 18, detectRetina: false }).addTo(m);
    const wp = m.createPane('warningsPane');
    wp.style.zIndex = 650;
    warnRenderer.current = L.canvas({ pane: 'warningsPane' });
    groups.current = {
      radar: L.layerGroup(), mo: L.layerGroup().addTo(m), world: L.layerGroup().addTo(m),
      flash: L.layerGroup().addTo(m), box: L.layerGroup().addTo(m),
    };
    heat.current = makeHeatLayer(L);
    dots.current = makeDotLayer(L, () => {
      const s = live.current;
      const ref = s.mode.kind === 'day' ? (s.replayT ?? Date.now()) : Date.now();
      return { colour: s.colour, light: s.light, ref, cutoff: s.mode.kind === 'day' ? s.replayT : null };
    }, (strike) => {
      const s = live.current;
      const ref = s.mode.kind === 'day' ? s.replayT : Date.now();
      const mins = Math.round((ref - strike.time) / 60000);
      L.popup({ className: 'lx-popup', maxWidth: 260 }).setLatLng([strike.lat, strike.lon]).setContent(
        `<b>${hhmmss(strike.time)}</b> <span>${mins < 1 ? 'just now' : mins < 120 ? `${mins} min ${s.mode.kind === 'day' ? 'before' : 'ago'}` : ''}</span>`
        + `<p>${describePlace(strike.lat, strike.lon)}</p><em>${strike.src === 1 ? 'Met Office' : 'Blitzortung'} · ${strike.lat.toFixed(3)}, ${strike.lon.toFixed(3)}</em>`,
      ).openOn(m);
    });
    m.on('contextmenu', (e) => setPanel({ kind: 'here', lat: e.latlng.lat, lon: e.latlng.lng }));
    map.current = m;
    setMapReady(true);
    return () => { m.remove(); map.current = null; setMapReady(false); };
  }, []);

  /* basemap follows the theme */
  useEffect(() => {
    if (!tiles.current) return;
    tiles.current.setUrl(basemap(light));
    dots.current?.redraw();
  }, [light, mapReady]);

  /* layers on and off */
  useEffect(() => {
    const m = map.current; if (!m) return;
    const show = (layer, yes) => { if (yes && !m.hasLayer(layer)) layer.addTo(m); if (!yes && m.hasLayer(layer)) m.removeLayer(layer); };
    show(dots.current, on('strikes'));
    show(heat.current, on('heat'));
    show(groups.current.radar, on('radar') && mode.kind === 'live');
  }, [prefs.layers, mode.kind, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dots.current?.redraw(); }, [prefs.colour]);

  /* the view */
  const firstView = useRef(true);
  useEffect(() => {
    if (!map.current) return;
    if (firstView.current) { firstView.current = false; return; }
    const v = VIEWS[region];
    map.current.flyTo(v.center, v.zoom, { duration: 0.9 });
  }, [region, mapReady]);
  /* Full screen. The map always fills the window at once (fixed, its section lifted above the site's
     bars — it used to stay inside a stacking layer below the top bar, which then covered the map's
     own controls, the way back out among them), and where the browser allows it, its own full
     screen is added on top. Leaving that (Esc, or the browser's own control) leaves ours too —
     unless the browser dropped it straight away, as some embedded views and phones do, in which case
     the window-filling version simply stays. */
  const realFs = useRef(0);                     // when the browser's full screen was entered (0 = not)
  const toggleFull = () => {
    if (!full) {
      setFull(true);
      const el = stageEl.current;
      if (el?.requestFullscreen && document.fullscreenEnabled) {
        el.requestFullscreen().then(() => { realFs.current = Date.now(); }).catch(() => { /* window-filling only */ });
      }
    } else {
      realFs.current = 0;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* already out */ });
      setFull(false);
    }
  };
  useEffect(() => {
    const sync = () => {
      if (document.fullscreenElement) return;
      if (realFs.current && Date.now() - realFs.current > 1000) setFull(false);
      realFs.current = 0;
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => { setTimeout(() => map.current?.invalidateSize(), 80); }, [full]);
  useEffect(() => {
    if (!full) return undefined;
    const k = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', k);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';                       // no page scrolling behind it
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = overflow; };
  }, [full]);

  /* ── loading a window or a day ── */
  const loadToken = useRef(0);
  const load = useCallback(async () => {
    const token = ++loadToken.current;
    const s = live.current;
    setLoading(true); setLoadError(null);
    try {
      const q = new URLSearchParams({ region: s.region, uk: s.uk });
      if (s.mode.kind === 'day') q.set('day', s.mode.day);
      else { q.set('from', String(windowStart(s.win))); q.set('to', String(Date.now() + 120000)); }
      const r = await fetch(`/api/lightning/strikes?${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (token !== loadToken.current) return;
      const list = toStrikes(j.strikes);
      strikes.current = list;
      cursor.current = j.seq || 0;
      dots.current?.setStrikes(list);
      heat.current?.setStrikes(list.slice());
      setShown({ count: list.length, from: j.from, to: j.to, thinned: j.thinned });
      if (s.mode.kind === 'day') {
        setReplay((rp) => ({ ...rp, t: j.to, playing: false }));
        if (heat.current) { heat.current.cutoff = null; }
      }
    } catch (e) {
      if (token === loadToken.current) setLoadError(e.message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);
  useEffect(() => { if (mapReady) load(); }, [mapReady, region, prefs.uk, mode.kind, mode.day, win, load]);

  /* ── live: what has arrived since, every 3 seconds ── */
  useEffect(() => {
    if (mode.kind !== 'live' || !mapReady) return undefined;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden || !cursor.current) return;
      busy = true;
      try {
        const s = live.current;
        const r = await fetch(`/api/lightning/live?after=${cursor.current}&region=${s.region}&uk=${s.uk}`);
        const j = await r.json();
        if (j.reset) { load(); return; }
        cursor.current = j.seq;
        setLastLive(Date.now());
        if (!j.strikes.length) return;
        const from = windowStart(s.win);
        const fresh = toStrikes(j.strikes).filter((x) => x.time >= from).sort((a, b) => a.time - b.time);
        if (!fresh.length) return;
        strikes.current.push(...fresh);
        dots.current?.addStrikes(fresh);
        heat.current?.addStrikes(fresh);
        setShown((sh) => ({ ...sh, count: strikes.current.length, to: Date.now() }));
        // a ring where each new strike lands, and thunder for one in view
        const m = map.current, b = m?.getBounds();
        let inView = false;
        for (const x of fresh) {
          if (Date.now() - x.time > 180e3 || !b?.contains([x.lat, x.lon])) continue;
          inView = true;
          if (s.strikesOn) flashAt(L, groups.current.flash, x.lat, x.lon);
        }
        if (inView && s.sound && Date.now() - lastThunder.current > 1500) { lastThunder.current = Date.now(); thunder(audio); }
      } catch { /* next tick */ } finally { busy = false; }
    };
    const id = setInterval(tick, 3000);
    // a rolling window moves on; "today" starts again at midnight
    const roll = setInterval(() => {
      const s = live.current;
      const from = windowStart(s.win);
      if (s.win === 'today' && shown.from && from > shown.from + 3600e3) { load(); return; }
      if (strikes.current.length && strikes.current[0].time < from) {
        strikes.current = strikes.current.filter((x) => x.time >= from);
        dots.current?.dropBefore(from); heat.current?.dropBefore(from);
        setShown((sh) => ({ ...sh, count: strikes.current.length, from }));
      }
      dots.current?.redraw();                                            // ages move on
    }, 30000);
    return () => { clearInterval(id); clearInterval(roll); };
  }, [mode.kind, mapReady, load, shown.from]);
  useEffect(() => () => { try { audio.current?.close(); } catch { /* closed */ } }, []);

  /* ── replaying a past day ── */
  useEffect(() => {
    if (mode.kind !== 'day') return;
    dots.current?.redraw();
    if (heat.current) { heat.current.cutoff = replay.t; heat.current._schedule(); }
  }, [replay.t, mode.kind]);
  useEffect(() => {
    if (mode.kind !== 'day' || !replay.playing) return undefined;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000; last = now;
      setReplay((rp) => {
        const t = (rp.t ?? shown.from) + dt * rp.speed * 60000;
        if (t >= shown.to) return { ...rp, t: shown.to, playing: false };
        return { ...rp, t };
      });
    }, 100);
    return () => clearInterval(id);
  }, [mode.kind, replay.playing, shown.from, shown.to]);
  const replayCount = useMemo(() => {
    if (mode.kind !== 'day' || replay.t == null) return shown.count;
    const a = strikes.current; let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].time <= replay.t) lo = mid + 1; else hi = mid; }
    return lo;
  }, [mode.kind, replay.t, shown.count]);

  /* ── the counts, every 15 seconds ── */
  useEffect(() => {
    let stop = false;
    const get = async () => {
      try { const r = await fetch(`/api/lightning/summary?uk=${prefs.uk}`); const j = await r.json(); if (!stop) setSummary(j); } catch { /* keep the last */ }
    };
    get();
    const id = setInterval(() => { if (!document.hidden) get(); }, 15000);
    return () => { stop = true; clearInterval(id); };
  }, [prefs.uk]);

  const openDays = async () => {
    setDaysOpen((o) => !o);
    try { const r = await fetch(`/api/lightning/days?n=30&uk=${prefs.uk}`); setDays((await r.json()).days || []); } catch { setDays([]); }
  };
  useEffect(() => {
    if (!daysOpen || !days?.some((d) => d.pending)) return undefined;
    const id = setTimeout(async () => { try { const r = await fetch(`/api/lightning/days?n=30&uk=${prefs.uk}`); setDays((await r.json()).days || []); } catch { /* later */ } }, 2500);
    return () => clearTimeout(id);
  }, [daysOpen, days, prefs.uk]);

  /* ── rain radar (live only; RainViewer keeps two hours) ── */
  useEffect(() => {
    if (!mapReady || !radarOn) return undefined;
    let stop = false;
    const get = async () => {
      try {
        const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
        const f = j?.radar?.past?.at(-1);
        if (!f || stop) return;
        const hi = (window.devicePixelRatio || 1) >= 1.5;
        groups.current.radar.clearLayers();
        L.tileLayer(`https://tilecache.rainviewer.com${f.path}/${hi ? 512 : 256}/{z}/{x}/{y}/6/1_1.png`, {
          opacity: 0.6, tileSize: hi ? 512 : 256, zoomOffset: hi ? -1 : 0, maxNativeZoom: 7, maxZoom: 18, updateWhenZooming: false,
        }).addTo(groups.current.radar);
      } catch { /* try again in ten minutes */ }
    };
    get();
    const id = setInterval(get, 10 * 60e3);
    return () => { stop = true; clearInterval(id); };
  }, [radarOn, mapReady]);

  /* ── Met Office warnings ── */
  useEffect(() => {
    const g = groups.current.mo;
    if (!mapReady || !moOn) { g?.clearLayers(); setMoList([]); return undefined; }
    let stop = false;
    const draw = async () => {
      const list = (await fetchMetOfficeWarnings()).filter((w) => !w.validTo || Date.parse(w.validTo) > Date.now());
      if (stop) return;
      g.clearLayers();
      setMoList(list);
      for (const w of list) {
        const future = w.validFrom && Date.parse(w.validFrom) > Date.now();
        const cfg = MO_LEVEL[future ? 'Future' : w.severity] || MO_LEVEL.Yellow;
        const open = () => setPanel({ kind: 'mo', w, accent: cfg.color });
        const style = { color: cfg.color, weight: cfg.weight, opacity: 0.95, fillColor: cfg.color, fillOpacity: cfg.fillOpacity, dashArray: cfg.dash || undefined };
        const geom = w.geometry || w.area_drawing;
        if (geom && ['Polygon', 'MultiPolygon', 'Feature', 'GeometryCollection'].includes(geom.type)) {
          try { L.geoJSON(geom, { pane: 'warningsPane', renderer: warnRenderer.current, style }).on('click', open).addTo(g); continue; } catch { /* regions instead */ }
        }
        // no shape: the coarse regions, dashed, so it is plain the area is approximate
        for (const name of new Set((Array.isArray(w.regions) ? w.regions : [w.region || 'UK']).map(moNormaliseRegion).filter(Boolean))) {
          const poly = MO_REGION_POLYS[name];
          if (poly) L.polygon(poly, { ...style, weight: 1.4, dashArray: '6, 5', fillOpacity: cfg.fillOpacity * 0.5, pane: 'warningsPane', renderer: warnRenderer.current }).on('click', open).addTo(g);
        }
      }
    };
    draw();
    const id = setInterval(draw, 10 * 60e3);
    return () => { stop = true; clearInterval(id); };
  }, [moOn, mapReady]);

  /* ── worldwide alerts ── */
  useEffect(() => {
    if (!worldOn) { groups.current.world?.clearLayers(); return undefined; }
    let stop = false;
    const get = async () => {
      setWorldLoading(true);
      try { const j = await (await fetch('/api/world-warnings')).json(); if (!stop) setWorld(j); } catch { if (!stop) setWorld({ warnings: [], counts: { total: 0, drawn: 0 } }); }
      if (!stop) setWorldLoading(false);
    };
    get();
    const id = setInterval(get, 10 * 60e3);
    return () => { stop = true; clearInterval(id); };
  }, [worldOn]);
  const openWorld = useCallback(async (w) => {
    const colour = (WORLD_SEV[w.severity] || WORLD_SEV.Unknown).color;
    setPanel({ kind: 'world', w, accent: colour });
    setWorldDetail(null);
    if (w.geometry && map.current) { try { map.current.flyToBounds(L.geoJSON(w.geometry).getBounds(), { padding: [40, 40], maxZoom: 7, duration: 0.9 }); } catch { /* no bounds */ } }
    try { setWorldDetail(await (await fetch(`/api/world-warnings/cap?u=${encodeURIComponent(w.capUrl)}`)).json()); } catch { setWorldDetail({ ok: false }); }
  }, []);
  useEffect(() => {
    const g = groups.current.world;
    if (!g) return;
    g.clearLayers();
    if (!worldOn || !world?.warnings?.length) return;
    for (const w of world.warnings) {
      if (!w.geometry) continue;
      const colour = (WORLD_SEV[w.severity] || WORLD_SEV.Unknown).color;
      try { L.geoJSON(w.geometry, { pane: 'warningsPane', renderer: warnRenderer.current, style: { color: colour, weight: 1.5, opacity: 0.9, fillColor: colour, fillOpacity: 0.2 } }).on('click', () => openWorld(w)).addTo(g); } catch { /* bad shape */ }
    }
  }, [world, worldOn, mapReady, openWorld]);

  /* ── AI lightning warnings ── */
  const aiw = useAiwLive({ includeTest: !!isAdmin });
  const [aiwLead, setAiwLead] = useState(0);
  const [aiwPlaying, setAiwPlaying] = useState(false);
  const [aiwSelected, setAiwSelected] = useState(null);
  const [aiwKey, setAiwKey] = useState(0);
  const aiwActive = useRef([]);
  aiwActive.current = aiw.active;
  useEffect(() => aiw.subscribe((m) => { if (m.type === 'cycle') setAiwKey((k) => k + 1); }), [aiw.subscribe]); // eslint-disable-line react-hooks/exhaustive-deps
  useAiwMapLayer({
    map: mapReady ? map.current : null, renderer: warnRenderer.current, warnings: aiw.active,
    showAreas: on('aiw'), showTracks: on('aiwTrack'), lead: aiwLead, selectedId: aiwSelected,
    onSelect: (w) => { setAiwSelected(w.id); setPanel({ kind: 'aiw', w }); }, lightMode: light,
  });
  const inRegion = (w) => (region === 'world' ? true : region === 'europe' ? (w.continents || []).includes('Europe')
    : (w.countryCodes || []).some((c) => ['GB', 'IE', 'IM', 'JE', 'GG'].includes(c)));
  const aiwCount = aiw.active.filter((w) => !w.isTest && inRegion(w)).length;
  const showAiw = useCallback((w) => {
    if (!w) return;
    setAiwSelected(w.id); setAiwLead(0);
    set((p) => (p.layers.includes('aiw') ? {} : { layers: [...p.layers, 'aiw'] }));
    setPanel({ kind: 'aiw', w: aiwActive.current.find((x) => x.id === w.id) || w });
  }, []);
  const showAiwById = useCallback((id) => showAiw(aiwActive.current.find((x) => x.id === id)), [showAiw]);
  useEffect(() => {                                                       // keep an open warning current
    if (panel?.kind !== 'aiw') return;
    const cur = aiw.active.find((x) => x.id === panel.w.id);
    if (cur && cur.updatedAt !== panel.w.updatedAt) setPanel({ kind: 'aiw', w: cur });
  }, [aiw.active]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── count the strikes in a box ── */
  useEffect(() => {
    const m = map.current;
    if (!m || !boxMode) return undefined;
    m.dragging.disable();
    m.getContainer().style.cursor = 'crosshair';
    let start = null, rect = null;
    const down = (e) => { start = e.latlng; groups.current.box.clearLayers(); rect = L.rectangle([start, start], { color: '#38bdf8', weight: 1.5, fillOpacity: 0.08, dashArray: '5 4', interactive: false }).addTo(groups.current.box); };
    const move = (e) => { if (start && rect) rect.setBounds([start, e.latlng]); };
    const up = (e) => {
      if (!start) return;
      const b = L.latLngBounds(start, e.latlng); start = null;
      const cut = live.current.mode.kind === 'day' ? live.current.replayT : Infinity;
      let n = 0;
      for (const x of strikes.current) if (x.time <= cut && b.contains([x.lat, x.lon])) n += 1;
      setBoxResult({ count: n, km2: Math.round(((b.getNorth() - b.getSouth()) * 111) * ((b.getEast() - b.getWest()) * 111 * Math.cos((b.getCenter().lat * Math.PI) / 180))) });
    };
    m.on('mousedown', down); m.on('mousemove', move); m.on('mouseup', up);
    return () => {
      m.off('mousedown', down); m.off('mousemove', move); m.off('mouseup', up);
      m.dragging.enable(); m.getContainer().style.cursor = '';
      groups.current.box.clearLayers();
    };
  }, [boxMode]);

  /* ── what is happening at a point (right-click / long-press) ── */
  const here = useMemo(() => {
    if (panel?.kind !== 'here') return null;
    const { lat, lon } = panel;
    const ref = mode.kind === 'day' ? replay.t : Date.now();
    let near = null, best = Infinity, n20 = 0;
    const k = Math.cos((lat * Math.PI) / 180);
    for (const x of strikes.current) {
      if (x.time > ref || ref - x.time > 30 * 60e3) continue;
      const d = Math.hypot(x.lat - lat, (x.lon - lon) * k) * 111;
      if (d < 20) n20 += 1;
      if (d < best) { best = d; near = x; }
    }
    const inside = (g) => { try { let hit = false; L.geoJSON(g).eachLayer((l) => { if (l.getBounds().contains([lat, lon])) hit = true; }); return hit; } catch { return false; } };
    const nowW = aiw.active.find((w) => inside(w.geometry));
    const soon = !nowW && aiw.active.map((w) => ({ w, f: (w.forecast || []).find((f) => inside(f.geometry)) })).find((x) => x.f);
    return { lat, lon, place: describePlace(lat, lon), near, km: near ? Math.round(best) : null, n20, nowW, soon };
  }, [panel, aiw.active, mode.kind, replay.t]);

  /* ── what the time bar does ── */
  const goLive = () => { setMode({ kind: 'live' }); setReplay((r) => ({ ...r, playing: false, t: null })); };
  const pickDay = (day) => { setDaysOpen(false); setMode({ kind: 'day', day }); };
  const pickWindow = (id) => { set((p) => ({ windows: { ...p.windows, [region]: id } })); if (mode.kind !== 'live') goLive(); };
  const pickRegion = (r) => { set({ region: r }); setPanel(null); };

  const g = summary?.regions?.[region];
  const feeds = summary?.feeds;
  const others = Object.keys(REGION_LABEL).filter((r) => r !== region);
  const isLiveFeed = feeds?.blitzortung?.status === 'live' || feeds?.metoffice?.status === 'live';
  const capturedHours = feeds?.blitzortung?.hours?.reduce((a, b) => a + b, 0) ?? null;

  return (
    <div className={`lx-page${light ? ' lx-light' : ''}${full ? ' is-full' : ''}`}>
      <style>{CSS + AIW_MAP_CSS}</style>
      <div className="lx-ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="lx-shell">
        {/* ── the map ── */}
        <section ref={stageEl} className={`lx-stage${full ? ' is-full' : ''}`} aria-label="Lightning map">
          <div ref={mapEl} className="lx-map" />

          <div className="lx-top">
            <div className="lx-brand lx-glass">
              <span className="lx-bolt"><Zap size={15} /></span>
              <b>Lightning</b>
              <span className={`lx-live${mode.kind === 'live' && isLiveFeed ? ' is-on' : ''}`}>{mode.kind === 'live' ? (isLiveFeed ? 'Live' : 'Connecting') : 'Replay'}</span>
            </div>
            <div className="lx-seg lx-glass" role="tablist" aria-label="View">
              {Object.entries(REGION_LABEL).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={region === id} onClick={() => pickRegion(id)}>{label}</button>
              ))}
            </div>
            <div className="lx-tools">
              <button type="button" className={`lx-icon lx-glass${layersOpen ? ' is-on' : ''}`} onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} title="Layers"><Layers size={16} /><span>Layers</span></button>
              <button type="button" className={`lx-icon lx-glass${boxMode ? ' is-on' : ''}`} onClick={() => { setBoxMode((b) => !b); setBoxResult(null); }} title="Count the strikes in an area"><Square size={15} /><span>Count</span></button>
              <button type="button" className={`lx-icon lx-glass${prefs.sound ? ' is-on' : ''}`} onClick={() => set((p) => ({ sound: !p.sound }))} title={prefs.sound ? 'Thunder on' : 'Thunder off'} aria-pressed={prefs.sound}>{prefs.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
              <button type="button" className={`lx-icon lx-glass${full ? ' lx-exit' : ''}`} onClick={toggleFull} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
                {full ? <><Minimize2 size={16} /><span>Exit full screen</span></> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>

          {layersOpen && (
            <div className="lx-pop lx-layers lx-glass" onWheel={(e) => e.stopPropagation()}>
              <div className="lx-pop-head"><b>Layers</b><button type="button" onClick={() => setLayersOpen(false)} aria-label="Close"><X size={14} /></button></div>
              {LAYERS.map((l) => (
                <label key={l.id} className="lx-switch">
                  <span>{l.label}{l.id === 'radar' && mode.kind === 'day' && <em> · live only</em>}</span>
                  <input type="checkbox" checked={on(l.id)} onChange={() => toggleLayer(l.id)} /><i />
                </label>
              ))}
              <p className="lx-pop-label">Strike colour</p>
              <div className="lx-swatches">
                {DOT_COLOURS.map((c) => (
                  <button key={c.id} type="button" aria-pressed={prefs.colour === c.id} onClick={() => set({ colour: c.id })} title={c.label}
                    style={{ background: c.hex || 'linear-gradient(135deg,#fff,#facc15 30%,#f97316 50%,#ef4444 65%,#a855f7 85%,#64748b)' }} />
                ))}
              </div>
              <p className="lx-pop-label">UK & Ireland strikes from</p>
              <div className="lx-seg lx-seg-sm">
                <button type="button" aria-selected={prefs.uk === 'mo'} onClick={() => set({ uk: 'mo' })}>Met Office</button>
                <button type="button" aria-selected={prefs.uk === 'bz'} onClick={() => set({ uk: 'bz' })}>Blitzortung</button>
              </div>
              <p className="lx-fine">{prefs.uk === 'mo'
                ? 'The Met Office network, recorded around the clock; strikes reach the map a minute or two after they happen. Blitzortung everywhere else.'
                : 'Blitzortung everywhere: within seconds, but only recorded while this site’s server is running.'}</p>
            </div>
          )}

          {on('aiw') && mode.kind === 'live' && <ForecastBanner lead={aiwLead} />}
          {boxMode && (
            <div className="lx-hint lx-glass">
              {boxResult ? <><b>{fmtN(boxResult.count)}</b> strikes in about {fmtN(boxResult.km2)} km² <button type="button" onClick={() => { setBoxResult(null); groups.current.box.clearLayers(); }}>Draw again</button></>
                : <>Drag a box on the map to count the strikes in it</>}
              <button type="button" className="lx-x" onClick={() => setBoxMode(false)} aria-label="Stop counting"><X size={13} /></button>
            </div>
          )}

          {panel && (
            <MapPanel
              title={panel.kind === 'aiw' ? `${SEV[panel.w.severity]?.label || ''} AI lightning warning` : panel.kind === 'mo' ? `${panel.w.severity} ${panel.w.type || ''} warning` : panel.kind === 'world' ? panel.w.event : 'What’s happening here'}
              accent={panel.kind === 'aiw' ? SEV[panel.w.severity]?.color : panel.accent || '#38bdf8'}
              onClose={() => setPanel(null)}>
              {panel.kind === 'aiw' && <WarningDetail warning={panel.w} compact lightMode={light} onOpenFull={() => { setTab('warnings'); setPanel(null); }} />}
              {panel.kind === 'mo' && <MetOfficeDetail w={panel.w} />}
              {panel.kind === 'world' && <WorldAlertDetail w={panel.w} detail={worldDetail} />}
              {panel.kind === 'here' && here && (
                <div className="lx-detail">
                  <p className="lx-here-place">{here.place}</p>
                  {here.nowW ? <p><b style={{ color: SEV[here.nowW.severity]?.color }}>{SEV[here.nowW.severity]?.label} AI lightning warning</b> in force here until {fmtAt(here.nowW.expiresAt, here.nowW.tz)}.</p>
                    : here.soon ? <p><b style={{ color: SEV[here.soon.w.severity]?.color }}>{SEV[here.soon.w.severity]?.label} AI lightning warning</b> forecast to reach here in about {here.soon.f.lead} minutes.</p> : null}
                  {here.near ? <p>Nearest strike in the last 30 minutes: <b>{here.km} km</b> away, {Math.max(0, Math.round(((mode.kind === 'day' ? replay.t : Date.now()) - here.near.time) / 60000))} min {mode.kind === 'day' ? 'before' : 'ago'}. {here.n20 ? `${fmtN(here.n20)} within 20 km.` : ''}</p>
                    : <p>No lightning within range in the last 30 minutes.</p>}
                  <p className="lx-fine">{here.lat.toFixed(3)}, {here.lon.toFixed(3)}</p>
                </div>
              )}
            </MapPanel>
          )}

          {/* ── the time bar ── */}
          <div className={`lx-time lx-glass${mode.kind === 'day' ? ' is-replay' : ''}`}>
            {mode.kind === 'live' ? (
              <>
                <span className="lx-time-label"><i className={isLiveFeed ? 'is-on' : ''} />Live</span>
                <div className="lx-seg lx-seg-sm">
                  {WINDOWS.map((w) => <button key={w.id} type="button" aria-selected={win === w.id} onClick={() => pickWindow(w.id)}>{w.label}</button>)}
                </div>
              </>
            ) : (
              <>
                <button type="button" className="lx-btn" onClick={goLive}><Undo2 size={14} /> Live</button>
                <button type="button" className="lx-play" onClick={() => setReplay((r) => ({ ...r, playing: !r.playing, t: !r.playing && r.t >= shown.to ? shown.from : r.t }))} aria-label={replay.playing ? 'Pause' : 'Play the day'}>
                  {replay.playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <input className="lx-scrub" type="range" min={shown.from || 0} max={shown.to || 1} step={60000} value={replay.t ?? shown.to ?? 0}
                  onChange={(e) => setReplay((r) => ({ ...r, t: Number(e.target.value), playing: false }))} aria-label="Time of day" />
                <span className="lx-time-now">{replay.t ? hhmm(replay.t) : '—'}</span>
                <select className="lx-speed" value={replay.speed} onChange={(e) => setReplay((r) => ({ ...r, speed: Number(e.target.value) }))} aria-label="Replay speed">
                  {SPEEDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </>
            )}
            <button type="button" className={`lx-btn${daysOpen ? ' is-on' : ''}`} onClick={openDays}><CalendarDays size={14} /> {mode.kind === 'day' ? shortDay(mode.day) : 'Past days'}</button>
            <span className="lx-count">{loading ? <Loader2 size={13} className="lx-spin" /> : <Zap size={12} />} {fmtN(mode.kind === 'day' ? replayCount : shown.count)}{shown.thinned ? ' (thinned)' : ''}</span>
          </div>

          {daysOpen && (
            <div className="lx-pop lx-days lx-glass" onWheel={(e) => e.stopPropagation()}>
              <div className="lx-pop-head"><b>Past days · {REGION_LABEL[region]}</b><button type="button" onClick={() => setDaysOpen(false)} aria-label="Close"><X size={14} /></button></div>
              {!days ? <p className="lx-muted"><Loader2 size={13} className="lx-spin" /> Loading…</p> : (
                <div className="lx-day-list">
                  {days.map((d) => (
                    <button key={d.day} type="button" className="lx-day" aria-pressed={mode.kind === 'day' && mode.day === d.day} onClick={() => pickDay(d.day)}>
                      <span>{dayLabel(d.day)}</span>
                      <b>{d.pending ? '…' : fmtN(d[region])}</b>
                      {!d.pending && d.bzHours < 24 && region !== 'uk' && <em title="Hours this server was recording Blitzortung">{d.bzHours}/24 h recorded</em>}
                    </button>
                  ))}
                </div>
              )}
              <p className="lx-fine">UK & Ireland days are complete from the Met Office. Elsewhere, strikes are recorded while this site’s server is running.</p>
            </div>
          )}
          {loadError && <div className="lx-hint lx-glass lx-err">Could not load strikes ({loadError}). <button type="button" onClick={load}>Try again</button></div>}
        </section>

        {/* ── the side panel ── */}
        <aside className="lx-side">
          <div className="lx-tabs lx-glass" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}><Activity size={14} /> Activity</button>
            <button type="button" role="tab" aria-selected={tab === 'warnings'} onClick={() => setTab('warnings')}><ShieldAlert size={14} /> Warnings{aiwCount + moList.length ? <em>{aiwCount + moList.length}</em> : null}</button>
            <button type="button" role="tab" aria-selected={tab === 'world'} onClick={() => { setTab('world'); if (!on('world')) toggleLayer('world'); }}><Globe size={14} /> World</button>
          </div>

          {tab === 'activity' && (
            <>
              <section className="lx-card lx-glass">
                <header className="lx-card-head"><h2>{REGION_LABEL[region]}</h2><span>{summary ? <Ago t={summary.now} prefix="updated " /> : 'loading…'}</span></header>
                <div className="lx-stats">
                  <div><span>Today</span><b>{fmtN(g?.today)}</b></div>
                  <div><span>Last hour</span><b>{fmtN(g?.lastHour)}</b></div>
                  <div><span>Last 5 min</span><b>{fmtN(g?.last5)}</b></div>
                  <div><span>Last 24 h</span><b>{fmtN(g?.last24)}</b></div>
                </div>
                <ActivityChart bins={g?.bins} binStart={summary?.binStart} from={mode.kind === 'live' ? windowStart(win) : null} />
                <p className="lx-fine">{g?.newest ? <>Latest strike {hhmm(g.newest)} (<Ago t={g.newest} />). </> : 'No strikes in the last 48 hours. '}{others.map((r) => `${REGION_LABEL[r]} today: ${fmtN(summary?.regions?.[r]?.today)}`).join(' · ')}</p>
              </section>

              <section className="lx-card lx-glass">
                <header className="lx-card-head"><h2>Data</h2></header>
                <div className="lx-feed">
                  <i className={feeds?.metoffice?.status === 'live' ? 'is-on' : ''} />
                  <div><b>Met Office</b><span>UK & Ireland · {feeds?.metoffice?.feedUpdatedAt ? <Ago t={feeds.metoffice.feedUpdatedAt} prefix="feed updated " /> : feeds?.metoffice?.lastError ? 'unavailable' : 'starting'}</span></div>
                </div>
                <div className="lx-feed">
                  <i className={feeds?.blitzortung?.status === 'live' ? 'is-on' : ''} />
                  <div><b>Blitzortung</b><span>{feeds?.blitzortung?.covers || 'elsewhere'} · {feeds?.blitzortung?.sockets != null ? `${feeds.blitzortung.sockets} connections` : '—'}{feeds?.blitzortung?.lastStrikeAgeMs != null ? ` · last ${Math.round(feeds.blitzortung.lastStrikeAgeMs / 1000)} s ago` : ''}</span></div>
                </div>
                <div className="lx-feed">
                  <i className={feeds?.cloud?.latestUpload && Date.now() - feeds.cloud.latestUpload < 45 * 60e3 ? 'is-on' : ''} />
                  <div><b>Backup recorder</b><span>on GitHub, while this PC is off · {feeds?.cloud?.latestUpload ? <Ago t={feeds.cloud.latestUpload} prefix="last saved " /> : feeds?.cloud?.lastError || (feeds?.cloud?.lastCheckAt ? 'waiting for its first save' : 'not checked yet')}</span></div>
                </div>
                {feeds?.blitzortung?.hours && (
                  <>
                    <div className="lx-hours" title="Each block is an hour: filled when Blitzortung was being recorded, here or by the backup recorder">
                      {feeds.blitzortung.hours.map((h, i) => <i key={i} className={h ? 'is-on' : ''} />)}
                    </div>
                    <p className="lx-fine">Blitzortung recorded for {capturedHours} of the last 24 hours. While this PC is off a recorder on GitHub keeps listening, and its strikes are added here when the site is back (within 20 minutes). UK & Ireland strikes come from the Met Office, whose own 48-hour feed fills any gap.{lastLive ? <> Map updated <Ago t={lastLive} />.</> : ''}</p>
                  </>
                )}
              </section>

              <section className="lx-card lx-glass">
                <header className="lx-card-head"><h2>Key</h2></header>
                <p className="lx-key-label">Strike age</p>
                <div className="lx-ages">
                  {AGE_BANDS.map((b) => <span key={b.label}><i style={{ width: b.r * 2.2, height: b.r * 2.2, background: prefs.colour === 'age' ? b.color : DOT_COLOURS.find((c) => c.id === prefs.colour)?.hex }} />{b.label}</span>)}
                </div>
                {on('heat') && (
                  <>
                    <p className="lx-key-label">Strike density, per 1,000 km²</p>
                    <div className="lx-ramp" style={{ background: HEAT_GRADIENT }} />
                    <div className="lx-ticks">{HEAT_TICKS.map((t) => <span key={t}>{t}</span>)}</div>
                  </>
                )}
                {on('radar') && (
                  <>
                    <p className="lx-key-label">Rain radar (RainViewer), mm/h</p>
                    <div className="lx-ramp lx-ramp-rain"><i style={{ background: RV_GRADIENT }} /></div>
                    <div className="lx-ticks lx-ticks-abs">{RV_TICKS.map((t) => <span key={t.dbz} style={{ left: `${(t.dbz / 80) * 100}%` }}>{t.mm}</span>)}</div>
                  </>
                )}
                {on('aiw') && <><p className="lx-key-label">AI lightning warnings</p><AiwLegend lightMode={light} /></>}
                {on('metoffice') && (
                  <>
                    <p className="lx-key-label">Met Office warnings</p>
                    <div className="lx-ages">{['Red', 'Amber', 'Yellow', 'Future'].map((k) => <span key={k}><i className="lx-sq" style={{ background: `${MO_LEVEL[k].color}55`, borderColor: MO_LEVEL[k].color }} />{k === 'Future' ? 'Upcoming' : k}</span>)}</div>
                  </>
                )}
                <p className="lx-fine">Click a strike for its time and place; right-click (or long-press) anywhere for what is happening there.</p>
              </section>
            </>
          )}

          {tab === 'warnings' && (
            <>
              {aiw.status && !aiw.status.issuing && (
                <div className="lx-card lx-glass lx-alert" role="alert">
                  {aiw.status.paused ? `AI warning issuance is paused by an administrator${aiw.status.pausedReason ? ` — ${aiw.status.pausedReason}` : ''}. Existing warnings run to their expiry.`
                    : 'The lightning feed the AI warnings depend on is unavailable, so no new warnings can be issued and existing ones are not being updated. This is not the same as there being no risk.'}
                </div>
              )}
              {on('aiw') && mode.kind === 'live' && <ForecastSlider lead={aiwLead} setLead={setAiwLead} playing={aiwPlaying} setPlaying={setAiwPlaying} lightMode={light} />}
              <VoiceAlerts subscribe={aiw.subscribe} lightMode={light} coverage={aiw.status?.coverage} onShowWarning={showAiwById} />
              <IssuedWarningsCentre lightMode={light} isAdmin={isAdmin} selectedId={aiwSelected} onSelect={setAiwSelected} onShowOnMap={showAiw} refreshKey={aiwKey} coverage={aiw.status?.coverage} />
              <section className="lx-card lx-glass">
                <header className="lx-card-head"><h2>Met Office warnings</h2>{!on('metoffice') && <button type="button" className="lx-btn" onClick={() => toggleLayer('metoffice')}>Show on map</button>}</header>
                {!on('metoffice') ? <p className="lx-muted">Turn the layer on to see the Met Office’s warnings in force.</p>
                  : moList.length ? moList.map((w, i) => {
                    const cfg = MO_LEVEL[w.validFrom && Date.parse(w.validFrom) > Date.now() ? 'Future' : w.severity] || MO_LEVEL.Yellow;
                    return (
                      <button key={i} type="button" className="lx-world-row" onClick={() => setPanel({ kind: 'mo', w, accent: cfg.color })}>
                        <i style={{ background: cfg.color }} />
                        <span><b>{w.severity} {w.type || ''} warning</b><span>{Array.isArray(w.regions) ? w.regions.join(', ') : w.region}</span><em>until {w.validTo ? hhmm(Date.parse(w.validTo)) : '—'}</em></span>
                      </button>
                    );
                  }) : <p className="lx-muted">No Met Office warnings in force.</p>}
              </section>
              <p className="lx-fine lx-pad">{aiw.status?.disclaimer || 'MyWeatherUK AI lightning warnings are experimental and are not official warnings.'} Lightning: Met Office and Blitzortung.org. Places: GeoNames (CC BY 4.0).</p>
              {isAdmin && <AiwAdminPanel onAfterChange={() => { aiw.refresh(); setAiwKey((k) => k + 1); }} />}
            </>
          )}

          {tab === 'world' && (
            <section className="lx-card lx-glass">
              <WorldAlertsList data={world} loading={worldLoading} onOpen={openWorld} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */
const CSS = `
.lx-page { --glass-fill: rgba(255,255,255,0.055); --glass-fill-strong: rgba(16,24,40,0.72); --glass-hairline: rgba(255,255,255,0.12);
  --glass-highlight: rgba(255,255,255,0.14); --glass-shadow: 0 1px 2px rgba(0,0,0,.3), 0 16px 40px -12px rgba(0,0,0,.6);
  --ink-1: #f2f6fc; --ink-2: #a6b6cb; --ink-3: rgba(166,182,203,.66); --page-bg: #070c16; --accent: #facc15;
  --amb-a: rgba(250,204,21,.14); --amb-b: rgba(129,140,248,.2); --amb-c: rgba(56,189,248,.16); --map-bg: #0b0b0d;
  position: relative; min-height: calc(100vh - 56px); min-height: calc(100dvh - 56px); background: var(--page-bg); color: var(--ink-1);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI Variable Display', 'Segoe UI', Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
.lx-page.lx-light { --glass-fill: rgba(255,255,255,0.62); --glass-fill-strong: rgba(255,255,255,0.84); --glass-hairline: rgba(15,23,42,0.09);
  --glass-highlight: rgba(255,255,255,0.92); --glass-shadow: 0 1px 2px rgba(15,23,42,.06), 0 18px 40px -14px rgba(15,23,42,.24);
  --ink-1: #0b1220; --ink-2: #46586f; --ink-3: rgba(70,88,111,.72); --page-bg: #eef3fb; --accent: #b7791f;
  --amb-a: rgba(250,204,21,.12); --amb-b: rgba(129,140,248,.14); --amb-c: rgba(56,189,248,.14); --map-bg: #e7e7e7; }
.lx-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.lx-ambient i { position: absolute; display: block; border-radius: 50%; }
.lx-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -26vw; left: -22vw; background: radial-gradient(circle, var(--amb-a), transparent 62%); }
.lx-ambient i:nth-child(2) { width: 62vw; height: 62vw; top: 12vh; right: -24vw; background: radial-gradient(circle, var(--amb-b), transparent 62%); }
.lx-ambient i:nth-child(3) { width: 64vw; height: 64vw; bottom: -26vw; left: 10vw; background: radial-gradient(circle, var(--amb-c), transparent 62%); }
.lx-glass { background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline);
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight); }
.lx-shell { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 14px; padding: 12px 16px 24px;
  height: calc(100vh - 56px); height: calc(100dvh - 56px); min-height: 560px; }        /* the site bar is 56 px */
@media (max-width: 1080px) { .lx-shell { grid-template-columns: minmax(0, 1fr); height: auto; } .lx-stage { height: 72vh; height: 72svh; min-height: 460px; } }
@media (max-width: 767px) { .lx-shell { padding: 8px 10px 90px; } }
.lx-stage { position: relative; border-radius: 24px; overflow: hidden; border: 1px solid var(--glass-hairline); box-shadow: var(--glass-shadow); background: var(--map-bg); isolation: isolate; }
.lx-stage.is-full { position: fixed; inset: 0; z-index: 9997; border-radius: 0; height: 100vh; height: 100dvh; border: 0; }
/* the shell is a stacking layer of its own (z-index 1), which kept a full-screen map under the site's
   top bar; in full screen it goes above the site's bars */
.lx-page.is-full .lx-shell { z-index: 10000; }
.lx-stage:fullscreen { width: 100vw; height: 100vh; border-radius: 0; border: 0; }
.lx-icon.lx-exit { color: var(--page-bg); background: var(--ink-1); }
@media (max-width: 767px) { .lx-icon.lx-exit { width: auto; padding: 0 12px; } .lx-icon.lx-exit span { display: inline; } }
.lx-map { position: absolute; inset: 0; background: var(--map-bg); }
.lx-map .leaflet-container, .lx-map.leaflet-container { background: var(--map-bg); font: inherit; }
.lx-top { position: absolute; z-index: 1001; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; pointer-events: none; }
.lx-top > * { pointer-events: auto; }
.lx-brand { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border-radius: 99px; font-size: .9rem; }
.lx-bolt { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 99px; color: #1a1300; background: linear-gradient(135deg, #fde68a, #facc15 55%, #f59e0b); }
.lx-live { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 99px; font-size: .68rem; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-live::before { content: ''; width: 7px; height: 7px; border-radius: 99px; background: var(--ink-3); }
.lx-live.is-on { color: #22c55e; } .lx-live.is-on::before { background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,.6); animation: lx-pulse 1.8s ease-out infinite; }
@keyframes lx-pulse { to { box-shadow: 0 0 0 8px rgba(34,197,94,0); } }
.lx-seg { display: inline-flex; gap: 3px; padding: 3px; border-radius: 99px; }
.lx-seg button { padding: 6px 13px; border: 0; border-radius: 99px; cursor: pointer; font: inherit; font-size: .8rem; font-weight: 650; color: var(--ink-2); background: none; white-space: nowrap; transition: background .18s, color .18s; }
.lx-seg button:hover { color: var(--ink-1); }
.lx-seg button[aria-selected='true'] { color: var(--page-bg); background: var(--ink-1); }
.lx-seg-sm { background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-seg-sm button { padding: 4px 10px; font-size: .74rem; }
.lx-tools { display: flex; gap: 6px; margin-left: auto; }
.lx-icon { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 11px; border-radius: 99px; cursor: pointer; font: inherit; font-size: .78rem; font-weight: 650; color: var(--ink-1); }
.lx-icon.is-on { color: var(--page-bg); background: var(--ink-1); }
@media (max-width: 767px) { .lx-icon span { display: none; } .lx-icon { width: 36px; padding: 0; justify-content: center; } .lx-top .lx-seg { order: 3; width: 100%; justify-content: space-between; } .lx-top .lx-seg button { flex: 1; padding: 6px 4px; } }
.lx-pop { position: absolute; z-index: 1002; border-radius: 18px; padding: 12px 14px; max-height: calc(100% - 140px); overflow-y: auto; }
.lx-layers { top: 60px; right: 12px; width: min(300px, calc(100% - 24px)); }
@media (max-width: 767px) { .lx-layers { top: 104px; } }
.lx-days { bottom: 72px; left: 50%; transform: translateX(-50%); width: min(420px, calc(100% - 24px)); }
.lx-pop-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.lx-pop-head b { font-size: .9rem; }
.lx-pop-head button { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 99px; border: 1px solid var(--glass-hairline); background: var(--glass-fill); color: var(--ink-2); cursor: pointer; }
.lx-pop-label { margin: 12px 0 6px; font-size: .64rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.lx-switch { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 2px; font-size: .84rem; cursor: pointer; border-bottom: 1px solid var(--glass-hairline); }
.lx-switch em { font-style: normal; color: var(--ink-3); font-size: .74rem; }
.lx-switch input { position: absolute; opacity: 0; pointer-events: none; }
.lx-switch i { position: relative; flex: 0 0 38px; height: 22px; border-radius: 99px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); transition: background .18s; }
.lx-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 99px; background: var(--ink-2); transition: transform .18s, background .18s; }
.lx-switch input:checked + i { background: #22c55e; border-color: transparent; }
.lx-switch input:checked + i::after { transform: translateX(16px); background: #fff; }
.lx-switch input:focus-visible + i { outline: 2px solid var(--accent); outline-offset: 2px; }
.lx-swatches { display: flex; gap: 7px; flex-wrap: wrap; }
.lx-swatches button { width: 26px; height: 26px; border-radius: 99px; cursor: pointer; border: 2px solid var(--glass-hairline); }
.lx-swatches button[aria-pressed='true'] { border-color: var(--ink-1); box-shadow: 0 0 0 2px var(--page-bg) inset; }
.lx-time { position: absolute; z-index: 1001; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-radius: 99px; max-width: calc(100% - 24px); flex-wrap: wrap; justify-content: center; }
@media (max-width: 767px) { .lx-time { border-radius: 20px; bottom: 10px; } }
@media (min-width: 768px) { .lx-time { flex-wrap: nowrap; } .lx-time.is-replay { width: min(760px, calc(100% - 24px)); } .lx-time.is-replay .lx-scrub { flex: 1 1 160px; width: auto; min-width: 90px; } }
.lx-time-label { display: inline-flex; align-items: center; gap: 6px; font-size: .78rem; font-weight: 750; }
.lx-time-label i { width: 8px; height: 8px; border-radius: 99px; background: var(--ink-3); }
.lx-time-label i.is-on { background: #22c55e; }
.lx-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 99px; cursor: pointer; font: inherit; font-size: .76rem; font-weight: 650; color: var(--ink-1); background: var(--glass-fill); border: 1px solid var(--glass-hairline); white-space: nowrap; }
.lx-btn:hover, .lx-btn.is-on { background: var(--ink-1); color: var(--page-bg); }
.lx-play { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 99px; border: 0; cursor: pointer; color: #1a1300; background: linear-gradient(135deg, #fde68a, #facc15 55%, #f59e0b); }
.lx-scrub { width: clamp(120px, 28vw, 340px); accent-color: #facc15; }
.lx-time-now { min-width: 40px; font-size: .84rem; font-weight: 750; font-variant-numeric: tabular-nums; }
.lx-speed { padding: 4px 6px; border-radius: 10px; font: inherit; font-size: .72rem; color: var(--ink-1); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-speed option { color: #0b1220; }
.lx-count { display: inline-flex; align-items: center; gap: 5px; padding: 0 6px; font-size: .78rem; font-weight: 700; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.lx-day-list { display: flex; flex-direction: column; gap: 4px; }
.lx-day { display: grid; grid-template-columns: 1fr auto; gap: 1px 10px; align-items: baseline; padding: 8px 10px; border-radius: 12px; cursor: pointer; font: inherit; text-align: left; color: var(--ink-1); background: var(--glass-fill); border: 1px solid transparent; }
.lx-day:hover { border-color: var(--glass-hairline); }
.lx-day[aria-pressed='true'] { border-color: #facc15; }
.lx-day span { font-size: .84rem; font-weight: 600; }
.lx-day b { font-size: .86rem; font-variant-numeric: tabular-nums; }
.lx-day em { grid-column: 1 / -1; font-style: normal; font-size: .68rem; color: var(--ink-3); }
.lx-hint { position: absolute; z-index: 1001; top: 64px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; border-radius: 99px; font-size: .8rem; white-space: nowrap; }
@media (max-width: 767px) { .lx-hint { top: 108px; white-space: normal; border-radius: 16px; width: calc(100% - 24px); } }
.lx-hint button { font: inherit; font-size: .74rem; font-weight: 650; padding: 4px 10px; border-radius: 99px; cursor: pointer; color: var(--ink-1); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-hint .lx-x { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; }
.lx-err { top: auto; bottom: 74px; color: #f87171; }
.lx-spin { animation: lx-spin 1s linear infinite; }
@keyframes lx-spin { to { transform: rotate(360deg); } }
/* the floating panel */
.lx-panel { position: absolute; z-index: 1003; display: flex; flex-direction: column; overflow: hidden; border-radius: 18px; background: var(--glass-fill-strong); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--glass-shadow); }
.lx-panel-bar { display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px; cursor: grab; touch-action: none; border-bottom: 1px solid var(--glass-hairline); background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent); color: var(--ink-3); }
.lx-panel-bar span { flex: 1; min-width: 0; font-size: .8rem; font-weight: 700; color: var(--ink-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lx-panel-bar button { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; cursor: pointer; background: var(--glass-fill); border: 1px solid var(--glass-hairline); color: var(--ink-2); }
.lx-panel-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.lx-panel-grip { position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px; cursor: nwse-resize; touch-action: none; color: var(--ink-3); }
.lx-detail { padding: 12px 14px 14px; font-size: .82rem; line-height: 1.5; color: var(--ink-1); }
.lx-detail p { margin: 0 0 10px; }
.lx-detail h4 { margin: 12px 0 4px; font-size: .64rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.lx-detail-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.lx-detail-head > i { width: 4px; align-self: stretch; min-height: 32px; border-radius: 3px; flex-shrink: 0; }
.lx-detail-head > div { flex: 1; min-width: 0; }
.lx-detail-head b { display: block; font-size: .95rem; letter-spacing: -.01em; }
.lx-detail-head span { display: block; font-size: .74rem; color: var(--ink-2); }
.lx-detail-head em { font-style: normal; padding: 2px 9px; border-radius: 99px; font-size: .62rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; border: 1px solid; white-space: nowrap; }
.lx-detail dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 10px; padding: 8px 10px; border-radius: 12px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-detail dt { font-size: .64rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); padding-top: 2px; }
.lx-detail dd { margin: 0; font-size: .8rem; }
.lx-here-place { font-size: .95rem; font-weight: 700; }
.lx-pre { white-space: pre-wrap; }
.lx-link { display: inline-block; margin-top: 4px; padding: 6px 12px; border-radius: 99px; font-size: .76rem; font-weight: 650; text-decoration: none; color: var(--ink-1); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-muted { margin: 4px 0; font-size: .8rem; color: var(--ink-3); display: flex; align-items: center; gap: 6px; }
.lx-fine { margin: 8px 0 0; font-size: .7rem; line-height: 1.5; color: var(--ink-3); }
.lx-pad { padding: 0 6px; }
/* strike popups */
.lx-popup .leaflet-popup-content-wrapper { border-radius: 14px; background: var(--glass-fill-strong); color: var(--ink-1); border: 1px solid var(--glass-hairline); box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
.lx-popup .leaflet-popup-tip { background: var(--glass-fill-strong); }
.lx-popup .leaflet-popup-content { margin: 10px 13px; font: inherit; font-size: .8rem; line-height: 1.45; }
.lx-popup .leaflet-popup-content b { font-size: .92rem; font-variant-numeric: tabular-nums; }
.lx-popup .leaflet-popup-content span { color: var(--ink-3); margin-left: 4px; }
.lx-popup .leaflet-popup-content p { margin: 4px 0; }
.lx-popup .leaflet-popup-content em { font-style: normal; font-size: .7rem; color: var(--ink-3); }
.lx-popup a.leaflet-popup-close-button { color: var(--ink-3); }
.lx-map .leaflet-control-zoom a { background: var(--glass-fill-strong); color: var(--ink-1); border-color: var(--glass-hairline); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
.lx-map .leaflet-control-zoom { border: 1px solid var(--glass-hairline); border-radius: 12px; overflow: hidden; margin-bottom: 70px !important; }
.lx-map .leaflet-control-attribution { background: color-mix(in srgb, var(--page-bg) 55%, transparent); color: var(--ink-3); font-size: 10px; border-radius: 8px 8px 0 0; margin-left: 12px !important; }
.lx-map .leaflet-control-attribution a { color: var(--ink-2); }
@media (max-width: 767px) { .lx-map .leaflet-control-zoom { display: none; } .lx-map .leaflet-control-attribution { display: none; } }
/* side panel */
.lx-side { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-right: 2px; }
/* in a fixed-height scrolling column, a card that clips its overflow would otherwise be squashed to fit */
.lx-side > * { flex-shrink: 0; }
/* the AI-warnings panels are drawn as the site's glass panes */
.lx-page .lg-pane { position: relative; background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); border-radius: 20px;
  -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight); }
@media (max-width: 1080px) { .lx-side { overflow: visible; } }
.lx-tabs { position: sticky; top: 0; z-index: 2; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 4px; border-radius: 16px; }
.lx-tabs button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 6px; border: 0; border-radius: 12px; cursor: pointer; font: inherit; font-size: .8rem; font-weight: 650; color: var(--ink-2); background: none; }
.lx-tabs button[aria-selected='true'] { color: var(--ink-1); background: var(--glass-fill); box-shadow: inset 0 0 0 1px var(--glass-hairline); }
.lx-tabs em { font-style: normal; min-width: 18px; padding: 0 5px; border-radius: 99px; font-size: .66rem; font-weight: 800; color: #1a1300; background: #facc15; }
.lx-card { border-radius: 20px; padding: 14px 15px; }
.lx-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.lx-card-head h2 { margin: 0; font-size: 1rem; font-weight: 700; letter-spacing: -.015em; }
.lx-card-head span { font-size: .72rem; color: var(--ink-3); }
.lx-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.lx-stats div { padding: 9px 11px; border-radius: 14px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-stats span { display: block; font-size: .62rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.lx-stats b { display: block; margin-top: 2px; font-size: 1.45rem; font-weight: 750; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.lx-stats div:first-child b { color: var(--accent); }
.lx-chart { margin-top: 12px; }
.lx-chart svg { display: block; width: 100%; height: 96px; cursor: crosshair; }
.lx-grid { stroke: var(--glass-hairline); stroke-width: .6; stroke-dasharray: 2 3; }
.lx-bar { fill: color-mix(in srgb, var(--ink-2) 45%, transparent); }
.lx-bar.in { fill: #facc15; }
.lx-bar.on { fill: var(--ink-1); }
.lx-axis { font-size: 7px; fill: var(--ink-3); }
.lx-chart-tip { margin-top: 2px; min-height: 18px; font-size: .72rem; color: var(--ink-3); }
.lx-chart-tip b { color: var(--ink-1); }
.lx-feed { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--glass-hairline); }
.lx-feed > i { width: 9px; height: 9px; border-radius: 99px; background: #f97316; flex-shrink: 0; }
.lx-feed > i.is-on { background: #22c55e; }
.lx-feed b { display: block; font-size: .84rem; }
.lx-feed span { display: block; font-size: .72rem; color: var(--ink-3); }
.lx-hours { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; margin-top: 10px; }
.lx-hours i { height: 10px; border-radius: 2px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-hours i.is-on { background: #22c55e; border-color: transparent; opacity: .85; }
.lx-key-label { margin: 10px 0 5px; font-size: .62rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.lx-key-label:first-of-type { margin-top: 0; }
.lx-ages { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.lx-ages span { display: inline-flex; align-items: center; gap: 5px; font-size: .72rem; color: var(--ink-2); }
.lx-ages i { border-radius: 99px; flex-shrink: 0; }
.lx-light .lx-ages i { box-shadow: 0 0 0 .8px rgba(15,23,42,.55); }
.lx-ages i.lx-sq { width: 14px; height: 9px; border-radius: 2px; border: 1.5px solid; box-shadow: none; }
.lx-ramp { height: 9px; border-radius: 5px; }
.lx-ramp-rain { position: relative; overflow: hidden; background: var(--map-bg); }
.lx-ramp-rain i { position: absolute; inset: 0; opacity: .6; }
.lx-ticks { display: flex; justify-content: space-between; margin-top: 3px; font-size: .64rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.lx-ticks-abs { position: relative; height: 14px; display: block; }
.lx-ticks-abs span { position: absolute; transform: translateX(-50%); }
.lx-alert { color: #f87171; font-size: .8rem; font-weight: 650; border-color: rgba(248,113,113,.45); }
/* worldwide alerts */
.lx-world-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: #34d399; }
.lx-world-head b { color: var(--ink-1); font-size: .95rem; }
.lx-world-head span { font-size: .72rem; color: var(--ink-3); }
.lx-search { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 0 12px; height: 38px; border-radius: 12px; background: var(--glass-fill); border: 1px solid var(--glass-hairline); color: var(--ink-3); }
.lx-search input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font: inherit; font-size: 16px; color: var(--ink-1); }
.lx-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.lx-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; cursor: pointer; font: inherit; font-size: .72rem; font-weight: 650; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.lx-chip[aria-pressed='true'] { color: var(--page-bg); background: var(--ink-1); }
.lx-chip i { width: 7px; height: 7px; border-radius: 99px; }
.lx-world-list { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
.lx-world-row { display: flex; gap: 10px; align-items: stretch; width: 100%; padding: 9px 11px; border-radius: 13px; cursor: pointer; font: inherit; text-align: left; color: var(--ink-1); background: var(--glass-fill); border: 1px solid var(--glass-hairline); margin-top: 5px; }
.lx-world-row:hover { border-color: color-mix(in srgb, var(--ink-2) 40%, transparent); }
.lx-world-row > i { width: 4px; border-radius: 3px; flex-shrink: 0; }
.lx-world-row > span { flex: 1; min-width: 0; }
.lx-world-row b { display: block; font-size: .8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lx-world-row span span { display: block; font-size: .72rem; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lx-world-row em { display: block; font-style: normal; font-size: .66rem; color: var(--ink-3); margin-top: 2px; }
.lx-more { display: block; margin: 10px auto 0; padding: 6px 14px; border-radius: 99px; cursor: pointer; font: inherit; font-size: .74rem; font-weight: 650; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
`;
