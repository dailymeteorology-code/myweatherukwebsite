/* Met Office rain radar: the 1 km composite from the AWS bucket for the past three hours (the
   same radar and the same colours as the Model Data page), then the UKV model's rain for the
   next hours, played as one loop, with the Met Office's LEELA lightning on top if wanted.

     scope="point"  round a searched place (the Location page): a 400 km square at 1 km
     scope="uk"     the UK and Ireland (the home page): the radar coarsened to 2 km, keeping each
                    block's heaviest value so a small heavy shower still shows

   The server cuts each frame (server/locationWeather.js). Here each one is drawn once, pixel by
   pixel through the grid's ellipsoidal projection, into its own image over the map; playback only
   changes which image shows, so it never flickers. The map and its controls are one unit, dark, or
   light with `light` (the home page follows its own theme); the rain colours are the same in both. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Pause, Play, Radar, Zap } from 'lucide-react';
import {
  laeaInverse, mercHeight, paintRadarCrop, parseRadarCrop, RADAR_BANDS, radarBox, radarCropMapping, radarStamp, UK_RADAR_VIEW,
} from '@/lib/ukRadar';
import { hhmm } from '@/lib/ukvLocation';
import './location.css';

const VIEWS = {
  point: { halfKm: 195, outW: 840, zoom: 8, minZoom: 6, maxZoom: 10 },
  uk: { halfKm: UK_RADAR_VIEW.halfKm, outW: 820, minZoom: 5, maxZoom: 9, centre: [UK_RADAR_VIEW.lat, UK_RADAR_VIEW.lon], fit: [[49.8, -10.8], [59.3, 2.3]] },
};

/* a strike's colour by age: white when new, through yellow and orange, to red after three hours */
const AGE = [[0, '#ffffff'], [20, '#fde047'], [60, '#fb923c'], [120, '#ef4444'], [180, '#991b1b']];
const ageColour = (mins) => (AGE.findLast(([m]) => mins >= m) || AGE[0])[1];

