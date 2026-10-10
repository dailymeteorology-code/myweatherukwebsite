import React, { useEffect, useMemo, useState } from 'react';

// Shared UK + Ireland map primitives, layers and forecast hazard icons used by
// both the public Thunderstorm Studio tool and any other lean graphic builder.
// Extracted verbatim from the large StormOutlookGraphicTool so a smaller
// component can render the SAME detailed coastline / county lines / city
// markers without inlining ~500 lines of geo code.

export const VIEW_W = 302, VIEW_H = 458;

export const MAP_BBOX = { lonMin: -10.8, lonMax: 2.5, latMin: 49.5, latMax: 61.0 };

export const UK_REGIONS = [
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

export function projectPt(lon, lat) {
  const x = ((lon - MAP_BBOX.lonMin) / (MAP_BBOX.lonMax - MAP_BBOX.lonMin)) * VIEW_W;
  const y = ((Y_TOP - mercY(lat)) / (Y_TOP - Y_BOT)) * VIEW_H;
  return [x, y];
}

// Project a geographic [lat, lon] into normalised 0..1 drawing space.
export function latLonToNorm(lat, lon) {
  const [x, y] = projectPt(lon, lat);
  return [x / VIEW_W, y / VIEW_H];
}

const PROJ_SIG = [MAP_BBOX.lonMin, MAP_BBOX.lonMax, MAP_BBOX.latMin, MAP_BBOX.latMax, VIEW_W, VIEW_H].join('_');
const GEO_CACHE_KEY = 'sotg_uk_geo_paths_v3_' + PROJ_SIG;

const GEO_SOURCES = [
  ['https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/develop/countries/ireland.json'],
  ['https://raw.githubusercontent.com/georgique/world-geojson/master/countries/united_kingdom.json',
   'https://raw.githubusercontent.com/georgique/world-geojson/master/countries/ireland.json'],
  ['https://raw.githubusercontent.com/johan/world.geo.json/master/countries/GBR.geo.json',
   'https://raw.githubusercontent.com/johan/world.geo.json/master/countries/IRL.geo.json'],
];
const MIN_DETAIL_VERTICES = 800;

const COUNTY_IE_SOURCE = 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/ireland-counties.geojson';
const COUNTY_CACHE_KEY = 'sotg_uk_county_paths_v5_' + PROJ_SIG;
const COUNTY_MIN_GAP_PX = 1.2;
const COUNTY_MIN_VERTICES = 2000;

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
  for (const d of ds) { const m = d.match(/[ML]/g); if (m) n += m.length; }
  return n;
}

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

function decodeCountyGeoJSON(gj) {
  try {
    const feats = (gj && gj.features) || (gj && gj.geometry ? [gj] : []);
    const out = [];
    for (const f of feats) {
      const geom = f && f.geometry;
      if (!geom) continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : null;
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

let countyCache = null;
export function CountyLinesLayer({ opacity = 0.5, region = null }) {
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
          countyCache = ds; setPaths(ds);
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
      const nums = d.match(/-?\d+(?:\.\d+)?/g);
      if (!nums || nums.length < 4) return false;
      let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
      for (let i=0;i+1<nums.length;i+=2){const x=+nums[i],y=+nums[i+1];if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;}
      return mxx >= minX && mnx <= maxX && mxy >= minY && mny <= maxY;
    });
  }, [paths, region]);

  if (!shown) return null;
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
      <defs><clipPath id="countyLandClip">{land ? land.map((d, i) => <path key={i} d={d} />) : null}</clipPath></defs>
      <g fill="none" stroke="#000000" strokeWidth="0.5" strokeOpacity={opacity} clipPath="url(#countyLandClip)" strokeLinejoin="round" strokeLinecap="round">{shown.map((d, i) => <path key={i} d={d} />)}</g>
    </svg>
  );
}

