/* ═════════════════════════════════════════════════════════════════════════
   SnowMapGraphicTool — the two model-driven snow graphics in the Graphic
   Studio, drawn straight onto a 1080×1920 canvas:

   • mode="accumulation" — how much snow is expected to SETTLE (cm), from a
     blend of ECMWF, GFS, UKMO global and UKV 2 km (or any one of them).
   • mode="risk" — what falls: snow that settles, snow that falls but mostly
     won't settle, and snow mixed with rain. A dark purple line marks how far
     the snow could POSSIBLY reach — either where any single model has it, or
     the main area pushed a chosen distance in a chosen direction.

   DATA
   ----
   One Open-Meteo request: daily snowfall_sum, precipitation_sum and
   temperature_2m_mean on a 0.5° grid for all four models. Fields are
   interpolated bilinearly per pixel and classified AFTER interpolation, so
   the bands have smooth edges instead of 0.5° blocks, then clipped to the
   coastline.

   Settling is estimated, not modelled: Open-Meteo's snowfall is snow that
   falls, so the accumulation scales it by the mean temperature — all of it
   at 0.5 °C or below, none at 3 °C or above, linear between. The footer says
   so on the graphic.
   ═════════════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, Snowflake, CloudSnow } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { loadUKCoastline, makeProjector, makeInverseProjector, UK_BBOX } from '@/lib/ukCoastline';
import { SnowBackgroundPicker, snowBackground, readSnowBgId } from '@/lib/snowBackgrounds';

const W = 1080, H = 1920;
const MAP_X = 80, MAP_Y = 300, MAP_W = 920;
const MAP_H = Math.round(MAP_W * 1.524);           // UK_BBOX in Mercator is 1.524 tall per 1 wide
const STEP = 0.5, LAT0 = 49.5, LAT1 = 61, LON0 = -11, LON1 = 2.5;
const NY = Math.round((LAT1 - LAT0) / STEP) + 1, NX = Math.round((LON1 - LON0) / STEP) + 1;

const MODELS = [
  { id: 'ecmwf_ifs', label: 'ECMWF' },
  { id: 'ncep_gfs_global', label: 'GFS' },
  { id: 'ukmo_global_deterministic_10km', label: 'UKMO' },
  { id: 'ukmo_uk_deterministic_2km', label: 'UKV' },
];

const ACC_SCALE = [
  [0.5, '#cfe8ff'], [1, '#93c5fd'], [2, '#60a5fa'], [5, '#3b82f6'],
  [10, '#6366f1'], [15, '#9333ea'], [25, '#d946ef'], [40, '#f5d0fe'],
];
const RISK_CATS = [
  null,
  { id: 'mix',    label: 'Snow & rain',   color: '#38bdf8' },
  { id: 'fall',   label: 'Falling snow',  color: '#c7d2fe' },
  { id: 'settle', label: 'Accumulating snow', color: '#ffffff' },
];
const EXTENT_COLOR = '#6b21a8';

const CITIES = [
  ['London', -0.13, 51.51], ['Birmingham', -1.9, 52.48], ['Manchester', -2.24, 53.48],
  ['Leeds', -1.55, 53.8], ['Newcastle', -1.61, 54.98], ['Glasgow', -4.25, 55.86, 'left'],
  ['Edinburgh', -3.19, 55.95], ['Aberdeen', -2.1, 57.15], ['Inverness', -4.22, 57.48],
  ['Cardiff', -3.18, 51.48, 'left'], ['Belfast', -5.93, 54.6], ['Dublin', -6.26, 53.35],
  ['Plymouth', -4.14, 50.38], ['Norwich', 1.3, 52.63], ['Carlisle', -2.93, 54.89],
  ['Cork', -8.47, 51.9], ['Exeter', -3.53, 50.72],
];
const DIRS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8][0];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const settleFactor = (t) => (t == null ? 1 : t <= 0.5 ? 1 : t >= 3 ? 0 : (3 - t) / 2.5);

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // a logo without CORS headers would taint the export, so skip it
    img.src = src;
  });
}

async function fetchModelGrid() {
  const lats = [], lons = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { lats.push(+(LAT0 + j * STEP).toFixed(2)); lons.push(+(LON0 + i * STEP).toFixed(2)); }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}`
    + `&daily=snowfall_sum,precipitation_sum,temperature_2m_mean&models=${MODELS.map((m) => m.id).join(',')}`
    + '&timezone=Europe%2FLondon&forecast_days=7';
  const res = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(data?.reason || 'Open-Meteo returned no data');
  return { days: data[0]?.daily?.time || [], points: data.map((d) => d.daily) };
}

/** Sum a model's days [from..to] at one point; null when the model doesn't reach that far. */
function sumModel(daily, m, from, to) {
  let snow = 0, precip = 0, t = 0;
  for (let d = from; d <= to; d++) {
    const s = daily[`snowfall_sum_${m}`]?.[d], p = daily[`precipitation_sum_${m}`]?.[d], tm = daily[`temperature_2m_mean_${m}`]?.[d];
    if (s == null || p == null) return null;
    snow += s; precip += p; t += tm ?? 0;
  }
  return { snow, precip, t: t / (to - from + 1) };
}

