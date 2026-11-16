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
  PenLine, Undo2, Loader2, Play, Pause, ChevronLeft, ChevronRight, Download, Film, ImageIcon, ZoomIn, ZoomOut, Maximize,
  Waves, MapPin, ChevronDown, X, Layers, Star, Minus, Plus, Zap, Route, Grid3x3, Navigation, CloudSun, Cloud,
  Map as MapIcon, CloudLightning, Gauge, Columns2, ArrowLeftRight, TriangleAlert, Clapperboard, Snowflake, Ratio, ChevronsLeft, ChevronsRight, Link2, Share2,
} from 'lucide-react';
import {
  API, NX, NY, REGIONS, MAP_STYLES, FONT, scaleFor, loadFrame, framePool, runTag, fieldLayer, frameContours, drawScene,
  realtimeBasemap, fmtValue, download, makeGif, makeVideo, canMakeVideo, probFrame, loadLive, loadRoads, loadObserved, WX_NAMES, sampleFrame,
  lonLatToGrid, STRIKE_STYLE, GRID, setGrid, staticUrl, pressureLines, pressureCentres, splitFrame, drawPanes, withGrid, viewOnGrid, WARN_COLOURS, diffScaleKey,
  coversMap, SEE_THROUGH, setPalette, scaleSwatch, radarTypeOf, RADAR_FAMILIES,
  setTone, onWxIcons, probScaleKey, scaleRamp, DISPLAY, INK, ACCENT, familyRate, onSatTiles, SAT_CREDIT, setKeyScale,
} from '@/lib/modelViewer';
import '@/components/modeldata/strata.css';
import LayerBrowser from '@/components/modeldata/LayerBrowser';
import Timeline from '@/components/modeldata/Timeline';
import { LAYER_DESC, POPULAR, probFamily, probLine, categoryOf } from '@/lib/modelLayers';
import { withMorePlaces } from '@/lib/modelPlaces';
import { areaStats, maskCells, typedShares } from '@/lib/areaStats';
import { ESSENTIALS, MODEL_ABOUT, QUESTIONS } from '@/lib/modelHelp';
import { readFavs, writeFavs, toggleLayer, addPlace, removePlace, addCompare, removeCompare } from '@/lib/modelFavs';
import { ukZone } from '@/lib/ukZone';
import { warmCells } from '@/lib/modelGL';
import { dateWords, dateTimeWords, timeWords } from '@/lib/dateFmt';
import { countyCells, describe } from '@/lib/mapCaption';
import RegionPicker, { gridBox, loadCounties } from '@/components/modeldata/RegionPicker';
import DrawBar from '@/components/modeldata/DrawBar';
import { AirPath, CrossSection, EnsemblePlume, ModelsAtPoint, Scenarios, Sounding, TRAJ_COLOURS } from '@/components/modeldata/PointTools';
import { readDrawings, saveDrawings, shapePoints, isClosed } from '@/lib/mapDrawings';
import LongRange from '@/components/modeldata/LongRange';
import { tweenFrame } from '@/lib/modelTween';
import { GRIDS, gridOfModel, projection } from '@/lib/modelGrids';
import { useAuth } from '@/lib/AuthContext';
import { novaRecentRuns, novaRun, runName, riskAreas, RISK_KEY, londonDay } from '@/lib/novaOutlook';
import { listStudioGraphics } from '@/components/studio/studioSaves';
import { boxToLatLon } from '@/components/studio/studioGeo';
import { frostRuns, frostRunName, snowSpans, snowKeyAt, snowOverlay } from '@/lib/frostOverlay';
import { SNOW_RISK_LEVELS, SNOW_RISK_NAMES, SNOW_AMOUNT_LEVELS, cmText } from '@/lib/frostKey';

const GROUP_ORDER = ['Precipitation', 'Temperature', 'Wind & pressure', 'Cloud & visibility', 'Convection', 'Snow & ice', 'Sea & waves', 'Air quality', 'Upper air', 'Radiation & surface'];
const FRAMES = { screen: { label: 'Screen', a: null }, square: { label: '1:1', a: 1 }, wide: { label: '16:9', a: 16 / 9 }, story: { label: '9:16', a: 9 / 16 }, portrait: { label: '4:5', a: 4 / 5 } };
const SHORT_NAMES = { consensus: 'MWUK Consensus', frost: 'TCM FROST', ukv: 'UKV', mo_global: 'MO Global', ifs: 'ECMWF', aifs: 'AIFS', gfs: 'GFS', gefs_mean: 'GEFS mean', gefs_aer: 'Dust & air', ecmwf_ens: 'ECMWF ENS', aifs_ens: 'AIFS ENS', gefs: 'GEFS', icon: 'ICON-EU', icon_europe: 'ICON-EU Europe', mix: 'MWUK Mix', aigfs: 'AIGFS', gdps: 'GDPS', meps: 'HARMONIE', arpege: 'ARPEGE', arome: 'AROME', ecmwf_ensm: 'ECMWF ENS mean', aifs_ensm: 'AIFS ENS mean' };
/* who makes each model, its grid, and where the files come from (picker groups and the credit line) */
const MODEL_INFO = {
  frost: ['MyWeatherUK', '2 km', 'MyWeatherUK’s own snow model'],
  ukv: ['Met Office', '2 km', 'Met Office via AWS'], mo_global: ['Met Office', '10 km', 'Met Office via AWS'],
  ifs: ['ECMWF', '0.25°', 'ECMWF open data'], aifs: ['ECMWF', '0.25°', 'ECMWF open data'],
  gfs: ['NOAA', '0.25°', 'NOAA via AWS'], gefs_mean: ['NOAA', '0.5°', 'NOAA via AWS'], gefs_aer: ['NOAA', '0.25°', 'NOAA via AWS'],
  ecmwf_ens: ['ECMWF', '0.25°', 'ECMWF open data'], aifs_ens: ['ECMWF', '0.25°', 'ECMWF open data'], gefs: ['NOAA', '0.25°', 'NOAA via AWS'],
  /* DWD ICON-EU: the UK on the 2 km grid, or its whole area (Europe, North Africa, the eastern Atlantic) */
  icon: ['DWD', '6.5 km', 'Source: Deutscher Wetterdienst'], icon_europe: ['DWD', '6.5 km', 'Source: Deutscher Wetterdienst'],
  /* MWUK Mix: MyWeatherUK's blend of the UKV and ICON-EU on the UKV's 2 km grid (tools/modeldata/mdata/mix.py) */
  mix: ['MyWeatherUK', '2 km', 'MyWeatherUK blend of the Met Office UKV and DWD ICON-EU'],
  consensus: ['MyWeatherUK', '2 km', 'MyWeatherUK: the middle of nine models'],
  /* 15 Nov 2026: NOAA's AI GFS, Canada's GDPS (tools/modeldata/mdata/models_more.py) */
  aigfs: ['NOAA', '0.25°', 'NOAA NOMADS', 'NOAA'], gdps: ['ECCC', '15 km', 'Environment and Climate Change Canada', 'Canada'],
  /* MET Norway's MEPS: HARMONIE-AROME at 2.5 km over the Nordic countries and the Baltic (read over OPeNDAP) */
  meps: ['MET Norway', '2.5 km', 'MET Norway MEPS (HARMONIE-AROME)', 'MET Norway'],
  /* Météo-France: ARPEGE over Europe on the wide grid, AROME at 2.5 km on the UK's 2 km grid (south of 55.4°N) */
  arpege: ['Météo-France', '0.1°', 'Météo-France open data', 'Météo-France'], arome: ['Météo-France', '2.5 km', 'Météo-France open data', 'Météo-France'],
  /* the ensembles in Forecast mode: the mean of their 50 members (tools/modeldata/mdata/ensmean.py) */
  ecmwf_ensm: ['ECMWF', '0.25°', 'ECMWF open data, the mean of 50 members', 'ECMWF'], aifs_ensm: ['ECMWF', '0.25°', 'ECMWF open data, the mean of 50 members', 'ECMWF'],
};
/* a regional model's own area (west, south, east, north), brought into view when it is picked while
   the map is somewhere else: MEPS covers the Nordic countries and the Baltic only */
const MODEL_AREA = { meps: [-4, 53, 38, 72] };
/* where a model's frames are being fetched from, for the loading notices */
const fetchedFrom = (id) => MODEL_INFO[id]?.[3] || (MODEL_INFO[id]?.[0] === 'DWD' ? 'DWD' : 'AWS');
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round(deg / 22.5) % 16];
/* the viewer's settings, remembered in this browser between visits */
const PREFS_KEY = 'md-prefs-v1';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } };
const MODES = ['forecast', 'prob', 'live', 'observed', 'long'];
const OBS_PANEL_W = 320;                                    // the observed side panel, CSS px
/* the four views: [key, name, what it is] (the phone's view menu says what each one is for) */
const MODE_INFO = [
  ['forecast', 'Forecast', 'Every model and every layer, run by run'],
  ['prob', 'Chances', 'The chance of rain, wind, frost and more, from ensembles'],
  ['live', 'Live', 'Radar, satellite, lightning and the weather now'],
  ['observed', 'Observed', 'Each day’s highs, lows and totals, kept day by day'],
  ['long', 'Long range', 'The polar vortex and the MJO, weeks ahead'],
];
const MODE_SHORT = { forecast: 'Forecast', prob: 'Chances', live: 'Live', observed: 'Observed', long: 'Long range' };
/* playback speeds, in words (ms per step) */
const SPEEDS = [[2000, 'Very slow'], [1300, 'Slower'], [900, 'Slow'], [650, 'Steady'], [450, 'Normal'], [300, 'Fast'], [200, 'Faster'], [120, 'Fastest']];
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
  ['Rain & flooding', 'raining', 'Rain falling (6 h)', 'rain', 'above', 0.05, 0.05, 1, 0.05],
  ['Rain & flooding', 'moist', 'Very moist air (precipitable water)', 'pw', 'above', 30, 10, 60, 1],
  ['Snow & ice', 'snow24', 'Snowfall (24 h)', 'snow_24h', 'above', 1, 0.5, 40, 0.5],
  ['Snow & ice', 'snow_heavy', 'Heavy snow (24 h)', 'snow_24h', 'above', 10, 0.5, 60, 0.5],
  ['Snow & ice', 'snowdepth', 'Lying snow', 'snow_depth', 'above', 1, 1, 60, 1],
  ['Snow & ice', 'snowing', 'Snow falling (6 h)', 'snowing', 'above', 0.05, 0.05, 1, 0.05],
  ['Snow & ice', 'frzr', 'Freezing rain (6 h)', 'frzr', 'above', 0.05, 0.05, 1, 0.05],
  ['Snow & ice', 'icep', 'Ice pellets (6 h)', 'icep', 'above', 0.05, 0.05, 1, 0.05],
  ['Temperature', 'frost', 'Air frost', 't2', 'below', 0, -15, 10, 0.5],
  ['Temperature', 'frost_min', 'Air frost (lowest in 6 h)', 'tmin', 'below', 0, -15, 10, 0.5],
  ['Temperature', 'warm_max', 'Warmest in 6 h above', 'tmax', 'above', 20, -10, 40, 0.5],
  ['Temperature', 'muggy', 'Muggy, humid air (dew point)', 'td2', 'above', 16, 0, 25, 0.5],
  ['Temperature', 'hardfrost', 'Hard frost', 't2', 'below', -5, -20, 5, 0.5],
  ['Temperature', 'tbelow', 'Temperature below', 't2', 'below', 5, -20, 30, 0.5],
  ['Temperature', 'tabove', 'Temperature above', 't2', 'above', 20, -10, 40, 0.5],
  ['Temperature', 'heat', 'Heat', 't2', 'above', 28, 15, 40, 0.5],
  ['Storms', 'thunder', 'Thunderstorm potential (CAPE)', 'cape', 'above', 500, 50, 3000, 50],
  ['Storms', 'deeplow', 'Deep low (pressure)', 'mslp', 'below', 980, 940, 1015, 1],
  ['Storms', 'helicity', 'Rotating storms possible (helicity 0-3 km)', 'srh3', 'above', 150, 50, 600, 10],
  ['Sky & visibility', 'fog', 'Fog (visibility)', 'vis', 'below', 1, 0.2, 10, 0.1],
  ['Sky & visibility', 'clear', 'Clear skies', 'tcc', 'below', 25, 5, 80, 5],
  ['Sky & visibility', 'overcast', 'Overcast', 'tcc', 'above', 85, 50, 100, 5],
  ['Sky & visibility', 'lowcloud', 'Low cloud base (ceiling)', 'ceiling', 'below', 300, 100, 3000, 50],
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
   (the time and T+ are its own) and lib/modelTween works out its values when its layers are made.
   The frames before `a` and after `b` come along, so the motion carries on through the real frames. */
const tweenRaw = (a, b, t, ms, prev = null, next = null) => ({ ...a, head: { ...a.head, valid: new Date(ms).toISOString(), step: t < 0.5 ? a.head.step : b.head.step },
  tween: { a, b, t, span: Date.parse(b.head.valid) - Date.parse(a.head.valid), prev, next } });
/* lib/modelTween's `near` for a frame between: the frames either side (through `map`, as the layer
   being made has them) and the steps' lengths against this one's */
const validOf = (f) => (f?.head?.valid ? Date.parse(f.head.valid) : null);
function nearOf(tw, map = (f) => f) {
  if (!tw || (!tw.prev && !tw.next)) return null;
  const ta = validOf(tw.a), tb = validOf(tw.b), tp = validOf(tw.prev), tn = validOf(tw.next), span = tb - ta;
  const prev = tw.prev ? map(tw.prev) : null, next = tw.next ? map(tw.next) : null;
  return { prev, next, kp: prev && tp != null && ta > tp ? span / (ta - tp) : 0, kn: next && tn != null && tn > tb ? span / (tn - tb) : 0 };
}
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
    let alive = true, timer = 0;
    /* as the main layer's (framePool), four on their way: the main layer keeps the rest of the
       browser's six connections to the site */
    const pool = framePool({
      size: 4,
      load: (s) => loadFrame(m, rt, vv, s, ac.signal),
      near: (s) => Math.abs(s - (wantStep.current || 0)),
      got: (b) => setFrames((o) => ({ ...o, ...b })),
      failed: () => { if (alive && !timer) timer = setTimeout(poll, 2000); },
    });
    const poll = async () => {
      timer = 0;
      if (!alive) return;
      try {
        const st = await fetch(`${API}/frames/${m}/${rt}/${vv}/status?first=${Math.max(0, wantStep.current || 0)}`, { signal: ac.signal }).then((r) => r.json());
        if (!alive) return;
        setStatus((o) => (o && o.state === st.state && o.done?.length === st.done?.length && o.missing?.length === st.missing?.length ? o : st));
        pool.add(st.done || []);
        if (st.state !== 'complete' && !timer) timer = setTimeout(poll, 1200);
      } catch { if (alive && !timer) timer = setTimeout(poll, 3000); }
    };
    poll();
    return () => { alive = false; ac.abort(); pool.stop(); clearTimeout(timer); };
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
    const day = dateWords(r.run, 'en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });   // a kept formatter (lib/dateFmt): run on every render
    if (!out.length || out[out.length - 1][0] !== day) out.push([day, []]);
    out[out.length - 1][1].push(r);
  }
  return out;
};
/* a run as its list names it: when it started, how far it reaches, and whether it is the newest */
const runText = (r, runs) => `${runLabel(r.run)} · T+${r.steps[r.steps.length - 1]}${r.run === runs[0].run ? ' · latest' : ''}`;
const runOptions = (runs) => runDays(runs).map(([day, rs]) => (
  <optgroup key={day} label={day} style={{ color: '#111' }}>
    {rs.map((r) => <option key={r.run} value={r.run} style={{ color: '#111' }}>{runText(r, runs)}</option>)}
  </optgroup>
));
const runLabel = (iso) => dateTimeWords(iso, 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit' }).replace(',', '') + 'Z';
/* what the key says about a frame: the model, the run and the lead time, and the shorter version
   that a narrow window has room for */
function creditOf(m, rn, lead) {
  const when = rn ? ` · run ${runLabel(rn.run)}${lead != null ? ` · T+${lead}` : ''}` : '';
  const who = m.members ? `${m.label} · ${m.members} members` : `${m.id === 'ukv' ? 'UKV' : m.label} ${MODEL_INFO[m.id]?.[1] || ''}`.trim();
  return { credit: `${who}${when} · ${MODEL_INFO[m.id]?.[2] || 'open data'}`, creditShort: `${SHORT_NAMES[m.id] || m.label}${when}` };
}
/* the STRATA graphic's badge (15 Nov 2026): the model and its run's hour in white, the lead time in
   the accent; and the source, as the foot of the frame */
const runHour = (iso) => `${String(new Date(iso).getUTCHours()).padStart(2, '0')}Z`;
const badgeOf = (m, rn, lead) => [`${SHORT_NAMES[m.id] || m.label}${rn ? ` ${runHour(rn.run)}` : ''}`.toUpperCase(), lead != null ? `T+${lead}` : ''];
const sourceOf = (m) => MODEL_INFO[m.id]?.[2] || 'open data';
/* the next run, in words (15 Nov 2026): its hour and, once the server has seen a few of the model's
   runs land (server/modelData.js nextRuns), when it usually arrives and how long that is from now; a
   run past its usual time is 'due now', and one well past it 'later than usual' */
const ukClock = (ms) => `${timeWords(ms, 'en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })} ${ukZone(new Date(ms))}`;
function nextRunText(nr, now) {
  if (!nr?.next) return null;
  const name = runHour(nr.next);
  if (!nr.due) return { short: `next ${name}`, long: `Next run: ${name}. When its runs usually arrive is still being learned.` };
  const due = Date.parse(nr.due), left = due - now, at = ukClock(due);
  if (left > 0) {
    const m = Math.ceil(left / 60e3), h = Math.floor(m / 60), mm = m % 60;
    const wait = h ? `${h} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
    return { short: `next ${name} in ${wait}`, long: `Next run: ${name}, usually here about ${at}, in ${wait}.` };
  }
  return -left < 90 * 60e3
    ? { short: `${name} due now`, long: `Next run: ${name}, usually here about ${at}: due now.` }
    : { short: `${name} later than usual`, long: `Next run: ${name}, usually here about ${at}: later than usual.` };
}
/* The view in the address (15 Nov 2026): what is on show is read from it when the page opens (it wins
   over what was last used here) and kept in it as things change, so a copied address, or a share link
   (/m/<id>, made with a picture of the map for its preview), opens the same map.
   mode; m the model; r the run; v the layer; t the time (UTC); at = lat,lon,km across,km tall; c the
   counties outlined; area a drawn outline (lon,lat_lon,lat_...); pin = lat,lon and pn its name; cmp
   the second window's model or 'warnings', cv its layer; p, thr, dir a chance; l the live layer; o
   the observed one */
const tCompact = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '')}Z`;
const tParse = (x) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})?Z?$/.exec(x || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +(m[5] || 0)) : null; };
function readLink() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (![...q.keys()].length) return null;
    const nums = (k, n) => { const a = (q.get(k) || '').split(',').map(Number); return a.length === n && a.every(Number.isFinite) ? a : null; };
    const area = (q.get('area') || '').split('_').map((xy) => xy.split(',').map(Number)).filter((a) => a.length === 2 && a.every(Number.isFinite));
    const thr = q.get('thr') == null ? NaN : Number(q.get('thr'));
    return {
      mode: MODES.includes(q.get('mode')) ? q.get('mode') : 'forecast', m: q.get('m'), r: tParse(q.get('r')), v: q.get('v'), t: tParse(q.get('t')),
      at: nums('at', 4), c: q.get('c') ? q.get('c').split(',') : null, area: area.length >= 3 ? area : null, pin: nums('pin', 2), pn: q.get('pn'),
      cmp: q.get('cmp'), cv: q.get('cv'), p: q.get('p'), thr: Number.isFinite(thr) ? thr : null, dir: ['above', 'below'].includes(q.get('dir')) ? q.get('dir') : null,
      l: q.get('l'), o: q.get('o'),
    };
  } catch { return null; }
}
/* the line under a live layer's headline */
const liveLine = (it) => (it.src === 'radar' || it.src === 'radar_type'
  ? `The Met Office 1 km rain radar, every 15 minutes${it.src === 'radar_type' ? ', each echo typed by the UKV and the station reports' : ''}`
  : it.src.startsWith('now_') ? 'Now: the UKV corrected by the latest station reports, every 15 minutes'
    : it.src.startsWith('sat_') ? 'Meteosat imagery from EUMETSAT' : '');
