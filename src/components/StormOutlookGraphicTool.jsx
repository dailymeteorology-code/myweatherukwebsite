/* StormOutlookGraphicTool — thunderstorm outlook graphic generator. */
import { useStormLightning } from '@/components/tcm/stormOutlookHelpers'; import UKVRainLayer from '@/components/tcm/UKVRainLayer'; import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Download, Eraser, Eye, EyeOff, Clock, Pen, MousePointer, Undo2, X, Zap,
  CloudLightning, Tornado, AlertTriangle, ShieldAlert, MapPin,
  CloudRain, CloudDrizzle, CloudRainWind, Radar, Save, FolderOpen, Check, Loader2, Circle, RefreshCw,
  Type, MoveUpRight, Gauge, DownloadCloud, FileText, Crop, Trash2, Wind,
} from 'lucide-react';
import html2canvas from 'html2canvas';
// The still-frame export goes through the browser's own renderer rather than
// html2canvas's re-implementation of it — see the JPG export below for why.
// (html2canvas is still used for the .webm frame grabs, where per-frame speed
// matters more than exactness and the panels are not the subject.)
import { toCanvas } from 'html-to-image';
import { base44 } from '@/api/base44Client';
import { RISK_META, RISK_PALETTES, LEVEL_RANGE } from '@/components/tcm/riskConfig';
import { buildOutlookLayers, buildHiResOutlookLayers } from '@/lib/tcmOutlookLayers';
import { loadLatestTCMFromDB } from '@/lib/tcmForecastCache';
import TimelinePill from '@/components/tcm/StormOutlookTimelinePill';
import { RADAR_BANDS, UKRadarLayer } from '@/lib/ukRadar';

// --- Conditional Severe -----------------------------------------------------
// A risk tier that sits BETWEEN High and Severe. Like Severe it flags the
// *potential* for severe thunderstorms, but it is conditional — it depends on
// uncertain ingredients coming together. It renders as a dashed BLACK outline
// with a plain translucent-grey fill and NO hatching (Severe keeps the hatch).
// Defined inline here (riskConfig isn't the place for a graphic-only tier).
const COND_SEVERE_ID = 'Conditional Severe';
const COND_SEVERE_COLOR = '#0b0f1a';   // near-black dashed outline
const COND_SEVERE = {
  id: COND_SEVERE_ID,
  short: 'COND SVRE',
  range: 'COND SVR',
  color: COND_SEVERE_COLOR,
  fill: 'rgba(200,205,215,0.18)',
  border: COND_SEVERE_COLOR,
};

// Darken a hex/rgb colour towards black by `amount` (0..1). Used for the
// per-area conditional outline: a drawn area's conditional border is just a
// darker shade of that area's own colour. Accepts #rgb, #rrggbb, or rgb()/rgba().
function darkenColor(input, amount = 0.45) {
  if (!input) return '#000000';
  let r, g, b;
  const s = String(input).trim();
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return '#000000';
    const parts = m[1].split(',').map(p => parseFloat(p));
    [r, g, b] = parts;
  }
  if (![r, g, b].every(Number.isFinite)) return '#000000';
  const k = 1 - Math.max(0, Math.min(1, amount));
  const d = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[d(r), d(g), d(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Ray-casting point-in-polygon test. `pt` and `poly` points are [x,y] in the
// same (normalised 0..1) space. Used to find which drawn area a click landed in.
function pointInPolygon(pt, poly) {
  if (!poly || poly.length < 3) return false;
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// --- Risk levels with % ranges from canonical TCM config ---
const GRAPHIC_LEVELS_BASE = RISK_META
  .filter(r => r.level !== 'No Risk')
  .map(r => {
    let [lo, hi] = LEVEL_RANGE[r.level] || [0, 0];
    if (r.level === 'High') hi = 100;
    const pal = RISK_PALETTES.thunderstorm[r.level];
    // Graphic-only palette + short labels (shared riskConfig untouched).
    const G = { 'Very Low': ['#60a5fa', 'rgba(96,165,250,0.34)', 'TSTM'], 'Low': ['#86efac', 'rgba(134,239,172,0.38)', 'MRGL'], 'Marginal': ['#facc15', 'rgba(250,204,21,0.42)', 'SLGT'], 'Slight': ['#fb923c', 'rgba(249,115,22,0.45)', 'ENH'], 'Moderate': ['#f87171', 'rgba(248,113,113,0.45)', 'MDT'], 'High': ['#a78bfa', 'rgba(167,139,250,0.45)', 'HIGH'] };
    const g = G[r.level];
    return {
      id: r.level,
      short: g ? g[2] : (r.level === 'Severe' ? 'SVRE' : r.level.toUpperCase()),
      range: r.level === 'Severe' ? 'SVR TSTMS' : `${lo}-${hi}%`,
      color: g ? g[0] : pal.color,
      fill: g ? g[1] : pal.fill,
      border: g ? g[0] : pal.border,
    };
  });

// Insert Conditional Severe immediately before Severe (so the ordering is
// ... High -> Conditional Severe -> Severe). If Severe is absent for any
// reason, append Conditional Severe at the end.
const GRAPHIC_LEVELS = (() => {
  const out = [];
  let inserted = false;
  for (const lvl of GRAPHIC_LEVELS_BASE) {
    if (lvl.id === 'Severe' && !inserted) { out.push(COND_SEVERE); inserted = true; }
    out.push(lvl);
  }
  if (!inserted) out.push(COND_SEVERE);
  return out;
})();
const RISK_BY_ID = Object.fromEntries(GRAPHIC_LEVELS.map(l => [l.id, l]));

// Helpers so every render site treats both special tiers consistently.
const isSevereId = (id) => id === 'Severe';
const isCondSevereId = (id) => id === COND_SEVERE_ID;

// --- Radar mode: rain-rate colour levels + radar hazards ---
// The radar is the Met Office 1 km composite (lib/ukRadar: the same radar and palette as the
// Model Data page and the motion graphics); these bands are that palette, so the key matches
// the imagery. Ids are kept from the old key so saved graphics still resolve.
const RADAR_LEVELS = RADAR_BANDS;
const RADAR_BY_ID = Object.fromEntries(RADAR_LEVELS.map(l => [l.id, l]));
const LEVEL_LOOKUP = { ...RADAR_BY_ID, ...RISK_BY_ID };

const RADAR_HAZARDS = [
  { id: 'heavyrain',    label: 'Heavy Rain',    Icon: CloudRain,      color: '#3b82f6', hatched: false },
  { id: 'showers',      label: 'Showers',       Icon: CloudDrizzle,   color: '#7dd3fc', hatched: false },
  { id: 'thunder',      label: 'Thunderstorms', Icon: CloudLightning, color: '#facc15', hatched: false },
  { id: 'heavyshowers', label: 'Heavy Showers', Icon: CloudRainWind,  color: '#22d3ee', hatched: false },
];

// --- Timeline granularity ---------------------------------------------------
// The timeline pill can run at 3-hourly (the classic 06>06 band), 2-hourly or
// hourly resolution for fast-evolving convective days. Each preset is a list of
// stamp labels; the active one drives both the pill render and the stamp arrays.
// Build timeline stamps between a start and end time (HH:MM), stepping by the
// granularity. End at/earlier than start = next day, so 06:00->06:00 still gives
// the classic 06,09,...,06 band; a custom window (e.g. 12:00->00:00) just yields
// a different stamp set via the same logic. Used by both admin + studio.
const buildStamps = (gran, startHHMM = '06:00', endHHMM = '06:00') => {
  const [sh, sm] = (startHHMM||'06:00').split(':').map(Number), [eh, em] = (endHHMM||'06:00').split(':').map(Number);
  let s = sh*60+sm, e = eh*60+em; if (e <= s) e += 1440;
  const st = (gran==='1h'?1:gran==='2h'?2:3)*60, out = [];
  for (let t = s; t <= e; t += st) out.push({ label: String(Math.floor((t%1440)/60)).padStart(2,'0') });
  return out;
};
const TIMELINE_STAMPS = buildStamps('3h');

// --- Forecaster confidence --------------------------------------------------
// Operational outlooks (ESTOFEX especially) carry an explicit confidence rating.
// Surfaced as a chip in the Risk Key card so the public graphic reads as a real
// product rather than a bare risk map.
// Rendered on the graphic as a 5-box segmented meter (see the Confidence block
// in the Risk Key card), so each level carries how many of the 5 boxes it fills.
// The three original ids ('low' / 'medium' / 'high') are kept byte-for-byte so
// previously-saved graphics still resolve; 'very-low' / 'very-high' extend the
// scale at either end.
const CONFIDENCE_STEPS = 5;
const CONFIDENCE_LEVELS = [
  { id: 'very-low',  label: 'Very Low',  short: 'V.LOW',  bars: 1, color: '#f87171' },
  { id: 'low',       label: 'Low',       short: 'LOW',    bars: 2, color: '#fb923c' },
  { id: 'medium',    label: 'Medium',    short: 'MEDIUM', bars: 3, color: '#facc15' },
  { id: 'high',      label: 'High',      short: 'HIGH',   bars: 4, color: '#4ade80' },
  { id: 'very-high', label: 'Very High', short: 'V.HIGH', bars: 5, color: '#22c55e' },
];
const CONFIDENCE_BY_ID = Object.fromEntries(CONFIDENCE_LEVELS.map(c => [c.id, c]));

// --- On-map annotation palette ----------------------------------------------
// Forecaster text labels placed directly on the map (SPC/ESTOFEX style:
// "MAIN THREAT 14-18Z", "TRAINING STORMS"). Stored in normalised 0..1 space so
// they survive the responsive scale and export at the right place.
const ANNOTATION_COLORS = ['#ffffff', '#fde047', '#f87171', '#38bdf8', '#a78bfa', '#4ade80', '#fb923c', '#111827'];
const ANNOTATION_SIZES = [
  { id: 'sm', label: 'S', px: 13 },
  { id: 'md', label: 'M', px: 17 },
  { id: 'lg', label: 'L', px: 22 },
];
const ANNOTATION_SIZE_PX = Object.fromEntries(ANNOTATION_SIZES.map(s => [s.id, s.px]));

/* Drawing-space and exported-canvas dimensions.

   Declared up here rather than beside their first use. latLonToNorm() below
   reads VIEW_*, and the JPG export path reads GRAPHIC_*, and both sit above
   where these used to be defined — which worked only because the readers are
   functions that run after the module (or the component body) has finished
   evaluating. That is fragile and it hid the dependency, so they lead now. */
const VIEW_W = 302, VIEW_H = 458;
const GRAPHIC_W = 640, GRAPHIC_H = 760;
/* The graphic's own base colour, used behind the export so a JPEG's opaque
   corners match the frame rather than going black. */
const GRAPHIC_BG = '#06040f';

// Project a geographic [lat, lon] (as stored by the TCM admin's Leaflet tool)
// into this tool's normalised 0..1 drawing space, via the SAME mercator
// projectPt() used for the coastline so imported areas register exactly.
function latLonToNorm(lat, lon) {
  const [x, y] = projectPt(lon, lat);
  return [x / VIEW_W, y / VIEW_H];
}

const HAZARDS = [
  { id: 'lightning', label: 'High Lightning', Icon: CloudLightning, color: '#ec4899', hatched: false },
  { id: 'hail',      label: 'Large Hail',     Icon: null,           color: '#22d3ee', hatched: false, customIcon: 'hail' },
  { id: 'flood',     label: 'Flash Flooding', Icon: null,           color: '#3b82f6', hatched: false, customIcon: 'flood' },
  { id: 'tornado',   label: 'Tornado',        Icon: Tornado,        color: '#f97316', hatched: false }, { id: 'wind', label: 'Strong Winds', Icon: Wind, color: '#0ea5e9', hatched: false },
  { id: 'severe',    label: 'Severe',         Icon: AlertTriangle,  color: '#a5b4fc', hatched: true  },
];

// --- Liquid-glass panel helper ----------------------------------------------
// A layered translucent tint, a strong backdrop blur with a saturation and
// brightness lift, a crisp top hairline and a soft inner glow. The multi-stop
// gradient gives the panel a subtle vertical sheen that reads as curved glass
// rather than a flat card.
//
// EXPORT MODE CHANGES EXACTLY ONE THING, and only because it has to.
// `backdrop-filter` blurs what is BEHIND an element, and the exporter renders
// the graphic inside an SVG <foreignObject> where there is no "behind" — the
// page is not in there. No DOM-to-image technique can reproduce it. So the
// export swaps the translucent tint for the colour that tint RESOLVES TO once
// it is flattened onto the backdrop, computed rather than eyeballed:
//
//     alpha x tint + (1 - alpha) x backdrop, backdrop = the #0b0a18 base
//       0.40 x (70,86,124) + 0.60 x (11,10,24) = (34,40,64)
//       0.34 x (40,54,86)  + 0.66 x (11,10,24) = (21,25,45)
//       0.46 x (16,24,44)  + 0.54 x (11,10,24) = (13,16,33)
//
// A little transparency is kept so what is genuinely behind a panel still
// shows through, the way the blur lets it.
//
// Everything else — the sheen, the shadows, the inner glow, the hairlines —
// is now identical in both, because the browser draws the export and it draws
// them correctly. Earlier versions carried export-only substitutes for all of
// those to work around a JavaScript CSS re-implementation; they are gone.
const glass = (extra = {}, exportMode = false) => ({
  background: exportMode
    ? 'linear-gradient(155deg, rgba(34,40,64,0.90) 0%, rgba(21,25,45,0.92) 45%, rgba(13,16,33,0.94) 100%)'
    : 'linear-gradient(155deg, rgba(70,86,124,0.40) 0%, rgba(40,54,86,0.34) 45%, rgba(16,24,44,0.46) 100%)',
  border: '1px solid rgba(255,255,255,0.26)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.46), 0 2px 10px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.40), inset 0 0 22px rgba(120,150,210,0.12), inset 0 -1px 0 rgba(0,0,0,0.24)',
  ...(exportMode ? {} : { backdropFilter: 'blur(22px) saturate(180%) brightness(1.08)', WebkitBackdropFilter: 'blur(22px) saturate(180%) brightness(1.08)' }),
  // `extra` is spread LAST and therefore wins every collision, including
  // `position`. Pass a panel's layout in here rather than spreading glass()
  // into a style object that already set position/top/right — those would be
  // overwritten by the relative default below and the panel would fall into
  // normal flow at full width. position:'relative' is a DEFAULT, present so the
  // sheen and the overflow clip have something to resolve against.
  borderRadius: 14, position: 'relative', overflow: 'hidden', ...extra,
});

// Specular highlights that sell the glass: a broad diagonal sheen across the
// top plus a thin bright edge line just inside the top border. Drawn in the
// export too — it sits at z-index 0 behind content at z-index 1, and the
// browser honours that ordering in the foreignObject exactly as it does on
// screen.
function GlassSheen() {
  return (
    <>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '58%',
        background: 'linear-gradient(158deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.07) 38%, transparent 72%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', top: 1, left: '8%', right: '8%', height: 1,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
    </>
  );
}

// --- Detailed UK + Ireland GeoJSON map ---
// Sources are tried in order. The georgique repo is the HIGH-DETAIL coastline
// (~3800 vertices across UK+Ireland with all the islands). We list both its
// `develop` and `master` branches as independent mirrors so a transient failure
// of one GitHub path doesn't drop us to a crude outline. The johan source is a
// ~56-vertex blob and is a LAST-RESORT only — see MIN_DETAIL_VERTICES below,
// which rejects any source that doesn't meet a real coastline's vertex count so
// the blob can never silently replace the detailed map.
const GEO_SOURCES = [
  ['https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/ireland.json'],
  ['https://raw.githubusercontent.com/georgique/world-geojson/master/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/master/countries/ireland.json'],
  // Last-resort crude outline — only used if every detailed mirror is unreachable.
  ['https://raw.githubusercontent.com/johan/world.geo.json/master/countries/GBR.geo.json',
   'https://raw.githubusercontent.com/johan/world.geo.json/master/countries/IRL.geo.json'],
];
// A real UK+Ireland coastline has thousands of vertices; the crude fallback has
// ~56. Anything below this is treated as "not the detailed map" and skipped in
// favour of the next mirror. Keeps us on the high-detail coastline.
const MIN_DETAIL_VERTICES = 800;
// GEO_CACHE_KEY is defined below, AFTER projectPt(), so it can embed the live
// projection signature (PROJ_SIG) and auto-invalidate whenever the map bounds or
// view size change — otherwise a previously-cached, already-projected coastline
// sits off-centre from a freshly-projected overlay.
// IMPORTANT: these bounds are kept byte-for-byte identical to the TCM page's
// GEO_BOUNDS_UK ({ latMin: 49.5, latMax: 61.0, lonMin: -10.8, lonMax: 2.5 }).
// The TCM page's "UK today" strike count — the number this graphic is meant to
// reproduce — counts every strike inside GEO_BOUNDS_UK. This box drives BOTH
// the map projection AND the inUKIreland() inclusion test below, so if the two
// boxes ever differ, this tool clips strikes the TCM page kept and the counts
// diverge. A previous tighter box here (latMin 49.7 / lon -11.0..2.2) silently
// dropped 1000+ strikes in the Channel and the East Anglia / North Sea margins.
// If the TCM bounds change, change these to match.
const MAP_BBOX = { lonMin: -10.8, lonMax: 2.5, latMin: 49.5, latMax: 61.0 };

// --- UK region presets for radar overlay ---
const UK_REGIONS = [
  { id: 'uk',       label: 'UK Wide',       bbox: { lonMin: -10.8, lonMax: 2.5,  latMin: 49.5, latMax: 61.0 } },
  { id: 'south',    label: 'South England',  bbox: { lonMin: -5.8,  lonMax: 1.8,  latMin: 50.0, latMax: 52.5 }, mask: '/static-data/south-england.geo.json', neighbours: '/static-data/france-north.geo.json', neighboursOutline: '/static-data/france-north-outline.geo.json' },
  { id: 'midlands', label: 'Midlands',       bbox: { lonMin: -4.0,  lonMax: 0.5,  latMin: 51.8, latMax: 54.0 } },
  { id: 'north',    label: 'North England',  bbox: { lonMin: -4.5,  lonMax: 0.2,  latMin: 53.5, latMax: 56.0 } },
  { id: 'scotland', label: 'Scotland',       bbox: { lonMin: -8.0,  lonMax: -1.5, latMin: 54.5, latMax: 61.0 } },
  { id: 'ireland',  label: 'Ireland',        bbox: { lonMin: -11.0, lonMax: -5.0, latMin: 51.3, latMax: 55.5 } },
  { id: 'wales',    label: 'Wales',          bbox: { lonMin: -5.5,  lonMax: -2.5, latMin: 51.3, latMax: 53.5 } },
];
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const Y_TOP = mercY(MAP_BBOX.latMax), Y_BOT = mercY(MAP_BBOX.latMin);

function projectPt(lon, lat) {
  const x = ((lon - MAP_BBOX.lonMin) / (MAP_BBOX.lonMax - MAP_BBOX.lonMin)) * VIEW_W;
  const y = ((Y_TOP - mercY(lat)) / (Y_TOP - Y_BOT)) * VIEW_H;
  return [x, y];
}

// A compact signature of everything projectPt() depends on. Any change to the
// map bounds or the view dimensions changes this string, which is baked into the
// coastline AND county cache keys below. That means a stale cache built against a
// different projection can never be read back — it is simply a different key, so
// the layer is re-fetched and re-projected with the CURRENT projectPt and always
// registers exactly with the map. Fixes county borders rendering off-centre /
// off the map after a projection change.
const PROJ_SIG = [
  MAP_BBOX.lonMin, MAP_BBOX.lonMax, MAP_BBOX.latMin, MAP_BBOX.latMax, VIEW_W, VIEW_H,
].join('_');
const GEO_CACHE_KEY = 'sotg_uk_geo_paths_v3_' + PROJ_SIG;

// A region's projected bbox rectangle (in VIEW space) — used to CLIP the white
// landmass + county lines to just the selected region so nothing outside it shows.
/* County-shaped region masks. A region with `mask` (South England) is clipped to
   the union of its real ceremonial counties instead of a straight-edged box, so
   the land, the county lines and the town labels stop at the county boundary. */
const maskCache = new Map();
function useRegionMask(regionId) {
  const reg = UK_REGIONS.find((r) => r.id === regionId);
  const url = reg?.mask || null;
  const [mask, setMask] = useState(() => (url ? maskCache.get(url) || null : null));
  useEffect(() => {
    if (!url) { setMask(null); return undefined; }
    if (maskCache.has(url)) { setMask(maskCache.get(url)); return undefined; }
    let live = true;
    fetch(url).then((r) => r.json()).then((gj) => {
      const polys = [], paths = [];
      for (const ft of gj.features || []) {
        const g = ft.geometry; if (!g) continue;
        const ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const p of ps) {
          polys.push(p[0]);
          paths.push(p.map((ring) => ring.map(([lo, la], i) => { const [x, y] = projectPt(lo, la); return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`; }).join('') + 'Z').join(''));
        }
      }
      const m = { paths, polys };
      maskCache.set(url, m);
      if (live) setMask(m);
    }).catch(() => {});
    return () => { live = false; };
  }, [url]);
  return mask;
}
const inMask = (mask, lon, lat) => mask.polys.some((ring) => pointInPolygon([lon, lat], ring));

/* Neighbouring land shown with a region (northern France and its départements
   for South England), drawn like the UK land: white fill, black coast, faint
   internal borders. Lives outside the UK map's box, so the SVG overflows. */
const neighbourCache = new Map();
function useProjectedGeo(url) {
  const [paths, setPaths] = useState(() => (url ? neighbourCache.get(url) || null : null));
  useEffect(() => {
    if (!url) { setPaths(null); return undefined; }
    if (neighbourCache.has(url)) { setPaths(neighbourCache.get(url)); return undefined; }
    let live = true;
    fetch(url).then((r) => r.json()).then((gj) => {
      const out = [];
      for (const ft of gj.features || []) {
        const g = ft.geometry; if (!g) continue;
        const ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        out.push(ps.map((p) => p.map((ring) => ring.map(([lo, la], i) => { const [x, y] = projectPt(lo, la); return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`; }).join('') + 'Z').join('')).join(''));
      }
      neighbourCache.set(url, out);
      if (live) setPaths(out);
    }).catch(() => {});
    return () => { live = false; };
  }, [url]);
  return paths;
}
function NeighbourLayer({ regionId }) {
  const reg = UK_REGIONS.find((r) => r.id === regionId);
  const paths = useProjectedGeo(reg?.neighbours || null);
  const outline = useProjectedGeo(reg?.neighboursOutline || null);
  if (!paths) return null;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
      {/* greyed out: context, not part of the forecast area */}
      <g>{paths.map((d, i) => <path key={i} d={d} fill="#8b93a1" fillOpacity="0.55" stroke="none" />)}</g>
      <g fill="none" stroke="#2b3240" strokeOpacity="0.55" strokeWidth="0.45" strokeLinejoin="round">{paths.map((d, i) => <path key={i} d={d} />)}</g>
      {outline && <g fill="none" stroke="#1f2633" strokeOpacity="0.8" strokeWidth="1.1" strokeLinejoin="round">{outline.map((d, i) => <path key={i} d={d} />)}</g>}
    </svg>
  );
}

function regionClipRect(region) {
  const [rx0, ry0] = projectPt(region.lonMin, region.latMax);
  const [rx1, ry1] = projectPt(region.lonMax, region.latMin);
  return { x: Math.min(rx0, rx1), y: Math.min(ry0, ry1), w: Math.abs(rx1 - rx0), h: Math.abs(ry1 - ry0) };
}

function geoToPath(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = projectPt(lon, lat);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      d += 'Z';
    }
  }
  return d;
}

