import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'; import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import {
  CloudLightning, Wind, Zap, AlertTriangle, ShieldAlert,
  ChevronDown, ChevronUp, ChevronRight, Home, Menu, X,
  RefreshCw, Loader2, Clock, Calendar, Archive, Camera,
  Radio, Trash2, Eye, Image as ImageIcon, Globe, Search, GripVertical,
  User, Sun, Moon,
} from 'lucide-react';
import { AURORA, glassPanel, AuroraRail, rgbStr } from '@/components/tcm/auroraGlass';
import LightningHeaderBar from '@/components/tcm/LightningHeaderBar';
import { useTheme } from '@/components/ThemeContext';
/* The liquid-glass tokens (--glass-*, --ink-*, .lg-pane) live with the home
   page because that is where they were first needed. Importing the injector
   rather than copying the block keeps ONE definition of the material: if the
   glass changes there, it changes here. */
import { injectThemeStyles } from '@/pages/Home';

/* ═══════════════════════════════════════════════════════════════
   RENDER BACKEND — single 24/7 source of Blitzortung strikes
   ═══════════════════════════════════════════════════════════════ */
// Render worker — used as fallback/snapshot source. Both schemes from the same host.
const RENDER_WORKER_HOST = 'blitzortungworker-3.onrender.com';
const RENDER_WORKER_WS   = `wss://${RENDER_WORKER_HOST}`;
const RENDER_WORKER_HTTP = `https://${RENDER_WORKER_HOST}`;

// Direct Blitzortung — used while a user is on the site
const BLITZORTUNG_DIRECT_SERVERS = [
  'wss://ws1.blitzortung.org',
  'wss://ws7.blitzortung.org',
  'wss://ws8.blitzortung.org',
];

/* RISK_LEVEL_GUIDE removed — replaced by RiskLegendPanel import in components/tcm */

/* ═══════════════════════════════════════════════════════════════
   ENHANCED CITY DATABASE — ~350 UK towns for accuracy
   ═══════════════════════════════════════════════════════════════ */
import { CITY_DB } from '@/components/tcm/cityDB';