let geoCache = null;
export function UKOutlineMap() {
  const [paths, setPaths] = useState(() => {
    if (geoCache) return geoCache;
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && countPathVertices(arr) >= MIN_DETAIL_VERTICES) { geoCache = arr; return arr; }
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
          const results = await Promise.all(urls.map(u => fetch(u).then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json(); })));
          const ds = [];
          for (const gj of results) { const feats = gj.features || [gj]; for (const f of feats) if (f.geometry) ds.push(geoToPath(f.geometry)); }
          if (!ds.length) continue;
          const detail = countPathVertices(ds);
          if (detail > (best ? countPathVertices(best) : 0)) best = ds;
          if (detail >= MIN_DETAIL_VERTICES) {
            if (cancelled) return;
            geoCache = ds; setPaths(ds);
            try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(ds)); } catch { /* quota */ }
            return;
          }
        } catch { /* try next source */ }
      }
      if (!cancelled && best) { geoCache = best; setPaths(best); }
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
      </defs>
      {paths && (
        <g filter="url(#landShadow)">
          {paths.map((d, i) => (<path key={i} d={d} fill="url(#landFill)" stroke="#000" strokeWidth="1.5" />))}
        </g>
      )}
      {!paths && (
        <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle"
          fill="rgba(255,255,255,0.5)" fontSize="13" fontFamily="monospace">loading map...</text>
      )}
    </svg>
  );
}

export const STORM_BG_URL = 'https://media.base44.com/images/public/69945c97e07811f2b5427aa6/fd5fe1cb8_generated_image.png';

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
];

export function CityMarkersLayer() {
  const pool = CITY_MARKERS.filter(c => !c.regionOnly);
  const boxes = [], kept = [];
  const hit = (a, b, m = 1.4) => !(a.x2 + m < b.x1 || a.x1 - m > b.x2 || a.y2 + m < b.y1 || a.y1 - m > b.y2);
  for (const c of pool) {
    const [px, py] = projectPt(c.lon, c.lat);
    const flip = c.flip ?? (px > VIEW_W - 48);
    const fs = 7, off = 6, cw = fs * 0.56;
    const w = c.name.length * cw, h = fs * 1.15;
    let bx, by;
    if (c.up)      { bx = px - w / 2;   by = py - off - h; }
    else if (flip) { bx = px - off - w; by = py - h * 0.55; }
    else           { bx = px + off;     by = py - h * 0.55; }
    const box = { x1: Math.min(bx, px - 4), y1: Math.min(by, py - 4), x2: Math.max(bx + w, px + 4), y2: Math.max(by + h, py + 4) };
    if (boxes.some(b => hit(box, b))) continue;
    boxes.push(box);
    kept.push({ c, x: px, y: py, flip });
  }
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 4 }}>
      {kept.map(({ c, x, y, flip }) => (
        <g key={c.name}>
          <circle cx={x} cy={y} r={3.5} fill="none" stroke="#000" strokeWidth={1.1} opacity={0.9} />
          <circle cx={x} cy={y} r={1.7} fill="#111827" stroke="#fff" strokeWidth={0.8} />
          <text x={c.up ? x : (flip ? x - 6 : x + 6)} y={c.up ? y - 6 : y + 2.6} fontSize={7} fontWeight={800}
            textAnchor={c.up ? 'middle' : (flip ? 'end' : 'start')}
            fontFamily="'Archivo','DM Sans',sans-serif" fill="#111827"
            stroke="#ffffff" strokeWidth={2} paintOrder="stroke" strokeLinejoin="round">
            {c.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function HailIcon({ size = 12, color = '#22d3ee' }) {
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

export function FloodHouseIcon({ size = 12, color = '#3b82f6' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 12 L12 4 L21 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 12 L5 20 L19 20 L19 12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 16 Q7 15 9 16 Q11 17 13 16 Q15 15 17 16 Q18.5 16.7 19 17 L19 20 L5 20 Z" fill={color} opacity="0.85"/>
      <path d="M5 16 Q7 15 9 16 Q11 17 13 16 Q15 15 17 16 Q18.5 16.7 19 17" stroke="#93c5fd" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}