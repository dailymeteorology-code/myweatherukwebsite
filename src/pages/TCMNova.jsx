/* ════════════════════════════════════════════════════════════════════════════
   TCM NOVA — the thunderstorm model page.
   ────────────────────────────────────────────────────────────────────────────
   Laid out like the TCM V3 page (header bar, hero risk banner, days + hazards
   on the left, tabbed map panel on the right) but every number comes from the
   NOVA runs served by server/tcmNova.js — nothing from Open-Meteo.

   Two products, never mixed:
     TCM Main Run    2 km, 03/09/15/21 UK time, AWS multi-model blend
     TCM Hyper-Short 1.5 km, hourly, 24 h at 30 min, observations only
   Switching product changes the API path the page reads from, not just a label.
   The map timeline shows VALID times; the selected run's INIT time is shown
   separately so an old run with late valid times is never mistaken for new.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CloudLightning, Zap, CloudRain, Wind, Tornado, Snowflake, AlertTriangle, Play, Pause,
  ChevronLeft, ChevronRight, Layers, Clock, Database, Activity, Map as MapIcon, Info, RefreshCw,
} from 'lucide-react';

/* ── look (V3 light card style) ───────────────────────────────────────────── */
const T = {
  bg: '#eef2f7', card: '#ffffff', border: 'rgba(15,23,42,0.09)', text: '#0f172a', mid: '#475569',
  faint: '#94a3b8', sky: '#0284c7', orange: '#ea580c', soft: '#f8fafc',
};
const MONO = "'DM Mono',ui-monospace,monospace";
const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' };

const PRODUCTS = {
  main: { label: 'TCM Main Run', res: '2 km', blurb: 'Four runs a day · AWS multi-model blend · deterministic downscaling' },
  hyper: { label: 'TCM Hyper-Short', res: '1.5 km', blurb: 'Hourly · 24 h at 30 min · observations only, TCM engine' },
};

/* hazards shown in the left column: field, label, icon */
const HAZARDS = [
  { f: 'p_thunder', label: 'Thunderstorm', icon: CloudLightning },
  { f: 'p_lightning', label: 'Lightning', icon: Zap },
  { f: 'p_hail', label: 'Hail', icon: Snowflake },
  { f: 'p_wind_damaging', label: 'Damaging wind', icon: Wind },
  { f: 'p_supercell', label: 'Supercell', icon: Activity },
  { f: 'p_tornado_env', label: 'Tornado environment', icon: Tornado },
  { f: 'p_heavy_rain', label: 'Heavy rain', icon: CloudRain },
  { f: 'p_severe', label: 'Severe (any)', icon: AlertTriangle },
];

/* palettes: [value, rgba] stops; kind 'p' = probability 0..1 */
const PROB = [[0.02, [56, 189, 248, 0]], [0.05, [56, 189, 248, 120]], [0.15, [74, 222, 128, 160]], [0.3, [250, 204, 21, 180]],
  [0.45, [249, 115, 22, 195]], [0.6, [239, 68, 68, 205]], [0.8, [168, 85, 247, 215]]];
