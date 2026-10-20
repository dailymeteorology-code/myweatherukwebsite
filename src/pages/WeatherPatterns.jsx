// Weather Patterns Page — v4 (UK & Europe convective outlook — full redesign)

import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Clock, ShieldAlert, CloudLightning,
  ChevronRight, ChevronDown, Wind, Zap, CloudRain, Activity,
  Play, RefreshCw, MapPin, Layers, Loader2,
  Sun, Database, Radio, Thermometer, BarChart2,
  Eye, TrendingUp, CheckCircle,
  CloudSnow, Map as MapIcon, Download, FileText, ToggleLeft, ToggleRight,
  Pen, Trash2, Save, PenLine, Eraser } from
'lucide-react';
import { base44 } from '@/api/base44Client';
import TCMApiStatus from '@/components/tcm/TCMApiStatus';
import TCMLeafletBase from '@/components/tcm/TCMLeafletBase';
import useBlitzortung from '@/components/tcm/useBlitzortung';
import AIAuthCard from '@/components/tcm/AIAuthCard';
import { smoothBlobPath } from '@/components/tcm/smoothBlobPath';
import { ringToSvgPath, buildFineGrid, buildSmoothedField } from '@/components/tcm/geometryEngine';
// Canonical outlook-layer builders (single implementation) — the local
// buildOutlookLayers* functions below are thin wrappers that adapt the page's
// positional call sites onto these.
import {
  buildOutlookLayers as _outlookLayers,
  buildHiResOutlookLayers as _hiResLayers,
  buildOutlookLayersForStep as _stepLayers,
  buildSevereOverlay as _severeLayers,
} from '@/lib/tcmOutlookLayers';
import { isInUKIreland, UK_IE_DATA_BOX, UK_IRELAND_COUNTIES } from '@/components/tcm/ukIrelandMask';
import { fetchOpenMeteoTCM, continueTCM, estimateRunSeconds } from '@/lib/openMeteoTCM';
// Open-Meteo Ensemble is the ONLY data source for the TCM page. The legacy
// tcmGrid backend, AI fallback and DB-read paths have been removed — every
// payload that reaches the UI comes directly from the canonical Open-Meteo
// URL documented in lib/openMeteoTCM.js. saveTCMRunToDB is retained purely
// as a write-only archival hook so admin refreshes can still be persisted
// for verification, but it is never read back as a data source.
import { loadRunFromCache, loadLatestRunFromCache, saveRunToCache, pruneOldForecastRuns, saveTCMRunToDB, listRunsFromDB, loadRunByKeyFromDB, saveAdminDrawnOutlook, deleteAdminDrawnOutlook, loadLatestAdminOutlookFromDB, updateAdminDrawnOutlook, loadLatestTCMFromDB } from '@/lib/tcmForecastCache';
import useTCMData from '@/components/tcm/useTCMData';
import OMDataSourcePanel from '@/components/tcm/OMDataSourcePanel';

import MapHoverTooltip from '@/components/tcm/MapHoverTooltip';
import { setLastFetch, isCurrentUserAdmin } from '@/lib/tcmFetchPolicy'; import { fwdWheel } from '@/lib/forwardWheelToMap'; import RunWaitCountdown from '@/components/tcm/RunWaitCountdown';
/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */
const HOURS_PER_STEP = 3;
const STEPS_PER_DAY = 8;
const TOTAL_STEPS = 32;
const RUN_CACHE_VERSION = 'v20_utc_runs';

const REGIONS = {
  uk: {
    id: 'uk', label: 'UK & Ireland', flag: '🇬🇧',
    // Tight data/display box = UK + Ireland (with surrounding seas). Every point
    // inside is fetched, scored and plotted (buildCoords fills the whole box).
    bbox: { lonMin: -11.0, lonMax: 2.5, latMin: 49.5, latMax: 61.5 },
    gridStep: 1.25
  },
  fr: {
    id: 'fr', label: 'France', flag: '🇫🇷',
    // Whole of mainland France + Corsica (+ a coastal margin). Same engine and
    // resolution as the UK; France's higher continental CAPE naturally lifts the
    // ingredient scores exactly where the physics warrants it.
    bbox: { lonMin: -5.5, lonMax: 10.0, latMin: 41.0, latMax: 51.5 },
    gridStep: 1.1
  },
  eu: {
    id: 'eu', label: 'Europe', flag: '🇪🇺',
    bbox: { lonMin: -12.0, lonMax: 32.0, latMin: 35.0, latMax: 62.0 },
    // 2.5° → ~198 cells → 4 batches → 2 parallel rounds at CONCURRENCY=3.
    gridStep: 2.5
  }
};

// True when (lat,lon) sits inside the active region's data box. An undefined
// bbox means "don't clip" (fail-open) so a missing region never blanks the map.
function inRegionBox(lat, lon, bbox) {
  if (!bbox) return true;
  return lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax;
}


