/* ════════════════════════════════════════════════════════════════════════════
   ClimateAnomalyGraphicTool — light-mode monthly climate anomaly map.

   Pick a month and a variable (rainfall / temperature / sunshine / cloudiness)
   and the graphic shades how that month compared with the same calendar month's
   1991-2020 average, per grid point.

   RENDERING
   ---------
   The anomaly field is a RASTER, not grid rectangles: every pixel inverse-
   projects to lon/lat, bilinearly samples the four surrounding grid points, then
   goes through the discrete colour scale. Interpolating the VALUE and banding
   afterwards gives smooth contour bands, which is how real climate maps read.
   The raster is blitted through a Path2D coastline clip so shading stops at the
   shore; because the grid spans the whole bbox (sea included) the field stays
   continuous right up to the coast.

   BASELINE
   --------
   Hardcoded 1991-2020 normals, so nothing but the chosen month is ever fetched
   (lib/ukNormals.js). Those are Met Office observations, which is right for the
   variables where ERA5 measures the same quantity — but wrong for sunshine and
   cloud, where it does not: ERA5 sunshine_duration is a radiation threshold
   against the WMO bright-sunshine standard, and ERA5 cloud_cover_mean is an
   areal fraction against a cloudy-hours figure. Those two measure their own
   normal from ERA5 instead, once, and keep it (lib/era5Normals.js).

   ONE VARIABLE PER LOAD
   ---------------------
   A load fetches only the daily field the selected variable needs, and merges
   it into whatever that month already holds. Requesting the whole field list
   every time cost roughly nine times what was on screen and drained the daily
   quota; see lib/climateAnomaly.js.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import html2canvas from 'html2canvas';
import {
  CloudRain, Thermometer, Sun, Cloud, Download, Loader2, Database,
  AlertTriangle, CheckCircle2, Server, ArrowUp, ArrowDown, Minus, Wind, Gauge,
  Thermometer as Thermo, CloudDrizzle, SlidersHorizontal,
} from 'lucide-react';
import { loadUKCoastline, makeProjector, makeInverseProjector, UK_BBOX } from '@/lib/ukCoastline';
import {
  CLIMATE_VARS, VAR_BY_ID, MONTH_NAMES,
  buildGrid, gridDims, gridSignature, fetchMonthGrid, fetchHourlyRainGrid, fetchForecastGrid,
  depScaleFor, depColorRgb, depGradientCss, formatValue, areaMean,
  dominantWeather, dominantWind,
  savedMonths, loadSavedMonth, saveMonth, deleteSavedMonth, mergeMonthPayload,
} from '@/lib/climateAnomaly';
import {
  normalFor, dayNormal, NORMALS_PERIOD, PRESSURE_NORMALS, WIND_NORMALS, angleDelta,
} from '@/lib/ukNormals';
import {
  needsEra5Normal, readEra5Normal, fetchEra5Normal,
  ERA5_NORMAL_POINT, ERA5_NORMAL_LABEL,
} from '@/lib/era5Normals';

const GRAPHIC_W = 700, GRAPHIC_H = 880;
const VIEW_W = 372, VIEW_H = 514;
const SS = 2;                       // raster supersample factor

const VAR_ICONS  = { rain: CloudRain, temp: Thermometer, sun: Sun, cloud: Cloud,
  pressure: Gauge, wind: Wind, tmax: Thermo, tmin: Thermo,
  rainDays: CloudDrizzle, threshold: SlidersHorizontal, windSpeed: Wind,
  rainHours: CloudDrizzle };
const VAR_ACCENT = { rain: '#0284c7', temp: '#e11d48', sun: '#d97706', cloud: '#6366f1',
  pressure: '#7c3aed', wind: '#0d9488', tmax: '#dc2626', tmin: '#2563eb',
  rainDays: '#0891b2', threshold: '#475569', windSpeed: '#ea580c',
  rainHours: '#0369a1' };

/* ── Light-mode ink palette ─────────────────────────────────────────────── */
const INK   = '#0f172a';   // headings
const INK2  = '#475569';   // body
const INK3  = '#94a3b8';   // labels
const LINE  = '#e2e8f0';   // hairlines
const PAPER = '#ffffff';
// Slightly stronger than the palest anomaly band, so near-average land (which
// shades almost white) still reads as distinct from the sea.
const SEA   = '#dce7f2';

/* Control-panel styling (kept dark to match the surrounding admin UI) */
const labelCss = { display: 'block', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#64748b', marginBottom: 8 };
const btnCss   = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: 'rgba(148,163,184,0.06)', border: '1.5px solid rgba(148,163,184,0.18)', color: '#94a3b8' };
const selCss   = { padding: '8px 10px', borderRadius: 9, background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)', color: '#f1f5f9', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', outline: 'none' };

/**
 * Does this grid point's record carry the given variable?
 *
 * A load fetches ONE variable now, so a stored month can hold rainfall but not
 * sunshine. The map and the headline both go blank in that case, and without
 * this the tool cannot tell "not fetched yet" from "fetched and empty".
 */
function pointHas(v, varId) {
  if (!v) return false;
  if (varId === 'threshold') return Array.isArray(v.tmaxDaily);
  if (varId === 'wind') return v.windDeg != null;
  return v[varId] != null;
}

