/* The Graphic Studio's map: one projection, the counties of the UK and Ireland by name, and the
   map views made from them.

   Every outlook graphic (thunderstorm, snow, wind) draws its map from here. A view is a set of
   counties. "UK & Ireland" is all of them, a preset (South West, Scotland, Ireland …) is a fixed
   list, and a custom view is whatever counties the forecaster ticks: Cornwall, Devon and Cork
   together, say. The chosen counties are the land, white with a black coast, and the land
   around them stays on the map in grey, so a regional graphic shows where it sits instead of
   being cut off at a straight edge. The map then zooms to the chosen counties.

   The counties (public/geo/uk-ie-counties.json, built from OS Boundary-Line and OSi data) are
   the UK ceremonial counties, Scotland's regions, Wales's preserved counties, the 26 counties of
   Ireland, the Isle of Man and the Channel Islands, simplified to about 120 m. Town labels come
   from public/geo/uk-ie-towns.json (OpenStreetMap places with their populations). */
import React, { useEffect, useId, useMemo, useState } from 'react';

/* ── projection ─────────────────────────────────────────────────────────────────────────────
   Web Mercator over MAP_BBOX into a VIEW_W x VIEW_H box. These bounds match the TCM page's
   GEO_BOUNDS_UK, which the lightning counts depend on: change both or neither. */
export const VIEW_W = 302, VIEW_H = 458;
export const MAP_BBOX = { lonMin: -10.8, lonMax: 2.5, latMin: 49.5, latMax: 61.0 };
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const Y_TOP = mercY(MAP_BBOX.latMax), Y_BOT = mercY(MAP_BBOX.latMin);

export function projectPt(lon, lat) {
  return [((lon - MAP_BBOX.lonMin) / (MAP_BBOX.lonMax - MAP_BBOX.lonMin)) * VIEW_W, ((Y_TOP - mercY(lat)) / (Y_TOP - Y_BOT)) * VIEW_H];
}
/** [lat, lon] -> the drawing space (the map box's 0..1). */
export function latLonToNorm(lat, lon) {
  const [x, y] = projectPt(lon, lat);
  return [x / VIEW_W, y / VIEW_H];
}

/* ── the counties ───────────────────────────────────────────────────────────────────────── */
export const COUNTRY_ORDER = ['England', 'Wales', 'Scotland', 'Northern Ireland', 'Ireland', 'Crown Dependencies'];

/* a ring's SVG path in view units, dropping vertices closer than `gap` to the last kept one */
function ringPath(ring, gap) {
  const pts = ring.map(([lo, la]) => projectPt(lo, la));
  const kept = [pts[0]];
  let last = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const dx = pts[i][0] - last[0], dy = pts[i][1] - last[1];
    if (dx * dx + dy * dy >= gap * gap) { kept.push(pts[i]); last = pts[i]; }
  }
  if (kept.length < 3) return '';
  return kept.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
}
const polysPath = (polys, gap) => polys.map((p) => p.map((r) => ringPath(r, gap)).join('')).join('');
const unflat = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };

let COUNTIES = null, countiesLoad = null;
function buildCounties(raw) {
  const areas = raw.areas.map((a) => {
    const polys = a.polys.map((poly) => poly.map(unflat));
    const [x0, y1] = projectPt(a.bbox[0], a.bbox[1]), [x1, y0] = projectPt(a.bbox[2], a.bbox[3]);
    return {
      id: a.id, name: a.name, group: a.group, country: a.country, bbox: a.bbox, polys,
      pbox: [x0, y0, x1, y1],
      fine: polysPath(polys, 0.06),     // zoomed in
      coarse: polysPath(polys, 0.45),   // the whole country: about one screen pixel
    };
  });
  const byId = Object.fromEntries(areas.map((a) => [a.id, a]));
  const groups = [];
  for (const a of areas) {
    let g = groups.find((x) => x.name === a.group);
    if (!g) { g = { name: a.group, country: a.country, ids: [] }; groups.push(g); }
    g.ids.push(a.id);
  }
  const context = raw.context.map((c) => { const polys = c.polys.map((p) => p.map(unflat)); return { id: c.id, polys, coarse: polysPath(polys, 0.45) }; });
  return { areas, byId, groups, context };
}
export function loadCounties() {
  if (COUNTIES) return Promise.resolve(COUNTIES);
  if (!countiesLoad) {
    countiesLoad = fetch('/geo/uk-ie-counties.json').then((r) => { if (!r.ok) throw new Error(`counties ${r.status}`); return r.json(); })
      .then((raw) => (COUNTIES = buildCounties(raw)))
      .catch((e) => { countiesLoad = null; throw e; });
  }
  return countiesLoad;
}
export function useCounties() {
  const [d, setD] = useState(COUNTIES);
  useEffect(() => { if (!d) { let live = true; loadCounties().then((x) => live && setD(x)).catch(() => {}); return () => { live = false; }; } return undefined; }, [d]);
  return d;
}