// Count drawing vertices in a path string (number of M/L commands) so we can
// tell a detailed coastline from a crude blob without re-parsing the GeoJSON.
function countPathVertices(ds) {
  let n = 0;
  for (const d of ds) {
    const m = d.match(/[ML]/g);
    if (m) n += m.length;
  }
  return n;
}

// --- County / local-authority boundary lines (overlaid on the landmass) ---
// These are the administrative-area outlines drawn as thin GREY stroke-only
// lines on top of the white landmass, so the map reads like a Met Office /
// broadcast county map rather than a blank silhouette. Coverage spans the whole
// map: Great Britain, Northern Ireland AND the Republic of Ireland, each from a
// separate source (there is no single file with all of them):
//   • GB  — quantised TopoJSON of 380 local-authority districts (England,
//           Scotland, Wales). Much smaller over the wire than the equivalent
//           GeoJSON (~2 MB vs ~10 MB).
//   • NI  — quantised TopoJSON of the 11 NI local-government districts.
//   • IE  — GeoJSON of the Republic's 26 counties (+ a few city/county splits).
// Every source is projected with the SAME projectPt() used for the coastline
// (so the lines register exactly with the landmass), heavily point-decimated for
// this ~300 px-wide map, then the combined result is cached. GB has an
// England-only TopoJSON fallback if the GB file is unreachable; NI and IE are
// best-effort, so if one is briefly down the others still draw.
const COUNTY_GB_SOURCES = [
  'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/gb/topo_lad.json',
  'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/eng/topo_lad.json',
];
const COUNTY_NI_SOURCE = 'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/ni/topo_lgd.json';
const COUNTY_IE_SOURCE = 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/ireland-counties.geojson';
// v2: bumped from v1 (GB-only) so a previously-cached GB-only layer is discarded
// and re-fetched with Northern Ireland + the Republic of Ireland included.
// v3: bumped so any cache built against an older MAP_BBOX / view size is
// discarded and re-projected with the CURRENT projectPt — otherwise the cached
// (already-projected) county paths sit off-centre from the freshly-projected
// coastline.
const COUNTY_CACHE_KEY = 'sotg_uk_county_paths_v5_' + PROJ_SIG;
// Minimum projected-pixel gap between successive kept vertices. At this map
// scale anything finer is sub-pixel, so dropping it cuts the vertex count ~30x
// with no visible change to the lines.
const COUNTY_MIN_GAP_PX = 1.2;
// A genuinely-decoded county layer has thousands of vertices; anything well
// below this means every source failed and we should not cache/keep it. (GB
// alone is ~12k; even if only IE+NI decode, that is ~3k — comfortably above.)
const COUNTY_MIN_VERTICES = 2000;

// Point-decimate an array of already-projected [x,y] points for one ring: keep a
// vertex only once it is far enough (in projected px) from the last kept one,
// always keeping the first and closing vertex. Returns null for rings that
// collapse to a sliver so the caller can drop them.
function decimateRing(proj) {
  if (proj.length < 4) return null;
  const gap2 = COUNTY_MIN_GAP_PX * COUNTY_MIN_GAP_PX;
  const kept = [proj[0]]; let last = proj[0];
  for (let i = 1; i < proj.length - 1; i++) {
    const dx = proj[i][0] - last[0], dy = proj[i][1] - last[1];
    if (dx * dx + dy * dy >= gap2) { kept.push(proj[i]); last = proj[i]; }
  }
  kept.push(proj[proj.length - 1]);
  if (kept.length < 4) return null;
  return kept.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)).join('') + 'Z';
}

// Decode a quantised TopoJSON object (GB "lad" or NI "lgd") into an array of
// decimated, projected SVG path strings (one per area). Returns [] on any
// malformed input so a bad fetch can never throw inside render.
function decodeCountyTopo(topo) {
  try {
    const t = topo && topo.transform;
    const obj = topo && topo.objects && Object.values(topo.objects)[0];
    if (!t || !obj || !Array.isArray(topo.arcs)) return [];
    const [sx, sy] = t.scale, [tx, ty] = t.translate;
    // Pre-decode every arc into absolute (delta-summed) lon/lat coordinates.
    const arcs = topo.arcs.map((arc) => {
      let x = 0, y = 0; const out = [];
      for (const [dx, dy] of arc) { x += dx; y += dy; out.push([x * sx + tx, y * sy + ty]); }
      return out;
    });
    const arcCoords = (idx) => (idx >= 0 ? arcs[idx] : arcs[~idx].slice().reverse());
    const out = [];
    for (const geom of (obj.geometries || [])) {
      const polys = geom.type === 'Polygon' ? [geom.arcs]
        : geom.type === 'MultiPolygon' ? geom.arcs : null;
      if (!polys) continue;
      let d = '';
      for (const poly of polys) {
        for (const ring of poly) {
          // Stitch the ring's arcs together (drop each arc's shared first point).
          const raw = [];
          ring.forEach((ai, k) => {
            const c = arcCoords(ai);
            for (let i = k > 0 ? 1 : 0; i < c.length; i++) raw.push(projectPt(c[i][0], c[i][1]));
          });
          const seg = decimateRing(raw);
          if (seg) d += seg;
        }
      }
      if (d) out.push(d);
    }
    return out;
  } catch { return []; }
}

// Decode a plain GeoJSON FeatureCollection (the Republic of Ireland counties)
// into an array of decimated, projected SVG path strings. Returns [] on any
// malformed input.
function decodeCountyGeoJSON(gj) {
  try {
    const feats = (gj && gj.features) || (gj && gj.geometry ? [gj] : []);
    const out = [];
    for (const f of feats) {
      const geom = f && f.geometry;
      if (!geom) continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates]
        : geom.type === 'MultiPolygon' ? geom.coordinates : null;
      if (!polys) continue;
      let d = '';
      for (const poly of polys) {
        for (const ring of poly) {
          const proj = ring.map(([lon, lat]) => projectPt(lon, lat));
          const seg = decimateRing(proj);
          if (seg) d += seg;
        }
      }
      if (d) out.push(d);
    }
    return out;
  } catch { return []; }
}

const fetchJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('fetch failed'); return r.json(); });

// Fetch GB (with fallback), NI and IE boundaries in parallel and return the
// combined decimated path list. GB tries its mirrors in order; NI and IE are
// each best-effort (a failure just omits that region rather than failing all).
async function loadAllCountyPaths() {
  // Real UK ceremonial counties (GB + NI) plus the Republic of Ireland counties.
  const ukP = fetchJSON('https://raw.githubusercontent.com/evansd/uk-ceremonial-counties/master/uk-ceremonial-counties.geojson').then(decodeCountyGeoJSON).catch(() => []);
  const ieP = fetchJSON(COUNTY_IE_SOURCE).then(decodeCountyGeoJSON).catch(() => []);
  const [uk, ie] = await Promise.all([ukP, ieP]);
  return [...uk, ...ie];
}

// Bounding box of an already-projected SVG path string (in VIEW_W×VIEW_H space)
// by scanning its numeric coordinate pairs — used to keep only the county paths
// that fall inside the active region.
function pathProjBBox(d) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = +nums[i], y = +nums[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

let countyCache = null;
function CountyLinesLayer({ opacity = 0.5, region = null, zIndex = 1, strokeWidth = 0.5, mask = null }) {
  const [paths, setPaths] = useState(() => {
    if (countyCache) return countyCache;
    try { const a = JSON.parse(localStorage.getItem(COUNTY_CACHE_KEY) || 'null');
      if (Array.isArray(a) && countPathVertices(a) >= COUNTY_MIN_VERTICES) { countyCache = a; return a; } } catch {}
    return null;
  });

  useEffect(() => {
    if (countyCache && countPathVertices(countyCache) >= COUNTY_MIN_VERTICES) return;
    let cancelled = false;
    (async () => {
      try {
        const ds = await loadAllCountyPaths();
        if (cancelled) return;
        if (countPathVertices(ds) >= COUNTY_MIN_VERTICES) {
          countyCache = ds;
          setPaths(ds);
          try { localStorage.setItem(COUNTY_CACHE_KEY, JSON.stringify(ds)); } catch { /* quota */ }
        }
      } catch { /* leave map without county lines rather than crashing */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Clip county lines to the landmass so offshore portions (maritime county
  // boundaries) never show in the sea. geoCache is populated by UKOutlineMap and
  // may not be ready when the county paths load first, so watch for it.
  const [land, setLand] = useState(geoCache);
  useEffect(() => {
    if (!geoCache) { const t = setInterval(() => { if (geoCache) { setLand(geoCache); clearInterval(t); } }, 150); return () => clearInterval(t); }
  }, []);

  const shown = useMemo(() => {
    if (!paths) return null;
    if (!region) return paths;
    // Region projected bbox (+ padding) in VIEW space; keep only intersecting counties.
    const [rx0, ry0] = projectPt(region.lonMin, region.latMax);
    const [rx1, ry1] = projectPt(region.lonMax, region.latMin);
    const pad = 10;
    const minX = Math.min(rx0, rx1) - pad, maxX = Math.max(rx0, rx1) + pad;
    const minY = Math.min(ry0, ry1) - pad, maxY = Math.max(ry0, ry1) + pad;
    return paths.filter(d => {
      const b = pathProjBBox(d);
      return b && b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;
    });
  }, [paths, region]);
  if (!shown) return null;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex }}>
      <defs><clipPath id="countyLandClip">{land ? land.map((d, i) => <path key={i} d={d} />) : null}</clipPath>{region && (mask
        ? <clipPath id="countyRegionClip">{mask.paths.map((d, i) => <path key={i} d={d} />)}</clipPath>
        : (() => { const c = regionClipRect(region); return <clipPath id="countyRegionClip"><rect x={c.x} y={c.y} width={c.w} height={c.h} /></clipPath>; })())}</defs>
      <g fill="none" stroke="#000000" strokeWidth={strokeWidth} strokeOpacity={opacity} clipPath="url(#countyLandClip)" strokeLinejoin="round" strokeLinecap="round"><g clipPath={region ? 'url(#countyRegionClip)' : undefined}>{shown.map((d, i) => <path key={i} d={d} />)}</g></g>
    </svg>
  );
}

let geoCache = null;
function UKOutlineMap({ region = null, mask = null }) {
  const [paths, setPaths] = useState(() => {
    if (geoCache) return geoCache;
    // Warm-start from localStorage so a previously-loaded detailed map shows
    // instantly and survives GitHub being flaky on later reloads.
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && countPathVertices(arr) >= MIN_DETAIL_VERTICES) {
          geoCache = arr;
          return arr;
        }
      }
    } catch { /* ignore */ }
    return null;
  });

  useEffect(() => {
    // Already have a detailed map in memory — nothing to fetch.
    if (geoCache && countPathVertices(geoCache) >= MIN_DETAIL_VERTICES) return;
    let cancelled = false;
    (async () => {
      let best = null; // hold the most-detailed result seen, even if below target
      for (const urls of GEO_SOURCES) {
        try {
          const results = await Promise.all(urls.map(u => fetch(u).then(r => {
            if (!r.ok) throw new Error('fetch failed');
            return r.json();
          })));
          const ds = [];
          for (const gj of results) {
            const feats = gj.features || [gj];
            for (const f of feats) if (f.geometry) ds.push(geoToPath(f.geometry));
          }
          if (!ds.length) continue;
          const detail = countPathVertices(ds);
          if (detail > (best ? countPathVertices(best) : 0)) best = ds;
          // Only accept and stop once we have a genuinely detailed coastline.
          if (detail >= MIN_DETAIL_VERTICES) {
            if (cancelled) return;
            geoCache = ds;
            setPaths(ds);
            try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(ds)); } catch { /* quota */ }
            return;
          }
        } catch { /* try next source */ }
      }
      // Every detailed mirror failed — fall back to the best (crude) result so
      // the user at least sees an outline rather than nothing.
      if (!cancelled && best) {
        geoCache = best;
        setPaths(best);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <defs>
        <filter id="landShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="5" stdDeviation="9" floodColor="#000" floodOpacity="0.5" />
        </filter>
        <linearGradient id="landFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#eef2f7" />
        </linearGradient>
        {region && (mask
          ? <clipPath id="landRegionClip">{mask.paths.map((d, i) => <path key={i} d={d} />)}</clipPath>
          : (() => { const clip = regionClipRect(region); return <clipPath id="landRegionClip"><rect x={clip.x} y={clip.y} width={clip.w} height={clip.h} /></clipPath>; })())}
      </defs>
      {paths && (
        <g filter="url(#landShadow)" clipPath={region ? 'url(#landRegionClip)' : undefined}>
          {paths.map((d, i) => (
            <path key={i} d={d} fill="url(#landFill)" stroke="#000" strokeWidth="1.5" />
          ))}
        </g>
      )}
      {!paths && (
        <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle"
          fill="rgba(255,255,255,0.5)" fontSize="13" fontFamily="monospace">loading map...</text>
      )}
    </svg>
  );
}

// --- Real thunderstorm photo background ---
const STORM_BG_URL = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/fd5fe1cb8_generated_image.png';

// --- City markers (selectable layer, drawn ABOVE the risk colours) ---
const CITY_MARKERS = [
  // England
  { name: 'London',      lon: -0.13, lat: 51.51 },
  { name: 'Luton',       lon: -0.42, lat: 51.88, flip: true },
  { name: 'Birmingham',  lon: -1.90, lat: 52.48 },
  { name: 'Manchester',  lon: -2.24, lat: 53.48 },
  { name: 'Newcastle',   lon: -1.61, lat: 54.98 },
  { name: 'Norwich',     lon: 1.30,  lat: 52.63, up: true },
  { name: 'Bristol',     lon: -2.59, lat: 51.45 },
  { name: 'Plymouth',    lon: -4.14, lat: 50.37 },
  // Wales
  { name: 'Cardiff',     lon: -3.18, lat: 51.48, up: true },
  { name: 'Aberystwyth', lon: -4.08, lat: 52.41, flip: true },
  { name: 'Wrexham',     lon: -2.99, lat: 53.05, flip: true },
  // Scotland
  { name: 'Glasgow',     lon: -4.25, lat: 55.86, flip: true },
  { name: 'Edinburgh',   lon: -3.19, lat: 55.95 },
  { name: 'Aberdeen',    lon: -2.10, lat: 57.15 },
  { name: 'Inverness',   lon: -4.22, lat: 57.48 },
  { name: 'Fort William', lon: -5.11, lat: 56.82, flip: true },
  { name: 'Wick',        lon: -3.09, lat: 58.44 },
  // Northern Ireland & Ireland
  { name: 'Belfast',     lon: -5.93, lat: 54.60 },
  { name: 'Derry',       lon: -7.32, lat: 54.99, flip: true },
  { name: 'Dublin',      lon: -6.26, lat: 53.35 },
  { name: 'Galway',      lon: -9.05, lat: 53.27, flip: true },
  { name: 'Limerick',    lon: -8.62, lat: 52.66, flip: true },
  { name: 'Cork',        lon: -8.47, lat: 51.90, flip: true },
  // Extra towns — shown ONLY when their region is selected (regionOnly), so the
  // UK-wide view stays uncluttered.
  // England
  { name: 'Liverpool',   lon: -2.99, lat: 53.41, flip: true, regionOnly: true },
  { name: 'Sheffield',   lon: -1.47, lat: 53.38, regionOnly: true },
  { name: 'Nottingham',  lon: -1.15, lat: 52.95, regionOnly: true },
  { name: 'Leicester',   lon: -1.13, lat: 52.64, regionOnly: true },
  { name: 'Hull',        lon: -0.34, lat: 53.74, regionOnly: true },
  { name: 'Southampton', lon: -1.40, lat: 50.90, regionOnly: true },
  { name: 'Portsmouth',  lon: -1.09, lat: 50.80, up: true, regionOnly: true },
  { name: 'Brighton',    lon: -0.14, lat: 50.82, regionOnly: true },
  { name: 'Exeter',      lon: -3.53, lat: 50.72, flip: true, regionOnly: true },
  { name: 'Carlisle',    lon: -2.94, lat: 54.89, flip: true, regionOnly: true },
  { name: 'Middlesbrough', lon: -1.23, lat: 54.57, regionOnly: true },
  { name: 'Stoke',       lon: -2.18, lat: 53.00, flip: true, regionOnly: true },
  { name: 'Peterborough', lon: -0.24, lat: 52.57, regionOnly: true },
  { name: 'Cambridge',   lon: 0.12,  lat: 52.20, regionOnly: true },
  // Wales
  { name: 'Swansea',     lon: -3.94, lat: 51.62, flip: true, regionOnly: true },
  { name: 'Bangor',      lon: -4.13, lat: 53.23, flip: true, regionOnly: true },
  // Scotland
  { name: 'Perth',       lon: -3.44, lat: 56.40, regionOnly: true },
  { name: 'Stirling',    lon: -3.94, lat: 56.12, flip: true, regionOnly: true },
  { name: 'Oban',        lon: -5.47, lat: 56.42, flip: true, regionOnly: true },
  { name: 'Stornoway',   lon: -6.39, lat: 58.21, flip: true, regionOnly: true },
  // Ireland
  { name: 'Waterford',   lon: -7.11, lat: 52.26, regionOnly: true },
  { name: 'Sligo',       lon: -8.48, lat: 54.27, flip: true, regionOnly: true },
  { name: 'Killarney',   lon: -9.52, lat: 52.06, flip: true, regionOnly: true },
];

function CityMarkersLayer({ region = null, k = 1, mask = null }) {
  // UK-wide shows only the core cities; a region view adds that region's smaller
  // towns (extras are flagged regionOnly).
  const pad = 0.4;
  const pool = region
    ? CITY_MARKERS.filter(c =>
        c.lat >= region.latMin - pad && c.lat <= region.latMax + pad &&
        c.lon >= region.lonMin - pad && c.lon <= region.lonMax + pad &&
        (!mask || inMask(mask, c.lon, c.lat)))
    : CITY_MARKERS.filter(c => !c.regionOnly);

  // Counter-scale marks + labels by the zoom so they stay a constant on-screen
  // size. De-clutter is done in "screen-ish" space (projected × zoom, constant
  // label size) so it matches what's actually visible — earlier (more important)
  // cities in the list win, later ones are dropped if they'd overlap.
  const s = 1 / Math.max(1, k);
  const K = Math.max(1, k);
  const hit = (a, b, m = 1.4) =>
    !(a.x2 + m < b.x1 || a.x1 - m > b.x2 || a.y2 + m < b.y1 || a.y1 - m > b.y2);
  const boxes = [];
  const kept = [];
  for (const c of pool) {
    const [px, py] = projectPt(c.lon, c.lat);
    const X = px * K, Y = py * K;
    const flip = c.flip ?? (px > VIEW_W - 48);
    const fs = 7, off = 6, cw = fs * 0.56;
    const w = c.name.length * cw, h = fs * 1.15;
    let bx, by;
    if (c.up)      { bx = X - w / 2;   by = Y - off - h; }
    else if (flip) { bx = X - off - w; by = Y - h * 0.55; }
    else           { bx = X + off;     by = Y - h * 0.55; }
    const box = { x1: Math.min(bx, X - 4), y1: Math.min(by, Y - 4), x2: Math.max(bx + w, X + 4), y2: Math.max(by + h, Y + 4) };
    if (boxes.some(b => hit(box, b))) continue;
    boxes.push(box);
    kept.push({ c, x: px, y: py, flip });
  }

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 4 }}>
      {kept.map(({ c, x, y, flip }) => (
        <g key={c.name}>
          <circle cx={x} cy={y} r={3.5 * s} fill="none" stroke="#000" strokeWidth={1.1 * s} opacity={0.9} />
          <circle cx={x} cy={y} r={1.7 * s} fill="#111827" stroke="#fff" strokeWidth={0.8 * s} />
          <text x={c.up ? x : (flip ? x - 6 * s : x + 6 * s)} y={c.up ? y - 6 * s : y + 2.6 * s} fontSize={7 * s} fontWeight={800}
            textAnchor={c.up ? 'middle' : (flip ? 'end' : 'start')}
            fontFamily="'Archivo','DM Sans',sans-serif" fill="#111827"
            stroke="#ffffff" strokeWidth={2 * s} paintOrder="stroke" strokeLinejoin="round">
            {c.name}
          </text>
        </g>
      ))}
    </svg>
  );
}


