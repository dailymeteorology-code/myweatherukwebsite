/* A thunderstorm outlook saved in the admin Graphic Studio, brought into Forecast Verification.

   The studio keeps a saved graphic as its state (WeatherGraphic.graphic_tool_state): the areas, in
   the 0..1 space of its map box, the timeline and the outlook day. Here they become
   - the period it forecast: its Valid span (first to last coloured timeline stamp, the user's rule),
     or the timeline's window when nothing is marked;
   - its areas as lat/lon rings, smoothed the way the studio draws them, with their level and hours;
   - a picture of them on the map in the graphic's own key colours, in Web Mercator with known
     edges, so the period's lightning lands where it fell with no lining up;
   and the areas are then scored against the lightning (scoreAreas), as the studio's Accuracy card
   does: the share of strikes inside a risk area (at its own hours, give or take an hour) and the
   share of areas that saw a strike, and their harmonic mean. */
import { base44 } from '@/api/base44Client';
import { boxToLatLon } from '@/components/studio/studioGeo';
import { savedTimeline, buildCells, cellLevels, markedSpan, keyMs } from '@/components/studio/studioTimeline';
import { loadLand, mercator, traceRings } from './landOutline';

/* the graphic's key, as the thunderstorm outlook draws it (StormOutlookGraphicTool) */
export const OUTLOOK_LEVELS = [
  { id: 'Very Low', short: 'TSTM', range: '5-11%', color: '#60a5fa', fill: 'rgba(96,165,250,0.34)' },
  { id: 'Low', short: 'MRGL', range: '12-21%', color: '#86efac', fill: 'rgba(134,239,172,0.38)' },
  { id: 'Marginal', short: 'SLGT', range: '22-34%', color: '#facc15', fill: 'rgba(250,204,21,0.42)' },
  { id: 'Slight', short: 'ENH', range: '35-49%', color: '#fb923c', fill: 'rgba(249,115,22,0.45)' },
  { id: 'Moderate', short: 'MDT', range: '50-64%', color: '#f87171', fill: 'rgba(248,113,113,0.45)' },
  { id: 'High', short: 'HIGH', range: '65-100%', color: '#a78bfa', fill: 'rgba(167,139,250,0.45)' },
];
const SEVERE = 'Severe', COND_SEVERE = 'Conditional Severe';
const ORDER = [...OUTLOOK_LEVELS.map((l) => l.id), COND_SEVERE, SEVERE];
const SEV = Object.fromEntries(ORDER.map((id, i) => [id, i]));
const isOverlay = (id) => id === SEVERE || id === COND_SEVERE;

/** The admin studio's saved thunderstorm outlooks that have areas, newest first. */
export async function savedOutlooks() {
  const rows = await base44.entities.WeatherGraphic.filter({}, '-created_date', 200);
  return (rows || []).filter((g) => {
    const s = g.graphic_tool_state;
    return s && !s._scenarioTool && (!s.tool || s.tool === 'outlook') && Array.isArray(s.shapes) && s.shapes.some((sh) => sh.points?.length >= 3);
  });
}

/** The period a saved outlook forecast, [from, to] in ms: its Valid span, else its timeline window. */
export function outlookPeriod(s) {
  const tl = savedTimeline(s, s.validDate, SEV);
  const cells = buildCells(tl);
  const span = cells.length ? markedSpan(cells, cellLevels(cells, tl.risk, SEV), cellLevels(cells, tl.over, SEV)) : null;
  if (span) {
    const last = cells.find((c) => c.ms === span.to);
    return [span.from, span.to > span.from ? span.to : last?.end ?? span.to + 3 * 3600e3];
  }
  const a = Date.parse(tl.from), b = Date.parse(tl.to);
  if (b > a) return [a, b];
  const d = new Date(`${s.validDate}T00:00:00`), e = new Date(d);
  e.setDate(e.getDate() + 1);   // the next midnight by the clock (a day can be 23 or 25 hours)
  return [d.getTime(), e.getTime()];
}

/* the studio's smoothing of a drawn area (decimate, then three closed Chaikin passes), then
   Douglas-Peucker to keep the record small (about a third of a pixel on the studio's map) */