const imgCache = {};
const loadImage = (src) => (imgCache[src] ||= new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));

/* ── STRATA plates (15 Nov 2026), as the motion graphics' light UI (mwuk-graphics src/strata/ui.ts):
   near-white plates with a fine ink edge and a soft shadow over the Light map, deep-navy plates over
   the dark, satellite and real-time maps; ink #0B1A31, the accent blue, and what is chosen in navy
   with white type (STRATA's chipOn). The same values reach the CSS of the layer picker and the
   timeline as --md-* variables (components/modeldata/strata.css). ── */
const BLUR = { backdropFilter: 'blur(20px) saturate(165%)', WebkitBackdropFilter: 'blur(20px) saturate(165%)' };
function mkTheme(light) {
  const glass = light ? {
    ...BLUR,
    background: 'rgba(250,252,255,0.9)',
    border: '1px solid rgba(11,26,49,0.09)',
    boxShadow: '0 1px 2px rgba(11,26,49,0.08), 0 10px 30px rgba(11,26,49,0.16)',
    color: INK,
  } : {
    ...BLUR,
    background: 'rgba(12,19,32,0.84)',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 12px 32px rgba(0,0,0,0.42)',
    color: '#F5F8FC',
  };
  const t = light ? {
    light, glass, capsule: { ...glass, borderRadius: 999 }, ink: INK, ink2: 'rgba(11,26,49,0.62)', ink3: 'rgba(11,26,49,0.84)', faint: 'rgba(11,26,49,0.42)',
    track: 'rgba(11,26,49,0.055)', trackShadow: 'inset 0 0 0 1px rgba(11,26,49,0.06)', idle: 'rgba(11,26,49,0.05)',
    on: INK, onInk: '#FFFFFF', onShadow: '0 2px 6px rgba(11,26,49,0.25)',
    chip: 'rgba(11,26,49,0.055)', chipShadow: 'none', btn: 'rgba(11,26,49,0.08)', line: 'rgba(11,26,49,0.1)', accent: ACCENT,
  } : {
    light, glass, capsule: { ...glass, borderRadius: 999 }, ink: '#F5F8FC', ink2: 'rgba(228,236,247,0.68)', ink3: 'rgba(236,242,250,0.88)', faint: 'rgba(228,236,247,0.44)',
    track: 'rgba(255,255,255,0.07)', trackShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)', idle: 'rgba(255,255,255,0.07)',
    on: '#F5F8FC', onInk: INK, onShadow: '0 2px 8px rgba(0,0,0,0.35)',
    chip: 'rgba(255,255,255,0.08)', chipShadow: 'none', btn: 'rgba(255,255,255,0.14)', line: 'rgba(255,255,255,0.12)', accent: '#4DA3FF',
  };
  t.vars = {
    '--md-ink': t.ink, '--md-sub': t.ink3, '--md-muted': t.ink2, '--md-faint': t.faint, '--md-plate': glass.background, '--md-stroke': light ? 'rgba(11,26,49,0.1)' : 'rgba(255,255,255,0.14)',
    '--md-shadow-big': light ? '0 2px 6px rgba(11,26,49,0.08), 0 24px 60px rgba(11,26,49,0.22)' : '0 24px 60px rgba(0,0,0,0.5)',
    '--md-track': t.track, '--md-track-strong': light ? 'rgba(11,26,49,0.12)' : 'rgba(255,255,255,0.16)', '--md-hover': light ? 'rgba(11,26,49,0.06)' : 'rgba(255,255,255,0.08)',
    '--md-on': t.on, '--md-on-ink': t.onInk, '--md-card': light ? '#FFFFFF' : 'rgba(255,255,255,0.05)', '--md-accent': t.accent,
    '--md-accent-soft': light ? 'rgba(10,111,219,0.09)' : 'rgba(77,163,255,0.16)', '--md-casing': light ? '#FFFFFF' : 'rgba(0,0,0,0.5)',
    '--md-line': t.line, '--md-lift': light ? 'rgba(11,26,49,0.14)' : 'rgba(0,0,0,0.4)', '--md-past': light ? 'rgba(11,26,49,0.38)' : 'rgba(255,255,255,0.5)',
    '--md-solid': light ? '#F6F8FB' : '#0E1624',                   // phones' sheets: solid, no frosted glass
  };
  t.solid = t.vars['--md-solid'];
  return t;
}
const THEMES = { dark: mkTheme(false), light: mkTheme(true) };
const ThemeCtx = React.createContext(THEMES.dark);