// --- Blitzortung lightning overlay ---
const LIGHTNING_SWATCHES = ['#facc15', '#ffffff', '#f87171', '#ec4899', '#22d3ee', '#a78bfa'];

function HailIcon({ size = 12, color = '#22d3ee' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 16a4 4 0 0 1-.7-7.9A5 5 0 0 1 17 9a3 3 0 0 1 1 5.83" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="8" cy="20" r="1.5" fill={color}/>
      <circle cx="12" cy="19" r="1.5" fill={color}/>
      <circle cx="16" cy="20" r="1.5" fill={color}/>
      <circle cx="10" cy="22" r="1.2" fill={color} opacity="0.7"/>
      <circle cx="14" cy="22" r="1.2" fill={color} opacity="0.7"/>
    </svg>
  );
}

function FloodHouseIcon({ size = 12, color = '#3b82f6' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 12 L12 4 L21 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 12 L5 20 L19 20 L19 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 16 Q7 15 9 16 Q11 17 13 16 Q15 15 17 16 Q18.5 16.7 19 17 L19 20 L5 20 Z" fill={color} opacity="0.85"/>
      <path d="M5 16 Q7 15 9 16 Q11 17 13 16 Q15 15 17 16 Q18.5 16.7 19 17" stroke="#93c5fd" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

function LightningLayer({ strikes, color = '#ffffff', outline = false, outlineColor = '#000000' }) {
  // Build a single compact <path> of all strike dots instead of thousands of
  // individual <circle> elements — dramatically faster rendering for large counts.
  // When `outline` is on we build a SECOND path at a slightly larger radius and
  // stroke it, so every dot gets a crisp ring without adding per-strike nodes.
  const { fillD, outlineD } = useMemo(() => {
    if (!strikes || !strikes.length) return { fillD: '', outlineD: '' };
    const r = 2.4;
    const ro = r + 1.1; // outline ring radius — fully encloses the fill dot
    let f = '';
    let o = '';
    const circle = (x, y, rad) => {
      const cy = y.toFixed(1);
      return `M${(x - rad).toFixed(1)},${cy} a${rad},${rad} 0 1,0 ${(rad * 2).toFixed(1)},0 a${rad},${rad} 0 1,0 -${(rad * 2).toFixed(1)},0 `;
    };
    for (const s of strikes) {
      const lat = s.lat ?? s.la;
      const lon = s.lon ?? s.lo;
      if (lat == null || lon == null) continue;
      const [x, y] = projectPt(lon, lat);
      if (x < -ro || x > VIEW_W + ro || y < -ro || y > VIEW_H + ro) continue;
      f += circle(x, y, r);
      if (outline) o += circle(x, y, ro);
    }
    return { fillD: f, outlineD: o };
  }, [strikes, outline]);

  if (!fillD) return null;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}>
      {outline && outlineD && (
        <path d={outlineD} fill="none" stroke={outlineColor} strokeWidth={1.3} opacity={0.95} />
      )}
      <path d={fillD} fill={color} opacity={0.9} />
    </svg>
  );
}

// Normalise whatever timestamp a strike source gives us to epoch milliseconds.
function strikeTimeMs(t) {
  if (t == null) return NaN;
  if (typeof t === 'string') {
    const n = Number(t);
    if (Number.isFinite(n)) return strikeTimeMs(n);
    const parsed = Date.parse(t);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (t > 1e15) return Math.round(t / 1e6); // nanoseconds  -> ms
  if (t > 1e12) return t;                    // milliseconds
  return t * 1000;                           // seconds      -> ms
}

// Strike records arrive in many shapes across sources (live socket, the
// localStorage caches the other pages write, the persisted store). Pull
// lat/lon/time out of whatever shape we're handed.
function extractStrike(item) {
  if (item == null) return null;
  if (Array.isArray(item)) {
    // [lat, lon, time] (or [lat, lon])
    if (item.length >= 2) return { lat: item[0], lon: item[1], t: item.length >= 3 ? item[2] : undefined };
    return null;
  }
  if (typeof item !== 'object') return null;
  const lat = item.lat ?? item.latitude ?? item.la ?? item.y;
  const lon = item.lon ?? item.lng ?? item.long ?? item.longitude ?? item.lo ?? item.x;
  const t   = item.t ?? item.time ?? item.timestamp ?? item.ts ?? item.time_ns ?? item.date ?? item.created_date ?? item.created_at;
  if (lat == null || lon == null) return null;
  return { lat, lon, t };
}

// A cache value might be a bare array, or an object wrapping the array under a
// common key. Return the array of strike records either way.
function unwrapStrikeArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const k of ['strikes', 'data', 'items', 'list', 'today', 'points', 'features', 'results']) {
      if (Array.isArray(parsed[k])) return parsed[k];
    }
  }
  return [];
}

// --- Drawn-area smoothing ---------------------------------------------------
// Two stages, then a Catmull-Rom spline in pointsToPath:
//   1. Distance-decimate to drop the dense jitter the pointer emits.
//   2. Closed Chaikin corner-cutting (2 iterations) to round every corner
//      evenly. Chaikin on a CLOSED ring (wrapping first<->last) gives a far
//      smoother, more natural blob than a single 3-point average, which is
//      what the old version did. The spline in pointsToPath then renders these
//      rounded points as flowing Bezier curves.
function decimatePoints(pts, minDist = 0.010) {
  if (!pts || pts.length < 2) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = out[out.length - 1];
    const [cx, cy] = pts[i];
    if (Math.hypot(cx - px, cy - py) >= minDist) out.push(pts[i]);
  }
  return out;
}

// One pass of Chaikin on a closed ring: each edge contributes two points at
// 1/4 and 3/4, cutting the corner. Repeating converges to a smooth curve.
function chaikinClosed(pts, iterations = 3) {
  let ring = pts;
  for (let it = 0; it < iterations; it++) {
    const n = ring.length;
    if (n < 3) return ring;
    const next = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % n];
      next.push([ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25]);
      next.push([ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75]);
    }
    ring = next;
  }
  return ring;
}

function smoothPoints(pts) {
  if (!pts || pts.length < 4) return pts || [];
  const dec = decimatePoints(pts, 0.010);
  if (dec.length < 4) return dec;
  // Three Chaikin passes for a noticeably rounder, more organic blob shape.
  return chaikinClosed(dec, 3);
}

