/* StormStudioGraphicTool — public Thunderstorm Studio graphic generator.
   A lean, user-facing sibling of the admin StormOutlookGraphicTool: it shares
   the same UK map / county / city layers and timeline pill, but exposes only a
   focused set of controls. Saves go to the per-user StudioGraphic entity (each
   user only sees their own), and saving is gated behind login. A non-removable
   "Made in @MyWeatherUK Graphic Studio" watermark is always rendered. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download, Eraser, Eye, EyeOff, Clock, Pen, MousePointer, Undo2, X, Zap, MapPin,
  CloudLightning, Tornado, AlertTriangle, Wind, Save, FolderOpen, Check, Loader2,
  Image as ImageIcon,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { base44 } from '@/api/base44Client';
import { RISK_META, RISK_PALETTES, LEVEL_RANGE } from '@/components/tcm/riskConfig';
import TimelinePill from '@/components/tcm/StormOutlookTimelinePill';
import {
  VIEW_W, VIEW_H, MAP_BBOX, UK_REGIONS, projectPt, latLonToNorm,
  UKOutlineMap, CountyLinesLayer, CityMarkersLayer, STORM_BG_URL, HailIcon, FloodHouseIcon,
} from '@/components/tcm/stormGeo';

const GRAPHIC_W = 640, GRAPHIC_H = 760;

// --- Conditional Severe (between High and Severe) ---
const COND_SEVERE_ID = 'Conditional Severe';
const COND_SEVERE_COLOR = '#0b0f1a';
const COND_SEVERE = { id: COND_SEVERE_ID, short: 'COND SVRE', range: 'COND SVR', color: COND_SEVERE_COLOR, fill: 'rgba(200,205,215,0.18)', border: COND_SEVERE_COLOR };

function darkenColor(input, amount = 0.45) {
  if (!input) return '#000000';
  let r, g, b; const s = String(input).trim();
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    r = parseInt(hex.slice(0, 2), 16); g = parseInt(hex.slice(2, 4), 16); b = parseInt(hex.slice(4, 6), 16);
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return '#000000';
    [r, g, b] = m[1].split(',').map(p => parseFloat(p));
  }
  if (![r, g, b].every(Number.isFinite)) return '#000000';
  const k = 1 - Math.max(0, Math.min(1, amount)); const d = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[d(r), d(g), d(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function pointInPolygon(pt, poly) {
  if (!poly || poly.length < 3) return false;
  const [x, y] = pt; let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

const GRAPHIC_LEVELS = (() => {
  const base = RISK_META.filter(r => r.level !== 'No Risk').map(r => {
    let [lo, hi] = LEVEL_RANGE[r.level] || [0, 0];
    if (r.level === 'High') hi = 100;
    const G = { 'Very Low': ['#60a5fa', 'rgba(96,165,250,0.34)', 'TSTM'], 'Low': ['#86efac', 'rgba(134,239,172,0.38)', 'MRGL'], 'Marginal': ['#facc15', 'rgba(250,204,21,0.42)', 'SLGT'], 'Slight': ['#fb923c', 'rgba(249,115,22,0.45)', 'ENH'], 'Moderate': ['#f87171', 'rgba(248,113,113,0.45)', 'MDT'], 'High': ['#a78bfa', 'rgba(167,139,250,0.45)', 'HIGH'] };
    const g = G[r.level];
    return { id: r.level, short: g ? g[2] : (r.level === 'Severe' ? 'SVRE' : r.level.toUpperCase()), range: r.level === 'Severe' ? 'SVR TSTMS' : `${lo}-${hi}%`, color: g ? g[0] : RISK_PALETTES.thunderstorm[r.level].color, fill: g ? g[1] : RISK_PALETTES.thunderstorm[r.level].fill, border: g ? g[0] : RISK_PALETTES.thunderstorm[r.level].border };
  });
  const out = []; let inserted = false;
  for (const lvl of base) { if (lvl.id === 'Severe' && !inserted) { out.push(COND_SEVERE); inserted = true; } out.push(lvl); }
  if (!inserted) out.push(COND_SEVERE);
  return out;
})();
const RISK_BY_ID = Object.fromEntries(GRAPHIC_LEVELS.map(l => [l.id, l]));
const LEVEL_LOOKUP = RISK_BY_ID;
const isSevereId = (id) => id === 'Severe';
const isCondSevereId = (id) => id === COND_SEVERE_ID;

const HAZARDS = [
  { id: 'lightning', label: 'High Lightning', Icon: CloudLightning, color: '#ec4899', hatched: false },
  { id: 'hail',      label: 'Large Hail',     Icon: null,            color: '#22d3ee', hatched: false, customIcon: 'hail' },
  { id: 'flood',     label: 'Flash Flooding', Icon: null,           color: '#3b82f6', hatched: false, customIcon: 'flood' },
  { id: 'tornado',   label: 'Tornado',        Icon: Tornado,        color: '#f97316', hatched: false },
  { id: 'wind',      label: 'Strong Winds',   Icon: Wind,           color: '#0ea5e9', hatched: false },
  { id: 'severe',    label: 'Severe',         Icon: AlertTriangle,  color: '#a5b4fc', hatched: true  },
];

const buildStamps = (gran, startHHMM = '06:00', endHHMM = '06:00') => {
  const [sh, sm] = (startHHMM || '06:00').split(':').map(Number), [eh, em] = (endHHMM || '06:00').split(':').map(Number);
  let s = sh * 60 + sm, e = eh * 60 + em; if (e <= s) e += 1440;
  const st = (gran === '1h' ? 1 : gran === '2h' ? 2 : 3) * 60, out = [];
  for (let t = s; t <= e; t += st) out.push({ label: String(Math.floor((t % 1440) / 60)).padStart(2, '0') });
  return out;
};

const CONFIDENCE_STEPS = 5;
const CONFIDENCE_LEVELS = [
  { id: 'very-low', label: 'Very Low', short: 'V.LOW', bars: 1, color: '#f87171' },
  { id: 'low', label: 'Low', short: 'LOW', bars: 2, color: '#fb923c' },
  { id: 'medium', label: 'Medium', short: 'MEDIUM', bars: 3, color: '#facc15' },
  { id: 'high', label: 'High', short: 'HIGH', bars: 4, color: '#4ade80' },
  { id: 'very-high', label: 'Very High', short: 'V.HIGH', bars: 5, color: '#22c55e' },
];
const CONFIDENCE_BY_ID = Object.fromEntries(CONFIDENCE_LEVELS.map(c => [c.id, c]));

// --- Frosted-glass panel helper (solid frosted fill in export mode) ---
const glass = (extra = {}, exportMode = false) => ({
  background: exportMode
    ? 'linear-gradient(155deg, rgba(46,58,88,0.93) 0%, rgba(28,38,62,0.94) 45%, rgba(18,26,46,0.95) 100%)'
    : 'linear-gradient(155deg, rgba(70,86,124,0.40) 0%, rgba(40,54,86,0.34) 45%, rgba(16,24,44,0.46) 100%)',
  border: '1px solid rgba(255,255,255,0.26)',
  boxShadow: exportMode
    ? '0 10px 34px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255,255,255,0.34), inset 0 -1px 0 rgba(0,0,0,0.26)'
    : '0 12px 40px rgba(0,0,0,0.46), 0 2px 10px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.40), inset 0 0 22px rgba(120,150,210,0.12), inset 0 -1px 0 rgba(0,0,0,0.24)',
  ...(exportMode ? {} : { backdropFilter: 'blur(22px) saturate(180%) brightness(1.08)', WebkitBackdropFilter: 'blur(22px) saturate(180%) brightness(1.08)' }),
  borderRadius: 14, position: 'relative', overflow: 'hidden', ...extra,
});
function GlassSheen() {
  return (<>
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '58%', background: 'linear-gradient(158deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.07) 38%, transparent 72%)', pointerEvents: 'none', zIndex: 0 }} />
    <div style={{ position: 'absolute', top: 1, left: '8%', right: '8%', height: 1, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)', pointerEvents: 'none', zIndex: 0 }} />
  </>);
}

// --- Drawn-area smoothing ---
function decimatePoints(pts, minDist = 0.010) {
  if (!pts || pts.length < 2) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = out[out.length - 1]; const [cx, cy] = pts[i];
    if (Math.hypot(cx - px, cy - py) >= minDist) out.push(pts[i]);
  }
  return out;
}
function chaikinClosed(pts, iterations = 3) {
  let ring = pts;
  for (let it = 0; it < iterations; it++) {
    const n = ring.length; if (n < 3) return ring; const next = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n];
      next.push([ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25], [ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75]);
    }
    ring = next;
  }
  return ring;
}
function smoothPoints(pts) {
  if (!pts || pts.length < 4) return pts || [];
  const dec = decimatePoints(pts, 0.010); if (dec.length < 4) return dec;
  return chaikinClosed(dec, 3);
}
function pointsToPath(pts) {
  const s = smoothPoints(pts); if (!s || s.length < 2) return '';
  if (s.length < 4) { let d = `M ${s[0][0] * 1000} ${s[0][1] * 1000}`; for (let i = 1; i < s.length; i++) d += ` L ${s[i][0] * 1000} ${s[i][1] * 1000}`; return d + ' Z'; }
  const n = s.length; const pt = (i) => s[((i % n) + n) % n]; let d = `M ${pt(0)[0] * 1000} ${pt(0)[1] * 1000}`;
  for (let i = 0; i < n; i++) {
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6) * 1000} ${(p1[1] + (p2[1] - p0[1]) / 6) * 1000}, ${(p2[0] - (p3[0] - p1[0]) / 6) * 1000} ${(p2[1] - (p3[1] - p1[1]) / 6) * 1000}, ${p2[0] * 1000} ${p2[1] * 1000}`;
  }
  return d + ' Z';
}
// Straight (un-smoothed) path for the click-points live preview.
const pointsToStraightPath = (pts) => pts.length ? (pts.map((p, i) => (i === 0 ? 'M' : 'L') + ` ${p[0] * 1000} ${p[1] * 1000}`).join('') + (pts.length >= 3 ? ' Z' : '')) : '';

function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 2000);
    });
  }));
}

const inputCss = { width: '100%', padding: '8px 10px', borderRadius: 8, background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)', color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none' };
const labelCss = { fontSize: 10.5, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' };
const btnCss = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)', color: '#f1f5f9', fontFamily: 'inherit' };

export default function StormStudioGraphicTool() {
  const [validDate, setValidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validDate2, setValidDate2] = useState('');
  const [activeRisk, setActiveRisk] = useState('Slight');
  const [hazards, setHazards] = useState(['lightning', 'hail', 'flood']);
  const [hazardPct, setHazardPct] = useState({});
  const [timelineGran, setTimelineGran] = useState('3h');
  const [timelineStart, setTimelineStart] = useState('06:00');
  const [timelineEnd, setTimelineEnd] = useState('06:00');
  const timelineStamps = useMemo(() => buildStamps(timelineGran, timelineStart, timelineEnd), [timelineGran, timelineStart, timelineEnd]);
  const [stampRisks, setStampRisks] = useState(() => Array(buildStamps('3h').length).fill(null));
  const [stampOverlays, setStampOverlays] = useState(() => Array(buildStamps('3h').length).fill(null));
  const [footerText, setFooterText] = useState('Risk of Thunderstorms in a 15 mile radius');
  const [handle, setHandle] = useState('@MyWeatherUK');
  const [version, setVersion] = useState('v6.00');
  const [forecastType, setForecastType] = useState('initial');
  const [updateNumber, setUpdateNumber] = useState(1);
  const [drawStyle, setDrawStyle] = useState('freehand');
  const [drawOpacity, setDrawOpacity] = useState(0.7);
  const [shapes, setShapes] = useState([]);
  const [currentPath, setCurrentPath] = useState([]);
  const [showShapes, setShowShapes] = useState(true);
  const [showCities, setShowCities] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [timelineRangeMode, setTimelineRangeMode] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [customLogoUrl, setCustomLogoUrl] = useState(null);
  const [savedGraphics, setSavedGraphics] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [loadingGraphics, setLoadingGraphics] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const studioLogoInputRef = useRef(null);
  const mapWrapRef = useRef(null);
  const graphicRef = useRef(null);
  const isPointerDown = useRef(false);

  useEffect(() => { base44.auth.me().then(setCurrentUser).catch(() => setCurrentUser(null)); }, []);
  useEffect(() => { if (!timelineRangeMode) setRangeAnchor(null); }, [timelineRangeMode]);

  // Remap stamp arrays when the timeline shape changes, by clock label.
  const prevStampsRef = useRef(timelineStamps);
  useEffect(() => {
    const prev = prevStampsRef.current, next = timelineStamps;
    if (prev === next) return;
    const used = {}; const byLabelIdx = new Map();
    prev.forEach((s, i) => { const k = `${s.label}#${(used[s.label] = (used[s.label] || 0))}`; byLabelIdx.set(k, stampRisks[i] ?? null); used[s.label]++; });
    const seen = {};
    const remap = (arr) => next.map((s) => { const occ = (seen[s.label] = (seen[s.label] || 0)); seen[s.label]++; return byLabelIdx.get(`${s.label}#${occ}`) ?? null; });
    setStampRisks(prev => { const used2 = {}; const m = new Map(); prev.forEach((v, i) => { const kk = `${prev[i].label}#${(used2[prev[i].label] = (used2[prev[i].label] || 0))}`; m.set(kk, v); used2[prev[i].label]++; }); const sn = {}; return next.map(s => { const occ = (sn[s.label] = (sn[s.label] || 0)); sn[s.label]++; return m.get(`${s.label}#${occ}`) ?? null; }); });
    setStampOverlays(prev => { const used2 = {}; const m = new Map(); prev.forEach((v, i) => { const kk = `${prev[i].label}#${(used2[prev[i].label] = (used2[prev[i].label] || 0))}`; m.set(kk, v); used2[prev[i].label]++; }); const sn = {}; return next.map(s => { const occ = (sn[s.label] = (sn[s.label] || 0)); sn[s.label]++; return m.get(`${s.label}#${occ}`) ?? null; }); });
    prevStampsRef.current = next;
  }, [timelineStamps]);

  const captureState = () => ({
    validDate, validDate2, activeRisk, hazards, hazardPct, stampRisks, stampOverlays, footerText, handle, version,
    forecastType, updateNumber, drawOpacity, shapes, showShapes, showCities, timelineGran, timelineStart, timelineEnd,
    confidence, customLogoUrl, drawStyle,
  });

  const handleSave = async () => {
    if (!saveName.trim()) return;
    if (!currentUser) { setNeedsAuth(true); return; }
    setSaving(true);
    try {
      await base44.entities.StudioGraphic.create({ title: saveName.trim(), graphic_state: captureState(), user_email: currentUser.email || '' });
      setSaveSuccess(true); setSaveName('');
      setTimeout(() => { setSaveSuccess(false); setShowSavePanel(false); setNeedsAuth(false); }, 1500);
    } catch (e) { console.error('[Studio] save failed:', e); }
    finally { setSaving(false); }
  };

  const openLoadPanel = async () => {
    setShowLoadPanel(true); setLoadingGraphics(true);
    try { const list = await base44.entities.StudioGraphic.filter({}, '-created_date', 50); setSavedGraphics(list); }
    finally { setLoadingGraphics(false); }
  };

  const loadState = (g) => {
    const s = g.graphic_state; if (!s) return;
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
    if (s.drawOpacity !== undefined) setDrawOpacity(s.drawOpacity);
    if (s.shapes !== undefined) setShapes(s.shapes);
    if (s.showShapes !== undefined) setShowShapes(s.showShapes);
    if (s.showCities !== undefined) setShowCities(s.showCities);
    if (s.timelineGran !== undefined) setTimelineGran(s.timelineGran);
    if (s.timelineStart !== undefined) setTimelineStart(s.timelineStart);
    if (s.timelineEnd !== undefined) setTimelineEnd(s.timelineEnd);
    if (s.confidence !== undefined) setConfidence(s.confidence);
    if (s.customLogoUrl !== undefined) setCustomLogoUrl(s.customLogoUrl);
    if (s.drawStyle !== undefined) setDrawStyle(s.drawStyle);
    setShowLoadPanel(false);
  };

  // --- Drawing handlers ---
  const eventToNormPoint = (e) => {
    const wrap = mapWrapRef.current; if (!wrap) return null;
    const rect = wrap.getBoundingClientRect(); const src = e.touches?.[0] || e;
    let x = (src.clientX - rect.left) / rect.width, y = (src.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  };

  const handleDown = (e) => {
    if (!drawStyle) {/* keep selected tool active */}
    e.preventDefault();
    const pt = eventToNormPoint(e); if (!pt) return;
    if (drawStyle === 'points') {
      setCurrentPath(prev => {
        if (prev.length >= 3 && Math.hypot(pt[0] - prev[0][0], pt[1] - prev[0][1]) < 0.022) {
          setShapes(sp => [...sp, { riskLevel: activeRisk, points: prev }]); return [];
        }
        return [...prev, pt];
      });
      return;
    }
    isPointerDown.current = true;
    setCurrentPath([pt]);
  };
  const handleMove = (e) => {
    if (!isPointerDown.current || drawStyle === 'points') return;
    e.preventDefault(); const pt = eventToNormPoint(e); if (pt) setCurrentPath(prev => [...prev, pt]);
  };
  const handleUp = () => {
    if (!isPointerDown.current) return;
    isPointerDown.current = false;
    if (currentPath.length > 2) setShapes(prev => [...prev, { riskLevel: activeRisk, points: currentPath }]);
    setCurrentPath([]);
  };

  const finishPointArea = () => setCurrentPath(prev => { if (prev.length >= 3) setShapes(sp => [...sp, { riskLevel: activeRisk, points: prev }]); return []; });
  const undoLast = () => setShapes(prev => prev.slice(0, -1));
  const clearShapes = () => shapes.length && window.confirm('Clear all drawn risk areas?') && setShapes([]);
  const cycleShapeRisk = (idx) => setShapes(prev => prev.map((s, j) => { if (j !== idx) return s; const order = GRAPHIC_LEVELS.map(l => l.id); const next = order[(order.indexOf(s.riskLevel) + 1) % order.length]; return { ...s, riskLevel: next }; }));
  const toggleHazard = (id) => setHazards(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);

  // Timeline stamp toggling (mirrors the admin tool).
  const isOverlayTier = isSevereId(activeRisk) || isCondSevereId(activeRisk);
  const applyStampRange = (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const setter = isOverlayTier ? setStampOverlays : setStampRisks;
    setter(prev => { const next = [...prev]; for (let k = lo; k <= hi; k++) next[k] = activeRisk; return next; });
  };
  const toggleSingleStamp = (i) => {
    if (isOverlayTier) { setStampOverlays(prev => { const n = [...prev]; n[i] = n[i] === activeRisk ? null : activeRisk; return n; }); return; }
    setStampRisks(prev => { const n = [...prev]; n[i] = n[i] === activeRisk ? null : activeRisk; return n; });
  };
  const cycleStamp = (i) => {
    if (timelineRangeMode) { if (rangeAnchor == null) { setRangeAnchor(i); return; } if (rangeAnchor === i) { setRangeAnchor(null); toggleSingleStamp(i); return; } applyStampRange(rangeAnchor, i); setRangeAnchor(null); return; }
    toggleSingleStamp(i);
  };

  const activeMeta = LEVEL_LOOKUP[activeRisk] || GRAPHIC_LEVELS[0];
  const visibleHazards = HAZARDS.filter(h => hazards.includes(h.id));
  const shapePaths = useMemo(() => shapes.map(s => pointsToPath(s.points)), [shapes]);
  const anyStamps = useMemo(() => stampRisks.some(Boolean) || stampOverlays.some(Boolean), [stampRisks, stampOverlays]);
  const SEV = useMemo(() => { const m = {}; GRAPHIC_LEVELS.forEach((l, i) => { m[l.id] = i; }); return m; }, []);

  const timelineValid = useMemo(() => {
    const stepH = timelineGran === '1h' ? 1 : timelineGran === '2h' ? 2 : 3;
    const [tsH, tsM] = (timelineStart || '06:00').split(':').map(Number);
    const base = new Date(validDate + `T${String(tsH).padStart(2, '0')}:${String(tsM).padStart(2, '0')}:00`);
    if (isNaN(base.getTime())) return null;
    const at = (idx) => new Date(base.getTime() + idx * stepH * 3600_000);
    let first = -1, last = -1;
    for (let i = 0; i < timelineStamps.length; i++) { if (stampRisks[i] || stampOverlays[i]) { if (first < 0) first = i; last = i; } }
    if (first < 0) return null;
    const start = at(first), end = at(last + 1);
    const fmt = (d) => d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', hour12: false });
    return { label: `${fmt(start)} → ${fmt(end)}` };
  }, [validDate, timelineGran, timelineStart, timelineStamps, stampRisks, stampOverlays]);

  const leadDays = useMemo(() => { const t = new Date(); t.setHours(0,0,0,0); const o = new Date(validDate + 'T00:00:00'); return Math.round((o - t) / 86400000); }, [validDate]);
  const isExtended = leadDays >= 3;
  const outlookTitle = isExtended ? 'Extended Thunderstorm Outlook' : 'Thunderstorm Outlook';
  const forecastLabel = forecastType === 'update' ? `Update ${Math.max(1, updateNumber)}` : 'Initial Forecast';
  const tzAbbr = 'BST';

  // --- PNG export (pixel-accurate: clone off-screen at true 640x760, strip the
  // live frame so no rounded-corner / border seam paints as a white line, and
  // wait for fonts + images before rasterising so nothing shifts). ---
  const handleDownload = async () => {
    if (!graphicRef.current) return;
    setIsExporting(true); setExportMode(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 100));
    const clone = graphicRef.current.cloneNode(true);
    clone.style.transform = 'none'; clone.style.transformOrigin = 'top left'; clone.style.margin = '0'; clone.style.flexShrink = '0';
    clone.style.width = `${GRAPHIC_W}px`; clone.style.height = `${GRAPHIC_H}px`;
    clone.style.border = 'none'; clone.style.borderRadius = '0'; clone.style.boxShadow = 'none'; clone.style.overflow = 'visible';
    const sandbox = document.createElement('div');
    sandbox.style.cssText = `position:fixed;top:0;left:-99999px;width:${GRAPHIC_W}px;height:${GRAPHIC_H}px;overflow:hidden;z-index:-1;pointerEvents:none;`;
    sandbox.appendChild(clone); document.body.appendChild(sandbox);
    try {
      await waitForImages(clone); await document.fonts.ready; await new Promise(r => requestAnimationFrame(r));
      const canvas = await html2canvas(clone, { backgroundColor: null, scale: 4, useCORS: true, logging: false, width: GRAPHIC_W, height: GRAPHIC_H, windowWidth: GRAPHIC_W, windowHeight: GRAPHIC_H });
      const link = document.createElement('a'); link.download = `thunderstorm-studio-${validDate}.png`; link.href = canvas.toDataURL('image/png'); link.click();
    } finally { document.body.removeChild(sandbox); setExportMode(false); setIsExporting(false); }
  };

  const scaleWrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => { const m = () => setScale(Math.min(1.7, (scaleWrapRef.current?.offsetWidth || GRAPHIC_W) / GRAPHIC_W)); m(); window.addEventListener('resize', m); return () => window.removeEventListener('resize', m); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, color: '#f1f5f9' }}>
      {/* ============ CONTROL PANEL ============ */}
      <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 14, padding: 13, display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <Field label="Outlook day"><input type="date" value={validDate} onChange={e => setValidDate(e.target.value)} style={inputCss} /></Field>
          <Field label="Second day (optional)">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="date" value={validDate2} onChange={e => setValidDate2(e.target.value)} style={{ ...inputCss, flex: 1 }} />
              {validDate2 && <button type="button" onClick={() => setValidDate2('')} style={{ ...btnCss, padding: '0 10px' }}><X style={{ width: 13, height: 13 }} /></button>}
            </div>
          </Field>
          <Field label="Footer caption"><input value={footerText} onChange={e => setFooterText(e.target.value)} style={inputCss} /></Field>
          <Field label="Handle"><input value={handle} onChange={e => setHandle(e.target.value)} style={inputCss} /></Field>
          <Field label="Version"><input value={version} onChange={e => setVersion(e.target.value)} style={inputCss} /></Field>
        </div>

        {/* User logo upload */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...labelCss, margin: 0 }}>Your logo</span>
          <button type="button" onClick={() => studioLogoInputRef.current?.click()} style={{ ...btnCss, fontWeight: 700 }}>
            <ImageIcon style={{ width: 13, height: 13 }} /> {customLogoUrl ? 'Change logo' : 'Upload logo'}
          </button>
          <input ref={studioLogoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
            const f = e.target.files?.[0]; if (!f) return;
            const reader = new FileReader(); reader.onload = () => setCustomLogoUrl(reader.result); reader.readAsDataURL(f); e.target.value = '';
          }} />
          {customLogoUrl && (<>
            <img src={customLogoUrl} alt="logo" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(148,163,184,0.3)' }} />
            <button type="button" onClick={() => setCustomLogoUrl(null)} style={{ ...btnCss, padding: '5px 10px', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}><X style={{ width: 13, height: 13 }} /> Remove</button>
          </>)}
          <span style={{ fontSize: 10.5, color: '#64748b' }}>Shown on the graphic footer; saved with your graphic.</span>
        </div>

        {/* Forecast issue type */}
        <div>
          <p style={{ ...labelCss, margin: '0 0 8px' }}>Forecast issue</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[{ id: 'initial', label: 'Initial Forecast' }, { id: 'update', label: 'Update' }].map(t => {
              const on = forecastType === t.id;
              return <button key={t.id} type="button" onClick={() => setForecastType(t.id)} style={{ ...btnCss, fontWeight: 800, background: on ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.08)', borderColor: on ? '#38bdf8' : 'rgba(148,163,184,0.2)', color: on ? '#38bdf8' : '#94a3b8' }}>{t.label}</button>;
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

        {/* Confidence + timeline resolution + timeline window */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <p style={{ ...labelCss, margin: '0 0 8px' }}>Forecast confidence</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {CONFIDENCE_LEVELS.map(c => { const on = confidence === c.id; return (
                <button key={c.id} type="button" onClick={() => setConfidence(on ? null : c.id)} style={{ ...btnCss, fontWeight: 800, padding: '6px 10px', background: on ? `${c.color}22` : 'rgba(148,163,184,0.08)', borderColor: on ? c.color : 'rgba(148,163,184,0.2)', color: on ? c.color : '#94a3b8' }}>{c.label}</button>
              ); })}
              {confidence && <button type="button" onClick={() => setConfidence(null)} style={{ ...btnCss, padding: '6px 9px', color: '#94a3b8' }}><X style={{ width: 12, height: 12 }} /> Off</button>}
            </div>
          </div>
          <div>
            <p style={{ ...labelCss, margin: '0 0 8px' }}>Timeline resolution</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {[['3h', '3-hourly'], ['2h', '2-hourly'], ['1h', 'Hourly']].map(([id, label]) => { const on = timelineGran === id; return (
                <button key={id} type="button" onClick={() => setTimelineGran(id)} style={{ ...btnCss, fontWeight: 800, background: on ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.08)', borderColor: on ? '#38bdf8' : 'rgba(148,163,184,0.2)', color: on ? '#38bdf8' : '#94a3b8' }}>{label}</button>
              ); })}
              <button type="button" onClick={() => setTimelineRangeMode(v => !v)} style={{ ...btnCss, fontWeight: 800, marginLeft: 4, background: timelineRangeMode ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)', borderColor: timelineRangeMode ? 'rgba(167,139,250,0.5)' : 'rgba(148,163,184,0.2)', color: timelineRangeMode ? '#a78bfa' : '#94a3b8' }}>
                <Clock style={{ width: 13, height: 13 }} /> {timelineRangeMode ? 'Range: On' : 'Range Fill'}
              </button>
              {timelineRangeMode && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#a78bfa' }}>{rangeAnchor == null ? 'Click the start time…' : 'Now click the end time'}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <span style={{ ...labelCss, margin: 0 }}>Timeline window</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, color: '#94a3b8' }}>From</span><input type="time" value={timelineStart} onChange={e => setTimelineStart(e.target.value)} style={{ ...inputCss, width: 110, colorScheme: 'dark' }} /></span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, color: '#94a3b8' }}>To</span><input type="time" value={timelineEnd} onChange={e => setTimelineEnd(e.target.value)} style={{ ...inputCss, width: 110, colorScheme: 'dark' }} /></span>
              <span style={{ fontSize: 10.5, color: '#64748b' }}>End at/earlier than start = next day</span>
            </div>
          </div>
        </div>

        {/* Active risk */}
        <div>
          <p style={{ ...labelCss, margin: '0 0 8px' }}>Active risk — drawing areas & timeline stamps</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GRAPHIC_LEVELS.map(r => { const on = activeRisk === r.id; return (
              <button key={r.id} type="button" onClick={() => setActiveRisk(r.id)} style={{ padding: '8px 12px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 7, background: on ? `${r.color}22` : 'transparent', border: `1.5px solid ${on ? r.color : 'rgba(148,163,184,0.2)'}`, cursor: 'pointer', color: on ? r.color : '#94a3b8', fontFamily: 'inherit', fontSize: 12, fontWeight: 800 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.color }} />{r.short}<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.75, fontFamily: 'monospace' }}>{r.range}</span>
              </button>
            ); })}
          </div>
        </div>

        {/* Hazards */}
        <div>
          <p style={{ ...labelCss, margin: '0 0 8px' }}>Hazard badges</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {HAZARDS.map(h => { const on = hazards.includes(h.id); const HIcon = h.Icon; const pct = hazardPct[h.id]; return (
              <span key={h.id} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 10, overflow: 'hidden', background: on ? 'rgba(56,189,248,0.10)' : 'transparent', border: `1.5px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.2)'}` }}>
                <button type="button" onClick={() => toggleHazard(h.id)} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, color: on ? '#f1f5f9' : '#94a3b8', fontFamily: 'inherit' }}>
                  {HIcon && <HIcon style={{ width: 13, height: 13 }} />} {h.label}
                </button>
                {on && (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, paddingLeft: 8, paddingRight: 9, borderLeft: '1px solid rgba(148,163,184,0.25)' }}>
                  <input type="number" min={0} max={100} step={5} placeholder="--" value={pct ?? ''} onChange={e => { const v = e.target.value; setHazardPct(p => { const n = { ...p }; if (v === '') delete n[h.id]; else n[h.id] = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); return n; }); }} style={{ width: 48, padding: '4px 6px', borderRadius: 6, textAlign: 'right', background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)', color: '#f1f5f9', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', outline: 'none' }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>%</span>
                </span>)}
              </span>
            ); })}
          </div>
        </div>

        {/* Drawing + export + save controls */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span style={{ ...labelCss, margin: 0 }}>Draw</span>
            {[['freehand', 'Freehand'], ['points', 'Click Points']].map(([id, lbl]) => { const on = drawStyle === id; return (
              <button key={id} type="button" onClick={() => setDrawStyle(id)} style={{ ...btnCss, padding: '5px 10px', fontWeight: 800, background: on ? 'rgba(167,139,250,0.18)' : 'rgba(148,163,184,0.08)', borderColor: on ? 'rgba(167,139,250,0.5)' : 'rgba(148,163,184,0.2)', color: on ? '#a78bfa' : '#94a3b8' }}>
                {id === 'freehand' ? <Pen style={{ width: 13, height: 13 }} /> : <MapPin style={{ width: 13, height: 13 }} />}{lbl}
              </button>
            ); })}
            {drawStyle === 'points' && (<>
              <button type="button" onClick={finishPointArea} disabled={currentPath.length < 3} style={{ ...btnCss, padding: '5px 11px', color: '#86efac', borderColor: 'rgba(74,222,128,0.4)', opacity: currentPath.length < 3 ? 0.4 : 1 }}><Check style={{ width: 13, height: 13 }} /> Finish Area</button>
              {currentPath.length > 0 && <button type="button" onClick={() => setCurrentPath([])} style={{ ...btnCss, padding: '5px 10px', color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}><X style={{ width: 13, height: 13 }} /> Cancel</button>}
            </>)}
          </span>
          <button type="button" onClick={() => setShowShapes(v => !v)} style={btnCss}>{showShapes ? <Eye style={{ width: 13, height: 13 }} /> : <EyeOff style={{ width: 13, height: 13 }} />}</button>
          <button type="button" onClick={() => setShowCities(v => !v)} style={{ ...btnCss, background: showCities ? 'rgba(56,189,248,0.10)' : 'rgba(148,163,184,0.08)', borderColor: showCities ? 'rgba(56,189,248,0.45)' : 'rgba(148,163,184,0.2)', color: showCities ? '#38bdf8' : '#94a3b8' }}><MapPin style={{ width: 13, height: 13 }} /> Cities</button>
          <button type="button" disabled title="Lightning overlay coming soon" style={{ ...btnCss, opacity: 0.5, cursor: 'not-allowed', background: 'rgba(148,163,184,0.06)', borderColor: 'rgba(148,163,184,0.16)' }}><Zap style={{ width: 13, height: 13 }} /> Lightning (Coming Soon)</button>
          <button type="button" onClick={undoLast} disabled={!shapes.length} style={{ ...btnCss, opacity: shapes.length ? 1 : 0.4 }}><Undo2 style={{ width: 13, height: 13 }} /> Undo</button>
          <button type="button" onClick={clearShapes} disabled={!shapes.length} style={{ ...btnCss, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)', opacity: shapes.length ? 1 : 0.4 }}><Eraser style={{ width: 13, height: 13 }} /> Clear Areas</button>
          <button type="button" onClick={() => { setStampRisks(Array(timelineStamps.length).fill(null)); setStampOverlays(Array(timelineStamps.length).fill(null)); }} style={{ ...btnCss, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}><Eraser style={{ width: 13, height: 13 }} /> Clear Timeline</button>
          <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>Opacity
            <input type="range" min="20" max="100" step="5" value={Math.round(drawOpacity * 100)} onChange={e => setDrawOpacity(Number(e.target.value) / 100)} style={{ width: 80, accentColor: '#a78bfa' }} />
            <span style={{ minWidth: 32, fontFamily: 'monospace', color: '#a78bfa' }}>{Math.round(drawOpacity * 100)}%</span>
          </label>
          <button type="button" onClick={handleDownload} disabled={isExporting} style={{ ...btnCss, marginLeft: 'auto', background: isExporting ? 'rgba(148,163,184,0.1)' : 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: '#fff', fontWeight: 700 }}><Download style={{ width: 14, height: 14 }} /> {isExporting ? 'Generating PNG...' : 'Download PNG'}</button>
          <button type="button" onClick={() => { setShowSavePanel(v => !v); setShowLoadPanel(false); setNeedsAuth(false); }} style={{ ...btnCss, background: showSavePanel ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.08)', borderColor: showSavePanel ? 'rgba(74,222,128,0.5)' : 'rgba(148,163,184,0.2)', color: showSavePanel ? '#86efac' : '#94a3b8' }}><Save style={{ width: 13, height: 13 }} /> Save</button>
          <button type="button" onClick={() => { openLoadPanel(); setShowSavePanel(false); }} style={{ ...btnCss, background: showLoadPanel ? 'rgba(251,191,36,0.15)' : 'rgba(148,163,184,0.08)', borderColor: showLoadPanel ? 'rgba(251,191,36,0.5)' : 'rgba(148,163,184,0.2)', color: showLoadPanel ? '#fbbf24' : '#94a3b8' }}><FolderOpen style={{ width: 13, height: 13 }} /> Load Saved</button>
        </div>

        {/* Needs-auth prompt */}
        {needsAuth && (
          <div style={{ padding: '12px 14px', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)' }}>
            <span style={{ fontSize: 12, color: '#e2e8f0' }}>Sign up or log in to save your graphic to your account.</span>
            <button type="button" onClick={() => base44.auth.redirectToLogin()} style={{ ...btnCss, background: 'rgba(56,189,248,0.18)', borderColor: 'rgba(56,189,248,0.5)', color: '#bae6fd' }}>Log In</button>
            <button type="button" onClick={() => { window.location.href = '/register'; }} style={{ ...btnCss, background: 'rgba(74,222,128,0.16)', borderColor: 'rgba(74,222,128,0.45)', color: '#86efac' }}>Sign Up</button>
            <button type="button" onClick={() => setNeedsAuth(false)} style={{ ...btnCss, padding: '6px 10px', color: '#94a3b8' }}>Cancel</button>
          </div>
        )}

        {/* Save panel */}
        {showSavePanel && (
          <div style={{ padding: '12px 14px', borderRadius: 10, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.25)' }}>
            <input value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} placeholder="Name this graphic (e.g. Day 1 Slight Risk)" style={{ ...inputCss, flex: 1 }} />
            <button type="button" onClick={handleSave} disabled={saving || !saveName.trim()} style={{ ...btnCss, padding: '8px 16px', fontWeight: 700, background: saveSuccess ? 'rgba(74,222,128,0.25)' : 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.4)', color: '#86efac', opacity: (!saveName.trim() || saving) ? 0.5 : 1 }}>
              {saving ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : saveSuccess ? <Check style={{ width: 13, height: 13 }} /> : <Save style={{ width: 13, height: 13 }} />}
              {saveSuccess ? 'Saved!' : saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}

        {/* Load panel */}
        {showLoadPanel && (
          <div style={{ padding: 14, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)', maxHeight: 260, overflowY: 'auto' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Your saved graphics</span>
            {loadingGraphics && <span style={{ color: '#94a3b8', fontSize: 12 }}>Loading...</span>}
            {!loadingGraphics && savedGraphics.length === 0 && <span style={{ color: '#64748b', fontSize: 12 }}>No saved graphics yet. Use Save to store your work.</span>}
            {savedGraphics.map(g => (
              <button key={g.id} type="button" onClick={() => loadState(g)} style={{ ...btnCss, justifyContent: 'flex-start', textAlign: 'left', background: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.22)', color: '#f1f5f9' }}>
                <FolderOpen style={{ width: 12, height: 12, color: '#fbbf24', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{g.title}</span>
                <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>{new Date(g.created_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
              </button>
            ))}
          </div>
        )}

        {/* Drawn shape chips */}
        {shapes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ ...labelCss, marginRight: 2 }}>Areas ({shapes.length}) · click to change level</span>
            {shapes.map((s, i) => { const m = LEVEL_LOOKUP[s.riskLevel] || GRAPHIC_LEVELS[0]; return (
              <span key={i} style={{ padding: '3px 4px 3px 9px', borderRadius: 6, background: m.fill, border: `1.5px solid ${m.color}`, color: '#f1f5f9', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button type="button" onClick={() => cycleShapeRisk(i)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#f1f5f9', padding: 0, fontWeight: 700, fontFamily: 'inherit', fontSize: 11 }}>{s.riskLevel}</button>
                <button type="button" onClick={() => setShapes(prev => prev.filter((_, j) => j !== i))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#f1f5f9', padding: '0 2px', display: 'inline-flex' }}><X style={{ width: 11, height: 11 }} /></button>
              </span>
            ); })}
          </div>
        )}
      </div>

      {/* ============ GRAPHIC ============ */}
      <div ref={scaleWrapRef} style={{ width: '100%', height: GRAPHIC_H * scale, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
        <div ref={graphicRef} style={{ width: GRAPHIC_W, height: GRAPHIC_H, position: 'relative', overflow: 'hidden', borderRadius: 24, fontFamily: "'Archivo','DM Sans',system-ui,sans-serif", background: '#06040f', flexShrink: 0, transform: `scale(${scale})`, transformOrigin: 'top center', border: '3px solid rgba(125,140,232,0.55)' }}>
          <img src={STORM_BG_URL} alt="" crossOrigin="anonymous" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', filter: 'blur(1.4px) brightness(0.58)' }} />
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(8,11,22,0.56) 0%, rgba(8,11,22,0.35) 38%, rgba(8,11,22,0.38) 70%, rgba(8,11,22,0.62) 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, opacity: 0.04, pointerEvents: 'none', backgroundImage: 'radial-gradient(rgba(255,255,255,0.6) 0.5px, transparent 0.5px)', backgroundSize: '22px 22px' }} />

          {/* HEADER */}
          <div style={{ position: 'absolute', top: 14, left: 18, right: 18, paddingBottom: 80, zIndex: 5, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, paddingRight: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: isExtended ? 25 : 31, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 0.98, textTransform: 'uppercase', textShadow: '0 2px 8px rgba(0,0,0,0.5)', display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                  {isExtended ? 'Extended ' : ''}<Zap style={{ width: 28, height: 28, color: '#fff' }} strokeWidth={2.4} fill="#fff" /> Thunderstorm Outlook
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  {(() => { const d1 = new Date(validDate + 'T12:00:00'); const d2 = validDate2 ? new Date(validDate2 + 'T12:00:00') : null; const f = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }); return <span style={{ padding: '2px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800, background: 'rgba(148,163,184,0.20)', color: '#e2e8f0', letterSpacing: '0.10em', textTransform: 'uppercase', border: '1px solid rgba(148,163,184,0.38)' }}>{d2 ? `${f(d1)} → ${f(d2)}` : f(d1)}</span>; })()}
                  {isExtended && <span style={{ padding: '2px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800, background: 'rgba(167,139,250,0.22)', color: '#c4b5fd', letterSpacing: '0.13em', textTransform: 'uppercase', border: '1px solid rgba(167,139,250,0.5)' }}>Extended · Day {leadDays}</span>}
                </div>
              </div>
            </div>
            <TimelinePill stamps={timelineStamps} stampRisks={stampRisks} stampOverlays={stampOverlays} onStampClick={cycleStamp} rangeAnchor={rangeAnchor} validLabel={timelineValid?.label} playhead={null} exportMode={exportMode} />

            {/* Risk key card */}
            <div style={{ ...glass({ padding: '8px 10px', borderRadius: 14, alignSelf: 'flex-start', width: 170 }, exportMode) }}>
              <GlassSheen />
              <span style={{ position: 'relative', zIndex: 1, display: 'block', marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.10)', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.22em', color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase' }}>Risk Key</span>
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
                {GRAPHIC_LEVELS.map((r, idx) => (
                  <React.Fragment key={r.id}>
                    {idx > 0 && <div style={{ height: 1, marginLeft: 8, marginRight: 8, marginTop: 4, marginBottom: 4, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 30%, rgba(255,255,255,0.18) 70%, transparent 100%)' }} />}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 28, height: 11, borderRadius: 3, flexShrink: 0, ...(isSevereId(r.id) ? { background: 'transparent', backgroundImage: 'repeating-linear-gradient(45deg, #312e81 0 3px, transparent 3px 7px)', border: `1.5px solid ${r.color}`, boxSizing: 'border-box' } : isCondSevereId(r.id) ? { background: r.fill, border: `1.5px dashed ${r.color}`, boxSizing: 'border-box' } : { background: r.color }) }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#e8edf6', letterSpacing: '0.04em' }}>{r.short}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace' }}>{r.range}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
              {confidence && (() => { const c = CONFIDENCE_BY_ID[confidence]; if (!c) return null; return (
                <div style={{ position: 'relative', zIndex: 1, marginTop: 9, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.10)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.18em', color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase' }}>Confidence</span><span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: c.color, letterSpacing: '0.10em', textTransform: 'uppercase' }}>{c.label}</span></div>
                  <div style={{ display: 'flex', gap: 3 }}>{Array.from({ length: CONFIDENCE_STEPS }, (_, i) => { const filled = i < c.bars; return <span key={i} style={{ flex: 1, height: 9, borderRadius: 2, boxSizing: 'border-box', background: filled ? c.color : 'rgba(148,163,184,0.16)', border: `1px solid ${filled ? c.color : 'rgba(148,163,184,0.30)'}`, boxShadow: filled ? `0 0 6px ${c.color}66` : 'none' }} />; })}</div>
                </div>
              ); })()}
              <span style={{ position: 'relative', zIndex: 1, display: 'block', marginTop: 8, fontSize: 7.5, fontWeight: 700, letterSpacing: '0.07em', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>SVRE = Severe Tstorm risk · COND = conditional</span>
            </div>

            {/* Hazards card */}
            {visibleHazards.length > 0 && (() => { const compact = visibleHazards.length >= 4; return (
              <div style={{ ...glass({ padding: compact ? '10px 11px' : '8px 10px', borderRadius: 14, alignSelf: 'flex-start', width: 170 }, exportMode) }}>
                <GlassSheen />
                <span style={{ position: 'relative', zIndex: 1, display: 'block', marginBottom: 9, paddingBottom: 7, borderBottom: '1px solid rgba(255,255,255,0.10)', fontSize: 9, fontWeight: 800, letterSpacing: '0.22em', color: 'rgba(148,163,184,0.95)', textTransform: 'uppercase' }}>Hazards</span>
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {visibleHazards.map(h => { const HIcon = h.Icon; return (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 9px', borderRadius: 10, background: h.hatched ? 'repeating-linear-gradient(45deg, rgba(0,0,0,0.5) 0 6px, rgba(49,46,129,0.4) 6px 12px)' : `linear-gradient(90deg, ${h.color}28 0%, ${h.color}12 100%)`, border: `1px solid ${h.color}55`, borderLeft: `4px solid ${h.color}` }}>
                      <div style={{ width: 26, height: 26, borderRadius: 9, flexShrink: 0, background: `linear-gradient(135deg, ${h.color}, ${h.color}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 2px 8px ${h.color}55` }}>
                        {h.customIcon === 'hail' ? <HailIcon size={15} color="#fff" /> : h.customIcon === 'flood' ? <FloodHouseIcon size={15} color="#fff" /> : HIcon ? <HIcon style={{ width: 14, height: 14, color: '#fff' }} strokeWidth={2.4} /> : null}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', lineHeight: 1.15, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{h.label}</span>
                      {hazardPct[h.id] != null && (<span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'baseline', gap: 1, padding: '2px 7px', borderRadius: 999, background: `${h.color}26`, border: `1px solid ${h.color}80` }}><span style={{ fontSize: 12.5, fontWeight: 800, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{hazardPct[h.id]}</span><span style={{ fontSize: 8.5, fontWeight: 800, color: 'rgba(255,255,255,0.75)' }}>%</span></span>)}
                    </div>
                  ); })}
                </div>
              </div>
            ); })()}
          </div>

          {/* MAP + DRAWING (always full UK — no region zoom) */}
          <div ref={mapWrapRef} onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp} onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp}
            style={{ position: 'absolute', top: 20, left: '50%', marginLeft: -130, width: 450, height: 666, zIndex: 3, cursor: drawStyle === 'points' ? 'pointer' : 'crosshair', userSelect: 'none', touchAction: drawStyle === 'freehand' ? 'none' : 'auto', borderRadius: 12, overflow: 'hidden' }}>
            <UKOutlineMap />
            <CountyLinesLayer opacity={0.5} />
            {showShapes && (
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }}>
                <defs><pattern id="severeHatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="#312e81" strokeWidth="4" strokeOpacity="0.85" /></pattern></defs>
                {shapes.map((s, i) => { const m = LEVEL_LOOKUP[s.riskLevel] || activeMeta; const severe = isSevereId(s.riskLevel); const condSevere = isCondSevereId(s.riskLevel); const pathD = shapePaths[i]; return (
                  <g key={i}>
                    {condSevere && <path d={pathD} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="12 9" />}
                    {severe && <path d={pathD} fill="url(#severeHatch)" stroke="none" />}
                    <path d={pathD} fill={severe ? 'none' : m.fill} stroke={darkenColor(m.border, 0.2)} strokeWidth={severe ? 6 : condSevere ? 5.5 : 4} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={condSevere ? '12 9' : 'none'} />
                  </g>
                ); })}
                {currentPath.length > 0 && (() => {
                  const d = drawStyle === 'points' ? pointsToStraightPath(currentPath) : pointsToPath(currentPath);
                  return (<>
                    <path d={d} fill={currentPath.length >= 3 ? activeMeta.fill : 'none'} stroke={activeMeta.border} strokeWidth={3} strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
                    {drawStyle === 'points' && currentPath.map((p, i) => (<circle key={i} cx={p[0] * 1000} cy={p[1] * 1000} r={currentPath.length >= 3 && i === 0 ? 9 : 6} fill={i === 0 && currentPath.length >= 3 ? activeMeta.border : '#fff'} stroke={activeMeta.border} strokeWidth={2} />))}
                  </>);
                })()}
              </svg>
            )}
            {showCities && <CityMarkersLayer />}
          </div>

          {/* FOOTER */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 5, padding: '13px 18px 17px', borderTop: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(0deg, rgba(8,12,24,0.96) 0%, rgba(8,12,24,0.80) 65%, rgba(8,12,24,0.30) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {customLogoUrl
                ? <img src={customLogoUrl} alt="logo" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.18)' }} />
                : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#5b6ee8', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.18)' }}><CloudLightning style={{ width: 16, height: 16, color: '#fff' }} /></div>}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.01em' }}>{handle}</span>
                <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(148,163,184,0.85)', letterSpacing: '0.20em', textTransform: 'uppercase', marginTop: 1 }}>{version}</span>
                {/* Non-removable studio watermark */}
                <span style={{ fontSize: 7.5, fontWeight: 800, color: 'rgba(125,140,232,0.95)', letterSpacing: '0.10em', textTransform: 'uppercase', marginTop: 2 }}>Made in @MyWeatherUK Graphic Studio</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginRight: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(203,213,225,0.85)', letterSpacing: '0.04em', lineHeight: 1.45, textAlign: 'right' }}>{footerText}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', background: forecastType === 'update' ? 'rgba(56,189,248,0.18)' : 'rgba(74,222,128,0.16)', color: forecastType === 'update' ? 'rgba(186,230,253,0.95)' : 'rgba(187,247,208,0.95)', border: `1px solid ${forecastType === 'update' ? 'rgba(56,189,248,0.40)' : 'rgba(74,222,128,0.38)'}` }}>{forecastLabel}</span>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'rgba(148,163,184,0.14)', color: 'rgba(226,232,240,0.92)', border: '1px solid rgba(148,163,184,0.30)' }}>Valid {new Date(validDate + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', background: 'rgba(91,110,232,0.18)', color: 'rgba(199,210,254,0.95)', border: '1px solid rgba(91,110,232,0.40)' }}>Issued {new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', hour12: false })} {tzAbbr}</span>
              </div>
              <span style={{ fontSize: 7.5, fontWeight: 800, color: 'rgba(252,211,77,0.9)', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'right', lineHeight: 1.4, marginTop: 2 }}>Not Official · Use for Guidance Only · Refer to Met Office Warnings</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={labelCss}>{label}</span>{children}</div>);
}