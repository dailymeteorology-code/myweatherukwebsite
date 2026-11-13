/* Weather Model Data: forecasts, probabilities, live observations and observed days on the
   UKV 2 km grid.

   Data (never Open-Meteo), gridded by tools/modeldata on this server:
     Forecast     Met Office UKV 2 km and Global 10 km, ECMWF IFS and AIFS, NOAA GFS, GEFS
                  mean and GEFS-Aerosols, with ECMWF and NOAA waves
     Probability  ECMWF ENS, ECMWF AIFS ENS, NOAA GEFS
     Live         Met Office 1 km radar, Meteosat imagery, LEELA lightning, and a 15-minute
                  UKV + METAR analysis of the weather now
     Observed     each day's extremes from that analysis and the radar, kept for good
   UKV is drawn cell for cell at its real 2 km.

   Layout: the map fills the page; the controls float over it as glass bars. The bright
   frame in the middle IS the graphic: the same renderer draws it here and into a PNG, GIF or
   video, so what you frame (screen, square, wide, vertical, 4:5) is what you download.

   Met Office warnings go over any layer, any layer can be laid over or under any other, and the
   frame can hold two windows with a white line between them: two runs, models or layers at the same
   valid time, or the warnings beside a layer.
   GIFs and videos are made smooth by working out the frames between the steps (lib/modelTween). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Play, Pause, ChevronLeft, ChevronRight, Download, Film, ImageIcon, ZoomIn, ZoomOut, Maximize,
  Waves, MapPin, Search, ChevronDown, X, Layers, Star, Minus, Plus, Zap, Route, Grid3x3, Navigation, CloudSun, Cloud,
  Map as MapIcon, CloudLightning, Gauge, Columns2, ArrowLeftRight, TriangleAlert, Clapperboard,
} from 'lucide-react';
import {
  API, NX, NY, REGIONS, MAP_STYLES, FONT, scaleFor, loadFrame, runTag, fieldLayer, frameContours, drawScene,
  realtimeBasemap, fmtValue, download, makeGif, makeVideo, canMakeVideo, probFrame, loadLive, loadRoads, loadObserved, WX_NAMES, sampleFrame,
  lonLatToGrid, STRIKE_STYLE, GRID, setGrid, staticUrl, pressureLines, pressureCentres, splitFrame, drawPanes, withGrid, viewOnGrid, WARN_COLOURS,
  coversMap, SEE_THROUGH, setPalette, scaleSwatch, radarTypeOf, RADAR_FAMILIES,
} from '@/lib/modelViewer';
import { tweenFrame } from '@/lib/modelTween';
import { GRIDS, gridOfModel, projection } from '@/lib/modelGrids';
import { useAuth } from '@/lib/AuthContext';
import { novaRecentRuns, novaRun, runName, riskAreas, RISK_KEY, londonDay } from '@/lib/novaOutlook';
import { listStudioGraphics } from '@/components/studio/studioSaves';
import { boxToLatLon } from '@/components/studio/studioGeo';

const GROUP_ORDER = ['Precipitation', 'Temperature', 'Wind & pressure', 'Cloud & visibility', 'Convection', 'Snow & ice', 'Sea & waves', 'Air quality', 'Upper air', 'Radiation & surface'];
const FRAMES = { screen: { label: 'Fit', a: null }, square: { label: '1:1', a: 1 }, wide: { label: '16:9', a: 16 / 9 }, story: { label: '9:16', a: 9 / 16 }, portrait: { label: '4:5', a: 4 / 5 } };
const SHORT_NAMES = { ukv: 'UKV', mo_global: 'MO Global', ifs: 'ECMWF', aifs: 'AIFS', gfs: 'GFS', gefs_mean: 'GEFS mean', gefs_aer: 'Dust & air', ecmwf_ens: 'ECMWF ENS', aifs_ens: 'AIFS ENS', gefs: 'GEFS' };
/* who makes each model, its grid, and where the files come from (picker groups and the credit line) */
const MODEL_INFO = {
  ukv: ['Met Office', '2 km', 'Met Office via AWS'], mo_global: ['Met Office', '10 km', 'Met Office via AWS'],
  ifs: ['ECMWF', '0.25°', 'ECMWF open data'], aifs: ['ECMWF', '0.25°', 'ECMWF open data'],
  gfs: ['NOAA', '0.25°', 'NOAA via AWS'], gefs_mean: ['NOAA', '0.5°', 'NOAA via AWS'], gefs_aer: ['NOAA', '0.25°', 'NOAA via AWS'],
  ecmwf_ens: ['ECMWF', '0.25°', 'ECMWF open data'], aifs_ens: ['ECMWF', '0.25°', 'ECMWF open data'], gefs: ['NOAA', '0.25°', 'NOAA via AWS'],
};
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];
/* the viewer's settings, remembered in this browser between visits */
const PREFS_KEY = 'md-prefs-v1';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
const MODES = ['forecast', 'prob', 'live', 'observed'];
const OBS_PANEL_W = 320;                                    // the observed side panel, CSS px
/* the four views: [key, name, what it is] (the phone's view menu says what each one is for) */
const MODE_INFO = [
  ['forecast', 'Forecast', 'Every model and every layer, run by run'],
  ['prob', 'Probability', 'The chance of rain, wind, frost and more, from ensembles'],
  ['live', 'Live', 'Radar, satellite, lightning and the weather now'],
  ['observed', 'Observed', 'Each day’s highs, lows and totals, kept day by day'],
];
const MODE_SHORT = { forecast: 'Forecast', prob: 'Chance', live: 'Live', observed: 'Observed' };
const londonToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
/* rain-type layers: these get the cloud overlay and the smoothing that keeps the radar's colour bands crisp */
const RAINY = new Set(['radar', 'precip_rate', 'rain_rate', 'conv_rain', 'precip_1h', 'refc', 'snow_rate', 'hail_rate']);

/* Probability products: [group, key, label, ensemble field, above|below, default, min, max, step]. The chance is the
   share of ensemble members past the threshold; the threshold and direction can be changed freely. */
const PRESETS = [
  ['Wind', 'gust', 'Wind gusts', 'gust', 'above', 50, 20, 110, 1],
  ['Wind', 'gust_dmg', 'Damaging gusts', 'gust', 'above', 60, 20, 110, 1],
  ['Wind', 'gust_sev', 'Severe, destructive gusts', 'gust', 'above', 75, 20, 110, 1],
  ['Wind', 'gale', 'Gale-force wind (mean)', 'wind', 'above', 39, 10, 90, 1],
  ['Rain & flooding', 'rain24', 'Rain (24 h)', 'precip_24h', 'above', 10, 0.5, 120, 0.5],
  ['Rain & flooding', 'rain6', 'Rain (6 h)', 'precip_6h', 'above', 5, 0.5, 80, 0.5],
  ['Rain & flooding', 'heavy', 'Heavy rain (24 h)', 'precip_24h', 'above', 25, 0.5, 120, 0.5],
  ['Rain & flooding', 'flood_rain', 'Flooding risk: very heavy rain', 'precip_24h', 'above', 40, 5, 150, 1],
  ['Rain & flooding', 'flood_runoff', 'Flooding risk: runoff', 'runoff_24h', 'above', 20, 1, 120, 1],
  ['Rain & flooding', 'dry', 'Dry (24 h)', 'precip_24h', 'below', 0.5, 0.1, 5, 0.1],
  ['Snow & ice', 'snow24', 'Snowfall (24 h)', 'snow_24h', 'above', 1, 0.5, 40, 0.5],
  ['Snow & ice', 'snow_heavy', 'Heavy snow (24 h)', 'snow_24h', 'above', 10, 0.5, 60, 0.5],
  ['Snow & ice', 'snowdepth', 'Lying snow', 'snow_depth', 'above', 1, 1, 60, 1],
  ['Snow & ice', 'snowing', 'Snow falling (6 h)', 'snowing', 'above', 0.05, 0.05, 1, 0.05],
  ['Snow & ice', 'frzr', 'Freezing rain (6 h)', 'frzr', 'above', 0.05, 0.05, 1, 0.05],
  ['Temperature', 'frost', 'Air frost', 't2', 'below', 0, -15, 10, 0.5],
  ['Temperature', 'hardfrost', 'Hard frost', 't2', 'below', -5, -20, 5, 0.5],
  ['Temperature', 'tbelow', 'Temperature below', 't2', 'below', 5, -20, 30, 0.5],
  ['Temperature', 'tabove', 'Temperature above', 't2', 'above', 20, -10, 40, 0.5],
  ['Temperature', 'heat', 'Heat', 't2', 'above', 28, 15, 40, 0.5],
  ['Storms', 'thunder', 'Thunderstorm potential (CAPE)', 'cape', 'above', 500, 50, 3000, 50],
  ['Storms', 'deeplow', 'Deep low (pressure)', 'mslp', 'below', 980, 940, 1015, 1],
  ['Sky & visibility', 'fog', 'Fog (visibility)', 'vis', 'below', 1, 0.2, 10, 0.1],
  ['Sky & visibility', 'clear', 'Clear skies', 'tcc', 'below', 25, 5, 80, 5],
  ['Sky & visibility', 'overcast', 'Overcast', 'tcc', 'above', 85, 50, 100, 5],
].map(([group, key, label, field, dir, thr, min, max, step]) => ({ group, key, label, field, dir, thr, min, max, step }));
const PRESET = Object.fromEntries(PRESETS.map((x) => [x.key, x]));

/* Live: [group, key, label, catalogue product]. Some views are drawn from the same images
   (infrared as plain, as a cloud-top colour scale, or as clouds over the map). */
const LIVE_LIST = [
  ['Now: observed + UKV', 'now_wx', 'Current weather', 'now_wx', 'wx'],
  ['Now: observed + UKV', 'now_t2', 'Temperature', 'now_t2', 't2'],
  ['Now: observed + UKV', 'now_feels', 'Feels like', 'now_feels', 'feels'],
  ['Now: observed + UKV', 'now_windchill', 'Wind chill', 'now_windchill', 'windchill'],
  ['Now: observed + UKV', 'now_td2', 'Dew point', 'now_td2', 'td2'],
  ['Now: observed + UKV', 'now_rh2', 'Humidity', 'now_rh2', 'rh2'],
  ['Now: observed + UKV', 'now_wind10', 'Wind speed & direction', 'now_wind10', 'wind10'],
  ['Now: observed + UKV', 'now_gust10', 'Wind gusts', 'now_gust10', 'gust10'],
  ['Now: observed + UKV', 'now_mslp', 'Pressure', 'now_mslp', 'mslp'],
  ['Now: observed + UKV', 'now_tcc', 'Cloud cover', 'now_tcc', 'tcc'],
  ['Radar & lightning', 'radar', 'Rain radar', 'radar_type', 'radar_type'],                 // rain, snow, sleet and ice
  ['Radar & lightning', 'radar_plain', 'Rain radar: rain colours only', 'radar'],
  ['Satellite', 'sat_clouds', 'Clouds over the map', 'sat_ir'],
  ['Satellite', 'sat_ir', 'Infrared', 'sat_ir'],
  ['Satellite', 'sat_ir_enh', 'Infrared: cloud-top colours', 'sat_ir'],
  ['Satellite', 'sat_vis', 'Visible (high resolution)', 'sat_vis'],
  ['Satellite', 'sat_geo', 'GeoColour (day & night)', 'sat_geo'],
  ['Satellite', 'sat_true', 'True colour', 'sat_true'],
  ['Satellite', 'sat_wv', 'Water vapour', 'sat_wv'],
  ['Satellite', 'sat_cth', 'Cloud-top height', 'sat_cth'],
  ['Satellite RGB', 'sat_airmass', 'Airmass', 'sat_airmass'],
  ['Satellite RGB', 'sat_conv', 'Severe convection', 'sat_conv'],
  ['Satellite RGB', 'sat_fog', 'Fog & low cloud', 'sat_fog'],
].map(([group, key, label, src, scale]) => ({ group, key, label, src, scale }));
const LIVE = Object.fromEntries(LIVE_LIST.map((x) => [x.key, x]));
/* the live layers that are the radar (in mm/h, with clouds beneath if wanted) */
const RADARS = new Set(['radar', 'radar_type']);
const NOW_UNITS = { now_t2: '°C', now_feels: '°C', now_windchill: '°C', now_td2: '°C', now_rh2: '%', now_wind10: 'mph', now_gust10: 'mph', now_mslp: 'hPa', now_tcc: '%', now_wx: '' };

/* Observed: each day's extremes (mdata/now.py), kept from 20 Oct 2026 onwards. [group, key, label, scale, unit] */
const OBS_LIST = [
  ['Temperature', 't2_max', 'Highest temperature', 't2', '°C'],
  ['Temperature', 't2_min', 'Lowest temperature', 't2', '°C'],
  ['Temperature', 'feels_max', 'Highest feels-like', 'feels', '°C'],
  ['Temperature', 'feels_min', 'Lowest feels-like', 'feels', '°C'],
  ['Temperature', 'windchill_min', 'Lowest wind chill', 'windchill', '°C'],
  ['Rain', 'precip_total', 'Rainfall total (radar)', 'precip_total', 'mm'],
  ['Rain', 'rain_rate_max', 'Heaviest rain rate (radar)', 'radar', 'mm/h'],
  ['Wind', 'gust10_max', 'Strongest gust', 'gust10', 'mph'],
  ['Wind', 'wind10_max', 'Strongest wind (mean)', 'wind10', 'mph'],
  ['Moisture & pressure', 'td2_max', 'Highest dew point', 'td2', '°C'],
  ['Moisture & pressure', 'td2_min', 'Lowest dew point', 'td2', '°C'],
  ['Moisture & pressure', 'rh2_max', 'Highest humidity', 'rh2', '%'],
  ['Moisture & pressure', 'rh2_min', 'Lowest humidity', 'rh2', '%'],
  ['Moisture & pressure', 'mslp_max', 'Highest pressure', 'mslp', 'hPa'],
  ['Moisture & pressure', 'mslp_min', 'Lowest pressure', 'mslp', 'hPa'],
].map(([group, key, label, scale, unit]) => ({ group, key, label, scale, unit }));
const OBS = Object.fromEntries(OBS_LIST.map((x) => [x.key, x]));
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/* The risk overlay (admins only, as TCM NOVA itself is): a NOVA run's thunderstorm risk at the
   outlook graphics' key, or an outlook saved in the Graphic Studio, over any layer. */
const OUTLOOK_ORDER = [...RISK_KEY.map((k) => k.id), 'Conditional Severe', 'Severe'];
const OUTLOOK_COLOURS = { ...Object.fromEntries(RISK_KEY.map((k) => [k.id, k.colour])), 'Conditional Severe': '#a5b4fc', Severe: '#a5b4fc' };
const toGridRing = (ring) => ring.map(([lat, lon]) => lonLatToGrid(lon, lat));
const isOutlookState = (st) => !st._scenarioTool && (!st.tool || st.tool === 'outlook');
/** A saved outlook's drawn areas on the display grid, lowest level first (Severe hatched). */
function outlookOverlay(state) {
  return (state?.shapes || []).filter((s) => OUTLOOK_COLOURS[s.riskLevel] && s.points?.length > 2)
    .sort((a, b) => OUTLOOK_ORDER.indexOf(a.riskLevel) - OUTLOOK_ORDER.indexOf(b.riskLevel))
    .map((s) => ({
      colour: OUTLOOK_COLOURS[s.riskLevel], rings: [toGridRing(s.points.map(([x, y]) => boxToLatLon(x, y)))],
      dash: !!s.cond || s.riskLevel === 'Conditional Severe', hatch: /Severe/.test(s.riskLevel),
    }));
}
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/* Met Office warnings on a display grid */
const SEV_RANK = { Yellow: 0, Amber: 1, Red: 2 };
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a / 2); };
/* a point inside a ring: the middle of its widest span along the row through its centre (a warning
   area wraps round coasts and hills, so its centre of gravity may be outside it) */
function pointInside(ring) {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const cy = sy / ring.length, xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i];
    if ((y0 <= cy) !== (y1 <= cy)) xs.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
  }
  xs.sort((a, b) => a - b);
  let bx = sx / ring.length, bw = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { bw = xs[i + 1] - xs[i]; bx = (xs[i] + xs[i + 1]) / 2; }
  return [bx, cy];
}
function pointInRings(x, y, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x0, y0] = r[j], [x1, y1] = r[i];
      if ((y0 > y) !== (y1 > y) && x < x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)) inside = !inside;
    }
  }
  return inside;
}
/** A warning from /api/modeldata/warnings on a grid: its rings, in cells, and where its label goes. */
function warningOnGrid(w, P) {
  const polys = w.geometry.type === 'Polygon' ? [w.geometry.coordinates] : w.geometry.coordinates;
  const rings = [];
  let big = null, bigArea = 0;
  for (const poly of polys) {
    const rs = poly.map((ring) => ring.map(([lon, lat]) => P.toGrid(lon, lat)));
    rings.push(...rs);
    const a = ringArea(rs[0]);
    if (a > bigArea) { bigArea = a; big = rs[0]; }
  }
  return { id: w.id, severity: w.severity, text: w.type, colour: WARN_COLOURS[w.severity], rings, label: big ? pointInside(big) : null,
    fromMs: Date.parse(w.from), toMs: Date.parse(w.to) };
}
const londonClock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const londonWeekday = (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
const warnWhen = (w) => `${londonWeekday(w.fromMs)} ${londonClock(w.fromMs)} – ${londonDay(w.fromMs) === londonDay(w.toMs) ? '' : `${londonWeekday(w.toMs)} `}${londonClock(w.toMs)}`;

/* The second window at a time. The steps of a run nearest a valid time, or null when the run does
   not reach it. */
function nearestStep(steps, runMs, ms) {
  if (!steps.length) return null;
  const h = (ms - runMs) / 3600e3;
  if (h < steps[0] - 1.5 || h > steps[steps.length - 1] + 1.5) return null;
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - h) < Math.abs(best - h)) best = s;
  return best;
}
/* the run to set beside a run: for the same model the one before that reaches about as far (a UKV
   hour between the long runs is not much of a comparison); for another model, its usual one */
function runBeside(m, first, run) {
  if (m.id !== first?.id) return defaultRun(m);
  const t = run ? Date.parse(run.run) : Infinity;
  const older = m.runs.filter((r) => Date.parse(r.run) < t);
  return older.find((r) => r.steps.length >= 0.8 * (run?.steps.length || 0)) || older[0] || defaultRun(m);
}
/* a frame part-way between two frames of a run, for a smooth GIF or video: it stands in for a frame
   (the time and T+ are its own) and lib/modelTween works out its values when its layers are made */
const tweenRaw = (a, b, t, ms) => ({ ...a, head: { ...a.head, valid: new Date(ms).toISOString(), step: t < 0.5 ? a.head.step : b.head.step }, tween: { a, b, t, span: Date.parse(b.head.valid) - Date.parse(a.head.valid) } });
const GIF_FPS = 25;                                         // 40 ms a frame: the smoothest every GIF viewer keeps to
const WARN_FADE = 40 * 60e3;                                // how long a warning takes to ease on in a smooth export
/* the display cells a window can see, as cells of a frame, with room for what is drawn from them */
const cellBox = (f, b) => { const K = f.nx ? f.k || 1 : 1, m = 18; return b && [Math.floor(b[0] / K) - m, Math.floor(b[1] / K) - m, Math.ceil(b[2] / K) + m, Math.ceil(b[3] / K) + m]; };
const boxOf = (rect, v) => [v.cx - rect.w / 2 / v.s, v.cy - rect.h / 2 / v.s, v.cx + rect.w / 2 / v.s, v.cy + rect.h / 2 / v.s];
const EMPTY = {};
const MAX_EXTRA = 3;                                        // layers laid over or under the main one
const NO_COLOURS = new Set(['wdir10', 'mwd']);              // directions have no colours to lay over anything

