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
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import NovaGlobe from '@/components/tcm/NovaGlobe';
import { isCurrentUserAdmin } from '@/lib/tcmFetchPolicy';
import { Lock as LockIcon } from 'lucide-react';

/* NOVA's data API is admin-only; send the session token with every request. */
const authHeaders = () => {
  try { const t = localStorage.getItem('base44_access_token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
};
const novaFetch = (url) => fetch(url, { headers: authHeaders() });
import {
  CloudLightning, Zap, CloudRain, Wind, Tornado, Snowflake, AlertTriangle, Play, Pause,
  ChevronLeft, ChevronRight, Layers, Clock, Database, Activity, Map as MapIcon, Info, RefreshCw, TrendingUp,
  CalendarRange, Download, X,
} from 'lucide-react';

/* ── look (V3 light card style) ───────────────────────────────────────────── */
const T = {
  bg: '#eef2f7', card: '#ffffff', border: 'rgba(15,23,42,0.09)', text: '#0f172a', mid: '#475569',
  faint: '#94a3b8', sky: '#0284c7', orange: '#ea580c', soft: '#f8fafc',
};
const MONO = "'DM Mono',ui-monospace,monospace";
const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' };

const PRODUCTS = {
  main: { label: 'TCM Main Run', res: '2 km', blurb: 'Four runs a day · 7 models each run through TCM V5 at 2 km' },
  hyper: { label: 'TCM Hyper-Short', res: '1.5 km', blurb: 'Hourly · 24 h at 30 min · 16-member radar & lightning nowcast blended with TCM V5 on the latest UKV' },
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
/* One continuous ramp with opacity that levels off: high values deepen in hue instead of
   turning into an opaque block, so the basemap and the surrounding bands stay readable and
   the top band blends out of the red rather than jumping to a flat purple. */
const PROB = [[0.02, [56, 189, 248, 0]], [0.05, [56, 189, 248, 95]], [0.15, [74, 222, 128, 135]], [0.3, [250, 204, 21, 155]],
  [0.45, [249, 115, 22, 168]], [0.6, [239, 68, 68, 176]], [0.75, [219, 39, 119, 182]], [0.9, [192, 38, 211, 186]]];
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
  p_initiation: { label: 'Initiation probability (V5 realisation stage)', unit: '%', stops: PROB, pct: true },
  p_ci_orographic: { label: 'Orographic initiation (terrain part)', unit: '%', stops: PROB, pct: true },
  p_rain: { label: 'Rain ≥1 mm/h probability', unit: '%', stops: PROB, pct: true },
  precip: { label: 'Precipitation rate', unit: 'mm/h', stops: [[0.1, [147, 197, 253, 0]], [0.3, [96, 165, 250, 170]], [1, [37, 99, 235, 200]], [4, [250, 204, 21, 210]], [10, [249, 115, 22, 220]], [25, [220, 38, 38, 230]], [50, [168, 85, 247, 235]]] },
  precip_accum: { label: 'Accumulated precipitation', unit: 'mm', stops: [[0.5, [147, 197, 253, 0]], [2, [96, 165, 250, 160]], [10, [37, 99, 235, 195]], [25, [250, 204, 21, 205]], [50, [239, 68, 68, 220]], [100, [168, 85, 247, 230]]] },
  lightning_jump: { label: 'Lightning jump (rising flash rate)', unit: '/km²/h', stops: [[0.005, [250, 204, 21, 0]], [0.02, [250, 204, 21, 160]], [0.1, [249, 115, 22, 200]], [0.5, [220, 38, 38, 220]], [2, [168, 85, 247, 235]]] },
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
  uncertainty: { label: 'Forecast uncertainty (TCM V5)', unit: '%', pct: true, stops: [[0.1, [74, 222, 128, 0]], [0.3, [250, 204, 21, 120]], [0.5, [249, 115, 22, 170]], [0.7, [220, 38, 38, 210]]] },
  confidence: { label: 'Forecast confidence (TCM V5, capped until calibrated)', unit: '%', pct: true, stops: [[0, [239, 68, 68, 140]], [0.4, [250, 204, 21, 110]], [0.7, [74, 222, 128, 90]], [1, [74, 222, 128, 0]]] },
  qc_path: { label: 'Cloud liquid water path', unit: 'kg/m²', stops: [[0.01, [186, 230, 253, 0]], [0.05, [125, 211, 252, 150]], [0.2, [59, 130, 246, 185]], [0.5, [99, 102, 241, 205]], [1, [168, 85, 247, 220]], [2, [219, 39, 119, 230]]] },
  qi_path: { label: 'Cloud ice water path', unit: 'kg/m²', stops: [[0.01, [186, 230, 253, 0]], [0.05, [125, 211, 252, 150]], [0.2, [59, 130, 246, 185]], [0.5, [99, 102, 241, 205]], [1, [168, 85, 247, 220]], [2, [219, 39, 119, 230]]] },
  qg_path: { label: 'Graupel water path (GFS)', unit: 'kg/m²', stops: [[0.01, [186, 230, 253, 0]], [0.05, [125, 211, 252, 150]], [0.2, [59, 130, 246, 185]], [0.5, [99, 102, 241, 205]], [1, [168, 85, 247, 220]], [2, [219, 39, 119, 230]]] },
  qr_path: { label: 'Rain water path', unit: 'kg/m²', stops: [[0.01, [186, 230, 253, 0]], [0.05, [125, 211, 252, 150]], [0.2, [59, 130, 246, 185]], [0.5, [99, 102, 241, 205]], [1, [168, 85, 247, 220]], [2, [219, 39, 119, 230]]] },
  slw_max_gm3: { label: 'Max supercooled liquid water', unit: 'g/m³', stops: [[0.01, [186, 230, 253, 0]], [0.05, [125, 211, 252, 150]], [0.2, [59, 130, 246, 185]], [0.5, [99, 102, 241, 205]], [1, [168, 85, 247, 220]], [2, [219, 39, 119, 230]]] },
  droplet_re_um: { label: 'Cloud droplet effective radius (assumed Nd)', unit: 'µm', stops: [[4, [186, 230, 253, 120]], [8, [125, 211, 252, 160]], [12, [74, 222, 128, 180]], [16, [250, 204, 21, 200]], [22, [249, 115, 22, 215]]] },
  ice_re_um: { label: 'Ice effective radius', unit: 'µm', stops: [[10, [186, 230, 253, 120]], [25, [125, 211, 252, 160]], [40, [167, 139, 250, 190]], [60, [168, 85, 247, 215]]] },
  charging_index: { label: 'Graupel–ice charging index (relative)', unit: '', stops: [[0.5, [254, 240, 138, 0]], [2, [250, 204, 21, 160]], [8, [249, 115, 22, 200]], [20, [220, 38, 38, 225]]] },
  lpi: { label: 'ICON-EU lightning potential index', unit: 'J/kg', stops: [[0.5, [254, 240, 138, 0]], [1, [250, 204, 21, 160]], [4, [249, 115, 22, 200]], [10, [220, 38, 38, 225]]] },
  htop_con: { label: 'Convective cloud top (ICON-EU)', unit: 'm', stops: [[2000, [203, 213, 225, 110]], [5000, [125, 211, 252, 150]], [8000, [250, 204, 21, 190]], [11000, [220, 38, 38, 220]]] },
  p_thunder_uncal: { label: 'Thunderstorm probability (raw, before calibration)', unit: '%', stops: PROB, pct: true },
  conv_10m: { label: '10 m convergence', unit: '10⁻⁵/s', mul: 1e5, stops: [[0, [255, 255, 255, 0]], [3, [250, 204, 21, 140]], [8, [249, 115, 22, 200]], [15, [220, 38, 38, 220]]] },
};
const MAIN_LAYER_GROUPS = [
  ['Hazards', ['p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_supercell', 'p_tornado_env', 'p_heavy_rain', 'p_training', 'p_severe', 'p_initiation', 'uncertainty', 'confidence']],
  ['Estimates', ['precip', 'precip_accum', 'flash_density', 'hail_size_max_cm', 'gust_max']],
  ['Environment', ['mu_cape', 'ml_cin', 'dcape', 'shear_0_6km', 'srh_0_1km', 'scp', 'stp', 'lapse_700_500', 'pw', 'wbz', 'conv_10m']],
  ['Cloud microphysics', ['qc_path', 'qi_path', 'qr_path', 'qg_path', 'slw_max_gm3', 'droplet_re_um', 'ice_re_um', 'charging_index', 'lpi', 'htop_con']],
  ['Terrain diagnostics', ['w_oro', 'windward_exposure', 'p_ci_orographic', 'terrain_modulation']],
  ['Calibration', ['p_thunder_uncal']],
];
const HYPER_LAYER_GROUPS = [
  ['Nowcast + UKV', ['p_thunder', 'p_lightning', 'p_rain', 'p_heavy_rain', 'precip', 'precip_accum', 'flash_density', 'lightning_jump']],
  ['UKV hazards', ['p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_supercell', 'p_tornado_env', 'p_severe', 'p_initiation', 'hail_size_max_cm', 'gust_max']],
  ['UKV environment', ['mu_cape', 'ml_cin', 'dcape', 'shear_0_6km', 'srh_0_1km', 'scp', 'stp', 'lapse_700_500', 'pw', 'wbz']],
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
async function fetchField(product, runId, lead, field, day = null) {
  const r = await novaFetch(day ? `/api/nova/${product}/runs/${runId}/day/${day}/${field}` : `/api/nova/${product}/runs/${runId}/frame/${lead}/${field}`);
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

const BOUNDS = [[49.5, -11.6], [61.2, 2.4]];
const OUT_W = 760, OUT_H = 1000;
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

/* The field as an image over BOUNDS. A layer with `step` is drawn as flat risk levels with a
   darker edge where a level meets a lower one, the way a forecaster's outlook looks. */
function renderCanvas(data, grid, layer) {
  const { xs, ys } = PIXEL_BNG();
  const cv = document.createElement('canvas');
  cv.width = OUT_W; cv.height = OUT_H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(OUT_W, OUT_H);
  const mul = layer.mul || 1;
  const cat = layer.categorical;
  const lv = layer.step ? new Int8Array(xs.length).fill(-1) : null;     // risk level per pixel
  for (let k = 0; k < xs.length; k += 1) {
    const fx = (xs[k] - grid.x0) / grid.dx_m - 0.5, fy = (ys[k] - grid.y0) / grid.dx_m - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= grid.nx - 1 || iy >= grid.ny - 1) continue;
    let v;
    if (cat) v = data[Math.round(fy) * grid.nx + Math.round(fx)];
    else {
      const tx = fx - ix, ty = fy - iy, i0 = iy * grid.nx + ix, i1 = i0 + grid.nx;
      const a = data[i0], b = data[i0 + 1], c2 = data[i1], d = data[i1 + 1];
      if (!Number.isFinite(a + b + c2 + d)) v = data[Math.round(fy) * grid.nx + Math.round(fx)];
      else v = (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d * tx) * ty;
    }
    const sv = v * (layer.pct ? 1 : mul);
    if (lv) {
      for (let q = 0; q < layer.stops.length && sv >= layer.stops[q][0]; q += 1) lv[k] = q;
      continue;
    }
    const c = colourAt(layer.stops, sv);
    if (!c) continue;
    img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = c[3];
  }
  if (lv) {
    const px = img.data;
    for (let k = 0; k < lv.length; k += 1) {
      const q = lv[k];
      if (q < 0) continue;
      const i = k % OUT_W;
      const edge = (i > 0 && lv[k - 1] < q) || (i < OUT_W - 1 && lv[k + 1] < q) || (k >= OUT_W && lv[k - OUT_W] < q) || (k + OUT_W < lv.length && lv[k + OUT_W] < q);
      const c = layer.stops[q][1], f = edge ? 0.62 : 1;
      px[k * 4] = c[0] * f; px[k * 4 + 1] = c[1] * f; px[k * 4 + 2] = c[2] * f; px[k * 4 + 3] = edge ? 235 : c[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
const renderField = (data, grid, layer) => renderCanvas(data, grid, layer).toDataURL();

function riskWord(p) {
  if (p >= 0.6) return ['HIGH', '#a855f7'];
  if (p >= 0.45) return ['MDT', '#ef4444'];
  if (p >= 0.3) return ['ENH', '#f97316'];
  if (p >= 0.15) return ['SLGT', '#eab308'];
  if (p >= 0.05) return ['MRGL', '#22c55e'];
  if (p >= 0.02) return ['TSTM', '#38bdf8'];
  return ['No Risk', '#94a3b8'];
}

/* ── combining hours ─────────────────────────────────────────────────────── */
/* outlook risk levels: the riskWord bands as flat colours [from, rgba, name] */
const RISK_LEVELS = [[0.02, [56, 189, 248, 120], 'TSTM'], [0.05, [34, 197, 94, 140], 'MRGL'], [0.15, [234, 179, 8, 150], 'SLGT'],
  [0.3, [249, 115, 22, 160], 'ENH'], [0.45, [239, 68, 68, 165], 'MDT'], [0.6, [168, 85, 247, 170], 'HIGH']];
/* fields whose worst value is the lowest (the whole-day summaries use the same rule) */
const LOW_WORST = new Set(['ml_cin']);

const valueText = (v, layer) => (layer.pct ? `${Math.round(v * 100)}%` : `${(v * (layer.mul || 1)).toFixed(1)} ${layer.unit}`.trim());
const weekday = (iso) => london(iso, { weekday: 'short' });
const stamp = (iso) => london(iso, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(/[^0-9A-Za-z]/g, '');
const fmtArea = (km2) => (km2 >= 1e4 ? `${Math.round(km2 / 1000).toLocaleString()}k km²` : `${Math.round(km2).toLocaleString()} km²`);
const howText = (field, how, pctField) => (field === 'precip_accum' ? 'Total that falls in the window'
  : how === 'mean' ? 'Average over the window'
    : LOW_WORST.has(field) ? 'Lowest at any time in the window' : `Highest ${pctField ? 'chance' : 'value'} at any time in the window`);

/* from slot i, every frame up to `hours` later */
function spanFrom(slots, i, hours) {
  const a = slots[Math.max(0, i)];
  if (!a) return { from: 0, to: 0 };
  const inside = slots.filter((x) => x.t >= a.t && x.t <= a.t + hours * 36e5);
  return { from: a.t, to: inside[inside.length - 1].t };
}

/* fields already fetched, most recently used last; about 60 MB of decoded fields at most */
const FIELD_CACHE = new Map();
function cachedField(product, manifest, lead, field) {
  const k = `${manifest.run_id}|${lead}|${field}`;
  let p = FIELD_CACHE.get(k);
  if (p) { FIELD_CACHE.delete(k); FIELD_CACHE.set(k, p); return p; }
  p = fetchField(product, manifest.run_id, lead, field);
  FIELD_CACHE.set(k, p);
  p.catch(() => FIELD_CACHE.delete(k));
  const cap = Math.max(12, Math.floor(60e6 / (4 * manifest.grid.nx * manifest.grid.ny)));
  while (FIELD_CACHE.size > cap) FIELD_CACHE.delete(FIELD_CACHE.keys().next().value);
  return p;
}

/* One field over a window of frames, cell by cell: the peak (and which frame it came in) or the
   average. Accumulated rain is the total that falls inside the window instead. */
async function combineFrames({ product, manifest, win, field, how, alive, onProgress }) {
  const n = manifest.grid.nx * manifest.grid.ny;
  if (field === 'precip_accum') {
    /* the running total at the end less the total before the window: Main Run holds each frame's
       rate over its 3 h (the whole-day totals add the same way), Hyper-Short integrates between frames */
    const all = (manifest.frames || []).filter((f) => f.valid).sort((x, y) => x.lead_min - y.lead_min);
    const i0 = all.findIndex((f) => f.lead_min === win[0].lead_min);
    const base = product === 'hyper' && win.length > 1 ? win[0] : all[i0 - 1] || null;
    const [end, start] = await Promise.all([cachedField(product, manifest, win[win.length - 1].lead_min, field),
      base ? cachedField(product, manifest, base.lead_min, field) : null]);
    onProgress(win.length, win.length);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = Math.max(0, end[i] - (start ? start[i] : 0));
    return { data: out, at: null };
  }
  const low = LOW_WORST.has(field);
  const out = new Float32Array(n).fill(NaN);
  const cnt = how === 'mean' ? new Uint16Array(n) : null;
  const at = cnt ? null : new Uint8Array(n).fill(255);
  const fold = (a, j) => {
    for (let i = 0; i < n; i += 1) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (cnt) { out[i] = cnt[i] ? out[i] + v : v; cnt[i] += 1; } else if (at[i] === 255 || (low ? v < out[i] : v > out[i]) || (v === out[i] && j < at[i])) { out[i] = v; at[i] = j; }
    }
  };
  let next = 0, done = 0;
  const worker = async () => {
    while (next < win.length && alive()) {
      const j = next; next += 1;
      const a = await cachedField(product, manifest, win[j].lead_min, field);
      if (!alive()) return;
      fold(a, j); done += 1; onProgress(done, win.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (cnt) for (let i = 0; i < n; i += 1) if (cnt[i]) out[i] /= cnt[i];
  return { data: out, at };
}

/* Risk levels are smoothed over about 6 km before they are drawn, the way a drawn outlook is, so
   the 2 km speckle does not break the edges into fragments. A NaN-aware box blur, twice (close to
   a Gaussian); cells with no data stay empty. Only the picture: the numbers stay unsmoothed. */
function smoothGrid(data, grid) {
  const { nx, ny } = grid, r = Math.max(1, Math.round(6000 / grid.dx_m));
  let a = data;
  for (let pass = 0; pass < 2; pass += 1) {
    const h = new Float32Array(a.length), out = new Float32Array(a.length);
    for (let y = 0; y < ny; y += 1) {
      const o = y * nx;
      for (let x = 0; x < nx; x += 1) {
        let s = 0, c = 0;
        for (let k = Math.max(0, x - r), e = Math.min(nx - 1, x + r); k <= e; k += 1) { const v = a[o + k]; if (v === v) { s += v; c += 1; } }
        h[o + x] = c ? s / c : NaN;
      }
    }
    for (let x = 0; x < nx; x += 1) {
      for (let y = 0; y < ny; y += 1) {
        let s = 0, c = 0;
        for (let k = Math.max(0, y - r), e = Math.min(ny - 1, y + r); k <= e; k += 1) { const v = h[k * nx + x]; if (v === v) { s += v; c += 1; } }
        const i = y * nx + x;
        out[i] = c && data[i] === data[i] ? s / c : NaN;
      }
    }
    a = out;
  }
  return a;
}

/* the UK-wide extreme of a combined field, when it came, and the area at each risk level or above */
function windowStats(combo, layer) {
  const { data, at, times, grid } = combo;
  const low = LOW_WORST.has(combo.field);
  let best = NaN, bi = -1;
  const count = RISK_LEVELS.map(() => 0);
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (bi < 0 || (low ? v < best : v > best)) { best = v; bi = i; }
    if (layer.pct) for (let q = RISK_LEVELS.length - 1; q >= 0; q -= 1) if (v >= RISK_LEVELS[q][0]) { count[q] += 1; break; }
  }
  for (let q = count.length - 2; q >= 0; q -= 1) count[q] += count[q + 1];          // this level or higher
  const cell = grid.cell_area_km2 || (grid.dx_m / 1000) ** 2;
  return { best: bi < 0 ? null : best, when: at && bi >= 0 && at[bi] !== 255 ? times[at[bi]] : null, areas: count.map((c) => c * cell) };
}

/* ── the combined window as a 1080×1920 image ────────────────────────────── */
const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;      // 0 = top of the world
const loadImg = (src, cors) => new Promise((ok) => {
  const im = new Image();
  if (cors) im.crossOrigin = 'anonymous';
  im.onload = () => ok(im); im.onerror = () => ok(null);
  im.src = src;
});
const greyTile = (part, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_${part}/MapServer/tile/${z}/${y}/${x}`;
const FONT = "Inter, 'Segoe UI', system-ui, sans-serif";

async function saveWindowPng({ overlay, title, lines, layer, footer, file }) {
  const W = 1080, H = 1920, MY = 250, MH = 1450;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  /* the map, full width: Great Britain and Ireland centred, grey base, the field, then place names */
  const bx0 = mercX(-10.7), bx1 = mercX(2.1), by0 = mercY(59.2), by1 = mercY(49.8);
  const sc = Math.min(W / (bx1 - bx0), MH / (by1 - by0));                    // px per world unit
  const vx0 = (bx0 + bx1) / 2 - W / 2 / sc, vy0 = (by0 + by1) / 2 - MH / 2 / sc;
  const z = Math.min(9, Math.ceil(Math.log2(sc / 256))), n = 2 ** z, tp = sc / n;
  const X = (u) => (u - vx0) * sc, Y = (u) => MY + (u - vy0) * sc;
  const tiles = (part) => {
    const jobs = [];
    for (let ty = Math.floor(vy0 * n); ty < (vy0 + MH / sc) * n; ty += 1) {
      for (let tx = Math.floor(vx0 * n); tx < (vx0 + W / sc) * n; tx += 1) jobs.push(loadImg(greyTile(part, z, tx, ty), true).then((im) => ({ im, tx, ty })));
    }
    return Promise.all(jobs);
  };
  const [base, names, logo] = await Promise.all([tiles('Base'), tiles('Reference'), loadImg('/logo.png', false)]);
  const draw = (list) => list.forEach(({ im, tx, ty }) => { if (im) ctx.drawImage(im, X(tx / n), Y(ty / n), tp + 0.6, tp + 0.6); });
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MY, W, MH); ctx.clip();
  ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0, MY, W, MH);
  draw(base);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(overlay, X(mercX(BOUNDS[0][1])), Y(mercY(BOUNDS[1][0])),
    (mercX(BOUNDS[1][1]) - mercX(BOUNDS[0][1])) * sc, (mercY(BOUNDS[0][0]) - mercY(BOUNDS[1][0])) * sc);
  ctx.globalAlpha = 1;
  draw(names);
  ctx.restore();
  /* the title, the window and how it was combined; the logo top right */
  let right = W - 56;
  if (logo) {
    const h = 112, w = Math.min(320, (h * logo.width) / logo.height);
    ctx.drawImage(logo, W - 56 - w, 58, w, (w * logo.height) / logo.width);
    right = W - 56 - w - 32;
  }
  const fit = (text, weight, size) => {
    let px = size;
    do { ctx.font = `${weight} ${px}px ${FONT}`; px -= 2; } while (ctx.measureText(text).width > right - 56 && px > 18);
  };
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#0f172a'; fit(title, 900, 60); ctx.fillText(title, 56, 118);
  ctx.fillStyle = '#334155'; fit(lines[0], 700, 34); ctx.fillText(lines[0], 56, 168);
  ctx.fillStyle = '#64748b'; fit(lines[1], 500, 27); ctx.fillText(lines[1], 56, 210);
  /* the key */
  const items = layer.stops.filter((q) => q[1][3] > 0).map(([v, c, name]) => [c,
    name ? `${name} ${Math.round(v * 100)}%` : layer.pct ? `${Math.round(v * 100)}%` : `${v}`]);
  ctx.fillStyle = '#0f172a'; ctx.font = `800 26px ${FONT}`;
  ctx.fillText(layer.step ? 'Risk level (chance at or above)' : `${layer.label}${!layer.pct && layer.unit ? ` (${layer.unit})` : ''}`, 56, MY + MH + 52);
  let kx = 56, ky = MY + MH + 76;
  ctx.font = `700 24px ${FONT}`;
  for (const [c, label] of items) {
    const w = 40 + 10 + ctx.measureText(label).width + 28;
    if (kx + w > W - 56) { kx = 56; ky += 42; }
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, c[3] / 170)})`;
    ctx.fillRect(kx, ky, 40, 26);
    ctx.fillStyle = '#334155'; ctx.fillText(label, kx + 50, ky + 22);
    kx += w;
  }
  ctx.fillStyle = '#94a3b8'; ctx.font = `600 22px ${FONT}`;
  ctx.fillText(footer, 56, H - 34);
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('the image could not be made');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = file;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ── data hooks ──────────────────────────────────────────────────────────── */
/* This page shows the last 24 hours of runs; older ones are in the TCM Archive (/TCMArchive). */
const FRESH_MS = 24 * 3600e3;
const isFresh = (r) => !!r && Date.now() - Date.parse(r.init_utc) < FRESH_MS;
function useRuns(product) {
  const [runs, setRuns] = useState([]);
  const [latest, setLatest] = useState(null);
  const [stale, setStale] = useState(null);           // the newest run, when even that is over a day old
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      const [r, l, s] = await Promise.all([
        novaFetch(`/api/nova/${product}/runs`).then((x) => x.json()),
        novaFetch(`/api/nova/${product}/latest`).then((x) => (x.ok ? x.json() : null)),
        novaFetch(`/api/nova/${product}/status`).then((x) => x.json()),
      ]);
      setRuns((r.runs || []).filter(isFresh)); setLatest(isFresh(l) ? l : null); setStale(l && !isFresh(l) ? l : null); setStatus(s); setError(null);
    } catch (e) { setError(String(e)); }
  }, [product]);
  useEffect(() => { setRuns([]); setLatest(null); setStale(null); load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);
  return { runs, latest, stale, status, error, reload: load };
}

/* ── lightning strikes: one canvas, redrawn only when the map moves ─────── */
const StrikeLayer = L.Layer.extend({
  initialize(strikes) { this.strikes = strikes; },
  onAdd(map) {
    this._map = map;
    this._c = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
    this._c.style.position = 'absolute'; this._c.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this._c);
    map.on('moveend zoomend resize', this._draw, this);
    this._draw();
  },
  onRemove(map) { map.off('moveend zoomend resize', this._draw, this); this._c.remove(); },
  setStrikes(s) { this.strikes = s; this._draw(); },
  _draw() {
    const map = this._map; if (!map) return;
    const size = map.getSize(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tl = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._c, tl);
    this._c.width = size.x * dpr; this._c.height = size.y * dpr;
    this._c.style.width = `${size.x}px`; this._c.style.height = `${size.y}px`;
    const ctx = this._c.getContext('2d'); ctx.scale(dpr, dpr);
    const st = this.strikes || []; if (!st.length) return;
    const t0 = st[0][0], t1 = st[st.length - 1][0], span = Math.max(t1 - t0, 1);
    const r = map.getZoom() >= 8 ? 2.6 : map.getZoom() >= 6 ? 2 : 1.5;
    const b = map.getBounds().pad(0.05);
    for (const [t, lat, lon] of st) {
      if (!b.contains([lat, lon])) continue;
      const a = (t - t0) / span;                                   // 0 oldest … 1 newest
      const p = map.latLngToContainerPoint([lat, lon]);
      ctx.fillStyle = a > 0.85 ? '#fffbe6' : a > 0.6 ? '#facc15' : a > 0.3 ? '#f97316' : '#b91c1c';
      ctx.globalAlpha = 0.55 + 0.45 * a;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
});

function useLightningToday(on) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    const load = () => fetch('/api/nova/lightning/day').then((r) => r.json()).then(setD).catch(() => setD({ count: 0, strikes: [], source: 'unavailable' }));
    load();
    const t = setInterval(load, 3 * 60000);
    return () => clearInterval(t);
  }, [on]);
  return d;
}

/* the overlay image: replaced in place, created on first use */
const putOverlay = (ov, m, url) => {
  if (ov.current) ov.current.setUrl(url);
  else ov.current = L.imageOverlay(url, BOUNDS, { opacity: 0.85, interactive: false }).addTo(m);
};

/* ── map ─────────────────────────────────────────────────────────────────── */
/* One frame (or one whole day) of one field. While hours are being combined (`combining`) it
   fetches nothing and shows `combined`, the field the page made, once it is ready. */
function NovaMap({ product, manifest, lead, day = null, layerKey, onHover, strikes, combining = false, combined = null, busyText = null }) {
  const el = useRef(null), map = useRef(null), overlay = useRef(null), dataRef = useRef(null), strikeLayer = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 10, zoomSnap: 0.25, scrollWheelZoom: 'center' }).fitBounds([[50.0, -10.6], [58.9, 1.9]]);
    setTimeout(() => { m.invalidateSize(); m.fitBounds([[50.0, -10.6], [58.9, 1.9]]); }, 250);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' }).addTo(m);
    m.createPane('labels'); m.getPane('labels').style.zIndex = 650; m.getPane('labels').style.pointerEvents = 'none';
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { pane: 'labels' }).addTo(m);
    m.on('mousemove', (e) => {
      const d = dataRef.current; if (!d) return;
      const [x, y] = toBNG(e.latlng.lat, e.latlng.lng);
      const g = d.grid; const ix = Math.floor((x - g.x0) / g.dx_m), iy = Math.floor((y - g.y0) / g.dx_m);
      if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) { onHover(null); return; }
      const i = iy * g.nx + ix;
      onHover({ v: d.data[i], lat: e.latlng.lat, lon: e.latlng.lng, when: d.at && d.at[i] !== 255 ? d.times[d.at[i]] : null });
    });
    map.current = m;
  }, [onHover]);
  useEffect(() => {
    if (!map.current) return;
    if (strikes && strikes.length) {
      if (strikeLayer.current) strikeLayer.current.setStrikes(strikes);
      else strikeLayer.current = new StrikeLayer(strikes).addTo(map.current);
    } else if (strikeLayer.current) { map.current.removeLayer(strikeLayer.current); strikeLayer.current = null; }
  }, [strikes]);
  useEffect(() => {
    if (!combining || !combined || !map.current) return;
    dataRef.current = combined;
    putOverlay(overlay, map.current, renderField(combined.shown, combined.grid, combined.layer));
  }, [combining, combined]);
  useEffect(() => {
    if (combining) { setBusy(false); setErr(null); return undefined; }
    if (!manifest || lead == null || manifest.product !== product) return undefined;   // a product switch, before its run arrives
    let alive = true;
    setBusy(true); setErr(null);
    fetchField(product, manifest.run_id, lead, layerKey, day).then((data) => {
      if (!alive) return;
      dataRef.current = { data, grid: manifest.grid };
      putOverlay(overlay, map.current, renderField(data, manifest.grid, LAYERS[layerKey]));
    }).catch((e) => { if (alive) { setErr(String(e.message || e)); if (overlay.current) { overlay.current.remove(); overlay.current = null; } dataRef.current = null; } })
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [product, manifest, lead, layerKey, day, combining]);
  return (
    <div style={{ position: 'relative' }}>
      {/* isolation: Leaflet's panes use z-index up to 1000; keep them inside the map so they never cover the sticky bars */}
      <div ref={el} style={{ height: 'min(72vh, 760px)', minHeight: 460, borderRadius: 14, overflow: 'hidden', background: '#e5e7eb', isolation: 'isolate', zIndex: 0, position: 'relative' }} />
      {(busyText || busy) && <div style={{ position: 'absolute', top: 10, left: 54, zIndex: 700, ...pill('#fff', T.mid) }}>{busyText || 'Loading field…'}</div>}
      {err && <div style={{ position: 'absolute', top: 10, left: 54, zIndex: 700, ...pill('#fef2f2', '#b91c1c') }}>Not in this run: {LAYERS[layerKey].label}</div>}
    </div>
  );
}
const pill = (bg, color) => ({ background: bg, color, border: `1px solid ${T.border}`, borderRadius: 99, padding: '4px 10px', fontSize: '0.7rem', fontWeight: 700 });

