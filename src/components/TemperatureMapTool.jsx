/**
 * TemperatureMapTool — the Graphic Studio's temperature map.
 *
 * DATA: the site's own Met Office UKV 2 km, from AWS, never Open-Meteo: the "right now" analysis
 * (the UKV corrected by the airports' reports, every 15 minutes) or any UKV forecast hour. The
 * server (/api/studio/temperature, server/studioTemperature.js) refines it with terrain to about
 * 250 m and returns the field for exactly the box on screen, at the canvas's own pixel size.
 *
 * DRAWING: Leaflet only pans and zooms. Everything you see (sea and land, the temperatures, the
 * coast and county lines, the towns and the liquid-glass cards) is drawn by one function onto one
 * canvas, and the PNG is that same function run again at the export size with a field fetched at
 * that size. So the download is the preview, sharper, and never a map-less copy of it (the old
 * export left out the basemap, which was map tiles the canvas never drew).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Thermometer, RefreshCw, Download, Loader2, Clock, CalendarClock, Sun, Moon, Type, Map as MapIcon, ChevronLeft, ChevronRight, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { StudioLayout, Section, Btn, Seg, Field } from '@/components/studio/StudioUI';
import { loadCounties, loadTowns } from '@/components/studio/studioGeo';
import { stepReady } from '@/lib/modelGuide';

/* ── the colour scale (°C) ─────────────────────────────────────────────────────────────────── */
const TEMP_STOPS = [
  { t: -15, c: [52, 0, 95] }, { t: -10, c: [69, 0, 132] }, { t: -5, c: [40, 40, 160] }, { t: 0, c: [40, 110, 200] },
  { t: 5, c: [70, 170, 220] }, { t: 10, c: [120, 200, 170] }, { t: 13, c: [180, 220, 120] }, { t: 16, c: [240, 230, 110] },
  { t: 20, c: [250, 190, 70] }, { t: 24, c: [245, 140, 50] }, { t: 28, c: [230, 80, 40] }, { t: 32, c: [200, 30, 30] },
  { t: 38, c: [140, 10, 30] }, { t: 42, c: [90, 0, 30] },
];
function tempRGB(t) {
  if (t <= TEMP_STOPS[0].t) return TEMP_STOPS[0].c;
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const a = TEMP_STOPS[i], b = TEMP_STOPS[i + 1];
    if (t <= b.t) { const f = (t - a.t) / (b.t - a.t); return [0, 1, 2].map((k) => Math.round(a.c[k] + (b.c[k] - a.c[k]) * f)); }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1].c;
}
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ink = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? '#0a0e1a' : '#ffffff');

/* ── the graphic's two looks (the controls follow the admin theme; the graphic is chosen) ──── */
const THEMES = {
  dark: {
    sea: '#0b1526', land: '#1a2434', ctx: '#141c2a', coast: 'rgba(4,8,16,0.92)', county: 'rgba(4,8,16,0.32)', ctxCoast: 'rgba(148,163,184,0.25)',
    ink: '#ffffff', ink2: 'rgba(226,232,240,0.88)', ink3: 'rgba(148,163,184,0.95)', tint: ['rgba(34,46,74,0.50)', 'rgba(10,16,30,0.62)'],
    edge: 'rgba(255,255,255,0.30)', sheen: 'rgba(255,255,255,0.18)', shadow: 'rgba(0,0,0,0.45)', accent: '#fbbf24', halo: 'rgba(0,0,0,0.85)',
  },
  light: {
    sea: '#cfdfee', land: '#e9eef4', ctx: '#dde4ec', coast: 'rgba(15,23,42,0.75)', county: 'rgba(15,23,42,0.22)', ctxCoast: 'rgba(15,23,42,0.25)',
    ink: '#0b1220', ink2: 'rgba(30,41,59,0.9)', ink3: 'rgba(71,85,105,0.95)', tint: ['rgba(255,255,255,0.62)', 'rgba(236,243,250,0.74)'],
    edge: 'rgba(255,255,255,0.95)', sheen: 'rgba(255,255,255,0.55)', shadow: 'rgba(15,23,42,0.22)', accent: '#c2410c', halo: 'rgba(255,255,255,0.92)',
  },
};
const FORMATS = {
  landscape: { label: '5:4', w: 1600, h: 1280 },
  wide: { label: '16:9', w: 1920, h: 1080 },
  square: { label: '1:1', w: 1440, h: 1440 },
  portrait: { label: '4:5', w: 1080, h: 1350 },
  story: { label: '9:16', w: 1080, h: 1920 },
};
const TOWN_COUNTS = { off: 0, few: 12, normal: 28, many: 64 };
const VIEWS = {
  all: { label: 'UK & Ireland', b: [[49.8, -10.6], [60.9, 1.9]] },
  ew: { label: 'England & Wales', b: [[49.9, -5.8], [55.9, 1.8]] },
  south: { label: 'South', b: [[50.0, -5.8], [52.4, 1.6]] },
  north: { label: 'North England', b: [[53.3, -3.6], [55.9, 0.2]] },
  scot: { label: 'Scotland', b: [[54.6, -7.6], [60.9, -0.7]] },
  ire: { label: 'Ireland', b: [[51.4, -10.6], [55.4, -5.4]] },
};
// Named hills for extremes far from any town: [name, lon, lat, radius km]
const UPLANDS = [
  ['the Cairngorms', -3.65, 57.08, 30], ['the Monadhliath', -4.15, 57.18, 20], ['Lochaber', -5.0, 56.8, 20],
  ['Rannoch Moor', -4.75, 56.62, 14], ['the Breadalbane hills', -4.3, 56.5, 20], ['the North West Highlands', -5.1, 57.9, 45],
  ['the Flow Country', -3.9, 58.4, 30], ['the Southern Uplands', -3.4, 55.4, 30], ['the Galloway Hills', -4.45, 55.1, 20],
  ['the Cheviots', -2.2, 55.45, 15], ['the Lake District fells', -3.1, 54.5, 22], ['the North Pennines', -2.3, 54.75, 25],
  ['the Yorkshire Dales', -2.1, 54.25, 22], ['the North York Moors', -0.9, 54.37, 20], ['the Peak District', -1.8, 53.35, 18],
  ['Snowdonia', -3.9, 53.0, 22], ['the Cambrian Mountains', -3.75, 52.35, 28], ['the Brecon Beacons', -3.45, 51.88, 22],
  ['Dartmoor', -3.9, 50.58, 15], ['Exmoor', -3.65, 51.13, 13], ['the Mournes', -6.0, 54.17, 12], ['the Sperrins', -7.0, 54.8, 20],
  ['the Wicklow Mountains', -6.4, 53.05, 20], ['the Kerry mountains', -9.8, 51.95, 25], ['Connemara', -9.7, 53.5, 25],
];
const FONT = "'Archivo','DM Sans',system-ui,sans-serif";
const D = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
const invMercY = (y) => Math.atan(Math.sinh(y)) / D;
const LONDON = (iso, o) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', ...o });
const tzName = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value || '';
const authHeaders = () => { try { const t = localStorage.getItem('base44_access_token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; } };

/* ── Leaflet (pan and zoom only) ───────────────────────────────────────────────────────────── */
let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(window.L); script.onerror = reject;
    document.body.appendChild(script);
  });
  return leafletPromise;
}