function smooth(pts) {
  if (!pts || pts.length < 4) return pts || [];
  const dec = [pts[0]];
  for (const p of pts.slice(1)) { const q = dec[dec.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.010) dec.push(p); }
  if (dec.length < 4) return dec;
  let ring = dec;
  for (let it = 0; it < 3; it++) {
    const next = [];
    ring.forEach(([ax, ay], i) => { const [bx, by] = ring[(i + 1) % ring.length]; next.push([ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25], [ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75]); });
    ring = next;
  }
  return ring;
}
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let far = -1, best = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A saved outlook's areas as lat/lon rings: [{ level, cond, ring: [[lat, lon]…], from, to }]. */
export function outlookAreas(s) {
  return (s.shapes || []).filter((sh) => sh.points?.length >= 3 && SEV[sh.riskLevel] != null).map((sh) => ({
    level: sh.riskLevel, cond: !!sh.cond,
    ring: simplify(smooth(sh.points), 0.0008).map(([x, y]) => boxToLatLon(x, y).map((v) => +v.toFixed(4))),
    ...(sh.from && sh.to ? { from: sh.from, to: sh.to } : {}),
  }));
}

/* the picture: the UK & Ireland with sea to the west for the title and key */
export const PICTURE_BOUNDS = { west: -15, east: 3, north: 61.3, south: 49.4 };
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

