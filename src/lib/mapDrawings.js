/* Drawing on the Model Data map (16 Nov 2026, at the user's request: "an admin only drawing tool ...
   for any variable. I can choose any colour and shape to draw (when drawing shape it must be the
   outline of it). I can also draw a custom shape").

   Every drawing is an outline, never filled: a pen line, a straight line, an arrow, a rectangle, a
   circle or ellipse, or a shape of the admin's own (corners clicked one by one, closed with Finish).
   Points are kept as longitude and latitude, so a drawing stays on its place at any zoom, on either
   map grid and in both windows of a comparison, and it is drawn into the downloads with the map.
   They are kept in this browser until cleared. */

export const DRAW_KINDS = [
  ['free', 'Pen'], ['line', 'Line'], ['arrow', 'Arrow'], ['rect', 'Rectangle'], ['ellipse', 'Circle'], ['shape', 'Own shape'],
];
export const DRAW_COLOURS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#111827'];
export const DRAW_WIDTHS = [['Thin', 3], ['Medium', 5], ['Thick', 9]];   // at a frame 1080 px across its short side
const KEY = 'md-drawings-v1';

export function readDrawings() {
  try { const a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a : []; } catch { return []; }
}
export function saveDrawings(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* a private window: nothing kept */ }
}

/** A drawing from where the pointer went: `a` the first point and `b` the latest, in the grid's cells
    (the map is flat in its cells, so a rectangle or circle drawn there is one on screen), turned into
    the points it is drawn through, as longitude and latitude. `free` keeps every point it is given. */
export function shapePoints(kind, pts, fromGrid) {
  const ll = (p) => fromGrid(p[0], p[1]);
  if (kind === 'free' || kind === 'shape') return pts.map(ll);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (kind === 'line' || kind === 'arrow') return [ll(a), ll(b)];
  if (kind === 'rect') return [a, [b[0], a[1]], b, [a[0], b[1]]].map(ll);
  /* an ellipse in the box from a to b */
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
  const out = [];
  for (let k = 0; k < 72; k++) { const t = (k / 72) * 2 * Math.PI; out.push(ll([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])); }
  return out;
}
export const isClosed = (kind) => kind === 'rect' || kind === 'ellipse' || kind === 'shape';

/* a light or a dark casing under the line, whichever shows it on any layer */
function casingFor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return 'rgba(0,0,0,0.45)';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)';
}

/** Draw the drawings (and the one being drawn, `draft`) with `toPx(lon, lat) -> [x, y]` in canvas
    pixels; `u` is the frame's size (its short side / 1080), so the lines keep their weight in downloads. */
export function drawDrawings(ctx, list, toPx, u = 1, draft = null) {
  const all = draft ? [...list, draft] : list;
  if (!all.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const d of all) {
    const p = (d.pts || []).map(([lo, la]) => toPx(lo, la)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (p.length < 2 && !(d.kind === 'shape' && p.length === 1)) continue;
    const w = Math.max(1.5, (d.w || 5) * u);
    const closed = d.closed ?? isClosed(d.kind);
    const path = () => {
      ctx.beginPath();
      if (d.kind === 'free' && p.length > 2) {             // a pen line: smooth curves through the points
        ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
        ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      } else {
        p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (closed && p.length > 2) ctx.closePath();
      }
      if (d.kind === 'arrow' && p.length >= 2) {            // the head: two strokes back from the tip
        const [x1, y1] = p[p.length - 1], [x0, y0] = p[p.length - 2];
        const ang = Math.atan2(y1 - y0, x1 - x0), len = Math.max(16 * u, w * 3.4);
        for (const s of [-1, 1]) {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - len * Math.cos(ang + s * 0.5), y1 - len * Math.sin(ang + s * 0.5));
        }
      }
    };
    path();
    ctx.strokeStyle = casingFor(d.colour);
    ctx.lineWidth = w + Math.max(2, 2.4 * u);
    ctx.stroke();
    ctx.strokeStyle = d.colour || '#ef4444';
    ctx.lineWidth = w;
    ctx.stroke();
    if (d.draft && d.kind === 'shape') {                    // its corners while it is being made
      for (const [x, y] of p) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3.5, w * 0.8), 0, 2 * Math.PI);
        ctx.fillStyle = d.colour || '#ef4444';
        ctx.fill();
      }
    }
  }
  ctx.restore();
}
