/* StormOutlookGraphicTool — thunderstorm outlook graphic generator. */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStormLightning } from '@/components/tcm/stormOutlookHelpers';
import {
  Download, Eraser, Eye, EyeOff, Clock, Pen, MousePointer, Undo2, X, Zap,
  CloudLightning, Tornado, AlertTriangle, ShieldAlert, MapPin,
  CloudRain, CloudDrizzle, CloudRainWind, Radar, Save, FolderOpen, Check, Loader2, Circle, RefreshCw,
  Type, MoveUpRight, MousePointer2, Redo2, DownloadCloud, FileText, Map as MapIcon, Trash2, Wind, Target,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { toast } from 'sonner';
// The still-frame export goes through the browser's own renderer rather than
// html2canvas's re-implementation of it — see the JPG export below for why.
// (html2canvas is still used for the .webm frame grabs, where per-frame speed
// matters more than exactness and the panels are not the subject.)
import { toCanvas } from 'html-to-image';
import { glass, GlassSheen, GlassBackdropContext, captureBackdrop, GraphicFooter } from '@/components/studio/graphicGlass';
import { base44 } from '@/api/base44Client';
import { RISK_META, RISK_PALETTES, LEVEL_RANGE } from '@/components/tcm/riskConfig';
import TimelinePill from '@/components/tcm/StormOutlookTimelinePill';
import { RADAR_BANDS, UKRadarLayer } from '@/lib/ukRadar';
import { VIEW_W, VIEW_H, MAP_BBOX, projectPt, latLonToBox, useCounties, resolveView, viewZoom, CountyLand, TownLabels } from '@/components/studio/studioGeo';
import { GRANS, defaultTimeline, buildCells, cellLevels, markCells, shiftTimeline, savedTimeline, markedSpan, parseLocal, keyMs } from '@/components/studio/studioTimeline';
import { StudioLayout, Section, Btn, Seg, Field, Swatches, SavedList, Popover } from '@/components/studio/StudioUI';
import MapViewPicker from '@/components/studio/MapViewPicker';
import ModelOverlay from '@/components/studio/ModelOverlay';
import useHistory from '@/components/studio/useHistory';
import NovaImportPanel from '@/components/studio/NovaImportPanel';
import { useStudioUser, saveStudioGraphic, listStudioGraphics, deleteStudioGraphic } from '@/components/studio/studioSaves';
import { AreaTimingPanel, shadeColor, timedActive, shiftTiming, timingOrder, shadeByTiming, timingRings, isTimed } from '@/components/studio/areaTiming';

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
const GRAPHIC_W = 640, GRAPHIC_H = 760;
/* The drawing layers: the map box (450 x 666, 20 px from the top, centred 130 px left of the
   middle) grown by DRAW_PAD on every side, in the box's own 0..1000 units. Areas, arrows and labels
   are stored in the box's 0..1 space; this lets them lie outside the box, anywhere on the graphic. */
const DRAW_PAD = 700;
const DRAW_BOX = { position: 'absolute', top: 20 - DRAW_PAD, left: `calc(50% - ${130 + DRAW_PAD}px)`, width: 450 + 2 * DRAW_PAD, height: 666 + 2 * DRAW_PAD };
const DRAW_VB = `${(-DRAW_PAD / 450) * 1000} ${(-DRAW_PAD / 666) * 1000} ${((450 + 2 * DRAW_PAD) / 450) * 1000} ${((666 + 2 * DRAW_PAD) / 666) * 1000}`;
/* The graphic's own base colour, used behind the export so a JPEG's opaque
   corners match the frame rather than going black. */
const GRAPHIC_BG = '#06040f';
/* whole days from one 'YYYY-MM-DD' to another */
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);
/* NOVA's own word bands (TSTM 2% … HIGH 60%), for importing by them instead of the key's */
const NOVA_WORD_MIN = { 'Very Low': 0.02, Low: 0.05, Marginal: 0.15, Slight: 0.3, Moderate: 0.45, High: 0.6 };
/* the NOVA field behind each hazard on the card */
const NOVA_HAZARD_FIELDS = { lightning: 'p_lightning', hail: 'p_hail', flood: 'p_heavy_rain', tornado: 'p_tornado_env', wind: 'p_wind_damaging', severe: 'p_severe' };

const HAZARDS = [
  { id: 'lightning', label: 'High Lightning', Icon: CloudLightning, color: '#ec4899', hatched: false },
  { id: 'hail',      label: 'Large Hail',     Icon: null,           color: '#22d3ee', hatched: false, customIcon: 'hail' },
  { id: 'flood',     label: 'Flash Flooding', Icon: null,           color: '#3b82f6', hatched: false, customIcon: 'flood' },
  { id: 'tornado',   label: 'Tornado',        Icon: Tornado,        color: '#f97316', hatched: false }, { id: 'wind', label: 'Strong Winds', Icon: Wind, color: '#0ea5e9', hatched: false },
  { id: 'severe',    label: 'Severe',         Icon: AlertTriangle,  color: '#a5b4fc', hatched: true  },
];

// The panels' liquid glass, its export backdrop and the footer: studio/graphicGlass.

// --- Real thunderstorm photo background ---
const STORM_BG_URL = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/fd5fe1cb8_generated_image.png';