/* the map's Web Mercator as a linear map from lon / Mercator-y to container pixels */
function projOf(map) {
  const a = map.latLngToContainerPoint([60, -10]), b = map.latLngToContainerPoint([50, 0]);
  const kx = (b.x - a.x) / 10, ky = (b.y - a.y) / (mercY(50) - mercY(60));
  const x0 = a.x + 10 * kx, y0 = a.y - ky * mercY(60);
  return { x: (lon) => x0 + kx * lon, y: (lat) => y0 + ky * mercY(lat), lon: (x) => (x - x0) / kx, lat: (y) => invMercY((y - y0) / ky), kx };
}

/* ── the field: fetch, colour, sample ──────────────────────────────────────────────────────── */
async function fetchField(q, signal) {
  const r = await fetch(`/api/studio/temperature/field?${new URLSearchParams(q)}`, { headers: authHeaders(), signal });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status }); }
  const buf = await r.arrayBuffer();
  const n = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const data = new Int16Array(buf.slice(4 + n));
  return { head, data, w: head.w, h: head.h };
}
function fieldImage(f, bands) {
  const cv = document.createElement('canvas');
  cv.width = f.w; cv.height = f.h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(f.w, f.h), px = img.data;
  const lut = new Map();
  for (let i = 0; i < f.data.length; i++) {
    const v = f.data[i];
    if (v === -32768) continue;
    let t = v / 100;
    if (bands) t = Math.floor(t / 2) * 2 + 1;
    const key = Math.round(t * 10);
    let c = lut.get(key);
    if (!c) { c = tempRGB(key / 10); lut.set(key, c); }
    const o = i * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
const sampleField = (f, rect, x, y) => {
  const i = Math.floor(((x - rect.x) / rect.w) * f.w), j = Math.floor(((y - rect.y) / rect.h) * f.h);
  if (i < 0 || j < 0 || i >= f.w || j >= f.h) return null;
  const v = f.data[j * f.w + i];
  return v === -32768 ? null : v / 100;
};

/* ── the land, as Path2Ds in container pixels ──────────────────────────────────────────────── */
function landPaths(geo, proj, gap) {
  const ring = (path, r) => {
    let lx = Infinity, ly = Infinity, n = 0;
    for (let i = 0; i < r.length; i++) {
      const x = proj.x(r[i][0]), y = proj.y(r[i][1]);
      if (i && i < r.length - 1 && Math.abs(x - lx) < gap && Math.abs(y - ly) < gap) continue;
      if (n) path.lineTo(x, y); else path.moveTo(x, y);
      lx = x; ly = y; n++;
    }
    path.closePath();
  };
  const land = new Path2D(), counties = [];
  for (const a of geo.areas) {
    const p = new Path2D();
    for (const poly of a.polys) for (const r of poly) ring(p, r);
    land.addPath(p);
    counties.push(p);
  }
  const ctx = new Path2D();
  for (const c of geo.context) for (const poly of c.polys) for (const r of poly) ring(ctx, r);
  return { land, counties, ctx };
}

/* ── glass, drawn: the frosted backdrop is the picture itself, blurred inside the card ─────── */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function glass(ctx, base, px, T, x, y, w, h, r) {
  ctx.save(); rr(ctx, x, y, w, h, r); ctx.shadowColor = T.shadow; ctx.shadowBlur = 22 * px; ctx.shadowOffsetY = 6 * px; ctx.fillStyle = T.tint[1]; ctx.fill(); ctx.restore();
  ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip();
  if (base) {
    const m = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${Math.round(16 * px)}px) saturate(170%)`;
    ctx.drawImage(base, 0, 0);
    ctx.filter = 'none';
    ctx.setTransform(m);
  }
  const g = ctx.createLinearGradient(x, y, x + w * 0.5, y + h); g.addColorStop(0, T.tint[0]); g.addColorStop(1, T.tint[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const s = ctx.createLinearGradient(x, y, x + w * 0.35, y + h * 0.65); s.addColorStop(0, T.sheen); s.addColorStop(0.55, 'rgba(255,255,255,0)');
  ctx.fillStyle = s; ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.save(); rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = T.edge; ctx.lineWidth = 1; ctx.stroke();
  const hl = ctx.createLinearGradient(x, 0, x + w, 0); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.75)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl; ctx.fillRect(x + r, y + 1, w - 2 * r, 1);
  ctx.restore();
}
function thermometer(ctx, cx, cy, s, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.9 * s; ctx.lineCap = 'round';
  rr(ctx, cx - 3.2 * s, cy - 10 * s, 6.4 * s, 14 * s, 3.2 * s); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy + 6 * s, 4.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - 1.2 * s, cy - 4 * s, 2.4 * s, 9 * s);
  ctx.restore();
}

/**
 * The whole graphic, in container pixels (ctx already scaled by px = device pixels per container
 * pixel). `s` holds the map's projection, the field and its colour image, the land, the towns
 * and every option.
 */
function drawGraphic(ctx, W, H, px, s) {
  const T = THEMES[s.theme];
  const base = document.createElement('canvas');
  base.width = Math.round(W * px); base.height = Math.round(H * px);
  const b = base.getContext('2d');
  b.scale(px, px);
  const { proj } = s;

  /* sea, the continent, the land */
  b.fillStyle = T.sea; b.fillRect(0, 0, W, H);
  if (s.paths) {
    b.fillStyle = T.ctx; b.fill(s.paths.ctx, 'evenodd');
    b.strokeStyle = T.ctxCoast; b.lineWidth = 0.8; b.stroke(s.paths.ctx);
    b.fillStyle = T.land; b.fill(s.paths.land, 'evenodd');
  }
  /* the temperatures (over the land only, unless the sea is wanted) */
  let rect = null;
  if (s.field && s.img) {
    const f = s.field.box;
    rect = { x: proj.x(f.lonMin), y: proj.y(f.latMax), w: proj.x(f.lonMax) - proj.x(f.lonMin), h: proj.y(f.latMin) - proj.y(f.latMax) };
    b.save();
    if (!s.sea && s.paths) b.clip(s.paths.land, 'evenodd');
    b.imageSmoothingEnabled = true; b.imageSmoothingQuality = 'high';
    b.drawImage(s.img, rect.x, rect.y, rect.w, rect.h);
    b.restore();
  }
  /* county lines, then the coast */
  if (s.paths) {
    b.lineJoin = 'round';
    if (s.counties) { b.strokeStyle = T.county; b.lineWidth = 0.7; for (const p of s.paths.counties) b.stroke(p); }
    b.strokeStyle = T.coast; b.lineWidth = 1.25; b.stroke(s.paths.land);
  }

  /* towns: biggest first, each kept only if its pill clears the ones already placed */
  const u = Math.min(W, H * 1.25) / 900;
  const placed = [];
  if (s.towns && s.field && rect && s.townCount) {
    const fs = Math.max(11, 13 * u), nfs = Math.max(8.5, 9.5 * u);
    b.textAlign = 'center'; b.textBaseline = 'alphabetic';
    let n = 0;
    for (const tw of s.towns) {
      if (n >= s.townCount) break;
      const x = proj.x(tw.lon), y = proj.y(tw.lat);
      if (x < 30 * u || x > W - 30 * u || y < 40 * u || y > H - 20 * u) continue;
      const t = sampleField(s.field, rect, x, y);
      if (t == null || (s.landAt && !s.landAt(x, y))) continue;
      b.font = `900 ${fs}px ${FONT}`;
      const label = `${Math.round(t)}°`;
      const pw = b.measureText(label).width + 12 * u, ph = fs + 9 * u;
      b.font = `750 ${nfs}px ${FONT}`;
      const nw = b.measureText(tw.name).width;
      const box = { x1: x - Math.max(pw, nw) / 2 - 3, x2: x + Math.max(pw, nw) / 2 + 3, y1: y - ph - 6 * u, y2: y + nfs + 7 * u };
      if (s.cards.some((c) => !(box.x2 < c.x || box.x1 > c.x + c.w || box.y2 < c.y || box.y1 > c.y + c.h))) continue;
      if (placed.some((p) => !(box.x2 + 2 < p.x1 || box.x1 - 2 > p.x2 || box.y2 + 2 < p.y1 || box.y1 - 2 > p.y2))) continue;
      placed.push(box);
      n++;
      const c = tempRGB(t);
      b.save(); b.shadowColor = 'rgba(0,0,0,0.35)'; b.shadowBlur = 6 * u; b.shadowOffsetY = 1.5 * u;
      rr(b, x - pw / 2, y - ph - 6 * u, pw, ph, ph / 2); b.fillStyle = css(c); b.fill(); b.restore();
      rr(b, x - pw / 2, y - ph - 6 * u, pw, ph, ph / 2); b.strokeStyle = 'rgba(255,255,255,0.92)'; b.lineWidth = 1.4; b.stroke();
      b.font = `900 ${fs}px ${FONT}`; b.fillStyle = ink(c); b.fillText(label, x, y - 6 * u - ph / 2 + fs * 0.36);
      b.beginPath(); b.arc(x, y, 2.6 * u, 0, Math.PI * 2); b.fillStyle = '#fff'; b.fill(); b.strokeStyle = 'rgba(0,0,0,0.6)'; b.lineWidth = 1.2; b.stroke();
      b.font = `750 ${nfs}px ${FONT}`; b.lineWidth = 3 * u; b.strokeStyle = T.halo; b.lineJoin = 'round';
      b.strokeText(tw.name, x, y + nfs + 3 * u); b.fillStyle = T.ink; b.fillText(tw.name, x, y + nfs + 3 * u);
    }
  }

  /* the picture, then the glass cards over it */
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0); ctx.restore();
  for (const c of s.cards) {
    glass(ctx, base, px, T, c.x, c.y, c.w, c.h, c.r);
    c.paint(ctx, T, u);
  }
  if (!s.field) {
    ctx.fillStyle = T.ink2; ctx.font = `700 ${15 * u}px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(s.message || 'Loading the temperatures…', W / 2, H / 2);
  }
}

/* the cards, laid out for a W x H graphic (their rectangles keep the towns clear of them) */
function layoutCards(ctx, W, H, s) {
  const u = Math.min(W, H * 1.25) / 900, m = 18 * u, cards = [];
  /* header */
  const titleFs = 30 * u, subFs = 13.5 * u, eyeFs = 10.5 * u;
  ctx.font = `850 ${titleFs}px ${FONT}`; const tw = ctx.measureText(s.title).width;
  ctx.font = `650 ${subFs}px ${FONT}`; const sw = ctx.measureText(s.when).width;
  const hw = Math.min(W - 2 * m, Math.max(tw, sw) + 92 * u), hh = 98 * u;
  cards.push({ x: m, y: m, w: hw, h: hh, r: 22 * u, paint: (c, TT) => {
    const cx = m + 40 * u, cy = m + hh / 2;
    c.save(); c.beginPath(); c.arc(cx, cy, 22 * u, 0, Math.PI * 2); c.fillStyle = s.theme === 'dark' ? 'rgba(251,191,36,0.16)' : 'rgba(194,65,12,0.12)'; c.fill();
    c.strokeStyle = s.theme === 'dark' ? 'rgba(251,191,36,0.45)' : 'rgba(194,65,12,0.35)'; c.lineWidth = 1; c.stroke(); c.restore();
    thermometer(c, cx, cy - 1 * u, 1.25 * u, TT.accent);
    const x = m + 74 * u;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.font = `850 ${eyeFs}px ${FONT}`; c.fillStyle = TT.accent; c.fillText(s.eyebrow, x, m + 28 * u);
    c.font = `850 ${titleFs}px ${FONT}`; c.fillStyle = TT.ink; c.fillText(s.title, x, m + 60 * u, hw - 86 * u);
    c.font = `650 ${subFs}px ${FONT}`; c.fillStyle = TT.ink2; c.fillText(s.when, x, m + 82 * u, hw - 86 * u);
  } });
  /* the key */
  const kw = Math.min(W - 2 * m - (s.brandW + 12 * u), 470 * u), kh = 74 * u, ky = H - m - kh;
  cards.push({ x: m, y: ky, w: kw, h: kh, r: 18 * u, paint: (c, TT) => {
    const x0 = m + 16 * u, bw = kw - 32 * u, by = ky + 26 * u, bh = 14 * u;
    c.textAlign = 'left'; c.font = `850 ${9.5 * u}px ${FONT}`; c.fillStyle = TT.ink3; c.fillText('TEMPERATURE · °C', x0, ky + 18 * u);
    c.textAlign = 'right'; c.font = `650 ${8.5 * u}px ${FONT}`; c.fillText(s.source, m + kw - 16 * u, ky + 18 * u, kw * 0.62);
    const [lo, hi] = s.keyRange;
    const g = c.createLinearGradient(x0, 0, x0 + bw, 0);
    for (let i = 0; i <= 24; i++) {
      let t = lo + ((hi - lo) * i) / 24;
      if (s.bands) t = Math.floor(t / 2) * 2 + 1;
      g.addColorStop(i / 24, css(tempRGB(t)));
    }
    c.save(); rr(c, x0, by, bw, bh, bh / 2); c.fillStyle = g; c.fill(); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1; c.stroke(); c.restore();
    const span = hi - lo, step = span > 30 ? 10 : span > 14 ? 5 : span > 7 ? 2 : 1;
    c.font = `800 ${10 * u}px ${FONT}`; c.fillStyle = TT.ink2; c.textAlign = 'center';
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-6; t += step) c.fillText(`${t}°`, x0 + ((t - lo) / span) * bw, by + bh + 14 * u);
  } });
  /* brand */
  const bh2 = 46 * u, bw2 = s.brandW, bx = W - m - bw2, byy = H - m - bh2;
  cards.push({ x: bx, y: byy, w: bw2, h: bh2, r: bh2 / 2, paint: (c, TT) => {
    const lr = 15 * u, lx = bx + 8 * u + lr, ly = byy + bh2 / 2;
    if (s.logo) { c.save(); c.beginPath(); c.arc(lx, ly, lr, 0, Math.PI * 2); c.clip(); c.drawImage(s.logo, lx - lr, ly - lr, lr * 2, lr * 2); c.restore(); }
    else { c.beginPath(); c.arc(lx, ly, lr, 0, Math.PI * 2); c.fillStyle = TT.accent; c.fill(); }
    c.textAlign = 'left'; c.font = `850 ${13.5 * u}px ${FONT}`; c.fillStyle = TT.ink; c.fillText(s.handle, lx + lr + 9 * u, ly + 5 * u);
  } });
  /* highest and lowest */
  if (s.extremes) {
    const lines = [['HIGHEST', s.extremes.hi], ['LOWEST', s.extremes.lo]];
    ctx.font = `750 ${12 * u}px ${FONT}`;
    const ew = Math.max(...lines.map(([, e]) => ctx.measureText(e.where).width)) + 112 * u, eh = 92 * u;
    const ex = W - m - ew;
    if (ex >= m) {
      /* beside the header if there is room, else under it */
      const top = ex > m + hw + 12 * u ? m : m + hh + 12 * u;
      cards.push({ x: ex, y: top, w: ew, h: eh, r: 20 * u, paint: (c, TT) => {
        lines.forEach(([k, e], i) => {
          const y = top + 30 * u + i * 38 * u, col = tempRGB(e.t);
          c.save(); rr(c, ex + 14 * u, y - 18 * u, 58 * u, 26 * u, 13 * u); c.fillStyle = css(col); c.fill(); c.restore();
          c.textAlign = 'center'; c.font = `900 ${15 * u}px ${FONT}`; c.fillStyle = ink(col); c.fillText(`${Math.round(e.t)}°`, ex + 43 * u, y + 0.5 * u);
          c.textAlign = 'left'; c.font = `850 ${8.5 * u}px ${FONT}`; c.fillStyle = TT.ink3; c.fillText(k, ex + 84 * u, y - 7 * u);
          c.font = `750 ${12 * u}px ${FONT}`; c.fillStyle = TT.ink; c.fillText(e.where, ex + 84 * u, y + 8 * u);
        });
      } });
    }
  }
  return cards;
}

