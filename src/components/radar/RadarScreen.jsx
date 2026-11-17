/* ════════════════════════════════════════════════════════════════════════════
   The Radar tab (17 Nov 2026, at the user's request: "the whole page should be the radar, with a key like on the
   Model Data page, and be able to see the past and the future with the UKV; make it really easy to move the
   time slider, with it clear whether it is live data or UKV future data").

   The map fills the screen. The Met Office's 1 km rain radar for the last three hours (every 15 minutes) and
   then the UKV model's rain for up to nine hours ahead (every hour) are one timeline in a glass dock above the
   tab bar: a wide slider you can grab anywhere and drag, its radar part and its forecast part in different
   colours with Now between them, and the time shown large with a label saying which it is: LIVE RADAR or UKV
   FORECAST. The key (each kind of precipitation, light to heavy, on the same scale) sits above the dock.

   The data are the radar the Location page shows (server/locationWeather.js /api/location/radar, the UK and
   Ireland at 2 km), each frame drawn once into its own image over the map (lib/ukRadar), so playing and
   scrubbing only change which image shows.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Pause, Play, Zap, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useSectionActive } from '@/components/app/sectionActive';
import { laeaInverse, mercHeight, paintRadarCrop, parseRadarCrop, radarBox, radarCropMapping, radarStamp, UK_RADAR_VIEW } from '@/lib/ukRadar';
import { familyColour, KIND_ORDER, RADAR_FAMILIES } from '@/lib/modelViewer';
import './radar-screen.css';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const BASEMAP = {
  dark: [`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
  light: [`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
};
const FIT = [[49.8, -10.8], [59.3, 2.3]];
const W = 900;                                   // each frame's picture, px across
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

/* "now", "45 min ago", "in 2 h" */
function relative(ms, now) {
  const min = Math.round((ms - now) / 6e4);
  if (Math.abs(min) < 8) return 'now';
  const a = Math.abs(min);
  const txt = a < 60 ? `${a} min` : `${Math.floor(a / 60)} h${a % 60 >= 8 ? ` ${Math.round((a % 60) / 15) * 15} min` : ''}`;
  return min < 0 ? `${txt} ago` : `in ${txt}`;
}