const BLITZORTUNG_DATE_IMAGES = {};
async function fetchBlitzortungArchive(dateStr, hourEnd) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const endTs  = Math.floor(d.getTime() / 1000) + hourEnd * 3600;
  const startTs = endTs - 3600;
  return `https://www.blitzortung.org/en/archive_data.php?stations_users=0&selected_numbers=&end_date=${endTs}&end_time=0&start_date=${startTs}&start_time=0&north=90&west=-180&east=180&south=-90&rawdata_image=1&map=10&width_orig=640&width_result=640&png_gif=0`;
}
function tsToDateHour(ts) {
  const d = new Date(ts);
  return { dateStr: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

/* nearestCity / nearestCityShort moved to components/tcm/stormTracker */

/* Storage helpers moved to components/tcm/strikeStorage */
import {
  STORE_KEY, DATE_KEY, ARCHIVE_KEY, SNAPSHOT_KEY,
  todayDateStr, localDateKey,
  loadSnapshots, saveSnapshot,
  loadTodayStrikes, saveTodayStrikes, loadNewStrikesSince,
  loadArchive, saveArchive,
} from '@/components/tcm/strikeStorage';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

/* ═══════════════════════════════════════════════════════════════
   GEO BOUNDS
   ═══════════════════════════════════════════════════════════════ */
const GEO_BOUNDS_UK = { latMin: 49.5, latMax: 61.0, lonMin: -10.8, lonMax: 2.5 };
const GEO_BOUNDS_EU = { latMin: 34.0, latMax: 72.0, lonMin: -25.0, lonMax: 45.0 };
const GEO_BOUNDS_WORLD = { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };
function inBounds(lat, lon, region = 'europe') {
  const b = region === 'uk' ? GEO_BOUNDS_UK : region === 'world' ? GEO_BOUNDS_WORLD : GEO_BOUNDS_EU;
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

// Canonical dedup key — used by BOTH the live WebSocket path and every merge
// path (DB pull, Render worker, cross-session, service worker). Previously each
// site rolled its own key (some keyed on ms, some on time/1000), so a strike
// arriving via one path was not recognised as a duplicate when it arrived via
// another — causing both double-paints AND, under load, lost strikes. One
// format, one source of truth. Rounds time to whole seconds so the same physical
// strike from different feeds (which can differ by sub-second timestamps)
// collapses to a single key.
function strikeKey(s) {
  return `${Math.round(s.time / 1000)}_${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}`;
}

// Normalise a strike timestamp to milliseconds regardless of the unit a feed
// hands us. Blitzortung's native format is nanoseconds; different storage paths
// have variously persisted seconds, milliseconds or nanoseconds. The live
// socket already normalises, but the DB / Render / archive pulls did not — so a
// strike stored in SECONDS (~1.7e9) was always < todayStartMs (~1.75e12) and got
// silently filtered out of every "today" read, dropping a large, consistent
// chunk of strikes. This makes every ingestion path unit-agnostic.
function strikeTimeMs(t) {
  if (t == null) return NaN;
  if (typeof t === 'string') {
    const n = Number(t);
    if (Number.isFinite(n)) return strikeTimeMs(n);
    const parsed = Date.parse(t);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (!Number.isFinite(t)) return NaN;
  if (t > 1e15) return Math.round(t / 1e6); // nanoseconds  -> ms
  if (t > 1e12) return t;                    // milliseconds (already)
  if (t > 1e9)  return t * 1000;             // seconds      -> ms
  return t;                                  // small/relative value — leave as-is
}

/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER — Render worker is the 24/7 upstream
   ═══════════════════════════════════════════════════════════════ */
import { SW_CODE } from '@/components/tcm/swCode';

function registerServiceWorker() {
  if (import.meta.env?.DEV) { if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(()=>{}); return; }
  if (!('serviceWorker' in navigator)) return;
  try { const b = new Blob([SW_CODE], { type: 'application/javascript' }); navigator.serviceWorker.register(URL.createObjectURL(b), { scope: '/' }).catch(() => {}); } catch (_) {}
}

import { playThunder as _playThunder, renderGlowFlash } from '@/components/tcm/lightningAudio';

/* EUROPE_GRID / computeRiskFromMetrics / fetchWindForPoint removed (unused in map view) */

/* The radar tiles are requested with colour scheme 6 — RainViewer's
   "NEXRAD Level III" — and the key used to be twenty hand-picked swatches
   that did not correspond to it at all (it started green-blue where the map
   starts cyan, and had no purples or whites where the map has both).

   These are RainViewer's OWN values, from the colour table they publish at
   rainviewer.com/files/rainviewer_api_colors_table.csv, one entry per dBZ
   wherever the colour changes. The key is drawn from them a dBZ at a time,
   so the bar is the map's palette exactly rather than an impression of it.
   The tiles are requested with the snow option on, and for this scheme
   RainViewer's snow half is identical to its rain half, so one bar covers
   both. */
const RV_NEXRAD_STOPS = [[0,'#04e9e7'], [1,'#03eae7'], [2,'#02ebe7'], [3,'#01ece7'], [4,'#00ede7'], [5,'#00efe7'], [6,'#00deea'], [7,'#00cded'], [8,'#00bdf0'], [9,'#00acf3'], [10,'#009cf7'], [11,'#007cf7'], [12,'#005df7'], [13,'#003ef7'], [14,'#001ff7'], [15,'#0000f7'], [16,'#0033c5'], [17,'#006694'], [18,'#009962'], [19,'#00cc31'], [20,'#00ff00'], [21,'#00f000'], [22,'#01e201'], [23,'#01d301'], [24,'#02c502'], [25,'#03b703'], [26,'#04a903'], [27,'#059b03'], [28,'#068e04'], [29,'#078004'], [30,'#087305'], [31,'#398f04'], [32,'#6aab03'], [33,'#9cc702'], [34,'#cde300'], [35,'#ffff00'], [36,'#fbf500'], [37,'#f7eb00'], [38,'#f3e100'], [39,'#efd700'], [40,'#ecce00'], [41,'#efc200'], [42,'#f3b600'], [43,'#f6aa00'], [44,'#fa9e00'], [45,'#fe9300'], [46,'#fe7500'], [47,'#fe5800'], [48,'#fe3a00'], [49,'#fe1d00'], [50,'#ff0000'], [51,'#f10000'], [52,'#e40000'], [53,'#d70000'], [54,'#ca0000'], [55,'#bd0000'], [61,'#ca0032'], [62,'#d70065'], [63,'#e40098'], [64,'#f100cb'], [65,'#fe00fe'], [66,'#ea10f2'], [67,'#d620e7'], [68,'#c331dc'], [69,'#af41d1'], [70,'#9c52c6'], [71,'#af74d1'], [72,'#c396dc'], [73,'#d6b9e7'], [74,'#eadbf2'], [75,'#fefefe'], [80,'#ffffff']];
const RV_DBZ_MAX = 80;
/* The map draws the tiles at this opacity, so the key does too — over the
   same ground colour — or the key would be brighter than anything on the map. */
const RV_TILE_OPACITY = 0.65;

const RAIN_KEY_GRADIENT = (() => {
  const parts = [];
  for (let i = 0; i < RV_NEXRAD_STOPS.length; i += 1) {
    const [d, c] = RV_NEXRAD_STOPS[i];
    const next = i + 1 < RV_NEXRAD_STOPS.length ? RV_NEXRAD_STOPS[i + 1][0] : RV_DBZ_MAX;
    const a = ((d / RV_DBZ_MAX) * 100).toFixed(2);
    const b = ((next / RV_DBZ_MAX) * 100).toFixed(2);
    // Hard edges, one band per entry: RainViewer's table is stepped, and a
    // smooth CSS blend between entries would invent colours it never uses.
    parts.push(`${c} ${a}%`, `${c} ${b}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
})();

/* Reflectivity to rain rate, Marshall–Palmer (Z = 200 R^1.6) — the standard
   conversion, and the one RainViewer's own documentation assumes. Shown under
   the dBZ ticks so the key answers "how heavy is that?" in millimetres. */
const RAIN_KEY_TICKS = [10, 20, 30, 40, 50, 60, 70].map((dbz) => {
  const r = (10 ** (dbz / 10) / 200) ** (1 / 1.6);
  const mm = r < 1 ? r.toFixed(1) : r < 10 ? r.toFixed(0) : String(Math.round(r / 5) * 5);
  return { dbz, mm };
});


/* HistoricalLightningPanel moved to components/tcm/HistoricalLightningPanel.jsx */

import AutoForecastPanel from '@/components/tcm/AutoForecastPanelWrapper';
import USAMonitor from '@/components/USAMonitor';

function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return '148,163,184';
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',');
}

/* ONE table drives the strike colours, the marker sizes and the legend. They
   used to be three separate lists that had drifted apart: the legend's first
   swatch said "<5 min = white" while the map used white only for the first
   two minutes and cream after that, and nothing on the map ever changed
   colour as a strike aged (see the age clock in the map component).

   Two colours were changed because they could not be seen. The old 1–6 hour
   band was #7f1d1d, a red so dark it vanished into the dark basemap — most of
   a busy day's strikes were in it. And white, the newest band, vanished into
   the light basemap. The dark band is a rose now, and on the light theme
   every dot gets a thin dark rim (see strikeStyle) so white still reads.

   Newer strikes are also drawn LARGER. Size is a second cue alongside
   colour, so the age of a strike can be read by people who cannot tell
   orange from red, and the strike that just happened stands out the instant
   it lands. */
const AGE_BANDS = [
  { max:    2, color: '#ffffff', r: 4.2, label: '< 2 min' },
  { max:    5, color: '#fef08a', r: 3.6, label: '5 min' },
  { max:   10, color: '#facc15', r: 3.2, label: '10 min' },
  { max:   30, color: '#f97316', r: 2.9, label: '30 min' },
  { max:   60, color: '#ef4444', r: 2.7, label: '1 hr' },
  { max:  180, color: '#e11d74', r: 2.5, label: '3 hr' },
  { max:  360, color: '#a855f7', r: 2.4, label: '6 hr' },
  { max:  720, color: '#6366f1', r: 2.3, label: '12 hr' },
  { max: Infinity, color: '#64748b', r: 2.2, label: 'older' },
];

/** Index of the age band a strike is in right now. */
function ageBand(timeMs, now = Date.now()) {
  const ageMin = (now - timeMs) / 60000;
  for (let i = 0; i < AGE_BANDS.length; i += 1) if (ageMin < AGE_BANDS[i].max) return i;
  return AGE_BANDS.length - 1;
}

function strikeColor(timeMs) {
  return AGE_BANDS[ageBand(timeMs)].color;
}

/** The full marker style for a strike: colour, size, and the light-theme rim. */
function strikeStyle(timeMs, colourMode, light, now = Date.now()) {
  const band = AGE_BANDS[ageBand(timeMs, now)];
  const fixed = colourMode && colourMode !== 'age'
    ? LIVE_STRIKE_COLOUR_OPTIONS.find((o) => o.id === colourMode)?.hex
    : null;
  return {
    fillColor: fixed || band.color,
    radius: band.r,
    color: light ? 'rgba(15,23,42,0.55)' : 'transparent',
    weight: light ? 0.8 : 0,
  };
}

/* Storm tracking helpers moved to components/tcm/stormTracker */
import { nearestCity, nearestCityShort } from '@/components/tcm/stormTracker';
/* ── AI lightning warnings (server-side engine; see server/aiw) ──
   These replace the old in-browser storm warnings, which every visitor's
   browser computed for itself from its own strike feed. */
import { useAiwLive, SEV, fmtAt } from '@/components/aiw/aiwClient';
import { useAiwMapLayer, AIW_MAP_CSS } from '@/components/aiw/useAiwMapLayer';
import { ForecastSlider, ForecastBanner, AiwLegend } from '@/components/aiw/AiwMapControls';
import IssuedWarningsCentre from '@/components/aiw/IssuedWarningsCentre';
import VoiceAlerts from '@/components/aiw/VoiceAlerts';
import AiwAdminPanel from '@/components/aiw/AiwAdminPanel';
import WarningDetail from '@/components/aiw/WarningDetail';

/* renderGlowFlash moved to components/tcm/lightningAudio */

/* ArchivedDayMap + ArchivePanel moved to components/tcm/LightningArchivePanel */
import ArchivePanel from '@/components/tcm/LightningArchivePanel';
import LightningMapControls from '@/components/tcm/LightningMapControls';

/* ═══════════════════════════════════════════════════════════════
   LAYER DEFS — OM layers removed, only strikes / heatmap / warnings / radar
   ═══════════════════════════════════════════════════════════════ */
const LIVE_STRIKE_COLOUR_OPTIONS = [
  { id: 'age',    label: 'Age',    preview: 'linear-gradient(90deg,#fff,#facc15,#f97316,#ef4444,#7c3aed,#4c1d95)' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'white',  label: 'White',  hex: '#ffffff' },
  { id: 'cyan',   label: 'Cyan',   hex: '#22d3ee' },
  { id: 'lime',   label: 'Lime',   hex: '#84cc16' },
  { id: 'pink',   label: 'Pink',   hex: '#f472b6' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'red',    label: 'Red',    hex: '#ef4444' },
  { id: 'purple', label: 'Purple', hex: '#a78bfa' },
];

/* CAP's own five-level severity scale, which is what every national met
   service publishes against — not the UK's yellow/amber/red, which is a Met
   Office convention and does not travel. */
const WORLD_SEV = {
  Extreme:  { color: '#ef4444', label: 'Extreme' },
  Severe:   { color: '#f97316', label: 'Severe' },
  Moderate: { color: '#facc15', label: 'Moderate' },
  Minor:    { color: '#38bdf8', label: 'Minor' },
  Unknown:  { color: '#94a3b8', label: 'Unknown' },
};
const WORLD_SEV_ORDER = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

const LAYER_DEFS = [
  { id: 'strikes',    label: 'Strikes',          icon: CloudLightning, color: '#facc15' },
  { id: 'strikeheat', label: 'Strike Heat',       icon: Zap,            color: '#a78bfa' },
  { id: 'aiw',        label: 'AI Warnings',       icon: AlertTriangle,  color: '#FF9800' },
  { id: 'aiwTrack',   label: '30-min Track',      icon: Clock,          color: '#FF9800' },
  { id: 'metoffice',  label: 'Met Office Alerts', icon: ShieldAlert,    color: '#38bdf8' },
  { id: 'world',      label: 'World Alerts',      icon: Globe,          color: '#34d399' },
  { id: 'radar',      label: 'Radar',             icon: Radio,          color: '#38bdf8' },
];

/* ═══════════════════════════════════════════════════════════════
   MET OFFICE WEATHER WARNINGS
   Fetches the public GeoJSON cache the Met Office website uses.
   No API key needed. CORS waterfall:
     1. Render worker  /metoffice-warnings  (add 1 route — see below)
     2. allorigins.win free proxy           (works immediately)
     3. Direct fetch                        (works with CORS extension)

   Render worker route (add to your Express server):
     app.get('/metoffice-warnings', async (req, res) => {
       const r = await fetch('https://www.metoffice.gov.uk/public/data/PWSCache/WarningsOfSevereMet/Version3/UK');
       res.setHeader('Access-Control-Allow-Origin', '*');
       res.setHeader('Cache-Control', 'public, max-age=300');
       res.json(await r.json());
     });
   ═══════════════════════════════════════════════════════════════ */
const MO_LS_KEY  = 'tcm_metoffice_warnings_v1';
const MO_LS_TTL  = 8 * 60 * 1000;
const MO_POLL_MS = 10 * 60 * 1000;

const MO_LEVEL = {
  Red:    { color: '#ef4444', fillOpacity: 0.45, weight: 2.5, dash: null,   zOff: 700 },
  Amber:  { color: '#f97316', fillOpacity: 0.38, weight: 2.2, dash: null,   zOff: 600 },
  Yellow: { color: '#facc15', fillOpacity: 0.30, weight: 2.0, dash: null,   zOff: 500 },
  Future: { color: '#94a3b8', fillOpacity: 0.10, weight: 1.5, dash: '5, 4', zOff: 400 },
};
const MO_EVT = {
  Rain:'🌧', Wind:'💨', Snow:'❄️', Ice:'🧊', Fog:'🌫',
  Thunderstorms:'⛈', Thunder:'⛈', 'Extreme Heat':'🌡️', Flood:'🌊', Other:'⚠️',
};

import { MO_REGION_POLYS, moNormaliseRegion } from '@/components/tcm/metOfficeRegions';

// (MO_REGION_POLYS and moNormaliseRegion imported from metOfficeRegions.js above)

/* Read the cached record the home page's warnings panel is built from, so the
   map and the panel can never disagree about what is in force. Falls back to
   asking for a refresh only when the cache is empty (a cold start). */
async function moFetch() {
  try {
    const records = await base44.entities.CachedWarnings.list();
    const record = records?.[0];
    if (record?.all_warnings?.length) {
      return { all_warnings: record.all_warnings, map_url: record.map_url, source: record.source };
    }
  } catch (_) {}
  try {
    const result = await base44.functions.invoke('getMetOfficeWarnings', {});
    if (result) return result;
    const records = await base44.entities.CachedWarnings.list();
    const record = records?.[0];
    if (record) return { all_warnings: record.all_warnings || [], map_url: record.map_url };
  } catch (_) {}
  return null;
}
function moLoadCache() {
  try {
    const { data, savedAt } = JSON.parse(localStorage.getItem(MO_LS_KEY) || 'null') || {};
    if (data && Date.now() - savedAt < MO_LS_TTL) return data;
  } catch (_) {}
  return null;
}
function moSaveCache(data) {
  try { localStorage.setItem(MO_LS_KEY, JSON.stringify({ data, savedAt: Date.now() })); } catch (_) {}
}
/* Feed text goes into markup, so it is escaped on the way in. The Met Office
   is not a hostile source, but 'the upstream feed is trustworthy' is not a
   property worth depending on when escaping costs one function. */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function moPopupHtml(w, isFuture, cfg) {
  const emoji = MO_EVT[w.type] || '⚠️';
  const fmtDT = d => d ? new Date(d).toLocaleString('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
  const regions = Array.isArray(w.regions) ? w.regions.join(', ') : (w.region || '');
  const now = Date.now();
  const validTo = w.validTo ? new Date(w.validTo).getTime() : null;
  const validFrom = w.validFrom ? new Date(w.validFrom).getTime() : null;
  const expiresInMin = validTo ? Math.max(0, Math.round((validTo - now) / 60000)) : null;
  const startsInMin  = (validFrom && validFrom > now) ? Math.round((validFrom - now) / 60000) : null;
  const timeTag = expiresInMin != null
    ? isFuture
      ? (startsInMin != null ? `Starts in ${startsInMin < 60 ? startsInMin + 'm' : Math.floor(startsInMin/60) + 'h ' + (startsInMin%60) + 'm'}` : 'Starting soon')
      : `Expires in ${expiresInMin < 60 ? expiresInMin + 'm' : Math.floor(expiresInMin/60) + 'h ' + (expiresInMin%60) + 'm'}`
    : '';
  /* Frameless: this is rendered INSIDE the map's warning panel, which
     brings its own glass, border and shadow. A card inside a card reads as a
     mistake. */
  return `<div style="padding:13px 14px;font-family:system-ui,sans-serif">
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
      <span style="font-size:1.4rem;line-height:1">${emoji}</span>
      <div style="flex:1;min-width:0">
        <p style="margin:0;font-size:0.86rem;font-weight:800;color:var(--ink-1,#e8eefb);letter-spacing:-0.01em">${escHtml(w.severity||'')} ${escHtml(w.type||'Weather')} Warning</p>
        ${regions ? `<p style="margin:2px 0 0;font-size:0.69rem;color:var(--ink-2,#64748b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📍 ${escHtml(regions)}</p>` : ''}
      </div>
      <span style="padding:3px 8px;border-radius:6px;background:${cfg.color}20;color:${cfg.color};font-size:0.58rem;font-weight:800;flex-shrink:0;border:1px solid ${cfg.color}30">${isFuture?'UPCOMING':'ACTIVE'}</span>
    </div>
    ${w.description ? `<p style="margin:0 0 10px;font-size:0.74rem;color:var(--ink-1,#cbd5e1);line-height:1.5">${escHtml(w.description)}</p>` : ''}
    <div style="background:var(--glass-fill,rgba(255,255,255,0.04));border-radius:9px;padding:9px 11px;margin-bottom:8px;border:1px solid var(--glass-hairline,rgba(255,255,255,0.06))">
      <p style="margin:0 0 5px;font-size:0.6rem;font-weight:700;color:var(--ink-3,#475569);text-transform:uppercase;letter-spacing:0.1em">Validity window</p>
      <p style="margin:0 0 2px;font-size:0.7rem;color:var(--ink-2,#94a3b8)">From: <b style="color:var(--ink-1,#e2e8f0)">${fmtDT(w.validFrom)}</b></p>
      <p style="margin:0;font-size:0.7rem;color:var(--ink-2,#94a3b8)">Until: <b style="color:var(--ink-1,#e2e8f0)">${fmtDT(w.validTo)}</b></p>
      ${timeTag ? `<p style="margin:5px 0 0;font-size:0.7rem;font-weight:700;color:${cfg.color}">${timeTag}</p>` : ''}
    </div>
    ${w.impacts ? `<div style="background:var(--glass-fill,rgba(255,255,255,0.03));border-radius:8px;padding:8px 10px;margin-bottom:8px;border:1px solid var(--glass-hairline,rgba(255,255,255,0.05))"><p style="margin:0 0 3px;font-size:0.6rem;font-weight:700;color:var(--ink-3,#475569);text-transform:uppercase;letter-spacing:0.1em">Likely impacts</p><p style="margin:0;font-size:0.7rem;color:var(--ink-2,#94a3b8);line-height:1.5">${escHtml(w.impacts)}</p></div>` : ''}
    <a href="https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings" target="_blank" rel="noopener" style="display:block;text-align:center;padding:7px;border-radius:9px;background:${cfg.color}15;color:${cfg.color};font-size:0.68rem;font-weight:700;text-decoration:none;border:1px solid ${cfg.color}30;margin-bottom:6px">View on Met Office →</a>
    <p style="margin:0;font-size:0.57rem;color:var(--ink-3,#1e293b);text-align:right">© Crown copyright. Met Office</p>
  </div>`;
}



const MAP_VIEWS = {
  uk:     { center: [54.8, -3.2], zoom: 6 },
  europe: { center: [52.0,  9.0], zoom: 4 },
  // Zoom 2 shows every continent at once without wrapping the date line.
  world:  { center: [20.0, 10.0], zoom: 2 },
};

import { connectBlitzortung } from '@/components/tcm/connectBlitzortung'; import { LIGHTNING_MAP_CSS } from '@/components/tcm/lightningMapStyles';

/* ═══════════════════════════════════════════════════════════════
   STRIKE DENSITY — a continuous field, not a mosaic

   The old heat layer binned strikes into fixed latitude/longitude cells and
   drew ONE LEAFLET RECTANGLE PER CELL, so the result was a grid of visible
   boxes whose size was hard-coded per region and whose aspect ratio was
   corrected by a fudge factor ("latStretch") because a lat/lon rectangle is
   not square on screen. It also renormalised to whatever the busiest cell
   happened to be that minute, so the same colour meant a different thing
   every refresh.

   This draws the field onto a canvas instead:

     1. SPLAT. Each strike is projected to screen and added to a half-
        resolution accumulation grid with bilinear weighting, so a strike
        between two cells contributes to both in proportion — no snapping.

     2. BLUR. Three successive normalised box blurs approximate a Gaussian
        to within about 3%, in O(cells) per pass rather than O(cells x
        kernel²). Normalised means total weight is preserved, which is what
        makes the result a density rather than a glow.

     3. SCALE. The kernel's width is set in KILOMETRES and converted to
        pixels at the view's centre latitude, so the field means the same
        thing at every zoom instead of changing shape as you zoom. It is
        clamped to stay between "smooth" and "still detailed" at the
        extremes of zoom.

     4. COLOUR. The value in each cell is divided by that cell's true ground
        area — computed per row, since metres-per-pixel in Web Mercator
        depends on latitude — giving strikes per 1000 km². That is an
        ABSOLUTE scale: a colour means the same density today as it did
        yesterday, and the legend can state real numbers.

   One deliberate change of meaning: the old field weighted recent strikes up
   to six times heavier than old ones, which made it a blend of "how much"
   and "how recently" that could not be labelled honestly. It is a plain
   density now. Recency is already carried by the strike markers themselves,
   which are coloured by age.
   ═══════════════════════════════════════════════════════════════ */

/* Kernel width on the ground. Twelve kilometres is about the scale of a
   single thunderstorm cell, so individual cells stay separate while the
   speckle between them fills in. */
const HEAT_BANDWIDTH_KM = 12;
/* Accumulation grid resolution, in screen pixels per cell. Two keeps the
   field smooth to the eye while quartering the work. */
const HEAT_DOWNSCALE = 2;
/* Kernel radius in grid cells, clamped. Below the floor the field breaks up
   into speckle at low zoom; above the ceiling it is an undifferentiated
   smear at high zoom. */
const HEAT_SIGMA_MIN = 2.5;
const HEAT_SIGMA_MAX = 26;

/* Strikes per 1000 km². The stops are spaced roughly logarithmically because
   lightning density is: a quiet day over the UK is single digits and the core
   of a severe storm is hundreds. */
/* The bottom stop is set just under the peak a SINGLE isolated strike
   reaches at this bandwidth (about 0.55 per 1000 km²), so one strike in an
   empty sky still registers faintly instead of being rounded away. */
const HEAT_STOPS = [
  { v: 0.15, r:  49, g:  46, b: 129, a: 0.00 }, // fades in rather than edging
  { v: 0.8,  r:  67, g:  56, b: 202, a: 0.30 }, // indigo
  { v: 3,    r:  37, g:  99, b: 235, a: 0.45 }, // blue
  { v: 8,    r:  14, g: 165, b: 233, a: 0.57 }, // sky
  { v: 20,   r:  16, g: 185, b: 129, a: 0.66 }, // green
  { v: 50,   r: 250, g: 204, b:  21, a: 0.75 }, // yellow
  { v: 120,  r: 249, g: 115, b:  22, a: 0.83 }, // orange
  { v: 300,  r: 239, g:  68, b:  68, a: 0.89 }, // red
  { v: 800,  r: 253, g: 224, b: 255, a: 0.94 }, // white-violet core
];

/** Build a 1024-entry lookup table over log10(density) so the per-pixel loop
 *  is one index rather than a scan through the stops. */
function buildHeatLut() {
  const LUT_N = 1024;
  const lo = Math.log10(HEAT_STOPS[0].v);
  const hi = Math.log10(HEAT_STOPS[HEAT_STOPS.length - 1].v);
  const lut = new Uint8ClampedArray(LUT_N * 4);
  for (let i = 0; i < LUT_N; i += 1) {
    const lv = lo + ((hi - lo) * i) / (LUT_N - 1);
    const v = 10 ** lv;
    let a = HEAT_STOPS[0];
    let b = HEAT_STOPS[HEAT_STOPS.length - 1];
    for (let k = 0; k < HEAT_STOPS.length - 1; k += 1) {
      if (v >= HEAT_STOPS[k].v && v <= HEAT_STOPS[k + 1].v) { a = HEAT_STOPS[k]; b = HEAT_STOPS[k + 1]; break; }
    }
    // Interpolate in log space too, or the low end of each band is all one colour.
    const la = Math.log10(a.v); const lb = Math.log10(b.v);
    const f = lb === la ? 0 : (lv - la) / (lb - la);
    lut[i * 4]     = Math.round(a.r + (b.r - a.r) * f);
    lut[i * 4 + 1] = Math.round(a.g + (b.g - a.g) * f);
    lut[i * 4 + 2] = Math.round(a.b + (b.b - a.b) * f);
    lut[i * 4 + 3] = Math.round(255 * (a.a + (b.a - a.a) * f));
  }
  return { lut, lo, hi, n: LUT_N };
}
const HEAT_LUT = buildHeatLut();

/* The legend's bar and its tick labels, derived from HEAT_STOPS so that
   changing the scale changes both the map and the key at once. */
const HEAT_LEGEND_GRADIENT = (() => {
  const lo = Math.log10(HEAT_STOPS[0].v);
  const hi = Math.log10(HEAT_STOPS[HEAT_STOPS.length - 1].v);
  const stops = HEAT_STOPS.map((s) => {
    const pct = ((Math.log10(s.v) - lo) / (hi - lo)) * 100;
    return `rgba(${s.r},${s.g},${s.b},${Math.max(s.a, 0.12).toFixed(2)}) ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
})();
const HEAT_LEGEND_TICKS = ['0.2', '3', '20', '120', '800'];

/** One pass of a normalised box blur, horizontal then vertical.
 *  Running sum, so cost is independent of the radius. */
function boxBlurH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let acc = 0;
    // Prime the window with the clamped left edge.
    for (let i = -r; i <= r; i += 1) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x += 1) {
      dst[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x += 1) {
    let acc = 0;
    for (let i = -r; i <= r; i += 1) acc += src[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y += 1) {
      dst[y * w + x] = acc * norm;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}

/** The Leaflet layer. Kept as a factory so it is only defined once Leaflet
 *  itself has loaded from its CDN. */
function makeStrikeHeatLayer(L) {
  const HeatLayer = L.Layer.extend({
    initialize() { this._pts = []; },

    onAdd(map) {
      this._map = map;
      /* NOT 'leaflet-layer': the page sets an opaque dark background on
         everything carrying that class, to stop white flashes between tiles,
         and an opaque overlay is exactly what a heat field must not be. */
      const c = this._canvas = L.DomUtil.create('canvas', 'lx-heat-canvas');
      c.style.position = 'absolute';
      c.style.pointerEvents = 'none';
      c.style.willChange = 'transform';
      map.getPane('overlayPane').appendChild(c);
      map.on('moveend zoomend resize', this._reset, this);
      this._visFn = () => this._onVisible();
      document.addEventListener('visibilitychange', this._visFn);
      if (map.options.zoomAnimation && L.Browser.any3d) {
        L.DomUtil.addClass(c, 'leaflet-zoom-animated');
        map.on('zoomanim', this._animateZoom, this);
      }
      this._reset();
      return this;
    },

    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      map.off('zoomanim', this._animateZoom, this);
      if (this._visFn) document.removeEventListener('visibilitychange', this._visFn);
      if (this._drawTimer) { clearTimeout(this._drawTimer); this._drawTimer = null; }
      if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      this._map = null;
      return this;
    },

    /* Ride the zoom animation with the tiles instead of jumping at the end. */
    _animateZoom(e) {
      if (!this._canvas) return;
      const scale = this._map.getZoomScale(e.zoom);
      const offset = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), e.zoom, e.center).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },

    setPoints(pts) { this._pts = pts || []; this._reset(); return this; },

    /* Live strikes. Appended, then drawn on a THROTTLE rather than a
       debounce: a debounce waits for a quiet spell and so never fires in a
       busy storm, whereas this guarantees a redraw within one interval of
       the first new strike however fast they keep coming. */
    addPoints(pts) {
      if (!pts || !pts.length) return this;
      for (const pt of pts) this._pts.push(pt);
      this._scheduleDraw();
      return this;
    },

    _scheduleDraw() {
      if (this._drawTimer || !this._map) return;
      /* The interval adapts to the device: about eight times what the last
         draw cost, between 0.6 s and 4 s. A fast desktop gets a field that
         moves with every strike; a slow phone is never asked to spend more
         than about an eighth of its time on this. */
      const gap = Math.min(4000, Math.max(600, (this._lastDrawMs || 20) * 8));
      const wait = Math.max(0, (this._lastDrawAt || 0) + gap - performance.now());
      this._drawTimer = setTimeout(() => {
        this._drawTimer = null;
        // A hidden tab draws nothing; it is redrawn the moment it is shown.
        if (document.visibilityState !== 'visible') { this._dirty = true; return; }
        this._reset();
      }, wait);
    },

    _onVisible() {
      if (document.visibilityState === 'visible' && this._dirty) { this._dirty = false; this._reset(); }
    },

    _reset() {
      const map = this._map;
      const c = this._canvas;
      if (!map || !c) return;
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(size.x * dpr) || c.height !== Math.round(size.y * dpr)) {
        c.width = Math.round(size.x * dpr);
        c.height = Math.round(size.y * dpr);
      }
      c.style.width = size.x + 'px';
      c.style.height = size.y + 'px';
      L.DomUtil.setTransform(c, map.containerPointToLayerPoint([0, 0]), 1);
      const t0 = performance.now();
      this._draw(size, dpr);
      this._lastDrawAt = performance.now();
      this._lastDrawMs = this._lastDrawAt - t0;
    },

    _draw(size, dpr) {
      const map = this._map;
      const ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      const pts = this._pts;
      if (!pts.length) return;

      const DS = HEAT_DOWNSCALE;
      const gw = Math.max(2, Math.ceil(size.x / DS) + 1);
      const gh = Math.max(2, Math.ceil(size.y / DS) + 1);
      const grid = new Float32Array(gw * gh);

      /* ── 1. splat, with bilinear weighting ── */
      let any = false;
      for (let i = 0; i < pts.length; i += 1) {
        const p = map.latLngToContainerPoint(pts[i]);
        const gx = p.x / DS;
        const gy = p.y / DS;
        // A kernel's worth of margin, so strikes just off-screen still
        // contribute to what is on it — otherwise the field has a hard edge
        // at the window that moves when you pan.
        if (gx < -64 || gy < -64 || gx > gw + 64 || gy > gh + 64) continue;
        const x0 = Math.floor(gx); const y0 = Math.floor(gy);
        const fx = gx - x0; const fy = gy - y0;
        for (let dy = 0; dy <= 1; dy += 1) {
          const yy = y0 + dy;
          if (yy < 0 || yy >= gh) continue;
          const wy = dy ? fy : 1 - fy;
          for (let dx = 0; dx <= 1; dx += 1) {
            const xx = x0 + dx;
            if (xx < 0 || xx >= gw) continue;
            grid[yy * gw + xx] += wy * (dx ? fx : 1 - fx);
            any = true;
          }
        }
      }
      if (!any) return;

      /* ── 2. blur: kernel width fixed on the ground ── */
      const centreLat = map.getCenter().lat;
      const mPerPx = (156543.03392 * Math.cos((centreLat * Math.PI) / 180)) / 2 ** map.getZoom();
      const sigmaNominal = (HEAT_BANDWIDTH_KM * 1000) / mPerPx / DS;
      const sigmaCells = Math.min(HEAT_SIGMA_MAX, Math.max(HEAT_SIGMA_MIN, sigmaNominal));
      /* When the kernel had to be clamped — at continental zoom it would be
         sub-pixel, at street zoom enormous — the weight is spread over a
         different area than 12 km would spread it, and the density that comes
         out is correspondingly wrong. Scaling by the ratio of the two areas
         reports the density AT THE NOMINAL BANDWIDTH however it was drawn, so
         a colour means the same number at every zoom. */
      const scaleFix = (sigmaCells / Math.max(sigmaNominal, 1e-6)) ** 2;
      // Three box passes of this radius approximate a Gaussian of sigmaCells.
      const r = Math.max(1, Math.round((sigmaCells * Math.sqrt(12 / 3) + 1) / 2));
      const tmp = new Float32Array(gw * gh);
      for (let pass = 0; pass < 3; pass += 1) {
        boxBlurH(grid, tmp, gw, gh, r);
        boxBlurV(tmp, grid, gw, gh, r);
      }

      /* ── 3. value -> density -> colour ── */
      const img = ctx.createImageData(gw, gh);
      const out = img.data;
      const { lut, lo, hi, n } = HEAT_LUT;
      const invSpan = (n - 1) / (hi - lo);

      for (let y = 0; y < gh; y += 1) {
        /* Ground area of one cell on THIS row. Web Mercator's scale depends
           on latitude, so a cell near Shetland covers noticeably less ground
           than one over the Channel, and a single figure for the whole view
           would misreport both. */
        const lat = map.containerPointToLatLng([0, y * DS]).lat;
        const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
        const cellKm2 = ((mpp * DS) / 1000) ** 2;
        const per1000 = 1000 / Math.max(cellKm2, 1e-9);
        const row = y * gw;
        for (let x = 0; x < gw; x += 1) {
          const v = grid[row + x] * per1000 * scaleFix;
          if (v <= HEAT_STOPS[0].v) continue;
          let idx = Math.round((Math.log10(v) - lo) * invSpan);
          if (idx < 0) idx = 0; else if (idx >= n) idx = n - 1;
          const o = (row + x) * 4;
          const l = idx * 4;
          out[o] = lut[l]; out[o + 1] = lut[l + 1]; out[o + 2] = lut[l + 2]; out[o + 3] = lut[l + 3];
        }
      }

      /* Paint the small grid, then let the browser scale it up smoothly —
         bilinear upsampling of an already-smooth field is free interpolation
         and the reason this has no visible cells at any zoom. */
      const off = document.createElement('canvas');
      off.width = gw; off.height = gh;
      off.getContext('2d').putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, gw, gh, 0, 0, gw * DS * dpr, gh * DS * dpr);
      ctx.restore();
    },
  });
  return new HeatLayer();
}

/* ═══════════════════════════════════════════════════════════════
   MAIN LIGHTNING MAP COMPONENT
   ═══════════════════════════════════════════════════════════════ */
function LightningMap({ region = 'uk', setRegion, isAdmin, archive, setArchive, lightMode = false }) {
  const isEuropeMap = region === 'europe';

  const [mapFullscreen, setMapFullscreen] = useState(false);
  const mapRef            = useRef(null);
  const mapInst           = useRef(null);
  const allDayLayer       = useRef(null);
  const strikeHeatLayer   = useRef(null);
  const flashLayer        = useRef(null);
  const radarLayer        = useRef(null);
  const metOfficeLayer    = useRef(null);
  const worldLayer        = useRef(null);
  const warningRenderer   = useRef(null);
  const audioCtx          = useRef(null);
  const markerPoolRef     = useRef([]);
  const newestLoadedTsRef = useRef(0);
  const heatRebuildTimer  = useRef(null);
  /* Every strike already in the density field, by the same key the live
     feed dedups on — so a strike that arrives live AND sits in the stored
     archive is counted once, whichever reached the field first. */
  const heatKeysRef       = useRef(new Set());
  const pendingCountsRef  = useRef({ strike: 0, today: 0, uk: 0, eu: 0, world: 0 });
  const todayStrikesRef = useRef([]);
  // O(1) dedup index — keys mirror the dupKey format used in handleStrike.
  // Replaces the old O(n) .some() scan that quadratically slowed ingestion
  // (and caused the WebSocket to back-pressure / drop strikes) during storms.
  const strikeKeySetRef = useRef(new Set());
  // Debounced persistence: writing to disk on every single strike was an
  // O(n) serialize-per-strike that stalled the main thread. We coalesce.
  const saveTimerRef    = useRef(null);
  const dirtyRef        = useRef(false);
  // Set by the DB-persistence effect to a function that queues strikes for
  // writing back to the shared base44 DB. Lets the live-socket path (handleStrike)
  // persist its catch too, so the full-day count never falls behind the feed.
  const persistStrikesRef = useRef(null);
  const boxSelectLayerRef = useRef(null);
  const boxSelectStateRef = useRef({ active: false, startLL: null, rect: null });

  /* Mirror the region the page was opened on, including World — reading it as
     a boolean "is it Europe?" silently collapsed World down to UK, which meant
     the World view kept only European strikes and its counter could never
     exceed the EU one. */
  const [view,             setView]             = useState(
    region === 'europe' ? 'europe' : region === 'world' ? 'world' : 'uk'
  );
  /* The header's UK / EU / World switch is the page-level control; without
     this the map keeps whichever view it started on and only the counters
     move. */
  useEffect(() => {
    setView(region === 'europe' ? 'europe' : region === 'world' ? 'world' : 'uk');
  }, [region]);

  const [activeLayers,     setActiveLayers]     = useState(['strikes', 'strikeheat', 'aiw', 'aiwTrack', 'radar']);
  /* ── AI lightning warnings ── */
  const [aiwLead,          setAiwLead]          = useState(0);     // forecast-time slider, minutes ahead
  const [aiwPlaying,       setAiwPlaying]       = useState(false);
  const [aiwSelectedId,    setAiwSelectedId]    = useState(null);
  const [aiwCentreKey,     setAiwCentreKey]     = useState(0);     // bumps the Issued Warnings list on change
  const aiwCentreRef = useRef(null);
  const [leafletReady,     setLeafletReady]     = useState(false);
  const [wsStatus,         setWsStatus]         = useState('connecting');
  const [metOfficeCount,   setMetOfficeCount]   = useState(0);
  const [metOfficeDrawn,   setMetOfficeDrawn]   = useState(0);
  /* What the map's movable warning panel is showing, if anything. */
  const [mapPanel,         setMapPanel]         = useState(null);
  /* Worldwide alerts — every national met service's live CAP warnings, via
     the WMO's aggregation. See server/worldWarnings.js. */
  const [world,            setWorld]            = useState(null);   // the whole payload
  const [worldLoading,     setWorldLoading]     = useState(false);
  const [worldSelected,    setWorldSelected]    = useState(null);   // the open warning
  const [worldDetail,      setWorldDetail]      = useState(null);   // its CAP, once fetched
  const [worldQuery,       setWorldQuery]       = useState('');
  const [worldSevFilter,   setWorldSevFilter]   = useState('all');
  /* How many live sockets the strike feed is holding. Shown so "LIVE" means
     something more specific than "we have not given up yet". */
  const [feedPool,         setFeedPool]         = useState({ live: 0, target: 0 });
  const [lastUpdate,       setLastUpdate]       = useState(new Date());
  const [strikeCount,      setStrikeCount]      = useState(0);
  const [lastMinCount, setLastMinCount] = useState(0);
const [lastMinUkCount, setLastMinUkCount] = useState(0);
const [lastMinEuCount, setLastMinEuCount] = useState(0);
const lastMinBufferRef = useRef([]);
const lastMinUkRef = useRef([]);
const lastMinEuRef = useRef([]);
useEffect(() => {
  const cutoff = Date.now() - 60000;
  lastMinBufferRef.current = lastMinBufferRef.current.filter(s => s.t > cutoff);
  const ukMs = lastMinBufferRef.current.filter(s => inBounds(s.lat, s.lon, 'uk')).length;
  const euMs = lastMinBufferRef.current.filter(s => inBounds(s.lat, s.lon, 'europe')).length;
  setLastMinUkCount(ukMs);
  setLastMinEuCount(euMs);
  setLastMinCount(view === 'europe' ? euMs : ukMs);
}, [view]);
useEffect(() => {
  if (mapInst.current) {
    setTimeout(() => { try { mapInst.current.invalidateSize(); } catch(_) {} }, 100);
  }
}, [mapFullscreen]);
useEffect(() => {
  if (mapFullscreen) {
    document.body.classList.add('tcm-map-fullscreen');
  } else {
    document.body.classList.remove('tcm-map-fullscreen');
  }
  return () => document.body.classList.remove('tcm-map-fullscreen');
}, [mapFullscreen]);
  const [todayCount,       setTodayCount]       = useState(0);
  const [ukCount,          setUkCount]          = useState(0);
  const [euCount,          setEuCount]          = useState(0);
  const [worldCount,       setWorldCount]       = useState(0);
  const [timeTravelMode,   setTimeTravelMode]   = useState(false);
  const [boxSelectMode,    setBoxSelectMode]    = useState(false);
  const [mapReady,         setMapReady]         = useState(false);
  const [boxSelectResult,  setBoxSelectResult]  = useState(null); // { count, bounds }
  const [timeTravelDate,   setTimeTravelDate]   = useState('');
  const [timeTravelHour,   setTimeTravelHour]   = useState(12);
  const [timeTravelImgUrl, setTimeTravelImgUrl] = useState(null);
  const [timeTravelLoading,setTimeTravelLoading]= useState(false);
  const timeTravelLayerRef = useRef(null);

  // ── Time-window strike filter ────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const [strikeFilterDate,  setStrikeFilterDate]  = useState(todayStr);
  const [strikeFilterStart, setStrikeFilterStart] = useState('00:00');
  const [strikeFilterEnd,   setStrikeFilterEnd]   = useState('23:59');
  const [strikeFilterLoading, setStrikeFilterLoading] = useState(false);
  const [filteredStrikes,   setFilteredStrikes]   = useState(null); // null = show live
  // Mirror of "is a strike filter active" for use inside the live painter's
  // stable useCallback (avoids a stale closure). When true, the live socket must
  // NOT paint incoming strikes onto the map, or they'd leak into the filtered view.
  const filterActiveRef = useRef(false);
  const [showStrikeWindow,  setShowStrikeWindow]  = useState(false); // toggle strike window bar

  // ── "Last 24h" window — pick a start point anywhere in the past 24 hours;
  //    the end is always pinned to NOW and the map shows every strike in between.
  //    minutesBack = how far back the start sits from now (0..1440).
  const [last24Mode,       setLast24Mode]       = useState(false);
  const [minutesBack,      setMinutesBack]      = useState(180); // default: last 3h
  const [last24Loading,    setLast24Loading]    = useState(false);
  const last24BufferRef = useRef([]); // merged today+yesterday strikes covering the full 24h
  // Keep the live-painter gate in sync: any active filter suppresses live paint.
  useEffect(() => { filterActiveRef.current = (filteredStrikes !== null) || last24Mode; }, [filteredStrikes, last24Mode]);

  // ── Right-click storm ETA ────────────────────────────────────────────
  const [etaPopup, setEtaPopup] = useState(null); // { lat, lon, text }

  const [liveStrikeColour, setLiveStrikeColour] = useState(() => localStorage.getItem('tcm_live_strike_colour') || 'age');
  const liveStrikeColourRef = useRef(liveStrikeColour);
  const lightModeRef = useRef(lightMode);
  useEffect(() => { lightModeRef.current = lightMode; }, [lightMode]);
  useEffect(() => { liveStrikeColourRef.current = liveStrikeColour; try { localStorage.setItem('tcm_live_strike_colour', liveStrikeColour); } catch (_) {} }, [liveStrikeColour]);

  const [soundEnabled,     setSoundEnabled]     = useState(() => localStorage.getItem('tcm_sound') !== 'false');
  const soundEnabledRef     = useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled;         localStorage.setItem('tcm_sound',    String(soundEnabled));    }, [soundEnabled]);

  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const l = document.createElement('link');
      l.id = 'leaflet-css'; l.rel = 'stylesheet';
      l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(l);
    }
    if (window.L) { setLeafletReady(true); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => setLeafletReady(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    const L = window.L;
    const v = MAP_VIEWS[view];
    const renderer = L.canvas({ padding: 0.5, tolerance: 3 });
    const map = L.map(mapRef.current, { center: v.center, zoom: v.zoom, zoomControl: false, attributionControl: false, preferCanvas: true, renderer });
    mapRef.current.style.background = lightMode ? '#dbe6f3' : '#060d1a';
    // Use devicePixelRatio-aware tiles on HiDPI screens (retina / 2× displays).
    // {r} in the CartoDB URL resolves to '@2x' when the browser reports DPR ≥ 1.5,
    // giving sharper text labels and coastlines on modern displays.
    const dpr = window.devicePixelRatio || 1;
    const retinaParam = dpr >= 1.5 ? '@2x' : '';
    const tileTheme = lightMode ? 'Canvas/World_Light_Gray_Base' : 'Canvas/World_Dark_Gray_Base';
    L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${tileTheme}/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 19, subdomains: 'abcd',
      // Esri serves 256px tiles only — no @2x variant — so the retina
      // upscaling that CARTO supported would just render them blurry.
      detectRetina: false,
      tileSize: 256,
      zoomOffset: 0,
    }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: '' })
      .addAttribution('© <a href="https://www.esri.com/">Esri</a> | ⚡ <a href="https://blitzortung.org">Blitzortung</a> | 🌧 <a href="https://rainviewer.com">RainViewer</a>')
      .addTo(map);
    if (!document.getElementById('blitz-popup-css')) {
      const style = document.createElement('style');
      style.id = 'blitz-popup-css';
      style.textContent = `.blitz-popup .leaflet-popup-content-wrapper{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important}.blitz-popup .leaflet-popup-content{margin:0!important}.blitz-popup .leaflet-popup-tip-container{display:none}.menu-open-blur{filter:blur(5px)!important;transition:filter 0.3s ease;pointer-events:none;}`;
      document.head.appendChild(style);
    }
    radarLayer.current      = L.layerGroup().addTo(map);
    strikeHeatLayer.current = makeStrikeHeatLayer(L).addTo(map);
    /* Warnings get their own pane ABOVE the marker pane. The strike and
       heat layers render onto canvases that Leaflet puts in the marker pane,
       which sits over the overlay pane and swallowed every click aimed at a
       warning underneath it — the shapes were drawn and simply could not be
       opened. A pane of their own, with its own canvas renderer, puts the
       warnings on top where a click can reach them. */
    if (!map.getPane('warningsPane')) {
      const wp = map.createPane('warningsPane');
      wp.style.zIndex = 650;
      wp.style.pointerEvents = 'auto';
    }
    warningRenderer.current = L.canvas({ pane: 'warningsPane' });

    metOfficeLayer.current  = L.layerGroup(); // not added until toggled on
    worldLayer.current      = L.layerGroup();
    allDayLayer.current     = L.layerGroup().addTo(map);
    flashLayer.current      = L.layerGroup().addTo(map);
    timeTravelLayerRef.current = L.layerGroup().addTo(map);
    boxSelectLayerRef.current  = L.layerGroup().addTo(map);
    mapInst.current = map;
    // Right-click → storm ETA popup
    map.on('contextmenu', (e) => {
      const { lat, lng: lon } = e.latlng;
      const now = Date.now();
      const recent = todayStrikesRef.current.filter(s => now - s.time < 20 * 60_000);
      let nearest = null, bestD = Infinity;
      for (const s of recent) {
        const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
        if (d < bestD) { bestD = d; nearest = s; }
      }
      // The AI warning engine already knows where each warning is forecast to
      // be at every 5 minutes; use that rather than guessing a speed.
      const inside = (g) => g && window.L && (() => { try { const pt = window.L.latLng(lat, lon); let hit = false; window.L.geoJSON(g).eachLayer((l) => { if (l.getBounds().contains(pt)) hit = true; }); return hit; } catch { return false; } })();
      let text;
      const nowWarn = (aiwActiveRef.current || []).find((w) => inside(w.geometry));
      const soonWarn = !nowWarn && (aiwActiveRef.current || []).map((w) => ({ w, f: (w.forecast || []).find((f) => inside(f.geometry)) })).find((x) => x.f);
      if (nowWarn) {
        text = `${SEV[nowWarn.severity].label} AI lightning warning in force here until ${fmtAt(nowWarn.expiresAt, nowWarn.tz)}.`;
      } else if (soonWarn) {
        text = `${SEV[soonWarn.w.severity].label} AI lightning warning forecast to reach here in about ${soonWarn.f.lead} minutes.`;
      } else if (nearest && bestD < 2.0) {
        const km = Math.round(Math.sqrt(bestD) * 111);
        const ageMin = Math.round((now - nearest.time) / 60_000);
        text = `Nearest recent strike: ~${km} km away, ${ageMin} min ago. No active cell detected near this point.`;
      } else {
        text = 'No recent lightning activity within range. Low storm risk at this location currently.';
      }
      setEtaPopup({ lat, lon, text });
      // Also show as a Leaflet popup
      L.popup({ className: 'blitz-popup' })
        .setLatLng(e.latlng)
        .setContent(`<div style="background:rgba(6,13,26,0.96);border:1px solid rgba(167,139,250,0.6);border-radius:10px;padding:10px 13px;max-width:240px;font-family:monospace;font-size:11px;color:#e2e8f0;line-height:1.5">
          <strong style="color:#a78bfa;display:block;margin-bottom:4px">⛈ Storm ETA</strong>${text}
        </div>`)
        .openOn(map);
    });
    // Signal that the map and all layer groups are ready for rendering.
    setMapReady(true);
    return () => { map.remove(); mapInst.current = null; setMapReady(false); };
  }, [leafletReady]); // eslint-disable-line

  const loadTimeTravelImage = useCallback(async () => {
    if (!timeTravelDate) return;
    setTimeTravelLoading(true);
    const d = new Date(timeTravelDate + 'T00:00:00Z');
    const endTs   = Math.floor(d.getTime() / 1000) + (timeTravelHour + 1) * 3600;
    const startTs = endTs - 3600;
    const url = `https://www.blitzortung.org/en/archive_data.php?stations_users=0&selected_numbers=&end_date=${endTs}&end_time=0&start_date=${startTs}&start_time=0&north=90&west=-180&east=180&south=-90&rawdata_image=1&map=10&width_orig=640&width_result=640&png_gif=0`;
    setTimeTravelImgUrl(url);
    const L = window.L;
    if (L && timeTravelLayerRef.current && mapInst.current) {
      timeTravelLayerRef.current.clearLayers();
      if (!document.getElementById('blitz-overlay-css')) {
        const s = document.createElement('style');
        s.id = 'blitz-overlay-css';
        s.textContent = `.blitz-screen { mix-blend-mode: screen !important; }`;
        document.head.appendChild(s);
      }
      L.imageOverlay(url, [[-90, -180], [90, 180]], { opacity: 1.0, className: 'blitz-screen' }).addTo(timeTravelLayerRef.current);
    }
    setTimeTravelLoading(false);
  }, [timeTravelDate, timeTravelHour]);

  const exitTimeTravel = useCallback(() => {
    setTimeTravelMode(false);
    setTimeTravelImgUrl(null);
    if (timeTravelLayerRef.current) timeTravelLayerRef.current.clearLayers();
  }, []);

  const handleTimeTravelSnapshot = useCallback(() => {
    if (!timeTravelDate || !timeTravelImgUrl) return;
    if (!handleForcedSnapshotRef.current) return; // guard: ref not yet set
    const d = new Date(timeTravelDate + 'T00:00:00Z');
    const snapshotTs = d.getTime() + timeTravelHour * 3600 * 1000;
    // Use handleForceSnapshot so the snapshot saves to DB and is visible to all users.
    handleForcedSnapshotRef.current(snapshotTs);
  }, [timeTravelDate, timeTravelHour, timeTravelImgUrl]);

  // viewRef mirrors `view` so paint callbacks see the latest region without
  // having to be re-created on every view change. Updated by an effect below.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const paintStrikeOnMap = useCallback((L, strike) => {
    if (!L || !allDayLayer.current) return;
    if (strike.lat == null || strike.lon == null) return;
    // Region-based visibility: UK view shows only UK/Ireland; Europe view shows all.
    // Strikes are always stored in memory regardless of view — just not painted if outside.
    const currentView = viewRef.current === 'europe' ? 'europe' : viewRef.current === 'world' ? 'world' : 'uk';
    if (!inBounds(strike.lat, strike.lon, currentView)) return;
    const eightDaysAgo = Date.now() - 8 * 86400_000;
    if (strike.time < eightDaysAgo) return;
    const st = strikeStyle(strike.time, liveStrikeColourRef.current || 'age', lightModeRef.current);
    const dot = L.circleMarker([strike.lat, strike.lon], {
      ...st,
      fillOpacity: 1,
      interactive: true,
      pane: 'markerPane',
    }).addTo(allDayLayer.current);
    dot._band = ageBand(strike.time);
    dot.on('click', () => dot.bindPopup(strikePopupHtml(strike), { className: 'blitz-popup', maxWidth: 240 }).openPopup());
    dot._strikeTime = strike.time;
    markerPoolRef.current.push(dot);
  }, []);

  const paintStrikes = useCallback((strikes, L) => {
    if (!L || !allDayLayer.current) return;
    const valid = strikes.filter(s => s && s.lat != null && s.lon != null);
    if (!valid.length) return;
    // Batch into chunks of 500 painted per animation frame so the main thread
    // is never blocked for more than ~4ms — handles 28,000+ strikes smoothly.
    const BATCH = 500;
    let i = 0;
    function paintBatch() {
      if (!allDayLayer.current) return; // map may have unmounted
      const end = Math.min(i + BATCH, valid.length);
      for (; i < end; i++) paintStrikeOnMap(L, valid[i]);
      if (i < valid.length) requestAnimationFrame(paintBatch);
    }
    requestAnimationFrame(paintBatch);
  }, [paintStrikeOnMap]);


  // ── Time-window strike loader ──────────────────────────────────────────
  // Loads strikes from the server for any date/time window up to 7 days back.
  // For today it filters the local in-memory buffer for instant results.
  const loadStrikeWindow = useCallback(async () => {
    setStrikeFilterLoading(true);
    try {
      const startMs = new Date(`${strikeFilterDate}T${strikeFilterStart}:00Z`).getTime();
      const endMs   = new Date(`${strikeFilterDate}T${strikeFilterEnd}:00Z`).getTime();
      if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return;

      if (strikeFilterDate === todayStr) {
        // Today: filter in-memory buffer
        const windowed = todayStrikesRef.current.filter(s => s.time >= startMs && s.time <= endMs);
        setFilteredStrikes(windowed);
        // Repaint the map with only the windowed strikes
        const L = window.L;
        if (L && allDayLayer.current) {
          allDayLayer.current.clearLayers();
          markerPoolRef.current = [];
          paintStrikes(windowed, L);
        }
        return;
      }
      // Historical date: fetch from server
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const dayStart = new Date(`${strikeFilterDate}T00:00:00Z`);
      const daysBack = Math.round((today.getTime() - dayStart.getTime()) / 86400_000);
      if (daysBack < 0 || daysBack > 7) return;
      const [ukRes, euRes] = await Promise.allSettled([
        base44.functions.invoke('historicalLightning', { region: 'uk', daysBack }),
        base44.functions.invoke('historicalLightning', { region: 'europe', daysBack }),
      ]);
      const all = [
        ...(ukRes.status === 'fulfilled' ? ukRes.value?.data?.strikes || [] : []),
        ...(euRes.status === 'fulfilled' ? euRes.value?.data?.strikes || [] : []),
      ]
        // Normalise time units FIRST (feeds may send s / ms / ns) so the window
        // filter compares like with like — a raw seconds timestamp (~1.7e9) is
        // always < startMs (~1.75e12) and would otherwise be dropped entirely.
        .map(s => (s && s.lat != null && s.lon != null) ? { ...s, time: strikeTimeMs(s.time) } : null)
        .filter(s => s && Number.isFinite(s.time) && s.time >= startMs && s.time <= endMs);
      setFilteredStrikes(all);
      const L = window.L;
      if (L && allDayLayer.current) {
        allDayLayer.current.clearLayers();
        markerPoolRef.current = [];
        paintStrikes(all, L);
      }
    } catch (e) {
      console.warn('[strikeWindow] failed:', e?.message);
    } finally {
      setStrikeFilterLoading(false);
    }
  }, [strikeFilterDate, strikeFilterStart, strikeFilterEnd, todayStr, paintStrikeOnMap]);

  const resetStrikeFilter = useCallback(() => {
    setFilteredStrikes(null);
    setStrikeFilterDate(todayStr);
    setStrikeFilterStart('00:00');
    setStrikeFilterEnd('23:59');
    // Repaint all today's strikes
    const L = window.L;
    if (L && allDayLayer.current) {
      allDayLayer.current.clearLayers();
      markerPoolRef.current = [];
      paintStrikes(todayStrikesRef.current, L);
    }
  }, [todayStr, paintStrikeOnMap]);

  // Paint the subset of the 24h buffer that falls within [now - minutesBack, now].
  const applyLast24Window = useCallback((mins) => {
    const nowMs = Date.now();
    const startMs = nowMs - mins * 60_000;
    const windowed = last24BufferRef.current.filter(s => s && s.time >= startMs && s.time <= nowMs);
    setFilteredStrikes(windowed);
    const L = window.L;
    if (L && allDayLayer.current) {
      allDayLayer.current.clearLayers();
      markerPoolRef.current = [];
      paintStrikes(windowed, L);
    }
    return windowed.length;
  }, [paintStrikeOnMap]);

  // Build the 24h buffer (today + yesterday from the server, merged with the
  // live in-memory buffer), deduped + normalised, then paint the chosen window.
  // Today's UTC buffer alone can't cover a window that reaches into yesterday
  // (e.g. at 02:00, "24h ago" is in yesterday's UTC day), so we pull both.
  const enterLast24 = useCallback(async () => {
    setLast24Mode(true);
    setShowStrikeWindow(false); // they're mutually exclusive views
    setLast24Loading(true);
    try {
      const cutoff24 = Date.now() - 24 * 60 * 60 * 1000;
      const [ukToday, euToday, ukYday, euYday] = await Promise.allSettled([
        base44.functions.invoke('historicalLightning', { region: 'uk',     daysBack: 0 }),
        base44.functions.invoke('historicalLightning', { region: 'europe', daysBack: 0 }),
        base44.functions.invoke('historicalLightning', { region: 'uk',     daysBack: 1 }),
        base44.functions.invoke('historicalLightning', { region: 'europe', daysBack: 1 }),
      ]);
      const grab = (r) => (r.status === 'fulfilled' ? (r.value?.data?.strikes || r.value?.strikes || []) : []);
      const raw = [...grab(ukToday), ...grab(euToday), ...grab(ukYday), ...grab(euYday)];
      // Merge with the live in-memory buffer so the freshest strikes are present.
      const merged = [...raw, ...todayStrikesRef.current];
      const seen = new Set();
      const buffer = [];
      for (const s of merged) {
        if (!s || s.lat == null || s.lon == null) continue;
        const t = strikeTimeMs(s.time);
        if (!Number.isFinite(t) || t < cutoff24) continue; // only the last 24h
        const k = `${Math.round(t / 1000)}_${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        buffer.push({ lat: s.lat, lon: s.lon, time: t, amp: s.amp || 0 });
      }
      buffer.sort((a, b) => a.time - b.time);
      last24BufferRef.current = buffer;
      applyLast24Window(minutesBack);
    } catch (e) {
      console.warn('[last24] failed:', e?.message);
    } finally {
      setLast24Loading(false);
    }
  }, [minutesBack, applyLast24Window]);

  const exitLast24 = useCallback(() => {
    setLast24Mode(false);
    setFilteredStrikes(null);
    last24BufferRef.current = [];
    const L = window.L;
    if (L && allDayLayer.current) {
      allDayLayer.current.clearLayers();
      markerPoolRef.current = [];
      paintStrikes(todayStrikesRef.current, L);
    }
  }, [paintStrikeOnMap]);

  // While the Last-24h window is open, keep "now" live: every 15s fold any newly
  // arrived strikes into the 24h buffer, drop anything older than 24h, and
  // re-apply the window so the end edge tracks the present moment.
  useEffect(() => {
    if (!last24Mode) return;
    const tick = () => {
      const nowMs = Date.now();
      const cutoff24 = nowMs - 24 * 60 * 60 * 1000;
      const seen = new Set(last24BufferRef.current.map(s => `${Math.round(s.time / 1000)}_${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}`));
      for (const s of todayStrikesRef.current) {
        if (!s || s.lat == null || s.lon == null) continue;
        const t = strikeTimeMs(s.time);
        if (!Number.isFinite(t) || t < cutoff24) continue;
        const k = `${Math.round(t / 1000)}_${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        last24BufferRef.current.push({ lat: s.lat, lon: s.lon, time: t, amp: s.amp || 0 });
      }
      // Prune anything that has aged out of the rolling 24h.
      last24BufferRef.current = last24BufferRef.current.filter(s => s.time >= cutoff24);
      last24BufferRef.current.sort((a, b) => a.time - b.time);
      applyLast24Window(minutesBack);
    };
    const iv = setInterval(tick, 15_000);
    return () => clearInterval(iv);
  }, [last24Mode, minutesBack, applyLast24Window]);

  const strikePopupHtml = (s) => {
    const t = new Date(s.time);
    const timeStr = t.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const dateStr = t.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    const ageMin = Math.round((Date.now()-s.time)/60000);
    const ageStr = ageMin<60?`${ageMin}m ago`:`${Math.round(ageMin/60)}h ${ageMin%60}m ago`;
    // Use the long-form locator ("over X" / "near X" / "N km from X, country")
    // so the user gets a clearer sense of WHERE the strike was, not just the
    // closest town name.
    const locStr = nearestCity(s.lat, s.lon);
    // Coordinates to 4dp ≈ 11 m at UK latitudes — far below Blitzortung's
    // intrinsic detection accuracy, but it makes the point unambiguous and
    // lets the user copy/paste it into a mapping tool.
    const latStr = `${Math.abs(s.lat).toFixed(4)}°${s.lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(s.lon).toFixed(4)}°${s.lon >= 0 ? 'E' : 'W'}`;
    return `<div style="background:#0d1525;border:1px solid rgba(250,204,21,0.40);border-radius:14px;padding:13px 16px;min-width:210px;max-width:260px;font-family:system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,0.7),0 0 0 1px rgba(250,204,21,0.08)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">
        <span style="font-size:1.1rem">⚡</span>
        <div>
          <p style="margin:0;font-size:0.82rem;font-weight:800;color:#facc15;letter-spacing:-0.01em">Lightning Strike</p>
          <p style="margin:0;font-size:0.68rem;color:#64748b;font-weight:600">${ageStr}</p>
        </div>
      </div>
      <div style="background:rgba(250,204,21,0.06);border:1px solid rgba(250,204,21,0.15);border-radius:9px;padding:8px 10px;margin-bottom:8px">
        <p style="margin:0 0 2px;font-size:0.78rem;font-weight:700;color:#f1f5f9;font-family:monospace">${timeStr}</p>
        <p style="margin:0;font-size:0.66rem;color:#64748b;font-family:monospace">${dateStr}</p>
      </div>
      <p style="margin:0 0 4px;font-size:0.72rem;color:#94a3b8">📍 ${locStr}</p>
      <p style="margin:0 0 4px;font-size:0.63rem;color:#475569;font-family:monospace">${latStr}, ${lonStr}</p>
      ${s.amp?`<div style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2)"><span style="font-size:0.66rem;color:#38bdf8;font-weight:600">⚡ ${Math.abs(s.amp)} kA</span></div>`:''}
    </div>`;
  }
  /* Gather the strikes the field is built from and hand them over. All the
     drawing lives in the layer; this only decides WHICH strikes count. */
  const rebuildStrikeHeatmap = useCallback(() => {
    const layer = strikeHeatLayer.current;
    if (!layer || !layer.setPoints) return;

    const dayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    const region = viewRef.current === 'europe' ? 'europe' : viewRef.current === 'world' ? 'world' : 'uk';

    const seen = new Set();
    const pts = [];
    const take = (s) => {
      if (!s || s.lat == null || s.lon == null) return;
      /* "Today" applies to the archive too. Stored snapshots hold whole
         previous days, and they were being merged in with no date check —
         so the field labelled "strikes per 1,000 km² today" also counted
         every archived day's strikes on top. */
      if (!(strikeTimeMs(s.time) >= dayStart)) return;
      if (!inBounds(s.lat, s.lon, region)) return;
      /* Same rounding as the live feed's own dedup, so a strike that reached
         us by two routes is one strike here too — otherwise the density is
         simply wrong wherever the archive and the live feed overlap. */
      const k = `${Math.round(s.time / 1000)}_${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}`;
      if (seen.has(k)) return;
      seen.add(k);
      pts.push([s.lat, s.lon]);
    };

    for (const s of todayStrikesRef.current) take(s);
    for (const d of archive || []) for (const s of d.strikes || []) take(s);

    heatKeysRef.current = seen;
    layer.setPoints(pts);
  }, [archive]);


  // Swap tile layer when light/dark mode toggles
  useEffect(() => {
    const map = mapInst.current;
    if (!map || !window.L) return;
    const L = window.L;
    const dpr = window.devicePixelRatio || 1;
    const retinaParam = dpr >= 1.5 ? '@2x' : '';
    const tileTheme = lightMode ? 'Canvas/World_Light_Gray_Base' : 'Canvas/World_Dark_Gray_Base';
    map.eachLayer(layer => { if (layer._url) map.removeLayer(layer); });
    L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${tileTheme}/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 19, subdomains: 'abcd',
      // Esri serves 256px tiles only — no @2x variant — so the retina
      // upscaling that CARTO supported would just render them blurry.
      detectRetina: false,
      tileSize: 256,
      zoomOffset: 0,
    }).addTo(map);
    if (mapRef.current) mapRef.current.style.background = lightMode ? '#dbe6f3' : '#060d1a';
  }, [lightMode]); // eslint-disable-line

  // ── Box selection — draw a rectangle and count strikes inside ──────────
  useEffect(() => {
    const map = mapInst.current;
    const L = window.L;
    if (!map || !L) return;
    const st = boxSelectStateRef.current;

    if (!boxSelectMode) {
      // Clean up
      if (boxSelectLayerRef.current) boxSelectLayerRef.current.clearLayers();
      map.dragging.enable();
      map.getContainer().style.cursor = '';
      st.active = false; st.startLL = null; st.rect = null;
      return;
    }

    map.getContainer().style.cursor = 'crosshair';
    map.dragging.disable();

    const onMouseDown = (e) => {
      st.active = true;
      st.startLL = e.latlng;
      if (st.rect) { try { boxSelectLayerRef.current.removeLayer(st.rect); } catch(_){} }
      st.rect = L.rectangle([e.latlng, e.latlng], {
        color: '#38bdf8', weight: 2, dashArray: '6 4',
        fillColor: '#38bdf8', fillOpacity: 0.08, interactive: false,
      }).addTo(boxSelectLayerRef.current);
    };
    const onMouseMove = (e) => {
      if (!st.active || !st.rect || !st.startLL) return;
      st.rect.setBounds([st.startLL, e.latlng]);
    };
    const onMouseUp = (e) => {
      if (!st.active || !st.startLL) return;
      st.active = false;
      const bounds = L.latLngBounds(st.startLL, e.latlng);
      const count = todayStrikesRef.current.filter(s =>
        s && s.lat != null && s.lon != null && bounds.contains([s.lat, s.lon])
      ).length;
      const center = bounds.getCenter();
      setBoxSelectResult({ count, lat: center.lat, lon: center.lng, bounds });
    };
    const onTouchStart = (e) => { if (e.touches.length === 1) onMouseDown({ latlng: map.containerPointToLatLng(L.point(e.touches[0].clientX - map.getContainer().getBoundingClientRect().left, e.touches[0].clientY - map.getContainer().getBoundingClientRect().top)) }); };
    const onTouchMove  = (e) => { if (e.touches.length === 1) onMouseMove({ latlng: map.containerPointToLatLng(L.point(e.touches[0].clientX - map.getContainer().getBoundingClientRect().left, e.touches[0].clientY - map.getContainer().getBoundingClientRect().top)) }); };
    const onTouchEnd   = (e) => { const t = e.changedTouches[0]; onMouseUp({ latlng: map.containerPointToLatLng(L.point(t.clientX - map.getContainer().getBoundingClientRect().left, t.clientY - map.getContainer().getBoundingClientRect().top)) }); };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup',   onMouseUp);
    map.getContainer().addEventListener('touchstart', onTouchStart, { passive: true });
    map.getContainer().addEventListener('touchmove',  onTouchMove,  { passive: true });
    map.getContainer().addEventListener('touchend',   onTouchEnd);
    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup',   onMouseUp);
      try { map.getContainer().removeEventListener('touchstart', onTouchStart); } catch(_){}
      try { map.getContainer().removeEventListener('touchmove',  onTouchMove);  } catch(_){}
      try { map.getContainer().removeEventListener('touchend',   onTouchEnd);   } catch(_){}
      map.getContainer().style.cursor = '';
      map.dragging.enable();
    };
  }, [boxSelectMode, leafletReady]); // eslint-disable-line

  // Restyle every marker when the colour preference or the theme changes.
  useEffect(() => {
    if (!window.L || !allDayLayer.current) return;
    const now = Date.now();
    allDayLayer.current.eachLayer(dot => {
      try {
        const t = dot._strikeTime;
        if (!t) return;
        const st = strikeStyle(t, liveStrikeColour, lightMode, now);
        dot.setStyle({ fillColor: st.fillColor, color: st.color, weight: st.weight });
        dot.setRadius(st.radius);
        dot._band = ageBand(t, now);
      } catch (_) {}
    });
  }, [liveStrikeColour, lightMode]); // eslint-disable-line

  useEffect(() => {
    const mapView = MAP_VIEWS[view]; const c = mapView?.center;
    if (!mapInst.current || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
    try { mapInst.current.flyTo(c, mapView.zoom, { animate: true, duration: 1.0 }); } catch (_) {}
    const L = window.L;
    if (!L || !allDayLayer.current) return;
    allDayLayer.current.clearLayers();
    markerPoolRef.current = [];
    paintStrikes(todayStrikesRef.current, L);
    rebuildStrikeHeatmap();
  }, [view]); // eslint-disable-line

  useEffect(() => {
    if (!mapInst.current) return;
    [
      [allDayLayer,     'strikes'],
      [strikeHeatLayer, 'strikeheat'],
      [metOfficeLayer,  'metoffice'],
      [worldLayer,      'world'],
      [radarLayer,      'radar'],
    ].forEach(([ref, id]) => {
      if (!ref.current) return;
      activeLayers.includes(id)
        ? (!mapInst.current.hasLayer(ref.current) && mapInst.current.addLayer(ref.current))
        : ( mapInst.current.hasLayer(ref.current) && mapInst.current.removeLayer(ref.current));
    });
  }, [activeLayers]);

  /* ── The age clock ────────────────────────────────────────────────────
     Strikes now change colour and size AS THEY AGE, live. The interval this
     replaces ran every 90 seconds and updated `_vLine` and `_hLine` — the
     cross-hair markers of an older design. The dots on the map today are
     circle markers that have neither, so the update silently did nothing: a
     strike painted white stayed white until something forced a full repaint
     of the map, and the age colours were whatever age the strike happened to
     be when it was drawn.

     Every two seconds each marker's band is recomputed — a single number
     comparison — and only the markers that actually crossed into a new band
     are restyled. On a 30,000-strike day that is a few dozen style changes a
     tick, and Leaflet's canvas renderer batches them into one redraw. The
     tick also notices midnight, and rebuilds the density field so yesterday
     drops out of "today". Nothing runs while the tab is hidden; the first
     tick back catches everything up at once. */
  useEffect(() => {
    const iv = setInterval(() => {
      const pc = pendingCountsRef.current;
      if (!pc.strike) return;
      pendingCountsRef.current = { strike: 0, today: 0, uk: 0, eu: 0, world: 0 };
      // One batched render for all of them.
      setStrikeCount((c) => c + pc.strike);
      setTodayCount((c) => c + pc.today);
      if (pc.uk) setUkCount((c) => c + pc.uk);
      if (pc.eu) setEuCount((c) => c + pc.eu);
      setWorldCount((c) => c + pc.world);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const heatDayRef = useRef(new Date().toDateString());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      const mode = liveStrikeColourRef.current || 'age';
      const light = lightModeRef.current;
      const pool = markerPoolRef.current;
      for (let i = 0; i < pool.length; i += 1) {
        const dot = pool[i];
        const t = dot._strikeTime;
        if (!t) continue;
        const band = ageBand(t, now);
        if (band === dot._band) continue;
        dot._band = band;
        try {
          const st = strikeStyle(t, mode, light, now);
          dot.setStyle({ fillColor: st.fillColor, color: st.color, weight: st.weight });
          dot.setRadius(st.radius);
        } catch (_) {}
      }
      const today = new Date().toDateString();
      if (today !== heatDayRef.current) {
        heatDayRef.current = today;
        liveCbs.current?.rebuildStrikeHeatmap?.();
      }
    };
    const iv = setInterval(tick, 2000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  useEffect(() => {
  // mapReady ensures allDayLayer.current exists (set at end of map-init effect).
  // leafletReady fires in the same React cycle as map-init, so allDayLayer may
  // still be null when the old [leafletReady] version ran → silent paint failure.
  if (!mapReady) return;
  const L = window.L;
  const existing = loadTodayStrikes();
  if (existing.length) {
    const held = strikeKeySetRef.current;
    const toAdd = existing.filter(s => {
      if (!s || s.lat == null || s.lon == null || !s.time) return false;
      const k = strikeKey(s);
      if (held.has(k)) return false;
      held.add(k);
      return true;
    });
    todayStrikesRef.current = [...todayStrikesRef.current, ...toAdd];
    todayStrikesRef.current.sort((a, b) => a.time - b.time);
    newestLoadedTsRef.current = todayStrikesRef.current[todayStrikesRef.current.length - 1]?.time || 0;
    setTodayCount(todayStrikesRef.current.length);
    setUkCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'uk')).length);
    setEuCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'europe')).length);
    setWorldCount(todayStrikesRef.current.length);
    if (L) paintStrikes(existing, L);
    // Deferred full repaint — allDayLayer may not be fully attached on first tick
    setTimeout(() => {
      if (!allDayLayer.current || !window.L) return;
      allDayLayer.current.clearLayers();
      markerPoolRef.current = [];
      paintStrikes(todayStrikesRef.current, window.L);
    }, 300);
    setTimeout(rebuildStrikeHeatmap, 800);
    setTimeout(rebuildStrikeHeatmap, 3000);
  }
}, [mapReady]); // eslint-disable-line
  // Pull strikes the Render worker collected while no users were on the site
    // Cross-device sync — fetch from Render on mount AND poll every 60s
  useEffect(() => {
    // Use mapReady (not leafletReady) — allDayLayer must exist before we paint
    if (!mapReady) return;
    let cancelled = false;

    // Dedup helper — returns only strikes NOT already known. Uses the SAME
    // shared Set as the live WebSocket path so the two feeds never double-count
    // or fight each other. Newly accepted strikes are registered into the Set
    // by commit() below.
    const dedup = (incoming) => {
      if (!Array.isArray(incoming) || !incoming.length) return [];
      const out = [];
      const localSeen = new Set();
      for (const s of incoming) {
        if (!s || !s.time || s.lat == null || s.lon == null) continue;
        const k = strikeKey(s);
        if (strikeKeySetRef.current.has(k) || localSeen.has(k)) continue;
        localSeen.add(k);
        out.push(s);
      }
      return out;
    };

    // ── DB PERSISTENCE QUEUE (root fix for the backend undercount) ────────────
    // The Render worker catches strikes 24/7, but historically nothing wrote its
    // continuous catch into the shared base44 DB — the page only READ the
    // worker's rolling /strikes/recent buffer, which expires. So once a strike
    // aged out of /recent (and if the gappy backend poll missed it) it vanished
    // from the day's count. Here every strike this client sees — from the live
    // socket, the worker pull, or a cross-session merge — is queued and flushed
    // to saveLightningStrikes, so the DB steadily accumulates the FULL day with
    // no gaps. saveLightningStrikes already dedups server-side, so re-sending a
    // strike another tab/device already saved is harmless. This makes the count
    // self-healing: whatever any open client catches becomes permanent.
    const persistQueueRef = { current: [] };
    const persistSeenRef  = new Set();           // keys already queued/sent this session
    let persistTimer = null;
    let persistInFlight = false;

    const flushPersist = async () => {
      if (persistInFlight) return;
      if (!persistQueueRef.current.length) return;
      // Drain up to 500 per request (saveLightningStrikes batches/dedups).
      const batch = persistQueueRef.current.splice(0, 500);
      persistInFlight = true;
      try {
        await base44.functions.invoke('saveLightningStrikes', {
          strikes: batch.map(s => ({ lat: s.lat, lon: s.lon, time: s.time, amp: s.amp || 0 })),
        });
      } catch (_) {
        // On failure, drop the batch rather than retry forever — the next pull
        // from the worker/DB will re-surface anything important, and the live
        // feed keeps flowing. (Avoids a stuck queue back-pressuring the page.)
      } finally {
        persistInFlight = false;
        // If more is queued, keep draining promptly.
        if (persistQueueRef.current.length) {
          persistTimer = setTimeout(flushPersist, 1500);
        }
      }
    };

    // Queue strikes for DB persistence. Only today's strikes, deduped per session.
    const queueForPersist = (strikes) => {
      if (!Array.isArray(strikes) || !strikes.length) return;
      const todayStart0 = new Date(); todayStart0.setUTCHours(0, 0, 0, 0);
      const todayStartMs0 = todayStart0.getTime();
      let added = 0;
      for (const s of strikes) {
        if (!s || s.lat == null || s.lon == null) continue;
        const t = Number(s.time);
        if (!Number.isFinite(t) || t < todayStartMs0) continue; // server only keeps today
        const k = strikeKey(s);
        if (persistSeenRef.has(k)) continue;
        persistSeenRef.add(k);
        persistQueueRef.current.push(s);
        added++;
      }
      if (added && !persistTimer && !persistInFlight) {
        persistTimer = setTimeout(() => { persistTimer = null; flushPersist(); }, 1500);
      }
    };
    // Expose to the live-socket path (handleStrike) via a ref so strikes caught
    // by the client's own WebSocket are persisted too, not just pulled ones.
    persistStrikesRef.current = queueForPersist;

    // Merge fresh strikes into ref, register keys, update counts, paint, save
    const commit = (fresh) => {
      if (!fresh.length) return;
      for (const s of fresh) strikeKeySetRef.current.add(strikeKey(s));
      todayStrikesRef.current.push(...fresh);
      todayStrikesRef.current.sort((a, b) => a.time - b.time);
      // Debounced persistence (was a synchronous full-array serialize on EVERY
      // pull — at 100k+ strikes the 20s Render poll re-serialised the whole
      // array repeatedly, stalling the main thread and back-pressuring the live
      // socket). Coalesce to one write ~1s after the last change, matching
      // handleStrike's strategy.
      dirtyRef.current = true;
      if (!saveTimerRef.current) {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          if (dirtyRef.current) { saveTodayStrikes(todayStrikesRef.current); dirtyRef.current = false; }
        }, 1000);
      }
      newestLoadedTsRef.current = todayStrikesRef.current[todayStrikesRef.current.length - 1]?.time || 0;
      setTodayCount(todayStrikesRef.current.length);
      setUkCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'uk')).length);
      setEuCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'europe')).length);
      setWorldCount(todayStrikesRef.current.length);
      const L = window.L;
      if (L) paintStrikes(fresh, L);
      queueForPersist(fresh); // accumulate into the shared DB (gapless full day)
      setTimeout(rebuildStrikeHeatmap, 600);
    };

    // ── Database read — today's strikes across all of UK + Europe ──
    // IMPORTANT: a single entities.list() call is hard-capped at 5,000 rows by
    // the server, so on busy days it silently dropped thousands of strikes.
    // historicalLightning paginates (up to 40k) and returns the FULL day, so we
    // use it for both regions to get the complete count.
    const pullFromDatabase = async () => {
      try {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayStartMs = todayStart.getTime();
        const todayDateStr = todayStart.toISOString().slice(0, 10);
        const [ukRes, euRes, archiveRes] = await Promise.allSettled([
          base44.functions.invoke('historicalLightning', { region: 'uk', daysBack: 0 }),
          base44.functions.invoke('historicalLightning', { region: 'europe', daysBack: 0 }),
          base44.entities.LightningArchive.filter({ date: todayDateStr }),
        ]);
        const rawStrikes = [
          ...(ukRes.status === 'fulfilled' ? ukRes.value?.data?.strikes || [] : []),
          ...(euRes.status === 'fulfilled' ? euRes.value?.data?.strikes || [] : []),
        ];
        // Normalise time to ms FIRST (feeds may send s / ms / ns), THEN filter to
        // today. Filtering on a raw seconds timestamp dropped those strikes every
        // time because ~1.7e9 < todayStartMs ~1.75e12.
        const liveStrikes = rawStrikes
          .map(s => (s && s.lat != null && s.lon != null) ? { lat: s.lat, lon: s.lon, time: strikeTimeMs(s.time), amp: s.amp || 0 } : null)
          .filter(s => s && Number.isFinite(s.time) && s.time >= todayStartMs);
        const archiveStrikes = (archiveRes.status === 'fulfilled' ? archiveRes.value : [])
          .flatMap(r => (r.strikes || []).filter(s => s && s.lat != null && s.lon != null))
          .map(s => ({ lat: s.lat, lon: s.lon, time: strikeTimeMs(s.time) || todayStartMs, amp: s.amp || 0 }));
        const allRows = [...liveStrikes, ...archiveStrikes];
        if (!allRows.length || cancelled) return;
        const fresh = dedup(allRows);
        commit(fresh);

      } catch (_) {}
    };

    const pullFromRender = async () => {
      try {
        const r = await fetch(`${RENDER_WORKER_HTTP}/strikes/recent`);
        if (!r.ok || cancelled) return;
        const strikes = await r.json();
        if (!Array.isArray(strikes) || !strikes.length) return;
        // Normalise time units (Render may emit s / ms / ns). Without this a
        // seconds-based timestamp is < eightDaysAgo and paintStrikeOnMap skips
        // the dot entirely — counted but never drawn.
        const normalised = strikes
          .map(s => (s && s.lat != null && s.lon != null) ? { lat: s.lat, lon: s.lon, time: strikeTimeMs(s.time), amp: s.amp || s.mamp || 0 } : null)
          .filter(s => s && Number.isFinite(s.time));
        commit(dedup(normalised));
      } catch (_) {}
    };

    // Fire immediately, then on a 30s/20s/60s cycle
    pullFromDatabase();
    pullFromRender();
    const iv1 = setInterval(pullFromDatabase, 60_000);
    const iv2 = setInterval(pullFromRender,   20_000);
    const onVisible = () => { pullFromDatabase(); pullFromRender(); };
    window.addEventListener('focus', onVisible);
    /* Named, so the cleanup below can actually remove it. This was an inline
       arrow that nothing ever removed: the effect re-runs on [mapReady,
       isEuropeMap], so switching to the Europe map left the previous one
       attached and every later tab-focus fired an extra pair of refetches. */
    const onVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') onVisible();
    };
    document.addEventListener('visibilitychange', onVisibilityRefresh);
    return () => {
      cancelled = true;
      clearInterval(iv1);
      clearInterval(iv2);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisibilityRefresh);
      // Best-effort final flush of any queued strikes, then clear the timer.
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      if (persistQueueRef.current.length) { flushPersist(); }
      persistStrikesRef.current = null;
    };
  }, [mapReady, isEuropeMap]); // eslint-disable-line
  // ── Stop all audio when the map unmounts (leaving the TCM page) ──────────
  // Thunder/siren use a shared AudioContext; TTS uses speechSynthesis. Without
  // this, queued speech + audio kept playing on other pages after navigating away.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;

    /* Silence the whole context the moment the tab goes away, and bring it back
       when it returns. The visibility gate on playThunder above stops NEW
       thunder; this stops whatever was already ringing — a rumble runs for a
       couple of seconds, which is long enough to be heard after a tab switch —
       and it also parks the audio hardware instead of leaving a live context
       open behind a tab nobody is looking at. */
    const onVisibility = () => {
      const ctx = audioCtx.current;
      if (!ctx) return;
      try {
        if (document.visibilityState === 'hidden') ctx.suspend();
        else ctx.resume();
      } catch (_) {}
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      try { window.speechSynthesis?.cancel(); } catch (_) {}
      try { audioCtx.current?.close(); } catch (_) {}
      audioCtx.current = null;
    };
  }, []);

  /* THUNDER ONLY PLAYS WHILE YOU ARE LOOKING AT THE LIGHTNING MAP.
     Leaving this page tears the socket down, so that was never the problem.
     A BACKGROUNDED TAB was: nothing here stopped on `visibilitychange`, so the
     socket stayed open and every European strike kept firing thunder from a tab
     the reader had switched away from — which is heard as lightning on the home
     page, or over whatever else they are doing. Thunder is ambience for a map
     you are watching; off-screen it is just noise coming from nowhere. */
  const playThunder = useCallback(
    () => _playThunder(audioCtx, soundEnabledRef.current && mountedRef.current && document.visibilityState === 'visible'),
    []);

  const loadRadar = useCallback(async () => {
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const data = await res.json();
      const frames = data?.radar?.past;
      if (!frames?.length) return;
      const latest = frames[frames.length - 1];
      const L = window.L;
      if (!L || !radarLayer.current) return;
      radarLayer.current.clearLayers();
      // RainViewer tiles — serve 512px tiles on HiDPI displays for crisper radar
      const rdpr = window.devicePixelRatio || 1;
      const rTileSize = rdpr >= 1.5 ? 512 : 256;
      L.tileLayer(`https://tilecache.rainviewer.com${latest.path}/${rTileSize}/{z}/{x}/{y}/6/1_1.png`, {
        opacity: 0.65,
        tileSize: rTileSize,
        zoomOffset: rdpr >= 1.5 ? -1 : 0,
        maxZoom: 19,
        maxNativeZoom: 18,
        minZoom: 0,
        detectRetina: false,
        updateWhenIdle: false,
        updateWhenZooming: false,
        keepBuffer: 4,
      }).addTo(radarLayer.current);
    } catch (_) {}
  }, []);

  // ── Met Office Weather Warnings overlay ──────────────────────────────────
  // Active only when 'metoffice' layer is toggled on. Polls every 10 minutes.
  useEffect(() => {
    if (!activeLayers.includes('metoffice') || !leafletReady) return;
    const L = window.L;
    if (!L || !metOfficeLayer.current) return;
    let cancelled = false;

    const render = (warnings, mapUrl) => {
      if (cancelled || !metOfficeLayer.current) return;
      metOfficeLayer.current.clearLayers();
      const now = Date.now();

      /* The warning's REAL shape, straight from the Met Office NSWWS feed.
         The old layer stretched a screenshot of the Met Office warning map
         over a rectangle of the UK and put invisible hand-drawn boxes on top
         of it for the clicks — so the colours were a picture that did not
         line up with the base map, and a click anywhere in the Yorkshire box
         opened a warning that might cover a corner of it. */
      let drawnShapes = 0;
      let count = 0;

      (Array.isArray(warnings) ? warnings : []).forEach(w => {
        const validTo   = w.validTo   ? new Date(w.validTo).getTime()   : Infinity;
        const validFrom = w.validFrom ? new Date(w.validFrom).getTime() : 0;
        if (validTo < now) return;
        const isFuture = validFrom > now;
        const cfg = MO_LEVEL[isFuture ? 'Future' : (w.severity || 'Yellow')] || MO_LEVEL.Yellow;
        count++;

        const geom = w.geometry || w.area_drawing || null;
        if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon' || geom.type === 'Feature' || geom.type === 'GeometryCollection')) {
          try {
            const gj = L.geoJSON(geom, {
              pane: 'warningsPane',
              renderer: warningRenderer.current || undefined,
              style: {
                color: cfg.color, weight: cfg.weight, opacity: 0.95,
                fillColor: cfg.color, fillOpacity: cfg.fillOpacity,
                dashArray: cfg.dash || undefined, interactive: true,
              },
            });
            gj.on('click', () => showMetOfficePanel(w, isFuture, cfg));
            gj.addTo(metOfficeLayer.current);
            drawnShapes++;
            return;
          } catch (_) { /* fall through to the region outline */ }
        }

        /* No geometry on this warning — fall back to the coarse region
           outlines, but DRAW them rather than leaving them invisible, so it
           is obvious the area is approximate rather than silently wrong. */
        const regionNames = Array.isArray(w.regions) ? w.regions : (w.region ? [w.region] : ['UK']);
        const seen = new Set();
        regionNames.forEach(rName => {
          const key = moNormaliseRegion(rName);
          if (!key || seen.has(key)) return;
          seen.add(key);
          const poly = MO_REGION_POLYS[key];
          if (!poly) return;
          try {
            const leafPoly = L.polygon(poly, {
              color: cfg.color, weight: 1.4, opacity: 0.7, dashArray: '6, 5',
              fillColor: cfg.color, fillOpacity: cfg.fillOpacity * 0.5,
              interactive: true, pane: 'warningsPane',
              renderer: warningRenderer.current || undefined,
            });
            leafPoly.on('click', () => showMetOfficePanel(w, isFuture, cfg));
            leafPoly.addTo(metOfficeLayer.current);
            drawnShapes++;
          } catch (_) {}
        });
      });

      setMetOfficeCount(count);
      setMetOfficeDrawn(drawnShapes);
    };

    const refresh = async () => {
      if (cancelled) return;
      const cached = moLoadCache();
      if (cached) { render(cached.warnings || cached, cached.mapUrl); return; }
      const data = await moFetch();
      if (data && !cancelled) {
        const warnings = data?.all_warnings || data;
        const mapUrl = data?.map_url || null;
        moSaveCache({ warnings, mapUrl });
        render(warnings, mapUrl);
      }
    };

    refresh();
    const iv = setInterval(refresh, MO_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
      if (metOfficeLayer.current) metOfficeLayer.current.clearLayers();
      setMetOfficeCount(0);
      setMetOfficeDrawn(0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayers.includes('metoffice'), leafletReady]);

  /* Fetch the worldwide list only while the layer is on, and refresh on the
     same ten-minute cadence the server caches it for. */
  useEffect(() => {
    if (!activeLayers.includes('world')) return;
    let cancelled = false;
    const load = async () => {
      setWorldLoading(true);
      try {
        const res = await fetch('/api/world-warnings');
        const json = await res.json();
        if (!cancelled) setWorld(json);
      } catch (_) {
        if (!cancelled) setWorld({ ok: false, warnings: [], counts: { total: 0, drawn: 0 } });
      } finally {
        if (!cancelled) setWorldLoading(false);
      }
    };
    load();
    const iv = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [activeLayers.includes('world')]); // eslint-disable-line

  /* Draw the ones that carry a shape. Most of the world's warnings describe
     their area in words or in a national geocode rather than coordinates, so
     the map shows what can honestly be drawn and the list below carries the
     rest. */
  useEffect(() => {
    const L = window.L;
    if (!L || !worldLayer.current) return;
    worldLayer.current.clearLayers();
    if (!activeLayers.includes('world') || !world?.warnings?.length) return;

    for (const w of world.warnings) {
      if (!w.geometry) continue;
      const colour = WORLD_SEV[w.severity]?.color || WORLD_SEV.Unknown.color;
      try {
        const gj = L.geoJSON(w.geometry, {
          pane: 'warningsPane',
          renderer: warningRenderer.current || undefined,
          style: {
            color: colour, weight: 1.6, opacity: 0.9,
            fillColor: colour, fillOpacity: 0.22, interactive: true,
          },
        });
        gj.on('click', () => { openWorldWarning(w); setMapPanel({ kind: 'world', w, accent: colour }); });
        gj.addTo(worldLayer.current);
      } catch (_) {}
    }
  }, [world, activeLayers.includes('world'), leafletReady]); // eslint-disable-line

  /* Opening a warning: show what the list already knows immediately, then
     fill in the description from its CAP. For US alerts the server has it
     cached from the NWS feed and the round trip is instant; for everything
     else it fetches that one CAP document. */
  const openWorldWarning = useCallback(async (w) => {
    setWorldSelected(w);
    setWorldDetail(null);
    if (w.geometry && mapInst.current) {
      try {
        const b = window.L.geoJSON(w.geometry).getBounds();
        /* Capped at 7 on purpose. The Esri Canvas basemap this map is built
           on has patchy coverage over open ocean beyond about zoom 7 — it is
           a land-data backdrop — and zooming past that onto a coastal warning
           fills the sea with Esri's 'Zoom Level Not Supported' placeholder
           tiles. Seven frames a US county cluster perfectly well and stays
           inside the tiles that exist. */
        mapInst.current.flyToBounds(b, { padding: [40, 40], maxZoom: 7, duration: 1 });
      } catch (_) {}
    }
    try {
      const res = await fetch('/api/world-warnings/cap?u=' + encodeURIComponent(w.capUrl));
      const json = await res.json();
      setWorldDetail((prev) => (prev === null ? json : prev));
    } catch (_) {
      setWorldDetail({ ok: false });
    }
  }, []);

  const showMetOfficePanel = useCallback((w, isFuture, cfg) => {
    setMapPanel({
      kind: 'metoffice',
      accent: cfg.color,
      title: `${w.severity || ''} ${w.type || 'Weather'} warning`.trim(),
      html: moPopupHtml(w, isFuture, cfg),
    });
  }, []);

  const renderFlash = useCallback((lat, lon) => {
  if (!activeLayers.current?.includes('strikes') && !activeLayers.includes('strikes')) return;
  if (!mapInst.current) return;
  try {
    const bounds = mapInst.current.getBounds();
    if (!bounds.contains([lat, lon])) return;
  } catch (_) { return; }
  renderGlowFlash(lat, lon, flashLayer);
}, [activeLayers]);

  const pendingStrikesRef = useRef([]);
  const rafPendingRef     = useRef(null);
  const flushPendingStrikes = useCallback(() => {
    const L = window.L;
    rafPendingRef.current = null;
    // While a strike filter is active (Last-24h or Strike Window), do NOT paint
    // live strikes — they'd appear outside the selected window. They're still
    // recorded in todayStrikesRef and will show when the filter is cleared, and
    // the 24h window's own 15s tick folds them in within its time range.
    if (filterActiveRef.current) { pendingStrikesRef.current.length = 0; return; }
    if (!pendingStrikesRef.current.length || !L || !allDayLayer.current) return;
    const batch = pendingStrikesRef.current.splice(0, 300);
    batch.forEach(strike => paintStrikeOnMap(L, strike));
    if (pendingStrikesRef.current.length > 0) rafPendingRef.current = requestAnimationFrame(flushPendingStrikes);
  }, [paintStrikeOnMap]);

  const handleStrike = useCallback((strike) => {
    if (!strike || strike.lat == null || strike.lon == null || strike.time == null) return;
    /* The socket now delivers the whole planet (connectBlitzortung no longer
       filters), so bound what we keep. Europe is retained whatever the view,
       because the UK and EU counters are both on screen at once and filtering
       to the selected region alone would zero the other one. Beyond Europe is
       kept only while the World view is actually open — storing every strike
       on Earth to look at the UK would cost memory and paint time for nothing. */
    if (viewRef.current !== 'world' && !inBounds(strike.lat, strike.lon, 'europe')) return;
    // Defensive unit-normalisation at the single live chokepoint: every strike
    // (socket, SW buffer, cross-session) flows through here, so normalising once
    // guarantees the dedup key, the today/8-day guards and the heatmap all see ms.
    const tMs = strikeTimeMs(strike.time);
    if (!Number.isFinite(tMs)) return;
    if (tMs !== strike.time) strike = { ...strike, time: tMs };
    const dupKey = strikeKey(strike);
    // O(1) dedup — was an O(n) .filter().some() over the whole day's strikes,
    // which became O(n²) across a storm and back-pressured the socket.
    if (strikeKeySetRef.current.has(dupKey)) return;
    strikeKeySetRef.current.add(dupKey);
    // Persist this live-caught strike to the shared DB (gapless full-day store).
    if (persistStrikesRef.current) { try { persistStrikesRef.current([strike]); } catch (_) {} }
    /* Counters are accumulated here and pushed to the screen ONCE a second
       (see the counter flush effect). Updating eight pieces of state per
       strike re-rendered the entire page several times a second in a storm,
       and every one of those renders was felt as lag. */
    {
      const pc = pendingCountsRef.current;
      pc.strike += 1; pc.today += 1; pc.world += 1;
      if (inBounds(strike.lat, strike.lon, 'uk')) pc.uk += 1;
      if (inBounds(strike.lat, strike.lon, 'europe')) pc.eu += 1;
    }
    const nowMs = Date.now();
    // Incremental last-minute buffer: push one, drop only what's aged out from
    // the front. The old code re-filtered + double-scanned the entire buffer on
    // every strike — wasteful and a contributor to ingestion lag.
    lastMinBufferRef.current.push({ t: nowMs, lat: strike.lat, lon: strike.lon, uk: inBounds(strike.lat, strike.lon, 'uk'), eu: inBounds(strike.lat, strike.lon, 'europe') });
    const cutoff = nowMs - 60000;
    while (lastMinBufferRef.current.length && lastMinBufferRef.current[0].t <= cutoff) {
      lastMinBufferRef.current.shift();
    }
    let ukMs = 0, euMs = 0;
    for (let i = 0; i < lastMinBufferRef.current.length; i++) {
      if (lastMinBufferRef.current[i].uk) ukMs++;
      if (lastMinBufferRef.current[i].eu) euMs++;
    }
    void ukMs; void euMs; // the once-a-second timer publishes these
    playThunder();
        todayStrikesRef.current.push(strike);
    dirtyRef.current = true;

    // Debounced persistence — coalesce rapid strikes into one write ~1s apart
    // instead of an O(n) serialize on every strike (which stalled ingestion).
    newestLoadedTsRef.current = strike.time;
    if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        if (dirtyRef.current) { saveTodayStrikes(todayStrikesRef.current); dirtyRef.current = false; }
      }, 1000);
    }
    renderFlash(strike.lat, strike.lon);


    pendingStrikesRef.current.push(strike);
    if (!rafPendingRef.current) rafPendingRef.current = requestAnimationFrame(flushPendingStrikes);
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'NEW_STRIKES', strikes: [strike] });
    }
    /* Live density. This used to be `clearTimeout` then `setTimeout(8000)`
       on EVERY strike — a debounce, which only fires after eight quiet
       seconds. During an active storm strikes arrive every second or two, the
       timer was reset every time, and so the density field never updated at
       all while there was weather to show; it caught up only in the lulls.
       Each strike now goes straight into the field, which redraws itself on
       its own throttle (see makeStrikeHeatLayer). */
    {
      const region = viewRef.current === 'europe' ? 'europe' : viewRef.current === 'world' ? 'world' : 'uk';
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      if (strike.time >= dayStart.getTime() && inBounds(strike.lat, strike.lon, region)) {
        const k = `${Math.round(strike.time / 1000)}_${Math.round(strike.lat * 1000)}_${Math.round(strike.lon * 1000)}`;
        if (!heatKeysRef.current.has(k)) {
          heatKeysRef.current.add(k);
          strikeHeatLayer.current?.addPoints?.([[strike.lat, strike.lon]]);
        }
      }
    }
  }, [playThunder, renderFlash, flushPendingStrikes, rebuildStrikeHeatmap]);


  const doMidnightSnapshot = useCallback((isForced = false, snapshotAt = null) => {
    const snap = [...todayStrikesRef.current];
    const captureTime = snapshotAt || Date.now();
    const dateKey = isForced
      ? `${localDateKey(captureTime)} [FORCED ${new Date(captureTime).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}]`
      : localDateKey(snap.length ? snap[snap.length-1].time : captureTime);
    const hourBuckets = {};
    snap.forEach(s => { const h = new Date(s.time).getHours(); hourBuckets[h] = (hourBuckets[h]||0)+1; });
    const peakHour = Object.entries(hourBuckets).sort((a,b) => b[1]-a[1])[0];
    const entry = {
      date: dateKey, capturedAt: captureTime, isForced,
      strikes: snap.map(s => ({ lat: s.lat, lon: s.lon, time: s.time, amp: s.amp })),
      stormCount: (aiwActiveRef.current || []).length,
      peakHour: peakHour ? `${String(peakHour[0]).padStart(2,'0')}:00` : '—',
      stormWarnings: (aiwActiveRef.current || []).map(w => ({
        id: w.id, risk: w.severity, centroid: { lat: w.centroid?.[0], lon: w.centroid?.[1] },
        locationLabel: w.areaLabel, expiresAt: w.expiresAt,
      })),
    };
    setArchive(prev => {
      const updated = [...prev.filter(d => d.date !== dateKey), entry].slice(-30);
      saveArchive(updated);
      return updated;
    });
    if (!isForced) {
      const cutoff24h = Date.now() - 25 * 60 * 60 * 1000;
      todayStrikesRef.current = todayStrikesRef.current.filter(s => s.time > cutoff24h);
      // Rebuild the dedup index from the surviving strikes so it stays bounded
      // and never holds stale keys for purged strikes.
      strikeKeySetRef.current = new Set(todayStrikesRef.current.map(strikeKey));
      dirtyRef.current = true;
      saveTodayStrikes(todayStrikesRef.current);
      setTodayCount(todayStrikesRef.current.length);
      try { allDayLayer.current?.clearLayers(); } catch (_) {}
      markerPoolRef.current = [];
      const L = window.L;
      if (L && allDayLayer.current) {
        paintStrikes(todayStrikesRef.current, L);
      }
      /* The heat layer is a single canvas now — it is cleared by being
         redrawn, not by emptying a group of shapes. */
      setTimeout(rebuildStrikeHeatmap, 800);
    }
  }, [isEuropeMap, paintStrikeOnMap, rebuildStrikeHeatmap, setArchive]);

  const forceSnapshotRef = useRef(doMidnightSnapshot);
  useEffect(() => { forceSnapshotRef.current = doMidnightSnapshot; }, [doMidnightSnapshot]);

  // Ref to handleForceSnapshot so time-travel callbacks can call it without
  // recreating the callback each render.
  const handleForcedSnapshotRef = useRef(null);

  const handleForceSnapshot = useCallback((snapshotTime) => {
    return new Promise(async (resolve) => {
      const cutoff = snapshotTime || Date.now();
      // Snapshot window: a 24-hour rolling window ending at the cutoff time.
      // (We can't restrict to "today only" here because admins use this to
      // capture a specific past hour within the last 24h.)
      const cutoffStart = cutoff - 24 * 60 * 60 * 1000;
      const windowStrikes = todayStrikesRef.current.filter(s => s.time >= cutoffStart && s.time <= cutoff);
      const prevStrikes = todayStrikesRef.current;
      todayStrikesRef.current = windowStrikes;
      forceSnapshotRef.current(true, cutoff);
      todayStrikesRef.current = prevStrikes;

      // Build the same archive key the backend will use, so the local snap
      // and the DB-loaded snap share identity (HistoricalLightningPanel dedup
      // keys on `date` first, so this gets us a clean merge).
      const snapDate = new Date(cutoff);
      const dateStr  = snapDate.toISOString().slice(0, 10);
      const timeLabel = snapDate.toISOString().slice(11, 16).replace(':', '');
      const archiveKey = `${dateStr}_FORCED_${timeLabel}`;

      const snap = {
        date: archiveKey,
        capturedAt: cutoff,
        isForced: true,
        strikes: windowStrikes.map(s => ({ lat: s.lat, lon: s.lon, time: s.time, amp: s.amp })),
        stormCount: (aiwActiveRef.current || []).length,
        peakHour: new Date(cutoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        stormWarnings: (aiwActiveRef.current || []).map(w => ({
          id: w.id, risk: w.severity, centroid: { lat: w.centroid?.[0], lon: w.centroid?.[1] },
          locationLabel: w.areaLabel, expiresAt: w.expiresAt,
        })),
      };
      saveSnapshot(snap);
      window.dispatchEvent(new StorageEvent('storage', { key: SNAPSHOT_KEY, newValue: JSON.stringify(loadSnapshots()) }));

      // ALSO push to the DB so other users see this snapshot in their
      // Historical Lightning panel. Previously this only saved locally,
      // which is why "force snapshot" appeared only on the admin's browser.
      // We send the actual strike payload (not isWholeDay), since this is a
      // user-driven point-in-time capture.
      if (isAdmin) {
        try {
          await base44.functions.invoke('saveSnapshotToDB', {
            snapshotAt: cutoff,
            isWholeDay: false,
            region: 'global',
            strikes: snap.strikes,
          });
        } catch (e) {
          console.warn('[handleForceSnapshot] DB save failed:', e?.message);
        }
      }
      setTimeout(resolve, 200);
    });
  }, [isAdmin]);

  // Keep the ref in sync so time-travel snapshot can call it
  useEffect(() => { handleForcedSnapshotRef.current = handleForceSnapshot; }, [handleForceSnapshot]);


  /* Latest-callback ref. Read through this inside the long-lived effect below
     so that effect never has to list a callback as a dependency. */
  const liveCbs = useRef({});
  liveCbs.current = { paintStrikes, handleStrike, loadRadar, doMidnightSnapshot, rebuildStrikeHeatmap };

  useEffect(() => {
    if (!leafletReady) return;
    registerServiceWorker();

    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    const onStorage = (e) => {
      if (e.key !== STORE_KEY) return;
      try {
        const incoming = JSON.parse(e.newValue || '[]');
        const cutoff24h = Date.now() - 25 * 60 * 60 * 1000;
        const fresh = incoming.filter(s => s.time && s.time > cutoff24h && s.time > newestLoadedTsRef.current);
        if (!fresh.length) return;
        const held = strikeKeySetRef.current;
        const toAdd = fresh.filter(s => {
          if (!s || s.lat == null || s.lon == null) return false;
          const k = strikeKey(s);
          if (held.has(k)) return false;
          held.add(k);
          return true;
        });
        if (!toAdd.length) return;
        todayStrikesRef.current.push(...toAdd);
        todayStrikesRef.current.sort((a, b) => a.time - b.time);
        newestLoadedTsRef.current = todayStrikesRef.current[todayStrikesRef.current.length - 1]?.time || 0;
        setTodayCount(todayStrikesRef.current.length);
        setUkCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'uk')).length);
        setEuCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'europe')).length);
        setWorldCount(todayStrikesRef.current.length);
        const L = window.L;
        if (L) liveCbs.current.paintStrikes(toAdd, L);
      } catch (_) {}
    };
    window.addEventListener('storage', onStorage);

    const crossSessionStrikes = loadNewStrikesSince(newestLoadedTsRef.current) || [];
    if (crossSessionStrikes.length) {
      const held = strikeKeySetRef.current;
      const toAdd = crossSessionStrikes.filter(s => {
        if (!s || s.lat == null || s.lon == null || !s.time) return false;
        const k = strikeKey(s);
        if (held.has(k)) return false;
        held.add(k);
        return true;
      });
      if (toAdd.length) {
        todayStrikesRef.current.push(...toAdd);
        todayStrikesRef.current.sort((a, b) => a.time - b.time);
        setTodayCount(todayStrikesRef.current.length);
        const L = window.L;
        if (L) liveCbs.current.paintStrikes(toAdd, L);
      }
    }

    const swMessageHandler = (event) => {
      if (event.data?.type === 'BUFFERED_STRIKES') {
        event.data.strikes.forEach(s => liveCbs.current.handleStrike(s));
      }
      if (event.data?.type === 'DO_MIDNIGHT_SNAPSHOT') liveCbs.current.doMidnightSnapshot(false);
    };
    navigator.serviceWorker?.addEventListener('message', swMessageHandler);

    navigator.serviceWorker?.ready.then(reg => { reg.active?.postMessage({ type: 'TAB_ACTIVE' }); }).catch(() => {});
    navigator.serviceWorker?.ready.then(async () => {
      try {
        const cache = await caches.open('tcm-bg-strikes-v1');
        const response = await cache.match('/tcm-bg-strikes');
        if (response) {
          const { strikes } = await response.json();
          if (strikes?.length) {
            const held = strikeKeySetRef.current;
            const dayAgo = Date.now() - 86400000;
            const toAdd = [];
            for (const raw of (strikes || [])) {
              if (!raw || raw.lat == null || raw.lon == null || raw.time == null) continue;
              // Normalise time first (an older service-worker build may have
              // cached seconds/ns) so the day filter, dedup key and 8-day paint
              // guard all see milliseconds — consistent with every other path.
              const t = strikeTimeMs(raw.time);
              if (!Number.isFinite(t) || t <= dayAgo) continue;
              const s = { lat: raw.lat, lon: raw.lon, time: t, amp: raw.amp || 0 };
              const k = strikeKey(s);
              if (held.has(k)) continue;
              held.add(k);
              toAdd.push(s);
            }
            if (toAdd.length) {
              todayStrikesRef.current.push(...toAdd);
              todayStrikesRef.current.sort((a, b) => a.time - b.time);
              setTodayCount(todayStrikesRef.current.length);
              setUkCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'uk')).length);
              setEuCount(todayStrikesRef.current.filter(s => inBounds(s.lat, s.lon, 'europe')).length);
              setWorldCount(todayStrikesRef.current.length);
              const L = window.L;
              if (L) liveCbs.current.paintStrikes(toAdd, L);
            }
          }
          await cache.delete('/tcm-bg-strikes');
        }
      } catch (_) {}
    }).catch(() => {});

    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        saveTodayStrikes(todayStrikesRef.current);
        newestLoadedTsRef.current = todayStrikesRef.current[todayStrikesRef.current.length - 1]?.time || 0;
        navigator.serviceWorker?.ready.then(reg => { reg.active?.postMessage({ type: 'TAB_HIDDEN' }); }).catch(() => {});
      } else {
        navigator.serviceWorker?.ready.then(reg => { reg.active?.postMessage({ type: 'TAB_ACTIVE' }); }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    const stopWs = connectBlitzortung(
      s => liveCbs.current.handleStrike(s),
      setWsStatus,
      { onPool: (live, target) => setFeedPool({ live, target }) },
    );


    liveCbs.current.loadRadar();
    const radarIv  = setInterval(() => liveCbs.current.loadRadar(), 10*60*1000);
    const updateIv = setInterval(() => setLastUpdate(new Date()), 30*1000);
    const saveIv = setInterval(() => {
  if (dirtyRef.current) {
    saveTodayStrikes(todayStrikesRef.current);
    newestLoadedTsRef.current = todayStrikesRef.current[todayStrikesRef.current.length - 1]?.time || 0;
    dirtyRef.current = false;
  }
}, 3000);
    const lastMinIv = setInterval(() => {
  const cutoff = Date.now() - 60000;
  lastMinBufferRef.current = lastMinBufferRef.current.filter(s => s.t > cutoff);
  const ukMs = lastMinBufferRef.current.filter(s => inBounds(s.lat, s.lon, 'uk')).length;
  const euMs = lastMinBufferRef.current.filter(s => inBounds(s.lat, s.lon, 'europe')).length;
  setLastMinUkCount(ukMs);
  setLastMinEuCount(euMs);
  // Use viewRef (not the captured `view`) so this timer always reflects the
  // CURRENT region. With the old stale closure, switching UK↔EU left this
  // showing the previous region's value, which then never updated — the
  // "number that sits there and never changes".
  const regionKey = viewRef.current === 'europe' ? 'europe' : viewRef.current === 'world' ? 'world' : 'uk';
  setLastMinCount(regionKey === 'uk' ? ukMs : euMs);
}, 1000);

    let snapshotDone = false;
    const snapshotIv = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 23 && now.getMinutes() === 59 && !snapshotDone) {
        snapshotDone = true;
        liveCbs.current.doMidnightSnapshot(false);
        setTimeout(() => { snapshotDone = false; }, 70000);
      }
    }, 30000);

    let swPingInterval = null;
    if ('serviceWorker' in navigator) {
      swPingInterval = setInterval(() => {
        navigator.serviceWorker.ready.then(reg => { reg.active?.postMessage({ type: 'PING' }); }).catch(() => {});
        if (todayStrikesRef.current.length) saveTodayStrikes(todayStrikesRef.current);
      }, 25000);
    }

    return () => {
      stopWs();
      clearInterval(radarIv);
      clearInterval(updateIv); clearInterval(snapshotIv); clearInterval(swPingInterval);
      clearInterval(lastMinIv);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', swMessageHandler);
      window.removeEventListener('storage', onStorage);
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      if (dirtyRef.current) { saveTodayStrikes(todayStrikesRef.current); dirtyRef.current = false; }
    };
  }, [leafletReady]); // eslint-disable-line -- callbacks are read through liveCbs

  useEffect(() => {
  const flushAll = () => {
    // Write synchronously — beforeunload has no async budget
    try {
      saveTodayStrikes(todayStrikesRef.current);
      newestLoadedTsRef.current = todayStrikesRef.current[todayStrikesRef.current.length - 1]?.time || 0;
    } catch (_) {}
  };
  window.addEventListener('beforeunload', flushAll);
  window.addEventListener('pagehide', flushAll);
  // Also flush on visibility hidden (mobile backgrounding)
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushAll();
  };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    window.removeEventListener('beforeunload', flushAll);
    window.removeEventListener('pagehide', flushAll);
    document.removeEventListener('visibilitychange', onHide);
  };
}, []);

  const toggleLayer = (id) => setActiveLayers(prev => prev.includes(id) ? prev.filter(l=>l!==id) : [...prev, id]);
  const fmt = (d) => d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const sc = wsStatus==='live' ? { color:'#22c55e', label:'LIVE' } : { color:'#facc15', label:'CONNECTING…' };
  /* ── AI warnings: live data, the map layer, selection ──────────────── */
  const aiw = useAiwLive({ includeTest: !!isAdmin });
  const aiwActiveRef = useRef([]);
  aiwActiveRef.current = aiw.active;
  useEffect(() => aiw.subscribe((m) => { if (m.type === 'cycle') setAiwCentreKey((k) => k + 1); }), [aiw.subscribe]); // eslint-disable-line
  /* The header counts warnings in the region being viewed, so the number
     matches what is on the map. */
  const inView = (w) => view === 'world' ? true
    : view === 'europe' ? (w.continents || []).includes('Europe')
    : (w.countryCodes || []).some((c) => c === 'GB' || c === 'IE' || c === 'IM' || c === 'JE' || c === 'GG');
  const activeWarningCount = aiw.active.filter((w) => !w.isTest && inView(w)).length;
  const openAiwOnMap = useCallback((w) => {
    if (!w) return;
    setAiwSelectedId(w.id);
    setAiwLead(0);
    if (!activeLayers.includes('aiw')) setActiveLayers((prev) => [...prev, 'aiw']);
    const live = aiwActiveRef.current.find((x) => x.id === w.id) || w;
    setMapPanel({ kind: 'aiw', w: live });
    try { mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
  }, [activeLayers]); // eslint-disable-line
  const showAiwById = useCallback((id) => {
    const w = aiwActiveRef.current.find((x) => x.id === id);
    if (w) openAiwOnMap(w);
  }, [openAiwOnMap]);
  const afterAdminChange = useCallback(() => { aiw.refresh(); setAiwCentreKey((k) => k + 1); }, [aiw.refresh]); // eslint-disable-line
  const openAiwFull = useCallback((w) => {
    setAiwSelectedId(w.id);
    setMapPanel(null);
    setTimeout(() => { try { aiwCentreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }, 50);
  }, []);
  useAiwMapLayer({
    map: mapReady ? mapInst.current : null,
    renderer: warningRenderer.current,
    warnings: aiw.active,
    showAreas: activeLayers.includes('aiw'),
    showTracks: activeLayers.includes('aiwTrack'),
    lead: aiwLead,
    selectedId: aiwSelectedId,
    onSelect: (w) => { setAiwSelectedId(w.id); setMapPanel({ kind: 'aiw', w }); },
    lightMode,
  });
  // Keep an open map panel showing the latest version of its warning.
  useEffect(() => {
    if (mapPanel?.kind !== 'aiw') return;
    const live = aiw.active.find((x) => x.id === mapPanel.w.id);
    if (live && live.updatedAt !== mapPanel.w.updatedAt) setMapPanel({ kind: 'aiw', w: live });
  }, [aiw.active]); // eslint-disable-line

  return (
    <>
      <style>{LIGHTNING_MAP_CSS + AIW_MAP_CSS}</style>

      {/* ── Page shell ──────────────────────────────────────────────────── */}
      <div style={{ paddingBottom: 36 }}>

        {/* ── Sticky title bar + live stat strip (Aurora Glass) ───────── */}
        <LightningHeaderBar
          lightMode={lightMode} wsStatus={wsStatus} feedPool={feedPool}
          view={view} setView={setRegion || setView}
          mapFullscreen={mapFullscreen} setMapFullscreen={setMapFullscreen}
          lastMinUkCount={lastMinUkCount} lastMinEuCount={lastMinEuCount}
          ukCount={ukCount} euCount={euCount} worldCount={worldCount}
          activeWarningCount={activeWarningCount} lastUpdate={lastUpdate}
        />

        {/* ── Map area ────────────────────────────────────────────────── */}
        <div style={{ padding:'10px 16px 0' }}>
          <div className={lightMode?'lightning-map-light':''} style={{ position:mapFullscreen?'fixed':'relative', inset:mapFullscreen?0:undefined, zIndex:mapFullscreen?9997:undefined, borderRadius:mapFullscreen?0:20, overflow:'hidden', border:'1px solid var(--glass-hairline)', boxShadow:mapFullscreen?'none':'var(--glass-shadow)' }}>

            {/* Toolbar — its own bar, above the picture rather than on it. */}
            <div style={{ position:mapFullscreen?'absolute':'relative', top:mapFullscreen?0:undefined, left:0, right:0, zIndex:1000, padding:'9px 11px', background:'var(--glass-fill-strong)', borderBottom:'1px solid var(--glass-hairline)', backdropFilter:'blur(20px) saturate(180%)', WebkitBackdropFilter:'blur(20px) saturate(180%)', display:'flex', flexDirection:'column', gap:7 }}>
              <LightningMapControls
                lightMode={lightMode}
                timeTravelMode={timeTravelMode} setTimeTravelMode={setTimeTravelMode} exitTimeTravel={exitTimeTravel}
                loadRadar={loadRadar}
                soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled}
                isAdmin={isAdmin} todayStrikesRef={todayStrikesRef} isEuropeMap={isEuropeMap}
                liveStrikeColour={liveStrikeColour} setLiveStrikeColour={setLiveStrikeColour}
                boxSelectMode={boxSelectMode} setBoxSelectMode={setBoxSelectMode}
                onAdminForceFetch={async () => { window.__tcmAdminForce = true; }}
              />
              {/* Layer toggles */}
              <div className="tcm-map-row2" style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {LAYER_DEFS.map(layer => {
                  const active = activeLayers.includes(layer.id);
                  const Icon = layer.icon;
                  return (
                    <button key={layer.id} onClick={() => toggleLayer(layer.id)} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:9, background:active?`rgba(${hexToRgb(layer.color)},0.16)`:'var(--glass-fill)', border:`1px solid ${active?`rgba(${hexToRgb(layer.color)},0.5)`:'var(--glass-hairline)'}`, color:active?layer.color:'var(--ink-2)', fontSize:'0.66rem', fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'background .18s, color .18s, border-color .18s' }}>
                      <Icon style={{width:10,height:10}}/>
                      {layer.label}
                      {layer.id==='strikes' && <span style={{ background:`rgba(${hexToRgb(layer.color)},0.2)`, borderRadius:4, padding:'0 4px', fontSize:'0.58rem', color:layer.color, fontFamily:'monospace' }}>{todayCount.toLocaleString()}</span>}
                      {layer.id==='aiw' && aiw.active.length>0 && <span style={{ background:`rgba(${hexToRgb(layer.color)},0.2)`, borderRadius:4, padding:'0 4px', fontSize:'0.58rem', color:layer.color, fontFamily:'monospace' }}>{aiw.active.filter((w) => !w.isTest).length}</span>}
                      {layer.id==='metoffice' && metOfficeCount>0 && <span style={{ background:'rgba(56,189,248,0.22)', borderRadius:4, padding:'0 4px', fontSize:'0.58rem', color:'#38bdf8', fontFamily:'monospace' }}>{metOfficeCount}</span>}
                      {layer.id==='world' && (world?.counts?.total > 0) && <span style={{ background:'rgba(52,211,153,0.22)', borderRadius:4, padding:'0 4px', fontSize:'0.58rem', color:'#34d399', fontFamily:'monospace' }}>{world.counts.total.toLocaleString()}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fullscreen exit button — shown as large floating button when fullscreen */}
            {mapFullscreen && (
              <button onClick={() => setMapFullscreen(false)}
                style={{ position:'fixed', top:16, right:16, zIndex:9999, display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, background:'rgba(6,13,26,0.95)', border:'1.5px solid rgba(56,189,248,0.5)', color:'#38bdf8', fontSize:'0.8rem', fontWeight:800, cursor:'pointer', backdropFilter:'blur(16px)', boxShadow:'0 4px 20px rgba(0,0,0,0.5)', letterSpacing:'0.04em' }}>
                <span style={{ fontSize:'1rem' }}>✕</span> Exit Fullscreen
              </button>
            )}

            {/* The map, and the movable warning panel that floats over it.
                The panel is positioned against THIS wrapper rather than the
                outer frame so that it can never drift up over the toolbar. */}
            <div style={{ position:'relative', width:'100%' }}>
              <div ref={mapRef} style={{ width:'100%', height:mapFullscreen?'100vh':'min(600px,65vh)', minHeight:340, background:lightMode?'#dbe6f3':'#060d1a' }} />
              {activeLayers.includes('aiw') && <ForecastBanner lead={aiwLead} />}
              {activeLayers.includes('aiw') && mapFullscreen && (
                <div style={{ position:'absolute', left:12, bottom:14, zIndex:1002, width:'min(460px, calc(100% - 180px))' }}>
                  <ForecastSlider lead={aiwLead} setLead={setAiwLead} playing={aiwPlaying} setPlaying={setAiwPlaying} lightMode={lightMode} />
                </div>
              )}
              {mapPanel && (
                <MapWarningPanel
                  title={mapPanel.kind === 'world' ? mapPanel.w.event : mapPanel.kind === 'aiw' ? `${SEV[mapPanel.w.severity].label} AI lightning warning` : mapPanel.title}
                  accent={mapPanel.kind === 'aiw' ? SEV[mapPanel.w.severity].color : mapPanel.accent}
                  onClose={() => setMapPanel(null)}
                >
                  {mapPanel.kind === 'aiw'
                    ? <WarningDetail warning={mapPanel.w} compact lightMode={lightMode} onOpenFull={openAiwFull} />
                    : mapPanel.kind === 'world'
                    ? <WorldAlertDetail w={mapPanel.w} detail={worldDetail} onClose={() => setMapPanel(null)} embedded />
                    : <div style={{ padding: '2px 4px' }} dangerouslySetInnerHTML={{ __html: mapPanel.html }} />}
                </MapWarningPanel>
              )}
            </div>

            {/* ── Strike window toggle button ─────────────────────────── */}
            <button onClick={() => { if (last24Mode) exitLast24(); setShowStrikeWindow(v => !v); }}
              style={{ position:'absolute', bottom:14, right:14, zIndex:1002, display:'flex', alignItems:'center', gap:5, padding:'6px 11px', borderRadius:10, background:showStrikeWindow?'rgba(250,204,21,0.20)':'var(--glass-fill-strong)', border:`1px solid ${showStrikeWindow?'rgba(250,204,21,0.5)':'var(--glass-hairline)'}`, color:lightMode?'#a16207':'#facc15', fontSize:'0.68rem', fontWeight:700, cursor:'pointer', fontFamily:'inherit', backdropFilter:'blur(18px) saturate(180%)', WebkitBackdropFilter:'blur(18px) saturate(180%)', boxShadow:'var(--glass-shadow)' }}>
              <Clock style={{width:10,height:10}}/> {showStrikeWindow ? '✕ Close Window' : '⚡ Strike Window'}
            </button>

            {/* ── Last 24h toggle button ──────────────────────────────── */}
            <button onClick={() => { if (last24Mode) exitLast24(); else enterLast24(); }} disabled={last24Loading}
              style={{ position:'absolute', bottom:14, right:152, zIndex:1002, display:'flex', alignItems:'center', gap:5, padding:'6px 11px', borderRadius:10, background:last24Mode?'rgba(56,189,248,0.20)':'var(--glass-fill-strong)', border:`1px solid ${last24Mode?'rgba(56,189,248,0.5)':'var(--glass-hairline)'}`, color:lightMode?'#0369a1':'#38bdf8', fontSize:'0.68rem', fontWeight:700, cursor:last24Loading?'wait':'pointer', fontFamily:'inherit', backdropFilter:'blur(18px) saturate(180%)', WebkitBackdropFilter:'blur(18px) saturate(180%)', boxShadow:'var(--glass-shadow)', opacity:last24Loading?0.6:1 }}>
              {last24Loading ? <Loader2 style={{width:10,height:10,animation:'spin 1s linear infinite'}}/> : <Clock style={{width:10,height:10}}/>} {last24Mode ? '✕ Close 24h' : '🕒 Last 24h'}
            </button>

            {/* ── Strike time-window filter panel ────────────────────── */}
            {showStrikeWindow && <div style={{ position:'absolute', bottom:58, left:'50%', transform:'translateX(-50%)', zIndex:1001, background:'var(--glass-fill-strong)', border:'1px solid rgba(250,204,21,0.35)', borderRadius:14, padding:'10px 14px', backdropFilter:'blur(22px) saturate(180%)', WebkitBackdropFilter:'blur(22px) saturate(180%)', boxShadow:'var(--glass-shadow)', display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap', minWidth:340, maxWidth:'94%' }}>
              <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#facc15', whiteSpace:'nowrap' }}>⚡ Strike Window</span>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                <span style={{ fontSize:'0.56rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--ink-3)' }}>Date</span>
                <input type="date" value={strikeFilterDate} max={new Date().toISOString().slice(0,10)} onChange={e=>setStrikeFilterDate(e.target.value)}
                  style={{ padding:'4px 6px', borderRadius:6, background:'var(--glass-fill)', border:'1px solid rgba(250,204,21,0.3)', color:'var(--ink-1)', fontSize:'0.7rem' }} />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                <span style={{ fontSize:'0.56rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--ink-3)' }}>From UTC</span>
                <input type="time" value={strikeFilterStart} onChange={e=>setStrikeFilterStart(e.target.value)}
                  style={{ padding:'4px 6px', borderRadius:6, background:'var(--glass-fill)', border:'1px solid rgba(250,204,21,0.3)', color:'var(--ink-1)', fontSize:'0.7rem' }} />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                <span style={{ fontSize:'0.56rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--ink-3)' }}>To UTC</span>
                <input type="time" value={strikeFilterEnd} onChange={e=>setStrikeFilterEnd(e.target.value)}
                  style={{ padding:'4px 6px', borderRadius:6, background:'var(--glass-fill)', border:'1px solid rgba(250,204,21,0.3)', color:'var(--ink-1)', fontSize:'0.7rem' }} />
              </div>
              <button onClick={loadStrikeWindow} disabled={strikeFilterLoading}
                style={{ padding:'6px 10px', borderRadius:8, fontSize:'0.7rem', fontWeight:700, background:'rgba(250,204,21,0.18)', border:'1px solid rgba(250,204,21,0.4)', color:'#facc15', cursor:'pointer', display:'flex', alignItems:'center', gap:5, opacity:strikeFilterLoading?0.6:1 }}>
                {strikeFilterLoading?<Loader2 style={{width:10,height:10,animation:'spin 1s linear infinite'}}/>:<Eye style={{width:10,height:10}}/>} Load
              </button>
              {filteredStrikes !== null && (
                <button onClick={resetStrikeFilter}
                  style={{ padding:'6px 10px', borderRadius:8, fontSize:'0.7rem', fontWeight:700, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.12)', color:'#94a3b8', cursor:'pointer' }}>
                  Reset
                </button>
              )}
              {filteredStrikes !== null && (
                <span style={{ fontSize:'0.65rem', color:'#facc15', fontFamily:'monospace', alignSelf:'center' }}>
                  {filteredStrikes.length.toLocaleString()} strikes
                </span>
              )}
              <span style={{ fontSize:'0.6rem', color:'#475569', alignSelf:'center', marginLeft:4 }}>Right-click map for storm ETA</span>
            </div>}

            {/* ── Last 24h window panel ───────────────────────────────── */}
            {last24Mode && (() => {
              const nowMs = Date.now();
              const startMs = nowMs - minutesBack * 60_000;
              const fmt = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
              const fmtDur = (m) => {
                if (m >= 60) { const h = Math.floor(m/60), mm = m%60; return mm ? `${h}h ${mm}m` : `${h}h`; }
                return `${m}m`;
              };
              const crossesMidnight = new Date(startMs).getDate() !== new Date(nowMs).getDate();
              return (
                <div style={{ position:'absolute', bottom:58, left:'50%', transform:'translateX(-50%)', zIndex:1001, background:'var(--glass-fill-strong)', border:'1px solid rgba(56,189,248,0.35)', borderRadius:14, padding:'12px 16px', backdropFilter:'blur(22px) saturate(180%)', WebkitBackdropFilter:'blur(22px) saturate(180%)', boxShadow:'var(--glass-shadow)', display:'flex', flexDirection:'column', gap:9, minWidth:380, maxWidth:'92vw' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                    <span style={{ fontSize:'0.72rem', fontWeight:700, color:'#38bdf8', whiteSpace:'nowrap' }}>🕒 Last 24h Window</span>
                    <span style={{ fontSize:'0.7rem', color:'#f1f5f9', fontFamily:'monospace' }}>
                      {fmt(startMs)}{crossesMidnight ? ' (prev day)' : ''} → now ({fmt(nowMs)})
                    </span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:'0.6rem', color:'#64748b', whiteSpace:'nowrap', minWidth:54, textAlign:'right' }}>{fmtDur(minutesBack)} ago</span>
                    <input
                      type="range" min={5} max={1440} step={5} value={minutesBack}
                      onChange={e => { const m = Number(e.target.value); setMinutesBack(m); applyLast24Window(m); }}
                      style={{ flex:1, accentColor:'#38bdf8', cursor:'pointer' }}
                    />
                    <span style={{ fontSize:'0.6rem', color:'#64748b', whiteSpace:'nowrap', minWidth:36 }}>now</span>
                  </div>
                  <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                    {[['30m',30],['1h',60],['3h',180],['6h',360],['12h',720],['24h',1440]].map(([lbl, m]) => (
                      <button key={m} onClick={() => { setMinutesBack(m); applyLast24Window(m); }}
                        style={{ padding:'4px 9px', borderRadius:7, fontSize:'0.64rem', fontWeight:700, cursor:'pointer',
                          background: minutesBack===m ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${minutesBack===m ? 'rgba(56,189,248,0.55)' : 'rgba(255,255,255,0.12)'}`,
                          color: minutesBack===m ? '#38bdf8' : '#94a3b8' }}>
                        {lbl}
                      </button>
                    ))}
                    <span style={{ fontSize:'0.66rem', color:'#38bdf8', fontFamily:'monospace', marginLeft:'auto' }}>
                      {(filteredStrikes?.length || 0).toLocaleString()} strikes
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Time travel panel */}
            {timeTravelMode && (
              <div style={{ position:'absolute', top:60, left:'50%', transform:'translateX(-50%)', zIndex:1001, background:'var(--glass-fill-strong)', border:'1px solid rgba(167,139,250,0.4)', borderRadius:16, padding:'14px 18px', backdropFilter:'blur(22px) saturate(180%)', WebkitBackdropFilter:'blur(22px) saturate(180%)', boxShadow:'var(--glass-shadow)', display:'flex', flexDirection:'column', gap:10, minWidth:340, maxWidth:'94%' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:'0.78rem', fontWeight:700, color:'#a78bfa' }}>⏪ Archive View</span>
                  <button onClick={exitTimeTravel} style={{ background:'rgba(255,255,255,0.06)', border:'none', borderRadius:6, width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748b' }}><X style={{width:11,height:11}}/></button>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <input type="date" value={timeTravelDate} max={new Date().toISOString().slice(0,10)} min="2010-01-01" onChange={e=>setTimeTravelDate(e.target.value)} style={{ padding:'5px 8px', borderRadius:7, background:'var(--glass-fill)', border:'1px solid rgba(167,139,250,0.35)', color:'var(--ink-1)', fontSize:'0.74rem' }} />
                  <span style={{ fontSize:'0.65rem', color:'#64748b' }}>Hour: {String(timeTravelHour).padStart(2,'0')}:00</span>
                  <input type="range" min={0} max={23} step={1} value={timeTravelHour} onChange={e=>setTimeTravelHour(Number(e.target.value))} style={{ width:120, accentColor:'#a78bfa' }} />
                  <button onClick={loadTimeTravelImage} disabled={!timeTravelDate||timeTravelLoading} style={{ display:'flex', alignItems:'center', gap:5, padding:'7px 12px', borderRadius:9, background:!timeTravelDate?'rgba(167,139,250,0.05)':'rgba(167,139,250,0.18)', border:'1px solid rgba(167,139,250,0.35)', color:!timeTravelDate?'#475569':'#a78bfa', fontSize:'0.74rem', fontWeight:700, cursor:!timeTravelDate?'default':'pointer' }}>
                    {timeTravelLoading?<Loader2 style={{width:11,height:11,animation:'spin 1s linear infinite'}}/>:<Clock style={{width:11,height:11}}/>} Load
                  </button>
                </div>
                {timeTravelImgUrl && <button onClick={handleTimeTravelSnapshot} style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, background:'rgba(245,158,11,0.15)', border:'1px solid rgba(245,158,11,0.35)', color:'#f59e0b', fontSize:'0.72rem', fontWeight:700, cursor:'pointer', alignSelf:'flex-start' }}><Camera style={{width:11,height:11}}/> Snapshot this hour</button>}
              </div>
            )}

            {/* Loading overlay */}
            {!leafletReady && (
              <div style={{ position:'absolute', inset:0, zIndex:999, display:'flex', alignItems:'center', justifyContent:'center',
                background: lightMode
                  ? 'linear-gradient(110deg,#e4ecf7 30%,#eef4fc 50%,#e4ecf7 70%)'
                  : 'linear-gradient(110deg,#0a1222 30%,#111c33 50%,#0a1222 70%)',
                backgroundSize:'220% 100%', animation:'lx-shimmer 1.5s linear infinite' }}>
                <div style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 15px', borderRadius:99,
                  background:'var(--glass-fill-strong)', border:'1px solid var(--glass-hairline)',
                  backdropFilter:'blur(18px)', WebkitBackdropFilter:'blur(18px)' }}>
                  <div style={{ width:13, height:13, border:'2px solid #facc15', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.9s linear infinite' }} />
                  <span style={{ color:'var(--ink-2)', fontSize:'0.76rem', fontWeight:650 }}>Loading map…</span>
                </div>
              </div>
            )}

            {/* Box select result popup */}
            {boxSelectMode && boxSelectResult && (
              <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:1002, background:'var(--glass-fill-strong)', border:'1.5px solid #38bdf8', borderRadius:16, padding:'20px 24px', backdropFilter:'blur(22px) saturate(180%)', WebkitBackdropFilter:'blur(22px) saturate(180%)', textAlign:'center', minWidth:200, boxShadow:'var(--glass-shadow)' }}>
                <div style={{ fontSize:'2rem', marginBottom:6 }}>⚡</div>
                <p style={{ margin:0, fontSize:'2.2rem', fontWeight:800, color:'#38bdf8', fontFamily:'monospace', letterSpacing:'-0.03em', lineHeight:1 }}>{boxSelectResult.count.toLocaleString()}</p>
                <p style={{ margin:'4px 0 0', fontSize:'0.72rem', color:'var(--ink-2)', fontWeight:600 }}>strikes in selected area</p>
                <button onClick={() => setBoxSelectResult(null)} style={{ marginTop:12, padding:'6px 16px', borderRadius:8, background:'rgba(56,189,248,0.15)', border:'1px solid rgba(56,189,248,0.3)', color:'#38bdf8', fontSize:'0.7rem', fontWeight:700, cursor:'pointer' }}>Clear</button>
              </div>
            )}

          </div>
        </div>

        {/* ── Legend (below map) ──────────────────────────────────────── */}
        <div style={{ padding:'10px 16px 0' }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {/* Strike age */}
            <div style={glassPanel({ flex:'1 1 180px', borderRadius:12, padding:'12px 14px' }, lightMode)}>
              <AuroraRail from="#facc15" to="#f97316" light={lightMode} />
              <p style={{ fontSize:'0.58rem', fontWeight:800, color:'#facc15', margin:'0 0 8px', letterSpacing:'0.12em', textTransform:'uppercase' }}>⚡ Strike Age</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 14px' }}>
                {/* Drawn from AGE_BANDS — the same table the map uses — and
                    each swatch at the size that band is drawn at. */}
                {AGE_BANDS.map(k=>(
                  <div key={k.label} style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:k.r*2.2, height:k.r*2.2, borderRadius:'50%', background:k.color, flexShrink:0,
                      boxShadow: lightMode ? '0 0 0 0.8px rgba(15,23,42,0.55)' : 'none' }} />
                    <span style={{ fontSize:'0.62rem', color:lightMode?'#475569':'#94a3b8' }}>{k.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Heatmap */}
            {activeLayers.includes('strikeheat') && (
              <div style={glassPanel({ flex:'1 1 220px', borderRadius:12, padding:'12px 14px' }, lightMode)}>
                <AuroraRail from="#8b5cf6" to="#22d3ee" light={lightMode} />
                <p style={{ fontSize:'0.58rem', fontWeight:800, color:'#a78bfa', margin:'0 0 8px', letterSpacing:'0.12em', textTransform:'uppercase' }}>🔥 Strike Density</p>
                {/* The bar IS the colour ramp the map uses, built from the same
                    table, so the two can never drift apart. It used to say
                    "Low" and "High" because the field was renormalised to its
                    own maximum every refresh and there was no number to put
                    here; it is an absolute scale now, so there is. */}
                <div style={{ height:10, borderRadius:5, marginBottom:5, background: HEAT_LEGEND_GRADIENT }} />
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  {HEAT_LEGEND_TICKS.map((v) => (
                    <span key={v} style={{ fontSize:'0.58rem', fontFamily:'ui-monospace, monospace', color:lightMode?'#64748b':'#64748b' }}>{v}</span>
                  ))}
                </div>
                <p style={{ margin:'5px 0 0', fontSize:'0.56rem', lineHeight:1.4, color:lightMode?'#94a3b8':'#475569' }}>
                  strikes per 1,000 km² today
                </p>
              </div>
            )}
            {/* AI lightning warnings */}
            {activeLayers.includes('aiw') && (
            <div style={glassPanel({ flex:'2 1 320px', borderRadius:12, padding:'12px 14px' }, lightMode)}>
              <AuroraRail from="#FFD600" to="#F44336" light={lightMode} />
              <p style={{ fontSize:'0.58rem', fontWeight:800, color: lightMode ? '#B05E00' : '#FF9800', margin:'0 0 8px', letterSpacing:'0.12em', textTransform:'uppercase' }}>⚠ AI Lightning Warnings</p>
              <AiwLegend lightMode={lightMode} />
            </div>
            )}
            {/* Met Office */}
            {activeLayers.includes('metoffice') && (
              <div style={glassPanel({ flex:'1 1 180px', borderRadius:12, padding:'12px 14px' }, lightMode)}>
                <AuroraRail from="#38bdf8" to="#22d3ee" light={lightMode} />
                <p style={{ fontSize:'0.58rem', fontWeight:800, color:'#38bdf8', margin:'0 0 8px', letterSpacing:'0.12em', textTransform:'uppercase' }}>🇬🇧 Met Office</p>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 12px' }}>
                  {[{c:'#ef4444',l:'Red'},{c:'#f97316',l:'Amber'},{c:'#facc15',l:'Yellow'}].map(k=>(
                    <div key={k.l} style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <div style={{ width:12, height:8, borderRadius:2, background:k.c+'55', border:`1.5px solid ${k.c}` }} />
                      <span style={{ fontSize:'0.62rem', color:lightMode?'#475569':'#94a3b8' }}>{k.l}</span>
                    </div>
                  ))}
                </div>
                <p style={{ margin:'6px 0 0', fontSize:'0.58rem', color:'#475569', lineHeight:1.4 }}>Live map image direct from Met Office</p>
              </div>
            )}
            {/* Radar */}
            {activeLayers.includes('radar') && (
              <div style={glassPanel({ flex:'1 1 180px', borderRadius:12, padding:'12px 14px' }, lightMode)}>
                <AuroraRail from="#22d3ee" to="#3b82f6" light={lightMode} />
                <p style={{ fontSize:'0.6rem', fontWeight:700, color:lightMode?'#475569':AURORA.textSub, margin:'0 0 6px', letterSpacing:'0.1em', textTransform:'uppercase' }}>🌧 Rainfall <span style={{ fontWeight:600, letterSpacing:0, textTransform:'none', opacity:0.75 }}>· RainViewer</span></p>
                {/* Painted over the basemap's own ground colour at the tiles'
                    opacity, so each colour in the key is the colour you see. */}
                <div style={{ position:'relative', height:10, borderRadius:4, overflow:'hidden', background: lightMode ? '#e5e5e5' : '#2b2b2b' }}>
                  <div style={{ position:'absolute', inset:0, background: RAIN_KEY_GRADIENT, opacity: RV_TILE_OPACITY }} />
                </div>
                <div style={{ position:'relative', height:22, marginTop:3 }}>
                  {RAIN_KEY_TICKS.map(({ dbz, mm }) => (
                    <div key={dbz} style={{ position:'absolute', left:`${(dbz / RV_DBZ_MAX) * 100}%`, transform:'translateX(-50%)', textAlign:'center', lineHeight:1.15 }}>
                      <div style={{ fontSize:'0.56rem', fontFamily:'ui-monospace, monospace', color:lightMode?'#475569':'#94a3b8' }}>{dbz}</div>
                      <div style={{ fontSize:'0.5rem', fontFamily:'ui-monospace, monospace', color:lightMode?'#94a3b8':'#64748b' }}>{mm}</div>
                    </div>
                  ))}
                </div>
                <p style={{ margin:'1px 0 0', fontSize:'0.54rem', color:lightMode?'#94a3b8':'#64748b' }}>dBZ · mm/h (approx.)</p>
              </div>
            )}
          </div>
        </div>

        {/* Worldwide alerts */}
        {activeLayers.includes('world') && (
          <WorldAlertsPanel
            data={world}
            loading={worldLoading}
            query={worldQuery} setQuery={setWorldQuery}
            sevFilter={worldSevFilter} setSevFilter={setWorldSevFilter}
            selected={worldSelected} detail={worldDetail}
            onOpen={openWorldWarning}
            onClose={() => { setWorldSelected(null); setWorldDetail(null); }}
          />
        )}

        {/* ── AI lightning warnings ───────────────────────────────────── */}
        {activeLayers.includes('aiw') && !mapFullscreen && (
          <div style={{ padding:'10px 16px 0' }}>
            <ForecastSlider lead={aiwLead} setLead={setAiwLead} playing={aiwPlaying} setPlaying={setAiwPlaying} lightMode={lightMode} />
          </div>
        )}
        <div style={{ padding:'10px 16px 0' }}>
          <VoiceAlerts subscribe={aiw.subscribe} lightMode={lightMode} coverage={aiw.status?.coverage} onShowWarning={showAiwById} />
        </div>
        {aiw.status && !aiw.status.issuing && (
          <div role="alert" style={{ margin:'10px 16px 0', padding:'10px 13px', borderRadius:14, fontSize:'0.76rem', fontWeight:700,
            background:'rgba(244,67,54,0.12)', border:'1px solid rgba(244,67,54,0.45)', color: lightMode ? '#C62828' : '#F44336' }}>
            {aiw.status.paused
              ? `AI warning issuance is paused by an administrator${aiw.status.pausedReason ? ` — ${aiw.status.pausedReason}` : ''}. Existing warnings run to their expiry.`
              : 'The lightning feed the AI warnings depend on is currently unavailable. No new warnings can be issued and existing ones are not being updated — this is NOT the same as there being no risk.'}
          </div>
        )}
        <div ref={aiwCentreRef} style={{ padding:'10px 16px 0', scrollMarginTop: 80 }}>
          <IssuedWarningsCentre
            lightMode={lightMode} isAdmin={isAdmin}
            selectedId={aiwSelectedId} onSelect={setAiwSelectedId}
            onShowOnMap={openAiwOnMap} refreshKey={aiwCentreKey}
            coverage={aiw.status?.coverage}
          />
        </div>
        <p style={{ margin:'8px 16px 0', fontSize:'0.62rem', lineHeight:1.5, color:'var(--ink-3)' }}>
          {aiw.status?.disclaimer || 'MyWeatherUK AI lightning warnings are experimental and are not official warnings.'}
          {' '}Lightning data: Blitzortung.org community network. Model atmosphere: Open-Meteo. Places: GeoNames (CC BY 4.0).
        </p>
        {isAdmin && (
          <div style={{ padding:'10px 16px 0' }}>
            <AiwAdminPanel onAfterChange={afterAdminChange} />
          </div>
        )}
      </div>


    </>
  );
}


/* ═══════════════════════════════════════════════════════════════
   WORLDWIDE ALERTS

   Every live severe-weather warning on Earth, from the WMO's aggregation of
   the national met services' own CAP feeds. The map can only draw the ones
   that publish coordinates, so this is where the rest live: the list is the
   complete picture, the map is the subset that has a shape.
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   THE MAP'S WARNING PANEL

   A warning used to open as a Leaflet popup pinned to its own shape, which
   put the text on top of the thing it was describing, moved whenever the map
   moved, and was whatever size Leaflet felt like. This is a panel that sits
   beside the map instead: drag it anywhere by its title bar, drag its corner
   to make it any size, and it stays where you put it — across warnings, map
   moves, fullscreen and your next visit.
   ═══════════════════════════════════════════════════════════════ */

const PANEL_KEY = 'lx_warn_panel_v1';
const PANEL_MIN_W = 230;
const PANEL_MIN_H = 160;
const PANEL_DEFAULT = { x: null, y: 14, w: 330, h: 380 };

function loadPanelBox() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) || 'null');
    if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) return { ...PANEL_DEFAULT, ...saved };
  } catch (_) {}
  return { ...PANEL_DEFAULT };
}

function MapWarningPanel({ title, accent = '#38bdf8', onClose, children }) {
  const boxRef = useRef(null);
  const hostRef = useRef(null);
  const [box, setBox] = useState(loadPanelBox);
  const dragRef = useRef(null);

  /* x is null until we know how wide the map is: the panel's resting place is
     the right-hand edge, and that cannot be expressed as a fixed number. */
  useEffect(() => {
    const host = boxRef.current?.parentElement;
    hostRef.current = host;
    if (!host) return;
    setBox((b) => {
      const maxW = Math.max(PANEL_MIN_W, host.clientWidth - 24);
      const maxH = Math.max(PANEL_MIN_H, host.clientHeight - 24);
      const w = Math.min(b.w, maxW);
      const h = Math.min(b.h, maxH);
      const x = b.x == null ? Math.max(12, host.clientWidth - w - 14) : Math.min(b.x, host.clientWidth - w - 6);
      const y = Math.min(Math.max(6, b.y), Math.max(6, host.clientHeight - h - 6));
      return { x, y, w, h };
    });
  }, []);

  /* Keep it on the map when the map changes size — entering fullscreen, or a
     phone being turned — rather than leaving it stranded off the edge. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setBox((b) => {
        const w = Math.min(b.w, Math.max(PANEL_MIN_W, host.clientWidth - 24));
        const h = Math.min(b.h, Math.max(PANEL_MIN_H, host.clientHeight - 24));
        return {
          w, h,
          x: Math.min(Math.max(6, b.x ?? 0), Math.max(6, host.clientWidth - w - 6)),
          y: Math.min(Math.max(6, b.y), Math.max(6, host.clientHeight - h - 6)),
        };
      });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const persist = (b) => { try { localStorage.setItem(PANEL_KEY, JSON.stringify(b)); } catch (_) {} };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* One pointer handler for both gestures. Pointer capture means the drag
     survives the cursor leaving the panel — without it, moving faster than
     React re-renders drops the drag, which is the usual way these feel
     broken. */
  const startGesture = (mode) => (e) => {
    if (e.button != null && e.button !== 0) return;
    /* The close button lives IN the title bar, which is the drag handle.
       Without this the press started a drag instead: preventDefault below
       suppresses the click that would have followed, and the capture sends
       the pointerup to the handle rather than the button — so the X was
       completely dead. Anything interactive in the bar keeps its own press. */
    if (e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    e.stopPropagation();
    const host = hostRef.current || boxRef.current?.parentElement;
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, box: { ...box }, host };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const host = d.host;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setBox(() => {
      if (d.mode === 'move') {
        const maxX = Math.max(6, (host?.clientWidth || 9999) - d.box.w - 6);
        const maxY = Math.max(6, (host?.clientHeight || 9999) - d.box.h - 6);
        return { ...d.box, x: Math.min(Math.max(6, d.box.x + dx), maxX), y: Math.min(Math.max(6, d.box.y + dy), maxY) };
      }
      const maxW = Math.max(PANEL_MIN_W, (host?.clientWidth || 9999) - d.box.x - 10);
      const maxH = Math.max(PANEL_MIN_H, (host?.clientHeight || 9999) - d.box.y - 10);
      return {
        ...d.box,
        w: Math.min(Math.max(PANEL_MIN_W, d.box.w + dx), maxW),
        h: Math.min(Math.max(PANEL_MIN_H, d.box.h + dy), maxH),
      };
    });
  };

  const endGesture = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setBox((b) => { persist(b); return b; });
  };

  return (
    <div
      ref={boxRef}
      className="lx-warn-panel"
      style={{
        position: 'absolute', zIndex: 1003,
        left: box.x == null ? undefined : box.x,
        right: box.x == null ? 14 : undefined,
        top: box.y, width: box.w, height: box.h,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderRadius: 16,
        background: 'var(--glass-fill-strong)',
        border: `1px solid ${accent}55`,
        backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        boxShadow: 'var(--glass-shadow)',
      }}
      /* The map is underneath: without this every scroll over the panel zooms
         the map and every drag pans it. */
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={startGesture('move')}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          padding: '9px 10px 9px 12px', cursor: 'grab', touchAction: 'none',
          borderBottom: '1px solid var(--glass-hairline)',
          background: `linear-gradient(90deg, ${accent}22, transparent)`,
        }}
      >
        <GripVertical style={{ width: 13, height: 13, color: 'var(--ink-3)', flexShrink: 0 }} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: '0.76rem', fontWeight: 700, color: 'var(--ink-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</span>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close warning panel"
          title="Close (Esc)"
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 7, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)', color: 'var(--ink-2)',
          }}>
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {children}
      </div>

      {/* Resize grip. Double-click resets it to the default size, which is the
          way back when someone drags it down to a sliver. */}
      <div
        onPointerDown={startGesture('resize')}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onDoubleClick={() => setBox((b) => {
          const next = { ...b, w: PANEL_DEFAULT.w, h: PANEL_DEFAULT.h };
          persist(next);
          return next;
        })}
        title="Drag to resize · double-click to reset"
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 20, height: 20,
          cursor: 'nwse-resize', touchAction: 'none',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 3,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M10 2 L2 10 M10 6 L6 10 M10 9.5 L9.5 10" stroke="var(--ink-3)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function relWhen(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  const mins = Math.round(Math.abs(ms) / 60000);
  const txt = mins < 60 ? mins + 'm'
    : mins < 1440 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'
    : Math.floor(mins / 1440) + 'd';
  return ms >= 0 ? 'in ' + txt : txt + ' ago';
}

function whenWithRel(iso) {
  const rel = relWhen(iso);
  return fmtWhen(iso) + (rel ? '  (' + rel + ')' : '');
}

const WA_CSS = `
  .wa-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 15px;
             border-bottom:1px solid var(--glass-hairline); }
  .wa-chip { padding:4px 11px; border-radius:99px; font-size:0.66rem; font-weight:700;
             cursor:pointer; font-family:inherit; background:var(--glass-fill);
             border:1px solid var(--glass-hairline); color:var(--ink-2); white-space:nowrap; }
  .wa-chip[data-on="1"] { color:var(--ink-1); background:var(--glass-fill-strong); }
  .wa-search { flex:1; min-width:150px; padding:7px 12px; border-radius:11px; font:inherit;
             font-size:0.78rem; background:var(--glass-fill); color:var(--ink-1);
             border:1px solid var(--glass-hairline); outline:none; }
  .wa-search::placeholder { color:var(--ink-3); }
  .wa-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));
             gap:8px; padding:12px 15px; max-height:440px; overflow-y:auto; }
  .wa-row { display:flex; gap:10px; align-items:stretch; text-align:left; width:100%;
             padding:10px 12px; border-radius:13px; cursor:pointer; font-family:inherit;
             background:var(--glass-fill); border:1px solid var(--glass-hairline);
             transition:background .16s, border-color .16s; }
  .wa-row:hover { background:var(--glass-fill-strong); }
`;

function WorldAlertsPanel({ data, loading, query, setQuery, sevFilter, setSevFilter, selected, detail, onOpen, onClose }) {
  const all = data?.warnings || [];

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((w) => {
      if (sevFilter !== 'all' && w.severity !== sevFilter) return false;
      if (!q) return true;
      return (
        (w.event || '').toLowerCase().includes(q) ||
        (w.areaDesc || '').toLowerCase().includes(q) ||
        (w.headline || '').toLowerCase().includes(q) ||
        (w.country || '').toLowerCase().includes(q) ||
        (w.sender || '').toLowerCase().includes(q)
      );
    });
  }, [all, query, sevFilter]);

  /* Rendering 1,100 rows at once locks the page up for no gain — nobody reads
     past the first screenful without searching or filtering first. */
  const [limit, setLimit] = useState(60);
  useEffect(() => { setLimit(60); }, [query, sevFilter]);

  const counts = data?.counts?.bySeverity || {};
  const countryCount = Object.keys(data?.counts?.byCountry || {}).length;

  return (
    <div style={{ padding: '14px 16px 0' }}>
      <div className="lg-pane" style={{ borderRadius: 20, overflow: 'hidden' }}>
        <style>{WA_CSS}</style>

        <div className="wa-head">
          <Globe style={{ width: 16, height: 16, color: '#34d399', flexShrink: 0 }} />
          <span style={{ fontWeight: 650, fontSize: '0.92rem', color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>
            Worldwide alerts
          </span>
          {loading && <Loader2 style={{ width: 13, height: 13, color: 'var(--ink-3)', animation: 'spin 0.9s linear infinite' }} />}
          <span style={{ fontSize: '0.68rem', color: 'var(--ink-3)' }}>
            {data?.counts?.total
              ? data.counts.total.toLocaleString() + ' in force · ' + countryCount + ' countries'
              : loading ? 'loading…' : 'none'}
          </span>

          <div style={{ flex: 1, minWidth: 8 }} />

          <input
            className="wa-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search event, area, country…" aria-label="Search worldwide alerts" />
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '10px 15px 0' }}>
          <button className="wa-chip" data-on={sevFilter === 'all' ? '1' : '0'} onClick={() => setSevFilter('all')}>
            All{data?.counts?.total ? ' · ' + data.counts.total : ''}
          </button>
          {WORLD_SEV_ORDER.filter((s) => counts[s]).map((s) => (
            <button key={s} className="wa-chip" data-on={sevFilter === s ? '1' : '0'}
              onClick={() => setSevFilter(s)}
              style={sevFilter === s ? { borderColor: WORLD_SEV[s].color + 'aa', color: WORLD_SEV[s].color } : undefined}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, marginRight: 6, background: WORLD_SEV[s].color }} />
              {s} · {counts[s]}
            </button>
          ))}
        </div>

        {/* What the map can and cannot show, said plainly rather than leaving
            someone to wonder why the list is longer than the map. */}
        {data?.counts?.total > 0 && (
          <p style={{ margin: '9px 15px 0', fontSize: '0.66rem', color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {data.counts.drawn.toLocaleString()} of these publish a map shape and are drawn above. The rest describe
            their area in words or by national area code, which carries no coordinates — every one is listed here.
          </p>
        )}

        {selected ? (
          <WorldAlertDetail w={selected} detail={detail} onClose={onClose} />
        ) : (
          <>
            <div className="wa-grid">
              {shown.slice(0, limit).map((w) => {
                const sev = WORLD_SEV[w.severity] || WORLD_SEV.Unknown;
                return (
                  <button key={w.id} className="wa-row" onClick={() => onOpen(w)}>
                    <span style={{ width: 4, borderRadius: 3, background: sev.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.event}
                      </span>
                      <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.country ? w.country + ' · ' : ''}{w.areaDesc || w.sender || '—'}
                      </span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: '0.62rem', color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>
                        {w.geometry ? 'mapped · ' : ''}ends {relWhen(w.expires) || '—'}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!shown.length && !loading && (
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--ink-3)' }}>
                  {all.length ? 'No alerts match that search.' : 'No worldwide alerts available right now.'}
                </p>
              )}
            </div>
            {shown.length > limit && (
              <button onClick={() => setLimit((l) => l + 120)}
                style={{ display: 'block', margin: '0 auto 14px', padding: '7px 18px', borderRadius: 10,
                  background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)',
                  color: 'var(--ink-2)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Show {Math.min(120, shown.length - limit)} more of {shown.length.toLocaleString()}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function WorldAlertDetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', borderTop: '1px solid var(--glass-hairline)' }}>
      <span style={{ flex: '0 0 92px', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', paddingTop: 2 }}>{label}</span>
      <span style={{ flex: 1, fontSize: '0.76rem', color: 'var(--ink-1)', minWidth: 0, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function WorldAlertDetail({ w, detail, onClose, embedded = false }) {
  const sev = WORLD_SEV[w.severity] || WORLD_SEV.Unknown;
  const d = detail && detail.ok !== false ? detail : null;
  const description = d?.description || null;
  const instruction = d?.instruction || null;
  const start = d?.onset || d?.effective || w.effective;
  const end = d?.expires || w.expires;

  return (
    <div style={{ padding: '14px 15px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{ width: 4, alignSelf: 'stretch', minHeight: 34, borderRadius: 3, background: sev.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>{w.event}</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--ink-2)' }}>
            {w.sender || d?.senderName || w.source}{w.country ? ' · ' + w.country : ''}
          </p>
        </div>
        <span style={{ padding: '3px 9px', borderRadius: 99, flexShrink: 0, fontSize: '0.6rem', fontWeight: 800,
          letterSpacing: '0.07em', textTransform: 'uppercase', color: sev.color,
          background: sev.color + '22', border: '1px solid ' + sev.color + '55' }}>{w.severity}</span>
        {!embedded && <button onClick={onClose} aria-label="Back to the list"
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 9, cursor: 'pointer',
            background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)', color: 'var(--ink-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X style={{ width: 13, height: 13 }} />
        </button>}
      </div>

      {w.headline && (
        <p style={{ margin: '0 0 10px', fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--ink-1)' }}>{w.headline}</p>
      )}

      <div style={{ borderRadius: 13, padding: '2px 12px 8px', background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)' }}>
        <WorldAlertDetailRow label="Starts" value={whenWithRel(start)} />
        <WorldAlertDetailRow label="Ends" value={whenWithRel(end)} />
        <WorldAlertDetailRow label="Area" value={d?.areaDesc || w.areaDesc} />
        <WorldAlertDetailRow label="Urgency" value={d?.urgency || w.urgency} />
        <WorldAlertDetailRow label="Certainty" value={d?.certainty || w.certainty} />
      </div>

      <div style={{ marginTop: 11 }}>
        <p style={{ margin: '0 0 5px', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          Description
        </p>
        {description ? (
          <p style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--ink-1)', whiteSpace: 'pre-wrap' }}>{description}</p>
        ) : detail === null ? (
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--ink-3)' }}>Loading the full alert…</p>
        ) : (
          /* The WMO index routinely outlives the CAP files it points at, so
             this is an ordinary outcome rather than a failure to hide. */
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--ink-3)' }}>
            {detail?.missing
              ? 'The issuing service has already withdrawn the full text of this alert. The summary above is what the WMO index still holds.'
              : 'The full text could not be loaded from the issuing service.'}
          </p>
        )}
      </div>

      {instruction && (
        <div style={{ marginTop: 11 }}>
          <p style={{ margin: '0 0 5px', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            Advice
          </p>
          <p style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--ink-1)', whiteSpace: 'pre-wrap' }}>{instruction}</p>
        </div>
      )}

      {d?.web && (
        <a href={d.web} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: 12, padding: '7px 14px', borderRadius: 10,
            fontSize: '0.72rem', fontWeight: 700, textDecoration: 'none', color: sev.color,
            background: sev.color + '18', border: '1px solid ' + sev.color + '44' }}>
          Open at the issuing service →
        </a>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ROOT PAGE
   ═══════════════════════════════════════════════════════════════ */
export default function TCM() {
  /* The page used to carry its OWN light/dark flag in localStorage under
     'tcm_light_mode', completely separate from the site theme. Switching the
     site to light left this page dark, and the page's own switch did nothing
     anywhere else. There is one theme now, the site's. */
  const { isDark } = useTheme();
  const lightMode = !isDark;

  const [archive, setArchive] = useState(loadArchive);

  const { data: userMe } = useQuery({
    queryKey: ['me'],
    queryFn:  () => base44.auth.me().catch(() => null),
  });

  const isAdmin = userMe?.role === 'admin';
  const [region, setRegion] = useState(() => { try { return localStorage.getItem('tcm_region') || 'uk'; } catch (_) { return 'uk'; } });
  const isUSA = region === 'usa';

  /* The glass tokens are defined once, with the home page. Inject them here
     too for anyone who lands on /Lightning directly without passing through
     Home first, and mirror the theme onto <html> the same way Home does so
     the light variables actually resolve. */
  useEffect(() => { injectThemeStyles(); }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.remove('light-mode');
    else        root.classList.add('light-mode');
  }, [isDark]);

  const setRegionAndSave = (r) => {
    setRegion(r);
    try { localStorage.setItem('tcm_region', r); } catch (_) {}
  };

  /* Pull-to-refresh. This used to remount the whole map — tearing down the
     Leaflet instance, the strike layers and the live socket, then building
     all of it again, which is why a pull took seconds and dropped the feed.
     The map keeps itself current from the socket, so the gesture now just
     acknowledges and lets the live data stand. */
  const [refreshing, setRefreshing] = useState(false);
  const handlePullRefresh = async () => {
    setRefreshing(true);
    await new Promise(r => setTimeout(r, 450));
    setRefreshing(false);
  };
  const { isPulling, isRefreshing, pullProgress, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(handlePullRefresh);

  return (
    <div
      className="lg-page"
      style={{ minHeight: '100vh', position: 'relative' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* The same drifting ground the home page floats its panes on, so the
          glass here has something to refract instead of flat colour. */}
      <div className="lg-ambient" aria-hidden="true">
        <i className="lg-orb-a" /><i className="lg-orb-b" /><i className="lg-orb-c" />
      </div>

      {(isPulling || isRefreshing || refreshing) && (
        <div style={{
          position: 'fixed', top: 'calc(70px + env(safe-area-inset-top, 0px))',
          left: '50%', transform: 'translateX(-50%)',
          zIndex: 1200, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 15px', borderRadius: 99,
          background: 'var(--glass-fill-strong)',
          border: '1px solid var(--glass-hairline)',
          backdropFilter: 'blur(18px) saturate(180%)', WebkitBackdropFilter: 'blur(18px) saturate(180%)',
          boxShadow: 'var(--glass-shadow)',
        }}>
          <svg width="15" height="15" viewBox="0 0 16 16" style={{
            flexShrink: 0,
            animation: (isRefreshing || refreshing) ? 'spin 0.9s linear infinite' : 'none',
            transform: (isRefreshing || refreshing) ? undefined : `rotate(${pullProgress * 300}deg)`,
          }}>
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--glass-hairline)" strokeWidth="2" />
            <circle cx="8" cy="8" r="6" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round"
              strokeDasharray="37.7"
              strokeDashoffset={(isRefreshing || refreshing) ? 0 : 37.7 * (1 - pullProgress)}
              style={{ transformOrigin: '8px 8px', transform: 'rotate(-90deg)' }} />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--ink-2)' }}>
            {(isRefreshing || refreshing) ? 'Refreshing…' : pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}

      <div id="tcm-main-content" style={{ position: 'relative', zIndex: 1 }}>
        {isUSA ? (
          <div style={{ padding: '24px 16px' }}>
            <USAMonitor isAdmin={isAdmin} lightMode={lightMode} />
          </div>
        ) : (
          <LightningMap
            region={region}
            setRegion={setRegionAndSave}
            isAdmin={isAdmin}
            archive={archive}
            setArchive={setArchive}
            lightMode={lightMode}
          />
        )}
      </div>
    </div>
  );
}
