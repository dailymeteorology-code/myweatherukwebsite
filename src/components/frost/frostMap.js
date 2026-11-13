/* The TCM FROST page's map, a renderer of its own: the UK and Ireland's ground from the snow
   model's own 2 km heights, shaded from the north-west so the hills stand out, the rest of the land
   and the sea plain and dark; the snow on top in TCM FROST's colours (lib/frostKey), one pixel a
   cell smoothed as it is scaled up; then the coast, the borders, the towns and a pin.

   Everything is on Model Data's 'uk' grid (Lambert equal-area, 2 km cells counted from the grid's
   north-west corner, cell i spanning [i, i+1]): the snow model is made on it. The frames, coast
   lines and towns come from the site's own API; nothing here is shared with another page. */
import { SNOW_RISK_LEVELS } from '@/lib/frostKey';

export const NX = 1042, NY = 970;
/* the views, as boxes of cells [west, north, east, south] */
export const REGIONS = {
  ukie: { label: 'UK & Ireland', box: [262, 90, 770, 748] },
  scotland: { label: 'Scotland', box: [392, 100, 652, 476] },
  england: { label: 'England & Wales', box: [450, 384, 746, 738] },
  ireland: { label: 'Ireland', box: [284, 392, 502, 660] },
};

/* the four layers: which frames, and their colours (Model Data's own for the same layers) */
const CM = [[0.1, '#dfe9f5', 130], [1, '#c3d3f2', 185], [3, '#9fb0ea', 212], [6, '#8a7fe0', 226], [12, '#a35ad2', 236], [25, '#e05cb4', 246], [50, '#ffffff', 255]];
const CHANCE = [[5, '#dfe9f5', 115], [10, '#c3d3f2', 150], [20, '#9fb0ea', 180], [30, '#7f9be6', 200], [40, '#8a7fe0', 212], [50, '#9a6ee0', 222],
  [60, '#a35ad2', 230], [70, '#c25ac8', 236], [80, '#e05cb4', 242], [90, '#ffffff', 250]];
