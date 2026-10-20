/* Rain radar round the searched place: the Met Office 1 km composite from the AWS bucket for
   the past three hours (the same radar as the Model Data page), then the UKV model's rain for
   the next hours, played as one loop.

   The server cuts a 400 km square round the place out of each frame (server/locationWeather.js).
   Here each crop is drawn once, pixel by pixel through the grid's ellipsoidal projection, into
   its own image over the map; playback only changes which image shows, so it never flickers. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Pause, Play, Radar } from 'lucide-react';
import { colourAt, scaleFor } from '@/lib/modelViewer';
import { laea, RADAR_BANDS } from '@/lib/ukRadar';
import { hhmm } from '@/lib/ukvLocation';

const D = Math.PI / 180;
const HALF_KM = 195;                                   // just inside the server's 200 km crop
const OUT_W = 840;                                     // ~2 px a kilometre: crisp when zoomed in on a phone
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
const stampOf = (iso) => iso.replace(/[-:]/g, '').slice(0, 13);

function parseCrop(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  return { head, q: new Uint8Array(buf, 4 + n, head.nx * head.ny) };
}

/* per output pixel: where it falls in a crop (top-left index and bilinear weights) */
function mapping(head, box, W, H) {
  const idx = new Int32Array(W * H).fill(-1), tx = new Float32Array(W * H), ty = new Float32Array(W * H);
  const yt = mercY(box.latMax), yb = mercY(box.latMin);
  for (let py = 0; py < H; py++) {
    const lat = Math.atan(Math.sinh(yt - ((py + 0.5) / H) * (yt - yb))) / D;
    for (let px = 0; px < W; px++) {
      const lon = box.lonMin + ((px + 0.5) / W) * (box.lonMax - box.lonMin);
      const [x, y] = laea(lon, lat);
      const fx = (x - head.x0) / head.dx, fy = (head.y0 - y) / head.dx;
      const i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i >= head.nx - 1 || j >= head.ny - 1) continue;
      const k = py * W + px;
      idx[k] = j * head.nx + i; tx[k] = fx - i; ty[k] = fy - j;
    }
  }
  return { idx, tx, ty };
}