const LAYERS = {
  p_thunder: { label: 'Thunderstorm probability', unit: '%', stops: PROB, pct: true },
  p_lightning: { label: 'Lightning probability', unit: '%', stops: PROB, pct: true },
  p_hail: { label: 'Hail ≥2 cm probability', unit: '%', stops: PROB, pct: true },
  p_hail_sig: { label: 'Large hail ≥4 cm probability', unit: '%', stops: PROB, pct: true },
  p_wind_damaging: { label: 'Damaging gust probability', unit: '%', stops: PROB, pct: true },
  p_downburst: { label: 'Downburst probability', unit: '%', stops: PROB, pct: true },
  p_supercell: { label: 'Supercell probability', unit: '%', stops: PROB, pct: true },
  p_tornado_env: { label: 'Tornado-environment probability', unit: '%', stops: PROB, pct: true },
  p_heavy_rain: { label: 'Heavy rain probability', unit: '%', stops: PROB, pct: true },
  p_training: { label: 'Cell-training probability', unit: '%', stops: PROB, pct: true },
  p_severe: { label: 'Severe-weather probability', unit: '%', stops: PROB, pct: true },
  p_initiation: { label: 'New initiation probability', unit: '%', stops: PROB, pct: true },
  p_ci_orographic: { label: 'Orographic initiation (terrain part)', unit: '%', stops: PROB, pct: true },
  p_rain: { label: 'Rain ≥1 mm/h probability', unit: '%', stops: PROB, pct: true },
  precip: { label: 'Precipitation rate', unit: 'mm/h', stops: [[0.1, [147, 197, 253, 0]], [0.3, [96, 165, 250, 170]], [1, [37, 99, 235, 200]], [4, [250, 204, 21, 210]], [10, [249, 115, 22, 220]], [25, [220, 38, 38, 230]], [50, [168, 85, 247, 235]]] },
  precip_accum: { label: 'Accumulated precipitation', unit: 'mm', stops: [[0.5, [147, 197, 253, 0]], [2, [96, 165, 250, 160]], [10, [37, 99, 235, 195]], [25, [250, 204, 21, 205]], [50, [239, 68, 68, 220]], [100, [168, 85, 247, 230]]] },
  flash_density: { label: 'Lightning flash density', unit: '/km²/h', stops: [[0.005, [250, 204, 21, 0]], [0.02, [250, 204, 21, 170]], [0.1, [249, 115, 22, 200]], [0.5, [220, 38, 38, 220]], [2, [168, 85, 247, 235]]] },
  hail_size_max_cm: { label: 'Max hail size estimate', unit: 'cm', stops: [[0.5, [125, 211, 252, 0]], [1, [125, 211, 252, 170]], [2, [250, 204, 21, 200]], [3, [249, 115, 22, 215]], [5, [220, 38, 38, 230]]] },
  gust_max: { label: 'Max gust estimate', unit: 'mph', mul: 2.237, stops: [[25, [148, 163, 184, 0]], [35, [125, 211, 252, 150]], [45, [250, 204, 21, 190]], [58, [249, 115, 22, 210]], [70, [220, 38, 38, 225]]] },
  mu_cape: { label: 'MUCAPE', unit: 'J/kg', stops: [[50, [254, 240, 138, 0]], [150, [254, 240, 138, 150]], [400, [251, 191, 36, 180]], [800, [249, 115, 22, 200]], [1500, [220, 38, 38, 215]], [2500, [168, 85, 247, 230]]] },
  ml_cin: { label: 'MLCIN', unit: 'J/kg', stops: [[-400, [30, 64, 175, 210]], [-200, [59, 130, 246, 180]], [-75, [147, 197, 253, 140]], [-25, [191, 219, 254, 60]], [-5, [255, 255, 255, 0]]] },
  dcape: { label: 'DCAPE', unit: 'J/kg', stops: [[200, [203, 213, 225, 0]], [400, [148, 163, 184, 150]], [700, [250, 204, 21, 190]], [1000, [249, 115, 22, 210]], [1400, [220, 38, 38, 225]]] },
  shear_0_6km: { label: '0–6 km bulk shear', unit: 'kt', mul: 1.944, stops: [[10, [203, 213, 225, 0]], [20, [125, 211, 252, 150]], [30, [74, 222, 128, 175]], [40, [250, 204, 21, 195]], [50, [249, 115, 22, 210]], [60, [220, 38, 38, 225]]] },
  srh_0_1km: { label: '0–1 km SRH', unit: 'm²/s²', stops: [[25, [203, 213, 225, 0]], [50, [125, 211, 252, 150]], [100, [250, 204, 21, 190]], [150, [249, 115, 22, 210]], [250, [220, 38, 38, 225]]] },
  scp: { label: 'Supercell composite', unit: '', stops: [[0.25, [203, 213, 225, 0]], [0.5, [125, 211, 252, 150]], [1, [250, 204, 21, 190]], [2, [249, 115, 22, 210]], [4, [220, 38, 38, 225]]] },
  stp: { label: 'Significant tornado parameter', unit: '', stops: [[0.1, [203, 213, 225, 0]], [0.3, [125, 211, 252, 150]], [0.6, [250, 204, 21, 190]], [1, [249, 115, 22, 210]], [2, [220, 38, 38, 225]]] },
  lapse_700_500: { label: '700–500 hPa lapse rate', unit: 'K/km', stops: [[5, [203, 213, 225, 0]], [6, [125, 211, 252, 140]], [6.5, [250, 204, 21, 180]], [7, [249, 115, 22, 205]], [8, [220, 38, 38, 225]]] },
  pw: { label: 'Precipitable water', unit: 'mm', stops: [[10, [203, 213, 225, 0]], [18, [125, 211, 252, 140]], [25, [74, 222, 128, 170]], [32, [250, 204, 21, 195]], [40, [220, 38, 38, 220]]] },
  wbz: { label: 'Wet-bulb zero height', unit: 'm', stops: [[500, [59, 130, 246, 160]], [1500, [125, 211, 252, 140]], [2500, [250, 204, 21, 150]], [3500, [249, 115, 22, 170]]] },
  w_oro: { label: 'Orographic ascent (terrain diag.)', unit: 'm/s', stops: [[-0.6, [59, 130, 246, 200]], [-0.15, [147, 197, 253, 120]], [-0.03, [255, 255, 255, 0]], [0.03, [255, 255, 255, 0]], [0.15, [250, 204, 21, 140]], [0.6, [220, 38, 38, 210]]] },
  windward_exposure: { label: 'Windward (+) / lee (−) exposure', unit: '', stops: [[-1, [59, 130, 246, 180]], [-0.2, [147, 197, 253, 80]], [0, [255, 255, 255, 0]], [0.2, [250, 204, 21, 80]], [1, [234, 88, 12, 190]]] },
  terrain_modulation: { label: 'Terrain modulation factor', unit: '×', stops: [[0.6, [59, 130, 246, 190]], [0.95, [147, 197, 253, 60]], [1, [255, 255, 255, 0]], [1.05, [250, 204, 21, 60]], [1.5, [234, 88, 12, 200]]] },
  confidence: { label: 'Forecast confidence', unit: '%', pct: true, stops: [[0, [239, 68, 68, 140]], [0.4, [250, 204, 21, 110]], [0.7, [74, 222, 128, 90]], [1, [74, 222, 128, 0]]] },
  conv_10m: { label: '10 m convergence', unit: '10⁻⁵/s', mul: 1e5, stops: [[0, [255, 255, 255, 0]], [3, [250, 204, 21, 140]], [8, [249, 115, 22, 200]], [15, [220, 38, 38, 220]]] },
};
const MAIN_LAYER_GROUPS = [
  ['Hazards', ['p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_supercell', 'p_tornado_env', 'p_heavy_rain', 'p_training', 'p_severe', 'p_initiation', 'confidence']],
  ['Estimates', ['precip', 'precip_accum', 'flash_density', 'hail_size_max_cm', 'gust_max']],
  ['Environment', ['mu_cape', 'ml_cin', 'dcape', 'shear_0_6km', 'srh_0_1km', 'scp', 'stp', 'lapse_700_500', 'pw', 'wbz', 'conv_10m']],
  ['Terrain diagnostics', ['w_oro', 'windward_exposure', 'p_ci_orographic', 'terrain_modulation']],
];
const HYPER_LAYER_GROUPS = [
  ['Observation-driven', ['p_thunder', 'p_lightning', 'p_rain', 'p_heavy_rain', 'precip', 'precip_accum', 'flash_density']],
];