/* point in one area (even-odd over its rings, so lakes and enclaves are outside) */
export function inArea(a, lon, lat) {
  if (lon < a.bbox[0] || lon > a.bbox[2] || lat < a.bbox[1] || lat > a.bbox[3]) return false;
  for (const poly of a.polys) {
    let ins = false;
    for (const r of poly) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi) ins = !ins;
      }
    }
    if (ins) return true;
  }
  return false;
}

/* ── map views ───────────────────────────────────────────────────────────────────────────── */
/* Ids kept from the old region buttons ('uk', 'south', 'midlands', 'north', 'scotland',
   'ireland', 'wales') so saved graphics open on the view they were made with. */
export const MAP_PRESETS = [
  { id: 'uk', label: 'UK & Ireland' },
  { id: 'gb', label: 'Great Britain', countries: ['England', 'Wales', 'Scotland'] },
  { id: 'england', label: 'England', countries: ['England'] },
  { id: 'south', label: 'South England', groups: ['South West England', 'South East England', 'London'], areas: ['essex', 'hertfordshire', 'bedfordshire'] },
  { id: 'southwest', label: 'South West', groups: ['South West England'] },
  { id: 'southeast', label: 'South East & London', groups: ['South East England', 'London'] },
  { id: 'east', label: 'East of England', groups: ['East of England'] },
  { id: 'midlands', label: 'Midlands', groups: ['East Midlands', 'West Midlands'] },
  { id: 'north', label: 'North England', groups: ['North East England', 'North West England', 'Yorkshire & Humber'] },
  { id: 'wales', label: 'Wales', countries: ['Wales'] },
  { id: 'scotland', label: 'Scotland', countries: ['Scotland'] },
  { id: 'ni', label: 'Northern Ireland', countries: ['Northern Ireland'] },
  { id: 'ireland', label: 'Ireland', countries: ['Northern Ireland', 'Ireland'] },
  { id: 'roi', label: 'Republic of Ireland', countries: ['Ireland'] },
];
const PRESET_BY_ID = Object.fromEntries(MAP_PRESETS.map((p) => [p.id, p]));
export const presetLabel = (id) => PRESET_BY_ID[id]?.label || (id === 'custom' ? 'Custom' : 'UK & Ireland');

/** The ids a preset covers ('uk' and unknown ids: every area). */
export function presetIds(data, presetId) {
  const p = PRESET_BY_ID[presetId];
  if (!data) return [];
  if (!p || p.id === 'uk') return data.areas.map((a) => a.id);
  return data.areas.filter((a) => p.countries?.includes(a.country) || p.groups?.includes(a.group) || p.areas?.includes(a.id)).map((a) => a.id);
}

/** A map view: { whole, ids:Set, box (lon/lat), label }. `region` is a preset id or 'custom'. */
export function resolveView(data, region, custom = []) {
  if (!data) return null;
  if (region !== 'custom' && (!PRESET_BY_ID[region] || region === 'uk')) return { whole: true, ids: new Set(data.areas.map((a) => a.id)), box: null, label: 'UK & Ireland' };
  const list = region === 'custom' ? custom.filter((id) => data.byId[id]) : presetIds(data, region);
  if (!list.length) return { whole: true, ids: new Set(data.areas.map((a) => a.id)), box: null, label: 'UK & Ireland' };
  const box = { lonMin: 180, latMin: 90, lonMax: -180, latMax: -90 };
  for (const id of list) {
    const b = data.byId[id].bbox;
    box.lonMin = Math.min(box.lonMin, b[0]); box.latMin = Math.min(box.latMin, b[1]);
    box.lonMax = Math.max(box.lonMax, b[2]); box.latMax = Math.max(box.latMax, b[3]);
  }
  return { whole: false, ids: new Set(list), box, label: region === 'custom' ? `${list.length} ${list.length === 1 ? 'county' : 'counties'}` : presetLabel(region) };
}
export const viewContains = (data, view, lon, lat) => !view || view.whole || [...view.ids].some((id) => inArea(data.byId[id], lon, lat));

/** The zoom that frames a view's box in the map's W x H px box: a CSS transform about 0,0 and
    the same as k (scale) and cx, cy (the box centre in drawing space). */