/** Default to the previous calendar month. */
function defaultMonth() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export default function ClimateAnomalyGraphicTool({ siteLogoUrl = '' }) {
  const init = defaultMonth();
  const [year, setYear]   = useState(init.year);
  const [month, setMonth] = useState(init.month);
  const [varId, setVarId] = useState('rain');
  const [handle, setHandle] = useState('@MyWeatherUK');
  // Threshold variable: count days whose max is above / min is below this value.
  const [threshTemp, setThreshTemp] = useState(25);
  const [threshDir, setThreshDir]   = useState('above');   // 'above' | 'below'
  // Hourly-rain window (inclusive start, exclusive end) + the fetched buckets.
  const [hourFrom, setHourFrom] = useState(12);
  const [hourTo, setHourTo]     = useState(18);
  const [hourBuckets, setHourBuckets] = useState(null);   // per grid point: 24 totals
  const [hourBusy, setHourBusy] = useState(false);
  /* Mode: the past month from the archive, or a day from the 16-day forecast.
     Both share the grid, projection, coastline and colour pipeline; only the
     source and the reference normal differ. */
  const [mode, setMode] = useState('month');            // 'month' | 'forecast'
  const [fc, setFc] = useState(null);                   // { dates, values }
  const [fcDay, setFcDay] = useState(0);
  const [fcBusy, setFcBusy] = useState(false);
  // Months already fetched and kept, so they can be revisited for free.
  const [saved, setSaved] = useState([]);

  const [coast, setCoast]         = useState(null);
  const [monthData, setMonthData] = useState(null);
  const [status, setStatus]       = useState(null);
  const [busy, setBusy]           = useState(false);
  const [progress, setProgress]   = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const abortRef   = useRef(null);
  const graphicRef = useRef(null);
  const canvasRef  = useRef(null);
  const scaleWrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  const grid    = useMemo(() => buildGrid(), []);
  const dims    = useMemo(() => gridDims(), []);
  const gridSig = useMemo(() => gridSignature(), []);
  const project   = useMemo(() => makeProjector({ bbox: UK_BBOX, viewW: VIEW_W, viewH: VIEW_H }), []);
  const unproject = useMemo(() => makeInverseProjector({ bbox: UK_BBOX, viewW: VIEW_W, viewH: VIEW_H }), []);
  const varDef  = VAR_BY_ID[varId];
  const accent  = VAR_ACCENT[varId];

  /* WHICH NORMAL THIS VARIABLE IS MEASURED AGAINST.
     Most use the observational 1991-2020 figures directly, because ERA5 and the
     observations measure the same quantity. Sunshine and cloud do not (see
     lib/era5Normals.js), so they compare against a normal measured from ERA5 —
     one request, once, then kept forever. Until that has been done there is no
     honest denominator, so the graphic says so rather than inventing one. */
  const usesEra5Normal = needsEra5Normal(varId);
  const [era5Normal, setEra5Normal] = useState(null);
  const [normalBusy, setNormalBusy] = useState(false);

  useEffect(() => {
    setEra5Normal(usesEra5Normal ? readEra5Normal(varId) : null);
  }, [varId, usesEra5Normal]);

  const normalMonthly = usesEra5Normal ? (era5Normal?.monthly || null) : null;
  const avgFor = useCallback(
    (m) => (usesEra5Normal ? (normalMonthly?.[m - 1] ?? null) : normalFor(varId, m)),
    [usesEra5Normal, normalMonthly, varId],
  );

  const measureNormal = useCallback(async () => {
    if (normalBusy) return;
    setNormalBusy(true); setStatus(null);
    try {
      const res = await fetchEra5Normal(varId);
      setEra5Normal(res);
      const { lat, lon } = ERA5_NORMAL_POINT;
      setStatus({
        kind: 'ok',
        msg: `${varDef.label} ${ERA5_NORMAL_LABEL} normal measured from ERA5 at ${lat}, ${lon} — ` +
             `${Math.min(...res.years)}-${Math.max(...res.years)} years per month. Kept from now on; never fetched again.`,
      });
    } catch (e) {
      setStatus({ kind: 'err', msg: e?.message || 'Could not measure the normal' });
    } finally { setNormalBusy(false); }
  }, [varId, varDef, normalBusy]);

  useEffect(() => {
    const measure = () => setScale(Math.min(1, (scaleWrapRef.current?.offsetWidth || GRAPHIC_W) / GRAPHIC_W));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => { loadUKCoastline({ viewW: VIEW_W, viewH: VIEW_H }).then(setCoast); }, []);
  useEffect(() => { setSaved(savedMonths(gridSig)); }, [gridSig]);

  /* Selecting a month shows it straight from storage if it has been fetched
     before; otherwise it clears and waits for Load month. */
  useEffect(() => {
    const hit = loadSavedMonth(gridSig, year, month);
    if (hit) {
      setMonthData(hit);
      const have = (hit.vars || []).map(v => VAR_BY_ID[v]?.short || v).join(', ');
      setStatus({ kind: 'ok', msg: `${MONTH_NAMES[month - 1]} ${year} restored from saved data — no request used${have ? ` (${have})` : ''}.` });
    } else {
      setMonthData(null);
      setStatus(null);
    }
  }, [year, month, gridSig]);

  /* A load covers ONE variable, so a month held in storage may not carry the
     one now selected — the map and the headline both go blank when it doesn't.
     Say why, rather than leaving an empty graphic with no explanation. */
  useEffect(() => {
    if (mode === 'forecast' || busy) return;
    if (!monthData?.values || varDef.mode === 'hourly') return;
    if (monthData.values.some(v => pointHas(v, varId))) return;
    setStatus({
      kind: 'warn',
      msg: `${varDef.label} has not been loaded for ${MONTH_NAMES[month - 1]} ${year} — press “Load month”. ` +
           'Only the variable you pick is requested, so each one is fetched the first time you view it.',
    });
  }, [monthData, varId, varDef, month, year, mode, busy]);

  /* Which grid points are on LAND, tested against the very same coastline path
     the map clips its raster to — so the printed statistics describe exactly the
     area the reader can see shaded. The grid deliberately covers sea as well (it
     keeps the interpolated field continuous to the coast), but only ~31% of its
     points are land, so averaging all of them would mostly be averaging ocean. */
  const landMask = useMemo(() => {
    if (!coast || !coast.length) return null;
    const cv = document.createElement('canvas');
    cv.width = VIEW_W; cv.height = VIEW_H;
    const ctx = cv.getContext('2d');
    const path = new Path2D();
    for (const d of coast) path.addPath(new Path2D(d));
    return grid.map(p => {
      const [x, y] = project(p.lon, p.lat);
      return ctx.isPointInPath(path, x, y);
    });
  }, [coast, grid, project]);

  /* Only LAND points are ever fetched. The map is clipped to the coastline and
     the statistics are land-only, so the 232 sea points in the 336-point grid
     were pure waste — 69% of every request bought nothing visible. Fetching just
     the 104 land points cuts each month from 3 chunk requests to 1, and cuts the
     baseline build by the same factor. Coastal pixels now interpolate from land
     neighbours only, which is also more correct than blending marine values
     inland (the raster's missing-corner re-weighting handles the sea gaps). */
  const landPoints = useMemo(() => {
    if (!landMask) return null;
    const { nLat, nLon } = dims;
    // Dilate the land mask by one grid step. Interpolating a pixel needs its
    // four surrounding grid points to carry data, and for anywhere near a coast
    // some of those sit offshore. Fetching land only left Cornwall, the Welsh
    // and Scottish peninsulas and much of the coastal fringe with no usable
    // corners, so they rendered blank. The halo is the cheapest correct fix:
    // still nothing like the full 69%-sea grid, but every land pixel now has
    // real values on all sides.
    const want = new Array(grid.length).fill(false);
    for (let j = 0; j < nLat; j++) {
      for (let i = 0; i < nLon; i++) {
        if (!landMask[j * nLon + i]) continue;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (jj < 0 || jj >= nLat || ii < 0 || ii >= nLon) continue;
            want[jj * nLon + ii] = true;
          }
        }
      }
    }
    const pts = [], idx = [];
    grid.forEach((p, i) => { if (want[i]) { pts.push(p); idx.push(i); } });
    return { pts, idx };
  }, [grid, landMask, dims]);

  /** Scatter a land-length result array back onto the full grid, sea = null. */
  const scatter = useCallback((landValues) => {
    const full = new Array(grid.length).fill(null);
    if (landPoints) landPoints.idx.forEach((gi, k) => { full[gi] = landValues[k]; });
    return full;
  }, [grid.length, landPoints]);

  const cancel = () => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); setProgress(null); };

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true); setStatus(null);
    try {
      if (!landPoints) { setStatus({ kind: 'warn', msg: 'Coastline still loading — try again in a moment.' }); return; }

      /* The ONLY fetch: the selected variable, for the selected month. Asking
         for the whole field list made every load about nine times dearer than
         the one variable on screen needed. Averages are hardcoded. */
      setProgress({ done: 0, total: 1, what: 'month' });
      const md = await fetchMonthGrid({
        year, month, varId, points: landPoints.pts, signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total, what: 'month' }),
      });
      if (ac.signal.aborted) return;
      const fetched = { ...md, values: scatter(md.values) };
      // Fold it in beside whatever this month already holds, so variables
      // loaded earlier survive and never need paying for twice.
      const payload = mergeMonthPayload(loadSavedMonth(gridSig, year, month), fetched);
      setMonthData(payload);
      saveMonth(gridSig, year, month, payload);
      setSaved(savedMonths(gridSig));

      const label = varDef.label.toLowerCase();
      const covered = fetched.values.filter(v => pointHas(v, varId)).length;
      setStatus(covered
        ? { kind: 'ok', msg: `Loaded ${label} for ${MONTH_NAMES[month - 1]} ${year} from Open-Meteo — ${covered} land points.` }
        : { kind: 'warn', msg: `No ERA5 ${label} for ${MONTH_NAMES[month - 1]} ${year} — that month is probably not published yet.` });
    } catch (e) {
      if (!ac.signal.aborted) setStatus({ kind: 'err', msg: e?.message || 'Load failed' });
    } finally {
      if (abortRef.current === ac) { setBusy(false); setProgress(null); abortRef.current = null; }
    }
  }, [year, month, varId, varDef, landPoints, scatter, gridSig]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ── Value field (actual monthly values, not an anomaly) ─────────────── */
  const isDirection = varDef.mode === 'direction';
  const isCount     = varDef.mode === 'count';
  const isHourly    = varDef.mode === 'hourly';
  const isForecast  = mode === 'forecast';
  const fcDate      = fc?.dates?.[fcDay] || null;

  const loadForecast = useCallback(async () => {
    if (!landPoints || fcBusy) return;
    setFcBusy(true); setStatus(null);
    try {
      const res = await fetchForecastGrid({ points: landPoints.pts, varId });
      // The window holds one variable, so remember which — switching variable
      // needs a fresh window rather than silently drawing the previous one.
      setFc({ varId, dates: res.dates, values: scatter(res.values) });
      setFcDay(0);
      setStatus({ kind: 'ok', msg: `${varDef.label} forecast loaded — ${res.dates.length} days from ${res.dates[0]}. Switching day is instant.` });
    } catch (e) {
      setStatus({ kind: 'err', msg: e?.message || 'Forecast load failed' });
    } finally { setFcBusy(false); }
  }, [landPoints, scatter, fcBusy, varId, varDef]);

  /* Forecast field: the chosen day against that day's own normal, interpolated
     from the monthly figures by dayNormal(). Using the monthly normal directly
     would give 1 March and 31 March the same reference. */
  const fcField = useMemo(() => {
    if (!isForecast || fc?.varId !== varId || !fc?.values || !fcDate
        || isDirection || isCount || isHourly) return null;
    const avg = dayNormal(varId, fcDate, normalMonthly);
    if (avg == null) return null;
    const ratio = varDef.mode === 'ratio';
    const out = new Float32Array(grid.length).fill(NaN);
    let any = false;
    for (let i = 0; i < grid.length; i++) {
      const rec = fc.values[i]?.[fcDay];
      const x = rec?.[varId];
      if (x == null) continue;
      out[i] = ratio ? (avg ? (x / avg - 1) * 100 : NaN) : x - avg;
      if (out[i] === out[i]) any = true;
    }
    return any ? out : null;
  }, [isForecast, fc, fcDay, fcDate, varId, varDef, normalMonthly, grid.length, isDirection, isCount, isHourly]);

  /* Sum the chosen hour window out of the per-point hour-of-day buckets. The
     window wraps midnight when `to` is before `from` (e.g. 21 -> 03). Purely
     client-side, so dragging the hours costs nothing. */
  const hourField = useMemo(() => {
    if (!hourBuckets || !isHourly) return null;
    const out = new Float32Array(grid.length).fill(NaN);
    let any = false;
    for (let i = 0; i < grid.length; i++) {
      const b = hourBuckets[i];
      if (!b) continue;
      let s = 0;
      for (let h = 0; h < 24; h++) {
        // End is exclusive, so from === to would otherwise be a zero-width
        // window returning 0 mm. Nobody picking 00:00-00:00 means "nothing" —
        // treat a matching pair as the whole day.
        const inWindow = hourFrom === hourTo ? true
          : hourFrom < hourTo
            ? (h >= hourFrom && h < hourTo)
            : (h >= hourFrom || h < hourTo);     // wraps midnight
        if (inWindow) s += b[h];
      }
      out[i] = s; any = true;
    }
    return any ? out : null;
  }, [hourBuckets, isHourly, hourFrom, hourTo, grid.length]);

  const loadHourly = useCallback(async () => {
    if (!landPoints || hourBusy) return;
    setHourBusy(true); setStatus(null);
    try {
      const res = await fetchHourlyRainGrid({ year, month, points: landPoints.pts });
      setHourBuckets(scatter(res));
      setStatus({ kind: 'ok', msg: `Hourly rain loaded for ${MONTH_NAMES[month - 1]} ${year} — any hour window now renders instantly.` });
    } catch (e) {
      setStatus({ kind: 'err', msg: e?.message || 'Hourly load failed' });
    } finally { setHourBusy(false); }
  }, [year, month, landPoints, scatter, hourBusy]);

  // The buckets belong to one specific month; drop them when it changes.
  useEffect(() => { setHourBuckets(null); }, [year, month]);

  /* Threshold counts are derived from the retained daily max/min series, so
     dragging the temperature re-renders instantly and costs no request.
     'above' uses each day's MAX (was it ever that warm), 'below' uses the MIN
     (did it ever fall that low) — which is how these are conventionally counted. */
  const countField = useMemo(() => {
    if (!monthData?.values || !isCount) return null;
    const out = new Float32Array(grid.length);
    let any = false;
    for (let i = 0; i < grid.length; i++) {
      const v = monthData.values[i];
      const series = threshDir === 'above' ? v?.tmaxDaily : v?.tminDaily;
      if (!series) { out[i] = NaN; continue; }
      let n = 0;
      for (const x of series) {
        if (x == null) continue;
        if (threshDir === 'above' ? x > threshTemp : x < threshTemp) n++;
      }
      out[i] = n; any = true;
    }
    return any ? out : null;
  }, [monthData, isCount, threshDir, threshTemp, grid.length]);

  /* Departure from the monthly average: percent for rainfall and sunshine,
     native units for temperature, cloud and pressure. Both sides of the ratio
     now come from the same source — avgFor() hands back an ERA5-measured normal
     for the variables whose observational normal measures something else — so
     the value goes in exactly as fetched, with no correction factor. */
  const field = useMemo(() => {
    if (isForecast || !monthData?.values || isDirection || isCount || isHourly) return null;
    const avg = avgFor(month);
    if (avg == null) return null;
    const ratio = varDef.mode === 'ratio';
    const out = new Float32Array(grid.length);
    let any = false;
    for (let i = 0; i < grid.length; i++) {
      const x = monthData.values[i]?.[varId];
      if (x == null) { out[i] = NaN; continue; }
      out[i] = ratio ? (avg ? (x / avg - 1) * 100 : NaN) : x - avg;
      if (out[i] === out[i]) any = true;
    }
    return any ? out : null;
  }, [monthData, varId, varDef, avgFor, grid.length, isDirection, isCount, isHourly, isForecast, month]);

  /* Wind is drawn as an ARROW FIELD rather than a shaded raster. A shaded field
     would require interpolating direction between grid points, and interpolating
     angles linearly is wrong (350 deg and 10 deg average to 180 deg). One arrow
     per land point uses that point's own circular mean, so nothing is averaged
     across points at all. Opacity encodes steadiness — a faint arrow means the
     month had no strong prevailing direction there. */
  const arrows = useMemo(() => {
    if (!monthData?.values || !isDirection || !landPoints) return null;
    const out = [];
    landPoints.idx.forEach((gi) => {
      const v = monthData.values[gi];
      if (!v || v.windDeg == null) return;
      const [x, y] = project(grid[gi].lon, grid[gi].lat);
      out.push({ x, y, deg: v.windDeg, steady: v.windSteadiness ?? 0 });
    });
    return out.length ? out : null;
  }, [monthData, isDirection, landPoints, grid, project]);

  const hasMapData = !!(field || arrows || countField || hourField || fcField);

  /* ── Raster: bilinear sample -> banded colour -> clip to land ──────────── */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    cv.width = VIEW_W * SS; cv.height = VIEW_H * SS;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const src = fcField || field || countField || hourField;
    if (!src || !coast || !coast.length) return;   // wind draws arrows instead

    const { nLat, nLon, lat0, lon0, dLat, dLon } = dims;
    const pts = depScaleFor(varId).pts;

    const tmp = document.createElement('canvas');
    tmp.width = cv.width; tmp.height = cv.height;
    const tctx = tmp.getContext('2d');
    const img = tctx.createImageData(tmp.width, tmp.height);
    const data = img.data;

    for (let py = 0; py < tmp.height; py++) {
      for (let px = 0; px < tmp.width; px++) {
        const [lon, lat] = unproject((px + 0.5) / SS, (py + 0.5) / SS);
        let gx = (lon - lon0) / dLon, gy = (lat - lat0) / dLat;
        if (gx < 0) gx = 0; else if (gx > nLon - 1) gx = nLon - 1;
        if (gy < 0) gy = 0; else if (gy > nLat - 1) gy = nLat - 1;

        const i0 = Math.min(Math.floor(gx), Math.max(0, nLon - 2));
        const j0 = Math.min(Math.floor(gy), Math.max(0, nLat - 2));
        const i1 = Math.min(i0 + 1, nLon - 1), j1 = Math.min(j0 + 1, nLat - 1);
        const fx = gx - i0, fy = gy - j0;

        const v00 = src[j0 * nLon + i0], v10 = src[j0 * nLon + i1];
        const v01 = src[j1 * nLon + i0], v11 = src[j1 * nLon + i1];

        let sum = 0, wsum = 0;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        if (v00 === v00) { sum += v00 * w00; wsum += w00; }
        if (v10 === v10) { sum += v10 * w10; wsum += w10; }
        if (v01 === v01) { sum += v01 * w01; wsum += w01; }
        if (v11 === v11) { sum += v11 * w11; wsum += w11; }
        // Very low weight means every nearby corner was missing; 0.02 keeps the
        // last sliver of coastline coloured instead of leaving a white rim.
        if (wsum < 0.02) continue;

        // Continuous blend between control points — no banding, no stepped edges.
        const rgb = depColorRgb(pts, sum / wsum);
        const o = (py * tmp.width + px) * 4;
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);

    const clip = new Path2D();
    for (const d of coast) clip.addPath(new Path2D(d));
    ctx.save();
    ctx.scale(SS, SS);
    ctx.clip(clip);
    ctx.drawImage(tmp, 0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }, [field, countField, hourField, fcField, coast, varId, dims, unproject]);

  /* ── Month character + headline ────────────────────────────────────────── */
  const character = useMemo(() => {
    if (!monthData?.values) return null;
    const weather = dominantWeather(monthData.values, landMask);
    const wind = dominantWind(monthData.values, landMask);
    return (weather || wind) ? { weather, wind } : null;
  }, [monthData, landMask]);

  const windNormal = WIND_NORMALS[month - 1];

  /* Headline: this month's land-area mean against the 1991-2020 normal for the
     variable — the observational one where ERA5 and the observations measure the
     same quantity, the ERA5-measured one where they do not (sunshine, cloud).
     Nothing is scaled on the way through. */
  const headline = useMemo(() => {
    // Forecast day: compare the land mean against that day's own normal.
    if (isForecast) {
      if (!fcField || !fcDate) return null;
      let sum = 0, n = 0;
      for (let i = 0; i < fcField.length; i++) {
        if (!landMask || !landMask[i]) continue;
        const x = fcField[i];
        if (x === x) { sum += x; n++; }
      }
      if (!n) return null;
      const a = sum / n;
      const ratio = varDef.mode === 'ratio';
      const tol = ratio ? 4 : (varId === 'pressure' ? 1 : 0.3);
      return { val: null, avg: dayNormal(varId, fcDate, normalMonthly), a,
        dir: Math.abs(a) < tol ? 'flat' : a > 0 ? 'up' : 'down' };
    }
    if (!monthData?.values) return null;

    // Hourly rain: an absolute total for the window, nothing to compare against.
    if (varDef.mode === 'hourly') {
      if (!hourField) return null;
      let sum = 0, n = 0;
      for (let i = 0; i < hourField.length; i++) {
        if (!landMask || !landMask[i]) continue;
        const x = hourField[i];
        if (x === x) { sum += x; n++; }
      }
      return n ? { val: sum / n, avg: null, a: sum / n, dir: 'flat' } : null;
    }

    // Threshold: an absolute count, so there is nothing to compare against.
    if (varDef.mode === 'count') {
      if (!countField) return null;
      let sum = 0, n = 0;
      for (let i = 0; i < countField.length; i++) {
        if (!landMask || !landMask[i]) continue;
        const x = countField[i];
        if (x === x) { sum += x; n++; }
      }
      if (!n) return null;
      return { val: sum / n, avg: null, a: sum / n, dir: 'flat' };
    }

    const avg = avgFor(month);
    if (avg == null) return null;

    // Direction: compare as a signed turn from the usual prevailing wind, not
    // as a subtraction (330 deg vs 020 deg is +50 deg, not -310 deg).
    if (varDef.mode === 'direction') {
      const w = character?.wind;
      if (!w) return null;
      const delta = angleDelta(avg, w.deg);
      const dir = Math.abs(delta) < 15 ? 'flat' : delta > 0 ? 'up' : 'down';
      return { val: w.deg, avg, a: delta, dir, cardinal: w.cardinal, steady: w.steadiness };
    }

    const val = areaMean(monthData.values, varId, landMask);
    if (val == null) return null;
    const ratio = varDef.mode === 'ratio';
    const a = ratio ? (avg ? (val / avg) * 100 : null) : val - avg;
    if (a == null) return null;
    const neutral = ratio ? 100 : 0;
    const tol = ratio ? 4 : (varId === 'pressure' ? 1 : 0.3);
    const dir = Math.abs(a - neutral) < tol ? 'flat' : a > neutral ? 'up' : 'down';
    return { val, avg, a, dir };
  }, [monthData, varId, varDef, avgFor, normalMonthly, landMask, month, character,
      countField, hourField, isForecast, fcField, fcDate]);

  const handleDownload = async () => {
    if (!graphicRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(graphicRef.current, {
        backgroundColor: null, scale: 2, useCORS: true, logging: false,
        width: GRAPHIC_W, height: GRAPHIC_H,
        windowWidth: GRAPHIC_W, windowHeight: GRAPHIC_H,
        x: 0, y: 0, scrollX: 0, scrollY: 0,
      });
      const link = document.createElement('a');
      link.download = `climate-${varId}-${year}-${String(month).padStart(2, '0')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally { setIsExporting(false); }
  };

  const sc = depScaleFor(varId);
  const years = [];
  for (let y = new Date().getUTCFullYear(); y >= 1991; y--) years.push(y);
  const DirIcon = headline?.dir === 'up' ? ArrowUp : headline?.dir === 'down' ? ArrowDown : Minus;
  const dirLabel = !headline ? '' : headline.dir === 'flat' ? 'Near average' : headline.dir === 'up' ? varDef.highLabel : varDef.lowLabel;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#f1f5f9' }}>

      {/* ══ Controls ══ */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.10)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Mode — past month vs forecast day. Shares everything below the data
            layer; only the source and reference normal change. */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[['month', 'Past month'], ['forecast', 'Forecast day']].map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setMode(id)} style={{
              ...btnCss, fontWeight: 800,
              background: mode === id ? 'rgba(56,189,248,0.16)' : 'rgba(148,163,184,0.06)',
              borderColor: mode === id ? '#38bdf8' : 'rgba(148,163,184,0.18)',
              color: mode === id ? '#7dd3fc' : '#94a3b8',
            }}>{lbl}</button>
          ))}
        </div>

        {/* Saved months — anything already fetched, restorable for free. */}
        {!isForecast && saved.length > 0 && (
          <div>
            <span style={labelCss}>Saved months · click to view, no request used</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {saved.map(s => {
                const on = s.year === year && s.month === month;
                return (
                  <span key={`${s.year}-${s.month}`} style={{
                    display: 'inline-flex', alignItems: 'center', borderRadius: 8, overflow: 'hidden',
                    border: `1px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.2)'}`,
                    background: on ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.05)',
                  }}>
                    <button type="button"
                      onClick={() => { setYear(s.year); setMonth(s.month); }}
                      style={{
                        padding: '6px 10px', fontSize: 11.5, fontWeight: 700, border: 'none',
                        background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                        color: on ? '#7dd3fc' : '#cbd5e1',
                      }}>
                      {MONTH_NAMES[s.month - 1].slice(0, 3)} {s.year}
                    </button>
                    <button type="button" title="Remove this saved month"
                      onClick={() => { deleteSavedMonth(gridSig, s.year, s.month); setSaved(savedMonths(gridSig));
                        if (on) setMonthData(null); }}
                      style={{
                        padding: '6px 8px', border: 'none', background: 'transparent',
                        cursor: 'pointer', color: '#64748b', fontSize: 12, lineHeight: 1,
                      }}>×</button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {isForecast && (
            <div>
              <span style={labelCss}>Forecast day</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={fcDay} onChange={e => setFcDay(Number(e.target.value))} style={selCss} disabled={!fc}>
                  {(fc?.dates || ['—']).map((d, i) => (
                    <option key={d} value={i}>
                      {d === '—' ? 'load first' : new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB',
                        { weekday: 'short', day: 'numeric', month: 'short' })}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={loadForecast} disabled={fcBusy || !landPoints} style={{
                  ...btnCss, fontWeight: 800,
                  background: fc ? 'rgba(74,222,128,0.14)' : 'rgba(56,189,248,0.16)',
                  borderColor: fc ? 'rgba(74,222,128,0.45)' : '#38bdf8',
                  color: fc ? '#86efac' : '#7dd3fc', cursor: fcBusy ? 'wait' : 'pointer',
                }}>
                  {fcBusy
                    ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />
                    : <Database style={{ width: 13, height: 13 }} />}
                  {fcBusy ? 'Loading…' : fc ? 'Forecast loaded' : 'Load forecast'}
                </button>
              </div>
            </div>
          )}
          <div style={{ display: isForecast ? 'none' : 'block' }}>
            <span style={labelCss}>Month</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selCss}>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} onChange={e => setYear(Number(e.target.value))} style={selCss}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div>
            <span style={labelCss}>Variable</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CLIMATE_VARS.map(v => {
                const on = varId === v.id;
                const VIcon = VAR_ICONS[v.id];
                return (
                  <button key={v.id} type="button" onClick={() => setVarId(v.id)} style={{
                    ...btnCss, fontWeight: 800,
                    background: on ? `${VAR_ACCENT[v.id]}22` : 'rgba(148,163,184,0.06)',
                    borderColor: on ? VAR_ACCENT[v.id] : 'rgba(148,163,184,0.18)',
                    color: on ? '#e2e8f0' : '#94a3b8',
                  }}>
                    <VIcon style={{ width: 13, height: 13 }} /> {v.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Hourly-rain window. The fetch is separate and explicit because it
              is ~10x a daily request; once loaded, the window is free to change. */}
          {isHourly && (
            <div>
              <span style={labelCss}>Hours (local)</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select value={hourFrom} onChange={e => setHourFrom(Number(e.target.value))} style={selCss}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
                <span style={{ fontSize: 12, color: '#64748b' }}>to</span>
                <select value={hourTo} onChange={e => setHourTo(Number(e.target.value))} style={selCss}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
                <button type="button" onClick={loadHourly} disabled={hourBusy || !landPoints} style={{
                  ...btnCss, fontWeight: 800,
                  background: hourBuckets ? 'rgba(74,222,128,0.14)' : 'rgba(56,189,248,0.16)',
                  borderColor: hourBuckets ? 'rgba(74,222,128,0.45)' : '#38bdf8',
                  color: hourBuckets ? '#86efac' : '#7dd3fc',
                  cursor: hourBusy ? 'wait' : 'pointer',
                }}>
                  {hourBusy
                    ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />
                    : <Database style={{ width: 13, height: 13 }} />}
                  {hourBusy ? 'Loading…' : hourBuckets ? 'Hourly loaded' : 'Load hourly rain'}
                </button>
              </div>
            </div>
          )}
          {/* Threshold controls — recompute client-side, no extra request */}
          {isCount && (
            <div>
              <span style={labelCss}>Count days</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {['above', 'below'].map(d => (
                  <button key={d} type="button" onClick={() => setThreshDir(d)} style={{
                    ...btnCss, fontWeight: 800,
                    background: threshDir === d ? 'rgba(56,189,248,0.16)' : 'rgba(148,163,184,0.06)',
                    borderColor: threshDir === d ? '#38bdf8' : 'rgba(148,163,184,0.18)',
                    color: threshDir === d ? '#7dd3fc' : '#94a3b8',
                  }}>{d}</button>
                ))}
                <input type="number" min={-20} max={40} step={1} value={threshTemp}
                  onChange={e => setThreshTemp(Number(e.target.value))}
                  style={{ ...selCss, width: 72, textAlign: 'right' }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#94a3b8' }}>°C</span>
              </div>
            </div>
          )}
          <div>
            <span style={labelCss}>Handle</span>
            <input value={handle} onChange={e => setHandle(e.target.value)} style={{ ...selCss, width: 150 }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => run()} disabled={busy} style={{
            ...btnCss, fontWeight: 800,
            background: busy ? 'rgba(148,163,184,0.08)' : 'rgba(56,189,248,0.14)',
            borderColor: busy ? 'rgba(148,163,184,0.2)' : '#38bdf8',
            color: busy ? '#94a3b8' : '#7dd3fc', cursor: busy ? 'wait' : 'pointer',
          }}>
            {busy ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Database style={{ width: 13, height: 13 }} />}
            {busy ? 'Loading…' : `Load ${varDef.short.toLowerCase()}`}
          </button>
          {busy && <button type="button" onClick={cancel} style={{ ...btnCss, color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}>Cancel</button>}

          {/* Sunshine and cloud have no comparable observational normal, so they
              need one measured from ERA5 first. One request, once, then cached
              forever — far smaller than a month load, which asks 245 locations. */}
          {usesEra5Normal && (
            <button type="button" onClick={measureNormal} disabled={normalBusy} style={{
              ...btnCss, fontWeight: 800,
              background: era5Normal ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.14)',
              borderColor: era5Normal ? 'rgba(74,222,128,0.45)' : 'rgba(251,191,36,0.5)',
              color: era5Normal ? '#86efac' : '#fbbf24',
              cursor: normalBusy ? 'wait' : 'pointer',
            }}>
              {normalBusy
                ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />
                : era5Normal ? <CheckCircle2 style={{ width: 13, height: 13 }} /> : <AlertTriangle style={{ width: 13, height: 13 }} />}
              {normalBusy ? 'Measuring…'
                : era5Normal ? `ERA5 normal ready — ${Math.round(era5Normal.monthly[month - 1])} ${varDef.unit}`
                : `Measure ${varDef.short.toLowerCase()} normal (1 request)`}
            </button>
          )}
          <button type="button" onClick={handleDownload} disabled={!hasMapData || isExporting} style={{
            ...btnCss, marginLeft: 'auto', fontWeight: 800,
            background: hasMapData ? 'linear-gradient(135deg, #0ea5e9, #0284c7)' : 'rgba(148,163,184,0.06)',
            borderColor: hasMapData ? 'transparent' : 'rgba(148,163,184,0.18)',
            color: hasMapData ? '#fff' : '#64748b', cursor: hasMapData ? 'pointer' : 'not-allowed',
          }}>
            {isExporting ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Download style={{ width: 13, height: 13 }} />}
            {isExporting ? 'Exporting…' : 'Download PNG'}
          </button>
        </div>

        {progress && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>
              Fetching {MONTH_NAMES[month - 1]} {year} — request {progress.done} of {progress.total}
            </span>
            <div style={{ height: 5, borderRadius: 99, background: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`, background: '#38bdf8', transition: 'width 0.2s' }} />
            </div>
          </div>
        )}

        {status && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 10,
            background: status.kind === 'err' ? 'rgba(248,113,113,0.08)' : status.kind === 'warn' ? 'rgba(251,191,36,0.08)' : 'rgba(74,222,128,0.07)',
            border: `1px solid ${status.kind === 'err' ? 'rgba(248,113,113,0.35)' : status.kind === 'warn' ? 'rgba(251,191,36,0.35)' : 'rgba(74,222,128,0.28)'}`,
          }}>
            {status.kind === 'ok'
              ? <CheckCircle2 style={{ width: 14, height: 14, color: '#4ade80', flexShrink: 0, marginTop: 1 }} />
              : <AlertTriangle style={{ width: 14, height: 14, color: status.kind === 'err' ? '#f87171' : '#fbbf24', flexShrink: 0, marginTop: 1 }} />}
            <span style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.45 }}>{status.msg}</span>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <Server style={{ width: 12, height: 12, flexShrink: 0, marginTop: 2 }} />
          <span>
            Data comes from <b style={{ color: '#94a3b8' }}>Open-Meteo&apos;s ERA5 archive</b> — not the self-hosted
            TCM box, so the month and the normals stay on one consistent source.
            <b style={{ color: '#94a3b8' }}> Only the variable you pick is fetched</b>, for the month you pick:
            a load asks for one daily field, not the whole list. Variables you have already viewed are kept, so
            going back to one costs nothing. The {NORMALS_PERIOD} averages are hardcoded in{' '}
            <code>lib/ukNormals.js</code>, except sunshine and cloud, which measure their own from ERA5 once
            (<code>lib/era5Normals.js</code>). Open-Meteo applies a daily request limit per IP — if a load fails
            with a quota error, it resets the next day.
          </span>
        </p>

        {/* Known bias, stated plainly rather than left for the reader to find.

           Deliberately UNQUANTIFIED. An earlier version of this panel printed
           specific figures ("max temp is exact", "min temp ~1.6 °C too warm",
           "rainfall ~45% too wet") checked against July 2026. Those were
           measured before rainfall moved from rain_sum to precipitation_sum and
           before sunshine lost its 1.85 divisor, so they no longer describe what
           this tool computes. Naming a direction we can argue from first
           principles is honest; naming a magnitude nobody has re-measured is
           not. Put the numbers back only after re-checking a month against the
           published UK figures. */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)',
        }}>
          <AlertTriangle style={{ width: 14, height: 14, color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.5 }}>
            <b style={{ color: '#fde68a' }}>Known accuracy caveat.</b> Values are ERA5 reanalysis.{' '}
            {usesEra5Normal ? (
              <>
                {varDef.label} compares against a normal measured from ERA5 itself, so both sides of the
                percentage are the same quantity. It is taken at{' '}
                <b style={{ color: '#fde68a' }}>{ERA5_NORMAL_POINT.lat}, {ERA5_NORMAL_POINT.lon}</b> — a single
                reference point, <b style={{ color: '#fca5a5' }}>not an area average</b> of the land grid the
                headline means over, so expect some offset from that.
              </>
            ) : (
              <>
                {varDef.label} compares against the Met Office {NORMALS_PERIOD} observational normal. That is
                sound where ERA5 measures the same quantity as the gauge network, which holds well for
                temperature. It does <b style={{ color: '#fca5a5' }}>not</b> hold for rainfall, rain days or
                overnight minima — ERA5 runs wet and warm overnight against observations, so those departures
                are overstated.
              </>
            )}{' '}
            <b style={{ color: '#fca5a5' }}>The size of that error is currently unmeasured</b> — the figures this
            panel used to quote were checked before rainfall moved to <code>precipitation_sum</code> and before
            sunshine lost its correction factor, so they no longer apply. Check a month against the published UK
            figures before quoting a percentage.
          </span>
        </div>
      </div>

      {/* ══ Graphic — LIGHT ══ */}
      <div ref={scaleWrapRef} style={{ width: '100%', height: GRAPHIC_H * scale, display: 'flex', justifyContent: 'center' }}>
        <div ref={graphicRef} style={{
          width: GRAPHIC_W, height: GRAPHIC_H, position: 'relative', overflow: 'hidden', flexShrink: 0,
          transform: `scale(${scale})`, transformOrigin: 'top center',
          borderRadius: 20, background: PAPER, border: `1px solid ${LINE}`,
          fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
          display: 'flex', flexDirection: 'column', padding: '30px 34px 24px',
        }}>
          {/* Hairline accent along the very top */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />

          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.22em', textTransform: 'uppercase', color: accent }}>
                {isHourly
                  ? `Rain ${String(hourFrom).padStart(2, '0')}:00–${String(hourTo).padStart(2, '0')}:00`
                  : isCount
                  ? `Days ${threshDir} ${threshTemp}°C`
                  : isDirection ? varDef.label : `${varDef.label} anomaly`}
              </span>
              <h2 style={{ margin: '8px 0 0', fontSize: isForecast ? 32 : 40, fontWeight: 700, letterSpacing: '-0.035em', color: INK, lineHeight: 1.05 }}>
                {isForecast
                  ? (fcDate
                      ? new Date(`${fcDate}T12:00:00Z`).toLocaleDateString('en-GB',
                          { weekday: 'long', day: 'numeric', month: 'long' })
                      : 'Load the forecast')
                  : <>{MONTH_NAMES[month - 1]} <span style={{ color: INK3, fontWeight: 500 }}>{year}</span></>}
              </h2>
              <p style={{ margin: '9px 0 0', fontSize: 12, fontWeight: 500, color: INK2 }}>
                {isForecast
                  ? `Forecast for this day vs its ${NORMALS_PERIOD} normal`
                  : isHourly
                  ? `Total rainfall falling between ${String(hourFrom).padStart(2, '0')}:00 and ${String(hourTo).padStart(2, '0')}:00`
                  : isCount
                  ? `Number of days · ${threshDir === 'above' ? 'daily maximum above' : 'daily minimum below'} ${threshTemp}°C`
                  : `Difference from the ${NORMALS_PERIOD} UK average`}
              </p>
            </div>

            {/* Headline figure — type, not a box */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 4 }}>
                <span style={{ fontSize: isDirection ? 40 : 52, fontWeight: 700, color: headline ? accent : INK3, letterSpacing: '-0.045em', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                  {!headline ? '—'
                    : isHourly ? headline.a.toFixed(1)
                    : isCount ? headline.a.toFixed(1)
                    : isDirection ? headline.cardinal
                    : varDef.mode === 'ratio' ? Math.round(headline.a)
                    : `${headline.a > 0 ? '+' : ''}${headline.a.toFixed(1)}`}
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: headline ? accent : INK3 }}>
                  {!headline ? '' : isHourly ? 'mm' : isCount ? 'days'
                    : isDirection ? `${Math.round(headline.val)}°` : varDef.mode === 'ratio' ? '%' : varDef.unit}
                </span>
              </div>
              {headline && (
                <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <DirIcon style={{ width: 13, height: 13, color: accent }} strokeWidth={3} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>{dirLabel}</span>
                </div>
              )}
              <p style={{ margin: '5px 0 0', fontSize: 10.5, color: INK3, fontVariantNumeric: 'tabular-nums' }}>
                {!headline ? (isHourly ? 'Press “Load hourly rain”' : 'No data loaded')
                  : isHourly
                    ? `average across UK land · ${String(hourFrom).padStart(2, '0')}:00–${String(hourTo).padStart(2, '0')}:00`
                  : isCount
                    ? `average across UK land · ${threshDir} ${threshTemp}°C`
                  : isDirection
                    ? `usually ${windNormal.cardinal} ${windNormal.deg}° · ${headline.a > 0 ? '+' : ''}${Math.round(headline.a)}°`
                    : `${formatValue(varDef, headline.val)} · avg ${formatValue(varDef, headline.avg)}`}
              </p>
            </div>
          </div>

          {/* ── Slim fact row ── */}
          {character && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 20, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
              {character?.weather && (
                <Fact first label="Dominant weather" value={character.weather.label}
                      sub={`${Math.round(character.weather.share * 100)}% of days`} />
              )}
              {character?.wind && (
                <Fact label="Prevailing wind" value={character.wind.cardinal}
                      sub={`${Math.round(character.wind.deg)}° · ${character.wind.steadiness >= 0.6 ? 'steady' : character.wind.steadiness >= 0.3 ? 'variable' : 'very variable'}`}
                      icon={
                        <svg width={12} height={12} viewBox="0 0 24 24" style={{ transform: `rotate(${character.wind.deg + 180}deg)` }}>
                          <path d="M12 2 L18 21 L12 17 L6 21 Z" fill={INK2} />
                        </svg>} />
              )}
              <Fact label="Typical pressure" value={PRESSURE_NORMALS[month - 1]}
                    sub={`Usually ${windNormal.cardinal} · ${normalFor('pressure', month)} hPa`} last />
            </div>
          )}

          {/* ── Map ── */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 12, minHeight: 0 }}>
            <div style={{ position: 'relative', width: VIEW_W, height: VIEW_H }}>
              <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width={VIEW_W} height={VIEW_H} style={{ position: 'absolute', inset: 0 }}>
                <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={SEA} rx={14} />
                <g fill="#dbe4ee">{(coast || []).map((d, i) => <path key={i} d={d} />)}</g>
              </svg>

              <canvas ref={canvasRef} width={VIEW_W * SS} height={VIEW_H * SS}
                style={{ position: 'absolute', inset: 0, width: VIEW_W, height: VIEW_H }} />

              <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width={VIEW_W} height={VIEW_H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <g fill="none" stroke="rgba(15,23,42,0.42)" strokeWidth={0.7} strokeLinejoin="round">
                  {(coast || []).map((d, i) => <path key={i} d={d} />)}
                </g>

                {/* Wind: one arrow per land point, pointing the way the air
                    TRAVELS (meteorological direction is where it comes from,
                    hence +180). Opacity carries steadiness. */}
                {arrows && arrows.map((a, i) => (
                  <g key={i} transform={`translate(${a.x} ${a.y}) rotate(${a.deg + 180})`}
                     opacity={0.30 + 0.70 * Math.min(1, a.steady / 0.6)}>
                    <path d="M0,-6.4 L3.1,4.2 L0,2.3 L-3.1,4.2 Z" fill={accent} />
                  </g>
                ))}
              </svg>

              {!hasMapData && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ padding: '8px 15px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: PAPER, border: `1px solid ${LINE}`, color: INK3 }}>
                    {busy ? 'Loading data…'
                      : usesEra5Normal && !era5Normal
                        ? `Measure the ${varDef.short.toLowerCase()} normal first`
                        : `Press “Load ${varDef.short.toLowerCase()}”`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Legend ── */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 7 }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK3 }}>
                {isDirection ? 'Dominant direction per grid point' : sc.label}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: INK3 }}>
                {MONTH_NAMES[month - 1]} {year}
              </span>
            </div>
            {isDirection ? (
              /* Direction has no colour ramp — the legend explains the arrows. */
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, paddingTop: 2 }}>
                {[['Faint', 0.3], ['Mixed', 0.6], ['Steady', 1]].map(([lbl, op]) => (
                  <span key={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <svg width={13} height={13} viewBox="-7 -7 14 14" style={{ opacity: op }}>
                      <path d="M0,-6.4 L3.1,4.2 L0,2.3 L-3.1,4.2 Z" fill={accent} />
                    </svg>
                    <span style={{ fontSize: 9.5, fontWeight: 600, color: INK3 }}>{lbl}</span>
                  </span>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 600, color: INK3 }}>
                  Arrows show where the wind blew towards
                </span>
              </div>
            ) : (
              <>
                {/* One continuous gradient built from the same control points the
                    map samples, so legend and field cannot drift apart. */}
                <div style={{ height: 10, borderRadius: 3, background: depGradientCss(sc.pts) }} />
                <div style={{ display: 'flex', marginTop: 4, justifyContent: 'space-between' }}>
                  {sc.ticks.map((t, i) => (
                    <span key={i} style={{ fontSize: 8.5, fontWeight: 600, color: INK3, fontVariantNumeric: 'tabular-nums' }}>{t}</span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Footer ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 13, borderTop: `1px solid ${LINE}` }}>
            {siteLogoUrl
              ? <img src={siteLogoUrl} alt="" crossOrigin="anonymous" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 26, height: 26, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CloudRain style={{ width: 13, height: 13, color: '#fff' }} />
                </div>}
            <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{handle}</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 500, color: INK3, textAlign: 'right', lineHeight: 1.55 }}>
              ERA5 reanalysis via Open-Meteo<br />
              Averages: UK {NORMALS_PERIOD}
            </span>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/** One item in the slim fact row — label above, value below, hairline divider. */
function Fact({ label, value, sub, icon, first, last }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, paddingLeft: first ? 0 : 16, paddingRight: 16,
      borderRight: last ? 'none' : `1px solid ${LINE}`,
    }}>
      <p style={{ margin: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: INK3 }}>{label}</p>
      <p style={{ margin: '5px 0 0', fontSize: 17, fontWeight: 700, color: INK, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}{value}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: 10, fontWeight: 500, color: INK3 }}>{sub}</p>
    </div>
  );
}