/** Per-grid-point fields for the chosen model set and day range. */
function buildFields(grid, modelSel, from, to) {
  const n = NX * NY;
  const acc = new Float32Array(n), snow = new Float32Array(n), precip = new Float32Array(n), frac = new Float32Array(n), anySnow = new Float32Array(n);
  const ids = modelSel === 'blend' ? MODELS.map((m) => m.id) : [modelSel];
  grid.points.forEach((daily, k) => {
    let a = 0, s = 0, p = 0, c = 0, mx = 0;
    for (const m of ids) {
      const v = sumModel(daily, m, from, to);
      if (!v) continue;
      a += v.snow * settleFactor(v.t); s += v.snow; p += v.precip; c++;
      mx = Math.max(mx, v.snow);
    }
    if (c) { acc[k] = a / c; snow[k] = s / c; precip[k] = p / c; }
    frac[k] = precip[k] > 0.05 ? Math.min(1, (snow[k] / 0.7) / precip[k]) : 0;   // snowfall cm -> mm water at 7:10
    anySnow[k] = mx;
  });
  return { acc, snow, precip, frac, anySnow };
}

function sampler(field) {
  return (lon, lat) => {
    const fx = Math.min(NX - 1.001, Math.max(0, (lon - LON0) / STEP));
    const fy = Math.min(NY - 1.001, Math.max(0, (lat - LAT0) / STEP));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const k = j * NX + i;
    return (field[k] * (1 - u) + field[k + 1] * u) * (1 - v) + (field[k + NX] * (1 - u) + field[k + NX + 1] * u) * v;
  };
}

function riskCategory(precip, frac, acc) {
  if (precip < 0.5 || frac < 0.25) return 0;
  if (frac < 0.7) return 1;
  return acc >= 1 ? 3 : 2;
}

/** Marching squares on a regular lon/lat grid; returns [[lon,lat],[lon,lat]] segments at `thr`. */
function contourSegments(val, nx, ny, lon0, lat0, step, thr) {
  const segs = [];
  const at = (i, j) => val[j * nx + i];
  const lerp = (a, b) => (thr - a) / (b - a || 1e-9);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    const idx = (a >= thr ? 1 : 0) | (b >= thr ? 2 : 0) | (c >= thr ? 4 : 0) | (d >= thr ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const x = lon0 + i * step, y = lat0 + j * step;
    const e = [
      [x + lerp(a, b) * step, y], [x + step, y + lerp(b, c) * step],
      [x + lerp(d, c) * step, y + step], [x, y + lerp(a, d) * step],
    ];
    const table = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]],
      8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[0, 3]] };
    for (const [p, q] of table[idx]) segs.push([e[p], e[q]]);
  }
  return segs;
}

const accBandLabel = (i) => (i === ACC_SCALE.length - 1 ? `${ACC_SCALE[i][0]}+ cm` : `${ACC_SCALE[i][0]}–${ACC_SCALE[i + 1][0]} cm`);
function inPoly(lon, lat, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const fmtDay = (iso, opts) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts);

