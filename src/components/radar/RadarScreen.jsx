/* ════════════════════════════════════════════════════════════════════════════
   The Radar tab (17 Nov 2026, at the user's request: "the whole page should be the radar, with a key like on the
   Model Data page, and the past and the future with the UKV; a time slider that is really easy to move, clear
   whether it is live data or UKV future data").

   The map fills the screen. "Radar" is written on it, and beside it a Layers button of Liquid Glass turns on the
   rain radar, lightning, pressure lines and satellite. The Met Office's 1 km rain radar for the last three hours
   (every 15 minutes) and then the newest UKV run's rain for up to nine hours ahead (every hour) are one timeline
   in a small glass dock above the tab bar: play, RADAR or UKV, the time, and a thin slider you can grab anywhere,
   green for the radar and blue for the forecast with Now between them. The key sits small in the top right.

   Sharp: each frame is drawn once at 1200 px across from the 1 km radar (the UKV's own 2 km grid ahead), and only
   two pictures are ever on the map, the one on show and the next, swapped when the next has loaded, so a phone
   holds two big pictures rather than twenty.

   The data are the Location page's radar (server/locationWeather.js /api/location/radar and its frames); the
   forecast is the newest UKV run Model Data has made the rain for (/api/modeldata/catalog); pressure lines are
   drawn from that run's sea-level pressure (lib/modelViewer pressureLines); the satellite is EUMETSAT's
   Meteosat GeoColour picture (view.eumetsat.int, the newest).
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Pause, Play, Layers, Loader2, X, CloudRain, Zap, Gauge, Satellite, ChevronDown, ChevronUp } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useSectionActive } from '@/components/app/sectionActive';
import { laeaInverse, mercHeight, paintRadarCrop, parseRadarCrop, radarBox, radarCropMapping, radarStamp, UK_RADAR_VIEW } from '@/lib/ukRadar';
import { familyColour, KIND_ORDER, RADAR_FAMILIES, loadFrame, loadLive, pressureLines, withGrid, runTag } from '@/lib/modelViewer';
import { projection } from '@/lib/modelGrids';
import { localPlaces } from '@/lib/location/places';
import './radar-screen.css';
import '@/components/app/liquid-glass.css';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const BASEMAP = {
  dark: [`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
  light: [`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
};
const SAT_WMS = 'https://view.eumetsat.int/geoserver/wms';
const FIT = [[49.8, -10.8], [59.3, 2.3]];
const W = 1200;                                  // each frame's picture, px across (about 1 km a pixel)
const OPACITY = 0.9;
const AHEAD_H = 9;                               // the forecast's reach after the newest radar
/* a lightning strike's colour by age: white when new, through yellow and orange, to red after three hours */
const AGE = [[0, '#ffffff'], [20, '#fde047'], [60, '#fb923c'], [120, '#ef4444'], [180, '#991b1b']];
const ageColour = (mins) => (AGE.findLast(([m]) => mins >= m) || AGE[0])[1];
const rgb = (c) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent');
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });

/* the key's scale: every kind along the same log axis, 0.05 to 40 mm an hour */
const KEY_MIN = Math.log(0.05), KEY_MAX = Math.log(40);
const KEY_CELLS = 36;
const KEY_TICKS = [0.1, 0.5, 1, 2, 4, 8, 16, 32];
const keyRate = (i) => Math.exp(KEY_MIN + ((i + 0.5) / KEY_CELLS) * (KEY_MAX - KEY_MIN));
const keyPos = (r) => ((Math.log(r) - KEY_MIN) / (KEY_MAX - KEY_MIN)) * 100;