/* frames of a run's variable, made on demand on the server, the step on screen first */
function useRunFrames(model, run, v, wantStep, on) {
  const [frames, setFrames] = useState({});
  const [status, setStatus] = useState(null);
  const key = on && model && run && (model.variables || model.fields)?.includes(v) ? `${model.id}/${runTag(run.run)}/${v}` : null;
  useEffect(() => {
    setFrames({}); setStatus(null);
    if (!key) return undefined;
    const [m, rt, vv] = key.split('/');
    const ac = new AbortController();
    const want = new Set();
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      try {
        const st = await fetch(`${API}/frames/${m}/${rt}/${vv}/status?first=${Math.max(0, wantStep.current || 0)}`, { signal: ac.signal }).then((r) => r.json());
        if (!alive) return;
        setStatus((o) => (o && o.state === st.state && o.done?.length === st.done?.length && o.missing?.length === st.missing?.length ? o : st));
        const todo = (st.done || []).filter((s) => !want.has(s)).sort((a, b) => Math.abs(a - wantStep.current) - Math.abs(b - wantStep.current));
        const batch = todo.slice(0, 6);
        await Promise.all(batch.map(async (s) => {
          want.add(s);
          try { const f = await loadFrame(m, rt, vv, s, ac.signal); if (alive) setFrames((o) => ({ ...o, [s]: f })); } catch { want.delete(s); }
        }));
        if (st.state !== 'complete' || todo.length > batch.length) setTimeout(poll, todo.length > batch.length ? 0 : 1200);
      } catch { if (alive) setTimeout(poll, 3000); }
    };
    poll();
    return () => { alive = false; ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key ? { frames, status, key } : null;
}
/* frames of one more variable of the same model run (wind direction, weather type, cloud) */
const useCompanion = (model, run, v, wantStep, on) => useRunFrames(model, run, v, wantStep, on)?.frames ?? null;

/* a live product's frames by time (ms), for overlays: cloud under the radar, arrows, symbols */
function useLiveCompanion(liveCat, product, on) {
  const [frames, setFrames] = useState({});
  const prod = on && product ? liveCat?.products?.[product] : null;
  const times = prod?.times?.join(',') || '';
  const got = useRef(new Set());
  useEffect(() => { got.current = new Set(); setFrames({}); }, [product]);
  useEffect(() => {
    if (!prod?.times?.length) return undefined;
    const ac = new AbortController();
    let alive = true;
    const todo = prod.times.filter((t) => !got.current.has(t)).reverse();
    (async () => {
      for (let i = 0; i < todo.length && alive; i += 6) {
        await Promise.all(todo.slice(i, i + 6).map(async (t) => {
          got.current.add(t);
          try { const f = await loadLive(product, t, prod.ext, ac.signal); if (alive) setFrames((o) => ({ ...o, [Date.parse(t)]: f })); } catch { got.current.delete(t); }
        }));
      }
    })();
    return () => { alive = false; ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, times]);
  return prod ? frames : null;
}
/* one observed field for every day on record, by the day's time (ms), for laying over or under the day's layer */
function useObservedCompanion(days, name) {
  const [frames, setFrames] = useState({});
  const list = days?.join(',') || '';
  useEffect(() => {
    setFrames({});
    if (!name || !list) return undefined;
    const ac = new AbortController();
    let alive = true;
    (async () => {
      const order = list.split(',').reverse();
      for (let i = 0; i < order.length && alive; i += 4) {
        await Promise.all(order.slice(i, i + 4).map(async (d) => {
          try {
            const f = await loadObserved(d, name, ac.signal);
            f.head.valid = `${d}T12:00:00Z`;
            if (alive) setFrames((o) => ({ ...o, [dayMs(d)]: f }));
          } catch { /* that day has no such field */ }
        }));
      }
    })();
    return () => { alive = false; ac.abort(); };
  }, [name, list]);
  return name ? frames : null;
}

/* the companion frame for a main frame: same step, or the nearest time within `tolMin` */
function companionOf(map, raw, live, tolMin = 10) {
  if (!map || !raw) return null;
  if (!live) return map[raw.head.step] || null;
  const ms = Date.parse(raw.head.valid);
  let best = null, bd = tolMin * 60e3 + 1;
  for (const k of Object.keys(map)) { const d = Math.abs(Number(k) - ms); if (d < bd) { bd = d; best = map[k]; } }
  return best;
}
/* a layer laid over or under: the same step, or else the nearest within three hours (not every field
   of a run has every step) */
function extraFrameOf(map, raw, byTime) {
  if (!map || !raw) return null;
  if (byTime) return companionOf(map, raw, true, 20);
  const at = raw.head.step;
  if (map[at]) return map[at];
  let best = null;
  for (const k of Object.keys(map)) if (Math.abs(k - at) <= 3 && (best == null || Math.abs(k - at) < Math.abs(best - at))) best = Number(k);
  return best == null ? null : map[best];
}
const fmtThr = (v) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : v.toFixed(v < 1 ? 2 : 1));

function defaultRun(m) {
  const runs = m.runs.filter((r) => !r.kept);                      // a run kept only for its reach is never the default
  const most = Math.max(0, ...runs.map((r) => r.steps.length));
  return runs.find((r) => r.steps.length >= 0.6 * most) || runs[0] || m.runs[0];
}
/* a model's runs grouped by their day (UTC), newest first: the last day's worth is listed, so for
   the UKV that is two dozen */
const runDays = (runs) => {
  const out = [];
  for (const r of runs) {
    const day = new Date(r.run).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
    if (!out.length || out[out.length - 1][0] !== day) out.push([day, []]);
    out[out.length - 1][1].push(r);
  }
  return out;
};
const runOptions = (runs) => runDays(runs).map(([day, rs]) => (
  <optgroup key={day} label={day} style={{ color: '#111' }}>
    {rs.map((r) => <option key={r.run} value={r.run} style={{ color: '#111' }}>{runLabel(r.run)} · T+{r.steps[r.steps.length - 1]}{r.run === runs[0].run ? ' · latest' : ''}</option>)}
  </optgroup>
));
const runLabel = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit' }).replace(',', '') + 'Z';
/* what the key says about a frame: the model, the run and the lead time, and the shorter version
   that a narrow window has room for */
function creditOf(m, rn, lead) {
  const when = rn ? ` · run ${runLabel(rn.run)}${lead != null ? ` · T+${lead}` : ''}` : '';
  const who = m.members ? `${m.label} · ${m.members} members` : `${m.id === 'ukv' ? 'UKV' : m.label} ${MODEL_INFO[m.id]?.[1] || ''}`.trim();
  return { credit: `${who}${when} · ${MODEL_INFO[m.id]?.[2] || 'open data'}`, creditShort: `${SHORT_NAMES[m.id] || m.label}${when}` };
}
const imgCache = {};
const loadImage = (src) => (imgCache[src] ||= new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));

/* ── liquid glass, in two tints: the bars follow the map underneath, so text on them stays
   readable (dark glass over the dark, satellite and real-time maps; light glass over the
   light map) ── */
const BLUR = { backdropFilter: 'blur(26px) saturate(185%)', WebkitBackdropFilter: 'blur(26px) saturate(185%)' };
function mkTheme(light) {
  const glass = light ? {
    ...BLUR,
    background: 'linear-gradient(140deg, rgba(255,255,255,0.8), rgba(255,255,255,0.62) 55%, rgba(255,255,255,0.74))',
    border: '1px solid rgba(255,255,255,0.9)',
    boxShadow: 'inset 0 1px 0 #ffffff, inset 0 -1px 0 rgba(15,23,34,0.04), 0 10px 30px rgba(15,23,34,0.18)',
    color: '#0f1722',
  } : {
    ...BLUR,
    background: 'linear-gradient(140deg, rgba(58,72,96,0.5), rgba(18,26,40,0.48) 55%, rgba(36,48,68,0.52))',
    border: '1px solid rgba(255,255,255,0.16)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(255,255,255,0.05), 0 12px 32px rgba(0,0,0,0.38)',
    color: '#f5f7fa',
  };
  return light ? {
    light, glass, capsule: { ...glass, borderRadius: 999 }, ink: '#0f1722', ink2: 'rgba(15,23,34,0.58)', ink3: 'rgba(15,23,34,0.84)',
    track: 'rgba(15,23,34,0.07)', trackShadow: 'inset 0 1px 2px rgba(15,23,34,0.12)', idle: 'rgba(15,23,34,0.06)',
    on: 'linear-gradient(180deg, #ffffff, #eef2f7)', onShadow: '0 1px 3px rgba(15,23,34,0.2), inset 0 1px 0 #ffffff',
    chip: 'rgba(15,23,34,0.06)', chipShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)', btn: 'rgba(15,23,34,0.09)', line: 'rgba(15,23,34,0.1)',
  } : {
    light, glass, capsule: { ...glass, borderRadius: 999 }, ink: '#f5f7fa', ink2: 'rgba(240,244,250,0.64)', ink3: 'rgba(240,244,250,0.86)',
    track: 'rgba(0,0,0,0.24)', trackShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)', idle: 'rgba(0,0,0,0.2)',
    on: 'linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0.14))', onShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 8px rgba(0,0,0,0.25)',
    chip: 'rgba(255,255,255,0.08)', chipShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)', btn: 'rgba(255,255,255,0.18)', line: 'rgba(255,255,255,0.12)',
  };
}
const THEMES = { dark: mkTheme(false), light: mkTheme(true) };
const ThemeCtx = React.createContext(THEMES.dark);

function Seg({ items, value, onChange, small }) {
  const t = React.useContext(ThemeCtx);
  return (
    <div style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 999, background: t.track, boxShadow: t.trackShadow }}>
      {items.map(([k, label]) => {
        const on = k === value;
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: small ? 11.5 : 12.5, fontWeight: 650, letterSpacing: '-0.01em',
            padding: small ? '5px 9px' : '6px 12px', borderRadius: 999, whiteSpace: 'nowrap', transition: 'all .18s ease',
            color: on ? t.ink : t.ink2, background: on ? t.on : 'transparent', boxShadow: on ? t.onShadow : 'none',
          }}>{label}</button>
        );
      })}
    </div>
  );
}
function IconBtn({ on, title, onClick, children, style }) {
  const t = React.useContext(ThemeCtx);
  return (
    <button title={title} aria-label={title} onClick={onClick} style={{
      border: 'none', cursor: 'pointer', width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center',
      color: on ? t.ink : t.ink2, background: on ? t.on : t.idle, boxShadow: on ? t.onShadow : t.trackShadow, ...style,
    }}>{children}</button>
  );
}
/* a labelled on/off pill */
function Pill({ on, onClick, icon, children, title }) {
  const t = React.useContext(ThemeCtx);
  return (
    <button title={title} aria-pressed={!!on} onClick={onClick} style={{
      border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 11.5, fontWeight: 700, padding: '0 11px', height: 32, borderRadius: 999,
      display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      color: on ? t.ink : t.ink2, background: on ? t.on : t.idle, boxShadow: on ? t.onShadow : t.trackShadow,
    }}>{icon}{children}</button>
  );
}
/* one row of the Layers panel: icon, name, a note, and a switch (locked when the layer on
   show already includes it) */
function LayerRow({ icon, label, note, on, onClick, locked }) {
  const t = React.useContext(ThemeCtx);
  return (
    <button onClick={locked ? undefined : onClick} disabled={locked} aria-pressed={!!on} style={{
      all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 12,
      cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.75 : 1,
    }}>
      <span style={{ width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', flexShrink: 0, background: on ? t.on : t.idle, boxShadow: on ? t.onShadow : 'none', color: on ? t.ink : t.ink2 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: t.ink }}>{label}</span>
        {note && <span style={{ display: 'block', fontSize: 11, color: t.ink2, marginTop: 1 }}>{note}</span>}
      </span>
      <span style={{ width: 34, height: 20, borderRadius: 999, flexShrink: 0, position: 'relative', transition: 'background .18s',
        background: on ? (t.light ? '#1f6fe0' : 'rgba(110,180,255,0.75)') : t.track, boxShadow: t.trackShadow }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left .18s' }} />
      </span>
    </button>
  );
}
/* a sheet rising from the bottom of the map (phones): drag the handle down, or tap outside, to
   close. `clear` keeps the map visible behind it (for switches whose effect you want to see).
   z-index 44/45: above the site's version badge (40), below its bottom navigation (50). */
function Sheet({ title, note, onClose, children, tall, clear }) {
  const t = React.useContext(ThemeCtx);
  const [dy, setDy] = useState(0);
  const start = useRef(null);
  const down = (e) => { if (e.target.closest('button')) return; start.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (start.current != null) setDy(Math.max(0, e.clientY - start.current)); };
  const up = () => { if (start.current == null) return; start.current = null; if (dy > 70) onClose(); setDy(0); };
  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 44, background: clear ? 'transparent' : 'rgba(2,6,14,0.45)' }} />
      <div role="dialog" aria-modal="true" aria-label={title} style={{ ...t.glass, position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 45, borderRadius: '22px 22px 0 0',
        maxHeight: tall ? '82%' : '64%', display: 'flex', flexDirection: 'column', transform: `translateY(${dy}px)`,
        transition: start.current == null ? 'transform .2s ease' : 'none', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ padding: '8px 14px', touchAction: 'none', cursor: 'grab', flexShrink: 0 }}>
          <div style={{ width: 40, height: 5, borderRadius: 5, background: t.light ? 'rgba(15,23,34,0.2)' : 'rgba(255,255,255,0.28)', margin: '0 auto 10px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 800 }}>{title}</span>
            {note && <span style={{ fontSize: 11.5, color: t.ink2 }}>{note}</span>}
            <IconBtn title="Close" onClick={onClose} style={{ width: 32, height: 32 }}><X size={15} /></IconBtn>
          </div>
        </div>
        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '2px 14px 18px' }}>{children}</div>
      </div>
    </>
  );
}

/* the value at a point through the steps: a small line, the step on show marked; click a
   point to go to that step */
function Sparkline({ values, at, onPick, w = 268, h = 54 }) {
  const t = React.useContext(ThemeCtx);
  const fin = values.filter((v) => Number.isFinite(v));
  if (fin.length < 2) return null;
  const lo = Math.min(...fin), hi = Math.max(...fin), span = hi - lo || 1;
  const X = (i) => 4 + (i / Math.max(1, values.length - 1)) * (w - 8), Y = (v) => h - 5 - ((v - lo) / span) * (h - 10);
  let d = '', pen = false;
  values.forEach((v, i) => { if (Number.isFinite(v)) { d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; } else pen = false; });
  const pick = (e) => { const r = e.currentTarget.getBoundingClientRect(); onPick(Math.round(((e.clientX - r.left) / r.width * w - 4) / (w - 8) * (values.length - 1))); };
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} onClick={pick} style={{ display: 'block', cursor: 'pointer' }}>
      <path d={d} fill="none" stroke={t.light ? '#1f6fe0' : '#7cc8ff'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {Number.isFinite(values[at]) && <circle cx={X(at)} cy={Y(values[at])} r="4" fill="#ffd23f" stroke={t.light ? '#0f1722' : '#000'} strokeWidth="1" />}
      <line x1={X(at)} x2={X(at)} y1="2" y2={h - 2} stroke={t.line} strokeWidth="1" />
    </svg>
  );
}