/** The outlook drawn on the map, as { blob, w, h, bounds }. */
export async function renderOutlook({ areas, periodLabel, opacity = 0.7 }) {
  const land = await loadLand();
  const b = PICTURE_BOUNDS, w = 1080;
  const h = Math.round((w * (merc(b.north) - merc(b.south))) / ((b.east - b.west) * Math.PI / 180));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const P = mercator(b, w, h);
  const sea = ctx.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, '#0b1a33'); sea.addColorStop(1, '#07101f');
  ctx.fillStyle = sea; ctx.fillRect(0, 0, w, h);
  traceRings(ctx, land.context, P, 0.5); ctx.fillStyle = '#334155'; ctx.fill();
  traceRings(ctx, land.counties, P, 0.5); ctx.fillStyle = '#f1f5f9'; ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(15,23,42,0.32)'; ctx.lineWidth = 0.8; ctx.stroke();

  /* the areas, lowest level first and the Severe overlays on top, as on the graphic */
  const line = (ring) => { ctx.beginPath(); ring.forEach(([la, lo], i) => { const [x, y] = P(lo, la); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
  const hatch = (() => {
    const t = document.createElement('canvas'); t.width = t.height = 14;
    const c = t.getContext('2d'); c.strokeStyle = 'rgba(49,46,129,0.85)'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(-4, 18); c.lineTo(18, -4); c.moveTo(-4, 4); c.lineTo(4, -4); c.moveTo(10, 18); c.lineTo(18, 10); c.stroke();
    return ctx.createPattern(t, 'repeat');
  })();
  const darker = (hex, k) => { const n = parseInt(hex.slice(1), 16); return `rgb(${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k))).join(',')})`; };
  ctx.save();
  ctx.globalAlpha = opacity;
  for (const a of [...areas].sort((x, y) => SEV[x.level] - SEV[y.level])) {
    const lv = OUTLOOK_LEVELS.find((l) => l.id === a.level);
    line(a.ring);
    if (a.level === SEVERE) {
      ctx.fillStyle = hatch; ctx.fill();
      ctx.setLineDash([]); ctx.strokeStyle = '#4338ca'; ctx.lineWidth = 5; ctx.stroke();
    } else if (a.level === COND_SEVERE) {
      ctx.fillStyle = 'rgba(200,205,215,0.18)'; ctx.fill();
      ctx.setLineDash([22, 16]); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = '#0b0f1a'; ctx.lineWidth = 4.5; ctx.stroke();
    } else {
      ctx.fillStyle = lv.fill; ctx.fill();
      ctx.setLineDash(a.cond ? [22, 14] : []);
      ctx.strokeStyle = darker(lv.color, a.cond ? 0.4 : 0.2); ctx.lineWidth = a.cond ? 4.2 : 3.5; ctx.stroke();
    }
  }
  ctx.restore();
  ctx.setLineDash([]);

  /* title and key over the Atlantic */
  const glass = (x, y, bw, bh) => { ctx.fillStyle = 'rgba(8,13,28,0.72)'; ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 18); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5; ctx.stroke(); };
  const font = (wt, px) => `${wt} ${px}px Archivo, 'DM Sans', system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  const caption = 'Risk of lightning in a 15 mile radius · MyWeatherUK Graphic Studio';
  const measure = (text, f) => { ctx.font = f; return ctx.measureText(text).width; };
  const tw = Math.max(measure('THUNDERSTORM OUTLOOK', font(800, 40)), measure(periodLabel, font(600, 22)), measure(caption, font(600, 16)));
  glass(28, 28, tw + 48, 140);
  ctx.fillStyle = '#ffffff'; ctx.font = font(800, 40); ctx.fillText('THUNDERSTORM OUTLOOK', 52, 82);
  ctx.fillStyle = 'rgba(203,213,225,0.95)'; ctx.font = font(600, 22); ctx.fillText(periodLabel, 52, 118);
  ctx.fillStyle = 'rgba(148,163,184,0.95)'; ctx.font = font(600, 16); ctx.fillText(caption, 52, 148);
  const used = OUTLOOK_LEVELS.filter((l) => areas.some((a) => a.level === l.id));
  const rows = [...(used.length ? used : OUTLOOK_LEVELS), ...(areas.some((a) => a.level === SEVERE) ? [{ id: SEVERE, short: 'SVRE', range: 'SEVERE' }] : [])];
  /* the key in the open Atlantic west of Ireland */
  const kh = 56 + rows.length * 38, ky = Math.round(h * 0.4);
  glass(28, ky, 248, kh);
  ctx.fillStyle = 'rgba(148,163,184,0.95)'; ctx.font = font(800, 17); ctx.fillText('RISK KEY', 50, ky + 36);
  rows.forEach((l, i) => {
    const y = ky + 62 + i * 38;
    if (l.id === SEVERE) { ctx.fillStyle = hatch; ctx.fillRect(50, y, 46, 20); ctx.strokeStyle = '#4338ca'; ctx.lineWidth = 2; ctx.strokeRect(50, y, 46, 20); }
    else { ctx.fillStyle = l.color; ctx.beginPath(); ctx.roundRect(50, y, 46, 20, 5); ctx.fill(); }
    ctx.fillStyle = '#e8edf6'; ctx.font = font(700, 19); ctx.fillText(l.short, 110, y + 17);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = font(700, 16); ctx.textAlign = 'right'; ctx.fillText(l.range, 256, y + 16); ctx.textAlign = 'left';
  });

  const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  return { blob, w, h, bounds: { ...b } };
}

/** Upload a rendered picture: its URL. */
export async function uploadPicture(blob, name) {
  const file = new File([blob], `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'outlook'}.png`, { type: 'image/png' });
  const { file_url } = await base44.integrations.Core.UploadFile({ file });
  return file_url;
}

/* ray casting on [lat, lon] rings, with the point as (lon, lat) */
function inside(lo, la, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > la) !== (yj > la) && lo < ((xj - xi) * (la - yi)) / ((yj - yi) || 1e-12) + xi) hit = !hit;
  }
  return hit;
}

/** How well the areas caught the lightning (strikes: [[t, lat, lon]…]): { score, pod, caught, total,
    areasHit, areas, later }, or null without risk areas or strikes. Severe and Conditional Severe
    are overlays, not areas of their own; an area whose hours have not begun yet is left out. */
export function scoreAreas(areas, strikes, nowMs = Date.now()) {
  const risk = (areas || []).filter((a) => a.ring?.length >= 3 && !isOverlay(a.level));
  const live = risk.filter((a) => !(a.from && keyMs(a.from) > nowMs));
  if (!live.length || !strikes?.length) return null;
  const boxes = live.map((a) => a.ring.reduce((m, [la, lo]) => [Math.min(m[0], lo), Math.min(m[1], la), Math.max(m[2], lo), Math.max(m[3], la)], [Infinity, Infinity, -Infinity, -Infinity]));
  const hours = live.map((a) => (a.from && a.to ? [keyMs(a.from) - 3600e3, keyMs(a.to) + 2 * 3600e3] : null));   // its hours, an hour either side
  const seen = new Array(live.length).fill(false);
  let caught = 0;
  for (const [t, la, lo] of strikes) {
    let hit = false;
    live.forEach((a, i) => {
      const bx = boxes[i];
      if (lo < bx[0] || lo > bx[2] || la < bx[1] || la > bx[3]) return;
      if (hours[i] && (t < hours[i][0] || t > hours[i][1])) return;
      if (!inside(lo, la, a.ring)) return;
      hit = true; seen[i] = true;
    });
    if (hit) caught++;
  }
  const pod = caught / strikes.length, areaHit = seen.filter(Boolean).length / live.length;
  const score = pod + areaHit > 0 ? (2 * pod * areaHit) / (pod + areaHit) : 0;
  return { score: Math.round(score * 100), pod: Math.round(pod * 100), caught, total: strikes.length, areasHit: seen.filter(Boolean).length, areas: live.length, later: risk.length - live.length };
}