/* what can be on the map, and whether it is to start with */
const LAYERS = [
  { id: 'radar', name: 'Rain radar', note: 'Met Office radar, then the UKV', icon: CloudRain, on: true },
  { id: 'lightning', name: 'Lightning', note: 'Strikes in the last 3 hours', icon: Zap, on: false },
  { id: 'pressure', name: 'Pressure lines', note: 'Isobars every 4 hPa, from the UKV', icon: Gauge, on: false },
  { id: 'satellite', name: 'Satellite', note: 'Meteosat, the newest picture', icon: Satellite, on: false },
];
const LAYERS_KEY = 'mwuk_radar_layers';
const readLayers = () => {
  const out = Object.fromEntries(LAYERS.map((l) => [l.id, l.on]));
  try { Object.assign(out, JSON.parse(localStorage.getItem(LAYERS_KEY) || '{}')); } catch { /* storage blocked */ }
  return out;
};

/* "now", "45 min ago", "in 2 h" */
function relative(ms, now) {
  const min = Math.round((ms - now) / 6e4);
  if (Math.abs(min) < 8) return 'now';
  const a = Math.abs(min);
  const txt = a < 60 ? `${a} min` : `${Math.floor(a / 60)} h${a % 60 >= 8 ? ` ${Math.round((a % 60) / 15) * 15} min` : ''}`;
  return min < 0 ? `${txt} ago` : `in ${txt}`;
}

/* The forecast part: the newest UKV run whose rain Model Data has made for the hours after the radar (three runs
   tried, newest first), each step with whether its precipitation type is made too. Null when none has it yet. */