function paint(crop, map, W, H) {
  const sc = scaleFor('radar');
  const { lo, hi, scale } = crop.head;
  const a = scale === 'sqrt' ? Math.sqrt(Math.max(lo, 0)) : lo, b = scale === 'sqrt' ? Math.sqrt(hi) : hi;
  const lut = new Uint32Array(256);
  for (let v = 0; v < 255; v++) {
    const val = scale === 'sqrt' ? (a + (v / 254) * (b - a)) ** 2 : a + (v / 254) * (b - a);
    const c = colourAt(sc, val);
    if (c) lut[v] = (c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const out = new Uint32Array(img.data.buffer);
  const { q } = crop, nx = crop.head.nx;
  const qv = (k) => (q[k] === 255 ? 0 : q[k]);
  for (let k = 0; k < out.length; k++) {
    const i0 = map.idx[k];
    if (i0 < 0) continue;
    const tx = map.tx[k], ty = map.ty[k];
    const v = Math.round((qv(i0) * (1 - tx) + qv(i0 + 1) * tx) * (1 - ty) + (qv(i0 + nx) * (1 - tx) + qv(i0 + nx + 1) * tx) * ty);
    out[k] = lut[v];
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((ok) => cv.toBlob((bl) => ok(bl ? URL.createObjectURL(bl) : cv.toDataURL()), 'image/png'));
}

const pinIcon = L.divIcon({ className: 'lw-pin', html: '<span class="lw-pin-dot"></span><span class="lw-pin-ring"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

export default function LocationRadar({ lat, lon }) {
  const el = useRef(null), map = useRef(null), pin = useRef(null), layers = useRef([]);
  const [frames, setFrames] = useState([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [state, setState] = useState('loading');

  const box = useMemo(() => {
    const dLat = HALF_KM / 111.2, dLon = HALF_KM / (111.2 * Math.cos(lat * D));
    return { latMin: lat - dLat, latMax: lat + dLat, lonMin: lon - dLon, lonMax: lon + dLon };
  }, [lat, lon]);

  /* the map, made once */
  useEffect(() => {
    const touch = L.Browser.mobile;
    const m = L.map(el.current, {
      zoomControl: false, attributionControl: true, minZoom: 6, maxZoom: 10, zoomSnap: 0.5,
      dragging: !touch, scrollWheelZoom: false, doubleClickZoom: true, touchZoom: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri · radar © Met Office' }).addTo(m);
    m.createPane('labels');
    m.getPane('labels').style.zIndex = 650;
    m.getPane('labels').style.pointerEvents = 'none';
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { pane: 'labels' }).addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.setView([lat, lon], 8, { animate: false });
    if (pin.current) pin.current.setLatLng([lat, lon]);
    else pin.current = L.marker([lat, lon], { icon: pinIcon, interactive: false, keyboard: false }).addTo(m);
  }, [lat, lon]);

  /* the frames: fetched four at a time, each drawn once into its own image layer */
  useEffect(() => {
    const ac = new AbortController();
    const made = [];
    let alive = true;
    setState('loading'); setFrames([]); setIdx(0);
    layers.current.forEach((l) => l.remove());
    layers.current = [];
    (async () => {
      try {
        const index = await fetch('/api/location/radar', { signal: ac.signal }).then((r) => r.json());
        const at = `lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
        const list = [
          ...index.past.map((t) => ({ kind: 'radar', valid: t, url: `/api/location/radar/frame?src=radar&t=${stampOf(t)}&${at}` })),
          ...index.future.map((f) => ({ kind: 'ukv', valid: f.valid, url: `/api/location/radar/frame?src=ukv&run=${f.run}&h=${f.h}&${at}` })),
        ];
        if (!list.length) { setState('none'); return; }
        const H = Math.round((OUT_W * (mercY(box.latMax) - mercY(box.latMin))) / ((box.lonMax - box.lonMin) * D));
        const maps = {};
        const out = new Array(list.length).fill(null);
        let next = 0;
        const worker = async () => {
          while (next < list.length && alive) {
            const k = next++;
            try {
              const buf = await fetch(list[k].url, { signal: ac.signal }).then((r) => (r.ok ? r.arrayBuffer() : null));
              if (!buf || !alive) continue;
              const crop = parseCrop(buf);
              const key = `${crop.head.x0}|${crop.head.y0}|${crop.head.dx}|${crop.head.nx}|${crop.head.ny}`;
              maps[key] = maps[key] || mapping(crop.head, box, OUT_W, H);
              const url = await paint(crop, maps[key], OUT_W, H);
              made.push(url);
              out[k] = { ...list[k], img: url };
            } catch { /* a missing frame is skipped */ }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (!alive || !map.current) return;
        const ok = out.filter(Boolean);
        if (!ok.length) { setState('none'); return; }
        const bounds = [[box.latMin, box.lonMin], [box.latMax, box.lonMax]];
        layers.current = ok.map((f) => L.imageOverlay(f.img, bounds, { opacity: 0, interactive: false }).addTo(map.current));
        const lastPast = ok.map((f) => f.kind).lastIndexOf('radar');
        setFrames(ok);
        setIdx(Math.max(0, lastPast));
        setState('ready');
      } catch (e) {
        if (alive) setState(e?.name === 'AbortError' ? 'loading' : 'none');
      }
    })();
    return () => {
      alive = false;
      ac.abort();
      layers.current.forEach((l) => l.remove());
      layers.current = [];
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [lat, lon, box]);

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
    <div className="lw-radar">
      {/* the map, with only the time and the zoom buttons on it; the controls sit underneath, so
          nothing overlaps however narrow the screen */}
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
      {frames.length > 1 && (
        <div className="lw-radar-bar">
          <button type="button" className="lw-icon-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause radar' : 'Play radar'}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <div className="lw-radar-ticks" role="slider" aria-label="Radar time" aria-valuemin={0} aria-valuemax={frames.length - 1} aria-valuenow={idx}
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
        </div>
      )}
      <div className="lw-radar-key">
        <Radar size={12} />
        {RADAR_BANDS.slice(0, 8).map((b) => <span key={b.id}><i style={{ background: b.color }} />{b.short.toLowerCase()}</span>)}
        {lastPast >= 0 && lastPast < frames.length - 1 && <span className="lw-radar-split">Grey steps: radar · blue steps: UKV forecast</span>}
      </div>
    </div>
  );
}
