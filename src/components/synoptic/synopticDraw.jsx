/* ════════════════════════════════════════════════════════════════════════════
   synopticDraw — the marks a synoptic chart is made of.

   Shared by SynopticChartTool (fronts, isobars, jet) and WeatherTypeMapTool
   (which only needs pressure centres and arrows). Kept in one place so a front
   drawn on one chart looks identical on the other.

   The fiddly part is the FRONT symbols. A front is not a decorated line: the
   triangles and semicircles must sit on ONE side of the line, spaced by arc
   length rather than by vertex, and rotated to the local tangent — otherwise
   they bunch up round tight bends and flip sides across an inflection. So the
   curve is densified into short segments once, and every symbol is placed by
   walking that polyline at a fixed distance. Vertex spacing then has no effect
   on symbol spacing, which is what lets the user drag control points around
   without the front redecorating itself.
   ════════════════════════════════════════════════════════════════════════════ */
import React from 'react';

/* ── Curves ──────────────────────────────────────────────────────────────── */

/** Catmull-Rom through the points, emitted as cubic beziers. */
export function smoothPath(pts, closed = false) {
  if (!pts || pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0][0]} ${pts[0][1]}L${pts[1][0]} ${pts[1][1]}`;
  const p = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2];
    d += `C${(x1 + (x2 - x0) / 6).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)},` +
         `${(x2 - (x3 - x1) / 6).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)},` +
         `${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return d + (closed ? 'Z' : '');
}