function Legend({ layerKey, layer = LAYERS[layerKey] }) {
  const l = layer;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: T.text, marginRight: 4 }}>{l.label}</span>
      {l.stops.filter((s) => s[1][3] > 0).map(([v, c, name]) => (
        <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.66rem', color: T.mid, fontFamily: MONO }}>
          <span style={{ width: 14, height: 10, borderRadius: 3, background: `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, c[3] / 200)})` }} />
          {name ? `${name} ≥${Math.round(v * 100)}%` : l.pct ? `${Math.round(v * 100)}%` : `${v}${l.unit ? ' ' + l.unit : ''}`}
        </span>
      ))}
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */
export default function TCMNova({ engineSwitcher = null, onUseV3 = null }) {
  /* NOVA is admin-only until launch: everyone else sees a locked "coming soon". */
  const [admin, setAdmin] = useState(null);
  useEffect(() => { isCurrentUserAdmin().then((a) => setAdmin(!!a)).catch(() => setAdmin(false)); }, []);
  if (admin === null) return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: '#64748b' }}>Loading…</div>;
  if (!admin) return <NovaComingSoon onUseV3={onUseV3} />;
  return <NovaForAdmin engineSwitcher={engineSwitcher} />;
}

function NovaComingSoon({ onUseV3 }) {
  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', display: 'grid', placeItems: 'center', padding: 24,
      background: 'radial-gradient(ellipse at 50% 35%, #0b1f3a 0%, #030712 70%)', color: '#e2e8f0', textAlign: 'center' }}>
      <div style={{ maxWidth: 460 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, margin: '0 auto 16px', display: 'grid', placeItems: 'center',
          background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)' }}>
          <LockIcon style={{ width: 28, height: 28, color: '#94a3b8' }} />
        </div>
        <div style={{ fontSize: '0.7rem', letterSpacing: '0.2em', color: '#7dd3fc', fontWeight: 800 }}>TCM NOVA</div>
        <h1 style={{ margin: '8px 0', fontSize: '2rem', fontWeight: 900, color: '#fff' }}>Coming soon</h1>
        <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
          TCM NOVA, MyWeatherUK's next-generation thunderstorm model, is in final testing and isn't open to the public yet.
          The TCM V3 outlook is available in the meantime.
        </p>
        {onUseV3 && (
          <button type="button" onClick={onUseV3} style={{ marginTop: 10, padding: '10px 18px', borderRadius: 99, border: 'none', cursor: 'pointer',
            fontWeight: 800, background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', color: '#fff' }}>Open TCM V3</button>
        )}
      </div>
    </div>
  );
}

function NovaForAdmin({ engineSwitcher }) {
  /* Every visit starts on the globe; the model opens once a region is picked. */
  const [region, setRegion] = useState(null);
  if (!region) return <NovaGlobe onSelect={setRegion} />;
  return <NovaModel engineSwitcher={engineSwitcher} region={region} onChangeRegion={() => setRegion(null)} />;
}

function NovaModel({ engineSwitcher, region, onChangeRegion }) {
  const [product, setProductState] = useState(() => { try { return localStorage.getItem('nova_product') === 'hyper' ? 'hyper' : 'main'; } catch { return 'main'; } });
  const setProduct = (p) => { setProductState(p); try { localStorage.setItem('nova_product', p); } catch { /* blocked */ } };
  const { runs, latest, stale, status, reload } = useRuns(product);
  const [pinned, setPinned] = useState(null);          // a run id the user chose; null = follow latest
  const [manifest, setManifest] = useState(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState('map');
  const [layerKey, setLayerKey] = useState('p_thunder');
  const [hover, setHover] = useState(null);
  const [ended, setEnded] = useState(false);
  const [showLightning, setShowLightning] = useState(() => { try { return localStorage.getItem('nova_lightning') === '1'; } catch { return false; } });
  const lightning = useLightningToday(showLightning);
  /* Main Run: a day opens as its WHOLE-DAY risk (max over the day); 3-hourly frames are opt-in */
  const [threeHourly, setThreeHourly] = useState(() => { try { return localStorage.getItem('nova_3h') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('nova_3h', threeHourly ? '1' : '0'); } catch { /* blocked */ } }, [threeHourly]);
  useEffect(() => { try { localStorage.setItem('nova_lightning', showLightning ? '1' : '0'); } catch { /* blocked */ } }, [showLightning]);
  /* combining hours: one map from a start time to an end time, which may be on another day */
  const [combine, setCombine] = useState(null);             // { from, to, how }: valid times (ms), or null when off
  const [combineStyle, setCombineStyle] = useState(() => { try { return localStorage.getItem('nova_combine_style') === 'shades' ? 'shades' : 'levels'; } catch { return 'levels'; } });
  useEffect(() => { try { localStorage.setItem('nova_combine_style', combineStyle); } catch { /* blocked */ } }, [combineStyle]);
  const [combo, setCombo] = useState(null);                  // the combined field
  const [comboProg, setComboProg] = useState(null);          // [frames done, of] while combining
  const [comboErr, setComboErr] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setPinned(null); setIdx(0); setEnded(false); setLayerKey('p_thunder'); setCombine(null); }, [product]);
  useEffect(() => { if (pinned && runs.length && !runs.some((r) => r.run_id === pinned)) setPinned(null); }, [pinned, runs]);
  /* follow the newest run unless the user is examining an older one */
  useEffect(() => {
    if (pinned) {
      novaFetch(`/api/nova/${product}/runs/${pinned}`).then((r) => (r.ok ? r.json() : null)).then(setManifest);
    } else {
      setManifest((m) => (latest ? (!m || m.run_id !== latest.run_id ? latest : m) : null));   // none in the last 24 h: none shown
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

  /* every frame's valid time, UK day and minute of the day (the combine pickers work in these) */
  const slots = useMemo(() => frames.map((f) => {
    const [h, mi] = london(f.valid, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
    return { f, t: Date.parse(f.valid), day: london(f.valid, { year: 'numeric', month: '2-digit', day: '2-digit' }), mins: h * 60 + mi };
  }), [frames]);
  const win = useMemo(() => (combine ? slots.filter((x) => x.t >= combine.from && x.t <= combine.to) : []), [slots, combine]);
  const winKey = win.map((x) => x.f.lead_min).join(',');
  const how = combine?.how || null;

  const groups = product === 'main' ? MAIN_LAYER_GROUPS : HYPER_LAYER_GROUPS;

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
  const dayMeta = frame ? (manifest?.days || []).find((d) => d.lead_min?.includes(frame.lead_min)) : null;
  const dayView = product === 'main' && !threeHourly && !!dayMeta && dayMeta.fields.includes(layerKey);
  const fieldMax = (f, fr = frame) => {
    if (win.length) return win.reduce((m, x) => { const v = x.f.stats?.[f]?.max; return v == null ? m : Math.max(m ?? v, v); }, null);
    return (dayView && dayMeta?.stats?.[f] ? dayMeta.stats[f].max : fr?.stats?.[f]?.max) ?? null;
  };
  const [word, colour] = riskWord(dayMeta?.stats?.p_thunder?.max ?? dayMax);
  const P = PRODUCTS[product];

  /* a newer run that no longer covers the window: start again from its first frame */
  useEffect(() => { if (combine && slots.length && !win.length) setCombine((c) => c && { ...c, ...spanFrom(slots, 0, 12) }); }, [combine, slots, win.length]);
  useEffect(() => {
    if (!how || !manifest || !winKey || manifest.product !== product) { setCombo(null); setComboProg(null); return undefined; }
    const list = winKey.split(',').map(Number).map((l) => manifest.frames.find((f) => f.lead_min === l)).filter(Boolean);
    let alive = true;
    setComboErr(null); setComboProg([0, list.length]);
    combineFrames({ product, manifest, win: list, field: layerKey, how, alive: () => alive, onProgress: (d, n) => { if (alive) setComboProg([d, n]); } })
      .then(({ data, at }) => { if (alive) setCombo({ data, at, grid: manifest.grid, times: list.map((f) => f.valid), field: layerKey, how }); })
      .catch((e) => { if (alive) { setCombo(null); setComboErr(`${LAYERS[layerKey].label} is missing from part of this window (${e.message || e}).`); } })
      .finally(() => { if (alive) setComboProg(null); });
    return () => { alive = false; };
  }, [product, manifest, layerKey, how, winKey]);
  const comboLayer = useMemo(() => (combineStyle === 'levels' && LAYERS[layerKey].pct ? { ...LAYERS[layerKey], stops: RISK_LEVELS, step: true } : LAYERS[layerKey]), [layerKey, combineStyle]);
  const combined = useMemo(() => (combo && combo.field === layerKey && combo.how === how
    ? { ...combo, layer: comboLayer, shown: comboLayer.step ? smoothGrid(combo.data, combo.grid) : combo.data } : null), [combo, comboLayer, layerKey, how]);
  const comboStats = useMemo(() => (combined ? windowStats(combined, LAYERS[combined.field]) : null), [combined]);
  /* open on the frame (or the whole day) being looked at, 12 hours long */
  const openCombine = () => {
    const d = dayView ? days.find((x) => x.key === curDay) : null;
    setCombine({ how: 'peak', ...spanFrom(slots, d ? d.first : Math.min(idx, slots.length - 1), 12) });
    setPlaying(false); setEnded(false);
  };
  const dayWindow = (key) => {
    const xs = slots.filter((x) => x.day === key);
    if (xs.length) setCombine((c) => ({ ...c, from: xs[0].t, to: xs[xs.length - 1].t }));
  };
  const saveImage = async () => {
    if (!combined || !win.length) return;
    const a = win[0].f.valid, b = win[win.length - 1].f.valid;
    setSaving(true);
    try {
      await saveWindowPng({
        overlay: renderCanvas(combined.shown, combined.grid, combined.layer),
        title: layerKey === 'p_thunder' ? 'THUNDERSTORM RISK' : LAYERS[layerKey].label.toUpperCase(),
        lines: [`${dayName(a)} ${hhmm(a)}  →  ${dayName(b)} ${hhmm(b)}`, howText(layerKey, how, LAYERS[layerKey].pct)],
        layer: combined.layer,
        footer: `TCM NOVA · ${P.label} · run initialised ${manifest.init_local}`,
        file: `nova-${layerKey}-${stamp(a)}-${stamp(b)}.png`,
      });
    } catch (e) {
      setComboErr(`The image could not be saved (${e.message || e}).`);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: 'inherit' }}>
      {/* header bar */}
      {/* Docks under the site's own sticky nav (56 px on desktop) and stays beneath its
          menus (z 45); on phones the site has a floating menu button top-right, so the
          bar leaves room for it rather than sliding under it. */}
      <style>{`.nova-bar{position:sticky;top:56px;z-index:40}.nova-bar-inner{padding:10px 16px}
        @media (max-width:767px){.nova-bar{top:0}.nova-bar-inner{padding:10px 56px 10px 12px}}`}</style>
      <div className="nova-bar" style={{ background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${T.border}` }}>
        <div className="nova-bar-inner" style={{ maxWidth: 1360, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
          <Link to={`/TCMArchive?product=${product}`} style={{ ...pill(T.soft, T.mid), textDecoration: 'none' }} title="Runs over a day old are kept in the TCM Archive">Older runs</Link>
          <button type="button" onClick={reload} style={{ ...pill(T.soft, T.mid), cursor: 'pointer' }} title="Check for new runs"><RefreshCw style={{ width: 13, height: 13 }} /></button>
          <button type="button" onClick={onChangeRegion} style={{ ...pill(T.soft, T.text), cursor: 'pointer' }} title="Pick another region on the globe">🌍 {region.name}</button>
          {engineSwitcher}
        </div>
      </div>

      {product === 'main' && days.length > 0 && (
        <div style={{ background: '#fff', borderBottom: `1px solid ${T.border}` }}>
          <div role="tablist" aria-label="Forecast day" style={{ maxWidth: 1360, margin: '0 auto', padding: '8px 16px', display: 'flex', gap: 6, overflowX: 'auto' }}>
            {days.slice(0, 4).map((d, i) => {
              const [w, c] = riskWord(d.max);
              const on = combine ? win.some((x) => x.day === d.key) : d.key === curDay;
              return (
                <button key={d.key} type="button" role="tab" aria-selected={on} onClick={() => { if (combine) dayWindow(d.key); else { setIdx(d.first); setEnded(false); } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    border: `1px solid ${on ? '#0f172a' : T.border}`, background: on ? '#0f172a' : T.soft, color: on ? '#fff' : T.text }}>
                  <span style={{ fontFamily: MONO, fontSize: '0.62rem', opacity: 0.75 }}>DAY {i + 1}</span>
                  <span style={{ fontWeight: 800, fontSize: '0.8rem' }}>{d.label}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: c }} title={w} />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '16px' }}>
        {/* hero */}
        <div style={{ ...card, padding: '18px 22px', marginBottom: 16, background: `linear-gradient(120deg, ${colour}1f, #ffffff 60%)`, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: '0.66rem', fontFamily: MONO, letterSpacing: '0.12em', color: T.faint }}>
              {region.name.toUpperCase()} · {P.label.toUpperCase()} · {frame ? dayName(frame.valid).toUpperCase() : '—'}
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
                const on = combine ? win.some((x) => x.day === d.key) : d.key === curDay;
                return (
                  <button key={d.key} type="button" onClick={() => { if (combine) dayWindow(d.key); else { setIdx(d.first); setEnded(false); } }}
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
              <SectionTitle icon={AlertTriangle} text={combine ? 'Hazards · peak in window' : dayView ? 'Hazards · whole day' : 'Hazards · this frame'} />
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
              {[['map', 'Map', MapIcon], ['overview', 'Sources & method', Database], ['learning', 'Learning', TrendingUp], ['status', 'Run status', Activity]].map(([k, l, I]) => (
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
                <div style={{ fontWeight: 800, color: T.text, marginTop: 8 }}>{stale ? `No ${P.label} in the last 24 hours` : `No published ${P.label} run yet`}</div>
                <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
                  {stale && <>The newest, from {stale.init_local}, is in the <Link to={`/TCMArchive?product=${product}&run=${stale.run_id}&date=${stale.init_local.slice(0, 10)}`} style={{ color: T.sky, fontWeight: 800 }}>TCM Archive</Link>. </>}
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
                    <button type="button" onClick={() => setShowLightning((v) => !v)} aria-pressed={showLightning}
                      style={{ ...pill(showLightning ? '#fef9c3' : '#fff', showLightning ? '#854d0e' : T.mid), cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                        borderColor: showLightning ? '#facc15' : T.border }}>
                      <Zap style={{ width: 13, height: 13 }} /> Lightning today
                      {showLightning && lightning && <span style={{ fontFamily: MONO }}>· {lightning.count.toLocaleString()} strikes</span>}
                    </button>
                    <button type="button" onClick={() => (combine ? setCombine(null) : openCombine())} aria-pressed={!!combine}
                      title="Combine the forecast from one time to another, across days if you like, into one map"
                      style={{ ...pill(combine ? '#e0f2fe' : '#fff', combine ? '#0369a1' : T.mid), cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                        borderColor: combine ? '#7dd3fc' : T.border }}>
                      <CalendarRange style={{ width: 13, height: 13 }} /> Combine hours
                    </button>
                    {hover && Number.isFinite(hover.v) && (
                      <span style={{ ...pill(T.soft, T.text), fontFamily: MONO }}>
                        {combine && how === 'mean' && layerKey !== 'precip_accum' ? 'avg ' : ''}{valueText(hover.v, LAYERS[layerKey])}{hover.when ? ` at ${weekday(hover.when)} ${hhmm(hover.when)}` : ''} · {hover.lat.toFixed(2)}, {hover.lon.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <Legend layerKey={layerKey} layer={combine ? comboLayer : undefined} />
                  {!combine && frame?.stats?.[layerKey] && frame.stats[layerKey].max != null && frame.stats[layerKey].max * (LAYERS[layerKey].pct ? 1 : (LAYERS[layerKey].mul || 1)) < LAYERS[layerKey].stops[0][0] && (
                    <div style={{ fontSize: '0.72rem', color: T.mid }}>
                      Nothing to show for this frame: {LAYERS[layerKey].pct ? `the highest value anywhere is ${Math.round((frame.stats[layerKey].max || 0) * 100)}%` : 'the field stays below the lowest colour band everywhere'}. The layer is working; there is simply no {LAYERS[layerKey].label.toLowerCase()} signal at this time.
                    </div>
                  )}
                  {showLightning && lightning && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.68rem', color: T.mid, flexWrap: 'wrap' }}>
                      <b style={{ color: T.text }}>Lightning since 00:00</b>
                      {[['#b91c1c', 'earliest'], ['#f97316', ''], ['#facc15', ''], ['#fffbe6', 'latest']].map(([c, l], i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><span style={{ width: 9, height: 9, borderRadius: 9, background: c, border: '1px solid rgba(0,0,0,0.25)' }} />{l}</span>
                      ))}
                      <span>· {lightning.source}</span>
                    </div>
                  )}
                </div>
                <div style={{ ...card, padding: 8, position: 'relative' }}>
                  <NovaMap product={product} manifest={manifest} lead={frame?.lead_min} day={dayView ? dayMeta.date : null} layerKey={layerKey} onHover={setHover}
                    strikes={showLightning ? lightning?.strikes : null} combining={!!combine} combined={combined}
                    busyText={comboProg ? `Combining ${comboProg[0]} of ${comboProg[1]} frames…` : null} />
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
                {!combine && product === 'main' && manifest?.days?.length > 0 && (
                  <div style={{ ...card, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 900, fontSize: '0.95rem' }}>{dayView ? `${dayMeta.label} · whole day` : frame ? `${dayName(frame.valid)} ${hhmm(frame.valid)}` : '—'}</div>
                    {dayView && <span style={{ ...pill(T.soft, T.mid) }}>highest value at any time of the day{dayMeta.complete ? '' : ' (part day in this run)'}</span>}
                    {!threeHourly && dayMeta && !dayMeta.fields.includes(layerKey) && <span style={{ ...pill('#fff7ed', '#c2410c') }}>this layer has no whole-day summary · showing {hhmm(frame.valid)}</span>}
                    <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer' }}>
                      <input type="checkbox" checked={threeHourly} onChange={(e) => { setThreeHourly(e.target.checked); setPlaying(false); }} style={{ accentColor: T.sky }} />
                      3-hourly view
                    </label>
                  </div>
                )}
                {!combine && (product !== 'main' || threeHourly || !manifest?.days?.length) && (
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
                  {product === 'hyper' && frame?.nowcast_weight != null && (
                    <div style={{ marginTop: 8, fontSize: '0.72rem', color: T.mid }}>
                      This frame: {Math.round(frame.nowcast_weight * 100)}% observation nowcast, {100 - Math.round(frame.nowcast_weight * 100)}% latest UKV{frame.ukv_environment ? '' : ' (UKV not available for this time)'}.
                    </div>
                  )}
                </div>
                )}
                {combine && (
                  <CombinePanel slots={slots} days={days} combine={combine} setCombine={setCombine} win={win} stats={comboStats} prog={comboProg} err={comboErr}
                    layerKey={layerKey} combineStyle={combineStyle} setCombineStyle={setCombineStyle} saving={saving} canSave={!!combined && !comboProg}
                    onSave={saveImage} onClose={() => setCombine(null)} dayTabs={product === 'main'} />
                )}
                <div style={{ ...card, padding: 12, fontSize: '0.72rem', color: T.mid, lineHeight: 1.6, display: 'flex', gap: 8 }}>
                  <Info style={{ width: 15, height: 15, flexShrink: 0, color: T.sky }} />
                  <span>
                    {String(manifest.calibration || '').startsWith('isotonic')
                      ? <>Thunderstorm and lightning probabilities are <b>calibrated</b> against observed storms (radar cores and lightning) from hindcasts; other hazards are not yet.</>
                      : <>Probabilities are <b>uncalibrated</b>{manifest.calibration === 'pending' ? ' (calibration from hindcasts is being built)' : ''}; risk words (TSTM…HIGH) are banded from them.</>} Probabilities mean “a thunderstorm within about {Math.round(product === 'main' ? 10 + 0.35 * (frame?.lead_h || 0) : frame?.neighbourhood_km || 3)} km”.
                    Tornado layers describe a favourable <b>environment</b>, not a tornado forecast.
                  </span>
                </div>
              </>
            )}

            {manifest && tab === 'overview' && <Overview manifest={manifest} frame={frame} product={product} />}
            {tab === 'status' && <StatusPanel manifest={manifest} status={status} />}
            {tab === 'learning' && <LearningPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
/* Combine hours: the start and the end (day and time), quick windows, how to combine, and what
   came out of it: the highest value, when it came and the area at each risk level. */
function CombinePanel({ slots, days, combine, setCombine, win, stats, prog, err, layerKey, combineStyle, setCombineStyle, saving, canSave, onSave, onClose, dayTabs }) {
  if (!win.length) return null;
  const layer = LAYERS[layerKey];
  const accum = layerKey === 'precip_accum';
  const a = win[0], b = win[win.length - 1];
  const setFrom = (t) => setCombine((c) => ({ ...c, from: t, to: Math.max(t, c.to) }));
  const setTo = (t) => setCombine((c) => ({ ...c, to: t, from: Math.min(t, c.from) }));
  /* a day's frame nearest a time of day, so changing the day keeps the hour */
  const near = (key, mins, minT = -Infinity) => slots.filter((x) => x.day === key && x.t >= minT)
    .reduce((best, x) => (!best || Math.abs(x.mins - mins) < Math.abs(best.mins - mins) ? x : best), null)?.t;
  const di = days.findIndex((d) => d.key === a.day);
  const d0 = days[di]?.key, d1 = days[di + 1]?.key;
  const span = (pred) => { const xs = slots.filter(pred); return xs.length ? { from: xs[0].t, to: xs[xs.length - 1].t } : null; };
  const presets = [
    ['Afternoon & evening', '12:00–00:00', span((x) => (x.day === d0 && x.mins >= 720) || (x.day === d1 && x.mins === 0))],
    ['Overnight', '18:00–06:00', span((x) => (x.day === d0 && x.mins >= 1080) || (x.day === d1 && x.mins <= 360))],
    ['Whole day', days[di]?.label || '', span((x) => x.day === d0)],
    ['Next 24 h', `from ${hhmm(a.f.valid)}`, span((x) => x.t >= a.t && x.t <= a.t + 864e5)],
  ];
  const sel = { ...pill('#fff', T.text), padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.76rem' };
  const picker = (label, s, dayList, times, onPick, minT) => (
    <div role="group" aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.12em', color: T.faint, fontFamily: MONO, width: 34 }}>{label.toUpperCase()}</span>
      <select value={s.day} aria-label={`${label} day`} onChange={(e) => onPick(near(e.target.value, s.mins, minT))} style={sel}>
        {dayList.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
      <select value={s.t} aria-label={`${label} time`} onChange={(e) => onPick(Number(e.target.value))} style={{ ...sel, fontFamily: MONO }}>
        {times.map((x) => <option key={x.t} value={x.t}>{hhmm(x.f.valid)}</option>)}
      </select>
    </div>
  );
  const seg = (on) => ({ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 11px', fontWeight: 800, fontSize: '0.72rem', fontFamily: 'inherit',
    background: on ? '#0f172a' : 'transparent', color: on ? '#fff' : T.mid });
  const group = (aria, items, value, onPick) => (
    <div role="radiogroup" aria-label={aria} style={{ display: 'inline-flex', background: T.soft, border: `1px solid ${T.border}`, borderRadius: 10, padding: 2 }}>
      {items.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onPick(k)} style={seg(value === k)}>{l}</button>)}
    </div>
  );
  const hours = Math.round(((b.t - a.t) / 36e5) * 10) / 10;
  const best = stats?.best;
  const [word, colour] = layer.pct && best != null ? riskWord(best) : [null, T.text];
  const what = layerKey === 'p_thunder' ? 'thunderstorm risk' : layer.label.toLowerCase();
  return (
    <div style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}><SectionTitle icon={CalendarRange} text="Combine hours" /></div>
        <button type="button" onClick={onSave} disabled={!canSave || saving} title="Save this window as a 1080×1920 image"
          style={{ ...pill('#fff', T.text), cursor: canSave && !saving ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : 0.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Download style={{ width: 13, height: 13 }} /> {saving ? 'Saving…' : 'Save image'}
        </button>
        <button type="button" onClick={onClose} aria-label="Stop combining hours" title="Back to single times" style={{ ...btn, width: 30, height: 30 }}><X style={{ width: 15, height: 15 }} /></button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {picker('From', a, days, slots.filter((x) => x.day === a.day), setFrom, -Infinity)}
        <span style={{ color: T.faint, fontWeight: 900 }}>→</span>
        {picker('To', b, days.filter((d) => slots.some((x) => x.day === d.key && x.t >= a.t)), slots.filter((x) => x.day === b.day && x.t >= a.t), setTo, a.t)}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {presets.map(([l, sub, w]) => {
          const on = !!w && w.from === a.t && w.to === b.t;
          return (
            <button key={l} type="button" disabled={!w} onClick={() => setCombine((c) => ({ ...c, ...w }))} aria-pressed={on}
              style={{ ...pill(on ? '#0f172a' : '#fff', on ? '#fff' : T.text), cursor: w ? 'pointer' : 'not-allowed', opacity: w ? 1 : 0.45 }}>
              {l} <span style={{ fontWeight: 600, opacity: 0.7 }}>{sub}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {accum ? <span style={{ ...pill(T.soft, T.mid) }}>Rain total in the window</span>
          : group('How to combine', [['peak', LOW_WORST.has(layerKey) ? 'Lowest' : 'Peak'], ['mean', 'Average']], combine.how, (k) => setCombine((c) => ({ ...c, how: k })))}
        {layer.pct && group('Map style', [['levels', 'Risk levels'], ['shades', 'Shades']], combineStyle, setCombineStyle)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: '0.95rem' }}>{dayName(a.f.valid)} {hhmm(a.f.valid)} → {dayName(b.f.valid)} {hhmm(b.f.valid)}</div>
        <span style={{ ...pill(T.soft, T.mid), fontFamily: MONO }}>{hours} h · {win.length} frame{win.length === 1 ? '' : 's'}</span>
        {prog && <span style={{ ...pill('#e0f2fe', '#0369a1'), fontFamily: MONO }}>combining {prog[0]}/{prog[1]}</span>}
      </div>
      {err && <div style={{ fontSize: '0.74rem', color: '#b91c1c' }}>{err}</div>}
      {!prog && best != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: layer.pct ? `${colour}14` : T.soft, border: `1px solid ${T.border}` }}>
          {word && <span style={{ ...pill('#fff', colour), fontWeight: 900 }}>{word}</span>}
          <span style={{ fontFamily: MONO, fontWeight: 900, fontSize: '1.35rem' }}>{valueText(best, layer)}</span>
          <span style={{ fontSize: '0.78rem', color: T.mid }}>
            {accum ? 'the most rain anywhere in the window' : `${combine.how === 'mean' ? 'highest average' : LOW_WORST.has(layerKey) ? 'lowest' : 'highest'} ${what} in the window`}
            {stats.when ? <>, at <b style={{ color: T.text }}>{dayName(stats.when)} {hhmm(stats.when)}</b></> : null}
          </span>
        </div>
      )}
      {!prog && layer.pct && stats && stats.areas.some((x) => x > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.7rem', color: T.mid }}>
          <b style={{ color: T.text }}>Area at each level or above</b>
          {RISK_LEVELS.map(([, c, name], q) => stats.areas[q] > 0 && (
            <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: `rgb(${c[0]},${c[1]},${c[2]})` }} />{name} {fmtArea(stats.areas[q])}
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: '0.7rem', color: T.mid, lineHeight: 1.55 }}>
        {accum ? 'The rain that falls between the first and the last time, from the run’s rain rate (Main Run frames hold for 3 h each).'
          : combine.how === 'mean'
            ? `Average: the mean of the ${win.length} frames at every point. It shows how long a risk lasts and always sits at or below the peak.`
            : `Peak: the ${LOW_WORST.has(layerKey) ? 'lowest' : 'highest'} value at every point at any one time in the window, the rule the whole-day maps use.${layer.pct ? ' The chance of a storm at some point in a long window is higher than any one time’s chance, so read a long window as a floor.' : ''} Hover the map for the value at a point and when it came.`}
        {combineStyle === 'levels' && layer.pct ? ' Risk levels are smoothed over about 6 km like a drawn outlook; the numbers are not.' : ''}
        {dayTabs ? ' The days the window touches are highlighted above; click a day to combine all of it.' : ''}
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
          <h4 style={{ color: T.text, marginBottom: 4 }}>Inputs</h4>
          <p style={{ marginTop: 0 }}>Observations (radar, lightning) drive the first hours; the latest UKV run ({manifest.ukv_cycle_utc ? manifest.ukv_cycle_utc.slice(0, 16).replace('T', ' ') + ' UTC' : 'not available'}) supplies the 3-D environment and takes over with lead time. Nowcast weight this frame: {frame?.nowcast_weight != null ? Math.round(frame.nowcast_weight * 100) + '%' : '—'}.</p>
          <h4 style={{ color: T.text, marginBottom: 4 }}>Sources</h4>
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

const WIN = { 0: '0–6 h', 1: '6–24 h', 2: '24–72 h', 3: '72–96 h' };
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function LearningPanel() {
  const [days, setDays] = useState([]);
  const [day, setDay] = useState(null);
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { novaFetch('/api/nova/learning/days').then((r) => r.json()).then((d) => { setDays(d.days || []); setDay((d.days || [])[0] || null); }); }, []);
  useEffect(() => {
    if (!day) return;
    novaFetch(`/api/nova/learning/report/${day}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setRep).catch((e) => setErr(String(e)));
  }, [day]);
  return (
    <div style={{ ...card, padding: 16, fontSize: '0.78rem', color: T.mid, lineHeight: 1.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, color: T.text }}>Nightly learning</h3>
        <select value={day || ''} onChange={(e) => setDay(e.target.value)} aria-label="Learning day" style={{ ...pill(T.soft, T.text), padding: '6px 10px' }}>
          {days.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span style={{ fontSize: '0.7rem' }}>Every night at 00:00 the day's runs are checked against radar and lightning, then weights and calibration are retrained.</span>
      </div>
      {!days.length && <p>No learning report yet — the first one is written at midnight.</p>}
      {err && <p>Could not load that report.</p>}
      {rep && (
        <>
          <h4 style={{ color: T.text, marginBottom: 4 }}>Analysis</h4>
          <p style={{ marginTop: 0, whiteSpace: 'pre-wrap', color: T.text }}>{rep.ai_analysis || rep.rule_based_analysis || 'Nothing to analyse for this day.'}</p>
          <p style={{ fontSize: '0.68rem', marginTop: -6 }}>{rep.ai_analysis ? 'Written by Claude from the verification numbers below — it cannot change model settings.' : 'Rule-based summary (' + rep.ai_analysis_status + ').'}</p>
          {Object.entries(rep.products || {}).map(([prod, r]) => (
            <div key={prod} style={{ marginTop: 12 }}>
              <h4 style={{ color: T.text, margin: '0 0 4px' }}>{prod === 'main' ? 'TCM Main Run' : 'TCM Hyper-Short'}</h4>
              {Object.keys(r.scores_by_window || {}).length === 0 ? <p style={{ margin: 0 }}>No frames from this product could be verified for this day.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', fontFamily: MONO }}>
                  <thead><tr style={{ textAlign: 'left', color: T.faint }}><th>Lead</th><th>Brier</th><th>BSS</th><th>Mean p</th><th>Observed</th><th>POD</th><th>FAR</th><th>CSI</th></tr></thead>
                  <tbody>{Object.entries(r.scores_by_window).map(([w, sc]) => (
                    <tr key={w} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td>{WIN[w] || w}</td><td>{sc.brier.toFixed(4)}</td><td>{sc.bss == null ? '—' : sc.bss.toFixed(3)}</td>
                      <td>{pct(sc.mean_p)}</td><td>{pct(sc.event_rate)}</td><td>{pct(sc.pod)}</td><td>{pct(sc.far)}</td><td>{pct(sc.csi)}</td>
                    </tr>))}</tbody>
                </table>
              )}
              {r.diagnosis && Object.keys(r.diagnosis).length > 0 && (
                <div style={{ fontSize: '0.7rem', marginTop: 6 }}>
                  {Object.entries(r.diagnosis).map(([g, d]) => (
                    <div key={g}><b>{g.replace('_', ' ')}</b> ({d.n} cells): MUCAPE {d.mu_cape ?? '—'} J/kg · MLCIN {d.ml_cin ?? '—'} · 0–6 km shear {d.shear_0_6km ?? '—'} m/s · terrain ascent {d.w_oro ?? '—'} m/s · lead {d.lead_h ?? '—'} h</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <h4 style={{ color: T.text, marginBottom: 4 }}>What the model learned</h4>
          <ul style={{ marginTop: 0, fontSize: '0.72rem' }}>
            {typeof rep.calibration_update === 'object' && Object.entries(rep.calibration_update).map(([k, c]) => (
              <li key={k}>{k}: calibration {c.applied ? 'applied' : 'not applied'} ({c.n_days} days; cross-validated Brier {c.brier_cv_raw?.toFixed?.(4) ?? '—'} → {c.brier_cv_calibrated?.toFixed?.(4) ?? '—'})</li>
            ))}
            {typeof rep.skill_update === 'object' && Object.entries(rep.skill_update).map(([w, m]) => (
              <li key={w}>Model skill {WIN[w] || w}: {Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