export default function RadarScreen() {
  const { isDark } = useTheme();
  const active = useSectionActive();
  const rootRef = useRef(null), mapEl = useRef(null), mapRef = useRef(null), layers = useRef([]), made = useRef([]), boltLayer = useRef(null);
  const [frames, setFrames] = useState([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [state, setState] = useState('loading');
  const [round, setRound] = useState(0);
  const [bolts, setBolts] = useState(false);
  const [strikes, setStrikes] = useState(null);
  const [keyOpen, setKeyOpen] = useState(() => { try { return localStorage.getItem('mwuk_radar_key') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('mwuk_radar_key', keyOpen ? '1' : '0'); } catch { /* blocked */ } }, [keyOpen]);
  const box = useMemo(() => radarBox(UK_RADAR_VIEW.lat, UK_RADAR_VIEW.lon, UK_RADAR_VIEW.halfKm), []);

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

  /* the map, made once */
  useEffect(() => {
    const el = mapEl.current;
    const m = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 10, zoomSnap: 0.25 });
    m.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'topright' }).addTo(m);
    m.createPane('labels');
    m.getPane('labels').style.zIndex = 650;
    m.getPane('labels').style.pointerEvents = 'none';
    mapRef.current = m;
    const frame = () => {
      const r = rootRef.current?.getBoundingClientRect();
      const dock = rootRef.current?.querySelector('.rs-dock')?.getBoundingClientRect();
      const top = rootRef.current?.querySelector('.rs-top')?.getBoundingClientRect();
      const padTop = r && top ? top.bottom - r.top + 6 : 60;
      const padBottom = r && dock ? r.bottom - dock.top + 6 : 160;
      try { m.fitBounds(FIT, { animate: false, paddingTopLeft: [6, padTop], paddingBottomRight: [6, padBottom] }); } catch { /* not laid out */ }
    };
    let moved = false;
    const mine = () => { moved = true; };
    ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.addEventListener(ev, mine, { passive: true }));
    const ro = new ResizeObserver(() => { m.invalidateSize({ animate: false }); if (!moved) frame(); });
    ro.observe(el);
    requestAnimationFrame(frame);
    return () => { ro.disconnect(); ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.removeEventListener(ev, mine)); m.remove(); mapRef.current = null; };
  }, []);

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

  /* the frames: the radar's and the UKV's, fetched four at a time and each drawn once; the newest radar scan
     first, shown on its own straight away; on a refresh the old set stays up until the new one is ready */
  useEffect(() => {
    const ac = new AbortController();
    const urls = [];
    let alive = true, first = null;
    if (!layers.current.length) setState('loading');
    (async () => {
      try {
        const index = await fetch('/api/location/radar', { signal: ac.signal }).then((r) => r.json());
        const at = 'scope=uk';
        const typed = new Set(index.pastTyped || []);
        const list = [
          ...(index.past || []).map((t) => ({
            kind: 'radar', valid: Date.parse(t), url: `/api/location/radar/frame?src=radar&t=${radarStamp(t)}&${at}`,
            typeUrl: typed.has(t) ? `/api/location/radar/frame?src=radar&t=${radarStamp(t)}&kind=type&${at}` : null,
          })),
          ...(index.future || []).map((f) => ({
            kind: 'ukv', valid: Date.parse(f.valid), run: f.run, url: `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&${at}`,
            typeUrl: f.typed ? `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&kind=type&${at}` : null,
          })),
        ];
        if (!list.length) { if (!layers.current.length) setState('none'); return; }
        const H = mercHeight(box, W);
        const maps = {};
        const out = new Array(list.length).fill(null);
        const newest = Math.max(0, (index.past || []).length - 1);
        const order = [newest, ...list.keys()].filter((k, i) => i === 0 || k !== newest);
        let next = 0;
        const bounds = [[box.latMin, box.lonMin], [box.latMax, box.lonMax]];
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
              if (k === newest && alive && mapRef.current && !layers.current.length) {
                first = L.imageOverlay(url, bounds, { opacity: OPACITY, interactive: false }).addTo(mapRef.current);
                setFrames([out[k]]); setIdx(0); setState('ready');
              }
            } catch { /* a missing frame is skipped */ }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (!alive || !mapRef.current) return;
        if (first) { first.remove(); first = null; }
        const ok = out.filter(Boolean);
        if (!ok.length) { if (!layers.current.length) setState('none'); return; }
        const lastPast = ok.map((f) => f.kind).lastIndexOf('radar');
        layers.current.forEach((l) => l.remove());
        made.current.forEach((u) => URL.revokeObjectURL(u));
        layers.current = ok.map((f, i) => L.imageOverlay(f.img, bounds, { opacity: i === Math.max(0, lastPast) ? OPACITY : 0, interactive: false }).addTo(mapRef.current));
        made.current = urls.splice(0);
        setFrames(ok);
        setIdx((i) => (round === 0 ? Math.max(0, lastPast) : Math.min(i, ok.length - 1)));
        setState('ready');
      } catch (e) {
        if (alive && e?.name !== 'AbortError' && !layers.current.length) setState('none');
      }
    })();
    return () => { alive = false; ac.abort(); if (first) first.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [box, round]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { layers.current.forEach((l) => l.remove()); made.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  /* a new scan every fifteen minutes: look again every five while the tab is on show */
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') setRound((r) => r + 1); }, 5 * 60e3);
    return () => clearInterval(t);
  }, [active]);

  /* lightning: the Met Office's strikes of the last three hours, every two minutes while on */
  useEffect(() => {
    if (!bolts || !active) { if (!bolts) setStrikes(null); return undefined; }
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
  }, [bolts, active]);
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

  /* one frame on show */
  useEffect(() => { layers.current.forEach((l, i) => l.setOpacity(i === idx ? OPACITY : 0)); }, [idx, frames]);

  /* playing: a beat a frame, a longer pause on Now and at the end; it rests while another tab shows */
  const lastPast = frames.map((f) => f.kind).lastIndexOf('radar');
  useEffect(() => {
    if (!playing || !active || frames.length < 2) return undefined;
    const hold = idx === lastPast || idx === frames.length - 1 ? 1400 : 480;
    const t = setTimeout(() => setIdx((i) => (i + 1) % frames.length), hold);
    return () => clearTimeout(t);
  }, [playing, active, idx, frames.length, lastPast]);

  /* ── the slider: grab it anywhere and drag; each step is an equal share of it ── */
  const track = useRef(null);
  const scrub = useRef(null);
  const stepAt = (x) => {
    const r = track.current.getBoundingClientRect();
    const n = frames.length;
    if (n < 2) return 0;
    return Math.max(0, Math.min(n - 1, Math.round(((x - r.left) / r.width) * (n - 1))));
  };
  const onDown = (e) => {
    if (!frames.length || (e.pointerType === 'mouse' && e.button !== 0)) return;
    scrub.current = e.pointerId;
    try { track.current.setPointerCapture(e.pointerId); } catch { /* follows without */ }
    setPlaying(false);
    setIdx(stepAt(e.clientX));
  };
  const onMove = (e) => { if (scrub.current === e.pointerId) setIdx(stepAt(e.clientX)); };
  const onUp = (e) => { if (scrub.current === e.pointerId) scrub.current = null; };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setPlaying(false); setIdx((i) => Math.min(frames.length - 1, i + 1)); }
    if (e.key === 'Home') { e.preventDefault(); setPlaying(false); setIdx(0); }
    if (e.key === 'End') { e.preventDefault(); setPlaying(false); setIdx(frames.length - 1); }
  };

  const f = frames[idx];
  const n = frames.length;
  const now = Date.now();
  const pct = (i) => (n < 2 ? 0 : (i / (n - 1)) * 100);
  const split = lastPast >= 0 ? pct(lastPast) : 100;     // where the radar ends and the forecast begins
  const isLive = f?.kind === 'radar';
  const futureCount = n - 1 - lastPast;
  const hoursAhead = futureCount > 0 && f ? Math.round((frames[n - 1].valid - frames[lastPast].valid) / 36e5) : 0;
  const run = frames.find((x) => x.kind === 'ukv')?.run;
  const runText = run ? `${run.slice(9, 11)}Z run` : '';
  return (
    <div ref={rootRef} className={`rs${isDark ? '' : ' is-light'}`} style={{ '--rs-top': `${topOffset}px` }}
      onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div ref={mapEl} className="rs-map" aria-label="Rain radar map of the UK and Ireland" />

      <div className="rs-top rs-glass">
        <div className="rs-title">
          <b>Radar</b>
          <span>{state === 'none' ? 'The radar is not available just now' : `Live radar for the last 3 h${futureCount > 0 ? `, then the UKV for ${hoursAhead} h` : ''}`}</span>
        </div>
        <button type="button" className={`rs-btn${bolts ? ' is-on' : ''}`} onClick={() => setBolts((b) => !b)} aria-pressed={bolts} title="Lightning in the last three hours">
          <Zap />{bolts && strikes ? strikes.length.toLocaleString() : 'Lightning'}
        </button>
      </div>

      {/* the key, small in the top right corner (17 Nov 2026, at the user's request): each kind on the same scale,
          light to heavy, on a soft fade rather than in a box; tap its title to fold it away */}
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
            {bolts && <p className="rs-key-note"><i style={{ background: '#fff' }} /><i style={{ background: '#fde047' }} /><i style={{ background: '#fb923c' }} /><i style={{ background: '#ef4444' }} />Lightning: new to 3 h old</p>}
          </div>
        )}
      </div>

      {/* the time, small and simple (17 Nov 2026, at the user's request): play, which kind of data it is in a
          word and a colour, the time, and the slider under them */}
      <div className="rs-dock rs-glass">
        <div className="rs-now">
          <button type="button" className="rs-play" onClick={() => setPlaying((p) => !p)} disabled={n < 2} aria-label={playing ? 'Pause' : 'Play'}>
            {playing && n > 1 ? <Pause /> : <Play />}
          </button>
          {f ? (
            <>
              <span className={`rs-badge ${isLive ? 'is-live' : 'is-fc'}`}>{isLive ? 'Radar' : 'UKV'}</span>
              <b className="rs-time">{hhmm(f.valid)}</b>
              <small className="rs-rel">{relative(f.valid, now)}{!isLive && runText ? ` · ${runText}` : ''}</small>
            </>
          ) : (
            <span className="rs-loading">{state === 'none' ? 'No radar to show' : <><Loader2 className="animate-spin" />Loading…</>}</span>
          )}
          {lastPast >= 0 && idx !== lastPast && (
            <button type="button" className="rs-tonow" onClick={() => { setPlaying(false); setIdx(lastPast); }}>Now</button>
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
            {frames.map((fr, i) => <i key={`${fr.kind}${fr.valid}`} className={`rs-tick ${fr.kind === 'radar' ? 'is-live' : 'is-fc'}${i === lastPast ? ' is-now' : ''}`} style={{ left: `${pct(i)}%` }} />)}
            {n > 0 && <span className={`rs-thumb ${isLive ? 'is-live' : 'is-fc'}`} />}
          </div>
        </div>
      </div>
    </div>
  );
}