/** Densify a Catmull-Rom through `pts` into a plain polyline. */
export function densify(pts, per = 14) {
  if (!pts || pts.length < 2) return pts || [];
  if (pts.length === 2) {
    const out = [];
    for (let t = 0; t <= per; t++) {
      const u = t / per;
      out.push([pts[0][0] + (pts[1][0] - pts[0][0]) * u, pts[0][1] + (pts[1][1] - pts[0][1]) * u]);
    }
    return out;
  }
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2];
    for (let t = 0; t < per; t++) {
      const u = t / per, u2 = u * u, u3 = u2 * u;
      out.push([
        0.5 * ((2 * x1) + (-x0 + x2) * u + (2 * x0 - 5 * x1 + 4 * x2 - x3) * u2 + (-x0 + 3 * x1 - 3 * x2 + x3) * u3),
        0.5 * ((2 * y1) + (-y0 + y2) * u + (2 * y0 - 5 * y1 + 4 * y2 - y3) * u2 + (-y0 + 3 * y1 - 3 * y2 + y3) * u3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Walk a polyline and return a placement every `spacing` px.
 *
 * Spacing is by ARC LENGTH, which is the whole point: symbols stay evenly
 * spread however unevenly the user placed the control points, and stay put when
 * a distant point is dragged.
 */
export function walkPath(poly, spacing, startOffset = 0) {
  const out = [];
  if (!poly || poly.length < 2) return out;
  let target = startOffset, acc = 0;
  for (let i = 1; i < poly.length; i++) {
    const [x0, y0] = poly[i - 1], [x1, y1] = poly[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg < 1e-6) continue;
    while (acc + seg >= target) {
      const u = (target - acc) / seg;
      out.push({
        x: x0 + (x1 - x0) * u,
        y: y0 + (y1 - y0) * u,
        angle: Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI,
      });
      target += spacing;
    }
    acc += seg;
  }
  return out;
}

/* ── Fronts ──────────────────────────────────────────────────────────────── */

export const FRONT_TYPES = {
  warm:     { id: 'warm',     label: 'Warm front',     color: '#e11d48' },
  cold:     { id: 'cold',     label: 'Cold front',     color: '#2563eb' },
  occluded: { id: 'occluded', label: 'Occluded front', color: '#7c3aed' },
  stationary: { id: 'stationary', label: 'Stationary front', color: '#e11d48', alt: '#2563eb' },
};

/**
 * One front: the line plus its symbols.
 *
 * `side` flips which way the symbols point, because a front drawn left-to-right
 * and the same front drawn right-to-left would otherwise decorate opposite
 * edges. It is a per-front toggle rather than something inferred, since only
 * the forecaster knows which way the boundary is moving.
 */
export function Front({ points, type = 'warm', side = 1, width = 3.4, size = 9, spacing = 34 }) {
  if (!points || points.length < 2) return null;
  const def = FRONT_TYPES[type] || FRONT_TYPES.warm;
  const poly = densify(points);
  const d = smoothPath(points);
  const marks = walkPath(poly, spacing, spacing * 0.55);

  const symbolAt = (m, i) => {
    // Alternate along an occluded/stationary front; every mark is the same on
    // a plain warm or cold front.
    const isWarm = type === 'warm' || ((type === 'occluded' || type === 'stationary') && i % 2 === 0);
    const colour = type === 'stationary' ? (isWarm ? def.color : def.alt) : def.color;
    const flip = type === 'stationary' && !isWarm ? -side : side;
    return (
      <g key={i} transform={`translate(${m.x} ${m.y}) rotate(${m.angle})`}>
        {isWarm
          ? <path d={`M${-size} 0 A ${size} ${size} 0 0 ${flip > 0 ? 1 : 0} ${size} 0 Z`}
                  fill={colour} stroke={colour} strokeWidth={0.8} strokeLinejoin="round" />
          : <path d={`M${-size} 0 L 0 ${-size * 1.15 * flip} L ${size} 0 Z`}
                  fill={colour} stroke={colour} strokeWidth={0.8} strokeLinejoin="round" />}
      </g>
    );
  };

  return (
    <g>
      {/* Dark casing under the line so a front stays legible over a coloured
          weather-type area or a busy coastline. */}
      <path d={d} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={width + 2.2}
            strokeLinecap="round" strokeLinejoin="round" />
      {type === 'stationary' ? (
        <>
          <path d={d} fill="none" stroke={def.color} strokeWidth={width} strokeLinecap="round" />
          <path d={d} fill="none" stroke={def.alt} strokeWidth={width}
                strokeLinecap="butt" strokeDasharray={`${spacing / 2} ${spacing / 2}`} />
        </>
      ) : (
        <path d={d} fill="none" stroke={def.color} strokeWidth={width}
              strokeLinecap="round" strokeLinejoin="round" />
      )}
      {marks.map(symbolAt)}
    </g>
  );
}

/* ── Isobars ─────────────────────────────────────────────────────────────── */

/** A pressure contour. Thin, pale, and labelled at its midpoint if given a value. */
export function Isobar({ points, value = null, color = '#e2e8f0', width = 1.6, dashed = false }) {
  if (!points || points.length < 2) return null;
  const d = smoothPath(points);
  const mid = points[Math.floor(points.length / 2)];
  return (
    <g>
      <path d={d} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={width + 1.6} strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
            strokeDasharray={dashed ? '7 5' : undefined} />
      {value != null && value !== '' && (
        <g transform={`translate(${mid[0]} ${mid[1]})`}>
          {/* Knock a hole in the line behind the number so it stays readable. */}
          <rect x={-15} y={-8} width={30} height={16} rx={3} fill="rgba(8,11,22,0.85)" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={11}
                fontWeight={800} fill={color}>{value}</text>
        </g>
      )}
    </g>
  );
}

/* ── Pressure centres ────────────────────────────────────────────────────── */

/** H or L, with an optional millibar value beneath. */
export function PressureCentre({ x, y, kind = 'L', value = '', scale = 1, showRing = true }) {
  const isLow = kind === 'L';
  const colour = isLow ? '#ef4444' : '#2563eb';
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {showRing && <circle r={22} fill="#ffffff" stroke={colour} strokeWidth={2.5} />}
      <text textAnchor="middle" dominantBaseline="central" y={1}
            fontSize={30} fontWeight={900} fill={showRing ? colour : '#fff'}
            style={showRing ? undefined : { paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 5 }}>
        {isLow ? 'L' : 'H'}
      </text>
      {value !== '' && value != null && (
        <text textAnchor="middle" y={36} fontSize={13} fontWeight={800} fill="#fff"
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 4 }}>{value}</text>
      )}
    </g>
  );
}

/* ── Arrows and the jet ──────────────────────────────────────────────────── */

/** A plain flow arrow. Follows its control points, so it can curve. */
export function FlowArrow({ points, color = '#e2e8f0', width = 3, head = 11 }) {
  if (!points || points.length < 2) return null;
  const poly = densify(points);
  const a = poly[poly.length - 2], b = poly[poly.length - 1];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  return (
    <g>
      <path d={smoothPath(points)} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth={width + 2} strokeLinecap="round" />
      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
      <g transform={`translate(${b[0]} ${b[1]}) rotate(${ang})`}>
        <path d={`M0 0 L${-head * 1.5} ${-head * 0.62} L${-head * 1.5} ${head * 0.62} Z`}
              fill={color} stroke="rgba(0,0,0,0.4)" strokeWidth={0.8} strokeLinejoin="round" />
      </g>
    </g>
  );
}

/**
 * The jet stream: a wide translucent ribbon rather than a line, because its
 * width is carrying information (strength) and a stroke of this weight reads as
 * a border otherwise.
 */
export function JetStream({ points, color = '#22d3ee', width = 22, opacity = 0.5 }) {
  if (!points || points.length < 2) return null;
  const poly = densify(points);
  const a = poly[poly.length - 2], b = poly[poly.length - 1];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  const d = smoothPath(points);
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
            opacity={opacity * 0.45} style={{ filter: 'blur(4px)' }} />
      <path d={d} fill="none" stroke={color} strokeWidth={width * 0.55} strokeLinecap="round" opacity={opacity} />
      <path d={d} fill="none" stroke="#fff" strokeWidth={width * 0.12} strokeLinecap="round" opacity={0.65} />
      <g transform={`translate(${b[0]} ${b[1]}) rotate(${ang})`}>
        <path d={`M0 0 L${-width * 0.9} ${-width * 0.5} L${-width * 0.9} ${width * 0.5} Z`}
              fill={color} opacity={Math.min(1, opacity + 0.3)} />
      </g>
    </g>
  );
}

/* ── Stripe fill ─────────────────────────────────────────────────────────── */

/**
 * Diagonal stripe pattern for a risk area.
 *
 * `thickness` is the stripe itself and `gap` the space between, both in view
 * px, so the caller controls density directly. Each pattern needs its own id —
 * two areas sharing one id would silently share a colour.
 */
export function StripePattern({ id, color, thickness = 6, gap = 8, angle = 45, bg = 'transparent' }) {
  const period = Math.max(2, thickness + gap);
  return (
    <pattern id={id} width={period} height={period} patternUnits="userSpaceOnUse"
             patternTransform={`rotate(${angle})`}>
      <rect width={period} height={period} fill={bg} />
      <line x1={0} y1={0} x2={0} y2={period} stroke={color} strokeWidth={thickness} />
    </pattern>
  );
}
