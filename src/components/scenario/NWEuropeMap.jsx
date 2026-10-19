/**
 * Base maps for the Scenario Forecast boards: black sea, white land, thin grey
 * country borders (the MyWeather scenario-board look), in two views that share
 * one frame size so the board layout never changes:
 *
 *   nweu — Iceland to Scandinavia, the Atlantic to central Europe
 *   uk   — the British Isles filling the height of the frame
 *
 * Both are Mercator, so shapes stay true. Drawings are stored in lon/lat and
 * projected through the active view, which is what lets the user switch views
 * without anything moving off its place.
 */
import React, { useEffect, useState } from 'react';

export const VIEW_W = 600, VIEW_H = 540;
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R;

/** A view centred on lonC spanning latMin..latMax; the longitude span follows from the frame's aspect. */
function makeView(id, label, lonC, latMin, latMax) {
  const yTop = mercY(latMax), yBot = mercY(latMin);
  const lonSpan = ((yTop - yBot) * VIEW_W) / VIEW_H / D2R;
  const bbox = { lonMin: lonC - lonSpan / 2, lonMax: lonC + lonSpan / 2, latMin, latMax };
  return {
    id, label, bbox,
    project: (lon, lat) => [((lon - bbox.lonMin) / lonSpan) * VIEW_W, ((yTop - mercY(lat)) / (yTop - yBot)) * VIEW_H],
    unproject: (x, y) => [bbox.lonMin + (x / VIEW_W) * lonSpan, invMercY(yTop - (y / VIEW_H) * (yTop - yBot))],
  };
}

export const VIEWS = {
  nweu: makeView('nweu', 'NW Europe', 1.5, 46.5, 71.5),
  uk: makeView('uk', 'UK', -3.6, 49.4, 61.1),
};

/** The frame boards were saved in before drawings were stored in lon/lat (0..1 of a 600-wide map). */
export function legacyToGeo([nx, ny]) {
  const b = { lonMin: -28, lonMax: 20, latMin: 44, latMax: 64 };
  const yTop = mercY(b.latMax), yBot = mercY(b.latMin);
  return [b.lonMin + nx * (b.lonMax - b.lonMin), invMercY(yTop - ny * (yTop - yBot))];
}

const GEO_SOURCES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
];

let featuresPromise = null;
function loadFeatures() {
  if (!featuresPromise) {
    featuresPromise = (async () => {
      for (const url of GEO_SOURCES) {
        try {
          const gj = await fetch(url).then((r) => { if (!r.ok) throw new Error('fetch'); return r.json(); });
          if (gj.features?.length) return gj.features;
        } catch { /* next mirror */ }
      }
      featuresPromise = null;
      return [];
    })();
  }
  return featuresPromise;
}

// Sutherland–Hodgman clip of a lon/lat ring against a box.
function clipRing(ring, c) {
  const edges = [
    [(p) => p[0] >= c.lonMin, (a, b) => [c.lonMin, a[1] + ((b[1] - a[1]) * (c.lonMin - a[0])) / (b[0] - a[0] || 1e-9)]],
    [(p) => p[0] <= c.lonMax, (a, b) => [c.lonMax, a[1] + ((b[1] - a[1]) * (c.lonMax - a[0])) / (b[0] - a[0] || 1e-9)]],
    [(p) => p[1] >= c.latMin, (a, b) => [a[0] + ((b[0] - a[0]) * (c.latMin - a[1])) / (b[1] - a[1] || 1e-9), c.latMin]],
    [(p) => p[1] <= c.latMax, (a, b) => [a[0] + ((b[0] - a[0]) * (c.latMax - a[1])) / (b[1] - a[1] || 1e-9), c.latMax]],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

const pathCache = new Map();
function buildPaths(features, view) {
  if (pathCache.has(view.id)) return pathCache.get(view.id);
  const b = view.bbox, c = { lonMin: b.lonMin - 4, lonMax: b.lonMax + 4, latMin: b.latMin - 3, latMax: b.latMax + 3 };
  const out = [];
  for (const f of features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = '';
    for (const poly of polys) for (const ring of poly) {
      const r = clipRing(ring, c);
      if (r.length < 3) continue;
      r.forEach(([lo, la], i) => { const [x, y] = view.project(lo, la); d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; });
      d += 'Z';
    }
    if (d) out.push(d);
  }
  pathCache.set(view.id, out);
  return out;
}

/** Land outlines for a view, projected (null until loaded). */
export function useLandPaths(view) {
  const [paths, setPaths] = useState(() => pathCache.get(view.id) || null);
  useEffect(() => {
    let live = true;
    if (pathCache.has(view.id)) { setPaths(pathCache.get(view.id)); return undefined; }
    loadFeatures().then((f) => { if (live && f.length) setPaths(buildPaths(f, view)); });
    return () => { live = false; };
  }, [view]);
  return paths;
}

export default function NWEuropeMap({ view = VIEWS.nweu }) {
  const paths = useLandPaths(view);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#151515" />
      {paths && (
        <g fill="#ffffff" stroke="#b8b8b8" strokeWidth={view.id === 'uk' ? 0.8 : 0.55} strokeLinejoin="round">
          {paths.map((d, i) => <path key={i} d={d} />)}
        </g>
      )}
    </svg>
  );
}