async function newestUkv(fromMs, signal) {
  const cat = await fetch('/api/modeldata/catalog', { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const runs = (cat?.models || []).find((m) => m.id === 'ukv')?.runs || [];
  for (const r of runs.slice(0, 3)) {
    const tag = runTag(r.run), runMs = Date.parse(r.run);
    const first = Math.max(0, Math.round((fromMs - runMs) / 36e5));
    const st = await fetch(`/api/modeldata/frames/ukv/${tag}/precip_rate/status?first=${first}`, { signal }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const done = new Set(st?.done || []);
    const out = (r.steps || []).map((h) => ({ h, t: runMs + h * 36e5 }))
      .filter(({ h, t }) => t > fromMs && t <= fromMs + AHEAD_H * 36e5 && done.has(h))
      .map(({ h, t }) => ({ run: tag, h, valid: new Date(t).toISOString() }));
    if (out.length >= 3) {
      const pt = await fetch(`/api/modeldata/frames/ukv/${tag}/ptype/status?first=${first}`, { signal }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const typed = new Set(pt?.done || []);
      return { run: { tag, runMs, steps: r.steps || [] }, future: out.map((f) => ({ ...f, typed: typed.has(f.h) })) };
    }
  }
  return null;
}

export default function RadarScreen() {
  const { isDark } = useTheme();
  const active = useSectionActive();
  const rootRef = useRef(null), mapEl = useRef(null), mapRef = useRef(null), bufs = useRef([]), front = useRef(0), made = useRef([]);
  const boltLayer = useRef(null), satLayer = useRef(null), isoLayer = useRef(null);
  const [frames, setFrames] = useState([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [state, setState] = useState('loading');
  const [round, setRound] = useState(0);
  const [ukvRun, setUkvRun] = useState(null);            // { tag, runMs, steps } of the forecast part
  const [strikes, setStrikes] = useState(null);
  const [layers, setLayers] = useState(readLayers);
  const [layersOpen, setLayersOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)); } catch { /* blocked */ } }, [layers]);
  const flip = (id) => setLayers((l) => ({ ...l, [id]: !l[id] }));
  const [keyOpen, setKeyOpen] = useState(() => { try { return localStorage.getItem('mwuk_radar_key') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('mwuk_radar_key', keyOpen ? '1' : '0'); } catch { /* blocked */ } }, [keyOpen]);
  const box = useMemo(() => radarBox(UK_RADAR_VIEW.lat, UK_RADAR_VIEW.lon, UK_RADAR_VIEW.halfKm), []);
  /* where you are (17 Nov 2026, at the user's request: "a red dot on the person's location, the radar slightly zoomed
     onto it"): the phone's own position when the app may already use it (it never asks here), else the place saved as
     Home on the home page */
  const [me, setMe] = useState(null);
  const meRef = useRef(null);
  const movedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const use = (lat, lon) => { if (alive && Number.isFinite(lat) && Number.isFinite(lon)) setMe([lat, lon]); };
    const fromHome = () => { try { const h = localPlaces().places.find((p) => p.label === 'home'); if (h) use(h.lat, h.lon); } catch { /* none */ } };
    const locate = () => navigator.geolocation.getCurrentPosition((p) => use(p.coords.latitude, p.coords.longitude), fromHome,
      { maximumAge: 10 * 60e3, timeout: 12000, enableHighAccuracy: false });
    if (!navigator.geolocation) fromHome();
    else if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then((st) => (st.state === 'granted' ? locate() : fromHome())).catch(fromHome);
    else fromHome();
    return () => { alive = false; };
  }, []);
  meRef.current = me;
  const bounds = useMemo(() => [[box.latMin, box.lonMin], [box.latMax, box.lonMax]], [box]);

  /* the screen's height: all of it below whatever sits above (the computer's site bar), measured while on show */
  const [topOffset, setTopOffset] = useState(0);
  useEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (el && !el.closest('[data-off]')) setTopOffset(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);

  /* the map, made once, with its two picture holders for the radar */
  const frameRef = useRef(null);
  useEffect(() => {
    const el = mapEl.current;
    const m = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 11, zoomSnap: 0.25 });
    m.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'topright' }).addTo(m);
    m.createPane('sat'); m.getPane('sat').style.zIndex = 250;
    m.createPane('isobars'); m.getPane('isobars').style.zIndex = 450; m.getPane('isobars').style.pointerEvents = 'none';
    m.createPane('labels'); m.getPane('labels').style.zIndex = 650; m.getPane('labels').style.pointerEvents = 'none';
    bufs.current = [0, 1].map(() => L.imageOverlay('data:image/gif;base64,R0lGODlhAQABAAAAACw=', bounds, { opacity: 0, interactive: false, className: 'rs-frame' }).addTo(m));
    mapRef.current = m;
    const frame = () => {
      const r = rootRef.current?.getBoundingClientRect();
      const dock = rootRef.current?.querySelector('.rs-dock')?.getBoundingClientRect();
      const head = rootRef.current?.querySelector('.rs-top')?.getBoundingClientRect();
      const padTop = r && head ? head.bottom - r.top + 4 : 60;
      const padBottom = r && dock ? r.bottom - dock.top + 6 : 120;
      try {
        const at = meRef.current;
        if (at && at[0] > 49 && at[0] < 61.5 && at[1] > -11.5 && at[1] < 3) {
          m.setView(at, 7, { animate: false });
          m.panBy([0, (padBottom - padTop) / 2], { animate: false });     // in the middle of the map you can see
        } else m.fitBounds(FIT, { animate: false, paddingTopLeft: [4, padTop], paddingBottomRight: [4, padBottom] });
      } catch { /* not laid out */ }
    };
    frameRef.current = frame;
    const mine = () => { movedRef.current = true; };
    ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.addEventListener(ev, mine, { passive: true }));
    const ro = new ResizeObserver(() => { m.invalidateSize({ animate: false }); if (!movedRef.current) frame(); });
    ro.observe(el);
    requestAnimationFrame(frame);
    return () => { ro.disconnect(); ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.removeEventListener(ev, mine)); m.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* you: a red dot, and the map onto it (unless it has been moved by hand) */
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !me) return undefined;
    const dot = L.marker(me, { icon: L.divIcon({ className: 'rs-me', iconSize: [20, 20], html: '<i></i>' }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m);
    if (!movedRef.current) frameRef.current?.();
    return () => dot.remove();
  }, [me]);

  /* the base map and its place names, dark or light with the app (swapped whole: setUrl asks for tiles at a
     fractional zoom, which the tile server reads wrongly) */
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return undefined;
    const [base, labels] = BASEMAP[isDark ? 'dark' : 'light'];
    const t = [
      L.tileLayer(base, { attribution: '© Esri · radar and lightning © Met Office · forecast: Met Office UKV' }).addTo(m),
      L.tileLayer(labels, { pane: 'labels' }).addTo(m),
    ];
    return () => t.forEach((x) => x.remove());
  }, [isDark]);

  /* the frames: the radar's and the newest UKV's, fetched four at a time and each drawn once; the newest radar
     scan first, shown straight away; on a refresh the old set stays up until the new one is ready */
  useEffect(() => {
    const ac = new AbortController();
    const urls = [];
    let alive = true;
    if (!frames.length) setState('loading');
    (async () => {
      try {
        const index = await fetch('/api/location/radar', { signal: ac.signal }).then((r) => r.json());
        const past = index.past || [];
        const fromMs = past.length ? Date.parse(past[past.length - 1]) : Date.now();
        const ukv = await newestUkv(fromMs, ac.signal);
        const future = ukv?.future || index.future || [];
        if (alive) setUkvRun(ukv?.run || (index.future?.[0] ? { tag: index.future[0].run, runMs: null, steps: [] } : null));
        const at = 'scope=uk';
        const typed = new Set(index.pastTyped || []);
        const list = [
          ...past.map((t) => ({
            kind: 'radar', valid: Date.parse(t), url: `/api/location/radar/frame?src=radar&t=${radarStamp(t)}&${at}&km=1`,
            typeUrl: typed.has(t) ? `/api/location/radar/frame?src=radar&t=${radarStamp(t)}&kind=type&${at}` : null,
          })),
          ...future.map((f) => ({
            kind: 'ukv', valid: Date.parse(f.valid), run: f.run, url: `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&${at}`,
            typeUrl: f.typed ? `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&kind=type&${at}` : null,
          })),
        ];
        if (!list.length) { if (!frames.length) setState('none'); return; }
        const H = mercHeight(box, W);
        const maps = {};
        const out = new Array(list.length).fill(null);
        const newest = Math.max(0, past.length - 1);
        const order = [newest, ...list.keys()].filter((k, i) => i === 0 || k !== newest);
        let next = 0, shownFirst = false;
        const worker = async () => {
          while (next < order.length && alive) {
            const k = order[next++];
            try {
              const get = (u) => fetch(u, { signal: ac.signal }).then((r) => (r.ok ? r.arrayBuffer() : null));
              const [buf, tbuf] = await Promise.all([get(list[k].url), list[k].typeUrl ? get(list[k].typeUrl).catch(() => null) : null]);
              if (!buf || !alive) continue;
              const mapFor = (c) => {
                const key = `${c.head.x0}|${c.head.y0}|${c.head.dx}|${c.head.nx}|${c.head.ny}`;
                maps[key] = maps[key] || radarCropMapping(c.head, box, W, H);
                return maps[key];
              };
              const crop = parseRadarCrop(buf);
              const tcrop = tbuf ? parseRadarCrop(tbuf) : null;
              const url = await paintRadarCrop(crop, mapFor(crop), W, H, tcrop ? { crop: tcrop, map: mapFor(tcrop) } : null);
              urls.push(url);
              out[k] = { ...list[k], img: url };
              /* the newest scan on its own while the rest are drawn (a first load only) */
              if (k === newest && alive && !shownFirst && !made.current.length) {
                shownFirst = true;
                setFrames([out[k]]); setIdx(0); setState('ready');
              }
            } catch { /* a missing frame is skipped */ }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (!alive) return;
        const ok = out.filter(Boolean);
        if (!ok.length) { if (!frames.length) setState('none'); return; }
        const lastPast = ok.map((f) => f.kind).lastIndexOf('radar');
        const old = made.current;
        made.current = urls.splice(0);
        setFrames(ok);
        setIdx((i) => (round === 0 ? Math.max(0, lastPast) : Math.min(i, ok.length - 1)));
        setState('ready');
        setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 4000);   // after the new set is on show
      } catch (e) {
        if (alive && e?.name !== 'AbortError' && !frames.length) setState('none');
      }
    })();
    return () => { alive = false; ac.abort(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [box, round]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { made.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  /* a new scan every fifteen minutes: look again every five while the tab is on show */
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') setRound((r) => r + 1); }, 5 * 60e3);
    return () => clearInterval(t);
  }, [active]);

  /* one frame on show: the next picture goes into the hidden holder, and the two swap once it has loaded */
  const showSeq = useRef(0);
  useEffect(() => {
    const f = frames[idx], [a, b] = bufs.current;
    if (!a || !b) return;
    const shown = front.current ? b : a, spare = front.current ? a : b;
    const op = layers.radar ? OPACITY : 0;
    if (!f) { a.setOpacity(0); b.setOpacity(0); return; }
    if (shown._url === f.img) { shown.setOpacity(op); spare.setOpacity(0); return; }
    const seq = ++showSeq.current;
    const swap = () => {
      if (seq !== showSeq.current) return;
      spare.setOpacity(op); shown.setOpacity(0);
      front.current = 1 - front.current;
    };
    if (spare._url === f.img) { swap(); return; }
    spare.once('load', swap);
    spare.setUrl(f.img);
  }, [idx, frames, layers.radar]);

  /* playing: a beat a frame, a longer pause on Now and at the end; it rests while another tab shows */
  const lastPast = frames.map((f) => f.kind).lastIndexOf('radar');
  useEffect(() => {
    if (!playing || !active || frames.length < 2) return undefined;
    const hold = idx === lastPast || idx === frames.length - 1 ? 1400 : 520;
    const t = setTimeout(() => setIdx((i) => (i + 1) % frames.length), hold);
    return () => clearTimeout(t);
  }, [playing, active, idx, frames.length, lastPast]);

  /* lightning: the Met Office's strikes of the last three hours, every two minutes while on */
  useEffect(() => {
    if (!layers.lightning || !active) { if (!layers.lightning) setStrikes(null); return undefined; }
    let alive = true;
    const load = () => fetch('/api/modeldata/live/lightning').then((r) => r.json()).then((j) => {
      if (!alive) return;
      const since = Date.now() - 3 * 36e5;
      setStrikes((j.strikes || []).filter((s) => s[0] >= since).map(([t, gx, gy]) => {
        const [slon, slat] = laeaInverse(gx * 2000 - 1159000, 903000 - gy * 2000);
        return [t, slat, slon];
      }));
    }).catch(() => { if (alive) setStrikes([]); });
    load();
    const t = setInterval(load, 120e3);
    return () => { alive = false; clearInterval(t); };
  }, [layers.lightning, active]);
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (boltLayer.current) { boltLayer.current.remove(); boltLayer.current = null; }
    if (!strikes?.length) return;
    const renderer = L.canvas({ padding: 0.2 });
    const now = Date.now();
    boltLayer.current = L.layerGroup(strikes.map(([t, la, lo]) => L.circleMarker([la, lo], {
      renderer, radius: 3, weight: 1, color: 'rgba(0,0,0,0.55)', fillColor: ageColour((now - t) / 60e3), fillOpacity: 0.95, interactive: false,
    }))).addTo(m);
  }, [strikes]);

  /* satellite: Meteosat's GeoColour picture from EUMETSAT, under the rain */
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return undefined;
    if (!layers.satellite) return undefined;
    const sat = L.tileLayer.wms(SAT_WMS, {
      layers: 'mtg_fd:rgb_geocolour', format: 'image/png', transparent: true, version: '1.3.0', pane: 'sat', opacity: 0.85,
      attribution: 'satellite © EUMETSAT',
    }).addTo(m);
    satLayer.current = sat;
    return () => { sat.remove(); satLayer.current = null; };
  }, [layers.satellite]);

  /* pressure lines: the isobars of the sea-level pressure at the time on show. For the radar's times, Model Data's
     15-minute analysis (the UKV corrected to the stations, made every 15 minutes, always there); ahead, the forecast
     run's own, which is asked for once while the lines are on and looked for again every 20 seconds until made. */
  const [mslNow, setMslNow] = useState(null);           // ms -> the analysis' own time
  const [fcMsl, setFcMsl] = useState(null);             // { tag, done: Set of the hours made }
  useEffect(() => {
    if (!layers.pressure || !active) return undefined;
    let alive = true, timer = null;
    fetch('/api/modeldata/live/catalog').then((r) => (r.ok ? r.json() : null)).then((c) => {
      const p = c?.products?.now_mslp;
      if (alive && p?.times) setMslNow(new Map(p.times.map((t) => [Date.parse(t), t])));
    }).catch(() => {});
    const look = async () => {
      if (!ukvRun?.tag) return;
      const st = await fetch(`/api/modeldata/frames/ukv/${ukvRun.tag}/mslp/status?first=0`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive) return;
      setFcMsl({ tag: ukvRun.tag, done: new Set(st?.done || []) });
      if (st?.state !== 'complete') timer = setTimeout(look, 20000);
    };
    look();
    return () => { alive = false; clearTimeout(timer); };
  }, [layers.pressure, active, ukvRun?.tag]);
  const isoCache = useRef(new Map());                    // key -> lines (null while on its way)
  const isoFailed = useRef(new Set());
  const f = frames[idx];
  /* a frame's pressure: its key, and how to fetch it */
  const isoFor = (fr) => {
    if (!fr) return null;
    if (fr.kind === 'radar') {
      /* the analysis at that time, else the nearest within 45 minutes (the newest scan is in before its analysis) */
      let at = mslNow?.get(fr.valid);
      if (!at && mslNow) { let best = 45 * 6e4 + 1; for (const [ms, iso] of mslNow) { const d = Math.abs(ms - fr.valid); if (d < best) { best = d; at = iso; } } }
      return at ? { key: `now/${at}`, load: () => loadLive('now_mslp', at, 'bin') } : null;
    }
    if (!fcMsl || !ukvRun?.runMs) return null;
    const h = Math.round((fr.valid - ukvRun.runMs) / 36e5);
    return fcMsl.done.has(h) ? { key: `${fcMsl.tag}/${h}`, load: () => loadFrame('ukv', fcMsl.tag, 'mslp', h) } : null;
  };
  const isoKey = layers.pressure ? isoFor(f)?.key || null : null;
  const [isoTick, setIsoTick] = useState(0);
  /* every frame's lines, fetched one after another in the background, the frame on show first; nothing is
     cancelled when the frame changes (playing changes it twice a second) */
  const isoBusy = useRef(false);
  const isoWant = useRef(() => []);
  isoWant.current = () => (layers.pressure ? [isoFor(frames[idx]), ...frames.map(isoFor)] : [])
    .filter((x) => x && !isoCache.current.has(x.key) && !isoFailed.current.has(x.key));
  useEffect(() => {
    if (!layers.pressure || isoBusy.current) return undefined;
    let alive = true;
    isoBusy.current = true;
    (async () => {
      try {
        for (let job = isoWant.current()[0]; alive && job; job = isoWant.current()[0]) {
          isoCache.current.set(job.key, null);
          try {
            const fr = await job.load();
            const lines = withGrid('uk', () => pressureLines(fr, 4, 2, new Map(), { sync: true })) || [];
            const P = projection('uk');
            isoCache.current.set(job.key, lines.map((c) => ({
              value: c.value,
              rings: c.rings.map((r) => r.map(([x, y]) => { const [lon, lat] = P.fromGrid(x, y); return [lat, lon]; })),
            })));
            if (alive) setIsoTick((n) => n + 1);
          } catch {
            isoCache.current.delete(job.key);
            isoFailed.current.add(job.key);
          }
        }
      } finally { isoBusy.current = false; }
    })();
    return () => { alive = false; };
  }, [layers.pressure, frames, mslNow, fcMsl, isoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (isoLayer.current) { isoLayer.current.remove(); isoLayer.current = null; }
    const lines = isoKey ? isoCache.current.get(isoKey) : null;
    if (!layers.pressure || !lines?.length) return;
    const ink = isDark ? 'rgba(255,255,255,0.82)' : 'rgba(20,28,40,0.78)';
    const g = L.layerGroup();
    for (const c of lines) {
      let longest = null;
      for (const ring of c.rings) {
        if (ring.length < 2) continue;
        L.polyline(ring, { pane: 'isobars', color: ink, weight: 1.4, opacity: 1, interactive: false, smoothFactor: 1.2 }).addTo(g);
        if (!longest || ring.length > longest.length) longest = ring;
      }
      if (longest) {
        L.marker(longest[Math.floor(longest.length / 2)], { pane: 'isobars', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'rs-iso-label', iconSize: [0, 0], html: `<span>${Math.round(c.value)}</span>` }) }).addTo(g);
      }
    }
    g.addTo(m);
    isoLayer.current = g;
  }, [isoKey, isoTick, layers.pressure, isDark]);

  /* ── the slider: grab it anywhere and drag; each step is an equal share of it ── */
  const track = useRef(null);
  const scrub = useRef(null);
  const n = frames.length;
  const stepAt = (x) => {
    const r = track.current.getBoundingClientRect();
    if (n < 2) return 0;
    return Math.max(0, Math.min(n - 1, Math.round(((x - r.left) / r.width) * (n - 1))));
  };
  const onDown = (e) => {
    if (!n || (e.pointerType === 'mouse' && e.button !== 0)) return;
    scrub.current = e.pointerId;
    try { track.current.setPointerCapture(e.pointerId); } catch { /* follows without */ }
    setPlaying(false);
    setIdx(stepAt(e.clientX));
  };
  const onMove = (e) => { if (scrub.current === e.pointerId) setIdx(stepAt(e.clientX)); };
  const onUp = (e) => { if (scrub.current === e.pointerId) scrub.current = null; };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setPlaying(false); setIdx((i) => Math.min(n - 1, i + 1)); }
    if (e.key === 'Home') { e.preventDefault(); setPlaying(false); setIdx(0); }
    if (e.key === 'End') { e.preventDefault(); setPlaying(false); setIdx(n - 1); }
  };

  const now = Date.now();
  const pct = (i) => (n < 2 ? 0 : (i / (n - 1)) * 100);
  const split = lastPast >= 0 ? pct(lastPast) : 100;     // where the radar ends and the forecast begins
  const isLive = f?.kind === 'radar';
  const runText = f?.run ? `${f.run.slice(9, 11)}Z run` : '';

  return (
    <div ref={rootRef} className={`rs${isDark ? '' : ' is-light'}`} style={{ '--rs-top': `${topOffset}px` }}
      onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div ref={mapEl} className="rs-map" aria-label="Rain radar map of the UK and Ireland" />

      {/* "Radar" on the map, a word under it, and the layers in glass beside it */}
      <div className="rs-top">
        <div className="rs-heading">
          <h1 className="lq-title">Radar</h1>
          <p className="lq-sub">{state === 'none' ? 'Not available just now' : 'Live radar · UKV forecast'}</p>
        </div>
        <button type="button" className={`lq lq-btn is-round${layersOpen ? ' is-on' : ''}`} onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} aria-label="Map layers">
          <Layers />
        </button>
      </div>

      {layersOpen && (
        <div className="rs-layers lq" role="dialog" aria-label="Map layers">
          <div className="rs-layers-head">
            <b>Map layers</b>
            <button type="button" onClick={() => setLayersOpen(false)} aria-label="Close the layers"><X /></button>
          </div>
          {LAYERS.map((l) => {
            const Icon = l.icon;
            return (
              <div key={l.id} className="rs-layer">
                <span className="rs-layer-icon" aria-hidden="true"><Icon /></span>
                <span className="rs-layer-text"><b>{l.name}</b><small>{l.id === 'lightning' && layers.lightning && strikes ? `${strikes.length.toLocaleString()} strikes in the last 3 hours` : l.note}</small></span>
                <button type="button" role="switch" aria-checked={!!layers[l.id]} aria-label={l.name} className="lq-switch" onClick={() => flip(l.id)} />
              </div>
            );
          })}
        </div>
      )}

      {/* the key, small in the top right corner: each kind on the same scale, light to heavy; folds to "Key" */}
      {!layersOpen && layers.radar && (
        <div className={`rs-key${keyOpen ? '' : ' is-closed'}`}>
          <button type="button" className="rs-key-head" onClick={() => setKeyOpen((o) => !o)} aria-expanded={keyOpen}>
            <span>{keyOpen ? 'mm/h' : 'Key'}</span>{keyOpen ? <ChevronUp /> : <ChevronDown />}
          </button>
          {keyOpen && (
            <div className="rs-key-body">
              {KIND_ORDER.map((k) => (
                <div key={k} className="rs-key-row">
                  <b>{RADAR_FAMILIES[k].name}</b>
                  <span className="rs-key-bar">
                    {Array.from({ length: KEY_CELLS }, (_, i) => <i key={i} style={{ background: rgb(familyColour(k, keyRate(i))) }} />)}
                  </span>
                </div>
              ))}
              <div className="rs-key-ticks" aria-hidden="true">
                {KEY_TICKS.map((t) => <span key={t} style={{ left: `${keyPos(t)}%` }}>{t}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* the time, as little as it can be (17 Nov 2026, at the user's request): play, the time and how long ago (or
          ahead, and which UKV run) on the left, and the slider, green for the radar and blue for the forecast */}
      <div className="rs-dock lq">
        <div className="rs-now">
          <button type="button" className="rs-play" onClick={() => setPlaying((p) => !p)} disabled={n < 2} aria-label={playing ? 'Pause' : 'Play'}>
            {playing && n > 1 ? <Pause /> : <Play />}
          </button>
          {f ? (
            <>
              <b className={`rs-time ${isLive ? 'is-live' : 'is-fc'}`}>{hhmm(f.valid)}</b>
              <small className="rs-rel">{relative(f.valid, now)}{!isLive && runText ? ` · UKV ${runText.replace(' run', '')}` : ''}</small>
            </>
          ) : (
            <span className="rs-loading">{state === 'none' ? 'No radar to show' : <><Loader2 className="animate-spin" />Loading…</>}</span>
          )}
        </div>
        <div ref={track} className="rs-track" role="slider" tabIndex={0} aria-label="Time"
          aria-valuemin={0} aria-valuemax={Math.max(0, n - 1)} aria-valuenow={idx}
          aria-valuetext={f ? `${isLive ? 'Live radar' : 'UKV forecast'} ${hhmm(f.valid)}` : 'Loading'}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
          style={{ '--rs-split': `${split}%`, '--rs-at': `${pct(idx)}%` }}>
          <div className="rs-rail">
            <span className="rs-rail-past" />
            <span className="rs-rail-fc" />
            {lastPast >= 0 && <i className="rs-tick is-now" style={{ left: `${pct(lastPast)}%` }} />}
            {n > 0 && <span className={`rs-thumb ${isLive ? 'is-live' : 'is-fc'}`} />}
          </div>
        </div>
      </div>
    </div>
  );
}