export const LAYERS = {
  risk: { label: 'Snow risk', v: 'snow_risk', stops: SNOW_RISK_LEVELS.map((l, i) => [l.level, l.colour, [165, 200, 222, 238][i]]),
    key: SNOW_RISK_LEVELS.map((l) => [l.level, l.name]), what: 'the risk over the 24 hours to the time on show' },
  chance: { label: 'Chance of snow', v: 'snow_chance', stops: CHANCE, key: CHANCE.filter((_, i) => i % 2 === 0 || i === CHANCE.length - 1).map(([v]) => [v, `${v}%`]),
    what: 'the chance of snow falling in the hours to the time on show' },
  day: { label: 'Snow in 24 h', v: 'snow_24h', stops: CM, key: CM.map(([v]) => [v, v < 1 ? `${v}` : `${v}`]), unit: 'cm',
    what: 'the snow expected to fall in the 24 hours to the time on show' },
  total: { label: 'Total snow', v: 'snow_expected', stops: CM, key: CM.map(([v]) => [v, `${v}`]), unit: 'cm',
    what: 'the snow expected to fall from the start of the run to the time on show' },
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** A value's colour on a layer, [r, g, b, a] or null: the step at or below it (none below the first). */
export function colourOf(layer, v) {
  if (!(v >= LAYERS[layer].stops[0][0])) return null;
  const s = LAYERS[layer].stops;
  let k = 0;
  while (k + 1 < s.length && v >= s[k + 1][0]) k++;
  return [...hex(s[k][1]), s[k][2]];
}

/* ── data ── */
export async function fetchRuns() {
  const r = await fetch('/api/frost/runs', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`TCM FROST: ${r.status}`);
  return (await r.json()).runs || [];
}
const FRAMES = new Map();
/** One frame of a run: { head, q (bytes), table (byte -> value) }. Kept, a few dozen at most. */
export function frostFrame(tag, v, lead) {
  const k = `${tag}|${v}|${lead}`;
  if (!FRAMES.has(k)) {
    const p = (async () => {
      const r = await fetch(`/api/modeldata/frames/frost/${tag}/${v}/${lead}`);
      if (!r.ok) throw new Error(`frame ${v} T+${lead}: ${r.status}`);
      const buf = await r.arrayBuffer();
      const n = new DataView(buf).getUint32(0, true);
      const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
      const q = new Uint8Array(buf, 4 + n, head.nx * head.ny);
      const sq = head.scale === 'sqrt', f = sq ? Math.sqrt : (x) => x, lo = f(Math.max(head.lo, 0)), hi = f(head.hi);
      const table = new Float32Array(256);
      for (let b = 0; b < 255; b++) { const x = lo + (b / 254) * (hi - lo); table[b] = sq ? x * x : x; }
      table[255] = NaN;
      return { head, q, table };
    })();
    FRAMES.set(k, p);
    p.catch(() => FRAMES.delete(k));
    while (FRAMES.size > 60) FRAMES.delete(FRAMES.keys().next().value);
  }
  return FRAMES.get(k);
}
let terrainP = null;
/** The ground: { nx, ny, h (Int16Array, m), land (Uint8Array) }. */
export function loadTerrain() {
  terrainP ||= (async () => {
    const r = await fetch('/api/frost/terrain');
    if (!r.ok) throw new Error(`terrain: ${r.status}`);
    const buf = await r.arrayBuffer();
    const n = new DataView(buf).getUint32(0, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
    const o = 4 + n, cells = head.nx * head.ny;
    return { ...head, h: new Int16Array(buf.slice(o, o + 2 * cells)), land: new Uint8Array(buf.slice(o + 2 * cells, o + 3 * cells)) };
  })();
  terrainP.catch(() => { terrainP = null; });
  return terrainP;
}
let linesP = null;
/** Coast and border lines ([x, y, x, y...] in cells) and the towns ({ name, x, y, rank }). */
export function loadLines() {
  linesP ||= Promise.all([
    fetch('/api/modeldata/static/lines.json').then((r) => r.json()),
    fetch('/api/modeldata/static/cities.json').then((r) => r.json()),
  ]).then(([lines, cities]) => ({ lines, cities }));
  linesP.catch(() => { linesP = null; });
  return linesP;
}

/* ── pictures, one pixel a cell ── */
const SEA = [9, 18, 32], LAND = [36, 46, 60];
/** The ground as a canvas: land shaded by its slopes (light from the north-west, the heights made
    three times steeper so 2 km hills still show), lightening a little with height. */
export function groundCanvas(t) {
  const { nx, ny, h, land } = t;
  const cv = document.createElement('canvas');
  cv.width = nx; cv.height = ny;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(nx, ny), d = img.data;
  const zf = 3 / 2000;                                   // exaggeration over a 2 km cell
  const lx = -0.5, ly = -0.5, lz = 0.7071;              // light from the north-west, 45 degrees up
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x, o = 4 * i;
      if (!land[i] && h[i] <= 0) { d[o + 3] = 0; continue; }
      const he = h[i];
      const dx = ((h[y * nx + Math.min(nx - 1, x + 1)] - h[y * nx + Math.max(0, x - 1)]) / 2) * zf;
      const dy = ((h[Math.min(ny - 1, y + 1) * nx + x] - h[Math.max(0, y - 1) * nx + x]) / 2) * zf;
      const len = Math.hypot(dx, dy, 1);
      const shade = Math.max(0, (-dx * lx - dy * ly + lz) / len);            // 0.7 on the flat
      const k = 0.6 + 1.25 * (shade - 0.7) + Math.min(0.32, he / 2600);
      d[o] = LAND[0] * k + 8; d[o + 1] = LAND[1] * k + 8; d[o + 2] = LAND[2] * k + 10; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
/** A frame of a layer as a canvas (no data and no snow are clear). */
export function fieldCanvas(frame, layer) {
  const { nx, ny } = frame.head;
  const lut = new Uint8ClampedArray(256 * 4);
  for (let b = 0; b < 255; b++) {
    const c = colourOf(layer, frame.table[b]);
    if (c) lut.set(c, 4 * b);
  }
  const cv = document.createElement('canvas');
  cv.width = nx; cv.height = ny;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(nx, ny), d = img.data, q = frame.q;
  for (let i = 0; i < q.length; i++) {
    const b = q[i];
    if (b === 255 || !lut[4 * b + 3]) continue;
    const o = 4 * i, l = 4 * b;
    d[o] = lut[l]; d[o + 1] = lut[l + 1]; d[o + 2] = lut[l + 2]; d[o + 3] = lut[l + 3];
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** How a view sits in a w x h box: { s (px a cell), ox, oy } so that x = ox + gx * s. */
export function fit(box, w, h) {
  const [x0, y0, x1, y1] = box;
  const s = Math.min(w / (x1 - x0), h / (y1 - y0));
  return { s, ox: (w - (x1 - x0) * s) / 2 - x0 * s, oy: (h - (y1 - y0) * s) / 2 - y0 * s };
}

/** The whole map on a canvas of w x h CSS pixels at `dpr`. */
export function drawMap(ctx, { w, h, dpr, box, ground, field, lines, cities, pin, light }) {
  const { s, ox, oy } = fit(box, w, h);
  const X = (gx) => (ox + gx * s) * dpr, Y = (gy) => (oy + gy * s) * dpr;
  ctx.save();
  ctx.fillStyle = `rgb(${SEA.join(',')})`;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (ground) ctx.drawImage(ground, X(0), Y(0), NX * s * dpr, NY * s * dpr);
  if (field) ctx.drawImage(field, X(0), Y(0), NX * s * dpr, NY * s * dpr);
  if (lines) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.9 * dpr;
    ctx.strokeStyle = 'rgba(214,228,244,0.5)';
    ctx.beginPath();
    for (const l of lines.coast || []) { ctx.moveTo(X(l[0]), Y(l[1])); for (let i = 2; i < l.length; i += 2) ctx.lineTo(X(l[i]), Y(l[i + 1])); }
    ctx.stroke();
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeStyle = 'rgba(214,228,244,0.32)';
    ctx.beginPath();
    for (const l of lines.border || []) { ctx.moveTo(X(l[0]), Y(l[1])); for (let i = 2; i < l.length; i += 2) ctx.lineTo(X(l[i]), Y(l[i + 1])); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (cities) {
    const most = s > 2.2 ? 3 : s > 1.4 ? 2 : 1;
    ctx.font = `600 ${11.5 * dpr}px Inter, -apple-system, "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const c of cities) {
      if ((c.rank || 1) > most) continue;
      const x = X(c.x), y = Y(c.y);
      if (x < 0 || y < 0 || x > w * dpr || y > h * dpr) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.arc(x, y, 2.4 * dpr, 0, 7); ctx.fill();
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(6,12,22,0.75)';
      ctx.strokeText(c.name, x + 6 * dpr, y);
      ctx.fillText(c.name, x + 6 * dpr, y);
    }
  }
  if (pin) {
    const x = X(pin.gx), y = Y(pin.gy);
    ctx.lineWidth = 2.4 * dpr;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = light ? 'rgba(37,99,235,0.9)' : 'rgba(77,171,247,0.95)';
    ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