/* Esri's plain canvas maps, dark or light to match the page; the place names sit above the rain */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const BASEMAP = {
  dark: [`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
  light: [`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
};

const pinIcon = L.divIcon({ className: 'lw-pin', html: '<span class="lw-pin-dot"></span><span class="lw-pin-ring"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

export default function LocationRadar({ lat, lon, scope = 'point', light = false }) {
  const V = VIEWS[scope] || VIEWS.point;
  const uk = scope === 'uk';
  const cLat = uk ? V.centre[0] : lat, cLon = uk ? V.centre[1] : lon;
  const el = useRef(null), map = useRef(null), pin = useRef(null), layers = useRef([]), boltLayer = useRef(null);
  const [frames, setFrames] = useState([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [state, setState] = useState('loading');
  const [bolts, setBolts] = useState(false);
  const [strikes, setStrikes] = useState(null);
  const [round, setRound] = useState(0);
  const made = useRef([]);

  const box = useMemo(() => radarBox(cLat, cLon, V.halfKm), [cLat, cLon, V.halfKm]);

  /* the map, made once */
  useEffect(() => {
    const touch = L.Browser.mobile;
    const m = L.map(el.current, {
      zoomControl: false, attributionControl: true, minZoom: V.minZoom, maxZoom: V.maxZoom, zoomSnap: 0.5,
      dragging: !touch, scrollWheelZoom: false, doubleClickZoom: true, touchZoom: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.createPane('labels');
    m.getPane('labels').style.zIndex = 650;
    m.getPane('labels').style.pointerEvents = 'none';
    if (scope === 'uk') m.fitBounds(V.fit, { animate: false });
    map.current = m;
    /* the box can change size after the map is made (the page still laying out, a phone turned):
       re-measure, and keep the UK framed until someone moves the map themselves */
    let moved = false;
    const mine = () => { moved = true; };
    ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.current.addEventListener(ev, mine, { passive: true }));
    const ro = new ResizeObserver(() => {
      m.invalidateSize({ animate: false });
      if (scope === 'uk' && !moved) m.fitBounds(V.fit, { animate: false });
    });
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* the base map, dark or light, and swapped whole when the page's theme changes. Not setUrl():
     its redraw asks for tiles at the map's fractional zoom ("tile/5.5/…"), which the tile server
     reads as zoom 5, so the UK's place on the map filled with tiles of India. */
  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    const [baseUrl, labelUrl] = BASEMAP[light ? 'light' : 'dark'];
    const made = [
      L.tileLayer(baseUrl, { attribution: '© Esri · radar and lightning © Met Office' }).addTo(m),
      L.tileLayer(labelUrl, { pane: 'labels' }).addTo(m),
    ];
    return () => made.forEach((t) => t.remove());
  }, [light]);

  useEffect(() => {
    const m = map.current;
    if (!m || uk || !Number.isFinite(lat)) return;
    m.setView([lat, lon], V.zoom, { animate: false });
    if (pin.current) pin.current.setLatLng([lat, lon]);
    else pin.current = L.marker([lat, lon], { icon: pinIcon, interactive: false, keyboard: false }).addTo(m);
  }, [lat, lon, uk, V.zoom]);

  /* the frames: fetched four at a time, each drawn once into its own image layer. The newest radar
     scan is drawn first and shown on its own straight away, while the rest of the loop is drawn;
     on a refresh the old set stays up until the new one is ready, so the map never blanks. */
  useEffect(() => {
    const ac = new AbortController();
    const urls = [];
    let alive = true, first = null;
    if (!layers.current.length) setState('loading');
    (async () => {
      try {
        const index = await fetch('/api/location/radar', { signal: ac.signal }).then((r) => r.json());
        const at = uk ? 'scope=uk' : `lat=${cLat.toFixed(3)}&lon=${cLon.toFixed(3)}`;
        const list = [
          ...index.past.map((t) => ({ kind: 'radar', valid: t, url: `/api/location/radar/frame?src=radar&t=${radarStamp(t)}&${at}` })),
          ...index.future.map((f) => ({ kind: 'ukv', valid: f.valid, url: `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&${at}` })),
        ];
        if (!list.length) { if (!layers.current.length) setState('none'); return; }
        const W = V.outW;
        const H = mercHeight(box, W);
        const maps = {};
        const out = new Array(list.length).fill(null);
        const newest = Math.max(0, index.past.length - 1);
        const order = [newest, ...list.keys()].filter((k, i) => i === 0 || k !== newest);
        let next = 0;
        const worker = async () => {
          while (next < order.length && alive) {
            const k = order[next++];
            try {
              const buf = await fetch(list[k].url, { signal: ac.signal }).then((r) => (r.ok ? r.arrayBuffer() : null));
              if (!buf || !alive) continue;
              const crop = parseRadarCrop(buf);
              const key = `${crop.head.x0}|${crop.head.y0}|${crop.head.dx}|${crop.head.nx}|${crop.head.ny}`;
              maps[key] = maps[key] || radarCropMapping(crop.head, box, W, H);
              const url = await paintRadarCrop(crop, maps[key], W, H);
              urls.push(url);
              out[k] = { ...list[k], img: url };
              if (k === newest && alive && map.current && !layers.current.length) {
                first = L.imageOverlay(url, [[box.latMin, box.lonMin], [box.latMax, box.lonMax]], { opacity: 0.88, interactive: false }).addTo(map.current);
                setFrames([out[k]]); setIdx(0); setState('ready');
              }
            } catch { /* a missing frame is skipped */ }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (!alive || !map.current) return;
        if (first) { first.remove(); first = null; }
        const ok = out.filter(Boolean);
        if (!ok.length) { if (!layers.current.length) setState('none'); return; }
        const bounds = [[box.latMin, box.lonMin], [box.latMax, box.lonMax]];
        const lastPast = ok.map((f) => f.kind).lastIndexOf('radar');
        layers.current.forEach((l) => l.remove());
        made.current.forEach((u) => URL.revokeObjectURL(u));
        layers.current = ok.map((f, i) => L.imageOverlay(f.img, bounds, { opacity: i === Math.max(0, lastPast) ? 0.88 : 0, interactive: false }).addTo(map.current));
        made.current = urls.splice(0);
        setFrames(ok);
        setIdx(Math.max(0, lastPast));
        setState('ready');
      } catch (e) {
        if (alive && e?.name !== 'AbortError' && !layers.current.length) setState('none');
      }
    })();
    return () => {
      alive = false;
      ac.abort();
      if (first) first.remove();
      urls.forEach((u) => URL.revokeObjectURL(u));   // drawn for a set that never went up
    };
  }, [cLat, cLon, box, uk, V.outW, round]);

  /* a new radar scan lands every fifteen minutes: look again every five while the page is in view */
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') setRound((r) => r + 1); }, 5 * 60e3);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => {
    layers.current.forEach((l) => l.remove());
    made.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  /* lightning: the Met Office LEELA strikes of the last three hours, every two minutes while on */
  useEffect(() => {
    if (!bolts) { setStrikes(null); return undefined; }
    let alive = true;
    const load = () => fetch('/api/modeldata/live/lightning').then((r) => r.json()).then((j) => {
      if (!alive) return;
      const since = Date.now() - 3 * 36e5;
      setStrikes((j.strikes || []).filter((s) => s[0] >= since).map(([t, gx, gy]) => {
        const [slon, slat] = laeaInverse(gx * 2000 - 1159000, 903000 - gy * 2000);   // grid cell -> metres -> lon/lat
        return [t, slat, slon];
      }));
    }).catch(() => { if (alive) setStrikes([]); });
    load();
    const t = setInterval(load, 120e3);
    return () => { alive = false; clearInterval(t); };
  }, [bolts]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (boltLayer.current) { boltLayer.current.remove(); boltLayer.current = null; }
    if (!strikes?.length) return;
    const renderer = L.canvas({ padding: 0.2 });
    const now = Date.now();
    boltLayer.current = L.layerGroup(strikes.map(([t, la, lo]) => L.circleMarker([la, lo], {
      renderer, radius: 3, weight: 1, color: 'rgba(0,0,0,0.55)', fillColor: ageColour((now - t) / 60e3), fillOpacity: 0.95, interactive: false,
    }))).addTo(m);
  }, [strikes]);

  /* show one frame */
  useEffect(() => {
    layers.current.forEach((l, i) => l.setOpacity(i === idx ? 0.88 : 0));
  }, [idx, frames]);

  /* play: a beat per frame, a longer pause on the newest radar and at the end */
  const lastPast = frames.map((f) => f.kind).lastIndexOf('radar');
  useEffect(() => {
    if (!playing || frames.length < 2) return undefined;
    const hold = idx === lastPast || idx === frames.length - 1 ? 1500 : 520;
    const t = setTimeout(() => setIdx((i) => (i + 1) % frames.length), hold);
    return () => clearTimeout(t);
  }, [playing, idx, frames.length, lastPast]);

  const f = frames[idx];
  return (
    <div className={`lw-radar${uk ? ' is-uk' : ''}${light ? ' is-light' : ''}`}>
      {/* the map with only the time and the zoom buttons on it; the controls sit in the dark strip
          underneath, so nothing overlaps however narrow the screen */}
      <div className="lw-radar-box">
        <div className="lw-radar-map" ref={el} />
        {state !== 'ready' && (
          <div className="lw-radar-note">{state === 'loading' ? 'Loading radar…' : 'Radar is not available right now.'}</div>
        )}
        {f && (
          <div className="lw-radar-time">
            <span className={`lw-tag ${f.kind === 'radar' ? 'is-obs' : 'is-fc'}`}>{f.kind === 'radar' ? 'Radar' : 'Forecast'}</span>
            {hhmm(Date.parse(f.valid))}
          </div>
        )}
      </div>
      <div className="lw-radar-foot">
        <div className="lw-radar-bar">
          <button type="button" className="lw-radar-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause radar' : 'Play radar'} disabled={frames.length < 2}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <div className="lw-radar-ticks" role="slider" aria-label="Radar time" aria-valuemin={0} aria-valuemax={Math.max(0, frames.length - 1)} aria-valuenow={idx}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { setPlaying(false); setIdx((i) => Math.min(frames.length - 1, i + 1)); }
              if (e.key === 'ArrowLeft') { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }
            }}>
            {frames.map((fr, i) => (
              <button key={fr.valid + fr.kind} type="button" tabIndex={-1} onClick={() => { setPlaying(false); setIdx(i); }}
                className={`lw-tick ${fr.kind === 'radar' ? 'is-obs' : 'is-fc'}${i === idx ? ' is-on' : ''}${i === lastPast ? ' is-now' : ''}`}
                aria-label={`${fr.kind === 'radar' ? 'Radar' : 'Forecast'} ${hhmm(Date.parse(fr.valid))}`} />
            ))}
          </div>
          <button type="button" className={`lw-radar-btn is-wide${bolts ? ' is-on' : ''}`} onClick={() => setBolts((b) => !b)} aria-pressed={bolts} title="Lightning in the last three hours">
            <Zap size={14} />{bolts && strikes ? `${strikes.length.toLocaleString()} strike${strikes.length === 1 ? '' : 's'}` : 'Lightning'}
          </button>
        </div>
        <div className="lw-radar-key">
          <Radar size={12} />
          {RADAR_BANDS.slice(0, 8).map((b) => <span key={b.id}><i style={{ background: b.color }} />{b.short.toLowerCase()}</span>)}
        </div>
        <div className="lw-radar-split">
          {lastPast >= 0 && lastPast < frames.length - 1 ? 'Grey steps: Met Office radar, every 15 minutes · blue steps: UKV forecast rain.' : 'Met Office radar, every 15 minutes.'}
          {bolts && strikes && (strikes.length ? ' Lightning (Met Office): white is new, red is three hours old.' : ' No lightning in the last three hours.')}
        </div>
      </div>
    </div>
  );
}
