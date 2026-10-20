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
   frame in the middle IS the graphic: the same renderer draws it here and into a PNG or
   GIF, so what you frame (screen, square, wide, vertical, 4:5) is what you download. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Play, Pause, ChevronLeft, ChevronRight, Download, Film, ImageIcon, ZoomIn, ZoomOut, Maximize,
  Waves, MapPin, Search, ChevronDown, X, Layers, Star, Minus, Plus, Zap, Route, Grid3x3, Navigation, CloudSun, Cloud,
  Map as MapIcon,
} from 'lucide-react';
import {
  API, NX, NY, REGIONS, MAP_STYLES, FONT, scaleFor, loadFrame, runTag, frameCanvas, frameContours, drawScene,
  realtimeBasemap, fmtValue, download, makeGif, probFrame, loadLive, loadRoads, smoothCanvas, loadObserved, WX_NAMES, sampleFrame,
} from '@/lib/modelViewer';

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
  ['Radar & lightning', 'radar', 'Rain radar', 'radar'],
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

/* frames of one more variable of the same model run (wind direction, weather type, cloud),
   fetched the way the main layer is: made on demand, the step on screen first */
function useCompanion(model, run, v, wantStep, on) {
  const [frames, setFrames] = useState({});
  const key = on && model && run && model.variables?.includes(v) ? `${model.id}/${runTag(run.run)}/${v}` : null;
  useEffect(() => {
    setFrames({});
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
  return key ? frames : null;
}

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
/* the companion frame for a main frame: same step, or the nearest time within `tolMin` */
function companionOf(map, raw, live, tolMin = 10) {
  if (!map || !raw) return null;
  if (!live) return map[raw.head.step] || null;
  const ms = Date.parse(raw.head.valid);
  let best = null, bd = tolMin * 60e3 + 1;
  for (const k of Object.keys(map)) { const d = Math.abs(Number(k) - ms); if (d < bd) { bd = d; best = map[k]; } }
  return best;
}
const fmtThr = (v) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : v.toFixed(v < 1 ? 2 : 1));

function defaultRun(m) {
  const most = Math.max(0, ...m.runs.map((r) => r.steps.length));
  return m.runs.find((r) => r.steps.length >= 0.6 * most) || m.runs[0];
}
const runLabel = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit' }).replace(',', '') + 'Z';
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
  const [smooth, setSmooth] = useState(!!prefs.smooth);
  const [showContours, setShowContours] = useState(prefs.showContours ?? true);
  const [showCities, setShowCities] = useState(prefs.showCities ?? true);
  const [showStar, setShowStar] = useState(!!prefs.showStar);
  const [showRoads, setShowRoads] = useState(!!prefs.showRoads);
  const [showGrid, setShowGrid] = useState(!!prefs.showGrid);
  const [showArrows, setShowArrows] = useState(!!prefs.showArrows);
  const [showWx, setShowWx] = useState(!!prefs.showWx);
  const [showClouds, setShowClouds] = useState(!!prefs.showClouds);
  const [roads, setRoads] = useState(null);
  useEffect(() => { if (showRoads && !roads) loadRoads().then(setRoads).catch(() => setShowRoads(false)); }, [showRoads, roads]);
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
  const [statics, setStatics] = useState(null);
  const [fontsOk, setFontsOk] = useState(0);
  const [varOpen, setVarOpen] = useState(false);
  const [q, setQ] = useState('');
  const [mapOpen, setMapOpen] = useState(false);              // the Layers panel
  const [regionsOpen, setRegionsOpen] = useState(false);
  const [pin, setPin] = useState(null);                     // a clicked point: its value through the steps
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
  const [exp, setExp] = useState({ open: false, png: 1080, gif: 720, from: 0, to: null, busy: null });
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, modelId, varKey, liveKey, obsKey, style, frameKey, speed, smooth, showContours,
        showCities, showStar, showRoads, showGrid, showArrows, showWx, showClouds, showLightning }));
    } catch { /* private window: nothing to remember */ }
  }, [mode, modelId, varKey, liveKey, obsKey, style, frameKey, speed, smooth, showContours, showCities, showStar, showRoads, showGrid, showArrows, showWx, showClouds, showLightning]);
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
    const layers = () => Promise.all([fetch(`${API}/static/lines.json`).then((r) => r.json()), fetch(`${API}/static/cities.json`).then((r) => r.json()),
      loadImage('/logo.png').catch(() => null)])
      .then(([lines, cities, logo]) => !stop && setStatics({ lines, cities, logo }))
      .catch(() => { if (!stop) setTimeout(layers, 5000); });
    layers();
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

  /* basemap images for the chosen style, loaded on demand */
  useEffect(() => {
    const need = style === 'realtime' ? ['sat_day.jpg', 'night_lights.png'] : [MAP_STYLES[style].base];
    need.forEach((f) => !imgs[f] && loadImage(`${API}/static/${f}`).then((im) => setImgs((o) => ({ ...o, [f]: im })))
      .catch(() => { delete imgCache[`${API}/static/${f}`]; setTimeout(() => setImgs((o) => ({ ...o })), 5000); }));
  }, [style, imgs]);

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
    : isLive ? { label: liveItem.label, unit: liveItem.src === 'radar' ? 'mm/h' : NOW_UNITS[liveItem.src] ?? '' }
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

  /* fit a grid box into the frame; `tight` fills it (a re-framing), otherwise leaves room
     for the title card and the key */
  const fit = useCallback((box, tight) => {
    const R = frameRect();
    if (!R) return;
    const [x0, y0, x1, y1] = box;
    const s = Math.min(R.w / (x1 - x0), (R.h * (tight ? 1 : 0.8)) / (y1 - y0));
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (tight ? 0 : (R.h * 0.02) / s), s });
  }, [frameRect]);
  useEffect(() => { if (!view && size) fit(REGIONS.uk.box); }, [size, view, fit]);
  /* a new frame shape (or the side panel opening) keeps the same area in view */
  const lastRect = useRef(null);
  useEffect(() => {
    const R = frameRect();
    const old = lastRect.current;
    lastRect.current = R;
    if (!view || !R || !old || (old.w === R.w && old.h === R.h)) return;
    const hw = old.w / 2 / view.s, hh = old.h / 2 / view.s;
    fit([view.cx - hw, view.cy - hh, view.cx + hw, view.cy + hh], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, sidePanel, layout]);

  const basemapFor = useCallback((f) => {
    if (style === 'realtime') {
      const d = imgs['sat_day.jpg'], n = imgs['night_lights.png'];
      return d && n && f ? realtimeBasemap(d, n, Date.parse(f.head.valid)) : d || null;
    }
    return imgs[MAP_STYLES[style].base] || null;
  }, [style, imgs]);

  const disp = useCallback((f) => (isProb && f ? probFrame(f, thr, dir) : f), [isProb, thr, dir]);
  /* strikes in the hour up to a frame's time, with their age in minutes */
  const strikesAt = useCallback((ms) => {
    const out = [];
    for (const [t, gx, gy] of strikes || []) if (t <= ms && t > ms - 3600e3) out.push([gx, gy, (ms - t) / 60e3]);
    return out.sort((a, b) => b[2] - a[2]);
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
  const canClouds = isLive ? liveItem.src === 'radar' : isForecast && hasVar('tcc') && RAINY.has(varKey);
  const canGrid = !isImg && !selfArrows;
  const canStar = !isImg && !['wx', 'wdir10', 'mwd'].includes(scaleKey) && !(isLive && liveKey === 'now_wx');
  const canContours = !isImg && !!scaleFor(scaleKey).contours;
  const canLightning = isLive || isObs;
  const arrowsOn = ownArrows || (showArrows && canArrows);
  const wxOn = ownWx || (showWx && canWx);
  const cloudsOn = showClouds && canClouds;
  const fcArrows = useCompanion(fcModel, run, 'wdir10', wantStep, arrowsOn && !selfArrows);
  const fcWx = useCompanion(fcModel, run, 'wx', wantStep, wxOn && !ownWx);
  const fcCloud = useCompanion(fcModel, run, 'tcc', wantStep, cloudsOn);
  /* a direction has no colours of its own: what it moves goes underneath (wave height, wind speed) */
  const underVar = selfArrows ? (varKey === 'mwd' ? 'swh' : 'wind10') : null;
  const underMeta = underVar && hasVar(underVar) ? cat?.variables?.[underVar] : null;
  const fcUnder = useCompanion(fcModel, run, underVar, wantStep, !!underMeta);
  const lvArrows = useLiveCompanion(liveCat, 'now_wdir10', isLive && arrowsOn);
  const lvWx = useLiveCompanion(liveCat, 'now_wx', isLive && wxOn && liveKey !== 'now_wx');
  const lvCloud = useLiveCompanion(liveCat, 'sat_ir', isLive && cloudsOn);
  const smoothCache = useRef(new Map());
  const overlayCache = useRef(new Map());
  const credit = !model ? '' : isObs
    ? (['precip_total', 'rain_rate_max'].includes(obsKey) ? 'Met Office radar via AWS' : 'UKV analysis + METAR station reports')
    : isLive
    ? (liveItem.src === 'radar' ? 'Met Office radar via AWS' : liveItem.src.startsWith('now_') ? 'UKV + METAR + Met Office radar' : liveProd?.source?.startsWith('Meteosat') ? `${liveProd.source} · EUMETSAT` : 'EUMETSAT')
    : isProb
    ? `${model.label} · ${model.members} members · ${MODEL_INFO[model.id]?.[2] || 'open data'}`
    : model.id === 'ukv' ? 'UKV 2 km native grid · Met Office via AWS' : `${model.label} · ${MODEL_INFO[model.id]?.[1] || ''} · ${MODEL_INFO[model.id]?.[2] || 'open data'}`;
  const chromeFor = useCallback((f) => (f && model && vmeta ? {
    variable: underMeta ? `${vmeta.label} · colours: ${underMeta.label.toLowerCase()}` : vmeta.label, unit: underMeta ? underMeta.unit : vmeta.unit,
    valid: f.head.valid, step: f.head.step, model: model.label, runLabel: run ? runLabel(run.run) : '', logo: statics?.logo, credit,
    scale: underMeta ? scaleFor(underVar) : (isLive && liveItem.src.startsWith('sat_')) || ['wdir10', 'mwd'].includes(scaleKey) ? {} : scaleFor(scaleKey),
    dayOnly: isObs,
    metaLine: isObs ? `Observed · ${['precip_total', 'rain_rate_max'].includes(obsKey) ? 'Met Office radar' : 'UKV + station analysis'} · UK & Ireland`
      : isLive ? `${liveItem.src.startsWith('now_') ? 'UKV + METAR + radar analysis' : liveProd?.source || ''} · ${new Date(f.head.valid).toISOString().slice(11, 16)} UTC · ${liveItem.src.startsWith('now_') ? 'now' : 'observed'}` : null,
  } : null), [model, vmeta, run, scaleKey, statics, credit, isLive, isObs, obsKey, liveItem, liveProd, underMeta, underVar]);

  const layersFor = useCallback((raw) => {
    const f = disp(raw);
    const sc = scaleFor(scaleKey);
    const smoothRain = smooth && sc.discrete && f?.q && !f.prob && RAINY.has(scaleKey);
    const arrowsF = !arrowsOn || !raw ? null : selfArrows ? f : companionOf(isLive ? lvArrows : fcArrows, raw, isLive, 16);
    const wxF = !wxOn || !raw ? null : ownWx ? f : companionOf(isLive ? lvWx : fcWx, raw, isLive, 16);
    const underF = underMeta && raw ? companionOf(fcUnder, raw, false) : null;
    const cloudF = cloudsOn && raw ? companionOf(isLive ? lvCloud : fcCloud, raw, isLive, 60) : null;   // satellite runs ~30-40 min behind the radar
    const day = isObs && raw ? dayOf(Date.parse(raw.head.valid)) : null;
    const ext = day ? obsSummary[day]?.fields?.[obsKey] : null;
    return {
      style, basemap: basemapFor(raw), lines: statics?.lines, cities: showCities || wxF ? statics?.cities : null,
      data: underF ? frameCanvas(underF, underVar, colourCache.current)
        : f ? (smoothRain ? smoothCanvas(f, scaleKey, smoothCache.current) : frameCanvas(f, scaleKey, colourCache.current)) : null, smooth,
      overlay: cloudF ? { canvas: frameCanvas(cloudF, isLive ? 'sat_clouds' : 'tcc', overlayCache.current), alpha: isLive ? 0.92 : 0.7 } : null,
      roads: showRoads ? roads : null,
      grid: showGrid && canGrid && f?.q ? { frame: f, varKey: scaleKey, unit: vmeta?.unit } : null,
      arrows: arrowsF ? { frame: arrowsF } : null,
      wx: wxF ? { frame: wxF, utcMs: Date.parse(raw.head.valid) } : null,
      contours: f && showContours && canContours ? frameContours(f, scaleKey, model?.res_km, contourCache.current) : null,
      contourLabels: true, chrome: chromeFor(raw),
      star: isObs && showStar && ext?.value != null ? { at: { gx: ext.gx, gy: ext.gy, v: ext.value, place: ext.place }, unit: vmeta?.unit }
        : showStar && canStar && f?.q && !isObs ? { frame: f, unit: vmeta?.unit, floor: sc.floor } : null,
      strikes: !showLightning || !raw ? null : isLive ? (strikes ? strikesAt(Date.parse(raw.head.valid)) : null) : isObs ? obsStrikes[day] || null : null,
      strikesDaily: isObs,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp, style, basemapFor, statics, showCities, scaleKey, smooth, showContours, model, chromeFor, fontsOk, showStar, vmeta, isLive, isObs, showLightning, strikes,
    arrowsOn, wxOn, cloudsOn, lvArrows, fcArrows, lvWx, fcWx, lvCloud, fcCloud, showRoads, roads, showGrid, timeSteps, obsSummary, obsKey, obsStrikes,
    selfArrows, ownWx, canGrid, canStar, canContours, underMeta, underVar, fcUnder]);
  useEffect(() => { colourCache.current.clear(); contourCache.current.clear(); smoothCache.current.clear(); }, [thr, dir, scaleKey]);

  /* draw: the map everywhere, dimmed outside the frame, the finished graphic inside it */
  useEffect(() => {
    const c = canvasRef.current, R = frameRect();
    if (!c || !view || !R) return;
    const ctx = c.getContext('2d');
    const full = { x: 0, y: 0, w: c.width, h: c.height };
    const L = layersFor(frame);
    ctx.clearRect(0, 0, c.width, c.height);
    // the dimmed map around the frame: map and data only (roads, grid, arrows and symbols are
    // for the graphic itself, and drawing them twice doubled the cost of every pan)
    drawScene(ctx, R, view, { ...L, chrome: null, cities: null, contours: null, roads: null, grid: null, arrows: null, wx: null, star: null }, { clip: full, coarse: true });
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,12,0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    const r = 18 * (c.width / Math.max(1, stageRef.current.clientWidth));
    ctx.roundRect ? ctx.roundRect(R.x, R.y, R.w, R.h, r) : ctx.rect(R.x, R.y, R.w, R.h);
    ctx.fill('evenodd');
    ctx.restore();
    drawScene(ctx, R, view, { ...L, interacting }, { round: r });
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1, r) : ctx.rect(R.x, R.y, R.w, R.h);
    ctx.stroke();
    if (pin) {
      const dpr = c.width / Math.max(1, stageRef.current.clientWidth);
      const px = (pin.gx - view.cx) * view.s + R.x + R.w / 2, py = (pin.gy - view.cy) * view.s + R.y + R.h / 2;
      ctx.beginPath(); ctx.arc(px, py, 9 * dpr, 0, Math.PI * 2);
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 2.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#ffd23f'; ctx.fill();
    }
    ctx.restore();
  }, [view, frame, layersFor, frameRect, interacting, pin]);

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
      else if (e.key === 'Escape') { setPin(null); setVarOpen(false); setMapOpen(false); setRegionsOpen(false); setModeOpen(false); setExp((x) => ({ ...x, open: false })); }
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
  const toGrid = (clientX, clientY) => {
    const c = canvasRef.current, rr = c.getBoundingClientRect(), R = frameRect();
    const dpr = c.width / rr.width;
    const px = (clientX - rr.left) * dpr, py = (clientY - rr.top) * dpr;
    return { px, py, R, gx: (px - (R.x + R.w / 2)) / view.s + view.cx, gy: (py - (R.y + R.h / 2)) / view.s + view.cy };
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
    const { gx, gy } = toGrid(e.clientX, e.clientY);
    const v = sampleFrame(disp(frame), gx, gy);
    if (!Number.isFinite(v)) { setHover(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, v });
  };
  const onUp = (e) => {
    const p = pressAt.current;
    if (p && e.type === 'pointerup' && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5 && view) {
      const { gx, gy } = toGrid(e.clientX, e.clientY);
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
  const renderAt = useCallback((f, ctx, W, H) => {
    const R = frameRect();
    const k = W / R.w;
    drawScene(ctx, { x: 0, y: 0, w: W, h: H }, { cx: view.cx, cy: view.cy, s: view.s * k }, layersFor(f));
  }, [view, layersFor, frameRect]);
  const stamp = (s) => (isObs ? dayOf(s) : isLive ? new Date(s).toISOString().slice(0, 16).replace(/[-:]/g, '') : `T${s}`);
  const fileBase = () => (isObs ? `MyWeatherUK_observed_${obsKey}_${frameKey}` : isLive ? `MyWeatherUK_live_${liveKey}_${frameKey}`
    : `MyWeatherUK_${model.id}_${runTag(run.run)}_${isProb ? `${presetKey}_${dir}${fmtThr(thr)}` : varKey}_${frameKey}`);
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
  const exportGif = async () => {
    const lo = exp.from, hi = exp.to ?? steps.length - 1;
    const list = steps.slice(lo, hi + 1).filter((s) => frames[s]);
    if (!list.length) return;
    const [W, H] = exportSize(exp.gif);
    gifCancel.current = false;
    setExp((e) => ({ ...e, busy: 0 }));
    try {
      const blob = await makeGif({
        count: list.length, W, H, delayMs: speed, cancelled: () => gifCancel.current,
        render: (i, ctx) => renderAt(frames[list[i]], ctx, W, H),
        onProgress: (p) => setExp((e) => ({ ...e, busy: p })),
      });
      if (blob) download(blob, `${fileBase()}_${stamp(list[0])}-${stamp(list[list.length - 1])}.gif`);
    } finally {
      setExp((e) => ({ ...e, busy: null }));
    }
  };

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
  const fmtPoint = (v) => (!Number.isFinite(v) ? '—' : scaleKey === 'wx' ? WX_NAMES[Math.round(v)] ?? '—'
    : scaleKey === 'wdir10' || scaleKey === 'mwd' ? `from the ${compass(v)} · ${Math.round(v)}°` : fmtValue(v, vmeta?.unit));

  /* panels: on a phone one at a time, as sheets from the bottom; elsewhere as cards */
  const panelOpen = { data: varOpen, layers: mapOpen, regions: regionsOpen, export: exp.open, summary: obsPanel && !sidePanel, mode: modeOpen };
  const closePanels = () => {
    setVarOpen(false); setMapOpen(false); setRegionsOpen(false); setModeOpen(false);
    setExp((e) => (e.open ? { ...e, open: false } : e));
    if (!sidePanel) setObsPanel(false);
  };
  const openPanel = (name) => {
    const was = panelOpen[name];
    closePanels();
    if (was) return;
    if (name === 'data') { setQ(''); setVarOpen(true); }
    if (name === 'layers') setMapOpen(true);
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
    canContours && showContours, canStar && showStar].filter(Boolean).length;
  const styleSeg = <Seg small items={Object.entries(MAP_STYLES).map(([k, s]) => [k, s.label])} value={style} onChange={setStyle} />;
  const frameSeg = <Seg small items={Object.entries(FRAMES).map(([k, f]) => [k, f.label])} value={frameKey} onChange={setFrameKey} />;
  const smoothPill = (
    <Pill on={smooth} title={smooth ? 'Smoothed: click to see the radar and model cells as they are' : 'Cells as they are: click to smooth'} onClick={() => setSmooth((x) => !x)}>
      {smooth ? 'Smooth' : 'Pixels'}
    </Pill>
  );
  const layerRows = (
    <div style={{ display: 'grid', gap: 1 }}>
      <LayerRow icon={<MapPin size={14} />} label="Places" note={wxOn ? 'shown with the weather symbols' : null} on={showCities || wxOn} locked={wxOn} onClick={() => setShowCities((x) => !x)} />
      {canWx && <LayerRow icon={<CloudSun size={14} />} label="Weather symbols" note={ownWx ? 'part of this layer' : 'above the places; sun or moon by the real sun'} on={wxOn} locked={ownWx} onClick={() => setShowWx((x) => !x)} />}
      {canArrows && <LayerRow icon={<Navigation size={14} />} label="Wind arrows" note={ownArrows ? 'part of this layer' : 'the way the wind is blowing'} on={arrowsOn} locked={ownArrows} onClick={() => setShowArrows((x) => !x)} />}
      {canClouds && <LayerRow icon={<Cloud size={14} />} label="Cloud underneath" note={isLive ? 'satellite cloud under the radar' : 'the model’s cloud under its rain'} on={showClouds} onClick={() => setShowClouds((x) => !x)} />}
      {canLightning && <LayerRow icon={<Zap size={14} />} label="Lightning" note={isLive ? 'strikes in the hour before each frame' : 'every strike that day'} on={showLightning} onClick={() => setShowLightning((x) => !x)} />}
      <LayerRow icon={<Route size={14} />} label="Roads" note="motorways; A roads as you zoom in" on={showRoads} onClick={() => setShowRoads((x) => !x)} />
      {canGrid && <LayerRow icon={<Grid3x3 size={14} />} label="Value grid" note="the number at each point" on={showGrid} onClick={() => setShowGrid((x) => !x)} />}
      {canContours && <LayerRow icon={<Waves size={14} />} label="Contours" note="lines at set values" on={showContours} onClick={() => setShowContours((x) => !x)} />}
      {canStar && <LayerRow icon={<Star size={14} />} label={isObs ? "Star the day's extreme" : 'Star the highest value'} note={isObs ? 'with where it was' : 'in the part of the map you can see'} on={showStar} onClick={() => setShowStar((x) => !x)} />}
    </div>
  );
  const layersBtn = (
    <Pill on={mapOpen} title="Layers: places, symbols, arrows, roads, grid…" onClick={() => (narrow ? openPanel('layers') : setMapOpen((o) => !o))} icon={<Layers size={14} />}>
      Layers{layerCount ? ` · ${layerCount}` : ''}
    </Pill>
  );
  /* the models, grouped by who makes them: a picker on desktops, buttons on phones and tablets */
  const modelGroups = (list) => ['Met Office', 'ECMWF', 'NOAA'].map((g) => [g, (list || []).filter((m) => m.runs?.length && (MODEL_INFO[m.id]?.[0] || 'NOAA') === g)]).filter(([, ms]) => ms.length);
  const chooseModel = (id) => (isProb ? (setEnsId(id), setEnsRunIso(null)) : (setModelId(id), setRunIso(null)));
  const modelPicker = (list, value, onChange) => (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...sel, fontWeight: 700 }} title={model?.source || 'Model'} aria-label="Model">
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
        {model.runs.map((r) => <option key={r.run} value={r.run} style={{ color: '#111' }}>{runLabel(r.run)} · T+{r.steps[r.steps.length - 1]}</option>)}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 12, top: narrow ? 12 : 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
    </div>
  );
  const chip = (on) => ({
    border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: narrow ? 13 : 12.5, fontWeight: 600, padding: narrow ? '9px 14px' : '7px 12px', borderRadius: 999,
    color: on ? '#fff' : T.ink3,
    background: on ? (T.light ? 'linear-gradient(180deg, #4b95ff, #1f6fe0)' : 'linear-gradient(180deg, rgba(110,180,255,0.55), rgba(60,130,240,0.4))') : T.chip,
    boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,0.5)' : T.chipShadow,
  });
  const sectionTitle = (t) => <div style={{ fontSize: 10.5, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '4px 4px 7px' }}>{t}</div>;
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
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ ...sel, padding: '7px 26px 7px 10px' }} title="Playback and GIF speed" aria-label="Playback speed">
        {[120, 200, 300, 450, 650, 900, 1300, 2000].map((v) => <option key={v} value={v} style={{ color: '#111' }}>{(1000 / v).toFixed(v > 500 ? 1 : 0)} fps</option>)}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 8, top: 9, width: 13, height: 13, pointerEvents: 'none', opacity: 0.7 }} />
    </div>
  );
  const exportBody = (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <div style={{ color: T.ink2 }}>{FRAMES[frameKey].a ? FRAMES[frameKey].label : 'As framed'} · exactly as previewed</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Seg small items={[[1080, '1080p'], [2160, '4K']]} value={exp.png} onChange={(v) => setExp((x) => ({ ...x, png: v }))} />
        <button onClick={exportPng} disabled={!frame} style={{ ...sel, padding: '9px 14px', display: 'flex', gap: 6, alignItems: 'center', background: T.btn }}><ImageIcon size={14} />PNG of this step</button>
      </div>
      <div style={{ height: 1, background: T.line }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ color: T.ink2 }}>From</span>
        <select value={exp.from} onChange={(e) => setExp((x) => ({ ...x, from: Number(e.target.value) }))} style={{ ...sel, padding: '6px 10px' }} aria-label="GIF from">
          {steps.map((s, i) => <option key={s} value={i} style={{ color: '#111' }}>{stepLabel(s)}</option>)}
        </select>
        <span style={{ color: T.ink2 }}>to</span>
        <select value={exp.to ?? steps.length - 1} onChange={(e) => setExp((x) => ({ ...x, to: Number(e.target.value) }))} style={{ ...sel, padding: '6px 10px' }} aria-label="GIF to">
          {steps.map((s, i) => <option key={s} value={i} style={{ color: '#111' }}>{stepLabel(s)}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ color: T.ink2 }}>Frame</span>
        <input type="number" min={40} max={5000} step={10} value={speed} onChange={(e) => setSpeed(Math.max(40, Math.min(5000, Number(e.target.value) || 450)))}
          style={{ ...sel, width: 84, padding: '6px 10px', cursor: 'text' }} aria-label="Milliseconds per frame" />
        <span style={{ color: T.ink2 }}>ms</span>
        <Seg small items={[[540, '540p'], [720, '720p'], [1080, '1080p']]} value={exp.gif} onChange={(v) => setExp((x) => ({ ...x, gif: v }))} />
      </div>
      {exp.busy == null
        ? <button onClick={exportGif} disabled={pending > 0} style={{ ...sel, justifySelf: 'stretch', padding: '11px 14px', display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', color: pending > 0 ? T.ink2 : '#fff', background: pending > 0 ? T.chip : 'linear-gradient(180deg, rgba(110,180,255,0.75), rgba(60,130,240,0.65))' }}>
            <Film size={14} />{pending > 0 ? `GIF — waiting for ${pending} frames` : isObs ? 'GIF of the days' : isLive ? 'GIF of the last hours' : 'GIF of the run'}
          </button>
        : <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.line, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(exp.busy * 100)}%`, background: 'linear-gradient(90deg,#7cc8ff,#3d8bff)' }} /></div>
            {Math.round(exp.busy * 100)}%
            <button onClick={() => { gifCancel.current = true; }} style={{ ...sel, padding: '5px 10px' }}>Cancel</button>
          </div>}
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
    const numeric = !['wx', 'wdir10', 'mwd'].includes(scaleKey);
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
      maxHeight: `calc(100% - ${topH + botH + 10}px)`, ...pos }}>
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
            <div style={{ ...T.capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', flexShrink: 0 }}>{styleSeg}{frameSeg}{smoothPill}{layersBtn}</div>
          </>
        ) : (
          <div style={{ ...T.capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', flex: 1, minWidth: 0 }}>
            {phone ? modeBtn : modeSeg}
            {dataChip}
            {!phone && layersBtn}
          </div>
        )}
        {probBar}
      </div>

      {/* desktop: the layer picker and the layers, as cards under the top bar */}
      {layout === 'desktop' && mapOpen && card('Layers', null, () => setMapOpen(false), layerRows, { right: 10, top: topH, width: 300 })}
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

      {hover && vmeta && layout === 'desktop' && (
        <div style={{ ...T.capsule, position: 'absolute', left: hover.x, top: hover.y + 12, transform: hover.x > hover.w - 200 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
          pointerEvents: 'none', padding: '5px 11px', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {fmtPoint(hover.v)}
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

      {!exp.open && !(phone && (varOpen || mapOpen || regionsOpen || obsPanel || modeOpen)) && pinCard}

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
          <IconBtn on={exp.open} title="Export PNG / GIF" onClick={() => setExp((e) => ({ ...e, open: !e.open }))} style={{ width: 38, height: 38 }}><Download size={16} /></IconBtn>
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
          <IconBtn on={exp.open} title="Export PNG / GIF" onClick={() => openPanel('export')} style={{ width: 38, height: 38 }}><Download size={16} /></IconBtn>
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