// Region switcher — UK & Ireland and France are live and clickable (each drives
// its own fetch/cache via the shared `region` state). "Europe" stays "coming
// soon": hovering (desktop) or tapping (mobile) it reveals a popup with a Buy Me
// a Coffee support link (set by the admin in Site Settings).
function RegionSwitcher({ t, region, setRegion }) {
  const [open, setOpen] = useState(false);
  const [coffeeUrl, setCoffeeUrl] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    base44.entities.SiteSettings.list()
      .then(list => { if (!cancelled) setCoffeeUrl(list?.[0]?.buymeacoffee_url || ''); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const textPrimary = t.textPrimary ?? t.textSecondary;
  const textMuted = t.textMuted ?? t.textSecondary;

  return (
    <div className="wp-region-switcher" style={{ border: `1px solid ${t.cardBorder}`, background: t.cardBg, backdropFilter: 'blur(16px)' }}>
      {/* Live regions — UK & Ireland + France (click a flag to switch) */}
      {[
        { id:'uk', flag:'🇬🇧', label:'UK & Ireland' },
        { id:'fr', flag:'🇫🇷', label:'France' },
      ].map((r) => {
        const active = region === r.id;
        return (
          <button key={r.id} type="button" onClick={() => setRegion && setRegion(r.id)} aria-pressed={active}
            title={active ? `${r.label} — live` : `Switch to ${r.label}`}
            style={active ? {
              padding:'9px 16px', fontSize:'0.73rem', fontWeight:800, color:'#fff', whiteSpace:'nowrap',
              background:'linear-gradient(135deg,#6366f1,#38bdf8)', letterSpacing:'0.03em', border:'none', cursor:'pointer',
              boxShadow:'inset 0 1px 0 rgba(255,255,255,0.3), 0 2px 12px rgba(99,102,241,0.4)'
            } : {
              padding:'9px 15px', fontSize:'0.73rem', fontWeight:800, color:textMuted, whiteSpace:'nowrap',
              background:'transparent', border:'none', cursor:'pointer', letterSpacing:'0.03em', transition:'color .15s'
            }}>
            {r.flag}&nbsp;{r.label}
          </button>
        );
      })}

      {/* Europe — coming soon */}
      <div ref={wrapRef} style={{ position:'relative', display:'flex' }}
           onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button type="button" onClick={(e) => { e.preventDefault(); setOpen(o => !o); }}
          aria-haspopup="dialog" aria-expanded={open}
          style={{ padding:'9px 15px', fontSize:'0.73rem', fontWeight:800, color:textMuted,
            background:'transparent', border:'none', cursor:'pointer', letterSpacing:'0.03em',
            whiteSpace:'nowrap', opacity:0.8, display:'flex', alignItems:'center', gap:6 }}>
          🇪🇺 Europe
          <span style={{ fontSize:'0.5rem', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em',
            padding:'2px 6px', borderRadius:99, background:'rgba(148,163,184,0.2)', color:t.textSecondary }}>Soon</span>
        </button>

        {open && (
          <div role="dialog" style={{
            position:'absolute', right:0, width:260, maxWidth:'86vw', zIndex:60, padding:14, borderRadius:14, textAlign:'left',
            top:'calc(100% + 10px)',   // always opens downward — switcher now sits in the top command bar
            background:t.cardBg, border:`1px solid ${t.cardBorder}`, backdropFilter:'blur(16px)',
            boxShadow:'0 16px 40px rgba(15,23,42,0.28)', fontFamily:"'DM Sans',system-ui,sans-serif" }}>
            <div style={{ fontSize:'0.86rem', fontWeight:800, color:textPrimary, marginBottom:4 }}>
              European outlooks — coming soon
            </div>
            <p style={{ margin:'0 0 12px', fontSize:'0.72rem', lineHeight:1.5, color:t.textSecondary }}>
              Thunderstorm forecasts for Europe aren’t available yet — they’re in development.
              Your support helps bring them online sooner.
            </p>
            {coffeeUrl ? (
              <a href={coffeeUrl} target="_blank" rel="noopener noreferrer"
                 style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                   padding:'9px 12px', borderRadius:10, textDecoration:'none', fontSize:'0.76rem', fontWeight:800,
                   color:'#0f172a', background:'linear-gradient(135deg,#ffdd00,#ffb700)',
                   boxShadow:'0 4px 14px rgba(255,183,0,0.35)' }}>
                ☕ Support the model
              </a>
            ) : (
              <div style={{ fontSize:'0.68rem', color:textMuted, fontStyle:'italic' }}>Support link coming soon.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Full-bleed flag "whoosh" played over the map when the user switches region
// (UK ⇄ France): a tricolour/indigo radial wash, an expanding ripple, the target
// flag zooming through, and the region name. Doubles as a graceful cover while
// the new region's outlook loads. `anim` = { id, flag, label, c1, c2 } or null.
function RegionSwitchFX({ anim }) {
  return (
    <AnimatePresence>
      {anim && (
        <motion.div key={anim.id}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
          style={{ position:'absolute', inset:0, zIndex:45, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', pointerEvents:'none', overflow:'hidden', borderRadius:20,
            background:`radial-gradient(circle at 50% 44%, ${anim.c1}f2 0%, ${anim.c2}e0 58%, ${anim.c1}f7 100%)`,
            backdropFilter:'blur(3px)', WebkitBackdropFilter:'blur(3px)' }}>
          <motion.div
            initial={{ scale: 0, opacity: 0.6 }} animate={{ scale: 4.2, opacity: 0 }} transition={{ duration: 1.0, ease: 'easeOut' }}
            style={{ position:'absolute', width:170, height:170, borderRadius:'50%', border:'3px solid rgba(255,255,255,0.85)' }} />
          <motion.div
            initial={{ scale: 0.3, rotate: -14, opacity: 0, filter:'blur(6px)' }}
            animate={{ scale: 1, rotate: 0, opacity: 1, filter:'blur(0px)' }}
            exit={{ scale: 1.7, opacity: 0, filter:'blur(4px)' }}
            transition={{ type:'spring', stiffness: 250, damping: 17 }}
            style={{ fontSize: 92, lineHeight: 1, filter:'drop-shadow(0 10px 26px rgba(0,0,0,0.5))' }}>
            {anim.flag}
          </motion.div>
          <motion.div
            initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: 0.1, duration: 0.4 }}
            style={{ marginTop: 14, color:'#fff', fontWeight: 900, fontSize:'1.55rem', letterSpacing:'0.01em',
              textShadow:'0 2px 14px rgba(0,0,0,0.55)', fontFamily:"'DM Sans',system-ui,sans-serif" }}>
            {anim.label}
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 0.9 }} exit={{ opacity: 0 }} transition={{ delay: 0.2, duration: 0.4 }}
            style={{ marginTop: 5, color:'rgba(255,255,255,0.9)', fontWeight: 700, fontSize:'0.66rem',
              textTransform:'uppercase', letterSpacing:'0.2em', fontFamily:"'DM Mono',monospace" }}>
            Loading outlook…
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const REGION_FX = {
  uk: { flag: '🇬🇧', label: 'UK & Ireland', c1: '#4f46e5', c2: '#38bdf8' },
  fr: { flag: '🇫🇷', label: 'France',        c1: '#1e40af', c2: '#ef4444' },
};

const VIEW_MODES = [
{ id: 'probability',    label: 'Probability',     icon: MapIcon,  desc: 'Grid probability fill (UKMO-style)' },
{ id: 'outlook',        label: 'Outlook',          icon: Layers,   desc: 'Nested risk polygons (SPC-style)' },
{ id: 'admin-outlook',  label: 'Admin Outlooks',   icon: PenLine,  desc: 'Admin-drawn outlook graphic overlaid on the map' },
{ id: 'hires',          label: 'High Resolution',  icon: Layers,   desc: 'High-detail forecast polygons (finer structure & gradients)' },
{ id: 'animated',       label: 'Animated',         icon: Activity, desc: '3-hourly time steps' },
{ id: 'radar',           label: 'Rain & Hail Radar', icon: Radio,    desc: 'High-resolution rain + hail radar outlook (Day 1–2, animated 3-hour steps)' },
{ id: 'temp-max',       label: 'Max Temp',         icon: Thermometer, desc: 'Daily maximum 2 m temperature (°C) — colour surface + town readouts' },
{ id: 'temp-min',       label: 'Min Temp',         icon: Thermometer, desc: 'Daily minimum 2 m temperature (°C) — colour surface + town readouts' },
{ id: 'hoco',           label: 'HOCO Outlook',     icon: CloudLightning, desc: 'HOCO V2.0 probabilistic lightning outlook (England + Scotland) — calibrated to the UK/TCM risk scale, available for all 3 days' }];


/* Risk levels (8) — internal key + threshold + on-map short code */
const RISK_META = [
{ level: 'No Risk',  min: 0,  short: 'NONE' },
{ level: 'Very Low', min: 5,  short: 'TSTM' },
{ level: 'Low',      min: 12, short: 'MRGL' },
{ level: 'Marginal', min: 22, short: 'SLGT' },
{ level: 'Slight',   min: 35, short: 'ENH'  },
{ level: 'Moderate', min: 50, short: 'MDT'  },
{ level: 'High',     min: 65, short: 'HIGH' },
{ level: 'Severe',   min: 80, short: 'SVR'  }];  // Hatching overlay


/* Per-risk colour palettes
 * Each hazard now has its own distinct palette so the map and legend make
 * clear at a glance which hazard is being plotted.
 *
 *  - Thunderstorm → green → yellow → orange → red → purple (classic SPC)
 *  - Hail         → green → yellow → cyan   → blue → navy   (cool/ice tones)
 *  - Tornado     → green → yellow → orange → red → crimson (warm/violent)
 *  - Lightning   → green → yellow → amber  → magenta → deep purple
 *
 * The lower three levels (Very Low / Low / Marginal) intentionally share a
 * green→olive ramp so "no big deal" looks the same across hazards — the
 * differentiation kicks in at Slight and above where impacts diverge.
 */
/* Canonical risk scale — colours taken from the Risk Key graphic.
 * Index order matches RISK_META:
 *   0 No Risk · 1 TSTM · 2 MRGL · 3 SLGT · 4 ENH · 5 MDT · 6 HIGH · 7 SVR(hatch)
 * All four hazards share this ramp so the map and the key always agree.
 */
const RISK_SCALE = [
  // No Risk
  { fill: 'transparent',              border: 'transparent', text: 'transparent' },
  // TSTM — light blue
  { fill: 'rgba(127,184,232,0.44)',   border: '#5b9bd5',     text: '#0b3a5c' },
  // MRGL — green
  { fill: 'rgba(79,191,106,0.50)',    border: '#3da356',     text: '#0f3d1e' },
  // SLGT — gold / yellow
  { fill: 'rgba(242,194,49,0.56)',    border: '#d9a91c',     text: '#3f2d05' },
  // ENH — orange
  { fill: 'rgba(242,140,40,0.60)',    border: '#d97316',     text: '#431407' },
  // MDT — red
  { fill: 'rgba(239,95,95,0.64)',     border: '#dc3f3f',     text: '#ffffff' },
  // HIGH — purple
  { fill: 'rgba(155,110,243,0.68)',   border: '#7c4ddb',     text: '#ffffff' },
  // SVR — black hatch overlay
  { fill: 'rgba(0,0,0,0.62)',         border: '#000000',     text: '#ffffff' },
];

const RISK_PALETTES = {
  thunderstorm: RISK_SCALE,
  hail:         RISK_SCALE,
  tornado:      RISK_SCALE,
  lightning:    RISK_SCALE,
};

/* Display layer — internal level keys stay unchanged so saved outlooks and
 * published DB runs keep working; only what the user reads changes. */
const RISK_DISPLAY = {
  'No Risk':  { name: 'No Risk',               code: '—'    },
  'Very Low': { name: 'General Thunderstorms', code: 'TSTM' },
  'Low':      { name: 'Marginal',              code: 'MRGL' },
  'Marginal': { name: 'Slight',                code: 'SLGT' },
  'Slight':   { name: 'Enhanced',              code: 'ENH'  },
  'Moderate': { name: 'Moderate',              code: 'MDT'  },
  'High':     { name: 'High',                  code: 'HIGH' },
  'Severe':   { name: 'Severe Thunderstorms',  code: 'SVR'  },
};
const riskName = (lvl) => RISK_DISPLAY[lvl]?.name ?? lvl;
const riskCode = (lvl) => RISK_DISPLAY[lvl]?.code ?? lvl;

// Per-risk descriptions — used in the OutlookLegend (map key) and the PDF.
// Each hazard explains what THAT specific risk level means for THAT hazard.
const RISK_DESCRIPTIONS_PER_RISK = {
  thunderstorm: {
    'Very Low': 'Isolated, brief thundery showers possible during peak heating. Single rumbles, no organised activity. Low impact.',
    'Low':      'Scattered thunderstorms — most short-lived. Frequent lightning in any cell, small hail under 2 cm, gusty winds. Low-to-moderate impact.',
    'Marginal': 'Genuine severe-storm threat. Storm clusters can persist for hours with frequent lightning, hail 2–3 cm, sudden flooding, gusts to 60 mph.',
    'Slight':   'Organised severe storms expected. Multicell clusters or squall lines; large hail 3–4 cm, damaging gusts, localised flash flooding.',
    'Moderate': 'Significant organised severe weather. Long-lived squall lines, hail 3–5 cm, gusts 60–80 mph, significant flash flooding.',
    'High':     'Exceptionally rare, dangerous storm event. Violent supercells, giant hail (≥5 cm), gusts 80–100 mph, credible tornado threat. Stay alert.',
    'Severe':   'Severe Thunderstorm overlay (hatching). Indicates risk of organised severe convection — supercells, large hail, damaging winds — at any risk-band level. Not a score tier.',
  },
  hail: {
    'Very Low': 'Marginal instability — a few small hailstones (<1 cm) possible in any isolated shower. No real damage expected.',
    'Low':      'Sufficient CAPE and a low freezing level for hail up to 1–2 cm in stronger cells. Brief crop damage possible in isolated areas.',
    'Marginal': 'Meaningful large-hail threat. CAPE and lapse rates support hail 2–4 cm. Vehicle damage and crop losses possible.',
    'Slight':   'Organised cells capable of hail to 3–4 cm. Localised vehicle and crop damage; greenhouse and skylight damage possible.',
    'Moderate': 'Supercell or multicell storms capable of hail 4–6 cm. Significant property damage in affected corridors.',
    'High':     'Extreme large-hail event. Hail 6–10 cm likely along storm tracks. Severe structural damage and serious injury risk.',
    'Severe':   'Severe hail overlay (hatching). Large-hail-capable cells in the area regardless of overall risk band.',
  },
  tornado: {
    'Very Low': 'Marginal environment. A brief, weak landspout (T0–T1) is theoretically possible but highly unlikely.',
    'Low':      'Weak tornado environment exists. An isolated weak tornado (T1–T2) cannot be ruled out near stronger cells.',
    'Marginal': 'Genuine if marginal tornado risk. Organised storms could produce T2–T3 tornadoes. Damage to trees and outbuildings possible.',
    'Slight':   'Discrete supercells possible with brief T2–T3 tornadoes. Tree damage, mobile-home and outbuilding damage on any track.',
    'Moderate': 'Significant tornado threat. Supercell-capable environment. T3–T5 tornadoes possible with major structural damage along any track.',
    'High':     'Rare and dangerous tornado outbreak. Multiple significant tornadoes (T4–T6) possible. Widespread severe damage and risk to life.',
    'Severe':   'Severe tornado overlay (hatching). Tornado-capable environment exists at this location on top of the colour risk level shown.',
  },
  lightning: {
    'Very Low': 'Very isolated storm may produce a few cloud-to-ground strokes during peak heating. Probability low.',
    'Low':      'Thunderstorms with frequent lightning expected in isolated areas. Seek shelter if thunder is heard.',
    'Marginal': 'Frequent, intense lightning from organised convection. Multiple strikes per minute within storm cores.',
    'Slight':   'Frequent lightning from scattered to widespread storms. Outdoor activity risk; power flickers possible.',
    'Moderate': 'Very frequent lightning from long-lived clusters or squall lines. Power disruption, wildfires and fatality risk are elevated.',
    'High':     'Extreme lightning event. Positive cloud-to-ground strikes likely. Infrastructure damage and serious risk to life.',
    'Severe':   'Severe thunderstorm overlay (hatching). Frequent high-intensity lightning expected regardless of the overall colour risk band.',
  },
};

const RISK_INDEX = Object.fromEntries(RISK_META.map((r, i) => [r.level, i]));

// ── Shareable URL state ──────────────────────────────────────────────────────
// Day, hazard, tab, map view and pinned point are mirrored into the location
// hash (read-modify-write, so each part only touches its own keys). Opening a
// shared link restores the exact view via the lazy state initializers below.
function readHashParams() {
  try { return new URLSearchParams((window.location.hash || '').replace(/^#/, '')); }
  catch { return new URLSearchParams(); }
}
function writeHashParams(updates) {
  try {
    const p = readHashParams();
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') p.delete(k); else p.set(k, String(v));
    }
    const s = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${s ? '#' + s : ''}`);
  } catch {}
}

function scoreToLevel(score) {
  for (let i = RISK_META.length - 1; i >= 0; i--) {
    if (score >= RISK_META[i].min) return RISK_META[i].level;
  }
  return 'No Risk';
}

function getPalette(riskType, level) {
  const idx = RISK_INDEX[level] ?? 0;
  const pal = RISK_PALETTES[riskType] ?? RISK_PALETTES.thunderstorm;
  return pal[idx] ?? pal[0];
}


const LEVEL_OPACITY = {
  'Very Low': 0.55,
  'Low': 0.62,
  'Marginal': 0.68,
  'Slight': 0.72,
  'Moderate': 0.76,
  'High': 0.82,
  'Severe': 0.88
};


const RISK_TYPES = [
{ id: 'thunderstorm', label: 'Thunderstorm', shortLabel: 'Storm', icon: CloudLightning, color: '#e65100' },
{ id: 'hail', label: 'Hail', shortLabel: 'Hail', icon: CloudRain, color: '#2e7d32' },
{ id: 'tornado', label: 'Tornado', shortLabel: 'Tor', icon: Wind, color: '#827717' },
{ id: 'lightning', label: 'Lightning', shortLabel: 'Ltg', icon: Zap, color: '#6a1b9a' }];


/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */

function fmtRange(level) {
  const idx = RISK_INDEX[level];
  if (idx == null) return '';
  const next = RISK_META[idx + 1];
  const max = next ? next.min - 1 : 100;
  return `(${RISK_META[idx].min}–${max})`;
}


// ── British Summer Time helpers ────────────────────────────────────────────
// All run scheduling is keyed to UK local clock time (BST = UTC+1 in summer,
// GMT = UTC in winter). The Date objects returned still carry a UTC instant —
// they just refer to the wall-clock hour the user sees in the UK.
function _isBST(d) {
  const y = d.getUTCFullYear();
  const lastSun = (year, monthZeroBased) => {
    const lastDay = new Date(Date.UTC(year, monthZeroBased + 1, 0));
    const dow = lastDay.getUTCDay();
    return new Date(Date.UTC(year, monthZeroBased, lastDay.getUTCDate() - dow, 1));
  };
  return d >= lastSun(y, 2) && d < lastSun(y, 9);
}
function _bstOffsetHours(d) { return _isBST(d) ? 1 : 0; }
function _bstNow(now = new Date()) { return new Date(now.getTime() + _bstOffsetHours(now) * 3600_000); }

// Returns the most recent 00/06/12/18 UTC run as a UTC Date.
// Model runs are published in UTC across the meteorological world — this
// function picks the nearest *past* UTC run hour from the supplied instant.
// (Earlier versions tried to be clever and shift to "BST run hour" which
// caused fmtRun to display 05/11/15/23Z labels in summer. Runs are UTC.)
function utcRunForDate(d) {
  const h = d.getUTCHours();
  const run = h >= 18 ? 18 : h >= 12 ? 12 : h >= 6 ? 6 : 0;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), run));
}


function fmtRun(d) {
  return `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')} ${d.getUTCHours().toString().padStart(2, '0')}Z`;
}
function stepLabel(step, run) {
  const ms = run.getTime() + step * HOURS_PER_STEP * 3600_000;
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${d.getUTCHours().toString().padStart(2, '0')}Z`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CACHE
═══════════════════════════════════════════════════════════════════════════ */
function tcmCacheKey(region) { return `tcm_${RUN_CACHE_VERSION}_${region}_active`; }
// Per-run cache key so each model run (00Z/06Z/12Z/18Z) is stored separately
// and selecting a different run actually shows that run's data.
function tcmRunCacheKey(region, run) {
  return `tcm_${RUN_CACHE_VERSION}_${region}_run_${run.toISOString().slice(0,13)}`;
}
function loadCachedTCM(region) {
  try {const c = localStorage.getItem(tcmCacheKey(region));return c ? JSON.parse(c) : null;} catch {return null;}
}
function pruneOldRuns() {
  try {
    const cutoff = Date.now() - 7 * 86400_000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('tcm_')) continue;
      try {const d = JSON.parse(localStorage.getItem(k));if (d?.builtAt && d.builtAt < cutoff) localStorage.removeItem(k);} catch {localStorage.removeItem(k);}
    }
  } catch {}
}

const _bgRefreshInFlight = new Set();

/* ═══════════════════════════════════════════════════════════════════════════
   DATA FETCHING — single source: Open-Meteo Ensemble
   Canonical endpoint (see lib/openMeteoTCM.js):
     https://ensemble-api.open-meteo.com/v1/ensemble
       ?latitude=…&longitude=…
       &daily=precipitation_sum,cape_mean,cape_max
       &hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,
               apparent_temperature,weather_code,surface_pressure,pressure_msl,
               cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,
               wind_speed_10m,wind_speed_80m,wind_direction_10m,wind_direction_80m,
               wind_gusts_10m,surface_temperature,cape,convective_inhibition,
               freezing_level_height
       &models=ncep_gefs05_ensemble_mean,ecmwf_ifs025_ensemble_mean,
               ecmwf_aifs025_ensemble_mean,ukmo_global_ensemble_mean_20km,
               ukmo_uk_ensemble_mean_2km
       &timezone=Europe%2FLondon&wind_speed_unit=mph
   The tcmGrid backend, Deno API, AI fallback and DB-cache reads have all been
   removed. Open-Meteo is the only path to fresh data.
═══════════════════════════════════════════════════════════════════════════ */
// Single-source fetch: Open-Meteo Ensemble only.
//
// force:true is passed unconditionally because doFetch is itself only called
// from runTCM when no usable local cache exists (cold load) or when the
// admin Refresh button is pressed — in both cases we WANT live data and
// must bypass the FETCH_NOT_DUE gate that exists inside fetchOpenMeteoTCM
// for routine page loads inside an already-fetched run window.
async function doFetch({ region, run, onProgress, fastMode, maxDay = 3 }) {
  const reg = REGIONS[region];
  const key = tcmCacheKey(region);
  onProgress?.(0.05);

  let payload;
  try {
    payload = await fetchOpenMeteoTCM({
      bbox:       reg.bbox,
      gridStep:   reg.gridStep,
      run,
      onProgress: (p) => onProgress?.(0.05 + p * 0.9),
      fastMode,
      force:      true,
      maxDay,
    });
  } catch (awsErr) {
    console.error('[TCM] AWS run unavailable:', awsErr?.message);
    throw new Error(`TCM V3 run unavailable: ${awsErr?.message || 'unknown error'}`);
  }

  if (!payload?.grid?.length) {
    throw new Error('TCM V3 run has no grid data');
  }
  console.info(`[TCM] AWS model run — ${payload.grid.length} pts`);

  payload.region = region;
  payload.run = payload.run || run.toISOString();

  // NOTE: we intentionally do NOT strip non-UK/IE grid points from payload.grid here.
  // The buildContourRiskLayers / buildFineGrid pipeline needs neighbouring grid points
  // from just outside the UK coast so IDW interpolation at coastal cells doesn't
  // collapse to zero (which was causing jagged spike artefacts along shorelines).
  // Offshore bleed is handled downstream by clipRingToUKIreland which clips every
  // contour ring to land BEFORE it reaches the renderer.

  // NOTE: bias calibration has been removed — it was applying a single regional
  // score_offset uniformly across all grid points, which caused the map to show
  // inflated or deflated scores independent of the actual model data, creating
  // the "bias to a region" effect that was reported. Scores now come directly
  // from the Open-Meteo engine with no post-processing adjustment.

  // Save both to the "active" key AND a per-run key so switching run shows that run.
  // IMPORTANT: _rawById (retained raw JSON for free "Continue") can be tens of MB
  // for a full-grid Day-1 run — far over the localStorage quota. We keep it ONLY
  // on the in-memory payload (so Continue works within the session with no
  // re-fetch) and strip it from the localStorage copy. A reload therefore loses
  // the raw and Continue falls back to a re-fetch (handled), but the common
  // Run→Continue→Continue flow in one session stays network-free.
  const runKey = tcmRunCacheKey(region, run);
  const { _rawById, _realGrid, ...persistable } = payload;
  const persistStr = JSON.stringify(persistable);
  try {localStorage.setItem(key, persistStr);}
  catch {pruneOldRuns();try {localStorage.setItem(key, persistStr);} catch {}}
  try {localStorage.setItem(runKey, persistStr);} catch {}

  onProgress?.(1);
  return payload;   // in-memory payload still carries _rawById
}

function loadCachedTCMForRun(region, run) {
  try {
    const c = localStorage.getItem(tcmRunCacheKey(region, run));
    return c ? JSON.parse(c) : null;
  } catch {return null;}
}

// Validate that cached data actually covers the full region bbox
// (reject caches from the Deno API that only returned a single lat row).
//
// LOOSENED so the page renders rather than blanking when the backend
// returns a slightly sparser-than-expected grid. The previous 25-pt /
// 70%-span gate caused the entire fallback chain to fire — and then,
// if Open-Meteo was throttled or returned a partial response, the
// Outlook tab simply never populated. 15 pts and 50% span is enough
// to form meaningful clusters, and anything smaller still falls
// through to the OM / AI fallback as before.
function isValidCache(cached, region) {
  const grid = cached?.grid;
  if (!grid?.length || grid.length < 10) return false;
  const bbox = REGIONS[region]?.bbox;
  if (!bbox) return true;
  // Loop, not Math.max(...spread): spreading a resolution-scaled array overflows
  // the call stack on large grids ("Maximum call stack size exceeded").
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const p of grid) {
    if (p.lat < latMin) latMin = p.lat;
    if (p.lat > latMax) latMax = p.lat;
    if (p.lon < lonMin) lonMin = p.lon;
    if (p.lon > lonMax) lonMax = p.lon;
  }
  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;
  const expectedLatSpan = bbox.latMax - bbox.latMin;
  const expectedLonSpan = bbox.lonMax - bbox.lonMin;
  return latSpan >= expectedLatSpan * 0.35 && lonSpan >= expectedLonSpan * 0.35;
}

async function runTCM({ region, run, onProgress, force = false, maxDay = 3 }) {
  // 1. Prefer a cache entry for THIS exact run so switching runs always shows
  //    that run's data instantly. Local caches are themselves snapshots of
  //    previous Open-Meteo responses, so they do not violate the
  //    "Open-Meteo is the only data source" rule — they just avoid re-hitting
  //    the API for the same run.
  const exactRunCached = loadCachedTCMForRun(region, run) || loadRunFromCache(region, run);
  if (exactRunCached && !force && isValidCache(exactRunCached, region)) {
    onProgress?.(1);
    return exactRunCached;
  }

  // 2. Fall back to the most recently SAVED snapshot for the region — this
  //    is the "latest run" the user expects to see on a cold page load.
  const latest = !force ? loadLatestRunFromCache(region) : null;

  // 3. Admin force-refresh — pull a fresh Open-Meteo payload immediately and
  //    archive it (best-effort) so it can be inspected later. The archive
  //    write is intentionally NOT used as a read path anywhere; Open-Meteo
  //    remains the only source the page ever reads from.
  if (force) {
    onProgress?.(0.05);
    const payload = await doFetch({ region, run, onProgress, fastMode: true, maxDay });
    saveRunToCache(region, run, payload);
    try {
      await saveTCMRunToDB(region, run, payload);
      console.info('[TCM] archived admin refresh to RiskGridCache (write-only)');
    } catch (e) {
      console.warn('[TCM] DB archive failed (data still served locally):', e?.message);
    }
    return payload;
  }

  // 4. No exact cache → try the most recent local snapshot before going to
  //    the network. This is just a "show something instantly" optimisation;
  //    the scheduled background fetch effect will refresh from Open-Meteo
  //    the moment a new 00/06/12/18 UTC run window opens.
  if (latest && isValidCache(latest, region)) { onProgress?.(1); return latest; }
  const cached = loadCachedTCM(region);
  if (cached && isValidCache(cached, region)) { onProgress?.(1); return cached; }

  // 5. No usable cache anywhere — fetch live from Open-Meteo. _bgRefreshInFlight
  //    de-duplicates concurrent fetches for the same region (e.g. the page
  //    mounting twice in StrictMode or the scheduled effect firing at the
  //    same instant as a manual reload).
  if (!_bgRefreshInFlight.has(region)) {
    _bgRefreshInFlight.add(region);
    onProgress?.(0.05);
    try {
      const payload = await doFetch({ region, run, onProgress, fastMode: false });
      setLastFetch(region, Date.now());
      saveRunToCache(region, run, payload);
      return payload;
    } finally {
      _bgRefreshInFlight.delete(region);
    }
  }

  // 6. A fetch is already in flight for this region — wait briefly then
  //    return whatever landed in the local cache. If still nothing, throw
  //    so useTCMData's .catch path can surface a clear error to the user
  //    rather than silently returning null (which left the loading
  //    spinner spinning forever).
  await new Promise(r => setTimeout(r, 4000));
  const afterWait = loadCachedTCMForRun(region, run) || loadCachedTCM(region);
  if (afterWait && isValidCache(afterWait, region)) return afterWait;
  throw new Error('Open-Meteo fetch in progress — please try again in a moment.');
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORE ACCESSORS
═══════════════════════════════════════════════════════════════════════════ */

// Offshore cells need no special damping here: the fetch mask keeps sea points
// so coastal interpolation stays smooth, and clipRingToUKIreland trims every
// contour ring to land before it is rendered. The former land-proximity score
// damper (and its GB/Ireland polygons) was removed as dead code — getRiskScore
// returns the pure model score.

function getRiskScore(pt, riskType, dayIdx) {
  // Return the raw engine score with NO geographic weighting.
  // landProximityFactor was previously applied here and artificially boosted
  // points that were deep inside the GB polygon (Northern England, Wales,
  // Ireland) while silently damping points near the coast (southern England,
  // Kent, Sussex). This created the visible bias toward Ireland / Wales /
  // Northern England even when the actual OM data had equal or higher risk
  // over central and southern England. The pure model signal is now used
  // directly — if Open-Meteo says CAPE=800 over Sussex, Sussex gets the score.
  return pt.perDay?.[dayIdx]?.scores?.[riskType] ?? 0;
}

function getRiskScoreStep(pt, riskType, stepIdx) {
  // perStep is present on locally-computed runs. Cross-device runs loaded from
  // the DB are slimmed (perStep stripped to keep the published payload small),
  // so fall back to the matching per-day scores — each global step maps to its
  // day (8 three-hourly steps per day). This keeps the 3-hourly timeline view
  // populated (at day-level granularity) on other devices instead of blank.
  let scores = pt.perStep?.[stepIdx]?.scores;
  if (!scores) {
    const dayIdx = Math.floor(stepIdx / 8);
    scores = pt.perDay?.[dayIdx]?.scores;
  }
  if (!scores) return 0;
  let raw;
  if (riskType === 'hail')      raw = scores.sub?.hail    ?? scores.hail    ?? 0;
  else if (riskType === 'tornado') raw = scores.sub?.tornado ?? scores.tornado ?? 0;
  else if (riskType === 'lightning') raw = scores.lightning ?? 0;
  else raw = scores[riskType] ?? 0;
  // No geographic factor — pure model data
  return raw;
}

/* ═══════════════════════════════════════════════════════════════════════════
   GEOMETRY ENGINE
═══════════════════════════════════════════════════════════════════════════ */


const LEVEL_PAD_SCALE = {
  'Very Low': 3.2,
  'Low': 2.8,
  'Marginal': 2.2,
  'Slight': 1.8,
  'Moderate': 1.4,
  'High': 1.0,
  'Severe': 0.7
};

function clusterToPath(cluster, projector, gridStep = 0.3, level = 'Very Low') {
  if (cluster.length < 4) return '';
  const pad = LEVEL_PAD_SCALE[level] ?? 2.0;
  return smoothBlobPath(cluster, projector, gridStep, pad);
}


// Detect the actual grid step from the data by finding the most common
// (modal) lat/lon difference. Using the minimum was unreliable — floating
// point noise could return a tiny value (e.g. 0.01°) even for a 1° grid,
// causing searchR to be far too small and no clusters to form.
// Known grid step values used by Open-Meteo and ECMWF ensemble products.
// Used to snap the detected step to the nearest exact value so that
// FINE_RES / gridStep is always an integer ratio (e.g. 0.25/1.25 = 5),
// ensuring source-grid points land exactly on fine-grid cells and the
// IDW exact-hit path fires correctly.
const KNOWN_GRID_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
function snapGridStep(v) {
  let best = v, bestDiff = Infinity;
  for (const s of KNOWN_GRID_STEPS) {
    const d = Math.abs(v - s);
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  return bestDiff <= 0.15 ? best : v;
}

// ── Strike colour options — identical to TCM page ────────────────────────────
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
function strikeColorByAge(timeMs) {
  const ageMin = (Date.now() - timeMs) / 60000;
  if (ageMin < 2)   return '#ffffff';
  if (ageMin < 5)   return '#fffde0';
  if (ageMin < 10)  return '#facc15';
  if (ageMin < 30)  return '#f97316';
  if (ageMin < 60)  return '#ef4444';
  if (ageMin < 360) return '#7f1d1d';
  if (ageMin < 720) return '#7c3aed';
  return '#4c1d95';
}
function getStrikeColor(timeMs, colourId) {
  if (!colourId || colourId === 'age') return strikeColorByAge(timeMs);
  return LIVE_STRIKE_COLOUR_OPTIONS.find(o => o.id === colourId)?.hex || strikeColorByAge(timeMs);
}

function detectGridStep(grid, fallback) {
  if (!grid?.length || grid.length < 2) return fallback;
  const sample = grid.slice(0, Math.min(grid.length, 200));
  const counts = {};
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const dLat = Math.abs(sample[i].lat - sample[j].lat);
      const dLon = Math.abs(sample[i].lon - sample[j].lon);
      // Use 2dp buckets to avoid 1.25 → 1.3 rounding error with 1dp
      if (dLat >= 0.05 && dLat <= 3.0) {
        const bucket = Math.round(dLat * 100) / 100;
        counts[bucket] = (counts[bucket] || 0) + 1;
      }
      if (dLat < 0.05 && dLon >= 0.05 && dLon <= 3.0) {
        const bucket = Math.round(dLon * 100) / 100;
        counts[bucket] = (counts[bucket] || 0) + 2;
      }
    }
  }
  const entries = Object.entries(counts);
  if (!entries.length) return fallback;
  const modal = entries.sort((a, b) => b[1] - a[1])[0][0];
  const step = parseFloat(modal);
  if (!Number.isFinite(step)) return fallback;
  const clamped = Math.max(0.1, Math.min(3.0, step));
  return snapGridStep(clamped);
}

// ── Risk levels shown as filled contour bands (Severe is a hatch overlay) ──
// Still referenced by the map legend; the point-gathering and threshold helpers
// that used to live here now belong to lib/tcmOutlookLayers.js, which the local
// builder wrappers below delegate to.
const CONTOUR_LEVELS = ['Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High'];

// ── Outlook layer builders — thin wrappers over the canonical builders in
// lib/tcmOutlookLayers.js. They keep the page's positional (grid, riskType,
// dayIdx, gridStep, region) call signature so no call site changes.
// Heavy blur (4 passes) + Chaikin smoothing (4 passes) + 0.30 deg² minimum
// area produces big, smooth, continuous nested rings rather than fragmented
// leaf-shaped slivers. Matches the SOTUK/SPC reference look.
function buildOutlookLayers(grid, riskType, dayIdx, gridStep, region = 'uk') {
  return _outlookLayers({ grid, riskType, dayIdx, bbox: REGIONS[region]?.bbox, gridStep, getRiskScore });
}

// ── High-Resolution tab: tighter, crisper nested rings ────────────────────
// 3 blur passes (vs 4 for the broad Outlook view) preserves more of the
// hotspot detail, with a higher minPolyArea (0.50) to drop coastal speckle.
function buildOutlookLayersConservative(grid, riskType, dayIdx, gridStep, region = 'uk') {
  return _hiResLayers({ grid, riskType, dayIdx, bbox: REGIONS[region]?.bbox, gridStep, getRiskScore });
}

// ── "Severe Thunderstorm" overlay: hatch zones where organised severe
// convection is indicated by sub-hazard scores (hail, supercell, tornado,
// strong winds). This overlay is INDEPENDENT of the overall risk level —
// it can appear inside a Very Low, Low, Marginal, Slight, Moderate or High
// risk zone. It represents the risk of SEVERE THUNDERSTORMS specifically
// (like SOTUK's black-hatch "Significant" zone), not a separate risk band.
// The threshold is intentionally lower (15) so marginal severe events are
// shown — a supercell with large hail is severe even in a Low-risk area.
function buildSevereThunderstormOverlay(grid, riskType, dayIdx, gridStep, region = 'uk') {
  return _severeLayers({ grid, dayIdx, bbox: REGIONS[region]?.bbox, gridStep });
}

function buildOutlookLayersForStep(grid, riskType, stepIdx, gridStep, region = 'uk') {
  return _stepLayers({ grid, riskType, stepIdx, bbox: REGIONS[region]?.bbox, gridStep, getRiskScore: getRiskScoreStep });
}

/* AUTO-GENERATED DAY DESCRIPTION — implementation in generateDayDescription.js */
import { makeGenerateDayDescription } from '@/components/tcm/generateDayDescription';
import { buildImpactedLocations } from '@/components/tcm/impactedLocations'; import DrawnAreaLocationsModal from '@/components/tcm/DrawnAreaLocationsModal';
const generateDayDescription = makeGenerateDayDescription({ RISK_TYPES, scoreToLevel });


/* ═══════════════════════════════════════════════════════════════════════════
   PDF EXPORT
═══════════════════════════════════════════════════════════════════════════ */
// ── Tile-stitch map capture ───────────────────────────────────────────────────
// Fetches Esri dark/light tiles directly and stitches them onto a canvas.
// No html2canvas dependency — fast, reliable, no CORS taint issues.
function _lonToTileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function _latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
function _tileXToLon(x, z)  { return x / Math.pow(2, z) * 360 - 180; }
function _tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Project lat/lon onto the stitched canvas (Mercator)
function _makeTileProjector(bbox, canvasW, canvasH, z, tileSize) {
  const x0 = _lonToTileX(bbox.lonMin, z) * tileSize;
  const y0 = _latToTileY(bbox.latMax, z) * tileSize; // top-left tile row
  const totalPx = Math.pow(2, z) * tileSize;
  return {
    project(lat, lon) {
      const mx = ((lon + 180) / 360) * totalPx - x0;
      const sinLat = Math.sin(lat * Math.PI / 180);
      const my = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * totalPx - y0;
      return [mx, my];
    },
    size: { x: canvasW, y: canvasH },
  };
}

async function captureMapImage(captureRef, bbox, lightMode, mapStyle) {
  try {
  // ── Choose zoom level so the bbox fits nicely in ~900×680 logical pixels ──
  const TARGET_W = 900;
  const TILE_SIZE = 256;
  const lonSpan = bbox.lonMax - bbox.lonMin;

  // Find the zoom where the tile grid spans roughly TARGET_W px
  let z = 5;
  for (let tz = 3; tz <= 8; tz++) {
    const tiles = Math.pow(2, tz);
    const pxPerDeg = (tiles * TILE_SIZE) / 360;
    if (pxPerDeg * lonSpan >= TARGET_W * 0.8) { z = tz; break; }
  }

  const txMin = _lonToTileX(bbox.lonMin, z);
  const txMax = _lonToTileX(bbox.lonMax, z);
  const tyMin = _latToTileY(bbox.latMax, z); // latMax → top
  const tyMax = _latToTileY(bbox.latMin, z); // latMin → bottom

  const colCount = txMax - txMin + 1;
  const rowCount = tyMax - tyMin + 1;
  const stitchW  = colCount * TILE_SIZE;
  const stitchH  = rowCount * TILE_SIZE;

  // Clip to bbox in pixel space
  const topLeftLon = _tileXToLon(txMin, z);
  const topLeftLat = _tileYToLat(tyMin, z);
  const botRightLon = _tileXToLon(txMax + 1, z);
  const botRightLat = _tileYToLat(tyMax + 1, z);

  const cropX = Math.round(((bbox.lonMin - topLeftLon) / (botRightLon - topLeftLon)) * stitchW);
  const cropY = Math.round(((topLeftLat - bbox.latMax) / (topLeftLat - botRightLat)) * stitchH);
  const cropW = Math.round(((bbox.lonMax - bbox.lonMin) / (botRightLon - topLeftLon)) * stitchW);
  const cropH = Math.round(((bbox.latMax - bbox.latMin) / (topLeftLat - botRightLat)) * stitchH);

  // ── VECTOR 'counties' basemap export: white paper + black county outlines ──
  // No tiles are fetched; we draw the UK_IRELAND_COUNTIES polygons directly onto
  // the cropped canvas using the same Web-Mercator math as the tile path, so the
  // exported PNG matches the on-screen white county map exactly.
  if (mapStyle === 'counties') {
    const cw = Math.max(1, cropW), chh = Math.max(1, cropH);
    const cnv = document.createElement('canvas');
    cnv.width = cw; cnv.height = chh;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, chh);
    // Pixel projector for the CROPPED canvas: map lon/lat → [0..cw, 0..chh].
    const proj = (lat, lon) => {
      const x = ((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin)) * cw;
      const sinLat = Math.sin(lat * Math.PI / 180);
      const myTop = 0.5 - Math.log((1 + Math.sin(bbox.latMax * Math.PI / 180)) / (1 - Math.sin(bbox.latMax * Math.PI / 180))) / (4 * Math.PI);
      const myBot = 0.5 - Math.log((1 + Math.sin(bbox.latMin * Math.PI / 180)) / (1 - Math.sin(bbox.latMin * Math.PI / 180))) / (4 * Math.PI);
      const my = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
      const y = ((my - myTop) / (myBot - myTop)) * chh;
      return [x, y];
    };
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const drawRing = (ring) => {
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        const [px, py] = proj(lat, lon);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    };
    for (const f of (UK_IRELAND_COUNTIES?.features || [])) {
      const g = f.geometry; if (!g) continue;
      if (g.type === 'Polygon') {
        for (const ring of g.coordinates) drawRing(ring);
      } else if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) for (const ring of poly) drawRing(ring);
      }
    }
    return cnv.toDataURL('image/png', 1.0);
  }

  // ── Fetch all tiles in parallel via fetch() to avoid canvas taint ──────────
  const tileStyle = lightMode ? 'Canvas/World_Light_Gray_Base' : 'Canvas/World_Dark_Gray_Base';

  async function fetchTileImg(tx, ty) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/${tileStyle}/MapServer/tile/${z}/${ty}/${tx}`;
    try {
      const resp = await fetch(url, { mode: 'cors', cache: 'force-cache' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const img = await new Promise((res) => {
        const i = new window.Image();
        i.onload  = () => { URL.revokeObjectURL(blobUrl); res(i); };
        i.onerror = () => { URL.revokeObjectURL(blobUrl); res(null); };
        i.src = blobUrl;
      });
      return img;
    } catch { return null; }
  }

  const tilePromises = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      tilePromises.push(fetchTileImg(tx, ty).then(img => ({ tx, ty, img })));
    }
  }

  const tiles = await Promise.all(tilePromises);

  // ── Stitch tiles onto canvas, then crop to bbox ──────────────────────────
  const stitchCanvas = document.createElement('canvas');
  stitchCanvas.width  = stitchW;
  stitchCanvas.height = stitchH;
  const sc = stitchCanvas.getContext('2d');

  // Fill background in case any tiles failed
  sc.fillStyle = lightMode ? '#e8e0d8' : '#0a0e1a';
  sc.fillRect(0, 0, stitchW, stitchH);

  for (const { tx, ty, img } of tiles) {
    if (!img) continue;
    sc.drawImage(img, (tx - txMin) * TILE_SIZE, (ty - tyMin) * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }

  // Crop canvas to bbox
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width  = Math.max(1, cropW);
  cropCanvas.height = Math.max(1, cropH);
  const cc = cropCanvas.getContext('2d');
  cc.drawImage(stitchCanvas,
    Math.max(0, cropX), Math.max(0, cropY),
    Math.min(cropW, stitchW), Math.min(cropH, stitchH),
    0, 0, cropCanvas.width, cropCanvas.height
  );

  return cropCanvas.toDataURL('image/png', 1.0);
  } catch (err) {
    console.warn('[captureMapImage] failed:', err?.message);
    return '';
  }
}
import { exportToPDF as _exportToPDFImpl } from '@/lib/exportTCMPdf';
function exportToPDF(params) {
  return _exportToPDFImpl(params, {
    RISK_TYPES, RISK_META, RISK_INDEX, getPalette, scoreToLevel,
    fmtRun, fmtRange, generateDayDescription, REGIONS,
    RISK_DESCRIPTIONS_PER_RISK, INLINE_LOGO,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════════════════════════════ */
// THEME_TOKENS, TCMThemeContext and useTCMTheme are re-exported from the shared
// TCMThemeContext.jsx so that child components (DiurnalTimingSection etc.) that
// import from that file receive the same context instance as this provider.
import {
  TCMThemeContext,
  useTCMTheme,
  THEME_TOKENS,
} from '@/components/tcm/TCMThemeContext';
function TCMThemeProvider({ children }) {
  // Light mode is the site's default look. The key is versioned (v2) so any
  // browser that had toggled dark under the old key resets to light once.
  const [lightMode, setLightMode] = useState(() => {try {const s=localStorage.getItem('tcm_light_mode_v2');return s!==null?s==='true':true;}catch{return true;}});
  useEffect(()=>{try{localStorage.setItem('tcm_light_mode_v2',String(lightMode));}catch{}},[lightMode]);
  const value = useMemo(() => ({ lightMode, toggle: () => setLightMode((m) => !m), t: lightMode ? THEME_TOKENS.light : THEME_TOKENS.dark }), [lightMode]);
  return <TCMThemeContext.Provider value={value}>{children}</TCMThemeContext.Provider>;
}

const INLINE_LOGO = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/c5edb1383_IMG_73723.png';
const MYWEATHER_LOGO_URL = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/3d6c13097_IMG_7307.PNG';
const TCMLogoContext = createContext({ logoUrl: INLINE_LOGO, refresh: () => {} });
const useLogo = () => useContext(TCMLogoContext);
function TCMLogoProvider({ children }) {
  const [logoUrl, setLogoUrl] = useState(() => {try {return localStorage.getItem('tcm_logo_local_dataurl') || INLINE_LOGO;} catch {return INLINE_LOGO;}});
  const refresh = useCallback(() => {try {setLogoUrl(localStorage.getItem('tcm_logo_local_dataurl') || INLINE_LOGO);} catch {setLogoUrl(INLINE_LOGO);}}, []);
  return <TCMLogoContext.Provider value={useMemo(() => ({ logoUrl, refresh }), [logoUrl, refresh])}>{children}</TCMLogoContext.Provider>;
}


/* ═══════════════════════════════════════════════════════════════════════════
   UI PRIMITIVES
═══════════════════════════════════════════════════════════════════════════ */
const Card = ({ children, style, className = '' }) => {
  const { t } = useTCMTheme();
  return (
    <div className={`wp-glass-card ${className}`} style={{ position:'relative', background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 18, backdropFilter: 'blur(20px) saturate(1.3)', WebkitBackdropFilter: 'blur(20px) saturate(1.3)', boxShadow: t.cardShadow, overflow:'hidden', ...style }}>
      <div aria-hidden style={{ position:'absolute', top:0, left:0, right:0, height:1, background:t.cardHighlight, pointerEvents:'none', zIndex:1 }} />
      {children}
    </div>
  );
};


const Section = ({ title, icon: Icon, children, extra, accent = '#6366f1', noPadding = false }) => {
  const { t } = useTCMTheme();
  return (
    <Card style={{ padding:0, marginBottom:18 }}>
      <div style={{ position:'relative', display:'flex', alignItems:'center', gap:11, padding:'13px 18px', borderBottom:`1px solid ${t.cardBorder}`, borderLeft:`3px solid ${accent}`, flexWrap:'wrap', background:`linear-gradient(110deg,${accent}1f 0%, ${accent}0a 22%, transparent 60%)`, boxShadow:`inset 6px 0 14px -8px ${accent}` }}>
        {Icon && (
          <div style={{ width:30, height:30, borderRadius:9, background:`linear-gradient(135deg,${accent}30,${accent}12)`, border:`1px solid ${accent}45`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 2px 10px ${accent}33` }}>
            <Icon style={{ width:15, height:15, color:accent }} />
          </div>
        )}
        <h3 style={{ margin:0, fontSize:'0.9rem', fontWeight:800, letterSpacing:'-0.01em', color:t.textPrimary, fontFamily:"'DM Sans',system-ui,sans-serif" }}>{title}</h3>
        <div style={{ flex:1 }} />
        {extra}
      </div>
      <div style={{ padding: noPadding ? 0 : 16 }}>{children}</div>
    </Card>
  );
};

const TitleCard = React.memo(function TitleCard({ w, x = 10, y = 10, h = 50, title, sub }) {
  const { t } = useTCMTheme();
  const { logoUrl } = useLogo();
  const logoBox = h - 8;
  return (
    <g data-map-overlay="title-card">
      <rect x={x} y={y} width={w} height={h} fill={t.titleCardBg} stroke={t.titleCardBorder} strokeWidth={0.5} rx={8} />
      <text x={x + 12} y={y + 22} fontFamily="DM Sans,sans-serif" fontSize={13} fontWeight={800} fill={t.titleCardText} style={{ letterSpacing: '-0.01em' }}>{title}</text>
      <text x={x + 12} y={y + 40} fontFamily="DM Mono,monospace" fontSize={10} fill={t.titleCardSub}>{sub}</text>
      {logoUrl && <image href={logoUrl} x={x + w - logoBox - 6} y={y + 4} width={logoBox} height={logoBox} preserveAspectRatio="xMidYMid meet" />}
    </g>);

});

/* ═══════════════════════════════════════════════════════════════════════════
   LEGEND — SPC-style "RISK KEY" panel
   Bands map 1:1 onto the model's own thresholds:
     Very Low→TSTM 5 · Low→MRGL 12 · Marginal→SLGT 22
     Slight→ENH 35 · Moderate→MDT 50 · High→HIGH 65
   Colours still come from RISK_PALETTES so the key follows the active hazard.
═══════════════════════════════════════════════════════════════════════════ */

// Percentage band for each key row — derived from RISK_META so it can never
// drift from the scoring thresholds. The top band always runs to 100.
const LEGEND_BANDS = CONTOUR_LEVELS.map((lvl, i) => {
  const min  = RISK_META.find(r => r.level === lvl)?.min ?? 0;
  const next = CONTOUR_LEVELS[i + 1];
  const max  = next ? (RISK_META.find(r => r.level === next)?.min ?? 100) - 1 : 100;
  return { level: lvl, code: riskCode(lvl), min, max };
});

function OutlookLegend({ riskType, activeLevels, forceLight, showSevere }) {
  const activeArr = activeLevels instanceof Set ? [...activeLevels] : (activeLevels ?? []);
  const isMobile  = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <div
      data-map-overlay="legend"
      style={{
        position: 'absolute',
        bottom: isMobile ? 10 : 14,
        right:  isMobile ? 8  : 12,
        zIndex: 500,
        width: isMobile ? 148 : 172,
        padding: isMobile ? '9px 9px 10px' : '11px 11px 12px',
        borderRadius: 16,
        background: 'linear-gradient(160deg, rgba(20,28,52,0.94) 0%, rgba(11,17,36,0.96) 100%)',
        border: '1px solid rgba(120,150,220,0.28)',
        boxShadow: '0 10px 34px rgba(2,6,20,0.55), inset 0 1px 0 rgba(255,255,255,0.07)',
        backdropFilter: 'blur(14px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.2)',
        pointerEvents: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: isMobile ? '0.5rem' : '0.54rem',
          fontWeight: 800,
          letterSpacing: '0.26em',
          textTransform: 'uppercase',
          color: 'rgba(163,184,224,0.92)',
          fontFamily: "'DM Mono',monospace",
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        Risk Key
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {LEGEND_BANDS.map(({ level, code, min, max }) => {
          const pal    = getPalette(riskType, level);
          const active = activeArr.includes(level);
          return (
            <div
              key={level}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: active ? 1 : 0.42,
                transition: 'opacity .2s ease',
              }}
            >
              {/* Colour pill */}
              <span
                style={{
                  width: isMobile ? 34 : 40,
                  height: isMobile ? 12 : 13,
                  borderRadius: 99,
                  flexShrink: 0,
                  background: pal.border,
                  boxShadow: active
                    ? `0 0 8px ${pal.border}80, inset 0 1px 0 rgba(255,255,255,0.35)`
                    : 'inset 0 1px 0 rgba(255,255,255,0.20)',
                }}
              />
              {/* Code */}
              <span
                style={{
                  flex: 1,
                  fontSize: isMobile ? '0.6rem' : '0.66rem',
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  color: '#f1f5f9',
                  fontFamily: "'DM Sans',system-ui,sans-serif",
                }}
              >
                {code}
              </span>
              {/* Percentage band */}
              <span
                style={{
                  fontSize: isMobile ? '0.53rem' : '0.58rem',
                  fontWeight: 600,
                  color: 'rgba(148,170,210,0.90)',
                  fontFamily: "'DM Mono',monospace",
                  whiteSpace: 'nowrap',
                }}
              >
                {min}-{max}%
              </span>
            </div>
          );
        })}

        {/* Severe thunderstorm hatching — overlay band, sits outside the % scale */}
        {showSevere && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 3,
              paddingTop: 6,
              borderTop: '1px solid rgba(120,150,220,0.20)',
            }}
          >
            <span
              style={{
                width: isMobile ? 34 : 40,
                height: isMobile ? 12 : 13,
                borderRadius: 99,
                flexShrink: 0,
                background:
                  'repeating-linear-gradient(45deg, rgba(0,0,0,0.92) 0px, rgba(0,0,0,0.92) 2px, rgba(226,232,240,0.85) 2px, rgba(226,232,240,0.85) 5px)',
                border: '1px solid rgba(0,0,0,0.75)',
              }}
            />
            <span
              style={{
                flex: 1,
                fontSize: isMobile ? '0.6rem' : '0.66rem',
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: '#f1f5f9',
                fontFamily: "'DM Sans',system-ui,sans-serif",
              }}
            >
              SVR
            </span>
            <span
              style={{
                fontSize: isMobile ? '0.53rem' : '0.58rem',
                fontWeight: 600,
                color: 'rgba(148,170,210,0.90)',
                fontFamily: "'DM Mono',monospace",
                whiteSpace: 'nowrap',
              }}
            >
              hatch
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* TCM logo watermark — shown on map during PDF capture */
function TCMLogoWatermark() {
  const { logoUrl } = useLogo();
  return (
    <div data-map-overlay="logo-watermark" style={{ position: 'absolute', top: 12, right: 12, zIndex: 600, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(15,23,42,0.12)', boxShadow: '0 2px 8px rgba(15,23,42,0.10)' }}>
      {logoUrl && <img src={logoUrl} alt="TCM" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.14em', background: 'linear-gradient(135deg,#a78bfa,#38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>TCM</span>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: '0.5rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.12em', textTransform: 'uppercase' }}>MyWeatherUK</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   OUTLOOK MAP
═══════════════════════════════════════════════════════════════════════════ */
const OutlookMap = React.memo(function OutlookMap({ data, region, riskType, dayIdx, onClickPoint, onInspect, pin = null, enableSearch = false, enableLocate = false, enableFullscreen = false, captureRef, showLightning, strikeColour = 'age', strikeStroke = 'none', forceLight, overlayMode = 'none', variant = 'outlook', drawnOutlooks = [], hideAutoLayers = false }) {
  const { lightMode: originalLight } = useTCMTheme();
  const lightMode = forceLight || originalLight;
  const bbox = REGIONS[region]?.bbox;
  const grid = data?.grid ?? [];
  // Use the ACTUAL grid step from data so polygons cover all of Britain
  // (Scotland was being dropped when fetched grid was coarser than REGIONS step).
  const gridStep = useMemo(() => detectGridStep(grid, REGIONS[region]?.gridStep ?? 1.25), [grid, region]);

  // Pick the layer builder for this variant:
  //   'outlook' → buildOutlookLayers          (Outlook tab, broader — 2 blur passes)
  //   'hires'   → buildOutlookLayersConservative (High Resolution tab, crisper —
  //                                               1 blur pass, tighter minPolyArea)
  const layers = useMemo(() => {
    if (!grid.length) return [];
    const builder = variant === 'hires' ? buildOutlookLayersConservative : buildOutlookLayers;
    const built = builder(grid, riskType, dayIdx, gridStep, region);
    // Guarantee ascending paint order (lowest risk first) so higher categories
    // always render on top of lower ones regardless of builder output order.
    return built.slice().sort((a, b) => (RISK_INDEX[a.level] ?? 0) - (RISK_INDEX[b.level] ?? 0));
  }, [grid, riskType, dayIdx, region, gridStep, variant]);

  // Severe thunderstorm hatching — shown on top of any risk level where
  // sub-hazard scores indicate organised severe convection (hail, supercell,
  // tornado, damaging winds). Matches SOTUK "Significant" hatching.
  const severeOverlay = useMemo(() => {
    if (!grid.length) return [];
    return buildSevereThunderstormOverlay(grid, riskType, dayIdx, gridStep, region);
  }, [grid, riskType, dayIdx, region, gridStep]);

  // ── Overlay layers (HD-fill / HD-boxes) ─────────────────────────────────
  // When the user has stacked an HD risk surface on top of the SPC outlook,
  // we need the same scoring field used by the Probability map. These memos
  // only run when an overlay actually requires them.
  const overlayCells = useMemo(() => {
    if (overlayMode !== 'hd-boxes' || !grid.length) return [];
    return grid.filter((p) => {
      if (p.lat < bbox.latMin - 0.1 || p.lat > bbox.latMax + 0.1) return false;
      if (p.lon < bbox.lonMin - 0.1 || p.lon > bbox.lonMax + 0.1) return false;
      if (!inRegionBox(p.lat, p.lon, bbox)) return false;
      return true;
    }).map((p) => ({ lat: p.lat, lon: p.lon, score: getRiskScore(p, riskType, dayIdx), level: scoreToLevel(getRiskScore(p, riskType, dayIdx)) }));
  }, [overlayMode, grid, riskType, dayIdx, bbox]);

  const overlayFineCells = useMemo(() => {
    if (overlayMode !== 'hd-fill' || !grid.length) return null;
    // Match the Outlook/Probability pipeline: filter to scored points, use the
    // peak-preserving smoothed field, and apply the land mask at render time.
    const pad = 0.5;
    const scored = [];
    for (const p of grid) {
      if (p.lat < bbox.latMin - pad || p.lat > bbox.latMax + pad) continue;
      if (p.lon < bbox.lonMin - pad || p.lon > bbox.lonMax + pad) continue;
      const score = getRiskScore(p, riskType, dayIdx);
      if (score > 1) scored.push({ lat: p.lat, lon: p.lon, score });
    }
    if (!scored.length) return null;
    return buildSmoothedField(scored, bbox, gridStep, 2);
  }, [overlayMode, grid, riskType, dayIdx, bbox, gridStep]);

  const activeLevels = useMemo(() => {const s = new Set();for (const l of layers) s.add(l.level);return s;}, [layers]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const mapHeight = isMobile ? Math.min(320, window.innerHeight * 0.55) : Math.max(420, Math.min(720, window.innerHeight * 0.66));

  // Hover tooltip state
  const [hover, setHover] = useState(null);
  const dayLabel = dayIdx === 0 ? 'Today' : dayIdx === 1 ? 'Tomorrow' : `Day ${dayIdx + 1}`;
  const riskTypeLabel = RISK_TYPES.find(tt => tt.id === riskType)?.label ?? riskType;

  // Interaction is routed through Leaflet (see TCMLeafletBase) so the SVG
  // overlay stays pointer-events:none and never blocks pan/pinch. These two
  // handlers receive geographic coords + container pixels from the map.
  const handleHover = useCallback((info) => {
    if (!info) { setHover(null); return; }
    const { lat, lon, x, y } = info;
    let n = null, bd = gridStep * 1.6;
    for (const p of grid) { const d = Math.hypot(p.lat - lat, p.lon - lon); if (d < bd) { bd = d; n = p; } }
    if (!n) { setHover(null); return; }
    const score = getRiskScore(n, riskType, dayIdx);
    const lvl = scoreToLevel(score);
    const cs = n.perDay?.[dayIdx];
    setHover({ x, y, point: { lat: n.lat, lon: n.lon, score, level: lvl, palette: getPalette(riskType, lvl), summary: cs ? { thunderstorm: cs.scores?.thunderstorm ?? 0, lightning: cs.scores?.lightning ?? 0, sub: cs.scores?.sub ?? {}, ranges: cs.ranges ?? {} } : null } });
  }, [grid, gridStep, riskType, dayIdx]);
  const handleInspect = useCallback((info) => {
    const { lat, lon } = info;
    let n = null, bd = Infinity;
    for (const p of grid) { const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2; if (d < bd) { bd = d; n = p; } }
    const target = n ? { lat: n.lat, lon: n.lon } : { lat, lon };
    if (onInspect) onInspect(target);
    else onClickPoint?.([target.lat, target.lon]);
  }, [grid, onInspect, onClickPoint]);

  return (
    <div ref={captureRef} style={{ position:'relative' }} onMouseLeave={() => setHover(null)}>
      {forceLight && <TCMLogoWatermark />}
      <TCMLeafletBase bbox={bbox} height={mapHeight} lightMode={lightMode}
        onHover={handleHover} onInspect={handleInspect} pin={pin}
        enableSearch={enableSearch} enableLocate={enableLocate} enableFullscreen={enableFullscreen}>
        {({ projector }) => {
          if (!projector) return null;
          const { x: w, y: h } = projector.size;
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>
              <defs>
                <pattern id="severe-hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(0,0,0,0.75)" strokeWidth="3.5" />
                </pattern>
                <filter id="risk-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3.5" />
                </filter>
              </defs>

              {/* Optional HD overlay rendered UNDER the SPC polygons */}
              {!hideAutoLayers && overlayMode === 'hd-fill' && overlayFineCells && (() => {
                const { values, cols, rows, lat0, lon0, step } = overlayFineCells;
                const [px0, py0] = projector.project(lat0, lon0);
                const [px1]      = projector.project(lat0,        lon0 + step);
                const [,    py1] = projector.project(lat0 + step, lon0);
                const cellPxW = Math.max(2, Math.abs(px1 - px0) * 1.12);
                const cellPxH = Math.max(2, Math.abs(py1 - py0) * 1.12);
                const rects = [];
                for (let r = 0; r < rows; r++) {
                  const lat = lat0 + r * step;
                  for (let c = 0; c < cols; c++) {
                    const score = values[r * cols + c];
                    if (score < 5) continue;
                    const lon = lon0 + c * step;
                    if (!inRegionBox(lat, lon, bbox)) continue;
                    const [cx, cy] = projector.project(lat, lon);
                    const lvl = scoreToLevel(score);
                    if (lvl === 'No Risk') continue;
                    const pal = getPalette(riskType, lvl);
                    rects.push(
                      <rect key={`ovr-hd-${r}-${c}`}
                        x={Math.floor(cx - cellPxW / 2)} y={Math.floor(cy - cellPxH / 2)}
                        width={Math.ceil(cellPxW)} height={Math.ceil(cellPxH)}
                        fill={pal.fill} opacity={(LEVEL_OPACITY[lvl] ?? 0.75) * 0.55}
                        pointerEvents="none" />
                    );
                  }
                }
                return rects;
              })()}
              {!hideAutoLayers && overlayMode === 'hd-boxes' && overlayCells.length > 0 && (() => {
                const refLat = overlayCells[0]?.lat ?? 55;
                const refLon = overlayCells[0]?.lon ?? -3;
                const [rx0, ry0] = projector.project(refLat, refLon);
                const [rx1]      = projector.project(refLat, refLon + gridStep);
                const [, ry1]    = projector.project(refLat + gridStep, refLon);
                const cellW = Math.max(6, Math.abs(rx1 - rx0) * 1.15);
                const cellH = Math.max(6, Math.abs(ry1 - ry0) * 1.15);
                return overlayCells.map((cc, i) => {
                  const [cx, cy] = projector.project(cc.lat, cc.lon);
                  const pal = getPalette(riskType, cc.level);
                  if (cc.level === 'No Risk') return null;
                  return (
                    <rect key={`ovr-box-${i}`}
                      x={Math.floor(cx - cellW / 2)} y={Math.floor(cy - cellH / 2)}
                      width={Math.ceil(cellW)} height={Math.ceil(cellH)}
                      fill={pal.fill} opacity={(LEVEL_OPACITY[cc.level] ?? 0.75) * 0.55}
                      pointerEvents="none" />
                  );
                });
              })()}

              {/* Outer soft glow behind every risk layer */}
              {!hideAutoLayers && layers.map((layer) => {
                const items = (layer.polygons?.length ? layer.polygons : [])
                  .map((ring) => ringToSvgPath(ring, projector));
                const pal = getPalette(riskType, layer.level);
                return items.map((d, ci) => {
                  if (!d) return null;
                  return (
                    <path key={`glow-${riskType}-${dayIdx}-${layer.level}-${ci}`}
                      d={d} fill={pal.border} stroke="none"
                      opacity={0.18} filter="url(#risk-glow)" pointerEvents="none" />
                  );
                });
              })}

              {/* Main fill pass — lowest to highest so higher fills paint over lower. */}
              {!hideAutoLayers && layers.map((layer) => {
                const pal = getPalette(riskType, layer.level);
                const items = (layer.polygons?.length ? layer.polygons : [])
                  .map((ring) => ringToSvgPath(ring, projector));
                return items.map((d, ci) => {
                  if (!d) return null;
                  return (
                    <path key={`poly-${riskType}-${dayIdx}-${layer.level}-${ci}`}
                      d={d} fill={pal.fill} stroke={pal.border}
                      strokeWidth={layer.level === 'Very Low' ? 1.5 : 1.8}
                      strokeLinejoin="round" strokeLinecap="round"
                      opacity={LEVEL_OPACITY[layer.level] ?? 0.7} />
                  );
                });
              })}

              {/* Severe Thunderstorm overlay — SOTUK-style black hatching.
                  Drawn on TOP of the filled risk areas to indicate where organised
                  severe convection (supercells, large hail, damaging winds) is
                  expected, regardless of the overall risk band colour. */}
              {!hideAutoLayers && severeOverlay.map((layer) => {
                const items = (layer.polygons?.length ? layer.polygons : [])
                  .map((ring) => ringToSvgPath(ring, projector));
                return items.map((d, ci) => {
                  if (!d) return null;
                  return (
                    <path key={`sev-hatch-${ci}`}
                      d={d}
                      fill="url(#severe-hatch)"
                      stroke="rgba(0,0,0,0.85)"
                      strokeWidth={2.2}
                      strokeLinejoin="round"
                      opacity={0.82}
                      pointerEvents="none" />
                  );
                });
              })}

              {/* Labels for Moderate and above */}
              {!hideAutoLayers && layers.filter((l) => RISK_INDEX[l.level] >= RISK_INDEX['Moderate']).map((layer) => {
                const rings = layer.polygons?.length ? layer.polygons : [];
                return rings.map((ring, ci) => {
                  if (ring.length < 3) return null;
                  const projected = ring.map(([lon, lat]) => projector.project(lat, lon));
                  const cx = projected.reduce((s, p) => s + p[0], 0) / projected.length;
                  const cy = projected.reduce((s, p) => s + p[1], 0) / projected.length;
                  const lbl = RISK_META.find((r) => r.level === layer.level)?.short;
                  if (!lbl) return null;
                  return (
                    <g key={`lbl-${layer.level}-${ci}`}>
                      <text x={cx + 0.8} y={cy + 1.8} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={900} fontFamily="DM Mono,monospace" fill="rgba(0,0,0,0.70)" letterSpacing="0.10em">{lbl}</text>
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={900} fontFamily="DM Mono,monospace" fill="rgba(255,255,255,0.96)" letterSpacing="0.10em">{lbl}</text>
                    </g>
                  );
                });
              })}

              {layers.length === 0 && grid.length === 0 &&
              <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={13} fontWeight={600} fill={lightMode ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.28)'} fontFamily="DM Sans">Loading forecast…</text>
              }

              {forceLight && <TitleCard w={Math.max(180, Math.min(360, w - 250))} x={10} y={10}
              title={`${RISK_TYPES.find((tt) => tt.id === riskType)?.label} Risk`}
              sub={`${(REGIONS[region] ?? {}).label ?? region} · Day ${dayIdx + 1}`} />}
              {/* Admin drawn outlooks — ONLY rendered in admin-outlook mode (hideAutoLayers=true).
                  In Outlook/HiRes/Animated modes drawnOutlooks are intentionally suppressed so
                  admin artwork never bleeds over the auto-generated polygons. */}
              {hideAutoLayers && drawnOutlooks.map((outlook, oi) =>
                (outlook?.shapes || []).map((shape, si) => {
                  if (!shape.latLngs?.length) return null;
                  const projected = shape.latLngs.map(([lat, lon]) => projector.project(lat, lon));
                  const d = smoothSvgPath(projected.map(p => ({ x: p[0], y: p[1] })));
                  const isSevere = shape.riskLevel === 'Severe';
                  return (
                    <path key={`do-${oi}-${si}`} d={d}
                      fill={isSevere ? 'url(#severe-hatch)' : (shape.color || 'rgba(245,158,11,0.35)')}
                      stroke={isSevere ? 'rgba(0,0,0,0.85)' : (shape.border || '#f59e0b')}
                      strokeWidth={isSevere ? 2.2 : 2.5} strokeLinejoin="round" strokeLinecap="round"
                      opacity={isSevere ? 0.82 : 0.88} pointerEvents="none" />
                  );
                })
              )}
              {/* Lightning overlay — rendered LAST so it sits above all risk polygons and admin outlooks */}
              {showLightning && <LightningOverlay projector={projector} bbox={bbox} containerW={w} containerH={h} strikeColour={strikeColour} strikeStroke={strikeStroke} />}
            </svg>);

        }}
      </TCMLeafletBase>
      <OutlookLegend riskType={riskType} activeLevels={activeLevels} forceLight={forceLight} showSevere={severeOverlay.length > 0} />
      {hover && !forceLight && (
        <MapHoverTooltip
          x={hover.x} y={hover.y}
          containerW={typeof window !== 'undefined' ? window.innerWidth - 40 : 1000}
          containerH={mapHeight}
          point={hover.point}
          riskTypeLabel={riskTypeLabel}
          dayLabel={dayLabel}
          lightMode={lightMode} />
      )}
    </div>);

});

/* ═══════════════════════════════════════════════════════════════════════════
   PROBABILITY MAP
═══════════════════════════════════════════════════════════════════════════ */
const ProbabilityMap = React.memo(function ProbabilityMap({ data, region, riskType, dayIdx, onClickPoint, onInspect, pin = null, enableSearch = false, enableLocate = false, enableFullscreen = false, captureRef, showLightning, strikeColour = 'age', strikeStroke = 'none', forceLight, overlayMode = 'none', drawnOutlooks = [] }) {

  const { lightMode: originalLight } = useTCMTheme();
  const lightMode = forceLight || originalLight;
  const bbox = REGIONS[region]?.bbox;
  const grid = data?.grid ?? [];
  const gridStep = useMemo(() => detectGridStep(grid, REGIONS[region]?.gridStep ?? 1.25), [grid, region]);

  // Outlook polygons used as an overlay (SPC nested rings on top of the
  // probability surface). Only computed when actually requested. We use
  // the broader Outlook builder so this overlay matches what the Outlook
  // tab renders — i.e. the looser, watch-zone envelope, not the focused
  // High-Resolution version.
  const overlayLayers = useMemo(() => {
    if (overlayMode !== 'outlook' || !grid.length) return [];
    return buildOutlookLayers(grid, riskType, dayIdx, gridStep, region)
      .slice().sort((a, b) => (RISK_INDEX[a.level] ?? 0) - (RISK_INDEX[b.level] ?? 0));
  }, [overlayMode, grid, riskType, dayIdx, gridStep, region]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const mapHeight = isMobile ? Math.min(320, window.innerHeight * 0.55) : Math.max(420, Math.min(720, window.innerHeight * 0.66));

  // ── Native (forecast) grid points, for click-to-snap & legend levels ────
  const cells = useMemo(() => {
    if (!grid.length) return [];
    return grid.filter((p) => {
      if (p.lat < bbox.latMin - 0.1 || p.lat > bbox.latMax + 0.1) return false;
      if (p.lon < bbox.lonMin - 0.1 || p.lon > bbox.lonMax + 0.1) return false;
      if (!inRegionBox(p.lat, p.lon, bbox)) return false;
      return true;
    }).map((p) => ({ lat: p.lat, lon: p.lon, score: getRiskScore(p, riskType, dayIdx), level: scoreToLevel(getRiskScore(p, riskType, dayIdx)) }));
  }, [grid, riskType, dayIdx, bbox, region]);

  // ── Interpolated fine grid (same engine used by the Outlook contour) ────
  // Renders a smooth probability surface that matches the outlook polygons.
  // IMPORTANT: pass null as maskFn to buildFineGrid — passing isInUKIreland
  // zeros all offshore fine-grid cells before IDW runs, causing coastal land
  // cells (e.g. Northern Ireland, Celtic Sea coasts) to be diluted to near-
  // zero because their IDW neighbourhood is full of zeroed offshore cells.
  // The isInUKIreland check is done at render time (see the skip below)
  // which clips the display without corrupting the interpolated field.
  // Also use a coastal pad (+0.5°) so source points near the coast are
  // included in the IDW, preventing edge dropout at land/sea boundaries.
  const fineCells = useMemo(() => {
    if (!grid.length) return null;
    const pad = 0.5;
    const scored = [];
    for (const p of grid) {
      if (p.lat < bbox.latMin - pad || p.lat > bbox.latMax + pad) continue;
      if (p.lon < bbox.lonMin - pad || p.lon > bbox.lonMax + pad) continue;
      const score = getRiskScore(p, riskType, dayIdx);
      if (score > 1) scored.push({ lat: p.lat, lon: p.lon, score });
    }
    if (!scored.length) return null;
    return buildSmoothedField(scored, bbox, gridStep, 2);
  }, [grid, riskType, dayIdx, bbox, gridStep]);

  const activeLevels = useMemo(() => {const s = new Set();for (const c of cells) s.add(c.level);return s;}, [cells]);

  // Click/tap → nearest grid point → drop pin (or legacy detail panel).
  const handleInspect = useCallback((info) => {
    const { lat, lon } = info;
    let n = null, bd = Infinity;
    for (const p of grid) { const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2; if (d < bd) { bd = d; n = p; } }
    const target = n ? { lat: n.lat, lon: n.lon } : { lat, lon };
    if (onInspect) onInspect(target);
    else onClickPoint?.([target.lat, target.lon]);
  }, [grid, onInspect, onClickPoint]);

  return (
    <div ref={captureRef} style={{ position:'relative' }}>
      {forceLight && <TCMLogoWatermark />}
      <TCMLeafletBase bbox={bbox} height={mapHeight} lightMode={lightMode}
        onInspect={handleInspect} pin={pin}
        enableSearch={enableSearch} enableLocate={enableLocate} enableFullscreen={enableFullscreen}>
        {({ projector }) => {
          if (!projector) return null;
          const { x: w, y: h } = projector.size;

          // If we have an interpolated fine grid, render that (smooth surface).
          // Otherwise fall back to the native grid rect tiling.
          if (fineCells) {
            const { values, cols, rows, lat0, lon0, step } = fineCells;
            const [px0, py0] = projector.project(lat0, lon0);
            const [px1]      = projector.project(lat0,        lon0 + step);
            const [,    py1] = projector.project(lat0 + step, lon0);
            const cellPxW = Math.max(3, Math.abs(px1 - px0) * 1.30);
            const cellPxH = Math.max(3, Math.abs(py1 - py0) * 1.30);

            return (
              <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>
                <defs>
                  <pattern id="prob-severe-hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(0,0,0,0.75)" strokeWidth="3.5" />
                  </pattern>
                </defs>
                {(() => {
                  const rects = [];
                  for (let r = 0; r < rows; r++) {
                    const lat = lat0 + r * step;
                    for (let c = 0; c < cols; c++) {
                      const score = values[r * cols + c];
                      if (score < 5) continue; // skip empty cells
                      const lon = lon0 + c * step;
                      if (!inRegionBox(lat, lon, bbox)) continue;
                      const [cx, cy] = projector.project(lat, lon);
                      const lvl = scoreToLevel(score);
                      const pal = getPalette(riskType, lvl);
                      if (lvl === 'No Risk') continue;
                      rects.push(
                        <rect key={`${r}-${c}`}
                          x={Math.floor(cx - cellPxW / 2)} y={Math.floor(cy - cellPxH / 2)}
                          width={Math.ceil(cellPxW)} height={Math.ceil(cellPxH)}
                          fill={pal.fill}
                          opacity={(LEVEL_OPACITY[lvl] ?? 0.75) * 0.95} />
                      );
                    }
                  }
                  return rects;
                })()}
                {/* Optional overlay drawn on top of the probability surface. */}
                {overlayMode === 'outlook' && overlayLayers.map((layer, li) => {
                  const items = layer.polygons
                    ? layer.polygons.map((ring) => ringToSvgPath(ring, projector))
                    : [];
                  const pal = getPalette(riskType, layer.level);
                  return items.map((d, ci) => d ? (
                    <path key={`po-ovr-${li}-${ci}`} d={d}
                      fill="none" stroke={pal.border} strokeWidth={2}
                      strokeLinejoin="round" strokeDasharray="none"
                      opacity={(LEVEL_OPACITY[layer.level] ?? 0.7) * 0.9}
                      pointerEvents="none" />
                  ) : null);
                })}
                {overlayMode === 'hd-boxes' && (() => {
                  const cls = cells;
                  if (!cls.length) return null;
                  const refLat = cls[0]?.lat ?? 55;
                  const refLon = cls[0]?.lon ?? -3;
                  const [rx0, ry0] = projector.project(refLat, refLon);
                  const [rx1]      = projector.project(refLat, refLon + gridStep);
                  const [, ry1]    = projector.project(refLat + gridStep, refLon);
                  const cellW = Math.max(6, Math.abs(rx1 - rx0) * 1.15);
                  const cellH = Math.max(6, Math.abs(ry1 - ry0) * 1.15);
                  return cls.map((cc, i) => {
                    if (cc.level === 'No Risk') return null;
                    const [cx, cy] = projector.project(cc.lat, cc.lon);
                    const pal = getPalette(riskType, cc.level);
                    return (
                      <rect key={`po-box-ovr-${i}`}
                        x={Math.floor(cx - cellW / 2)} y={Math.floor(cy - cellH / 2)}
                        width={Math.ceil(cellW)} height={Math.ceil(cellH)}
                        fill="none" stroke={pal.border} strokeWidth={1.4}
                        opacity={(LEVEL_OPACITY[cc.level] ?? 0.75) * 0.85}
                        pointerEvents="none" />
                    );
                  });
                })()}
                {/* Admin drawn outlooks overlay */}
                {overlayMode === 'admin-outlook' && drawnOutlooks.map((outlook, oi) =>
                  (outlook?.shapes || []).map((shape, si) => {
                    if (!shape.latLngs?.length) return null;
                    const projected = shape.latLngs.map(([lat, lon]) => projector.project(lat, lon));
                    const d = smoothSvgPath(projected.map(p => ({ x: p[0], y: p[1] })));
                    const isSevere = shape.riskLevel === 'Severe';
                    return (
                      <path key={`prob-do-${oi}-${si}`} d={d}
                        fill={isSevere ? 'url(#prob-severe-hatch)' : (shape.color || 'rgba(245,158,11,0.35)')}
                        stroke={isSevere ? 'rgba(0,0,0,0.85)' : (shape.border || '#f59e0b')}
                        strokeWidth={isSevere ? 2.2 : 2.5} strokeLinejoin="round" strokeLinecap="round"
                        opacity={isSevere ? 0.82 : 0.88} pointerEvents="none" />
                    );
                  })
                )}
                {forceLight && <TitleCard w={Math.max(180, Math.min(340, w - 250))} x={10} y={10}
                  title={`${RISK_TYPES.find((tt) => tt.id === riskType)?.label} Risk`}
                  sub={`${(REGIONS[region] ?? {}).label ?? region} · Day ${dayIdx + 1} · Probability`} />}
                {showLightning && <LightningOverlay projector={projector} bbox={bbox} containerW={w} containerH={h} strikeColour={strikeColour} strikeStroke={strikeStroke} />}
                {(() => {
                  // Clean rectangular frame around the UK & Ireland data region.
                  const B = bbox || UK_IE_DATA_BOX;
                  const [bx0, by0] = projector.project(B.latMax, B.lonMin);
                  const [bx1, by1] = projector.project(B.latMin, B.lonMax);
                  return <rect x={Math.min(bx0, bx1)} y={Math.min(by0, by1)}
                    width={Math.abs(bx1 - bx0)} height={Math.abs(by1 - by0)} rx={12} ry={12}
                    fill="none" stroke={lightMode ? 'rgba(51,65,85,0.55)' : 'rgba(125,211,252,0.5)'}
                    strokeWidth={2} strokeDasharray="6 5" pointerEvents="none" />;
                })()}
              </svg>
            );
          }

          // Fallback: legacy native-grid rect tiling
          const refLat = cells[0]?.lat ?? 55;
          const refLon = cells[0]?.lon ?? -3;
          const [rx0, ry0] = projector.project(refLat, refLon);
          const [rx1]      = projector.project(refLat, refLon + gridStep);
          const [, ry1]    = projector.project(refLat + gridStep, refLon);
          const cellW = Math.max(6, Math.abs(rx1 - rx0) * 1.15);
          const cellH = Math.max(6, Math.abs(ry1 - ry0) * 1.15);
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>
              <defs>
                <pattern id="prob-severe-hatch-fb" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(0,0,0,0.75)" strokeWidth="3.5" />
                </pattern>
              </defs>
              {cells.map((c, i) => {
                const [cx, cy] = projector.project(c.lat, c.lon);
                const pal = getPalette(riskType, c.level);
                const isNone = c.level === 'No Risk';
                const fill = isNone ? lightMode ? 'rgba(200,210,220,0.18)' : 'rgba(30,50,70,0.15)' : pal.fill;
                const opacity = isNone ? 0.2 : LEVEL_OPACITY[c.level] ?? 0.75;
                return (
                  <rect key={i}
                  x={Math.floor(cx - cellW / 2)} y={Math.floor(cy - cellH / 2)}
                  width={Math.ceil(cellW)} height={Math.ceil(cellH)}
                  rx={0} ry={0} fill={fill} opacity={opacity} />);


              })}
              {/* Optional overlay drawn on top of the box surface. */}
              {overlayMode === 'outlook' && overlayLayers.map((layer, li) => {
                const items = layer.polygons
                  ? layer.polygons.map((ring) => ringToSvgPath(ring, projector))
                  : [];
                const pal = getPalette(riskType, layer.level);
                return items.map((d, ci) => d ? (
                  <path key={`po-box-base-ovr-${li}-${ci}`} d={d}
                    fill="none" stroke={pal.border} strokeWidth={2}
                    strokeLinejoin="round" strokeDasharray="none"
                    opacity={(LEVEL_OPACITY[layer.level] ?? 0.7) * 0.9}
                    pointerEvents="none" />
                ) : null);
              })}
              {/* Admin drawn outlooks overlay */}
              {overlayMode === 'admin-outlook' && drawnOutlooks.map((outlook, oi) =>
                (outlook?.shapes || []).map((shape, si) => {
                  if (!shape.latLngs?.length) return null;
                  const projected = shape.latLngs.map(([lat, lon]) => projector.project(lat, lon));
                  const d = smoothSvgPath(projected.map(p => ({ x: p[0], y: p[1] })));
                  const isSevere = shape.riskLevel === 'Severe';
                  return (
                    <path key={`prob-fb-do-${oi}-${si}`} d={d}
                      fill={isSevere ? 'url(#prob-severe-hatch-fb)' : (shape.color || 'rgba(245,158,11,0.35)')}
                      stroke={isSevere ? 'rgba(0,0,0,0.85)' : (shape.border || '#f59e0b')}
                      strokeWidth={isSevere ? 2.2 : 2.5} strokeLinejoin="round" strokeLinecap="round"
                      opacity={isSevere ? 0.82 : 0.88} pointerEvents="none" />
                  );
                })
              )}
              {forceLight && <TitleCard w={Math.max(180, Math.min(340, w - 250))} x={10} y={10}
              title={`${RISK_TYPES.find((tt) => tt.id === riskType)?.label} Risk`}
              sub={`${(REGIONS[region] ?? {}).label ?? region} · Day ${dayIdx + 1} · Probability`} />}
              {showLightning && <LightningOverlay projector={projector} bbox={bbox} containerW={w} containerH={h} strikeColour={strikeColour} strikeStroke={strikeStroke} />}
            </svg>);

        }}
      </TCMLeafletBase>
      <OutlookLegend riskType={riskType} activeLevels={activeLevels} forceLight={forceLight} />
    </div>);

});

/* ═══════════════════════════════════════════════════════════════════════════
   TEMPERATURE MAP — daily max/min 2 m temperature (from the same TCM run)
═══════════════════════════════════════════════════════════════════════════ */
// Daily max/min temperature at a grid point (°C). Populated by openMeteoTCM
// during the normal run — no extra API request.
function getTemp(point, dayIdx, mode) {
  const t = point?.perDay?.[dayIdx]?.temp;
  if (!t) return null;
  const v = mode === 'min' ? t.min : t.max;
  return (v == null || !Number.isFinite(v)) ? null : v;
}
// Cold→hot colour ramp (°C). Stops span -10…50 °C — blue (cold) → green/yellow →
// red (hot) → magenta/pink (extreme, well above UK norms but kept for headroom).
const TEMP_STOPS = [
  { t: -10, c: '#312e81' }, { t: -5, c: '#1d4ed8' }, { t: 0, c: '#2563eb' },
  { t: 5,  c: '#0ea5e9' },  { t: 10, c: '#14b8a6' }, { t: 15, c: '#22c55e' },
  { t: 20, c: '#eab308' },  { t: 25, c: '#f97316' }, { t: 30, c: '#ef4444' },
  { t: 35, c: '#b91c1c' },  { t: 40, c: '#9f1239' }, { t: 45, c: '#be185d' }, { t: 50, c: '#ec4899' },
];
const TEMP_LO = -10, TEMP_HI = 50;

// 5-pointed star path (for the hottest / coldest marker).
function starPath(cx, cy, R, r, points = 5) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (Math.PI / points) * i - Math.PI / 2;
    d += (i === 0 ? 'M' : 'L') + (cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1);
  }
  return d + 'Z';
}
function _hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function _lerpHex(a, b, f) { const A = _hexRgb(a), B = _hexRgb(b); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * f)},${Math.round(A[1] + (B[1] - A[1]) * f)},${Math.round(A[2] + (B[2] - A[2]) * f)})`; }
// Numeric [r,g,b] version of the ramp — for per-pixel canvas rasterisation.
const _STOP_RGB = TEMP_STOPS.map(s => ({ t: s.t, rgb: _hexRgb(s.c) }));
function tempColorRGB(v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= _STOP_RGB[0].t) return _STOP_RGB[0].rgb;
  const last = _STOP_RGB[_STOP_RGB.length - 1];
  if (v >= last.t) return last.rgb;
  for (let i = 0; i < _STOP_RGB.length - 1; i++) {
    const a = _STOP_RGB[i], b = _STOP_RGB[i + 1];
    if (v >= a.t && v <= b.t) {
      const f = (v - a.t) / (b.t - a.t);
      return [Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f), Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f), Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f)];
    }
  }
  return last.rgb;
}

// Major UK & Ireland places labelled on the temperature map.
const UK_CITIES = [
  { name: 'London', lat: 51.51, lon: -0.13 }, { name: 'Birmingham', lat: 52.48, lon: -1.90 },
  { name: 'Manchester', lat: 53.48, lon: -2.24 }, { name: 'Leeds', lat: 53.80, lon: -1.55 },
  { name: 'Glasgow', lat: 55.86, lon: -4.25 }, { name: 'Edinburgh', lat: 55.95, lon: -3.19 },
  { name: 'Liverpool', lat: 53.41, lon: -2.99 }, { name: 'Newcastle', lat: 54.98, lon: -1.61 },
  { name: 'Sheffield', lat: 53.38, lon: -1.47 }, { name: 'Bristol', lat: 51.45, lon: -2.59 },
  { name: 'Cardiff', lat: 51.48, lon: -3.18 }, { name: 'Belfast', lat: 54.60, lon: -5.93 },
  { name: 'Dublin', lat: 53.35, lon: -6.26 }, { name: 'Aberdeen', lat: 57.15, lon: -2.09 },
  { name: 'Inverness', lat: 57.48, lon: -4.22 }, { name: 'Norwich', lat: 52.63, lon: 1.30 },
  { name: 'Plymouth', lat: 50.38, lon: -4.14 }, { name: 'Nottingham', lat: 52.95, lon: -1.15 },
  { name: 'Southampton', lat: 50.90, lon: -1.40 }, { name: 'Hull', lat: 53.74, lon: -0.34 },
  { name: 'Cork', lat: 51.90, lon: -8.47 }, { name: 'Galway', lat: 53.27, lon: -9.05 },
];

function TempLegend({ mode }) {
  const grad = `linear-gradient(90deg, ${TEMP_STOPS.map(s => `${s.c} ${(((s.t - TEMP_LO) / (TEMP_HI - TEMP_LO)) * 100).toFixed(0)}%`).join(', ')})`;
  return (
    <div data-map-overlay="temp-legend" style={{ position: 'absolute', bottom: 12, right: 8, zIndex: 500, background: 'rgba(10,16,34,0.86)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 9px', backdropFilter: 'blur(8px)', width: 190 }}>
      <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontFamily: "'DM Mono',monospace" }}>{mode === 'min' ? 'Min' : 'Max'} temperature · °C</div>
      <div style={{ height: 9, borderRadius: 4, background: grad }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {[-10, 5, 20, 35, 50].map(t => <span key={t} style={{ fontSize: '0.52rem', color: '#94a3b8', fontFamily: "'DM Mono',monospace" }}>{t}°</span>)}
      </div>
    </div>
  );
}

const TemperatureMap = React.memo(function TemperatureMap({ data, region, dayIdx, tempMode = 'max', onClickPoint, onInspect, pin = null, enableSearch = false, enableLocate = false, enableFullscreen = false, captureRef, showLocations = true, showGrid = false, showExtreme = false }) {
  const { lightMode } = useTCMTheme();
  const bbox = REGIONS[region]?.bbox;
  const grid = data?.grid ?? [];
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const mapHeight = isMobile ? Math.min(320, window.innerHeight * 0.55) : Math.max(420, Math.min(720, window.innerHeight * 0.66));

  // Interpolation source points — the Met Office (UKMO) temperature is baked onto
  // every TCM grid cell at run time (assignMetOfficeTemps in openMeteoTCM.js), so
  // we read it straight off the grid. No per-visitor fetch.
  const pts = useMemo(() => {
    const out = [];
    if (grid.length && bbox) for (const p of grid) {
      if (p.lat < bbox.latMin - 0.7 || p.lat > bbox.latMax + 0.7) continue;
      if (p.lon < bbox.lonMin - 0.7 || p.lon > bbox.lonMax + 0.7) continue;
      const t = getTemp(p, dayIdx, tempMode);
      if (t != null) out.push({ lat: p.lat, lon: p.lon, t });
    }
    return out;
  }, [grid, dayIdx, tempMode, bbox]);

  // Crisp, wxcharts-style raster — ZERO blur. Two passes:
  //  (1) inverse-distance interpolation at LOW resolution, temperature ENCODED as
  //      a grey value (cheap — the field itself is smooth);
  //  (2) that field is bilinearly upscaled onto a HIGH-resolution canvas and every
  //      pixel is snapped to a discrete colour BAND, so the boundaries between
  //      bands are sharp curves (a filled-contour chart) instead of a soft blur.
  // Finally it is clipped to the real coastline with a thin coast drawn on top.
  // Recomputed only when the data changes — not on pan/zoom.
  const raster = useMemo(() => {
    if (typeof document === 'undefined' || !bbox || pts.length < 3) return null;
    const rad = Math.PI / 180;
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));
    const yTop = mercY(bbox.latMax), yBot = mercY(bbox.latMin);
    const lonMin = bbox.lonMin, lonSpan = bbox.lonMax - bbox.lonMin;
    const aspect = (yTop - yBot) / (lonSpan * rad);
    const T0 = -20, SPAN = 70; // encode temperature (-20…50 °C) → 0–255 grey
    // ── Pass 1: low-res interpolation, temperature encoded as grey ────────────
    const loW = 200, loH = Math.max(120, Math.min(520, Math.round(loW * aspect)));
    const src = pts.length > 360 ? pts.filter((_, i) => i % Math.ceil(pts.length / 360) === 0) : pts;
    const N = src.length;
    const PLat = new Float64Array(N), PLon = new Float64Array(N), PT = new Float64Array(N);
    for (let i = 0; i < N; i++) { PLat[i] = src[i].lat; PLon[i] = src[i].lon; PT[i] = src[i].t; }
    const lonK = Math.cos(((bbox.latMin + bbox.latMax) / 2) * rad);
    const smooth2 = 0.06;
    let loC; try { loC = document.createElement('canvas'); } catch { return null; }
    loC.width = loW; loC.height = loH;
    const loCtx = loC.getContext('2d'); if (!loCtx) return null;
    const loImg = loCtx.createImageData(loW, loH), lod = loImg.data;
    for (let py = 0; py < loH; py++) {
      const mY = yTop - ((py + 0.5) / loH) * (yTop - yBot);
      const lat = (2 * Math.atan(Math.exp(mY)) - Math.PI / 2) / rad;
      for (let px = 0; px < loW; px++) {
        const lon = lonMin + ((px + 0.5) / loW) * lonSpan;
        let sw = 0, sv = 0;
        for (let i = 0; i < N; i++) {
          const dlat = PLat[i] - lat, dlon = (PLon[i] - lon) * lonK;
          const w = 1 / (dlat * dlat + dlon * dlon + smooth2);
          sw += w; sv += w * PT[i];
        }
        const enc = Math.max(0, Math.min(255, Math.round((((sv / sw) - T0) / SPAN) * 255)));
        const k = (py * loW + px) * 4; lod[k] = lod[k + 1] = lod[k + 2] = enc; lod[k + 3] = 255;
      }
    }
    loCtx.putImageData(loImg, 0, 0);
    // ── Pass 2: high-res — smooth-upscale the encoded field, then BAND it ─────
    const hiW = 660, hiH = Math.max(200, Math.round(hiW * aspect));
    let hiC; try { hiC = document.createElement('canvas'); } catch { return null; }
    hiC.width = hiW; hiC.height = hiH;
    const hiCtx = hiC.getContext('2d'); if (!hiCtx) return null;
    hiCtx.imageSmoothingEnabled = true; hiCtx.imageSmoothingQuality = 'high';
    hiCtx.drawImage(loC, 0, 0, loW, loH, 0, 0, hiW, hiH);
    const BAND = 1.5; // °C per colour band → crisp filled-contour steps
    const LUT = new Uint8Array(256 * 3);
    for (let b = 0; b < 256; b++) {
      const rgb = tempColorRGB(Math.round((T0 + (b / 255) * SPAN) / BAND) * BAND) || [0, 0, 0];
      LUT[b * 3] = rgb[0]; LUT[b * 3 + 1] = rgb[1]; LUT[b * 3 + 2] = rgb[2];
    }
    const hiImg = hiCtx.getImageData(0, 0, hiW, hiH), hid = hiImg.data;
    for (let k = 0; k < hid.length; k += 4) {
      const b3 = hid[k] * 3; hid[k] = LUT[b3]; hid[k + 1] = LUT[b3 + 1]; hid[k + 2] = LUT[b3 + 2]; hid[k + 3] = 255;
    }
    hiCtx.putImageData(hiImg, 0, 0);
    // ── Clip to the real coastline + thin coast, at high resolution ───────────
    const projC = (lat, lon) => [((lon - lonMin) / lonSpan) * hiW, ((yTop - mercY(lat)) / (yTop - yBot)) * hiH];
    const land = new Path2D();
    const addRing = (ring) => { for (let i = 0; i < ring.length; i++) { const [lo, la] = ring[i]; const [x, y] = projC(la, lo); if (i === 0) land.moveTo(x, y); else land.lineTo(x, y); } land.closePath(); };
    for (const f of (UK_IRELAND_COUNTIES?.features || [])) {
      const g = f.geometry; if (!g) continue;
      if (g.type === 'Polygon') for (const ring of g.coordinates) addRing(ring);
      else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const ring of poly) addRing(ring);
    }
    hiCtx.globalCompositeOperation = 'destination-in';
    hiCtx.fill(land, 'nonzero');
    hiCtx.globalCompositeOperation = 'source-over';
    hiCtx.lineJoin = 'round'; hiCtx.lineWidth = 0.8; hiCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    hiCtx.stroke(land);
    try { return { url: hiC.toDataURL('image/png') }; } catch { return null; }
  }, [pts, bbox]);

  // Hottest (max mode) / coldest (min mode) source point over land — star marker.
  const extreme = useMemo(() => {
    let best = null;
    for (const p of pts) {
      if (!inRegionBox(p.lat, p.lon, bbox)) continue;
      if (!best || (tempMode === 'min' ? p.t < best.t : p.t > best.t)) best = p;
    }
    return best;
  }, [pts, tempMode, bbox]);

  const handleInspect = useCallback((info) => {
    const { lat, lon } = info;
    let n = null, bd = Infinity;
    for (const p of grid) { const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2; if (d < bd) { bd = d; n = p; } }
    const target = n ? { lat: n.lat, lon: n.lon } : { lat, lon };
    if (onInspect) onInspect(target); else onClickPoint?.([target.lat, target.lon]);
  }, [grid, onInspect, onClickPoint]);

  const hasTemp = pts.length > 0;

  return (
    <div ref={captureRef} style={{ position: 'relative' }}>
      <TCMLeafletBase bbox={bbox} height={mapHeight} lightMode={lightMode}
        onInspect={handleInspect} pin={pin}
        enableSearch={enableSearch} enableLocate={enableLocate} enableFullscreen={enableFullscreen}>
        {({ projector }) => {
          if (!projector) return null;
          const { x: w, y: h } = projector.size;
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>
              {raster && (() => {
                // Place the geographic raster by projecting the bbox corners. Both
                // the raster and Leaflet are Web-Mercator, so a straight stretch
                // between the projected corners keeps it perfectly aligned.
                const [x0, y0] = projector.project(bbox.latMax, bbox.lonMin);
                const [x1, y1] = projector.project(bbox.latMin, bbox.lonMax);
                const ix = Math.min(x0, x1), iy = Math.min(y0, y1);
                const iw = Math.abs(x1 - x0), ih = Math.abs(y1 - y0);
                return <image href={raster.url} x={ix} y={iy} width={iw} height={ih} preserveAspectRatio="none" opacity={1} style={{ imageRendering: 'auto' }} />;
              })()}
              {showGrid && hasTemp && pts.map((p, i) => {
                const [cx, cy] = projector.project(p.lat, p.lon);
                if (cx < 0 || cy < 0 || cx > w || cy > h) return null;
                return <text key={`n${i}`} x={cx} y={cy + 3.5} textAnchor="middle" fontSize={9.5} fontWeight={800} fontFamily="DM Mono,monospace" stroke="rgba(0,0,0,0.5)" strokeWidth={2} paintOrder="stroke" fill="#fff">{Math.round(p.t)}</text>;
              })}
              {showLocations && hasTemp && UK_CITIES.map((city) => {
                let n = null, bd = Infinity;
                for (const p of pts) { const dd = (p.lat - city.lat) ** 2 + (p.lon - city.lon) ** 2; if (dd < bd) { bd = dd; n = p; } }
                if (!n) return null;
                const [cx, cy] = projector.project(city.lat, city.lon);
                if (cx < -20 || cy < -20 || cx > w + 20 || cy > h + 20) return null;
                return (
                  <g key={`city-${city.name}`}>
                    <circle cx={cx} cy={cy} r={3} fill="#fff" stroke="rgba(0,0,0,0.65)" strokeWidth={1.2} />
                    <text x={cx + 6} y={cy - 1} fontSize={12.5} fontWeight={900} fontFamily="DM Mono,monospace" stroke="rgba(0,0,0,0.78)" strokeWidth={2.8} paintOrder="stroke" fill="#fff">{Math.round(n.t)}°</text>
                    <text x={cx + 6} y={cy + 10} fontSize={8.5} fontWeight={700} fontFamily="DM Sans,sans-serif" stroke="rgba(0,0,0,0.72)" strokeWidth={2.2} paintOrder="stroke" fill="rgba(255,255,255,0.92)">{city.name}</text>
                  </g>
                );
              })}
              {showExtreme && extreme && (() => {
                const [cx, cy] = projector.project(extreme.lat, extreme.lon);
                const col = tempMode === 'min' ? '#38bdf8' : '#f43f5e';
                return (
                  <g>
                    <text x={cx} y={cy - 15} textAnchor="middle" fontSize={14} fontWeight={900} fontFamily="DM Mono,monospace" stroke="rgba(0,0,0,0.82)" strokeWidth={3.2} paintOrder="stroke" fill="#fff">{Math.round(extreme.t)}°C</text>
                    <path d={starPath(cx, cy, 12, 5.4)} fill={col} stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
                    <text x={cx} y={cy + 24} textAnchor="middle" fontSize={8.5} fontWeight={800} letterSpacing="0.08em" fontFamily="DM Sans,sans-serif" stroke="rgba(0,0,0,0.75)" strokeWidth={2.2} paintOrder="stroke" fill={col}>{tempMode === 'min' ? 'COLDEST' : 'HOTTEST'}</text>
                  </g>
                );
              })()}
              {!hasTemp && <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={13} fontWeight={600} fill={lightMode ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.30)'} fontFamily="DM Sans">Temperature data appears after the next model run</text>}
            </svg>
          );
        }}
      </TCMLeafletBase>
      <TempLegend mode={tempMode} />
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   HOCO — Handry Outlook (HOCO V2.0) probabilistic LIGHTNING outlook, folded into
   the TCM model and calibrated to the UK risk scale.
   • Free Firebase API (public key). England + Scotland runs are combined for UK
     coverage; other regions (Germany/Poland/Baltics) are ignored.
   • The three HOCO day-ranges Day0-1 / Day1-2 / Day2-3 map 1:1 onto the TCM's
     Day 1 / 2 / 3, so it is available for every day of the 3-day outlook.
   • HOCO's lightning probability (%) is calibrated onto the TCM's 8-level scale
     (hocoRiskToLevel) so it renders in the model's own colours + legend.
   Docs: https://handry-outlook.github.io/HOCO-V2.0/api_usage.html
═══════════════════════════════════════════════════════════════════════════ */
const HOCO_KEY = 'AIzaSyA8IYTApDl8vhZENPJXIw48rR_SUhfFPVQ';
const HOCO_QUERY_URL = `https://firestore.googleapis.com/v1/projects/hoco-3b23e/databases/(default)/documents:runQuery?key=${HOCO_KEY}`;
const HOCO_DAY_RANGE = ['Day0-1', 'Day1-2', 'Day2-3']; // TCM dayIdx → HOCO forecast range
const HOCO_UK_REGIONS = ['England', 'Scotland'];

// Calibrate HOCO's lightning probability (%) to the TCM's UK risk scale. UK
// convection runs weaker than the near-continent, so a given probability sits a
// notch lower here than a central-European reading of the same number would.
function hocoRiskToLevel(risk) {
  const r = Number(risk) || 0;
  if (r >= 70) return 'Severe';
  if (r >= 50) return 'High';
  if (r >= 40) return 'Moderate';
  if (r >= 30) return 'Slight';
  if (r >= 20) return 'Marginal';
  if (r >= 10) return 'Low';
  if (r >= 5)  return 'Very Low';
  return 'No Risk';
}

// Latest completed automated runs. Cached briefly — the GeoJSON URLs are signed
// and time-limited, so we refresh well within their validity window.
let _hocoRunsCache = { at: 0, runs: null };
async function hocoFetchRuns() {
  if (_hocoRunsCache.runs && Date.now() - _hocoRunsCache.at < 8 * 60_000) return _hocoRunsCache.runs;
  const body = { structuredQuery: {
    from: [{ collectionId: 'hoco_requests' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'public' }, op: 'EQUAL', value: { booleanValue: true } } },
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'completed' } } },
      { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: { stringValue: 'automated' } } },
    ] } },
    orderBy: [{ field: { fieldPath: 'completedAt' }, direction: 'DESCENDING' }],
    limit: 80,
  } };
  const res = await fetch(HOCO_QUERY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HOCO query ${res.status}`);
  const arr = await res.json();
  const runs = (Array.isArray(arr) ? arr : []).map(x => x.document).filter(Boolean).map(doc => {
    const f = doc.fields || {};
    const id = f.id?.stringValue || '';
    const m = id.match(/-(England|Scotland|Germany|Poland|Baltics)-(Day\d-\d)$/);
    return { region: f.region?.stringValue, dayRange: m ? m[2] : null, url: f.geojsonUrl?.stringValue, completedAt: f.completedAt?.timestampValue, weather: f.weather?.stringValue };
  }).filter(r => r.url && r.dayRange);
  _hocoRunsCache = { at: Date.now(), runs };
  return runs;
}

// Parsed outlook polygons for one TCM day (England + Scotland combined), each
// mapped onto a TCM level. Cached per day-range.
const _hocoDayCache = new Map();
async function hocoFetchDay(dayIdx) {
  const dayRange = HOCO_DAY_RANGE[Math.max(0, Math.min(2, dayIdx))] || 'Day0-1';
  const hit = _hocoDayCache.get(dayRange);
  if (hit && Date.now() - hit.at < 8 * 60_000) return hit.out;
  const runs = await hocoFetchRuns();
  const chosen = HOCO_UK_REGIONS.map(reg => runs.find(r => r.region === reg && r.dayRange === dayRange)).filter(Boolean);
  const layers = [];
  let meta = null;
  for (const run of chosen) {
    try {
      const gj = await fetch(run.url).then(r => (r.ok ? r.json() : null));
      if (!gj) continue;
      if (!meta) meta = { weather: run.weather, completedAt: run.completedAt, dayRange };
      for (const feat of (gj.features || [])) {
        if (feat?.properties?.feature_type !== 'polygon') continue;
        const level = hocoRiskToLevel(feat.properties.risk);
        if (level === 'No Risk') continue;
        const geom = feat.geometry;
        const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
        for (const poly of polys) {
          const ring = poly?.[0];
          if (Array.isArray(ring) && ring.length >= 3) layers.push({ level, risk: Number(feat.properties.risk) || 0, ring });
        }
      }
    } catch { /* skip a failed region, keep the other */ }
  }
  layers.sort((a, b) => a.risk - b.risk); // paint low → high so stronger bands land on top
  const out = { layers, meta };
  _hocoDayCache.set(dayRange, { at: Date.now(), out });
  return out;
}

const HOCOMap = React.memo(function HOCOMap({ region, dayIdx, onClickPoint, onInspect, pin = null, enableSearch = false, enableLocate = false, enableFullscreen = false, captureRef }) {
  const { lightMode } = useTCMTheme();
  const bbox = REGIONS[region]?.bbox;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const mapHeight = isMobile ? Math.min(320, window.innerHeight * 0.55) : Math.max(420, Math.min(720, window.innerHeight * 0.66));
  const [state, setState] = useState({ loading: true, layers: [], meta: null, err: null });

  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, err: null }));
    hocoFetchDay(dayIdx)
      .then(({ layers, meta }) => { if (alive) setState({ loading: false, layers, meta, err: null }); })
      .catch(e => { if (alive) setState({ loading: false, layers: [], meta: null, err: e?.message || 'HOCO unavailable' }); });
    return () => { alive = false; };
  }, [dayIdx]);

  const activeLevels = useMemo(() => { const s = new Set(); for (const l of state.layers) s.add(l.level); return s; }, [state.layers]);

  const handleInspect = useCallback((info) => {
    if (onInspect) onInspect({ lat: info.lat, lon: info.lon });
    else onClickPoint?.([info.lat, info.lon]);
  }, [onInspect, onClickPoint]);

  return (
    <div ref={captureRef} style={{ position: 'relative' }}>
      <TCMLeafletBase bbox={bbox} height={mapHeight} lightMode={lightMode}
        onInspect={handleInspect} pin={pin}
        enableSearch={enableSearch} enableLocate={enableLocate} enableFullscreen={enableFullscreen}>
        {({ projector }) => {
          if (!projector) return null;
          const { x: w, y: h } = projector.size;
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>
              {state.layers.map((L, i) => {
                const pal = getPalette('thunderstorm', L.level);
                let d = '';
                for (let j = 0; j < L.ring.length; j++) {
                  const [lon, lat] = L.ring[j];
                  const [px, py] = projector.project(lat, lon);
                  d += (j === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1);
                }
                d += 'Z';
                return <path key={i} d={d} fill={pal.fill} stroke={pal.border} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" opacity={LEVEL_OPACITY[L.level] ?? 0.7} />;
              })}
              {state.loading && <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={13} fontWeight={700} fill={lightMode ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)'} fontFamily="DM Sans">Loading HOCO outlook…</text>}
              {!state.loading && !state.err && state.layers.length === 0 && <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={13} fontWeight={600} fill={lightMode ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.32)'} fontFamily="DM Sans">No HOCO lightning risk for this day</text>}
              {state.err && <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={12} fontWeight={600} fill="#f87171" fontFamily="DM Sans">HOCO outlook unavailable</text>}
            </svg>
          );
        }}
      </TCMLeafletBase>
      <OutlookLegend riskType="thunderstorm" activeLevels={activeLevels} forceLight={undefined} />
      {/* HOCO identity chip (top-centre — that zone is free) */}
      <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 9, background: 'rgba(10,16,34,0.84)', border: '1px solid rgba(129,140,248,0.4)', backdropFilter: 'blur(8px)', pointerEvents: 'none', maxWidth: 'calc(100% - 24px)' }}>
        <span style={{ fontSize: '0.64rem', fontWeight: 900, color: '#a5b4fc', letterSpacing: '0.05em' }}>HOCO V2.0</span>
        <span style={{ fontSize: '0.58rem', color: '#94a3b8', fontFamily: "'DM Mono',monospace", whiteSpace: 'nowrap' }}>
          lightning · {HOCO_DAY_RANGE[dayIdx] || ''}{state.meta?.completedAt ? ` · ${new Date(state.meta.completedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
    </div>
  );
});

/* AnimatedMap moved to components/tcm/AnimatedMap.jsx */
import AnimatedMapImpl from '@/components/tcm/AnimatedMap';
import RadarRasterMap from '@/components/tcm/RadarRasterMap';
const AnimatedMap = React.memo(function AnimatedMap(props) {
  return <AnimatedMapImpl {...props} REGIONS={REGIONS} RISK_TYPES={RISK_TYPES} LEVEL_OPACITY={LEVEL_OPACITY} TOTAL_STEPS={TOTAL_STEPS} STEPS_PER_DAY={STEPS_PER_DAY} buildOutlookLayersForStep={buildOutlookLayersForStep} buildOutlookLayers={buildOutlookLayers} buildFineGrid={buildFineGrid} buildSmoothedField={buildSmoothedField} getRiskScore={getRiskScore} scoreToLevel={scoreToLevel} isInUKIreland={isInUKIreland} detectGridStep={detectGridStep} clusterToPath={clusterToPath} ringToSvgPath={ringToSvgPath} getPalette={getPalette} stepLabel={stepLabel} TitleCard={TitleCard} OutlookLegend={OutlookLegend} useTCMTheme={useTCMTheme} />;
});

/* ═══════════════════════════════════════════════════════════════════════════
   PNG EXPORT — helpers & modal
═══════════════════════════════════════════════════════════════════════════ */

const PNG_COLOUR_PRESETS = [
  { id: 'default',  label: 'Default',    dotColor: '#facc15', accent: '#a78bfa' },
  { id: 'midnight', label: 'Midnight',   dotColor: '#38bdf8', accent: '#38bdf8' },
  { id: 'storm',    label: 'Storm Red',  dotColor: '#f87171', accent: '#ef4444' },
  { id: 'nature',   label: 'Green',      dotColor: '#86efac', accent: '#22c55e' },
  { id: 'aurora',   label: 'Aurora',     dotColor: '#c4b5fd', accent: '#8b5cf6' },
  { id: 'mono',     label: 'Mono',       dotColor: '#e2e8f0', accent: '#94a3b8' },
];

function _loadImg(url, timeoutMs = 6000) {
  return new Promise((res) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => res(null), timeoutMs);
    img.onload  = () => { clearTimeout(timer); res(img); };
    img.onerror = () => { clearTimeout(timer); res(null); };
    img.src = url;
  });
}

function _rr(ctx, x, y, w, h, r) {
  if (w < 1 || h < 1) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

function _riskCol(level) {
  return {
    'No Risk': '#1e293b', 'Very Low': '#0891b2', 'Low': '#475569',
    'Marginal': '#65a30d', 'Slight': '#ca8a04', 'Moderate': '#ea580c',
    'High': '#dc2626', 'Severe': '#991b1b',
  }[level] || '#1e293b';
}

function _actSteps(data, dayIdx, riskType, run) {
  const grid = data?.grid ?? [];
  const rh = run ? new Date(run).getUTCHours() : 0;
  return Array.from({ length: 8 }, (_, si) => {
    const gs = dayIdx * 8 + si, h = (rh + si * 3) % 24;
    let max = 0;
    for (const p of grid) {
      // perStep on local runs; fall back to the step's day on slimmed DB runs.
      const s = (p.perStep?.[gs]?.scores?.[riskType])
        ?? (p.perDay?.[Math.floor(gs / 8)]?.scores?.[riskType])
        ?? 0;
      if (s > max) max = s;
    }
    return { hour: h, score: max, level: scoreToLevel(max) };
  });
}

function _dayMaxima(data, dayIdx) {
  let maxG = 0, maxH = 0, maxT = 0, maxL = 0, maxF = 0;
  for (const p of (data?.grid || [])) {
    const d = p.perDay?.[dayIdx]; if (!d) continue;
    maxG = Math.max(maxG, d.scores?.metrics?.gust ?? 0);
    maxH = Math.max(maxH, d.scores?.hail ?? 0);
    maxT = Math.max(maxT, d.scores?.tornado ?? 0);
    maxL = Math.max(maxL, d.scores?.lightning ?? 0);
    maxF = Math.max(maxF, d.scores?.sub?.flashFlood ?? 0);
  }
  return {
    hail: Math.round(maxH * 0.5), tornado: Math.round(maxT),
    gust: Math.round(maxG * 0.621371), lightning: Math.round(maxL), flood: Math.round(maxF),
  };
}

async function _buildCanvas({ mapDataUrl, opts, data, dayIdx, riskType, region, run, strikes, scale = 1, adminOutlooksMeta = [] }) {
  const {
    showKey, showLightningDots, colourPreset,
    showOverlaySVR, showOverlayLightning, showOverlayHail, showOverlayFloodFlashing,
  } = opts;
  const pal = PNG_COLOUR_PRESETS.find(p => p.id === colourPreset) || PNG_COLOUR_PRESETS[0];

  // ── Risk colour helpers (use the actual site palette) ────────────────
  function _riskFill(level) {
    const idx = RISK_INDEX[level] ?? 0;
    return (RISK_PALETTES.thunderstorm[idx] ?? RISK_PALETTES.thunderstorm[0]).fill ?? 'transparent';
  }
  function _riskBorder(level) {
    const idx = RISK_INDEX[level] ?? 0;
    return (RISK_PALETTES.thunderstorm[idx] ?? RISK_PALETTES.thunderstorm[0]).border ?? '#475569';
  }
  // Solid opaque version of a fill colour for chip backgrounds
  function _solidFill(level) {
    const f = _riskFill(level);
    // Convert rgba(r,g,b,a) -> rgba(r,g,b,0.92) for legibility
    const m = f.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return `rgba(${m[1]},${m[2]},${m[3]},0.92)`;
    return f;
  }

  const mapImg = mapDataUrl ? await _loadImg(mapDataUrl) : null;

  // ── Canvas size — map fills the canvas ──────────────────────────────
  const RENDER_SCALE = 2;
  const W = mapImg ? mapImg.naturalWidth  : 900;
  const H = mapImg ? mapImg.naturalHeight : 680;

  const canvas = document.createElement('canvas');
  canvas.width  = W * RENDER_SCALE * scale;
  canvas.height = H * RENDER_SCALE * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(RENDER_SCALE * scale, RENDER_SCALE * scale);

  // ── Draw map ─────────────────────────────────────────────────────────
  if (mapImg) {
    ctx.drawImage(mapImg, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#0a1420'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '13px monospace'; ctx.fillStyle = '#334155';
    ctx.fillText('Live map renders here on export', W / 2, H / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // ── Vignette gradients for readability ───────────────────────────────
  // Left edge (title/key side)
  const vgL = ctx.createLinearGradient(0, 0, W * 0.42, 0);
  vgL.addColorStop(0,   'rgba(0,0,0,0.78)');
  vgL.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  vgL.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = vgL; ctx.fillRect(0, 0, W, H);
  // Top strip
  const vgT = ctx.createLinearGradient(0, 0, 0, H * 0.22);
  vgT.addColorStop(0, 'rgba(0,0,0,0.60)'); vgT.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vgT; ctx.fillRect(0, 0, W, H);
  // Bottom strip
  const vgB = ctx.createLinearGradient(0, H * 0.74, 0, H);
  vgB.addColorStop(0, 'rgba(0,0,0,0)'); vgB.addColorStop(1, 'rgba(0,0,0,0.82)');
  ctx.fillStyle = vgB; ctx.fillRect(0, 0, W, H);

  // ── Lightning strike dots — solid filled circles, no halo or stroke ────
  if (showLightningDots && strikes?.length) {
    const bbox2 = (REGIONS[region] ?? {}).bbox;
    if (bbox2) {
      const lw2 = bbox2.lonMax - bbox2.lonMin, lh2 = bbox2.latMax - bbox2.latMin;
      for (const s of strikes) {
        if (s.lat < bbox2.latMin || s.lat > bbox2.latMax || s.lon < bbox2.lonMin || s.lon > bbox2.lonMax) continue;
        const px = ((s.lon - bbox2.lonMin) / lw2) * W;
        const py = ((bbox2.latMax - s.lat)  / lh2) * H;
        // Age-coloured: <10min white, <30min yellow, <60min amber, older orange
        const ageMin = (Date.now() - (s.time || 0)) / 60000;
        const col = ageMin < 10 ? '#ffffff' : ageMin < 30 ? '#fde047' : ageMin < 60 ? '#f59e0b' : '#fb923c';
        const r   = ageMin < 10 ? 2.8 : ageMin < 30 ? 2.4 : 2.0;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      }
      // ── Strike counter pill — bottom-right of the map ──
      const visCount = strikes.filter(s =>
        s.lat >= bbox2.latMin && s.lat <= bbox2.latMax &&
        s.lon >= bbox2.lonMin && s.lon <= bbox2.lonMax
      ).length;
      if (visCount > 0) {
        const label = `⚡ ${visCount >= 1000 ? (visCount / 1000).toFixed(1) + 'k' : visCount} strikes`;
        ctx.font = 'bold 14px monospace';
        const tw = ctx.measureText(label).width;
        const PW = tw + 24, PH = 30;
        const PX = W - PW - PAD, PY = H - PH - PAD - 52; // above watermark
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10;
        ctx.fillStyle = 'rgba(6,10,24,0.85)';
        _rr(ctx, PX, PY, PW, PH, 8); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(251,191,36,0.55)'; ctx.lineWidth = 1;
        _rr(ctx, PX, PY, PW, PH, 8); ctx.stroke();
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#fbbf24';
        ctx.fillText(label, PX + PW / 2, PY + PH / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    }
  }

  // ── Panel drawing helper ─────────────────────────────────────────────
  const PAD = 18;

  function glassPanel(x, y, w, h, r = 12, { alpha = 0.87, border = 'rgba(255,255,255,0.13)', accentStrip = null } = {}) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    ctx.fillStyle = `rgba(6,11,26,${alpha})`;
    _rr(ctx, x, y, w, h, r); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = border; ctx.lineWidth = 1;
    _rr(ctx, x, y, w, h, r); ctx.stroke();
    if (accentStrip) {
      ctx.fillStyle = accentStrip;
      _rr(ctx, x, y, 3, h, Math.min(r, 3)); ctx.fill();
    }
  }

  // ── Canvas icon drawing helpers (no emoji) ───────────────────────────
  function drawLightningBolt(cx, cy, size, color) {
    const s = size * 0.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + s*0.2,  cy - s);
    ctx.lineTo(cx - s*0.3,  cy + s*0.1);
    ctx.lineTo(cx + s*0.1,  cy + s*0.1);
    ctx.lineTo(cx - s*0.2,  cy + s);
    ctx.lineTo(cx + s*0.3,  cy - s*0.1);
    ctx.lineTo(cx - s*0.1,  cy - s*0.1);
    ctx.closePath(); ctx.fill();
  }

  function drawHailIcon(cx, cy, size, color) {
    // Cloud body
    ctx.strokeStyle = color; ctx.lineWidth = size * 0.09; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx - size*0.15, cy - size*0.05, size*0.22, Math.PI*0.9, Math.PI*2.1);
    ctx.arc(cx + size*0.15, cy - size*0.12, size*0.18, Math.PI, Math.PI*2);
    ctx.arc(cx + size*0.28, cy,              size*0.14, Math.PI*1.5, Math.PI*0.5);
    ctx.arc(cx - size*0.28, cy,              size*0.14, Math.PI*0.5, Math.PI*1.5);
    ctx.stroke();
    // Three hail dots below
    const dotR = size * 0.07;
    [-size*0.22, 0, size*0.22].forEach(dx => {
      ctx.beginPath(); ctx.arc(cx+dx, cy+size*0.38, dotR, 0, Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
    });
  }

  function drawFloodIcon(cx, cy, size, color) {
    ctx.strokeStyle = color; ctx.lineWidth = size * 0.09; ctx.lineCap = 'round';
    // Three wave lines
    [-0.2, 0, 0.2].forEach((dy, i) => {
      const y0 = cy + dy * size;
      ctx.beginPath();
      ctx.moveTo(cx - size*0.35, y0);
      ctx.bezierCurveTo(cx - size*0.15, y0 - size*0.12, cx + size*0.05, y0 + size*0.12, cx + size*0.25, y0);
      ctx.bezierCurveTo(cx + size*0.4, y0 - size*0.1, cx + size*0.5, y0 + size*0.08, cx + size*0.35, y0);
      ctx.stroke();
    });
  }

  function drawSVRIcon(cx, cy, size, color) {
    // Warning triangle
    ctx.strokeStyle = color; ctx.lineWidth = size * 0.1; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - size*0.5);
    ctx.lineTo(cx + size*0.46, cy + size*0.32);
    ctx.lineTo(cx - size*0.46, cy + size*0.32);
    ctx.closePath(); ctx.stroke();
    // Exclamation mark
    ctx.fillStyle = color;
    ctx.fillRect(cx - size*0.065, cy - size*0.18, size*0.13, size*0.32);
    ctx.beginPath(); ctx.arc(cx, cy + size*0.24, size*0.075, 0, Math.PI*2); ctx.fill();
  }

  // ─────────────────────────────────────────────────────────────────────
  // TOP-LEFT — Title block
  // ─────────────────────────────────────────────────────────────────────
  {
    const riskLabel = RISK_TYPES.find(t => t.id === riskType)?.label ?? 'Thunderstorms';
    const TH = 68;
    const TITLE_X = PAD, TITLE_Y = PAD;

    // Measure to auto-size
    ctx.font = 'bold 34px sans-serif';
    const labelW = ctx.measureText(riskLabel).width;
    const TW = 66 + labelW + 18;

    glassPanel(TITLE_X, TITLE_Y, TW, TH, 12, { accentStrip: pal.accent });

    // Lightning bolt icon box
    ctx.fillStyle = pal.accent + '28';
    _rr(ctx, TITLE_X + 10, TITLE_Y + 10, 48, 48, 10); ctx.fill();
    ctx.strokeStyle = pal.accent + '60'; ctx.lineWidth = 1;
    _rr(ctx, TITLE_X + 10, TITLE_Y + 10, 48, 48, 10); ctx.stroke();
    drawLightningBolt(TITLE_X + 34, TITLE_Y + 34, 28, pal.accent);

    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = 'bold 34px sans-serif'; ctx.fillStyle = '#f1f5f9';
    // Text shadow for crispness
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
    ctx.fillText(riskLabel, TITLE_X + 66, TITLE_Y + TH / 2);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // ─────────────────────────────────────────────────────────────────────
  // RISK SCALE — horizontal chip bar below title
  // ─────────────────────────────────────────────────────────────────────
  if (showKey) {
    const LEVELS = RISK_META.filter(r => r.level !== 'No Risk');
    const CHIP_H = 52;
    const CHIP_GAP = 4;
    const LABEL_W = 62; // "Risk >" prefix cell
    const BAR_PAD = 10;

    // Auto-size chips to fit nicely — measure widest label at chosen font
    ctx.font = 'bold 13px sans-serif';
    const maxW = Math.max(...LEVELS.map(r => ctx.measureText(r.level).width));
    const CHIP_W = Math.ceil(maxW) + 22;

    const BAR_W = LABEL_W + LEVELS.length * (CHIP_W + CHIP_GAP) - CHIP_GAP + BAR_PAD * 2;
    const BAR_H = CHIP_H + BAR_PAD * 2;
    const BAR_X = PAD;
    const BAR_Y = PAD + 68 + 8;

    glassPanel(BAR_X, BAR_Y, BAR_W, BAR_H, 12);

    // "Risk >" label
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('RISK', BAR_X + BAR_PAD + LABEL_W / 2, BAR_Y + BAR_H / 2 - 7);
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('\u25B6', BAR_X + BAR_PAD + LABEL_W / 2, BAR_Y + BAR_H / 2 + 9);

    let bx = BAR_X + BAR_PAD + LABEL_W;

    LEVELS.forEach(r => {
      const cy = BAR_Y + BAR_PAD;
      const borderCol = _riskBorder(r.level);
      const fillCol   = _solidFill(r.level);
      const next      = RISK_META[RISK_META.findIndex(x => x.level === r.level) + 1];
      const rangeStr  = next ? `${r.min}\u2013${next.min - 1}` : `${r.min}+`;

      if (r.level === 'Severe') {
        // Hatching fill
        ctx.save();
        ctx.beginPath(); _rr(ctx, bx, cy, CHIP_W, CHIP_H, 7); ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx, cy, CHIP_W, CHIP_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.8;
        for (let hx = -CHIP_H; hx < CHIP_W + CHIP_H; hx += 6) {
          ctx.beginPath();
          ctx.moveTo(bx + hx, cy);
          ctx.lineTo(bx + hx + CHIP_H, cy + CHIP_H);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.40)'; ctx.lineWidth = 1.2;
        _rr(ctx, bx, cy, CHIP_W, CHIP_H, 7); ctx.stroke();
      } else {
        ctx.fillStyle = fillCol;
        _rr(ctx, bx, cy, CHIP_W, CHIP_H, 7); ctx.fill();
        ctx.strokeStyle = borderCol; ctx.lineWidth = 1.5;
        _rr(ctx, bx, cy, CHIP_W, CHIP_H, 7); ctx.stroke();
      }

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3;
      ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#ffffff';
      ctx.fillText(r.level, bx + CHIP_W / 2, cy + CHIP_H * 0.37);
      ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.70)';
      ctx.fillText(rangeStr, bx + CHIP_W / 2, cy + CHIP_H * 0.74);
      ctx.shadowBlur = 0;

      bx += CHIP_W + CHIP_GAP;
    });
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // ─────────────────────────────────────────────────────────────────────
  // HAZARD OVERLAY BOXES — bottom-left
  // ─────────────────────────────────────────────────────────────────────
  {
    const icons = [];
    if (showOverlaySVR)            icons.push({ id: 'svr',       label: 'SVR',         sub: 'Severe',    draw: drawSVRIcon,       accent: '#ef4444', border: 'rgba(239,68,68,0.55)'  });
    if (showOverlayLightning)      icons.push({ id: 'lightning', label: 'High Risk',   sub: 'Lightning', draw: drawLightningBolt, accent: '#fbbf24', border: 'rgba(251,191,36,0.55)' });
    if (showOverlayHail)           icons.push({ id: 'hail',      label: 'Large Hail',  sub: '',          draw: drawHailIcon,      accent: '#38bdf8', border: 'rgba(56,189,248,0.55)' });
    if (showOverlayFloodFlashing)  icons.push({ id: 'flood',     label: 'Flash',       sub: 'Flooding',  draw: drawFloodIcon,     accent: '#0ea5e9', border: 'rgba(14,165,233,0.55)' });

    if (icons.length > 0) {
      const ICON_BOX = 110; const ICON_GAP = 10;
      const ICON_Y = H - PAD - ICON_BOX;

      icons.forEach((ic, i) => {
        const ix = PAD + i * (ICON_BOX + ICON_GAP);
        const CX = ix + ICON_BOX / 2, CY = ICON_Y + ICON_BOX * 0.40;

        glassPanel(ix, ICON_Y, ICON_BOX, ICON_BOX, 16, { alpha: 0.90, border: ic.border });

        // Glowing circle
        ctx.save();
        ctx.shadowColor = ic.accent; ctx.shadowBlur = 24;
        ctx.beginPath(); ctx.arc(CX, CY, 30, 0, Math.PI*2);
        ctx.fillStyle = ic.accent + '22'; ctx.fill();
        ctx.restore();
        ctx.strokeStyle = ic.accent + '80'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(CX, CY, 30, 0, Math.PI*2); ctx.stroke();

        // Icon
        ic.draw(CX, CY, 24, ic.accent);

        // Labels
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
        ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#f1f5f9';
        ctx.fillText(ic.label, CX, ICON_Y + ICON_BOX * 0.74);
        if (ic.sub) {
          ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = ic.accent;
          ctx.fillText(ic.sub, CX, ICON_Y + ICON_BOX * 0.89);
        }
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // DATE / RUN INFO — bottom-left, above hazard boxes (only if icons)
  // ─────────────────────────────────────────────────────────────────────
  {
    const d0 = new Date(run || Date.now()); d0.setDate(d0.getDate() + dayIdx);
    const dateStr = d0.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const iconsCount = (showOverlaySVR?1:0)+(showOverlayLightning?1:0)+(showOverlayHail?1:0)+(showOverlayFloodFlashing?1:0);
    const ICON_BOX = 110;
    const DR_H = 34;
    const DR_Y = iconsCount > 0 ? H - PAD - ICON_BOX - 6 - DR_H : H - PAD - DR_H;
    const DR_W = 270;

    glassPanel(PAD, DR_Y, DR_W, DR_H, 10, { alpha: 0.82, accentStrip: pal.accent });
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = 'bold 12px monospace'; ctx.fillStyle = pal.accent;
    ctx.fillText('Day ' + (dayIdx + 1) + '  \u00B7  ' + dateStr, PAD + 10, DR_Y + DR_H / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // ─────────────────────────────────────────────────────────────────────
  // WATERMARK — bottom-right
  // ─────────────────────────────────────────────────────────────────────
  {
    const WW = 240, WH = 58;
    const WX = W - WW - PAD, WY = H - WH - PAD;

    glassPanel(WX, WY, WW, WH, 12, { accentStrip: pal.accent });

    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = 'bold 14px monospace'; ctx.fillStyle = pal.accent;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
    ctx.fillText('MyWeatherUK  \u00B7  V5', WX + 12, WY + WH * 0.33);
    ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.40)';
    ctx.fillText('myweatheruk.com', WX + 12, WY + WH * 0.70);
    ctx.shadowBlur = 0;

    // Disclaimer italic line above watermark
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'italic 10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillText('Risk of Thunderstorms in a 15 mile radius', W - PAD, WY - 6);
    ctx.textAlign = 'left';
  }

  // ─────────────────────────────────────────────────────────────────────
  // MyWeather logo — top-right
  // ─────────────────────────────────────────────────────────────────────
  {
    const mwImg = await _loadImg(MYWEATHER_LOGO_URL);
    const SZ = 60;
    if (mwImg) {
      const LX = W - SZ - PAD, LY = PAD;
      ctx.save(); _rr(ctx, LX, LY, SZ, SZ, 11); ctx.clip();
      ctx.drawImage(mwImg, LX, LY, SZ, SZ); ctx.restore();
      ctx.save();
      ctx.shadowColor = pal.accent; ctx.shadowBlur = 8;
      ctx.strokeStyle = pal.accent + '90'; ctx.lineWidth = 1.5;
      _rr(ctx, LX, LY, SZ, SZ, 11); ctx.stroke();
      ctx.restore();
    }
  }

  return canvas;
}


async function _compositeAndDownload({ mapDataUrl, opts, data, dayIdx, riskType, region, run, strikes, adminOutlooksMeta = [] }) {
  const canvas = await _buildCanvas({ mapDataUrl, opts, data, dayIdx, riskType, region, run, strikes, scale: 1, adminOutlooksMeta });
  const link = document.createElement('a');
  const rl  = (RISK_TYPES.find(t => t.id === riskType)?.label ?? riskType).toLowerCase().replace(/\s+/g, '-');
  const d0  = new Date(run || Date.now()); d0.setDate(d0.getDate() + dayIdx);
  const ds  = d0.toISOString().slice(0, 10);
  link.href = canvas.toDataURL('image/png', 1.0);
  link.download = `myweatheruk-${rl}-${region}-day${dayIdx + 1}-${ds}.png`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}


/* PngExportModal lives in components/tcm/PngExportModal.jsx — extracted to keep
   this file under the editing size limit. The wrapper below passes the
   WeatherPatterns-local helpers (captureMapImage, _buildCanvas, REGIONS, etc.)
   into the extracted modal as props so behaviour is unchanged. */
import PngExportModalImpl from '@/components/tcm/PngExportModal';
function PngExportModal(props) {
  return <PngExportModalImpl
    {...props}
    captureMapImage={captureMapImage}
    buildCanvas={_buildCanvas}
    REGIONS={REGIONS}
    PNG_COLOUR_PRESETS={PNG_COLOUR_PRESETS}
    AlertTriangle={AlertTriangle} Zap={Zap} CloudSnow={CloudSnow} CloudRain={CloudRain}
    X={X} Download={Download} Loader2={Loader2}
  />;
}



/* ═══════════════════════════════════════════════════════════════════════════
   MAIN MAP SECTION — with PDF export
═══════════════════════════════════════════════════════════════════════════ */
// Pin-point forecast card — the 3-day risk profile (all four hazards) at the
// exact map point the user tapped/clicked. Rendered below the map, in flow, so
// it never crowds the on-map controls and reads cleanly on mobile.
function PinForecastCard({ pin, data, riskType, run, region, t, onClose, onFullDetail }) {
  const grid = data?.grid ?? [];
  let n = null, bd = Infinity;
  for (const p of grid) { const d = (p.lat - pin.lat) ** 2 + (p.lon - pin.lon) ** 2; if (d < bd) { bd = d; n = p; } }
  const daysAvailable = data?.daysAvailable ?? 3;
  const dayName = (d) => { const x = new Date(run || Date.now()); x.setDate(x.getDate() + d); return d === 0 ? 'Today' : d === 1 ? 'Tom' : x.toLocaleDateString(undefined, { weekday: 'short' }); };
  const lvlCol = (h, lv) => (lv === 'No Risk' ? '#64748b' : (getPalette(h, lv).border || '#64748b'));
  return (
    <Card style={{ marginTop: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MapPin style={{ width: 15, height: 15, color: '#818cf8' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.86rem', fontWeight: 800, color: t.textPrimary }}>Point forecast</div>
          <div style={{ fontSize: '0.66rem', color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>{pin.lat.toFixed(3)}°, {pin.lon.toFixed(3)}° · {(REGIONS[region] ?? {}).label ?? region}</div>
        </div>
        <button onClick={onFullDetail} style={{ padding: '6px 12px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer', background: 'rgba(56,189,248,0.14)', border: '1px solid rgba(56,189,248,0.4)', color: '#38bdf8' }}>Full detail</button>
        <button onClick={onClose} title="Remove pin" style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'transparent', border: `1px solid ${t.cardBorder}`, color: t.textMuted }}><X style={{ width: 14, height: 14 }} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '92px repeat(3, 1fr)', gap: 6, alignItems: 'center' }}>
        <span />
        {[0, 1, 2].map(d => <div key={d} style={{ textAlign: 'center', fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>{dayName(d)}</div>)}
        {RISK_TYPES.map(rt => {
          const Ic = rt.icon;
          return (
            <React.Fragment key={rt.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 700, color: rt.id === riskType ? rt.color : t.textSecondary }}>
                <Ic style={{ width: 13, height: 13, color: rt.color, flexShrink: 0 }} />{rt.label}
              </div>
              {[0, 1, 2].map(d => {
                const locked = d >= daysAvailable;
                const sc = (!locked && n) ? Math.round(getRiskScore(n, rt.id, d)) : 0;
                const lv = scoreToLevel(sc);
                const col = lvlCol(rt.id, lv);
                return (
                  <div key={d} style={{ textAlign: 'center', padding: '5px 4px', borderRadius: 8, background: locked ? 'transparent' : `${col}14`, border: `1px solid ${locked ? 'transparent' : col + '44'}` }}>
                    <div style={{ fontSize: '0.58rem', fontWeight: 800, color: locked ? t.textMuted : col, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{locked ? '—' : lv}</div>
                    {!locked && <div style={{ fontSize: '0.82rem', fontWeight: 900, color: t.textPrimary, fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>{sc}</div>}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
      {[0, 1, 2].some(d => getTemp(n, d, 'max') != null || getTemp(n, d, 'min') != null) && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.cardBorder}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Thermometer style={{ width: 13, height: 13, color: '#f97316' }} />
            <span style={{ fontSize: '0.68rem', fontWeight: 800, color: t.textPrimary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Temperature trend · °C</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '92px repeat(3, 1fr)', gap: 6, alignItems: 'center' }}>
            <span />
            {[0, 1, 2].map(d => <div key={d} style={{ textAlign: 'center', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>{dayName(d)}</div>)}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 700, color: '#f97316' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#f97316' }} />Max</div>
            {[0, 1, 2].map(d => { const v = getTemp(n, d, 'max'); return <div key={d} style={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 900, color: t.textPrimary, fontFamily: "'DM Mono',monospace" }}>{v != null ? `${Math.round(v)}°` : '—'}</div>; })}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8' }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#38bdf8' }} />Min</div>
            {[0, 1, 2].map(d => { const v = getTemp(n, d, 'min'); return <div key={d} style={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 900, color: t.textPrimary, fontFamily: "'DM Mono',monospace" }}>{v != null ? `${Math.round(v)}°` : '—'}</div>; })}
          </div>
        </div>
      )}
    </Card>
  );
}

function MainMapSection({ data, region, riskType, dayIdx, run, onClickPoint, summary, refreshStartTime, savedOutlooks = [], onViewModeChange }) {
  const { t } = useTCMTheme();
  const [viewMode,     setViewMode]     = useState(() => { const v = readHashParams().get('view'); return VIEW_MODES.some(m => m.id === v) ? v : 'probability'; });
  const setViewModeAndNotify = (mode) => { setViewMode(mode); if (onViewModeChange) onViewModeChange(mode); };
  // Optional secondary layer drawn on top of the base map. The available
  // overlays are the three other risk-rendering primitives — outlook
  // polygons (SPC nested rings), the HD fine-grid surface, and the HD
  // native-grid box tiling — plus 'none' for no overlay. Mutually exclusive
  // with the base view (you can't overlay a layer onto itself).
  const [overlayMode,  setOverlayMode]  = useState('none');
  const [exporting,    setExporting]    = useState(false);
  const [showLightning, setShowLightning] = useState(false);
  const [strikeColour, setStrikeColour] = useState(() => {
    try { return localStorage.getItem('wp_strike_colour') || 'age'; } catch { return 'age'; }
  });
  const [strikeStroke, setStrikeStroke] = useState(() => {
    try { return localStorage.getItem('wp_strike_stroke') || 'none'; } catch { return 'none'; }
  });
  const [showColourPicker, setShowColourPicker] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('wp_strike_colour', strikeColour); } catch {}
  }, [strikeColour]);
  useEffect(() => {
    try { localStorage.setItem('wp_strike_stroke', strikeStroke); } catch {}
  }, [strikeStroke]);
  // Close colour picker on outside click
  useEffect(() => {
    if (!showColourPicker) return;
    const handler = (e) => {
      if (!e.target.closest('[data-colour-picker]')) setShowColourPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColourPicker]);
  const [pngModalOpen, setPngModalOpen] = useState(false);
  const [forceExportLight] = useState(false);
  const mapCaptureRef = useRef(null);
  // Pin-point inspect + consolidated on-map control panel
  const [pin, setPin] = useState(() => { const la = parseFloat(readHashParams().get('plat')); const lo = parseFloat(readHashParams().get('plon')); return (Number.isFinite(la) && Number.isFinite(lo)) ? { lat: la, lon: lo } : null; });
  const [mapPanel, setMapPanel] = useState(null);       // null | 'layers' | 'export'
  const [showTempLocations, setShowTempLocations] = useState(true);   // town readouts on temp map
  const [showTempGrid, setShowTempGrid] = useState(false);            // grid numbers on temp map
  const [showTempExtreme, setShowTempExtreme] = useState(false);      // hottest/coldest star
  useEffect(() => { writeHashParams({ view: viewMode, plat: pin ? pin.lat.toFixed(4) : null, plon: pin ? pin.lon.toFixed(4) : null }); }, [viewMode, pin]);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const stopBar = { onMouseDown: e => e.stopPropagation(), onTouchStart: e => e.stopPropagation(), onWheel: e => e.stopPropagation(), onDoubleClick: e => e.stopPropagation(), onPointerDown: e => e.stopPropagation() };
  const barPill = (active, color) => ({ padding: '7px 11px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', background: active ? `${color}26` : 'rgba(10,16,34,0.88)', color: active ? color : '#cbd5e1', border: `1px solid ${active ? color + '88' : 'rgba(255,255,255,0.10)'}`, backdropFilter: 'blur(10px)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' });
  const barPanel = viewMode === 'radar' ? { position:'absolute', top:'calc(100% + 8px)', bottom:'auto', right:0, zIndex:60, minWidth:214, maxWidth:264, padding:10, borderRadius:12, background:'rgba(10,16,34,0.97)', border:'1px solid rgba(255,255,255,0.12)', backdropFilter:'blur(12px)', boxShadow:'0 8px 36px rgba(0,0,0,0.6)', display:'flex', flexDirection:'column', gap:8 } : { position:'absolute', bottom:'calc(100% + 8px)', right:0, zIndex:60, minWidth:214, maxWidth:264, padding:10, borderRadius:12, background:'rgba(10,16,34,0.97)', border:'1px solid rgba(255,255,255,0.12)', backdropFilter:'blur(12px)', boxShadow:'0 -8px 36px rgba(0,0,0,0.6)', display:'flex', flexDirection:'column', gap:8 };
  const drawnForDay = (() => { const d = new Date(run || Date.now()); d.setDate(d.getDate() + dayIdx); const iso = d.toISOString().slice(0, 10); return savedOutlooks.filter(o => o.data?.isoDate === iso).map(o => o.data).filter(Boolean); })();
  const isTempView = viewMode === 'temp-max' || viewMode === 'temp-min';
  const isHocoView = viewMode === 'hoco';
  const overlayVisible = viewMode !== 'radar' && viewMode !== 'admin-outlook' && !isTempView && !isHocoView;
  const VM_SHORT = { probability: 'Prob', outlook: 'Outlook', 'admin-outlook': 'Admin', hires: 'Hi-Res', animated: 'Anim', radar: 'Radar', 'temp-max': 'Max °C', 'temp-min': 'Min °C', hoco: 'HOCO' };

  // Load live strikes — used for PNG export lightning dots
  const bbox = REGIONS[region]?.bbox;
  const liveStrikes = useMemo(
    () => loadTodayStrikes(bbox),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [region]  // re-read when region changes; loadTodayStrikes reads localStorage fresh each call
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const exportBbox = REGIONS[region]?.bbox ?? { lonMin: -10.5, lonMax: 2.5, latMin: 49.5, latMax: 61.5 };
      const mapDataUrl = await captureMapImage(null, exportBbox, true, 'counties');
      const impactedLocations = buildImpactedLocations(data?.grid || [], riskType, dayIdx, { getRiskScore, region, maxResults: 24 });
      await exportToPDF({ region, riskType, dayIdx, run, data, summary, mapDataUrl, impactedLocations });
    } catch (e) { console.error(e); }
    finally { setExporting(false); }
  };

  const handleDownloadPNG = () => setPngModalOpen(true);

  const handlePngExport = async (opts) => {
    setPngModalOpen(false);
    // Small pause to let the modal unmount cleanly
    await new Promise(r => setTimeout(r, 80));

    // Tile-stitch the map directly — no html2canvas, no waiting for React re-renders
    const bbox = REGIONS[region]?.bbox ?? { lonMin: -10.5, lonMax: 2.5, latMin: 49.5, latMax: 61.5 };
    const mapDataUrl = await captureMapImage(null, bbox, !opts.darkMode, opts.darkMode ? undefined : 'counties');

    await _compositeAndDownload({
      mapDataUrl,
      opts: { ...opts, viewLabel: 'Outlook' },
      data, dayIdx, riskType, region, run,
      strikes: liveStrikes,
      adminOutlooksMeta: opts.selectedOutlooks || [],
    });

  };

  return (
    <>
    <div style={{ position:'relative', borderRadius:16, overflow:'hidden', border:`1px solid ${t.cardBorder}`, background:t.cardBg, boxShadow:t.cardShadow }}>
      {viewMode==='outlook'        && <OutlookMap     data={data} region={region} riskType={riskType} dayIdx={dayIdx} onClickPoint={onClickPoint} onInspect={setPin} pin={pin} enableSearch enableLocate enableFullscreen captureRef={mapCaptureRef} showLightning={showLightning} strikeColour={strikeColour} strikeStroke={strikeStroke} overlayMode={overlayMode} variant="outlook" forceLight={forceExportLight||undefined} drawnOutlooks={drawnForDay} hideAutoLayers={false} />}
      {viewMode==='admin-outlook'  && <OutlookMap     data={data} region={region} riskType={riskType} dayIdx={dayIdx} onClickPoint={onClickPoint} onInspect={setPin} pin={pin} enableSearch enableLocate enableFullscreen captureRef={mapCaptureRef} showLightning={showLightning} strikeColour={strikeColour} strikeStroke={strikeStroke} overlayMode="none"   variant="outlook" forceLight={forceExportLight||undefined} drawnOutlooks={drawnForDay} hideAutoLayers={true} />}
      {viewMode==='hires'          && <OutlookMap     data={data} region={region} riskType={riskType} dayIdx={dayIdx} onClickPoint={onClickPoint} onInspect={setPin} pin={pin} enableSearch enableLocate enableFullscreen captureRef={mapCaptureRef} showLightning={showLightning} strikeColour={strikeColour} strikeStroke={strikeStroke} overlayMode={overlayMode} variant="hires"  forceLight={forceExportLight||undefined} drawnOutlooks={drawnForDay} hideAutoLayers={false} />}
      {viewMode==='probability'    && <ProbabilityMap data={data} region={region} riskType={riskType} dayIdx={dayIdx} onClickPoint={onClickPoint} onInspect={setPin} pin={pin} enableSearch enableLocate enableFullscreen captureRef={mapCaptureRef} showLightning={showLightning} strikeColour={strikeColour} strikeStroke={strikeStroke} overlayMode={overlayMode} forceLight={forceExportLight||undefined} drawnOutlooks={drawnForDay}/>}
      {viewMode==='animated'    && <AnimatedMap    data={data} region={region} riskType={riskType} dayIdx={dayIdx} run={run} overlayMode={overlayMode}
          REGIONS={REGIONS} RISK_TYPES={RISK_TYPES} LEVEL_OPACITY={LEVEL_OPACITY} TOTAL_STEPS={TOTAL_STEPS} STEPS_PER_DAY={STEPS_PER_DAY}
          buildOutlookLayersForStep={buildOutlookLayersForStep} buildOutlookLayers={buildOutlookLayers} buildFineGrid={buildFineGrid}
          getRiskScore={getRiskScore} scoreToLevel={scoreToLevel} isInUKIreland={isInUKIreland} detectGridStep={detectGridStep}
          clusterToPath={clusterToPath} ringToSvgPath={ringToSvgPath} getPalette={getPalette} stepLabel={stepLabel}
          TitleCard={TitleCard} OutlookLegend={OutlookLegend} useTCMTheme={useTCMTheme} />}
      {viewMode==='radar' && <RadarRasterMap data={data} region={region} run={run} dayIdx={dayIdx} REGIONS={REGIONS} TOTAL_STEPS={TOTAL_STEPS} STEPS_PER_DAY={STEPS_PER_DAY} useTCMTheme={useTCMTheme} stepLabel={stepLabel} regionLabel={(REGIONS[region]||{}).label||region} onInspect={setPin} pin={pin} enableSearch enableLocate enableFullscreen captureRef={mapCaptureRef} />}
      {isTempView && <TemperatureMap data={data} region={region} dayIdx={dayIdx} tempMode={viewMode==='temp-min'?'min':'max'} onClickPoint={onClickPoint} onInspect={setPin} pin={pin} enableSearch enableLocate enableFullscreen captureRef={mapCaptureRef} showLocations={showTempLocations} showGrid={showTempGrid} showExtreme={showTempExtreme} />}
      {isHocoView && <HOCOMap region={region} dayIdx={dayIdx} onClickPoint={onClickPoint} onInspect={setPin} pin={pin} enableSearch enableLocate enableFullscreen captureRef={mapCaptureRef} />}

      {/* control bar — top-right in radar view (avoids the bottom timeline) */}
      <div {...stopBar} style={{ ...(viewMode==='radar' ? { top:10, right:10, bottom:'auto', transform:'none', left:'auto' } : { bottom: isMobile?52:12, left:'50%', transform:'translateX(-50%)' }), position:'absolute', maxWidth:'calc(100% - 24px)', zIndex:820, display:'flex', gap:6 }}>
        <div style={{ position:'relative', display:'flex', gap:6 }}>
          {/* View picker — grouped so Temperature is always one tap away */}
          <button onClick={() => setMapPanel(p => p==='view'?null:'view')} title="Choose the map view" style={barPill(mapPanel==='view', '#a78bfa')}>
            {(() => { const vm = VIEW_MODES.find(v => v.id === viewMode); const VIcon = vm?.icon || Layers; return <><VIcon style={{ width:13, height:13 }} />{VM_SHORT[viewMode] || vm?.label || 'View'}</>; })()}
            <ChevronDown style={{ width:11, height:11, opacity:0.7, transform: mapPanel==='view'?'rotate(180deg)':'none', transition:'transform 0.18s' }} />
          </button>
          {mapPanel==='view' && (
            <div style={{ ...barPanel, right:'auto', left:0, minWidth:232, maxWidth:292, gap:11 }}>
              {[
                { group:'Convective risk',   color:'#a78bfa', ids:['probability','outlook','hires','admin-outlook'] },
                { group:'Animation & radar', color:'#38bdf8', ids:['animated','radar'] },
                { group:'Temperature',       color:'#f97316', ids:['temp-max','temp-min'] },
                { group:'Lightning · HOCO',  color:'#818cf8', ids:['hoco'] },
              ].map(sec => (
                <div key={sec.group} style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  <div style={{ fontSize:'0.56rem', fontWeight:800, color:sec.color, textTransform:'uppercase', letterSpacing:'0.10em' }}>{sec.group}</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    {sec.ids.map(id => { const vm = VIEW_MODES.find(v => v.id===id); if (!vm) return null; const VIcon = vm.icon; const on = viewMode===id; return (
                      <button key={id} onClick={() => { setViewModeAndNotify(id); setMapPanel(null); }} title={vm.desc}
                        style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 10px', borderRadius:8, fontSize:'0.68rem', fontWeight:800, cursor:'pointer', whiteSpace:'nowrap', background: on?`${sec.color}30`:'rgba(255,255,255,0.05)', color: on?sec.color:'#cbd5e1', border:`1px solid ${on?sec.color:'rgba(255,255,255,0.10)'}` }}>
                        <VIcon style={{ width:12, height:12 }} />{vm.label}
                      </button>
                    ); })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setMapPanel(p => p==='layers'?null:'layers')} title="Layers, overlays & lightning" style={barPill(mapPanel==='layers', '#38bdf8')}>
            <Layers style={{ width:13, height:13 }} />{!isMobile && 'Layers'}
          </button>
          <button onClick={() => setMapPanel(p => p==='export'?null:'export')} title="Export the map" style={barPill(mapPanel==='export', '#22c55e')}>
            <Download style={{ width:13, height:13 }} />{!isMobile && 'Export'}
          </button>

          {mapPanel==='layers' && (
            <div style={barPanel}>
              {isTempView && (<>
                <div style={{ fontSize:'0.58rem', fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.10em' }}>Temperature display</div>
                <button onClick={() => setShowTempLocations(v => !v)} style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 9px', borderRadius:8, cursor:'pointer', background: showTempLocations?'rgba(56,189,248,0.20)':'rgba(255,255,255,0.05)', border:`1px solid ${showTempLocations?'#38bdf8':'rgba(255,255,255,0.10)'}`, color:'#38bdf8', fontSize:'0.72rem', fontWeight:800 }}>
                  <MapPin style={{ width:12, height:12 }} /> Town readouts {showTempLocations ? 'On' : 'Off'}
                </button>
                <button onClick={() => setShowTempGrid(v => !v)} style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 9px', borderRadius:8, cursor:'pointer', background: showTempGrid?'rgba(56,189,248,0.20)':'rgba(255,255,255,0.05)', border:`1px solid ${showTempGrid?'#38bdf8':'rgba(255,255,255,0.10)'}`, color:'#38bdf8', fontSize:'0.72rem', fontWeight:800 }}>
                  <MapIcon style={{ width:12, height:12 }} /> Grid numbers {showTempGrid ? 'On' : 'Off'}
                </button>
                <button onClick={() => setShowTempExtreme(v => !v)} style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 9px', borderRadius:8, cursor:'pointer', background: showTempExtreme?(viewMode==='temp-min'?'rgba(56,189,248,0.22)':'rgba(244,63,94,0.20)'):'rgba(255,255,255,0.05)', border:`1px solid ${showTempExtreme?(viewMode==='temp-min'?'#38bdf8':'#f43f5e'):'rgba(255,255,255,0.10)'}`, color: viewMode==='temp-min'?'#38bdf8':'#f43f5e', fontSize:'0.72rem', fontWeight:800 }}>
                  <Sun style={{ width:12, height:12 }} /> {viewMode==='temp-min' ? 'Coldest point ★' : 'Hottest point ★'} {showTempExtreme ? 'On' : 'Off'}
                </button>
                <p style={{ margin:'2px 0 0', fontSize:'0.6rem', color:'#64748b', lineHeight:1.4 }}>Turn town readouts + grid off for the plain colour surface. The ★ marks the day's {viewMode==='temp-min' ? 'coldest' : 'hottest'} point.</p>
              </>)}
              {overlayVisible && (<>
                <div style={{ fontSize:'0.58rem', fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.10em' }}>Overlay layer</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {[{ id:'none', label:'None' },{ id:'outlook', label:'Outlook' },{ id:'admin-outlook', label:'Admin' },{ id:'hd-fill', label:'HD risk' },{ id:'hd-boxes', label:'HD boxes' }].filter(o => o.id==='none' || o.id!==viewMode).map(o => (
                    <button key={o.id} onClick={() => setOverlayMode(o.id)} style={{ padding:'5px 9px', borderRadius:7, fontSize:'0.66rem', fontWeight:700, cursor:'pointer', background: overlayMode===o.id?'rgba(56,189,248,0.25)':'rgba(255,255,255,0.05)', color: overlayMode===o.id?'#38bdf8':'#94a3b8', border:`1px solid ${overlayMode===o.id?'rgba(56,189,248,0.4)':'rgba(255,255,255,0.08)'}` }}>{o.label}</button>
                  ))}
                </div>
                <div style={{ height:1, background:'rgba(255,255,255,0.08)', margin:'2px 0' }} />
              </>)}
              {!isTempView && !isHocoView && (
              <button onClick={() => setShowLightning(s => !s)} style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 9px', borderRadius:8, cursor:'pointer', background: showLightning?'rgba(245,158,11,0.20)':'rgba(255,255,255,0.05)', border:`1px solid ${showLightning?'#f59e0b':'rgba(255,255,255,0.10)'}`, color:'#f59e0b', fontSize:'0.72rem', fontWeight:800 }}>
                <Zap style={{ width:12, height:12 }} /> {showLightning ? 'Lightning On' : 'Lightning Off'}
              </button>
              )}
              {!isTempView && !isHocoView && showLightning && (<>
                <div style={{ fontSize:'0.58rem', fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.10em', marginTop:2 }}>Strike colour</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                  {LIVE_STRIKE_COLOUR_OPTIONS.map(opt => (
                    <button key={opt.id} onClick={() => setStrikeColour(opt.id)} title={opt.label} style={{ width:22, height:22, borderRadius:6, cursor:'pointer', padding:0, background: opt.preview || opt.hex, border:`2px solid ${strikeColour===opt.id?'#fff':'transparent'}`, boxShadow: strikeColour===opt.id?'0 0 0 1px rgba(255,255,255,0.5)':'none' }} />
                  ))}
                </div>
                <div style={{ display:'flex', gap:4 }}>
                  {[{ id:'none', label:'No line' },{ id:'black', label:'Black' },{ id:'white', label:'White' }].map(opt => (
                    <button key={opt.id} onClick={() => setStrikeStroke(opt.id)} style={{ flex:1, padding:'4px 6px', borderRadius:6, fontSize:'0.62rem', fontWeight:700, cursor:'pointer', background: strikeStroke===opt.id?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.04)', color: strikeStroke===opt.id?'#f1f5f9':'#64748b', border:`1px solid ${strikeStroke===opt.id?'rgba(255,255,255,0.25)':'transparent'}` }}>{opt.label}</button>
                  ))}
                </div>
              </>)}
            </div>
          )}
          {mapPanel==='export' && (
            <div style={barPanel}>
              <button onClick={handleExport} disabled={exporting} style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 10px', borderRadius:8, cursor:exporting?'wait':'pointer', background:'rgba(56,189,248,0.12)', border:'1px solid rgba(56,189,248,0.3)', color:'#38bdf8', fontSize:'0.74rem', fontWeight:800, opacity:exporting?0.6:1 }}>
                {exporting ? <Loader2 className="animate-spin" style={{ width:13, height:13 }} /> : <FileText style={{ width:13, height:13 }} />} Export full PDF report
              </button>
              <button onClick={handleDownloadPNG} disabled={exporting} style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 10px', borderRadius:8, cursor:exporting?'wait':'pointer', background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.3)', color:'#22c55e', fontSize:'0.74rem', fontWeight:800, opacity:exporting?0.6:1 }}>
                <Download style={{ width:13, height:13 }} /> Save map as PNG
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Pin-point 3-day forecast card */}
    {pin && <PinForecastCard pin={pin} data={data} riskType={riskType} run={run} region={region} t={t} onClose={() => setPin(null)} onFullDetail={() => onClickPoint?.([pin.lat, pin.lon])} />}

    {/* PNG Export Modal — rendered outside the map stage so it's not clipped */}
    <PngExportModal
      open={pngModalOpen}
      onClose={() => setPngModalOpen(false)}
      onExport={handlePngExport}
      data={data}
      region={region}
      riskType={riskType}
      dayIdx={dayIdx}
      run={run}
      strikes={liveStrikes}
      savedOutlooks={savedOutlooks}
    />
    </>
  );
}

/* Tiny overlay that renders today's lightning strikes on top of any map */
// ── Today's UK & Ireland strikes from the Met Office LEELA feed (same source as TCM NOVA).
// Covers the whole UK day since 00:00 regardless of whether anyone had the page open;
// merged with the live Blitzortung stream for the newest seconds.
async function fetchLeelaToday() {
  const r = await fetch('/api/nova/lightning/day', { cache: 'no-store' });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.strikes || []).map(([t, lat, lon]) => ({
    time: t, lat, lon, provider: 'metoffice-leela', dedup_key: `${Math.round(t / 1000)}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
  }));
}

function LightningOverlay({ projector, bbox, containerW, containerH, strikeColour = 'age', strikeStroke = 'none' }) {
  const [strikes, setStrikes] = useState([]);
  const [now, setNow] = useState(Date.now());

  // Merge an array of server strikes into the shared localStorage cache + state
  const mergeServerStrikes = useCallback((serverStrikes) => {
    if (!serverStrikes?.length) return;
    setStrikes(prev => {
      const merged = new Map();
      for (const s of [...prev, ...serverStrikes]) {
        if (!s || s.lat == null || s.lon == null || !s.time) continue;
        const k = s.dedup_key || `${Math.round(s.time/1000)}_${(s.lat).toFixed(3)}_${(s.lon).toFixed(3)}`;
        if (!merged.has(k)) merged.set(k, s);
      }
      const out = [...merged.values()].sort((a,b) => a.time - b.time);
      // Write merged result back so subsequent loads are fast
      saveTodayStrikes(out);
      return bbox
        ? out.filter(s => s.lat >= bbox.latMin && s.lat <= bbox.latMax && s.lon >= bbox.lonMin && s.lon <= bbox.lonMax)
        : out;
    });
  }, [bbox]);

  const reload = useCallback(() => {
    setStrikes(loadTodayStrikes(bbox));
    setNow(Date.now());
  }, [bbox]);

  useEffect(() => {
    // 1. Load from localStorage immediately
    reload();

    // 2. Every UK & Ireland strike since 00:00 from the Met Office feed (as TCM NOVA), plus
    //    the server's own archive for other regions; refreshed every 3 minutes.
    let cancelled = false;
    const region = bbox && bbox.lonMax < 10 ? 'uk' : 'europe';
    const pullServer = () => {
      if (region === 'uk') fetchLeelaToday().then((srv) => { if (!cancelled) mergeServerStrikes(srv); }).catch(() => {});
      base44.functions.invoke('historicalLightning', { region, daysBack: 0 })
        .then(res => { if (!cancelled) mergeServerStrikes(res?.data?.strikes || res?.strikes || []); })
        .catch(() => {});
    };
    pullServer();
    const ivServer = setInterval(pullServer, 3 * 60_000);

    // 3. Poll localStorage every 10s to pick up TCM live WS strikes
    const iv = setInterval(reload, 10_000);

    // 4. Refresh immediately when TCM writes to localStorage (same tab cross-component,
    //    or cross-tab via storage event)
    const onStorage = (e) => {
      if (e.key === STRIKE_CACHE_KEY || e.key === 'tcm_today_strikes') reload();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      clearInterval(iv);
      clearInterval(ivServer);
      window.removeEventListener('storage', onStorage);
    };
  }, [reload, mergeServerStrikes, bbox]);

  // Refresh age-colours every 60s without hitting localStorage
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);

  if (!projector || !strikes.length) return null;

  const count = strikes.length;
  const pillX = (containerW || 600) - 12;
  const pillY = 12;
  const pillW = count >= 10000 ? 90 : count >= 1000 ? 80 : count >= 100 ? 72 : 64;
  const pillH = 22;
  const pillAccent = strikeColour === 'age' ? '#f97316'
    : (LIVE_STRIKE_COLOUR_OPTIONS.find(o => o.id === strikeColour)?.hex || '#f97316');

  // Stroke attrs
  const strokeColor = strikeStroke === 'black' ? 'rgba(0,0,0,0.85)'
    : strikeStroke === 'white' ? 'rgba(255,255,255,0.90)'
    : 'transparent';
  const strokeW = strikeStroke === 'none' ? 0 : 0.8;

  return (
    <g pointerEvents="none">
      {strikes.map((s, i) => {
        const [x, y] = projector.project(s.lat, s.lon);
        const col = getStrikeColor(s.time, strikeColour);
        const ageMin = (now - s.time) / 60000;
        const r = ageMin < 5 ? 3.2 : ageMin < 30 ? 2.6 : 2.0;
        return (
          <circle
            key={`ls-${s.time}-${i}`}
            cx={x.toFixed(1)} cy={y.toFixed(1)}
            r={r} fill={col} opacity={0.92}
            stroke={strokeColor} strokeWidth={strokeW}
          />
        );
      })}
      {/* Strike counter pill */}
      <rect
        x={pillX - pillW} y={pillY}
        width={pillW} height={pillH} rx={11}
        fill="rgba(6,10,24,0.82)" stroke={pillAccent + '99'} strokeWidth={1}
      />
      <text
        x={pillX - pillW / 2} y={pillY + pillH / 2}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={10} fontWeight={700} fontFamily="DM Mono,monospace"
        fill={pillAccent} letterSpacing="0.04em"
      >
        {`⚡ ${count >= 1000 ? (count / 1000).toFixed(1) + 'k' : count}`}
      </text>
    </g>
  );
}

// DaySelector now lives in components/tcm/DaySelectorCards.jsx

/* ═══════════════════════════════════════════════════════════════════════════
   RISK LEGEND CARD — uses exact screenshot colours
═══════════════════════════════════════════════════════════════════════════ */
// ── TCM engine-version switcher (V3 live · V5 in development) ─────────────────
function TcmVersionSwitcher() {
  const { t, lightMode } = useTCMTheme();
  const [open, setOpen] = useState(false);
  const rowBase = { display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px', borderRadius: 10, textAlign: 'left', width: '100%' };
  return (
    <div style={{ position: 'relative' }}>
      <button className="tcmx-cmd-btn" onClick={() => setOpen((o) => !o)}
        style={{ background: open ? 'rgba(129,140,248,0.16)' : 'transparent', border: `1px solid ${open ? 'rgba(129,140,248,0.45)' : t.cardBorder}`, color: open ? '#818cf8' : t.textMuted }}>
        <Layers style={{ width: 13, height: 13 }} /> TCM V3
        <ChevronDown style={{ width: 13, height: 13, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 268, zIndex: 60, padding: 8, borderRadius: 14, background: lightMode ? '#ffffff' : '#0f1a30', border: `1px solid ${t.cardBorder}`, boxShadow: '0 20px 48px rgba(2,6,15,0.55)' }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.textMuted, margin: '2px 4px 7px', fontFamily: "'DM Mono',monospace" }}>Engine Version</div>
          {/* V3 — selected */}
          <button onClick={() => setOpen(false)} style={{ ...rowBase, cursor: 'pointer', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, background: '#38bdf8', boxShadow: '0 0 7px #38bdf8', flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 800, color: t.textPrimary }}>TCM V3
                <span style={{ fontSize: '0.52rem', fontWeight: 800, letterSpacing: '0.06em', color: '#38bdf8', background: 'rgba(56,189,248,0.16)', border: '1px solid rgba(56,189,248,0.4)', padding: '1px 6px', borderRadius: 99 }}>SELECTED</span>
              </span>
              <span style={{ display: 'block', fontSize: '0.66rem', color: t.textMuted, marginTop: 2, lineHeight: 1.4 }}>Current production engine.</span>
            </span>
          </button>
          {/* V5 — disabled / in development */}
          <div aria-disabled="true" style={{ ...rowBase, marginTop: 5, opacity: 0.8, cursor: 'not-allowed', background: 'rgba(148,163,184,0.06)', border: `1px solid ${t.cardBorder}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, background: t.textMuted, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 800, color: t.textSecondary }}>TCM NOVA
                <span style={{ fontSize: '0.52rem', fontWeight: 800, letterSpacing: '0.06em', color: '#f59e0b', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.35)', padding: '1px 6px', borderRadius: 99 }}>SOON</span>
              </span>
              <span style={{ display: 'block', fontSize: '0.66rem', color: t.textMuted, marginTop: 3, lineHeight: 1.45 }}>
                Currently in Development. More info on the <a href="https://x.com/MyWeatherUK" target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', fontWeight: 700, textDecoration: 'underline' }}>MyWeatherUK</a> X page.
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function RiskLegend({ riskType }) {
  const { t } = useTCMTheme();
  const [open, setOpen] = useState(false);
  const riskMeta = RISK_TYPES.find((r) => r.id === riskType);

  // Keyed by INTERNAL level so nothing downstream has to change.
  const descriptions = {
    'Very Low': 'General (non-severe) thunderstorms. A stray, short-lived cell or two during the warmest part of the afternoon, with the vast majority of places staying dry. Expect the odd distant rumble and a brief downpour from an isolated shower — lightning is sparse and widely scattered. No disruption expected; outdoor plans are safe, with only a small chance of catching a passing shower.',
    'Low': 'Isolated severe storms are possible, but limited in coverage, duration and intensity. Most cells stay below severe limits — where one does go up, expect a sharp 15–30 minute burst of heavy rain, gusty winds and occasional close lightning before it drifts on. Storms are disorganised and short-lived, so the main nuisance is a sudden downpour rather than any lasting impact.',
    'Marginal': 'Scattered severe storms, generally short-lived and not widespread. Several areas see repeated activity into the evening, with frequent lightning, small hail, torrential rain capable of briefly flooding roads and drains, and gusts of 40–50 mph in the strongest cells. A genuine severe threat — keep an eye on the sky and have a backup plan for anything outdoors.',
    'Slight': 'Numerous severe storms, more persistent and more widespread. Organised multi-cell clusters are likely, some lasting for hours. Expect frequent cloud-to-ground lightning, hail up to ~2 cm, damaging downpours with surface-water flooding, and squally gusts to 55 mph. Cells can merge into lines and cross the same areas twice — take lightning safety seriously and avoid exposed high ground while storms are active.',
    'Moderate': 'Widespread severe storms likely, several long-lived and intense. Well-organised convection — possibly including supercells — brings large hail (2–4 cm), damaging straight-line winds (55–70 mph), dangerously frequent lightning and flash flooding from slow-moving cells. Real impacts to travel, property and outdoor events are likely along storm tracks. Have a plan, secure loose items, and monitor official warnings closely.',
    'High': 'A severe weather outbreak — widespread, long-lived and particularly intense storms. Supercells and squall lines carry very large hail (4–6 cm+), destructive winds (70 mph+), an elevated tornado risk, near-continuous lightning and life-threatening flash floods. Widespread disruption and structural damage are possible. Avoid travelling while storms are ongoing and be ready to shelter indoors, away from windows, at short notice.',
    'Severe': 'The black hatching flags a SEVERE THUNDERSTORM threat at this location — violent supercells, giant hail, destructive winds or tornadoes — and can overlay ANY band from TSTM to HIGH, pinpointing where the very worst cells are most likely. Where it coincides with a storm, impacts can be extreme and life-threatening. Follow official warnings and take cover immediately if one approaches.'
  };

  return (
    <Card style={{ padding: 14, marginBottom: 20 }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', userSelect:'none' }}>
        <div style={{ width:32, height:32, borderRadius:9, background:`${riskMeta?.color}18`, border:`1px solid ${riskMeta?.color}44`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          {riskMeta && <riskMeta.icon style={{ width:15, height:15, color:riskMeta.color }} />}
        </div>
        <div>
          <div style={{ fontSize:'0.84rem', fontWeight:700, color:t.textPrimary }}>{riskMeta?.label} Risk Scale</div>
          <div style={{ fontSize:'0.62rem', color:t.textMuted, marginTop:1 }}>
            {open ? 'Click to collapse' : 'Click to expand risk level descriptions'}
          </div>
        </div>
        <div style={{ flex:1 }} />
        <ChevronDown style={{ width:16, height:16, color:t.textMuted, transform:open?'rotate(180deg)':'none', transition:'transform .2s' }} />
      </div>

      {/* Compact colour strip — always visible */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {LEGEND_BANDS.map(({ level, code }) => {
          const pal = getPalette(riskType, level);
          return (
            <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: pal.fill, border: `2px solid ${pal.border}`, borderRadius: 99, fontSize: '0.68rem', fontWeight: 800, color: t.textPrimary }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: pal.border }} />
              {code}
            </div>);
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.55) 0px, rgba(0,0,0,0.55) 2px, transparent 2px, transparent 6px)', border: '2px solid rgba(0,0,0,0.75)', borderRadius: 99, fontSize: '0.68rem', fontWeight: 800, color: t.textPrimary }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(0,0,0,0.75)' }} />SVR
        </div>
      </div>

      <AnimatePresence>
        {open &&
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LEGEND_BANDS.map(({ level, code, min, max }) => {
              const pal = getPalette(riskType, level);
              return (
                <div key={level} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${t.cardBorder}`, borderRadius: 8 }}>
                    <span style={{ width: 30, height: 14, borderRadius: 99, background: pal.border, flexShrink: 0, marginTop: 3, boxShadow: `0 0 8px ${pal.border}55` }} />
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: t.textPrimary, display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                        <span style={{ fontFamily: "'DM Mono',monospace", color: pal.border, letterSpacing:'0.05em' }}>{code}</span>
                        <span>{riskName(level)}</span>
                        <span style={{ fontFamily: "'DM Mono',monospace", color: t.textMuted, fontSize: '0.65rem', fontWeight: 600 }}>{min}–{max}%</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: t.textSecondary, marginTop: 3, lineHeight: 1.55 }}>{descriptions[level] ?? ''}</div>
                    </div>
                  </div>);
            })}
              {/* Severe Thunderstorms hatching entry */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 11px', background: 'rgba(0,0,0,0.10)', border: '1px solid rgba(0,0,0,0.35)', borderRadius: 8 }}>
                <span style={{ width: 30, height: 14, borderRadius: 99, flexShrink: 0, marginTop: 3, background: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.75) 0px, rgba(0,0,0,0.75) 2px, rgba(226,232,240,0.85) 2px, rgba(226,232,240,0.85) 5px)', border: '1.5px solid rgba(0,0,0,0.7)' }} />
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: t.textPrimary, display:'flex', alignItems:'center', gap:7 }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", letterSpacing:'0.05em' }}>SVR</span>
                    <span>Severe Thunderstorms</span>
                    <span style={{ fontFamily: "'DM Mono',monospace", color: t.textMuted, fontSize: '0.65rem', fontWeight: 600 }}>hatched</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: t.textSecondary, marginTop: 3, lineHeight: 1.55 }}>{descriptions['Severe']}</div>
                </div>
              </div>
            </div>
          </motion.div>
        }
      </AnimatePresence>
    </Card>);
}

/* DayOverview moved to components/tcm/DayOverview.jsx */
import DayOverviewImpl from '@/components/tcm/DayOverview';
function DayOverview(props) {
  const { t, lightMode } = useTCMTheme();
  const impactedLocations = useMemo(
    () => buildImpactedLocations(props.data?.grid || [], props.riskType, props.dayIdx, { getRiskScore, region: props.regionLabel?.toLowerCase().includes('europe') ? 'eu' : 'uk', maxResults: 20 }),
    [props.data, props.riskType, props.dayIdx, props.regionLabel]
  );
  return <DayOverviewImpl {...props} impactedLocations={impactedLocations} t={t} lightMode={lightMode} RISK_TYPES={RISK_TYPES} scoreToLevel={scoreToLevel} getPalette={getPalette} getRiskScore={getRiskScore} generateDayDescription={generateDayDescription} Section={Section} Card={Card} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIGHTNING VERIFICATION — v4
   • Every strike plotted, no per-day cap
   • Time-window picker (date + start/end time)
   • Historical server pull for full-day coverage
   • Heat-map toggle (density kernel on the same map)
   • 30-min ahead forecast auto-generated on mount, refreshed every 5 min
   • Right-click any map point → storm ETA panel
═══════════════════════════════════════════════════════════════════════════ */
const STRIKE_CACHE_KEY = 'tcm_lightning_strikes_today';
const STRIKE_HARD_CAP  = 100_000; // no artificial cap — plots every strike

function ukMidnightMs(now = Date.now()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const g = (k) => Number(f.find((x) => x.type === k).value);
  return now - ((g('hour') * 60 + g('minute')) * 60 + g('second')) * 1000 - (now % 1000);
}

function loadTodayStrikes(bbox = null) {
  try {
    // UK midnight (Europe/London, BST/GMT-aware) — the same "today" TCM NOVA uses.
    const todayStartMs = ukMidnightMs();

    const allRaw = [];

    // ── Source 1: WeatherPatterns / synced key  { date, strikes[] } ─────────
    try {
      const raw = localStorage.getItem(STRIKE_CACHE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) {
          allRaw.push(...p);
        } else if (p && Array.isArray(p.strikes)) {
          // Accept regardless of date field — filter by time below
          allRaw.push(...p.strikes);
        }
      }
    } catch (_) {}

    // ── Source 2: TCM native key — plain array ───────────────────────────────
    // Read ONLY when isC flag is NOT set (i.e. plain format is active)
    try {
      const isCompressed = localStorage.getItem('tcm_today_strikes_isC') === 'true';
      if (!isCompressed) {
        const tcmRaw = localStorage.getItem('tcm_today_strikes');
        if (tcmRaw) {
          const p = JSON.parse(tcmRaw);
          if (Array.isArray(p)) allRaw.push(...p);
          else if (p && Array.isArray(p.strikes)) allRaw.push(...p.strikes);
        }
      } else {
        // ── Source 3: TCM compressed key ──────────────────────────────────
        const compRaw = localStorage.getItem('tcm_today_strikes_c');
        if (compRaw) {
          const compressed = JSON.parse(compRaw);
          if (Array.isArray(compressed)) {
            allRaw.push(...compressed.map(c =>
              Array.isArray(c) ? { lat: c[0], lon: c[1], time: c[2], amp: 0 } : c
            ));
          }
        }
      }
    } catch (_) {}

    // ── Deduplicate + filter to today ────────────────────────────────────────
    const seen = new Set();
    const merged = [];
    for (const s of allRaw) {
      if (!s || s.lat == null || s.lon == null || !s.time) continue;
      // Only keep today's strikes (UTC)
      if (s.time < todayStartMs) continue;
      const k = `${Math.round(s.time / 1000)}_${Math.round(s.lat * 1000)}_${Math.round(s.lon * 1000)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(s);
    }
    merged.sort((a, b) => a.time - b.time);

    if (!bbox) return merged;
    return merged.filter(s =>
      s.lat >= bbox.latMin && s.lat <= bbox.latMax &&
      s.lon >= bbox.lonMin && s.lon <= bbox.lonMax
    );
  } catch { return []; }
}
function saveTodayStrikes(strikes) {
  try {
    localStorage.setItem(STRIKE_CACHE_KEY, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      strikes: strikes.slice(-STRIKE_HARD_CAP),
    }));
  } catch {}
}

// ── Kernel density estimation for the strike heat-map ─────────────────────
// Builds a canvas-based heat-map from strike lat/lon pairs.
// Returns a data-URL string (or '' if < 2 strikes).
function buildStrikeHeatmap(strikes, projector, w, h) {
  if (!strikes || strikes.length < 2 || !projector) return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const r = Math.max(14, Math.round(Math.min(w, h) / 60)); // kernel radius
    ctx.globalCompositeOperation = 'lighter';
    for (const s of strikes) {
      const [x, y] = projector.project(s.lat, s.lon);
      if (x < -r || x > w + r || y < -r || y > h + r) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0,   'rgba(255,220,0,0.28)');
      g.addColorStop(0.5, 'rgba(255,100,0,0.12)');
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas.toDataURL();
  } catch { return ''; }
}

// ── 30-min storm-ahead forecast ────────────────────────────────────────────
// Computes a simple density-velocity forecast: for each 0.5° grid cell count
// the strikes in the last 10 min and the 10-min-before-that window, estimate
// a motion vector from the shift of the density centroid, then project each
// cell's count forward 30 min. Returns an array of {lat, lon, score} cells.
function build30MinForecast(strikes, bbox) {
  if (!strikes || strikes.length < 5) return [];
  const now = Date.now();
  const t1end   = now;
  const t1start = now - 10 * 60_000;
  const t0end   = t1start;
  const t0start = now - 20 * 60_000;
  const CELL = 0.5; // deg

  function cellKey(lat, lon) {
    return `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
  }
  function centroid(cells) {
    let swLat = 0, swLon = 0, tot = 0;
    for (const [k, n] of cells) {
      const [r, c] = k.split(',').map(Number);
      swLat += (r * CELL + CELL / 2) * n;
      swLon += (c * CELL + CELL / 2) * n;
      tot += n;
    }
    return tot ? [swLat / tot, swLon / tot] : null;
  }

  const w0 = new Map(), w1 = new Map();
  for (const s of strikes) {
    const k = cellKey(s.lat, s.lon);
    if (s.time >= t0start && s.time < t0end) w0.set(k, (w0.get(k) || 0) + 1);
    if (s.time >= t1start && s.time < t1end) w1.set(k, (w1.get(k) || 0) + 1);
  }
  if (!w1.size) return [];

  const c0 = centroid([...w0.entries()]);
  const c1 = centroid([...w1.entries()]);
  // Motion vector in deg per 30 min (3× the 10-min displacement)
  const dLat = c0 && c1 ? (c1[0] - c0[0]) * 3 : 0;
  const dLon = c0 && c1 ? (c1[1] - c0[1]) * 3 : 0;

  const forecast = [];
  for (const [k, n] of w1.entries()) {
    const [r, c] = k.split(',').map(Number);
    const lat = r * CELL + CELL / 2 + dLat;
    const lon = c * CELL + CELL / 2 + dLon;
    if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) continue;
    // score proportional to recent density, decays with time
    forecast.push({ lat, lon, score: Math.min(100, n * 4) });
  }
  return forecast;
}

function TCMLightningVerification({ data, region, dayIdx, riskType, captureRef, outlookEnabled, isAdmin = false }) {
  const { t, lightMode } = useTCMTheme();
  const bbox = REGIONS[region]?.bbox;
  const internalRef = useRef(null);
  const mapWrapRef  = captureRef || internalRef;

  // ── Strike state ───────────────────────────────────────────────────────
  const [strikes, setStrikes] = useState(() => loadTodayStrikes(bbox));
  const [live,    setLive]    = useState(true);
  const [status,  setStatus]  = useState('idle');
  const freshRef = useRef(new Set());

  // ── Time-window filter ─────────────────────────────────────────────────
  // Default: all of today
  const todayStr = new Date().toISOString().slice(0, 10);
  const [filterDate,  setFilterDate]  = useState(todayStr);
  const [filterStart, setFilterStart] = useState('00:00');
  const [filterEnd,   setFilterEnd]   = useState('23:59');
  const [filterLoading, setFilterLoading] = useState(false);

  // ── Map display options ────────────────────────────────────────────────
  const [showStrikes,  setShowStrikes]  = useState(true);
  const [showHeatmap,  setShowHeatmap]  = useState(false);
  const [heatmapUrl,   setHeatmapUrl]   = useState('');

  // ── 30-min forecast ────────────────────────────────────────────────────
  const [forecast30, setForecast30] = useState([]);
  const [showForecast, setShowForecast] = useState(true);
  const [forecastAge,  setForecastAge]  = useState(null); // ms since last build

  // ── Right-click ETA panel ──────────────────────────────────────────────
  const [etaPanel, setEtaPanel] = useState(null); // { x, y, lat, lon, eta }

  // ── Outlook overlay ────────────────────────────────────────────────────
  const outlookRiskType = riskType;
  const outlookDayIdx   = dayIdx;

  // ── Admin reference image overlay ─────────────────────────────────────
  const ADMIN_OVERLAY_KEY = `tcm_admin_overlay_${region}`;
  const [overlay,          setOverlay]          = useState(() => {
    try { return JSON.parse(localStorage.getItem(ADMIN_OVERLAY_KEY) || 'null'); } catch { return null; }
  });
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false);
  const persistOverlay = useCallback((next) => {
    setOverlay(next);
    try {
      if (next) localStorage.setItem(ADMIN_OVERLAY_KEY, JSON.stringify(next));
      else      localStorage.removeItem(ADMIN_OVERLAY_KEY);
    } catch {}
  }, [ADMIN_OVERLAY_KEY]);

  // ── onStrike — store every single strike, no cap on intra-day deduplicated set ──
  const onStrike = useCallback((s) => {
    freshRef.current.add(s.time);
    setTimeout(() => freshRef.current.delete(s.time), 90_000);
    setStrikes((prev) => {
      const todayStart = new Date(ukMidnightMs());
      const dedup = (x) => x.dedup_key || `${Math.round(x.time / 1000)}_${x.lat.toFixed(3)}_${x.lon.toFixed(3)}`;
      const sKey  = dedup(s);
      const seen  = new Set(prev.map(dedup));
      if (seen.has(sKey)) return prev;
      const next  = [...prev.filter((x) => x.time >= todayStart.getTime()), s].slice(-STRIKE_HARD_CAP);
      saveTodayStrikes(next);
      return next;
    });
  }, []);

  useBlitzortung({ enabled: live, bbox, onStrike, onStatus: setStatus });

  // Reload strikes when region changes
  useEffect(() => { setStrikes(loadTodayStrikes(bbox)); }, [region]);

  // ── Historical server pull — every 5 min ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      if (cancelled) return;
      try {
        const res = await base44.functions.invoke('historicalLightning', { region: region === 'eu' ? 'europe' : 'uk' }).catch(() => null);
        const leela = region === 'eu' ? [] : await fetchLeelaToday().catch(() => []);
        const serverStrikes = [...(res?.data?.strikes || []), ...leela];
        if (cancelled || !serverStrikes.length) return;
        setStrikes((prev) => {
          const merged = new Map();
          for (const s of [...prev, ...serverStrikes]) {
            const k = s.dedup_key || `${Math.round(s.time / 1000)}_${(s.lat || 0).toFixed(3)}_${(s.lon || 0).toFixed(3)}`;
            if (!merged.has(k)) merged.set(k, s);
          }
          const out = [...merged.values()].sort((a, b) => a.time - b.time).slice(-STRIKE_HARD_CAP);
          saveTodayStrikes(out);
          return out;
        });
      } catch (e) { console.warn('[historicalLightning] failed:', e?.message); }
    };
    pull();
    const id = setInterval(pull, 3 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [region]);

  // ── 30-min forecast — build on mount, refresh every 5 min ─────────────
  useEffect(() => {
    const build = () => {
      const fc = build30MinForecast(strikes, bbox);
      setForecast30(fc);
      setForecastAge(Date.now());
    };
    build();
    const id = setInterval(build, 5 * 60_000);
    return () => clearInterval(id);
  }, [strikes, bbox]);

  // ── Time-window fetch from server (when user picks a custom date/time) ─
  const loadCustomWindow = useCallback(async () => {
    setFilterLoading(true);
    try {
      const startMs = new Date(`${filterDate}T${filterStart}:00Z`).getTime();
      const endMs   = new Date(`${filterDate}T${filterEnd}:00Z`).getTime();
      if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return;

      // Check if it's today — use local cache first
      const isToday = filterDate === todayStr;
      if (isToday) {
        const todayCache = loadTodayStrikes(bbox);
        const windowed = todayCache.filter((s) => s.time >= startMs && s.time <= endMs);
        setStrikes(windowed);
        return;
      }
      // Historical date — fetch from server using daysBack
      const dayStart = new Date(`${filterDate}T00:00:00Z`);
      const today    = new Date(); today.setUTCHours(0, 0, 0, 0);
      const daysBack = Math.round((today.getTime() - dayStart.getTime()) / 86400_000);
      if (daysBack < 0 || daysBack > 7) return; // only 7-day history available
      const res = await base44.functions.invoke('historicalLightning', {
        region: region === 'eu' ? 'europe' : 'uk',
        daysBack,
      });
      const all = res?.data?.strikes || [];
      setStrikes(all.filter((s) =>
        s.time >= startMs && s.time <= endMs &&
        s.lat >= bbox.latMin && s.lat <= bbox.latMax &&
        s.lon >= bbox.lonMin && s.lon <= bbox.lonMax
      ));
    } catch (e) {
      console.warn('[customWindow] failed:', e?.message);
    } finally {
      setFilterLoading(false);
    }
  }, [filterDate, filterStart, filterEnd, bbox, region, todayStr]);

  // ── Effective visible strikes (time window) ───────────────────────────
  const effectiveStrikes = useMemo(() => {
    const bboxOnly = strikes.filter((s) =>
      s.lat >= bbox.latMin && s.lat <= bbox.latMax &&
      s.lon >= bbox.lonMin && s.lon <= bbox.lonMax
    );
    // If a custom (non-today) date is loaded, bboxOnly is already filtered
    return bboxOnly;
  }, [strikes, bbox]);

  const now       = Date.now();
  const last30min = useMemo(() => effectiveStrikes.filter((s) => now - s.time < 30 * 60_000), [effectiveStrikes, now]);
  const last1h    = useMemo(() => effectiveStrikes.filter((s) => now - s.time < 60 * 60_000), [effectiveStrikes, now]);

  // ── Heatmap rebuild when strikes or projector changes ─────────────────
  // Defer to next paint so we don't block the render
  const heatProjectorRef = useRef(null);
  useEffect(() => {
    if (!showHeatmap || !heatProjectorRef.current || !effectiveStrikes.length) {
      setHeatmapUrl('');
      return;
    }
    const id = requestAnimationFrame(() => {
      const proj = heatProjectorRef.current;
      if (!proj) return;
      const mapHeight = Math.max(380, Math.min(620, window.innerHeight * 0.6));
      // Use actual map dimensions (approximate w from height + UK aspect ratio)
      const w = Math.round(mapHeight * 0.85);
      const url = buildStrikeHeatmap(effectiveStrikes, proj, w, mapHeight);
      setHeatmapUrl(url);
    });
    return () => cancelAnimationFrame(id);
  }, [showHeatmap, effectiveStrikes]);

  // ── Outlook layers ─────────────────────────────────────────────────────
  const effectiveData = data;
  const gridStep = useMemo(
    () => detectGridStep(effectiveData?.grid || [], REGIONS[region]?.gridStep ?? 1.25),
    [effectiveData, region]
  );
  const outlookLayers = useMemo(() => {
    if (!outlookEnabled || !effectiveData?.grid?.length) return [];
    return buildOutlookLayers(effectiveData.grid, outlookRiskType, outlookDayIdx, gridStep, region)
      .slice().sort((a, b) => (RISK_INDEX[a.level] ?? 0) - (RISK_INDEX[b.level] ?? 0));
  }, [effectiveData, region, outlookDayIdx, outlookRiskType, outlookEnabled, gridStep]);

  const statusColor = {
    live:'#22c55e', connecting:'#eab308', reconnecting:'#eab308',
    error:'#dc2626', disabled:'#64748b', idle:'#64748b',
  }[status] || '#64748b';

  const mapHeight = Math.max(380, Math.min(620, typeof window !== 'undefined' ? window.innerHeight * 0.6 : 520));

  // ── Right-click handler — compute storm ETA for clicked point ─────────
  const handleContextMenu = useCallback((e, projector) => {
    e.preventDefault();
    if (!projector) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const [lat, lon] = projector.unproject(px, py);

    // Find nearest forecast cell
    let nearest = null, bestD = Infinity;
    for (const fc of forecast30) {
      const d = (fc.lat - lat) ** 2 + (fc.lon - lon) ** 2;
      if (d < bestD) { bestD = d; nearest = fc; }
    }

    // Find nearest recent strike cluster
    const recent = effectiveStrikes.filter((s) => now - s.time < 20 * 60_000);
    let nearestStrike = null, bestSD = Infinity;
    for (const s of recent) {
      const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
      if (d < bestSD) { bestSD = d; nearestStrike = s; }
    }

    let eta = null;
    if (nearest && nearest.score > 15) {
      // Forecast cell is within 30 min if score is present
      eta = `Storm activity expected within 30 min (confidence: ${nearest.score > 60 ? 'High' : nearest.score > 30 ? 'Moderate' : 'Low'})`;
    } else if (nearestStrike && bestSD < 1.0) {
      const km = Math.sqrt(bestSD) * 111;
      const ageMin = Math.round((now - nearestStrike.time) / 60_000);
      eta = `Nearest recent strike: ~${km.toFixed(0)} km away, ${ageMin} min ago`;
    } else {
      eta = 'No significant storm activity forecast within 30 min for this area';
    }

    setEtaPanel({ x: px, y: py, lat, lon, eta });
  }, [forecast30, effectiveStrikes, now]);

  return (
    <Section title="Lightning Verification — Live Strike Feed" icon={Zap} accent="#f59e0b"
      extra={
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:'0.7rem', fontWeight:700, color:statusColor, fontFamily:"'DM Mono',monospace" }}>
            <span style={{ width:7, height:7, borderRadius:99, background:statusColor, boxShadow:`0 0 8px ${statusColor}` }} />
            {status.toUpperCase()}
          </span>
          <button onClick={() => setLive((l) => !l)}
            style={{ padding:'5px 9px', borderRadius:8, fontSize:'0.7rem', fontWeight:700, background:live?'rgba(220,38,38,0.15)':'rgba(34,197,94,0.15)', color:live?'#dc2626':'#22c55e', border:`1px solid ${live?'#dc2626':'#22c55e'}40`, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <Radio style={{ width:11, height:11 }} /> {live ? 'Disconnect' : 'Connect'}
          </button>
          <span style={{ fontSize:'0.7rem', fontWeight:700, color:'#a78bfa', fontFamily:"'DM Mono',monospace" }}>
            {last30min.length} last 30m · {last1h.length} last 1h · {effectiveStrikes.length} shown
          </span>
        </div>
      }
    >
      {/* ── Time-window picker ──────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-end', gap:10, marginBottom:12, padding:'10px 14px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:`1px solid ${t.cardBorder}`, flexWrap:'wrap' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:t.textMuted }}>Date</span>
          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
            style={{ padding:'5px 8px', borderRadius:7, border:`1px solid ${t.cardBorder}`, background:'rgba(255,255,255,0.05)', color:t.textPrimary, fontSize:'0.78rem', fontFamily:"'DM Mono',monospace" }} />
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:t.textMuted }}>From (UTC)</span>
          <input type="time" value={filterStart} onChange={(e) => setFilterStart(e.target.value)}
            style={{ padding:'5px 8px', borderRadius:7, border:`1px solid ${t.cardBorder}`, background:'rgba(255,255,255,0.05)', color:t.textPrimary, fontSize:'0.78rem', fontFamily:"'DM Mono',monospace" }} />
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:t.textMuted }}>To (UTC)</span>
          <input type="time" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)}
            style={{ padding:'5px 8px', borderRadius:7, border:`1px solid ${t.cardBorder}`, background:'rgba(255,255,255,0.05)', color:t.textPrimary, fontSize:'0.78rem', fontFamily:"'DM Mono',monospace" }} />
        </div>
        <button onClick={loadCustomWindow} disabled={filterLoading}
          style={{ padding:'6px 14px', borderRadius:8, fontSize:'0.76rem', fontWeight:700, background:'rgba(56,189,248,0.18)', border:'1px solid rgba(56,189,248,0.4)', color:'#38bdf8', cursor:'pointer', display:'flex', alignItems:'center', gap:6, opacity:filterLoading?0.6:1 }}>
          {filterLoading ? <><Loader2 className="animate-spin" style={{ width:12, height:12 }} /> Loading…</> : <><Eye style={{ width:12, height:12 }} /> Load window</>}
        </button>
        <button onClick={() => { setFilterDate(todayStr); setFilterStart('00:00'); setFilterEnd('23:59'); setStrikes(loadTodayStrikes(bbox)); }}
          style={{ padding:'6px 10px', borderRadius:8, fontSize:'0.72rem', fontWeight:700, background:'rgba(255,255,255,0.04)', border:`1px solid ${t.cardBorder}`, color:t.textMuted, cursor:'pointer' }}>
          Reset to today
        </button>
      </div>

      {/* ── Map controls row ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
        <button onClick={() => setShowStrikes((v) => !v)}
          style={{ padding:'5px 10px', borderRadius:8, fontSize:'0.7rem', fontWeight:700, display:'flex', alignItems:'center', gap:5, cursor:'pointer', background:showStrikes?'rgba(250,204,21,0.15)':'rgba(255,255,255,0.04)', border:`1px solid ${showStrikes?'#facc15':t.cardBorder}`, color:showStrikes?'#facc15':t.textMuted }}>
          <Zap style={{ width:11, height:11 }} /> {showStrikes ? 'Strikes On' : 'Strikes Off'}
        </button>
        <button onClick={() => setShowHeatmap((v) => !v)}
          style={{ padding:'5px 10px', borderRadius:8, fontSize:'0.7rem', fontWeight:700, display:'flex', alignItems:'center', gap:5, cursor:'pointer', background:showHeatmap?'rgba(239,68,68,0.15)':'rgba(255,255,255,0.04)', border:`1px solid ${showHeatmap?'#ef4444':t.cardBorder}`, color:showHeatmap?'#ef4444':t.textMuted }}>
          <Activity style={{ width:11, height:11 }} /> {showHeatmap ? 'Heat-map On' : 'Heat-map Off'}
        </button>
        <button onClick={() => setShowForecast((v) => !v)}
          style={{ padding:'5px 10px', borderRadius:8, fontSize:'0.7rem', fontWeight:700, display:'flex', alignItems:'center', gap:5, cursor:'pointer', background:showForecast?'rgba(167,139,250,0.18)':'rgba(255,255,255,0.04)', border:`1px solid ${showForecast?'#a78bfa':t.cardBorder}`, color:showForecast?'#a78bfa':t.textMuted }}>
          <TrendingUp style={{ width:11, height:11 }} /> 30-min Forecast {showForecast ? 'On' : 'Off'}
        </button>
        {forecastAge && (
          <span style={{ fontSize:'0.64rem', color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>
            Forecast: {Math.round((Date.now() - forecastAge) / 60_000)} min ago · auto-updates every 5 min
          </span>
        )}
        <span style={{ fontSize:'0.64rem', color:t.textMuted, marginLeft:'auto' }}>Right-click map for storm ETA</span>
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div style={{ position:'relative' }} ref={mapWrapRef}>
        <TCMLeafletBase bbox={bbox} height={mapHeight} lightMode={lightMode}>
          {({ projector }) => {
            if (!projector) return null;
            // Store projector ref for heatmap generation
            heatProjectorRef.current = projector;
            const { x: w, y: h } = projector.size;

            return (
              <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
                style={{ position:'absolute', inset:0, pointerEvents:'auto', cursor:'crosshair', zIndex:400 }} onWheelCapture={fwdWheel}
                onContextMenu={(e) => handleContextMenu(e, projector)}
                onClick={() => setEtaPanel(null)}
              >
                {/* Outlook polygons */}
                {outlookEnabled && outlookLayers.map((layer, li) => {
                  const items = layer.polygons
                    ? layer.polygons.map((ring) => ringToSvgPath(ring, projector))
                    : layer.clusters.map((cluster) => clusterToPath(cluster, projector, gridStep, layer.level));
                  const pal = getPalette(outlookRiskType, layer.level);
                  return items.map((d, ci) => d && (
                    <path key={`ltg-poly-${li}-${ci}`} d={d}
                      fill={pal.fill} stroke={pal.border} strokeWidth={1.7}
                      strokeLinejoin="round" opacity={(LEVEL_OPACITY[layer.level] ?? 0.7) * 0.75} />
                  ));
                })}

                {/* Strike heat-map — rendered as a foreign image if available */}
                {showHeatmap && heatmapUrl && (
                  <image href={heatmapUrl} x={0} y={0} width={w} height={h}
                    preserveAspectRatio="none" opacity={0.7} pointerEvents="none" />
                )}

                {/* 30-min forecast cells */}
                {showForecast && forecast30.map((fc, i) => {
                  const [cx, cy] = projector.project(fc.lat, fc.lon);
                  const r  = Math.max(6, Math.round(fc.score / 8));
                  const op = 0.15 + (fc.score / 100) * 0.55;
                  return (
                    <circle key={`fc-${i}`} cx={cx} cy={cy} r={r}
                      fill={`rgba(167,139,250,${op})`}
                      stroke="rgba(167,139,250,0.6)" strokeWidth={1}
                      pointerEvents="none">
                      <animate attributeName="r" values={`${r};${r * 1.25};${r}`} dur="2.4s" repeatCount="indefinite" />
                    </circle>
                  );
                })}

                {/* Admin reference image overlay */}
                {overlay?.dataUrl && (() => {
                  const ob = overlay.bbox || bbox;
                  const [x0, y0] = projector.project(ob.latMax, ob.lonMin);
                  const [x1, y1] = projector.project(ob.latMin, ob.lonMax);
                  const ix = Math.min(x0, x1), iy = Math.min(y0, y1);
                  const iw = Math.abs(x1 - x0), ih = Math.abs(y1 - y0);
                  return (
                    <image key="admin-overlay" href={overlay.dataUrl}
                      x={ix} y={iy} width={iw} height={ih}
                      preserveAspectRatio="none" opacity={overlay.opacity ?? 0.55}
                      pointerEvents="none" />
                  );
                })()}

                {/* Lightning strikes — every single one */}
                {showStrikes && effectiveStrikes.map((s, i) => {
                  const [x, y] = projector.project(s.lat, s.lon);
                  const isFresh = freshRef.current.has(s.time);
                  const ageMin  = (now - s.time) / 60_000;
                  const color   = ageMin < 5   ? '#ffffff'
                                : ageMin < 10  ? '#facc15'
                                : ageMin < 30  ? '#f97316'
                                : ageMin < 120 ? '#ef4444'
                                :                '#7c3aed';
                  return (
                    <g key={`${s.time}_${i}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
                      {isFresh && (
                        <circle r={2} fill="none" stroke="#ffffff" strokeWidth={1.4}>
                          <animate attributeName="r" from="2" to="22" dur="0.8s" fill="freeze" />
                          <animate attributeName="opacity" from="0.9" to="0" dur="0.8s" fill="freeze" />
                        </circle>
                      )}
                      <line x1={-4} x2={4} y1={0} y2={0} stroke={color} strokeWidth={1.8} strokeLinecap="round" opacity={0.9} />
                      <line y1={-4} y2={4} x1={0} x2={0} stroke={color} strokeWidth={1.8} strokeLinecap="round" opacity={0.9} />
                    </g>
                  );
                })}

                {/* Right-click ETA panel */}
                {etaPanel && (() => {
                  const px = Math.min(etaPanel.x, w - 220);
                  const py = Math.max(0, etaPanel.y - 70);
                  return (
                    <g key="eta-panel">
                      <rect x={px} y={py} width={210} height={60} rx={8}
                        fill="rgba(10,15,30,0.92)" stroke="rgba(167,139,250,0.6)" strokeWidth={1} />
                      <text x={px + 10} y={py + 18} fontSize={9} fontWeight={700} fill="#a78bfa" fontFamily="DM Mono,monospace">
                        Storm ETA — {etaPanel.lat.toFixed(2)}°N {etaPanel.lon.toFixed(2)}°E
                      </text>
                      <foreignObject x={px + 8} y={py + 24} width={194} height={30}>
                        <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize:'0.62rem', color:'#e2e8f0', lineHeight:1.4, wordBreak:'break-word' }}>
                          {etaPanel.eta}
                        </div>
                      </foreignObject>
                    </g>
                  );
                })()}

                <TitleCard w={Math.max(180, Math.min(360, w - 260))} x={10} y={10}
                  title={`Lightning · ${(REGIONS[region] ?? {}).label ?? region}`}
                  sub={`${effectiveStrikes.length} strikes · ${filterDate} ${filterStart}–${filterEnd} UTC`} />
              </svg>
            );
          }}
        </TCMLeafletBase>

        {/* ── Strike count summary bar ───────────────────────────────── */}
        <div style={{ display:'flex', gap:12, marginTop:10, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:`1px solid ${t.cardBorder}`, flexWrap:'wrap' }}>
          {[
            { label:'Last 5 min',  count:effectiveStrikes.filter((s) => now - s.time < 5 * 60_000).length,   color:'#ffffff' },
            { label:'Last 30 min', count:last30min.length,  color:'#facc15' },
            { label:'Last 1 hr',   count:last1h.length,     color:'#f97316' },
            { label:'Total shown', count:effectiveStrikes.length, color:'#a78bfa' },
          ].map(({ label, count, color }) => (
            <div key={label} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, minWidth:70 }}>
              <span style={{ fontSize:'1.1rem', fontWeight:800, color, fontFamily:"'DM Mono',monospace" }}>{count.toLocaleString()}</span>
              <span style={{ fontSize:'0.58rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:t.textMuted }}>{label}</span>
            </div>
          ))}
          {showForecast && forecast30.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, minWidth:80, marginLeft:'auto' }}>
              <span style={{ fontSize:'1.1rem', fontWeight:800, color:'#a78bfa', fontFamily:"'DM Mono',monospace" }}>{forecast30.length}</span>
              <span style={{ fontSize:'0.58rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:t.textMuted }}>30-min cells</span>
            </div>
          )}
        </div>

        {/* Legend strip */}
        <div style={{ display:'flex', gap:10, marginTop:8, flexWrap:'wrap', alignItems:'center' }}>
          {[
            { label:'< 5 min',   color:'#ffffff' },
            { label:'5–10 min',  color:'#facc15' },
            { label:'10–30 min', color:'#f97316' },
            { label:'30–120 min',color:'#ef4444' },
            { label:'> 2 hr',    color:'#7c3aed' },
            { label:'30-min forecast', color:'rgba(167,139,250,0.7)', dashed: true },
          ].map(({ label, color, dashed }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:5 }}>
              {dashed
                ? <div style={{ width:14, height:14, borderRadius:'50%', border:`2px dashed ${color}`, background:'rgba(167,139,250,0.15)' }} />
                : <div style={{ width:10, height:10, borderRadius:'50%', background:color }} />
              }
              <span style={{ fontSize:'0.63rem', color:t.textMuted }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Admin overlay panel */}
        {isAdmin && (
          <div style={{ marginTop:10, border:'1px dashed rgba(167,139,250,0.35)', borderRadius:10, background:'rgba(167,139,250,0.06)' }}>
            <button onClick={() => setOverlayPanelOpen((o) => !o)}
              style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', background:'transparent', border:'none', cursor:'pointer', color:'#a78bfa', fontSize:'0.74rem', fontWeight:800, fontFamily:"'DM Mono',monospace", letterSpacing:'0.06em' }}>
              <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Activity style={{ width:12, height:12 }} />
                ADMIN · REFERENCE IMAGE OVERLAY {overlay?.dataUrl ? '· ACTIVE' : ''}
              </span>
              <span>{overlayPanelOpen ? '▲' : '▼'}</span>
            </button>
            {overlayPanelOpen && (
              <div style={{ padding:'4px 12px 12px', display:'flex', flexDirection:'column', gap:8 }}>
                <label style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:'0.72rem', color:t.textSecondary, cursor:'pointer' }}>
                  <input type="file" accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file || !file.type.startsWith('image/')) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const dataUrl = ev.target?.result;
                        if (!dataUrl) return;
                        const mid = new Date(); mid.setUTCHours(0, 0, 0, 0);
                        persistOverlay({ dataUrl, startMs: mid.getTime(), endMs: Date.now(), opacity: 0.55, bbox: { ...bbox } });
                      };
                      reader.readAsDataURL(file);
                    }}
                    style={{ fontSize:'0.7rem', color:t.textSecondary }} />
                </label>
                {overlay?.dataUrl && (
                  <button onClick={() => persistOverlay(null)}
                    style={{ padding:'5px 10px', borderRadius:8, fontSize:'0.72rem', fontWeight:700, background:'rgba(220,38,38,0.10)', border:'1px solid rgba(220,38,38,0.30)', color:'#dc2626', cursor:'pointer', width:'fit-content' }}>
                    Remove overlay
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ARCHIVE
   Reads model runs from RiskGridCache (saved by admin's "Run Model" button).
   Each time admin runs the model, saveTCMRunToDB writes two keys:
     tcm_<region>_<YYYY-MM-DDTHH>Z  — per-run snapshot
     tcm_<region>_latest             — always-current latest
   This component lists the per-run entries so there's a real history.
═══════════════════════════════════════════════════════════════════════════ */
function TCMArchive({ region }) {
  const { t } = useTCMTheme();
  const [modelRuns, setModelRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingRuns(true);
    (async () => {
      try {
        // Load the most recent 40 RiskGridCache rows, then filter to this region's
        // per-run entries (exclude the _latest sentinel key).
        const rows = await base44.entities.RiskGridCache.list('-generated_at', 60);
        if (cancelled || !Array.isArray(rows)) return;
        const all = rows.filter(r => r.cache_key?.startsWith(`tcm_${region}_`) && !r.cache_key?.endsWith('_latest') && !r.cache_key?.startsWith(`tcm_drawn_`));
        const archived = all.filter(r => r.cache_key?.startsWith(`tcm_${region}_archive_`));
        const regionRows = archived.length ? archived : all.filter(r => !r.cache_key?.startsWith(`tcm_${region}_archive_`));
        setModelRuns(regionRows.map(r => ({
          cacheKey: r.cache_key,
          generatedAt: r.generated_at,
          modelRun: r.model_run,
          points: r.diagnostics?.points || r.grid_data?.grid?.length || 0,
          source: r.grid_data?.source || 'open-meteo',
        })));
      } catch (e) {
        console.warn('[TCMArchive] Model run load failed:', e?.message);
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    })();
    return () => { cancelled = true; };
  }, [region]);

  const recent = modelRuns.slice(0, 6);

  return (
    <Card style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 18px', borderBottom:`1px solid ${t.cardBorder}`, background:'linear-gradient(135deg,rgba(167,139,250,0.06),transparent)' }}>
        <div style={{ width:28, height:28, borderRadius:8, background:'rgba(167,139,250,0.14)', border:'1px solid rgba(167,139,250,0.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Clock style={{ width:13, height:13, color:'#a78bfa' }} />
        </div>
        <span style={{ fontSize:'0.86rem', fontWeight:700, color:t.textPrimary }}>Model Run Archive</span>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: t.textMuted, marginLeft: 4 }}>
          {loadingRuns ? '…' : `${modelRuns.length} run${modelRuns.length !== 1 ? 's' : ''} saved`}
        </span>
        <div style={{ flex: 1 }} />
        <a href={`/TCMArchive?region=${region}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8, background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)', color: '#38bdf8', fontSize: '0.72rem', fontWeight: 700, textDecoration: 'none' }}>
          View full archive <ChevronRight style={{ width: 11, height: 11 }} />
        </a>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loadingRuns ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 4px' }}>
            <Loader2 className="animate-spin" style={{ width:14, height:14, color:'#38bdf8' }} />
            <span style={{ fontSize:'0.76rem', color:t.textMuted }}>Loading archived runs…</span>
          </div>
        ) : recent.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.78rem', color: t.textMuted, textAlign: 'center', padding: '8px 0' }}>
            No archived model runs yet — admin must press "Run Model" to save a run to the archive.
          </p>
        ) : (
          recent.map((entry, idx) => {
            const genDate = entry.generatedAt ? new Date(entry.generatedAt) : null;
            const label = genDate
              ? genDate.toLocaleString('en-GB', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false }) + ' UTC'
              : (entry.modelRun || entry.cacheKey);
            return (
              <div key={idx} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:10, background:'rgba(255,255,255,0.03)', border:`1px solid ${t.cardBorder}` }}>
                <CheckCircle style={{ width:14, height:14, color:'#22c55e', flexShrink:0 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'0.8rem', fontWeight:700, color:t.textPrimary, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</div>
                  <div style={{ fontSize:'0.66rem', color:t.textMuted, fontFamily:"'DM Mono',monospace", marginTop:2 }}>
                    {entry.points > 0 ? `${entry.points} grid points` : ''}{entry.source ? ` · ${entry.source}` : ''}
                  </div>
                </div>
                <span style={{ fontSize:'0.64rem', color:'#38bdf8', fontFamily:"'DM Mono',monospace", flexShrink:0 }}>
                  {REGIONS[region]?.flag}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN DRAW CANVAS
   Transparent canvas overlay that captures freehand drawing and converts
   pixel paths to lat/lon arrays using the Leaflet projector's unproject().
═══════════════════════════════════════════════════════════════════════════ */
// ── Smoothing helpers ──────────────────────────────────────────────────────
// Ramer–Douglas–Peucker: thins a dense mouse-path to its essential corners
// so Chaikin has fewer points to subdivide and can't create false loops.
function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  let dmax = 0, idx = 0;
  const end = pts.length - 1;
  const dx = pts[end].x - pts[0].x, dy = pts[end].y - pts[0].y;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < end; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + pts[end].x * pts[0].y - pts[end].y * pts[0].x) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const a = rdp(pts.slice(0, idx + 1), eps);
    const b = rdp(pts.slice(idx), eps);
    return [...a.slice(0, -1), ...b];
  }
  return [pts[0], pts[end]];
}
// Chaikin corner-cutting — each pass doubles vertices and rounds all corners.
// 6 passes gives glass-smooth bezier-like curves from any polygon.
function chaikinPts(pts, passes = 6) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const next = [];
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      const a = cur[i], b = cur[(i + 1) % n];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    cur = next;
  }
  return cur;
}
// Build a smooth closed canvas path using Catmull-Rom splines through pts.
function catmullRomPath(ctx, pts) {
  const n = pts.length;
  if (n < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}
// Convert an array of {x,y} pixel points to a smooth closed SVG path string
// using cubic Bézier curves through Catmull-Rom control points.
function smoothSvgPath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = (p1.x + (p2.x - p0.x) / 6).toFixed(1);
    const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(1);
    const cp2x = (p2.x - (p3.x - p1.x) / 6).toFixed(1);
    const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(1);
    d += `C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} `;
  }
  return d + 'Z';
}

function AdminDrawCanvas({ map, projector, color, borderColor, onShapeComplete }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const pixelPts = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const { x: w, y: h } = projector.size;
      canvas.width  = w;
      canvas.height = h;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [projector]);

  useEffect(() => {
    if (!map) return;
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    return () => {
      try { map.dragging.enable(); map.scrollWheelZoom.enable(); } catch {}
    };
  }, [map]);

  const getXY = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pts = pixelPts.current;
    if (pts.length < 3) return;
    // Live preview: Catmull-Rom through raw points — silky smooth while dragging
    ctx.beginPath();
    catmullRomPath(ctx, pts);
    ctx.closePath();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.88;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const onDown = (e) => {
    e.preventDefault();
    drawing.current = true;
    const pt = getXY(e);
    if (pt) pixelPts.current = [pt];
  };
  const onMove = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const pt = getXY(e);
    if (pt) { pixelPts.current.push(pt); redraw(); }
  };
  const onUp = (e) => {
    if (!drawing.current) return;
    drawing.current = false;
    e.preventDefault();
    const raw = pixelPts.current;
    if (raw.length > 4) {
      // 1. Thin the raw samples with RDP (epsilon = 3 px) to remove noise
      const simplified = rdp(raw, 3);
      // 2. Six passes of Chaikin corner-cutting → ultra-smooth polygon
      const smooth = chaikinPts(simplified, 6);
      // 3. Convert pixel → lat/lon for storage
      const latLngs = smooth.map(p => projector.unproject(p.x, p.y));
      onShapeComplete(latLngs, smooth);
    }
    pixelPts.current = [];
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ position:'absolute', inset:0, zIndex:500, cursor:'crosshair', touchAction:'none' }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DB-BACKED RUN SELECTOR
   Shows only admin-saved runs from the database (not fixed 6-hourly slots).
   Auto-refreshes every 60 s so new admin runs appear without page reload.
═══════════════════════════════════════════════════════════════════════════ */
function RunSelector({ region, value, onChange, isAdmin }) {
  const { t } = useTCMTheme();
  const [open, setOpen] = useState(false);
  const [dbRuns, setDbRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const refresh = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const runs = await listRunsFromDB(region);
      setDbRuns(runs);
    } catch {}
    setLoadingRuns(false);
  }, [region]);

  // Load on mount + when region changes; poll every 60 s for new admin runs
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Group by date for display
  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of dbRuns) {
      if (!r.runISO) continue;
      const k = r.runISO.slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [dbRuns]);

  const selectedLabel = value
    ? `${value.toISOString().slice(0,10)} ${value.getUTCHours().toString().padStart(2,'0')}Z`
    : 'Select run';

  const handleDelete = async (r) => {
    try {
      await base44.entities.RiskGridCache.delete(r.id);
      await refresh();
      if (value && r.runISO && new Date(r.runISO).getTime() === value.getTime()) onChange(null);
    } catch {}
    setDeleteConfirm(null);
  };

  return (
    <div style={{ position: 'relative', zIndex: 200 }}>
      <button onClick={() => { setOpen(o => !o); if (!open) refresh(); }}
        style={{ padding:'7px 12px', borderRadius:9, background:'rgba(99,102,241,0.10)', border:'1px solid rgba(99,102,241,0.25)', color:'#818cf8', fontSize:'0.72rem', fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
        <Clock style={{ width:12, height:12 }} />
        {loadingRuns ? <Loader2 className="animate-spin" style={{width:11,height:11}}/> : selectedLabel}
        <ChevronDown style={{ width:12, height:12, transform:open?'rotate(180deg)':'none', transition:'transform .2s' }} />
      </button>
      <AnimatePresence>
        {open &&
        <motion.div initial={{ opacity:0, y:-6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }}
          style={{ position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:9999, minWidth:260, background:'rgba(10,16,32,0.97)', backdropFilter:'blur(14px)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:13, padding:8, maxHeight:340, overflowY:'auto', boxShadow:'0 16px 48px rgba(0,0,0,0.6)' }}>
          <div style={{ padding:'4px 8px 8px', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid rgba(255,255,255,0.06)', marginBottom:6 }}>
            <Database style={{width:11,height:11,color:'#a78bfa'}}/>
            <span style={{ fontSize:'0.6rem', fontWeight:800, color:'#a78bfa', textTransform:'uppercase', letterSpacing:'0.1em' }}>Admin Model Runs</span>
            <span style={{ fontSize:'0.58rem', color:'#475569' }}>{dbRuns.length} saved</span>
            <div style={{flex:1}}/>
            <button onClick={refresh} style={{ background:'none', border:'none', cursor:'pointer', color:'#475569', padding:2 }} title="Refresh">
              <RefreshCw style={{width:10,height:10}}/>
            </button>
          </div>
          {dbRuns.length === 0 && !loadingRuns && (
            <p style={{ margin:'8px', fontSize:'0.7rem', color:'#475569', textAlign:'center' }}>
              No saved runs yet. Admin must press "Run Model" to create runs.
            </p>
          )}
          {grouped.map(([date, runs]) => (
            <div key={date} style={{ marginBottom:6 }}>
              <div style={{ fontSize:'0.6rem', fontWeight:700, color:'#64748b', padding:'3px 8px', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                {new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'short' })}
              </div>
              {runs.map(r => {
                const runDate = r.runISO ? new Date(r.runISO) : null;
                const isActive = runDate && value && runDate.getTime() === value.getTime();
                const genLabel = r.generatedAt
                  ? new Date(r.generatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' UTC'
                  : '';
                return (
                  <div key={r.cacheKey} style={{ display:'flex', alignItems:'center', gap:3 }}>
                    <button
                      onClick={async () => {
                        if (!r.runISO) return;
                        const runObj = new Date(r.runISO);
                        onChange(runObj);
                        // Load payload from DB if not in local cache
                        const local = loadRunFromCache(region, runObj);
                        if (!local && r.cacheKey) {
                          const dbPayload = await loadRunByKeyFromDB(r.cacheKey);
                          if (dbPayload) {
                            saveRunToCache(region, runObj, dbPayload);
                          }
                        }
                        setOpen(false);
                      }}
                      style={{ flex:1, padding:'6px 8px', textAlign:'left', background:isActive?'rgba(56,189,248,0.15)':'transparent', border:'none', borderRadius:6, color:isActive?'#38bdf8':'#cbd5e1', fontSize:'0.74rem', fontWeight:600, cursor:'pointer' }}>
                      <span style={{ fontFamily:"'DM Mono',monospace" }}>
                        {runDate ? runDate.getUTCHours().toString().padStart(2,'0')+'Z UTC' : r.cacheKey}
                      </span>
                      {genLabel && <span style={{ fontSize:'0.58rem', color:'#475569', marginLeft:6 }}>{genLabel}</span>}
                      <span style={{ fontSize:'0.6rem', color:'#334155', marginLeft:6 }}>{r.points} pts</span>
                    </button>
                    {isAdmin && (
                      deleteConfirm === r.cacheKey ? (
                        <button onClick={() => handleDelete(r)} style={{ padding:'3px 7px', borderRadius:5, background:'rgba(239,68,68,0.18)', border:'1px solid rgba(239,68,68,0.4)', color:'#ef4444', fontSize:'0.6rem', cursor:'pointer' }}>✓</button>
                      ) : (
                        <button onClick={() => setDeleteConfirm(r.cacheKey)} style={{ padding:'3px 5px', borderRadius:5, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', color:'#475569', cursor:'pointer' }}>
                          <Trash2 style={{width:9,height:9}}/>
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {deleteConfirm && <button onClick={() => setDeleteConfirm(null)} style={{ fontSize:'0.6rem', color:'#64748b', background:'none', border:'none', cursor:'pointer', padding:'4px 8px' }}>✕ Cancel</button>}
        </motion.div>
        }
      </AnimatePresence>
    </div>
  );
}

/* LocationPanel moved to components/tcm/LocationPanel.jsx */
import LocationPanelImpl from '@/components/tcm/LocationPanel';
function LocationPanel(props) { const { t } = useTCMTheme(); return <LocationPanelImpl {...props} t={t} RISK_TYPES={RISK_TYPES} scoreToLevel={scoreToLevel} getPalette={getPalette} />; }

/* ═══════════════════════════════════════════════════════════════════════════
   HERO + STATUS BAR
═══════════════════════════════════════════════════════════════════════════ */
// TCMHero and DataStatusBar live in components/tcm/TCMHeroSection.jsx

// The TCM hamburger is gone; SiteNav in the layout handles navigation, and its
// menu was page links only (Home, Admin, TCM Lightning/Archive/Verification)
// which SiteNav's Forecast and Verification groups already carry.

/* ═══════════════════════════════════════════════════════════════════════════
   ROOT PAGE
═══════════════════════════════════════════════════════════════════════════ */
/* ─── Error Boundary ─────────────────────────────────────────────────────────
   Catches any render-time JS error and shows a recoverable error UI instead
   of a blank white page. Without this, ANY uncaught render error = blank page.
─────────────────────────────────────────────────────────────────────────── */
class WeatherPatternsErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('[WeatherPatterns] render error:', error, info); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#0a0f1e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>⚡</div>
          <h2 style={{ color: '#f1f5f9', fontFamily: "'DM Sans',sans-serif", fontSize: '1.2rem', fontWeight: 800, marginBottom: 8 }}>
            Weather Patterns failed to load
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.82rem', marginBottom: 20, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.6 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{ padding: '10px 24px', borderRadius: 10, background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: '#818cf8', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}

/**
 * The V3 engine's page.
 *
 * `embedded` is set when TCM Outlooks renders this as its V3 view: that page
 * owns the engine switcher, so this one hides its own rather than showing two
 * that disagree about which engine is selected.
 */
export default function TCMPage({ embedded = false }) {
  return (
    <WeatherPatternsErrorBoundary>
      <TCMThemeProvider>
        <TCMLogoProvider>
          <TCMPageContent embedded={embedded} />
        </TCMLogoProvider>
      </TCMThemeProvider>
    </WeatherPatternsErrorBoundary>
  );
}

function TCMPageContent({ embedded = false }) {
  const { t } = useTCMTheme();

  // Live regions: UK & Ireland and France (switchable via RegionSwitcher). Each
  // region keeps its own fetch + cache; wider Europe is still "coming soon".
  const [region, setRegion] = useState('uk');
  // Region-switch animation: a flag "whoosh" over the map + a quick map zoom.
  const [regionAnim, setRegionAnim] = useState(null);   // { id, flag, label, c1, c2 } | null
  const [mapZoom, setMapZoom] = useState(1);
  const switchRegion = useCallback((r) => {
    if (!r || r === region) return;
    setRegion(r);
    const fx = REGION_FX[r];
    if (fx) setRegionAnim({ id: Date.now(), ...fx });
  }, [region]);
  // Drive the map zoom-out/in + auto-clear the overlay whenever a switch fires.
  useEffect(() => {
    if (!regionAnim) return;
    setMapZoom(0.9);
    const t1 = setTimeout(() => setMapZoom(1), 320);
    const t2 = setTimeout(() => setRegionAnim(null), 1250);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [regionAnim]);
  // Prefetch the OTHER live region's latest run into the in-memory cache so the
  // first switch is instant (no DB round-trip felt by the user).
  useEffect(() => {
    const other = region === 'uk' ? 'fr' : 'uk';
    const id = setTimeout(() => { loadLatestTCMFromDB(other).catch(() => {}); }, 1200);
    return () => clearTimeout(id);
  }, [region]);
  const [riskType, setRiskType] = useState(() => { const h = readHashParams().get('h'); return RISK_TYPES.some(r => r.id === h) ? h : 'thunderstorm'; });
  const [dayIdx, setDayIdx] = useState(() => { const d = parseInt(readHashParams().get('d'), 10); return (d === 0 || d === 1 || d === 2) ? d : 0; });
  // Anchor the page on the MOST RECENT 00/06/12/18 UTC run that has already
  // happened. Earlier code preferred today's 06Z even after 12Z/18Z had
  // passed, which caused the page to show a stale run by default.
  const [run, setRun] = useState(() => utcRunForDate(new Date()));
  const [refreshStartTime, setRefreshStartTime] = useState(null); // set on admin refresh, clears filters Day1
  const [clickPoint, setClickPoint] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [outlookEnabled, setOutlookEnabled] = useState(true);
  // Admin drawn outlooks
  const [showDrawTool, setShowDrawTool] = useState(false);
  const [drawShapes, setDrawShapes] = useState([]); // { riskLevel, color, points, label }
  const [activeDrawLevel, setActiveDrawLevel] = useState('Slight');
  const [drawMode, setDrawMode] = useState(false); const [drawOpacity, setDrawOpacity] = useState(0.85); const [showImpactedModal, setShowImpactedModal] = useState(false);
  const [savedOutlooks, setSavedOutlooks] = useState([]); // from DB
  const [outlookLabel, setOutlookLabel] = useState('');
  const [savingOutlook, setSavingOutlook] = useState(false);
  const [drawOutlookDayIdx, setDrawOutlookDayIdx] = useState(0);
  const [editingOutlookId, setEditingOutlookId] = useState(null);   // id of record being edited, or null for new
  const [activeViewMode, setActiveViewMode] = useState('outlook'); // mirrors MainMapSection viewMode
  // Extended outlook fields
  const [outlookDescription, setOutlookDescription] = useState('');
  const [outlookOverallRisk, setOutlookOverallRisk] = useState('');
  const [outlookPeakWindow, setOutlookPeakWindow] = useState('');
  const [outlookThunderstormOverview, setOutlookThunderstormOverview] = useState('');
  const [outlookForecastType, setOutlookForecastType] = useState('initial'); // 'initial' | 'update'
  const DEFAULT_PEAK_24H_WP = [
    { time: '00:00', label: 'Midnight', risk_level: 'No Risk', activity: 0 },
    { time: '03:00', label: '3am',      risk_level: 'No Risk', activity: 0 },
    { time: '06:00', label: '6am',      risk_level: 'No Risk', activity: 0 },
    { time: '09:00', label: '9am',      risk_level: 'No Risk', activity: 0 },
    { time: '12:00', label: 'Noon',     risk_level: 'No Risk', activity: 0 },
    { time: '15:00', label: '3pm',      risk_level: 'No Risk', activity: 0 },
    { time: '18:00', label: '6pm',      risk_level: 'No Risk', activity: 0 },
    { time: '21:00', label: '9pm',      risk_level: 'No Risk', activity: 0 },
  ];
  const [outlookPeak24h, setOutlookPeak24h] = useState(DEFAULT_PEAK_24H_WP);

  const { data, setData, loading, setLoading, progress, setProgress, error: dataError, retry: retryFetch, dataSource } = useTCMData({
    region, run
  });

  useEffect(() => {isCurrentUserAdmin().then(setIsAdmin);}, []);
  // Load admin-drawn outlooks — show from localStorage immediately, then refresh from DB
  useEffect(() => {
    let cancelled = false;
    // Phase 1: Show from localStorage immediately (instant, no network)
    let hasLSData = false;
    try {
      const lsCached = JSON.parse(localStorage.getItem(`tcm_drawn_outlooks_${region}`) || 'null');
      if (Array.isArray(lsCached) && lsCached.length > 0 && !cancelled) {
        setSavedOutlooks(lsCached);
        hasLSData = true;
      }
    } catch {}
    // Phase 2: Refresh from DB — only update state if DB returns actual rows
    (async () => {
      try {
        const rows = await Promise.race([
          (async () => {
            const dbRows = await base44.entities.RiskGridCache.list('-generated_at', 200);
            if (!Array.isArray(dbRows)) return null;
            return dbRows
              .filter(r => r.cache_key?.startsWith(`tcm_drawn_${region}_`) && !r.cache_key.endsWith('_latest'))
              .map(r => ({
                id:          r.id,
                cacheKey:    r.cache_key,
                isoDate:     r.grid_data?.isoDate || r.cache_key.split('_')[3],
                generatedAt: r.generated_at,
                shapes:      r.grid_data?.shapes || [],
                label:       r.grid_data?.label || '',
                createdAt:   r.grid_data?.createdAt || 0,
                forecastType: r.grid_data?.forecastType || 'initial',
                data:        r.grid_data,
              }));
          })(),
          new Promise(res => setTimeout(() => res(null), 8000)),
        ]);
        if (!cancelled && Array.isArray(rows) && rows.length > 0) {
          setSavedOutlooks(rows);
          try { localStorage.setItem(`tcm_drawn_outlooks_${region}`, JSON.stringify(rows)); } catch {}
        } else if (!cancelled && !hasLSData) {
          // Phase 3: Nothing in full list or LS — try the latest-sentinel as last resort
          // This covers first-time visitors on a new browser
          const latest = await loadLatestAdminOutlookFromDB(region);
          if (!cancelled && latest) {
            setSavedOutlooks([latest]);
          }
        }
      } catch { /* DB unavailable — LS data already shown */ }
    })();
    return () => { cancelled = true; };
  }, [region]);
  useEffect(() => {try {localStorage.setItem('tcm_region', region);} catch {}}, [region]);
  useEffect(() => { pruneOldRuns(); pruneOldForecastRuns(); for (const reg of Object.keys(REGIONS)) { const c = loadCachedTCM(reg); if (c && !isValidCache(c, reg)) { try { localStorage.removeItem(tcmCacheKey(reg)); } catch {} } } }, []);

  // Auto-advance to the latest UTC run whenever a new one comes online (every
  // 6 hours: 00/06/12/18 UTC). Keeps the page on the freshest model output
  // without user interaction.
  useEffect(() => {
    const id = setInterval(() => {
      const n = utcRunForDate(new Date());
      if (n.getTime() !== run.getTime()) setRun(n);
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [run]);

  // NOTE: The scheduled 6-hourly background fetch has been intentionally removed.
  // Data is only refreshed when the admin clicks "Run Model" (handleRerun below).
  // Regular users always see the most recent admin-approved run loaded from
  // localStorage or the DB — never auto-triggered Open-Meteo fetches.

  const dayLabels = [0, 1, 2].map((d) => {
    const x = new Date(run);x.setDate(x.getDate() + d);
    return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : x.toLocaleDateString(undefined, { weekday: 'long' });
  });

  const [runStatus, setRunStatus] = useState(null); // null | 'running' | 'done' | 'error'
  const [lastRunInfo, setLastRunInfo] = useState(null); // { time, region, points }

  const handleRerun = async () => {
    if (!isAdmin) { alert('Manual model run is restricted to administrators.'); return; }

    // Clear any stuck in-flight marker
    _bgRefreshInFlight.delete(region);

    // Record when the admin pressed refresh — Day 1 will only show data from this time forward
    const refreshedAt = new Date();
    setRefreshStartTime(refreshedAt);

    setData(null);
    setLoading(true);
    setProgress(0);
    setRunStatus('running');
    setDayIdx(0);   // a fresh run starts at Day 1

    try {
      // Force-fetch fresh data from the canonical Open-Meteo Ensemble endpoint.
      // runTCM(force:true) fetches live data, saves to localStorage, and returns the payload.
      // maxDay:2 ⇒ the full 3-day outlook in ONE run. Each model is fetched only
      // for the days it feeds (Day 1 = 6 models, Day 2 = 4, Day 3 = 3), so the run
      // stays light enough to repeat twice a day inside the Open-Meteo free tier.
      const payload = await runTCM({ region, run, onProgress: setProgress, force: true, maxDay: 2 });

      if (!payload?.grid?.length) throw new Error('Model run returned empty grid — try again');

      // 1. Save to localStorage cache so this user sees it instantly on reload
      saveRunToCache(region, run, payload);
      setLastFetch(region, Date.now());

      // 2. Render NOW — the moment the data is ready. The DB publish (step 3)
      //    happens AFTER this so a slow or hung network write can never leave the
      //    button stuck on "Running Model…" at 100% with a finished map behind
      //    it. That ordering was the "reaches 100% then nothing happens" symptom.
      setData(payload);
      setLoading(false);
      setProgress(1);
      setRunStatus('done');
      setLastRunInfo({
        time: new Date().toISOString(),
        region: (REGIONS[region] ?? {}).label ?? region,
        points: payload.grid.length,
        runLabel: fmtRun(run),
        dbSaved: null,            // pending — updated by the publish below
        dbSaveError: null,
      });

      // 3. Publish to DB (RiskGridCache) so ALL users get this run on their next
      //    page load. Non-blocking for the UI: the map is already up. The payload
      //    is slimmed inside saveTCMRunToDB so the write reliably lands. One retry
      //    rides out a transient backend hiccup. We report the outcome honestly.
      setSaveMsg({ ok: true, text: 'Publishing to all devices…' });
      (async () => {
        let dbSaved = false;
        let dbSaveError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await saveTCMRunToDB(region, run, payload);
            dbSaved = true;
            console.info(`[TCM] Admin run published — ${run.toISOString()} (${payload.grid.length} pts)`);
            break;
          } catch (dbErr) {
            dbSaveError = dbErr?.message || String(dbErr);
            console.warn(`[TCM] DB publish attempt ${attempt} failed:`, dbSaveError);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
          }
        }
        setLastRunInfo(prev => ({ ...(prev || {}), dbSaved, dbSaveError }));
        setSaveMsg(dbSaved
          ? { ok: true, text: `Published ${fmtRun(run)} to all devices · ${payload.grid.length} pts` }
          : { ok: false, text: `Publish failed: ${dbSaveError || 'DB write failed'} — saved on this device. Use “Save & Publish” to retry.` });
      })();

    } catch (err) {
      setLoading(false);
      setProgress(0);
      setRunStatus('error');
      console.error('[TCM] Admin model run failed:', err);
    }
  };

  // ── Manual "Save / Publish" ────────────────────────────────────────────────
  // Re-publishes the CURRENTLY loaded run to the DB on demand, independent of a
  // fresh model run. Useful when the automatic publish at the end of a run hit a
  // transient error, or when an admin wants to (re)push the run that's on screen
  // so every other device/browser picks it up. Saves to localStorage too so this
  // browser's instant-load cache matches what was published.
  const [savingRun, setSavingRun] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // {ok:boolean, text:string}
  const handleManualSave = async () => {
    if (!isAdmin) { alert('Saving runs is restricted to administrators.'); return; }
    if (!data?.grid?.length) { setSaveMsg({ ok: false, text: 'No run loaded to save — run the model first.' }); return; }
    setSavingRun(true);
    setSaveMsg(null);
    try {
      // Keep this browser's caches current with what we publish.
      saveRunToCache(region, run, data);
      setLastFetch(region, Date.now());

      // Publish to the DB (slimmed inside saveTCMRunToDB) so every device sees it.
      // One retry on failure to ride out a transient backend hiccup.
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await saveTCMRunToDB(region, run, data);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
        }
      }
      if (lastErr) throw lastErr;

      setSaveMsg({ ok: true, text: `Published ${fmtRun(run)} to all devices · ${data.grid.length} pts` });
      setLastRunInfo(prev => ({
        ...(prev || {}),
        time: new Date().toISOString(),
        region: (REGIONS[region] ?? {}).label ?? region,
        points: data.grid.length,
        runLabel: fmtRun(run),
        dbSaved: true,
        dbSaveError: null,
      }));
    } catch (err) {
      console.error('[TCM] Manual save/publish failed:', err);
      setSaveMsg({ ok: false, text: `Publish failed: ${err?.message || 'unknown error'} — data is still saved on this device.` });
    } finally {
      setSavingRun(false);
    }
  };

  // ── Continue to the next forecast day ──────────────────────────────────────
  // Extends the current partial run by one day WITHOUT any new network calls,
  // by re-scoring the raw data already fetched (payload._rawById) via
  // continueTCM. Renders the new day on the map immediately. Disabled once
  // Day 4 (maxDay === 3) is reached — there is nowhere further to continue.
  const [continuing, setContinuing] = useState(false);
  const canContinue = isAdmin
    && !!data?.grid?.length
    && typeof data?.maxDay === 'number'
    && data.maxDay < 2
    && !!data?.bbox
    && data?.runStartMs != null;   // bbox + run present ⇒ continueTCM can re-fetch the next day

  const handleContinue = async () => {
    if (!isAdmin) { alert('Continue is restricted to administrators.'); return; }
    if (!canContinue || continuing || loading) return;

    const nextDay = Math.min(3, (data.maxDay ?? 0) + 1);
    setContinuing(true);
    setProgress(0);
    setRunStatus('running');

    try {
      // Pure CPU re-score of the already-fetched raw data for the wider day
      // range — no Open-Meteo request is made here.
      const extended = await continueTCM({
        payload: data,
        toDay:   nextDay,
        onProgress: setProgress,
      });

      if (!extended?.grid?.length) throw new Error('Continue produced no grid');

      // Persist locally and render immediately, then publish to the DB in the
      // background so a slow write never freezes the UI at 100%.
      extended.region = region;
      extended.run = run.toISOString();
      saveRunToCache(region, run, extended);

      setData(extended);
      setDayIdx(nextDay);          // jump the map to the day we just revealed
      setProgress(1);
      setRunStatus('done');
      setLastRunInfo(prev => ({
        ...(prev || {}),
        time:   new Date().toISOString(),
        region: (REGIONS[region] ?? {}).label ?? region,
        points: extended.grid.length,
        runLabel: fmtRun(run),
        daysAvailable: extended.daysAvailable,
        dbSaved: null,
        dbSaveError: null,
      }));

      setSaveMsg({ ok: true, text: `Publishing Day ${nextDay + 1}…` });
      (async () => {
        let dbSaved = false;
        let dbSaveError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await saveTCMRunToDB(region, run, extended);
            dbSaved = true;
            console.info(`[TCM] Continue → Day ${nextDay + 1} published (${extended.grid.length} pts)`);
            break;
          } catch (dbErr) {
            dbSaveError = dbErr?.message || String(dbErr);
            console.warn(`[TCM] Continue publish attempt ${attempt} failed:`, dbSaveError);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
          }
        }
        setLastRunInfo(prev => ({ ...(prev || {}), dbSaved, dbSaveError }));
        setSaveMsg(dbSaved
          ? { ok: true, text: `Published Day ${nextDay + 1} to all devices · ${extended.grid.length} pts` }
          : { ok: false, text: `Publish failed: ${dbSaveError || 'DB write failed'} — saved on this device. Use “Save & Publish” to retry.` });
      })();
    } catch (err) {
      setRunStatus('error');
      console.error('[TCM] Continue failed:', err);
      // If the raw data wasn't retained (e.g. an old cache), fall back to a
      // full re-fetch of all days so the user still gets the later days.
      if (err?.code === 'NO_RAW') {
        try {
          setLoading(true);
          const full = await runTCM({ region, run, onProgress: setProgress, force: true, maxDay: 2 });
          saveRunToCache(region, run, full);
          try { await saveTCMRunToDB(region, run, full); } catch {}
          setData(full);
          setDayIdx(Math.min(3, (data.maxDay ?? 0) + 1));
          setRunStatus('done');
        } catch (e2) {
          console.error('[TCM] Continue full-refetch fallback failed:', e2);
          setRunStatus('error');
        } finally {
          setLoading(false);
        }
      }
    } finally {
      setContinuing(false);
    }
  };

  const currentSummary = data?.summary?.[dayIdx];
  // ══════════════════════════════════════════════════════════════════════════
  //  Redesigned dashboard shell — command bar · risk headline · control sidebar
  //  · tabbed workspace (Map / Overview / Lightning / Archive / Admin).
  //  All data + admin machinery below is unchanged; only the composition,
  //  layout and chrome are new.
  // ══════════════════════════════════════════════════════════════════════════
  const [tab, setTab] = useState(() => { const tb = readHashParams().get('tab'); return ['map','overview','lightning','archive','admin'].includes(tb) ? tb : 'map'; });
  const [showSources, setShowSources] = useState(false);
  useEffect(() => { writeHashParams({ d: dayIdx, h: riskType, tab }); }, [dayIdx, riskType, tab]);
  const daySummary       = data?.summary?.[dayIdx] || null;
  const activeScore      = Math.round(daySummary?.[riskType] ?? 0);
  const activeLevel      = scoreToLevel(activeScore);
  const activeRiskMeta   = RISK_TYPES.find(r => r.id === riskType) || RISK_TYPES[0];
  const daysAvailableUI  = data?.daysAvailable ?? 3;
  const levelColor       = (rt, lvl) => (lvl === 'No Risk' ? '#64748b' : (getPalette(rt, lvl).border || '#64748b'));
  // Data-driven headline blurb — built from the run's ACTUAL peak stats for the
  // day (CAPE, coverage, hail, gusts, rain) rather than a fixed per-level string.
  const headlineDesc = (() => {
    const sum = daySummary;
    if (!sum) return 'Model output loading…';
    const rg = sum.ranges || {};
    const cape   = Math.round(rg.cape?.max   ?? 0);
    const gust   = Math.round(rg.gust?.max   ?? 0);
    const precip = Math.round((rg.precip?.max ?? 0) * 10) / 10;
    const hail   = Math.round(rg.hailMm?.max ?? 0);
    const cov    = sum.totalCells ? Math.round((sum.stormyCells / sum.totalCells) * 100) : 0;
    const hazardWord = ({ thunderstorm: 'thunderstorm', hail: 'hail', tornado: 'tornado', lightning: 'lightning' })[riskType] || 'convective';
    if (activeLevel === 'No Risk' || activeScore < 5) {
      return `Stable, capped atmosphere — peak CAPE of just ${cape} J/kg. No convective development expected, so no ${hazardWord} risk across the region this day.`;
    }
    const bits = [`peak CAPE around ${cape} J/kg`];
    if (cov > 0)    bits.push(`convection over roughly ${cov}% of the region`);
    if (hail > 5)   bits.push(`hail to ~${hail} mm`);
    if (gust > 40)  bits.push(`gusts near ${gust} mph`);
    if (precip > 4) bits.push(`rainfall rates to ~${precip} mm/h`);
    const tail = ({
      'Very Low': 'A brief, isolated cell or two at most — minimal impact.',
      'Low':      'Scattered, short-lived storms where cells fire; localised impacts only.',
      'Marginal': 'Organised storms possible with a lower-end severe threat — stay weather-aware.',
      'Slight':   'Multi-cell storms and clusters likely; take lightning safety seriously.',
      'Moderate': 'A significant severe-weather setup — real disruption possible along storm tracks.',
      'High':     'A dangerous, high-end severe outbreak — monitor warnings and be ready to shelter.',
      'Severe':   'Extreme, potentially life-threatening storms — follow official warnings closely.',
    })[activeLevel] || '';
    return `${activeLevel} ${hazardWord} risk: ${bits.join(', ')}. ${tail}`;
  })();
  const TABS_UI = [
    { id: 'map',       label: 'Map',       icon: MapIcon,   accent: '#38bdf8' },
    { id: 'overview',  label: 'Overview',  icon: BarChart2, accent: '#a78bfa' },
    { id: 'lightning', label: 'Lightning', icon: Zap,       accent: '#facc15' },
    { id: 'archive',   label: 'Archive',   icon: Database,  accent: '#34d399' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: ShieldAlert, accent: '#f59e0b' }] : []),
  ];

  // Keyboard: press 1 / 2 / 3 to jump between forecast days (ignored in inputs).
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const d = Number(e.key) - 1;
        if (d < (data?.daysAvailable ?? 3)) setDayIdx(d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data?.daysAvailable]);

  return (
    <div className="wp-tcm-root" style={{ minHeight:'100vh', background:t.pageBg, color:t.textSecondary, fontFamily:"'DM Sans',system-ui,sans-serif", transition:'background 0.3s ease', position:'relative' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@500&display=swap');
        *{box-sizing:border-box}body{margin:0}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.20);border-radius:99px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(148,163,184,0.38)}
        .animate-spin{animation:spin 1s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes wpFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .wp-fade-in{animation:wpFadeIn 0.35s ease both}
        .wp-glass-card{transition:transform .25s cubic-bezier(0.4,0,0.2,1),box-shadow .25s ease,border-color .25s ease}
        .wp-glass-card:hover{border-color:rgba(120,160,230,0.30)!important}
        /* Region switcher now flows INSIDE the command bar (was fixed) */
        .wp-region-switcher{position:relative;display:flex;border-radius:11px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.16)}

        /* ── Command bar ── */
        .tcmx-cmd{position:sticky;top:0;z-index:40;backdrop-filter:blur(20px) saturate(1.3);-webkit-backdrop-filter:blur(20px) saturate(1.3)}
        .tcmx-cmd-inner{max-width:1340px;margin:0 auto;padding:13px 22px 13px 80px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
        .tcmx-brand{display:flex;align-items:center;gap:11px;min-width:0}
        .tcmx-brand-badge{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6366f1,#38bdf8);box-shadow:0 4px 16px rgba(99,102,241,0.4),inset 0 1px 0 rgba(255,255,255,0.35);flex-shrink:0}
        .tcmx-brand-title{font-size:1.02rem;font-weight:900;letter-spacing:-0.02em;line-height:1.05}
        .tcmx-brand-sub{font-size:0.6rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;font-family:'DM Mono',monospace}
        .tcmx-live{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:0.56rem;font-weight:800;letter-spacing:0.1em;font-family:'DM Mono',monospace;color:#22c55e;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3)}
        .tcmx-cmd-right{display:flex;align-items:center;gap:9px;margin-left:auto;flex-wrap:wrap}
        .tcmx-cmd-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:10px;font-size:0.72rem;font-weight:800;cursor:pointer;letter-spacing:0.02em;transition:all .18s}

        /* ── Risk headline ── */
        .tcmx-headline{max-width:1320px;margin:16px auto 4px;padding:0 18px}
        .tcmx-hl-card{position:relative;overflow:hidden;border-radius:24px;padding:26px 30px;display:flex;align-items:center;justify-content:space-between;gap:26px;flex-wrap:wrap;box-shadow:inset 0 1px 0 rgba(255,255,255,0.06)}
        .tcmx-hl-eyebrow{font-size:0.62rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;font-family:'DM Mono',monospace;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .tcmx-hl-title{margin:12px 0 9px;font-size:clamp(1.75rem,4.2vw,2.7rem);font-weight:900;letter-spacing:-0.035em;line-height:1.04;display:flex;align-items:center;gap:13px}
        .tcmx-hl-desc{margin:0;font-size:0.86rem;line-height:1.6;max-width:580px}
        .tcmx-hl-gauge{display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0}
        .tcmx-hl-chip{padding:7px 18px;border-radius:99px;font-size:0.92rem;font-weight:900;letter-spacing:0.02em;display:inline-flex;align-items:center;gap:8px}
        .tcmx-hl-score{font-family:'DM Mono',monospace;font-weight:900;font-size:2.6rem;line-height:1;letter-spacing:-0.04em}

        /* ── Shell grid ── */
        .tcmx-shell{max-width:1340px;margin:22px auto 0;padding:0 22px 72px;display:grid;grid-template-columns:304px minmax(0,1fr);gap:24px;align-items:start}
        .tcmx-side{position:sticky;top:70px;display:flex;flex-direction:column;gap:12px}
        .tcmx-main{min-width:0;display:flex;flex-direction:column;gap:18px}
        .tcmx-card{border-radius:18px;overflow:hidden}
        .tcmx-card-h{display:flex;align-items:center;gap:8px;padding:13px 17px;font-size:0.64rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;font-family:'DM Mono',monospace}
        .tcmx-rail{display:flex;flex-direction:column;gap:7px;padding:8px 10px 12px}

        /* Day / hazard rail buttons */
        .tcmx-day,.tcmx-haz{display:flex;align-items:center;gap:13px;width:100%;text-align:left;padding:13px 15px;border-radius:14px;cursor:pointer;transition:all .18s cubic-bezier(0.4,0,0.2,1);font-family:'DM Sans',system-ui,sans-serif}
        .tcmx-day:hover:not(:disabled),.tcmx-haz:hover{transform:translateX(2px)}
        .tcmx-day:disabled{opacity:0.38;cursor:not-allowed;filter:grayscale(0.5)}

        /* ── Tab bar ── */
        .tcmx-tabbar{display:flex;gap:7px;padding:7px;border-radius:16px;overflow-x:auto;scrollbar-width:none}
        .tcmx-tabbar::-webkit-scrollbar{display:none}
        .tcmx-tab{display:inline-flex;align-items:center;gap:7px;padding:11px 18px;border-radius:12px;font-size:0.78rem;font-weight:800;cursor:pointer;white-space:nowrap;border:1px solid transparent;background:transparent;transition:all .18s;letter-spacing:0.01em}

        @media(max-width:980px){
          .tcmx-shell{grid-template-columns:1fr;gap:14px}
          .tcmx-side{position:static;flex-direction:column}
          .tcmx-rail{flex-direction:row;overflow-x:auto;padding:10px}
          .tcmx-day,.tcmx-haz{min-width:150px;flex-shrink:0}
        }
        @media(max-width:640px){
          /* Mobile safety net — stop any wide child from pushing the page
             sideways and clipping content. Desktop (>640px) is untouched. */
          .wp-tcm-root{overflow-x:hidden;width:100%;max-width:100vw}
          .wp-tcm-root img,.wp-tcm-root canvas,.wp-tcm-root video,.wp-tcm-root .leaflet-container{max-width:100%}
          .tcmx-cmd-inner{padding:8px 12px 8px 64px;gap:8px}
          .tcmx-cmd-right{gap:6px;width:100%;margin-left:0;justify-content:flex-start}
          .tcmx-headline{padding:0 12px;margin-top:12px}
          .tcmx-hl-card{padding:16px;flex-direction:column;align-items:flex-start;gap:14px}
          .tcmx-hl-gauge{align-self:center}
          .tcmx-hl-title{font-size:1.35rem}
          .tcmx-hl-desc{max-width:100%}
          .tcmx-hl-score{font-size:2rem}
          .tcmx-shell{padding:0 12px 56px;margin-top:12px}
          .tcmx-day,.tcmx-haz{min-width:134px}
          .tcmx-tab{padding:8px 13px;font-size:0.74rem}
          .tcmx-brand-sub{display:none}
        }

        /* ── UX polish pass: tactile feedback, focus a11y, tap targets, motion ── */
        button,.tcmx-tab,.tcmx-day,.tcmx-haz,.tcmx-cmd-btn{-webkit-tap-highlight-color:transparent}
        :where(button,a,.tcmx-tab,.tcmx-day,.tcmx-haz,.tcmx-cmd-btn):focus-visible{outline:2px solid #38bdf8;outline-offset:2px;border-radius:10px}
        .tcmx-cmd-btn:active,.tcmx-tab:active{transform:scale(0.96)}
        .tcmx-day:active:not(:disabled),.tcmx-haz:active{transform:translateX(2px) scale(0.985)}
        .tcmx-tab:hover{filter:brightness(1.12)}
        .tcmx-cmd-btn:hover{filter:brightness(1.1)}
        .wp-glass-card:hover{transform:translateY(-2px)}
        /* Touch devices: kill hover-move (prevents sticky :hover state on tap) */
        @media(hover:none){.tcmx-day:hover:not(:disabled),.tcmx-haz:hover,.wp-glass-card:hover,.tcmx-tab:hover,.tcmx-cmd-btn:hover{transform:none;filter:none}}
        @media(max-width:640px){
          .tcmx-cmd-btn,.tcmx-tab{min-height:40px}
          .tcmx-day,.tcmx-haz{min-height:52px}
          .tcmx-tabbar{-webkit-overflow-scrolling:touch}
        }
        /* Respect users who prefer less motion */
        @media(prefers-reduced-motion:reduce){*,.wp-fade-in{animation:none!important;transition-duration:.01ms!important}}
      `}</style>

      {/* Old TCM hamburger removed — SiteNav in the layout owns navigation. */}

      {/* ══ Command bar ══════════════════════════════════════════════════════ */}
      <header className="tcmx-cmd" style={{ background:t.cardBg, borderBottom:`1px solid ${t.cardBorder}`, boxShadow:t.cardShadow }}>
        <div className="tcmx-cmd-inner">
          <div className="tcmx-brand">
            <div className="tcmx-brand-badge"><CloudLightning style={{ width:20, height:20, color:'#fff' }} /></div>
            <div style={{ minWidth:0 }}>
              <div className="tcmx-brand-title" style={{ color:t.textPrimary }}>Convective Outlook</div>
              <div className="tcmx-brand-sub" style={{ color:t.textMuted }}>MyWeatherUK · TCM</div>
            </div>
            <span className="tcmx-live"><span style={{ width:5, height:5, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 6px #22c55e' }} />LIVE</span>
          </div>

          <div className="tcmx-cmd-right">
            {!embedded && <TcmVersionSwitcher />}
            <RunSelector region={region} value={run} onChange={(r) => { if (r) setRun(r); }} isAdmin={isAdmin} />

            {/* Model sources popover */}
            <div style={{ position:'relative' }}>
              <button className="tcmx-cmd-btn" onClick={() => setShowSources(s => !s)}
                style={{ background: showSources ? 'rgba(56,189,248,0.16)' : 'transparent', border:`1px solid ${showSources ? 'rgba(56,189,248,0.45)' : t.cardBorder}`, color: showSources ? '#38bdf8' : t.textMuted }}>
                <Layers style={{ width:13, height:13 }} /> Sources
              </button>
              {showSources && (
                <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', width:250, zIndex:60, padding:12, borderRadius:14, background:t.cardBg, border:`1px solid ${t.cardBorder}`, backdropFilter:'blur(18px)', boxShadow:'0 18px 44px rgba(15,23,42,0.32)' }}>
                  <div style={{ fontSize:'0.62rem', fontWeight:800, letterSpacing:'0.1em', textTransform:'uppercase', color:t.textMuted, marginBottom:8, fontFamily:"'DM Mono',monospace" }}>Ensemble Models</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {[{ label:'UKMO UKV', sub:'2 km', color:'#818cf8' },{ label:'UKMO Global', sub:'20 km', color:'#818cf8' },{ label:'ECMWF IFS', sub:'0.25°', color:'#38bdf8' },{ label:'ECMWF AI-IFS', sub:'0.25°', color:'#34d399' },{ label:'NCEP GEFS', sub:'0.5°', color:'#fb923c' },{ label:'DWD ICON-EU', sub:'7 km', color:'#f472b6' }].map(m => (
                      <div key={m.label} style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ width:6, height:6, borderRadius:'50%', background:m.color, flexShrink:0 }} />
                        <span style={{ fontSize:'0.74rem', fontWeight:700, color:t.textPrimary, flex:1 }}>{m.label}</span>
                        <span style={{ fontSize:'0.64rem', color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{m.sub}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:10, paddingTop:9, borderTop:`1px solid ${t.cardBorder}`, fontSize:'0.62rem', color:t.textMuted, lineHeight:1.5 }}>
                    Ingredients-based multiplicative risk engine · per-timestep ensemble weighting.
                  </div>
                </div>
              )}
            </div>

            {/* Admin quick-run */}
            {isAdmin && (
              <button className="tcmx-cmd-btn" onClick={handleRerun} disabled={loading || runStatus==='running'}
                style={{ background: runStatus==='done' ? 'rgba(34,197,94,0.16)' : runStatus==='error' ? 'rgba(239,68,68,0.16)' : 'rgba(99,102,241,0.16)', border:`1px solid ${runStatus==='done' ? 'rgba(34,197,94,0.45)' : runStatus==='error' ? 'rgba(239,68,68,0.45)' : 'rgba(99,102,241,0.4)'}`, color: runStatus==='done' ? '#22c55e' : runStatus==='error' ? '#f87171' : '#818cf8', opacity:(loading||runStatus==='running')?0.7:1, cursor:(loading||runStatus==='running')?'wait':'pointer' }}>
                {(loading||runStatus==='running')
                  ? <><Loader2 className="animate-spin" style={{ width:13, height:13 }} /> Running…</>
                  : <><Play style={{ width:13, height:13 }} /> Run Model</>}
              </button>
            )}

            {/* Region switcher (UK live · Europe soon) — inline */}
            <RegionSwitcher t={t} region={region} setRegion={switchRegion} />
          </div>
        </div>
      </header>

      {/* ══ Risk headline ════════════════════════════════════════════════════ */}
      <div className="tcmx-headline">
        <Card className="wp-fade-in" style={{ borderRadius:20 }}>
          <div className="tcmx-hl-card" style={{ background:`linear-gradient(120deg, ${activeRiskMeta.color}1c 0%, transparent 60%)` }}>
            <div aria-hidden style={{ position:'absolute', top:-80, right:-40, width:280, height:280, borderRadius:'50%', background:`radial-gradient(circle, ${levelColor(riskType, activeLevel)}22 0%, transparent 70%)`, filter:'blur(30px)', pointerEvents:'none' }} />
            {/* Risk-coloured accent edge — ties the hero card to the active level at a glance */}
            <div aria-hidden style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:`linear-gradient(180deg, ${levelColor(riskType, activeLevel)}, ${levelColor(riskType, activeLevel)}33)`, pointerEvents:'none' }} />
            <div style={{ minWidth:0, position:'relative' }}>
              <div className="tcmx-hl-eyebrow" style={{ color:t.textMuted }}>
                <span>{(REGIONS[region] ?? {}).label ?? region}</span>
                <span style={{ color:t.cardBorder }}>◇</span>
                <span style={{ color:activeRiskMeta.color }}>{activeRiskMeta.label}</span>
                <span style={{ color:t.cardBorder }}>◇</span>
                <span>Day {dayIdx + 1} · {dayLabels[dayIdx]}</span>
              </div>
              <h1 className="tcmx-hl-title" style={{ color:t.textPrimary }}>
                <activeRiskMeta.icon style={{ width:30, height:30, color:activeRiskMeta.color, flexShrink:0 }} />
                {activeLevel === 'No Risk' ? 'No active risk' : `${activeLevel} ${activeRiskMeta.label.toLowerCase()} risk`}
              </h1>
              <p className="tcmx-hl-desc" style={{ color:t.textSecondary }}>{headlineDesc}</p>
            </div>
            <div className="tcmx-hl-gauge" style={{ position:'relative' }}>
              <div className="tcmx-hl-chip" style={{ color: levelColor(riskType, activeLevel), background:`${levelColor(riskType, activeLevel)}1f`, border:`1.5px solid ${levelColor(riskType, activeLevel)}` }}>
                <span style={{ width:9, height:9, borderRadius:'50%', background:levelColor(riskType, activeLevel), boxShadow:`0 0 8px ${levelColor(riskType, activeLevel)}` }} />
                {activeLevel}
              </div>
              <div className="tcmx-hl-score" style={{ color:t.textPrimary }}>
                {activeScore}<span style={{ fontSize:'1rem', color:t.textMuted, fontWeight:700 }}>/100</span>
              </div>
              <span style={{ fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>Peak score</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ══ Shell: control sidebar + tabbed workspace ═══════════════════════ */}
      <div className="tcmx-shell">
        {/* ── Sidebar ── */}
        <aside className="tcmx-side">
          {/* Day rail */}
          <Card className="tcmx-card">
            <div className="tcmx-card-h" style={{ color:t.textMuted, borderBottom:`1px solid ${t.cardBorder}` }}>
              <Clock style={{ width:12, height:12 }} /> Forecast Days
              <span style={{ marginLeft:'auto', fontSize:'0.54rem', color:t.textMuted, letterSpacing:'0.06em' }}>1·2·3 keys</span>
            </div>
            <div className="tcmx-rail">
              {[0,1,2].map(d => {
                const sc = Math.round(data?.summary?.[d]?.[riskType] ?? 0);
                const lv = scoreToLevel(sc);
                const col = levelColor(riskType, lv);
                const locked = d >= daysAvailableUI;
                const date = new Date(run); date.setDate(date.getDate() + d);
                const name = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday:'long' });
                const dstr = date.toLocaleDateString(undefined, { day:'numeric', month:'short' });
                const active = dayIdx === d;
                return (
                  <button key={d} className="tcmx-day" disabled={locked} onClick={() => { if (!locked) setDayIdx(d); }}
                    title={locked ? `Day ${d+1} not computed yet` : `${name} — ${dstr}`}
                    style={{ border:`1.5px solid ${active ? col : t.cardBorder}`, background: active ? `linear-gradient(135deg, ${col}22, transparent)` : 'rgba(255,255,255,0.02)' }}>
                    <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:`${col}1a`, border:`1px solid ${col}55` }}>
                      <span style={{ fontSize:'0.5rem', fontWeight:800, letterSpacing:'0.08em', color:col, textTransform:'uppercase', fontFamily:"'DM Mono',monospace" }}>Day</span>
                      <span style={{ fontSize:'0.95rem', fontWeight:900, color:col, lineHeight:1 }}>{d+1}</span>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:'0.82rem', fontWeight:800, color:t.textPrimary, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</div>
                      <div style={{ fontSize:'0.64rem', color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{dstr}</div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ fontSize:'0.6rem', fontWeight:800, color:col, textTransform:'uppercase', letterSpacing:'0.03em' }}>{lv}</div>
                      <div style={{ fontSize:'0.9rem', fontWeight:900, color:t.textPrimary, fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{locked ? '—' : sc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Hazard rail */}
          <Card className="tcmx-card">
            <div className="tcmx-card-h" style={{ color:t.textMuted, borderBottom:`1px solid ${t.cardBorder}` }}>
              <ShieldAlert style={{ width:12, height:12 }} /> Hazard
            </div>
            <div className="tcmx-rail">
              {RISK_TYPES.map(rt => {
                const Ic = rt.icon;
                const sc = Math.round(data?.summary?.[dayIdx]?.[rt.id] ?? 0);
                const active = riskType === rt.id;
                return (
                  <button key={rt.id} className="tcmx-haz" onClick={() => setRiskType(rt.id)}
                    style={{ border:`1.5px solid ${active ? rt.color : t.cardBorder}`, background: active ? `linear-gradient(135deg, ${rt.color}26, ${rt.color}0d)` : 'rgba(255,255,255,0.02)' }}>
                    <div style={{ width:30, height:30, borderRadius:9, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:`${rt.color}1c`, border:`1px solid ${rt.color}44` }}>
                      <Ic style={{ width:15, height:15, color:rt.color }} />
                    </div>
                    <span style={{ flex:1, fontSize:'0.82rem', fontWeight:800, color: active ? t.textPrimary : t.textSecondary }}>{rt.label}</span>
                    <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <div style={{ width:44, height:5, borderRadius:99, background:'rgba(148,163,184,0.18)', overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${Math.min(100, sc)}%`, background:rt.color, borderRadius:99 }} />
                      </div>
                      <span style={{ fontSize:'0.78rem', fontWeight:900, color: sc > 8 ? rt.color : t.textMuted, fontFamily:"'DM Mono',monospace", width:22, textAlign:'right' }}>{sc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Day at-a-glance */}
          <Card className="tcmx-card">
            <div className="tcmx-card-h" style={{ color:t.textMuted, borderBottom:`1px solid ${t.cardBorder}` }}>
              <Eye style={{ width:12, height:12 }} /> Day {dayIdx+1} Snapshot
            </div>
            <div style={{ padding:'12px 15px', display:'flex', flexDirection:'column', gap:10 }}>
              {(() => {
                const s = data?.summary?.[dayIdx] || {};
                const peak = RISK_TYPES.map(rt => ({ rt, sc: Math.round(s[rt.id] ?? 0) })).sort((a,b) => b.sc - a.sc)[0] || { rt: activeRiskMeta, sc: 0 };
                const peakLv = scoreToLevel(peak.sc);
                const pcol = levelColor(peak.rt.id, peakLv);
                return (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:12, background:`${pcol}12`, border:`1px solid ${pcol}33` }}>
                      <peak.rt.icon style={{ width:18, height:18, color:peak.rt.color, flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'0.58rem', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>Leading hazard</div>
                        <div style={{ fontSize:'0.86rem', fontWeight:900, color:t.textPrimary }}>{peak.rt.label} · {peakLv}</div>
                      </div>
                      <div style={{ fontSize:'1.15rem', fontWeight:900, color:pcol, fontFamily:"'DM Mono',monospace" }}>{peak.sc}</div>
                    </div>
                    <div style={{ fontSize:'0.62rem', color:t.textMuted, lineHeight:1.5 }}>
                      Scores are the day's peak grid value per hazard (0–100). Switch hazard or day above; the map, overview and lightning tabs all follow this selection.
                    </div>
                  </>
                );
              })()}
            </div>
          </Card>
        </aside>

        {/* ── Main workspace ── */}
        <main className="tcmx-main">
          {/* Global alerts */}
          {loading &&
            <Card style={{ padding:'14px 18px', border:'1px solid rgba(99,102,241,0.25)', background:'rgba(99,102,241,0.06)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <Loader2 className="animate-spin" style={{ width:16, height:16, color:'#818cf8', flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'0.78rem', fontWeight:700, color:t.textPrimary, marginBottom:6 }}>Fetching ensemble forecast…</div>
                  <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:99 }}>
                    <motion.div animate={{ width:`${Math.round(progress * 100)}%` }} transition={{ duration:0.3 }} style={{ height:'100%', background:'linear-gradient(90deg,#6366f1,#818cf8,#38bdf8)', borderRadius:99 }} />
                  </div>
                  <div style={{ fontSize:'0.62rem', color:t.textMuted, marginTop:5, fontFamily:"'DM Mono',monospace" }}>{Math.round(progress * 100)}% · Open-Meteo Ensemble</div>
                  {runStatus === 'running' && <RunWaitCountdown key={`${region}-${run?.toISOString?.()}`} estimateSeconds={continuing ? 8 : estimateRunSeconds({ bbox: REGIONS[region]?.bbox, gridStep: REGIONS[region]?.gridStep, maxDay: 2 })} muted={t.textMuted} />}
                </div>
              </div>
            </Card>
          }
          {!loading && data && dataSource === 'db' && (
            <Card style={{ padding:'10px 14px', border:'1px solid rgba(56,189,248,0.30)', background:'rgba(56,189,248,0.07)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <Database style={{ width:14, height:14, color:'#38bdf8' }} />
                <span style={{ fontSize:'0.76rem', fontWeight:700, color:'#38bdf8' }}>Showing latest admin-published run</span>
                <span style={{ fontSize:'0.7rem', color:t.textMuted }}>{data.builtAt ? `· Published ${new Date(data.builtAt).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false })} UTC` : ''}</span>
              </div>
            </Card>
          )}
          {!loading && !dataError && !data &&
            <Card style={{ padding:28, border:'1px solid rgba(99,102,241,0.20)', background:'rgba(99,102,241,0.05)', textAlign:'center' }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
                <div style={{ width:48, height:48, borderRadius:14, background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Database style={{ width:22, height:22, color:'#818cf8' }} />
                </div>
                <div style={{ fontSize:'0.9rem', fontWeight:700, color:t.textPrimary }}>No forecast data yet</div>
                <div style={{ fontSize:'0.76rem', color:t.textMuted, maxWidth:420, lineHeight:1.55 }}>
                  {isAdmin ? 'Press "Run Model" (top bar or Admin tab) to fetch the latest Open-Meteo ensemble and publish for all users.' : 'The model has not yet been run for this region. Data is typically published several times daily.'}
                </div>
              </div>
            </Card>
          }
          {!loading && dataError &&
            <Card style={{ padding:18, border:'1px solid rgba(239,68,68,0.35)', background:'rgba(239,68,68,0.07)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <AlertTriangle style={{ width:18, height:18, color:'#f87171', flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#f87171' }}>Failed to load forecast data</div>
                  <div style={{ fontSize:'0.74rem', color:t.textMuted, marginTop:3 }}>{dataError}</div>
                </div>
                <button onClick={() => retryFetch()} style={{ padding:'6px 14px', borderRadius:8, fontSize:'0.78rem', fontWeight:700, background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.35)', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                  <RefreshCw style={{ width:12, height:12 }} /> Retry
                </button>
              </div>
            </Card>
          }
          {data?.source === 'ai-fallback' &&
            <Card style={{ padding:'10px 14px', border:'1px solid rgba(167,139,250,0.40)', background:'rgba(167,139,250,0.08)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <Activity style={{ width:14, height:14, color:'#a78bfa' }} />
                <span style={{ fontSize:'0.76rem', fontWeight:700, color:'#a78bfa' }}>AI Forecast Active — Deno API and Open-Meteo both unavailable</span>
                {data.synopticSummary && <span style={{ flexBasis:'100%', fontSize:'0.72rem', color:t.textSecondary, lineHeight:1.5, marginTop:4 }}>{data.synopticSummary}</span>}
              </div>
            </Card>
          }

          {/* Tab bar */}
          <Card style={{ padding:0 }}>
            <nav className="tcmx-tabbar">
              {TABS_UI.map(tb => {
                const on = tab === tb.id;
                const Ic = tb.icon;
                return (
                  <button key={tb.id} className="tcmx-tab" onClick={() => setTab(tb.id)}
                    style={{ color: on ? tb.accent : t.textMuted, background: on ? `${tb.accent}1c` : 'transparent', borderColor: on ? `${tb.accent}66` : 'transparent' }}>
                    <Ic style={{ width:15, height:15 }} /> {tb.label}
                  </button>
                );
              })}
            </nav>
          </Card>

          {/* ═══ MAP TAB ═══ */}
          {tab === 'map' && (
            <div className="wp-fade-in" style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {activeViewMode !== 'temp-max' && activeViewMode !== 'temp-min' && <RiskLegend riskType={riskType} />}
              <div style={{ position:'relative', borderRadius:20, overflow:'hidden' }}>
                <div style={{ transform:`scale(${mapZoom})`, transformOrigin:'50% 42%',
                  transition:'transform 0.55s cubic-bezier(0.22,1,0.36,1)', willChange:'transform' }}>
                  <MainMapSection
                    data={data || { grid: [] }}
                    region={region}
                    riskType={riskType}
                    dayIdx={dayIdx}
                    run={run}
                    onClickPoint={setClickPoint}
                    summary={currentSummary}
                    refreshStartTime={refreshStartTime}
                    savedOutlooks={savedOutlooks}
                    onViewModeChange={setActiveViewMode} />
                </div>
                <RegionSwitchFX anim={regionAnim} />
              </div>
        {activeViewMode === 'admin-outlook' && savedOutlooks.length > 0 && (() => {
          const RISK_BAR_COLORS = { 'No Risk':'#475569','Very Low':'#5b9bd5','Low':'#3da356','Marginal':'#d9a91c','Slight':'#d97316','Moderate':'#dc3f3f','High':'#7c4ddb','Severe':'#0f172a' }

          // Compute forecast type label for each outlook
          const updateCount = { count: 0 };
          const outlooksWithType = savedOutlooks.map((o, i) => {
            const ft = o.forecastType || o.data?.forecastType || 'initial';
            let typeLabel;
            if (ft === 'initial') { typeLabel = 'Initial Forecast'; }
            else { updateCount.count++; typeLabel = `Update ${updateCount.count}`; }
            return { ...o, typeLabel };
          });

          return (
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:14 }}>
              {outlooksWithType.map((outlookEntry, eidx) => {
                const latest = outlookEntry.data;
                if (!latest) return null;
                const hasPeak24h = latest.peak_24h?.length === 8 && latest.peak_24h.some(s => s.risk_level !== 'No Risk' || s.activity > 0);
                const hasDetails = latest.description || latest.overall_risk || latest.peak_window || latest.thunderstorm_overview || hasPeak24h;
                if (!hasDetails && !isAdmin) return null;

                return (
                  <Card key={outlookEntry.cacheKey || eidx} style={{ padding:'16px 18px', border:'1px solid rgba(245,158,11,0.25)', background:'rgba(15,20,40,0.97)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:hasDetails?14:0, flexWrap:'wrap' }}>
                      <PenLine style={{ width:13, height:13, color:'#f59e0b' }} />
                      <span style={{ fontSize:'0.76rem', fontWeight:800, color:'#f59e0b', letterSpacing:'0.02em' }}>
                        {latest.label || 'Admin Outlook'}
                      </span>
                      {/* Forecast type badge */}
                      <span style={{ fontSize:'0.64rem', fontWeight:700, padding:'2px 8px', borderRadius:99, background: outlookEntry.typeLabel === 'Initial Forecast' ? 'rgba(56,189,248,0.15)' : 'rgba(245,158,11,0.15)', border: `1px solid ${outlookEntry.typeLabel === 'Initial Forecast' ? 'rgba(56,189,248,0.4)' : 'rgba(245,158,11,0.4)'}`, color: outlookEntry.typeLabel === 'Initial Forecast' ? '#38bdf8' : '#f59e0b' }}>
                        {outlookEntry.typeLabel}
                      </span>
                      {latest.isoDate && (
                        <span style={{ fontSize:'0.68rem', color:'#64748b' }}>
                          · {new Date(latest.isoDate + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}
                        </span>
                      )}
                      <div style={{ flex:1 }} />
                      {/* Delete button — admin only */}
                      {isAdmin && (
                        <div style={{ display:'flex', gap:5 }}>
                          {/* Edit button — loads outlook into draw tool */}
                          <button
                            onClick={() => {
                              setDrawShapes(latest.shapes || []);
                              setOutlookLabel(latest.label || '');
                              setOutlookForecastType(latest.forecastType || 'initial');
                              setOutlookDescription(latest.description || '');
                              setOutlookOverallRisk(latest.overall_risk || '');
                              setOutlookPeakWindow(latest.peak_window || '');
                              setOutlookThunderstormOverview(latest.thunderstorm_overview || '');
                              setOutlookPeak24h(latest.peak_24h?.length === 8 ? latest.peak_24h : DEFAULT_PEAK_24H_WP);
                              // Set dayIdx to match the outlook's date
                              if (latest.isoDate && run) {
                                const outlookMs = new Date(latest.isoDate + 'T00:00:00Z').getTime();
                                const runMs = new Date(run).setHours(0,0,0,0);
                                const diff = Math.round((outlookMs - runMs) / 86400_000);
                                setDrawOutlookDayIdx(Math.max(0, Math.min(diff, 6)));
                              }
                              setEditingOutlookId(outlookEntry.id || null);
                              setTab('admin');       // draw tool lives in the Admin tab
                              setShowDrawTool(true);
                              // Scroll to the draw tool once the Admin tab has rendered
                              setTimeout(() => document.querySelector('[data-draw-tool]')?.scrollIntoView({ behavior:'smooth', block:'start' }), 160);
                            }}
                            style={{ padding:'4px 10px', borderRadius:7, fontSize:'0.66rem', fontWeight:700, cursor:'pointer', background:'rgba(245,158,11,0.10)', border:'1px solid rgba(245,158,11,0.30)', color:'#f59e0b', display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                            <PenLine style={{ width:10, height:10 }} /> Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Delete "${latest.label || 'this outlook'}"? This cannot be undone.`)) return;
                              try {
                                await deleteAdminDrawnOutlook(outlookEntry.id, outlookEntry.cacheKey, region);
                                setSavedOutlooks(prev => prev.filter((_, i) => i !== eidx));
                              } catch (e) {
                                alert('Delete failed: ' + (e?.message || 'unknown error'));
                              }
                            }}
                            style={{ padding:'4px 10px', borderRadius:7, fontSize:'0.66rem', fontWeight:700, cursor:'pointer', background:'rgba(239,68,68,0.10)', border:'1px solid rgba(239,68,68,0.30)', color:'#ef4444', display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                            <Trash2 style={{ width:10, height:10 }} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                    {hasDetails && (
                      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                        {/* Description */}
                        {latest.description && (
                          <div>
                            <p style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'rgba(167,139,250,0.7)', marginBottom:5 }}>Description</p>
                            <p style={{ fontSize:'0.82rem', color:'#e2e8f0', lineHeight:1.65, margin:0, whiteSpace:'pre-wrap' }}>{latest.description}</p>
                          </div>
                        )}
                        {/* Overall Risk */}
                        {latest.overall_risk && (
                          <div style={{ borderRadius:12, padding:'10px 14px', background:'rgba(248,113,113,0.07)', border:'1px solid rgba(248,113,113,0.18)' }}>
                            <p style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#f87171', marginBottom:4 }}>Overall Risk</p>
                            <p style={{ fontSize:'0.82rem', color:'rgba(254,202,202,0.85)', margin:0, lineHeight:1.6 }}>{latest.overall_risk}</p>
                          </div>
                        )}
                        {/* Peak Window */}
                        {latest.peak_window && (
                          <div style={{ display:'flex', alignItems:'center', gap:10, borderRadius:10, padding:'8px 12px', background:'rgba(56,189,248,0.06)', border:'1px solid rgba(56,189,248,0.14)', alignSelf:'flex-start' }}>
                            <Clock style={{ width:14, height:14, color:'#38bdf8', flexShrink:0 }} />
                            <div>
                              <p style={{ fontSize:'0.65rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#38bdf8', margin:0 }}>Peak Window</p>
                              <p style={{ fontSize:'0.9rem', fontWeight:700, color:'#bae6fd', margin:0 }}>{latest.peak_window}</p>
                            </div>
                          </div>
                        )}
                        {/* 24-Hour Peak Activity */}
                        {hasPeak24h && (
                          <div>
                            <p style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'rgba(192,132,252,0.7)', marginBottom:8 }}>24-Hour Peak Activity</p>
                            <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:4 }}>
                              {latest.peak_24h.map(slot => {
                                const barColor = RISK_BAR_COLORS[slot.risk_level] || '#475569';
                                return (
                                  <div key={slot.time} style={{ borderRadius:8, padding:'6px 4px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', textAlign:'center' }}>
                                    <p style={{ fontSize:9, fontWeight:700, color:'#94a3b8', margin:'0 0 3px' }}>{slot.time}</p>
                                    <div style={{ height:4, borderRadius:2, background:'rgba(255,255,255,0.1)', marginBottom:4, overflow:'hidden' }}>
                                      <div style={{ height:'100%', width:`${slot.activity}%`, background:barColor, borderRadius:2 }} />
                                    </div>
                                    <p style={{ fontSize:8, fontWeight:700, color:barColor, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{slot.risk_level}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {/* Thunderstorm Overview */}
                        {latest.thunderstorm_overview && (
                          <div style={{ borderRadius:12, padding:'10px 14px', background:'rgba(250,204,21,0.06)', border:'1px solid rgba(250,204,21,0.15)' }}>
                            <p style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#facc15', marginBottom:4 }}>⚡ Thunderstorm Overview</p>
                            <p style={{ fontSize:'0.82rem', color:'rgba(254,249,195,0.85)', margin:0, lineHeight:1.6 }}>{latest.thunderstorm_overview}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          );
        })()}
            </div>
          )}

          {/* ═══ OVERVIEW TAB ═══ */}
          {tab === 'overview' && (
            <div className="wp-fade-in">
              <DayOverview
                data={data}
                summary={currentSummary}
                riskType={riskType}
                regionLabel={(REGIONS[region] ?? {}).label ?? region}
                dayLabel={dayLabels[dayIdx]}
                dayIdx={dayIdx}
                run={run} />
            </div>
          )}

          {/* ═══ LIGHTNING TAB ═══ */}
          {tab === 'lightning' && (
            <div className="wp-fade-in" style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <Card style={{ padding:'10px 14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <Layers style={{ width:13, height:13, color:'#a78bfa' }} />
                  <span style={{ fontSize:'0.74rem', fontWeight:700, color:t.textPrimary }}>Risk Overlay on Lightning Map</span>
                  <div style={{ flex:1 }} />
                  <button onClick={() => setOutlookEnabled((o) => !o)}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, fontSize:'0.72rem', fontWeight:700, cursor:'pointer', background: outlookEnabled ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.04)', color: outlookEnabled ? '#a78bfa' : t.textMuted, border:`1px solid ${outlookEnabled ? '#a78bfa55' : t.cardBorder}` }}>
                    {outlookEnabled ? <ToggleRight style={{ width:14, height:14 }} /> : <ToggleLeft style={{ width:14, height:14 }} />}
                    {outlookEnabled ? 'Polygons On' : 'Polygons Off'}
                  </button>
                </div>
              </Card>
              <TCMLightningVerification data={data} region={region} dayIdx={dayIdx} riskType={riskType} outlookEnabled={outlookEnabled} isAdmin={isAdmin} />
            </div>
          )}

          {/* ═══ ARCHIVE TAB ═══ */}
          {tab === 'archive' && (
            <div className="wp-fade-in">
              <TCMArchive region={region} />
            </div>
          )}

          {/* ═══ ADMIN TAB ═══ */}
          {tab === 'admin' && isAdmin && (
            <div className="wp-fade-in" style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {/* Self-host data source — admin-only, saves for this session */}
              <OMDataSourcePanel />
              {/* Run controls */}
              <Card style={{ padding:'14px 16px', position:'relative', zIndex:100, overflow:'visible' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
                  <Database style={{ width:13, height:13, color:t.textMuted }} />
                  <span style={{ fontSize:'0.7rem', fontWeight:800, color:t.textMuted, textTransform:'uppercase', letterSpacing:'0.08em' }}>Model Control</span>
                  {refreshStartTime && dayIdx === 0 && (
                    <span style={{ fontSize:'0.62rem', color:'#f59e0b', fontFamily:"'DM Mono',monospace", background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.25)', padding:'2px 7px', borderRadius:5 }}>
                      Day 1 showing from {refreshStartTime.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} UTC
                    </span>
                  )}
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                  <button onClick={handleRerun} disabled={loading || runStatus==='running'}
                    style={{ padding:'9px 15px', borderRadius:10, background:runStatus==='done'?'rgba(34,197,94,0.16)':runStatus==='error'?'rgba(239,68,68,0.16)':'rgba(99,102,241,0.14)', border:`1px solid ${runStatus==='done'?'rgba(34,197,94,0.45)':runStatus==='error'?'rgba(239,68,68,0.45)':'rgba(99,102,241,0.35)'}`, color:runStatus==='done'?'#22c55e':runStatus==='error'?'#f87171':'#818cf8', fontSize:'0.78rem', fontWeight:800, cursor:(loading||runStatus==='running')?'wait':'pointer', display:'flex', alignItems:'center', gap:7, opacity:(loading||runStatus==='running')?0.7:1 }}>
                    {(loading||runStatus==='running')
                      ? <><Loader2 className="animate-spin" style={{width:14,height:14}}/> Running Model…</>
                      : runStatus==='done'
                      ? <><CheckCircle style={{width:14,height:14}}/> Model Run Complete</>
                      : runStatus==='error'
                      ? <><AlertTriangle style={{width:14,height:14}}/> Run Failed — Retry</>
                      : <><Play style={{width:14,height:14}}/> Run Model</>}
                  </button>
                  {canContinue && (
                    <button onClick={handleContinue} disabled={continuing || loading || runStatus==='running'}
                      style={{ padding:'9px 15px', borderRadius:10, background:'rgba(16,185,129,0.14)', border:'1px solid rgba(16,185,129,0.4)', color:'#10b981', fontSize:'0.78rem', fontWeight:800, cursor:(continuing||loading)?'wait':'pointer', display:'flex', alignItems:'center', gap:7, opacity:(continuing||loading)?0.7:1 }}>
                      {continuing
                        ? <><Loader2 className="animate-spin" style={{width:14,height:14}}/> Computing Day {Math.min(4,(data?.maxDay ?? 0) + 2)}…</>
                        : <><Play style={{width:14,height:14}}/> Continue → Day {Math.min(4,(data?.maxDay ?? 0) + 2)}</>}
                    </button>
                  )}
                  {!!data?.grid?.length && (
                    <button onClick={handleManualSave} disabled={savingRun || loading || runStatus==='running'}
                      style={{ padding:'9px 15px', borderRadius:10, background:'rgba(56,189,248,0.14)', border:'1px solid rgba(56,189,248,0.4)', color:'#38bdf8', fontSize:'0.78rem', fontWeight:800, cursor:(savingRun||loading)?'wait':'pointer', display:'flex', alignItems:'center', gap:7, opacity:(savingRun||loading)?0.7:1 }}>
                      {savingRun
                        ? <><Loader2 className="animate-spin" style={{width:14,height:14}}/> Publishing…</>
                        : <><Save style={{width:14,height:14}}/> Save &amp; Publish</>}
                    </button>
                  )}
                  <button onClick={() => setShowDrawTool(v => !v)}
                    style={{ padding:'9px 15px', borderRadius:10, background:showDrawTool?'rgba(245,158,11,0.18)':'rgba(245,158,11,0.08)', border:`1px solid ${showDrawTool?'rgba(245,158,11,0.5)':'rgba(245,158,11,0.25)'}`, color:showDrawTool?'#f59e0b':'#d97706', fontSize:'0.78rem', fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
                    <PenLine style={{width:14,height:14}}/> {showDrawTool ? 'Close Draw Tool' : 'Draw Outlook'}
                  </button>
                </div>
                {!!data?.daysAvailable && (
                  <div style={{ fontSize:'0.62rem', color:t.textMuted, fontFamily:"'DM Mono',monospace", marginTop:10 }}>
                    {data.daysAvailable >= 3 ? 'All 3 days computed' : `Days 1–${data.daysAvailable} computed · Continue for more`}
                  </div>
                )}
                {lastRunInfo && (
                  <div style={{ fontSize:'0.62rem', color: lastRunInfo.dbSaved === false ? '#f59e0b' : t.textMuted, fontFamily:"'DM Mono',monospace", marginTop:4 }}>
                    Last run: {lastRunInfo.runLabel} · {lastRunInfo.points} pts · {lastRunInfo.dbSaved === false ? `saved locally only — NOT published (${lastRunInfo.dbSaveError || 'DB write failed'})` : 'saved to DB'}
                  </div>
                )}
                {saveMsg && (
                  <div style={{ fontSize:'0.62rem', color: saveMsg.ok ? '#22c55e' : '#f59e0b', fontFamily:"'DM Mono',monospace", marginTop:4, maxWidth:520 }}>
                    {saveMsg.text}
                  </div>
                )}
              </Card>
        {isAdmin && showDrawTool && (() => {
          const DRAW_LEVELS = [
            { level:'Very Low', color:'rgba(34,139,87,0.65)', border:'#22884f', fill:'rgba(34,139,87,0.35)' },
            { level:'Low', color:'rgba(34,170,82,0.70)', border:'#22aa52', fill:'rgba(34,170,82,0.40)' },
            { level:'Marginal', color:'rgba(202,138,4,0.75)', border:'#a3760a', fill:'rgba(202,138,4,0.45)' },
            { level:'Slight', color:'rgba(234,88,12,0.75)', border:'#c2410c', fill:'rgba(234,88,12,0.45)' },
            { level:'Moderate', color:'rgba(220,38,38,0.78)', border:'#b91c1c', fill:'rgba(220,38,38,0.48)' },
            { level:'High', color:'rgba(126,34,206,0.80)', border:'#6b21a8', fill:'rgba(126,34,206,0.50)' },
            { level:'Severe', color:'rgba(15,15,15,0.82)', border:'#1e1e1e', fill:'rgba(15,15,15,0.45)' },
          ];
          const activeLevelCfg = DRAW_LEVELS.find(l => l.level === activeDrawLevel) || DRAW_LEVELS[2];
          const handleSaveOutlook = async () => {
            if (drawShapes.length === 0) { alert('Draw at least one shape first.'); return; }
            setSavingOutlook(true);
            try {
              const targetDate = new Date(run);
              targetDate.setDate(targetDate.getDate() + drawOutlookDayIdx);
              const isoDate = targetDate.toISOString().slice(0, 10);
              const drawnData = {
                shapes: drawShapes,
                label: outlookLabel || `Admin outlook ${isoDate}`,
                region,
                isoDate,
                dayIdx: drawOutlookDayIdx,
                createdAt: editingOutlookId ? undefined : Date.now(),
                forecastType: outlookForecastType,
                description: outlookDescription,
                overall_risk: outlookOverallRisk,
                peak_window: outlookPeakWindow,
                thunderstorm_overview: outlookThunderstormOverview,
                peak_24h: outlookPeak24h,
              };

              let record;
              if (editingOutlookId) {
                // ── Update existing record ─────────────────────────────────
                record = await updateAdminDrawnOutlook(editingOutlookId, region, isoDate, {
                  ...drawnData,
                  createdAt: savedOutlooks.find(o => o.id === editingOutlookId)?.createdAt || Date.now(),
                });
                setSavedOutlooks(prev => prev.map(o => o.id === editingOutlookId ? { ...o, ...record, data: record.data || drawnData } : o));
              } else {
                // ── Create new record ──────────────────────────────────────
                record = await saveAdminDrawnOutlook(region, isoDate, drawnData);
                setSavedOutlooks(prev => [record, ...prev]);
              }

              // Reset draw tool
              setDrawShapes([]);
              setOutlookLabel('');
              setOutlookForecastType('initial');
              setOutlookDescription('');
              setOutlookOverallRisk('');
              setOutlookPeakWindow('');
              setOutlookThunderstormOverview('');
              setOutlookPeak24h(DEFAULT_PEAK_24H_WP);
              setEditingOutlookId(null);
              setShowDrawTool(false); if (!editingOutlookId) { base44.functions.invoke('sendOutlookEmailAlert', { overall_risk: outlookOverallRisk?.match(/Severe|High|Moderate|Slight|Marginal|Low|Very Low/i)?.[0] || activeDrawLevel || 'Marginal', label: drawnData.label, description: outlookDescription, peak_window: outlookPeakWindow, thunderstorm_overview: outlookThunderstormOverview, isoDate, region }).then(res => console.info('[OutlookEmailAlert]', res?.data || res)).catch(err => console.warn('[OutlookEmailAlert] failed:', err?.message || err)); }
              alert(editingOutlookId ? 'Outlook updated successfully.' : 'Outlook saved and published to all users.');
            } catch (e) {
              alert('Save failed: ' + (e?.message || 'unknown error'));
            }
            setSavingOutlook(false);
          };
          return (
            <Card data-draw-tool style={{ padding:0, marginBottom:14, border:`1px solid ${editingOutlookId ? 'rgba(99,102,241,0.55)' : 'rgba(245,158,11,0.35)'}`, background:'rgba(15,20,40,0.97)', overflow:'hidden', position:'relative', zIndex:50 }}>
              {/* Toolbar */}
              <div style={{ padding:'10px 14px', borderBottom:`1px solid ${editingOutlookId ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.2)'}`, background: editingOutlookId ? 'rgba(99,102,241,0.08)' : 'rgba(245,158,11,0.06)', display:'flex', flexWrap:'wrap', alignItems:'center', gap:8 }}>
                <PenLine style={{width:14,height:14,color: editingOutlookId ? '#a78bfa' : '#f59e0b'}}/>
                <span style={{ fontSize:'0.76rem', fontWeight:800, color: editingOutlookId ? '#a78bfa' : '#f59e0b', letterSpacing:'0.02em' }}>
                  {editingOutlookId ? 'Edit Outlook' : 'Draw Outlook Tool'}
                </span>
                {editingOutlookId && (
                  <span style={{ fontSize:'0.62rem', fontWeight:700, padding:'2px 8px', borderRadius:99, background:'rgba(99,102,241,0.18)', border:'1px solid rgba(99,102,241,0.40)', color:'#a78bfa' }}>
                    Editing existing
                  </span>
                )}
                {editingOutlookId && (
                  <button onClick={() => { setEditingOutlookId(null); setDrawShapes([]); setOutlookLabel(''); setOutlookForecastType('initial'); setOutlookDescription(''); setOutlookOverallRisk(''); setOutlookPeakWindow(''); setOutlookThunderstormOverview(''); setOutlookPeak24h(DEFAULT_PEAK_24H_WP); }}
                    style={{ padding:'3px 8px', borderRadius:6, fontSize:'0.64rem', fontWeight:700, cursor:'pointer', background:'transparent', border:'1px solid rgba(99,102,241,0.35)', color:'#6366f1', marginLeft:4 }}>
                    Cancel edit
                  </button>
                )}
                {/* Day selector */}
                <div style={{ display:'flex', gap:3, background:'rgba(0,0,0,0.25)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, padding:'3px' }}>
                  {dayLabels.map((label, di) => (
                    <button key={di} onClick={() => setDrawOutlookDayIdx(di)}
                      style={{ padding:'3px 10px', borderRadius:6, fontSize:'0.66rem', fontWeight:700, cursor:'pointer', border:`1px solid ${drawOutlookDayIdx===di ? 'rgba(245,158,11,0.6)' : 'transparent'}`, background: drawOutlookDayIdx===di ? 'rgba(245,158,11,0.25)' : 'transparent', color: drawOutlookDayIdx===di ? '#f59e0b' : '#64748b', transition:'all 0.15s' }}>
                      Day {di+1} · {label}
                    </button>
                  ))}
                </div>
                <div style={{flex:1}}/>
                {/* Risk level picker */}
                <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                  {DRAW_LEVELS.map(l => (
                    <button key={l.level} onClick={() => setActiveDrawLevel(l.level)}
                      style={{ padding:'4px 9px', borderRadius:6, fontSize:'0.66rem', fontWeight:700, cursor:'pointer', background: activeDrawLevel===l.level ? l.fill : 'rgba(255,255,255,0.04)', border:`1px solid ${activeDrawLevel===l.level ? l.border : 'rgba(255,255,255,0.1)'}`, color: activeDrawLevel===l.level ? l.border : '#94a3b8', transition:'all 0.15s' }}>
                      {l.level}
                    </button>
                  ))}
                </div>
                <button onClick={() => setDrawMode(v => !v)}
                  style={{ padding:'6px 11px', borderRadius:8, fontSize:'0.72rem', fontWeight:700, cursor:'pointer', background: drawMode?'rgba(56,189,248,0.18)':'rgba(255,255,255,0.05)', border:`1px solid ${drawMode?'rgba(56,189,248,0.5)':'rgba(255,255,255,0.1)'}`, color: drawMode?'#38bdf8':'#94a3b8', display:'flex', alignItems:'center', gap:5 }}>
                  {drawMode ? <><Pen style={{width:11,height:11}}/> Drawing…</> : <><Pen style={{width:11,height:11}}/> Draw</>}
                </button>
                <button onClick={() => setDrawShapes(s => s.slice(0,-1))} disabled={drawShapes.length===0}
                  style={{ padding:'6px 9px', borderRadius:8, fontSize:'0.7rem', cursor:'pointer', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', color:'#64748b', display:'flex', alignItems:'center', gap:5 }}>
                  <Eraser style={{width:11,height:11}}/> Undo
                </button>
                <button onClick={() => { if (window.confirm('Clear all drawn risk areas?')) setDrawShapes([]); }} disabled={drawShapes.length===0} title="Clear all drawn risk areas" style={{ padding:'6px 9px', borderRadius:8, fontSize:'0.7rem', cursor:'pointer', background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171', display:'flex', alignItems:'center', gap:5 }}><Trash2 style={{width:11,height:11}}/> Clear All</button>
                <div title="Adjust transparency of drawn risk areas" style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 9px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)' }}><span style={{ fontSize:'0.62rem', fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em' }}>Opacity</span><input type="range" min="10" max="100" step="5" value={Math.round(drawOpacity * 100)} onChange={e => setDrawOpacity(Number(e.target.value) / 100)} style={{ width:80, accentColor:'#f59e0b', cursor:'pointer' }} /><span style={{ fontSize:'0.66rem', fontWeight:700, color:'#f59e0b', fontFamily:"'DM Mono',monospace", minWidth:30, textAlign:'right' }}>{Math.round(drawOpacity * 100)}%</span></div><button onClick={() => setShowImpactedModal(true)} disabled={drawShapes.length===0} title="Show cities & towns inside the drawn polygons" style={{ padding:'6px 9px', borderRadius:8, fontSize:'0.7rem', cursor:drawShapes.length===0?'not-allowed':'pointer', background:'rgba(245,158,11,0.10)', border:'1px solid rgba(245,158,11,0.30)', color:'#f59e0b', display:'flex', alignItems:'center', gap:5, opacity:drawShapes.length===0?0.5:1 }}><MapPin style={{width:11,height:11}}/> Impacted Locations</button><DrawnAreaLocationsModal open={showImpactedModal} onClose={() => setShowImpactedModal(false)} shapes={drawShapes} />
              </div>
              {/* Map drawing area */}
              <div style={{ position:'relative', height:480 }}>
                <TCMLeafletBase bbox={REGIONS[region]?.bbox} height={480} lightMode={false}>
                  {({ projector, map }) => {
                    // Draw existing shapes as SVG overlay
                    const { x: w, y: h } = projector.size;
                    return (
                      <>
                        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
                          style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:400 }}>
                          <defs>
                            <pattern id="draw-severe-hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                              <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(0,0,0,0.75)" strokeWidth="3.5" />
                            </pattern>
                          </defs>
                          {drawShapes.map((shape, si) => {
                            const cfg = DRAW_LEVELS.find(l => l.level === shape.riskLevel) || DRAW_LEVELS[2];
                            if (!shape.latLngs?.length) return null;
                            // Always reproject from lat/lng so shapes stay geo-anchored when map pans/zooms.
                            // smoothPx was only valid for the frame it was drawn — don't use it for display.
                            const projected = shape.latLngs.map(([lat, lon]) => projector.project(lat, lon));
                            const d = smoothSvgPath(projected.map(p => ({ x: p[0], y: p[1] })));
                            const isSevere = shape.riskLevel === 'Severe';
                            return (
                              <path key={si} d={d}
                                fill={isSevere ? 'url(#draw-severe-hatch)' : cfg.fill}
                                stroke={isSevere ? 'rgba(0,0,0,0.85)' : cfg.border}
                                strokeWidth={isSevere ? 2.2 : 2} strokeLinejoin="round" strokeLinecap="round"
                                opacity={drawOpacity} />
                            );
                          })}
                        </svg>
                        {/* Invisible click-capture canvas for drawing */}
                        {drawMode && (
                          <AdminDrawCanvas
                            map={map} projector={projector}
                            color={activeLevelCfg.fill} borderColor={activeLevelCfg.border}
                            onShapeComplete={(latLngs, smoothPx) => {
                              setDrawShapes(s => [...s, { riskLevel: activeDrawLevel, color: activeLevelCfg.fill, border: activeLevelCfg.border, latLngs, smoothPx }]);
                            }}
                          />
                        )}
                      </>
                    );
                  }}
                </TCMLeafletBase>
              </div>
              {/* Extended save form */}
              <div style={{ padding:'14px 14px 0', borderTop:'1px solid rgba(245,158,11,0.2)', display:'flex', flexDirection:'column', gap:10 }}>
                {/* Forecast Type + Label row */}
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:'0.7rem', color:'#94a3b8', flexShrink:0 }}>Forecast Type:</span>
                  {[
                    { value:'initial', label:'Initial Forecast' },
                    { value:'update', label:'Update' },
                  ].map(ft => (
                    <button key={ft.value} onClick={() => setOutlookForecastType(ft.value)}
                      style={{ padding:'4px 10px', borderRadius:7, fontSize:'0.68rem', fontWeight:700, cursor:'pointer', border:`1.5px solid ${outlookForecastType===ft.value?'rgba(245,158,11,0.7)':'rgba(255,255,255,0.12)'}`, background:outlookForecastType===ft.value?'rgba(245,158,11,0.22)':'rgba(255,255,255,0.04)', color:outlookForecastType===ft.value?'#f59e0b':'#64748b', transition:'all 0.15s' }}>
                      {ft.label}
                    </button>
                  ))}
                </div>
                {/* Label row */}
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:'0.7rem', color:'#94a3b8', flexShrink:0 }}>Label (optional):</span>
                  <input value={outlookLabel} onChange={e => setOutlookLabel(e.target.value)} placeholder="e.g. Thunderstorm Risk Day 1"
                    style={{ flex:1, padding:'5px 9px', borderRadius:7, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#f1f5f9', fontSize:'0.74rem', outline:'none' }}/>
                </div>
                {/* Description */}
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#a78bfa', textTransform:'uppercase', letterSpacing:'0.06em' }}>Description</span>
                  <textarea value={outlookDescription} onChange={e => setOutlookDescription(e.target.value)}
                    placeholder="Full outlook description shown to all users..."
                    rows={3}
                    style={{ padding:'6px 9px', borderRadius:7, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#f1f5f9', fontSize:'0.74rem', outline:'none', resize:'vertical', fontFamily:'inherit' }}/>
                </div>
                {/* Overall Risk */}
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#f87171', textTransform:'uppercase', letterSpacing:'0.06em' }}>Overall Risk</span>
                  <textarea value={outlookOverallRisk} onChange={e => setOutlookOverallRisk(e.target.value)}
                    placeholder="e.g. Marginal to Moderate risk across central England..."
                    rows={2}
                    style={{ padding:'6px 9px', borderRadius:7, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#f1f5f9', fontSize:'0.74rem', outline:'none', resize:'vertical', fontFamily:'inherit' }}/>
                </div>
                {/* Peak Window + Thunderstorm Overview side by side */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#38bdf8', textTransform:'uppercase', letterSpacing:'0.06em' }}>Peak Window</span>
                    <input value={outlookPeakWindow} onChange={e => setOutlookPeakWindow(e.target.value)} placeholder="e.g. 14:00 – 20:00"
                      style={{ padding:'5px 9px', borderRadius:7, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#f1f5f9', fontSize:'0.74rem', outline:'none' }}/>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#facc15', textTransform:'uppercase', letterSpacing:'0.06em' }}>⚡ Thunderstorm Overview</span>
                    <textarea value={outlookThunderstormOverview} onChange={e => setOutlookThunderstormOverview(e.target.value)}
                      placeholder="Thunderstorm specific notes..."
                      rows={2}
                      style={{ padding:'6px 9px', borderRadius:7, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', color:'#f1f5f9', fontSize:'0.74rem', outline:'none', resize:'vertical', fontFamily:'inherit' }}/>
                  </div>
                </div>
                {/* 24h Peak at 3h intervals */}
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#c084fc', textTransform:'uppercase', letterSpacing:'0.06em' }}>24-Hour Peak Activity (3h intervals)</span>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:4 }}>
                    {outlookPeak24h.map((slot, i) => {
                      const RISK_LEVELS_WP = ['No Risk','Very Low','Low','Marginal','Slight','Moderate','High','Severe'];
                      const RISK_COLORS_WP = { 'No Risk':'#475569','Very Low':'#5b9bd5','Low':'#3da356','Marginal':'#d9a91c','Slight':'#d97316','Moderate':'#dc3f3f','High':'#7c4ddb','Severe':'#0f172a' }
                      const barColor = RISK_COLORS_WP[slot.risk_level] || '#475569';
                      return (
                        <div key={slot.time} style={{ borderRadius:8, padding:'6px 4px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', textAlign:'center' }}>
                          <p style={{ fontSize:9, fontWeight:700, color:'#94a3b8', margin:'0 0 3px' }}>{slot.time}</p>
                          <select value={slot.risk_level}
                            onChange={e => setOutlookPeak24h(arr => { const n=[...arr]; n[i]={...n[i],risk_level:e.target.value}; return n; })}
                            style={{ width:'100%', fontSize:8, borderRadius:4, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(0,0,0,0.3)', color:'#f1f5f9', padding:'1px 0', outline:'none', marginBottom:3 }}>
                            {RISK_LEVELS_WP.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                          <div style={{ height:3, borderRadius:2, background:'rgba(255,255,255,0.1)', overflow:'hidden', marginBottom:2 }}>
                            <div style={{ height:'100%', width:`${slot.activity}%`, background:barColor, borderRadius:2 }} />
                          </div>
                          <input type="range" min="0" max="100" step="5" value={slot.activity}
                            onChange={e => setOutlookPeak24h(arr => { const n=[...arr]; n[i]={...n[i],activity:Number(e.target.value)}; return n; })}
                            style={{ width:'100%', accentColor:barColor, cursor:'pointer' }}/>
                          <p style={{ fontSize:8, color:barColor, margin:0, fontWeight:700 }}>{slot.activity}%</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Publish button row */}
                <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:10 }}>
                  <button onClick={handleSaveOutlook} disabled={savingOutlook || drawShapes.length===0}
                    style={{ padding:'8px 18px', borderRadius:9, background: editingOutlookId ? 'rgba(99,102,241,0.15)' : 'rgba(34,197,94,0.15)', border: `1px solid ${editingOutlookId ? 'rgba(99,102,241,0.4)' : 'rgba(34,197,94,0.4)'}`, color: editingOutlookId ? '#a78bfa' : '#22c55e', fontSize:'0.78rem', fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', gap:6, opacity:(savingOutlook||drawShapes.length===0)?0.5:1 }}>
                    {savingOutlook ? <Loader2 className="animate-spin" style={{width:13,height:13}}/> : <Save style={{width:13,height:13}}/>}
                    {savingOutlook ? 'Saving…' : editingOutlookId ? 'Save Changes' : 'Publish Outlook'}
                  </button>
                  <span style={{ fontSize:'0.66rem', color:'#475569' }}>{drawShapes.length} shape{drawShapes.length!==1?'s':''} drawn · {editingOutlookId ? 'Updates the existing record in DB' : 'Saved to DB and visible to all users'}</span>
                </div>
              </div>
            </Card>
          );
        })()}
              {/* Diagnostics */}
              <AIAuthCard verdict={null} loading={false} tokens={t} />
              <TCMApiStatus tokens={t} />
            </div>
          )}
        </main>
      </div>

      <LocationPanel data={data} riskType={riskType} dayIdx={dayIdx} run={run} point={clickPoint} onClose={() => setClickPoint(null)} />
    </div>);
}