export default function SnowMapGraphicTool({ mode = 'accumulation', myWeatherLogoUrl = '' }) {
  const isRisk = mode === 'risk';
  const canvasRef = useRef(null);
  const [logoUrl, setLogoUrl] = useState(myWeatherLogoUrl || '');
  const [coast, setCoast] = useState(null);
  const [grid, setGrid] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bgId, setBgId] = useState(readSnowBgId);
  const [modelSel, setModelSel] = useState('blend');
  const [fromDay, setFromDay] = useState(0);
  const [toDay, setToDay] = useState(1);
  const [handle, setHandle] = useState('@MyWeatherUK');
  const [version, setVersion] = useState('V5.00');
  const [showCities, setShowCities] = useState(true);
  const [extentMode, setExtentMode] = useState('models');   // models | push | off
  const [pushDir, setPushDir] = useState(135);
  const [pushMiles, setPushMiles] = useState(50);
  // Hand-drawn areas: { brush, pts: [[lon,lat]...] }. brush = acc band index, risk category 1-3, 'erase' or 'extent'.
  const [shapes, setShapes] = useState([]);
  const [brush, setBrush] = useState(3);
  const [penOn, setPenOn] = useState(true);
  const [showModel, setShowModel] = useState(true);
  const overlayRef = useRef(null);
  const strokeRef = useRef(null);

  useEffect(() => {
    if (myWeatherLogoUrl) return;
    base44.entities.SiteSettings.list().then((l) => { if (l[0]?.logo_url) setLogoUrl(l[0].logo_url); }).catch(() => {});
  }, [myWeatherLogoUrl]);
  useEffect(() => { loadUKCoastline({ bbox: UK_BBOX, viewW: MAP_W, viewH: MAP_H }).then(setCoast); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setGrid(await fetchModelGrid()); } catch (e) { setError(e?.message || 'Could not load model data'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fields = useMemo(() => (grid ? buildFields(grid, modelSel, fromDay, Math.max(fromDay, toDay)) : null), [grid, modelSel, fromDay, toDay]);
  const modelsUsed = modelSel === 'blend' ? MODELS.map((m) => m.label).join(' · ') : MODELS.find((m) => m.id === modelSel)?.label;

  const draw = useCallback(async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const bg = snowBackground(bgId);
    const [bgImg, logo] = await Promise.all([loadImage(bg.url), loadImage(logoUrl)]);

    // ── Background photo, cover-fit and darkened ──
    ctx.fillStyle = '#07101f'; ctx.fillRect(0, 0, W, H);
    if (bgImg) {
      const s = Math.max(W / bgImg.width, H / bgImg.height);
      ctx.filter = 'blur(2px) brightness(0.6)';
      ctx.drawImage(bgImg, (W - bgImg.width * s) / 2, (H - bgImg.height * s) / 2, bgImg.width * s, bgImg.height * s);
      ctx.filter = 'none';
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(5,10,25,0.72)'); g.addColorStop(0.18, 'rgba(5,10,25,0.38)');
    g.addColorStop(0.8, 'rgba(5,10,25,0.42)'); g.addColorStop(1, 'rgba(5,10,25,0.82)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // ── Header ──
    let tx = 60;
    if (logo) { const lh = 120, lw = logo.width * (lh / logo.height); ctx.drawImage(logo, 60, 56, lw, lh); tx = 60 + lw + 28; }
    ctx.fillStyle = '#ffffff'; ctx.font = '900 72px Inter, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    const title = isRisk ? 'SNOW RISK' : 'SNOW ACCUMULATION';
    const tsz = Math.min(72, Math.floor(72 * (W - 60 - tx) / ctx.measureText(title).width));
    ctx.font = `900 ${tsz}px Inter, system-ui, sans-serif`; ctx.fillText(title, tx, 130);
    if (grid?.days?.length) {
      const a = grid.days[fromDay], b = grid.days[Math.max(fromDay, toDay)];
      const txt = a === b ? fmtDay(a, { weekday: 'long', day: 'numeric', month: 'long' })
        : `${fmtDay(a, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmtDay(b, { weekday: 'short', day: 'numeric', month: 'short' })}`;
      ctx.font = '700 36px Inter, system-ui, sans-serif'; ctx.fillStyle = '#bae6fd';
      ctx.fillText(txt.toUpperCase(), tx, 182);
    }
    ctx.font = '600 26px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(226,232,240,0.85)';
    ctx.fillText(isRisk ? 'Where snow falls, settles or mixes with rain' : 'Snow expected to settle on the ground (cm)', 60, 252);

    // ── Map panel ──
    roundRect(ctx, MAP_X - 14, MAP_Y - 14, MAP_W + 28, MAP_H + 28, 26);
    ctx.fillStyle = 'rgba(8,16,34,0.55)'; ctx.fill();
    ctx.strokeStyle = 'rgba(186,230,253,0.25)'; ctx.lineWidth = 2; ctx.stroke();

    const land = new Path2D();
    for (const d of coast || []) land.addPath(new Path2D(d));
    const project = makeProjector({ bbox: UK_BBOX, viewW: MAP_W, viewH: MAP_H });

    ctx.save(); ctx.translate(MAP_X, MAP_Y);
    ctx.save(); ctx.clip(land);
    ctx.fillStyle = 'rgba(30,41,59,0.94)'; ctx.fillRect(0, 0, MAP_W, MAP_H);

    // Field raster: interpolate the values per pixel, THEN band/classify.
    if (fields && showModel) {
      const inv = makeInverseProjector({ bbox: UK_BBOX, viewW: MAP_W, viewH: MAP_H });
      const sAcc = sampler(fields.acc), sP = sampler(fields.precip), sF = sampler(fields.frac);
      const off = document.createElement('canvas'); off.width = MAP_W; off.height = MAP_H;
      const octx = off.getContext('2d'); const img = octx.createImageData(MAP_W, MAP_H); const px = img.data;
      const lonAt = new Float32Array(MAP_W), latAt = new Float32Array(MAP_H);
      for (let x = 0; x < MAP_W; x++) lonAt[x] = inv(x + 0.5, 0)[0];
      for (let y = 0; y < MAP_H; y++) latAt[y] = inv(0, y + 0.5)[1];
      const accRgb = ACC_SCALE.map(([v, c]) => [v, hex(c)]);
      const riskRgb = RISK_CATS.map((c) => (c ? hex(c.color) : null));
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
        const lon = lonAt[x], lat = latAt[y];
        let rgb = null, alpha = 235;
        if (isRisk) {
          const cat = riskCategory(sP(lon, lat), sF(lon, lat), sAcc(lon, lat));
          rgb = riskRgb[cat]; if (cat === 1) alpha = 215;
        } else {
          const v = sAcc(lon, lat);
          for (let k = accRgb.length - 1; k >= 0; k--) if (v >= accRgb[k][0]) { rgb = accRgb[k][1]; break; }
        }
        if (!rgb) continue;
        const o = (y * MAP_W + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = alpha;
      }
      octx.putImageData(img, 0, 0);
      ctx.drawImage(off, 0, 0);
    }
    for (const sh of shapes) {
      if (sh.brush === 'extent' || sh.pts.length < 3) continue;
      ctx.beginPath(); sh.pts.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath();
      ctx.fillStyle = sh.brush === 'erase' ? 'rgb(30,41,59)' : isRisk ? RISK_CATS[sh.brush].color : ACC_SCALE[sh.brush][1];
      ctx.globalAlpha = sh.brush === 'erase' ? 1 : isRisk && sh.brush === 1 ? 0.85 : 0.93; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(226,232,240,0.75)'; ctx.lineWidth = 1.6; ctx.stroke(land);

    // ── Possible extent (risk only) ──
    let extentLabel = null;
    if (isRisk && fields && showModel && extentMode !== 'off') {
      const FS = 0.1, fnx = Math.round((LON1 - LON0) / FS) + 1, fny = Math.round((LAT1 - LAT0) / FS) + 1;
      const sSnow = sampler(fields.snow), sAny = sampler(fields.anySnow);
      const rad = (pushDir * Math.PI) / 180;
      const ext = new Float32Array(fnx * fny), core = new Float32Array(fnx * fny);
      for (let j = 0; j < fny; j++) for (let i = 0; i < fnx; i++) {
        const lon = LON0 + i * FS, lat = LAT0 + j * FS, k = j * fnx + i;
        core[k] = sSnow(lon, lat);
        if (extentMode === 'models') ext[k] = sAny(lon, lat);
        else {
          // Reachable if snow sits upstream within the push distance.
          const dLat = (pushMiles / 69) * Math.cos(rad), dLon = (pushMiles / (69 * Math.cos((lat * Math.PI) / 180))) * Math.sin(rad);
          let m = 0;
          for (let t = 0; t <= 12; t++) m = Math.max(m, sSnow(lon - (dLon * t) / 12, lat - (dLat * t) / 12));
          ext[k] = m;
        }
      }
      const THR = 0.2;
      const segs = contourSegments(ext, fnx, fny, LON0, LAT0, FS, THR);
      ctx.save(); ctx.clip(land); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [w, col] of [[12, 'rgba(233,213,255,0.55)'], [6, EXTENT_COLOR]]) {
        ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
        for (const [a, b] of segs) { const p = project(a[0], a[1]), q = project(b[0], b[1]); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        ctx.stroke();
      }
      ctx.restore();
      // Direction of the possible spread: from the main snow area to the extra area, over land.
      let cx = 0, cy = 0, cn = 0, ex = 0, ey = 0, en = 0;
      for (let j = 0; j < fny; j += 2) for (let i = 0; i < fnx; i += 2) {
        const k = j * fnx + i, lon = LON0 + i * FS, lat = LAT0 + j * FS;
        const [x, y] = project(lon, lat);
        if (!ctx.isPointInPath(land, x + MAP_X, y + MAP_Y)) continue;
        if (core[k] >= THR) { cx += lon; cy += lat; cn++; } else if (ext[k] >= THR) { ex += lon; ey += lat; en++; }
      }
      if (cn && en) {
        const c = [cx / cn, cy / cn], e = [ex / en, ey / en];
        const bearing = extentMode === 'push' ? pushDir
          : (Math.atan2((e[0] - c[0]) * Math.cos((c[1] * Math.PI) / 180), e[1] - c[1]) * 180) / Math.PI;
        extentLabel = { at: project(e[0], e[1]), bearing, dir: compass(bearing) };
      }
    }

    // Hand-drawn possible-extent lines (not clipped: the line goes where it's drawn).
    const drawnExtent = shapes.filter((sh) => sh.brush === 'extent' && sh.pts.length > 1);
    if (drawnExtent.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [w, col] of [[12, 'rgba(233,213,255,0.55)'], [6, EXTENT_COLOR]]) {
        ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
        for (const sh of drawnExtent) sh.pts.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      }
    }

    // ── Cities ──
    const readout = [];
    {
      const base = fields && showModel;
      const sAcc = base && sampler(fields.acc), sP = base && sampler(fields.precip), sF = base && sampler(fields.frac);
      for (const [name, lon, lat] of CITIES) {
        let acc = base ? sAcc(lon, lat) : 0, cat = base ? riskCategory(sP(lon, lat), sF(lon, lat), acc) : 0, label = null;
        for (const sh of shapes) {
          if (sh.brush === 'extent' || !inPoly(lon, lat, sh.pts)) continue;
          if (sh.brush === 'erase') { acc = 0; cat = 0; label = null; }
          else if (isRisk) cat = sh.brush;
          else { acc = ACC_SCALE[sh.brush][0]; label = accBandLabel(sh.brush); }
        }
        readout.push({ name, acc, cat, label });
      }
    }
    if (showCities) {
      ctx.font = '700 22px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
      for (const [name, lon, lat, side] of CITIES) {
        const [x, y] = project(lon, lat);
        ctx.textAlign = side === 'left' ? 'right' : 'left'; const lx = side === 'left' ? x - 11 : x + 11;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = '#0f172a'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(2,6,23,0.85)'; ctx.strokeText(name, lx, y);
        ctx.fillStyle = '#ffffff'; ctx.fillText(name, lx, y);
      }
      ctx.textAlign = 'left';
    }

    if (extentLabel) {
      const [x, y] = extentLabel.at;
      const text = `POSSIBLE EXTENT ${extentLabel.dir}`;
      ctx.font = '900 22px Inter, system-ui, sans-serif'; const tw = ctx.measureText(text).width;
      const bx = Math.min(MAP_W - tw - 80, Math.max(10, x - (tw + 70) / 2)), by = Math.min(MAP_H - 60, Math.max(10, y - 25));
      roundRect(ctx, bx, by, tw + 70, 46, 23); ctx.fillStyle = EXTENT_COLOR; ctx.fill();
      ctx.strokeStyle = 'rgba(233,213,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 18, by + 24);
      ctx.save(); ctx.translate(bx + tw + 45, by + 23); ctx.rotate((extentLabel.bearing * Math.PI) / 180);
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 5); ctx.lineTo(0, 1); ctx.lineTo(-9, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    }

    // ── At-a-glance card in the open Atlantic (top-left of the map) ──
    const rows = isRisk
      ? readout.filter((r) => r.cat > 0).sort((a, b) => b.cat - a.cat || b.acc - a.acc).slice(0, 6)
        .map((r) => [r.name, RISK_CATS[r.cat].label, RISK_CATS[r.cat].color])
      : readout.filter((r) => r.acc >= 0.5).sort((a, b) => b.acc - a.acc).slice(0, 6)
        .map((r) => [r.name, r.label || (r.acc >= 10 ? `${Math.round(r.acc)} cm` : `${r.acc.toFixed(1)} cm`), '#bae6fd']);
    const cardH = 70 + Math.max(1, rows.length) * 40;
    roundRect(ctx, 18, 18, 340, cardH, 18); ctx.fillStyle = 'rgba(8,16,34,0.82)'; ctx.fill();
    ctx.strokeStyle = 'rgba(186,230,253,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textBaseline = 'alphabetic'; ctx.font = '900 19px Inter, system-ui, sans-serif'; ctx.fillStyle = '#7dd3fc';
    ctx.fillText(isRisk ? 'CITIES AT RISK' : 'HIGHEST CITY TOTALS', 38, 56);
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    if (!rows.length) { ctx.fillStyle = 'rgba(226,232,240,0.8)'; ctx.fillText(isRisk ? 'No snow at listed cities' : 'Under 0.5 cm everywhere listed', 38, 100); }
    rows.forEach(([name, val, col], i) => {
      const y = 100 + i * 40;
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.fillText(name, 38, y);
      ctx.fillStyle = col; ctx.textAlign = 'right'; ctx.font = isRisk ? '700 15px Inter, system-ui, sans-serif' : '800 22px Inter, system-ui, sans-serif';
      ctx.fillText(val, 340, y); ctx.font = '700 22px Inter, system-ui, sans-serif';
    });
    ctx.textAlign = 'left';
    ctx.restore();

    // ── Legend ──
    const LY = MAP_Y + MAP_H + 34;
    ctx.textBaseline = 'middle'; ctx.font = '800 22px Inter, system-ui, sans-serif';
    if (isRisk) {
      let x = 60;
      const items = [...RISK_CATS.slice(1).reverse().map((c) => [c.label, c.color, 'box'])];
      if ((showModel && extentMode !== 'off') || drawnExtent.length) items.push(['Possible extent', EXTENT_COLOR, 'line']);
      for (const [label, col, kind] of items) {
        if (kind === 'box') { roundRect(ctx, x, LY - 14, 28, 28, 7); ctx.fillStyle = col; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(233,213,255,0.6)'; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(x, LY); ctx.lineTo(x + 36, LY); ctx.stroke();
          ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke(); }
        ctx.fillStyle = '#ffffff'; ctx.fillText(label, x + (kind === 'box' ? 38 : 46), LY);
        x += ctx.measureText(label).width + (kind === 'box' ? 66 : 74);
      }
    } else {
      const bw = 960 / ACC_SCALE.length;
      ctx.font = '800 18px Inter, system-ui, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText('Settled snow (cm)', 60, LY - 34);
      ACC_SCALE.forEach(([v, c], i) => {
        ctx.fillStyle = c; ctx.fillRect(60 + i * bw, LY - 16, bw - 4, 22);
        ctx.fillStyle = '#ffffff'; ctx.font = '800 20px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(i === ACC_SCALE.length - 1 ? `${v}+ cm` : `${v}`, 60 + i * bw + bw / 2 - 2, LY + 26);
      });
      ctx.textAlign = 'left';
    }

    // ── Footer ──
    ctx.textBaseline = 'alphabetic';
    ctx.font = '900 30px Inter, system-ui, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText(handle, 60, H - 62);
    ctx.font = '800 18px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(148,163,184,0.95)'; ctx.fillText(version.toUpperCase(), 60, H - 34);
    ctx.textAlign = 'right'; ctx.font = '600 18px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(226,232,240,0.85)';
    const issued = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', hour12: false });
    ctx.fillText(`Models: ${modelsUsed}  ·  Issued ${issued}`, W - 60, H - 74);
    ctx.fillText(isRisk ? 'Settling where snow dominates and the mean temperature is near or below freezing'
      : 'Model snowfall reduced for melting where the mean temperature is above 0.5 °C', W - 60, H - 50);
    if (bg.credit) { ctx.font = '500 13px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(203,213,225,0.6)'; ctx.fillText(bg.credit, W - 60, H - 26); }
    ctx.textAlign = 'left';
  }, [bgId, logoUrl, coast, fields, grid, fromDay, toDay, isRisk, showCities, extentMode, pushDir, pushMiles, handle, version, modelsUsed, shapes, showModel]);

  useEffect(() => { draw(); }, [draw]);

  // Pointer -> lon/lat on the map (the preview is the 1080×1920 canvas scaled down).
  const toLonLat = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = ((e.clientX - r.left) * W) / r.width, cy = ((e.clientY - r.top) * H) / r.height;
    return [makeInverseProjector({ bbox: UK_BBOX, viewW: MAP_W, viewH: MAP_H })(cx - MAP_X, cy - MAP_Y), [cx, cy]];
  };
  const paintStroke = () => {
    const cv = overlayRef.current; if (!cv) return;
    const c = cv.getContext('2d'); c.clearRect(0, 0, W, H);
    const st = strokeRef.current; if (!st || st.px.length < 2) return;
    const col = brush === 'extent' ? EXTENT_COLOR : brush === 'erase' ? '#1e293b' : isRisk ? RISK_CATS[brush].color : ACC_SCALE[brush][1];
    c.beginPath(); st.px.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (brush !== 'extent') { c.closePath(); c.globalAlpha = 0.6; c.fillStyle = col; c.fill(); c.globalAlpha = 1; }
    c.lineWidth = 6; c.strokeStyle = brush === 'erase' ? '#f87171' : col; c.lineJoin = 'round'; c.stroke();
  };
  const onDown = (e) => {
    if (!penOn) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [ll, px] = toLonLat(e); strokeRef.current = { pts: [ll], px: [px] };
  };
  const onMove = (e) => {
    const st = strokeRef.current; if (!st) return;
    const [ll, px] = toLonLat(e); const last = st.px[st.px.length - 1];
    if (Math.hypot(px[0] - last[0], px[1] - last[1]) < 6) return;
    st.pts.push(ll); st.px.push(px); paintStroke();
  };
  const onUp = () => {
    const st = strokeRef.current; strokeRef.current = null; paintStroke();
    if (st && st.pts.length >= (brush === 'extent' ? 2 : 3)) setShapes((p) => [...p, { brush, pts: st.pts }]);
  };

  const download = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `snow-${isRisk ? 'risk' : 'accumulation'}-${grid?.days?.[fromDay] || 'map'}.jpg`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/jpeg', 0.93);
  };

  const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8' };
  const input = { padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.7)', color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit' };
  const chip = (on, col = '#38bdf8') => ({
    padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: 'inherit',
    background: on ? `${col}2e` : 'rgba(148,163,184,0.06)', border: `1px solid ${on ? `${col}80` : 'rgba(148,163,184,0.15)'}`, color: on ? col : '#94a3b8',
  });
  const days = grid?.days || [];
  const Icon = isRisk ? CloudSnow : Snowflake;

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 18, padding: 20, borderRadius: 16, background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon style={{ width: 20, height: 20, color: isRisk ? '#a78bfa' : '#93c5fd' }} />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>{isRisk ? 'Snow Risk' : 'Snow Accumulation'}</h3>
          <button type="button" onClick={load} disabled={loading} style={{ ...chip(false), marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {loading ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <RefreshCw style={{ width: 13, height: 13 }} />} Refresh models
          </button>
        </div>
        {error && <p style={{ margin: 0, color: '#fca5a5', fontSize: 12.5 }}>{error}</p>}

        <div>
          <p style={{ ...label, margin: '0 0 8px' }}>Model</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[{ id: 'blend', label: 'Blend (all 4)' }, ...MODELS].map((m) => (
              <button key={m.id} type="button" style={chip(modelSel === m.id)} onClick={() => setModelSel(m.id)}>{m.label}</button>
            ))}
          </div>
          {modelSel === 'ukmo_uk_deterministic_2km' && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b' }}>UKV only reaches the first couple of days; later days show nothing.</p>}
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {[['From', fromDay, (v) => { setFromDay(v); if (toDay < v) setToDay(v); }], ['To', toDay, (v) => setToDay(Math.max(v, fromDay))]].map(([l, v, set]) => (
            <div key={l}>
              <p style={{ ...label, margin: '0 0 6px' }}>{l}</p>
              <select value={v} onChange={(e) => set(+e.target.value)} style={input}>
                {days.map((d, i) => <option key={d} value={i}>{fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' })}</option>)}
              </select>
            </div>
          ))}
        </div>

        {isRisk && (
          <div>
            <p style={{ ...label, margin: '0 0 8px' }}>Possible extent (purple line)</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['models', 'Any model has snow'], ['push', 'Push in a direction'], ['off', 'Off']].map(([id, l]) => (
                <button key={id} type="button" style={chip(extentMode === id, '#a78bfa')} onClick={() => setExtentMode(id)}>{l}</button>
              ))}
            </div>
            {extentMode === 'push' && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {DIRS.map(([n, deg]) => <button key={n} type="button" style={chip(pushDir === deg, '#a78bfa')} onClick={() => setPushDir(deg)}>{n}</button>)}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {[25, 50, 75, 100, 150].map((m) => <button key={m} type="button" style={chip(pushMiles === m, '#a78bfa')} onClick={() => setPushMiles(m)}>{m} mi</button>)}
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <p style={{ ...label, margin: '0 0 8px' }}>Draw on the map</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(isRisk
              ? [[3, 'Accumulating snow', RISK_CATS[3].color], [2, 'Falling snow', RISK_CATS[2].color], [1, 'Snow & rain', RISK_CATS[1].color], ['extent', 'Possible extent line', EXTENT_COLOR]]
              : ACC_SCALE.map(([, c], i) => [i, accBandLabel(i), c])
            ).concat([['erase', 'Erase (no snow)', '#334155']]).map(([id, l, c]) => (
              <button key={id} type="button" style={{ ...chip(brush === id), display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { setBrush(id); setPenOn(true); }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: c, border: '1px solid rgba(255,255,255,0.4)' }} />{l}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" style={chip(penOn)} onClick={() => setPenOn((v) => !v)}>{penOn ? 'Pen on' : 'Pen off'}</button>
            <button type="button" style={chip(false)} disabled={!shapes.length} onClick={() => setShapes((p) => p.slice(0, -1))}>Undo</button>
            <button type="button" style={chip(false, '#f87171')} disabled={!shapes.length} onClick={() => setShapes([])}>Clear drawings</button>
            <button type="button" style={chip(showModel)} onClick={() => setShowModel((v) => !v)}>{showModel ? 'Model layer on' : 'Model layer off'}</button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b' }}>Drag on the preview to draw an area (it closes itself). Drawn areas sit on top of the model layer; turn the model layer off to draw everything by hand.</p>
        </div>

        <SnowBackgroundPicker value={bgId} onChange={setBgId} labelStyle={label} />

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div><p style={{ ...label, margin: '0 0 6px' }}>Handle</p><input value={handle} onChange={(e) => setHandle(e.target.value)} style={input} /></div>
          <div><p style={{ ...label, margin: '0 0 6px' }}>Version</p><input value={version} onChange={(e) => setVersion(e.target.value)} style={{ ...input, width: 90 }} /></div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
          <input type="checkbox" checked={showCities} onChange={(e) => setShowCities(e.target.checked)} /> Show cities
        </label>

        <button type="button" onClick={download} disabled={!fields} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px', borderRadius: 10,
          background: '#0284c7', color: '#fff', border: 'none', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
        }}><Download style={{ width: 16, height: 16 }} /> Download JPG (1080×1920)</button>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>Daily snowfall, precipitation and mean temperature from Open-Meteo on a 0.5° grid.</p>
      </div>

      <div style={{ position: 'relative', width: 405, height: 720, flex: '0 0 auto' }}>
        <canvas ref={canvasRef} width={W} height={H} style={{ width: 405, height: 720, borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.45)', display: 'block' }} />
        <canvas ref={overlayRef} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          style={{ position: 'absolute', inset: 0, width: 405, height: 720, cursor: penOn ? 'crosshair' : 'default', touchAction: 'none' }} />
      </div>
    </div>
  );
}