/* ── helpers ─────────────────────────────────────────────────────────────── */
const london = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', ...opts });
const hhmm = (iso) => london(iso, { hour: '2-digit', minute: '2-digit' });
const dayName = (iso) => london(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const leadText = (m) => `T+${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function f16(u) {
  const s = (u & 0x8000) ? -1 : 1; const e = (u >> 10) & 0x1f; const f = u & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
async function fetchField(product, runId, lead, field) {
  const r = await fetch(`/api/nova/${product}/runs/${runId}/frame/${lead}/${field}`);
  if (!r.ok) throw new Error(`${field}: ${r.status}`);
  const dtype = r.headers.get('X-Nova-Dtype');
  const ds = r.body.pipeThrough(new DecompressionStream('deflate'));
  const buf = await new Response(ds).arrayBuffer();
  if (dtype === 'int8') return Float32Array.from(new Int8Array(buf));
  const u = new Uint16Array(buf); const out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i += 1) out[i] = f16(u[i]);
  return out;
}

/* WGS84 lat/lon -> British National Grid (transverse Mercator on Airy 1830, no
   datum shift: ~100 m error, far below the 1.5–2 km cell size). */
function toBNG(lat, lon) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717, lat0 = 49 * Math.PI / 180, lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000, e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b);
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  const sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
  const nu = a * F0 / Math.sqrt(1 - e2 * sp * sp), rho = a * F0 * (1 - e2) / (1 - e2 * sp * sp) ** 1.5, eta2 = nu / rho - 1;
  const dp = p - lat0, sp2 = p + lat0;
  const M = b * F0 * ((1 + n + 1.25 * n * n + 1.25 * n ** 3) * dp - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(dp) * Math.cos(sp2)
    + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * dp) * Math.cos(2 * sp2) - (35 / 24) * n ** 3 * Math.sin(3 * dp) * Math.cos(3 * sp2));
  const I = M + N0, II = nu / 2 * sp * cp, III = nu / 24 * sp * cp ** 3 * (5 - tp * tp + 9 * eta2), IIIA = nu / 720 * sp * cp ** 5 * (61 - 58 * tp * tp + tp ** 4);
  const IV = nu * cp, V = nu / 6 * cp ** 3 * (nu / rho - tp * tp), VI = nu / 120 * cp ** 5 * (5 - 18 * tp * tp + tp ** 4 + 14 * eta2 - 58 * tp * tp * eta2);
  const dl = l - lon0;
  return [E0 + IV * dl + V * dl ** 3 + VI * dl ** 5, I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6];
}

const BOUNDS = [[49.7, -8.9], [61.0, 2.1]];
const OUT_W = 560, OUT_H = 900;
/* per output pixel (uniform in Web Mercator) -> BNG coordinates, computed once */
const PIXEL_BNG = (() => {
  let cache = null;
  return () => {
    if (cache) return cache;
    const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const y0 = merc(BOUNDS[0][0]), y1 = merc(BOUNDS[1][0]);
    const xs = new Float64Array(OUT_W * OUT_H), ys = new Float64Array(OUT_W * OUT_H);
    for (let j = 0; j < OUT_H; j += 1) {
      const my = y1 - (j + 0.5) / OUT_H * (y1 - y0);
      const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI;
      for (let i = 0; i < OUT_W; i += 1) {
        const lon = BOUNDS[0][1] + (i + 0.5) / OUT_W * (BOUNDS[1][1] - BOUNDS[0][1]);
        const [x, y] = toBNG(lat, lon);
        xs[j * OUT_W + i] = x; ys[j * OUT_W + i] = y;
      }
    }
    cache = { xs, ys };
    return cache;
  };
})();

function colourAt(stops, v) {
  if (!Number.isFinite(v) || v < stops[0][0]) return null;
  for (let k = stops.length - 1; k >= 0; k -= 1) {
    if (v >= stops[k][0]) {
      if (k === stops.length - 1) return stops[k][1];
      const [a, ca] = stops[k], [b, cb] = stops[k + 1], t = (v - a) / (b - a);
      return ca.map((c, i) => c + (cb[i] - c) * t);
    }
  }
  return null;
}

function renderField(data, grid, layer) {
  const { xs, ys } = PIXEL_BNG();
  const cv = document.createElement('canvas');
  cv.width = OUT_W; cv.height = OUT_H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(OUT_W, OUT_H);
  const mul = layer.mul || 1;
  for (let k = 0; k < xs.length; k += 1) {
    const ix = Math.floor((xs[k] - grid.x0) / grid.dx_m), iy = Math.floor((ys[k] - grid.y0) / grid.dx_m);
    if (ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny) continue;
    const c = colourAt(layer.stops, data[iy * grid.nx + ix] * (layer.pct ? 1 : mul));
    if (!c) continue;
    img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = c[3];
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}

function riskWord(p) {
  if (p >= 0.6) return ['HIGH', '#a855f7'];
  if (p >= 0.45) return ['MDT', '#ef4444'];
  if (p >= 0.3) return ['ENH', '#f97316'];
  if (p >= 0.15) return ['SLGT', '#eab308'];
  if (p >= 0.05) return ['MRGL', '#22c55e'];
  if (p >= 0.02) return ['TSTM', '#38bdf8'];
  return ['No Risk', '#94a3b8'];
}

/* ── data hooks ──────────────────────────────────────────────────────────── */
function useRuns(product) {
  const [runs, setRuns] = useState([]);
  const [latest, setLatest] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      const [r, l, s] = await Promise.all([
        fetch(`/api/nova/${product}/runs`).then((x) => x.json()),
        fetch(`/api/nova/${product}/latest`).then((x) => (x.ok ? x.json() : null)),
        fetch(`/api/nova/${product}/status`).then((x) => x.json()),
      ]);
      setRuns(r.runs || []); setLatest(l); setStatus(s); setError(null);
    } catch (e) { setError(String(e)); }
  }, [product]);
  useEffect(() => { setRuns([]); setLatest(null); load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);
  return { runs, latest, status, error, reload: load };
}

/* ── map ─────────────────────────────────────────────────────────────────── */
function NovaMap({ product, manifest, lead, layerKey, onHover }) {
  const el = useRef(null), map = useRef(null), overlay = useRef(null), dataRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 10, zoomSnap: 0.25, scrollWheelZoom: 'center' }).setView([54.7, -3.0], 6);
    setTimeout(() => m.invalidateSize(), 200);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' }).addTo(m);
    m.createPane('labels'); m.getPane('labels').style.zIndex = 650; m.getPane('labels').style.pointerEvents = 'none';
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { pane: 'labels' }).addTo(m);
    m.on('mousemove', (e) => {
      const d = dataRef.current; if (!d) return;
      const [x, y] = toBNG(e.latlng.lat, e.latlng.lng);
      const g = d.grid; const ix = Math.floor((x - g.x0) / g.dx_m), iy = Math.floor((y - g.y0) / g.dx_m);
      onHover(ix >= 0 && iy >= 0 && ix < g.nx && iy < g.ny ? { v: d.data[iy * g.nx + ix], lat: e.latlng.lat, lon: e.latlng.lng } : null);
    });
    map.current = m;
  }, [onHover]);
  useEffect(() => {
    if (!manifest || lead == null) return undefined;
    let alive = true;
    setBusy(true); setErr(null);
    fetchField(product, manifest.run_id, lead, layerKey).then((data) => {
      if (!alive) return;
      dataRef.current = { data, grid: manifest.grid };
      const url = renderField(data, manifest.grid, LAYERS[layerKey]);
      if (overlay.current) overlay.current.setUrl(url);
      else overlay.current = L.imageOverlay(url, BOUNDS, { opacity: 0.85, interactive: false }).addTo(map.current);
    }).catch((e) => { if (alive) { setErr(String(e.message || e)); if (overlay.current) { overlay.current.remove(); overlay.current = null; } dataRef.current = null; } })
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [product, manifest, lead, layerKey]);
  return (
    <div style={{ position: 'relative' }}>
      <div ref={el} style={{ height: 'min(72vh, 760px)', minHeight: 460, borderRadius: 14, overflow: 'hidden', background: '#e5e7eb' }} />
      {busy && <div style={{ position: 'absolute', top: 10, left: 54, zIndex: 700, ...pill('#fff', T.mid) }}>Loading field…</div>}
      {err && <div style={{ position: 'absolute', top: 10, left: 54, zIndex: 700, ...pill('#fef2f2', '#b91c1c') }}>Not in this run: {LAYERS[layerKey].label}</div>}
    </div>
  );
}
const pill = (bg, color) => ({ background: bg, color, border: `1px solid ${T.border}`, borderRadius: 99, padding: '4px 10px', fontSize: '0.7rem', fontWeight: 700 });

function Legend({ layerKey }) {
  const l = LAYERS[layerKey];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: T.text, marginRight: 4 }}>{l.label}</span>
      {l.stops.filter((s) => s[1][3] > 0).map(([v, c]) => (
        <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.66rem', color: T.mid, fontFamily: MONO }}>
          <span style={{ width: 14, height: 10, borderRadius: 3, background: `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, c[3] / 200)})` }} />
          {l.pct ? `${Math.round(v * 100)}%` : `${v}${l.unit ? ' ' + l.unit : ''}`}
        </span>
      ))}
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */
export default function TCMNova({ engineSwitcher = null }) {
  const [product, setProductState] = useState(() => { try { return localStorage.getItem('nova_product') === 'hyper' ? 'hyper' : 'main'; } catch { return 'main'; } });
  const setProduct = (p) => { setProductState(p); try { localStorage.setItem('nova_product', p); } catch { /* blocked */ } };
  const { runs, latest, status, reload } = useRuns(product);
  const [pinned, setPinned] = useState(null);          // a run id the user chose; null = follow latest
  const [manifest, setManifest] = useState(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState('map');
  const [layerKey, setLayerKey] = useState('p_thunder');
  const [hover, setHover] = useState(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => { setPinned(null); setIdx(0); setEnded(false); setLayerKey('p_thunder'); }, [product]);
  /* follow the newest run unless the user is examining an older one */
  useEffect(() => {
    if (pinned) {
      fetch(`/api/nova/${product}/runs/${pinned}`).then((r) => (r.ok ? r.json() : null)).then(setManifest);
    } else {
      setManifest((m) => (latest && (!m || m.run_id !== latest.run_id) ? latest : m || latest));
    }
  }, [pinned, latest, product]);
  useEffect(() => { if (manifest && manifest.product !== product) setManifest(null); }, [manifest, product]);

  const frames = useMemo(() => (manifest?.frames || []).filter((f) => f.valid).sort((a, b) => a.lead_min - b.lead_min), [manifest]);
  const frame = frames[Math.min(idx, frames.length - 1)];
  useEffect(() => { if (idx >= frames.length && frames.length) setIdx(frames.length - 1); }, [frames, idx]);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setIdx((i) => (i + 1 < frames.length ? i + 1 : 0)), 900);
    return () => clearInterval(t);
  }, [playing, frames.length]);
  const next = () => { if (idx + 1 < frames.length) { setIdx(idx + 1); setEnded(false); } else if (product === 'hyper') setEnded(true); };
  const prev = () => { setEnded(false); setIdx(Math.max(0, idx - 1)); };

  const groups = product === 'main' ? MAIN_LAYER_GROUPS : HYPER_LAYER_GROUPS;
  const fieldMax = (f, fr = frame) => fr?.stats?.[f]?.max ?? null;

  /* day cards (Main): highest thunder probability per UK calendar day */
  const days = useMemo(() => {
    const m = new Map();
    frames.forEach((f, i) => {
      const k = london(f.valid, { year: 'numeric', month: '2-digit', day: '2-digit' });
      const d = m.get(k) || { key: k, label: dayName(f.valid), first: i, max: 0 };
      d.max = Math.max(d.max, f.stats?.p_thunder?.max || 0);
      m.set(k, d);
    });
    return [...m.values()];
  }, [frames]);
  const curDay = frame ? london(frame.valid, { year: 'numeric', month: '2-digit', day: '2-digit' }) : null;
  const dayMax = days.find((d) => d.key === curDay)?.max || 0;
  const [word, colour] = riskWord(dayMax);
  const P = PRODUCTS[product];

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: 'inherit' }}>
      {/* header bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', display: 'grid', placeItems: 'center' }}>
            <CloudLightning style={{ width: 18, height: 18, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              TCM NOVA
              <span style={{ ...pill(manifest?.status === 'published' ? '#dcfce7' : '#fef3c7', manifest?.status === 'published' ? '#15803d' : '#b45309'), padding: '1px 8px', fontSize: '0.6rem' }}>
                {manifest ? manifest.status.toUpperCase() : 'NO RUN'}
              </span>
            </div>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.14em', color: T.faint, fontFamily: MONO }}>MYWEATHERUK · THUNDERSTORM MODEL</div>
          </div>
          {/* product selector */}
          <div role="tablist" aria-label="Forecast product" style={{ display: 'inline-flex', marginLeft: 'auto', background: T.soft, border: `1px solid ${T.border}`, borderRadius: 12, padding: 3 }}>
            {Object.entries(PRODUCTS).map(([k, v]) => (
              <button key={k} role="tab" aria-selected={product === k} onClick={() => setProduct(k)} type="button"
                style={{ border: 'none', cursor: 'pointer', borderRadius: 9, padding: '7px 14px', fontWeight: 800, fontSize: '0.74rem', fontFamily: 'inherit',
                  background: product === k ? 'linear-gradient(135deg,#0ea5e9,#6366f1)' : 'transparent', color: product === k ? '#fff' : T.mid }}>
                {v.label} <span style={{ opacity: 0.75, fontWeight: 600 }}>· {v.res}</span>
              </button>
            ))}
          </div>
          <select value={pinned || ''} onChange={(e) => { setPinned(e.target.value || null); setIdx(0); }} aria-label="Run"
            style={{ ...pill(T.soft, T.text), padding: '7px 10px', fontFamily: MONO, cursor: 'pointer' }}>
            <option value="">Latest run{latest ? ` (${latest.init_local})` : ''}</option>
            {runs.map((r) => <option key={r.run_id} value={r.run_id}>{r.init_local} · {r.status}</option>)}
          </select>
          <button type="button" onClick={reload} style={{ ...pill(T.soft, T.mid), cursor: 'pointer' }} title="Check for new runs"><RefreshCw style={{ width: 13, height: 13 }} /></button>
          {engineSwitcher}
        </div>
      </div>

      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '16px' }}>
        {/* hero */}
        <div style={{ ...card, padding: '18px 22px', marginBottom: 16, background: `linear-gradient(120deg, ${colour}1f, #ffffff 60%)`, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: '0.66rem', fontFamily: MONO, letterSpacing: '0.12em', color: T.faint }}>
              GREAT BRITAIN · {P.label.toUpperCase()} · {frame ? dayName(frame.valid).toUpperCase() : '—'}
            </div>
            <h1 style={{ margin: '4px 0 2px', fontSize: '1.9rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 10 }}>
              <CloudLightning style={{ color: colour, width: 28, height: 28 }} />
              {dayMax >= 0.02 ? `${word} thunderstorm risk` : 'No significant thunderstorm risk'}
            </h1>
            <div style={{ fontSize: '0.8rem', color: T.mid }}>
              {manifest ? <>Run initialised <b>{manifest.init_local}</b> · {P.blurb}</> : 'Waiting for the first published run of this product.'}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ ...pill('#fff', colour), fontSize: '0.8rem', fontWeight: 900 }}>{word}</div>
            <div style={{ fontSize: '2.2rem', fontWeight: 900, fontFamily: MONO, marginTop: 4 }}>{Math.round(dayMax * 100)}<span style={{ fontSize: '0.9rem', color: T.faint }}>%</span></div>
            <div style={{ fontSize: '0.58rem', color: T.faint, letterSpacing: '0.12em' }}>PEAK P(THUNDER) · DAY</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', gap: 16 }} className="nova-grid">
          <style>{'@media (max-width: 900px){ .nova-grid{ grid-template-columns: 1fr !important; } }'}</style>
          {/* left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...card, padding: 12 }}>
              <SectionTitle icon={Clock} text={product === 'main' ? 'Forecast days' : 'Forecast window'} />
              {product === 'main' ? days.map((d, i) => {
                const [w, c] = riskWord(d.max);
                const on = d.key === curDay;
                return (
                  <button key={d.key} type="button" onClick={() => { setIdx(d.first); setEnded(false); }}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '9px 10px', marginTop: 6, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? '#f1f5f9' : '#fff', border: `1px solid ${on ? '#334155' : T.border}`, textAlign: 'left' }}>
                    <span style={{ ...pill(T.soft, T.mid), fontFamily: MONO, fontSize: '0.6rem' }}>DAY {i + 1}</span>
                    <span style={{ flex: 1, fontWeight: 800, fontSize: '0.82rem' }}>{d.label}</span>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, color: c }}>{w}</span>
                  </button>
                );
              }) : (
                <div style={{ fontSize: '0.76rem', color: T.mid, lineHeight: 1.6, marginTop: 6 }}>
                  24 hours from the selected hourly run, every 30 minutes (49 frames).<br />
                  Observation analysis: <b>{manifest?.analysis ? `radar ${manifest.analysis.radar_age_min} min old, ${Math.round(manifest.analysis.radar_coverage * 100)}% coverage, lightning ${manifest.analysis.lightning_feed}` : '—'}</b>
                </div>
              )}
            </div>
            <div style={{ ...card, padding: 12 }}>
              <SectionTitle icon={AlertTriangle} text="Hazards · this frame" />
              {HAZARDS.map(({ f, label, icon: Icon }) => {
                const v = fieldMax(f);
                const avail = v != null;
                const on = layerKey === f;
                return (
                  <button key={f} type="button" disabled={!avail} onClick={() => setLayerKey(f)}
                    title={avail ? '' : 'Not produced by this product'}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '9px 10px', marginTop: 6, borderRadius: 12, fontFamily: 'inherit',
                      cursor: avail ? 'pointer' : 'not-allowed', opacity: avail ? 1 : 0.45, textAlign: 'left',
                      background: on ? '#fff7ed' : '#fff', border: `1px solid ${on ? '#fdba74' : T.border}` }}>
                    <Icon style={{ width: 16, height: 16, color: on ? T.orange : T.mid }} />
                    <span style={{ flex: 1, fontWeight: 700, fontSize: '0.8rem' }}>{label}</span>
                    <span style={{ width: 50, height: 5, borderRadius: 9, background: '#e2e8f0', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${Math.round((v || 0) * 100)}%`, background: riskWord(v || 0)[1] }} />
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: '0.72rem', width: 32, textAlign: 'right' }}>{avail ? Math.round(v * 100) : '—'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={{ ...card, padding: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[['map', 'Map', MapIcon], ['overview', 'Sources & method', Database], ['status', 'Run status', Activity]].map(([k, l, I]) => (
                <button key={k} type="button" onClick={() => setTab(k)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: '0.8rem',
                    border: 'none', background: tab === k ? '#e0f2fe' : 'transparent', color: tab === k ? T.sky : T.mid }}>
                  <I style={{ width: 14, height: 14 }} />{l}
                </button>
              ))}
            </div>

            {!manifest && (
              <div style={{ ...card, padding: 28, textAlign: 'center', color: T.mid }}>
                <Database style={{ width: 22, height: 22, color: T.sky }} />
                <div style={{ fontWeight: 800, color: T.text, marginTop: 8 }}>No published {P.label} run yet</div>
                <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
                  {status?.state ? `Current job: ${status.state}. ` : ''}Next scheduled run {status?.next_cycle_utc ? london(status.next_cycle_utc, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} UK time.
                </div>
              </div>
            )}

            {manifest && tab === 'map' && (
              <>
                <div style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Layers style={{ width: 15, height: 15, color: T.mid }} />
                    <select value={layerKey} onChange={(e) => setLayerKey(e.target.value)} aria-label="Map layer"
                      style={{ ...pill('#fff', T.text), padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {groups.map(([g, ks]) => (
                        <optgroup key={g} label={g}>{ks.filter((k) => manifest.fields?.[k]).map((k) => <option key={k} value={k}>{LAYERS[k].label}</option>)}</optgroup>
                      ))}
                    </select>
                    {hover && Number.isFinite(hover.v) && (
                      <span style={{ ...pill(T.soft, T.text), fontFamily: MONO }}>
                        {LAYERS[layerKey].pct ? `${Math.round(hover.v * 100)}%` : `${(hover.v * (LAYERS[layerKey].mul || 1)).toFixed(1)} ${LAYERS[layerKey].unit}`} · {hover.lat.toFixed(2)}, {hover.lon.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <Legend layerKey={layerKey} />
                </div>
                <div style={{ ...card, padding: 8, position: 'relative' }}>
                  <NovaMap product={product} manifest={manifest} lead={frame?.lead_min} layerKey={layerKey} onHover={setHover} />
                  {ended && (
                    <div style={{ position: 'absolute', inset: 8, zIndex: 800, borderRadius: 14, background: 'rgba(15,23,42,0.72)', display: 'grid', placeItems: 'center', color: '#fff', textAlign: 'center', padding: 20 }}>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>The Hyper-Short forecast ends at T+24:00</div>
                        <div style={{ fontSize: '0.8rem', opacity: 0.85, margin: '6px 0 12px' }}>Nothing beyond it is extrapolated or borrowed from another run.</div>
                        <button type="button" onClick={() => setProduct('main')} style={{ ...pill('#fff', T.text), cursor: 'pointer', padding: '8px 14px' }}>Switch to TCM Main Run</button>
                        <button type="button" onClick={() => setEnded(false)} style={{ ...pill('transparent', '#fff'), cursor: 'pointer', padding: '8px 14px', marginLeft: 8 }}>Back</button>
                      </div>
                    </div>
                  )}
                </div>
                {/* timeline */}
                <div style={{ ...card, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={prev} aria-label="Previous frame" style={btn}><ChevronLeft style={{ width: 16, height: 16 }} /></button>
                    <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} style={btn}>
                      {playing ? <Pause style={{ width: 16, height: 16 }} /> : <Play style={{ width: 16, height: 16 }} />}
                    </button>
                    <button type="button" onClick={next} aria-label="Next frame" style={btn}><ChevronRight style={{ width: 16, height: 16 }} /></button>
                    <div style={{ fontWeight: 900, fontSize: '0.95rem', marginLeft: 6 }}>{frame ? `${dayName(frame.valid)} ${hhmm(frame.valid)}` : '—'}</div>
                    <span style={{ ...pill(T.soft, T.mid), fontFamily: MONO }}>valid · {frame ? leadText(frame.lead_min) : '—'}</span>
                    <span style={{ ...pill('#eef2ff', '#4338ca'), fontFamily: MONO, marginLeft: 'auto' }}>init {manifest.init_local}</span>
                    {!pinned && <span style={{ ...pill('#dcfce7', '#15803d') }}>latest run</span>}
                  </div>
                  <input type="range" min={0} max={Math.max(frames.length - 1, 0)} value={Math.min(idx, frames.length - 1)} aria-label="Forecast time"
                    onChange={(e) => { setIdx(Number(e.target.value)); setEnded(false); }} style={{ width: '100%', marginTop: 10, accentColor: T.sky }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: T.faint, fontFamily: MONO }}>
                    <span>{frames[0] && `${hhmm(frames[0].valid)} T+0`}</span>
                    <span>{product === 'hyper' ? 'ends T+24:00 · every 30 min' : `every ${manifest.step_h} h to T+${manifest.horizon_h}`}</span>
                    <span>{frames.length > 0 && `${dayName(frames[frames.length - 1].valid)} ${hhmm(frames[frames.length - 1].valid)}`}</span>
                  </div>
                  {frame?.beyond_skill_horizon && (
                    <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#b45309' }}>
                      Beyond the engine's skill horizon: this frame only shows existing echoes decaying — the Hyper-Short stage-1 engine does not start new storms.
                    </div>
                  )}
                </div>
                <div style={{ ...card, padding: 12, fontSize: '0.72rem', color: T.mid, lineHeight: 1.6, display: 'flex', gap: 8 }}>
                  <Info style={{ width: 15, height: 15, flexShrink: 0, color: T.sky }} />
                  <span>
                    Probabilities are <b>uncalibrated</b> until enough runs have been verified against radar and lightning; risk words (TSTM…HIGH) are
                    banded from them. Probabilities mean “a thunderstorm within about {Math.round(product === 'main' ? 10 + 0.35 * (frame?.lead_h || 0) : frame?.neighbourhood_km || 3)} km”.
                    Tornado layers describe a favourable <b>environment</b>, not a tornado forecast.
                  </span>
                </div>
              </>
            )}

            {manifest && tab === 'overview' && <Overview manifest={manifest} frame={frame} product={product} />}
            {tab === 'status' && <StatusPanel manifest={manifest} status={status} />}
          </div>
        </div>
      </div>
    </div>
  );
}
const btn = { display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, border: `1px solid ${T.border}`, background: '#fff', cursor: 'pointer', color: T.text };

