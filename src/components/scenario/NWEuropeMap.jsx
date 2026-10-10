/**
 * NWEuropeMap — North-West Europe coastline, UK centred, Atlantic to the west.
 *
 * A premium white-on-deep-ocean SVG basemap for the Scenario Forecast tool.
 * Coordinates project through a conformal (true-shape) Mercator into the
 * SCN_VIEW_W x SCN_VIEW_H box, so 1° lon and 1° lat keep their correct ratio.
 *
 * Upgrades vs the old version:
 *   • Polygons are CLIPPED to the bbox (with a margin) so off-screen geometry
 *     no longer bloats the path — much faster, much cleaner edges.
 *   • Layered bathymetry ocean (deep → shelf) with an animated sheen.
 *   • Crisp land with a soft coastal halo + drop shadow for "lift".
 *   • Country borders drawn faintly on top of the unified landmass.
 *   • Graticule with edge labels (°N / °W / °E) for a real synoptic feel.
 *   • Corner vignette + subtle film grain for depth.
 */
import React, { useEffect, useMemo, useState } from 'react';

// Wide bbox: Atlantic (well west of Ireland) across to central Europe,
// from northern Spain up to Iceland/Norway — keeps the UK roughly centred.
export const SCN_BBOX = { lonMin: -28.0, lonMax: 20.0, latMin: 44.0, latMax: 64.0 };

const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const Y_TOP = mercY(SCN_BBOX.latMax), Y_BOT = mercY(SCN_BBOX.latMin);

// CONFORMAL (true-shape) Mercator: the viewport height is DERIVED from the
// bbox so the map is no longer stretched. Width is fixed; height follows.
export const SCN_VIEW_W = 600;
const LON_SPAN_RAD = (SCN_BBOX.lonMax - SCN_BBOX.lonMin) * D2R;
const Y_SPAN = Y_TOP - Y_BOT;
export const SCN_VIEW_H = Math.round(SCN_VIEW_W * (Y_SPAN / LON_SPAN_RAD));

export function scnProject(lon, lat) {
  const x = ((lon - SCN_BBOX.lonMin) / (SCN_BBOX.lonMax - SCN_BBOX.lonMin)) * SCN_VIEW_W;
  const y = ((Y_TOP - mercY(lat)) / Y_SPAN) * SCN_VIEW_H;
  return [x, y];
}

// World coastline GeoJSON sources (low-res, plenty for a synoptic chart).
const GEO_SOURCES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
  'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
];

// ── Sutherland–Hodgman clip of a lon/lat ring against the bbox (with margin) ─
// Clipping in geographic space keeps the projection honest and removes the huge
// off-screen subpaths that used to make the rendered path enormous.
const CLIP = {
  lonMin: SCN_BBOX.lonMin - 4, lonMax: SCN_BBOX.lonMax + 4,
  latMin: SCN_BBOX.latMin - 3, latMax: SCN_BBOX.latMax + 3,
};
function clipRing(ring) {
  const edges = [
    { inside: (p) => p[0] >= CLIP.lonMin, intersect: (a, b) => lerpX(a, b, CLIP.lonMin) },
    { inside: (p) => p[0] <= CLIP.lonMax, intersect: (a, b) => lerpX(a, b, CLIP.lonMax) },
    { inside: (p) => p[1] >= CLIP.latMin, intersect: (a, b) => lerpY(a, b, CLIP.latMin) },
    { inside: (p) => p[1] <= CLIP.latMax, intersect: (a, b) => lerpY(a, b, CLIP.latMax) },
  ];
  let out = ring;
  for (const e of edges) {
    const input = out; out = [];
    if (!input.length) break;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const curIn = e.inside(cur), prevIn = e.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(e.intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(e.intersect(prev, cur));
      }
    }
  }
  return out;
}
function lerpX(a, b, x) {
  const t = (x - a[0]) / ((b[0] - a[0]) || 1e-9);
  return [x, a[1] + (b[1] - a[1]) * t];
}
function lerpY(a, b, y) {
  const t = (y - a[1]) / ((b[1] - a[1]) || 1e-9);
  return [a[0] + (b[0] - a[0]) * t, y];
}

