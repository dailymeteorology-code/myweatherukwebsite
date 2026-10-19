/**
 * Scenario story cards — one vertical 1080×1920 card per scenario, for social:
 *
 *   top ~55%   white, a faint grey wash at the very top edge, the UK filled in the
 *              scenario's pastel (no internal borders), the Republic of Ireland as a
 *              thin grey coastline only, and the low's track: a thin black curve with
 *              an arrowhead and a white "L" disc on it.
 *   the seam   a joined pill: near-black title box + percentage box in the strong colour.
 *   bottom     a panel in the pastel with rounded bottom corners and the description.
 *
 * Title, percentage and description are the tool's own fields; anything left empty is
 * simply not drawn (no empty boxes, no placeholder text). The track comes from the
 * ECMWF scenario (its main low, followed through the period) or a preset, and can be
 * reshaped by dragging its points or sliding the L along it on the preview.
 *
 * Geometry is the site's own: /static-data/uk-climate-districts.geo.json (UK land) and
 * /static-data/context.geo.json (Ireland). Fonts: DM Sans, already used on the site.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Wand2 } from 'lucide-react';
import { loadImage, downloadCanvas } from '@/lib/canvasGraphic';
import { describeLwt } from './ensembleLayer';

export const CARD_W = 1080, CARD_H = 1920;
const PANEL_Y = 1056;
const CARD_FONT = "'DM Sans', system-ui, sans-serif";

export const SCHEMES = {
  pink: { label: 'Pink', soft: '#f2c4cc', strong: '#c8435a' },
  lilac: { label: 'Lilac', soft: '#d8c6e4', strong: '#8e5fa8' },
  blue: { label: 'Blue', soft: '#abc9e3', strong: '#3a78b8' },
};

/* ── projection: the UK filling the top of the card, a touch right of centre ── */
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const TOP_LAT = 61.0, BOT_LAT = 49.6, TOP_Y = 56, BOT_Y = 968, LON_C = -4.3, X_C = 560;
const SCALE = (BOT_Y - TOP_Y) / (mercY(TOP_LAT) - mercY(BOT_LAT));          // px per radian
export const cardProject = (lon, lat) => [X_C + (lon - LON_C) * D2R * SCALE, TOP_Y + (mercY(TOP_LAT) - mercY(lat)) * SCALE];
export const cardUnproject = (x, y) => [LON_C + (x - X_C) / SCALE / D2R, (2 * Math.atan(Math.exp(mercY(TOP_LAT) - (y - TOP_Y) / SCALE)) - Math.PI / 2) / D2R];

/* ── presets: the three classic tracks (lon/lat), L at point `l` ── */
export const TRACK_PRESETS = {
  wales: { label: 'Wales & S England', l: 3, pts: [[-17, 48.6], [-11, 50.2], [-6.5, 51.1], [-3.9, 51.4], [-0.8, 51.9], [2.6, 52.6], [6.5, 53.5]] },
  channel: { label: 'English Channel', l: 3, pts: [[-17.5, 49.2], [-10, 49.35], [-5.4, 49.65], [-3.0, 49.9], [0.0, 50.12], [1.6, 50.7], [3.6, 52.0], [6.5, 53.6]] },
  irish: { label: 'Irish Sea & N Britain', l: 3, pts: [[-17, 47.2], [-11.5, 49.6], [-7.8, 51.4], [-6.0, 52.1], [-5.0, 53.6], [-3.6, 55.0], [-1.0, 56.2], [2.5, 57.6], [6.5, 59.0]] },
};
export const defaultCards = () => ({
  most: { scheme: 'pink', title: '', desc: '', track: presetTrack('wales') },
  less: { scheme: 'lilac', title: '', desc: '', track: presetTrack('channel') },
  least: { scheme: 'blue', title: '', desc: '', track: presetTrack('irish') },
});