/* ── the tool ──────────────────────────────────────────────────────────────────────────────── */
export default function TemperatureMapTool({ siteLogoUrl = '' }) {
  const wrapRef = useRef(null), mapElRef = useRef(null), canvasRef = useRef(null), mapRef = useRef(null);
  const [sources, setSources] = useState(null);
  const [src, setSrc] = useState('now');
  const [nowTime, setNowTime] = useState('');            // '' = the newest analysis
  const [ukvIdx, setUkvIdx] = useState(0);
  const [terrain, setTerrain] = useState(true);
  const [theme, setTheme] = useState('dark');
  const [towns, setTowns] = useState('normal');
  const [counties, setCounties] = useState(true);
  const [sea, setSea] = useState(true);
  const [bands, setBands] = useState(false);
  const [showExtremes, setShowExtremes] = useState(true);
  const [keyMode, setKeyMode] = useState('fit');
  const [format, setFormat] = useState('landscape');
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('@MyWeatherUK');
  const [field, setField] = useState(null);
  const [status, setStatus] = useState({ busy: true, text: 'Starting…' });
  const [exporting, setExporting] = useState(false);
  const [geo, setGeo] = useState(null);
  const [townList, setTownList] = useState(null);
  const [logo, setLogo] = useState(null);
  const [tick, setTick] = useState(0);                 // redraws on pan / zoom
  const [boxW, setBoxW] = useState(800);
  const fetchRef = useRef(null);

  useEffect(() => { loadCounties().then(setGeo).catch(() => {}); loadTowns().then(setTownList); }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      let url = siteLogoUrl;
      if (!url) url = (await base44.entities.SiteSettings.list().catch(() => []))?.[0]?.logo_url;
      if (!url) return;
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => live && setLogo(img); img.src = url;
    })();
    return () => { live = false; };
  }, [siteLogoUrl]);

  const loadSources = useCallback(async () => {
    try {
      const r = await fetch('/api/studio/temperature/sources', { headers: authHeaders() });
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'The temperature map needs an admin session.' : `HTTP ${r.status}`);
      const j = await r.json();
      setSources(j);
      const nowMs = Date.now();
      setUkvIdx((i) => (i ? i : Math.max(0, j.ukv.findIndex((h) => Date.parse(h.valid) >= nowMs))));
    } catch (e) { setStatus({ busy: false, error: true, text: e.message }); }
  }, []);
  useEffect(() => { loadSources(); }, [loadSources]);

  const fmt = FORMATS[format];
  const hour = sources?.ukv?.[ukvIdx] || null;
  const analysis = src === 'now' ? (nowTime || sources?.now?.[0] || '') : '';

  /* the preview's size: the column's width, or the window's height for tall formats */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const fit = () => setBoxW(Math.round(Math.min(el.clientWidth, Math.max(320, (window.innerHeight - 170) * (fmt.w / fmt.h)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [fmt.w, fmt.h]);
  const boxH = Math.round((boxW * fmt.h) / fmt.w);

  /* Leaflet: no tiles, only pan and zoom */
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !mapElRef.current || mapRef.current) return;
      const map = L.map(mapElRef.current, {
        zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 4.5, maxZoom: 12.5, zoomControl: false, attributionControl: false,   // zoom is on the toolbar, clear of the cards
        zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
        maxBounds: [[46.5, -17], [64, 7]], maxBoundsViscosity: 0.7,
      });
      map.fitBounds(VIEWS.all.b);
      mapRef.current = map;
      map.on('move zoom', () => setTick((t) => t + 1));
      map.on('moveend zoomend', () => fetchRef.current?.());
      setTick((t) => t + 1);
      fetchRef.current?.();
    });
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);
  useEffect(() => { const m = mapRef.current; if (m) { m.invalidateSize({ pan: false }); fetchRef.current?.(); } }, [boxW, boxH]);

  /* the field for the view, at the canvas's pixel size, after a pan or zoom settles */
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const query = useCallback((w, h) => {
    const map = mapRef.current;
    if (!map || (!analysis && !hour)) return null;
    const p = projOf(map), W = map.getSize().x, H = map.getSize().y;
    const q = { lonMin: p.lon(0), lonMax: p.lon(W), latMin: p.lat(H), latMax: p.lat(0), w: Math.round(w), h: Math.round(h), terrain: terrain ? 1 : 0 };
    return src === 'ukv' ? { ...q, src: 'ukv', tag: hour.tag, step: hour.step } : { ...q, src: 'now', time: analysis };
  }, [src, analysis, hour, terrain]);
  const ensureBuilt = useCallback(async (alive) => {
    if (src !== 'ukv' || !hour) return true;
    return stepReady('ukv', hour.tag, 't2', hour.step, { alive, onStatus: (text) => setStatus({ busy: true, text }) });
  }, [src, hour]);
  useEffect(() => {
    let ctrl = null, timer = null;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const map = mapRef.current;
        if (!map) return;
        const q = query(map.getSize().x * Math.min(dpr, 1.5), map.getSize().y * Math.min(dpr, 1.5));
        if (!q) return;
        ctrl?.abort();
        const c = new AbortController(); ctrl = c;
        setStatus({ busy: true, text: 'Making the temperature field…' });
        try {
          if (!(await ensureBuilt(() => !c.signal.aborted))) { if (!c.signal.aborted) setStatus({ busy: false, error: true, text: 'This UKV run has no temperature for that hour.' }); return; }
          const f = await fetchField(q, c.signal);
          if (c.signal.aborted) return;
          f.box = { lonMin: q.lonMin, lonMax: q.lonMax, latMin: q.latMin, latMax: q.latMax };
          setField(f);
          setStatus({ busy: false, text: `${f.w} × ${f.h} px field · ${f.head.terrain ? 'terrain-refined to ~250 m' : 'the 2 km grid'}` });
        } catch (e) {
          if (e.name !== 'AbortError') setStatus({ busy: false, error: true, text: e.message || 'The field could not be made' });
        }
      }, 250);
    };
    fetchRef.current = run;
    run();
    return () => { clearTimeout(timer); ctrl?.abort(); };
  }, [query, ensureBuilt, dpr]);

  const img = useMemo(() => (field ? fieldImage(field, bands) : null), [field, bands]);
  const sortedTowns = useMemo(() => (townList ? [...townList].sort((a, b) => b.pop - a.pop) : null), [townList]);

  /* what the graphic says about itself */
  const valid = field?.head?.valid || (src === 'ukv' ? hour?.valid : analysis) || null;
  const autoTitle = src === 'now' ? 'Temperatures right now' : 'Forecast temperatures';
  const when = valid ? `${LONDON(valid, { weekday: 'long', day: 'numeric', month: 'long' })} · ${LONDON(valid, { hour: '2-digit', minute: '2-digit', hour12: false })} ${tzName(valid)}${src === 'ukv' && field?.head?.run ? ` · UKV ${field.head.run.slice(11, 13)}Z run` : ''}` : '';
  const sourceLine = `Met Office UKV${src === 'now' ? ' + airport reports' : ''}${field?.head?.terrain ? ' · terrain ~250 m, Copernicus DEM' : ''}`;

  /* everything a draw needs, for any size */
  const scene = useCallback((map, W, H, f, image, ctx) => {
    const proj = projOf(map);
    const scaleW = W / map.getSize().x;
    const p2 = scaleW === 1 ? proj : { x: (lon) => proj.x(lon) * scaleW, y: (lat) => proj.y(lat) * scaleW, lon: (x) => proj.lon(x / scaleW), lat: (y) => proj.lat(y / scaleW) };
    const paths = geo ? landPaths(geo, p2, Math.max(0.35, 0.7)) : null;
    /* land, for the towns and the extremes: a small mask of the field's own pixels */
    let landAt = null, stats = null;
    if (f && paths) {
      const rect = { x: p2.x(f.box.lonMin), y: p2.y(f.box.latMax), w: p2.x(f.box.lonMax) - p2.x(f.box.lonMin), h: p2.y(f.box.latMin) - p2.y(f.box.latMax) };
      const mw = Math.min(f.w, 900), mh = Math.round((mw * f.h) / f.w);
      const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
      const mx = mc.getContext('2d');
      mx.setTransform(mw / rect.w, 0, 0, mh / rect.h, (-rect.x * mw) / rect.w, (-rect.y * mh) / rect.h);
      mx.fill(paths.land, 'evenodd');
      const md = mx.getImageData(0, 0, mw, mh).data;
      landAt = (x, y) => { const i = Math.floor(((x - rect.x) / rect.w) * mw), j = Math.floor(((y - rect.y) / rect.h) * mh); return i >= 0 && j >= 0 && i < mw && j < mh && md[(j * mw + i) * 4 + 3] > 127; };
      let lo = Infinity, hi = -Infinity, li = -1, hiIdx = -1;
      for (let j = 0; j < mh; j++) {
        for (let i = 0; i < mw; i++) {
          if (md[(j * mw + i) * 4 + 3] < 128) continue;
          const v = f.data[Math.floor((j / mh) * f.h) * f.w + Math.floor((i / mw) * f.w)];
          if (v === -32768) continue;
          if (v < lo) { lo = v; li = j * mw + i; }
          if (v > hi) { hi = v; hiIdx = j * mw + i; }
        }
      }
      if (li >= 0) {
        const at = (k) => [p2.lon(rect.x + ((k % mw) + 0.5) / mw * rect.w), p2.lat(rect.y + (Math.floor(k / mw) + 0.5) / mh * rect.h)];
        const near = ([lon, lat]) => {
          let best = null, bd = Infinity;
          for (const t of townList || []) { const d = Math.hypot((t.lon - lon) * Math.cos(lat * D), t.lat - lat); if (d < bd) { bd = d; best = t; } }
          if (!best) return 'the map';
          const km = bd * 111;
          if (km < 5) return best.name;
          if (km < 12) return `near ${best.name}`;
          let hill = null, hr = 1;
          for (const [name, ulon, ulat, r] of UPLANDS) { const q = (Math.hypot((ulon - lon) * Math.cos(lat * D), ulat - lat) * 111) / r; if (q < hr) { hr = q; hill = name; } }
          return hill ? `in ${hill}` : `${Math.round(km)} km from ${best.name}`;
        };
        stats = { lo: lo / 100, hi: hi / 100, loAt: near(at(li)), hiAt: near(at(hiIdx)) };
      }
    }
    const keyRange = keyMode === 'fit' && stats
      ? [Math.floor(stats.lo / 2) * 2 - 2, Math.ceil(stats.hi / 2) * 2 + 2]
      : [-10, 35];
    ctx.font = `850 ${13.5 * (Math.min(W, H * 1.25) / 900)}px ${FONT}`;
    const u = Math.min(W, H * 1.25) / 900;
    const brandW = ctx.measureText(handle).width + 58 * u;
    const s = {
      proj: p2, field: f, img: image, paths, landAt, theme, sea, counties, bands,
      towns: sortedTowns, townCount: TOWN_COUNTS[towns], title: title || autoTitle, eyebrow: 'MYWEATHERUK · TEMPERATURE', when, source: sourceLine,
      keyRange, handle, logo, brandW,
      extremes: showExtremes && stats ? { hi: { t: stats.hi, where: stats.hiAt }, lo: { t: stats.lo, where: stats.loAt } } : null,
      message: status.error ? status.text : null,
    };
    s.cards = layoutCards(ctx, W, H, s);
    return s;
  }, [geo, theme, sea, counties, bands, sortedTowns, towns, title, autoTitle, when, sourceLine, keyMode, handle, logo, showExtremes, townList, status.error, status.text]);

  /* the preview */
  useEffect(() => {
    const map = mapRef.current, cv = canvasRef.current;
    if (!map || !cv) return;
    const W = map.getSize().x, H = map.getSize().y;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGraphic(ctx, W, H, dpr, scene(map, W, H, field, img, ctx));
  }, [tick, field, img, scene, dpr, boxW, boxH]);

  /* the export: the same drawing at the format's size, with a field fetched at that size */
  const download = async (type = 'png') => {
    const map = mapRef.current;
    if (!map) return;
    setExporting(true);
    try {
      const W = map.getSize().x, H = map.getSize().y, px = fmt.w / W;
      const q = query(fmt.w, fmt.h);
      const f = q ? await fetchField(q) : null;
      if (f) f.box = { lonMin: q.lonMin, lonMax: q.lonMax, latMin: q.latMin, latMax: q.latMax };
      const cv = document.createElement('canvas');
      cv.width = fmt.w; cv.height = fmt.h;
      const ctx = cv.getContext('2d');
      ctx.setTransform(px, 0, 0, px, 0, 0);
      await document.fonts?.ready;
      drawGraphic(ctx, W, H, px, scene(map, W, H, f || field, f ? fieldImage(f, bands) : img, ctx));
      const blob = await new Promise((res) => cv.toBlob(res, type === 'jpg' ? 'image/jpeg' : 'image/png', 0.95));
      const a = document.createElement('a');
      const stamp = valid ? LONDON(valid, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/[^0-9]/g, '') : 'map';
      a.href = URL.createObjectURL(blob); a.download = `temperature-${src}-${stamp}-${fmt.w}x${fmt.h}.${type}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    } catch (e) {
      setStatus({ busy: false, error: true, text: `Export failed: ${e.message}` });
    } finally { setExporting(false); }
  };

  const goView = (k) => mapRef.current?.fitBounds(VIEWS[k].b);
  const ukvLabel = (h) => `${LONDON(h.valid, { weekday: 'short', day: 'numeric' })} · ${LONDON(h.valid, { hour: '2-digit', minute: '2-digit', hour12: false })}`;

  const controls = (
    <>
      <Section id="temp-data" icon={Thermometer} color="#f59e0b" title="Temperatures" sub={src === 'now' ? 'Right now · Met Office analysis' : `Forecast · ${hour ? ukvLabel(hour) : '…'}`}>
        <Seg value={src} onChange={setSrc} color="#f59e0b" options={[['now', 'Right now', Clock], ['ukv', 'Forecast', CalendarClock]]} />
        {src === 'now' ? (
          <Field label="Analysis time">
            <select className="sg-input" value={nowTime} onChange={(e) => setNowTime(e.target.value)}>
              <option value="">Newest{sources?.now?.[0] ? ` (${LONDON(sources.now[0], { hour: '2-digit', minute: '2-digit', hour12: false })})` : ''}</option>
              {(sources?.now || []).slice(1).map((t) => <option key={t} value={t}>{LONDON(t, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Forecast hour (UKV)">
            <div className="sg-row" style={{ flexWrap: 'nowrap' }}>
              <Btn icon={ChevronLeft} disabled={ukvIdx <= 0} onClick={() => setUkvIdx((i) => Math.max(0, i - 1))} aria-label="Earlier" />
              <select className="sg-input" value={ukvIdx} onChange={(e) => setUkvIdx(Number(e.target.value))}>
                {(sources?.ukv || []).map((h, i) => <option key={h.valid} value={i}>{ukvLabel(h)} (T+{h.step})</option>)}
              </select>
              <Btn icon={ChevronRight} disabled={!sources || ukvIdx >= sources.ukv.length - 1} onClick={() => setUkvIdx((i) => Math.min(sources.ukv.length - 1, i + 1))} aria-label="Later" />
            </div>
          </Field>
        )}
        <div className="sg-row">
          <Btn sm on={terrain} color="#22c55e" onClick={() => setTerrain((v) => !v)} disabled={sources && !sources.terrain}>Terrain detail (~250 m)</Btn>
          <Btn sm icon={RefreshCw} onClick={() => { loadSources(); fetchRef.current?.(); }}>Refresh</Btn>
        </div>
        <span className="sg-status" style={{ '--c': status.error ? '#f87171' : status.busy ? '#facc15' : '#4ade80' }}><i />{status.text}</span>
        <p className="sg-note">
          {src === 'now'
            ? 'The Met Office UKV 2 km model corrected by the UK and Irish airports\' own reports, every 15 minutes.'
            : 'The Met Office UKV 2 km model: hourly to T+54, then 3-hourly to T+120 from the 03Z and 15Z runs.'}
          {' '}Terrain detail adds the hills and valleys the 2 km grid cannot see, using the lapse rate measured from the field itself, so cold valleys on a still night come out colder, not warmer. All of it from AWS open data.
        </p>
      </Section>

      <Section id="temp-look" icon={Sun} color="#38bdf8" title="Look" sub={`${theme === 'dark' ? 'Dark' : 'Light'} · ${FORMATS[format].label}`}>
        <div className="sg-row">
          <Seg value={theme} onChange={setTheme} options={[['dark', 'Dark', Moon], ['light', 'Light', Sun]]} />
          <Seg value={format} onChange={setFormat} options={Object.entries(FORMATS).map(([k, v]) => [k, v.label])} />
        </div>
        <div>
          <span className="sg-label">Towns</span>
          <Seg value={towns} onChange={setTowns} options={[['off', 'Off'], ['few', 'Few'], ['normal', 'Normal'], ['many', 'Many']]} />
        </div>
        <div className="sg-row">
          <Btn sm on={counties} onClick={() => setCounties((v) => !v)}>County lines</Btn>
          <Btn sm on={sea} onClick={() => setSea((v) => !v)}>Sea temperatures</Btn>
          <Btn sm on={bands} onClick={() => setBands((v) => !v)}>2° bands</Btn>
          <Btn sm on={showExtremes} onClick={() => setShowExtremes((v) => !v)}>Highest & lowest</Btn>
        </div>
        <div>
          <span className="sg-label">Key</span>
          <Seg value={keyMode} onChange={setKeyMode} options={[['fit', 'Fitted to the map'], ['full', 'Full scale (−10 to 35°)']]} />
        </div>
      </Section>

      <Section id="temp-text" icon={Type} color="#a78bfa" title="Text" sub={title || autoTitle}>
        <Field label="Title"><input className="sg-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} /></Field>
        <Field label="Handle"><input className="sg-input" value={handle} onChange={(e) => setHandle(e.target.value)} /></Field>
      </Section>

      <Section id="temp-export" icon={Download} color="#0284c7" title="Export" sub={`${fmt.w} × ${fmt.h} px`}>
        <div className="sg-row">
          <Btn primary color="#0284c7" icon={exporting ? Loader2 : Download} disabled={exporting || !field} onClick={() => download('png')}>{exporting ? 'Making it…' : 'Download PNG'}</Btn>
          <Btn icon={Download} disabled={exporting || !field} onClick={() => download('jpg')}>JPG</Btn>
        </div>
        <p className="sg-note">The download is the view on screen at {fmt.w} × {fmt.h}, with the temperatures worked out again at that size.</p>
      </Section>
    </>
  );

  const toolbar = (
    <div className="sg-toolbar">
      <MapIcon style={{ width: 15, height: 15, color: 'var(--sg-dim)' }} />
      {Object.entries(VIEWS).map(([k, v]) => <Btn key={k} sm onClick={() => goView(k)}>{v.label}</Btn>)}
      <span className="sg-grow" />
      {status.busy && <Loader2 className="sg-spin" style={{ width: 15, height: 15, color: 'var(--sg-dim)' }} />}
      <Btn sm icon={ZoomIn} onClick={() => mapRef.current?.zoomIn()} title="Zoom in (or scroll, or double-click the map)" />
      <Btn sm icon={ZoomOut} onClick={() => mapRef.current?.zoomOut()} title="Zoom out" />
      <Btn sm icon={Maximize} onClick={() => goView('all')} title="Back to the whole map" />
      <Btn sm primary color="#0284c7" icon={exporting ? Loader2 : Download} disabled={exporting || !field} onClick={() => download('png')}>PNG</Btn>
    </div>
  );

  return (
    <StudioLayout controls={controls} toolbar={toolbar} preview={(
      <div ref={wrapRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: boxW, height: boxH, borderRadius: 18, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.35)', background: THEMES[theme].sea }}>
          <div ref={mapElRef} style={{ position: 'absolute', inset: 0, background: 'transparent' }} />
          <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, zIndex: 450, pointerEvents: 'none' }} />
        </div>
      </div>
    )} />
  );
}