// --- Lightning overlay (Met Office strikes, via useStormLightning) ---
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
  // When `outline` is on we build a SECOND path of slightly larger discs in the
  // outline colour, laid under ALL the dots: where strikes overlap, every dot
  // still sits on top of every outline, and the one group opacity is applied to
  // the finished picture, so a cluster never shows darker seams or blends.
  const { fillD, outlineD } = useMemo(() => {
    if (!strikes || !strikes.length) return { fillD: '', outlineD: '' };
    const r = 1.6;
    const ro = r + 0.75; // outline disc radius — a thin rim round the fill dot
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
      <g opacity={0.92}>
        {outline && outlineD && <path d={outlineD} fill={outlineColor} />}
        <path d={fillD} fill={color} />
      </g>
    </svg>
  );
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

// --- Main component ---
/* `basic`: the public Graphic Studio's set (pages/GraphicStudio). Everything for drawing an outlook,
   without the admin's data tools (the TCM NOVA import, the UKV rain under the drawing, the
   lightning check, the live radar graphic, the WebM film) and without the version; saves go to
   the visitor's own account (studio/studioSaves) and the footer says where it was made. */
export default function StormOutlookGraphicTool({ myWeatherLogoUrl = '', basic = false }) {
  const me = useStudioUser(basic);
  const [siteLogoUrl, setSiteLogoUrl] = useState(myWeatherLogoUrl || null);
  useEffect(() => {
    if (!myWeatherLogoUrl) {
      base44.entities.SiteSettings.list().then(list => {
        const logo = list[0]?.logo_url;
        if (logo) setSiteLogoUrl(logo);
      }).catch(() => {});
    }
  }, [myWeatherLogoUrl]);

  /* the outlook day, in local time (toISOString gave yesterday's date before 01:00 in summer) */
  const [validDate, setValidDate]       = useState(() => new Date().toLocaleDateString('en-CA'));
  const [validDate2, setValidDate2]     = useState(''); // optional second outlook day
  const [activeRisk, setActiveRisk]     = useState('Slight');
  const [hazards, setHazards]           = useState(['lightning', 'hail', 'flood']);
  // Optional per-hazard probability, keyed by hazard id -> 0..100. A hazard with
  // no entry simply renders without a percentage, so this stays fully optional.
  const [hazardPct, setHazardPct]       = useState({});
  /* The timeline: a window from one date and time to another, its cell size, and what is marked,
     kept by the hour (studio/studioTimeline). The cells and each cell's level derive from it. */
  const [timeline, setTimeline] = useState(() => defaultTimeline(new Date().toLocaleDateString('en-CA')));
  const SEV = useMemo(() => Object.fromEntries(GRAPHIC_LEVELS.map((l, i) => [l.id, i])), []);
  const timelineStamps = useMemo(() => buildCells(timeline), [timeline]);
  const stampRisks = useMemo(() => cellLevels(timelineStamps, timeline.risk, SEV), [timelineStamps, timeline.risk, SEV]);
  const stampOverlays = useMemo(() => cellLevels(timelineStamps, timeline.over, SEV), [timelineStamps, timeline.over, SEV]);
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
  const [exportMode, setExportMode]     = useState(false); // the JPG / WebM export is rendering
  const [backdrop, setBackdrop]         = useState(null);  // the blurred picture behind the glass, during a JPG export
  const glassMode = exportMode ? (backdrop ? 'backdrop' : true) : false;
  const [graphicMode, setGraphicMode]   = useState('outlook'); // 'outlook' | 'radar'
  const [lightningColor, setLightningColor]   = useState('#ffffff');
  const [lightningOutline, setLightningOutline] = useState(false);
  const [lightningOutlineColor, setLightningOutlineColor] = useState('#000000');
  const [lightningWindow, setLightningWindow] = useState(false);
  const [windowMinutes, setWindowMinutes]     = useState(180);
  const [savedGraphics, setSavedGraphics]     = useState([]);
  const [saving, setSaving]                   = useState(false);
  const [saveName, setSaveName]               = useState('');
  const [showLoadPanel, setShowLoadPanel]     = useState(false);
  const [loadingGraphics, setLoadingGraphics] = useState(false);
  const [saveSuccess, setSaveSuccess]         = useState(false);
  const [savedPop, setSavedPop]               = useState(false);   // the saved list, dropped from the toolbar
  /* the UKV rain under the drawing (studio/ModelOverlay): on/off, the timeline cell it shows
     (null: the first marked cell) and what it last said about itself */
  const [showModel, setShowModel] = useState(false);
  const [overlayCell, setOverlayCell] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [confidence, setConfidence] = useState(null);

  // --- Valid-until (expiry) shown in the footer alongside Issued ---
  const [validUntil, setValidUntil] = useState(''); // ISO 'YYYY-MM-DDTHH:mm' or ''

  // --- Forecast discussion card (free text, toggleable) ---
  const [discussionEnabled, setDiscussionEnabled] = useState(false);
  const [discussionText, setDiscussionText] = useState('');

  // --- Map view (studio/studioGeo): a preset id ('uk' = everything) or 'custom' with the
  // chosen county ids, and whether the land outside it stays on the map in grey ---
  const [outlookRegion, setOutlookRegion] = useState('uk');
  const [mapAreas, setMapAreas] = useState([]);
  const [mapContext, setMapContext] = useState(true);

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

  // --- TCM NOVA import panel (studio/NovaImportPanel) ---
  const [showNovaPanel, setShowNovaPanel] = useState(false);

  // --- Undo / redo (studio/useHistory): what the graphic is made of, a step per settled change ---
  const docSnap = useMemo(() => ({ shapes, annotations, arrows, timeline, hazards, hazardPct, validDate, outlookRegion, mapAreas, mapContext, confidence }),
    [shapes, annotations, arrows, timeline, hazards, hazardPct, validDate, outlookRegion, mapAreas, mapContext, confidence]);
  const history = useHistory(docSnap, (d) => {
    setShapes(d.shapes); setAnnotations(d.annotations); setArrows(d.arrows); setTimeline(d.timeline);
    setHazards(d.hazards); setHazardPct(d.hazardPct); setValidDate(d.validDate); setOutlookRegion(d.outlookRegion);
    setMapAreas(d.mapAreas); setMapContext(d.mapContext); setConfidence(d.confidence);
  });
  /* the area picked with the Select tool (an index into shapes), the one under a chip, and a drag */
  const [selectedShape, setSelectedShape] = useState(null);
  const [hoverShape, setHoverShape] = useState(null);
  const dragRef = useRef(null);

  // Capture current state as a serialisable object
  const captureState = () => ({
    tool: 'outlook', validDate, validDate2, activeRisk, hazards, hazardPct, timeline, footerText, handle, version,
    forecastType, updateNumber, overnightEnabled, overnightStart, overnightEnd,
    drawOpacity, shapes, showShapes, showCities, graphicMode, showModel,
    lightningColor, lightningOutline, lightningOutlineColor, lightningWindow, windowMinutes,
    confidence, validUntil, discussionEnabled, discussionText,
    outlookRegion, mapAreas, mapContext, annotations, arrows,
  });

  /* a name when none is typed: the outlook's days and when it was saved
     ("Thunderstorm Outlook · 22 Oct → 24 Oct · saved 23 Oct 17:52") */
  const autoTitle = (what = 'saved') => {
    const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const days = validDate2 && validDate2 !== validDate ? `${day(validDate)} → ${day(validDate2)}` : day(validDate);
    const at = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    return `Thunderstorm Outlook · ${days} · ${what} ${at}`;
  };

  // Save current state to database (`quick`: from the toolbar, named for it when no name is typed)
  const handleSaveToStudio = async (quick = false) => {
    const title = saveName.trim() || (quick ? autoTitle() : '');
    if (!title) return;
    if (basic && !me) { base44.auth.redirectToLogin(); return; }
    setSaving(true);
    try {
      await saveStudioGraphic({ basic, me, title, state: captureState() });
      if (savedPop || showLoadPanel) loadSaved();
      setSaveSuccess(true);
      setSaveName('');
      setTimeout(() => setSaveSuccess(false), 1500);
    } catch (e) {
      console.error('[Studio] save failed:', e);
      toast.error('The graphic could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  // Load saved graphics list
  const openLoadPanel = () => { setShowLoadPanel(true); loadSaved(); };
  const loadSaved = async () => {
    setLoadingGraphics(true);
    try {
      /* this tool's own: saved before graphics carried their tool (and not the scenario board's), or
         'outlook' (in the public studio only its own: the old Thunderstorm Studio drew another map) */
      setSavedGraphics(await listStudioGraphics({ basic, me, keep: (st) => (basic ? st.tool === 'outlook' : !st._scenarioTool && (!st.tool || st.tool === 'outlook')) }));
    } finally {
      setLoadingGraphics(false);
    }
  };
  const deleteSaved = async (g) => {
    try {
      await deleteStudioGraphic({ basic, id: g.id });
      setSavedGraphics((list) => list.filter((x) => x.id !== g.id));
    } catch (e) {
      console.error('[Studio] delete failed:', e);
      toast.error('The graphic could not be deleted.');
    }
  };

  // Restore state from a saved graphic
  const loadState = (g) => {
    const s = g.state;
    if (!s) return;
    if (s.validDate !== undefined) setValidDate(s.validDate);
    if (s.validDate2 !== undefined) setValidDate2(s.validDate2);
    if (s.activeRisk !== undefined) setActiveRisk(s.activeRisk);
    if (s.hazards !== undefined) setHazards(s.hazards);
    if (s.hazardPct !== undefined) setHazardPct(s.hazardPct || {});
    setTimeline(savedTimeline(s, new Date().toLocaleDateString('en-CA'), SEV));
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
    if (s.showCities !== undefined) setShowCities(s.showCities);
    setShowModel(!!(s.showModel ?? s.showUKVRain));
    if (s.graphicMode !== undefined) setGraphicMode(s.graphicMode);
    if (s.lightningColor !== undefined) setLightningColor(s.lightningColor);
    if (s.lightningOutline !== undefined) setLightningOutline(s.lightningOutline);
    if (s.lightningOutlineColor !== undefined) setLightningOutlineColor(s.lightningOutlineColor);
    if (s.lightningWindow !== undefined) setLightningWindow(s.lightningWindow);
    if (s.windowMinutes !== undefined) setWindowMinutes(s.windowMinutes);
    if (s.confidence !== undefined) setConfidence(s.confidence);
    if (s.validUntil !== undefined) setValidUntil(s.validUntil);
    if (s.discussionEnabled !== undefined) setDiscussionEnabled(s.discussionEnabled);
    if (s.discussionText !== undefined) setDiscussionText(s.discussionText);
    setOutlookRegion(s.outlookRegion || 'uk');
    setMapAreas(Array.isArray(s.mapAreas) ? s.mapAreas : []);
    setMapContext(s.mapContext !== false);
    if (s.annotations !== undefined) setAnnotations(s.annotations);
    if (s.arrows !== undefined) setArrows(s.arrows);
    setShowLoadPanel(false);
  };

  const isRadar = graphicMode === 'radar';
  const usesSevere = shapes.some((sh) => isSevereId(sh.riskLevel) || isCondSevereId(sh.riskLevel) || sh.cond);
  /* the key lists the severe tiers only once something uses them; the level picker always offers them */
  const usesSevereAny = usesSevere || stampOverlays.some(Boolean);
  const levels = isRadar ? RADAR_LEVELS : GRAPHIC_LEVELS.filter((l) => usesSevereAny || !(isSevereId(l.id) || isCondSevereId(l.id)));
  const pickLevels = isRadar ? RADAR_LEVELS : GRAPHIC_LEVELS;
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
    if (!anyStamps && !isTimed(s)) return drawOpacity;
    const N = timelineStamps.length;
    let f = playhead;
    if (f >= N) f = N - 0.0001; if (f < 0) f = 0;
    const i0 = Math.floor(f), i1 = Math.min(N - 1, i0 + 1), frac = f - i0;
    const band = 0.15, tn = Math.max(0, Math.min(1, (frac - (0.5 - band)) / (2 * band))), ease = tn * tn * (3 - 2 * tn);
    /* a timed area shows during its own hours; the rest follow the level marked on each stamp */
    const tol = (timelineStamps[1] ? timelineStamps[1].ms - timelineStamps[0].ms : 3600e3) / 2 - 1;
    const activeAt = (idx) => {
      if (idx < 0 || idx >= N) return 0;
      const timed = timedActive(s, timelineStamps[idx].ms, tol);
      if (timed != null) return timed ? 1 : 0;
      if (isSevereId(s.riskLevel) || isCondSevereId(s.riskLevel)) return stampOverlays[idx] === s.riskLevel ? 1 : 0;
      const st = stampRisks[idx];
      return st && SEV[st] >= SEV[s.riskLevel] ? 1 : 0;
    };
    return Math.max(0, Math.min(1, activeAt(i0) + (activeAt(i1) - activeAt(i0)) * ease)) * drawOpacity;
  };

  const shapePaths = useMemo(() => shapes.map((s) => pointsToPath(s.points)), [shapes]);

  const handleExportVideo = async () => {
    if (!graphicRef.current) return;
    if (!anyStamps && !shapes.some(isTimed)) { window.alert('Mark some timeline hours with a risk level, or give areas their hours, first — the animation reveals the areas that match each hour.'); return; }
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
      // Full teardown (the redraw timer and the Met Office poll) — clearing the
      // flag alone used to leave the stream open in the background.
      stopLightning();
      setActiveRisk('ModRain');
      setHazards(['heavyrain', 'showers', 'thunder', 'heavyshowers']);
      // The radar keeps the map view; the drawing tools and the NOVA import are outlook-only.
      setMapTool('draw');
      setShowNovaPanel(false);
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
    /* Anywhere on the graphic, not only over the map's box: the point is in the box's 0..1 space
       and may lie outside it, out to the graphic's edges. */
    const g = graphicRef.current?.getBoundingClientRect() || rect;
    let x = (Math.max(g.left, Math.min(g.right, src.clientX)) - rect.left) / rect.width;
    let y = (Math.max(g.top, Math.min(g.bottom, src.clientY)) - rect.top) / rect.height;
    // When zoomed into a region the map layer is CSS-transformed (translate +
    // scale about origin 0,0). The drawn shapes render INSIDE that zoomed layer,
    // so we must invert the zoom here or the shape lands double-transformed.
    // Inverse of  visible = 0.5 + (norm - centre)*k  ⇒  norm = centre + (visible-0.5)/k.
    const z = outlookZoomRef.current;
    if (z && z.zoomed) {
      x = z.cx + (x - 0.5) / z.k;
      y = z.cy + (y - 0.5) / z.k;
    }
    return [x, y];
  };

  // Whether the map surface should currently capture pointer drawing. Text-drop
  // is a click (handled separately); arrow is a drag; draw is a freehand drag.
  const surfaceActive = mapTool === 'draw' || mapTool === 'arrow' || mapTool === 'select';

  /* the topmost drawn area under a point (tested against the smoothed outline that is drawn) */
  const hitShape = (pt, plainOnly = false) => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const sh = shapes[i];
      if (plainOnly && (isSevereId(sh.riskLevel) || isCondSevereId(sh.riskLevel))) continue;
      if (pointInPolygon(pt, smoothPoints(sh.points))) return i;
    }
    return -1;
  };

  const handleDown = (e) => {
    // Region zoom is inverted in eventToNormPoint, so drawing/placement works at
    // any zoom level — no lock required.
    // AREA CONDITIONAL tool: click inside a drawn area to toggle a conditional
    // flag on THAT area (click again to remove). Tests against the smoothed
    // outline so the hit region matches what's rendered. Picks the topmost
    // (last-drawn) matching area. Special tiers can't take a per-area flag.
    // SELECT tool: click an area to pick it (the panel and toolbar then edit it); drag to move it.
    if (mapTool === 'select') {
      const pt = eventToNormPoint(e);
      if (!pt) return;
      e.preventDefault();
      const hit = hitShape(pt);
      setSelectedShape(hit >= 0 ? hit : null);
      if (hit >= 0) { dragRef.current = { idx: hit, last: pt }; isPointerDown.current = true; }
      return;
    }
    if (mapTool === 'cond') {
      const pt = eventToNormPoint(e);
      if (!pt) return;
      e.preventDefault();
      const hitIdx = hitShape(pt, true);
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
    if (mapTool === 'select' && dragRef.current) {
      e.preventDefault();
      const pt = eventToNormPoint(e);
      if (!pt) return;
      const { idx, last } = dragRef.current;
      const dx = pt[0] - last[0], dy = pt[1] - last[1];
      dragRef.current.last = pt;
      setShapes((prev) => prev.map((sh, j) => (j === idx ? { ...sh, points: sh.points.map(([x, y]) => [x + dx, y + dy]) } : sh)));
      return;
    }
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
    if (mapTool === 'select') { dragRef.current = null; return; }
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

  // --- The selected area -----------------------------------------------------------
  const sel = selectedShape != null && selectedShape < shapes.length ? selectedShape : null;
  const patchSelected = (patch) => setShapes((prev) => prev.map((sh, j) => (j === sel ? { ...sh, ...patch } : sh)));
  const deleteSelected = () => { if (sel == null) return; setShapes((prev) => prev.filter((_, j) => j !== sel)); setSelectedShape(null); };
  const orderSelected = (front) => {
    if (sel == null) return;
    setShapes((prev) => { const sh = prev[sel], rest = prev.filter((_, j) => j !== sel); return front ? [...rest, sh] : [sh, ...rest]; });
    setSelectedShape(front ? shapes.length - 1 : 0);
  };
  const duplicateSelected = () => {
    if (sel == null) return;
    setShapes((prev) => [...prev, { ...prev[sel], points: prev[sel].points.map(([x, y]) => [x + 0.02, y + 0.02]) }]);
    setSelectedShape(shapes.length);
  };
  /* "Pick on the timeline" for the selected area (studio/areaTiming): the next stamp clicked is
     its first hour, the one after that its last */
  const [timingPick, setTimingPick] = useState(false);
  const [timingAnchor, setTimingAnchor] = useState(null);
  useEffect(() => { setTimingPick(false); setTimingAnchor(null); }, [selectedShape]);
  const strokeOf = (s) => {
    if (s.stroke != null) return shadeColor(s.stroke);
    const m = LEVEL_LOOKUP[s.riskLevel] || GRAPHIC_LEVELS[0];
    return s.cond && !isSevereId(s.riskLevel) && !isCondSevereId(s.riskLevel) ? darkenColor(m.border, 0.4) : darkenColor(m.border, 0.2);
  };
  const order = useMemo(() => timingOrder(shapes), [shapes]);
  /* Delete removes the selected area, Esc lets it go (not while typing in a box) */
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key === 'Escape') setSelectedShape(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape != null) {
        e.preventDefault();
        setShapes((prev) => prev.filter((_, j) => j !== selectedShape));
        setSelectedShape(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedShape]);

  // --- TCM NOVA -----------------------------------------------------------------
  // The newest Main Run, imported by studio/NovaImportPanel: risk areas (lat/lon rings into the
  // drawing space), a timeline already moved to the imported day, and hazard chances (%) by
  // hazard id. A hazard NOVA gives 10% or more is ticked as well. Areas split by time come with
  // their hours, and get outline shades from white (first) to grey (last).
  const applyNova = ({ mode, day, day2, areas, timeline: tl, hazards: hz }) => {
    const n = day && day !== validDate ? dayDiff(validDate, day) : 0;
    if (n) {
      setValidDate(day);
      if (!tl) setTimeline((t) => shiftTimeline(t, n));
    }
    if (day2 !== undefined) setValidDate2(day2);   // chosen dates and times: the outlook's days are theirs
    if (tl) setTimeline(tl);
    if (areas) {
      const mapped = areas.map(({ riskLevel, ring, from, to }) => ({ riskLevel, points: ring.map(([lat, lon]) => latLonToBox(lat, lon)), ...(from ? { from, to } : {}) }))
        .filter((s) => s.points.length >= 3);
      setShapes((prev) => {
        const next = mode === 'append' ? [...prev.map((s) => shiftTiming(s, n)), ...mapped] : mapped;
        return Math.max(0, ...timingOrder(mapped)) > 1 ? shadeByTiming(next) : next;
      });
    } else if (n) setShapes((prev) => prev.map((s) => shiftTiming(s, n)));
    if (hz) {
      setHazardPct((p) => {
        const next = { ...p };
        for (const [id, v] of Object.entries(hz)) { if (v >= 1) next[id] = v; else delete next[id]; }
        return next;
      });
      setHazards((h) => [...new Set([...h, ...Object.entries(hz).filter(([, v]) => v >= 10).map(([id]) => id)])]);
    }
  };
  /* moving the outlook day carries the timeline window (and its marks) with it */
  const changeDay = (d) => {
    if (!d) return;
    const n = dayDiff(validDate, d);
    setValidDate(d);
    if (n) { setTimeline((t) => shiftTimeline(t, n)); setShapes((prev) => prev.map((s) => shiftTiming(s, n))); }
  };

  // Severe & Conditional Severe are OVERLAY tiers: stamping one of them onto a
  // cell does NOT replace the base risk underneath (e.g. a 2-cell High stays
  // High) — it toggles a separate overlay layer drawn on top. All other tiers
  // set the base risk as before.
  //
  // Range mode: the first click sets an anchor; the second click fills every
  // cell between the two (inclusive) with the active risk/overlay. Clicking the
  // same cell twice just falls back to a single toggle.
  const layerOf = (id) => (isSevereId(id) || isCondSevereId(id) ? 'over' : 'risk');
  const applyStampRange = (start, end) => {
    const k = layerOf(activeRisk);
    setTimeline((t) => ({ ...t, [k]: markCells(t[k], timelineStamps, start, end, activeRisk, SEV) }));
  };

  const toggleSingleStamp = (i) => {
    const k = layerOf(activeRisk);
    const cur = (k === 'over' ? stampOverlays : stampRisks)[i];
    setTimeline((t) => ({ ...t, [k]: markCells(t[k], timelineStamps, i, i, cur === activeRisk ? null : activeRisk, SEV) }));
  };
  const clearTimeline = () => setTimeline((t) => ({ ...t, risk: {}, over: {} }));
  const setWindow = (patch) => setTimeline((t) => ({ ...t, ...patch }));

  const cycleStamp = (i) => {
    if (timingPick && sel != null) {
      if (timingAnchor == null) { setTimingAnchor(i); patchSelected({ from: timelineStamps[i].at, to: timelineStamps[i].at }); return; }
      patchSelected({ from: timelineStamps[Math.min(i, timingAnchor)].at, to: timelineStamps[Math.max(i, timingAnchor)].at });
      setTimingAnchor(null); setTimingPick(false);
      return;
    }
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
      /* the glass: the graphic without it, blurred, laid in behind each panel (studio/graphicGlass) */
      try {
        setBackdrop(await captureBackdrop(node, { width: GRAPHIC_W, height: GRAPHIC_H, backgroundColor: GRAPHIC_BG }));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await waitForImages(node);
      } catch (err) {
        console.warn('[graphic export] no glass backdrop, flat panels instead:', err?.message || err);
      }

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

      /* in Admin, every download is kept in Saved graphics too, so a graphic that is posted can
         always be opened again and edited */
      if (!basic) {
        saveStudioGraphic({ basic, me, title: autoTitle('downloaded'), state: captureState() })
          .then(() => toast.success(`Exported at ${canvas.width}x${canvas.height}, and kept in Saved graphics`))
          .catch(() => toast.success(`Exported at ${canvas.width}x${canvas.height} (not kept in Saved graphics)`));
      } else toast.success(`Exported at ${canvas.width}x${canvas.height}`);
    } catch (err) {
      console.error('[graphic export]', err);
      toast.error('The graphic could not be exported — see the console for why.');
    } finally {
      setBackdrop(null);
      setExportMode(false);
      setIsExporting(false);
    }
  };

  const visibleHazards = hazardList.filter(h => hazards.includes(h.id));
  const activeMeta = LEVEL_LOOKUP[activeRisk] || levels[0];

  // --- Map view + zoom (studio/studioGeo) ----------------------------------------
  // The view is a set of counties; anything but the whole map zooms to fit them. The same
  // transform is applied to the map AND to the drawn areas, towns and labels so everything stays
  // registered, and eventToNormPoint inverts it so drawing works at any zoom.
  const counties = useCounties();
  const view = useMemo(() => resolveView(counties, outlookRegion, mapAreas), [counties, outlookRegion, mapAreas]);
  const regional = !!view && !view.whole;
  const outlookZoom = useMemo(() => viewZoom(view, { bottomInset: regional ? 36 : 0 }), [view, regional]);
  outlookZoomRef.current = outlookZoom;   // ref declared above eventToNormPoint
  /* the same zoom, for the graphic-wide drawing layers (in DRAW_VB's units) */
  const drawZoom = outlookZoom.zoomed
    ? `translate(${(1000 * (0.5 - outlookZoom.cx * outlookZoom.k)).toFixed(1)} ${(1000 * (0.5 - outlookZoom.cy * outlookZoom.k)).toFixed(1)}) scale(${outlookZoom.k.toFixed(3)})`
    : undefined;
  /* the lon/lat box on screen, for the radar and the UKV layer */
  const viewBox = regional ? view.box : null;

  /* How well the areas caught the lightning, for the card under the Lightning one. Of the strikes on
     the map (in a regional view, that region's), the share inside a risk area, at that area's own
     hours when it has them (give or take an hour); and of the risk areas, the share that saw a
     strike. The score is the harmonic mean of the two, so it is high only when the areas caught the
     strikes AND were not drawn where none fell. Severe and Conditional Severe are overlays on the
     risk areas, not areas of their own, so they are left out, and so is an area whose hours have
     not begun yet (tomorrow's, on a two-day outlook): it cannot have seen anything. */
  const lightningScore = useMemo(() => {
    if (!showLightning || isRadar || !strikes?.length) return null;
    const now = Date.now();
    const risk = shapes.filter((s) => s.points?.length >= 3 && !isSevereId(s.riskLevel) && !isCondSevereId(s.riskLevel));
    const areas = risk.filter((s) => !(isTimed(s) && keyMs(s.from) > now));
    if (!areas.length) return null;
    const boxes = areas.map((s) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of s.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return [x0, y0, x1, y1];
    });
    const seen = new Array(areas.length).fill(false);
    let total = 0, caught = 0;
    for (const st of strikes) {
      const lat = st.lat ?? st.la, lon = st.lon ?? st.lo;
      if (lat == null || lon == null) continue;
      if (viewBox && (lon < viewBox.lonMin || lon > viewBox.lonMax || lat < viewBox.latMin || lat > viewBox.latMax)) continue;
      total++;
      const p = latLonToBox(lat, lon);
      let hit = false;
      areas.forEach((s, i) => {
        const b = boxes[i];
        if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return;
        if (timedActive(s, st.t, 3600e3) === false || !pointInPolygon(p, s.points)) return;
        hit = true;
        seen[i] = true;
      });
      if (hit) caught++;
    }
    if (!total) return null;
    const pod = caught / total, areaHit = seen.filter(Boolean).length / areas.length;
    const score = pod + areaHit > 0 ? (2 * pod * areaHit) / (pod + areaHit) : 0;
    return { score: Math.round(score * 100), pod: Math.round(pod * 100), caught, total, areasHit: seen.filter(Boolean).length, areas: areas.length, later: risk.length - areas.length };
  }, [showLightning, isRadar, strikes, shapes, viewBox]);

  // --- Timeline: the span of what is marked, and the hour the UKV layer shows ------------
  const timelineValid = useMemo(() => markedSpan(timelineStamps, stampRisks, stampOverlays), [timelineStamps, stampRisks, stampOverlays]);
  const windowBad = (() => { const a = parseLocal(timeline.from), b = parseLocal(timeline.to); return !a || !b || b <= a; })();
  const firstMarked = stampRisks.findIndex(Boolean);
  const overlayIdx = playhead != null
    ? Math.min(timelineStamps.length - 1, Math.floor(playhead))
    : Math.min(timelineStamps.length - 1, overlayCell ?? Math.max(0, firstMarked));
  const overlayTime = timelineStamps[overlayIdx]?.ms;
  const MODEL_FIELD = useMemo(() => ({ v: 'precip_rate', scale: 1, bands: RADAR_BANDS.map((b) => ({ min: b.lo, color: b.color })) }), []);

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
  const HEADER_AVAIL_H = GRAPHIC_H - 14 - 54; // top inset + room for the logo in the corner
  /* The preview fills its column (up to 1.7x), re-measured whenever the column changes size,
     not only when the window does. */
  useEffect(() => {
    const el = scaleWrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      setScale(Math.min(1.7, (el.offsetWidth || GRAPHIC_W) / GRAPHIC_W));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

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

  /* ── the controls: titled glass sections beside the graphic (studio/StudioUI) ───────────── */
  const lightningPanel = showLightning && (
    <div className="sg-panel">
      <div className="sg-row">
        <span className="sg-status" style={{ '--c': liveStatus === 'connected' ? '#4ade80' : liveStatus === 'unavailable' ? '#f87171' : '#facc15' }} title="Met Office lightning, checked every minute">
          <i />{liveStatus === 'connected' ? 'Live feed' : liveStatus === 'unavailable' ? 'Live feed off' : 'Connecting…'}
        </span>
        <Btn sm icon={RefreshCw} disabled={loadingStrikes} onClick={refreshLightning} title="Re-pull today's strikes and merge any new ones">Refresh</Btn>
        <span className="sg-note"><b>{lightningStats.count.toLocaleString()}</b> UK &amp; Ireland strikes {lightningWindow ? 'in the window' : 'today'}
          {lightningStats.count > 0 && lightningStats.peakHour != null ? <> · peak <b>{fmtHour(lightningStats.peakHour)}–{fmtHour((lightningStats.peakHour + 1) % 24)} {tzAbbr}</b></> : ''}</span>
      </div>
      {lightningError && <p className="sg-note" style={{ color: 'var(--sg-amber)' }}>{lightningError}</p>}
      {lightningStats.count > 0 && (
        <p className="sg-note">{lightningScore
          ? <>Accuracy <b>{lightningScore.score}%</b>: {lightningScore.caught.toLocaleString()} of {lightningScore.total.toLocaleString()} strikes{viewBox ? ' in this view' : ''} fell in a risk area, and {lightningScore.areasHit} of {lightningScore.areas} areas saw lightning{lightningScore.later > 0 ? ` (${lightningScore.later} still to come are left out)` : ''}. The score is on the graphic, under the Lightning card.</>
          : 'Draw or import risk areas to score them against the strikes.'}</p>
      )}
      <div className="sg-row">
        <span className="sg-label" style={{ margin: 0 }}>Dots</span>
        <Swatches colors={LIGHTNING_SWATCHES} value={lightningColor} onChange={setLightningColor} custom />
        <Btn sm on={lightningOutline} icon={Circle} onClick={() => setLightningOutline((v) => !v)}>Outline</Btn>
        {lightningOutline && <input type="color" className="sg-color" value={lightningOutlineColor} onChange={(e) => setLightningOutlineColor(e.target.value)} title="Outline colour" />}
      </div>
      <div className="sg-row">
        <Btn sm on={lightningWindow} icon={Clock} onClick={() => setLightningWindow((v) => !v)}>Recent only</Btn>
        {lightningWindow && (
          <>
            <input type="range" className="sg-range" min={5} max={1440} step={5} value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value))} style={{ width: 110 }} />
            <span className="sg-note" style={{ fontFamily: 'ui-monospace, monospace' }}>{windowMinutes >= 60 ? `${Math.floor(windowMinutes / 60)}h${windowMinutes % 60 ? ` ${windowMinutes % 60}m` : ''}` : `${windowMinutes}m`}</span>
            {[['1h', 60], ['3h', 180], ['6h', 360], ['12h', 720], ['24h', 1440]].map(([l, m]) => <Btn key={m} sm on={windowMinutes === m} onClick={() => setWindowMinutes(m)}>{l}</Btn>)}
          </>
        )}
      </div>
    </div>
  );

  const controls = (
    <>
      <Section id="storm-graphic" icon={Zap} color="#eab308" title="Graphic"
        sub={isRadar ? 'Live Met Office radar' : `${outlookTitle} · ${forecastLabel}`}>
        {!basic && <Seg value={graphicMode} onChange={switchMode} color="#eab308" options={[['outlook', 'Outlook', Zap], ['radar', 'Radar', Radar]]} />}
        <div className="sg-grid2">
          <Field label="Outlook day"><input type="date" className="sg-input" value={validDate} onChange={(e) => changeDay(e.target.value)} /></Field>
          <Field label="Second day (optional)">
            <div className="sg-row" style={{ flexWrap: 'nowrap' }}>
              <input type="date" className="sg-input" value={validDate2} onChange={(e) => setValidDate2(e.target.value)} />
              {validDate2 && <Btn icon={X} onClick={() => setValidDate2('')} title="Remove the second day" />}
            </div>
          </Field>
        </div>
        {!isRadar && (
          <>
            <div>
              <span className="sg-label">Forecast issue</span>
              <div className="sg-row">
                <Seg value={forecastType} onChange={setForecastType} options={[['initial', 'Initial forecast'], ['update', 'Update']]} />
                {forecastType === 'update' && (
                  <span className="sg-row" style={{ gap: 4 }}>
                    <Btn sm onClick={() => setUpdateNumber((n) => Math.max(1, n - 1))} aria-label="Previous update number">−</Btn>
                    <b style={{ minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{updateNumber}</b>
                    <Btn sm onClick={() => setUpdateNumber((n) => Math.min(99, n + 1))} aria-label="Next update number">+</Btn>
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="sg-label">Forecast confidence</span>
              <div className="sg-row">
                {CONFIDENCE_LEVELS.map((c) => (
                  <Btn key={c.id} sm on={confidence === c.id} color={c.color} onClick={() => setConfidence(confidence === c.id ? null : c.id)}>
                    <span style={{ display: 'inline-flex', gap: 2 }}>
                      {Array.from({ length: CONFIDENCE_STEPS }, (_, i) => <span key={i} style={{ width: 3, height: 10, borderRadius: 1, background: i < c.bars ? c.color : 'var(--sg-border3)' }} />)}
                    </span>
                    {c.label}
                  </Btn>
                ))}
              </div>
            </div>
            <div className="sg-grid2">
              <Field label="Valid until (optional)">
                <div className="sg-row" style={{ flexWrap: 'nowrap' }}>
                  <input type="datetime-local" className="sg-input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  {validUntil && <Btn icon={X} onClick={() => setValidUntil('')} title="Clear the expiry" />}
                </div>
              </Field>
              <Field label="Footer caption"><input className="sg-input" value={footerText} onChange={(e) => setFooterText(e.target.value)} /></Field>
            </div>
          </>
        )}
        <div className="sg-grid2">
          <Field label="Handle"><input className="sg-input" value={handle} onChange={(e) => setHandle(e.target.value)} /></Field>
          {!basic && <Field label="Version"><input className="sg-input" value={version} onChange={(e) => setVersion(e.target.value)} /></Field>}
        </div>
      </Section>

      <Section id="storm-map" icon={MapIcon} color="#38bdf8" title="Map" sub={view?.label || 'UK & Ireland'}>
        <MapViewPicker region={outlookRegion} areas={mapAreas} context={mapContext}
          onChange={({ region, areas }) => { setOutlookRegion(region); setMapAreas(areas); }} onContext={setMapContext} />
        <div className="sg-row">
          <Btn on={showCities} icon={MapPin} onClick={() => setShowCities((v) => !v)}>Towns</Btn>
          {!isRadar && !basic && <Btn on={showModel} icon={CloudRain} onClick={() => setShowModel((v) => !v)}>UKV rain</Btn>}
          {!isRadar && !basic && <Btn on={showLightning} color={lightningColor === '#ffffff' ? '#facc15' : lightningColor} icon={loadingStrikes ? Loader2 : Zap} onClick={toggleLightning}>{loadingStrikes ? 'Loading strikes…' : 'Lightning'}</Btn>}
        </div>
        {showModel && !isRadar && (
          <div className="sg-panel">
            <div className="sg-row">
              <span className="sg-label" style={{ margin: 0 }}>Shows</span>
              <select className="sg-input" style={{ width: 'auto', flex: 1 }} value={overlayCell ?? ''} onChange={(e) => setOverlayCell(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">The first marked hour{firstMarked >= 0 ? ` (${timelineStamps[firstMarked].weekday} ${timelineStamps[firstMarked].label}:00)` : ''}</option>
                {timelineStamps.map((c, i) => <option key={c.ms} value={i}>{c.weekday} {c.label}:00</option>)}
              </select>
            </div>
            {modelStatus && <span className="sg-status" style={{ '--c': modelStatus.state === 'ok' ? '#4ade80' : modelStatus.state === 'error' || modelStatus.state === 'none' ? '#f87171' : '#facc15' }}><i />{modelStatus.text}</span>}
            <p className="sg-note">Met Office UKV 2 km rain rate from the AWS open data, in the radar key's colours. It follows the timeline while it plays.</p>
          </div>
        )}
        {!isRadar && lightningPanel}
      </Section>

      {!isRadar && (
        <Section id="storm-areas" icon={Pen} color="#a78bfa" title="Risk areas" sub={`${shapes.length} drawn · ${LEVEL_LOOKUP[activeRisk]?.short || activeRisk} selected`}>
          <div>
            <span className="sg-label">Level for areas and the timeline</span>
            <div className="sg-row">
              {pickLevels.map((r) => (
                <button key={r.id} type="button" className="sg-level" aria-pressed={activeRisk === r.id} style={{ '--c': r.id === COND_SEVERE_ID ? '#94a3b8' : r.color }} onClick={() => setActiveRisk(r.id)}>
                  <i />{r.short}<small>{r.range}</small>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="sg-label">On the map</span>
            <Seg value={mapTool} color="#a78bfa" onChange={(t) => { setMapTool(t); if (t === 'draw') setDrawMode(true); }}
              options={[['draw', 'Draw', Pen], ['select', 'Select', MousePointer2], ['text', 'Label', Type], ['arrow', 'Arrow', MoveUpRight], ['cond', 'Conditional', ShieldAlert]]} />
          </div>
          {mapTool === 'draw' && <p className="sg-note">Drag anywhere on the graphic to draw an area in the selected level. Areas can run off the map, under the cards or into the corners.</p>}
          {mapTool === 'select' && <p className="sg-note">Click an area on the graphic to select it, then change it below or drag it to move it. <b>Delete</b> removes it, <b>Esc</b> lets it go. Give areas live at different times their hours and an outline from white to grey: each gets a dashed ring in that shade on the timeline.</p>}
          {sel != null && (
            <div className="sg-panel" style={{ borderColor: 'color-mix(in srgb, #a78bfa 50%, transparent)' }}>
              <div className="sg-row" style={{ justifyContent: 'space-between' }}>
                <span className="sg-note"><b>Selected area</b> · {LEVEL_LOOKUP[shapes[sel].riskLevel]?.short || shapes[sel].riskLevel}{shapes[sel].cond ? ' · conditional' : ''}</span>
                <Btn sm icon={X} onClick={() => setSelectedShape(null)} aria-label="Let go of the area" />
              </div>
              <div className="sg-row">
                {pickLevels.map((r) => (
                  <button key={r.id} type="button" className="sg-level" aria-pressed={shapes[sel].riskLevel === r.id} style={{ '--c': r.id === COND_SEVERE_ID ? '#94a3b8' : r.color, minHeight: 28, padding: '0 9px' }}
                    onClick={() => patchSelected({ riskLevel: r.id, ...(layerOf(r.id) === 'over' ? { cond: false } : {}) })}><i />{r.short}</button>
                ))}
              </div>
              <AreaTimingPanel shape={shapes[sel]} cells={timelineStamps} levelColor={strokeOf({ ...shapes[sel], stroke: null })} onPatch={patchSelected}
                picking={timingPick} onPicking={(on) => { setTimingPick(on); setTimingAnchor(null); }} />
              <div className="sg-row">
                {!isSevereId(shapes[sel].riskLevel) && !isCondSevereId(shapes[sel].riskLevel) && <Btn sm on={!!shapes[sel].cond} color="#a78bfa" onClick={() => patchSelected({ cond: !shapes[sel].cond })}>Conditional</Btn>}
                <Btn sm onClick={() => orderSelected(true)}>To front</Btn>
                <Btn sm onClick={() => orderSelected(false)}>To back</Btn>
                <Btn sm onClick={duplicateSelected}>Duplicate</Btn>
                <Btn sm danger icon={Trash2} onClick={deleteSelected}>Delete</Btn>
              </div>
            </div>
          )}
          {mapTool === 'cond' && (
            <p className="sg-note">Click inside a drawn area to mark it <b>conditional</b> (a dashed, darker outline); click again to clear.
              {shapes.some((s) => s.cond) ? ` ${shapes.filter((s) => s.cond).length} conditional now.` : ''}</p>
          )}
          {mapTool === 'text' && (
            <div className="sg-panel">
              <input className="sg-input" value={annDraft} onChange={(e) => setAnnDraft(e.target.value)} placeholder="Type a label, then click the graphic to place it (e.g. MAIN THREAT 14–18Z)" />
              <div className="sg-row">
                <Swatches colors={ANNOTATION_COLORS} value={annColor} onChange={setAnnColor} />
                <Seg value={annSize} onChange={setAnnSize} options={ANNOTATION_SIZES.map((s) => [s.id, s.label])} />
                <Btn sm on={annPill} onClick={() => setAnnPill((v) => !v)}>Pill</Btn>
                <Btn sm on={annLeader} onClick={() => setAnnLeader((v) => !v)}>Leader line</Btn>
              </div>
              <p className="sg-note">Drag a placed label to move it.</p>
            </div>
          )}
          {mapTool === 'arrow' && (
            <div className="sg-panel">
              <div className="sg-row">
                <span className="sg-note">Drag on the graphic to draw a storm-motion arrow.</span>
                <Swatches colors={ANNOTATION_COLORS} value={arrowColor} onChange={setArrowColor} />
              </div>
              <div className="sg-row">
                <Btn sm danger icon={Eraser} disabled={!arrows.length} onClick={clearArrows}>Clear arrows</Btn>
              </div>
            </div>
          )}
          {annotations.length > 0 && (
            <div>
              <span className="sg-label">Labels ({annotations.length})</span>
              <div className="sg-list">
                {annotations.map((a) => (
                  <div key={a.id} className="sg-item" style={editingAnnId === a.id ? { borderColor: '#a78bfa' } : undefined}>
                    <span style={{ flex: '0 0 12px', height: 12, borderRadius: 3, background: a.color, border: '1px solid rgba(0,0,0,0.3)' }} />
                    <input className="sg-input" style={{ minHeight: 30, padding: '4px 8px' }} value={a.text} onChange={(e) => updateAnnotation(a.id, { text: e.target.value })} onFocus={() => setEditingAnnId(a.id)} />
                    <Btn sm on={a.leader} onClick={() => updateAnnotation(a.id, { leader: !a.leader })}>Leader</Btn>
                    <Btn sm on={a.pill} onClick={() => updateAnnotation(a.id, { pill: !a.pill })}>Pill</Btn>
                    <Btn sm danger icon={Trash2} onClick={() => removeAnnotation(a.id)} aria-label="Delete label" />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="sg-row">
            <Btn sm icon={Undo2} disabled={!history.canUndo} onClick={history.undo} title="Undo (Ctrl+Z)">Undo</Btn>
            <Btn sm icon={Redo2} disabled={!history.canRedo} onClick={history.redo} title="Redo (Ctrl+Y)">Redo</Btn>
            <Btn sm danger icon={Eraser} disabled={!shapes.length} onClick={clearShapes}>Clear areas</Btn>
            <Btn sm on={!showShapes} icon={showShapes ? Eye : EyeOff} onClick={() => setShowShapes((v) => !v)}>{showShapes ? 'Hide areas' : 'Areas hidden'}</Btn>
            {Math.max(0, ...order) > 1 && <Btn sm icon={Clock} onClick={() => setShapes(shadeByTiming)} title="Outline the timed areas from white (first) to grey (last)">Shade by time</Btn>}
            <label className="sg-row" style={{ gap: 6 }}>
              <span className="sg-note">Opacity</span>
              <input type="range" className="sg-range" min="20" max="100" step="5" value={Math.round(drawOpacity * 100)} onChange={(e) => setDrawOpacity(Number(e.target.value) / 100)} style={{ width: 80 }} />
              <span className="sg-note" style={{ minWidth: 30, fontFamily: 'ui-monospace, monospace' }}>{Math.round(drawOpacity * 100)}%</span>
            </label>
          </div>
          {shapes.length > 0 && (
            <div className="sg-row" style={{ gap: 5 }}>
              {shapes.map((s, i) => {
                const m = LEVEL_LOOKUP[s.riskLevel] || GRAPHIC_LEVELS[0];
                const canCond = !isSevereId(s.riskLevel) && !isCondSevereId(s.riskLevel);
                return (
                  <span key={i} className="sg-chipx" onMouseEnter={() => setHoverShape(i)} onMouseLeave={() => setHoverShape(null)}
                    style={{ '--c': s.riskLevel === COND_SEVERE_ID ? '#94a3b8' : m.color, borderStyle: s.cond ? 'dashed' : 'solid', ...(sel === i ? { boxShadow: '0 0 0 2px var(--sg-text)' } : {}) }}>
                    <button type="button" onClick={() => { setSelectedShape(i); setMapTool('select'); }} title={isTimed(s) ? `Select this area · ${order[i]}${['st', 'nd', 'rd'][order[i] - 1] || 'th'} by time` : 'Select this area (it is outlined on the graphic)'}>
                      {s.stroke != null && <span style={{ width: 9, height: 9, borderRadius: '50%', border: `2px solid ${shadeColor(s.stroke)}`, marginRight: 4, boxShadow: '0 0 0 1px rgba(0,0,0,0.45)' }} />}
                      {m.short}{order[i] ? <sup style={{ marginLeft: 2, fontSize: 9 }}>{order[i]}</sup> : null}
                    </button>
                    {canCond && <button type="button" onClick={() => setShapes((prev) => prev.map((sh, j) => (j === i ? { ...sh, cond: !sh.cond } : sh)))} title="Conditional" style={s.cond ? { background: 'rgba(0,0,0,0.3)', color: '#fff' } : undefined}>C</button>}
                    <button type="button" onClick={() => setShapes((prev) => prev.filter((_, j) => j !== i))} aria-label="Delete area"><X /></button>
                  </span>
                );
              })}
            </div>
          )}
          {!basic && <Btn on={showNovaPanel} color="#818cf8" icon={DownloadCloud} onClick={() => setShowNovaPanel((v) => !v)}>Import from TCM NOVA</Btn>}
          {showNovaPanel && !basic && (
            <NovaImportPanel view={view} timeline={timeline} validDate={validDate} hazardFields={NOVA_HAZARD_FIELDS} onImport={applyNova}
              levels={GRAPHIC_LEVELS.filter((l) => !isSevereId(l.id) && !isCondSevereId(l.id)).map((l) => ({ id: l.id, keyMin: (LEVEL_RANGE[l.id]?.[0] ?? 0) / 100, novaMin: NOVA_WORD_MIN[l.id] ?? 0 }))} />
          )}
        </Section>
      )}

      {!isRadar && (
        <Section id="storm-timeline" icon={Clock} color="#22c55e" title="Timeline" sub={timelineValid?.label || 'Nothing marked yet'}>
          <div className="sg-grid2">
            <Field label="From"><input type="datetime-local" className="sg-input" value={timeline.from} onChange={(e) => setWindow({ from: e.target.value })} /></Field>
            <Field label="To"><input type="datetime-local" className="sg-input" value={timeline.to} onChange={(e) => setWindow({ to: e.target.value })} /></Field>
          </div>
          {windowBad && <p className="sg-note" style={{ color: 'var(--sg-amber)' }}>The end is not after the start, so the timeline shows 24 hours from the start.</p>}
          <div className="sg-row">
            <Seg value={timeline.gran} onChange={(g) => setWindow({ gran: g })} color="#22c55e" options={GRANS} />
            <span className="sg-note">{timelineStamps.length} cells</span>
          </div>
          <div className="sg-row">
            <Btn sm on={timelineRangeMode} color="#a78bfa" icon={Clock} onClick={() => setTimelineRangeMode((v) => !v)}>Range fill</Btn>
            {timelineRangeMode && <span className="sg-note" style={{ color: '#a78bfa' }}>{rangeAnchor == null ? 'Click the first cell…' : 'Now click the last cell'}</span>}
            <span className="sg-grow" />
            <Btn sm danger icon={Eraser} disabled={!anyStamps} onClick={clearTimeline}>Clear marks</Btn>
          </div>
          <p className="sg-note">Click the hours on the graphic's timeline to mark them with the selected level ({LEVEL_LOOKUP[activeRisk]?.short}); click again to clear. Marks stay on their hours when you change the window or the cell size.</p>
          <div className="sg-row">
            <Btn sm on={overnightEnabled} color="#a78bfa" icon={Clock} onClick={() => setOvernightEnabled((v) => !v)}>Overnight period</Btn>
            {overnightEnabled && (
              <>
                <input type="time" className="sg-input" style={{ width: 110 }} value={overnightStart} onChange={(e) => setOvernightStart(e.target.value)} aria-label="Overnight from" />
                <span className="sg-note">to</span>
                <input type="time" className="sg-input" style={{ width: 110 }} value={overnightEnd} onChange={(e) => setOvernightEnd(e.target.value)} aria-label="Overnight to" />
                {overnightCrossesMidnight && <span className="sg-note">next day</span>}
              </>
            )}
          </div>
        </Section>
      )}

      <Section id="storm-hazards" icon={AlertTriangle} color="#f97316" title={isRadar ? 'Conditions' : 'Hazards'}
        sub={showLightning ? 'Off while lightning is shown' : `${visibleHazards.length} on the graphic`}>
        <div className="sg-row" style={{ opacity: showLightning ? 0.45 : 1, pointerEvents: showLightning ? 'none' : 'auto' }}>
          {hazardList.map((h) => {
            const on = hazards.includes(h.id);
            const HIcon = h.Icon;
            return (
              <span key={h.id} className="sg-row" style={{ gap: 0, flexWrap: 'nowrap' }}>
                <Btn sm on={on} color={h.color} onClick={() => toggleHazard(h.id)} style={on && !isRadar ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : undefined}>
                  {h.customIcon === 'hail' ? <HailIcon size={13} color="currentColor" /> : h.customIcon === 'flood' ? <FloodHouseIcon size={13} color="currentColor" /> : HIcon ? <HIcon /> : null}
                  {h.label}
                </Btn>
                {on && !isRadar && (
                  <input type="number" className="sg-input" min={0} max={100} step={5} placeholder="%" value={hazardPct[h.id] ?? ''} title={`${h.label}: chance (%), optional`}
                    style={{ width: 56, minHeight: 28, padding: '3px 6px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 0 }}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHazardPct((p) => {
                        const next = { ...p };
                        if (v === '') delete next[h.id]; else next[h.id] = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
                        return next;
                      });
                    }} />
                )}
              </span>
            );
          })}
        </div>
        {!isRadar && <p className="sg-note">A percentage is optional; left blank, the hazard shows without one.</p>}
      </Section>

      {!isRadar && (
        <Section id="storm-discussion" icon={FileText} color="#60a5fa" title="Discussion" sub={discussionEnabled && discussionText.trim() ? 'Shown on the graphic' : 'Not shown'} defaultOpen={false}>
          <Btn sm on={discussionEnabled} color="#22c55e" onClick={() => setDiscussionEnabled((v) => !v)}>{discussionEnabled ? 'Shown on the graphic' : 'Show on the graphic'}</Btn>
          <textarea className="sg-input" rows={4} value={discussionText} onChange={(e) => setDiscussionText(e.target.value)}
            placeholder="A short forecaster discussion (2–3 lines), e.g. Surface heating and a sharpening trough drive scattered storms from midday; the greatest hail and lightning risk is over central and eastern England." />
        </Section>
      )}

      <Section id="storm-export" icon={Download} color="#0ea5e9" title="Save & export">
        <div className="sg-row">
          <Btn primary color="#0ea5e9" icon={isExporting ? Loader2 : Download} disabled={isExporting} onClick={handleDownload}>{isExporting ? 'Exporting…' : 'Download JPG'}</Btn>
          {!isRadar && !basic && <Btn primary color="#7c3aed" icon={Download} disabled={isExporting} onClick={handleExportVideo} title="Render a WebM of the timeline sweep">Export WebM</Btn>}
        </div>
        {basic && !me && (
          <p className="sg-note">Log in to save your graphics to your account and open them again later. <button type="button" className="sg-link" onClick={() => base44.auth.redirectToLogin()}>Log in</button></p>
        )}
        <div className="sg-row" style={{ flexWrap: 'nowrap' }}>
          <input className="sg-input" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveToStudio()} placeholder="Name this graphic (e.g. Day 1 Slight Risk)" />
          <Btn on={saveSuccess} color="#22c55e" icon={saving ? Loader2 : saveSuccess ? Check : Save} disabled={saving || !saveName.trim()} onClick={() => handleSaveToStudio()}>{saveSuccess ? 'Saved' : 'Save'}</Btn>
        </div>
        {!basic && <p className="sg-note">Every JPG you download is kept here too.</p>}
        <Btn on={showLoadPanel} color="#fbbf24" icon={FolderOpen} onClick={() => (showLoadPanel ? setShowLoadPanel(false) : openLoadPanel())}>Saved graphics</Btn>
        {showLoadPanel && savedList(() => {})}
      </Section>
    </>
  );

  /* quick tools over the graphic, so drawing never needs the controls scrolled into view */
  const penOn = mapTool === 'draw' && drawMode;
  /* the saved graphics, newest first; `after` runs once one is opened */
  function savedList(after) {
    return <SavedList items={savedGraphics} loading={loadingGraphics} onOpen={(g) => { loadState(g); after(); }} onDelete={deleteSaved} />;
  }
  const toolbar = (
    <div className="sg-toolbar">
      {!isRadar && (
        <>
          <Btn sm on={penOn} color="#a78bfa" icon={penOn ? Pen : MousePointer} onClick={() => { if (mapTool !== 'draw') { setMapTool('draw'); setDrawMode(true); } else setDrawMode((d) => !d); }}>{penOn ? 'Drawing' : 'Draw'}</Btn>
          <span className="sg-row" style={{ gap: 3 }}>
            {pickLevels.filter((l) => !isCondSevereId(l.id)).map((r) => (
              <button key={r.id} type="button" title={sel != null ? `Make the selected area ${r.short}` : `${r.short} · ${r.range}`} aria-pressed={activeRisk === r.id}
                onClick={() => { setActiveRisk(r.id); if (sel != null) patchSelected({ riskLevel: r.id, ...(layerOf(r.id) === 'over' ? { cond: false } : {}) }); }}
                style={{ width: 22, height: 22, borderRadius: 7, cursor: 'pointer', padding: 0, background: isSevereId(r.id) ? 'repeating-linear-gradient(45deg, #312e81 0 3px, transparent 3px 6px)' : r.color,
                  border: activeRisk === r.id ? '2px solid var(--sg-text)' : '2px solid transparent', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }} />
            ))}
          </span>
          <Btn sm on={mapTool === 'select'} color="#a78bfa" icon={MousePointer2} onClick={() => setMapTool('select')} title="Select an area on the graphic">Select</Btn>
          {sel != null && <Btn sm danger icon={Trash2} onClick={deleteSelected} title="Delete the selected area" />}
          <span className="sg-sep" />
          <Btn sm on={isAnimating} color="#22c55e" disabled={isExporting} onClick={() => setIsAnimating((v) => !v)} title="Play the timeline hour by hour">{isAnimating ? '❚❚ Pause' : '▶ Play'}</Btn>
        </>
      )}
      <Btn sm icon={Undo2} disabled={!history.canUndo} onClick={history.undo} title="Undo (Ctrl+Z)" />
      <Btn sm icon={Redo2} disabled={!history.canRedo} onClick={history.redo} title="Redo (Ctrl+Y)" />
      <span className="sg-grow" />
      <Btn sm on={saveSuccess} color="#22c55e" icon={saving ? Loader2 : saveSuccess ? Check : Save} disabled={saving} onClick={() => handleSaveToStudio(true)}
        title={saveName.trim() ? `Save as "${saveName.trim()}"` : 'Save this graphic (named for its days, or type a name under Save & export)'}>{saveSuccess ? 'Saved' : 'Save'}</Btn>
      <Btn sm on={savedPop} color="#fbbf24" icon={FolderOpen} data-pop-toggle onClick={() => { if (!savedPop) loadSaved(); setSavedPop((v) => !v); }} title="Open a saved graphic">Saved</Btn>
      <Btn sm primary color="#0ea5e9" icon={isExporting ? Loader2 : Download} disabled={isExporting} onClick={handleDownload}>JPG</Btn>
      {savedPop && <Popover title="Saved graphics" onClose={() => setSavedPop(false)}>{savedList(() => setSavedPop(false))}</Popover>}
    </div>
  );

  /* ============ GRAPHIC (exported area) ============ */
  return (
    <StudioLayout controls={controls} toolbar={toolbar} preview={(
      <div ref={scaleWrapRef} style={{
        width: '100%', height: GRAPHIC_H * scale, overflow: 'hidden',
        display: 'flex', justifyContent: 'center',
      }}>
        <GlassBackdropContext.Provider value={backdrop}>
        <div ref={graphicRef} data-graphic-root=""
          onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp}
          onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp}
          style={{
          cursor: mapTool === 'text' ? 'text' : mapTool === 'arrow' ? 'crosshair' : mapTool === 'cond' || mapTool === 'select' ? 'pointer' : (drawMode ? 'crosshair' : 'default'),
          userSelect: 'none',
          touchAction: (surfaceActive && (drawMode || mapTool === 'arrow')) ? 'none' : 'auto',
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
            position: 'absolute', top: 14, left: 18, right: 18, bottom: 54,
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

            {!isRadar && <TimelinePill stamps={timelineStamps} stampRisks={stampRisks} stampOverlays={stampOverlays} levels={GRAPHIC_LEVELS} onStampClick={cycleStamp} rangeAnchor={timingAnchor ?? rangeAnchor} validLabel={timelineValid?.label} playhead={playhead} exportMode={exportMode}
              rings={showShapes ? timingRings(shapes, timelineStamps, strokeOf, sel) : []} />}


            {!isRadar && overnightEnabled && (
              <div style={{
                ...glass({
                  padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 11,
                  borderRadius: 12, alignSelf: 'flex-start',
                }, glassMode),
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

            <div style={{ ...glass({ padding: '8px 10px', borderRadius: 14, alignSelf: 'flex-start', width: 170 }, glassMode) }}>
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
              }}>{isRadar ? 'Source: Met Office radar & lightning' : usesSevere ? 'SVRE = Severe Tstorm risk · COND = conditional' : null}</span>
            </div>

            {/* Hazards card — hidden while the lightning overlay is active, since
                lightning mode is a verification view, not a hazard forecast. */}
            {!showLightning && visibleHazards.length > 0 && (
              /* Compact: a slim row for each hazard, its chance (when set) at the end of the same
                 row, so setting percentages never widens the card into the map. It used to grow
                 from 170 to 200 px the moment one was set, over the map's west coast. */
              <div style={{ ...glass({ padding: '8px 9px 9px', borderRadius: 13, alignSelf: 'flex-start', width: 160 }, glassMode) }}>
                <GlassSheen />
                <span style={{
                  position: 'relative', zIndex: 1, display: 'block', marginBottom: 6, paddingBottom: 5,
                  borderBottom: '1px solid rgba(255,255,255,0.10)',
                  fontSize: 8.5, fontWeight: 800, letterSpacing: '0.2em',
                  color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase',
                }}>{isRadar ? 'Conditions' : 'Hazards'}</span>
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {visibleHazards.map(h => {
                    const HIcon = h.Icon;
                    const pct = hazardPct[h.id];
                    return (
                      <div key={h.id} style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '3px 6px 3px 3px', borderRadius: 8,
                        background: h.hatched
                          ? 'repeating-linear-gradient(45deg, rgba(0,0,0,0.45) 0 5px, rgba(49,46,129,0.38) 5px 10px)'
                          : `linear-gradient(90deg, ${h.color}30 0%, ${h.color}0e 100%)`,
                        boxShadow: `inset 3px 0 0 ${h.color}`,
                      }}>
                        <div style={{
                          width: 19, height: 19, borderRadius: 6, flexShrink: 0, marginLeft: 3,
                          background: `linear-gradient(135deg, ${h.color}, ${h.color}cc)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {h.customIcon === 'hail' ? <HailIcon size={12} color="#fff" /> :
                           h.customIcon === 'flood' ? <FloodHouseIcon size={12} color="#fff" /> :
                           HIcon ? <HIcon style={{ width: 11, height: 11, color: '#fff' }} strokeWidth={2.5} /> : null}
                        </div>
                        <span style={{
                          flex: 1, minWidth: 0, fontSize: 9.5, fontWeight: 750, color: '#fff',
                          lineHeight: 1.12, letterSpacing: '-0.005em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{h.label}</span>
                        {pct != null && (
                          <span style={{
                            flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#fff', lineHeight: 1,
                            letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
                          }}>{pct}<span style={{ fontSize: 8, fontWeight: 800, color: 'rgba(255,255,255,0.72)', marginLeft: 1 }}>%</span></span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Lightning verification stats card — shown on the graphic itself
                (and in exports) only while the lightning overlay is active.
                Mirrors the count + peak-hour readout from the control panel. */}
            {showLightning && (
              <div style={{ ...glass({ padding: '8px 10px', borderRadius: 12, alignSelf: 'flex-start', width: 150 }, glassMode) }}>
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

            {/* Accuracy card — how well the drawn areas caught the strikes shown (see lightningScore) */}
            {showLightning && lightningScore && (() => {
              const c = lightningScore.score >= 70 ? '#4ade80' : lightningScore.score >= 40 ? '#facc15' : '#f87171';
              const sub = { fontSize: 7.5, fontWeight: 700, color: 'rgba(148,163,184,0.95)', letterSpacing: '0.12em', textTransform: 'uppercase' };
              return (
                <div style={{ ...glass({ padding: '8px 10px', borderRadius: 12, alignSelf: 'flex-start', width: 150 }, glassMode) }}>
                  <GlassSheen />
                  <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid rgba(255,255,255,0.10)', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.18em', color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase' }}>
                    <Target style={{ width: 10, height: 10, color: c }} strokeWidth={2.6} /> Accuracy
                  </span>
                  <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 19, fontWeight: 800, color: c, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                        {lightningScore.score}<span style={{ fontSize: 11, marginLeft: 1 }}>%</span>
                      </span>
                      <span style={{ display: 'block', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${lightningScore.score}%`, background: c, borderRadius: 2 }} />
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{lightningScore.pod}%</span>
                      <span style={sub}>Strikes in risk areas</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{lightningScore.areasHit} / {lightningScore.areas}</span>
                      <span style={sub}>Areas with lightning</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Forecast discussion card — forecaster narrative, left column.
                Display-only; inherits the header's pointer-events:none. Width
                matches the other cards so it clears the centred map, and the
                body is line-clamped so a long discussion can't run under the
                footer or off the bottom of the graphic. */}
            {!isRadar && discussionEnabled && discussionText.trim() && (
              <div style={{ ...glass({ padding: '11px 13px', borderRadius: 14, alignSelf: 'flex-start', width: 220 }, glassMode) }}>
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

          {/* -- MAP + VECTOR DRAWING --
              The map sits in its box; what is drawn can go anywhere on the graphic. The box's two map
              layers (the ground, then rain, cities and lightning) clip to it as before. The drawings
              between and above them keep the box's 0..1 coordinates, so they stay registered with the
              map, but are drawn on layers that reach far past the box on every side (DRAW_BOX /
              DRAW_VB): an area can run out over the sea, under the cards or into the corners. The
              pointer is taken on the whole graphic (its root's handlers), not only over the box. */}
          <div ref={mapWrapRef} style={{
              position: 'absolute', top: 20, left: '50%', marginLeft: -130, width: 450, height: 666,
                            zIndex: 3, borderRadius: 12, overflow: 'hidden',
            }}
          >
           <div style={{
             position: 'absolute', inset: 0,
             transform: outlookZoom.transform, transformOrigin: '0 0',
             transition: 'transform 0.25s ease',
           }}>
            <CountyLand data={counties} view={view} k={outlookZoom.k} context={mapContext} />
            {isRadar && <UKRadarLayer opacity={0.88} projectPt={projectPt} viewW={VIEW_W} viewH={VIEW_H} bbox={viewBox ? { lonMin: viewBox.lonMin - 0.6, lonMax: viewBox.lonMax + 0.6, latMin: viewBox.latMin - 0.4, latMax: viewBox.latMax + 0.4 } : MAP_BBOX} />}
            {isRadar && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 3px)' }} />}
           </div>
          </div>
          {showShapes && (
              <svg viewBox={DRAW_VB} preserveAspectRatio="none"
                style={{ ...DRAW_BOX, pointerEvents: 'none', zIndex: 3 }}>
                <g transform={drawZoom}>
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
                        stroke={s.stroke != null ? shadeColor(s.stroke) : areaCond ? condColor : darkenColor(m.border, 0.2)}
                        strokeWidth={severe ? 6 : condSevere ? 5.5 : areaCond ? 5 : 4}
                        strokeLinejoin="round" strokeLinecap="round"
                        strokeDasharray={condSevere ? '12 9' : areaCond ? '13 8' : 'none'} />
                    </g>
                  );
                })}
                {/* the selected area (dashed white) and the one under a chip (dotted), never exported */}
                {!exportMode && [[hoverShape, false], [sel, true]].map(([idx, main]) => (idx != null && shapes[idx] && (main || idx !== sel) ? (
                  <path key={main ? 'sel' : 'hov'} d={shapePaths[idx]} fill="none" stroke={main ? '#ffffff' : 'rgba(255,255,255,0.75)'} strokeWidth={main ? 4.5 : 3}
                    strokeDasharray={main ? '11 7' : '3 6'} strokeLinejoin="round" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.9))' }} />
                ) : null))}
                {currentPath.length > 1 && (
                  <path d={pointsToPath(currentPath)}
                    fill={activeMeta.fill} stroke={activeMeta.border}
                    strokeWidth={3} strokeDasharray="6 4"
                    strokeLinejoin="round" strokeLinecap="round" opacity={0.85}
                  />
                )}
              </g>
              </svg>
            )}
          <div style={{
              position: 'absolute', top: 20, left: '50%', marginLeft: -130, width: 450, height: 666,
                            zIndex: 3, borderRadius: 12, overflow: 'hidden', pointerEvents: 'none',
            }}
          >
           <div style={{
             position: 'absolute', inset: 0,
             transform: outlookZoom.transform, transformOrigin: '0 0',
             transition: 'transform 0.25s ease',
           }}>
            <ModelOverlay enabled={showModel && !isRadar} field={MODEL_FIELD} timeMs={overlayTime} box={viewBox} k={outlookZoom.k} onStatus={setModelStatus} />
            {showCities && <TownLabels data={counties} view={view} k={outlookZoom.k} />}
            {showLightning && strikes && <LightningLayer strikes={strikes} color={lightningColor} outline={lightningOutline} outlineColor={lightningOutlineColor} />}
            {/* County outlines drawn ON TOP of the lightning dots so the borders stay visible over the strike overlay. */}
            {showLightning && <CountyLand data={counties} view={view} k={outlookZoom.k} linesOnly zIndex={5.5} />}
           </div>
          </div>
          {/* the outlines again over the strikes, exactly as they are drawn without them */}
          {showShapes && showLightning && shapes.length > 0 && (
              <svg viewBox={DRAW_VB} preserveAspectRatio="none" style={{ ...DRAW_BOX, pointerEvents: 'none', zIndex: 3 }}>
                <g transform={drawZoom}>
                {shapes.map((s, i) => {
                  const m = LEVEL_LOOKUP[s.riskLevel] || activeMeta, severe = isSevereId(s.riskLevel), condSevere = isCondSevereId(s.riskLevel), areaCond = !!s.cond && !severe && !condSevere;
                  return (
                    <g key={i} opacity={animOpacityFor(s)}>
                      {condSevere && <path d={shapePaths[i]} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="12 9" />}
                      <path d={shapePaths[i]} fill="none" stroke={s.stroke != null ? shadeColor(s.stroke) : areaCond ? darkenColor(m.border, 0.4) : darkenColor(m.border, 0.2)}
                        strokeWidth={severe ? 6 : condSevere ? 5.5 : areaCond ? 5 : 4} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={condSevere ? '12 9' : areaCond ? '13 8' : 'none'} />
                    </g>
                  );
                })}
              </g>
              </svg>
            )}
          {/* -- STORM-MOTION ARROWS -- */}
            {(arrows.length > 0 || arrowDraft) && (
              <svg viewBox={DRAW_VB} preserveAspectRatio="none"
                style={{ ...DRAW_BOX, pointerEvents: 'none', zIndex: 3 }}>
                <g transform={drawZoom}>
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
              </g>
              </svg>
            )}

          {/* -- ON-MAP TEXT ANNOTATIONS -- leader lines on a drawing layer, labels over the box */}
          {annotations.some(a => a.leader) && (
            <svg viewBox={DRAW_VB} preserveAspectRatio="none" style={{ ...DRAW_BOX, pointerEvents: 'none', zIndex: 3 }}>
              <g transform={drawZoom}>
                {annotations.filter(a => a.leader).map(a => (
                      <g key={`ld-${a.id}`}>
                        <line x1={a.x * 1000} y1={a.y * 1000} x2={a.lx * 1000} y2={a.ly * 1000}
                          stroke="rgba(0,0,0,0.55)" strokeWidth={4} strokeLinecap="round" />
                        <line x1={a.x * 1000} y1={a.y * 1000} x2={a.lx * 1000} y2={a.ly * 1000}
                          stroke={a.color} strokeWidth={2} strokeLinecap="round" />
                        <circle cx={a.lx * 1000} cy={a.ly * 1000} r={5} fill={a.color} stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} />
                      </g>
                    ))}
              </g>
            </svg>
          )}
          {annotations.length > 0 && (
            <div style={{ position: 'absolute', top: 20, left: '50%', marginLeft: -130, width: 450, height: 666, zIndex: 3, pointerEvents: 'none' }}>
           <div style={{
             position: 'absolute', inset: 0,
             transform: outlookZoom.transform, transformOrigin: '0 0',
             transition: 'transform 0.25s ease',
           }}>
                {annotations.map(a => {
                  const px = ANNOTATION_SIZE_PX[a.size] || 17;
                  const dark = a.color === '#111827' || a.color === '#ffffff';
                  return (
                    <div key={a.id}
                      onMouseDown={(e) => {
                        if (exportMode) return;
                        e.stopPropagation();
                        setEditingAnnId(a.id);
                        /* eventToNormPoint undoes the zoom, so a label drags at any zoom */
                        const onMove = (ev) => { const p = eventToNormPoint(ev); if (p) updateAnnotation(a.id, { x: p[0], y: p[1] }); };
                        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                      style={{
                        position: 'absolute', left: `${a.x * 100}%`, top: `${a.y * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        pointerEvents: exportMode ? 'none' : 'auto',
                        cursor: exportMode ? 'default' : 'move',
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
            </div>
          )}

          {/* -- FOOTER: the logo in the bottom-left corner, a glass card in the bottom-right -- */}
          <GraphicFooter logoUrl={siteLogoUrl} FallbackIcon={CloudLightning} handle={handle} version={basic ? null : version} madeWith={basic} radar={isRadar}
            caption={footerText} forecastLabel={forecastLabel} update={forecastType === 'update'} validDate={validDate} validUntil={validUntil}
            tzAbbr={tzAbbr} regionLabel={view?.label || 'UK & Ireland'} />
        </div>
        </GlassBackdropContext.Provider>
      </div>
    )} />
  );
}