export function viewZoom(view, { W = 450, H = 666, bottomInset = 0, maxK = 9 } = {}) {
  if (!view || view.whole || !view.box) return { transform: 'none', zoomed: false, k: 1, cx: 0.5, cy: 0.5 };
  const [x0, y0] = latLonToNorm(view.box.latMax, view.box.lonMin);
  const [x1, y1] = latLonToNorm(view.box.latMin, view.box.lonMax);
  const bw = Math.max(0.001, x1 - x0), bh = Math.max(0.001, y1 - y0);
  const usableH = (H - bottomInset) / H;
  const k = Math.min(maxK, Math.max(1, Math.min(0.88 / bw, (0.88 * usableH) / bh)));
  /* visible = 0.5 + (norm - c) * k. The box's middle goes to the middle of the part of the map
     above the bottom inset, which is the same as framing a centre a little lower. */
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + (0.5 - 0.5 * usableH) / k;
  const tx = W * (0.5 - cx * k), ty = H * (0.5 - cy * k);
  return { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(3)})`, zoomed: true, k, cx, cy };
}

/* ── the land ────────────────────────────────────────────────────────────────────────────── */
const svgFill = { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' };

/** The counties of a view as land: chosen ones white with a black coast and faint county
    lines, the rest (and the continent) grey. Strokes are divided by the zoom so lines keep
    their weight however far the view is zoomed. */
export function CountyLand({ data, view, k = 1, context = true, lineOpacity = 0.5, linesOnly = false, zIndex }) {
  const uid = useId().replace(/:/g, '');
  const lod = k >= 2.2 ? 'fine' : 'coarse';
  const sel = useMemo(() => (data && view ? data.areas.filter((a) => view.ids.has(a.id)) : []), [data, view]);
  const rest = useMemo(() => (data && view && !view.whole ? data.areas.filter((a) => !view.ids.has(a.id)) : []), [data, view]);
  if (!data || !view) {
    return (
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} style={{ ...svgFill, zIndex }}>
        <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="13" fontFamily="monospace">loading map…</text>
      </svg>
    );
  }
  const s = 1 / k;
  if (linesOnly) {
    /* the county lines alone, heavier, drawn back over the lightning dots so the borders stay readable */
    return (
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" style={{ ...svgFill, zIndex }}>
        <g fill="none" stroke="#000" strokeOpacity="0.8" strokeWidth={1.1 * s} strokeLinejoin="round" fillRule="evenodd">{sel.map((a) => <path key={a.id} d={a[lod]} />)}</g>
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" style={{ ...svgFill, zIndex }}>
      <defs>
        <filter id={`sh${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy={5 * s} stdDeviation={9 * s} floodColor="#000" floodOpacity="0.5" />
        </filter>
        <linearGradient id={`lf${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#eef2f7" />
        </linearGradient>
      </defs>
      {context && !view.whole && (
        <g fillRule="evenodd">
          <g fill="#a3abb8" fillOpacity="0.6" stroke="#2b3240" strokeOpacity="0.5" strokeWidth={0.45 * s} strokeLinejoin="round">
            {data.context.map((c) => <path key={c.id} d={c.coarse} />)}
            {rest.map((a) => <path key={a.id} d={a[lod]} />)}
          </g>
        </g>
      )}
      <g filter={`url(#sh${uid})`} fillRule="evenodd" strokeLinejoin="round">
        {/* the coast (and the edge of the chosen counties): a stroke under the fill, so only
            its outer half shows and the shared borders between chosen counties are covered */}
        <g fill="none" stroke="#000" strokeWidth={3 * s}>{sel.map((a) => <path key={a.id} d={a[lod]} />)}</g>
        <g fill={`url(#lf${uid})`} stroke="#000" strokeOpacity={lineOpacity} strokeWidth={0.5 * s}>{sel.map((a) => <path key={a.id} d={a[lod]} />)}</g>
      </g>
    </svg>
  );
}

/* ── town labels ─────────────────────────────────────────────────────────────────────────── */
/* The UK-wide view keeps a hand-picked set of cities (with the label side that reads best); a
   zoomed view labels the biggest towns inside the chosen counties, as many as fit. */
export const CORE_CITIES = [
  { name: 'London', lon: -0.13, lat: 51.51 }, { name: 'Luton', lon: -0.42, lat: 51.88, flip: true },
  { name: 'Birmingham', lon: -1.90, lat: 52.48 }, { name: 'Manchester', lon: -2.24, lat: 53.48 },
  { name: 'Newcastle', lon: -1.61, lat: 54.98 }, { name: 'Norwich', lon: 1.30, lat: 52.63, up: true },
  { name: 'Bristol', lon: -2.59, lat: 51.45 }, { name: 'Plymouth', lon: -4.14, lat: 50.37 },
  { name: 'Cardiff', lon: -3.18, lat: 51.48, up: true }, { name: 'Aberystwyth', lon: -4.08, lat: 52.41, flip: true },
  { name: 'Wrexham', lon: -2.99, lat: 53.05, flip: true }, { name: 'Glasgow', lon: -4.25, lat: 55.86, flip: true },
  { name: 'Edinburgh', lon: -3.19, lat: 55.95 }, { name: 'Aberdeen', lon: -2.10, lat: 57.15 },
  { name: 'Inverness', lon: -4.22, lat: 57.48 }, { name: 'Fort William', lon: -5.11, lat: 56.82, flip: true },
  { name: 'Wick', lon: -3.09, lat: 58.44 }, { name: 'Belfast', lon: -5.93, lat: 54.60 },
  { name: 'Derry', lon: -7.32, lat: 54.99, flip: true }, { name: 'Dublin', lon: -6.26, lat: 53.35 },
  { name: 'Galway', lon: -9.05, lat: 53.27, flip: true }, { name: 'Limerick', lon: -8.62, lat: 52.66, flip: true },
  { name: 'Cork', lon: -8.47, lat: 51.90, flip: true },
];
let TOWNS = null, townsLoad = null;
/** The towns and cities of the UK and Ireland with their populations, biggest first. */
export function loadTowns() {
  if (!townsLoad) townsLoad = fetch('/geo/uk-ie-towns.json').then((r) => r.json()).then((j) => (TOWNS = j.rows.map(([name, lon, lat, pop]) => ({ name, lon, lat, pop })))).catch(() => { townsLoad = null; return null; });
  return townsLoad;
}
function useTowns() {
  const [t, setT] = useState(TOWNS);
  useEffect(() => {
    if (t) return undefined;
    let live = true;
    loadTowns().then((x) => live && x && setT(x));
    return () => { live = false; };
  }, [t]);
  return t;
}

export function TownLabels({ data, view, k = 1, max = 24, zIndex = 4 }) {
  const towns = useTowns();
  const kept = useMemo(() => {
    if (!view) return [];
    let pool;
    if (view.whole || !data) pool = CORE_CITIES;
    else {
      if (!towns) return [];
      const areas = [...view.ids].map((id) => data.byId[id]);
      const inside = (c) => areas.some((a) => inArea(a, c.lon, c.lat));
      const core = new Map(CORE_CITIES.map((c) => [c.name, c]));
      pool = towns.filter(inside).map((t) => core.get(t.name) || t);
    }
    /* de-clutter on screen (view units x zoom, labels a constant size): bigger places first,
       each tries right, left, above and below before it is dropped */
    const K = Math.max(1, k), fs = 7, off = 6, cw = fs * 0.56, h = fs * 1.15;
    const boxes = [], out = [];
    const hit = (a, b) => !(a.x2 + 1.4 < b.x1 || a.x1 - 1.4 > b.x2 || a.y2 + 1.4 < b.y1 || a.y1 - 1.4 > b.y2);
    for (const c of pool) {
      if (out.length >= (view.whole ? 99 : max)) break;
      const [px, py] = projectPt(c.lon, c.lat);
      const X = px * K, Y = py * K, w = c.name.length * cw;
      const sides = c.up ? ['up'] : c.flip ? ['left'] : view.whole ? [px > VIEW_W - 48 ? 'left' : 'right'] : ['right', 'left', 'up', 'down'];
      for (const side of sides) {
        const bx = side === 'right' ? X + off : side === 'left' ? X - off - w : X - w / 2;
        const by = side === 'up' ? Y - off - h : side === 'down' ? Y + off : Y - h * 0.55;
        const box = { x1: Math.min(bx, X - 4), y1: Math.min(by, Y - 4), x2: Math.max(bx + w, X + 4), y2: Math.max(by + h, Y + 4) };
        if (boxes.some((b) => hit(box, b))) continue;
        boxes.push(box);
        out.push({ c, x: px, y: py, side });
        break;
      }
    }
    return out;
  }, [data, view, towns, k, max]);
  const s = 1 / Math.max(1, k);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" style={{ ...svgFill, zIndex }}>
      {kept.map(({ c, x, y, side }) => (
        <g key={c.name + x}>
          <circle cx={x} cy={y} r={3.5 * s} fill="none" stroke="#000" strokeWidth={1.1 * s} opacity={0.9} />
          <circle cx={x} cy={y} r={1.7 * s} fill="#111827" stroke="#fff" strokeWidth={0.8 * s} />
          <text x={side === 'right' ? x + 6 * s : side === 'left' ? x - 6 * s : x}
            y={side === 'up' ? y - 6 * s : side === 'down' ? y + 12.5 * s : y + 2.6 * s}
            fontSize={7 * s} fontWeight={800} textAnchor={side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'}
            fontFamily="'Archivo','DM Sans',sans-serif" fill="#111827" stroke="#ffffff" strokeWidth={2 * s} paintOrder="stroke" strokeLinejoin="round">
            {c.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
