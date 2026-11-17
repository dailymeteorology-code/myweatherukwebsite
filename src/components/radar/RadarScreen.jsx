/* ════════════════════════════════════════════════════════════════════════════
   The Radar tab (17 Nov 2026, at the user's request: "the whole page should be the radar, with a key like on the
   Model Data page, and the past and the future with the UKV; a time slider that is really easy to move, clear
   whether it is live data or UKV future data").

   The map fills the screen. "Radar" is written on it, and beside it a Layers button of Liquid Glass turns on the
   rain radar, lightning, pressure lines and satellite. The Met Office's 1 km rain radar for the last three hours
   (every 15 minutes) and then the newest UKV run's rain for up to nine hours ahead (every hour) are one timeline
   in a small glass dock above the tab bar: play, RADAR or UKV, the time, and a thin slider you can grab anywhere,
   green for the radar and blue for the forecast with Now between them. The key sits small in the top right.

   Sharp and quick (17 Nov 2026, the user: "significantly faster, to a point it is basically instant", and "stopped
   at the current latest scan, it doesn't move unless the user wants to"): the frames come from radarFeed.js, which
   fetches the newest scan before the tab is first opened; each frame is drawn at 1200 px across from the 1 km radar
   (the UKV's own 2 km grid ahead) straight into one canvas on the map when it is shown, about 20 ms, with no
   picture files made. The tab opens paused on the newest scan, stays on the newest as new scans come in, and moves
   only when play is pressed or the slider is moved.

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
import { drawRadarFrame, laeaInverse, mercHeight, radarBox, UK_RADAR_VIEW } from '@/lib/ukRadar';
import { familyColour, KIND_ORDER, RADAR_FAMILIES, loadFrame, loadLive, pressureLines, withGrid } from '@/lib/modelViewer';
import { projection } from '@/lib/modelGrids';
import { localPlaces } from '@/lib/location/places';
import { loadRadar, subscribeRadar } from './radarFeed';
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

/* Leaflet's picture layer with a canvas in place of an <img> (as its own L.SVGOverlay takes an element): each frame
   is drawn into it straight from its bytes, with no picture file made and read back */
const CanvasOverlay = L.ImageOverlay.extend({
  _initImage() {
    const el = (this._image = this._url);
    L.DomUtil.addClass(el, 'leaflet-image-layer');
    if (this._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
    if (this.options.className) L.DomUtil.addClass(el, this.options.className);
    el.onselectstart = L.Util.falseFn;
    el.onmousemove = L.Util.falseFn;
  },
});

/* the newest radar scan that is ready to show (else the newest scan) */
function newestScan(frames) {
  let last = -1;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].kind !== 'radar') continue;
    if (frames[i].ready) return i;
    if (last < 0) last = i;
  }
  return last;
}

