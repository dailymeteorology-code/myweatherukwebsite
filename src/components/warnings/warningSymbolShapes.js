/* The warning symbols, as shapes: MyWeatherUK's own set for every warning type but wind (which
   keeps Lucide's Wind). Drawn on a 24-unit square with a 2-unit line, round ends and joins, in
   currentColor, so they sit beside Lucide's icons at any size and take the warning's ink colour.

   Simple on purpose, one plain idea each (a cloud and its rain, a bolt, a snowflake, icicles, a
   flame…), so a warning reads at a glance. Two-tone: the main body is tinted under its outline,
   and a few marks are solid (raindrops, bolts, mercury), so they keep their weight on the yellow,
   amber and red chips at 20-odd pixels.

   Plain data, so the site (WarningSymbols.jsx) and the script that renders them to pictures draw
   exactly the same thing. Each: { label, els: [[tag, attrs], …] }, where attrs.paint is
     'soft'      tinted inside and outlined
     'solid'     filled and outlined (the outline rounds its corners)
     'dot'       filled, no outline
     'wash'      tinted, no outline
   and anything else is an outline only. */

const SOFT = 0.22;
export const SOFT_OPACITY = SOFT;
const r2 = (v) => Math.round(v * 100) / 100;

/* where two circles cross, the upper of the two points */
function meet([ax, ay, ar], [bx, by, br]) {
  const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
  const a = (ar * ar - br * br + d * d) / (2 * d), h = Math.sqrt(Math.max(0, ar * ar - a * a));
  const px = ax + (a * dx) / d, py = ay + (a * dy) / d;
  const p1 = [px + (h * dy) / d, py - (h * dx) / d], p2 = [px - (h * dy) / d, py + (h * dx) / d];
  return p1[1] < p2[1] ? p1 : p2;
}
/* a cumulus cloud from three circles (left, top, right), flat along its base `y` */
function cloud(y) {
  const L = [7.8, y - 3, 3], T = [12.4, y - 4.9, 4.4], R = [16.6, y - 2.6, 2.6];
  const [p, q] = [meet(L, T), meet(T, R)];
  return `M${L[0]} ${y}A${L[2]} ${L[2]} 0 1 1 ${r2(p[0])} ${r2(p[1])}A${T[2]} ${T[2]} 0 0 1 ${r2(q[0])} ${r2(q[1])}A${R[2]} ${R[2]} 0 0 1 ${R[0]} ${y}Z`;
}
/* a lightning bolt through these points */
const bolt = (pts) => `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
/* a six-armed snowflake: arms of length `len` from (cx, cy), each with a pair of branches */
function snowflake(cx, cy, len) {
  const out = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 - Math.PI / 2;
    const ux = Math.cos(a), uy = Math.sin(a);
    out.push(['path', { d: `M${r2(cx + ux * 1.8)} ${r2(cy + uy * 1.8)}L${r2(cx + ux * len)} ${r2(cy + uy * len)}` }]);
    const bx = cx + ux * len * 0.56, by = cy + uy * len * 0.56, b = len * 0.3;
    for (const s of [-1, 1]) {
      const ang = a + s * 0.82;
      out.push(['path', { d: `M${r2(bx)} ${r2(by)}L${r2(bx + Math.cos(ang) * b)} ${r2(by + Math.sin(ang) * b)}` }]);
    }
  }
  return out;
}
/* the sun: a disc and eight rays between radii a and b */
function sun(cx, cy, r, a, b, w = 1.7) {
  const out = [['circle', { cx, cy, r, paint: 'soft' }]];
  for (let k = 0; k < 8; k++) {
    const t = (k * Math.PI) / 4;
    out.push(['path', { d: `M${r2(cx + Math.cos(t) * a)} ${r2(cy + Math.sin(t) * a)}L${r2(cx + Math.cos(t) * b)} ${r2(cy + Math.sin(t) * b)}`, strokeWidth: w }]);
  }
  return out;
}
/* an icicle hanging from y0 at x, w wide and len long */
const icicle = (x, y0, w, len) => `M${r2(x - w / 2)} ${y0}Q${r2(x - w * 0.12)} ${r2(y0 + len * 0.62)} ${r2(x)} ${r2(y0 + len)}Q${r2(x + w * 0.12)} ${r2(y0 + len * 0.62)} ${r2(x + w / 2)} ${y0}`;
/* a wave line from x0 to x1 at y, in humps of width w */
function wave(x0, x1, y, w = 3.2, h = 1.4) {
  let d = `M${x0} ${y}`;
  for (let x = x0, up = true; x < x1 - 0.01; x += w / 2, up = !up) d += `Q${r2(x + w / 4)} ${r2(up ? y - h : y + h)} ${r2(Math.min(x1, x + w / 2))} ${y}`;
  return d;
}

export const WARNING_SYMBOLS = {
  rain: {
    label: 'Rain',
    els: [
      ['path', { d: 'M12 2.5C12 2.5 18.5 9.6 18.5 14.6a6.5 6.5 0 0 1-13 0C5.5 9.6 12 2.5 12 2.5Z', paint: 'soft' }],
      ['path', { d: 'M9.1 15.1a3 3 0 0 0 2.7 3' }],
    ],
  },
  thunderstorm: {
    label: 'Thunderstorm',
    els: [
      ['path', { d: cloud(11), paint: 'soft' }],
      ['path', { d: bolt([[11.2, 13.6], [14.6, 13.6], [13.1, 16.7], [15.4, 16.7], [10, 22.6], [11.2, 18.5], [8.8, 18.5]]), paint: 'solid' }],
    ],
  },
  lightning: {
    label: 'Lightning',
    els: [['path', { d: bolt([[11.5, 2], [16.9, 2], [13.5, 8.7], [17.7, 8.7], [8.9, 22], [10.9, 13.3], [6.3, 13.3]]), paint: 'solid' }]],
  },
  snow: {
    label: 'Snow',
    els: snowflake(12, 12, 9.6),
  },
  ice: {
    label: 'Ice',
    els: [
      ['rect', { x: 2.5, y: 3, width: 19, height: 3.4, rx: 1.7, paint: 'soft' }],
      ['path', { d: icicle(6.5, 6.4, 3.4, 8), paint: 'soft' }],
      ['path', { d: icicle(12, 6.4, 3.8, 14), paint: 'soft' }],
      ['path', { d: icicle(17.5, 6.4, 3.4, 9.5), paint: 'soft' }],
    ],
  },
  fog: {
    label: 'Fog',
    els: [
      ['path', { d: cloud(10.6), paint: 'soft' }],
      ['path', { d: 'M3.5 14.4h17' }], ['path', { d: 'M5.5 18h13' }], ['path', { d: 'M3.5 21.6h17' }],
    ],
  },
  heat: {
    label: 'Extreme heat',
    els: [
      ['path', { d: 'M5.9 14.4V5.1a2.1 2.1 0 0 1 4.2 0v9.3a3.7 3.7 0 1 1-4.2 0Z', paint: 'soft' }],
      ['path', { d: 'M8 8.5v8' }], ['circle', { cx: 8, cy: 17.4, r: 1.75, paint: 'dot' }],
      ...sun(16.9, 7, 2.1, 3.9, 5.4, 1.6),
    ],
  },
  flood: {
    label: 'Flood',
    els: [
      ['path', { d: 'M6.6 13.6V9l5.4-4.7L17.4 9v4.6', paint: 'wash' }],
      ['path', { d: 'M4.3 10.6 12 3.9l7.7 6.7' }], ['path', { d: 'M6.6 8.9v4.7' }], ['path', { d: 'M17.4 8.9v4.7' }],
      ['path', { d: wave(2.4, 21.6, 15.6, 4.8, 1.3) }], ['path', { d: wave(2.4, 21.6, 20, 4.8, 1.3) }],
    ],
  },
  fire: {
    label: 'Wildfire',
    els: [
      ['path', { d: 'M12 2.2C15.4 5.7 17.8 9.6 17.8 15.2A5.8 5.8 0 0 1 6.2 15.2C6.2 12.5 7.4 10.5 9 8.9c.4 1.9 1.3 3 2.5 3.4C11.1 8.7 11.1 5.5 12 2.2Z', paint: 'soft' }],
      ['path', { d: 'M12 19a2.4 2.4 0 0 1-2.4-2.4c0-1.6 1.2-2.5 2.4-4.4 1.2 1.9 2.4 2.8 2.4 4.4A2.4 2.4 0 0 1 12 19Z', paint: 'solid' }],
    ],
  },
  other: {
    label: 'Other',
    els: [
      ['path', { d: 'M10.27 4.1a2 2 0 0 1 3.46 0l7.6 13.2a2 2 0 0 1-1.73 3H4.4a2 2 0 0 1-1.73-3Z', paint: 'soft' }],
      ['path', { d: 'M12 9v4.8' }], ['circle', { cx: 12, cy: 16.9, r: 1.15, paint: 'dot' }],
    ],
  },
};

/* Lucide's Wind, which the wind warning keeps (for the picture of the whole set) */
export const WIND_SYMBOL = {
  label: 'Wind',
  els: [['path', { d: 'M12.8 19.6A2 2 0 1 0 14 16H2' }], ['path', { d: 'M17.5 8a2.5 2.5 0 1 1 2 4H2' }], ['path', { d: 'M9.8 4.4A2 2 0 1 1 11 8H2' }]],
};

/** The symbol's key for a warning type (Met Office or the site's own): null for wind. */
export function symbolKey(type) {
  const t = String(type || '').toLowerCase();
  if (/wind|gale/.test(t)) return null;
  if (/thunder/.test(t)) return 'thunderstorm';
  if (/lightning/.test(t)) return 'lightning';
  if (/flood/.test(t)) return 'flood';
  if (/rain/.test(t)) return 'rain';
  if (/ice|frost|freez/.test(t)) return 'ice';
  if (/snow|cold|blizzard/.test(t)) return 'snow';
  if (/fog|mist/.test(t)) return 'fog';
  if (/heat|hot/.test(t)) return 'heat';
  if (/fire/.test(t)) return 'fire';
  return 'other';
}