function pointsToPath(pts) {
  const s = smoothPoints(pts);
  if (!s || s.length < 2) return '';
  if (s.length < 4) {
    let d = `M ${s[0][0] * 1000} ${s[0][1] * 1000}`;
    for (let i = 1; i < s.length; i++) d += ` L ${s[i][0] * 1000} ${s[i][1] * 1000}`;
    return d + ' Z';
  }
  const n = s.length;
  const pt = (i) => s[((i % n) + n) % n];
  let d = `M ${pt(0)[0] * 1000} ${pt(0)[1] * 1000}`;
  for (let i = 0; i < n; i++) {
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6) * 1000} ${(p1[1] + (p2[1] - p0[1]) / 6) * 1000},` +
         ` ${(p2[0] - (p3[0] - p1[0]) / 6) * 1000} ${(p2[1] - (p3[1] - p1[1]) / 6) * 1000},` +
         ` ${p2[0] * 1000} ${p2[1] * 1000}`;
  }
  return d + ' Z';
}

// Wait until every <img> inside `root` has finished loading (or errored) so a
// freshly-cloned graphic is fully painted before html2canvas reads its pixels.
// Each image gets a 2s safety timeout so a slow/blocked asset can't hang the
// export.
function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 2000);
    });
  }));
}

/* --- Local primitives ---
   Control-panel styling for the editor UI around the graphic (not the graphic
   itself). These lived at the foot of the file, below the component that reads
   them ~70 times; module consts are not hoisted, so that only worked because
   the reads happen at render time. Moved above their first use. */
const inputCss = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)',
  color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none',
};
const labelCss = {
  fontSize: 10.5, fontWeight: 700, color: '#94a3b8',
  letterSpacing: '0.08em', textTransform: 'uppercase',
};
const btnCss = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', borderRadius: 9, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', background: 'rgba(148,163,184,0.08)',
  border: '1px solid rgba(148,163,184,0.2)', color: '#f1f5f9',
  fontFamily: 'inherit',
};

// --- Main component ---
export default function StormOutlookGraphicTool({ myWeatherLogoUrl = '' }) {
  const [siteLogoUrl, setSiteLogoUrl] = useState(myWeatherLogoUrl || null);
  useEffect(() => {
    if (!myWeatherLogoUrl) {
      base44.entities.SiteSettings.list().then(list => {
        const logo = list[0]?.logo_url;
        if (logo) setSiteLogoUrl(logo);
      }).catch(() => {});
    }
  }, [myWeatherLogoUrl]);

  const [validDate, setValidDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [validDate2, setValidDate2]     = useState(''); // optional second outlook day
  const [activeRisk, setActiveRisk]     = useState('Slight');
  const [hazards, setHazards]           = useState(['lightning', 'hail', 'flood']);
  // Optional per-hazard probability, keyed by hazard id -> 0..100. A hazard with
  // no entry simply renders without a percentage, so this stays fully optional.
  const [hazardPct, setHazardPct]       = useState({});
  // Timeline granularity: '3h' (classic), '2h' or '1h'. Drives stamp count.
  const [timelineGran, setTimelineGran]   = useState('3h');
  const [timelineStart, setTimelineStart] = useState('06:00');
  const [timelineEnd, setTimelineEnd]     = useState('06:00');
  const timelineStamps = useMemo(() => buildStamps(timelineGran, timelineStart, timelineEnd), [timelineGran, timelineStart, timelineEnd]);
  const [stampRisks, setStampRisks]     = useState(() => Array(TIMELINE_STAMPS.length).fill(null)); const [stampOverlays, setStampOverlays] = useState(() => Array(TIMELINE_STAMPS.length).fill(null));
  const [footerText, setFooterText]     = useState('Risk of Thunderstorms in a 15 mile radius');
  const [handle, setHandle]             = useState('@MyWeatherUK');
  const [version, setVersion]           = useState('v6.00');
  // Issue type: 'initial' = Initial Forecast, 'update' = Update #N
  const [forecastType, setForecastType] = useState('initial'); // 'initial' | 'update'
  const [updateNumber, setUpdateNumber] = useState(1);
  // Overnight risk-period: when on, the user names a night window that crosses
  // midnight (e.g. 21:00 -> 09:00) shown as a dedicated banner on the graphic.
  const [overnightEnabled, setOvernightEnabled] = useState(false);
  const [overnightStart, setOvernightStart]     = useState('21:00');
  const [overnightEnd, setOvernightEnd]         = useState('09:00');
  const [drawMode, setDrawMode]         = useState(true);
  const [drawOpacity, setDrawOpacity]   = useState(0.7);
  const [shapes, setShapes]             = useState([]);   // { riskLevel, points:[[x,y]0..1] }
  const [currentPath, setCurrentPath]   = useState([]);
  const [showShapes, setShowShapes]     = useState(true);
  const [showCities, setShowCities]     = useState(true);
  const [isExporting, setIsExporting]   = useState(false);
  const [exportMode, setExportMode]     = useState(false); // solid-frosted glass for the JPG export
  const [graphicMode, setGraphicMode]   = useState('outlook'); // 'outlook' | 'radar'
  const [lightningColor, setLightningColor]   = useState('#ffffff');
  const [lightningOutline, setLightningOutline] = useState(false);
  const [lightningOutlineColor, setLightningOutlineColor] = useState('#000000');
  const [lightningWindow, setLightningWindow] = useState(false);
  const [windowMinutes, setWindowMinutes]     = useState(180);
  const [radarRegion, setRadarRegion]         = useState('uk');
  const [savedGraphics, setSavedGraphics]     = useState([]);
  const [saving, setSaving]                   = useState(false);
  const [saveName, setSaveName]               = useState('');
  const [showSavePanel, setShowSavePanel]     = useState(false);
  const [showLoadPanel, setShowLoadPanel]     = useState(false);
  const [loadingGraphics, setLoadingGraphics] = useState(false);
  const [saveSuccess, setSaveSuccess]         = useState(false);
  const [showUKVRain, setShowUKVRain] = useState(false);
  const [confidence, setConfidence] = useState(null);

  // --- Valid-until (expiry) shown in the footer alongside Issued ---
  const [validUntil, setValidUntil] = useState(''); // ISO 'YYYY-MM-DDTHH:mm' or ''

  // --- Forecast discussion card (free text, toggleable) ---
  const [discussionEnabled, setDiscussionEnabled] = useState(false);
  const [discussionText, setDiscussionText] = useState('');

  // --- Outlook-mode zoom preset (tight regional crop of the same UK map) ---
  // Reuses the radar region bounding boxes. 'uk' = full national view.
  const [outlookRegion, setOutlookRegion] = useState('uk');

  // --- On-map text annotations ---
  // Each: { id, x, y, text, color, size:'sm'|'md'|'lg', pill:bool, leader:bool, lx, ly }
  // (x,y) is the label anchor; (lx,ly) the leader-line target. All 0..1.
  const [annotations, setAnnotations] = useState([]);
  const [annDraft, setAnnDraft] = useState('');          // text being typed for the next drop
  const [annColor, setAnnColor] = useState('#fde047');
  const [annSize, setAnnSize] = useState('md');
  const [annPill, setAnnPill] = useState(true);
  const [annLeader, setAnnLeader] = useState(false);
  const [editingAnnId, setEditingAnnId] = useState(null);

  // --- Storm-motion arrows ---
  // Each: { id, x1, y1, x2, y2, color }. Drawn as a curved vector with a head.
  const [arrows, setArrows] = useState([]);
  const [arrowColor, setArrowColor] = useState('#ffffff');
  const [arrowDraft, setArrowDraft] = useState(null);    // { x1,y1,x2,y2 } while dragging

  // --- Map interaction tool: 'draw' (areas) | 'text' | 'arrow' | 'cond' ---
  const [mapTool, setMapTool] = useState('draw');

  // --- Timeline range fill: when on, click a start cell then an end cell to
  // fill that whole band with the active risk (instead of toggling one cell). ---
  const [timelineRangeMode, setTimelineRangeMode] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState(null); // first-clicked cell index, or null

  // --- Load risk areas from the latest TCM run ---
  const [tcmRuns, setTcmRuns] = useState([]);
  const [showTcmPanel, setShowTcmPanel] = useState(false);
  const [loadingTcm, setLoadingTcm] = useState(false);
  const [importingAuto, setImportingAuto] = useState(false);
  const [autoVariant, setAutoVariant] = useState('outlook'); // 'outlook' (SPC) | 'hires' (risk)

  // Capture current state as a serialisable object
  const captureState = () => ({
    validDate, validDate2, activeRisk, hazards, hazardPct, stampRisks, stampOverlays, footerText, handle, version,
    forecastType, updateNumber, overnightEnabled, overnightStart, overnightEnd,
    drawOpacity, shapes, showShapes, showCities, graphicMode, radarRegion, showUKVRain,
    lightningColor, lightningOutline, lightningOutlineColor, lightningWindow, windowMinutes,
    timelineGran, confidence, validUntil, discussionEnabled, discussionText,
    outlookRegion, annotations, arrows,
  });

  // Save current state to database
  const handleSaveToStudio = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      await base44.entities.WeatherGraphic.create({
        title: saveName.trim(),
        graphic_tool_state: captureState(),
        published: false,
        is_forecast: false,
      });
      setSaveSuccess(true);
      setSaveName('');
      setTimeout(() => { setSaveSuccess(false); setShowSavePanel(false); }, 1500);
    } catch (e) {
      console.error('[Studio] save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  // Load saved graphics list
  const openLoadPanel = async () => {
    setShowLoadPanel(true);
    setLoadingGraphics(true);
    try {
      const list = await base44.entities.WeatherGraphic.filter({}, '-created_date', 50);
      setSavedGraphics(list.filter(g => g.graphic_tool_state && g.graphic_tool_state.tool !== 'snow'));
    } finally {
      setLoadingGraphics(false);
    }
  };

  // Restore state from a saved graphic
  const loadState = (g) => {
    const s = g.graphic_tool_state;
    if (!s) return;
    if (s.validDate !== undefined) setValidDate(s.validDate);
    if (s.validDate2 !== undefined) setValidDate2(s.validDate2);
    if (s.activeRisk !== undefined) setActiveRisk(s.activeRisk);
    if (s.hazards !== undefined) setHazards(s.hazards);
    if (s.hazardPct !== undefined) setHazardPct(s.hazardPct || {});
    if (s.stampRisks !== undefined) setStampRisks(s.stampRisks);
    if (s.stampOverlays !== undefined) setStampOverlays(s.stampOverlays);
    if (s.footerText !== undefined) setFooterText(s.footerText);
    if (s.handle !== undefined) setHandle(s.handle);
    if (s.version !== undefined) setVersion(s.version);
    if (s.forecastType !== undefined) setForecastType(s.forecastType);
    if (s.updateNumber !== undefined) setUpdateNumber(s.updateNumber);
    if (s.overnightEnabled !== undefined) setOvernightEnabled(s.overnightEnabled);
    if (s.overnightStart !== undefined) setOvernightStart(s.overnightStart);
    if (s.overnightEnd !== undefined) setOvernightEnd(s.overnightEnd);
    if (s.drawOpacity !== undefined) setDrawOpacity(s.drawOpacity);
    if (s.shapes !== undefined) setShapes(s.shapes);
    if (s.showShapes !== undefined) setShowShapes(s.showShapes);
    if (s.showCities !== undefined) setShowCities(s.showCities); if (s.showUKVRain !== undefined) setShowUKVRain(s.showUKVRain);
    if (s.graphicMode !== undefined) setGraphicMode(s.graphicMode); if (s.radarRegion !== undefined) setRadarRegion(s.radarRegion);
    if (s.lightningColor !== undefined) setLightningColor(s.lightningColor);
    if (s.lightningOutline !== undefined) setLightningOutline(s.lightningOutline);
    if (s.lightningOutlineColor !== undefined) setLightningOutlineColor(s.lightningOutlineColor);
    if (s.lightningWindow !== undefined) setLightningWindow(s.lightningWindow);
    if (s.windowMinutes !== undefined) setWindowMinutes(s.windowMinutes);
    // new in v6:
    if (s.timelineGran !== undefined) setTimelineGran(s.timelineGran);
    if (s.confidence !== undefined) setConfidence(s.confidence);
    if (s.validUntil !== undefined) setValidUntil(s.validUntil);
    if (s.discussionEnabled !== undefined) setDiscussionEnabled(s.discussionEnabled);
    if (s.discussionText !== undefined) setDiscussionText(s.discussionText);
    if (s.outlookRegion !== undefined) setOutlookRegion(s.outlookRegion);
    if (s.annotations !== undefined) setAnnotations(s.annotations);
    if (s.arrows !== undefined) setArrows(s.arrows);
    setShowLoadPanel(false);
  };

  const isRadar = graphicMode === 'radar';
  const usesSevere = shapes.some((sh) => isSevereId(sh.riskLevel) || isCondSevereId(sh.riskLevel) || sh.cond);
  const levels = isRadar ? RADAR_LEVELS : GRAPHIC_LEVELS.filter((l) => usesSevere || !(isSevereId(l.id) || isCondSevereId(l.id)));
  const hazardList = isRadar ? RADAR_HAZARDS : HAZARDS;

  // --- Lightning overlay (hook) + timeline animation ------------------------
  const {
    showLightning, setShowLightning, strikes, loadingStrikes, lightningError,
    liveStatus, toggleLightning, refreshLightning, lightningStats, fmtHour, tzAbbr,
    stopLightning,
  } = useStormLightning({ lightningWindow, setLightningWindow, windowMinutes, setWindowMinutes });

  // --- Timeline animation: hour-by-hour playback + WebM export ---
  const [isAnimating, setIsAnimating] = useState(false);
  const [playhead, setPlayhead] = useState(null);      // 0..N hours; null = live editing
  const [isRecording, setIsRecording] = useState(false);
  const playheadRef = useRef(0);
  const animRef = useRef(null);

  const anyStamps = useMemo(() => stampRisks.some(Boolean) || stampOverlays.some(Boolean), [stampRisks, stampOverlays]);
  const SEV = useMemo(() => { const m = {}; GRAPHIC_LEVELS.forEach((l, i) => { m[l.id] = i; }); return m; }, []);
  // rAF sweep ~4s/hour. Cumulative: a tier shows where the hour's stamp is at/above its
  // own severity (lower tiers stay on under an active level). Fast fade at boundaries.
  useEffect(() => {
    if (!isAnimating || isRecording) { cancelAnimationFrame(animRef.current); return; }
    let last = performance.now();
    let ph = (playheadRef.current >= timelineStamps.length || playheadRef.current < 0) ? 0 : playheadRef.current;
    const secPerStamp = 4;
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      ph += dt / secPerStamp;
      if (ph >= timelineStamps.length) ph = 0;
      playheadRef.current = ph; setPlayhead(ph);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isAnimating, isRecording, timelineStamps.length]);
  useEffect(() => { if (!isAnimating && !isRecording) setPlayhead(null); }, [isAnimating, isRecording]);
  const animOpacityFor = (s) => {
    if (playhead == null || isRadar) return drawOpacity;
    if (!anyStamps) return drawOpacity;
    const N = timelineStamps.length;
    let f = playhead;
    if (f >= N) f = N - 0.0001; if (f < 0) f = 0;
    const i0 = Math.floor(f), i1 = Math.min(N - 1, i0 + 1), frac = f - i0;
    const band = 0.15, tn = Math.max(0, Math.min(1, (frac - (0.5 - band)) / (2 * band))), ease = tn * tn * (3 - 2 * tn);
    const activeAt = (idx) => {
      if (idx < 0 || idx >= N) return 0;
      if (isSevereId(s.riskLevel) || isCondSevereId(s.riskLevel)) return stampOverlays[idx] === s.riskLevel ? 1 : 0;
      const st = stampRisks[idx];
      return st && SEV[st] >= SEV[s.riskLevel] ? 1 : 0;
    };
    return Math.max(0, Math.min(1, activeAt(i0) + (activeAt(i1) - activeAt(i0)) * ease)) * drawOpacity;
  };

  const shapePaths = useMemo(() => shapes.map((s) => pointsToPath(s.points)), [shapes]);

  const handleExportVideo = async () => {
    if (!graphicRef.current) return;
    if (!anyStamps) { window.alert('Mark some timeline hours with a risk level first — the animation reveals the areas that match each hour.'); return; }
    const N = timelineStamps.length;
    const wasAnimating = isAnimating;
    setIsAnimating(false); setIsRecording(true); setExportMode(true); setIsExporting(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 80));
    const EXPORT_W = GRAPHIC_W * 2, EXPORT_H = GRAPHIC_H * 2;
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W; canvas.height = EXPORT_H;
    const ctx = canvas.getContext('2d');
    let stream, track, recorder;
    try { stream = canvas.captureStream(0); track = stream.getVideoTracks()[0]; }
    catch { window.alert('Video recording is not supported in this browser.'); setIsRecording(false); setExportMode(false); setIsExporting(false); return; }
    const pickMime = () => {
      for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
        try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* next */ }
      }
      return '';
    };
    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10000000 } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { recorder.onstop = () => res(); });
    recorder.start();
    const sandbox = document.createElement('div');
    sandbox.style.cssText = `position:fixed;top:0;left:-99999px;width:${GRAPHIC_W}px;height:${GRAPHIC_H}px;overflow:hidden;z-index:-1;pointerEvents:none;`;
    sandbox.style.pointerEvents = 'none';
    const framesPerStamp = 6;
    const totalFrames = Math.max(2, N * framesPerStamp);
    try {
      for (let f = 0; f < totalFrames; f++) {
        const ph = Math.min(N - 0.0001, (f / Math.max(1, totalFrames - 1)) * N);
        setPlayhead(ph);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 15));
        const clone = graphicRef.current.cloneNode(true);
        clone.style.transform = 'none'; clone.style.transformOrigin = 'top left';
        clone.style.margin = '0'; clone.style.flexShrink = '0';
        clone.style.width = GRAPHIC_W + 'px'; clone.style.height = GRAPHIC_H + 'px';
        sandbox.appendChild(clone); document.body.appendChild(sandbox);
        try {
          await waitForImages(clone);
          await new Promise(r => requestAnimationFrame(r));
          const fc = await html2canvas(clone, { backgroundColor: null, scale: 2, useCORS: true, logging: false, width: GRAPHIC_W, height: GRAPHIC_H, windowWidth: GRAPHIC_W, windowHeight: GRAPHIC_H });
          ctx.clearRect(0, 0, EXPORT_W, EXPORT_H);
          ctx.drawImage(fc.canvas, 0, 0, EXPORT_W, EXPORT_H);
          if (track.requestFrame) track.requestFrame();
        } finally { document.body.removeChild(sandbox); sandbox.removeChild(clone); }
      }
    } finally { recorder.stop(); }
    await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `thunderstorm-outlook-${validDate}.webm`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setIsRecording(false); setExportMode(false); setIsExporting(false); setPlayhead(null);
    if (wasAnimating) setIsAnimating(true);
  };

  /* Defined here, after stopLightning, rather than up beside the other mode
     state: it calls stopLightning, which in turn needs the lightning refs
     declared above. It used to sit before all of them and only worked because
     nothing calls it until a click. */
  const switchMode = (m) => {
    if (m === graphicMode) return;
    setGraphicMode(m);
    if (m === 'radar') {
      // Lightning verification is an outlook-mode view — leaving it on would
      // strand the overlay and stats card on the radar graphic. Clear it.
      setShowLightning(false);
      // Full teardown (timer AND the live Blitzortung socket) — clearing the
      // flag alone used to leave the stream open in the background.
      stopLightning();
      setActiveRisk('ModRain');
      setHazards(['heavyrain', 'showers', 'thunder', 'heavyshowers']);
      // Outlook-only placement tools / zoom don't apply to radar.
      setMapTool('draw');
      setOutlookRegion('uk');
      setShowTcmPanel(false);
    } else {
      setActiveRisk('Slight');
      setHazards(['lightning', 'hail']);
    }
  };



  // --- Vector drawing handlers (Photo-Outlook style) ---
  const mapWrapRef = useRef(null);
  const isPointerDown = useRef(false);
  /* Holds the current outlookZoom for eventToNormPoint below, which needs it to
     undo the region zoom when converting a pointer event to drawing space.
     Declared here, ahead of that reader; outlookZoom itself is computed much
     further down, so the ref starts empty and is refreshed on every render at
     its definition. Empty is safe — the only reader runs from an event handler,
     long after the first render has filled it, and guards for null anyway. */
  const outlookZoomRef = useRef(null);

  const eventToNormPoint = (e) => {
    const wrap = mapWrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    let x = (src.clientX - rect.left) / rect.width;
    let y = (src.clientY - rect.top) / rect.height;
    // When zoomed into a region the map layer is CSS-transformed (translate +
    // scale about origin 0,0). The drawn shapes render INSIDE that zoomed layer,
    // so we must invert the zoom here or the shape lands double-transformed.
    // Inverse of  visible = 0.5 + (norm - centre)*k  ⇒  norm = centre + (visible-0.5)/k.
    const z = outlookZoomRef.current;
    if (z && z.zoomed) {
      x = z.cx + (x - 0.5) / z.k;
      y = z.cy + (y - 0.5) / z.k;
    }
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  };

  // Whether the map surface should currently capture pointer drawing. Text-drop
  // is a click (handled separately); arrow is a drag; draw is a freehand drag.
  const surfaceActive = mapTool === 'draw' || mapTool === 'arrow';

  const handleDown = (e) => {
    // Region zoom is inverted in eventToNormPoint, so drawing/placement works at
    // any zoom level — no lock required.
    // AREA CONDITIONAL tool: click inside a drawn area to toggle a conditional
    // flag on THAT area (click again to remove). Tests against the smoothed
    // outline so the hit region matches what's rendered. Picks the topmost
    // (last-drawn) matching area. Special tiers can't take a per-area flag.
    if (mapTool === 'cond') {
      const pt = eventToNormPoint(e);
      if (!pt) return;
      e.preventDefault();
      let hitIdx = -1;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (isSevereId(s.riskLevel) || isCondSevereId(s.riskLevel)) continue;
        const poly = smoothPoints(s.points);
        if (pointInPolygon(pt, poly)) { hitIdx = i; break; }
      }
      if (hitIdx >= 0) {
        setShapes(prev => prev.map((s, j) => (j === hitIdx ? { ...s, cond: !s.cond } : s)));
      }
      return;
    }
    // TEXT tool: a single click drops/positions a label, no drag.
    if (mapTool === 'text') {
      const pt = eventToNormPoint(e);
      if (!pt) return;
      e.preventDefault();
      const text = (annDraft || '').trim();
      if (!text) return; // nothing typed yet — ignore the click
      const id = `a-${Date.now()}`;
      setAnnotations(prev => [...prev, {
        id, x: pt[0], y: pt[1], text,
        color: annColor, size: annSize, pill: annPill,
        leader: annLeader, lx: pt[0], ly: Math.min(1, pt[1] + 0.10),
      }]);
      setEditingAnnId(id);
      return;
    }
    if (mapTool === 'arrow') {
      e.preventDefault();
      isPointerDown.current = true;
      const pt = eventToNormPoint(e);
      if (pt) setArrowDraft({ x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1] });
      return;
    }
    // DRAW tool (freehand risk area)
    if (!drawMode) return;
    e.preventDefault();
    isPointerDown.current = true;
    const pt = eventToNormPoint(e);
    if (pt) setCurrentPath([pt]);
  };

  const handleMove = (e) => {
    if (!isPointerDown.current) return;
    if (mapTool === 'arrow') {
      e.preventDefault();
      const pt = eventToNormPoint(e);
      if (pt) setArrowDraft(d => d ? { ...d, x2: pt[0], y2: pt[1] } : d);
      return;
    }
    if (mapTool !== 'draw' || !drawMode) return;
    e.preventDefault();
    const pt = eventToNormPoint(e);
    if (pt) setCurrentPath(prev => [...prev, pt]);
  };

  const handleUp = () => {
    if (!isPointerDown.current) return;
    isPointerDown.current = false;
    if (mapTool === 'arrow') {
      setArrowDraft(d => {
        if (d && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.03) {
          setArrows(prev => [...prev, { id: `ar-${Date.now()}`, ...d, color: arrowColor }]);
        }
        return null;
      });
      return;
    }
    if (mapTool !== 'draw' || !drawMode) { setCurrentPath([]); return; }
    if (currentPath.length > 2) {
      setShapes(prev => [...prev, { riskLevel: activeRisk, points: currentPath }]);
    }
    setCurrentPath([]);
  };

  const undoLast = () => setShapes(prev => prev.slice(0, -1));
  const clearShapes = () => {
    if (!shapes.length) return;
    if (window.confirm('Clear all drawn risk areas?')) setShapes([]);
  };

  // --- Annotation + arrow management --------------------------------------
  const updateAnnotation = (id, patch) =>
    setAnnotations(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
  const removeAnnotation = (id) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
    if (editingAnnId === id) setEditingAnnId(null);
  };
  const clearArrows = () => setArrows([]);
  const undoArrow = () => setArrows(prev => prev.slice(0, -1));

  // Cycle a finished shape's risk level up the ladder (so you can promote a
  // drawn area without redrawing). Wraps round at the top.
  const cycleShapeRisk = (idx) => {
    setShapes(prev => prev.map((s, j) => {
      if (j !== idx) return s;
      const order = GRAPHIC_LEVELS.map(l => l.id);
      const cur = order.indexOf(s.riskLevel);
      const next = order[(cur + 1) % order.length];
      return { ...s, riskLevel: next };
    }));
  };

  // --- Load risk areas from the latest TCM run ----------------------------
  // The TCM admin stores published outlooks as TCMOutlook records whose
  // `risk_areas` are [{ id, risk_level, points:[[lat,lon],...] }]. We project
  // those lat/lon polygons into this tool's normalised 0..1 space so the drawn
  // areas match the model exactly instead of being hand-traced again.
  const openTcmPanel = async () => {
    setShowTcmPanel(true);
    setShowSavePanel(false); setShowLoadPanel(false);
    setLoadingTcm(true);
    try {
      const list = await base44.entities.TCMOutlook.list('-outlook_date', 30);
      setTcmRuns((list || []).filter(o => Array.isArray(o.risk_areas) && o.risk_areas.length > 0));
    } catch (e) {
      console.error('[TCM import] list failed:', e);
      setTcmRuns([]);
    } finally {
      setLoadingTcm(false);
    }
  };

  const importTcmAreas = (outlook, mode = 'replace') => {
    const src = outlook?.risk_areas || [];
    const mapped = [];
    for (const area of src) {
      const pts = area?.points || [];
      if (pts.length < 3) continue;
      // points are [lat, lon]; project each into normalised drawing space.
      const norm = pts.map(([lat, lon]) => latLonToNorm(Number(lat), Number(lon)))
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (norm.length < 3) continue;
      // Map the TCM risk level onto a graphic tier id (identical names; fall
      // back to the level itself, then Slight, if an unknown tier appears).
      const lvl = RISK_BY_ID[area.risk_level] ? area.risk_level : 'Slight';
      mapped.push({ riskLevel: lvl, points: norm });
    }
    if (!mapped.length) { window.alert('That run has no usable risk areas.'); return; }
    setShapes(prev => (mode === 'append' ? [...prev, ...mapped] : mapped));
    // Pull the outlook date across too so the header date matches the run.
    if (outlook.outlook_date) setValidDate(outlook.outlook_date);
    setShowTcmPanel(false);
  };

  // --- Import the AUTO-generated model outlook (from the latest published run) --
  // Loads the latest TCM grid and rebuilds its risk polygons (SPC-style Outlook,
  // or the tighter High-Res "risk" version) for the chosen day, then projects
  // them into the drawing space as editable areas — so you can start from the
  // model's own outlook and draw your own areas over it.
  const importAutoOutlook = async (dayIndex, mode = 'replace') => {
    setImportingAuto(true);
    try {
      const payload = await loadLatestTCMFromDB('uk');
      const grid = payload?.grid;
      if (!grid?.length) { window.alert('No published TCM run found. Run the model on the TCM Outlooks page first, then try again.'); return; }
      const bbox = { lonMin: -16.0, lonMax: 2.5, latMin: 49.5, latMax: 61.5 };
      const builder = autoVariant === 'hires' ? buildHiResOutlookLayers : buildOutlookLayers;
      const layers = builder({ grid, riskType: 'thunderstorm', dayIdx: dayIndex, bbox, gridStep: 1.25 }) || [];
      const mapped = [];
      for (const layer of layers) {
        const lvl = RISK_BY_ID[layer.level] ? layer.level : 'Slight';
        for (const ring of (layer.polygons || [])) {
          if (!ring || ring.length < 3) continue;
          const norm = ring
            .map(([lon, lat]) => latLonToNorm(Number(lat), Number(lon)))
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
          if (norm.length >= 3) mapped.push({ riskLevel: lvl, points: norm });
        }
      }
      if (!mapped.length) { window.alert('The latest run has no thunderstorm risk areas for that day.'); return; }
      setShapes(prev => (mode === 'append' ? [...prev, ...mapped] : mapped));
      if (payload?.run) {
        try { const d = new Date(payload.run); d.setUTCDate(d.getUTCDate() + dayIndex); setValidDate(d.toISOString().slice(0, 10)); } catch { /* keep current date */ }
      }
      setShowTcmPanel(false);
    } catch (e) {
      console.error('[auto outlook import] failed:', e);
      window.alert('Could not load the auto outlook: ' + (e?.message || 'unknown error'));
    } finally {
      setImportingAuto(false);
    }
  };

  // Severe & Conditional Severe are OVERLAY tiers: stamping one of them onto a
  // cell does NOT replace the base risk underneath (e.g. a 2-cell High stays
  // High) — it toggles a separate overlay layer drawn on top. All other tiers
  // set the base risk as before.
  //
  // Range mode: the first click sets an anchor; the second click fills every
  // cell between the two (inclusive) with the active risk/overlay. Clicking the
  // same cell twice just falls back to a single toggle.
  const applyStampRange = (start, end) => {
    const a = Math.min(start, end), b = Math.max(start, end);
    const overlay = isSevereId(activeRisk) || isCondSevereId(activeRisk);
    const setter = overlay ? setStampOverlays : setStampRisks;
    setter(prev => {
      const next = [...prev];
      for (let k = a; k <= b; k++) next[k] = activeRisk;
      return next;
    });
  };

  const toggleSingleStamp = (i) => {
    if (isSevereId(activeRisk) || isCondSevereId(activeRisk)) {
      setStampOverlays(prev => {
        const next = [...prev];
        next[i] = next[i] === activeRisk ? null : activeRisk;
        return next;
      });
      return;
    }
    setStampRisks(prev => {
      const next = [...prev];
      next[i] = next[i] === activeRisk ? null : activeRisk;
      return next;
    });
  };

  const cycleStamp = (i) => {
    if (timelineRangeMode) {
      if (rangeAnchor == null) { setRangeAnchor(i); return; }
      if (rangeAnchor === i) { setRangeAnchor(null); toggleSingleStamp(i); return; }
      applyStampRange(rangeAnchor, i);
      setRangeAnchor(null);
      return;
    }
    toggleSingleStamp(i);
  };
  // Drop the pending range anchor if range mode is turned off.
  useEffect(() => { if (!timelineRangeMode) setRangeAnchor(null); }, [timelineRangeMode]);
  const toggleHazard = (id) =>
    setHazards(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);

  /* ── JPG export ────────────────────────────────────────────────────────────
   *
   * REBUILT. The old path handed the graphic to html2canvas, which does not
   * screenshot anything — it walks the DOM and re-implements CSS painting in
   * JavaScript. Every effect this graphic leans on was a place for that
   * re-implementation to disagree with Chrome, and it did, repeatedly: the
   * panels' sheen overlay was painted in front of their text instead of behind
   * it, so the headings vanished under a white veil; the wide inset glow came
   * out as a pale rectangle ringing every panel; the flat fills substituted for
   * the frosted glass never matched. Each fix moved the problem rather than
   * removing it, because the renderer was never going to agree with the browser
   * about this design.
   *
   * So the browser renders it now. The graphic is serialised into an SVG
   * <foreignObject> and drawn to a canvas, which means Chrome does the layout,
   * the gradients, the stacking, the shadows and the text — the exported pixels
   * come from the same engine that painted the preview.
   *
   * ONE THING STILL CANNOT SURVIVE, and it is unavoidable rather than a bug:
   * `backdrop-filter` blurs whatever is BEHIND an element, and inside a
   * foreignObject there is no "behind" — the page is not there. No DOM-to-image
   * technique of any kind can reproduce it. That is the entire remaining job of
   * `exportMode`: swap the frosted panels for a flat fill matching what the
   * blur resolves to. Everything else now stays exactly as it is on screen.
   *
   * QUALITY. JPEG at 1.0 — the top of the format — and the largest raster that
   * will actually come back. EXPORT_SCALES is tried highest first: an SVG
   * foreignObject can fail to rasterise at extreme sizes, and it fails by
   * handing back a blank canvas rather than by throwing, so each attempt is
   * checked for actual content before it is accepted. The result goes out as a
   * blob rather than a data URL: base64 inflates a 40 MB image by a third and
   * pushes it through a string, which is where very large exports fall over.
   */
  const graphicRef = useRef(null);

  /* Largest first. 8x is 5120x6080 — beyond any social crop and about 43 cm
     wide in print at 300 dpi. 4x is the floor, and is still 2560x3040. */
  const EXPORT_SCALES = [8, 6, 4];

  /** True if the raster holds a picture rather than a flat fill. */
  const canvasHasContent = (canvas) => {
    try {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      // Nine points across the frame; a failed foreignObject leaves every one
      // of them the same background colour.
      const pts = [[0.5, 0.08], [0.2, 0.25], [0.5, 0.3], [0.8, 0.45],
                   [0.2, 0.55], [0.5, 0.6], [0.35, 0.8], [0.7, 0.85], [0.5, 0.95]];
      const seen = new Set();
      for (const [fx, fy] of pts) {
        const d = ctx.getImageData(Math.floor(w * fx), Math.floor(h * fy), 1, 1).data;
        seen.add(`${d[0]},${d[1]},${d[2]}`);
      }
      return seen.size > 2;
    } catch {
      return true;   // cannot check: assume it worked rather than downgrade
    }
  };

  const handleDownload = async () => {
    const node = graphicRef.current;
    if (!node) return;

    setIsExporting(true);
    setExportMode(true);
    try {
      // Let the flat-fill swap paint, and make sure the storm backdrop and the
      // logo have decoded — a half-loaded image serialises as a blank box.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await waitForImages(node);

      let canvas = null;
      for (const pixelRatio of EXPORT_SCALES) {
        try {
          const c = await toCanvas(node, {
            width: GRAPHIC_W,
            height: GRAPHIC_H,
            pixelRatio,
            // JPEG has no alpha: without this the ground outside the frame's
            // rounded corners would come out black.
            backgroundColor: GRAPHIC_BG,
            // The preview is scaled down to fit the editor; the export is not.
            style: { transform: 'none', transformOrigin: 'top left', margin: '0' },
            // Fetch images past any cached response that lacks CORS headers —
            // one of those silently produces an empty backdrop.
            cacheBust: true,
          });
          if (canvasHasContent(c)) { canvas = c; break; }
          console.warn(`[graphic export] blank raster at ${pixelRatio}x, stepping down`);
        } catch (err) {
          console.warn(`[graphic export] ${pixelRatio}x failed, stepping down:`, err?.message || err);
        }
      }
      if (!canvas) throw new Error('every export size came back empty');

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          b => (b ? resolve(b) : reject(new Error('the image could not be encoded'))),
          'image/jpeg',
          1,                       // the top of what JPEG offers
        );
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `thunderstorm-outlook-${validDate}.jpg`;
      link.href = url;
      link.click();
      // Give the download a moment to take the URL before it is released.
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      toast.success(`Exported at ${canvas.width}x${canvas.height}`);
    } catch (err) {
      console.error('[graphic export]', err);
      toast.error('The graphic could not be exported — see the console for why.');
    } finally {
      setExportMode(false);
      setIsExporting(false);
    }
  };

  const visibleHazards = hazardList.filter(h => hazards.includes(h.id));
  const activeMeta = LEVEL_LOOKUP[activeRisk] || levels[0];

  // --- Outlook-mode regional zoom -----------------------------------------
  // 'uk' = full national view (identity transform). Any other region computes a
  // scale + translate that frames that region's bounding box inside the map
  // wrap. The same transform is applied to the rendered map AND to drawn
  // areas/cities/annotations so everything stays registered. Freehand drawing
  // is locked while zoomed (draw at full extent or import from TCM instead).
  const outlookZoom = useMemo(() => {
    if (isRadar || outlookRegion === 'uk') return { transform: 'none', zoomed: false, k: 1, cx: 0.5, cy: 0.5 };
    const reg = UK_REGIONS.find(r => r.id === outlookRegion);
    if (!reg) return { transform: 'none', zoomed: false, k: 1, cx: 0.5, cy: 0.5 };
    // Region bbox -> normalised 0..1 rect via the shared projection.
    const [x0, y0] = latLonToNorm(reg.bbox.latMax, reg.bbox.lonMin); // top-left
    const [x1, y1] = latLonToNorm(reg.bbox.latMin, reg.bbox.lonMax); // bottom-right
    const bw = Math.max(0.001, x1 - x0), bh = Math.max(0.001, y1 - y0);
    // Fit the bbox into the wrap (with a little padding) — limit zoom so labels
    // don't get absurdly large.
    const k = Math.min(6, Math.max(1, Math.min(1 / bw, 1 / bh) * 0.86));
    // Centre the bbox: translate so the bbox centre maps to the wrap centre.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const W = 450, H = 666; // wrap px
    const tx = W * (0.5 - cx * k);
    const ty = H * (0.5 - cy * k);
    return { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(3)})`, zoomed: true, k, cx, cy };
  }, [isRadar, outlookRegion]);
  // Drawing now works at any zoom — eventToNormPoint inverts the region zoom
  // so placement stays registered. (Kept as a const so the old references
  // compile; it is always false now.)
  const drawLocked = false;
  outlookZoomRef.current = outlookZoom;   // ref declared above eventToNormPoint
  // The active region's geographic bbox (null = UK-wide) — used to filter the
  // counties + town labels to the selected region.
  const regionMask = useRegionMask(!isRadar ? outlookRegion : 'uk');
  const activeRegionBox = (!isRadar && outlookRegion !== 'uk')
    ? (UK_REGIONS.find(r => r.id === outlookRegion)?.bbox || null)
    : null;

  // --- Timeline valid window ------------------------------------------------
  // Maps the stamp band that carries a risk to real datetimes. The timeline
  // starts at 06:00 on the outlook day and advances by the granularity step per
  // stamp (so the labels 06,09,…,00,03,06 cross midnight into the next day).
  // We show "HH:00 DD Mon → HH:00 DD Mon" spanning the first->last risk cell.
  const timelineValid = useMemo(() => {
    const stepH = timelineGran === '1h' ? 1 : timelineGran === '2h' ? 2 : 3;
    const base = new Date(validDate + 'T' + (timelineStart || '06:00') + ':00'); // local timeline start on outlook day
    if (isNaN(base.getTime())) return null;
    const at = (idx) => new Date(base.getTime() + idx * stepH * 3600_000);
    // First and last cell index that carries either a base risk or an overlay.
    let first = -1, last = -1;
    for (let i = 0; i < timelineStamps.length; i++) {
      if (stampRisks[i] || stampOverlays[i]) { if (first < 0) first = i; last = i; }
    }
    if (first < 0) return null;
    // The band's END is the END of the last active cell, so add one step.
    const start = at(first), end = at(last + 1);
    const fmt = (d) => d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', hour12: false });
    return { label: `${fmt(start)} → ${fmt(end)}` };
  }, [validDate, timelineGran, timelineStamps, stampRisks, stampOverlays]);

  // --- Lead time -> "Extended" title ---------------------------------------
  // Day-count between today (local) and the outlook day. 3+ days out flips the
  // title from "Thunderstorm Outlook" to "Extended Thunderstorm Outlook".
  const leadDays = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out = new Date(validDate + 'T00:00:00');
    return Math.round((out - today) / 86400000);
  }, [validDate]);
  const isExtended = leadDays >= 3;
  const outlookTitle = isExtended ? 'Extended Thunderstorm Outlook' : 'Thunderstorm Outlook';

  // --- Forecast / Update label ---------------------------------------------
  const forecastLabel = forecastType === 'update'
    ? `Update ${Math.max(1, updateNumber)}`
    : 'Initial Forecast';

  // --- Overnight window label ----------------------------------------------
  // Pretty 12h-ish formatting with a midnight-cross hint.
  const fmtClock = (hhmm) => {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return `${hh}:${mm}`;
  };
  const overnightCrossesMidnight = useMemo(() => {
    if (!overnightStart || !overnightEnd) return false;
    const [sh, sm] = overnightStart.split(':').map(Number);
    const [eh, em] = overnightEnd.split(':').map(Number);
    return (eh * 60 + em) <= (sh * 60 + sm); // end at/earlier than start => next day
  }, [overnightStart, overnightEnd]);
  const overnightLabel = `${fmtClock(overnightStart)} - ${fmtClock(overnightEnd)}${overnightCrossesMidnight ? ' (+1)' : ''}`;

  // --- Responsive scaling --- (GRAPHIC_W/H are module constants, see top)
  const scaleWrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  // Header auto-fit: measure the stacked left-side cards and scale them down if
  // they'd overflow the space above the footer, so every overlay stays visible.
  const headerScaleRef = useRef(null);
  const [headerScale, setHeaderScale] = useState(1);
  const HEADER_AVAIL_H = GRAPHIC_H - 14 - 74; // top inset + footer reserve
  useEffect(() => {
    const measure = () => {
      const avail = scaleWrapRef.current?.offsetWidth || GRAPHIC_W;
      setScale(Math.min(1.7, avail / GRAPHIC_W));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // When the timeline granularity changes, resize the stamp arrays to match the
  // new stamp count. We map by clock label so a stamp keeps its risk where the
  // same hour exists in both layouts (e.g. switching 3h<->1h keeps 06/09/12...).
  const prevStampsRef = useRef(timelineStamps);
  useEffect(() => {
    const prevStamps = prevStampsRef.current;
    const newStamps = timelineStamps;
    if (prevStamps === newStamps) return;
    const remap = (arr) => {
      // Build label->value from the OLD layout (first occurrence wins), then read
      // back into the NEW layout. Labels can repeat (06 at both ends); index-align
      // the repeats so the morning 06 and the next-day 06 don't collide.
      const used = {};
      const byLabelIdx = new Map();
      prevStamps.forEach((s, i) => {
        const k = `${s.label}#${(used[s.label] = (used[s.label] || 0))}`;
        byLabelIdx.set(k, arr[i] ?? null);
        used[s.label]++;
      });
      const seen = {};
      return newStamps.map((s) => {
        const occ = (seen[s.label] = (seen[s.label] || 0));
        seen[s.label]++;
        return byLabelIdx.get(`${s.label}#${occ}`) ?? null;
      });
    };
    setStampRisks(prev => remap(prev));
    setStampOverlays(prev => remap(prev));
    prevStampsRef.current = newStamps;
  }, [timelineStamps]);

  /* Dependency keys for the header measurement below. Extracted rather than
     written inline: an expression in a dependency array cannot be checked
     statically, so the exhaustive-deps rule can no longer tell whether the
     effect actually tracks what it reads. Naming them restores that. */
  const visibleHazardKey = visibleHazards.map(h => h.id).join(',');
  const hazardPctKey = JSON.stringify(hazardPct);

  // Measure the header's natural height and scale it down to fit the space
  // above the footer. The scaler div keeps a fixed layout width (transform only
  // affects paint, not layout), so scrollHeight is a stable natural-height
  // measure independent of the applied scale — no feedback loop.
  useLayoutEffect(() => {
    const el = headerScaleRef.current;
    if (!el) return;
    const natural = el.scrollHeight;
    const next = natural > HEADER_AVAIL_H ? Math.max(0.62, HEADER_AVAIL_H / natural) : 1;
    setHeaderScale(prev => (Math.abs(next - prev) > 0.005 ? next : prev));
  }, [
    HEADER_AVAIL_H, isRadar, showLightning,
    discussionEnabled, discussionText, overnightEnabled, overnightLabel,
    timelineStamps, stampRisks, stampOverlays,
    confidence, timelineValid, outlookTitle, isExtended, validDate2,
    visibleHazardKey, hazardPctKey,
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#f1f5f9' }}>

      {/* ============ CONTROL PANEL ============ */}
      <div style={{
        background: '#0c1422', border: '1px solid rgba(148,163,184,0.12)',
        borderRadius: 14, padding: 13, display: 'flex', flexDirection: 'column', gap: 11,
      }}>
        {/* Mode toggle - Outlook vs Radar */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: 'outlook', label: 'Outlook', Icon: Zap },
            { id: 'radar',   label: 'Radar',   Icon: Radar },
          ].map(m => {
            const on = graphicMode === m.id;
            const MIcon = m.Icon;
            return (
              <button key={m.id} type="button" onClick={() => switchMode(m.id)} style={{
                ...btnCss, fontWeight: 800,
                background: on ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.08)',
                borderColor: on ? '#38bdf8' : 'rgba(148,163,184,0.2)',
                color: on ? '#38bdf8' : '#94a3b8',
              }}>
                <MIcon style={{ width: 13, height: 13 }} /> {m.label}
              </button>
            );
          })}

          {isRadar && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 8, flexWrap: 'wrap' }}>
              <span style={{ ...labelCss, alignSelf: 'center', marginBottom: 0, marginRight: 4 }}>Region</span>
              {UK_REGIONS.map(r => {
                const on = radarRegion === r.id;
                return (
                  <button key={r.id} type="button" onClick={() => setRadarRegion(r.id)} style={{
                    padding: '5px 9px', borderRadius: 8, fontSize: 11, fontWeight: on ? 800 : 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    background: on ? 'rgba(14,165,233,0.18)' : 'rgba(148,163,184,0.06)',
                    border: `1px solid ${on ? 'rgba(14,165,233,0.5)' : 'rgba(148,163,184,0.15)'}`,
                    color: on ? '#38bdf8' : '#94a3b8',
                  }}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <Field label="Outlook day">
            <input type="date" value={validDate} onChange={e => setValidDate(e.target.value)} style={inputCss} />
          </Field>
          <Field label="Second day (optional)">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="date" value={validDate2} onChange={e => setValidDate2(e.target.value)} style={{ ...inputCss, flex: 1 }} />
              {validDate2 && (
                <button type="button" onClick={() => setValidDate2('')} style={{ ...btnCss, padding: '0 10px' }}>
                  <X style={{ width: 13, height: 13 }} />
                </button>
              )}
            </div>
          </Field>
          {/* Outlook-only: the radar graphic uses its own generated status
              block in the footer rather than a free-text caption. */}
          {!isRadar && (
            <Field label="Footer caption">
              <input value={footerText} onChange={e => setFooterText(e.target.value)} style={inputCss} />
            </Field>
          )}
          <Field label="Handle">
            <input value={handle} onChange={e => setHandle(e.target.value)} style={inputCss} />
          </Field>
          <Field label="Version">
            <input value={version} onChange={e => setVersion(e.target.value)} style={inputCss} />
          </Field>
        </div>

        {/* Forecast issue type + overnight period - outlook mode only */}
        {!isRadar && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Issue type */}
            <div>
              <p style={{ ...labelCss, margin: '0 0 8px' }}>Forecast issue</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { id: 'initial', label: 'Initial Forecast' },
                  { id: 'update',  label: 'Update' },
                ].map(t => {
                  const on = forecastType === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setForecastType(t.id)} style={{
                      ...btnCss, fontWeight: 800,
                      background: on ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.08)',
                      borderColor: on ? '#38bdf8' : 'rgba(148,163,184,0.2)',
                      color: on ? '#38bdf8' : '#94a3b8',
                    }}>
                      {t.label}
                    </button>
                  );
                })}
                {forecastType === 'update' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" onClick={() => setUpdateNumber(n => Math.max(1, n - 1))} style={{ ...btnCss, padding: '6px 11px', fontWeight: 800 }}>-</button>
                    <span style={{ minWidth: 26, textAlign: 'center', fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: '#7dd3fc' }}>{updateNumber}</span>
                    <button type="button" onClick={() => setUpdateNumber(n => Math.min(99, n + 1))} style={{ ...btnCss, padding: '6px 11px', fontWeight: 800 }}>+</button>
                  </span>
                )}
              </div>
            </div>

            {/* Overnight period */}
            <div>
              <p style={{ ...labelCss, margin: '0 0 8px' }}>Overnight risk period</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={() => setOvernightEnabled(v => !v)} style={{
                  ...btnCss, fontWeight: 800,
                  background: overnightEnabled ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)',
                  borderColor: overnightEnabled ? 'rgba(167,139,250,0.45)' : 'rgba(148,163,184,0.2)',
                  color: overnightEnabled ? '#a78bfa' : '#94a3b8',
                }}>
                  <Clock style={{ width: 13, height: 13 }} /> {overnightEnabled ? 'Overnight On' : 'Overnight Off'}
                </button>
                {overnightEnabled && (
                  <>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>From</span>
                      <input type="time" value={overnightStart} onChange={e => setOvernightStart(e.target.value)} style={{ ...inputCss, width: 110, colorScheme: 'dark' }} />
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>To</span>
                      <input type="time" value={overnightEnd} onChange={e => setOvernightEnd(e.target.value)} style={{ ...inputCss, width: 110, colorScheme: 'dark' }} />
                    </span>
                    {overnightCrossesMidnight && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.04em' }}>crosses midnight (+1 day)</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Map tool selector: Draw areas / Text labels / Motion arrows ── */}
        {!isRadar && (
          <div>
            <p style={{ ...labelCss, margin: '0 0 8px' }}>Map tool</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                { id: 'draw',  label: 'Draw Areas', Icon: Pen },
                { id: 'text',  label: 'Text Label', Icon: Type },
                { id: 'arrow', label: 'Motion Arrow', Icon: MoveUpRight },
                { id: 'cond',  label: 'Area Conditional', Icon: ShieldAlert },
              ].map(t => {
                const on = mapTool === t.id;
                const TIcon = t.Icon;
                return (
                  <button key={t.id} type="button" onClick={() => setMapTool(t.id)} style={{
                    ...btnCss, fontWeight: 800,
                    background: on ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)',
                    borderColor: on ? 'rgba(167,139,250,0.5)' : 'rgba(148,163,184,0.2)',
                    color: on ? '#a78bfa' : '#94a3b8',
                  }}>
                    <TIcon style={{ width: 13, height: 13 }} /> {t.label}
                  </button>
                );
              })}
              {drawLocked && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.03em' }}>
                  Map placement locked while zoomed — set region to UK Wide to edit
                </span>
              )}
            </div>

            {/* AREA CONDITIONAL tool help */}
            {mapTool === 'cond' && (
              <div style={{
                marginTop: 10, padding: '11px 13px', borderRadius: 10,
                background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.25)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <span style={{ fontSize: 11.5, color: '#cbd5e1' }}>
                  Click inside any drawn risk area to mark it <strong>conditional</strong>. Click it again to clear.
                </span>
                <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                  A conditional area's outline becomes a dashed, darker shade of that area's own colour.
                  {shapes.some(s => s.cond) ? ` ${shapes.filter(s => s.cond).length} area(s) currently conditional.` : ''}
                </span>
              </div>
            )}

            {/* TEXT tool controls */}
            {mapTool === 'text' && (
              <div style={{
                marginTop: 10, padding: '11px 13px', borderRadius: 10,
                background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.25)',
                display: 'flex', flexDirection: 'column', gap: 9,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    value={annDraft}
                    onChange={e => setAnnDraft(e.target.value)}
                    placeholder="Label text, then click the map to place (e.g. MAIN THREAT 14–18Z)"
                    style={{ ...inputCss, flex: 1, minWidth: 240 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...labelCss }}>Colour</span>
                    {ANNOTATION_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setAnnColor(c)} style={{
                        width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                        border: annColor === c ? '2px solid #f1f5f9' : '2px solid rgba(148,163,184,0.3)',
                      }} />
                    ))}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ ...labelCss }}>Size</span>
                    {ANNOTATION_SIZES.map(s => (
                      <button key={s.id} type="button" onClick={() => setAnnSize(s.id)} style={{
                        ...btnCss, padding: '5px 10px', fontWeight: 800,
                        background: annSize === s.id ? 'rgba(167,139,250,0.2)' : 'rgba(148,163,184,0.08)',
                        borderColor: annSize === s.id ? 'rgba(167,139,250,0.5)' : 'rgba(148,163,184,0.2)',
                        color: annSize === s.id ? '#a78bfa' : '#94a3b8',
                      }}>{s.label}</button>
                    ))}
                  </span>
                  <button type="button" onClick={() => setAnnPill(v => !v)} style={{
                    ...btnCss, fontWeight: 700,
                    background: annPill ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)',
                    borderColor: annPill ? 'rgba(167,139,250,0.45)' : 'rgba(148,163,184,0.2)',
                    color: annPill ? '#a78bfa' : '#94a3b8',
                  }}>{annPill ? 'Pill On' : 'Pill Off'}</button>
                  <button type="button" onClick={() => setAnnLeader(v => !v)} style={{
                    ...btnCss, fontWeight: 700,
                    background: annLeader ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)',
                    borderColor: annLeader ? 'rgba(167,139,250,0.45)' : 'rgba(148,163,184,0.2)',
                    color: annLeader ? '#a78bfa' : '#94a3b8',
                  }}>{annLeader ? 'Leader On' : 'Leader Off'}</button>
                </div>
                <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                  Tip: drag any placed label to reposition it. Leader-line target dots can be dragged in the list below.
                </span>
              </div>
            )}

            {/* ARROW tool controls */}
            {mapTool === 'arrow' && (
              <div style={{
                marginTop: 10, padding: '11px 13px', borderRadius: 10,
                background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.25)',
                display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 11.5, color: '#cbd5e1' }}>Drag on the map to draw a storm-motion arrow.</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ ...labelCss }}>Colour</span>
                  {ANNOTATION_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setArrowColor(c)} style={{
                      width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                      border: arrowColor === c ? '2px solid #f1f5f9' : '2px solid rgba(148,163,184,0.3)',
                    }} />
                  ))}
                </span>
                <button type="button" onClick={undoArrow} disabled={!arrows.length}
                  style={{ ...btnCss, opacity: arrows.length ? 1 : 0.4 }}>
                  <Undo2 style={{ width: 13, height: 13 }} /> Undo Arrow
                </button>
                <button type="button" onClick={clearArrows} disabled={!arrows.length}
                  style={{ ...btnCss, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)', opacity: arrows.length ? 1 : 0.4 }}>
                  <Eraser style={{ width: 13, height: 13 }} /> Clear Arrows
                </button>
              </div>
            )}

            {/* Placed annotations list — edit / move-target / delete */}
            {annotations.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...labelCss }}>Placed labels ({annotations.length})</span>
                {annotations.map(a => (
                  <div key={a.id} style={{
                    display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                    padding: '6px 9px', borderRadius: 8,
                    background: editingAnnId === a.id ? 'rgba(167,139,250,0.12)' : 'rgba(148,163,184,0.06)',
                    border: `1px solid ${editingAnnId === a.id ? 'rgba(167,139,250,0.4)' : 'rgba(148,163,184,0.16)'}`,
                  }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: a.color, flexShrink: 0, border: '1px solid rgba(0,0,0,0.3)' }} />
                    <input value={a.text} onChange={e => updateAnnotation(a.id, { text: e.target.value })}
                      onFocus={() => setEditingAnnId(a.id)}
                      style={{ ...inputCss, flex: 1, minWidth: 160, padding: '5px 8px' }} />
                    <button type="button" onClick={() => updateAnnotation(a.id, { leader: !a.leader })} style={{
                      ...btnCss, padding: '5px 9px', fontSize: 11,
                      background: a.leader ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)',
                      borderColor: a.leader ? 'rgba(167,139,250,0.45)' : 'rgba(148,163,184,0.2)',
                      color: a.leader ? '#a78bfa' : '#94a3b8',
                    }}>Leader</button>
                    <button type="button" onClick={() => updateAnnotation(a.id, { pill: !a.pill })} style={{
                      ...btnCss, padding: '5px 9px', fontSize: 11,
                      background: a.pill ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)',
                      borderColor: a.pill ? 'rgba(167,139,250,0.45)' : 'rgba(148,163,184,0.2)',
                      color: a.pill ? '#a78bfa' : '#94a3b8',
                    }}>Pill</button>
                    <button type="button" onClick={() => removeAnnotation(a.id)}
                      style={{ ...btnCss, padding: '5px 9px', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}>
                      <Trash2 style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Confidence + Timeline granularity + Region (outlook only) ── */}
        {!isRadar && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Confidence */}
            <div>
              <p style={{ ...labelCss, margin: '0 0 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Gauge style={{ width: 12, height: 12 }} /> Forecast confidence
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {CONFIDENCE_LEVELS.map(c => {
                  const on = confidence === c.id;
                  return (
                    <button key={c.id} type="button" onClick={() => setConfidence(on ? null : c.id)} style={{
                      ...btnCss, fontWeight: 800,
                      background: on ? `${c.color}22` : 'rgba(148,163,184,0.08)',
                      borderColor: on ? c.color : 'rgba(148,163,184,0.2)',
                      color: on ? c.color : '#94a3b8',
                    }}>
                      <span style={{ display: 'inline-flex', gap: 2 }}>
                        {Array.from({ length: CONFIDENCE_STEPS }, (_, i) => (
                          <span key={i} style={{
                            width: 4, height: 11, borderRadius: 1,
                            background: i < c.bars ? c.color : 'rgba(148,163,184,0.25)',
                          }} />
                        ))}
                      </span>
                      {c.label}
                    </button>
                  );
                })}
                {confidence && (
                  <button type="button" onClick={() => setConfidence(null)} style={{ ...btnCss, padding: '6px 9px', color: '#94a3b8' }}>
                    <X style={{ width: 12, height: 12 }} /> Off
                  </button>
                )}
              </div>
            </div>

            {/* Timeline granularity */}
            <div>
              <p style={{ ...labelCss, margin: '0 0 8px' }}>Timeline resolution & window</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {[['3h','3-hourly'],['2h','2-hourly'],['1h','Hourly']].map(([id, label]) => { const on = timelineGran === id; return (
                  <button key={id} type="button" onClick={() => setTimelineGran(id)} style={{ ...btnCss, fontWeight: 800, background: on ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.08)', borderColor: on ? '#38bdf8' : 'rgba(148,163,184,0.2)', color: on ? '#38bdf8' : '#94a3b8' }}>{label}</button>
                ); })}
                <button type="button" onClick={() => setTimelineRangeMode(v => !v)} title="Click a start time then an end time to fill the band" style={{ ...btnCss, fontWeight: 800, marginLeft: 4, background: timelineRangeMode ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)', borderColor: timelineRangeMode ? 'rgba(167,139,250,0.5)' : 'rgba(148,163,184,0.2)', color: timelineRangeMode ? '#a78bfa' : '#94a3b8' }}>
                  <Clock style={{ width: 13, height: 13 }} /> {timelineRangeMode ? 'Range: On' : 'Range Fill'}
                </button>
                {timelineRangeMode && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.03em' }}>{rangeAnchor == null ? 'Click the start time…' : 'Now click the end time'}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <span style={{ ...labelCss, margin: 0 }}>Window</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, color: '#94a3b8' }}>From</span><input type="time" value={timelineStart} onChange={e => setTimelineStart(e.target.value)} style={{ ...inputCss, width: 110, colorScheme: 'dark' }} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, color: '#94a3b8' }}>To</span><input type="time" value={timelineEnd} onChange={e => setTimelineEnd(e.target.value)} style={{ ...inputCss, width: 110, colorScheme: 'dark' }} /></span>
                <span style={{ fontSize: 10.5, color: '#64748b' }}>End at/earlier than start = next day</span>
              </div>
            </div>

            {/* Outlook region zoom */}
            <div>
              <p style={{ ...labelCss, margin: '0 0 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Crop style={{ width: 12, height: 12 }} /> Map view
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {UK_REGIONS.map(r => {
                  const on = outlookRegion === r.id;
                  return (
                    <button key={r.id} type="button" onClick={() => setOutlookRegion(r.id)} style={{
                      padding: '5px 9px', borderRadius: 8, fontSize: 11, fontWeight: on ? 800 : 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? 'rgba(14,165,233,0.18)' : 'rgba(148,163,184,0.06)',
                      border: `1px solid ${on ? 'rgba(14,165,233,0.5)' : 'rgba(148,163,184,0.15)'}`,
                      color: on ? '#38bdf8' : '#94a3b8',
                    }}>{r.id === 'uk' ? 'UK Wide' : r.label}</button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Valid-until + Forecast discussion (outlook only) ── */}
        {!isRadar && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <p style={{ ...labelCss, margin: '0 0 8px' }}>Valid until (expiry)</p>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="datetime-local" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                  style={{ ...inputCss, width: 220, colorScheme: 'dark' }} />
                {validUntil && (
                  <button type="button" onClick={() => setValidUntil('')} style={{ ...btnCss, padding: '8px 10px' }}>
                    <X style={{ width: 13, height: 13 }} />
                  </button>
                )}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <p style={{ ...labelCss, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText style={{ width: 12, height: 12 }} /> Forecast discussion
                <button type="button" onClick={() => setDiscussionEnabled(v => !v)} style={{
                  ...btnCss, padding: '4px 9px', fontSize: 10.5, fontWeight: 800,
                  background: discussionEnabled ? 'rgba(74,222,128,0.16)' : 'rgba(148,163,184,0.08)',
                  borderColor: discussionEnabled ? 'rgba(74,222,128,0.45)' : 'rgba(148,163,184,0.2)',
                  color: discussionEnabled ? '#86efac' : '#94a3b8', textTransform: 'none', letterSpacing: 0,
                }}>{discussionEnabled ? 'Shown on graphic' : 'Hidden'}</button>
              </p>
              <textarea
                value={discussionText}
                onChange={e => setDiscussionText(e.target.value)}
                placeholder="Short forecaster discussion shown as a card on the graphic (2–3 lines). E.g. Surface heating and a sharpening trough drive scattered storms from midday; greatest hail/lightning risk over central and eastern England."
                rows={3}
                style={{ ...inputCss, width: '100%', resize: 'vertical', lineHeight: 1.4 }}
              />
            </div>
          </div>
        )}

        {/* Active risk — OUTLOOK ONLY. The radar view renders the real Met Office radar
            imagery, so the hand-drawn rain-rate palette that used to sit here
            was redundant (and could contradict the actual radar) and has been
            removed. */}
        {!isRadar && (
        <div>
          <p style={{ ...labelCss, margin: '0 0 8px' }}>
            Active risk - drawing areas &amp; timeline stamps
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {levels.map(r => {
              const active = activeRisk === r.id;
              return (
                <button key={r.id} type="button" onClick={() => setActiveRisk(r.id)} style={{
                  padding: '8px 12px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 7,
                  background: active ? `${r.color}22` : 'transparent',
                  border: `1.5px solid ${active ? r.color : 'rgba(148,163,184,0.2)'}`,
                  cursor: 'pointer', color: active ? r.color : '#94a3b8',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 800,
                }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.color }} />
                  {r.short}
                  <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.75, fontFamily: 'monospace' }}>{r.range}</span>
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* Hazards — disabled while the lightning overlay is active, since the
            lightning verification view replaces the hazard forecast. */}
        <div style={{ opacity: showLightning ? 0.4 : 1, pointerEvents: showLightning ? 'none' : 'auto' }}>
          <p style={{ ...labelCss, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            Hazard badges
            {showLightning && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#fde68a', letterSpacing: '0.04em', textTransform: 'none' }}>
                — off in lightning mode
              </span>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hazardList.map(h => {
              const on = hazards.includes(h.id);
              const HIcon = h.Icon;
              const pct = hazardPct[h.id];
              return (
                <span key={h.id} style={{
                  display: 'inline-flex', alignItems: 'center', borderRadius: 10, overflow: 'hidden',
                  background: on ? 'rgba(56,189,248,0.10)' : 'transparent',
                  border: `1.5px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.2)'}`,
                }}>
                  <button type="button" disabled={showLightning} onClick={() => toggleHazard(h.id)} style={{
                    padding: '8px 12px', fontSize: 12, fontWeight: 700, border: 'none', background: 'transparent',
                    cursor: showLightning ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 7,
                    color: on ? '#f1f5f9' : '#94a3b8', fontFamily: 'inherit',
                  }}>
                    {HIcon && <HIcon style={{ width: 13, height: 13 }} />} {h.label}
                  </button>
                  {/* Percentage chance for THIS hazard. Blank = no percentage
                      shown on the graphic, so it stays entirely optional. */}
                  {on && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      paddingLeft: 8, paddingRight: 9,
                      borderLeft: '1px solid rgba(148,163,184,0.25)',
                    }} title={`${h.label} — percentage chance of occurring`}>
                      <input
                        type="number" min={0} max={100} step={5} placeholder="--"
                        value={pct ?? ''}
                        disabled={showLightning}
                        onChange={e => {
                          const v = e.target.value;
                          setHazardPct(p => {
                            const next = { ...p };
                            if (v === '') delete next[h.id];
                            else next[h.id] = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
                            return next;
                          });
                        }}
                        style={{
                          width: 48, padding: '4px 6px', borderRadius: 6, textAlign: 'right',
                          background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)',
                          color: '#f1f5f9', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>%</span>
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        {/* Draw controls + export */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => {
            if (mapTool !== 'draw') { setMapTool('draw'); setDrawMode(true); }
            else setDrawMode(d => !d);
          }} style={{
            ...btnCss,
            background: (mapTool === 'draw' && drawMode) ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)',
            borderColor: (mapTool === 'draw' && drawMode) ? 'rgba(167,139,250,0.45)' : 'rgba(148,163,184,0.2)',
            color: (mapTool === 'draw' && drawMode) ? '#a78bfa' : '#94a3b8',
          }}>
            {(mapTool === 'draw' && drawMode) ? <Pen style={{ width: 13, height: 13 }} /> : <MousePointer style={{ width: 13, height: 13 }} />}
            {(mapTool === 'draw' && drawMode) ? 'Pen Active' : 'Draw Area'}
          </button>
          <button type="button" onClick={() => setShowShapes(v => !v)} style={btnCss}>
            {showShapes ? <Eye style={{ width: 13, height: 13 }} /> : <EyeOff style={{ width: 13, height: 13 }} />}
          </button>
          <button type="button" onClick={() => setShowCities(v => !v)} style={{ ...btnCss, background: showCities ? 'rgba(56,189,248,0.10)' : 'rgba(148,163,184,0.08)', borderColor: showCities ? 'rgba(56,189,248,0.45)' : 'rgba(148,163,184,0.2)', color: showCities ? '#38bdf8' : '#94a3b8' }}><MapPin style={{ width: 13, height: 13 }} /> Cities</button>
          <button type="button" onClick={() => setShowUKVRain(v => !v)} style={{ ...btnCss, background: showUKVRain ? 'rgba(56,189,248,0.18)' : 'rgba(148,163,184,0.08)', borderColor: showUKVRain ? 'rgba(56,189,248,0.5)' : 'rgba(148,163,184,0.2)', color: showUKVRain ? '#38bdf8' : '#94a3b8' }}><CloudRain style={{ width: 13, height: 13 }} /> {showUKVRain ? 'UKV Rain On' : 'UKV Rain'}</button>
          <button type="button" onClick={toggleLightning} style={{
            ...btnCss,
            background: showLightning ? `${lightningColor}1a` : 'rgba(148,163,184,0.08)',
            borderColor: showLightning ? `${lightningColor}88` : 'rgba(148,163,184,0.2)',
            color: showLightning ? lightningColor : '#94a3b8',
          }}>
            <Zap style={{ width: 13, height: 13 }} />
            {loadingStrikes ? 'Loading strikes...' : showLightning ? 'Lightning On' : 'Load Lightning'}
          </button>
          {showLightning && (
            <button type="button" onClick={refreshLightning} disabled={loadingStrikes} title="Re-pull today's strikes and merge any new ones"
              style={{
                ...btnCss,
                background: 'rgba(56,189,248,0.08)', borderColor: 'rgba(56,189,248,0.4)',
                color: '#38bdf8', opacity: loadingStrikes ? 0.5 : 1, cursor: loadingStrikes ? 'wait' : 'pointer',
              }}>
              <RefreshCw style={{ width: 13, height: 13, animation: loadingStrikes ? 'spin 1s linear infinite' : 'none' }} /> Refresh
            </button>
          )}
          {/* Live-feed status + any load error, so an empty map is never silent */}
          {showLightning && (() => {
            const live = liveStatus === 'connected';
            const dotColor = live ? '#4ade80' : liveStatus === 'unavailable' ? '#f87171' : '#facc15';
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8,
                  background: 'rgba(148,163,184,0.08)', border: `1px solid ${dotColor}55`,
                }} title="Live Blitzortung stream">
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, boxShadow: `0 0 7px ${dotColor}` }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>
                    {live ? 'Live feed' : liveStatus === 'unavailable' ? 'Live feed off' : 'Connecting…'}
                  </span>
                </span>
                {lightningError && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24', maxWidth: 320, lineHeight: 1.35 }}>
                    {lightningError}
                  </span>
                )}
              </span>
            );
          })()}
          {showLightning && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {LIGHTNING_SWATCHES.map(c => (
                <button key={c} type="button" onClick={() => setLightningColor(c)} style={{
                  width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: lightningColor === c ? '2px solid #f1f5f9' : '2px solid rgba(148,163,184,0.3)',
                  padding: 0,
                }} />
              ))}
              <input type="color" value={lightningColor} onChange={e => setLightningColor(e.target.value)}
                style={{ width: 24, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
            </span>
          )}
          {showLightning && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button type="button" onClick={() => setLightningOutline(v => !v)} style={{
                ...btnCss,
                background: lightningOutline ? 'rgba(248,250,252,0.12)' : 'rgba(148,163,184,0.08)',
                borderColor: lightningOutline ? 'rgba(241,245,249,0.6)' : 'rgba(148,163,184,0.2)',
                color: lightningOutline ? '#f1f5f9' : '#94a3b8',
              }}>
                <Circle style={{ width: 12, height: 12 }} /> {lightningOutline ? 'Outline On' : 'Outline'}
              </button>
              {lightningOutline && (
                <input type="color" value={lightningOutlineColor} onChange={e => setLightningOutlineColor(e.target.value)}
                  title="Outline colour"
                  style={{ width: 24, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
              )}
            </span>
          )}
          {showLightning && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 9, padding: '5px 11px',
              borderRadius: 8, background: 'rgba(250,204,21,0.08)',
              border: '1px solid rgba(250,204,21,0.28)', fontSize: 11.5, color: '#e8edf6',
            }}>
              <span><strong style={{ color: '#fde68a', fontFamily: 'monospace', fontSize: 13 }}>{lightningStats.count.toLocaleString()}</strong> UK &amp; Ireland strikes {lightningWindow ? 'in window' : 'today'}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              {lightningStats.count > 0 && lightningStats.peakHour != null ? (
                <span>peak <strong style={{ color: '#fff' }}>{fmtHour(lightningStats.peakHour)}–{fmtHour((lightningStats.peakHour + 1) % 24)} {tzAbbr}</strong> <span style={{ opacity: 0.7 }}>({lightningStats.peakCount.toLocaleString()})</span></span>
              ) : (
                <span style={{ opacity: 0.7 }}>{loadingStrikes ? 'loading…' : (lightningWindow ? 'no strikes in window' : 'no UK strikes today')}</span>
              )}
            </span>
          )}
          {showLightning && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 11px',
              borderRadius: 8, background: lightningWindow ? 'rgba(56,189,248,0.1)' : 'rgba(148,163,184,0.06)',
              border: `1px solid ${lightningWindow ? 'rgba(56,189,248,0.4)' : 'rgba(148,163,184,0.2)'}` }}>
              <button type="button" onClick={() => setLightningWindow(v => !v)} style={{
                ...btnCss,
                background: lightningWindow ? 'rgba(56,189,248,0.18)' : 'rgba(148,163,184,0.08)',
                borderColor: lightningWindow ? 'rgba(56,189,248,0.6)' : 'rgba(148,163,184,0.2)',
                color: lightningWindow ? '#38bdf8' : '#94a3b8',
              }}>
                <Clock style={{ width: 12, height: 12 }} /> {lightningWindow ? 'Last 24h: On' : 'Last 24h'}
              </button>
              {lightningWindow && (() => {
                const fmtDur = (m) => m >= 60 ? (m % 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${Math.floor(m/60)}h`) : `${m}m`;
                const startMs = Date.now() - windowMinutes * 60_000;
                const fmt = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                return (
                  <>
                    <span style={{ fontSize: 10.5, color: '#cbd5e1', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {fmt(startMs)} → now
                    </span>
                    <input type="range" min={5} max={1440} step={5} value={windowMinutes}
                      onChange={e => setWindowMinutes(Number(e.target.value))}
                      style={{ width: 120, accentColor: '#38bdf8', cursor: 'pointer' }} />
                    <span style={{ fontSize: 10.5, color: '#38bdf8', fontFamily: 'monospace', minWidth: 48 }}>{fmtDur(windowMinutes)}</span>
                    {[['1h',60],['3h',180],['6h',360],['12h',720],['24h',1440]].map(([lbl, m]) => (
                      <button key={m} type="button" onClick={() => setWindowMinutes(m)} style={{
                        padding: '3px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                        background: windowMinutes === m ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${windowMinutes === m ? 'rgba(56,189,248,0.55)' : 'rgba(255,255,255,0.12)'}`,
                        color: windowMinutes === m ? '#38bdf8' : '#94a3b8',
                      }}>{lbl}</button>
                    ))}
                  </>
                );
              })()}
            </span>
          )}
          <button type="button" onClick={undoLast} disabled={!shapes.length} style={{ ...btnCss, opacity: shapes.length ? 1 : 0.4 }}><Undo2 style={{ width: 13, height: 13 }} /> Undo</button>
          <button type="button" onClick={clearShapes} disabled={!shapes.length} style={{ ...btnCss, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)', opacity: shapes.length ? 1 : 0.4 }}><Eraser style={{ width: 13, height: 13 }} /> Clear Areas</button>
          <button type="button" onClick={() => { setStampRisks(Array(timelineStamps.length).fill(null)); setStampOverlays(Array(timelineStamps.length).fill(null)); }} style={{ ...btnCss, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}><Eraser style={{ width: 13, height: 13 }} /> Clear Timeline</button>
          <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>Opacity
            <input type="range" min="20" max="100" step="5" value={Math.round(drawOpacity * 100)} onChange={e => setDrawOpacity(Number(e.target.value) / 100)} style={{ width: 80, accentColor: '#a78bfa' }} />
            <span style={{ minWidth: 32, fontFamily: 'monospace', color: '#a78bfa' }}>{Math.round(drawOpacity * 100)}%</span></label>
          {!isRadar && (
            <button type="button" onClick={() => setIsAnimating(v => !v)} disabled={isExporting} title="Play the timeline hour by hour" style={{ ...btnCss, fontWeight: 800, background: isAnimating ? 'rgba(34,197,94,0.18)' : 'rgba(148,163,184,0.08)', borderColor: isAnimating ? 'rgba(34,197,94,0.55)' : 'rgba(148,163,184,0.2)', color: isAnimating ? '#4ade80' : '#94a3b8', opacity: isExporting ? 0.5 : 1 }}>
              {isAnimating ? '❚❚ Pause' : '▶ Animate'}
            </button>
          )}
          {!isRadar && (
            <button type="button" onClick={handleExportVideo} disabled={isExporting} title="Render a WebM video of the timeline sweep" style={{ ...btnCss, background: isExporting ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: 'none', color: '#fff', fontWeight: 700, opacity: isExporting ? 0.6 : 1 }}>
              <Download style={{ width: 13, height: 13 }} /> {isExporting ? 'Rendering…' : 'Export WebM'}
            </button>
          )}
          <button type="button" onClick={handleDownload} disabled={isExporting} style={{ ...btnCss, marginLeft: 'auto', background: isExporting ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: '#fff', fontWeight: 700 }}><Download style={{ width: 14, height: 14 }} /> {isExporting ? 'Generating JPG...' : 'Download JPG'}</button>
          <button type="button" onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); }} style={{
            ...btnCss,
            background: showSavePanel ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.08)',
            borderColor: showSavePanel ? 'rgba(74,222,128,0.5)' : 'rgba(148,163,184,0.2)',
            color: showSavePanel ? '#86efac' : '#94a3b8',
          }}>
            <Save style={{ width: 13, height: 13 }} /> Save to Studio
          </button>
          <button type="button" onClick={() => { openLoadPanel(); setShowSavePanel(false); }} style={{
            ...btnCss,
            background: showLoadPanel ? 'rgba(251,191,36,0.15)' : 'rgba(148,163,184,0.08)',
            borderColor: showLoadPanel ? 'rgba(251,191,36,0.5)' : 'rgba(148,163,184,0.2)',
            color: showLoadPanel ? '#fbbf24' : '#94a3b8',
          }}>
            <FolderOpen style={{ width: 13, height: 13 }} /> Load Saved
          </button>
          {!isRadar && (
            <button type="button" onClick={() => { showTcmPanel ? setShowTcmPanel(false) : openTcmPanel(); setShowSavePanel(false); setShowLoadPanel(false); }} style={{
              ...btnCss,
              background: showTcmPanel ? 'rgba(129,140,248,0.18)' : 'rgba(148,163,184,0.08)',
              borderColor: showTcmPanel ? 'rgba(129,140,248,0.5)' : 'rgba(148,163,184,0.2)',
              color: showTcmPanel ? '#a5b4fc' : '#94a3b8',
            }}>
              <DownloadCloud style={{ width: 13, height: 13 }} /> Load from TCM Run
            </button>
          )}
        </div>

        {/* TCM import panel */}
        {showTcmPanel && (
          <div style={{
            padding: '12px 14px', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8,
            background: 'rgba(129,140,248,0.07)', border: '1px solid rgba(129,140,248,0.25)',
            maxHeight: 280, overflowY: 'auto',
          }}>
            {/* Auto-generated model outlook — the thing to draw over */}
            <div style={{ padding: '9px 11px', borderRadius: 8, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.28)', display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: '#7dd3fc', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Auto outlook · latest model run</span>
              <span style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>Rebuilds the model's thunderstorm risk polygons so you can start from them and draw your own areas over the top.</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>Layer:</span>
                {[['outlook', 'Outlook'], ['hires', 'Risk (HD)']].map(([id, lbl]) => (
                  <button key={id} type="button" onClick={() => setAutoVariant(id)} style={{
                    ...btnCss, padding: '3px 9px', fontSize: 10.5, fontWeight: 700,
                    background: autoVariant === id ? 'rgba(56,189,248,0.22)' : 'transparent',
                    borderColor: autoVariant === id ? 'rgba(56,189,248,0.5)' : 'rgba(148,163,184,0.25)',
                    color: autoVariant === id ? '#bae6fd' : '#94a3b8',
                  }}>{lbl}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {[0, 1, 2].map(di => (
                  <button key={di} type="button" disabled={importingAuto} onClick={() => importAutoOutlook(di, 'replace')} style={{
                    ...btnCss, padding: '5px 11px', fontSize: 11, fontWeight: 700,
                    background: 'rgba(56,189,248,0.16)', borderColor: 'rgba(56,189,248,0.45)', color: '#bae6fd',
                    opacity: importingAuto ? 0.6 : 1, cursor: importingAuto ? 'wait' : 'pointer',
                  }}>{importingAuto ? '…' : `Day ${di + 1}`}</button>
                ))}
                <button type="button" disabled={importingAuto} onClick={() => importAutoOutlook(0, 'append')} style={{
                  ...btnCss, padding: '5px 11px', fontSize: 11,
                  background: 'rgba(56,189,248,0.08)', borderColor: 'rgba(56,189,248,0.30)', color: '#7dd3fc',
                  opacity: importingAuto ? 0.6 : 1,
                }}>+ Add Day 1</button>
              </div>
            </div>

            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a5b4fc', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Or import a hand-drawn published TCM outlook
            </span>
            {loadingTcm && <span style={{ color: '#94a3b8', fontSize: 12 }}>Loading runs…</span>}
            {!loadingTcm && tcmRuns.length === 0 && (
              <span style={{ color: '#64748b', fontSize: 12 }}>No TCM outlooks with mapped risk areas found.</span>
            )}
            {tcmRuns.map(o => {
              const dateStr = o.outlook_date
                ? new Date(o.outlook_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
                : '—';
              const nAreas = o.risk_areas?.length || 0;
              const top = o.risk_level || (o.risk_levels && o.risk_levels[0]) || '';
              return (
                <div key={o.id} style={{
                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                  padding: '7px 10px', borderRadius: 8,
                  background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.22)',
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e8edf6', flex: 1, minWidth: 150 }}>
                    {dateStr}{o.title ? ` · ${o.title}` : ''}
                    {top && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#a5b4fc' }}>{top}</span>}
                  </span>
                  <span style={{ fontSize: 10.5, color: '#94a3b8', fontFamily: 'monospace' }}>{nAreas} area{nAreas !== 1 ? 's' : ''}</span>
                  <button type="button" onClick={() => importTcmAreas(o, 'replace')} style={{
                    ...btnCss, padding: '5px 10px', fontSize: 11, fontWeight: 700,
                    background: 'rgba(129,140,248,0.18)', borderColor: 'rgba(129,140,248,0.45)', color: '#c7d2fe',
                  }}>Replace</button>
                  <button type="button" onClick={() => importTcmAreas(o, 'append')} style={{
                    ...btnCss, padding: '5px 10px', fontSize: 11,
                  }}>Add</button>
                </div>
              );
            })}
            <span style={{ fontSize: 10, color: '#64748b' }}>
              Areas are projected from the TCM map onto this graphic. "Replace" swaps all drawn areas; "Add" merges them in.
            </span>
          </div>
        )}

        {/* Save panel */}
        {showSavePanel && (
          <div style={{
            padding: '12px 14px', borderRadius: 10, display: 'flex', gap: 8, alignItems: 'center',
            background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.25)',
          }}>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveToStudio()}
              placeholder="Name this graphic (e.g. Day 1 Slight Risk)"
              style={{ ...inputCss, flex: 1 }}
            />
            <button type="button" onClick={handleSaveToStudio} disabled={saving || !saveName.trim()} style={{
              ...btnCss, padding: '8px 16px', fontWeight: 700,
              background: saveSuccess ? 'rgba(74,222,128,0.25)' : 'rgba(74,222,128,0.15)',
              borderColor: 'rgba(74,222,128,0.4)', color: '#86efac',
              opacity: (!saveName.trim() || saving) ? 0.5 : 1,
            }}>
              {saving ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> :
               saveSuccess ? <Check style={{ width: 13, height: 13 }} /> : <Save style={{ width: 13, height: 13 }} />}
              {saveSuccess ? 'Saved!' : saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}

        {/* Load panel */}
        {showLoadPanel && (
          <div style={{
            padding: 14, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8,
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)',
            maxHeight: 260, overflowY: 'auto',
          }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Saved Graphics
            </span>
            {loadingGraphics && (
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Loading...</span>
            )}
            {!loadingGraphics && savedGraphics.length === 0 && (
              <span style={{ color: '#64748b', fontSize: 12 }}>No saved graphics found. Use "Save to Studio" to save your work.</span>
            )}
            {savedGraphics.map(g => (
              <button key={g.id} type="button" onClick={() => loadState(g)} style={{
                ...btnCss, justifyContent: 'flex-start', textAlign: 'left',
                background: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.22)', color: '#f1f5f9',
              }}>
                <FolderOpen style={{ width: 12, height: 12, color: '#fbbf24', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{g.title}</span>
                <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>
                  {new Date(g.created_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Drawn shape chips — click the level to promote it up the ladder */}
        {shapes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ ...labelCss, marginRight: 2 }}>Areas ({shapes.length}) · click to change level</span>
            {shapes.map((s, i) => {
              const m = LEVEL_LOOKUP[s.riskLevel] || GRAPHIC_LEVELS[0];
              const canCond = !isSevereId(s.riskLevel) && !isCondSevereId(s.riskLevel);
              return (
                <span key={i} style={{
                  padding: '3px 4px 3px 9px', borderRadius: 6, background: m.fill,
                  border: s.cond ? `1.5px dashed ${darkenColor(m.border, 0.4)}` : `1.5px solid ${m.color}`,
                  color: '#f1f5f9',
                  fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <button type="button" onClick={() => cycleShapeRisk(i)} title="Click to cycle risk level"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#f1f5f9',
                             padding: 0, fontWeight: 700, fontFamily: 'inherit', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <RefreshCw style={{ width: 10, height: 10, opacity: 0.7 }} /> {s.riskLevel}
                  </button>
                  {canCond && (
                    <button type="button" onClick={() => setShapes(prev => prev.map((sh, j) => (j === i ? { ...sh, cond: !sh.cond } : sh)))}
                      title="Toggle conditional"
                      style={{ background: s.cond ? 'rgba(0,0,0,0.35)' : 'transparent', border: 'none', cursor: 'pointer',
                               color: '#fff', padding: '1px 5px', borderRadius: 4, fontWeight: 800, fontFamily: 'inherit', fontSize: 10,
                               letterSpacing: '0.04em' }}>
                      C
                    </button>
                  )}
                  <button type="button" onClick={() => setShapes(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#f1f5f9', padding: '0 2px', display: 'inline-flex' }}>
                    <X style={{ width: 11, height: 11 }} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ GRAPHIC (exported area) ============ */}
      <div ref={scaleWrapRef} style={{
        width: '100%', height: GRAPHIC_H * scale, overflow: 'hidden',
        display: 'flex', justifyContent: 'center',
      }}>
        <div ref={graphicRef} style={{
          width: GRAPHIC_W, height: GRAPHIC_H, position: 'relative', overflow: 'hidden',
          borderRadius: 24, fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
          background: '#06040f', flexShrink: 0,
          transform: `scale(${scale})`, transformOrigin: 'top center',
          border: isRadar ? '3px solid rgba(56,189,248,0.55)' : '3px solid rgba(125,140,232,0.55)',
        }}>
          {/* -- Backdrop -- */}
          {isRadar ? (
            <>
              <img src="https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?q=80&w=1600&auto=format&fit=crop" alt="" crossOrigin="anonymous" style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', pointerEvents: 'none',
                filter: 'blur(1.8px) brightness(0.65)',
              }} />
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: 'linear-gradient(170deg, rgba(4,12,32,0.58) 0%, rgba(6,14,28,0.35) 40%, rgba(8,14,26,0.38) 65%, rgba(4,12,32,0.62) 100%)',
              }} />
            </>
          ) : (
            <>
              <img src={STORM_BG_URL} alt="" crossOrigin="anonymous" style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', pointerEvents: 'none',
                filter: 'blur(1.4px) brightness(0.58)',
              }} />
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: 'linear-gradient(180deg, rgba(8,11,22,0.56) 0%, rgba(8,11,22,0.35) 38%, rgba(8,11,22,0.38) 70%, rgba(8,11,22,0.62) 100%)',
              }} />
            </>
          )}

          <div style={{
            position: 'absolute', inset: 0, opacity: 0.04, pointerEvents: 'none',
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.6) 0.5px, transparent 0.5px)',
            backgroundSize: '22px 22px',
          }} />

          {/* The day/days this graphic is for now render inline under the title. */}

          {/* -- HEADER -- */}
          {/* The header content auto-scales down if the stacked cards would
              otherwise run past the footer, so every overlay on the left stays
              fully visible (and is captured intact in the JPG export). */}
          <div style={{
            position: 'absolute', top: 14, left: 18, right: 18, bottom: 74,
            zIndex: 5, pointerEvents: 'none',
          }}>
          <div ref={headerScaleRef} style={{
            transformOrigin: 'top left',
            transform: headerScale < 1 ? `scale(${headerScale})` : 'none',
          }}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
              /* Reserve room for the date card, which is pinned to the graphic's
                 top-right corner OUTSIDE this scaler (see the DATE CARD block
                 above) so the title never runs underneath it.

                 Divided by headerScale because this padding sits INSIDE the
                 scaler and the card does not. At scale s the padding PAINTS s
                 times as wide while the card keeps its full width, so a flat
                 200 became 124 at the 0.62 floor against a two-date card ~142
                 wide — the card landed on the title. Dividing keeps the painted
                 gap constant at every scale.

                 The feedback this creates (wider padding -> title wraps ->
                 header taller -> smaller scale -> wider padding) is weak and
                 settles: the title row is ~50px of a ~670px natural height, and
                 the 0.005 threshold in the measuring effect stops the chase.
                 The clamp bounds it even if a future title makes it stronger. */
              paddingRight: !isRadar ? 18 : 0,
            }}>

              <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{
                    fontSize: isRadar ? 31 : (showLightning ? 22 : (isExtended ? 25 : 31)),
                    fontWeight: 800, color: '#fff', letterSpacing: '-0.02em',
                    lineHeight: 0.98, textTransform: 'uppercase',
                    textShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    display: 'inline-flex', alignItems: 'center', gap: 12,
                  }}>{isRadar
                    ? <><Radar style={{ width: 28, height: 28, color: '#7dd3fc' }} strokeWidth={2.2} /> Radar</>
                    : showLightning ? 'Outlook Lightning Verification'
                    : <>{isExtended ? 'Extended ' : ''}<Zap style={{ width: 28, height: 28, color: '#ffffff' }} strokeWidth={2.4} fill="#ffffff" /> Thunderstorm Outlook</>}</span>

                  {/* Outlook: forecast-type + extended badges under the title */}
                  {!isRadar && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                      {(() => {
                        const d1 = new Date(validDate + 'T12:00:00');
                        const d2 = validDate2 ? new Date(validDate2 + 'T12:00:00') : null;
                        const f = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
                        return <span style={{ padding: '2px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800, background: 'rgba(148,163,184,0.20)',
                          color: '#e2e8f0', letterSpacing: '0.10em', textTransform: 'uppercase', border: '1px solid rgba(148,163,184,0.38)' }}>
                          {d2 ? `${f(d1)} → ${f(d2)}` : f(d1)}</span>;
                      })()}
                      {isExtended && (
                        <span style={{
                          padding: '2px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800,
                          background: 'rgba(167,139,250,0.22)', color: '#c4b5fd',
                          letterSpacing: '0.13em', textTransform: 'uppercase',
                          border: '1px solid rgba(167,139,250,0.5)',
                        }}>Extended · Day {leadDays}</span>
                      )}
                    </div>
                  )}

                  {isRadar && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <span style={{
                        padding: '1px 6px', borderRadius: 4, fontSize: 7.5, fontWeight: 800,
                        background: 'rgba(239,68,68,0.85)', color: '#fff',
                        letterSpacing: '0.14em', textTransform: 'uppercase',
                        border: '1px solid rgba(248,113,113,0.5)',
                      }}>LIVE</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: 'rgba(226,232,240,0.90)',
                        letterSpacing: '0.13em', textTransform: 'uppercase',
                      }}>{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })} {tzAbbr}</span>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {!isRadar && <TimelinePill stamps={timelineStamps} stampRisks={stampRisks} stampOverlays={stampOverlays} onStampClick={cycleStamp} rangeAnchor={rangeAnchor} validLabel={timelineValid?.label} playhead={playhead} exportMode={exportMode} />}


            {!isRadar && overnightEnabled && (
              <div style={{
                ...glass({
                  padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 11,
                  borderRadius: 12, alignSelf: 'flex-start',
                }, exportMode),
                border: '1px solid rgba(167,139,250,0.45)',
              }}>
                <GlassSheen />
                <span style={{
                  position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(167,139,250,0.22)', border: '1px solid rgba(167,139,250,0.55)',
                }}>
                  {/* moon glyph */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                </span>
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: '0.20em', textTransform: 'uppercase',
                    color: 'rgba(196,181,253,0.95)',
                  }}>Overnight Risk Period</span>
                  <span style={{
                    fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '0.01em',
                    fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
                  }}>{overnightLabel}</span>
                </div>
              </div>
            )}

            <div style={{ ...glass({ padding: '8px 10px', borderRadius: 14, alignSelf: 'flex-start', width: 170 }, exportMode) }}>
              <GlassSheen />
              <span style={{
                position: 'relative', zIndex: 1, display: 'block', marginBottom: 6, paddingBottom: 6,
                borderBottom: '1px solid rgba(255,255,255,0.10)',
                fontSize: 8.5, fontWeight: 800, letterSpacing: '0.22em',
                color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase',
              }}>{isRadar ? 'Rain Rate' : 'Risk Key'}</span>
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
                {levels.map((r, idx) => (
                  <React.Fragment key={r.id}>
                    {(() => {
                      if (idx === levels.findIndex(rr => isSevereId(rr.id) || isCondSevereId(rr.id)))
                        return (<div style={{ margin: '4px 0 2px' }}>
                          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.32) 20%, rgba(255,255,255,0.32) 80%, transparent)' }} />
                          <span style={{ display: 'block', marginTop: 3, fontSize: 7, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>Other:</span>
                        </div>);
                      return idx > 0 ? (<div style={{ height: 1, marginLeft: 8, marginRight: 8, marginTop: 4, marginBottom: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 30%, rgba(255,255,255,0.18) 70%, transparent 100%)' }} />) : null;
                    })()}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 28, height: 11, borderRadius: 3, flexShrink: 0,
                        // Severe: black/indigo hatch. Conditional Severe: flat
                        // grey fill inside a dashed grey outline, no hatch.
                        // Everything else: solid colour chip.
                        ...(isSevereId(r.id) ? {
                          background: 'transparent',
                          backgroundImage: 'repeating-linear-gradient(45deg, #312e81 0 3px, transparent 3px 7px)',
                          border: `1.5px solid ${r.color}`,
                          boxSizing: 'border-box',
                        } : isCondSevereId(r.id) ? {
                          background: r.fill,
                          border: `1.5px dashed ${r.color}`,
                          boxSizing: 'border-box',
                        } : {
                          background: r.color,
                          // The radar ramp includes very dark greens and
                          // reds that would otherwise vanish against the dark
                          // glass card — a hairline keeps every band's chip readable.
                          ...(isRadar ? { border: '1px solid rgba(255,255,255,0.28)', boxSizing: 'border-box' } : {}),
                        }),
                      }} />
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: '#e8edf6', letterSpacing: '0.04em',
                      }}>{r.short}</span>
                      <span style={{
                        marginLeft: 'auto', display: 'flex', flexDirection: 'column',
                        alignItems: 'flex-end', lineHeight: 1.15,
                      }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700,
                          color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace',
                        }}>{r.range}</span>
                        {/* Radar bands also carry the dBZ span they came from */}
                        {r.dbz && (
                          <span style={{
                            fontSize: 7.5, fontWeight: 700,
                            color: 'rgba(255,255,255,0.42)', fontFamily: 'monospace',
                          }}>{r.dbz}</span>
                        )}
                      </span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              {/* Forecaster confidence — segmented multi-box meter. Boxes fill
                  left-to-right up to the selected level, so the reader gets the
                  confidence at a glance rather than parsing a word. */}
              {!isRadar && confidence && (() => {
                const c = CONFIDENCE_BY_ID[confidence];
                if (!c) return null;
                return (
                  <div style={{
                    position: 'relative', zIndex: 1, marginTop: 9, paddingTop: 8,
                    borderTop: '1px solid rgba(255,255,255,0.10)',
                    display: 'flex', flexDirection: 'column', gap: 5,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{
                        fontSize: 8, fontWeight: 800, letterSpacing: '0.18em',
                        color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase',
                      }}>Confidence</span>
                      <span style={{
                        marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: c.color,
                        letterSpacing: '0.10em', textTransform: 'uppercase',
                      }}>{c.label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {Array.from({ length: CONFIDENCE_STEPS }, (_, i) => {
                        const filled = i < c.bars;
                        return (
                          <span key={i} style={{
                            flex: 1, height: 9, borderRadius: 2, boxSizing: 'border-box',
                            background: filled ? c.color : 'rgba(148,163,184,0.16)',
                            border: `1px solid ${filled ? c.color : 'rgba(148,163,184,0.30)'}`,
                            boxShadow: filled ? `0 0 6px ${c.color}66` : 'none',
                          }} />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <span style={{
                position: 'relative', zIndex: 1, display: 'block', marginTop: 8,
                fontSize: 7.5, fontWeight: 700, letterSpacing: '0.07em',
                color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase',
              }}>{isRadar ? 'Source: Met Office radar / Blitzortung' : usesSevere ? 'SVRE = Severe Tstorm risk · COND = conditional' : null}</span>
            </div>

            {/* Hazards card — hidden while the lightning overlay is active, since
                lightning mode is a verification view, not a hazard forecast. */}
            {!showLightning && visibleHazards.length > 0 && (() => {
              // When 4+ hazard overlays are selected the rows in the box shrink
              // so they all fit without the panel growing tall / cramped.
              const compact = visibleHazards.length >= 4;
              const rowGap   = compact ? 3 : 5;
              const rowPad   = compact ? '5px 8px' : '6px 9px';
              const rowGapIn = compact ? 8 : 10;
              const iconBox  = compact ? 22 : 26;
              const iconSize = compact ? 13 : 14;
              const customSz = compact ? 13 : 15;
              const labelSz  = compact ? 9.5 : 10;
              return (
              <div style={{ ...glass({ padding: compact ? '10px 11px' : '8px 10px', borderRadius: 14, alignSelf: 'flex-start', width: visibleHazards.some(h => hazardPct[h.id] != null) ? 200 : 170 }, exportMode) }}>
                <GlassSheen />
                <span style={{
                  position: 'relative', zIndex: 1, display: 'block', marginBottom: compact ? 7 : 9, paddingBottom: 7,
                  borderBottom: '1px solid rgba(255,255,255,0.10)',
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.22em',
                  color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase',
                }}>{isRadar ? 'Conditions' : 'Hazards'}</span>
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: rowGap }}>
                  {visibleHazards.map(h => {
                    const HIcon = h.Icon;
                    return (
                      <div key={h.id} style={{
                        display: 'flex', alignItems: 'center', gap: rowGapIn,
                        padding: rowPad, borderRadius: 10,
                        background: h.hatched
                          ? 'repeating-linear-gradient(45deg, rgba(0,0,0,0.5) 0 6px, rgba(49,46,129,0.4) 6px 12px)'
                          : `linear-gradient(90deg, ${h.color}28 0%, ${h.color}12 100%)`,
                        border: `1px solid ${h.color}55`,
                        borderLeft: `4px solid ${h.color}`,
                      }}>
                        <div style={{
                          width: iconBox, height: iconBox, borderRadius: compact ? 7 : 9, flexShrink: 0,
                          background: `linear-gradient(135deg, ${h.color}, ${h.color}cc)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: `0 2px 8px ${h.color}55`,
                        }}>
                          {h.customIcon === 'hail' ? <HailIcon size={customSz} color="#fff" /> :
                           h.customIcon === 'flood' ? <FloodHouseIcon size={customSz} color="#fff" /> :
                           HIcon ? <HIcon style={{ width: iconSize, height: iconSize, color: '#fff' }} strokeWidth={2.4} /> : null}
                        </div>
                        <span style={{
                          fontSize: labelSz, fontWeight: 800, color: '#fff', lineHeight: 1.15,
                          letterSpacing: '0.04em', textTransform: 'uppercase',
                        }}>{h.label}</span>
                        {/* Percentage chance of this hazard occurring. Only
                            rendered when the forecaster has set one. */}
                        {hazardPct[h.id] != null && (
                          <span style={{
                            marginLeft: 'auto', flexShrink: 0,
                            display: 'inline-flex', alignItems: 'baseline', gap: 1,
                            padding: compact ? '1px 6px' : '2px 7px', borderRadius: 999,
                            background: `${h.color}26`, border: `1px solid ${h.color}80`,
                          }}>
                            <span style={{
                              fontSize: compact ? 11 : 12.5, fontWeight: 800, color: '#fff',
                              lineHeight: 1, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
                            }}>{hazardPct[h.id]}</span>
                            <span style={{
                              fontSize: compact ? 7.5 : 8.5, fontWeight: 800,
                              color: 'rgba(255,255,255,0.75)',
                            }}>%</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Lightning verification stats card — shown on the graphic itself
                (and in exports) only while the lightning overlay is active.
                Mirrors the count + peak-hour readout from the control panel. */}
            {showLightning && (
              <div style={{ ...glass({ padding: '8px 10px', borderRadius: 12, alignSelf: 'flex-start', width: 150 }, exportMode) }}>
                <GlassSheen />
                <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid rgba(255,255,255,0.10)', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.18em', color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase' }}>
                  <Zap style={{ width: 10, height: 10, color: '#facc15' }} fill="#facc15" strokeWidth={2.2} /> Lightning
                </span>
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 19, fontWeight: 800, color: '#fde68a', lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                      {lightningStats.count.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(148,163,184,0.95)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                      {lightningWindow
                        ? `Strikes · Last ${windowMinutes >= 60 ? (windowMinutes % 60 ? `${Math.floor(windowMinutes/60)}h ${windowMinutes%60}m` : `${Math.floor(windowMinutes/60)}h`) : `${windowMinutes}m`}`
                        : 'Strikes Today'}
                    </span>
                  </div>
                  {lightningStats.count > 0 && lightningStats.peakHour != null && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: '-0.01em' }}>
                        {fmtHour(lightningStats.peakHour)}–{fmtHour((lightningStats.peakHour + 1) % 24)}
                      </span>
                      <span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(148,163,184,0.95)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                        Peak{tzAbbr ? ` · ${tzAbbr}` : ''} · {lightningStats.peakCount.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Forecast discussion card — forecaster narrative, left column.
                Display-only; inherits the header's pointer-events:none. Width
                matches the other cards so it clears the centred map, and the
                body is line-clamped so a long discussion can't run under the
                footer or off the bottom of the graphic. */}
            {!isRadar && discussionEnabled && discussionText.trim() && (
              <div style={{ ...glass({ padding: '11px 13px', borderRadius: 14, alignSelf: 'flex-start', width: 220 }, exportMode) }}>
                <GlassSheen />
                <span style={{
                  position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, paddingBottom: 7,
                  borderBottom: '1px solid rgba(255,255,255,0.10)',
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.20em',
                  color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase',
                }}>
                  <FileText style={{ width: 12, height: 12, color: '#93c5fd' }} strokeWidth={2.2} /> Discussion
                </span>
                <p style={{
                  position: 'relative', zIndex: 1, margin: 0,
                  fontSize: 11, fontWeight: 500, lineHeight: 1.5,
                  color: 'rgba(226,232,240,0.95)', whiteSpace: 'pre-wrap',
                  display: '-webkit-box', WebkitLineClamp: 9, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{discussionText.trim()}</p>
              </div>
            )}
          </div>
          </div>{/* /header auto-fit scaler */}
          </div>{/* /header bottom-anchored wrapper */}

          {/* -- MAP + VECTOR DRAWING -- */}
          <div
            ref={mapWrapRef}
            onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp}
            onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp}
            style={{
              position: 'absolute', top: 20, left: '50%', marginLeft: -130, width: 450, height: 666,
              // region views stop at the top of the footer band; a clip, not a resize, so the land map
              // (aspect-fit) and the risk areas (stretched to the box) keep registering exactly
              clipPath: (!isRadar && outlookRegion !== 'uk') ? 'inset(0 0 36px 0 round 12px)' : undefined,
              zIndex: 3,
              cursor: mapTool === 'text' ? 'text' : mapTool === 'arrow' ? 'crosshair' : mapTool === 'cond' ? 'pointer' : (drawMode ? 'crosshair' : 'default'),
              userSelect: 'none',
              touchAction: (surfaceActive && (drawMode || mapTool === 'arrow')) ? 'none' : 'auto',
              borderRadius: 12, overflow: 'hidden',
            }}
          >
           <div style={{
             position: 'absolute', inset: 0,
             transform: outlookZoom.transform, transformOrigin: '0 0',
             transition: 'transform 0.25s ease',
           }}>
            {!isRadar && <NeighbourLayer regionId={outlookRegion} />}
            <UKOutlineMap region={activeRegionBox} mask={regionMask} />
            <CountyLinesLayer opacity={0.5} region={activeRegionBox} mask={regionMask} />
            {isRadar && <UKRadarLayer opacity={0.88} projectPt={projectPt} viewW={VIEW_W} viewH={VIEW_H} bbox={(UK_REGIONS.find(r => r.id === radarRegion) || UK_REGIONS[0]).bbox} />}
            {isRadar && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 3px)' }} />}
            {showShapes && (
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3, overflow: 'visible' }}>
                <defs>
                  {/* Severe hatch — diagonal lines only, transparent background so
                      underlying shapes/map are NOT obscured. */}
                  <pattern id="severeHatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="10" stroke="#312e81" strokeWidth="4" strokeOpacity="0.85" />
                  </pattern>
                </defs>
                {shapes.map((s, i) => {
                  const m = LEVEL_LOOKUP[s.riskLevel] || activeMeta;
                  const severe = isSevereId(s.riskLevel);
                  const condSevere = isCondSevereId(s.riskLevel);
                  const areaCond = !!s.cond && !severe && !condSevere;
                  const condColor = areaCond ? darkenColor(m.border, 0.4) : null;
                  const pathD = shapePaths[i];
                  return (
                    <g key={i} opacity={animOpacityFor(s)}>
                      {condSevere && <path d={pathD} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="12 9" />}
                      {severe && <path d={pathD} fill="url(#severeHatch)" stroke="none" />}
                      <path d={pathD}
                        fill={severe ? 'none' : m.fill}
                        stroke={areaCond ? condColor : darkenColor(m.border, 0.2)}
                        strokeWidth={severe ? 6 : condSevere ? 5.5 : areaCond ? 5 : 4}
                        strokeLinejoin="round" strokeLinecap="round"
                        strokeDasharray={condSevere ? '12 9' : areaCond ? '13 8' : 'none'} />
                    </g>
                  );
                })}
                {currentPath.length > 1 && (
                  <path d={pointsToPath(currentPath)}
                    fill={activeMeta.fill} stroke={activeMeta.border}
                    strokeWidth={3} strokeDasharray="6 4"
                    strokeLinejoin="round" strokeLinecap="round" opacity={0.85}
                  />
                )}
              </svg>
            )}
            {!isRadar && <UKVRainLayer enabled={showUKVRain} validDate={validDate} timelineGran={timelineGran} playhead={playhead} region={activeRegionBox} />}
            {showCities && <CityMarkersLayer region={activeRegionBox} k={outlookZoom.k} mask={regionMask} />}
            {showLightning && strikes && <LightningLayer strikes={strikes} color={lightningColor} outline={lightningOutline} outlineColor={lightningOutlineColor} />}
            {/* County outlines drawn ON TOP of the lightning dots so the borders stay visible over the strike overlay. */}
            {showLightning && <CountyLinesLayer opacity={0.8} region={activeRegionBox} zIndex={5.5} strokeWidth={1.1} mask={regionMask} />}
            {showShapes && showLightning && shapes.length > 0 && (
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }}>
                {shapes.map((s, i) => {
                  const m = LEVEL_LOOKUP[s.riskLevel] || activeMeta, severe = isSevereId(s.riskLevel), condSevere = isCondSevereId(s.riskLevel), areaCond = !!s.cond && !severe && !condSevere;
                  return <path key={i} d={pointsToPath(s.points)} fill="none" stroke={areaCond ? darkenColor(m.border, 0.3) : darkenColor(m.border, 0.2)} strokeWidth={severe ? 9 : condSevere ? 8 : areaCond ? 7.5 : 6} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={condSevere ? '14 10' : areaCond ? '15 9' : 'none'} opacity={Math.min(1, drawOpacity + 0.15)} />;
                })}
              </svg>
            )}

            {/* -- STORM-MOTION ARROWS -- */}
            {(arrows.length > 0 || arrowDraft) && (
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 7, overflow: 'visible' }}>
                <defs>
                  {[...arrows, ...(arrowDraft ? [{ id: 'draft', color: arrowColor }] : [])].map(a => (
                    <marker key={`mk-${a.id}`} id={`arrowhead-${a.id}`} markerWidth="9" markerHeight="9"
                      refX="6" refY="4.5" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L9,4.5 L0,9 L2.6,4.5 Z" fill={a.color} stroke="rgba(0,0,0,0.45)" strokeWidth="0.5" />
                    </marker>
                  ))}
                </defs>
                {arrows.map(a => {
                  const x1 = a.x1 * 1000, y1 = a.y1 * 1000, x2 = a.x2 * 1000, y2 = a.y2 * 1000;
                  // gentle curve: control point offset perpendicular to the line
                  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
                  const cx = mx - (dy / len) * len * 0.12, cy = my + (dx / len) * len * 0.12;
                  const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
                  return (
                    <g key={a.id}>
                      <path d={d} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={9} strokeLinecap="round" />
                      <path d={d} fill="none" stroke={a.color} strokeWidth={5} strokeLinecap="round"
                        markerEnd={`url(#arrowhead-${a.id})`} />
                    </g>
                  );
                })}
                {arrowDraft && (() => {
                  const { x1, y1, x2, y2 } = arrowDraft;
                  const d = `M ${x1 * 1000} ${y1 * 1000} L ${x2 * 1000} ${y2 * 1000}`;
                  return <path d={d} fill="none" stroke={arrowColor} strokeWidth={5} strokeLinecap="round"
                    strokeDasharray="10 8" opacity={0.85} markerEnd="url(#arrowhead-draft)" />;
                })()}
              </svg>
            )}

            {/* -- ON-MAP TEXT ANNOTATIONS -- */}
            {annotations.length > 0 && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 8, pointerEvents: 'none' }}>
                {/* leader lines first, under the labels */}
                {annotations.some(a => a.leader) && (
                  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
                    {annotations.filter(a => a.leader).map(a => (
                      <g key={`ld-${a.id}`}>
                        <line x1={a.x * 1000} y1={a.y * 1000} x2={a.lx * 1000} y2={a.ly * 1000}
                          stroke="rgba(0,0,0,0.55)" strokeWidth={4} strokeLinecap="round" />
                        <line x1={a.x * 1000} y1={a.y * 1000} x2={a.lx * 1000} y2={a.ly * 1000}
                          stroke={a.color} strokeWidth={2} strokeLinecap="round" />
                        <circle cx={a.lx * 1000} cy={a.ly * 1000} r={5} fill={a.color} stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} />
                      </g>
                    ))}
                  </svg>
                )}
                {annotations.map(a => {
                  const px = ANNOTATION_SIZE_PX[a.size] || 17;
                  const dark = a.color === '#111827' || a.color === '#ffffff';
                  return (
                    <div key={a.id}
                      onMouseDown={(e) => {
                        if (exportMode || outlookZoom.zoomed) return;
                        e.stopPropagation();
                        const wrap = mapWrapRef.current; if (!wrap) return;
                        const rect = wrap.getBoundingClientRect();
                        setEditingAnnId(a.id);
                        const onMove = (ev) => {
                          const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                          const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
                          updateAnnotation(a.id, { x: nx, y: ny });
                        };
                        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                      style={{
                        position: 'absolute', left: `${a.x * 100}%`, top: `${a.y * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: exportMode ? 'none' : 'auto',
                        cursor: (exportMode || outlookZoom.zoomed) ? 'default' : 'move',
                        fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
                        fontWeight: 900, fontSize: px, lineHeight: 1.05,
                        letterSpacing: '0.02em', textTransform: 'uppercase',
                        color: a.color, whiteSpace: 'pre-wrap', textAlign: 'center',
                        maxWidth: 220,
                        padding: a.pill ? '4px 9px' : 0,
                        borderRadius: a.pill ? 7 : 0,
                        background: a.pill ? 'rgba(8,12,24,0.74)' : 'transparent',
                        border: a.pill ? `1.5px solid ${a.color}` : 'none',
                        boxShadow: a.pill ? '0 2px 10px rgba(0,0,0,0.4)' : 'none',
                        textShadow: a.pill ? 'none'
                          : (dark ? '0 1px 3px rgba(0,0,0,0.9)' : '0 1px 2px rgba(0,0,0,0.85)'),
                        WebkitTextStroke: (!a.pill && !dark) ? '0.5px rgba(0,0,0,0.55)' : undefined,
                        outline: (!exportMode && editingAnnId === a.id) ? '2px dashed rgba(255,255,255,0.55)' : 'none',
                        outlineOffset: 3,
                      }}>
                      {a.text}
                    </div>
                  );
                })}
              </div>
            )}
           </div>{/* /zoom wrapper */}
          </div>

          {/* -- FOOTER -- */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 5,
            padding: '13px 18px 17px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            background: 'linear-gradient(0deg, rgba(8,12,24,0.96) 0%, rgba(8,12,24,0.80) 65%, rgba(8,12,24,0.30) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {siteLogoUrl
                ? <img src={siteLogoUrl} alt="MyWeatherUK"
                    style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.18)' }} />
                : <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: isRadar ? '#0ea5e9' : '#5b6ee8',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px solid rgba(255,255,255,0.18)',
                  }}><CloudLightning style={{ width: 16, height: 16, color: '#fff' }} /></div>}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.01em' }}>{handle}</span>
                <span style={{
                  fontSize: 8, fontWeight: 700, color: 'rgba(148,163,184,0.85)',
                  letterSpacing: '0.20em', textTransform: 'uppercase', marginTop: 1,
                }}>{version}</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginRight: 8 }}>
              {/* Footer caption is an OUTLOOK-only line. Radar gets its own
                  purpose-built status block below instead. */}
              {!isRadar && (
                <span style={{
                  fontSize: 10, fontWeight: 600, color: 'rgba(203,213,225,0.85)',
                  letterSpacing: '0.04em', lineHeight: 1.45, textAlign: 'right',
                }}>{footerText}</span>
              )}
              {!isRadar && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase',
                    background: forecastType === 'update' ? 'rgba(56,189,248,0.18)' : 'rgba(74,222,128,0.16)',
                    color: forecastType === 'update' ? 'rgba(186,230,253,0.95)' : 'rgba(187,247,208,0.95)',
                    border: `1px solid ${forecastType === 'update' ? 'rgba(56,189,248,0.40)' : 'rgba(74,222,128,0.38)'}` }}>{forecastLabel}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    background: 'rgba(148,163,184,0.14)', color: 'rgba(226,232,240,0.92)', border: '1px solid rgba(148,163,184,0.30)' }}>
                    Valid {new Date(validDate + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
                    background: 'rgba(91,110,232,0.18)', color: 'rgba(199,210,254,0.95)', border: '1px solid rgba(91,110,232,0.40)' }}>
                    Issued {new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', hour12: false })} {tzAbbr}</span>
                  {validUntil && (() => {
                    const vu = new Date(validUntil);
                    if (isNaN(vu.getTime())) return null;
                    const expired = vu.getTime() < Date.now();
                    return (
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase',
                        background: expired ? 'rgba(248,113,113,0.18)' : 'rgba(250,204,21,0.16)',
                        color: expired ? 'rgba(254,202,202,0.95)' : 'rgba(254,240,138,0.95)',
                        border: `1px solid ${expired ? 'rgba(248,113,113,0.45)' : 'rgba(250,204,21,0.4)'}` }}>
                        {expired ? 'Expired ' : 'Valid until '}
                        {vu.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} {tzAbbr}
                      </span>
                    );
                  })()}
                </div>
              )}
              {!isRadar && (
                <span style={{ fontSize: 7.5, fontWeight: 800, color: 'rgba(252,211,77,0.9)', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'right', lineHeight: 1.4, marginTop: 2 }}>
                  Not Official · Use for Guidance Only · Refer to Met Office Warnings
                </span>
              )}
            </div>

            {/* Radar status block — replaces the outlook's free-text caption
                with live, self-describing metadata: feed status, the region the
                imagery covers, capture time and per-feed attribution. */}
            {isRadar && (() => {
              const regionLabel = (UK_REGIONS.find(r => r.id === radarRegion) || UK_REGIONS[0]).label;
              const chip = (bg, bd, fg) => ({
                padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 800,
                background: bg, border: `1px solid ${bd}`, color: fg,
                letterSpacing: '0.10em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              });
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, marginRight: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{
                      ...chip('rgba(239,68,68,0.20)', 'rgba(248,113,113,0.55)', '#fecaca'),
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171', boxShadow: '0 0 6px #f87171' }} />
                      Live
                    </span>
                    <span style={chip('rgba(14,165,233,0.18)', 'rgba(14,165,233,0.45)', 'rgba(186,230,253,0.95)')}>{regionLabel}</span>
                    <span style={chip('rgba(148,163,184,0.14)', 'rgba(148,163,184,0.30)', 'rgba(226,232,240,0.92)')}>
                      Updated {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })} {tzAbbr}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,0.40)',
                    letterSpacing: '0.10em', textTransform: 'uppercase', textAlign: 'right', lineHeight: 1.5,
                  }}>Radar: Met Office · Lightning: Blitzortung</span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={labelCss}>{label}</span>
      {children}
    </div>
  );
}