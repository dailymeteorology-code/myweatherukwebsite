// Module-level constants, helpers and map layers for StormOutlookGraphicTool,
// extracted so the graphic-tool component file stays under the editor line cap.
// Everything here is self-contained (only React hooks, lucide icons and the
// canonical risk config are imported) and exported back to the component.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CloudLightning, Tornado, AlertTriangle, CloudRain, CloudDrizzle, CloudRainWind } from 'lucide-react';
import { RISK_META, RISK_PALETTES, LEVEL_RANGE } from '@/components/tcm/riskConfig';
import { base44 } from '@/api/base44Client';

// --- Conditional Severe -----------------------------------------------------
const COND_SEVERE_ID = 'Conditional Severe';
const COND_SEVERE_COLOR = '#0b0f1a';
const COND_SEVERE = {
  id: COND_SEVERE_ID,
  short: 'COND SVRE',
  range: 'COND SVR',
  color: COND_SEVERE_COLOR,
  fill: 'rgba(200,205,215,0.18)',
  border: COND_SEVERE_COLOR,
};

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

const GRAPHIC_LEVELS_BASE = RISK_META
  .filter(r => r.level !== 'No Risk')
  .map(r => {
    let [lo, hi] = LEVEL_RANGE[r.level] || [0, 0];
    if (r.level === 'High') hi = 100;
    const pal = RISK_PALETTES.thunderstorm[r.level];
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
const isSevereId = (id) => id === 'Severe';
const isCondSevereId = (id) => id === COND_SEVERE_ID;

const RADAR_LEVELS = [
  { id: 'TraceRain',   short: 'TRACE',      range: '0.1-0.3 mm/h', dbz: '5-14 dBZ',  color: '#cec087' },
  { id: 'LightRain',   short: 'V.LIGHT',    range: '0.3-0.6 mm/h', dbz: '15-19 dBZ', color: '#88ddee' },
  { id: 'ModRain',     short: 'LIGHT',      range: '0.6-1.2 mm/h', dbz: '20-24 dBZ', color: '#00a3e0' },
  { id: 'HeavyRain',   short: 'MODERATE',   range: '1.3-2.4 mm/h', dbz: '25-29 dBZ', color: '#0077aa' },
  { id: 'VHeavyRain',  short: 'HEAVY',      range: '2.7-5 mm/h',   dbz: '30-34 dBZ', color: '#004a70' },
  { id: 'IntenseRain', short: 'V.HEAVY',    range: '5.6-10 mm/h',  dbz: '35-39 dBZ', color: '#ffc500' },
  { id: 'TorrRain',    short: 'INTENSE',    range: '11-20 mm/h',   dbz: '40-44 dBZ', color: '#ff8100' },
  { id: 'ExtremeRain', short: 'TORRENTIAL', range: '24-86 mm/h',   dbz: '45-54 dBZ', color: '#cd0d00' },
  { id: 'HailCore',    short: 'HAIL',       range: 'Hail / extreme', dbz: '55+ dBZ', color: '#ff77ff' },
].map(l => ({ ...l, fill: `${l.color}66`, border: l.color }));
const RADAR_BY_ID = Object.fromEntries(RADAR_LEVELS.map(l => [l.id, l]));
const LEVEL_LOOKUP = { ...RADAR_BY_ID, ...RISK_BY_ID };

const RADAR_HAZARDS = [
  { id: 'heavyrain',    label: 'Heavy Rain',    Icon: CloudRain,      color: '#3b82f6', hatched: false },
  { id: 'showers',      label: 'Showers',       Icon: CloudDrizzle,   color: '#7dd3fc', hatched: false },
  { id: 'thunder',      label: 'Thunderstorms', Icon: CloudLightning, color: '#facc15', hatched: false },
  { id: 'heavyshowers', label: 'Heavy Showers', Icon: CloudRainWind,  color: '#22d3ee', hatched: false },
];

const TIMELINE_PRESETS = {
  '3h': ['06', '09', '12', '15', '18', '21', '00', '03', '06'],
  '2h': ['06', '08', '10', '12', '14', '16', '18', '20', '22', '00', '02', '04', '06'],
  '1h': ['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18',
         '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06'],
};
const buildStamps = (gran) => (TIMELINE_PRESETS[gran] || TIMELINE_PRESETS['3h']).map(label => ({ label }));
const TIMELINE_STAMPS = buildStamps('3h');

const CONFIDENCE_STEPS = 5;
const CONFIDENCE_LEVELS = [
  { id: 'very-low',  label: 'Very Low',  short: 'V.LOW',  bars: 1, color: '#f87171' },
  { id: 'low',       label: 'Low',       short: 'LOW',    bars: 2, color: '#fb923c' },
  { id: 'medium',    label: 'Medium',    short: 'MEDIUM', bars: 3, color: '#facc15' },
  { id: 'high',      label: 'High',      short: 'HIGH',   bars: 4, color: '#4ade80' },
  { id: 'very-high', label: 'Very High', short: 'V.HIGH', bars: 5, color: '#22c55e' },
];
const CONFIDENCE_BY_ID = Object.fromEntries(CONFIDENCE_LEVELS.map(c => [c.id, c]));

const ANNOTATION_COLORS = ['#ffffff', '#fde047', '#f87171', '#38bdf8', '#a78bfa', '#4ade80', '#fb923c', '#111827'];
const ANNOTATION_SIZES = [
  { id: 'sm', label: 'S', px: 13 },
  { id: 'md', label: 'M', px: 17 },
  { id: 'lg', label: 'L', px: 22 },
];
const ANNOTATION_SIZE_PX = Object.fromEntries(ANNOTATION_SIZES.map(s => [s.id, s.px]));

const VIEW_W = 302, VIEW_H = 458;
const GRAPHIC_W = 640, GRAPHIC_H = 760;

function latLonToNorm(lat, lon) {
  const [x, y] = projectPt(lon, lat);
  return [x / VIEW_W, y / VIEW_H];
}

const HAZARDS = [
  { id: 'lightning', label: 'High Lightning', Icon: CloudLightning, color: '#ec4899', hatched: false },
  { id: 'hail',      label: 'Large Hail',     Icon: null,           color: '#22d3ee', hatched: false, customIcon: 'hail' },
  { id: 'flood',     label: 'Flash Flooding', Icon: null,           color: '#3b82f6', hatched: false, customIcon: 'flood' },
  { id: 'tornado',   label: 'Tornado',        Icon: Tornado,        color: '#f97316', hatched: false },
  { id: 'severe',    label: 'Severe',         Icon: AlertTriangle,  color: '#a5b4fc', hatched: true  },
];

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

const MAP_BBOX = { lonMin: -10.8, lonMax: 2.5, latMin: 49.5, latMax: 61.0 };

const UK_REGIONS = [
  { id: 'uk',       label: 'UK Wide',       bbox: { lonMin: -10.8, lonMax: 2.5,  latMin: 49.5, latMax: 61.0 } },
  { id: 'south',    label: 'South England',  bbox: { lonMin: -5.8,  lonMax: 1.8,  latMin: 50.0, latMax: 52.5 } },
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

const PROJ_SIG = [
  MAP_BBOX.lonMin, MAP_BBOX.lonMax, MAP_BBOX.latMin, MAP_BBOX.latMax, VIEW_W, VIEW_H,
].join('_');
const GEO_CACHE_KEY = 'sotg_uk_geo_paths_v3_' + PROJ_SIG;

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

function countPathVertices(ds) {
  let n = 0;
  for (const d of ds) {
    const m = d.match(/[ML]/g);
    if (m) n += m.length;
  }
  return n;
}

const COUNTY_IE_SOURCE = 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/ireland-counties.geojson';
const COUNTY_CACHE_KEY = 'sotg_uk_county_paths_v5_' + PROJ_SIG;
const COUNTY_MIN_GAP_PX = 1.2;
const COUNTY_MIN_VERTICES = 2000;

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

function decodeCountyTopo(topo) {
  try {
    const t = topo && topo.transform;
    const obj = topo && topo.objects && Object.values(topo.objects)[0];
    if (!t || !obj || !Array.isArray(topo.arcs)) return [];
    const [sx, sy] = t.scale, [tx, ty] = t.translate;
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

async function loadAllCountyPaths() {
  const ukP = fetchJSON('https://raw.githubusercontent.com/evansd/uk-ceremonial-counties/master/uk-ceremonial-counties.geojson').then(decodeCountyGeoJSON).catch(() => []);
  const ieP = fetchJSON(COUNTY_IE_SOURCE).then(decodeCountyGeoJSON).catch(() => []);
  const [uk, ie] = await Promise.all([ukP, ieP]);
  return [...uk, ...ie];
}

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
function CountyLinesLayer({ opacity = 0.5, region = null }) {
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

  const [land, setLand] = useState(geoCache);
  useEffect(() => {
    if (!geoCache) { const t = setInterval(() => { if (geoCache) { setLand(geoCache); clearInterval(t); } }, 150); return () => clearInterval(t); }
  }, []);

  const shown = useMemo(() => {
    if (!paths) return null;
    if (!region) return paths;
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
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
      <defs><clipPath id="countyLandClip">{land ? land.map((d, i) => <path key={i} d={d} />) : null}</clipPath>{region && (() => { const c = regionClipRect(region); return <clipPath id="countyRegionClip"><rect x={c.x} y={c.y} width={c.w} height={c.h} /></clipPath>; })()}</defs>
      <g fill="none" stroke="#000000" strokeWidth="0.5" strokeOpacity={opacity} clipPath="url(#countyLandClip)" strokeLinejoin="round" strokeLinecap="round"><g clipPath={region ? 'url(#countyRegionClip)' : undefined}>{shown.map((d, i) => <path key={i} d={d} />)}</g></g>
    </svg>
  );
}

let geoCache = null;
function UKOutlineMap({ region = null }) {
  const [paths, setPaths] = useState(() => {
    if (geoCache) return geoCache;
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
    if (geoCache && countPathVertices(geoCache) >= MIN_DETAIL_VERTICES) return;
    let cancelled = false;
    (async () => {
      let best = null;
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
          if (detail >= MIN_DETAIL_VERTICES) {
            if (cancelled) return;
            geoCache = ds;
            setPaths(ds);
            try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(ds)); } catch { /* quota */ }
            return;
          }
        } catch { /* try next source */ }
      }
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
        {region && (() => { const clip = regionClipRect(region); return <clipPath id="landRegionClip"><rect x={clip.x} y={clip.y} width={clip.w} height={clip.h} /></clipPath>; })()}
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

const STORM_BG_URL = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/fd5fe1cb8_generated_image.png';

const CITY_MARKERS = [
  { name: 'London',      lon: -0.13, lat: 51.51 },
  { name: 'Luton',       lon: -0.42, lat: 51.88, flip: true },
  { name: 'Birmingham',  lon: -1.90, lat: 52.48 },
  { name: 'Manchester',  lon: -2.24, lat: 53.48 },
  { name: 'Newcastle',   lon: -1.61, lat: 54.98 },
  { name: 'Norwich',     lon: 1.30,  lat: 52.63, up: true },
  { name: 'Bristol',     lon: -2.59, lat: 51.45 },
  { name: 'Plymouth',    lon: -4.14, lat: 50.37 },
  { name: 'Cardiff',     lon: -3.18, lat: 51.48, up: true },
  { name: 'Aberystwyth', lon: -4.08, lat: 52.41, flip: true },
  { name: 'Wrexham',     lon: -2.99, lat: 53.05, flip: true },
  { name: 'Glasgow',     lon: -4.25, lat: 55.86, flip: true },
  { name: 'Edinburgh',   lon: -3.19, lat: 55.95 },
  { name: 'Aberdeen',    lon: -2.10, lat: 57.15 },
  { name: 'Inverness',   lon: -4.22, lat: 57.48 },
  { name: 'Fort William', lon: -5.11, lat: 56.82, flip: true },
  { name: 'Wick',        lon: -3.09, lat: 58.44 },
  { name: 'Belfast',     lon: -5.93, lat: 54.60 },
  { name: 'Derry',       lon: -7.32, lat: 54.99, flip: true },
  { name: 'Dublin',      lon: -6.26, lat: 53.35 },
  { name: 'Galway',      lon: -9.05, lat: 53.27, flip: true },
  { name: 'Limerick',    lon: -8.62, lat: 52.66, flip: true },
  { name: 'Cork',        lon: -8.47, lat: 51.90, flip: true },
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
  { name: 'Swansea',     lon: -3.94, lat: 51.62, flip: true, regionOnly: true },
  { name: 'Bangor',      lon: -4.13, lat: 53.23, flip: true, regionOnly: true },
  { name: 'Perth',       lon: -3.44, lat: 56.40, regionOnly: true },
  { name: 'Stirling',    lon: -3.94, lat: 56.12, flip: true, regionOnly: true },
  { name: 'Oban',        lon: -5.47, lat: 56.42, flip: true, regionOnly: true },
  { name: 'Stornoway',   lon: -6.39, lat: 58.21, flip: true, regionOnly: true },
  { name: 'Waterford',   lon: -7.11, lat: 52.26, regionOnly: true },
  { name: 'Sligo',       lon: -8.48, lat: 54.27, flip: true, regionOnly: true },
  { name: 'Killarney',   lon: -9.52, lat: 52.06, flip: true, regionOnly: true },
];

function CityMarkersLayer({ region = null, k = 1 }) {
  const pad = 0.4;
  const pool = region
    ? CITY_MARKERS.filter(c =>
        c.lat >= region.latMin - pad && c.lat <= region.latMax + pad &&
        c.lon >= region.lonMin - pad && c.lon <= region.lonMax + pad)
    : CITY_MARKERS.filter(c => !c.regionOnly);

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

function RadarOverlayLayer({ opacity = 0.85, bbox = MAP_BBOX }) {
  const bboxKey = `${bbox.lonMin}-${bbox.lonMax}-${bbox.latMin}-${bbox.latMax}`;
  const [tiles, setTiles] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const meta = await fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json());
        const frames = meta?.radar?.past || [];
        const frame = frames[frames.length - 1];
        if (!frame) return;
        const z = 6, n = 2 ** z;
        const lon2x = lon => ((lon + 180) / 360) * n;
        const lat2y = lat => ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * n;
        const xMin = Math.floor(lon2x(bbox.lonMin)), xMax = Math.floor(lon2x(bbox.lonMax));
        const yMin = Math.floor(lat2y(bbox.latMax)), yMax = Math.floor(lat2y(bbox.latMin));
        const out = [];
        for (let x = xMin; x <= xMax; x++) {
          for (let y = yMin; y <= yMax; y++) {
            const lonW = (x / n) * 360 - 180, lonE = ((x + 1) / n) * 360 - 180;
            const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
            const latS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
            const [px, py] = projectPt(lonW, latN);
            const [px2, py2] = projectPt(lonE, latS);
            out.push({
              url: `${meta.host}${frame.path}/256/${z}/${x}/${y}/2/1_1.png`,
              x: px, y: py, w: px2 - px, h: py2 - py,
            });
          }
        }
        setTiles(out);
      } catch { /* radar unavailable - just skip the overlay */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey]);
  if (!tiles) return null;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {tiles.map((t, i) => (
        <image key={i} href={t.url} x={t.x} y={t.y} width={t.w} height={t.h}
          opacity={opacity} preserveAspectRatio="none" crossOrigin="anonymous" />
      ))}
    </svg>
  );
}

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
  const { fillD, outlineD } = useMemo(() => {
    if (!strikes || !strikes.length) return { fillD: '', outlineD: '' };
    const r = 2.4;
    const ro = r + 1.1;
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

function strikeTimeMs(t) {
  if (t == null) return NaN;
  if (typeof t === 'string') {
    const n = Number(t);
    if (Number.isFinite(n)) return strikeTimeMs(n);
    const parsed = Date.parse(t);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (t > 1e15) return Math.round(t / 1e6);
  if (t > 1e12) return t;
  return t * 1000;
}

function extractStrike(item) {
  if (item == null) return null;
  if (Array.isArray(item)) {
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

function unwrapStrikeArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const k of ['strikes', 'data', 'items', 'list', 'today', 'points', 'features', 'results']) {
      if (Array.isArray(parsed[k])) return parsed[k];
    }
  }
  return [];
}

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

const MIN_DETAIL_VERTICES = 800;
const GEO_SOURCES = [
  ['https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/ireland.json'],
  ['https://raw.githubusercontent.com/georgique/world-geojson/master/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/master/countries/ireland.json'],
  ['https://raw.githubusercontent.com/johan/world.geo.json/master/countries/GBR.geo.json',
   'https://raw.githubusercontent.com/johan/world.geo.json/master/countries/IRL.geo.json'],
];

// --- Lightning overlay hook (today's strikes + live Blitzortung feed) --------
// Extracted from StormOutlookGraphicTool so the graphic-tool component stays
// under the editor line cap. Owns the strike store, the live socket and the
// rolling 24h window; the colour/outline/window settings stay component-owned
// (persisted via captureState) and are passed in.
export function useStormLightning({
  lightningWindow, setLightningWindow, windowMinutes, setWindowMinutes,
}) {
  const [showLightning, setShowLightning] = useState(false);
  const [strikes, setStrikes] = useState(null);
  const [loadingStrikes, setLoadingStrikes] = useState(false);
  const [lightningError, setLightningError] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);

  const strikeStoreRef = useRef(new Map());
  const flushTimerRef = useRef(null);
  const showLightningRef = useRef(false);
  const liveStopRef = useRef(null);
  const liveDirtyRef = useRef(false);

  const inUKIreland = (lat, lon) =>
    lon >= MAP_BBOX.lonMin && lon <= MAP_BBOX.lonMax &&
    lat >= MAP_BBOX.latMin && lat <= MAP_BBOX.latMax;

  const addStrike = (lat, lon, rawT) => {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (!inUKIreland(lat, lon)) return false;
    const tMs = strikeTimeMs(rawT) || Date.now();
    const key = `${Math.round(tMs / 1000)}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
    if (strikeStoreRef.current.has(key)) return false;
    strikeStoreRef.current.set(key, { lat, lon, t: tMs });
    return true;
  };

  const flushStrikes = () => {
    const all = Array.from(strikeStoreRef.current.values());
    const nowMs = Date.now();
    if (!lightningWindow) {
      const todayStartMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
      setStrikes(all.filter(s => s.t >= todayStartMs));
      return;
    }
    const startMs = nowMs - windowMinutes * 60_000;
    setStrikes(all.filter(s => s.t >= startMs && s.t <= nowMs));
  };

  const seedTodayBackfill = async () => {
    let added = 0;
    const RENDER_WORKER_RECENT = 'https://blitzortungworker-3.onrender.com/strikes';   // { count, serverTime, strikes }
    const todayDateStr = new Date().toISOString().slice(0, 10);
    const ydayDateStr  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const safe = async (fn) => { try { return await fn(); } catch { return []; } };
    const [ukRes, euRes, renderRes, archiveRes, ukYRes, euYRes, archiveYRes] = await Promise.allSettled([
      safe(() => base44.functions.invoke('historicalLightning', { region: 'uk', daysBack: 0 })),
      safe(() => base44.functions.invoke('historicalLightning', { region: 'europe', daysBack: 0 })),
      safe(() => fetch(RENDER_WORKER_RECENT).then(r => (r.ok ? r.json() : [])).then(b => (Array.isArray(b) ? b : b?.strikes || []))),
      safe(() => base44.entities.LightningArchive.filter({ date: todayDateStr })),
      safe(() => base44.functions.invoke('historicalLightning', { region: 'uk', daysBack: 1 })),
      safe(() => base44.functions.invoke('historicalLightning', { region: 'europe', daysBack: 1 })),
      safe(() => base44.entities.LightningArchive.filter({ date: ydayDateStr })),
    ]);
    try {
      const ukStrikes = ukRes.status === 'fulfilled' ? (ukRes.value?.data?.strikes || ukRes.value?.strikes || []) : [];
      const euStrikes = euRes.status === 'fulfilled' ? (euRes.value?.data?.strikes || euRes.value?.strikes || []) : [];
      const rdStrikes = renderRes.status === 'fulfilled' && Array.isArray(renderRes.value) ? renderRes.value : [];
      const ukYStrikes = ukYRes.status === 'fulfilled' ? (ukYRes.value?.data?.strikes || ukYRes.value?.strikes || []) : [];
      const euYStrikes = euYRes.status === 'fulfilled' ? (euYRes.value?.data?.strikes || euYRes.value?.strikes || []) : [];
      const archiveStrikes = archiveRes.status === 'fulfilled' && Array.isArray(archiveRes.value)
        ? archiveRes.value.flatMap(r => (r?.strikes || [])) : [];
      const archiveYStrikes = archiveYRes.status === 'fulfilled' && Array.isArray(archiveYRes.value)
        ? archiveYRes.value.flatMap(r => (r?.strikes || [])) : [];
      const cutoff24 = Date.now() - 24 * 60 * 60 * 1000;
      const ydayRecent = [...ukYStrikes, ...euYStrikes, ...archiveYStrikes]
        .filter(s => s && strikeTimeMs(s.time ?? s.t) >= cutoff24);
      const dbStrikes = [...ukStrikes, ...euStrikes, ...rdStrikes, ...archiveStrikes, ...ydayRecent];
      let dbAdded = 0;
      for (const s of dbStrikes) {
        const e = extractStrike(s);
        if (e && addStrike(e.lat, e.lon, e.t)) dbAdded++;
      }
      added += dbAdded;
      console.log('[Lightning] backfill: uk', ukStrikes.length, '+ eu', euStrikes.length, '+ render', rdStrikes.length, '+ archive', archiveStrikes.length, '| yesterday last24h', ydayRecent.length, '=', dbStrikes.length, 'loaded,', dbAdded, 'added');
    } catch (dbErr) {
      console.warn('[Lightning] DB backfill failed:', dbErr?.message);
    }
    try {
      const { loadTodayStrikes } = await import('@/components/tcm/strikeStorage');
      const todayStrikes = loadTodayStrikes();
      for (const s of todayStrikes) { if (addStrike(s.lat, s.lon, s.time ?? s.t)) added++; }
      console.log('[Lightning] backfill from TCM cache:', todayStrikes.length, 'loaded,', added, 'added');
    } catch (err) {
      console.warn('[Lightning] strikeStorage import failed, trying raw localStorage', err);
      const lsKeys = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && /lightn|strike|blitz/i.test(k)) lsKeys.push(k);
        }
      } catch { /* noop */ }
      for (const k of ['tcm_lightning_strikes_today', 'tcm_today_strikes', 'tcm_lightning_strikes']) {
        if (!lsKeys.includes(k)) lsKeys.push(k);
      }
      for (const k of lsKeys) {
        try {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const arr = unwrapStrikeArray(JSON.parse(raw));
          for (const item of arr) {
            const e = extractStrike(item);
            if (e && addStrike(e.lat, e.lon, e.t)) added++;
          }
        } catch { /* noop */ }
      }
    }
    console.log('[Lightning] backfill complete, total UK strikes added:', added, '| store size:', strikeStoreRef.current.size);
  };

  const stopLightning = () => {
    showLightningRef.current = false;
    if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null; }
    if (liveStopRef.current) { try { liveStopRef.current(); } catch {} liveStopRef.current = null; }
    setLiveStatus(null);
  };

  const startLiveFeed = async () => {
    if (liveStopRef.current) return;
    try {
      const { connectBlitzortung } = await import('@/components/tcm/connectBlitzortung');
      if (!showLightningRef.current) return;
      setLiveStatus('connecting');
      liveStopRef.current = connectBlitzortung(
        (s) => { if (!showLightningRef.current) return; if (addStrike(s.lat, s.lon, s.time)) liveDirtyRef.current = true; },
        (status) => setLiveStatus(status),
      );
    } catch (err) {
      console.warn('[Lightning] live feed unavailable:', err?.message);
      setLiveStatus('unavailable');
    }
  };

  const toggleLightning = async () => {
    if (showLightning) { setShowLightning(false); stopLightning(); return; }
    setShowLightning(true);
    showLightningRef.current = true;
    setLoadingStrikes(true);
    setLightningError(null);
    strikeStoreRef.current = new Map();
    setStrikes([]);
    try {
      await seedTodayBackfill();
      flushStrikes();
      if (strikeStoreRef.current.size === 0) setLightningError('No stored strikes for today yet — waiting on the live feed.');
    } catch (err) {
      setLightningError(err?.message || 'Strike load failed — live feed only.');
    } finally {
      setLoadingStrikes(false);
    }
    startLiveFeed();
  };

  const refreshLightning = async () => {
    if (!showLightning || loadingStrikes) return;
    setLoadingStrikes(true);
    setLightningError(null);
    try {
      await seedTodayBackfill();
      flushStrikes();
    } catch (err) {
      setLightningError(err?.message || 'Refresh failed.');
    } finally {
      setLoadingStrikes(false);
    }
    startLiveFeed();
  };

  useEffect(() => () => stopLightning(), []);

  useEffect(() => {
    if (!showLightning) return;
    flushStrikes();
    const iv = setInterval(() => {
      if (liveDirtyRef.current || lightningWindow) { liveDirtyRef.current = false; flushStrikes(); }
    }, 5_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLightning, lightningWindow, windowMinutes]);

  useEffect(() => {
    if (!showLightning || !lightningWindow) return;
    let cancelled = false;
    (async () => {
      setLoadingStrikes(true);
      await seedTodayBackfill();
      if (cancelled) return;
      setLoadingStrikes(false);
      flushStrikes();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLightning, lightningWindow]);

  const lightningStats = useMemo(() => {
    const list = Array.isArray(strikes) ? strikes : [];
    if (!list.length) return { count: 0, peakHour: null, peakCount: 0 };
    const buckets = new Array(24).fill(0);
    for (const s of list) { const h = new Date(s.t ?? s.time).getHours(); if (h >= 0 && h < 24) buckets[h]++; }
    let peakHour = 0, peakCount = -1;
    buckets.forEach((c, h) => { if (c > peakCount) { peakCount = c; peakHour = h; } });
    return { count: list.length, peakHour, peakCount };
  }, [strikes]);

  const tzAbbr = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(new Date());
      return parts.find(p => p.type === 'timeZoneName')?.value || '';
    } catch { return ''; }
  }, []);
  const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;

  return {
    showLightning, setShowLightning, strikes, loadingStrikes, lightningError, liveStatus,
    toggleLightning, refreshLightning, lightningStats, fmtHour, tzAbbr, stopLightning,
  };
}

export {
  COND_SEVERE_ID, COND_SEVERE_COLOR, COND_SEVERE, darkenColor, pointInPolygon,
  GRAPHIC_LEVELS_BASE, GRAPHIC_LEVELS, RISK_BY_ID, isSevereId, isCondSevereId,
  RADAR_LEVELS, RADAR_BY_ID, LEVEL_LOOKUP, RADAR_HAZARDS,
  TIMELINE_PRESETS, buildStamps, TIMELINE_STAMPS,
  CONFIDENCE_STEPS, CONFIDENCE_LEVELS, CONFIDENCE_BY_ID,
  ANNOTATION_COLORS, ANNOTATION_SIZES, ANNOTATION_SIZE_PX,
  VIEW_W, VIEW_H, GRAPHIC_W, GRAPHIC_H, latLonToNorm, HAZARDS, glass, GlassSheen,
  MAP_BBOX, UK_REGIONS, mercY, Y_TOP, Y_BOT, projectPt, PROJ_SIG, GEO_CACHE_KEY,
  regionClipRect, geoToPath, countPathVertices,
  COUNTY_IE_SOURCE, COUNTY_CACHE_KEY, COUNTY_MIN_GAP_PX, COUNTY_MIN_VERTICES,
  decimateRing, decodeCountyTopo, decodeCountyGeoJSON, fetchJSON, loadAllCountyPaths, pathProjBBox,
  countyCache, CountyLinesLayer, geoCache, UKOutlineMap,
  STORM_BG_URL, CITY_MARKERS, CityMarkersLayer, RadarOverlayLayer,
  LIGHTNING_SWATCHES, HailIcon, FloodHouseIcon, LightningLayer,
  strikeTimeMs, extractStrike, unwrapStrikeArray,
  decimatePoints, chaikinClosed, smoothPoints, pointsToPath, waitForImages,
  inputCss, labelCss, btnCss, MIN_DETAIL_VERTICES, GEO_SOURCES,
};