// Quick reject: does a ring's bbox overlap the clip window at all?
function ringTouchesView(ring) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  return !(maxLon < CLIP.lonMin || minLon > CLIP.lonMax || maxLat < CLIP.latMin || minLat > CLIP.latMax);
}

function geoToPath(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length < 3 || !ringTouchesView(ring)) continue;
      const clipped = clipRing(ring);
      if (clipped.length < 3) continue;
      let started = false;
      for (let i = 0; i < clipped.length; i++) {
        const [x, y] = scnProject(clipped[i][0], clipped[i][1]);
        d += (!started ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
        started = true;
      }
      d += 'Z';
    }
  }
  return d;
}

// Graticule edge labels.
const fmtLon = (lon) => lon === 0 ? '0°' : `${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`;
const fmtLat = (lat) => `${lat}°N`;

let scnGeoCache = null;
export default function NWEuropeMap() {
  const [paths, setPaths] = useState(scnGeoCache);
  useEffect(() => {
    if (scnGeoCache) return;
    (async () => {
      for (const url of GEO_SOURCES) {
        try {
          const gj = await fetch(url).then(r => { if (!r.ok) throw new Error('fetch'); return r.json(); });
          const feats = gj.features || [gj];
          const ds = [];
          for (const f of feats) {
            if (!f.geometry) continue;
            const dPath = geoToPath(f.geometry);
            if (dPath) ds.push(dPath);
          }
          if (ds.length) { scnGeoCache = ds; setPaths(ds); return; }
        } catch { /* try next */ }
      }
    })();
  }, []);

  const lonLines = useMemo(() => [-25, -20, -15, -10, -5, 0, 5, 10, 15], []);
  const latLines = useMemo(() => [46, 48, 50, 52, 54, 56, 58, 60, 62], []);
  const majorLon = new Set([-20, -10, 0, 10]);
  const majorLat = new Set([50, 55, 60]);

  return (
    <svg viewBox={`0 0 ${SCN_VIEW_W} ${SCN_VIEW_H}`} preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <defs>
        {/* Deep ocean with a faint bathymetric glow toward the shelf seas */}
        <radialGradient id="scnOcean" cx="48%" cy="38%" r="85%">
          <stop offset="0%" stopColor="#123056" />
          <stop offset="42%" stopColor="#0d2240" />
          <stop offset="78%" stopColor="#0a1a32" />
          <stop offset="100%" stopColor="#060f20" />
        </radialGradient>
        {/* Land: cool porcelain with a hint of green-grey toward the south */}
        <linearGradient id="scnLand" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stopColor="#f4f7fb" />
          <stop offset="55%" stopColor="#e2e9f2" />
          <stop offset="100%" stopColor="#c4d0e0" />
        </linearGradient>
        {/* Coastal halo — a soft luminous rim where land meets sea */}
        <filter id="scnCoastHalo" x="-25%" y="-25%" width="150%" height="150%">
          <feMorphology operator="dilate" radius="1.4" in="SourceAlpha" result="grow" />
          <feGaussianBlur in="grow" stdDeviation="2.4" result="halo" />
          <feFlood floodColor="#8fd3ff" floodOpacity="0.55" result="hc" />
          <feComposite in="hc" in2="halo" operator="in" result="haloColored" />
          <feMerge>
            <feMergeNode in="haloColored" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="scnLandShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="4.5" floodColor="#000" floodOpacity="0.5" />
        </filter>
        {/* Corner vignette */}
        <radialGradient id="scnVignette" cx="50%" cy="46%" r="72%">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="78%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
        {/* Animated ocean sheen — a slow drifting highlight band */}
        <linearGradient id="scnSheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#bfe3ff" stopOpacity="0" />
          <stop offset="48%" stopColor="#bfe3ff" stopOpacity="0" />
          <stop offset="50%" stopColor="#bfe3ff" stopOpacity="0.07" />
          <stop offset="62%" stopColor="#bfe3ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Ocean base */}
      <rect x="0" y="0" width={SCN_VIEW_W} height={SCN_VIEW_H} fill="url(#scnOcean)" />

      {/* Subtle bathymetry rings west of the shelf for an Atlantic-depth feel */}
      <g fill="none" stroke="rgba(90,150,210,0.05)" strokeWidth="1">
        {[0.78, 0.62, 0.48].map((rr, i) => (
          <ellipse key={i} cx={SCN_VIEW_W * 0.30} cy={SCN_VIEW_H * 0.52}
            rx={SCN_VIEW_W * rr * 0.6} ry={SCN_VIEW_H * rr * 0.55} />
        ))}
      </g>

      {/* Graticule with major/minor weighting */}
      <g>
        {lonLines.map(lon => {
          const [x] = scnProject(lon, SCN_BBOX.latMax);
          const major = majorLon.has(lon);
          return <line key={`v${lon}`} x1={x} y1={0} x2={x} y2={SCN_VIEW_H}
            stroke={major ? 'rgba(150,185,225,0.14)' : 'rgba(150,185,225,0.07)'} strokeWidth={major ? 0.9 : 0.6} />;
        })}
        {latLines.map(lat => {
          const [, y] = scnProject(SCN_BBOX.lonMin, lat);
          const major = majorLat.has(lat);
          return <line key={`h${lat}`} x1={0} y1={y} x2={SCN_VIEW_W} y2={y}
            stroke={major ? 'rgba(150,185,225,0.14)' : 'rgba(150,185,225,0.07)'} strokeWidth={major ? 0.9 : 0.6} />;
        })}
      </g>

      {/* Landmass: coastal halo + body + drop shadow, drawn as one unified shape */}
      {paths ? (
        <>
          <g filter="url(#scnLandShadow)">
            <g filter="url(#scnCoastHalo)">
              {paths.map((d, i) => (
                <path key={i} d={d} fill="url(#scnLand)" stroke="#7c93b0" strokeWidth="0.5" />
              ))}
            </g>
          </g>
          {/* Faint internal borders (re-drawn so they sit above the unified land) */}
          <g fill="none" stroke="rgba(80,105,140,0.28)" strokeWidth="0.45" strokeDasharray="2 2.5" opacity="0.6">
            {paths.map((d, i) => <path key={`b${i}`} d={d} />)}
          </g>
        </>
      ) : (
        <text x={SCN_VIEW_W / 2} y={SCN_VIEW_H / 2} textAnchor="middle"
          fill="rgba(255,255,255,0.45)" fontSize="15" fontFamily="monospace">loading map…</text>
      )}

      {/* Drifting ocean sheen */}
      <rect x="0" y="0" width={SCN_VIEW_W} height={SCN_VIEW_H} fill="url(#scnSheen)" opacity="0.9">
        <animateTransform attributeName="transform" type="translate"
          values={`-${SCN_VIEW_W * 0.3} 0; ${SCN_VIEW_W * 0.3} 0; -${SCN_VIEW_W * 0.3} 0`}
          dur="14s" repeatCount="indefinite" />
      </rect>

      {/* Graticule edge labels */}
      <g fontFamily="'DM Mono','SFMono-Regular',monospace" fill="rgba(170,200,235,0.5)" fontSize="8.5" fontWeight="600">
        {lonLines.filter(l => majorLon.has(l)).map(lon => {
          const [x] = scnProject(lon, SCN_BBOX.latMin);
          return <text key={`ll${lon}`} x={x} y={SCN_VIEW_H - 5} textAnchor="middle">{fmtLon(lon)}</text>;
        })}
        {latLines.filter(l => majorLat.has(l)).map(lat => {
          const [, y] = scnProject(SCN_BBOX.lonMin, lat);
          return <text key={`ll${lat}`} x={5} y={y - 3} textAnchor="start">{fmtLat(lat)}</text>;
        })}
      </g>

      {/* "ATLANTIC" label out west */}
      <text x={scnProject(-26, 54)[0]} y={scnProject(-26, 54)[1]}
        fill="rgba(150,185,225,0.30)" fontSize="15" fontWeight="700"
        letterSpacing="4" textAnchor="middle"
        transform={`rotate(-90 ${scnProject(-26, 54)[0]} ${scnProject(-26, 54)[1]})`}>
        ATLANTIC
      </text>

      {/* Corner vignette on top of everything except labels */}
      <rect x="0" y="0" width={SCN_VIEW_W} height={SCN_VIEW_H} fill="url(#scnVignette)" pointerEvents="none" />
    </svg>
  );
}