function SectionTitle({ icon: Icon, text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.faint, fontFamily: MONO, padding: '2px 4px' }}>
      <Icon style={{ width: 13, height: 13 }} />{text}
    </div>
  );
}

function Overview({ manifest, frame, product }) {
  const w = frame?.weights_environment;
  return (
    <div style={{ ...card, padding: 16, fontSize: '0.8rem', color: T.mid, lineHeight: 1.6 }}>
      <h3 style={{ margin: '0 0 6px', color: T.text }}>How this run was made</h3>
      <p style={{ marginTop: 0 }}>{manifest.method}</p>
      {product === 'main' ? (
        <>
          <h4 style={{ color: T.text, marginBottom: 4 }}>Sources used (all read from AWS)</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
            <thead><tr style={{ textAlign: 'left', color: T.faint }}><th>Model</th><th>Cycle (UTC)</th><th>Baseline %</th><th>Used % this frame</th></tr></thead>
            <tbody>
              {Object.entries(manifest.sources || {}).map(([k, s]) => (
                <tr key={k} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td>{s.label}</td><td style={{ fontFamily: MONO }}>{s.cycle_utc.slice(0, 16).replace('T', ' ')}</td>
                  <td style={{ fontFamily: MONO }}>{w?.baseline?.[k] ?? '—'}</td><td style={{ fontFamily: MONO, fontWeight: 800, color: T.text }}>{w?.final?.[k] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.72rem' }}>Lead window {w?.window}. Weights are the baseline table for this window, renormalised over the sources that are available and cover each cell,
            moved towards verified skill as the record grows, and capped per modelling centre so one family cannot dominate.</p>
          <h4 style={{ color: T.text, marginBottom: 4 }}>Not used in this run</h4>
          <ul style={{ marginTop: 0 }}>{Object.entries(manifest.unavailable || {}).map(([k, why]) => <li key={k}><b>{k}</b>: {why}</li>)}</ul>
        </>
      ) : (
        <>
          <h4 style={{ color: T.text, marginBottom: 4 }}>Inputs (observations only — no model forecasts)</h4>
          <ul style={{ marginTop: 0 }}>{Object.entries(manifest.inputs || {}).map(([k, v]) => <li key={k}><b>{k}</b>: {v}</li>)}</ul>
          <h4 style={{ color: T.text, marginBottom: 4 }}>Not produced by this engine yet</h4>
          <ul style={{ marginTop: 0 }}>{Object.entries(manifest.unavailable || {}).map(([k, why]) => <li key={k}><b>{k}</b>: {why}</li>)}</ul>
          <p><b>Skill horizon:</b> {manifest.skill_horizon}</p>
        </>
      )}
      <p style={{ fontSize: '0.72rem' }}>Grid {manifest.grid.crs} · {manifest.grid.dx_m} m · {manifest.grid.nx}×{manifest.grid.ny} · engine {manifest.engine_version} · calibration: {manifest.calibration}</p>
    </div>
  );
}

function StatusPanel({ manifest, status }) {
  return (
    <div style={{ ...card, padding: 16, fontSize: '0.78rem', color: T.mid, lineHeight: 1.6 }}>
      <h3 style={{ margin: '0 0 6px', color: T.text }}>Run status</h3>
      <div>Job state: <b>{status?.state || '—'}</b> {status?.running ? `(running since ${london(status.running.started, { hour: '2-digit', minute: '2-digit' })})` : ''}</div>
      <div>Next scheduled run: <b>{status?.next_cycle_utc ? london(status.next_cycle_utc, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</b> UK time</div>
      {manifest && (
        <>
          <div>Selected run: <b>{manifest.run_id}</b> · {manifest.status} · {manifest.frames.length} frames · {manifest.runtime_s ? `${Math.round(manifest.runtime_s / 60)} min` : ''}</div>
          <h4 style={{ color: T.text, marginBottom: 4 }}>Validation</h4>
          <ul style={{ marginTop: 0 }}>{(manifest.validation || []).map((c) => <li key={c.name}>{c.ok ? '✔' : '✘'} {c.name}: {c.detail}</li>)}</ul>
          {manifest.degraded_because?.length > 0 && (
            <><h4 style={{ color: '#b45309', marginBottom: 4 }}>Degraded because</h4><ul style={{ marginTop: 0 }}>{manifest.degraded_because.map((d) => <li key={d}>{d}</li>)}</ul></>
          )}
        </>
      )}
      {status?.history?.length > 0 && (
        <><h4 style={{ color: T.text, marginBottom: 4 }}>Recent job history</h4>
          <ul style={{ marginTop: 0, fontFamily: MONO, fontSize: '0.68rem' }}>{status.history.slice(-10).reverse().map((h, i) => <li key={i}>{h.at?.slice(0, 16)} {h.state} {h.run_id || ''}</li>)}</ul></>
      )}
    </div>
  );
}