export default function ModelData() {
  const [prefs] = useState(readPrefs);
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState(null);
  const [modelId, setModelId] = useState(prefs.modelId || 'ukv');
  const [runIso, setRunIso] = useState(null);
  const [varKey, setVarKey] = useState(prefs.varKey || 'precip_rate');
  const [status, setStatus] = useState(null);
  const [frames, setFrames] = useState({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(prefs.speed || 450);
  const [smooth, setSmooth] = useState(prefs.smooth ?? true);
  const [showContours, setShowContours] = useState(prefs.showContours ?? true);
  const [showCities, setShowCities] = useState(prefs.showCities ?? true);
  const [showStar, setShowStar] = useState(!!prefs.showStar);
  const [showRoads, setShowRoads] = useState(!!prefs.showRoads);
  const [showGrid, setShowGrid] = useState(!!prefs.showGrid);
  const [showArrows, setShowArrows] = useState(!!prefs.showArrows);
  /* sea-level pressure over any layer: isobars (every 2, 4 or 8 hPa), H and L, and the centres' pressures */
  const [msl, setMsl] = useState(() => ({ on: false, isobars: true, symbols: true, centres: true, every: 4, ...(prefs.msl || {}) }));
  const setMslK = (k, v) => setMsl((o) => ({ ...o, [k]: v }));
  const [showWx, setShowWx] = useState(!!prefs.showWx);
  const [showClouds, setShowClouds] = useState(!!prefs.showClouds);
  const [roadsBy, setRoadsBy] = useState({});                // each grid's road network
  const [obsDays, setObsDays] = useState(null);
  const [obsKey, setObsKey] = useState(OBS[prefs.obsKey] ? prefs.obsKey : 't2_max');
  const [obsSummary, setObsSummary] = useState({});
  const [obsStrikes, setObsStrikes] = useState({});
  const [obsPanel, setObsPanel] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1000);
  const [mode, setMode] = useState(MODES.includes(prefs.mode) ? prefs.mode : 'forecast');
  const [ensId, setEnsId] = useState('ecmwf_ens');
  const [ensRunIso, setEnsRunIso] = useState(null);
  const [presetKey, setPresetKey] = useState('gust');
  const [thr, setThr] = useState(50);
  const [dir, setDir] = useState('above');
  const isProb = mode === 'prob';
  const isLive = mode === 'live';
  const isObs = mode === 'observed';
  const obsItem = OBS[obsKey];
  const [liveKey, setLiveKey] = useState(LIVE[prefs.liveKey] ? prefs.liveKey : 'radar');
  const [liveCat, setLiveCat] = useState(null);
  const [strikes, setStrikes] = useState(null);
  const [showLightning, setShowLightning] = useState(prefs.showLightning ?? true);
  /* the strikes' look: coloured by age or one colour, with or without an outline */
  const [strikeStyle, setStrikeStyle] = useState(() => ({ ...STRIKE_STYLE, ...(prefs.strikeStyle || {}) }));
  const setStrikeK = (k, v) => setStrikeStyle((s) => ({ ...s, [k]: v }));
  /* the risk overlay: on, the source (a NOVA run or a saved outlook), over the day on show or a
     span of dates and times, simplified or detailed, and how strongly it is drawn */
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const [ov, setOv] = useState(() => ({ on: false, src: 'nova', run: null, span: 'day', from: '', to: '', look: 'smooth', outlook: null, alpha: 0.85, ...(prefs.ov || {}) }));
  const setOvK = (k, v) => setOv((o) => ({ ...o, [k]: v }));
  const [ovRuns, setOvRuns] = useState(null);       // the last 48 hours' runs
  const [ovRun, setOvRun] = useState(null);         // the chosen one's manifest
  const [ovAreas, setOvAreas] = useState({});       // London day (or 'custom') -> { peak, areas } or null
  const [ovOutlooks, setOvOutlooks] = useState(null);
  const [ovErr, setOvErr] = useState(null);
  const ovOn = isAdmin && ov.on;
  /* Met Office warnings over any layer: those in force at the time on show */
  const [wn, setWn] = useState(() => ({ on: false, look: 'fill', labels: true, alpha: 0.85, ...(prefs.wn || {}) }));
  const setWnK = (k, v) => setWn((o) => ({ ...o, [k]: v }));
  const [warnData, setWarnData] = useState(null);
  /* any layer over or under the main one, per view: { v, place: 'over' | 'under', alpha } */
  const [extrasBy, setExtrasBy] = useState(() => ({ forecast: [], prob: [], live: [], observed: [], ...(prefs.extras || {}) }));
  const [layerAlpha, setLayerAlpha] = useState(prefs.layerAlpha ?? 1);   // how strongly the main layer itself is drawn
  /* the layers' colours as designed, or pale: set here, during render, like the grid, so every draw
     below already uses them; put back when the page closes, as other pages use the same scales */
  const [palette, setPaletteChoice] = useState(prefs.palette === 'pale' ? 'pale' : 'normal');
  setPalette(palette);
  useEffect(() => () => setPalette('normal'), []);
  /* the second window: another run, model or layer at the same valid time, or the warnings */
  const [cmp, setCmp] = useState(() => ({ on: false, kind: 'run', model: null, v: null, split: 'auto', swap: false, ...(prefs.cmp || {}), run: null }));
  const setCmpK = (k, v) => setCmp((o) => ({ ...o, [k]: v }));
  const [cmpOpen, setCmpOpen] = useState(false);
  const [newRun, setNewRun] = useState(null);
  const liveItem = LIVE[liveKey];
  const liveProd = liveCat?.products?.[liveItem.src];
  const preset = PRESET[presetKey];
  /* the threshold as typed: kept as text while typing ('-', '1.'), applied whenever it is a number */
  const [thrText, setThrText] = useState('50');
  useEffect(() => { setThrText((t) => (parseFloat(t) === thr ? t : fmtThr(thr))); }, [thr]);
  const nudge = (k) => setThr((v) => Math.round((v + k * preset.step) * 1000) / 1000);
  const [style, setStyle] = useState(MAP_STYLES[prefs.style] ? prefs.style : 'dark');
  const T = THEMES[style === 'light' ? 'light' : 'dark'];
  const [frameKey, setFrameKey] = useState(FRAMES[prefs.frameKey] ? prefs.frameKey : 'screen');
  const [view, setView] = useState(null);
  const [interacting, setInteracting] = useState(false);        // the map is being dragged or zoomed
  const interactingRef = useRef(false);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState(null);
  const [imgs, setImgs] = useState({});
  const [staticsBy, setStaticsBy] = useState({});            // each grid's coastlines and places
  const [fontsOk, setFontsOk] = useState(0);
  const [varOpen, setVarOpen] = useState(false);
  const [q, setQ] = useState('');
  const [mapOpen, setMapOpen] = useState(false);              // the Layers panel
  const [regionsOpen, setRegionsOpen] = useState(false);
  const [pin, setPin] = useState(null);                     // a clicked point: its value through the steps
  /* The display grid: the UKV's 2 km grid for the UKV, live and observed; the wide 8 km grid of
     Europe, the Atlantic and North Africa for the global models and their ensembles. It is switched
     here, during render, so every lon/lat conversion and frame below already uses it; the view
     keeps the same place and map scale across a switch. */
  const gridName = isLive || isObs ? 'uk' : gridOfModel(isProb ? ensId : modelId);
  const gridRef = useRef(gridName);
  if (GRID.name !== gridName) setGrid(gridName);
  if (gridRef.current !== gridName) {
    const from = GRIDS[gridRef.current], to = GRIDS[gridName];
    gridRef.current = gridName;
    if (view) {
      const [lon, lat] = projection(from).fromGrid(view.cx, view.cy);
      const [cx, cy] = projection(to).toGrid(lon, lat);
      setView({ cx, cy, s: Math.max(0.3, Math.min(30, view.s * (to.dx / from.dx))) });
    }
    setPin(null);
  }
  const statics = staticsBy[gridName] || null;
  /* phone below 640 px wide, tablet to 1180 px, desktop beyond */
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1400 : window.innerWidth));
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const layout = vw < 640 ? 'phone' : vw < 1180 ? 'tablet' : 'desktop';
  const phone = layout === 'phone', narrow = layout !== 'desktop';
  const [modeOpen, setModeOpen] = useState(false);            // phones: the view menu
  const [exp, setExp] = useState({ open: false, png: 1080, gif: 720, video: 1080, fps: 60, smooth: true, from: 0, to: null, busy: null, job: null, err: null });
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, modelId, varKey, liveKey, obsKey, style, frameKey, speed, smooth, showContours,
        showCities, showStar, showRoads, showGrid, showArrows, showWx, showClouds, showLightning, strikeStyle, ov, msl, wn, cmp, extras: extrasBy, layerAlpha, palette }));
    } catch { /* private window: nothing to remember */ }
  }, [mode, modelId, varKey, liveKey, obsKey, style, frameKey, speed, smooth, showContours, showCities, showStar, showRoads, showGrid, showArrows, showWx, showClouds, showLightning, msl,
    strikeStyle, ov, wn, cmp, extrasBy, layerAlpha, palette]);

  /* the overlay's runs (the last 48 hours), the newest Main Run chosen unless one already is */
  useEffect(() => {
    if (!ovOn || ov.src !== 'nova' || ovRuns) return;
    novaRecentRuns(48).then((rs) => {
      setOvRuns(rs);
      if (!rs.length) { setOvErr('No TCM NOVA run in the last 48 hours.'); return; }
      if (!rs.some((r) => `${r.product}|${r.run_id}` === ov.run)) { const r = rs.find((x) => x.product === 'main') || rs[0]; setOvK('run', `${r.product}|${r.run_id}`); }
    }).catch((e) => setOvErr(e.message));
  }, [ovOn, ov.src, ovRuns]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ovOn || ov.src !== 'nova' || !ov.run) return undefined;
    let live = true;
    const [p, id] = ov.run.split('|');
    setOvRun(null); setOvErr(null);
    novaRun(p, id).then((m) => live && setOvRun(m)).catch((e) => live && setOvErr(e.message));
    return () => { live = false; };
  }, [ovOn, ov.src, ov.run]);
  /* its areas for every day it reaches (so stepping and exports across days have each day's), or
     for the span asked for */
  useEffect(() => {
    if (!ovRun) return undefined;
    let live = true;
    setOvAreas({}); setOvErr(null);
    const asOverlay = (r) => (r ? { peak: r.peak, areas: r.levels.flatMap((l) => l.areas.map((a) => ({ colour: l.colour, rings: [toGridRing(a.ring)] }))) } : null);
    (async () => {
      if (ov.span === 'custom') {
        const from = Date.parse(ov.from), to = Date.parse(ov.to);           // datetime-local: local time
        if (!(from < to)) { setOvErr('Choose a start and an end after it.'); return; }
        const r = await riskAreas(ovRun, { from, to }, ov.look);
        if (!live) return;
        setOvAreas({ custom: asOverlay(r) });
        if (!r) setOvErr('That span is outside this run.');
        return;
      }
      const days = [...new Set(ovRun.frames.filter((f) => f.valid).map((f) => londonDay(Date.parse(f.valid))))];
      for (const d of days) {
        const r = await riskAreas(ovRun, { day: d }, ov.look);
        if (!live) return;
        setOvAreas((o) => ({ ...o, [d]: asOverlay(r) }));
      }
    })().catch((e) => live && setOvErr(e.message));
    return () => { live = false; };
  }, [ovRun, ov.span, ov.from, ov.to, ov.look, gridName]);
  /* the outlooks saved in the Graphic Studio, newest first */
  useEffect(() => {
    if (!ovOn || ov.src !== 'outlook' || ovOutlooks) return;
    listStudioGraphics({ basic: false, me: null, keep: isOutlookState }).then((gs) => {
      setOvOutlooks(gs);
      if (gs.length && !gs.some((g) => g.id === ov.outlook)) setOvK('outlook', gs[0].id);
    }).catch((e) => setOvErr(e.message));
  }, [ovOn, ov.src, ovOutlooks]); // eslint-disable-line react-hooks/exhaustive-deps
  const outlookShown = useMemo(() => (ov.src === 'outlook' && ovOutlooks ? outlookOverlay(ovOutlooks.find((g) => g.id === ov.outlook)?.state) : null),
    [ov.src, ov.outlook, ovOutlooks, gridName]);   // eslint-disable-line react-hooks/exhaustive-deps -- remade on a grid switch
  /** the overlay for a frame's time: the outlook, the span, or that London day's */
  const riskFor = useCallback((validMs) => {
    if (!ovOn) return null;
    const areas = ov.src === 'outlook' ? outlookShown : (ov.span === 'custom' ? ovAreas.custom : ovAreas[londonDay(validMs)])?.areas;
    return areas?.length ? { alpha: ov.alpha, areas } : null;
  }, [ovOn, ov.src, ov.span, ov.alpha, outlookShown, ovAreas]);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const topRef = useRef(null);
  const botRef = useRef(null);
  const colourCache = useRef(new Map());
  const contourCache = useRef(new Map());
  const shellRef = useRef(null);
  const [shellH, setShellH] = useState('calc(100dvh - 56px)');
  const sidePanel = isObs && obsPanel && (layout === 'desktop' || (layout === 'tablet' && vw >= 1000));   // docked beside the frame

  useEffect(() => {
    const measure = () => {
      const top = shellRef.current?.getBoundingClientRect().top ?? 0;
      setShellH(`calc(100dvh - 56px - ${Math.max(0, Math.round(top + window.scrollY))}px)`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /* the graphic's typeface, so the canvas, the PNG and the GIF all use it */
  useEffect(() => {
    if (!document.getElementById('md-inter')) {
      const l = document.createElement('link');
      l.id = 'md-inter'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap';
      document.head.appendChild(l);
    }
    Promise.all(['400', '600', '700', '800'].map((w) => document.fonts.load(`${w} 20px Inter`))).then(() => setFontsOk((n) => n + 1)).catch(() => {});
  }, []);

  /* catalogue + static layers */
  useEffect(() => {
    let stop = false;
    const get = () => fetch(`${API}/catalog`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalogue ${r.status}`))))
      .then((c) => { if (!stop) { setCat(c); setErr(null); } })
      .catch((e) => { if (!stop) { setErr(e.message); setTimeout(get, 15000); } });
    get();
    const t = setInterval(get, 2 * 60 * 1000);           // a new run shows up here within minutes of reaching AWS
    return () => { stop = true; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!isLive) return undefined;
    let stop = false;
    const get = () => {
      fetch(`${API}/live/catalog`).then((r) => (r.ok ? r.json() : null)).then((c) => !stop && c && setLiveCat(c)).catch(() => {});
      fetch(`${API}/live/lightning`).then((r) => (r.ok ? r.json() : null)).then((c) => !stop && c && setStrikes(c.strikes || [])).catch(() => {});
    };
    get();
    const t = setInterval(get, 60 * 1000);
    return () => { stop = true; clearInterval(t); };
  }, [isLive]);

  /* observed: the archive's days, and each day's summary (extremes, stations, lightning) */
  useEffect(() => {
    if (!isObs) return undefined;
    let stop = false;
    const get = () => fetch(`${API}/observed/days`).then((r) => r.json()).then((j) => !stop && setObsDays([...(j.days || [])].sort())).catch(() => {});
    get();
    const t = setInterval(get, 5 * 60 * 1000);
    return () => { stop = true; clearInterval(t); };
  }, [isObs]);

  /* observed: the day's lightning strikes, when the lightning layer is on */
  const obsDayShown = isObs && obsDays?.length ? obsDays[Math.min(idx, obsDays.length - 1)] : null;
  useEffect(() => {
    if (!obsDayShown || !showLightning || obsStrikes[obsDayShown]) return;
    fetch(`${API}/observed/${obsDayShown}/strikes.json`).then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setObsStrikes((o) => ({ ...o, [obsDayShown]: (j.strikes || []).map((s) => [s[1], s[2]]) }))).catch(() => {});
  }, [obsDayShown, showLightning, obsStrikes]);

  const liveRun = useMemo(() => (liveProd?.times?.length
    ? { run: liveProd.times[liveProd.times.length - 1], steps: liveProd.times.map((t) => Date.parse(t)) } : null), [liveProd]);
  const obsRun = useMemo(() => (obsDays?.length ? { run: obsDays[obsDays.length - 1], steps: obsDays.map(dayMs) } : null), [obsDays]);
  const timeSteps = isLive || isObs;                       // steps are times (ms), not forecast hours
  const hasObsDays = !!obsDays?.length;
  const liveSource = liveProd?.source;
  const model = useMemo(() => (isObs ? (hasObsDays ? { id: 'observed', label: 'Observed', runs: [] } : null)
    : isLive ? (liveSource ? { id: 'live', label: liveSource, runs: [] } : null)
    : isProb ? cat?.ensembles?.find((m) => m.id === ensId) : cat?.models?.find((m) => m.id === modelId)),
  [isObs, hasObsDays, isLive, liveSource, isProb, cat, ensId, modelId]);
  const curRunIso = isProb ? ensRunIso : runIso;
  const run = isObs ? obsRun : isLive ? liveRun : model?.runs?.find((r) => r.run === curRunIso) || (model?.runs?.length ? defaultRun(model) : null);
  const fieldKey = isProb ? preset.field : varKey;
  const fmeta = isProb ? cat?.ens_fields?.[preset.field] : null;
  const vmeta = useMemo(() => (isObs ? { label: obsItem.label, unit: obsItem.unit }
    : isLive ? { label: liveItem.label, unit: RADARS.has(liveItem.src) ? 'mm/h' : NOW_UNITS[liveItem.src] ?? '' }
    : isProb
      ? { label: `Chance of ${preset.label.toLowerCase()} ${dir === 'below' ? '≤' : '≥'} ${fmtThr(thr)}${fmeta?.unit ? ` ${fmeta.unit}` : ''}`, unit: '%', group: preset.group }
      : cat?.variables?.[varKey]), [isObs, obsItem, isLive, liveItem, isProb, preset, dir, thr, fmeta, cat, varKey]);
  const scaleKey = isObs ? obsItem.scale : isLive ? (liveItem.scale || (liveItem.src === 'radar' ? 'radar' : liveKey)) : isProb ? 'prob' : varKey;

  useEffect(() => {
    if (timeSteps) return;
    if (!isProb && model && !model.variables.includes(varKey)) setVarKey(model.variables.includes('precip_rate') ? 'precip_rate' : model.variables[0]);
    if (isProb && model && !model.fields.includes(preset.field)) {
      const p = PRESETS.find((x) => model.fields.includes(x.field));
      if (p) { setPresetKey(p.key); setThr(p.thr); setDir(p.dir); }
    }
  }, [isProb, model, varKey, preset, timeSteps]);
  useEffect(() => {
    if (!cat) return;
    const ok = (list, id) => list?.some((m) => m.id === id && m.runs?.length);
    if (!ok(cat.models, modelId)) { const m = cat.models?.find((x) => x.runs?.length); if (m) setModelId(m.id); }
    if (!ok(cat.ensembles, ensId)) { const m = cat.ensembles?.find((x) => x.runs?.length); if (m) setEnsId(m.id); }
  }, [cat, modelId, ensId]);
  const lastRunOf = useRef({});
  useEffect(() => {
    if (timeSteps || !model || !run || curRunIso) return;
    const prev = lastRunOf.current[model.id];
    lastRunOf.current[model.id] = run.run;
    if (prev && prev !== run.run && Date.parse(run.run) > Date.parse(prev)) {
      setNewRun(`New ${SHORT_NAMES[model.id] || model.label} run · ${runLabel(run.run)}`);
      const t = setTimeout(() => setNewRun(null), 9000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [timeSteps, model, run, curRunIso]);
  const choosePreset = (k) => { const p = PRESET[k]; setPresetKey(k); setThr(p.thr); setDir(p.dir); };

  /* frames for this model / run / variable (made on demand on the server) */
  const key = !timeSteps && run && model ? `${model.id}/${runTag(run.run)}/${fieldKey}` : null;
  /* switching variable, model or run keeps the same valid time: remember it before the
     switch, then land on that time (or the nearest the new run has) once its steps are known */
  const lastValid = useRef(null);
  const targetValid = useRef(null);
  const wantStep = useRef(0);
  useEffect(() => {
    targetValid.current = lastValid.current;
  }, [key]);
  useEffect(() => {
    if (!key) return undefined;
    const [m, rt, v] = key.split('/');
    const ac = new AbortController();
    const want = new Set();
    let alive = true;
    if (targetValid.current != null) wantStep.current = Math.max(0, Math.round((targetValid.current - Date.parse(run.run)) / 3600e3));
    setFrames({}); setStatus(null); colourCache.current.clear(); contourCache.current.clear();
    const pull = async (step) => {
      want.add(step);
      try {
        const f = await loadFrame(m, rt, v, step, ac.signal);
        if (alive) setFrames((o) => ({ ...o, [step]: f }));
      } catch { want.delete(step); }
    };
    const poll = async () => {
      if (!alive) return;
      try {
        const st = await fetch(`${API}/frames/${m}/${rt}/${v}/status?first=${Math.max(0, wantStep.current)}`, { signal: ac.signal }).then((r) => r.json());
        if (!alive) return;
        setStatus(st);
        /* the frame being looked at first, then outwards from it, eight at a time */
        const todo = (st.done || []).filter((s) => !want.has(s)).sort((a, b) => Math.abs(a - wantStep.current) - Math.abs(b - wantStep.current));
        const batch = todo.slice(0, 8);
        await Promise.all(batch.map(pull));
        if (st.state !== 'complete' || todo.length > batch.length) setTimeout(poll, todo.length > batch.length ? 0 : 600);
      } catch { if (alive) setTimeout(poll, 2000); }
    };
    poll();
    return () => { alive = false; ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);                                              // the key names the run; run.run is read with it

  const liveSrc = isLive ? liveItem.src : null;
  const liveWant = useRef(new Set());
  useEffect(() => { liveWant.current = new Set(); setFrames({}); if (liveSrc) setStatus(null); colourCache.current.clear(); }, [liveSrc]);
  useEffect(() => {
    if (!isLive || !liveProd?.times?.length || !liveProd.ext) return undefined;
    const ac = new AbortController();
    let alive = true;
    const times = liveProd.times;
    const at = wantStep.current && times.some((t) => Date.parse(t) === wantStep.current) ? wantStep.current : Date.parse(times[times.length - 1]);
    const todo = times.filter((t) => !liveWant.current.has(t)).sort((a, b) => Math.abs(Date.parse(a) - at) - Math.abs(Date.parse(b) - at));
    (async () => {
      for (let i = 0; i < todo.length && alive; i += 6) {
        await Promise.all(todo.slice(i, i + 6).map(async (t) => {
          liveWant.current.add(t);
          try {
            const f = await loadLive(liveItem.src, t, liveProd.ext, ac.signal);
            if (alive) setFrames((o) => ({ ...o, [Date.parse(t)]: f }));
          } catch { liveWant.current.delete(t); }
        }));
      }
    })();
    return () => { alive = false; ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveSrc, liveProd]);

  /* observed: the chosen field for each day, the day on screen first; today's is refetched
     as it fills in, past days are fixed */
  const obsTick = useRef(0);
  const [obsRefresh, setObsRefresh] = useState(0);
  useEffect(() => {
    if (!isObs) return undefined;
    const t = setInterval(() => setObsRefresh((n) => n + 1), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [isObs]);
  useEffect(() => { if (isObs) { setFrames({}); colourCache.current.clear(); } }, [isObs, obsKey]);
  useEffect(() => {
    if (!isObs || !obsDays?.length) return undefined;
    const ac = new AbortController();
    let alive = true;
    const tick = ++obsTick.current;
    const at = wantStep.current && obsDays.some((d) => dayMs(d) === wantStep.current) ? wantStep.current : dayMs(obsDays[obsDays.length - 1]);
    const order = [...obsDays].sort((a, b) => Math.abs(dayMs(a) - at) - Math.abs(dayMs(b) - at));
    (async () => {
      for (let i = 0; i < order.length && alive; i += 4) {
        await Promise.all(order.slice(i, i + 4).map(async (d) => {
          try {
            const [f, s] = await Promise.all([loadObserved(d, obsKey, ac.signal),
              fetch(`${API}/observed/${d}/summary.json`, { signal: ac.signal }).then((r) => (r.ok ? r.json() : null))]);
            if (!alive || tick !== obsTick.current) return;
            f.head.valid = `${d}T12:00:00Z`;
            setFrames((o) => ({ ...o, [dayMs(d)]: f }));
            if (s) setObsSummary((o) => ({ ...o, [d]: s }));
          } catch { /* that day has no such field yet */ }
        }));
      }
    })();
    return () => { alive = false; ac.abort(); };
  }, [isObs, obsKey, obsDays, obsRefresh]);

  const steps = useMemo(() => {
    if (!run) return [];
    const miss = new Set((key && status?.missing) || []);
    return run.steps.filter((s) => !miss.has(s));
  }, [run, status, key]);
  const step = steps[Math.min(idx, Math.max(0, steps.length - 1))];
  const frame = frames[step];
  const loadedCount = steps.filter((s) => frames[s]).length;
  const validMs = !run || step == null ? null : timeSteps ? step : Date.parse(run.run) + step * 3600e3;

  /* The second window. Forecast and Probability can set any model, run or layer beside the first (a
     chance keeps the first window's threshold); any view can have the warnings. It follows the first
     window's time, so two runs are always compared at one valid time; a run with no step at that
     exact time shows its nearest and says so. */
  const kindB = cmp.on && model ? (timeSteps ? 'warnings' : cmp.kind) : null;
  const optionsB = isProb ? cat?.ensembles : cat?.models;
  const modelB = kindB === 'run' ? optionsB?.find((m) => m.id === cmp.model && m.runs?.length) || model : null;
  const runB = !modelB ? null : modelB.runs.find((r) => r.run === cmp.run) || runBeside(modelB, model, run);
  const varB = !modelB || isProb ? null : cmp.v && modelB.variables.includes(cmp.v) ? cmp.v
    : modelB.variables.includes(varKey) ? varKey : modelB.variables.includes('precip_rate') ? 'precip_rate' : modelB.variables[0];
  const fieldB = isProb ? preset.field : varB;
  const scaleB = isProb ? 'prob' : varB;
  const gridB = modelB ? gridOfModel(modelB.id) : gridName;
  const wantStepB = useRef(0);
  const dataB = useRunFrames(modelB, runB, fieldB, wantStepB, !!modelB);
  const framesB = dataB?.frames || EMPTY, statusB = dataB?.status || null;
  const stepsB = useMemo(() => {
    if (!runB) return [];
    const miss = new Set(statusB?.missing || []);
    return runB.steps.filter((x) => !miss.has(x));
  }, [runB, statusB]);
  const runMsB = runB ? Date.parse(runB.run) : 0;
  const stepB = runB && validMs != null ? nearestStep(stepsB, runMsB, validMs) : null;
  useEffect(() => { if (stepB != null) wantStepB.current = stepB; }, [stepB]);
  /* the second window's frame at a time: with `between`, part-way along if it falls between two steps */
  const frameBAt = useCallback((ms, between) => {
    if (!runB) return null;
    if (between) {
      for (let i = 0; i + 1 < stepsB.length; i++) {
        const ta = runMsB + stepsB[i] * 3600e3, tb = runMsB + stepsB[i + 1] * 3600e3;
        if (ms < ta || ms > tb) continue;
        const a = framesB[stepsB[i]], b = framesB[stepsB[i + 1]];
        if (!a || !b) break;
        const t = (ms - ta) / (tb - ta);
        return t <= 0 ? a : t >= 1 ? b : tweenRaw(a, b, t, ms);
      }
    }
    const k = nearestStep(stepsB, runMsB, ms);
    return k == null ? null : framesB[k] || null;
  }, [runB, runMsB, stepsB, framesB]);
  /* the nearest step that has arrived stands in until this one does, so playing never blinks */
  const frameB = useMemo(() => {
    if (stepB == null) return null;
    if (framesB[stepB]) return framesB[stepB];
    let best = null;
    for (const k of Object.keys(framesB)) if (best == null || Math.abs(k - stepB) < Math.abs(best - stepB)) best = Number(k);
    return best == null ? null : framesB[best];
  }, [framesB, stepB]);
  const spanMs = steps.length > 1 && validMs != null ? [steps[Math.min(exp.from, steps.length - 1)], steps[exp.to ?? steps.length - 1]].map((x) => (timeSteps ? x : Date.parse(run.run) + x * 3600e3)) : null;
  const pendingB = !modelB || !spanMs ? 0 : stepsB.filter((x) => { const t = runMsB + x * 3600e3; return t >= spanMs[0] - 3 * 3600e3 && t <= spanMs[1] + 3 * 3600e3 && !framesB[x]; }).length;

  /* the grids on show: their coastlines, places and basemap images, loaded once each */
  const gridsInUse = useMemo(() => [...new Set([gridName, gridB])], [gridName, gridB]);
  useEffect(() => {
    let stop = false;
    for (const g of gridsInUse) {
      if (staticsBy[g]) continue;
      const layers = () => Promise.all([fetch(staticUrl('lines.json', g)).then((r) => r.json()), fetch(staticUrl('cities.json', g)).then((r) => r.json()),
        loadImage('/logo.png').catch(() => null)])
        .then(([lines, cities, logo]) => !stop && setStaticsBy((o) => ({ ...o, [g]: { lines, cities, logo } })))
        .catch(() => { if (!stop) setTimeout(layers, 5000); });
      layers();
    }
    return () => { stop = true; };
  }, [gridsInUse, staticsBy]);
  useEffect(() => {
    const need = style === 'realtime' ? ['sat_day.jpg', 'night_lights.png'] : [MAP_STYLES[style].base];
    for (const g of gridsInUse) {
      need.forEach((f) => {
        const k = `${g}/${f}`, url = staticUrl(f, g);
        if (!imgs[k]) loadImage(url).then((im) => setImgs((o) => ({ ...o, [k]: im })))
          .catch(() => { delete imgCache[url]; setTimeout(() => setImgs((o) => ({ ...o })), 5000); });
      });
    }
  }, [style, imgs, gridsInUse]);
  useEffect(() => {
    if (!showRoads) return;
    for (const g of gridsInUse) if (!roadsBy[g]) loadRoads(g).then((r) => setRoadsBy((o) => (o[g] ? o : { ...o, [g]: r }))).catch(() => setShowRoads(false));
  }, [showRoads, roadsBy, gridsInUse]);

  /* the warnings: fetched while on, refreshed as the Met Office changes them */
  const wantWarn = wn.on || kindB === 'warnings';
  useEffect(() => {
    if (!wantWarn) return undefined;
    let stop = false;
    const get = () => fetch(`${API}/warnings`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!stop && j) setWarnData(j); }).catch(() => {});
    get();
    const t = setInterval(get, 5 * 60 * 1000);
    return () => { stop = true; clearInterval(t); };
  }, [wantWarn]);
  /* on each grid once, least severe first so the worst is drawn on top */
  const warnShapes = useRef({ of: null, by: {} });
  const warnMemo = useRef(new Map());
  const shapesOn = useCallback((grid) => {
    const m = warnShapes.current;
    if (m.of !== warnData) { m.of = warnData; m.by = {}; warnMemo.current.clear(); }
    if (!m.by[grid]) {
      const P = projection(grid);
      m.by[grid] = (warnData?.warnings || []).map((w) => warningOnGrid(w, P)).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
    }
    return m.by[grid];
  }, [warnData]);
  /* those in force at a time (a whole day, for an observed day), the same list for the same warnings
     so the map only redraws them when they change. In a smooth export (`fade`, ms) they ease on over
     that long before they begin and off after they end, so they never pop, and at every moment they
     are in force they are at full strength */
  const warningsAt = useCallback((ms, grid, wholeDay, fade = 0) => {
    const from = wholeDay ? ms - 12 * 3600e3 : ms, to = wholeDay ? ms + 12 * 3600e3 : ms;
    if (fade) {
      return shapesOn(grid).filter((w) => w.fromMs - fade <= to && w.toMs + fade > from)
        .map((w) => ({ ...w, fade: Math.max(0, Math.min(1, 1 + (ms - w.fromMs) / fade, 1 + (w.toMs - ms) / fade)) }));
    }
    const list = shapesOn(grid).filter((w) => w.fromMs <= to && w.toMs > from);
    const key = `${grid}|${list.map((w) => w.id).join()}`;
    if (!warnMemo.current.has(key)) warnMemo.current.set(key, list);
    return warnMemo.current.get(key);
  }, [shapesOn]);
  const atLatest = useRef(true);
  useEffect(() => {
    if (!timeSteps || !steps.length) return;
    const goLatest = atLatest.current;                   // read now: the updater runs after the next effects
    setIdx((i) => (goLatest ? steps.length - 1 : Math.min(i, steps.length - 1)));
  }, [timeSteps, steps]);
  useEffect(() => { if (timeSteps) atLatest.current = idx >= steps.length - 1; }, [timeSteps, idx, steps.length]);
  useEffect(() => { if (timeSteps) atLatest.current = true; }, [timeSteps, liveSrc]);
  useEffect(() => {
    if (timeSteps || !run || !steps.length) return;
    if (targetValid.current == null) { setIdx((i) => Math.min(i, steps.length - 1)); return; }
    const runMs = Date.parse(run.run);
    let best = 0;
    steps.forEach((s, i) => {
      if (Math.abs(runMs + s * 3600e3 - targetValid.current) < Math.abs(runMs + steps[best] * 3600e3 - targetValid.current)) best = i;
    });
    setIdx(best);
    if (status) targetValid.current = null;              // settled once the run's real steps are known
  }, [timeSteps, steps, run, status]);
  useEffect(() => {
    if (timeSteps) { wantStep.current = step; if (step != null && isLive) lastValid.current = step; return; }
    if (run && step != null && targetValid.current == null) { lastValid.current = Date.parse(run.run) + step * 3600e3; wantStep.current = step; }
  }, [timeSteps, isLive, run, step]);

  /* canvas follows the stage; the frame sits between the top and bottom bars */
  useEffect(() => {
    const el = stageRef.current, c = canvasRef.current;
    if (!el || !c) return undefined;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
      if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
      setSize((n) => n + 1);
    });
    ro.observe(el);
    if (topRef.current) ro.observe(topRef.current);
    if (botRef.current) ro.observe(botRef.current);
    return () => ro.disconnect();
  }, [layout]);                                             // the bars are different elements per layout

  const frameRect = useCallback(() => {
    const c = canvasRef.current, st = stageRef.current;
    if (!c || !st) return null;
    const dpr = c.width / Math.max(1, st.clientWidth);
    const m = 12 * dpr;
    const top = ((topRef.current?.offsetHeight || 0) + 10) * dpr + m;
    const bot = ((botRef.current?.offsetHeight || 0) + 10) * dpr + m;
    const side = sidePanel ? (OBS_PANEL_W + 20) * dpr : 0;           // the observed panel docks on the left
    const safe = { x: m + side, y: top, w: c.width - 2 * m - side, h: Math.max(80, c.height - top - bot) };
    const a = FRAMES[frameKey].a;
    if (!a) return safe;
    const w = Math.min(safe.w, safe.h * a), h = w / a;
    return { x: safe.x + (safe.w - w) / 2, y: safe.y + (safe.h - h) / 2, w, h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, size, sidePanel]);

  /* the two windows in a frame: side by side, or stacked where the frame is tall */
  const splitOf = useCallback((R) => splitFrame(R, cmp.split === 'auto' ? (R.w / R.h >= 0.9 ? 'cols' : 'rows') : cmp.split, Math.min(R.w, R.h) / 1080), [cmp.split]);
  /* where each window is: `a` the first, `b` the second (none with one window) */
  const windowRects = useCallback(() => {
    const R = frameRect();
    if (!R) return null;
    if (!kindB) return { R, a: R, b: null, sp: null };
    const sp = splitOf(R);
    return { R, sp, a: cmp.swap ? sp.b : sp.a, b: cmp.swap ? sp.a : sp.b };
  }, [frameRect, kindB, splitOf, cmp.swap]);

  /* fit a grid box into the frame; `tight` fills it (a re-framing), otherwise leaves room
     for the title card and the key */
  const fit = useCallback((box, tight) => {
    const R = windowRects()?.a;
    if (!R) return;
    const [x0, y0, x1, y1] = box;
    const s = Math.min(R.w / (x1 - x0), (R.h * (tight ? 1 : 0.8)) / (y1 - y0));
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (tight ? 0 : (R.h * 0.02) / s), s });
  }, [windowRects]);
  useEffect(() => { if (!view && size) fit(REGIONS.uk.box); }, [size, view, fit]);
  /* a new frame shape (or the side panel opening) keeps the same area in view */
  const lastRect = useRef(null);
  useEffect(() => {
    const R = windowRects()?.a;
    const old = lastRect.current;
    lastRect.current = R ? { ...R, two: !!kindB } : null;
    if (!view || !R || !old || (old.w === R.w && old.h === R.h)) return;
    /* going to or from two windows keeps the map's middle and about the same amount of map: the
       UK is tall, so it sits well in half a square at a little under the old scale */
    if (old.two !== !!kindB) {
      setView({ ...view, s: Math.max(0.3, Math.min(30, view.s * Math.sqrt((R.w * R.h) / (old.w * old.h)))) });
      return;
    }
    const hw = old.w / 2 / view.s, hh = old.h / 2 / view.s;
    fit([view.cx - hw, view.cy - hh, view.cx + hw, view.cy + hh], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, sidePanel, layout, !!kindB, cmp.split]);
  /* the stage settling or being resized is not a new shape to keep the view through, only news of
     how big the frame is (the canvas has no real size at all when the page first draws) */
  useEffect(() => {
    const R = windowRects()?.a;
    if (R) lastRect.current = { ...R, two: !!kindB };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const basemapFor = useCallback((f, grid = gridName, ms = null) => {
    if (style === 'realtime') {
      const d = imgs[`${grid}/sat_day.jpg`], n = imgs[`${grid}/night_lights.png`];
      const at = f ? Date.parse(f.head.valid) : ms;
      return d && n && at != null ? realtimeBasemap(d, n, at) : d || null;
    }
    return imgs[`${grid}/${MAP_STYLES[style].base}`] || null;
  }, [style, imgs, gridName]);

  const disp = useCallback((f) => (isProb && f ? probFrame(f, thr, dir) : f), [isProb, thr, dir]);
  /* strikes in the hour up to a frame's time, with their age in minutes */
  const strikesMemo = useRef({ ms: null, of: null, out: null });
  const strikesAt = useCallback((ms) => {
    const m = strikesMemo.current;
    if (m.ms === ms && m.of === strikes) return m.out;
    const out = [];
    for (const [t, gx, gy] of strikes || []) if (t <= ms && t > ms - 3600e3) out.push([gx, gy, (ms - t) / 60e3]);
    out.sort((a, b) => b[2] - a[2]);
    strikesMemo.current = { ms, of: strikes, out };
    return out;
  }, [strikes]);
  /* companions: wind arrows, weather symbols and cloud, from the same run (forecast) or the
     nearest time (live) */
  const fcModel = !timeSteps && !isProb ? model : null;
  const isForecast = !timeSteps && !isProb;
  const hasVar = (v) => !!model?.variables?.includes(v);
  const isImg = isLive && liveItem.src.startsWith('sat_');
  const selfArrows = isForecast && (varKey === 'wdir10' || varKey === 'mwd');       // the layer IS a direction
  const ownArrows = selfArrows || (isLive && liveKey === 'now_wind10');
  const ownWx = (isForecast && varKey === 'wx') || (isLive && liveKey === 'now_wx');
  const canArrows = ownArrows || isLive || (isForecast && hasVar('wdir10'));
  const canWx = ownWx || isLive || (isForecast && hasVar('wx'));
  const canClouds = isLive ? RADARS.has(liveItem.src) : isForecast && hasVar('tcc') && RAINY.has(varKey);
  const canGrid = !isImg && !selfArrows;
  const canStar = !isImg && !['wx', 'ptype', 'radar_type', 'wdir10', 'mwd'].includes(scaleKey) && !(isLive && liveKey === 'now_wx');
  /* MSLP as the layer itself: its lines, highs and lows are the pressure overlay's, under its switches */
  const ownMsl = (isForecast && varKey === 'mslp') || (isLive && liveKey === 'now_mslp');
  const canMsl = ownMsl || (isForecast && hasVar('mslp')) || (isLive && !isImg);
  const mslOn = ownMsl || (msl.on && canMsl);
  const canContours = !isImg && !!scaleFor(scaleKey).contours && !ownMsl;
  const canLightning = isLive || isObs;
  const arrowsOn = ownArrows || (showArrows && canArrows);
  const wxOn = ownWx || (showWx && canWx);
  const cloudsOn = showClouds && canClouds;
  const fcArrows = useCompanion(fcModel, run, 'wdir10', wantStep, arrowsOn && !selfArrows);
  const fcWx = useCompanion(fcModel, run, 'wx', wantStep, wxOn && !ownWx);
  const fcCloud = useCompanion(fcModel, run, 'tcc', wantStep, cloudsOn);
  const fcMsl = useCompanion(fcModel, run, 'mslp', wantStep, mslOn && !ownMsl && isForecast);
  /* a direction has no colours of its own: what it moves goes underneath (wave height, wind speed) */
  const underVar = selfArrows ? (varKey === 'mwd' ? 'swh' : 'wind10') : null;
  const underMeta = underVar && hasVar(underVar) ? cat?.variables?.[underVar] : null;
  const fcUnder = useCompanion(fcModel, run, underVar, wantStep, !!underMeta);
  const lvArrows = useLiveCompanion(liveCat, 'now_wdir10', isLive && arrowsOn);
  const lvWx = useLiveCompanion(liveCat, 'now_wx', isLive && wxOn && liveKey !== 'now_wx');
  const lvCloud = useLiveCompanion(liveCat, 'sat_ir', isLive && cloudsOn);
  const lvMsl = useLiveCompanion(liveCat, 'now_mslp', isLive && mslOn && !ownMsl);
  /* the second window takes the same switches, for what its own model and layer have */
  const fcB = isForecast && kindB === 'run' ? modelB : null;
  const hasB = (v) => !!fcB?.variables?.includes(v);
  const selfArrowsB = !!fcB && (varB === 'wdir10' || varB === 'mwd');
  const ownWxB = !!fcB && varB === 'wx';
  const ownMslB = !!fcB && varB === 'mslp';
  const arrowsOnB = selfArrowsB || (showArrows && hasB('wdir10'));
  const wxOnB = ownWxB || (showWx && hasB('wx'));
  const cloudsOnB = showClouds && hasB('tcc') && RAINY.has(varB);
  const mslOnB = ownMslB || (msl.on && hasB('mslp'));
  const fcArrowsB = useCompanion(fcB, runB, 'wdir10', wantStepB, arrowsOnB && !selfArrowsB);
  const fcWxB = useCompanion(fcB, runB, 'wx', wantStepB, wxOnB && !ownWxB);
  const fcCloudB = useCompanion(fcB, runB, 'tcc', wantStepB, cloudsOnB);
  const fcMslB = useCompanion(fcB, runB, 'mslp', wantStepB, mslOnB && !ownMslB);
  const underVarB = selfArrowsB ? (varB === 'mwd' ? 'swh' : 'wind10') : null;
  const underMetaB = underVarB && hasB(underVarB) ? cat?.variables?.[underVarB] : null;
  const fcUnderB = useCompanion(fcB, runB, underVarB, wantStepB, !!underMetaB);

  /* Layers laid over or under the main one, from the same run or the same live or observed record. A
     fixed number of slots, as hooks must be. A chance is a preset at its usual threshold. The second
     window lays the same layers over its own run, where its model has them. */
  const extras = extrasBy[mode] || [];
  const setExtraK = (i, k, v) => setExtrasBy((o) => ({ ...o, [mode]: o[mode].map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const dropExtra = (i) => setExtrasBy((o) => ({ ...o, [mode]: o[mode].filter((x, j) => j !== i) }));
  const addExtra = (v) => setExtrasBy((o) => (o[mode].length >= MAX_EXTRA ? o : { ...o, [mode]: [...o[mode], { v, place: coversMap(extraScale(v)) ? 'under' : 'over', alpha: coversMap(extraScale(v)) ? 1 : 0.8 }] }));
  /* the field behind a layer's name in each view, its colours, and what its key says */
  const extraField = (v) => (isProb ? PRESET[v]?.field : isLive ? LIVE[v]?.src : v);
  const extraScale = (v) => (isObs ? OBS[v]?.scale : isLive ? LIVE[v]?.scale || (LIVE[v]?.src === 'radar' ? 'radar' : v) : isProb ? 'prob' : v);
  const extraMeta = (v) => (isObs ? { label: OBS[v]?.label, unit: OBS[v]?.unit }
    : isLive ? { label: LIVE[v]?.label, unit: RADARS.has(LIVE[v]?.src) ? 'mm/h' : NOW_UNITS[LIVE[v]?.src] ?? '' }
    : isProb ? { label: `Chance of ${(PRESET[v]?.label || '').toLowerCase()} ${PRESET[v]?.dir === 'below' ? '≤' : '≥'} ${fmtThr(PRESET[v]?.thr ?? 0)}${cat?.ens_fields?.[PRESET[v]?.field]?.unit ? ` ${cat.ens_fields[PRESET[v].field].unit}` : ''}`, unit: '%' }
    : cat?.variables?.[v] || { label: v, unit: '' });
  const useModelExtra = (m, r, i, want) => useRunFrames(!timeSteps ? m : null, r, extras[i] ? extraField(extras[i].v) : null, want, !!extras[i]);
  const x0 = useModelExtra(model, run, 0, wantStep), x1 = useModelExtra(model, run, 1, wantStep), x2 = useModelExtra(model, run, 2, wantStep);
  const y0 = useRunFrames(!timeSteps ? modelB : null, runB, extras[0] ? extraField(extras[0].v) : null, wantStepB, !!extras[0]);
  const y1 = useRunFrames(!timeSteps ? modelB : null, runB, extras[1] ? extraField(extras[1].v) : null, wantStepB, !!extras[1]);
  const y2 = useRunFrames(!timeSteps ? modelB : null, runB, extras[2] ? extraField(extras[2].v) : null, wantStepB, !!extras[2]);
  const lv0 = useLiveCompanion(liveCat, isLive && extras[0] ? LIVE[extras[0].v]?.src : null, true);
  const lv1 = useLiveCompanion(liveCat, isLive && extras[1] ? LIVE[extras[1].v]?.src : null, true);
  const lv2 = useLiveCompanion(liveCat, isLive && extras[2] ? LIVE[extras[2].v]?.src : null, true);
  const ob0 = useObservedCompanion(isObs ? obsDays : null, isObs && extras[0] ? extras[0].v : null);
  const ob1 = useObservedCompanion(isObs ? obsDays : null, isObs && extras[1] ? extras[1].v : null);
  const ob2 = useObservedCompanion(isObs ? obsDays : null, isObs && extras[2] ? extras[2].v : null);
  const extraCaches = useRef([new Map(), new Map(), new Map(), new Map(), new Map(), new Map()]);
  /* a window's extras: what to read, how, and how to draw it */
  const extraLayers = useCallback((maps, slot) => extras.map((x, i) => {
    const p = isProb ? PRESET[x.v] : null;
    return { ...x, map: maps[i]?.frames ?? maps[i], status: maps[i]?.status, byTime: timeSteps, scale: extraScale(x.v), meta: extraMeta(x.v), cache: extraCaches.current[slot + i],
      prep: p ? (f) => (f ? probFrame(f, p.thr, p.dir) : f) : (f) => f };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [extras, isProb, timeSteps, isLive, isObs, cat]);
  const stackA = useMemo(() => extraLayers(timeSteps ? (isLive ? [lv0, lv1, lv2] : [ob0, ob1, ob2]) : [x0, x1, x2], 0), [extraLayers, timeSteps, isLive, lv0, lv1, lv2, ob0, ob1, ob2, x0, x1, x2]);
  const stackB = useMemo(() => (kindB === 'run' ? extraLayers([y0, y1, y2], 3) : []), [extraLayers, kindB, y0, y1, y2]);
  /* frames of the extras still to come for an export */
  const pendingX = stackA.reduce((n, x) => n + (x.status && x.status.state !== 'complete' ? 1 : 0), 0);
  const pressureCache = useRef(new Map());
  const centreCache = useRef(new Map());
  /* contour lines, isobars and highs and lows are worked out in a worker (lib/modelViewer): when
     the one on screen is ready the map redraws, at most once a frame */
  const [calcTick, setCalcTick] = useState(0);
  const bumpRaf = useRef(0);
  const bump = useCallback(() => {
    if (bumpRaf.current) return;
    bumpRaf.current = requestAnimationFrame(() => { bumpRaf.current = 0; setCalcTick((n) => n + 1); });
  }, []);
  const smoothCache = useRef(new Map());
  const overlayCache = useRef(new Map());
  /* where the live and observed layers are from (a forecast's key names its model and run) */
  const credit = !model || !timeSteps ? '' : isObs
    ? (['precip_total', 'rain_rate_max'].includes(obsKey) ? 'Met Office radar via AWS' : 'UKV analysis + METAR station reports')
    : (liveItem.src === 'radar' ? 'Met Office radar via AWS' : liveItem.src === 'radar_type' ? 'Met Office radar via AWS · type from UKV + METAR' : liveItem.src.startsWith('now_') ? 'UKV + METAR + Met Office radar' : liveProd?.source?.startsWith('Meteosat') ? `${liveProd.source} · EUMETSAT` : 'EUMETSAT');
  const chromeFor = useCallback((f) => (f && model && vmeta ? {
    variable: underMeta ? `${vmeta.label} · colours: ${underMeta.label.toLowerCase()}` : vmeta.label, unit: underMeta ? underMeta.unit : vmeta.unit,
    valid: f.head.valid, logo: statics?.logo, ...(timeSteps ? { credit } : creditOf(model, run, f.head.step)),
    scale: underMeta ? scaleFor(underVar) : (isLive && liveItem.src.startsWith('sat_')) || ['wdir10', 'mwd'].includes(scaleKey) ? {} : scaleFor(scaleKey),
    dayOnly: isObs,
  } : null), [model, vmeta, run, scaleKey, statics, credit, isLive, isObs, liveItem, timeSteps, underMeta, underVar]);
  const metaB = !modelB ? null : isProb ? vmeta : cat?.variables?.[varB];
  /* the second window's: with nothing to show at this time, the time and a word saying why */
  const chromeForB = useCallback((f, ms) => {
    if (!modelB || !metaB || ms == null) return null;
    const lacks = !(modelB.variables || modelB.fields)?.includes(fieldB);
    const notice = lacks ? `${SHORT_NAMES[modelB.id] || modelB.label} has no ${(isProb ? preset.label : metaB.label).toLowerCase()}` : f ? null
      : stepsB.length && nearestStep(stepsB, runMsB, ms) == null ? `The ${runLabel(runB.run)} run does not cover this time` : 'Fetching from AWS…';
    return {
      variable: underMetaB ? `${metaB.label} · colours: ${underMetaB.label.toLowerCase()}` : metaB.label, unit: underMetaB ? underMetaB.unit : metaB.unit,
      valid: f ? f.head.valid : new Date(ms).toISOString(), logo: staticsBy[gridB]?.logo, ...creditOf(modelB, runB, f?.head.step), notice,
      scale: underMetaB ? scaleFor(underVarB) : ['wdir10', 'mwd'].includes(scaleB) ? {} : scaleFor(scaleB),
    };
  }, [modelB, metaB, runB, runMsB, stepsB, fieldB, scaleB, isProb, preset, underMetaB, underVarB, staticsBy, gridB]);

  /* what each window draws: its layer, what it has switched on, and the companions it can read them from */
  const cachesA = useMemo(() => ({ colour: colourCache.current, contour: contourCache.current, smooth: smoothCache.current, overlay: overlayCache.current,
    pressure: pressureCache.current, centre: centreCache.current }), []);
  const cachesB = useMemo(() => ({ colour: new Map(), contour: new Map(), smooth: new Map(), overlay: new Map(), pressure: new Map(), centre: new Map() }), []);
  const paneA = useMemo(() => ({ grid: gridName, scaleKey, meta: vmeta, resKm: model?.res_km, live: isLive, caches: cachesA, chrome: chromeFor,
    arrowsOn, selfArrows, wxOn, ownWx, cloudsOn, mslOn, ownMsl, canGrid, canStar, canContours, underMeta, underVar,
    arrows: isLive ? lvArrows : fcArrows, wx: isLive ? lvWx : fcWx, cloud: isLive ? lvCloud : fcCloud, msl: isLive ? lvMsl : fcMsl, under: fcUnder, stack: stackA }),
  [gridName, scaleKey, vmeta, model, isLive, cachesA, chromeFor, arrowsOn, selfArrows, wxOn, ownWx, cloudsOn, mslOn, ownMsl, canGrid, canStar, canContours, underMeta, underVar,
    lvArrows, fcArrows, lvWx, fcWx, lvCloud, fcCloud, lvMsl, fcMsl, fcUnder, stackA]);
  const paneB = useMemo(() => ({ grid: gridB, scaleKey: scaleB, meta: metaB, resKm: modelB?.res_km, live: false, caches: cachesB, chrome: chromeForB,
    arrowsOn: arrowsOnB, selfArrows: selfArrowsB, wxOn: wxOnB, ownWx: ownWxB, cloudsOn: cloudsOnB, mslOn: mslOnB, ownMsl: ownMslB, canGrid: !selfArrowsB,
    canStar: !['wx', 'ptype', 'wdir10', 'mwd'].includes(scaleB), canContours: !!scaleB && !!scaleFor(scaleB).contours && !ownMslB, underMeta: underMetaB, underVar: underVarB,
    arrows: fcArrowsB, wx: fcWxB, cloud: fcCloudB, msl: fcMslB, under: fcUnderB, stack: stackB }),
  [gridB, scaleB, metaB, modelB, cachesB, chromeForB, arrowsOnB, selfArrowsB, wxOnB, ownWxB, cloudsOnB, mslOnB, ownMslB, underMetaB, underVarB, fcArrowsB, fcWxB, fcCloudB, fcMslB, fcUnderB, stackB]);

  /* The layers of one frame of one window; `sync` (exports: true, or 'smooth') works the sums out at
     once instead of in the worker, `ms` is the time for a window with no frame yet. A frame part-way between two steps
     (raw.tween) is worked out here, its companion layers with it, and all that follows draws it as
     it would any frame. */
  const layersFor = useCallback((P, raw, sync = false, ms = null) => {
    const tw = raw?.tween, C = P.caches, st = staticsBy[P.grid];
    const f = tw ? tweenFrame(disp(tw.a), disp(tw.b), tw.t, P.scaleKey, cellBox(disp(tw.a), tw.box)) : disp(raw);
    const later = sync ? undefined : { onReady: bump };
    const sc = scaleFor(P.scaleKey);
    const comp = (map, key, tol) => {
      if (!map || !raw) return null;
      const a = companionOf(map, tw ? tw.a : raw, P.live, tol);
      if (!tw) return a;
      const b = companionOf(map, tw.b, P.live, tol);
      return a && b ? tweenFrame(a, b, tw.t, key, cellBox(a, tw.box)) : a || b;
    };
    /* the layers laid over and under this one, each at its own strength; a whole-map layer is drawn
       see-through on the maps worth seeing, so what is under it shows */
    const veil = (key) => (coversMap(key) ? SEE_THROUGH[style] ?? 1 : 1);
    const stacked = P.stack.flatMap((x) => {
      if (!raw) return [];
      const a = x.prep(extraFrameOf(x.map, tw ? tw.a : raw, x.byTime));
      const b = tw ? x.prep(extraFrameOf(x.map, tw.b, x.byTime)) : null;
      const fr = tw && a && b ? tweenFrame(a, b, tw.t, x.scale, cellBox(a, tw.box)) : a || b;
      const canvas = fieldLayer(fr, x.scale, smooth, x.cache, x.cache, RAINY.has(x.scale));
      return canvas ? [{ canvas, alpha: x.alpha * (x.place === 'over' ? veil(x.scale) : 1), place: x.place, key: { variable: x.meta.label, unit: x.meta.unit, credit: x.place === 'over' ? 'Laid over' : 'Laid under', scale: NO_COLOURS.has(x.scale) ? {} : scaleFor(x.scale) } }] : [];
    });
    const shown = P.chrome(raw, ms);
    /* satellite pictures over a map: the Satellite and Real-time maps show through their dark parts */
    const picture = !!f?.img || !!f?.mix?.a?.img;
    const onEarth = picture && SEE_THROUGH[style] != null && P.scaleKey !== 'sat_clouds';
    const arrowsF = !P.arrowsOn || !raw ? null : P.selfArrows ? f : comp(P.arrows, 'wdir10', 16);
    const wxF = !P.wxOn || !raw ? null : P.ownWx ? f : comp(P.wx, 'wx', 16);
    const underF = P.underMeta && raw ? comp(P.under, P.underVar) : null;
    const cloudF = P.cloudsOn && raw ? comp(P.cloud, P.live ? 'sat_clouds' : 'tcc', 60) : null;   // satellite runs ~30-40 min behind the radar
    const mslF = !P.mslOn || !raw ? null : P.ownMsl ? f : comp(P.msl, 'mslp', 30);
    const at = raw ? Date.parse(raw.head.valid) : ms;
    const day = isObs && raw ? dayOf(at) : null;
    const ext = day ? obsSummary[day]?.fields?.[obsKey] : null;
    return {
      style, basemap: basemapFor(raw, P.grid, ms), lines: st?.lines, cities: showCities || wxF ? st?.cities : null,
      data: underF ? fieldLayer(underF, P.underVar, smooth, C.colour, C.smooth, false) : fieldLayer(f, P.scaleKey, smooth, C.colour, C.smooth, RAINY.has(P.scaleKey)), smooth,
      dataAlpha: layerAlpha * veil(underF ? P.underVar : P.scaleKey) * (coversMap(P.scaleKey) && !picture && stacked.some((x) => x.place === 'under') ? 0.7 : 1), dataBlend: onEarth ? 'screen' : null,
      under: stacked.filter((x) => x.place === 'under'), over: stacked.filter((x) => x.place === 'over'),
      overlay: cloudF ? { canvas: fieldLayer(cloudF, P.live ? 'sat_clouds' : 'tcc', true, C.overlay, C.overlay, false), alpha: P.live ? 0.92 : 0.7 } : null,
      roads: showRoads ? roadsBy[P.grid] || null : null,
      grid: showGrid && P.canGrid && f?.q ? { frame: f, varKey: P.scaleKey, unit: P.meta?.unit } : null,
      arrows: arrowsF ? { frame: arrowsF } : null,
      wx: wxF ? { frame: wxF, utcMs: at } : null,
      contours: f && showContours && P.canContours ? frameContours(f, P.scaleKey, P.resKm, C.contour, later) : null,
      contourLabels: true, chrome: shown && stacked.length ? { ...shown, extras: stacked.map((x) => x.key) } : shown,
      star: isObs && showStar && ext?.value != null ? { at: { gx: ext.gx, gy: ext.gy, v: ext.value, place: ext.place }, unit: P.meta?.unit }
        : showStar && P.canStar && f?.q && !isObs ? { frame: f, unit: P.meta?.unit, floor: sc.floor } : null,
      strikes: !showLightning || !raw ? null : isLive ? (strikes ? strikesAt(at) : null) : isObs ? obsStrikes[day] || null : null,
      strikesDaily: isObs, strikeStyle,
      risk: raw && P.grid === gridName ? riskFor(at) : null,              // its shapes are made for the first window's grid
      warnings: wn.on && at != null ? { alpha: wn.alpha, look: wn.look, labels: wn.labels, areas: warningsAt(at, P.grid, isObs, sync === 'smooth' ? WARN_FADE : 0) } : null,
      pressure: mslF ? {
        lines: msl.isobars ? pressureLines(mslF, msl.every, P.resKm, C.pressure, later) : null,
        list: msl.symbols || msl.centres ? pressureCentres(mslF, C.centre, later) : null, symbols: msl.symbols, centres: msl.centres,
      } : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp, style, basemapFor, staticsBy, showCities, smooth, showContours, fontsOk, showStar, isObs, isLive, showLightning, strikes, showRoads, roadsBy, showGrid, obsSummary, obsKey,
    obsStrikes, strikeStyle, riskFor, gridName, wn, warningsAt, msl, bump, calcTick, layerAlpha, palette]);
  useEffect(() => { colourCache.current.clear(); contourCache.current.clear(); smoothCache.current.clear(); }, [thr, dir, scaleKey]);
  useEffect(() => { Object.values(cachesB).forEach((m) => m.clear()); }, [cachesB, dataB?.key, thr, dir, scaleB]);

  /* a window of the Met Office warnings alone, in force at a time, with their list in the key */
  const warningLayers = useCallback((raw, ms, sync) => {
    const st = staticsBy[gridName];
    const areas = ms == null ? [] : warningsAt(ms, gridName, isObs, sync === 'smooth' ? WARN_FADE : 0);
    return {
      style, basemap: basemapFor(raw, gridName, ms), lines: st?.lines, cities: showCities ? st?.cities : null, roads: showRoads ? roadsBy[gridName] || null : null, smooth,
      warnings: { alpha: 1, look: 'fill', labels: true, areas },
      chrome: ms == null ? null : { variable: 'Met Office warnings', valid: new Date(ms).toISOString(), logo: st?.logo, dayOnly: isObs, credit: isObs ? 'In force that day' : 'In force at this time',
        warnList: warnData ? areas.filter((w) => (w.fade ?? 1) > 0.5).reverse().map((w) => ({ severity: w.severity, type: w.text, when: warnWhen(w) })) : [], notice: warnData ? null : 'Loading the warnings…' },
    };
  }, [staticsBy, gridName, warningsAt, isObs, style, basemapFor, showCities, showRoads, roadsBy, smooth, warnData]);
  /* The two windows of a frame, at the time of the first window's frame `raw`: `mode` is false on
     screen, 'exact' for an export of the steps as they are, 'smooth' for one with frames between. The
     two share one time card and one logo: left and right or both on the top window, and the other
     window shows a time of its own only if a run has no step at that time. */
  const windowsFor = useCallback((raw, R, V, mode) => {
    const sp = splitOf(R), sync = mode;
    const vB = viewOnGrid(V, gridName, gridB);
    const ms = raw ? Date.parse(raw.head.valid) : validMs;
    const ra = cmp.swap ? sp.b : sp.a, rb = cmp.swap ? sp.a : sp.b;
    const within = (f, rect, v) => { if (f?.tween) f.tween.box = boxOf(rect, v); return f; };
    const LA = layersFor(paneA, within(raw, ra, V), sync);
    const LB = withGrid(gridB, () => (kindB === 'warnings' ? warningLayers(raw, ms, sync)
      : layersFor(paneB, within(mode ? frameBAt(ms, mode === 'smooth') : frameB, rb, vB), sync, ms)));
    const differ = !!LA.chrome && !!LB.chrome && Math.abs(Date.parse(LA.chrome.valid) - Date.parse(LB.chrome.valid)) > 60e3;
    const rows = sp.split === 'rows';
    const mark = (L, time, brand) => (L.chrome ? { ...L, chrome: { ...L.chrome, time, brand } } : L);
    const a = { view: V, grid: gridName }, b = { view: vB, grid: gridB };
    const slots = cmp.swap ? [{ ...b, L: LB }, { ...a, L: LA }] : [{ ...a, L: LA }, { ...b, L: LB }];
    return {
      u: Math.min(R.w, R.h) / 1080, line: sp.line, split: sp.split,
      panes: [{ ...slots[0], rect: sp.a, L: mark(slots[0].L, true, rows) }, { ...slots[1], rect: sp.b, L: mark(slots[1].L, differ, !rows) }],
    };
  }, [splitOf, gridName, gridB, validMs, cmp.swap, layersFor, paneA, paneB, kindB, warningLayers, frameBAt, frameB]);

  /* the contour lines and isobars, highs and lows of the steps ahead (and just behind), worked
     out in the worker while this one is looked at, so stepping and playback find them ready */
  useEffect(() => {
    const lines = showContours && canContours;
    if ((!lines && !mslOn) || !steps.length || exp.busy != null) return undefined;
    const t = setTimeout(() => {
      const ahead = { urgent: false };
      for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, -1, -2]) {
        const raw = frames[steps[(idx + k + steps.length) % steps.length]];
        if (!raw) continue;
        const f = disp(raw);
        if (lines && f) frameContours(f, scaleKey, model?.res_km, contourCache.current, ahead);
        const mslF = !mslOn ? null : ownMsl ? raw : companionOf(isLive ? lvMsl : fcMsl, raw, isLive, 30);
        if (mslF && msl.isobars) pressureLines(mslF, msl.every, model?.res_km, pressureCache.current, ahead);
        if (mslF && (msl.symbols || msl.centres)) pressureCentres(mslF, centreCache.current, ahead);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [idx, steps, frames, disp, showContours, canContours, mslOn, ownMsl, msl, isLive, lvMsl, fcMsl, scaleKey, model, exp.busy]);
  useEffect(() => {
    const lines = showContours && paneB.canContours;
    if (kindB !== 'run' || (!lines && !mslOnB) || stepB == null || exp.busy != null) return undefined;
    const t = setTimeout(() => withGrid(gridB, () => {
      const ahead = { urgent: false }, at = stepsB.indexOf(stepB), n = stepsB.length;
      for (const k of [1, 2, 3, 4, 5, 6, 7, 8, -1]) {
        const raw = framesB[stepsB[(at + k + n) % n]];
        if (!raw) continue;
        const f = disp(raw);
        if (lines && f) frameContours(f, scaleB, modelB?.res_km, cachesB.contour, ahead);
        const mslF = !mslOnB ? null : ownMslB ? raw : companionOf(fcMslB, raw, false);
        if (mslF && msl.isobars) pressureLines(mslF, msl.every, modelB?.res_km, cachesB.pressure, ahead);
        if (mslF && (msl.symbols || msl.centres)) pressureCentres(mslF, cachesB.centre, ahead);
      }
    }), 200);
    return () => clearTimeout(t);
  }, [kindB, stepB, stepsB, framesB, disp, showContours, paneB, mslOnB, ownMslB, fcMslB, msl, gridB, scaleB, modelB, cachesB, exp.busy]);

  /* draw: the map everywhere, dimmed outside the frame, the finished graphic inside it */
  useEffect(() => {
    const c = canvasRef.current, R = frameRect();
    if (!c || !view || !R) return;
    const ctx = c.getContext('2d');
    const full = { x: 0, y: 0, w: c.width, h: c.height };
    const S = kindB ? windowsFor(frame, R, view, false) : null;
    const L = S ? null : layersFor(paneA, frame);
    ctx.clearRect(0, 0, c.width, c.height);
    // the dimmed map around the frame: map, data and coastlines only (the overlays are for the
    // graphic itself, and drawing them twice doubled the cost of every pan)
    const plain = { chrome: null, cities: null, contours: null, roads: null, grid: null, arrows: null, wx: null, star: null,
      pressure: null, risk: null, warnings: null, strikes: null, under: null, over: null, interacting };
    if (S) {
      /* each window's map runs on beyond the frame on its own side of the line */
      const cut = S.split === 'rows' ? S.line.y : S.line.x;
      S.panes.forEach((p, i) => {
        const clip = S.split === 'rows' ? { x: 0, y: i ? cut : 0, w: c.width, h: i ? c.height - cut : cut } : { x: i ? cut : 0, y: 0, w: i ? c.width - cut : cut, h: c.height };
        withGrid(p.grid, () => drawScene(ctx, p.rect, p.view, { ...p.L, ...plain }, { clip, coarse: true, cache: true, u: S.u }));
      });
    } else drawScene(ctx, R, view, { ...L, ...plain }, { clip: full, coarse: true, cache: true });
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,12,0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    const r = 18 * (c.width / Math.max(1, stageRef.current.clientWidth));
    ctx.roundRect ? ctx.roundRect(R.x, R.y, R.w, R.h, r) : ctx.rect(R.x, R.y, R.w, R.h);
    ctx.fill('evenodd');
    ctx.restore();
    if (S) drawPanes(ctx, R, S, { round: r, cache: true, interacting });
    else drawScene(ctx, R, view, { ...L, interacting }, { round: r, cache: true });
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, r) : ctx.rect(R.x, R.y, R.w, R.h);
    ctx.stroke();
    if (pin) {
      const dpr = c.width / Math.max(1, stageRef.current.clientWidth);
      for (const p of S ? S.panes : [{ rect: R, view, grid: gridName }]) {
        const [gx, gy] = p.grid === gridName ? [pin.gx, pin.gy] : projection(p.grid).toGrid(...projection(gridName).fromGrid(pin.gx, pin.gy));
        const px = (gx - p.view.cx) * p.view.s + p.rect.x + p.rect.w / 2, py = (gy - p.view.cy) * p.view.s + p.rect.y + p.rect.h / 2;
        if (px < p.rect.x || py < p.rect.y || px > p.rect.x + p.rect.w || py > p.rect.y + p.rect.h) continue;
        ctx.beginPath(); ctx.arc(px, py, 9 * dpr, 0, Math.PI * 2);
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
        ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, 2.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#ffd23f'; ctx.fill();
      }
    }
    ctx.restore();
  }, [view, frame, layersFor, paneA, windowsFor, kindB, gridName, frameRect, interacting, pin]);

  /* playback */
  useEffect(() => {
    if (!playing || steps.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => {
      const n = (i + 1) % steps.length;
      return frames[steps[n]] ? n : i;
    }), speed);
    return () => clearInterval(t);
  }, [playing, steps, frames, speed]);

  /* keyboard: left/right step, Home/End, space plays, + and - zoom, Esc closes panels */
  const keyRef = useRef({});
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.target?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      const { n, zoomBy: z } = keyRef.current;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); setPlaying(false);
        setIdx((i) => Math.max(0, Math.min(n - 1, i + (e.key === 'ArrowRight' ? 1 : -1))));
      } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setPlaying(false); setIdx(e.key === 'Home' ? 0 : Math.max(0, n - 1)); }
      else if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === '+' || e.key === '=') z?.(1.35);
      else if (e.key === '-' || e.key === '_') z?.(1 / 1.35);
      else if (e.key === 'Escape') { setPin(null); setVarOpen(false); setMapOpen(false); setCmpOpen(false); setRegionsOpen(false); setModeOpen(false); setExp((x) => ({ ...x, open: false })); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* zoom, pan, pinch, hover. While the map moves, heavy layers (roads) are moved as a picture
     and redrawn properly ~0.2 s after it stops. */
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const settle = useRef(null);
  const poke = () => {
    if (!interactingRef.current) { interactingRef.current = true; setInteracting(true); }
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { interactingRef.current = false; setInteracting(false); }, 180);
  };
  /* a point on the canvas in the window it is over. Both windows pan and zoom as one: their views
     are the same but for the grid, so gx and gy hold for either as a place to zoom around */
  const toGrid = (clientX, clientY) => {
    const c = canvasRef.current, rr = c.getBoundingClientRect(), Wn = windowRects();
    const dpr = c.width / rr.width;
    const px = (clientX - rr.left) * dpr, py = (clientY - rr.top) * dpr;
    const second = !!Wn.sp && (Wn.sp.split === 'rows' ? py >= Wn.sp.line.y : px >= Wn.sp.line.x) !== !!cmp.swap;
    const R = second ? Wn.b : Wn.a;
    return { px, py, R, second, gx: (px - (R.x + R.w / 2)) / view.s + view.cx, gy: (py - (R.y + R.h / 2)) / view.s + view.cy };
  };
  /* that point on the second window's own grid */
  const onGridB = ({ px, py, R }) => {
    const v = viewOnGrid(view, gridName, gridB);
    return [(px - (R.x + R.w / 2)) / v.s + v.cx, (py - (R.y + R.h / 2)) / v.s + v.cy];
  };
  /* the worst warning over a point, at the time on show */
  const warningOver = (grid, gx, gy) => {
    if (validMs == null) return null;
    const list = warningsAt(validMs, grid, isObs);
    for (let i = list.length - 1; i >= 0; i--) if (pointInRings(gx, gy, list[i].rings)) return list[i];
    return null;
  };
  const zoomAt = (clientX, clientY, k) => {
    if (!view) return;
    poke();
    const { px, py, R, gx, gy } = toGrid(clientX, clientY);
    const s = Math.max(0.3, Math.min(30, view.s * k));
    setView({ s, cx: gx - (px - (R.x + R.w / 2)) / s, cy: gy - (py - (R.y + R.h / 2)) / s });
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18); };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  });
  const pressAt = useRef(null);
  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressAt.current = pointers.current.size ? null : { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = pts.length === 2
      ? { pinch: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), v: view }
      : { x: e.clientX, y: e.clientY, v: view };
  };
  const onMove = (e) => {
    if (!view) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const dpr = canvasRef.current.width / canvasRef.current.getBoundingClientRect().width;
    if (pressAt.current && Math.hypot(e.clientX - pressAt.current.x, e.clientY - pressAt.current.y) >= 5) pressAt.current = null;
    if (g && pointers.current.size === 2 && g.pinch) {
      poke();
      const pts = [...pointers.current.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setView({ ...g.v, s: Math.max(0.3, Math.min(30, g.v.s * (d / g.pinch))) });
      return;
    }
    if (g && pointers.current.size === 1 && !g.pinch) {
      poke();
      setView({ ...g.v, cx: g.v.cx - ((e.clientX - g.x) * dpr) / g.v.s, cy: g.v.cy - ((e.clientY - g.y) * dpr) / g.v.s });
      return;
    }
    const at = toGrid(e.clientX, e.clientY);
    const r = e.currentTarget.getBoundingClientRect();
    const spot = { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
    const [gx, gy] = at.second ? onGridB(at) : [at.gx, at.gy];
    const w = (wn.on || (at.second && kindB === 'warnings')) ? warningOver(at.second ? gridB : gridName, gx, gy) : null;
    const warn = w ? `${w.severity} warning · ${w.text}` : null;
    if (at.second && kindB === 'warnings') { setHover(warn ? { ...spot, text: warn } : null); return; }
    const v = at.second ? withGrid(gridB, () => sampleFrame(disp(frameB), gx, gy)) : sampleFrame(disp(frame), gx, gy);
    if (!Number.isFinite(v) && !warn) { setHover(null); return; }
    setHover({ ...spot, text: Number.isFinite(v) ? (at.second ? fmtPoint(v, scaleB, metaB) : fmtPoint(v)) : warn, warn: Number.isFinite(v) ? warn : null });
  };
  const onUp = (e) => {
    const p = pressAt.current;
    if (p && e.type === 'pointerup' && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5 && view) {
      const at = toGrid(e.clientX, e.clientY);
      /* a click in the second window is the same place, wherever it is on the first window's grid */
      const [gx, gy] = at.second && gridB !== gridName ? projection(gridName).toGrid(...projection(gridB).fromGrid(...onGridB(at))) : [at.gx, at.gy];
      if (gx >= 0 && gy >= 0 && gx < NX && gy < NY) setPin({ gx, gy });
    }
    pressAt.current = null;
    pointers.current.delete(e.pointerId);
    gesture.current = null;
  };
  const zoomBy = (k) => { const r = canvasRef.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, k); };
  keyRef.current = { n: steps.length, zoomBy };

  /* exports: the frame, enlarged (short side = chosen size) */
  const exportSize = (short) => {
    const R = frameRect();
    const a = R.w / R.h;
    return a >= 1 ? [Math.round(short * a / 2) * 2, short] : [short, Math.round(short / a / 2) * 2];
  };
  /* one frame of the graphic, at an export's size; the page's own grid, whatever has been clicked since */
  const renderAt = useCallback((f, ctx, W, H, mode = 'exact') => withGrid(gridName, () => {
    const R = frameRect();
    const v = { cx: view.cx, cy: view.cy, s: view.s * (W / R.w) };
    const out = { x: 0, y: 0, w: W, h: H };
    if (kindB) { drawPanes(ctx, out, windowsFor(f, out, v, mode)); return; }
    if (f?.tween) f.tween.box = boxOf(out, v);
    drawScene(ctx, out, v, layersFor(paneA, f, mode));
  }), [view, layersFor, paneA, windowsFor, kindB, frameRect, gridName]);
  const stamp = (s) => (isObs ? dayOf(s) : isLive ? new Date(s).toISOString().slice(0, 16).replace(/[-:]/g, '') : `T${s}`);
  const secondName = () => (!kindB ? '' : kindB === 'warnings' ? '_with_warnings' : `_vs_${modelB.id}_${runTag(runB.run)}${isProb || varB === varKey ? '' : `_${varB}`}`);
  const fileBase = () => (isObs ? `MyWeatherUK_observed_${obsKey}${secondName()}_${frameKey}` : isLive ? `MyWeatherUK_live_${liveKey}${secondName()}_${frameKey}`
    : `MyWeatherUK_${model.id}_${runTag(run.run)}_${isProb ? `${presetKey}_${dir}${fmtThr(thr)}` : varKey}${secondName()}_${frameKey}`);
  const exportPng = () => {
    if (!frame) return;
    const [W, H] = exportSize(exp.png);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    renderAt(frame, cv.getContext('2d'), W, H);
    cv.toBlob((b) => download(b, `${fileBase()}_${stamp(step)}.png`), 'image/png');
  };
  if (import.meta.env.DEV) window.__mdExport = (short = 1080) => { const [W, H] = exportSize(short); const cv = document.createElement('canvas'); cv.width = W; cv.height = H; renderAt(frame, cv.getContext('2d'), W, H); return cv.toDataURL('image/jpeg', 0.85); };
  const gifCancel = useRef(false);
  /* The frames of a GIF or video: each step for `speed` ms, as it is or, smooth, moving on to the next
     all the way through at the file's frame rate. It ends on a short rest. A GIF goes round and round,
     so a smooth one dissolves from its last frame back to its first. */
  const motionPlan = (job, list) => {
    const fps = job === 'gif' ? GIF_FPS : exp.fps, tick = 1000 / fps;
    const smoothly = exp.smooth && list.length > 1;
    const per = Math.max(1, Math.round(speed / tick));
    const plan = [];
    for (let i = 0; i + 1 < list.length; i++) {
      if (job === 'gif' && !smoothly) { plan.push({ i, t: 0, delay: speed }); continue; }
      for (let k = 0; k < per; k++) plan.push({ i, t: smoothly ? k / per : 0, same: !smoothly && k > 0, delay: tick });
    }
    const end = list.length - 1;
    if (job === 'gif') {
      plan.push({ i: end, t: 0, delay: Math.max(speed, 900) });
      if (smoothly) for (let k = 1; k < per; k++) plan.push({ fade: k / per, delay: tick });
    } else for (let k = 0; k < fps; k++) plan.push({ i: end, t: 0, same: k > 0, delay: tick });
    return { plan, fps, smoothly };
  };
  const motionFrames = (job) => {
    const lo = exp.from, hi = exp.to ?? steps.length - 1;
    return steps.slice(lo, hi + 1).filter((s) => frames[s]);
  };
  /* `keep` (tests) hands the file back instead of saving it */
  const exportMotion = async (job, keep) => {
    const list = motionFrames(job);
    if (!list.length) return null;
    const { plan, fps, smoothly } = motionPlan(job, list);
    const [W, H] = exportSize(job === 'gif' ? exp.gif : exp.video);
    const mode = smoothly ? 'smooth' : 'exact';
    const rawOf = (p) => {
      const a = frames[list[p.i]];
      if (!p.t) return a;
      const b = frames[list[p.i + 1]], ta = Date.parse(a.head.valid);
      return tweenRaw(a, b, p.t, ta + (Date.parse(b.head.valid) - ta) * p.t);
    };
    /* the last frame and the first, kept for the dissolve from one to the other */
    const ends = [];
    const end = (i, p) => {
      if (ends[i]) return ends[i];
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      renderAt(rawOf(p), cv.getContext('2d'), W, H, mode);
      ends[i] = cv;
      return cv;
    };
    const render = (i, ctx) => {
      const p = plan[i];
      if (p.fade == null) { renderAt(rawOf(p), ctx, W, H, mode); return; }
      ctx.globalAlpha = 1;
      ctx.drawImage(end(0, { i: list.length - 1, t: 0 }), 0, 0);
      ctx.globalAlpha = p.fade;
      ctx.drawImage(end(1, { i: 0, t: 0 }), 0, 0);
      ctx.globalAlpha = 1;
    };
    gifCancel.current = false;
    setExp((e) => ({ ...e, busy: 0, job, err: null }));
    try {
      const blob = await (job === 'gif' ? makeGif : makeVideo)({
        count: plan.length, W, H, fps, render, cancelled: () => gifCancel.current,
        delayOf: (i) => plan[i].delay, same: (i) => !!plan[i].same,
        onProgress: (p) => { const q = Math.round(p * 100) / 100; setExp((e) => (e.busy === q ? e : { ...e, busy: q })); },
      });
      if (blob && !keep) download(blob, `${fileBase()}_${stamp(list[0])}-${stamp(list[list.length - 1])}.${job === 'gif' ? 'gif' : 'mp4'}`);
      return blob;
    } catch (e) {
      setExp((x) => ({ ...x, err: e.message }));
      return null;
    } finally {
      setExp((e) => ({ ...e, busy: null }));
    }
  };
  if (import.meta.env.DEV) window.__mdMotion = exportMotion;

  const groups = useMemo(() => {
    if (!model || !cat) return [];
    const g = {};
    const qq = q.trim().toLowerCase();
    if (isObs) {
      for (const it of OBS_LIST) {
        if (!qq || it.label.toLowerCase().includes(qq) || it.group.toLowerCase().includes(qq)) (g[it.group] ||= []).push([it.key, it]);
      }
      return Object.entries(g);
    }
    if (isLive) {
      for (const it of LIVE_LIST) {
        if (!qq || it.label.toLowerCase().includes(qq) || it.group.toLowerCase().includes(qq)) (g[it.group] ||= []).push([it.key, it]);
      }
      return Object.entries(g);
    }
    if (isProb) {
      for (const pr of PRESETS) {
        if (model.fields.includes(pr.field) && (!qq || pr.label.toLowerCase().includes(qq) || pr.group.toLowerCase().includes(qq))) (g[pr.group] ||= []).push([pr.key, pr]);
      }
      return Object.entries(g);
    }
    for (const k of model.variables) {
      const v = cat.variables[k];
      if (v && (!qq || v.label.toLowerCase().includes(qq) || v.group.toLowerCase().includes(qq))) (g[v.group] ||= []).push([k, v]);
    }
    return GROUP_ORDER.filter((n) => g[n]).map((n) => [n, g[n]]);
  }, [model, cat, q, isProb, isLive, isObs]);
  const pending = key && status && status.state !== 'complete' ? Math.max(0, steps.length - loadedCount) : 0;
  /* a new set of steps starts the export range afresh */
  useEffect(() => { setExp((e) => (e.from || e.to != null ? { ...e, from: 0, to: null } : e)); }, [mode, key, liveSrc, obsKey]);
  const sel = { ...T.glass, appearance: 'none', borderRadius: 999, padding: '7px 30px 7px 12px', fontSize: 12.5, fontWeight: 600, fontFamily: FONT, cursor: 'pointer', color: T.ink, background: T.track, boxShadow: T.trackShadow };
  /* loading notices: under the top bar, or (phones and tablets, where that is the title card) above the bottom bar */
  const noticePos = narrow ? { bottom: (botRef.current?.offsetHeight || 56) + 18 } : { top: (topRef.current?.offsetHeight || 46) + 18 };
  const topH = (topRef.current?.offsetHeight || 46) + 18, botH = (botRef.current?.offsetHeight || 56) + 18;
  const validLabel = !frame ? '' : isObs
    ? new Date(frame.head.valid).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : new Date(frame.head.valid).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const subLabel = step == null ? '' : isObs ? 'observed day' : isLive ? `${Math.max(0, Math.round((Date.now() - step) / 60e3))} min ago` : `T+${step}`;
  const stepLabel = (s) => (isObs ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : isLive ? new Date(s).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : `T+${s}`);

  /* one value, as this layer reads: a weather type, a direction, or a number with its unit */
  const fmtPoint = (v, sk = scaleKey, meta = vmeta) => (!Number.isFinite(v) ? '—' : sk === 'wx' ? WX_NAMES[Math.round(v)] ?? '—'
    : sk === 'ptype' || sk === 'radar_type' ? (() => { const t = radarTypeOf(v); return t ? `${RADAR_FAMILIES[t.family].name} · ${fmtValue(t.rate, 'mm/h')}` : 'Dry'; })()
    : sk === 'wdir10' || sk === 'mwd' ? `from the ${compass(v)} · ${Math.round(v)}°` : fmtValue(v, meta?.unit));

  /* panels: on a phone one at a time, as sheets from the bottom; elsewhere as cards */
  const panelOpen = { data: varOpen, layers: mapOpen, compare: cmpOpen, regions: regionsOpen, export: exp.open, summary: obsPanel && !sidePanel, mode: modeOpen };
  const closePanels = () => {
    setVarOpen(false); setMapOpen(false); setCmpOpen(false); setRegionsOpen(false); setModeOpen(false);
    setExp((e) => (e.open ? { ...e, open: false } : e));
    if (!sidePanel) setObsPanel(false);
  };
  const openPanel = (name) => {
    const was = panelOpen[name];
    closePanels();
    if (was) return;
    if (name === 'data') { setQ(''); setVarOpen(true); }
    if (name === 'layers') setMapOpen(true);
    if (name === 'compare') setCmpOpen(true);
    if (name === 'regions') setRegionsOpen(true);
    if (name === 'export') setExp((e) => ({ ...e, open: true }));
    if (name === 'summary') setObsPanel(true);
    if (name === 'mode') setModeOpen(true);
  };
  const setModeTo = (m) => { setMode(m); setVarOpen(false); setModeOpen(false); if (m === 'observed') setShowStar(true); };
  const layerLabel = isObs ? obsItem.label : isLive ? liveItem.label : isProb ? preset.label : vmeta?.label || 'Choose a layer';
  const liveTime = run ? new Date(run.run).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : null;
  const chipSub = !cat ? (err || 'Finding the latest runs…') : isObs ? (obsDays ? `${obsDays.length} day${obsDays.length === 1 ? '' : 's'} recorded` : 'Loading the archive…')
    : isLive ? (liveTime ? `Live · latest ${liveTime}` : 'Live · starting…')
    : model ? `${SHORT_NAMES[model.id] || model.label} · ${MODEL_INFO[model.id]?.[1] || ''}${run ? ` · run ${runLabel(run.run)}` : ''}` : 'Loading…';

  const varButton = (
    <button onClick={() => { setVarOpen((o) => !o); setQ(''); setMapOpen(false); }} style={{ ...sel, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0, background: varOpen ? T.btn : sel.background }}>
      {layerLabel} <ChevronDown style={{ width: 14, height: 14, opacity: 0.7, transform: varOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
    </button>
  );
  /* phones and tablets: one chip names the layer and where it comes from; tap for models, runs and layers */
  const dataChip = (
    <button onClick={() => openPanel('data')} aria-label="Choose the model, run and layer" style={{ ...sel, flex: 1, minWidth: 0, padding: '5px 12px 5px 14px', display: 'flex', alignItems: 'center', gap: 8,
      textAlign: 'left', background: varOpen ? T.btn : sel.background }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layerLabel}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: err && !cat ? '#fca5a5' : T.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isLive && liveTime && <span style={{ width: 6, height: 6, borderRadius: 99, background: '#ff4d4f', boxShadow: '0 0 6px #ff4d4f', flexShrink: 0 }} />}
          {!cat && !err && <Loader2 className="animate-spin" style={{ width: 11, height: 11, flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chipSub}</span>
        </span>
      </span>
      <ChevronDown style={{ width: 16, height: 16, opacity: 0.7, flexShrink: 0, transform: varOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
    </button>
  );
  const modeSeg = <Seg items={MODE_INFO.map(([k, l]) => [k, l])} value={mode} onChange={setModeTo} />;
  const modeBtn = (
    <button onClick={() => openPanel('mode')} aria-label="Change view" style={{ ...sel, padding: '0 10px 0 13px', height: 42, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800,
      flexShrink: 0, background: modeOpen ? T.btn : sel.background }}>
      {MODE_SHORT[mode]}<ChevronDown style={{ width: 15, height: 15, opacity: 0.7 }} />
    </button>
  );

  const layerCount = [showCities || wxOn, wxOn, arrowsOn, cloudsOn, canLightning && showLightning, showRoads, canGrid && showGrid,
    canContours && showContours, canStar && showStar, ovOn, mslOn && !ownMsl, wn.on].filter(Boolean).length + extras.length;
  const styleSeg = <Seg small items={Object.entries(MAP_STYLES).map(([k, s]) => [k, s.label])} value={style} onChange={setStyle} />;
  const frameSeg = <Seg small items={Object.entries(FRAMES).map(([k, f]) => [k, f.label])} value={frameKey} onChange={setFrameKey} />;
  const sectionTitle = (t) => <div style={{ fontSize: 10.5, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '4px 4px 7px' }}>{t}</div>;
  /* only the UK grid's cells are the model's or radar's real cells: the wide grid's always interpolate */
  const smoothPill = gridName === 'uk' && (
    <Pill on={smooth} title={smooth ? 'Smoothed: click to see the radar and model cells as they are' : 'Cells as they are: click to smooth'} onClick={() => setSmooth((x) => !x)}>
      {smooth ? 'Smooth' : 'Pixels'}
    </Pill>
  );
  /* under the Lightning switch: the strikes' colours and outline */
  const subRow = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: T.ink2, fontWeight: 650 };
  const swatch = (value, onChange, title) => (
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} title={title} aria-label={title}
      style={{ width: 28, height: 22, padding: 0, border: `1px solid ${T.line}`, borderRadius: 7, background: 'none', cursor: 'pointer' }} />
  );
  const mslControls = (
    <div style={{ display: 'grid', gap: 8, padding: '0 8px 10px 46px' }}>
      <div style={{ ...subRow, gap: 12 }}>
        {[['isobars', 'Isobars'], ['symbols', 'H and L'], ['centres', 'Centres']].map(([k, l]) => (
          <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title={k === 'symbols' ? 'the pressure symbols: H for highs, L for lows' : k === 'centres' ? 'where each high and low is centred, with its pressure' : 'lines of equal pressure, labelled'}>
            <input type="checkbox" checked={!!msl[k]} onChange={(e) => setMslK(k, e.target.checked)} /> {l}
          </label>
        ))}
      </div>
      {msl.isobars && (
        <div style={subRow}>
          <span style={{ fontWeight: 600 }}>Every</span>
          <Seg small items={[[2, '2 hPa'], [4, '4 hPa'], [8, '8 hPa']]} value={msl.every} onChange={(v) => setMslK('every', v)} />
        </div>
      )}
    </div>
  );
  const strikeControls = (
    <div style={{ display: 'grid', gap: 8, padding: '0 8px 10px 46px' }}>
      <div style={subRow}>
        <Seg small items={[['age', 'By age'], ['one', 'One colour']]} value={strikeStyle.colour} onChange={(v) => setStrikeK('colour', v)} />
        {strikeStyle.colour === 'one' && swatch(strikeStyle.fill, (v) => setStrikeK('fill', v), 'Strike colour')}
      </div>
      <div style={subRow}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={strikeStyle.outline} onChange={(e) => setStrikeK('outline', e.target.checked)} /> Outline
        </label>
        {strikeStyle.outline && swatch(strikeStyle.outlineColour, (v) => setStrikeK('outlineColour', v), 'Outline colour')}
      </div>
      {strikeStyle.colour === 'age' && (
        <div style={{ ...subRow, gap: 10, fontWeight: 600, fontSize: 11 }}>
          {[['#ffffff', 'under 5 min'], ['#ffe23c', '15'], ['#ff9628', '30'], ['#eb4632', 'older']].map(([c, l]) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 9, height: 9, borderRadius: 99, background: c, border: '1px solid rgba(0,0,0,0.45)' }} />{l}</span>
          ))}
        </div>
      )}
    </div>
  );
  /* under the Met Office warnings switch: their look, and what is in force at the time on show */
  const goToMs = (ms) => {
    setPlaying(false);
    const msOf = (x) => (timeSteps ? x : Date.parse(run.run) + x * 3600e3);
    let best = 0;
    steps.forEach((x, i) => { if (Math.abs(msOf(x) - ms) < Math.abs(msOf(steps[best]) - ms)) best = i; });
    setIdx(best);
  };
  const warnNow = wn.on && warnData && validMs != null ? [...warningsAt(validMs, gridName, isObs)].reverse() : [];
  const warnNext = wn.on && warnData && validMs != null && !warnNow.length ? shapesOn(gridName).filter((w) => w.fromMs > validMs).sort((a, b) => a.fromMs - b.fromMs)[0] : null;
  const warnFrom = warnData?.recordingSince ? Date.parse(warnData.recordingSince) : null;
  const warnState = (
    <div style={{ display: 'grid', gap: 3, fontSize: 11, color: T.ink2 }}>
      {!warnData ? 'Loading the warnings…' : warnNow.length ? warnNow.map((w) => (
        <span key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 10, height: 10, borderRadius: 3, background: w.colour, flexShrink: 0 }} />{w.severity} · {w.text} · {warnWhen(w)}
        </span>
      )) : warnFrom && validMs < warnFrom ? `The record of warnings begins on ${dayLabel(londonDay(warnFrom))}.` : `None in force ${isObs ? 'that day' : 'at this time'}.`}
      {warnNext && (
        <button onClick={() => goToMs(warnNext.fromMs)} style={{ all: 'unset', cursor: 'pointer', color: T.ink3, fontWeight: 650 }}>
          Next: {warnNext.severity.toLowerCase()} {warnNext.text.toLowerCase()}, {warnWhen(warnNext)} ›
        </button>
      )}
    </div>
  );
  const warnControls = (
    <div style={{ display: 'grid', gap: 8, padding: '0 8px 10px 46px' }}>
      <div style={subRow}>
        <Seg small items={[['fill', 'Filled'], ['line', 'Outline']]} value={wn.look} onChange={(v) => setWnK('look', v)} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={wn.labels} onChange={(e) => setWnK('labels', e.target.checked)} /> Labels
        </label>
      </div>
      <label style={subRow}>Strength <input type="range" min={0.3} max={1} step={0.05} value={wn.alpha} onChange={(e) => setWnK('alpha', Number(e.target.value))} style={{ flex: 1, minWidth: 90 }} /></label>
      {warnState}
    </div>
  );
  /* the risk overlay's controls (admins) */
  const ovDays = useMemo(() => new Set((ovRun?.frames || []).filter((f) => f.valid).map((f) => londonDay(Date.parse(f.valid)))), [ovRun]);
  const shownDay = frame?.head?.valid ? londonDay(Date.parse(frame.head.valid)) : null;
  const ovStatus = (() => {
    if (ovErr) return ovErr;
    if (ov.src === 'outlook') return !ovOutlooks ? 'Loading your saved outlooks…' : ovOutlooks.length ? `${outlookShown?.length || 0} area${outlookShown?.length === 1 ? '' : 's'}, drawn as saved` : 'No outlook saved in the Graphic Studio yet.';
    if (!ovRun) return 'Loading the run…';
    if (ov.span === 'custom') return !('custom' in ovAreas) ? 'Working out the span…' : ovAreas.custom ? `Peak over the span: ${Math.round(ovAreas.custom.peak * 100)}%` : null;
    if (!shownDay) return null;
    if (!ovDays.has(shownDay)) return `${dayLabel(shownDay)} is outside this run.`;
    const a = ovAreas[shownDay];
    return a === undefined ? `Working out ${dayLabel(shownDay)}…` : a ? `${dayLabel(shownDay)}: peak ${Math.round(a.peak * 100)}%` : `Nothing for ${dayLabel(shownDay)}.`;
  })();
  /* a span starts as the day on show */
  const pickSpan = (v) => setOv((o) => {
    if (v !== 'custom' || (o.from && o.to)) return { ...o, span: v };
    const d = shownDay || londonDay(Date.now());
    return { ...o, span: v, from: `${d}T00:00`, to: `${new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)}T00:00` };
  });
  const field = { ...sel, borderRadius: 12, padding: '6px 10px', width: '100%', boxSizing: 'border-box' };
  const ovControls = (
    <div style={{ display: 'grid', gap: 8, padding: '0 8px 10px 46px' }}>
      <Seg small items={[['nova', 'TCM NOVA'], ['outlook', 'My outlooks']]} value={ov.src} onChange={(v) => { setOvErr(null); setOvK('src', v); }} />
      {ov.src === 'nova' ? (
        <>
          <select value={ov.run || ''} onChange={(e) => setOvK('run', e.target.value)} style={field} aria-label="TCM NOVA run">
            {(ovRuns || []).map((r) => <option key={`${r.product}|${r.run_id}`} value={`${r.product}|${r.run_id}`} style={{ color: '#111' }}>{runName(r)}</option>)}
          </select>
          <Seg small items={[['day', 'Day on show'], ['custom', 'Dates & times']]} value={ov.span} onChange={pickSpan} />
          {ov.span === 'custom' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <input type="datetime-local" value={ov.from} max={ov.to || undefined} onChange={(e) => setOvK('from', e.target.value)} style={field} aria-label="From" />
              <input type="datetime-local" value={ov.to} min={ov.from || undefined} onChange={(e) => setOvK('to', e.target.value)} style={field} aria-label="To" />
            </div>
          )}
          <Seg small items={[['smooth', 'Simplified'], ['detailed', 'Detailed']]} value={ov.look} onChange={(v) => setOvK('look', v)} />
        </>
      ) : (
        <select value={ov.outlook || ''} onChange={(e) => setOvK('outlook', e.target.value)} style={field} aria-label="Saved outlook">
          {(ovOutlooks || []).map((g) => <option key={g.id} value={g.id} style={{ color: '#111' }}>{g.title}</option>)}
        </select>
      )}
      <label style={subRow}>Strength <input type="range" min={0.3} max={1} step={0.05} value={ov.alpha} onChange={(e) => setOvK('alpha', Number(e.target.value))} style={{ flex: 1, minWidth: 90 }} /></label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {RISK_KEY.map((k) => (
          <span key={k.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: T.ink2 }}><i style={{ width: 12, height: 8, borderRadius: 3, background: k.colour }} />{k.short}</span>
        ))}
      </div>
      {ovStatus && <div style={{ fontSize: 11, color: ovErr ? '#f59e0b' : T.ink2 }}>{ovStatus}</div>}
    </div>
  );
  /* any layer over or under the one on show: everything this view has, grouped as in the picker */
  const extraGroups = (() => {
    if (!model) return [];
    const taken = new Set([isObs ? obsKey : isLive ? liveKey : isProb ? presetKey : varKey, ...extras.map((x) => x.v)]);
    const g = {};
    const add = (grp, k, label) => { if (!taken.has(k) && !NO_COLOURS.has(k)) (g[grp] ||= []).push([k, label]); };
    if (isObs) OBS_LIST.forEach((x) => add(x.group, x.key, x.label));
    else if (isLive) LIVE_LIST.forEach((x) => add(x.group, x.key, x.label));
    else if (isProb) PRESETS.filter((x) => model.fields?.includes(x.field)).forEach((x) => add(x.group, x.key, x.label));
    else (model.variables || []).forEach((k) => cat?.variables?.[k] && add(cat.variables[k].group, k, cat.variables[k].label));
    const order = isObs || isLive || isProb ? Object.keys(g) : GROUP_ORDER.filter((n) => g[n]);
    return order.map((n) => [n, g[n]]);
  })();
  const extraLabel = (v) => (isObs ? OBS[v]?.label : isLive ? LIVE[v]?.label : isProb ? PRESET[v]?.label : cat?.variables?.[v]?.label) || v;
  /* the colours: as designed, or pale; each choice shows the layer on show in it */
  const swatchOf = (pale) => {
    const g = scaleSwatch(scaleKey, pale);
    return g ? <i style={{ width: 30, height: 8, borderRadius: 4, background: g, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)', flexShrink: 0 }} /> : null;
  };
  const colourControls = (
    <div style={{ display: 'grid', gap: 6, padding: '2px 8px 8px' }}>
      {sectionTitle('Colours')}
      <Seg small items={[['normal', <span key="n" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>{swatchOf(false)}Normal</span>],
        ['pale', <span key="p" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>{swatchOf(true)}Pale</span>]]} value={palette} onChange={setPaletteChoice} />
    </div>
  );
  const stackControls = (
    <div style={{ display: 'grid', gap: 6, padding: '2px 8px 8px' }}>
      {sectionTitle('Layers over and under')}
      <label style={subRow}>{layerLabel} <input type="range" min={0.2} max={1} step={0.05} value={layerAlpha} onChange={(e) => setLayerAlpha(Number(e.target.value))} style={{ flex: 1, minWidth: 70 }} aria-label="Strength of the main layer" /></label>
      {extras.map((x, i) => (
        <div key={`${x.v}${i}`} style={{ display: 'grid', gap: 5, padding: '7px 9px', borderRadius: 12, background: T.chip, boxShadow: T.chipShadow }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={extraLabel(x.v)}>{extraLabel(x.v)}</span>
            <IconBtn title="Remove this layer" onClick={() => dropExtra(i)} style={{ width: 24, height: 24 }}><X size={12} /></IconBtn>
          </div>
          {!timeSteps && !(model?.variables || model?.fields)?.includes(extraField(x.v)) && <span style={{ fontSize: 11, color: '#f59e0b' }}>{SHORT_NAMES[model?.id] || 'This model'} does not have this layer.</span>}
          <div style={subRow}>
            <Seg small items={[['over', 'Over'], ['under', 'Under']]} value={x.place} onChange={(v) => setExtraK(i, 'place', v)} />
            <input type="range" min={0.15} max={1} step={0.05} value={x.alpha} onChange={(e) => setExtraK(i, 'alpha', Number(e.target.value))} style={{ flex: 1, minWidth: 70 }} aria-label={`Strength of ${extraLabel(x.v)}`} />
          </div>
        </div>
      ))}
      {extras.length < MAX_EXTRA ? (
        <div style={{ position: 'relative' }}>
          <select value="" onChange={(e) => { if (e.target.value) addExtra(e.target.value); }} style={{ ...sel, width: '100%' }} aria-label="Add a layer over or under this one">
            <option value="" style={{ color: '#111' }}>Add a layer…</option>
            {extraGroups.map(([g, list]) => <optgroup key={g} label={g} style={{ color: '#111' }}>{list.map(([k, l]) => <option key={k} value={k} style={{ color: '#111' }}>{l}</option>)}</optgroup>)}
          </select>
          <ChevronDown style={{ position: 'absolute', right: 12, top: 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
        </div>
      ) : <span style={{ fontSize: 11, color: T.ink2 }}>Three layers is the most: remove one to add another.</span>}
    </div>
  );
  const layerRows = (
    <div style={{ display: 'grid', gap: 1 }}>
      {colourControls}
      {stackControls}
      <div style={{ height: 1, background: T.line, margin: '2px 4px 6px' }} />
      <LayerRow icon={<MapPin size={14} />} label="Places" note={wxOn ? 'shown with the weather symbols' : null} on={showCities || wxOn} locked={wxOn} onClick={() => setShowCities((x) => !x)} />
      {canWx && <LayerRow icon={<CloudSun size={14} />} label="Weather symbols" note={ownWx ? 'part of this layer' : 'above the places; sun or moon by the real sun'} on={wxOn} locked={ownWx} onClick={() => setShowWx((x) => !x)} />}
      {canArrows && <LayerRow icon={<Navigation size={14} />} label="Wind arrows" note={ownArrows ? 'part of this layer' : 'the way the wind is blowing'} on={arrowsOn} locked={ownArrows} onClick={() => setShowArrows((x) => !x)} />}
      {canMsl && <LayerRow icon={<Gauge size={14} />} label="Sea-level pressure" note={ownMsl ? 'this layer: its isobars, highs and lows' : 'isobars, highs and lows over the layer'} on={mslOn} locked={ownMsl} onClick={() => setMslK('on', !msl.on)} />}
      {canMsl && mslOn && mslControls}
      {canClouds && <LayerRow icon={<Cloud size={14} />} label="Cloud underneath" note={isLive ? 'satellite cloud under the radar' : 'the model’s cloud under its rain'} on={showClouds} onClick={() => setShowClouds((x) => !x)} />}
      <LayerRow icon={<TriangleAlert size={14} />} label="Met Office warnings" note={isObs ? 'those in force that day' : 'those in force at the time on show'} on={wn.on} onClick={() => setWnK('on', !wn.on)} />
      {wn.on && warnControls}
      {canLightning && <LayerRow icon={<Zap size={14} />} label="Lightning" note={isLive ? 'strikes in the hour before each frame' : 'every strike that day'} on={showLightning} onClick={() => setShowLightning((x) => !x)} />}
      {canLightning && showLightning && strikeControls}
      <LayerRow icon={<Route size={14} />} label="Roads" note="motorways; A roads as you zoom in" on={showRoads} onClick={() => setShowRoads((x) => !x)} />
      {canGrid && <LayerRow icon={<Grid3x3 size={14} />} label="Value grid" note="the number at each point" on={showGrid} onClick={() => setShowGrid((x) => !x)} />}
      {canContours && <LayerRow icon={<Waves size={14} />} label="Contours" note="lines at set values" on={showContours} onClick={() => setShowContours((x) => !x)} />}
      {canStar && <LayerRow icon={<Star size={14} />} label={isObs ? "Star the day's extreme" : 'Star the highest value'} note={isObs ? 'with where it was' : 'in the part of the map you can see'} on={showStar} onClick={() => setShowStar((x) => !x)} />}
      {isAdmin && (
        <>
          <div style={{ height: 1, background: T.line, margin: '6px 4px' }} />
          <LayerRow icon={<CloudLightning size={14} />} label="Risk overlay" note="TCM NOVA or your outlooks, over any layer (admins)" on={ov.on} onClick={() => setOvK('on', !ov.on)} />
          {ov.on && ovControls}
        </>
      )}
    </div>
  );
  const layersBtn = (
    <Pill on={mapOpen} title="Layers: places, symbols, arrows, warnings, roads, grid…" onClick={() => { if (narrow) openPanel('layers'); else { setCmpOpen(false); setMapOpen((o) => !o); } }} icon={<Layers size={14} />}>
      Layers{layerCount ? ` · ${layerCount}` : ''}
    </Pill>
  );
  const compareBtn = (
    <Pill on={cmpOpen || cmp.on} title="Two windows: compare runs, or the warnings beside a layer" onClick={() => { if (narrow) openPanel('compare'); else { setMapOpen(false); setCmpOpen((o) => !o); } }} icon={<Columns2 size={14} />}>
      Compare
    </Pill>
  );
  /* the models, grouped by who makes them: a picker on desktops, buttons on phones and tablets */
  const modelGroups = (list) => ['Met Office', 'ECMWF', 'NOAA'].map((g) => [g, (list || []).filter((m) => m.runs?.length && (MODEL_INFO[m.id]?.[0] || 'NOAA') === g)]).filter(([, ms]) => ms.length);
  const chooseModel = (id) => (isProb ? (setEnsId(id), setEnsRunIso(null)) : (setModelId(id), setRunIso(null)));
  const modelPicker = (list, value, onChange, wide) => (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...sel, fontWeight: 700, ...(wide ? { width: '100%' } : {}) }} title={model?.source || 'Model'} aria-label={wide ? "Second window's model" : 'Model'}>
        {modelGroups(list).map(([g, ms]) => (
          <optgroup key={g} label={g} style={{ color: '#111' }}>
            {ms.map((m) => <option key={m.id} value={m.id} style={{ color: '#111' }}>{SHORT_NAMES[m.id] || m.label} · {MODEL_INFO[m.id]?.[1] || ''}</option>)}
          </optgroup>
        ))}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 10, top: 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
    </div>
  );
  const runSelect = model && !timeSteps && (
    <div style={{ position: 'relative' }}>
      <select value={run?.run || ''} onChange={(e) => (isProb ? setEnsRunIso : setRunIso)(e.target.value)} style={{ ...sel, ...(narrow ? { width: '100%', padding: '10px 34px 10px 14px', fontSize: 13.5 } : {}) }}
        title={model.source || `${model.label} · ${model.members} members`} aria-label="Run">
        {runOptions(model.runs)}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 12, top: narrow ? 12 : 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
    </div>
  );
  const spec = (label, el) => (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 650, color: T.ink2 }}>{label}</span>
      {el}
    </div>
  );
  const compareBody = (
    <div style={{ display: 'grid', gap: 10 }}>
      <LayerRow icon={<Columns2 size={14} />} label="Two windows" note="in one frame, with a white line between them" on={cmp.on} onClick={() => setCmpK('on', !cmp.on)} />
      {cmp.on && (
        <div style={{ display: 'grid', gap: 10, padding: '0 8px 4px' }}>
          {!timeSteps && spec('Second window', <Seg small items={[['run', isProb ? 'Another run' : 'Run or layer'], ['warnings', 'Warnings']]} value={cmp.kind} onChange={(v) => setCmpK('kind', v)} />)}
          {kindB === 'warnings' && <div style={{ fontSize: 11.5, color: T.ink2, lineHeight: 1.4 }}>The Met Office warnings in force at the time on show, beside {layerLabel.toLowerCase()}.</div>}
          {kindB === 'run' && modelB && (
            <>
              {spec('Model', modelPicker(optionsB, modelB.id, (id) => setCmp((o) => ({ ...o, model: id, run: null })), true))}
              {spec('Run', (
                <div style={{ position: 'relative' }}>
                  <select value={runB?.run || ''} onChange={(e) => setCmpK('run', e.target.value)} style={{ ...sel, width: '100%' }} aria-label="Second window's run">
                    {runOptions(modelB.runs)}
                  </select>
                  <ChevronDown style={{ position: 'absolute', right: 12, top: 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
                </div>
              ))}
              {!isProb && spec('Layer', (
                <div style={{ position: 'relative' }}>
                  <select value={cmp.v && modelB.variables.includes(cmp.v) ? cmp.v : ''} onChange={(e) => setCmpK('v', e.target.value || null)} style={{ ...sel, width: '100%' }} aria-label="Second window's layer">
                    <option value="" style={{ color: '#111' }}>Same as the first window</option>
                    {GROUP_ORDER.map((g) => {
                      const vs = modelB.variables.filter((k) => cat.variables[k]?.group === g);
                      return vs.length ? <optgroup key={g} label={g} style={{ color: '#111' }}>{vs.map((k) => <option key={k} value={k} style={{ color: '#111' }}>{cat.variables[k].label}</option>)}</optgroup> : null;
                    })}
                  </select>
                  <ChevronDown style={{ position: 'absolute', right: 12, top: 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
                </div>
              ))}
            </>
          )}
          {spec('Layout', <Seg small items={[['auto', 'Auto'], ['cols', 'Side by side'], ['rows', 'Stacked']]} value={cmp.split} onChange={(v) => setCmpK('split', v)} />)}
          <button onClick={() => setCmpK('swap', !cmp.swap)} style={{ ...sel, justifySelf: 'start', padding: '7px 12px', display: 'flex', gap: 6, alignItems: 'center', background: T.btn }}><ArrowLeftRight size={13} />Swap the windows</button>
          {kindB === 'run' && pendingB > 0 && <div style={{ fontSize: 11, color: T.ink2, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />Fetching the second window from AWS · {pendingB} to go</div>}
        </div>
      )}
    </div>
  );
  const chip = (on) => ({
    border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: narrow ? 13 : 12.5, fontWeight: 600, padding: narrow ? '9px 14px' : '7px 12px', borderRadius: 999,
    color: on ? '#fff' : T.ink3,
    background: on ? (T.light ? 'linear-gradient(180deg, #4b95ff, #1f6fe0)' : 'linear-gradient(180deg, rgba(110,180,255,0.55), rgba(60,130,240,0.4))') : T.chip,
    boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,0.5)' : T.chipShadow,
  });
  const isSel = (k) => k === (isObs ? obsKey : isLive ? liveKey : isProb ? presetKey : varKey);
  const pickVar = (k) => { if (isObs) setObsKey(k); else if (isLive) setLiveKey(k); else if (isProb) choosePreset(k); else setVarKey(k); setVarOpen(false); };
  const searchBox = (autoFocus) => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: narrow ? '10px 14px' : '7px 12px', borderRadius: 999, background: T.track }}>
      <Search size={14} style={{ opacity: 0.6 }} />
      <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={isLive ? 'Search radar, satellite…' : isProb ? 'Search wind, rain, frost, snow…' : isObs ? 'Search highs, lows, rain…' : 'Search layers'}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: T.ink, fontFamily: FONT, fontSize: narrow ? 16 : 13 }} />
    </div>
  );
  const varGroups = groups.map(([g, list]) => (
    <div key={g} style={{ marginBottom: 10 }}>
      {sectionTitle(g)}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {list.map(([k, v]) => <button key={k} onClick={() => pickVar(k)} style={chip(isSel(k))}>{v.label}</button>)}
      </div>
    </div>
  ));
  const pickerNote = model && (
    <div style={{ fontSize: 11, color: T.ink2, margin: '4px 4px 0', lineHeight: 1.45 }}>{isObs
      ? "Each day's highs, lows and totals across the UK and Ireland, kept from 20 October 2026 onwards: step back through the days on the timeline. Temperature, wind, pressure and humidity come from a 15-minute analysis that starts from the Met Office UKV model and is pulled to what the airport weather stations (METAR) measured; rainfall is the Met Office radar's own total."
      : isLive
      ? "Live, observed: Met Office 1 km rain radar every 15 minutes (AWS), Meteosat-12 imagery every 10 minutes and Meteosat 0° every 15 (EUMETSAT), lightning from the Met Office LEELA network. 'Now' layers are a 15-minute analysis: the Met Office UKV model corrected to the UK and Irish airport weather reports (METAR), with the radar's rain and LEELA lightning for the weather symbols."
      : isProb
      ? `${model.label}: ${model.members} members. The chance is the share of members past your threshold, so drag the slider to ask a different question. Flooding uses 24 h rain or ECMWF runoff (wet ground runs off more); it is a signal, not a river forecast.`
      : model.source}</div>
  );
  /* phones and tablets: models and run first, then the layers */
  const dataBody = (
    <div style={{ display: 'grid', gap: 6 }}>
      {cat && !timeSteps && (
        <>
          {modelGroups(isProb ? cat.ensembles : cat.models).map(([g, ms]) => (
            <div key={g} style={{ marginBottom: 4 }}>
              {sectionTitle(g)}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ms.map((m) => (
                  <button key={m.id} onClick={() => chooseModel(m.id)} style={chip(m.id === (isProb ? ensId : modelId))}>
                    {SHORT_NAMES[m.id] || m.label}<span style={{ opacity: 0.7, fontWeight: 500 }}> · {MODEL_INFO[m.id]?.[1] || ''}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {sectionTitle('Run')}
          {runSelect}
          <div style={{ height: 1, background: T.line, margin: '8px 2px 4px' }} />
        </>
      )}
      <div style={{ display: 'flex', margin: '2px 0 6px' }}>{searchBox(false)}</div>
      {varGroups}
      {pickerNote}
    </div>
  );
  const regionList = (
    <div style={{ display: 'grid', gap: 2 }}>
      {Object.entries(REGIONS).map(([k, r]) => (
        <button key={k} onClick={() => { fit(r.box); setRegionsOpen(false); }} style={{ all: 'unset', cursor: 'pointer', padding: narrow ? '12px 14px' : '7px 12px', borderRadius: 12, fontSize: narrow ? 14 : 12.5, fontWeight: 650, color: T.ink3 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = T.chip; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>{r.label}</button>
      ))}
    </div>
  );
  const speedSelect = (
    <div style={{ position: 'relative' }}>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ ...sel, padding: '7px 26px 7px 10px' }} title="Playback, GIF and video speed" aria-label="Playback speed">
        {[120, 200, 300, 450, 650, 900, 1300, 2000].map((v) => <option key={v} value={v} style={{ color: '#111' }}>{(1000 / v).toFixed(v > 500 ? 1 : 0)} fps</option>)}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 8, top: 9, width: 13, height: 13, pointerEvents: 'none', opacity: 0.7 }} />
    </div>
  );
  const waiting = pending + pendingB + pendingX;
  const lengthSec = (job) => {
    const list = motionFrames(job);
    return list.length ? Math.round(motionPlan(job, list).plan.reduce((n, x) => n + x.delay, 0) / 100) / 10 : 0;
  };
  const motionName = isObs ? 'the days' : isLive ? 'the last hours' : 'the run';
  const motionBtn = (job, icon, label) => {
    const off = waiting > 0 || (job === 'video' && !canMakeVideo());
    return (
      <button onClick={() => exportMotion(job)} disabled={off} style={{ ...sel, flex: 1, minWidth: 150, padding: '10px 14px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center',
        color: off ? T.ink2 : '#fff', background: off ? T.chip : 'linear-gradient(180deg, rgba(110,180,255,0.75), rgba(60,130,240,0.65))' }}>
        {icon}{label}
      </button>
    );
  };
  const exportBody = exp.open && (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <div style={{ color: T.ink2 }}>{FRAMES[frameKey].a ? FRAMES[frameKey].label : 'As framed'}{kindB ? ' · both windows' : ''} · exactly as previewed</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Seg small items={[[1080, '1080p'], [2160, '4K']]} value={exp.png} onChange={(v) => setExp((x) => ({ ...x, png: v }))} />
        <button onClick={exportPng} disabled={!frame} style={{ ...sel, padding: '9px 14px', display: 'flex', gap: 6, alignItems: 'center', background: T.btn }}><ImageIcon size={14} />PNG of this step</button>
      </div>
      <div style={{ height: 1, background: T.line }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ color: T.ink2 }}>From</span>
        <select value={exp.from} onChange={(e) => setExp((x) => ({ ...x, from: Number(e.target.value) }))} style={{ ...sel, padding: '6px 10px' }} aria-label="From">
          {steps.map((s, i) => <option key={s} value={i} style={{ color: '#111' }}>{stepLabel(s)}</option>)}
        </select>
        <span style={{ color: T.ink2 }}>to</span>
        <select value={exp.to ?? steps.length - 1} onChange={(e) => setExp((x) => ({ ...x, to: Number(e.target.value) }))} style={{ ...sel, padding: '6px 10px' }} aria-label="To">
          {steps.map((s, i) => <option key={s} value={i} style={{ color: '#111' }}>{stepLabel(s)}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ color: T.ink2 }}>Each step</span>
        <input type="number" min={40} max={5000} step={10} value={speed} onChange={(e) => setSpeed(Math.max(40, Math.min(5000, Number(e.target.value) || 450)))}
          style={{ ...sel, width: 84, padding: '6px 10px', cursor: 'text' }} aria-label="Milliseconds per step" />
        <span style={{ color: T.ink2 }}>ms</span>
      </div>
      <LayerRow icon={<Waves size={14} />} label="Smooth transitions" note="the frames between the steps, worked out from how the weather moves" on={exp.smooth} onClick={() => setExp((x) => ({ ...x, smooth: !x.smooth }))} />
      {exp.busy == null ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Seg small items={[[540, '540p'], [720, '720p'], [1080, '1080p']]} value={exp.gif} onChange={(v) => setExp((x) => ({ ...x, gif: v }))} />
            {motionBtn('gif', <Film size={14} />, `GIF of ${motionName}`)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Seg small items={[[720, '720p'], [1080, '1080p'], [2160, '4K']]} value={exp.video} onChange={(v) => setExp((x) => ({ ...x, video: v }))} />
            <Seg small items={[[30, '30 fps'], [60, '60 fps']]} value={exp.fps} onChange={(v) => setExp((x) => ({ ...x, fps: v }))} />
            {motionBtn('video', <Clapperboard size={14} />, `Video of ${motionName}`)}
          </div>
          <div style={{ fontSize: 11, color: exp.err ? '#f59e0b' : T.ink2 }}>{exp.err || (waiting > 0 ? `Waiting for ${waiting} frames from AWS` : !canMakeVideo() ? 'This browser cannot make video files; Chrome, Edge, Safari and recent Firefox can.' : `Video ${lengthSec('video')} s · GIF ${lengthSec('gif')} s, ${GIF_FPS} frames a second`)}</div>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: T.ink2 }}>Making the {exp.job === 'gif' ? 'GIF' : 'video'}…</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.line, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(exp.busy * 100)}%`, background: 'linear-gradient(90deg,#7cc8ff,#3d8bff)' }} /></div>
            {Math.round(exp.busy * 100)}%
            <button onClick={() => { gifCancel.current = true; }} style={{ ...sel, padding: '5px 10px' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
  /* the observed day: its extremes, lightning and station reports */
  const obsDay = isObs && frame ? obsSummary[dayOf(Date.parse(frame.head.valid))] : null;
  const summaryBody = obsDay && (() => {
    const s = obsDay;
    const rows = ['t2_max', 't2_min', 'precip_total', 'rain_rate_max', 'gust10_max', 'wind10_max', 'mslp_min', 'windchill_min'].map((k) => [k, s.fields?.[k]]).filter(([, v]) => v?.value != null);
    const st = s.stations || [];
    const top = (k, fn) => st.filter((x) => x[k] != null).sort((a, b) => fn(a[k], b[k]))[0];
    const sw = top('tmax', (a, b) => b - a), sc = top('tmin', (a, b) => a - b), sg = top('gust', (a, b) => b - a);
    return (
      <div style={{ display: 'grid', gap: 2, fontSize: narrow ? 13 : 12 }}>
        {rows.map(([k, v]) => (
          <button key={k} onClick={() => { setObsKey(k); if (phone) setObsPanel(false); }} title={`Show ${v.label.toLowerCase()} on the map`} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: 10, padding: narrow ? '8px 8px' : '5px 8px', borderRadius: 10,
            background: k === obsKey ? T.chip : 'transparent' }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', color: T.ink3, fontWeight: 650 }}>{v.label}</span>
              <span style={{ display: 'block', color: T.ink2, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.place || ''}</span>
            </span>
            <span style={{ fontWeight: 800, fontSize: 13.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtValue(v.value, v.unit)}</span>
          </button>
        ))}
        <div style={{ color: T.ink2, padding: '6px 8px 4px' }}>Lightning: <b style={{ color: T.ink }}>{(s.lightning || 0).toLocaleString('en-GB')}</b> strike{s.lightning === 1 ? '' : 's'}</div>
        {(sw || sc || sg) && <div style={{ height: 1, background: T.line, margin: '4px 8px' }} />}
        {(sw || sc || sg) && (
          <div style={{ padding: '2px 8px', display: 'grid', gap: 3, color: T.ink2 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Station reports (METAR)</span>
            {sw && <span>Warmest: <b style={{ color: T.ink }}>{sw.tmax}°C</b> {sw.name}</span>}
            {sc && <span>Coldest: <b style={{ color: T.ink }}>{sc.tmin}°C</b> {sc.name}</span>}
            {sg && <span>Strongest gust: <b style={{ color: T.ink }}>{Math.round(sg.gust)} mph</b> {sg.name}</span>}
          </div>
        )}
      </div>
    );
  })();
  const summaryTitle = obsDay ? `UK & Ireland · ${new Date(`${obsDay.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'The day';
  const summaryNote = obsDay ? (obsDay.day === londonToday() ? 'so far today' : `${obsDay.analyses}/96 analyses`) : '';

  /* a clicked point: its value now and through the steps */
  const pinCard = pin && (() => {
    const vals = steps.map((s) => (frames[s] ? sampleFrame(disp(frames[s]), pin.gx, pin.gy) : NaN));
    const at = Math.min(idx, Math.max(0, steps.length - 1));
    const numeric = !['wx', 'ptype', 'wdir10', 'mwd'].includes(scaleKey);
    const fin = vals.filter(Number.isFinite);
    const c = (statics?.cities || []).reduce((b, x) => { const d = Math.hypot(x.x - pin.gx, x.y - pin.gy); return !b || d < b.d ? { d, n: x.name } : b; }, null);
    const km = c ? c.d * 2 : null;
    const where = !c ? 'Picked point' : km < 6 ? c.n : km < 20 ? `Near ${c.n}` : `${Math.round(km)} km from ${c.n}`;
    return (
      <div style={{ ...T.glass, borderRadius: 20, position: 'absolute', bottom: botH, zIndex: 4, padding: '10px 12px 12px', display: 'grid', gap: 6,
        ...(narrow ? { left: 10, right: 10, maxWidth: 520, margin: '0 auto' } : { right: 10, width: 300 }) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MapPin size={14} style={{ color: '#ffd23f', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where}</span>
          <IconBtn title="Close (Esc)" onClick={() => setPin(null)} style={{ width: narrow ? 30 : 24, height: narrow ? 30 : 24 }}><X size={12} /></IconBtn>
        </div>
        {isImg
          ? <span style={{ fontSize: 12, color: T.ink2 }}>Satellite pictures carry no values: choose a radar, model, “now” or observed layer.</span>
          : <>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtPoint(vals[at])}</div>
                <div style={{ fontSize: 11.5, color: T.ink2 }}>{vmeta?.label} · {validLabel}</div>
                {kindB === 'run' && frameB && (
                  <div style={{ fontSize: 12, color: T.ink3, marginTop: 3 }}>
                    Second window: <b>{fmtPoint(withGrid(gridB, () => {
                      const [bx, by] = gridB === gridName ? [pin.gx, pin.gy] : projection(gridB).toGrid(...projection(gridName).fromGrid(pin.gx, pin.gy));
                      return sampleFrame(disp(frameB), bx, by);
                    }), scaleB, metaB)}</b>
                  </div>
                )}
              </div>
              {numeric && fin.length > 1 && (
                <>
                  <Sparkline values={vals} at={at} w={narrow ? Math.min(496, (stageRef.current?.clientWidth || 360) - 44) : 268}
                    onPick={(i) => { setPlaying(false); setIdx(Math.max(0, Math.min(steps.length - 1, i))); }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.ink2 }}>
                    <span>{stepLabel(steps[0])}</span>
                    <span>low {fmtValue(Math.min(...fin), vmeta?.unit)} · high {fmtValue(Math.max(...fin), vmeta?.unit)}</span>
                    <span>{stepLabel(steps[steps.length - 1])}</span>
                  </div>
                </>
              )}
              {numeric && fin.length <= 1 && steps.length > 1 && <span style={{ fontSize: 11.5, color: T.ink2 }}>The other steps are still loading.</span>}
            </>}
      </div>
    );
  })();

  /* a card floating over the map (desktops and tablets) */
  const card = (title, note, onClose, body, pos) => (
    <div role="dialog" aria-label={title} style={{ ...T.glass, borderRadius: 22, position: 'absolute', zIndex: 6, padding: '10px 12px 12px', overflowY: 'auto', overflowX: 'hidden',
      scrollbarWidth: 'thin', scrollbarColor: `${T.line} transparent`, maxHeight: `calc(100% - ${topH + botH + 10}px)`, ...pos }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 8px 4px' }}>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800 }}>{title}</span>
        {note && <span style={{ color: T.ink2, fontSize: 11 }}>{note}</span>}
        <IconBtn title="Close" onClick={onClose} style={{ width: 26, height: 26 }}><X size={13} /></IconBtn>
      </div>
      {body}
    </div>
  );
  const probBar = isProb && cat && (
    <div style={{ ...T.capsule, padding: '5px 12px 5px 5px', display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto', flexBasis: '100%', maxWidth: 680 }}>
      <Seg small items={[['above', phone ? '≥' : '≥ above'], ['below', phone ? '≤' : '≤ below']]} value={dir} onChange={setDir} />
      <input type="range" className="md-thr" min={Math.min(preset.min, thr)} max={Math.max(preset.max, thr)} step={preset.step} value={thr}
        onChange={(e) => setThr(Number(e.target.value))} style={{ flex: 1, minWidth: 60, accentColor: T.light ? '#1f6fe0' : '#7cc8ff' }} aria-label="Threshold" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 999, background: T.track, boxShadow: T.trackShadow, flexShrink: 0 }}>
        <IconBtn title="Lower" onClick={() => nudge(-1)} style={{ width: 26, height: 26, background: 'transparent', boxShadow: 'none' }}><Minus size={13} /></IconBtn>
        <input type="text" inputMode="decimal" value={thrText} aria-label="Threshold value"
          onChange={(e) => { setThrText(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) setThr(v); }}
          onBlur={() => setThrText(fmtThr(thr))}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); } if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); } if (e.key === 'Enter') e.currentTarget.blur(); }}
          style={{ width: `${Math.max(3, thrText.length + 1)}ch`, minWidth: 38, textAlign: 'center', border: 'none', outline: 'none', background: 'transparent',
            color: T.ink, fontFamily: FONT, fontSize: phone ? 16 : 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', padding: '4px 0' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: T.ink2, paddingRight: 2 }}>{fmeta?.unit || ''}</span>
        <IconBtn title="Higher" onClick={() => nudge(1)} style={{ width: 26, height: 26, background: 'transparent', boxShadow: 'none' }}><Plus size={13} /></IconBtn>
      </div>
      {!narrow && <span style={{ fontSize: 11.5, color: T.ink2, whiteSpace: 'nowrap' }}>{model?.members ? `${model.members} members` : ''}</span>}
    </div>
  );
  const stepBack = () => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); };
  const stepFwd = () => { setPlaying(false); setIdx((i) => Math.min(steps.length - 1, i + 1)); };
  const slider = (
    <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.min(idx, Math.max(0, steps.length - 1))}
      onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} style={{ flex: 1, minWidth: 60, accentColor: '#7cc8ff', height: phone ? 30 : undefined }} aria-label="Forecast step" />
  );
  const playBtn = (
    <IconBtn on={playing} title={playing ? 'Pause (space)' : 'Play (space)'} onClick={() => setPlaying((p) => !p)} style={{ width: phone ? 42 : 38, height: phone ? 42 : 38, flexShrink: 0 }}>
      {playing ? <Pause size={17} /> : <Play size={17} />}
    </IconBtn>
  );
  /* a labelled tool on the phone's bottom bar */
  const tool = (icon, label, on, onClick, badge) => (
    <button key={label} onClick={onClick} aria-pressed={!!on} style={{ border: 'none', cursor: 'pointer', fontFamily: FONT, flex: 1, minWidth: 0, height: 46, borderRadius: 14,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 10.5, fontWeight: 700,
      color: on ? T.ink : T.ink2, background: on ? T.on : 'transparent', boxShadow: on ? T.onShadow : 'none', position: 'relative' }}>
      {icon}<span>{label}</span>
      {badge ? <span style={{ position: 'absolute', top: 4, right: '50%', marginRight: -18, minWidth: 15, height: 15, borderRadius: 99, fontSize: 9.5, lineHeight: '15px', background: '#3d8bff', color: '#fff' }}>{badge}</span> : null}
    </button>
  );

  return (
    <ThemeCtx.Provider value={T}>
    <div ref={shellRef} style={{ height: shellH, position: 'relative', overflow: 'hidden', fontFamily: FONT, color: T.ink,
      background: 'radial-gradient(120% 80% at 50% 0%, #142238 0%, #070c16 60%, #04070d 100%)' }}>
      <div ref={stageRef} style={{ position: 'absolute', inset: 0 }}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerLeave={(e) => { onUp(e); setHover(null); }}
          style={{ width: '100%', height: '100%', display: 'block', cursor: interacting ? 'grabbing' : 'crosshair', touchAction: 'none' }} />
      </div>

      {/* top bar */}
      <div ref={topRef} style={{ position: 'absolute', top: phone ? 8 : 10, left: phone ? 8 : 10, right: phone ? 8 : 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
        {layout === 'desktop' ? (
          <>
            <div className="md-noscroll" style={{ ...T.capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0, maxWidth: '100%', pointerEvents: 'auto' }}>
              {cat ? (
                <>
                  {modeSeg}
                  {isObs
                    ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', fontSize: 12, fontWeight: 700, color: T.ink2, whiteSpace: 'nowrap' }}>{chipSub}</span>
                    : isLive
                    ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', fontSize: 12, fontWeight: 700, color: T.ink2, whiteSpace: 'nowrap' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: '#ff4d4f', boxShadow: '0 0 8px #ff4d4f' }} />
                        {liveTime ? `Latest ${liveTime}` : 'Starting…'}
                      </span>
                    : isProb
                    ? modelPicker(cat.ensembles, ensId, chooseModel)
                    : modelPicker(cat.models, modelId, chooseModel)}
                  {runSelect}
                  {varButton}
                </>
              ) : (
                <span style={{ padding: '6px 10px', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', color: err ? '#fca5a5' : T.ink2 }}>
                  {!err && <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />}{err || 'Finding the latest runs…'}
                </span>
              )}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ ...T.capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', flexShrink: 0 }}>{styleSeg}{frameSeg}{smoothPill}{compareBtn}{layersBtn}</div>
          </>
        ) : (
          <div style={{ ...T.capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', flex: 1, minWidth: 0 }}>
            {phone ? modeBtn : modeSeg}
            {dataChip}
            {!phone && compareBtn}
            {!phone && layersBtn}
          </div>
        )}
        {probBar}
      </div>

      {/* desktop: the layer picker and the layers, as cards under the top bar */}
      {layout === 'desktop' && mapOpen && card('Layers', null, () => setMapOpen(false), layerRows, { right: 10, top: topH, width: 300 })}
      {layout === 'desktop' && cmpOpen && card('Compare', null, () => setCmpOpen(false), compareBody, { right: 10, top: topH, width: 320 })}
      {layout === 'desktop' && varOpen && cat && !mapOpen && (
        <div style={{ ...T.glass, borderRadius: 24, position: 'absolute', left: 10, top: topH, width: 'min(560px, calc(100% - 20px))', maxHeight: '62%', overflowY: 'auto', padding: 14, zIndex: 5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            {searchBox(true)}
            <IconBtn title="Close" onClick={() => setVarOpen(false)}><X size={15} /></IconBtn>
          </div>
          {varGroups}
          {pickerNote}
        </div>
      )}
      {/* tablet: the same, as cards */}
      {layout === 'tablet' && varOpen && card('Model, run and layer', null, closePanels, dataBody, { left: 10, top: topH, width: 'min(460px, calc(100% - 20px))' })}
      {layout === 'tablet' && mapOpen && card('Map and layers', null, closePanels,
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gap: 8, justifyItems: 'start', paddingBottom: 8, borderBottom: `1px solid ${T.line}` }}>{styleSeg}{frameSeg}{smoothPill}</div>
          {layerRows}
        </div>, { right: 10, top: topH, width: 320 })}
      {layout === 'tablet' && cmpOpen && card('Compare', null, closePanels, compareBody, { right: 10, top: topH, width: 320 })}
      {layout === 'tablet' && regionsOpen && card('Zoom to', null, closePanels, regionList, { right: 10, bottom: botH, width: 240 })}
      {layout === 'tablet' && exp.open && card('Export', null, closePanels, <>{exportBody}<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}><span style={{ color: T.ink2, fontSize: 12.5 }}>Playback</span>{speedSelect}</div></>,
        { right: 10, bottom: botH, width: 'min(380px, calc(100% - 20px))' })}

      <style>{'.md-noscroll::-webkit-scrollbar{display:none}.md-noscroll{scrollbar-width:none}'
        + '.md-thr{height:28px;cursor:pointer}.md-thr::-webkit-slider-thumb{width:22px;height:22px}.md-thr::-moz-range-thumb{width:22px;height:22px}'}</style>

      {/* desktop: zoom buttons and regions (phones and tablets pinch, and have Regions on the bottom bar) */}
      {layout === 'desktop' && (
        <div style={{ ...T.capsule, position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', padding: 5, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <IconBtn title="Zoom in (+)" onClick={() => zoomBy(1.35)}><ZoomIn size={15} /></IconBtn>
          <IconBtn title="Zoom out (−)" onClick={() => zoomBy(1 / 1.35)}><ZoomOut size={15} /></IconBtn>
          <IconBtn title="UK & Ireland" onClick={() => fit(REGIONS.uk.box)}><Maximize size={14} /></IconBtn>
          <IconBtn on={regionsOpen} title="Zoom to a region" onClick={() => setRegionsOpen((o) => !o)}><MapIcon size={14} /></IconBtn>
        </div>
      )}
      {layout === 'desktop' && regionsOpen && (
        <div style={{ ...T.glass, borderRadius: 18, position: 'absolute', right: 58, top: '50%', transform: 'translateY(-50%)', padding: 6, zIndex: 6 }}>{regionList}</div>
      )}

      {hover && layout === 'desktop' && (
        <div style={{ ...T.capsule, position: 'absolute', left: hover.x, top: hover.y + 12, transform: hover.x > hover.w - 200 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
          pointerEvents: 'none', padding: '5px 11px', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: hover.warn ? 14 : 999 }}>
          {hover.text}{hover.warn && <div style={{ fontSize: 11.5, fontWeight: 650, color: T.ink2 }}>{hover.warn}</div>}
        </div>
      )}
      {newRun && (
        <div style={{ ...T.capsule, position: 'absolute', left: 10, bottom: botH, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center', zIndex: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: '#34d399', boxShadow: '0 0 8px #34d399' }} />{newRun}
        </div>
      )}
      {isObs && (!obsDays || (obsDays.length && !frame)) && (
        <div style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', ...noticePos, padding: '6px 14px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />Loading the observed days…
        </div>
      )}
      {isObs && obsDays && !obsDays.length && (
        <div style={{ ...T.capsule, position: 'absolute', left: 10, right: 10, margin: '0 auto', maxWidth: 520, ...noticePos, padding: '7px 14px', fontSize: 12.5, textAlign: 'center' }}>
          The first observed day is being built from today's radar and station reports — back in a few minutes.
        </div>
      )}
      {/* the observed day: docked beside the frame where there is room; otherwise a card or a sheet */}
      {isObs && obsPanel && summaryBody && sidePanel && card(summaryTitle, summaryNote, () => setObsPanel(false), summaryBody, { left: 10, top: topH, width: OBS_PANEL_W })}
      {isObs && obsPanel && summaryBody && !sidePanel && layout === 'tablet' && card(summaryTitle, summaryNote, closePanels, summaryBody, { left: 10, bottom: botH, width: 'min(340px, calc(100% - 20px))' })}
      {isObs && !obsPanel && layout === 'desktop' && (
        <div style={{ ...T.capsule, position: 'absolute', left: 10, bottom: botH, padding: 4 }}>
          <IconBtn title="Show the day's extremes" onClick={() => setObsPanel(true)}><Star size={14} /></IconBtn>
        </div>
      )}
      {isLive && liveProd && !frame && (
        <div style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', ...noticePos, padding: '6px 14px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />{liveProd.times?.length ? 'Loading the latest images…' : 'The first images are being fetched…'}
        </div>
      )}
      {(!frame || pending > 0) && key && (
        <div style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', ...noticePos, padding: '6px 14px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
          {!status ? 'Starting…' : `Fetching from AWS · ${loadedCount}/${steps.length}`}
        </div>
      )}

      {!exp.open && !(phone && (varOpen || mapOpen || cmpOpen || regionsOpen || obsPanel || modeOpen)) && pinCard}

      {/* desktop: the export card above the timeline */}
      {layout === 'desktop' && exp.open && card('Export', null, () => setExp((e) => ({ ...e, open: false })), exportBody, { right: 10, bottom: botH, width: 'min(380px, calc(100% - 20px))' })}

      {/* bottom bar */}
      {layout === 'desktop' ? (
        <div ref={botRef} style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 10, width: 'min(980px, calc(100% - 20px))', padding: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconBtn title="Previous step (←)" onClick={stepBack}><ChevronLeft size={16} /></IconBtn>
          {playBtn}
          <IconBtn title="Next step (→)" onClick={stepFwd}><ChevronRight size={16} /></IconBtn>
          {slider}
          <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', padding: '0 4px' }}>
            {validLabel}<span style={{ color: T.ink2, fontWeight: 600 }}>{subLabel && !isObs ? ` · ${subLabel}` : ''}</span>
          </span>
          {speedSelect}
          <IconBtn on={exp.open} title="Export a PNG, GIF or video" onClick={() => setExp((e) => ({ ...e, open: !e.open }))} style={{ width: 38, height: 38 }}><Download size={16} /></IconBtn>
        </div>
      ) : layout === 'tablet' ? (
        <div ref={botRef} style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 10, width: 'calc(100% - 20px)', maxWidth: 1060, padding: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconBtn title="Previous step" onClick={stepBack} style={{ width: 38, height: 38 }}><ChevronLeft size={17} /></IconBtn>
          {playBtn}
          <IconBtn title="Next step" onClick={stepFwd} style={{ width: 38, height: 38 }}><ChevronRight size={17} /></IconBtn>
          {slider}
          <span style={{ display: 'grid', lineHeight: 1.15, padding: '0 4px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800 }}>{validLabel}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: T.ink2 }}>{subLabel}</span>
          </span>
          <IconBtn on={regionsOpen} title="Zoom to a region" onClick={() => openPanel('regions')} style={{ width: 38, height: 38 }}><MapIcon size={16} /></IconBtn>
          {isObs && <IconBtn on={obsPanel} title="The day's extremes" onClick={() => (sidePanel ? setObsPanel(false) : openPanel('summary'))} style={{ width: 38, height: 38 }}><Star size={16} /></IconBtn>}
          <IconBtn on={exp.open} title="Export a PNG, GIF or video" onClick={() => openPanel('export')} style={{ width: 38, height: 38 }}><Download size={16} /></IconBtn>
        </div>
      ) : (
        <div ref={botRef} style={{ ...T.glass, position: 'absolute', left: 8, right: 8, bottom: 22, borderRadius: 24, padding: '6px 6px 4px', display: 'grid', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
            {playBtn}
            {slider}
            <span style={{ display: 'grid', lineHeight: 1.15, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>{validLabel.replace(/^(\w+) (\d+),/, '$1 $2 ·')}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.ink2 }}>{subLabel}</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {tool(<ChevronLeft size={18} />, 'Back', false, stepBack)}
            {tool(<ChevronRight size={18} />, 'Next', false, stepFwd)}
            {tool(<Layers size={18} />, 'Layers', mapOpen, () => openPanel('layers'), layerCount)}
            {tool(<Columns2 size={18} />, 'Compare', cmpOpen || cmp.on, () => openPanel('compare'))}
            {tool(<MapIcon size={18} />, 'Regions', regionsOpen, () => openPanel('regions'))}
            {isObs && tool(<Star size={18} />, 'Day', obsPanel, () => openPanel('summary'))}
            {tool(<Download size={18} />, 'Export', exp.open, () => openPanel('export'))}
          </div>
        </div>
      )}

      {/* phone: everything else as sheets from the bottom */}
      {phone && modeOpen && (
        <Sheet title="View" onClose={closePanels}>
          <div style={{ display: 'grid', gap: 6 }}>
            {MODE_INFO.map(([k, l, d]) => (
              <button key={k} onClick={() => setModeTo(k)} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', padding: '12px 14px', borderRadius: 14,
                background: k === mode ? T.on : T.chip, boxShadow: k === mode ? T.onShadow : 'none' }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: T.ink }}>{l}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: T.ink2, marginTop: 2 }}>{d}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {phone && varOpen && <Sheet title={timeSteps ? 'Layer' : 'Model, run and layer'} onClose={closePanels} tall>{dataBody}</Sheet>}
      {phone && mapOpen && (
        <Sheet title="Map and layers" onClose={closePanels} clear>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="md-noscroll" style={{ overflowX: 'auto' }}>{styleSeg}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{frameSeg}{smoothPill}</div>
            {layerRows}
          </div>
        </Sheet>
      )}
      {phone && cmpOpen && <Sheet title="Compare" onClose={closePanels} clear>{compareBody}</Sheet>}
      {phone && regionsOpen && <Sheet title="Zoom to" onClose={closePanels} clear>{regionList}</Sheet>}
      {phone && exp.open && (
        <Sheet title="Export" onClose={closePanels}>
          {exportBody}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}><span style={{ color: T.ink2, fontSize: 12.5 }}>Playback</span>{speedSelect}</div>
        </Sheet>
      )}
      {phone && isObs && obsPanel && summaryBody && <Sheet title={summaryTitle} note={summaryNote} onClose={closePanels} clear>{summaryBody}</Sheet>}
    </div>
    </ThemeCtx.Provider>
  );
}