/* ── curve helpers (card pixels) ── */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Catmull-Rom samples through P, plus the sample index of every control point. */
function sample(P, step = 4) {
  if (P.length < 2) return { S: P.slice(), at: P.map(() => 0) };
  const S = [], at = [], n = P.length, pt = (i) => P[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    at.push(S.length);
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2), k = Math.max(1, Math.ceil(dist(p1, p2) / step));
    for (let s = 0; s < k; s++) {
      const t = s / k, t2 = t * t, t3 = t2 * t;
      S.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  at.push(S.length); S.push(P[n - 1]);
  return { S, at };
}
const cumLen = (S) => S.reduce((acc, p, i) => { acc.push(i ? acc[i - 1] + dist(S[i - 1], p) : 0); return acc; }, []);
function indexAtT(S, t) {
  const c = cumLen(S), L = c[c.length - 1] || 1;
  const want = Math.max(0, Math.min(1, t)) * L;
  let i = 0; while (i < c.length - 1 && c[i] < want) i++;
  return i;
}
function tAtIndex(S, i) { const c = cumLen(S); return (c[i] || 0) / (c[c.length - 1] || 1); }

/** A track object from lon/lat points with the L on point `l`. */
export function makeTrack(src, pts, l) {
  const { S, at } = sample(pts.map((p) => cardProject(p[0], p[1])));
  return { src, pts, lT: pts.length < 2 ? 0 : tAtIndex(S, at[Math.max(0, Math.min(pts.length - 1, l))]) };
}
export function presetTrack(id) { const p = TRACK_PRESETS[id]; return makeTrack(id, p.pts, p.l); }
/** The ECMWF scenario's main-low track, or null if it has none. */
export function ecmwfTrack(cluster) {
  const tr = cluster?.track;
  if (!tr?.length) return null;
  return makeTrack('ecmwf', tr.map((p) => [p.lon, p.lat]), cluster.trackAt ?? 0);
}

/* ── geometry: the site's own outlines ── */
let geoPromise = null;
function loadGeo() {
  if (!geoPromise) {
    geoPromise = Promise.all([
      fetch('/static-data/uk-climate-districts.geo.json').then((r) => r.json()),
      fetch('/static-data/context.geo.json').then((r) => r.json()),
    ]).then(([uk, ctx]) => {
      const rings = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
      const toPath = (polys) => {
        const p = new Path2D();
        for (const poly of polys) for (const ring of poly) ring.forEach(([lo, la], i) => { const [x, y] = cardProject(lo, la); if (i) p.lineTo(x, y); else p.moveTo(x, y); });
        return p;
      };
      return {
        uk: uk.features.map((f) => toPath(rings(f))),
        ie: ctx.features.filter((f) => f.properties?.iso === 'IRL').map((f) => toPath(rings(f))),
      };
    }).catch((e) => { geoPromise = null; throw e; });
  }
  return geoPromise;
}

let fontPromise = null;
function loadCardFont() {
  if (!fontPromise) {
    if (!document.getElementById('dm-sans-cards')) {
      const l = document.createElement('link');
      l.id = 'dm-sans-cards'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;800&display=swap';
      document.head.appendChild(l);
    }
    fontPromise = new Promise((r) => setTimeout(r, 50))
      .then(() => Promise.all(['400 48px "DM Sans"', '800 50px "DM Sans"'].map((f) => document.fonts.load(f))))
      .catch(() => null);
  }
  return fontPromise;
}

/* ── the renderer ── */
function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** Draw one card. Returns the track's on-card geometry (for dragging). */
export function drawCard(ctx, { scheme = 'pink', title = '', pct = '', desc = '', track, geo, logo, handles = false }) {
  const col = SCHEMES[scheme] || SCHEMES.pink;
  const W = CARD_W, H = CARD_H;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const wash = ctx.createLinearGradient(0, 0, 0, 120);
  wash.addColorStop(0, 'rgba(0,0,0,0.06)'); wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wash; ctx.fillRect(0, 0, W, 120);

  // ── map ──
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, PANEL_Y); ctx.clip();
  if (geo) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#cdcdcd'; ctx.lineWidth = 2;
    for (const p of geo.ie) ctx.stroke(p);
    ctx.fillStyle = col.soft; ctx.strokeStyle = col.soft; ctx.lineWidth = 1.6;   // same-colour stroke closes the seams between districts
    for (const p of geo.uk) { ctx.fill(p); ctx.stroke(p); }
  }
  let geom = null;
  if (track?.pts?.length) {
    const P = track.pts.map((p) => cardProject(p[0], p[1]));
    const { S, at } = sample(P);
    let iL = indexAtT(S, track.lT ?? 0.4);
    // end the line (and its arrow) inside the frame, after the L
    const inside = ([x, y]) => x > 44 && x < W - 44 && y > 44 && y < PANEL_Y - 80;
    let end = S.length - 1;
    for (let i = iL; i < S.length; i++) if (!inside(S[i])) { end = Math.max(iL, i - 1); break; }
    iL = Math.min(iL, end);
    geom = { S, at, P, end, iL };
    if (end > 0) {
      ctx.beginPath(); S.slice(0, end + 1).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = '#111111'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      // a track that ends at the L (the low fills or leaves the data) points into the disc instead
      let tipI = end;
      if (dist(S[end], S[iL]) < 75) { tipI = iL; while (tipI > 0 && dist(S[tipI], S[iL]) < 64) tipI--; }
      const e = S[tipI], b = S[Math.max(0, tipI - 6)], a = Math.atan2(e[1] - b[1], e[0] - b[0]);
      const tip = tipI === end ? [e[0] + Math.cos(a) * 10, e[1] + Math.sin(a) * 10] : e, len = 34, half = 14;
      ctx.beginPath();
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(tip[0] - len * Math.cos(a) + half * Math.sin(a), tip[1] - len * Math.sin(a) - half * Math.cos(a));
      ctx.lineTo(tip[0] - len * Math.cos(a) - half * Math.sin(a), tip[1] - len * Math.sin(a) + half * Math.cos(a));
      ctx.closePath(); ctx.fillStyle = '#111111'; ctx.fill();
    }
    const [lx, ly] = S[iL];
    ctx.beginPath(); ctx.arc(lx, ly, 55, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#111111'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#111111'; ctx.font = `800 70px ${CARD_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('L', lx, ly + 3);
    if (handles) {
      for (const [x, y] of P) { if (Math.hypot(x - lx, y - ly) < 60) continue; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.strokeStyle = col.strong; ctx.lineWidth = 4; ctx.stroke(); }
    }
  }
  if (logo) {
    const s = 104, x = W - 44 - s, y = 44;
    ctx.save(); ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(logo, x, y, s, s); ctx.restore();
  }
  ctx.restore();

  // ── panel ──
  ctx.beginPath(); ctx.roundRect(0, PANEL_Y, W, H - PANEL_Y, [0, 0, 48, 48]);
  ctx.fillStyle = col.soft; ctx.fill();

  // ── title pill (only the parts that have text) ──
  const t = String(title || '').trim(), pc = pct === '' || pct == null ? '' : `${pct}%`;
  const PH = 104, py = PANEL_Y - PH / 2, px = 60, R = 22;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `800 50px ${CARD_FONT}`;
  const pw = pc ? ctx.measureText(pc).width + 64 : 0;
  if (t) {
    let size = 50; ctx.font = `800 ${size}px ${CARD_FONT}`;
    const maxT = W - 2 * px - pw - 72;
    while (ctx.measureText(t).width > maxT && size > 28) { size -= 2; ctx.font = `800 ${size}px ${CARD_FONT}`; }
    const tw = Math.min(maxT, ctx.measureText(t).width) + 72;
    ctx.beginPath(); ctx.roundRect(px, py, tw, PH, pc ? [R, 0, 0, R] : R); ctx.fillStyle = '#2b2b2b'; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillText(t, px + 36, py + PH / 2 + 2, maxT);
    if (pc) {
      ctx.beginPath(); ctx.roundRect(px + tw, py, pw, PH, [0, R, R, 0]); ctx.fillStyle = col.strong; ctx.fill();
      ctx.font = `800 50px ${CARD_FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(pc, px + tw + 32, py + PH / 2 + 2);
    }
  } else if (pc) {
    ctx.beginPath(); ctx.roundRect(px, py, pw, PH, R); ctx.fillStyle = col.strong; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillText(pc, px + 32, py + PH / 2 + 2);
  }

  // ── description ──
  const body = String(desc || '').trim();
  if (body) {
    const top = PANEL_Y + (t || pc ? PH / 2 + 70 : 80), bottom = H - 80, maxW = W - 2 * 64;
    let size = 48, lines, lh;
    for (;;) {
      ctx.font = `400 ${size}px ${CARD_FONT}`; lh = Math.round(size * 1.34);
      lines = wrapLines(ctx, body, maxW);
      if (top + lines.length * lh <= bottom || size <= 30) break;
      size -= 2;
    }
    const fit = Math.floor((bottom - top) / lh);
    if (lines.length > fit) { lines = lines.slice(0, fit); lines[fit - 1] = `${lines[fit - 1].replace(/\s+\S*$/, '')}…`; }
    ctx.fillStyle = '#3b3b3b'; ctx.textBaseline = 'alphabetic';
    lines.forEach((l, i) => ctx.fillText(l, 64, top + size + i * lh));
  }
  ctx.restore();
  return geom;
}

/* ── wording from the ECMWF scenario ── */
const PLACES = [
  ['the English Channel', 50.2, -2.0], ['the Western Approaches', 49.3, -7.0], ['the Bristol Channel', 51.35, -4.0], ['south Wales', 51.7, -3.4],
  ['the Irish Sea', 53.8, -5.0], ['south-west Ireland', 51.9, -9.8], ['south-east Ireland', 52.3, -6.6], ['the west of Ireland', 53.5, -10.5],
  ['Northern Ireland', 54.6, -6.6], ['northern England', 54.6, -2.0], ['the Midlands', 52.6, -1.6], ['East Anglia', 52.4, 1.0],
  ['south-east England', 51.2, 0.3], ['south-west England', 50.7, -3.8], ['Wales', 52.4, -3.7], ['southern Scotland', 55.6, -3.8],
  ['the Highlands', 57.3, -4.6], ['the Hebrides', 57.6, -7.3], ['the Northern Isles', 59.6, -2.0], ['the North Sea', 55.8, 2.5],
  ['the southern North Sea', 53.2, 2.8], ['Norway', 60.5, 5.5], ['Denmark', 56.0, 9.0], ['the Low Countries', 52.0, 4.8],
  ['northern France', 49.0, 0.5], ['Brittany', 48.2, -3.2], ['Biscay', 45.8, -5.5], ['the Faroes', 62.0, -7.0], ['Iceland', 64.5, -19.0],
  ['Rockall', 57.6, -13.7], ['the Atlantic west of Ireland', 53.0, -16.0], ['the Atlantic south-west of the UK', 48.0, -14.0],
];
const kmTo = (a, b) => 6371 * Math.acos(Math.min(1, Math.sin(a[0] * D2R) * Math.sin(b[0] * D2R) + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.cos((a[1] - b[1]) * D2R)));
const placeOf = (lat, lon) => PLACES.reduce((b, p) => (kmTo([lat, lon], [p[1], p[2]]) < kmTo([lat, lon], [b[1], b[2]]) ? p : b))[0];
const fmtWhen = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} at ${d.toISOString().slice(11, 16)}`; };

export function wordingFor(cluster, info) {
  if (!cluster) return null;
  const s = describeLwt(cluster.lwt);
  const parts = [];
  if (info?.days > 1) parts.push(`Windiest on ${new Date(cluster.valid).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}.`);
  const L = cluster.track?.[cluster.trackAt ?? 0];
  if (L) {
    parts.push(`Low centre near ${placeOf(L.lat, L.lon)} on ${fmtWhen(L.t)} UTC, around ${L.p} hPa${cluster.minP != null && cluster.minP < L.p - 1 ? `, deepening to ${cluster.minP} hPa` : ''}.`);
  }
  if (s) parts.push(`${s.feel.charAt(0).toUpperCase()}${s.feel.slice(1)}${cluster.lwt?.type === 'U' ? '' : `, ${s.wind}`}.`);
  parts.push(`${cluster.n} of ${info?.members || 50} ECMWF ensemble runs.`);
  return { title: s?.head || '', desc: parts.join(' ') };
}

/* ── one card's preview + controls ── */
const inputCss = { width: '100%', padding: '8px 11px', borderRadius: 9, background: '#101c2e', border: '1px solid rgba(148,163,184,0.18)', color: '#f1f5f9', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const smallBtn = (on, c = '#38bdf8') => ({ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: on ? `${c}24` : 'rgba(148,163,184,0.06)', border: `1px solid ${on ? `${c}88` : 'rgba(148,163,184,0.18)'}`, color: on ? c : '#94a3b8' });

export function StoryCard({ idx, card, setCard, pct, setPct, cluster, info, logoUrl, showLogo, fileStem }) {
  const ref = useRef(null);
  const geomRef = useRef(null);
  const dragRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const [logo, setLogo] = useState(null);
  const [fontTick, setFontTick] = useState(0);
  const [hover, setHover] = useState(false);   // the drag handles show only while the pointer is on the card
  useEffect(() => { loadGeo().then(setGeo).catch(() => {}); loadCardFont().then(() => setFontTick((n) => n + 1)); }, []);
  useEffect(() => { let live = true; loadImage(showLogo ? logoUrl : '').then((im) => { if (live) setLogo(im); }); return () => { live = false; }; }, [logoUrl, showLogo]);

  const render = (handles) => {
    const cv = ref.current; if (!cv) return;
    geomRef.current = drawCard(cv.getContext('2d'), { ...card, pct, geo, logo, handles });
  };
  useEffect(() => { render(hover); }); // eslint-disable-line react-hooks/exhaustive-deps
  void fontTick;

  const toCard = (e) => { const r = ref.current.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * CARD_W, ((e.clientY - r.top) / r.height) * CARD_H]; };
  const onDown = (e) => {
    const g = geomRef.current; if (!g) return;
    const p = toCard(e);
    if (dist(p, g.S[g.iL]) < 70) dragRef.current = { kind: 'L' };
    else {
      let best = -1, bd = 50;
      g.P.forEach((q, i) => { const d = dist(p, q); if (d < bd) { bd = d; best = i; } });
      if (best < 0) return;
      dragRef.current = { kind: 'pt', i: best };
    }
    try { ref.current.setPointerCapture(e.pointerId); } catch { /* fine */ }
  };
  const onMove = (e) => {
    const d = dragRef.current, g = geomRef.current; if (!d || !g) return;
    const p = toCard(e);
    if (d.kind === 'L') {
      let bi = 0, bd = Infinity;
      for (let i = 0; i <= g.end; i++) { const dd = dist(p, g.S[i]); if (dd < bd) { bd = dd; bi = i; } }
      setCard({ ...card, track: { ...card.track, lT: tAtIndex(g.S, bi) } });
    } else {
      const pts = card.track.pts.map((q, i) => (i === d.i ? cardUnproject(p[0], p[1]) : q));
      setCard({ ...card, track: { ...card.track, src: 'custom', pts } });
    }
  };
  const onUp = () => { dragRef.current = null; };

  const download = () => {
    render(false);
    downloadCanvas(ref.current, `${fileStem}-scenario-${idx + 1}.jpg`);
    setTimeout(() => render(hover), 300);
  };
  const ens = ecmwfTrack(cluster);
  const words = wordingFor(cluster, info);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.15)', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Card {idx + 1}</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {Object.entries(SCHEMES).map(([id, s]) => (
            <button key={id} type="button" title={s.label} onClick={() => setCard({ ...card, scheme: id })} style={{ width: 22, height: 22, borderRadius: 6, cursor: 'pointer', background: `linear-gradient(135deg, ${s.soft} 55%, ${s.strong} 55%)`, border: card.scheme === id ? '2px solid #fff' : '1px solid rgba(148,163,184,0.35)' }} />
          ))}
        </div>
      </div>
      <canvas ref={ref} width={CARD_W} height={CARD_H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
        style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 10, background: '#fff', touchAction: 'none', cursor: 'grab' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={card.title} onChange={(e) => setCard({ ...card, title: e.target.value })} placeholder="Title (optional)" style={{ ...inputCss, flex: 1 }} />
        <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} placeholder="%" title="Probability % (shared with the board); leave empty to hide" style={{ ...inputCss, width: 64, textAlign: 'center' }} />
      </div>
      <textarea value={card.desc} onChange={(e) => setCard({ ...card, desc: e.target.value })} placeholder="Description (optional)" rows={4} style={{ ...inputCss, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <button type="button" disabled={!ens} onClick={() => ens && setCard({ ...card, track: ens })} style={{ ...smallBtn(card.track?.src === 'ecmwf', '#34d399'), opacity: ens ? 1 : 0.45 }}>ECMWF track</button>
        {Object.entries(TRACK_PRESETS).map(([id, p]) => <button key={id} type="button" onClick={() => setCard({ ...card, track: presetTrack(id) })} style={smallBtn(card.track?.src === id)}>{p.label}</button>)}
        {card.track?.src === 'custom' && <span style={{ ...smallBtn(true, '#fbbf24'), cursor: 'default' }}>Custom</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" disabled={!words} onClick={() => words && setCard({ ...card, title: words.title, desc: words.desc })} style={{ ...smallBtn(false), opacity: words ? 1 : 0.45 }}><Wand2 style={{ width: 12, height: 12 }} /> Words from ECMWF</button>
        <button type="button" onClick={download} style={{ ...smallBtn(true, '#0ea5e9'), marginLeft: 'auto' }}><Download style={{ width: 12, height: 12 }} /> JPG</button>
      </div>
    </div>
  );
}

export function StoryCardsPanel({ cards, setCards, pcts, setPcts, defs, ensClusters, ensInfo, logoUrl, fileStem }) {
  const [showLogo, setShowLogo] = useState(true);
  const [busy, setBusy] = useState(false);
  const downloadAll = async () => {
    setBusy(true);
    try {
      const [geo, logo] = await Promise.all([loadGeo().catch(() => null), loadImage(showLogo ? logoUrl : ''), loadCardFont()]);
      for (let i = 0; i < defs.length; i++) {
        const cv = document.createElement('canvas'); cv.width = CARD_W; cv.height = CARD_H;
        drawCard(cv.getContext('2d'), { ...cards[defs[i].id], pct: pcts[defs[i].id], geo, logo });
        downloadCanvas(cv, `${fileStem}-scenario-${i + 1}.jpg`);
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally { setBusy(false); }
  };
  return (
    <div style={{ background: '#0c1422', border: '1px solid rgba(148,163,184,0.12)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Story cards · 1080×1920</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>One card per scenario. Empty fields are left off the card. Drag the track's points, or slide the L along it, on the preview.</span>
        <button type="button" onClick={() => setShowLogo((v) => !v)} style={{ ...smallBtn(showLogo), marginLeft: 'auto' }}>Logo</button>
        <button type="button" onClick={downloadAll} disabled={busy} style={smallBtn(true, '#0ea5e9')}>
          {busy ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Download style={{ width: 12, height: 12 }} />} All three JPGs
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {defs.map((d, i) => (
          <StoryCard key={d.id} idx={i} card={cards[d.id]} setCard={(c) => setCards((m) => ({ ...m, [d.id]: c }))}
            pct={pcts[d.id] ?? ''} setPct={(v) => setPcts((p) => ({ ...p, [d.id]: v === '' ? '' : Math.max(0, Math.min(100, Number(v) || 0)) }))}
            cluster={ensClusters?.[i] || null} info={ensInfo} logoUrl={logoUrl} showLogo={showLogo} fileStem={fileStem} />
        ))}
      </div>
    </div>
  );
}