function Seg({ items, value, onChange, small }) {
  const t = React.useContext(ThemeCtx);
  return (
    <div style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 999, background: t.track, boxShadow: t.trackShadow }}>
      {items.map(([k, label, tip]) => {
        const on = k === value;
        return (
          <button key={k} onClick={() => onChange(k)} title={tip} aria-pressed={on} style={{
            border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: small ? 11.5 : 12.5, fontWeight: 650, letterSpacing: '-0.01em',
            padding: small ? '5px 10px' : '6px 13px', borderRadius: 999, whiteSpace: 'nowrap', transition: 'all .18s ease',
            color: on ? t.onInk : t.ink2, background: on ? t.on : 'transparent', boxShadow: on ? t.onShadow : 'none',
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
      color: on ? t.onInk : t.ink3, background: on ? t.on : t.idle, boxShadow: on ? t.onShadow : t.trackShadow, ...style,
    }}>{children}</button>
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
      <span style={{ width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', flexShrink: 0, background: on ? t.on : t.idle, boxShadow: on ? t.onShadow : 'none', color: on ? t.onInk : t.ink2 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: t.ink }}>{label}</span>
        {note && <span style={{ display: 'block', fontSize: 11, color: t.ink2, marginTop: 1 }}>{note}</span>}
      </span>
      <span style={{ width: 34, height: 20, borderRadius: 999, flexShrink: 0, position: 'relative', transition: 'background .18s',
        background: on ? t.accent : t.track, boxShadow: t.trackShadow }}>
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
      <div role="dialog" aria-modal="true" aria-label={title} style={{ ...t.glass, backdropFilter: 'none', WebkitBackdropFilter: 'none', background: t.solid,   // solid: Safari can stall scrolling in frosted panels
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 45, borderRadius: '22px 22px 0 0',
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
        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', padding: '2px 14px 18px' }}>{children}</div>
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
  const [link] = useState(readLink);          // the address the page opened with (null without one): it wins over what was saved here
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState(null);
  const [modelId, setModelId] = useState((link?.mode === 'forecast' && link.m) || prefs.modelId || 'ukv');
  const [runIso, setRunIso] = useState(null);
  const [varKey, setVarKey] = useState((link?.mode === 'forecast' && link.v) || prefs.varKey || 'precip_rate');
  const [status, setStatus] = useState(null);
  const [frames, setFrames] = useState({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(prefs.speed || 450);
  const [loopFrom, setLoopFrom] = useState(null);            // Live: the time the loop starts from (16 Nov 2026; null: the whole of it)
  /* Simple mode (15 Nov 2026, at the user's request; off unless turned on in Map): questions to start
     with, the main layers only, and the map described in words under the top bar */
  const [simple, setSimple] = useState(!!prefs.simple);
  const [nowAfter, setNowAfter] = useState(false);          // after a question: go to the step nearest now
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
  const [obsKey, setObsKey] = useState(OBS[link?.o] ? link.o : OBS[prefs.obsKey] ? prefs.obsKey : 't2_max');
  const [obsSummary, setObsSummary] = useState({});
  const [obsStrikes, setObsStrikes] = useState({});
  const [obsPanel, setObsPanel] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1000);
  const [mode, setMode] = useState(link ? link.mode : MODES.includes(prefs.mode) ? prefs.mode : 'forecast');
  const [ensId, setEnsId] = useState((link?.mode === 'prob' && link.m) || 'ecmwf_ens');
  const [ensRunIso, setEnsRunIso] = useState(null);
  const linkPreset = link?.p && PRESET[link.p] ? PRESET[link.p] : null;
  const [presetKey, setPresetKey] = useState(linkPreset ? linkPreset.key : 'gust');
  const [thr, setThr] = useState(link?.thr ?? linkPreset?.thr ?? 50);
  const [dir, setDir] = useState(link?.dir || linkPreset?.dir || 'above');
  const isProb = mode === 'prob';
  const isLive = mode === 'live';
  const isObs = mode === 'observed';
  const isLong = mode === 'long';          // Long range: the polar vortex and the MJO, as charts over the map (components/modeldata/LongRange)
  const obsItem = OBS[obsKey];
  const [liveKey, setLiveKey] = useState(LIVE[link?.l] ? link.l : LIVE[prefs.liveKey] ? prefs.liveKey : 'radar');
  const [liveCat, setLiveCat] = useState(null);
  const [strikes, setStrikes] = useState(null);
  const [showLightning, setShowLightning] = useState(prefs.showLightning ?? true);
  /* the strikes' look: coloured by age or one colour, with or without an outline */
  const [strikeStyle, setStrikeStyle] = useState(() => ({ ...STRIKE_STYLE, ...(prefs.strikeStyle || {}) }));
  const setStrikeK = (k, v) => setStrikeStyle((s) => ({ ...s, [k]: v }));
  /* the risk overlay: on, the source (a NOVA run or a saved outlook), over the day on show or a
     span of dates and times, simplified or detailed, and how strongly it is drawn */
  const { user } = useAuth() || {};
  /* (the development build only: localStorage md-dev-admin = 1 shows the admin's tools, to test them without signing in) */
  const isAdmin = user?.role === 'admin' || (import.meta.env.DEV && (() => { try { return localStorage.getItem('md-dev-admin') === '1'; } catch { return false; } })());
  const [ov, setOv] = useState(() => ({ on: false, src: 'nova', run: null, span: 'day', from: '', to: '', look: 'smooth', outlook: null, alpha: 0.85, ...(prefs.ov || {}) }));
  const setOvK = (k, v) => setOv((o) => ({ ...o, [k]: v }));
  const [ovRuns, setOvRuns] = useState(null);       // the last 48 hours' runs
  const [ovRun, setOvRun] = useState(null);         // the chosen one's manifest
  const [ovAreas, setOvAreas] = useState({});       // London day (or 'custom') -> { peak, areas } or null
  const [ovOutlooks, setOvOutlooks] = useState(null);
  const [ovErr, setOvErr] = useState(null);
  const ovOn = isAdmin && ov.on;
  /* the snow overlay (for everyone): a TCM FROST run's snow risk, or the snow it expects, over any
     layer, for the day on show, the 24 hours to the time on show, or the whole run */
  const [sn, setSn] = useState(() => ({ on: false, run: null, show: 'risk', span: 'day', look: 'smooth', alpha: 0.85, ...(prefs.sn || {}) }));
  const setSnK = (k, v) => setSn((o) => ({ ...o, [k]: v }));
  const [snRuns, setSnRuns] = useState(null);       // the last 48 hours' runs, newest first
  const [snAreas, setSnAreas] = useState({});       // span key -> { areas, peakRisk, peakCm, note } or null
  const [snErr, setSnErr] = useState(null);
  const snOn = sn.on;
  const snRun = useMemo(() => (snRuns?.length ? snRuns.find((r) => r.tag === sn.run) || snRuns[0] : null), [snRuns, sn.run]);
  const snRunKey = snRun ? `${snRun.tag}|${snRun.created}` : null;
  const snKeys = useMemo(() => new Set(snowSpans(snRun, sn.span).map((s) => s.key)), [snRunKey, sn.span]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownMsRef = useRef(null);
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
  const [cmp, setCmp] = useState(() => ({ on: false, kind: 'run', model: null, v: null, split: 'auto', swap: false, ...(prefs.cmp || {}), run: null,
    ...(link ? { on: !!link.cmp, kind: link.cmp === 'warnings' ? 'warnings' : 'run', model: link.cmp && link.cmp !== 'warnings' ? link.cmp : null, v: link.cv || null, swap: false } : {}) }));
  const setCmpK = (k, v) => setCmp((o) => ({ ...o, [k]: v }));
  const [cmpOpen, setCmpOpen] = useState(false);
  const [newRun, setNewRun] = useState(null);
  /* favourites (lib/modelFavs, 15 Nov 2026): layers starred in the picker (per view), places saved
     from a pin (in Zoom to) and comparisons saved from Compare, all kept in this browser */
  const [favs, setFavs] = useState(readFavs);
  const updFavs = (fn) => setFavs((f) => { const n = fn(f); writeFavs(n); return n; });
  const favLayers = useMemo(() => favs.layers.filter((k) => k.startsWith(`${mode}:`)).map((k) => k.slice(mode.length + 1)), [favs.layers, mode]);
  /* when each model's next run is due, and the clock the countdown runs on */
  const [nextRuns, setNextRuns] = useState({});
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(t); }, []);
  const liveItem = LIVE[liveKey];
  const liveProd = liveCat?.products?.[liveItem.src];
  const preset = PRESET[presetKey];
  /* the threshold as typed: kept as text while typing ('-', '1.'), applied whenever it is a number */
  const [thrText, setThrText] = useState('50');
  useEffect(() => { setThrText((t) => (parseFloat(t) === thr ? t : fmtThr(thr))); }, [thr]);
  const nudge = (k) => setThr((v) => Math.round((v + k * preset.step) * 1000) / 1000);
  /* The Light map (the STRATA look) is where everyone starts since the redesign of 15 Nov 2026: a choice
     saved before it (prefs without ui: 2, when Dark was the default) is put to Light once. */
  const [style, setStyle] = useState(prefs.ui === 2 && MAP_STYLES[prefs.style] ? prefs.style : 'light');
  const T = THEMES[style === 'light' ? 'light' : 'dark'];
  /* the colour scales for the map's tone (cloud as a grey veil on the light map), set during render
     like the palette, so the layers made below already use them; put back when the page closes */
  setTone(MAP_STYLES[style]?.glass === 'light' ? 'light' : 'dark');
  useEffect(() => () => setTone('dark'), []);
  const [frameKey, setFrameKey] = useState(FRAMES[prefs.frameKey] ? prefs.frameKey : 'screen');
  const [view, setView] = useState(null);
  const [fitAfter, setFitAfter] = useState(null);
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
  const [shareOpen, setShareOpen] = useState(false);          // Share: a link to this map, with its picture
  const [share, setShare] = useState(null);                  // { busy } | { url, img, title } | { err }
  const [copied, setCopied] = useState(false);
  const [pin, setPin] = useState(null);                     // a clicked point: its value through the steps
  /* a county picked from the search (components/modeldata/RegionPicker), outlined in green over the
     map, on each grid's cells; it stays until another place is picked or it is closed */
  const [hl, setHl] = useState(null);
  /* an area being drawn (15 Nov 2026): its corners on the grid, until Done makes it the outline */
  const [drawing, setDrawing] = useState(null);
  /* the admin's drawings over the map (16 Nov 2026, lib/mapDrawings): outlines in any colour, kept in
     this browser and drawn into the downloads; while the tools are open the map is drawn on, not moved */
  const [drawOn, setDrawOn] = useState(false);
  const [drawTool, setDrawTool] = useState({ kind: 'free', colour: '#ef4444', w: 5 });
  const [drawings, setDrawings] = useState(readDrawings);
  const [drawDraft, setDrawDraft] = useState(null);         // { kind, pts: grid cells, hover } while one is being drawn
  useEffect(() => { saveDrawings(drawings); }, [drawings]);
  const drawRef = useRef({});
  drawRef.current = { drawOn, drawDraft };
  /* the point and column tools (16 Nov 2026, components/modeldata/PointTools): every model at the pin, the
     members (Chances), the air above (GFS sounding), where the air came from, a cross-section, scenarios */
  const [ptool, setPtool] = useState(null);                    // { kind, lat, lon, place, ... }
  const [sectionFrom, setSectionFrom] = useState(null);      // a cross-section's first end, waiting for the second
  const [traj, setTraj] = useState(null);                    // { busy } | { data } | { err }
  const hlRings = useMemo(() => {
    if (!hl) return null;
    const out = {};
    for (const g of Object.keys(GRIDS)) {
      const P = projection(g);
      out[g] = hl.polys.flatMap((poly) => poly.map((ring) => ring.map(([lo, la]) => P.toGrid(lo, la))));
    }
    return out;
  }, [hl]);
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
  setKeyScale(phone ? 1.6 : layout === 'tablet' ? 1.2 : 1);    // keys big enough to read on a small screen (downloads match)
  const [modeOpen, setModeOpen] = useState(false);            // phones: the view menu
  const [shapeOpen, setShapeOpen] = useState(false);          // phones: the frame's shape
  const [exp, setExp] = useState({ open: false, png: 1080, gif: 720, video: 1080, fps: 60, smooth: true, from: 0, to: null, busy: null, job: null, err: null });
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ui: 2, mode, modelId, varKey, liveKey, obsKey, style, frameKey, speed, smooth, showContours,
        showCities, showStar, showRoads, showGrid, showArrows, showWx, showClouds, showLightning, strikeStyle, ov, sn, msl, wn, cmp, extras: extrasBy, layerAlpha, palette, simple }));
    } catch { /* private window: nothing to remember */ }
  }, [simple, mode, modelId, varKey, liveKey, obsKey, style, frameKey, speed, smooth, showContours, showCities, showStar, showRoads, showGrid, showArrows, showWx, showClouds, showLightning, msl,
    strikeStyle, ov, sn, wn, cmp, extrasBy, layerAlpha, palette]);

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
  /* the snow overlay's runs, fetched when it is turned on and every ten minutes while it is (a new
     run arrives every six hours) */
  useEffect(() => {
    if (!snOn) return undefined;
    let live = true;
    const get = () => frostRuns().then((rs) => {
      if (!live) return;
      setSnRuns(rs);
      setSnErr(rs.length ? null : 'No TCM FROST run on the site yet: the first is on its way.');
    }).catch((e) => live && setSnErr(e.message));
    get();
    const t = setInterval(get, 10 * 60e3);
    return () => { live = false; clearInterval(t); };
  }, [snOn]);
  /* its areas for every span of the run (so stepping and exports have each one's), the one on show
     first and then outward from it, handed to the map a few at a time */
  useEffect(() => {
    if (!snOn || !snRun) return undefined;
    let live = true;
    setSnAreas({});
    const specs = snowSpans(snRun, sn.span);
    const k0 = snowKeyAt(snRun, sn.span, shownMsRef.current);
    const i0 = Math.max(0, specs.findIndex((s) => s.key === k0));
    const order = specs.map((s, i) => [Math.abs(i - i0) + (i < i0 ? 0.5 : 0), s]).sort((a, b) => a[0] - b[0]).map(([, s]) => s);
    (async () => {
      let pend = {}, last = 0;
      for (const s of order) {
        const r = await snowOverlay(snRun, s, { show: sn.show, look: sn.look, grid: gridName });
        if (!live) return;
        pend[s.key] = r;
        if (performance.now() - last > 300) { const p = pend; pend = {}; last = performance.now(); setSnAreas((o) => ({ ...o, ...p })); }
        await new Promise((ok) => setTimeout(ok, 0));                  // the page breathes between spans
      }
      if (Object.keys(pend).length) setSnAreas((o) => ({ ...o, ...pend }));
    })().catch((e) => live && setSnErr(e.message));
    return () => { live = false; };
  }, [snOn, snRunKey, sn.show, sn.span, sn.look, gridName]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the overlays for a frame's time: the risk overlay's (the outlook, the span, or that London day's)
      and the snow overlay's, the snow on top; one object per time, so the map's layer cache holds */
  const riskFor = useMemo(() => {
    const memo = new Map();
    return (validMs) => {
      const nova = ovOn ? (ov.src === 'outlook' ? outlookShown : (ov.span === 'custom' ? ovAreas.custom : ovAreas[londonDay(validMs)])?.areas) : null;
      const sk = snOn && snRun ? snowKeyAt(snRun, sn.span, validMs) : null;
      const snow = sk ? snAreas[sk]?.areas : null;
      if (!snow?.length) return nova?.length ? { alpha: ov.alpha, areas: nova } : null;
      const k = `${nova?.length ? (ov.src === 'outlook' ? 'o' : ov.span === 'custom' ? 'c' : londonDay(validMs)) : '-'}|${sk}`;
      let hit = memo.get(k);
      if (!hit) {
        hit = { alpha: ov.alpha, areas: [...(nova || []), ...snow.map((a) => ({ ...a, alpha: sn.alpha }))] };
        memo.set(k, hit);
      }
      return hit;
    };
  }, [ovOn, ov.src, ov.span, ov.alpha, outlookShown, ovAreas, snOn, snRunKey, sn.span, sn.alpha, snAreas]); // eslint-disable-line react-hooks/exhaustive-deps
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

  /* the graphic's typefaces, so the canvas, the PNG, the GIF and the video all use them: the motion
     graphics' own Inter and Inter Tight (public/fonts, @font-face in strata.css), loaded before the
     first draw that needs them; the map is drawn again as they arrive, and as each weather icon does */
  useEffect(() => {
    const faces = ['500 20px Inter', '600 20px Inter', '650 20px Inter', '700 20px Inter', '650 20px "Inter Tight"', '760 20px "Inter Tight"'];
    Promise.all(faces.map((f) => document.fonts.load(f))).then(() => setFontsOk((n) => n + 1)).catch(() => {});
    onWxIcons(() => setFontsOk((n) => n + 1));
    onSatTiles(() => setFontsOk((n) => n + 1));                   // the Satellite map's detail tiles, as they arrive
    return () => { onWxIcons(null); onSatTiles(null); };
  }, []);

  /* catalogue + static layers */
  useEffect(() => {
    let stop = false;
    const get = () => fetch(`${API}/catalog`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalogue ${r.status}`))))
      .then((c) => { if (!stop) { setCat(c); setErr(null); } })
      .catch((e) => { if (!stop) { setErr(e.message); setTimeout(get, 15000); } });
    const next = () => fetch(`${API}/nextruns`).then((r) => (r.ok ? r.json() : null)).then((n) => { if (!stop && n) setNextRuns(n); }).catch(() => {});
    get(); next();
    const t = setInterval(() => { get(); next(); }, 2 * 60 * 1000);           // a new run shows up here within minutes of reaching AWS
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
  /* a chance is coloured by what it is about (snow in the snow-chance colours, rain in blues …) */
  const scaleKey = isObs ? obsItem.scale : isLive ? (liveItem.scale || (liveItem.src === 'radar' ? 'radar' : liveKey)) : isProb ? probScaleKey(probFamily(preset)) : varKey;

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
  /* the run named in the address, once the catalogue lists it (gone by now: the latest, at the same time) */
  const linkRun = useRef(link?.r ?? null);
  useEffect(() => {
    if (!cat || linkRun.current == null) return;
    const prob = link.mode === 'prob';
    const m = (prob ? cat.ensembles : cat.models)?.find((x) => x.id === (prob ? ensId : modelId));
    const r = m?.runs?.find((x) => Date.parse(x.run) === linkRun.current);
    linkRun.current = null;
    if (r) (prob ? setEnsRunIso : setRunIso)(r.run);
  }, [cat]);                                               // eslint-disable-line react-hooks/exhaustive-deps
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
  const lastValid = useRef(link && link.mode !== 'observed' && link.mode !== 'live' ? link.t : null);    // the address's time, to land on first
  const targetValid = useRef(null);
  const wantStep = useRef(0);
  useEffect(() => {
    targetValid.current = lastValid.current;
  }, [key]);
  useEffect(() => {
    if (!key) return undefined;
    const [m, rt, v] = key.split('/');
    const ac = new AbortController();
    let alive = true, timer = 0;
    if (targetValid.current != null) wantStep.current = Math.max(0, Math.round((targetValid.current - Date.parse(run.run)) / 3600e3));
    setFrames({}); setStatus(null); colourCache.current.clear(); contourCache.current.clear();
    /* every step the server has, the one on screen first and then outwards from it, six on their way
       at all times, the page drawn again for a handful at a time (lib/modelViewer framePool); the
       status is asked again only while the server is still making steps, or to retry a failed one */
    const pool = framePool({
      load: (s) => loadFrame(m, rt, v, s, ac.signal),
      near: (s) => Math.abs(s - wantStep.current),
      got: (b) => setFrames((o) => ({ ...o, ...b })),
      failed: () => { if (alive && !timer) timer = setTimeout(poll, 1500); },
    });
    const poll = async () => {
      timer = 0;
      if (!alive) return;
      try {
        const st = await fetch(`${API}/frames/${m}/${rt}/${v}/status?first=${Math.max(0, wantStep.current)}`, { signal: ac.signal }).then((r) => r.json());
        if (!alive) return;
        setStatus(st);
        pool.add(st.done || []);
        if (st.state !== 'complete' && !timer) timer = setTimeout(poll, 600);
      } catch { if (alive && !timer) timer = setTimeout(poll, 2000); }
    };
    poll();
    return () => { alive = false; ac.abort(); pool.stop(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);                                              // the key names the run; run.run is read with it

  const liveSrc = isLive ? liveItem.src : null;
  const liveWant = useRef(new Set());
  useEffect(() => { liveWant.current = new Set(); setFrames({}); if (liveSrc) setStatus(null); colourCache.current.clear(); }, [liveSrc]);
  useEffect(() => {
    if (!isLive || !liveProd?.times?.length || !liveProd.ext) return undefined;
    const ac = new AbortController();
    const times = liveProd.times;
    const at = wantStep.current && times.some((t) => Date.parse(t) === wantStep.current) ? wantStep.current : Date.parse(times[times.length - 1]);
    const todo = times.filter((t) => !liveWant.current.has(t));
    todo.forEach((t) => liveWant.current.add(t));
    const shown = new Set();
    /* as the forecast layers' (lib/modelViewer framePool): six on their way at all times, nearest
       the time on screen first; any not shown when this ends are asked for again next time */
    const pool = framePool({
      load: (t) => loadLive(liveItem.src, t, liveProd.ext, ac.signal),
      near: (t) => Math.abs(Date.parse(t) - at),
      got: (b) => { const add = {}; for (const t in b) { shown.add(t); add[Date.parse(t)] = b[t]; } setFrames((o) => ({ ...o, ...add })); },
      failed: (t) => liveWant.current.delete(t),
    });
    pool.add(todo);
    return () => { pool.stop(); ac.abort(); for (const t of todo) if (!shown.has(t)) liveWant.current.delete(t); };
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
  /* how long the rest will take (15 Nov 2026): the rate the steps came in over the last half-minute */
  const etaRef = useRef({ key: null, pts: [] });
  const etaSec = useMemo(() => {
    const e = etaRef.current, t = Date.now();
    if (e.key !== key) { e.key = key; e.pts = []; }
    e.pts.push([t, loadedCount]);
    e.pts = e.pts.filter(([x]) => t - x < 30000);
    const [t0, c0] = e.pts[0];
    const rate = (loadedCount - c0) / ((t - t0) / 1000), left = steps.length - loadedCount;
    return left > 0 && rate > 0 && t - t0 >= 3000 ? left / rate : null;
  }, [loadedCount, key, steps.length]);
  const etaText = etaSec == null ? null : etaSec < 60 ? `~${Math.max(5, Math.round(etaSec / 5) * 5)} s left` : `~${Math.round(etaSec / 60)} min left`;
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
  const scaleB = isProb ? probScaleKey(probFamily(preset)) : varB;
  const gridB = modelB ? gridOfModel(modelB.id) : gridName;
  /* the difference (16 Nov 2026, at the user's request): the first window minus the second, in one map,
     for the same layer or two in one unit (not types, directions or levels of risk); and the swipe,
     two windows over one frame with a line to drag between them */
  const NO_DIFF = ['wx', 'ptype', 'radar_type', 'wdir10', 'mwd', 'snow_risk', 'snow_cond', 'frost_risk', 'ice_risk', 'beaufort'];
  const unitB = cat?.variables?.[varB]?.unit;
  const canDiff = kindB === 'run' && !isProb && !!vmeta && unitB != null && vmeta.unit === unitB && !NO_DIFF.includes(scaleKey) && !NO_DIFF.includes(varB);
  const diffOn = canDiff && !!cmp.diff;
  const twoWin = !!kindB && !diffOn;
  const splitTwo = twoWin && cmp.split !== 'swipe';           // two windows side by side or stacked (a swipe keeps the whole frame)
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
        return t <= 0 ? a : t >= 1 ? b : tweenRaw(a, b, t, ms, i ? framesB[stepsB[i - 1]] || null : null, framesB[stepsB[i + 2]] || null);
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
        .then(([lines, cities, logo]) => {
          if (stop) return;
          setStaticsBy((o) => ({ ...o, [g]: { lines, cities, logo } }));
          // then the towns and villages that appear as you zoom in (lib/modelPlaces)
          withMorePlaces(cities, g).then((all) => { if (all !== cities) setStaticsBy((o) => (o[g] ? { ...o, [g]: { ...o[g], cities: all } } : o)); });
        })
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
  /* the observed day named in the address, once the days are listed */
  const linkDay = useRef(link?.mode === 'observed' ? link.t : null);
  useEffect(() => {
    if (!isObs || linkDay.current == null || !steps.length) return;
    let best = 0;
    steps.forEach((st, i) => { if (Math.abs(st - linkDay.current) < Math.abs(steps[best] - linkDay.current)) best = i; });
    linkDay.current = null;
    atLatest.current = false;
    setIdx(best);
  }, [isObs, steps]);
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
  const splitOf = useCallback((R) => splitFrame(R, cmp.split === 'auto' ? (R.w / R.h >= 0.9 ? 'cols' : 'rows') : cmp.split, Math.min(R.w, R.h) / 1080, cmp.at ?? 0.5), [cmp.split, cmp.at]);
  /* where each window is: `a` the first, `b` the second (none with one window) */
  const windowRects = useCallback(() => {
    const R = frameRect();
    if (!R) return null;
    if (!twoWin) return { R, a: R, b: null, sp: null };
    const sp = splitOf(R);
    return { R, sp, a: cmp.swap ? sp.b : sp.a, b: cmp.swap ? sp.a : sp.b };
  }, [frameRect, twoWin, splitOf, cmp.swap]);

  /* fit a grid box into the frame; `tight` fills it (a re-framing), otherwise leaves room
     for the title card and the key */
  const fit = useCallback((box, tight) => {
    const R = windowRects()?.a;
    if (!R) return;
    const [x0, y0, x1, y1] = box;
    const s = Math.min(R.w / (x1 - x0), (R.h * (tight ? 1 : 0.8)) / (y1 - y0));
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (tight ? 0 : (R.h * 0.02) / s), s });
  }, [windowRects]);
  const linkAt = useRef(link?.at || null);
  useEffect(() => {
    if (view || !size) return;
    const R = windowRects()?.a;
    if (linkAt.current && R) {
      const [lat, lon, wkm, hkm] = linkAt.current;
      linkAt.current = null;
      const [cx, cy] = projection(gridName).toGrid(lon, lat), km = GRIDS[gridName].dx / 1000;
      setView({ cx, cy, s: Math.max(0.3, Math.min(30, Math.min(R.w / Math.max(1, wkm / km), R.h / Math.max(1, hkm / km)))) });
      return;
    }
    fit(REGIONS.uk.box);
  }, [size, view, fit]);                                   // eslint-disable-line react-hooks/exhaustive-deps
  /* after a question: the step nearest the hour now (the run's own steps, once they are listed) */
  useEffect(() => {
    if (!nowAfter || !run || !steps.length || timeSteps) return;
    const t0 = Date.parse(run.run), now = Date.now();
    let best = 0;
    steps.forEach((st, k) => { if (Math.abs(t0 + st * 3600e3 - now) < Math.abs(t0 + steps[best] * 3600e3 - now)) best = k; });
    setIdx(best);
    setNowAfter(false);
  }, [nowAfter, run, steps, timeSteps]);
  useEffect(() => {
    if (!fitAfter || isLong || gridName !== gridOfModel(modelId)) return;
    fit(gridBox(fitAfter, gridName).box);
    setFitAfter(null);
  }, [fitAfter, isLong, gridName, modelId, fit]);
  /* a new frame shape (or the side panel opening) keeps the same area in view */
  const lastRect = useRef(null);
  useEffect(() => {
    const R = windowRects()?.a;
    const old = lastRect.current;
    lastRect.current = R ? { ...R, two: splitTwo } : null;
    if (!view || !R || !old || (old.w === R.w && old.h === R.h)) return;
    /* going to or from two windows keeps the map's middle and about the same amount of map: the
       UK is tall, so it sits well in half a square at a little under the old scale */
    if (old.two !== splitTwo) {
      setView({ ...view, s: Math.max(0.3, Math.min(30, view.s * Math.sqrt((R.w * R.h) / (old.w * old.h)))) });
      return;
    }
    const hw = old.w / 2 / view.s, hh = old.h / 2 / view.s;
    fit([view.cx - hw, view.cy - hh, view.cx + hw, view.cy + hh], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, sidePanel, layout, splitTwo, cmp.split]);
  /* the stage settling or being resized is not a new shape to keep the view through, only news of
     how big the frame is (the canvas has no real size at all when the page first draws) */
  useEffect(() => {
    const R = windowRects()?.a;
    if (R) lastRect.current = { ...R, two: splitTwo };
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
  const extraScale = (v) => (isObs ? OBS[v]?.scale : isLive ? LIVE[v]?.scale || (LIVE[v]?.src === 'radar' ? 'radar' : v) : isProb ? probScaleKey(probFamily(PRESET[v])) : v);
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
  /* the graphics card's program compiles while the first frames are on their way, and the map is
     drawn again once it is ready (lib/modelGL warmCells: it used to freeze the page for ~1 s) */
  useEffect(() => warmCells(bump), [bump]);
  const smoothCache = useRef(new Map());
  const overlayCache = useRef(new Map());
  /* where the live and observed layers are from (a forecast's key names its model and run) */
  const credit = !model || !timeSteps ? '' : isObs
    ? (['precip_total', 'rain_rate_max'].includes(obsKey) ? 'Met Office radar via AWS' : 'UKV analysis + METAR station reports')
    : (liveItem.src === 'radar' ? 'Met Office radar via AWS' : liveItem.src === 'radar_type' ? 'Met Office radar via AWS · type from UKV + METAR' : liveItem.src.startsWith('now_') ? 'UKV + METAR + Met Office radar' : liveProd?.source?.startsWith('Meteosat') ? `${liveProd.source} · EUMETSAT` : 'EUMETSAT');
  /* the line under the headline and the badge, for the STRATA graphic */
  const radarObs = ['precip_total', 'rain_rate_max'].includes(obsKey);
  /* the line under the headline: only the Chances' question (the user asked, 15 Nov 2026, for no short
     description under each layer's name; the badge and the source already say where it comes from) */
  const chromeSub = isProb ? probLine(preset, dir, fmtThr(thr), fmeta?.unit, model?.members) : '';
  const timeBadge = isObs ? (radarObs ? 'MET OFFICE RADAR' : 'UKV + STATIONS')
    : isLive ? (liveItem.src.startsWith('sat_') ? 'METEOSAT' : liveItem.src.startsWith('now_') ? 'UKV + STATIONS' : 'MET OFFICE RADAR') : null;
  const chromeFor = useCallback((f) => (f && model && vmeta ? {
    variable: underMeta ? `${vmeta.label} · colours: ${underMeta.label.toLowerCase()}` : vmeta.label, unit: underMeta ? underMeta.unit : vmeta.unit,
    valid: f.head.valid, logo: statics?.logo, ...(timeSteps ? { credit } : creditOf(model, run, f.head.step)),
    scale: underMeta ? scaleFor(underVar) : (isLive && liveItem.src.startsWith('sat_')) || ['wdir10', 'mwd'].includes(scaleKey) ? {} : scaleFor(scaleKey),
    dayOnly: isObs,
    sub: chromeSub, source: timeSteps ? credit : sourceOf(model),
    badge: timeSteps ? [timeBadge, isObs ? 'OBSERVED' : 'LIVE'] : badgeOf(model, run, f.head.step),
  } : null), [model, vmeta, run, scaleKey, statics, credit, isLive, isObs, liveItem, timeSteps, underMeta, underVar, chromeSub, timeBadge]);
  const metaB = !modelB ? null : isProb ? vmeta : cat?.variables?.[varB];
  /* the second window's: with nothing to show at this time, the time and a word saying why */
  const chromeForB = useCallback((f, ms) => {
    if (!modelB || !metaB || ms == null) return null;
    const lacks = !(modelB.variables || modelB.fields)?.includes(fieldB);
    const notice = lacks ? `${SHORT_NAMES[modelB.id] || modelB.label} has no ${(isProb ? preset.label : metaB.label).toLowerCase()}` : f ? null
      : stepsB.length && nearestStep(stepsB, runMsB, ms) == null ? `The ${runLabel(runB.run)} run does not cover this time` : `Fetching from ${fetchedFrom(modelB.id)}…`;
    return {
      variable: underMetaB ? `${metaB.label} · colours: ${underMetaB.label.toLowerCase()}` : metaB.label, unit: underMetaB ? underMetaB.unit : metaB.unit,
      valid: f ? f.head.valid : new Date(ms).toISOString(), logo: staticsBy[gridB]?.logo, ...creditOf(modelB, runB, f?.head.step), notice,
      scale: underMetaB ? scaleFor(underVarB) : ['wdir10', 'mwd'].includes(scaleB) ? {} : scaleFor(scaleB),
      sub: isProb ? chromeSub : '', source: sourceOf(modelB), badge: badgeOf(modelB, runB, f?.head.step),
    };
  }, [modelB, metaB, runB, runMsB, stepsB, fieldB, scaleB, isProb, preset, underMetaB, underVarB, staticsBy, gridB, chromeSub, varB]);

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

  /* the difference's frame: the first window's cells, each less the second window's value at the same
     place and time (on another grid, the second's cell under it), on a two-way scale of plus and minus
     about a quarter of the layer's range (fixed steps for the common units) */
  const DIFF_SPAN = { '°C': 8, hPa: 10, mph: 25, 'mm/h': 6, mm: 25, '%': 50, cm: 15, dam: 10, m: 500, 'J/kg': 1000, 'm/s': 12, kt: 25, 'W/m²': 200 };
  const diffKey = diffOn ? diffScaleKey(vmeta.unit, DIFF_SPAN[vmeta.unit] ?? Math.max(1, Math.round(((vmeta.hi ?? 10) - (vmeta.lo ?? 0)) / 4))) : null;
  const diffCache = useRef(new WeakMap());
  const diffMaps = useRef({});
  const diffRaw = useCallback((fa) => {
    if (!diffKey || !fa?.q) return null;
    const fb = frameBAt(Date.parse(fa.head.valid), false) || frameB;
    if (!fb?.q) return null;
    const hit = diffCache.current.get(fa);
    if (hit && hit.fb === fb && hit.key === diffKey) return hit.f;
    const span = Number(diffKey.split('|')[2]);
    const W = fa.nx || NX, H = fa.ny || NY, K = fa.nx ? fa.k || 1 : 1;
    /* where each of the first window's cells falls on the second window's grid (worked out once) */
    let map = null;
    if (gridB !== gridName) {
      const mk = `${gridName}>${gridB}|${W}|${H}|${K}`;
      if (!diffMaps.current[mk]) {
        const PA = projection(gridName), PB = projection(gridB), m = new Float32Array(W * H * 2);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const [bx, by] = PB.toGrid(...PA.fromGrid(i * K + K / 2, j * K + K / 2)); m[(j * W + i) * 2] = bx; m[(j * W + i) * 2 + 1] = by; }
        diffMaps.current = { [mk]: m };
      }
      map = diffMaps.current[mk];
    }
    const q = new Uint8Array(W * H);
    withGrid(gridB, () => {
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = j * W + i, va = fa.table[fa.q[k]];
        const vb = Number.isFinite(va) ? (map ? sampleFrame(fb, map[k * 2], map[k * 2 + 1]) : sampleFrame(fb, i * K + K / 2, j * K + K / 2)) : NaN;
        q[k] = Number.isFinite(vb) ? Math.max(0, Math.min(254, Math.round(((va - vb + span) / (2 * span)) * 254))) : 255;
      }
    });
    const table = new Float32Array(256);
    for (let v = 0; v < 255; v++) table[v] = -span + (v / 254) * 2 * span;
    table[255] = NaN;
    const f = { q, table, head: { ...fa.head, lo: -span, hi: span, scale: 'lin', var: 'diff' }, ...(fa.nx ? { nx: fa.nx, ny: fa.ny, k: fa.k } : {}) };
    diffCache.current.set(fa, { fb, key: diffKey, f });
    return f;
  }, [diffKey, frameB, frameBAt, gridB, gridName]);
  /* The layers of one frame of one window; `sync` (exports: true, or 'smooth') works the sums out at
     once instead of in the worker, `ms` is the time for a window with no frame yet. A frame part-way between two steps
     (raw.tween) is worked out here, its companion layers with it, and all that follows draws it as
     it would any frame. */
  const trajLines = useMemo(() => (traj?.data?.trajectories || []).map((tr) => ({ kind: 'arrow', colour: TRAJ_COLOURS[tr.from_p] || '#111827', w: 4,
    pts: tr.path.map(([la, lo]) => [lo, la]).reverse() })), [traj]);
  const drawLayer = useMemo(() => {
    if (!drawings.length && !drawDraft && !trajLines.length) return null;
    const P = projection(gridName);
    const pts = drawDraft ? (drawDraft.kind === 'shape' && drawDraft.hover ? [...drawDraft.pts, drawDraft.hover] : drawDraft.pts) : null;
    return { list: trajLines.length ? [...drawings, ...trajLines] : drawings, draft: drawDraft && pts?.length ? { kind: drawDraft.kind, colour: drawTool.colour, w: drawTool.w, draft: true,
      closed: drawDraft.kind === 'shape' ? false : isClosed(drawDraft.kind), pts: shapePoints(drawDraft.kind, pts, P.fromGrid) } : null };
  }, [drawings, drawDraft, drawTool, gridName, trajLines]);
  const layersFor = useCallback((P, raw, sync = false, ms = null) => {
    const tw = raw?.tween, C = P.caches, st = staticsBy[P.grid];
    const f = tw ? tweenFrame(disp(tw.a), disp(tw.b), tw.t, P.scaleKey, cellBox(disp(tw.a), tw.box), nearOf(tw, disp)) : disp(raw);
    const later = sync ? undefined : { onReady: bump };
    const sc = scaleFor(P.scaleKey);
    const comp = (map, key, tol) => {
      if (!map || !raw) return null;
      const a = companionOf(map, tw ? tw.a : raw, P.live, tol);
      if (!tw) return a;
      const b = companionOf(map, tw.b, P.live, tol);
      return a && b ? tweenFrame(a, b, tw.t, key, cellBox(a, tw.box), nearOf(tw, (r) => companionOf(map, r, P.live, tol))) : a || b;
    };
    /* the layers laid over and under this one, each at its own strength; a whole-map layer is drawn
       see-through on the maps worth seeing, so what is under it shows */
    const veil = (key) => (coversMap(key) ? SEE_THROUGH[style] ?? 1 : 1);
    const stacked = P.stack.flatMap((x) => {
      if (!raw) return [];
      const a = x.prep(extraFrameOf(x.map, tw ? tw.a : raw, x.byTime));
      const b = tw ? x.prep(extraFrameOf(x.map, tw.b, x.byTime)) : null;
      const fr = tw && a && b ? tweenFrame(a, b, tw.t, x.scale, cellBox(a, tw.box), nearOf(tw, (r) => x.prep(extraFrameOf(x.map, r, x.byTime)))) : a || b;
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
      highlight: drawing?.pts?.length > 1 && P.grid === gridName ? { rings: [drawing.pts], name: 'drawing' }
        : hlRings ? { rings: hlRings[P.grid] || [], name: hl.name } : null,
      drawings: drawLayer,
      pressure: mslF ? {
        lines: msl.isobars ? pressureLines(mslF, msl.every, P.resKm, C.pressure, later) : null,
        list: msl.symbols || msl.centres ? pressureCentres(mslF, C.centre, later) : null, symbols: msl.symbols, centres: msl.centres,
      } : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp, style, basemapFor, staticsBy, showCities, smooth, showContours, fontsOk, showStar, isObs, isLive, showLightning, strikes, showRoads, roadsBy, showGrid, obsSummary, obsKey,
    obsStrikes, strikeStyle, riskFor, gridName, wn, warningsAt, msl, bump, calcTick, layerAlpha, palette, hlRings, drawing, drawLayer]);
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
        badge: ['MET OFFICE', 'WARNINGS'],
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
    if (sp.split === 'swipe') {                           // the first over the whole frame (its title and key), the second right of the line
      const lab = (L) => L.chrome?.badge?.filter(Boolean).join(' ') || '';
      return {
        u: Math.min(R.w, R.h) / 1080, line: sp.line, split: 'swipe', labels: [lab(slots[0].L), lab(slots[1].L)],
        panes: [{ ...slots[0], rect: R, L: mark(slots[0].L, true, true) },
          { ...slots[1], rect: R, clip: { x: sp.line.x, y: R.y, w: R.x + R.w - sp.line.x, h: R.h }, L: { ...slots[1].L, chrome: null } }],
      };
    }
    return {
      u: Math.min(R.w, R.h) / 1080, line: sp.line, split: sp.split,
      panes: [{ ...slots[0], rect: sp.a, L: mark(slots[0].L, true, rows) }, { ...slots[1], rect: sp.b, L: mark(slots[1].L, differ, !rows) }],
    };
  }, [splitOf, gridName, gridB, validMs, cmp.swap, layersFor, paneA, paneB, kindB, warningLayers, frameBAt, frameB]);

  /* the difference's window: the first window's, its title and key saying what is taken from what */
  const cachesD = useMemo(() => ({ colour: new Map(), contour: new Map(), smooth: new Map(), overlay: new Map(), pressure: new Map(), centre: new Map() }), []);
  useEffect(() => { Object.values(cachesD).forEach((m) => m.clear()); }, [cachesD, diffKey, frameB]);
  const paneDiff = useMemo(() => {
    if (!diffOn || !diffKey) return null;
    const nameA = SHORT_NAMES[model.id] || model.label, nameB = SHORT_NAMES[modelB.id] || modelB.label;
    const sameModel = model.id === modelB.id;
    const what = sameModel ? `the ${runLabel(run.run)} run minus the ${runLabel(runB.run)}` : `${nameA} minus ${nameB}`;
    return { ...paneA, scaleKey: diffKey, meta: { label: vmeta.label, unit: vmeta.unit }, caches: cachesD, canContours: false, canStar: false, stack: [], underMeta: null,
      chrome: (f, ms) => { const c = paneA.chrome(f, ms); return c && { ...c, variable: `${vmeta.label}: ${what}`, scale: scaleFor(diffKey), sub: 'Red: the first is higher · blue: the second is higher' }; } };
  }, [diffOn, diffKey, paneA, cachesD, vmeta, model, modelB, run, runB]);
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
    const S = twoWin ? windowsFor(frame, R, view, false) : null;
    const L = S ? null : diffOn && paneDiff ? layersFor(paneDiff, diffRaw(frame)) : layersFor(paneA, frame);
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
    // beyond the frame: frosted on the light map, dimmed on the dark ones
    ctx.fillStyle = T.light ? 'rgba(226,234,243,0.74)' : 'rgba(3,6,12,0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    const r = 18 * (c.width / Math.max(1, stageRef.current.clientWidth));
    ctx.roundRect ? ctx.roundRect(R.x, R.y, R.w, R.h, r) : ctx.rect(R.x, R.y, R.w, R.h);
    ctx.fill('evenodd');
    ctx.restore();
    if (S) drawPanes(ctx, R, S, { round: r, cache: true, interacting });
    else drawScene(ctx, R, view, { ...L, interacting }, { round: r, cache: true });
    ctx.save();
    ctx.strokeStyle = T.light ? 'rgba(11,26,49,0.14)' : 'rgba(255,255,255,0.22)';
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
  }, [view, frame, layersFor, paneA, windowsFor, twoWin, diffOn, paneDiff, diffRaw, gridName, frameRect, interacting, pin, T]);

  /* playback */
  useEffect(() => {
    if (!playing || steps.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => {
      const lo = isLive && loopFrom != null ? Math.max(0, steps.findIndex((x) => x >= loopFrom)) : 0;
      const n = i + 1 >= steps.length || i + 1 < lo ? lo : i + 1;
      return frames[steps[n]] ? n : i;
    }), speed);
    return () => clearInterval(t);
  }, [playing, steps, frames, speed, isLive, loopFrom]);

  /* keyboard: left/right step, Home/End, space plays, + and - zoom, Esc closes panels */
  const keyRef = useRef({});
  const stepDayRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (e.defaultPrevented) return;                               // already handled (the timeline's own keys)
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || e.target?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      const { n, zoomBy: z, ok, day } = keyRef.current;
      /* only steps that have loaded, as the timeline (a blank step would make the map jump) */
      const findOk = (from, dir) => { for (let k = from; k >= 0 && k < n; k += dir) if (!ok || ok(k)) return k; return null; };
      if ((e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) || e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault(); day?.(e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : -1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); setPlaying(false);
        setIdx((i) => { const d = e.key === 'ArrowRight' ? 1 : -1; const k = findOk(Math.min(i, n) + d, d); return k == null ? i : k; });
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault(); setPlaying(false);
        setIdx((i) => { const k = e.key === 'Home' ? findOk(0, 1) : findOk(n - 1, -1); return k == null ? i : k; });
      }
      else if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === '+' || e.key === '=') z?.(1.35);
      else if (e.key === '-' || e.key === '_') z?.(1 / 1.35);
      else if (e.key === 'Escape' && (drawRef.current.drawDraft || drawRef.current.drawOn)) { if (drawRef.current.drawDraft) setDrawDraft(null); else setDrawOn(false); }
      else if (e.key === 'Escape') { setPtool(null); setSectionFrom(null); setPin(null); setHl(null); setDrawing(null); setVarOpen(false); setMapOpen(false); setCmpOpen(false); setRegionsOpen(false); setModeOpen(false); setExp((x) => ({ ...x, open: false })); }
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
  const dprOf = () => canvasRef.current.width / canvasRef.current.getBoundingClientRect().width;
  const finishShape = (pts) => {
    if (pts?.length >= 3) setDrawings((l) => [...l, { kind: 'shape', colour: drawTool.colour, w: drawTool.w, closed: true, pts: shapePoints('shape', pts, projection(gridName).fromGrid) }]);
    setDrawDraft(null);
  };
  /* the swipe's line: is the pointer on it (canvas pixels, a finger's width either side)? */
  const onSwipeLine = (clientX) => {
    if (!twoWin || cmp.split !== 'swipe') return null;
    const Wn = windowRects(), c = canvasRef.current, rr = c.getBoundingClientRect(), dpr = c.width / rr.width;
    const px = (clientX - rr.left) * dpr;
    return Wn?.sp && Math.abs(px - (Wn.sp.line.x + Wn.sp.line.w / 2)) < 22 * dpr ? { R: Wn.R, dpr, rr } : null;
  };
  const onDown = (e) => {
    const sw = pointers.current.size === 0 && !drawOn ? onSwipeLine(e.clientX) : null;
    if (sw) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gesture.current = { swipe: sw };
      return;
    }
    if (drawOn && isAdmin && view && pointers.current.size === 0 && e.button !== 2) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pressAt.current = { x: e.clientX, y: e.clientY };
      gesture.current = { draw: true, last: [e.clientX, e.clientY] };
      const at = toGrid(e.clientX, e.clientY);
      if (drawTool.kind !== 'shape') setDrawDraft({ kind: drawTool.kind, pts: [[at.gx, at.gy], [at.gx, at.gy]] });
      return;
    }
    if (gesture.current?.draw) { gesture.current = null; if (drawDraft?.kind !== 'shape') setDrawDraft(null); }   // a second finger: move and zoom instead
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
    if (gesture.current?.swipe) {
      const { R, dpr, rr } = gesture.current.swipe;
      const at = ((e.clientX - rr.left) * dpr - R.x) / R.w;
      setCmp((o) => ({ ...o, at: Math.min(0.95, Math.max(0.05, at)) }));
      return;
    }
    if (twoWin && cmp.split === 'swipe' && !pointers.current.size) e.currentTarget.style.cursor = onSwipeLine(e.clientX) ? 'ew-resize' : '';
    if (gesture.current?.draw) {
      if (pointers.current.size !== 1) return;
      const at = toGrid(e.clientX, e.clientY), g = gesture.current;
      if (drawTool.kind === 'free') {
        if (Math.hypot(e.clientX - g.last[0], e.clientY - g.last[1]) < 3) return;
        g.last = [e.clientX, e.clientY];
        setDrawDraft((d) => (d ? { ...d, pts: [...d.pts, [at.gx, at.gy]] } : d));
      } else if (drawTool.kind !== 'shape') setDrawDraft((d) => (d ? { ...d, pts: [d.pts[0], [at.gx, at.gy]] } : d));
      return;
    }
    if (drawOn && drawDraft?.kind === 'shape' && !pointers.current.size) {   // the next side, following the pointer
      const at = toGrid(e.clientX, e.clientY);
      setDrawDraft((d) => (d?.kind === 'shape' ? { ...d, hover: [at.gx, at.gy] } : d));
      return;
    }
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
    const v = at.second ? withGrid(gridB, () => sampleFrame(disp(frameB), gx, gy)) : diffOn ? sampleFrame(diffRaw(frame), gx, gy) : sampleFrame(disp(frame), gx, gy);
    if (!Number.isFinite(v) && !warn) { setHover(null); return; }
    setHover({ ...spot, text: Number.isFinite(v) ? (at.second ? fmtPoint(v, scaleB, metaB) : fmtPoint(v)) : warn, warn: Number.isFinite(v) ? warn : null });
  };
  const onUp = (e) => {
    if (gesture.current?.swipe) { pointers.current.delete(e.pointerId); gesture.current = null; pressAt.current = null; return; }
    if (gesture.current?.draw) {
      const p0 = pressAt.current, click = !!p0 && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) < 5;
      pointers.current.delete(e.pointerId);
      gesture.current = null;
      pressAt.current = null;
      if (e.type !== 'pointerup') { if (drawTool.kind !== 'shape') setDrawDraft(null); return; }
      if (drawTool.kind === 'shape') {
        if (!click) return;
        const at = toGrid(e.clientX, e.clientY);
        const pts = drawDraft?.kind === 'shape' ? drawDraft.pts : [];
        /* pressing the first corner again closes the shape */
        if (pts.length >= 3 && Math.hypot((at.gx - pts[0][0]) * view.s, (at.gy - pts[0][1]) * view.s) < 14 * dprOf()) { finishShape(pts); return; }
        setDrawDraft({ kind: 'shape', pts: [...pts, [at.gx, at.gy]] });
        return;
      }
      const d = drawDraft;
      setDrawDraft(null);
      if (d && !click && d.pts.length >= 2) {
        setDrawings((l) => [...l, { kind: d.kind, colour: drawTool.colour, w: drawTool.w, closed: isClosed(d.kind), pts: shapePoints(d.kind, d.pts, projection(gridName).fromGrid) }]);
      }
      return;
    }
    const p = pressAt.current;
    if (p && e.type === 'pointerup' && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5 && view) {
      const at = toGrid(e.clientX, e.clientY);
      /* a click in the second window is the same place, wherever it is on the first window's grid */
      const [gx, gy] = at.second && gridB !== gridName ? projection(gridName).toGrid(...projection(gridB).fromGrid(...onGridB(at))) : [at.gx, at.gy];
      if (gx >= 0 && gy >= 0 && gx < NX && gy < NY) {
        if (drawing) setDrawing((d) => ({ pts: [...(d?.pts || []), [gx, gy]] }));
        else if (sectionFrom) {
          const P = projection(gridName), [lo1, la1] = P.fromGrid(sectionFrom.gx, sectionFrom.gy), [lo2, la2] = P.fromGrid(gx, gy);
          setPtool({ kind: 'section', lat1: la1, lon1: lo1, lat2: la2, lon2: lo2, fromName: sectionFrom.name, toName: nearPlaceName(gx, gy) });
          setSectionFrom(null);
        } else setPin({ gx, gy });
      }
    }
    pressAt.current = null;
    pointers.current.delete(e.pointerId);
    gesture.current = null;
  };
  const zoomBy = (k) => { const r = canvasRef.current.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, k); };
  keyRef.current = { n: steps.length, zoomBy, ok: (k) => !!frames[steps[k]], day: (d) => stepDayRef.current?.(d) };

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
    if (twoWin) { drawPanes(ctx, out, windowsFor(f, out, v, mode)); return; }
    if (diffOn && paneDiff) { drawScene(ctx, out, v, layersFor(paneDiff, diffRaw(f?.tween ? f.tween.a : f), mode)); return; }
    if (f?.tween) f.tween.box = boxOf(out, v);
    drawScene(ctx, out, v, layersFor(paneA, f, mode));
  }), [view, layersFor, paneA, windowsFor, twoWin, diffOn, paneDiff, diffRaw, frameRect, gridName]);
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
  /* The frames of a GIF or video, timed by the clock. Every step lasts as long as the time it covers,
     so the weather moves at one steady pace (a model's three-hourly steps last three times its hourly
     ones), and how fast is set from how many steps there are: a few linger, a ten-day run moves
     briskly (4 to 30 s of motion; a GIF at most 15, to keep the file small). The first frame is held
     a moment to take in, the last a little longer. Smooth, the frames between follow at the file's
     frame rate; a GIF goes round and round, so a smooth one dissolves from its last frame to its first. */
  const motionPlan = (job, list) => {
    const fps = job === 'gif' ? GIF_FPS : exp.fps, tick = 1000 / fps, gif = job === 'gif';
    const smoothly = exp.smooth && list.length > 1;
    const gaps = [];
    for (let i = 0; i + 1 < list.length; i++) {
      const a = validOf(frames[list[i]]), b = validOf(frames[list[i + 1]]);
      gaps.push(a != null && b != null && b > a ? b - a : null);
    }
    const known = gaps.filter((g) => g != null).sort((x, y) => x - y);
    const typical = known.length ? known[known.length >> 1] : 3600e3;
    const spans = gaps.map((g) => g ?? typical);
    const total = spans.reduce((n, g) => n + g, 0) || 1;
    const length = Math.min(gif ? 15 : 30, Math.max(4, 1.4 * Math.max(1, spans.length) ** 0.62)) * 1000;   // ms of motion
    const msOf = (g) => Math.max(180, (g / total) * length);                                          // no step a blink
    const plan = [];
    const hold = (i, ms) => {
      if (gif) { plan.push({ i, t: 0, delay: Math.round(ms) }); return; }                                // a GIF frame can simply stay
      const n = Math.max(1, Math.round(ms / tick));
      for (let k = 0; k < n; k++) plan.push({ i, t: 0, same: plan.length > 0 && k > 0, delay: tick });
    };
    const end = list.length - 1;
    if (gif && !smoothly) {
      spans.forEach((g, i) => plan.push({ i, t: 0, delay: Math.round(msOf(g) + (i ? 0 : 700)) }));
      plan.push({ i: end, t: 0, delay: 1500 });
    } else {
      hold(0, 700);
      spans.forEach((g, i) => {
        const n = Math.max(1, Math.round(msOf(g) / tick));
        for (let k = 0; k < n; k++) plan.push({ i, t: smoothly ? k / n : 0, same: (!smoothly && k > 0) || (!gif && i === 0 && k === 0), delay: tick });
      });
      hold(end, gif ? 1200 : 1600);
      if (gif && smoothly) { const n = Math.round(600 / tick); for (let k = 1; k < n; k++) plan.push({ fade: k / n, delay: tick }); }
    }
    return { plan, fps, smoothly, msPer: (u) => (u / total) * length, typical };
  };
  /* how fast an export runs, said as the clock: "an hour every 0.3 s" */
  const motionPace = (job) => {
    const list = motionFrames(job);
    if (list.length < 2) return '';
    const m = motionPlan(job, list);
    /* said in the steps' own unit: a day, its hours (a 6-hourly model: "6 hours"), an hour, 10 minutes */
    const h = Math.round(m.typical / 3600e3);
    const [unit, name] = m.typical >= 20 * 3600e3 ? [864e5, 'a day'] : m.typical <= 30 * 60e3 ? [6e5, '10 minutes'] : h > 1 ? [h * 3600e3, `${h} hours`] : [3600e3, 'an hour'];
    return `${name} every ${(Math.max(180, m.msPer(unit)) / 1000).toFixed(2).replace(/0$/, '')} s`;
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
      return tweenRaw(a, b, p.t, ta + (Date.parse(b.head.valid) - ta) * p.t, p.i ? frames[list[p.i - 1]] || null : null, frames[list[p.i + 2]] || null);
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
  /* (development) the frames of a smooth export at plan positions, as JPEGs, to look at transitions */
  if (import.meta.env.DEV) {
    window.__mdPlan = (job = 'video') => { const list = motionFrames(job); const m = motionPlan(job, list); return { steps: list, n: m.plan.length, fps: m.fps, plan: m.plan.map((p) => [p.i, +(p.t || 0).toFixed(3), p.fade ?? null]) }; };
    window.__mdPlanFrames = (idx, job = 'video', short = 540) => {
      const list = motionFrames(job), { plan } = motionPlan(job, list), [W, H] = exportSize(short);
      return idx.map((k) => {
        const p = plan[k], cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const a = frames[list[p.i]];
        const raw = !p.t ? a : (() => { const b = frames[list[p.i + 1]], ta = Date.parse(a.head.valid); return tweenRaw(a, b, p.t, ta + (Date.parse(b.head.valid) - ta) * p.t, p.i ? frames[list[p.i - 1]] || null : null, frames[list[p.i + 2]] || null); })();
        renderAt(raw, cv.getContext('2d'), W, H, 'smooth');
        return cv.toDataURL('image/jpeg', 0.88);
      });
    };
  }

  /* every layer this view offers, for the layer picker (components/modeldata/LayerBrowser): its name,
     its group, one line saying what it shows, its unit, and its colours as the map draws them (in the
     tone and palette on show) */
  const browserItems = useMemo(() => {
    if (!model || !cat) return [];
    const ramp = (sk) => { try { return sk ? scaleRamp(sk) : null; } catch { return null; } };
    if (isObs) {
      return OBS_LIST.map((it) => ({ key: it.key, label: it.label, group: it.group, unit: it.unit, ramp: ramp(it.scale),
        desc: ['precip_total', 'rain_rate_max'].includes(it.key) ? 'From the Met Office radar, day by day' : 'From the UKV analysed every 15 minutes with the station reports' }));
    }
    if (isLive) {
      return LIVE_LIST.map((it) => ({ key: it.key, label: it.label, group: it.group, desc: liveLine(it),
        unit: RADARS.has(it.src) ? 'mm/h' : NOW_UNITS[it.src] ?? '', ramp: it.src.startsWith('sat_') ? null : ramp(it.scale || (it.src === 'radar' ? 'radar' : it.key)) }));
    }
    if (isProb) {
      return PRESETS.filter((pr) => model.fields.includes(pr.field)).map((pr) => {
        const unit = cat.ens_fields?.[pr.field]?.unit || '';
        return { key: pr.key, label: pr.label, group: pr.group, unit: '%', ramp: ramp(probScaleKey(probFamily(pr))),
          desc: `The chance of ${pr.dir === 'below' ? 'at most' : 'at least'} ${fmtThr(pr.thr)}${unit ? ` ${unit}` : ''}; move the slider to ask another` };
      });
    }
    const vars = model.variables.filter((k) => cat.variables[k]);
    const order = [...GROUP_ORDER, ...new Set(vars.map((k) => cat.variables[k].group).filter((g) => !GROUP_ORDER.includes(g)))];
    return order.flatMap((g) => vars.filter((k) => cat.variables[k].group === g).map((k) => ({
      key: k, label: cat.variables[k].label, group: g, unit: cat.variables[k].unit, desc: LAYER_DESC[k] || '', ramp: ['wdir10', 'mwd'].includes(k) ? null : ramp(k),
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, cat, isProb, isLive, isObs, style, palette]);
  const shownItems = useMemo(() => (simple && !isProb && !isLive && !isObs
    ? browserItems.filter((it) => ESSENTIALS.includes(it.key) || it.key === varKey) : browserItems), [simple, browserItems, isProb, isLive, isObs, varKey]);
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
    : sk === 'snow_risk' ? `${SNOW_RISK_NAMES[Math.round(v)] ?? '—'} risk of snow`
    : sk === 'snow_cond' ? `${['None', 'Very low', 'Low', 'Moderate', 'High', 'Very high'][Math.round(v)] ?? '—'} snow risk (conditions)`
    : sk === 'frost_risk' || sk === 'ice_risk' ? `${['No', 'Low', 'Moderate', 'High'][Math.round(v)] ?? '—'} ${sk === 'frost_risk' ? 'frost' : 'ice'} risk`
    : sk === 'beaufort' ? (Math.round(v) ? `Force ${Math.round(v)}` : 'Calm')
    : sk === 'ptype' || sk === 'radar_type' ? (() => { const t = radarTypeOf(v); return t ? `${RADAR_FAMILIES[t.family].name} · ${familyRate(t.family, t.rate).text}` : 'Dry'; })()
    : sk === 'wdir10' || sk === 'mwd' ? `from the ${compass(v)} · ${Math.round(v)}°` : fmtValue(v, meta?.unit));

  /* panels: on a phone one at a time, as sheets from the bottom; elsewhere as cards */
  const panelOpen = { data: varOpen, layers: mapOpen, compare: cmpOpen, regions: regionsOpen, export: exp.open, summary: obsPanel && !sidePanel, mode: modeOpen, shape: shapeOpen, share: shareOpen };
  const closePanels = () => {
    setVarOpen(false); setMapOpen(false); setCmpOpen(false); setRegionsOpen(false); setModeOpen(false); setShapeOpen(false); setShareOpen(false);
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
    if (name === 'shape') setShapeOpen(true);
    if (name === 'share') { setShareOpen(true); makeShare(); }
  };
  const ask = (qn) => {
    const ms = cat?.models || [];
    let pick = null;
    for (const v of [qn.v, qn.alt].filter(Boolean)) {
      for (const id of qn.models) { const m = ms.find((x) => x.id === id && x.runs?.length && x.variables.includes(v)); if (m) { pick = [m.id, v]; break; } }
      if (pick) break;
    }
    if (!pick) return;
    setModeTo('forecast'); setModelId(pick[0]); setRunIso(null); setVarKey(pick[1]); setNowAfter(true);
  };
  const showVortex = () => { setModeTo('forecast'); setModelId('gfs'); setRunIso(null); setVarKey('u10hpa'); setFitAfter([-180, 58, 180, 90]); };
  const setModeTo = (m) => { setMode(m); setVarOpen(false); setModeOpen(false); if (m === 'observed') setShowStar(true); };
  const layerLabel = isObs ? obsItem.label : isLive ? liveItem.label : isProb ? preset.label : vmeta?.label || 'Choose a layer';
  const liveTime = run ? new Date(run.run).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : null;
  const chipSub = !cat ? (err || 'Finding the latest runs…') : isObs ? (obsDays ? `${obsDays.length} day${obsDays.length === 1 ? '' : 's'} recorded` : 'Loading the archive…')
    : isLive ? (liveTime ? `Live · latest ${liveTime}` : 'Live · starting…')
    : model ? `${SHORT_NAMES[model.id] || model.label} · ${MODEL_INFO[model.id]?.[1] || ''}${run ? ` · run ${runLabel(run.run)}` : ''}` : 'Loading…';

  /* the layer on show as the picker's button: its category's icon on a navy badge and its name */
  const layerIcon = categoryOf((isObs ? obsItem.group : isLive ? liveItem.group : isProb ? preset.group : vmeta?.group) || '').icon;
  const layerBadge = <span className="mdb-badge" aria-hidden="true"><img src={`/icons/wx/${layerIcon}.svg`} alt="" draggable={false} /></span>;
  /* desktop: the layer as the top bar's last field, in navy: LAYER above its name, its icon beside */
  const varButton = (
    <button className="md-layer-btn md-field-layer" onClick={() => { setVarOpen((o) => !o); setQ(''); setMapOpen(false); setCmpOpen(false); }} aria-expanded={varOpen}
      aria-label={`Layer: ${layerLabel}. Choose another`} title="Choose what the map shows">
      {layerBadge}
      <span style={{ minWidth: 0 }}>
        <span className="md-field-lab">Layer</span>
        <span className="md-field-val">{layerLabel}</span>
      </span>
      <ChevronDown className="md-field-chev" />
    </button>
  );
  /* phones and tablets: one chip names the layer and where it comes from; tap for models, runs and layers */
  const dataChip = (
    <button className="md-layer-btn" onClick={() => openPanel('data')} aria-label="Choose the model, run and layer" style={{ ...sel, flex: 1, minWidth: 0, padding: '5px 12px 5px 5px', display: 'flex', alignItems: 'center', gap: 9,
      textAlign: 'left', background: varOpen ? T.btn : sel.background }}>
      {layerBadge}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layerLabel}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: err && !cat ? '#fca5a5' : T.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isLive && liveTime && <span style={{ width: 6, height: 6, borderRadius: 99, background: '#ff4d4f', boxShadow: '0 0 6px #ff4d4f', flexShrink: 0 }} />}
          {!cat && !err && <Loader2 className="animate-spin" style={{ width: 11, height: 11, flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chipSub}</span>
        </span>
      </span>
      <ChevronDown style={{ width: 16, height: 16, opacity: 0.7, flexShrink: 0, transform: varOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
    </button>
  );
  const modeSeg = <Seg items={MODE_INFO} value={mode} onChange={setModeTo} />;
  const modeBtn = (
    <button onClick={() => openPanel('mode')} aria-label="Change view" style={{ ...sel, padding: '0 10px 0 13px', height: 42, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800,
      flexShrink: 0, background: modeOpen ? T.btn : sel.background }}>
      {MODE_SHORT[mode]}<ChevronDown style={{ width: 15, height: 15, opacity: 0.7 }} />
    </button>
  );

  const layerCount = [showCities || wxOn, wxOn, arrowsOn, cloudsOn, canLightning && showLightning, showRoads, canGrid && showGrid,
    canContours && showContours, canStar && showStar, ovOn, snOn, mslOn && !ownMsl, wn.on].filter(Boolean).length + extras.length;
  const styleSeg = <Seg small items={Object.entries(MAP_STYLES).map(([k, s]) => [k, s.label])} value={style} onChange={setStyle} />;
  const frameSeg = <Seg small items={Object.entries(FRAMES).map(([k, f]) => [k, f.label])} value={frameKey} onChange={setFrameKey} />;
  const sectionTitle = (t) => <div style={{ fontSize: 10.5, fontWeight: 700, color: T.ink2, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '4px 4px 7px' }}>{t}</div>;
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
  /* the snow overlay's controls (everyone) */
  shownMsRef.current = frame?.head?.valid ? Date.parse(frame.head.valid) : null;
  const snKeyNow = snRun ? snowKeyAt(snRun, sn.span, shownMsRef.current) : null;
  const snStatus = (() => {
    if (snErr) return snErr;
    if (!snRuns) return 'Loading the runs…';
    if (!snRun || !shownMsRef.current) return null;
    if (!snKeyNow || !snKeys.has(snKeyNow)) return sn.span === 'day' ? `${dayLabel(londonDay(shownMsRef.current))} is outside this run.` : 'The time on show is outside this run.';
    if (!(snKeyNow in snAreas)) return 'Working out the snow…';
    const a = snAreas[snKeyNow];
    if (!a) return 'This run has nothing for that time yet.';
    const what = sn.span === 'day' ? dayLabel(snKeyNow.slice(1)) : sn.span === 'run' ? 'The whole run' : 'The 24 hours to then';
    const when = a.note === 'from the run’s start' || (sn.span === '24h' && a.note === 'since the run began') ? ` (${a.note})` : '';
    const risk = a.peakRisk >= 1 ? `highest risk ${SNOW_RISK_NAMES[Math.round(a.peakRisk)]}` : 'no snow risk anywhere';
    const cm = a.peakCm >= 0.2 ? `, up to ${cmText(a.peakCm)} expected` : '';
    return `${what}${when}: ${risk}${cm}.`;
  })();
  const keyChip = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: T.ink2 };
  const snControls = (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, padding: '0 8px 10px 46px' }}>
      <select value={sn.run || ''} onChange={(e) => setSnK('run', e.target.value || null)} style={field} aria-label="TCM FROST run">
        <option value="" style={{ color: '#111' }}>Latest run{snRuns?.[0] ? ` · ${frostRunName(snRuns[0])}` : ''}</option>
        {(snRuns || []).map((r) => <option key={r.tag} value={r.tag} style={{ color: '#111' }}>{frostRunName(r)} · {r.members} forecasts</option>)}
      </select>
      {/* each row no wider than the panel: three choices of time would not fit as buttons beside the indent */}
      <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
        <Seg small items={[['risk', 'Risk'], ['amount', 'Amount'], ['both', 'Both']]} value={sn.show} onChange={(v) => setSnK('show', v)} />
      </div>
      <select value={sn.span} onChange={(e) => setSnK('span', e.target.value)} style={field} aria-label="Snow overlay time">
        <option value="day" style={{ color: '#111' }}>The day on show</option>
        <option value="24h" style={{ color: '#111' }}>The 24 hours to the time on show</option>
        <option value="run" style={{ color: '#111' }}>The whole run (ten days)</option>
      </select>
      <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
        <Seg small items={[['smooth', 'Simplified'], ['detailed', 'Detailed']]} value={sn.look} onChange={(v) => setSnK('look', v)} />
      </div>
      <label style={subRow}>Strength <input type="range" min={0.3} max={1} step={0.05} value={sn.alpha} onChange={(e) => setSnK('alpha', Number(e.target.value))} style={{ flex: 1, minWidth: 90 }} /></label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {sn.show !== 'amount' && SNOW_RISK_LEVELS.map((l) => (
          <span key={l.level} title={`${l.name}: ${l.rule} in 24 hours`} style={keyChip}><i style={{ width: 12, height: 8, borderRadius: 3, background: l.colour }} />{l.name}</span>
        ))}
        {sn.show === 'amount' && SNOW_AMOUNT_LEVELS.map((b) => (
          <span key={b.cm} style={keyChip}><i style={{ width: 12, height: 8, borderRadius: 3, background: b.colour }} />{b.name}+</span>
        ))}
        {sn.show === 'both' && <span style={keyChip}><i style={{ width: 14, height: 0, borderTop: '2px solid #fff', boxShadow: '0 0 0 1px rgba(8,14,24,0.55)' }} />snow expected (1, 5, 10, 20 cm)</span>}
      </div>
      {snStatus && <div style={{ fontSize: 11, color: snErr ? '#f59e0b' : T.ink2 }}>{snStatus}</div>}
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
      <LayerRow icon={<MapPin size={14} />} label="Places" note={wxOn ? 'shown with the weather symbols' : 'more towns and villages as you zoom in (GeoNames)'} on={showCities || wxOn} locked={wxOn} onClick={() => setShowCities((x) => !x)} />
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
      <div style={{ height: 1, background: T.line, margin: '6px 4px' }} />
      <LayerRow icon={<Snowflake size={14} />} label="Snow overlay" note="TCM FROST’s snow risk or snow expected, over any layer" on={sn.on} onClick={() => setSnK('on', !sn.on)} />
      {sn.on && snControls}
      {isAdmin && (
        <>
          <div style={{ height: 1, background: T.line, margin: '6px 4px' }} />
          <LayerRow icon={<CloudLightning size={14} />} label="Risk overlay" note="TCM NOVA or your outlooks, over any layer (admins)" on={ov.on} onClick={() => setOvK('on', !ov.on)} />
          {ov.on && ovControls}
        </>
      )}
    </div>
  );
  /* the Map panel, on every device: the map's look first, then what is drawn on it, then the finer
     settings (layers over and under, the colours, smoothing) */
  const mapBody = (
    <div style={{ display: 'grid' }}>
      <div className="md-sec">
        <span className="md-sec-t">Map style</span>
        <div className="md-noscroll" style={{ overflowX: 'auto' }}>{styleSeg}</div>
        {style === 'satellite' && <span className="md-sec-n" style={{ marginTop: 0 }}>{SAT_CREDIT}</span>}
      </div>
      <div className="md-sec">
        <LayerRow icon={<Star size={14} />} label="Simple mode" note="questions to start with, the main layers only, and the map in words" on={simple} onClick={() => setSimple((x) => !x)} />
        {isAdmin && narrow && (
          <LayerRow icon={<PenLine size={14} />} label="Draw on the map" note="admin: outlines in any colour, in the downloads too" on={drawOn}
            onClick={() => { setDrawOn((o) => !o); setDrawDraft(null); closePanels(); }} />
        )}
      </div>
      <div className="md-sec">
        <span className="md-sec-t">Show on the map</span>
        {layerRows}
      </div>
      <div className="md-sec" style={{ gap: 4 }}>
        {stackControls}
        {colourControls}
        {/* only the UK grid's cells are the model's or radar's real cells: the wide grid's always interpolate */}
        {gridName === 'uk' && (
          <LayerRow icon={<Waves size={14} />} label="Smooth the data" note={smooth ? 'blended between the model and radar cells' : 'every model and radar cell as it is'}
            on={smooth} onClick={() => setSmooth((x) => !x)} />
        )}
      </div>
    </div>
  );
  /* the map's own settings (its style, what is drawn on it, the colours) behind one button, named
     plainly so it is never confused with the layer picker */
  const layersBtn = (
    <button type="button" className="md-act" aria-pressed={mapOpen} title="The map: its style, and what is drawn on it (places, warnings, lightning, roads…)"
      onClick={() => { if (narrow) openPanel('layers'); else { setCmpOpen(false); setVarOpen(false); setMapOpen((o) => !o); } }}>
      <Layers size={16} />Map{layerCount ? <span className="md-act-count" aria-label={`${layerCount} on`}>{layerCount}</span> : null}
    </button>
  );
  const compareBtn = (
    <button type="button" className="md-act" aria-pressed={cmpOpen || cmp.on} title="Two windows side by side: two runs, two models, or the warnings beside a layer"
      onClick={() => { if (narrow) openPanel('compare'); else { setMapOpen(false); setVarOpen(false); setCmpOpen((o) => !o); } }}>
      <Columns2 size={16} />Compare
    </button>
  );
  /* the models, grouped by who makes them: a picker on desktops, buttons on phones and tablets */
  const modelGroups = (list) => ['MyWeatherUK', 'Met Office', 'ECMWF', 'DWD', 'Météo-France', 'MET Norway', 'ECCC', 'NOAA'].map((g) => [g, (list || []).filter((m) => m.runs?.length && (MODEL_INFO[m.id]?.[0] || 'NOAA') === g)]).filter(([, ms]) => ms.length);
  const chooseModel = (id) => {
    if (isProb) { setEnsId(id); setEnsRunIso(null); return; }
    setModelId(id); setRunIso(null);
    /* a regional model picked while the map is elsewhere: its own area comes into view */
    const area = MODEL_AREA[id];
    if (area && gridOfModel(id) === gridName) {
      const { box } = gridBox(area, gridName);
      if (!view || view.cx < box[0] || view.cx > box[2] || view.cy < box[1] || view.cy > box[3]) fit(box);
    }
  };
  const modelText = (m) => `${SHORT_NAMES[m.id] || m.label} · ${MODEL_INFO[m.id]?.[1] || ''}`;
  const modelOptions = (list) => modelGroups(list).map(([g, ms]) => (
    <optgroup key={g} label={g} style={{ color: '#111' }}>
      {ms.map((m) => <option key={m.id} value={m.id} style={{ color: '#111' }}>{modelText(m)}</option>)}
    </optgroup>
  ));
  const modelPicker = (list, value, onChange, wide) => (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...sel, fontWeight: 700, ...(wide ? { width: '100%' } : {}) }} title={model?.source || 'Model'} aria-label={wide ? "Second window's model" : 'Model'}>
        {modelOptions(list)}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 10, top: 9, width: 14, height: 14, pointerEvents: 'none', opacity: 0.7 }} />
    </div>
  );
  /* desktop: the top bar's labelled fields. Each says what it is (MODEL, RUN) above what it holds,
     and the whole box opens its list */
  const topField = (label, text, el, title) => (
    <div className="md-field" title={title}>
      <span className="md-field-lab">{label}</span>
      <span className="md-field-size" aria-hidden="true">{text}</span>
      {el}
      <ChevronDown className="md-field-chev" />
    </div>
  );
  const statusField = (label, content) => (
    <div className="md-field is-status">
      <span className="md-field-lab">{label}</span>
      <span className="md-field-size">{content}</span>
    </div>
  );
  const modelField = (list, value) => topField('Model', model ? modelText(model) : '', (
    <select className="md-field-sel" value={value} onChange={(e) => chooseModel(e.target.value)} aria-label="Model">{modelOptions(list)}</select>
  ), model ? `${model.label} · ${MODEL_INFO[model.id]?.[2] || model.source || ''}` : 'Model');
  const nr = model && !timeSteps ? nextRunText(nextRuns[model.id], clock) : null;
  /* a newer run than the one on show: whole (green), or still arriving (amber: the page stays on the
     last whole run until most of a new one is in) */
  const newer = model && run && !timeSteps && model.runs?.[0] && Date.parse(model.runs[0].run) > Date.parse(run.run) ? model.runs[0] : null;
  /* whole: as long as the last run from the same hour (the UKV's 18Z only ever reaches T+54), or, with
     none to go by, most of the way to the longest run */
  const sameHour = newer ? model.runs.slice(1).find((r) => runHour(r.run) === runHour(newer.run)) : null;
  const newerWhole = newer && (sameHour ? newer.steps.length >= sameHour.steps.length
    : newer.steps.length >= 0.6 * Math.max(0, ...model.runs.filter((r) => !r.kept).map((r) => r.steps.length)));
  const runNote = newer
    ? <span className={`md-field-note ${newerWhole ? 'is-new' : 'is-wait'}`}><i />{newerWhole ? `newer ${runHour(newer.run)}` : `${runHour(newer.run)} arriving`}</span>
    : nr ? <span className="md-field-note">{nr.short}</span> : null;
  const runField = model && !timeSteps && run && topField(<>Run{runNote}</>, runText(run, model.runs), (
    <select className="md-field-sel" value={run.run} onChange={(e) => (isProb ? setEnsRunIso : setRunIso)(e.target.value)} aria-label="Run">{runOptions(model.runs)}</select>
  ), `When the model run started (UTC), and how far ahead it reaches.${newer ? ` A newer run, ${runLabel(newer.run)}, is ${newerWhole ? 'in the list' : 'arriving'}.` : ''}${nr ? ` ${nr.long}` : ''}`);
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
  /* what is on show, as the address's query (with the run named whenever one was picked, and always in
     a share link, whose picture is of that run) */
  const linkQuery = (withRun) => {
    if (!cat) return null;
    const q = new URLSearchParams();
    if (mode !== 'forecast') q.set('mode', mode);
    if (isLong) return q.toString();
    if (isProb) { q.set('m', ensId); q.set('p', presetKey); q.set('thr', fmtThr(thr)); q.set('dir', dir); }
    else if (isLive) q.set('l', liveKey);
    else if (isObs) q.set('o', obsKey);
    else { q.set('m', modelId); q.set('v', varKey); }
    if (!timeSteps && run && (withRun || curRunIso)) q.set('r', tCompact(Date.parse(run.run)));
    if (validMs != null && !isLive) q.set('t', tCompact(validMs));
    const R = windowRects()?.a;
    if (view && R) {
      const [lon, lat] = projection(gridName).fromGrid(view.cx, view.cy), km = GRIDS[gridName].dx / 1000;
      q.set('at', [lat.toFixed(3), lon.toFixed(3), Math.round((R.w / view.s) * km), Math.round((R.h / view.s) * km)].join(','));
    }
    if (hl) {
      if (String(hl.id).startsWith('drawn')) q.set('area', hl.polys[0][0].map(([lo, la]) => `${lo.toFixed(3)},${la.toFixed(3)}`).join('_'));
      else q.set('c', String(hl.id).split('+').join(','));
    }
    if (pin) {
      const [lo, la] = projection(gridName).fromGrid(pin.gx, pin.gy);
      q.set('pin', `${la.toFixed(4)},${lo.toFixed(4)}`);
      if (pin.label) q.set('pn', pin.label);
    }
    if (kindB === 'warnings') q.set('cmp', 'warnings');
    else if (kindB === 'run' && modelB) { q.set('cmp', modelB.id); if (cmp.v) q.set('cv', cmp.v); }
    return q.toString().replace(/%2C/g, ',');
  };
  const qNow = linkQuery(false);
  useEffect(() => {
    if (qNow == null || playing || interacting) return undefined;
    const t = setTimeout(() => {
      const url = `${window.location.pathname}${qNow ? `?${qNow}` : ''}`;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
    }, 500);
    return () => clearTimeout(t);
  }, [qNow, playing, interacting]);
  /* Share: a 1200 x 630 picture of the frame (the size link previews use) and the view's address go to
     the server, which gives back a short link (/m/<id>) that opens this map and shows that picture */
  const makeShare = async () => {
    if (!frame || !view || !cat) { setShare({ err: 'The map is still loading: try again in a moment.' }); return; }
    setShare({ busy: true }); setCopied(false);
    try {
      const cv = document.createElement('canvas');
      cv.width = 1200; cv.height = 630;
      renderAt(frame, cv.getContext('2d'), 1200, 630);
      const img = cv.toDataURL('image/jpeg', 0.84);
      const who = isObs ? 'Observed' : isLive ? 'Live' : `${SHORT_NAMES[model.id] || model.label}${isProb ? ' chances' : ''}`;
      const what = isProb ? `${layerLabel} ${dir === 'above' ? '≥' : '≤'} ${fmtThr(thr)} ${fmeta?.unit || ''}`.trim() : layerLabel;
      const title = `${who} · ${what}${validLabel ? ` · ${validLabel}` : ''}`;
      const desc = caption || (run && !timeSteps ? `Run ${runLabel(run.run)} · T+${step} · MyWeatherUK Model Data` : 'MyWeatherUK Model Data');
      const r = await fetch(`${API}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ img, q: linkQuery(true), title, desc }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || `The link could not be made (${r.status}).`);
      setShare({ url: `${window.location.origin}${d.url}`, img, title });
    } catch (e) { setShare({ err: e.message || 'The link could not be made.' }); }
  };
  const copyShare = async () => {
    try { await navigator.clipboard.writeText(share.url); setCopied(true); } catch { /* the field can be selected and copied by hand */ }
  };
  const shareBody = (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {share?.busy && <div style={{ fontSize: 12.5, color: T.ink2, display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />Making the link and its picture…</div>}
      {share?.err && <div style={{ fontSize: 12.5, color: T.light ? '#b91c1c' : '#fca5a5', lineHeight: 1.4 }}>{share.err}</div>}
      {share?.url && (
        <>
          <img src={share.img} alt="The picture shown with the link" style={{ width: '100%', aspectRatio: '1200 / 630', borderRadius: 12, display: 'block', boxShadow: T.chipShadow }} />
          <input readOnly value={share.url} onFocus={(e) => e.target.select()} aria-label="The link" style={{ ...sel, width: '100%', boxSizing: 'border-box', padding: '9px 12px', cursor: 'text' }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="md-act" onClick={copyShare}><Link2 size={15} />{copied ? 'Copied' : 'Copy link'}</button>
            {typeof navigator !== 'undefined' && navigator.share && (
              <button type="button" className="md-act" onClick={() => navigator.share({ url: share.url, title: share.title }).catch(() => {})}><Share2 size={15} />Share…</button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: T.ink2, lineHeight: 1.45 }}>
            It opens {isLive ? 'this live layer, at its latest' : isObs ? 'this observed day' : 'this model, run, layer and time'}, on this part of the map{hl ? `, with ${hl.name} outlined` : ''}{pin ? ' and the pin' : ''}. Posted or sent in a message, it shows this picture.
          </div>
        </>
      )}
    </div>
  );
  /* a comparison as saved: the first window's model and layer, and the second window's choices (never
     the runs, so a saved comparison always opens on the latest) */
  const cmpSavable = !isProb && !timeSteps && cmp.on && model && (kindB === 'warnings' || modelB);
  const cmpNow = cmpSavable ? {
    name: `${SHORT_NAMES[model.id] || model.label} ${layerLabel} vs ${kindB === 'warnings' ? 'warnings'
      : `${SHORT_NAMES[modelB.id] || modelB.label} ${(cmp.v && modelB.variables.includes(cmp.v) ? cat?.variables?.[cmp.v]?.label : null) || layerLabel}`}`,
    modelId: model.id, varKey, cmp: { kind: cmp.kind, model: cmp.model, v: cmp.v, split: cmp.split, swap: cmp.swap },
  } : null;
  const cmpSaved = !!cmpNow && favs.compares.some((c) => c.name === cmpNow.name);
  const openCompare = (c) => {
    chooseModel(c.modelId);
    setVarKey(c.varKey);
    setCmp((o) => ({ ...o, ...c.cmp, on: true, run: null }));
  };
  const compareBody = (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <LayerRow icon={<Columns2 size={14} />} label="Two windows" note="in one frame, with a white line between them" on={cmp.on} onClick={() => setCmpK('on', !cmp.on)} />
      {cmp.on && (
        <div style={{ display: 'grid', gap: 10, padding: '0 8px 4px', gridTemplateColumns: 'minmax(0, 1fr)' }}>
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
          {kindB === 'run' && !isProb && (
            <LayerRow icon={<Minus size={14} />} label="Show the difference" on={diffOn} onClick={() => canDiff && setCmpK('diff', !cmp.diff)}
              note={canDiff ? 'one map: the first window minus the second (red where the first is higher)' : 'needs the same kind of layer in both windows'} />
          )}
          {!diffOn && spec('Layout', <Seg small items={[['auto', 'Auto'], ['cols', 'Side by side'], ['rows', 'Stacked'], ['swipe', 'Swipe']]} value={cmp.split} onChange={(v) => setCmpK('split', v)} />)}
          {!diffOn && cmp.split === 'swipe' && <div style={{ fontSize: 11.5, color: T.ink2, lineHeight: 1.4 }}>Drag the white line across the map to show more of one window or the other.</div>}
          <button onClick={() => setCmpK('swap', !cmp.swap)} style={{ ...sel, justifySelf: 'start', padding: '7px 12px', display: 'flex', gap: 6, alignItems: 'center', background: T.btn }}><ArrowLeftRight size={13} />Swap the windows</button>
          {kindB === 'run' && pendingB > 0 && <div style={{ fontSize: 11, color: T.ink2, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />Fetching the second window from {fetchedFrom(modelB?.id)} · {pendingB} to go</div>}
          {cmpSavable && (
            <button onClick={() => updFavs((f) => addCompare(f, cmpNow))} disabled={cmpSaved}
              style={{ ...sel, justifySelf: 'start', padding: '7px 12px', display: 'flex', gap: 6, alignItems: 'center', background: T.btn, opacity: cmpSaved ? 0.7 : 1, cursor: cmpSaved ? 'default' : 'pointer' }}>
              <Star size={13} fill={cmpSaved ? '#f59e0b' : 'none'} style={{ color: cmpSaved ? '#d97706' : undefined }} />{cmpSaved ? 'Saved in your comparisons' : 'Save this comparison'}
            </button>
          )}
        </div>
      )}
      {!isProb && !timeSteps && favs.compares.length > 0 && (
        <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'minmax(0, 1fr)', borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 650, color: T.ink2, padding: '0 8px' }}>Your comparisons</span>
          {favs.compares.map((c, i) => (
            <div key={`${c.name}${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" className="md-act" onClick={() => openCompare(c)} title="Open this comparison (latest runs)"
                style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', cursor: 'pointer', background: 'transparent', color: T.ink, fontFamily: FONT, fontSize: 12.5, fontWeight: 650,
                  padding: '7px 8px', borderRadius: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</button>
              <IconBtn title="Forget this comparison" onClick={() => updFavs((f) => removeCompare(f, i))} style={{ width: 26, height: 26 }}><X size={12} /></IconBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  /* a chip: what is chosen in navy with white type, as STRATA's chips */
  const chip = (on) => ({
    border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: narrow ? 13 : 12.5, fontWeight: 620, padding: narrow ? '9px 14px' : '7px 12px', borderRadius: 999,
    color: on ? T.onInk : T.ink3, background: on ? T.on : T.chip, boxShadow: on ? T.onShadow : T.chipShadow,
  });
  const pickVar = (k) => { if (isObs) setObsKey(k); else if (isLive) setLiveKey(k); else if (isProb) choosePreset(k); else setVarKey(k); setVarOpen(false); };
  const pickerNote = !model ? '' : simple && !isProb && !isLive && !isObs ? 'Simple mode: the main layers. Turn it off in Map to see all of them.' : isObs
    ? "Each day's highs, lows and totals across the UK and Ireland, kept from 20 October 2026 onwards: step back through the days on the timeline. Temperature, wind, pressure and humidity come from a 15-minute analysis that starts from the Met Office UKV model and is pulled to what the airport weather stations (METAR) measured; rainfall is the Met Office radar's own total."
    : isLive
      ? "Live, observed: Met Office 1 km rain radar every 15 minutes (AWS), Meteosat-12 imagery every 10 minutes and Meteosat 0° every 15 (EUMETSAT), lightning from the Met Office LEELA network. 'Now' layers are a 15-minute analysis: the Met Office UKV model corrected to the UK and Irish airport weather reports (METAR), with the radar's rain and LEELA lightning for the weather symbols."
      : isProb
        ? `${model.label}: ${model.members} members. The chance is the share of members past your threshold, so drag the slider to ask a different question. Flooding uses 24 h rain or ECMWF runoff (wet ground runs off more); it is a signal, not a river forecast.`
        : model.source;
  /* phones and tablets: the model and the run, above the layers in the picker */
  /* (two labelled pickers, MODEL and RUN, side by side: the device's own lists, which always scroll,
     where a row of chips had to be swiped sideways) */
  const modelRunRow = cat && !timeSteps && (
    <div className="mdb-fields">
      {isProb ? modelField(cat.ensembles, ensId) : modelField(cat.models, modelId)}
      {runField}
    </div>
  );
  /* the layer picker, where it opens */
  const browser = (pos, extra) => (
    <LayerBrowser items={shownItems} popular={isProb || timeSteps || simple ? [] : POPULAR} selected={isObs ? obsKey : isLive ? liveKey : isProb ? presetKey : varKey}
      modelAbout={model && MODEL_ABOUT[model.id] ? { name: SHORT_NAMES[model.id] || model.label, text: `${MODEL_ABOUT[model.id]}${nr ? ` ${nr.long}` : ''}` } : null}
      favs={favLayers} onFav={(k) => updFavs((f) => toggleLayer(f, `${mode}:${k}`))}
      onPick={pickVar} onClose={closePanels} layout={layout} style={pos} query={q} setQuery={setQ} note={pickerNote} extra={extra}
      title={isObs ? 'Observed' : isLive ? 'Live' : isProb ? 'Chances' : 'Layers'}
      subtitle={!model ? '' : isProb ? `${model.label} · ${model.members} members` : timeSteps ? chipSub
        : `${SHORT_NAMES[model.id] || model.label} · ${MODEL_INFO[model.id]?.[1] || ''} · ${browserItems.length} layers`} />
  );
  /* several counties outlined together: one outline, its name the counties' names */
  const joinAreas = (a, b) => {
    if (!a) return b;
    const names = [...(a.names || [a.name]), b.name];
    return {
      id: `${a.id}+${b.id}`, names, name: names.length > 3 ? `${names.slice(0, 2).join(' + ')} + ${names.length - 2} more` : names.join(' + '),
      polys: [...a.polys, ...b.polys],
      bbox: [Math.min(a.bbox[0], b.bbox[0]), Math.min(a.bbox[1], b.bbox[1]), Math.max(a.bbox[2], b.bbox[2]), Math.max(a.bbox[3], b.bbox[3])],
    };
  };
  /* the area drawn: its corners as lon/lat, outlined like a county */
  const finishDrawing = () => {
    const pts = drawing?.pts || [];
    setDrawing(null);
    if (pts.length < 3) return;
    const P = projection(gridName);
    const ring = pts.map(([x, y]) => P.fromGrid(x, y));
    const lons = ring.map((r) => r[0]), lats = ring.map((r) => r[1]);
    setHl({ id: `drawn-${Date.now()}`, name: 'Your area', polys: [[ring]], bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] });
  };
  /* zoom to a place: areas, their countries and their regions (components/modeldata/RegionPicker); its
     search also finds counties (zoomed to and outlined in green) and places (zoomed to, about 80 km
     across and at least 16 cells, and pinned, so their values show) */
  const regionList = (
    <RegionPicker grid={gridName} phone={phone} titled={narrow} onPick={(b) => { setHl(null); fit(b); }} onClose={phone || layout === 'tablet' ? closePanels : () => setRegionsOpen(false)}
      wholeBox={(REGIONS.all || REGIONS.ukv)?.box} cities={statics?.cities}
      onCounty={(c, gb) => { setHl(c); setPin(null); fit(gb); }}
      canAdd={!!hl} onAddCounty={(c) => {
        const next = joinAreas(hl, c);
        setHl(next);
        fit(gridBox(next.bbox, gridName).box);
      }}
      onDraw={() => { setHl(null); setPin(null); setDrawing({ pts: [] }); }}
      myPlaces={favs.places} onForget={(i) => updFavs((f) => removePlace(f, i))}
      onPlace={(p) => {
        setHl(null);
        const hs = Math.max(8, 40000 / GRIDS[gridName].dx);
        fit([p.x - hs, p.y - hs, p.x + hs, p.y + hs]);
        setPin({ gx: p.x, gy: p.y, label: p.name });
      }} />
  );
  /* the playback speed, in words; a speed typed into the Download panel shows as its milliseconds */
  const speedOptions = (
    <>
      {!SPEEDS.some(([v]) => v === speed) && <option value={speed} style={{ color: '#111' }}>{speed} ms a step</option>}
      {SPEEDS.map(([v, l]) => <option key={v} value={v} style={{ color: '#111' }}>{l}</option>)}
    </>
  );
  const speedName = SPEEDS.find(([v]) => v === speed)?.[1] || `${speed} ms a step`;
  const speedSelect = (
    <div style={{ position: 'relative' }}>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ ...sel, padding: '7px 26px 7px 10px' }} title="Playback speed (GIFs and videos time themselves)" aria-label="Playback speed">
        {speedOptions}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 8, top: 9, width: 13, height: 13, pointerEvents: 'none', opacity: 0.7 }} />
    </div>
  );
  const speedField = topField('Speed', speedName, (
    <select className="md-field-sel" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">{speedOptions}</select>
  ), 'How fast the map plays (GIFs and videos time themselves)');
  /* Live: where the loop starts (16 Nov 2026, at the user's request): any quarter-hour in it, played to the latest */
  const loopTimes = isLive ? steps.filter((x, k) => k < steps.length - 2 && new Date(x).getUTCMinutes() % 15 === 0) : [];
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  const agoText = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60e3)); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''} ago` : `${m} min ago`; };
  const chooseLoop = (v) => {
    setLoopFrom(v);
    if (v != null) { const k = steps.findIndex((x) => x >= v); if (k >= 0 && idx < k) setIdx(k); }
  };
  const loopOptions = (
    <>
      <option value="" style={{ color: '#111' }}>The whole loop</option>
      {loopTimes.map((x) => <option key={x} value={x} style={{ color: '#111' }}>From {hhmm(x)} ({agoText(x)})</option>)}
    </>
  );
  const loopName = loopFrom == null ? 'The whole loop' : `From ${hhmm(loopFrom)}`;
  const loopField = isLive && loopTimes.length > 1 && topField('Loop', loopName, (
    <select className="md-field-sel" value={loopFrom ?? ''} onChange={(e) => chooseLoop(e.target.value ? Number(e.target.value) : null)} aria-label="Where the loop starts">{loopOptions}</select>
  ), 'Where the radar loop starts: it plays from there to the latest');
  const loopRow = isLive && loopTimes.length > 1 && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ color: T.ink2, fontSize: 12.5 }}>Loop from</span>
      <div style={{ position: 'relative' }}>
        <select value={loopFrom ?? ''} onChange={(e) => chooseLoop(e.target.value ? Number(e.target.value) : null)} style={{ ...sel, padding: '7px 26px 7px 10px' }} aria-label="Where the loop starts">{loopOptions}</select>
        <ChevronDown style={{ position: 'absolute', right: 8, top: 9, width: 13, height: 13, pointerEvents: 'none', opacity: 0.7 }} />
      </div>
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
        color: off ? T.ink2 : '#fff', background: off ? T.chip : T.light ? ACCENT : '#2f7fe0', boxShadow: off ? 'none' : '0 3px 10px rgba(10,111,219,0.3)' }}>
        {icon}{label}
      </button>
    );
  };
  const exportBody = exp.open && (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <div style={{ display: 'grid', gap: 7 }}>
        <span className="md-sec-t">Shape</span>
        <div className="md-noscroll" style={{ overflowX: 'auto' }}>{frameSeg}</div>
        <span style={{ color: T.ink2, fontSize: 11.5 }}>Saved exactly as the frame on the map shows it{kindB ? ', both windows' : ''}</span>
      </div>
      <div style={{ height: 1, background: T.line }} />
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
          <div style={{ fontSize: 11, color: exp.err ? '#f59e0b' : T.ink2 }}>{exp.err || (waiting > 0 ? `Waiting for ${waiting} frames from AWS` : !canMakeVideo() ? 'This browser cannot make video files; Chrome, Edge, Safari and recent Firefox can.' : `Video ${lengthSec('video')} s · GIF ${lengthSec('gif')} s · timed by the clock: ${motionPace('video')}${exp.smooth ? '' : ' (each step held)'}`)}</div>
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
  /* the outlined area's numbers (15 Nov 2026): its cells on this grid, the frame on show over them,
     and the whole run's extremes from every step loaded so far */
  const areaCells = useMemo(() => (hlRings ? maskCells(hlRings[gridName] || [], gridName) : null), [hlRings, gridName]);
  const [counties, setCounties] = useState(null);
  useEffect(() => { let on = true; loadCounties().then((c) => on && setCounties(c)); return () => { on = false; }; }, []);
  const linkMarks = useRef(link && (link.c || link.area || link.pin) ? link : null);
  useEffect(() => {
    const L = linkMarks.current;
    if (!L || !view || (L.c && !counties)) return;
    linkMarks.current = null;
    if (L.c) {
      const joined = L.c.map((id) => counties.find((x) => x.id === id)).filter(Boolean).reduce((a, b) => joinAreas(a, b), null);
      if (joined) setHl(joined);
    } else if (L.area) {
      const lons = L.area.map((r) => r[0]), lats = L.area.map((r) => r[1]);
      setHl({ id: 'drawn-link', name: 'Your area', polys: [[L.area]], bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] });
    }
    if (L.pin) { const [gx, gy] = projection(gridName).toGrid(L.pin[1], L.pin[0]); setPin({ gx, gy, label: L.pn || undefined }); }
  }, [view, counties]);                                    // eslint-disable-line react-hooks/exhaustive-deps
  /* the map in words, worked out when the browser has a moment rather than as a frame arrives (16 Nov
     2026: every county's cells, ~0.2 s the first time, held the first frame back from the screen) */
  const [caption, setCaption] = useState('');
  useEffect(() => {
    if (!counties || !frame || isImg || isLong) { setCaption(''); return undefined; }
    const later = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 800 }) : (f) => setTimeout(f, 60);
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = later(() => { try { setCaption(describe(disp(frame), scaleKey, vmeta, countyCells(counties, gridName), gridName)); } catch { setCaption(''); } });
    return () => cancel(id);
  }, [counties, frame, disp, scaleKey, vmeta, gridName, isImg, isLong]);
  const areaWet = RAINY.has(scaleKey) || /^(precip|snow|rain|frzr|icep|conv)_(total|1h|6h|24h|acc)$/.test(scaleKey) ? 0.1 : null;
  const areaNow = useMemo(() => {
    if (!areaCells?.length || !frame) return null;
    const f = disp(frame);
    if (scaleKey === 'ptype' || scaleKey === 'radar_type') return { typed: typedShares(f, areaCells, gridName) };
    if (['wx', 'wdir10', 'mwd', 'snow_risk', 'snow_cond', 'frost_risk', 'ice_risk', 'beaufort'].includes(scaleKey) || isImg) return { none: true };
    return areaStats(f, areaCells, gridName, areaWet);
  }, [areaCells, frame, disp, scaleKey, gridName, areaWet, isImg]);
  const areaRun = useMemo(() => {
    if (!areaCells?.length || !areaNow || areaNow.none || areaNow.typed) return null;
    let hi = null, lo = null, n = 0;
    for (const st of steps) {
      const f = frames[st];
      if (!f) continue;
      const a = areaStats(disp(f), areaCells, gridName);
      if (!a) continue;
      n++;
      if (!hi || a.max > hi.v) hi = { v: a.max, st, c: a.imax };
      if (!lo || a.min < lo.v) lo = { v: a.min, st, c: a.imin };
    }
    return n > 1 ? { hi, lo, n } : null;
  }, [areaCells, areaNow, steps, frames, disp, gridName]);
  const nearPlace = (c) => {
    const nx = GRIDS[gridName].nx, gx = c % nx, gy = Math.floor(c / nx);
    const b = (statics?.cities || []).reduce((m, x) => { const d = Math.hypot(x.x - gx, x.y - gy); return !m || d < m.d ? { d, n: x.name } : m; }, null);
    return b && (b.d * GRIDS[gridName].dx) / 1000 < 30 ? ` near ${b.n}` : '';
  };
  /* a step as its day and time (Mon 16, 08:00), as the run's own steps are labelled elsewhere */
  const whenOf = (st) => {
    const ms = timeSteps ? st : Date.parse(run?.run || 0) + st * 3600e3;
    return dateTimeWords(ms, 'en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  };
  const areaCard = hl && !drawing && (() => {
    const A = areaNow, unit = vmeta?.unit;
    const of = hl.names ? 'the area' : hl.name;
    const swatch = <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: 'rgba(34,197,94,0.3)', boxShadow: 'inset 0 0 0 2px #16a34a' }} />;
    /* at the top on the right, under the run's badge: the key sits bottom left and the pin card bottom right */
    return (
      <div style={{ ...T.glass, borderRadius: 18, position: 'absolute', top: topH + (narrow ? 4 : 40), zIndex: 4, padding: '9px 10px 10px 12px', display: 'grid', gap: 3,
        ...(narrow ? { left: 10, right: 10, maxWidth: 520, margin: '0 auto' } : { right: 62, width: 330 }) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {swatch}
          <b style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hl.name}</b>
          <IconBtn title="Stop outlining it (Esc)" onClick={() => setHl(null)} style={{ width: narrow ? 30 : 24, height: narrow ? 30 : 24 }}><X size={12} /></IconBtn>
        </div>
        <div style={{ fontSize: 11.5, color: T.ink2 }}>{vmeta?.label} · {validLabel}</div>
        {!A ? <div style={{ fontSize: 12, color: T.ink2 }}>This step is still loading.</div>
          : A.none ? <div style={{ fontSize: 12, color: T.ink2 }}>Pick a layer with numbers (temperature, rain, wind…) to see its highest, lowest and average here.</div>
          : A.typed ? (
            <div style={{ fontSize: 12.5, fontWeight: 650 }}>
              {['Rain', 'Sleet', 'Snow', 'Ice'].map((k, i) => `${k} ${Math.round(A.typed[i] * 100)}%`).join(' · ')}<span style={{ color: T.ink2, fontWeight: 500 }}> of {of}</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 750 }}>Highest {fmtValue(A.max, unit)}<span style={{ fontWeight: 550, color: T.ink3 }}>{nearPlace(A.imax)}</span></div>
              <div style={{ fontSize: 12.5, fontWeight: 650 }}>
                {A.wetShare != null
                  ? <>{A.wetShare > 0 ? `Falling over ${Math.max(1, Math.round(A.wetShare * 100))}% of ${of}` : `Dry over all of ${of}`}</>
                  : <>Lowest {fmtValue(A.min, unit)}<span style={{ fontWeight: 500, color: T.ink3 }}>{nearPlace(A.imin)}</span></>}
                <span style={{ fontWeight: 500, color: T.ink2 }}> · average {fmtValue(A.mean, unit)}</span>
              </div>
              {areaRun && (
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                  Whole run{areaRun.n < steps.length ? ` (${areaRun.n} of ${steps.length} steps loaded)` : ''}: highest {fmtValue(areaRun.hi.v, unit)} ({whenOf(areaRun.hi.st)})
                  {A.wetShare == null ? `, lowest ${fmtValue(areaRun.lo.v, unit)} (${whenOf(areaRun.lo.st)})` : ''}
                </div>
              )}
            </>
          )}
      </div>
    );
  })();
  /* a point's name: the nearest place */
  const nearPlaceName = (gx, gy) => {
    const c = (statics?.cities || []).reduce((b, x) => { const d = Math.hypot(x.x - gx, x.y - gy); return !b || d < b.d ? { d, n: x.name } : b; }, null);
    if (!c) return 'Here';
    const km = (c.d * GRIDS[gridName].dx) / 1000;
    return km < 6 ? c.n : km < 20 ? `Near ${c.n}` : `${Math.round(km)} km from ${c.n}`;
  };
  /* the newest whole GFS run, and its step nearest the time on show (soundings, sections, the air's path) */
  const gfsAt = () => {
    const g = cat?.models?.find((m) => m.id === 'gfs');
    const r = g?.runs?.find((x) => !x.kept && x.complete) || g?.runs?.[0];
    if (!r?.steps?.length) return null;
    const t0 = Date.parse(r.run), want = validMs ?? Date.now();
    return { run: r.run, step: r.steps.reduce((b, x) => (Math.abs(t0 + x * 3600e3 - want) < Math.abs(t0 + b * 3600e3 - want) ? x : b), r.steps[0]) };
  };
  const openTool = (kind, place) => {
    if (!pin) return;
    const [lon, lat] = projection(gridName).fromGrid(pin.gx, pin.gy);
    setPtool({ kind, lat, lon, place, gx: pin.gx, gy: pin.gy });
  };
  useEffect(() => {
    if (ptool?.kind !== 'trajectory') { setTraj(null); return undefined; }
    const g = gfsAt();
    if (!g) { setTraj({ err: 'No GFS run is listed just now.' }); return undefined; }
    let on = true;
    setTraj({ busy: true });
    fetch(`/api/modeldata/trajectory?run=${encodeURIComponent(g.run)}&step=${g.step}&lat=${ptool.lat.toFixed(3)}&lon=${ptool.lon.toFixed(3)}&hours=72`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (on) setTraj(ok && !j.error ? { data: j } : { err: j.error || 'The air could not be traced back.' }); })
      .catch((e) => { if (on) setTraj({ err: `It could not be fetched (${e.message}).` }); });
    return () => { on = false; };
  }, [ptool]);                                              // eslint-disable-line react-hooks/exhaustive-deps
  /* Chances: every member's value at the pin through the run (the members are in the frames already) */
  const plume = useMemo(() => {
    if (ptool?.kind !== 'plume' || !isProb || !run) return null;
    const first = steps.map((x) => frames[x]).find((f) => f?.head?.members);
    if (!first) return null;
    const M = first.head.members, out = { times: [], members: Array.from({ length: M }, () => []) };
    for (const st of steps) {
      const ef = frames[st];
      if (!ef?.q || !ef.head?.members) continue;
      const { nx, ny } = ef.head, k = ef.head.k || 8, n = nx * ny;
      const i = Math.floor(ptool.gx / k), j = Math.floor(ptool.gy / k);
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      out.times.push(Date.parse(run.run) + st * 3600e3);
      for (let m = 0; m < M; m++) { const v = ef.q[m * n + j * nx + i]; out.members[m].push(v === 255 ? null : ef.table[v]); }
    }
    return out;
  }, [ptool, isProb, run, steps, frames]);
  const pinCard = pin && (() => {
    const vals = steps.map((s) => (frames[s] ? sampleFrame(disp(frames[s]), pin.gx, pin.gy) : NaN));
    const at = Math.min(idx, Math.max(0, steps.length - 1));
    const numeric = !['wx', 'ptype', 'wdir10', 'mwd'].includes(scaleKey);
    const fin = vals.filter(Number.isFinite);
    const c = (statics?.cities || []).reduce((b, x) => { const d = Math.hypot(x.x - pin.gx, x.y - pin.gy); return !b || d < b.d ? { d, n: x.name } : b; }, null);
    const km = c ? (c.d * GRIDS[gridName].dx) / 1000 : null;          // cells to km on this grid (2 km or 10 km)
    /* a place or postcode picked from the search keeps its own name */
    const where = pin.label || (!c ? 'Picked point' : km < 6 ? c.n : km < 20 ? `Near ${c.n}` : `${Math.round(km)} km from ${c.n}`);
    const [plon, plat] = projection(gridName).fromGrid(pin.gx, pin.gy);
    const savedAt = favs.places.findIndex((p) => Math.hypot(p.lon - plon, p.lat - plat) <= 0.01);
    return (
      <div style={{ ...T.glass, borderRadius: 20, position: 'absolute', bottom: botH, zIndex: 4, padding: '10px 12px 12px', display: 'grid', gap: 6,
        ...(narrow ? { left: 10, right: 10, maxWidth: 520, margin: '0 auto' } : { right: 10, width: 300 }) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MapPin size={14} style={{ color: '#ffd23f', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where}</span>
          <IconBtn title={savedAt >= 0 ? 'In your places (Zoom to): press to forget it' : 'Save this place: it shows in Zoom to'}
            onClick={() => updFavs((f) => (savedAt >= 0 ? removePlace(f, savedAt) : addPlace(f, { name: where, lon: Math.round(plon * 1e4) / 1e4, lat: Math.round(plat * 1e4) / 1e4 })))}
            style={{ width: narrow ? 30 : 24, height: narrow ? 30 : 24, color: savedAt >= 0 ? '#d97706' : undefined }}>
            <Star size={12} fill={savedAt >= 0 ? '#f59e0b' : 'none'} />
          </IconBtn>
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
              {!timeSteps && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', paddingTop: 2 }}>
                  {[...(isProb ? [['plume', 'Members', 'Every member of the ensemble here, through the run']] : [['models', 'Every model', 'This layer from every model\u2019s newest run, here']]),
                    ['sounding', 'The air above', 'A sounding (skew-T) from NOAA GFS: temperature, moisture and wind up through the air'],
                    ['trajectory', 'Where the air came from', 'The air over here traced back three days through the GFS winds'],
                    ['section', 'Cross-section', 'A slice through the air from here to a second point you press on the map']].map(([k, l, title]) => (
                    <button key={k} type="button" title={title} onClick={() => (k === 'section' ? setSectionFrom({ gx: pin.gx, gy: pin.gy, name: where }) : openTool(k, where))}
                      style={{ border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 999, fontFamily: FONT, fontSize: 11.5, fontWeight: 700,
                        background: ptool?.kind === k || (k === 'section' && sectionFrom) ? T.on : T.track, color: ptool?.kind === k || (k === 'section' && sectionFrom) ? T.onInk : T.ink }}>{l}</button>
                  ))}
                </div>
              )}
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
      {model?.fields?.includes('mslp') && (
        <button type="button" onClick={() => setPtool((o) => (o?.kind === 'scenarios' ? null : { kind: 'scenarios' }))} title="The ways the members split at this time (their pressure maps grouped)"
          style={{ border: 'none', cursor: 'pointer', padding: '6px 11px', borderRadius: 999, fontFamily: FONT, fontSize: 12, fontWeight: 700, flexShrink: 0,
            background: ptool?.kind === 'scenarios' ? T.on : T.track, color: ptool?.kind === 'scenarios' ? T.onInk : T.ink }}>Scenarios</button>
      )}
    </div>
  );
  /* back and next go to the nearest step that has loaded (as the timeline does): never onto a blank map */
  const stepBack = () => { setPlaying(false); setIdx((i) => { for (let k = Math.min(i, steps.length) - 1; k >= 0; k--) if (frames[steps[k]]) return k; return i; }); };
  const stepFwd = () => { setPlaying(false); setIdx((i) => { for (let k = i + 1; k < steps.length; k++) if (frames[steps[k]]) return k; return i; }); };
  /* the timeline: the run's days as a STRATA progress bar (components/modeldata/Timeline), a tick for
     every step (faint until it has loaded), the time it lands on shown above a press or a drag */
  const runMsT = run && !timeSteps ? Date.parse(run.run) : 0;
  const stepTimes = timeSteps ? steps : steps.map((s) => runMsT + s * 3600e3);
  /* a day back or on (15 Nov 2026): the loaded step nearest the same time a day away */
  const stepDay = (dir) => {
    setPlaying(false);
    setIdx((i) => {
      const cur = Math.min(i, steps.length - 1), tNow = stepTimes[cur], want = tNow + dir * 864e5;
      let best = null;
      steps.forEach((st, k) => {
        if (!frames[st] || (dir > 0 ? stepTimes[k] <= tNow : stepTimes[k] >= tNow)) return;
        if (best == null || Math.abs(stepTimes[k] - want) < Math.abs(stepTimes[best] - want)) best = k;
      });
      return best ?? i;
    });
  };
  stepDayRef.current = stepDay;
  const tipLabel = (ms) => {
    if (isObs) return dateWords(ms, 'en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
    const t = dateTimeWords(ms, 'en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' ·');
    return timeSteps ? t : `${t} · T+${Math.round((ms - runMsT) / 3600e3)}`;
  };
  const slider = (
    <Timeline times={stepTimes} idx={Math.min(idx, Math.max(0, steps.length - 1))} onPick={(i) => { setPlaying(false); setIdx(i); }}
      loaded={(i) => !!frames[steps[i]]} label={tipLabel} />
  );
  const playBtn = (
    <button type="button" className="mdt-play" onClick={() => setPlaying((p) => !p)} title={playing ? 'Pause (space)' : 'Play (space)'} aria-label={playing ? 'Pause' : 'Play'}
      style={phone ? { width: 42, height: 42 } : undefined}>
      {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
    </button>
  );
  /* how many steps have loaded, in plain sight: a ring that fills and the count (the marks under the
     timeline are the same steps, solid once they have loaded) */
  const loadMeter = steps.length > 1 && (() => {
    const done = loadedCount >= steps.length, pct = loadedCount / steps.length;
    return (
      <span className={`mdt-load${done ? ' is-done' : ''}`} role="status" aria-live="polite"
        title={done ? `All ${steps.length} steps have loaded` : `${loadedCount} of ${steps.length} steps have loaded${etaText ? ` (${etaText.replace('~', 'about ')})` : ''}; the rest are coming from ${fetchedFrom(model?.id)}. Each mark under the timeline is a step, solid once it has loaded.`}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" className="mdt-load-bg" />
          <circle cx="10" cy="10" r="8" className="mdt-load-fg" style={{ strokeDasharray: `${(pct * 50.27).toFixed(2)} 50.27` }} />
        </svg>
        <span><b>{loadedCount}/{steps.length}</b>{!phone ? <i>{done ? 'all loaded' : etaText || 'loaded'}</i> : !done && etaText ? <i>{etaText}</i> : null}</span>
      </span>
    );
  })();
  /* the time on show, as the STRATA clock: the day in the accent, the hour in ink, the lead under it */
  const [dayPart, hourPart] = isObs ? [validLabel, ''] : validLabel.split(', ');
  const timeLabel = (
    <span className="mdt-time">
      <b><i>{dayPart}</i>{hourPart ? ` · ${hourPart}` : ''}</b>
      <span>{subLabel}{phone && loadMeter}</span>
    </span>
  );
  /* a labelled tool on the phone's bottom bar: an icon over a word, a finger's width each */
  const tool = (icon, label, on, onClick, badge) => (
    <button key={label} onClick={onClick} aria-pressed={!!on} style={{ border: 'none', cursor: 'pointer', fontFamily: FONT, flex: 1, minWidth: 0, height: 50, borderRadius: 16,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11.5, fontWeight: 650, letterSpacing: '-0.005em',
      color: on ? T.onInk : T.ink3, background: on ? T.on : 'transparent', boxShadow: on ? T.onShadow : 'none', position: 'relative' }}>
      {icon}<span>{label}</span>
      {badge ? <span style={{ position: 'absolute', top: 3, right: '50%', marginRight: -20, minWidth: 16, height: 16, borderRadius: 99, fontSize: 10, lineHeight: '16px', fontWeight: 760, background: T.accent, color: '#fff' }}>{badge}</span> : null}
    </button>
  );

  return (
    <ThemeCtx.Provider value={T}>
    <div ref={shellRef} className="md-strata" style={{ ...T.vars, height: shellH, position: 'relative', overflow: 'hidden', fontFamily: FONT, color: T.ink,
      background: T.light ? 'radial-gradient(120% 80% at 50% 0%, #e9f0f7 0%, #c9d8e7 60%, #b3c7dc 100%)' : 'radial-gradient(120% 80% at 50% 0%, #142238 0%, #070c16 60%, #04070d 100%)' }}>
      <div ref={stageRef} style={{ position: 'absolute', inset: 0 }}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerLeave={(e) => { onUp(e); setHover(null); }}
          style={{ width: '100%', height: '100%', display: 'block', cursor: interacting ? 'grabbing' : 'crosshair', touchAction: 'none' }} />
      </div>

      {/* top bar */}
      <div ref={topRef} style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
        {layout === 'desktop' ? (
          <>
            <div className="md-noscroll" style={{ ...T.capsule, padding: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0, maxWidth: '100%', pointerEvents: 'auto' }}>
              {cat ? (
                <>
                  {modeSeg}
                  {!isLong && (isObs
                    ? statusField('Archive', chipSub)
                    : isLive
                    ? statusField('Updated', <><span style={{ width: 8, height: 8, borderRadius: 99, background: '#ff4d4f', boxShadow: '0 0 8px #ff4d4f', flexShrink: 0 }} />{liveTime ? `Latest ${liveTime}` : 'Starting…'}</>)
                    : isProb
                    ? modelField(cat.ensembles, ensId)
                    : modelField(cat.models, modelId))}
                  {!isLong && runField}
                  {!isLong && varButton}
                </>
              ) : (
                <span style={{ padding: '6px 10px', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', color: err ? '#fca5a5' : T.ink2 }}>
                  {!err && <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />}{err || 'Finding the latest runs…'}
                </span>
              )}
            </div>
            <div style={{ flex: 1 }} />
            {!isLong && <div style={{ ...T.capsule, padding: 7, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', flexShrink: 0 }}>{compareBtn}{layersBtn}</div>}
          </>
        ) : (
          <div style={{ ...T.capsule, padding: phone ? 6 : 5, display: 'flex', alignItems: 'center', gap: phone ? 8 : 6, pointerEvents: 'auto', flex: 1, minWidth: 0 }}>
            {phone ? modeBtn : modeSeg}
            {!isLong && dataChip}
            {!phone && !isLong && compareBtn}
            {!phone && !isLong && layersBtn}
          </div>
        )}
        {probBar}
        {/* Simple mode: questions to start with, as a row of the top bar (so the map starts below them) */}
        {simple && !isLong && !isLive && !isObs && !isProb && cat && (
          <div className="md-noscroll" style={{ flexBasis: '100%', display: 'flex', gap: 6, overflowX: 'auto', pointerEvents: 'auto' }}>
            {QUESTIONS.map((qn) => (
              <button key={qn.key} type="button" className="md-act" onClick={() => ask(qn)} style={{ flexShrink: 0, ...T.capsule, padding: '7px 13px', fontWeight: 700 }}>{qn.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* desktop: the layer picker and the layers, as cards under the top bar */}
      {layout === 'desktop' && mapOpen && card('Map', null, () => setMapOpen(false), mapBody, { right: 10, top: topH, width: 330 })}
      {layout === 'desktop' && cmpOpen && card('Compare', null, () => setCmpOpen(false), compareBody, { right: 10, top: topH, width: 320 })}
      {layout === 'desktop' && varOpen && cat && !mapOpen && browser({ left: 10, top: topH, width: 'min(980px, calc(100% - 20px))', height: `min(680px, calc(100% - ${topH + botH + 4}px))` })}
      {/* tablet: the picker with the model and run above its layers; the layers, as a card */}
      {layout === 'tablet' && varOpen && cat && browser({ left: 10, right: 10, top: topH, height: `calc(100% - ${topH + botH + 4}px)` }, modelRunRow)}
      {layout === 'tablet' && mapOpen && card('Map', null, closePanels, mapBody, { right: 10, top: topH, width: 330 })}
      {layout === 'tablet' && cmpOpen && card('Compare', null, closePanels, compareBody, { right: 10, top: topH, width: 320 })}
      {layout === 'tablet' && regionsOpen && card('Zoom to', null, closePanels, regionList, { right: 10, bottom: botH, width: 300 })}
      {layout === 'tablet' && exp.open && card('Download', null, closePanels, <>{exportBody}<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}><span style={{ color: T.ink2, fontSize: 12.5 }}>Playback speed</span>{speedSelect}</div>{loopRow}</>,
        { right: 10, bottom: botH, width: 'min(380px, calc(100% - 20px))' })}

      <style>{'.md-noscroll::-webkit-scrollbar{display:none}.md-noscroll{scrollbar-width:none}'
        + '.md-thr{height:28px;cursor:pointer}.md-thr::-webkit-slider-thumb{width:22px;height:22px}.md-thr::-moz-range-thumb{width:22px;height:22px}'}</style>

      {/* desktop: zoom buttons and regions (phones and tablets pinch, and have Regions on the bottom bar) */}
      {layout === 'desktop' && !isLong && (
        <div style={{ ...T.capsule, position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', padding: 5, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <IconBtn title="Zoom in (+)" onClick={() => zoomBy(1.35)}><ZoomIn size={15} /></IconBtn>
          <IconBtn title="Zoom out (−)" onClick={() => zoomBy(1 / 1.35)}><ZoomOut size={15} /></IconBtn>
          <IconBtn title="UK & Ireland" onClick={() => fit(REGIONS.uk.box)}><Maximize size={14} /></IconBtn>
          <IconBtn on={regionsOpen} title="Zoom to a region" onClick={() => setRegionsOpen((o) => !o)}><MapIcon size={14} /></IconBtn>
          {isAdmin && <IconBtn on={drawOn} title="Draw on the map (admin)" onClick={() => { setDrawOn((o) => !o); setDrawDraft(null); }}><PenLine size={14} /></IconBtn>}
        </div>
      )}
      {layout === 'desktop' && regionsOpen && (
        <div style={{ ...T.glass, borderRadius: 18, position: 'absolute', right: 58, top: '50%', transform: 'translateY(-50%)', padding: 10, zIndex: 6, width: 290, display: 'flex' }}>{regionList}</div>
      )}

      {hover && layout === 'desktop' && (
        <div style={{ ...T.capsule, position: 'absolute', left: hover.x, top: hover.y + 12, transform: hover.x > hover.w - 200 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
          pointerEvents: 'none', padding: '5px 11px', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: hover.warn ? 14 : 999 }}>
          {hover.text}{hover.warn && <div style={{ fontSize: 11.5, fontWeight: 650, color: T.ink2 }}>{hover.warn}</div>}
        </div>
      )}
      {sectionFrom && (
        <div style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: topH, zIndex: 7, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, display: 'flex', gap: 10, alignItems: 'center' }}>
          Press the map where the cross-section should end
          <IconBtn title="Cancel (Esc)" onClick={() => setSectionFrom(null)} style={{ width: 24, height: 24 }}><X size={12} /></IconBtn>
        </div>
      )}
      {ptool && (() => {
        const close = () => setPtool(null), g = gfsAt();
        const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        const body = ptool.kind === 'models' ? (
          <ModelsAtPoint t={T} phone={phone} place={ptool.place} lat={ptool.lat} lon={ptool.lon} v={varKey} label={vmeta?.label || varKey} unit={vmeta?.unit || ''} validMs={validMs} onClose={close}
            names={SHORT_NAMES} models={[...(cat?.models || []).filter((m) => m.runs?.length && m.variables?.includes(varKey) && !['frost', 'gefs_aer', 'ecmwf_ensm', 'aifs_ensm', 'mix'].includes(m.id)).map((m) => m.id)]} />
        ) : ptool.kind === 'plume' ? (
          <EnsemblePlume t={T} phone={phone} place={ptool.place} data={plume} thr={thr} dir={dir} unit={fmeta?.unit || ''} label={preset.label} ensName={model?.label || ''} validMs={validMs} onClose={close} />
        ) : ptool.kind === 'sounding' ? (
          <Sounding t={T} phone={phone} place={ptool.place} onClose={close} url={g ? `/api/modeldata/sounding?${q({ run: g.run, step: g.step, lat: ptool.lat.toFixed(2), lon: ptool.lon.toFixed(2) })}` : null} />
        ) : ptool.kind === 'trajectory' ? (
          <AirPath t={T} phone={phone} place={ptool.place} data={traj?.data} busy={traj?.busy} err={traj?.err} onClose={close} />
        ) : ptool.kind === 'section' ? (
          <CrossSection t={T} phone={phone} fromName={ptool.fromName} toName={ptool.toName} onClose={close}
            url={g ? `/api/modeldata/section?${q({ run: g.run, step: g.step, lat1: ptool.lat1.toFixed(2), lon1: ptool.lon1.toFixed(2), lat2: ptool.lat2.toFixed(2), lon2: ptool.lon2.toFixed(2) })}` : null} />
        ) : ptool.kind === 'scenarios' && isProb && run && step != null ? (
          <Scenarios t={T} phone={phone} lines={statics?.lines} ensName={model?.label || ''} onClose={close} url={`/api/modeldata/scenarios?${q({ ens: model.id, run: run.run, step })}`} />
        ) : null;
        if (!body) return null;
        const pos = phone ? { left: 8, right: 8, bottom: botH, maxHeight: '74%' } : { left: 10, top: topH, width: 'min(800px, calc(100% - 96px))', maxHeight: `calc(100% - ${topH + botH + 8}px)` };
        return <div className="md-noscroll" style={{ position: 'absolute', zIndex: 8, overflowY: 'auto', borderRadius: 22, ...pos }}>{body}</div>;
      })()}
      {isAdmin && drawOn && (
        <DrawBar tool={drawTool} setTool={setDrawTool} phone={phone} shapePoints={drawDraft?.kind === 'shape' ? drawDraft.pts.length : 0}
          onFinishShape={() => finishShape(drawDraft?.pts)} canUndo={drawings.length > 0} count={drawings.length}
          onUndo={() => setDrawings((l) => l.slice(0, -1))}
          onClear={() => { if (window.confirm('Clear every drawing from the map?')) setDrawings([]); }}
          onDone={() => { setDrawOn(false); setDrawDraft(null); }}
          style={{ ...T.glass, position: 'absolute', zIndex: 7, ...(phone ? { left: 10, right: 10, bottom: botH } : { left: '50%', transform: 'translateX(-50%)', top: topH, maxWidth: 'calc(100% - 140px)' }) }} />
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
      {!frame && key && !isLong && (
        <div style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', ...noticePos, padding: '6px 14px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
          {!status ? 'Starting…' : `Fetching from ${fetchedFrom(model?.id)} · ${loadedCount}/${steps.length}`}
        </div>
      )}

      {!exp.open && !isLong && !drawOn && !(phone && (varOpen || mapOpen || cmpOpen || regionsOpen || obsPanel || modeOpen || shapeOpen || shareOpen)) && pinCard}
      {/* the outlined county or area: its highest, lowest and average (phones: while no pin card is open) */}
      {areaCard && !isLong && !exp.open && !(phone && (pin || varOpen || mapOpen || cmpOpen || regionsOpen || modeOpen || shapeOpen || shareOpen)) && areaCard}
      {/* drawing an area: how, and Undo, Done and Cancel */}
      {drawing && !isLong && (
        <div style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', ...noticePos, padding: '5px 6px 5px 14px', display: 'flex', gap: 6,
          alignItems: 'center', zIndex: 6, fontSize: 12.5, fontWeight: 650, whiteSpace: 'nowrap', maxWidth: 'calc(100% - 20px)' }}>
          <PenLine size={14} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{narrow ? 'Tap' : 'Click'} the map for each corner{drawing.pts.length ? ` · ${drawing.pts.length}` : ''}</span>
          <IconBtn title="Take away the last corner" onClick={() => setDrawing((d) => ({ pts: d.pts.slice(0, -1) }))} style={{ width: 28, height: 28 }}><Undo2 size={13} /></IconBtn>
          <button type="button" className="md-act" disabled={drawing.pts.length < 3} onClick={finishDrawing} style={{ opacity: drawing.pts.length < 3 ? 0.5 : 1 }}>Done</button>
          <IconBtn title="Cancel (Esc)" onClick={() => setDrawing(null)} style={{ width: 28, height: 28 }}><X size={13} /></IconBtn>
        </div>
      )}

      {/* Simple mode: questions to start with, and the map in words (screen readers always hear the words) */}
      {simple && caption && !isLong && !drawing && !phone && (
        <div style={{ ...T.capsule, borderRadius: 14, position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: topH, zIndex: 3,
          maxWidth: 'min(640px, calc(100% - 20px))', padding: '6px 13px', fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: T.ink3, textAlign: 'center' }}>{caption}</div>
      )}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{caption}</div>

      {/* Long range: the polar vortex and the MJO, over the map */}
      {isLong && <LongRange t={T} phone={phone} onMap={showVortex} style={{ position: 'absolute', left: 10, right: 10, top: topH, bottom: phone ? 16 : 10, zIndex: 5 }} />}

      {/* desktop: the export card above the timeline */}
      {layout === 'desktop' && exp.open && card('Download', null, () => setExp((e) => ({ ...e, open: false })), exportBody, { right: 10, bottom: botH, width: 'min(380px, calc(100% - 20px))' })}
      {!phone && shareOpen && !isLong && card('Share', 'a link to this map', closePanels, shareBody, { right: 10, bottom: botH, width: 340 })}

      {/* bottom bar */}
      {isLong ? null : layout === 'desktop' ? (
        <div ref={botRef} style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 10, width: 'min(980px, calc(100% - 20px))', padding: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconBtn title="Back a day (Shift+←)" onClick={() => stepDay(-1)}><ChevronsLeft size={16} /></IconBtn>
          <IconBtn title="Previous step (←)" onClick={stepBack}><ChevronLeft size={16} /></IconBtn>
          {playBtn}
          <IconBtn title="Next step (→)" onClick={stepFwd}><ChevronRight size={16} /></IconBtn>
          <IconBtn title="On a day (Shift+→)" onClick={() => stepDay(1)}><ChevronsRight size={16} /></IconBtn>
          <div style={{ flex: 1, minWidth: 80, display: 'flex', padding: '0 8px' }}>{slider}</div>
          {loadMeter}
          {timeLabel}
          {speedField}
          {loopField}
          {!isLong && (
            <button type="button" className="md-act" aria-pressed={shareOpen} title="A link to this map, with a picture of it for its preview" onClick={() => openPanel('share')}>
              <Share2 size={16} />Share
            </button>
          )}
          <button type="button" className="md-act" aria-pressed={exp.open} title="Download a picture (PNG), a GIF or a video" onClick={() => { setShareOpen(false); setExp((e) => ({ ...e, open: !e.open })); }}>
            <Download size={16} />Download
          </button>
        </div>
      ) : layout === 'tablet' ? (
        <div ref={botRef} style={{ ...T.capsule, position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 10, width: 'calc(100% - 20px)', maxWidth: 1060, padding: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconBtn title="Back a day" onClick={() => stepDay(-1)} style={{ width: 34, height: 34 }}><ChevronsLeft size={16} /></IconBtn>
          <IconBtn title="Previous step" onClick={stepBack} style={{ width: 38, height: 38 }}><ChevronLeft size={17} /></IconBtn>
          {playBtn}
          <IconBtn title="Next step" onClick={stepFwd} style={{ width: 38, height: 38 }}><ChevronRight size={17} /></IconBtn>
          <IconBtn title="On a day" onClick={() => stepDay(1)} style={{ width: 34, height: 34 }}><ChevronsRight size={16} /></IconBtn>
          <div style={{ flex: 1, minWidth: 80, display: 'flex', padding: '0 6px' }}>{slider}</div>
          {loadMeter}
          {timeLabel}
          <IconBtn on={regionsOpen} title="Zoom to a region" onClick={() => openPanel('regions')} style={{ width: 38, height: 38 }}><MapIcon size={16} /></IconBtn>
          {isObs && <IconBtn on={obsPanel} title="The day's extremes" onClick={() => (sidePanel ? setObsPanel(false) : openPanel('summary'))} style={{ width: 38, height: 38 }}><Star size={16} /></IconBtn>}
          {!isLong && <IconBtn on={shareOpen} title="Share: a link to this map, with a picture of it" onClick={() => openPanel('share')} style={{ width: 38, height: 38 }}><Share2 size={16} /></IconBtn>}
          <button type="button" className="md-act" aria-pressed={exp.open} title="Download a picture (PNG), a GIF or a video" onClick={() => openPanel('export')}><Download size={16} />Download</button>
        </div>
      ) : (
        <div ref={botRef} className="md-phone-bar" style={{ ...T.glass, position: 'absolute', left: 10, right: 10, bottom: 16, borderRadius: 26, padding: '10px 12px 6px', display: 'grid', gap: 6 }}>
          {/* the time on show, with a step back and a step on either side of it */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconBtn title="Back a day" onClick={() => stepDay(-1)} style={{ width: 34, height: 34 }}><ChevronsLeft size={17} /></IconBtn>
            <IconBtn title="Previous step" onClick={stepBack} style={{ width: 40, height: 40 }}><ChevronLeft size={19} /></IconBtn>
            <div className="md-phone-time" style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>{timeLabel}</div>
            <IconBtn title="Next step" onClick={stepFwd} style={{ width: 40, height: 40 }}><ChevronRight size={19} /></IconBtn>
            <IconBtn title="On a day" onClick={() => stepDay(1)} style={{ width: 34, height: 34 }}><ChevronsRight size={17} /></IconBtn>
          </div>
          {/* play, and the whole width to drag along the timeline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {playBtn}
            <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>{slider}</div>
          </div>
          {/* Simple mode: the map in words, two lines at most */}
          {simple && caption && !isLong && (
            <div style={{ fontSize: 12, lineHeight: 1.35, color: T.ink3, textAlign: 'center', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', padding: '0 4px' }}>{caption}</div>
          )}
          <div style={{ display: 'flex', gap: 4, borderTop: `1px solid ${T.line}`, paddingTop: 6, marginTop: 2 }}>
            {tool(<Layers size={19} />, 'Map', mapOpen, () => openPanel('layers'), layerCount)}
            {tool(<Ratio size={19} />, frameKey === 'screen' ? 'Shape' : FRAMES[frameKey].label, shapeOpen, () => openPanel('shape'))}
            {tool(<Columns2 size={19} />, 'Compare', cmpOpen || cmp.on, () => openPanel('compare'))}
            {tool(<MapIcon size={19} />, 'Regions', regionsOpen, () => openPanel('regions'))}
            {isObs && tool(<Star size={19} />, 'Day', obsPanel, () => openPanel('summary'))}
            {!isLong && tool(<Share2 size={19} />, 'Share', shareOpen, () => openPanel('share'))}
            {tool(<Download size={19} />, 'Download', exp.open, () => openPanel('export'))}
          </div>
        </div>
      )}

      {/* phone: everything else as sheets from the bottom */}
      {phone && modeOpen && (
        <Sheet title="View" onClose={closePanels}>
          <div style={{ display: 'grid', gap: 6 }}>
            {MODE_INFO.map(([k, l, d]) => (
              <button key={k} onClick={() => setModeTo(k)} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', padding: '12px 14px', borderRadius: 14,
                background: k === mode ? T.on : T.chip, boxShadow: k === mode ? T.onShadow : 'none' }} aria-pressed={k === mode}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: k === mode ? T.onInk : T.ink }}>{l}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: k === mode ? T.onInk : T.ink2, opacity: k === mode ? 0.78 : 1, marginTop: 2 }}>{d}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {phone && shapeOpen && (
        <Sheet title="Shape" note="the frame on the map, and its downloads" onClose={closePanels} clear>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[['screen', 'Screen', 'fills the screen'], ['square', '1:1', 'square post'], ['story', '9:16', 'story, full screen'], ['portrait', '4:5', 'portrait post']].map(([k, l, d]) => {
              const on = frameKey === k, a = FRAMES[k].a || 0.62;
              const w = a >= 1 ? 30 : 30 * a, h = a >= 1 ? 30 / a : 30;
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => { setFrameKey(k); setShapeOpen(false); }}
                  style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', padding: 14, borderRadius: 16, display: 'flex', alignItems: 'center', gap: 12,
                    background: on ? T.on : T.chip, color: on ? T.onInk : T.ink, boxShadow: on ? T.onShadow : 'none' }}>
                  <span style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <i style={{ width: w, height: h, borderRadius: 4, border: '2px solid currentColor' }} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: 16, fontWeight: 760 }}>{l}</b>
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.75, marginTop: 1 }}>{d}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
      {phone && varOpen && cat && (
        <>
          <div onClick={closePanels} style={{ position: 'absolute', inset: 0, zIndex: 44, background: 'rgba(2,6,14,0.4)' }} />
          {browser({ left: 0, right: 0, bottom: 0, height: '88%', zIndex: 45 }, modelRunRow)}
        </>
      )}
      {phone && mapOpen && (
        <Sheet title="Map" onClose={closePanels} clear>{mapBody}</Sheet>
      )}
      {phone && cmpOpen && <Sheet title="Compare" onClose={closePanels} clear>{compareBody}</Sheet>}
      {phone && regionsOpen && <Sheet title="Zoom to" onClose={closePanels} clear>{regionList}</Sheet>}
      {phone && shareOpen && !isLong && <Sheet title="Share" note="a link to this map" onClose={closePanels} clear>{shareBody}</Sheet>}
      {phone && exp.open && (
        <Sheet title="Download" onClose={closePanels}>
          {exportBody}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}><span style={{ color: T.ink2, fontSize: 12.5 }}>Playback speed</span>{speedSelect}</div>{loopRow}
        </Sheet>
      )}
      {phone && isObs && obsPanel && summaryBody && <Sheet title={summaryTitle} note={summaryNote} onClose={closePanels} clear>{summaryBody}</Sheet>}
    </div>
    </ThemeCtx.Provider>
  );
}