export default function RadarScreen() {
  const { isDark } = useTheme();
  const active = useSectionActive();
  const rootRef = useRef(null), mapEl = useRef(null), mapRef = useRef(null);
  const overlay = useRef(null), canvasEl = useRef(null), pix = useRef(null), drawn = useRef('');
  const boltLayer = useRef(null), satLayer = useRef(null), isoLayer = useRef(null);
  /* the frames (radarFeed.js): each { kind, valid, url, ready, crop, tcrop, run? } */
  const [feed, setFeed] = useState(null);
  useEffect(() => subscribeRadar(setFeed), []);
  const frames = feed?.frames || [];
  const state = feed?.state || 'loading';
  const ukvRun = feed?.run || null;                       // { tag, runMs, steps } of the forecast part
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  /* on the newest scan until moved by hand; back on it when left there */
  const follow = useRef(true);
  const shownAt = useRef(null);                           // the time on show, kept when the frames change
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
    /* in the iPhone app the app answers (its bridge); the page's own permission says "denied" there */
    else if (window.__mwukBridge) locate();
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

  /* the map, made once, with the canvas the radar is drawn into */
  const frameRef = useRef(null);
  useEffect(() => {
    const el = mapEl.current;
    const m = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 11, zoomSnap: 0.25 });
    m.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'topright' }).addTo(m);
    m.createPane('sat'); m.getPane('sat').style.zIndex = 250;
    m.createPane('isobars'); m.getPane('isobars').style.zIndex = 450; m.getPane('isobars').style.pointerEvents = 'none';
    m.createPane('labels'); m.getPane('labels').style.zIndex = 650; m.getPane('labels').style.pointerEvents = 'none';
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = mercHeight(box, W);
    canvasEl.current = cv;
    overlay.current = new CanvasOverlay(cv, bounds, { opacity: 0, interactive: false, className: 'rs-frame' }).addTo(m);
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

  /* the frames (radarFeed.js): everything the timeline needs whenever the tab comes on show (the newest scan is
     usually in already), and the list of scans read again every five minutes while it shows */
  useEffect(() => {
    if (!active) return undefined;
    loadRadar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadRadar(true); }, 5 * 60e3);
    return () => clearInterval(t);
  }, [active]);

  /* Which frame is on show as the frames change: the newest scan while following it (from the start, and whenever
     left on it), else the same time as before. Nothing moves on its own. */
  const lastPast = frames.map((f) => f.kind).lastIndexOf('radar');
  useEffect(() => {
    if (!frames.length) return;
    if (follow.current) { setIdx(Math.max(0, newestScan(frames))); return; }
    const at = shownAt.current;
    let best = 0;
    frames.forEach((fr, i) => { if (Math.abs(fr.valid - at) < Math.abs(frames[best].valid - at)) best = i; });
    setIdx(best);
  }, [frames]);
  useEffect(() => { if (frames[idx]) shownAt.current = frames[idx].valid; }, [idx, frames]);
  /* moved by hand: following the newest scan again only when left on it */
  const pick = (i, play = false) => {
    follow.current = !play && i === lastPast;
    setIdx(i);
  };

  /* the frame on show, drawn into the map's canvas when it changes; while one is still on its way the last picture
     stays, faded, and the time says it is loading */
  const f = frames[idx];
  useEffect(() => {
    const ov = overlay.current, cv = canvasEl.current;
    if (!ov || !cv) return;
    if (!layers.radar) { ov.setOpacity(0); return; }
    if (!f?.ready) { ov.setOpacity(drawn.current ? OPACITY * 0.35 : 0); return; }
    const key = `${f.url}|${f.tcrop ? 1 : 0}`;
    if (drawn.current !== key) {
      const ctx = cv.getContext('2d');
      if (!pix.current) pix.current = ctx.createImageData(cv.width, cv.height);
      drawRadarFrame(pix.current, f.crop, box, f.tcrop);
      ctx.putImageData(pix.current, 0, 0);
      drawn.current = key;
    }
    ov.setOpacity(OPACITY);
  }, [f, layers.radar, box]);

  /* playing (only when asked): a beat a frame, a longer pause on Now and at the end, each frame waited for if it is
     not in yet; it rests while another tab shows */
  const nextReady = frames.length > 1 && !!frames[(idx + 1) % frames.length]?.ready;
  useEffect(() => {
    if (!playing || !active || !nextReady) return undefined;   // a frame not in yet: comes round again when it is
    const hold = idx === lastPast || idx === frames.length - 1 ? 1400 : 520;
    const t = setTimeout(() => setIdx((idx + 1) % frames.length), hold);
    return () => clearTimeout(t);
  }, [playing, active, idx, frames.length, lastPast, nextReady]);
  const togglePlay = () => {
    if (playing) { setPlaying(false); follow.current = idx === lastPast; return; }
    follow.current = false;
    if (idx >= frames.length - 1) setIdx(0);                // from the start again after the end
    setPlaying(true);
  };

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
    pick(stepAt(e.clientX));
  };
  const onMove = (e) => { if (scrub.current === e.pointerId) pick(stepAt(e.clientX)); };
  const onUp = (e) => { if (scrub.current === e.pointerId) scrub.current = null; };
  const onKey = (e) => {
    const go = (i) => { e.preventDefault(); setPlaying(false); pick(Math.max(0, Math.min(n - 1, i))); };
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') go(idx - 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') go(idx + 1);
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(n - 1);
  };

  const now = Date.now();
  const pct = (i) => (n < 2 ? 0 : (i / (n - 1)) * 100);
  const split = lastPast >= 0 ? pct(lastPast) : 100;     // where the radar ends and the forecast begins
  const isLive = f?.kind === 'radar';
  const runText = f?.run ? `${f.run.slice(9, 11)}Z run` : '';

  return (
    /* touches are not stopped here: the map follows a pinch from the document (Leaflet's TouchZoom listens there) */
    <div ref={rootRef} className={`rs${isDark ? '' : ' is-light'}`} style={{ '--rs-top': `${topOffset}px` }}>
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
          <button type="button" className="rs-play" onClick={togglePlay} disabled={n < 2} aria-label={playing ? 'Pause' : 'Play'}>
            {playing && n > 1 ? <Pause /> : <Play />}
          </button>
          {f ? (
            <>
              <b className={`rs-time ${isLive ? 'is-live' : 'is-fc'}`}>{hhmm(f.valid)}</b>
              <small className="rs-rel">
                {f.ready ? <>{relative(f.valid, now)}{!isLive && runText ? ` · UKV ${runText.replace(' run', '')}` : ''}</> : <><Loader2 className="animate-spin" />Loading</>}
              </small>
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
