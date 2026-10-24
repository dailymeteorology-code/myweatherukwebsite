/* ════════════════════════════════════════════════════════════════════════════
   One warning as a picture to save and share (the warning map's "Save JPG").

   1920 × 1080. The map fills the frame — the same basemap as the warning map, light or dark
   with the site — framed on the warning's area, which is drawn in its colour with the places
   inside it named. A panel down the right gives the warning in full: the severity and type,
   exactly when it starts and ends (weekday, date, time, BST or GMT) and for how long, the Met
   Office's description, and the official likelihood-and-impact matrix with this warning's cell
   ticked. Drawn straight onto a canvas rather than photographed from the page, so it comes out
   the same on every screen.
   ════════════════════════════════════════════════════════════════════════════ */
import { ukZone } from '@/lib/ukZone';
import { LIKELIHOOD, IMPACT, SEV_HEX, sevInkOn, insideGeometries } from './MetOfficeWarning';

const W = 1920, H = 1080;
const PANEL = { x: 1196, y: 28, w: 696, h: 1024 };
const MAP_BOX = { x: 70, y: 110, w: 1050, h: 880 };          // where the area is framed: left of the panel
const FONT = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const TZ = 'Europe/London';
const MATRIX_COL = { G: '#c5e510', Y: '#ffe629', A: '#ff9b00', R: '#d1063b' };
const MATRIX = { 4: ['G', 'Y', 'A', 'R'], 3: ['G', 'Y', 'A', 'A'], 2: ['G', 'G', 'Y', 'A'], 1: ['G', 'G', 'Y', 'Y'] };

/* ── Web Mercator ───────────────────────────────────────────────────────── */
const worldX = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const worldY = (lat, z) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
};

const rings = (w) => (w.polygons || []).flatMap((g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []));

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/* ── text ───────────────────────────────────────────────────────────────── */
function wrap(ctx, text, width) {
  const out = [];
  for (const para of String(text || '').split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const font = (size, weight = 500) => `${weight} ${size}px ${FONT}`;

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const zoneOf = (d) => ukZone(d);   // BST or GMT at that time (lib/ukZone; browsers name winter differently)
const durationText = (ms) => {
  const h = Math.round(ms / 36e5);
  if (!(h > 0)) return '';
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} day${d === 1 ? '' : 's'}${r ? ` ${r} hour${r === 1 ? '' : 's'}` : ''}`;
};

/* ── the map ────────────────────────────────────────────────────────────── */
async function drawMap(ctx, w, { dark }) {
  const rs = rings(w);
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const poly of rs) for (const [lon, lat] of poly[0] || []) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  if (minLon > maxLon) { minLon = -8.6; maxLon = 2; minLat = 49.9; maxLat = 60.9; }   // no area: the UK
  /* the zoom that fits the area into the box left of the panel, not so close that a small
     warning loses the country around it */
  const spanX = worldX(maxLon, 0) - worldX(minLon, 0), spanY = worldY(minLat, 0) - worldY(maxLat, 0);
  const z = Math.max(4.6, Math.min(8.2, Math.log2(Math.min(MAP_BOX.w / Math.max(spanX, 1e-6), MAP_BOX.h / Math.max(spanY, 1e-6)))));
  const cx = (worldX(minLon, z) + worldX(maxLon, z)) / 2, cy = (worldY(minLat, z) + worldY(maxLat, z)) / 2;
  const ox = cx - (MAP_BOX.x + MAP_BOX.w / 2), oy = cy - (MAP_BOX.y + MAP_BOX.h / 2);   // world px -> canvas px
  const px = (lon, lat) => [worldX(lon, z) - ox, worldY(lat, z) - oy];

  /* ground, then the basemap tiles (whole zoom above, drawn smaller: crisper than stretching) */
  ctx.fillStyle = dark ? '#1b1d21' : '#e9ebee';
  ctx.fillRect(0, 0, W, H);
  const zt = Math.min(10, Math.ceil(z));
  const k = 2 ** (z - zt), size = 256 * k;
  const t0x = Math.floor(ox / size), t1x = Math.floor((ox + W) / size);
  const t0y = Math.max(0, Math.floor(oy / size)), t1y = Math.min(2 ** zt - 1, Math.floor((oy + H) / size));
  const base = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? 'Dark' : 'Light'}_Gray_Base/MapServer/tile`;
  const jobs = [];
  for (let ty = t0y; ty <= t1y; ty += 1) {
    for (let tx = t0x; tx <= t1x; tx += 1) {
      const wx = ((tx % 2 ** zt) + 2 ** zt) % 2 ** zt;
      jobs.push(loadImage(`${base}/${zt}/${ty}/${wx}`).then((im) => { if (im) ctx.drawImage(im, tx * size - ox, ty * size - oy, size + 0.5, size + 0.5); }));
    }
  }
  await Promise.all(jobs);

  /* the area */
  const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
  ctx.save();
  ctx.beginPath();
  for (const poly of rs) for (const ring of poly) ring.forEach(([lon, lat], i) => { const [x, y] = px(lon, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.fillStyle = hex; ctx.globalAlpha = 0.4; ctx.fill('evenodd');
  ctx.globalAlpha = 1; ctx.lineJoin = 'round';
  ctx.strokeStyle = dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.3)'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = hex; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();

  /* places: the ones inside the area by name, and the big cities outside it faintly, to place it */
  let places = [];
  try { places = (await (await fetch('/data/uk-places.json')).json()).places || []; } catch { /* no names */ }
  const maxTier = z <= 5.2 ? 2 : z <= 6.2 ? 3 : 4;
  const placed = [[PANEL.x - 20, 0, W, H]];
  const ink = dark ? '#f1f5f9' : '#0f172a', halo = dark ? 'rgba(10,12,18,0.9)' : 'rgba(255,255,255,0.95)';
  for (const [name, lat, lon, tier] of places) {
    const inside = insideGeometries(w.polygons, lat, lon);
    if (inside ? tier > maxTier : tier > 1) continue;
    const [x, y] = px(lon, lat);
    if (x < 20 || x > PANEL.x - 30 || y < 20 || y > H - 20) continue;
    const fs = tier === 1 ? 22 : tier === 2 ? 19 : 17;
    ctx.font = font(fs, tier <= 2 ? 750 : 650);
    const tw = ctx.measureText(name).width;
    const box = [x - 6, y - fs / 2 - 4, x + 12 + tw + 4, y + fs / 2 + 4];
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    ctx.globalAlpha = inside ? 1 : 0.55;
    ctx.fillStyle = ink; ctx.strokeStyle = halo; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, tier === 1 ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.textBaseline = 'middle';
    ctx.strokeText(name, x + 11, y); ctx.fillText(name, x + 11, y);
    ctx.globalAlpha = 1;
  }
}

/* ── the panel ──────────────────────────────────────────────────────────── */
function drawMatrix(ctx, x, y, width, likelihood, impact, { ink, faint }) {
  const L = Number(likelihood), I = Number(impact);
  const has = L >= 1 && L <= 4 && I >= 1 && I <= 4;
  const labelW = 132, gap = 4, cellW = (width - labelW - gap * 3) / 4, cellH = 50;
  ctx.textBaseline = 'middle';
  [4, 3, 2, 1].forEach((l, r) => {
    const yy = y + r * (cellH + gap);
    ctx.fillStyle = ink; ctx.textAlign = 'right';
    ctx.font = font(17, 650); ctx.fillText(LIKELIHOOD[l][0], x + labelW - 14, yy + cellH / 2 - 9);
    ctx.fillStyle = faint; ctx.font = font(14, 500); ctx.fillText(LIKELIHOOD[l][1], x + labelW - 14, yy + cellH / 2 + 11);
    [1, 2, 3, 4].forEach((i, c) => {
      const xx = x + labelW + c * (cellW + gap);
      ctx.fillStyle = MATRIX_COL[MATRIX[l][i - 1]];
      roundRect(ctx, xx, yy, cellW, cellH, 6); ctx.fill();
      if (has && l === L && i === I) {
        ctx.strokeStyle = '#111'; ctx.lineWidth = 3; roundRect(ctx, xx + 1.5, yy + 1.5, cellW - 3, cellH - 3, 5); ctx.stroke();
        ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(xx + cellW / 2 - 14, yy + cellH / 2 + 1); ctx.lineTo(xx + cellW / 2 - 4, yy + cellH / 2 + 10); ctx.lineTo(xx + cellW / 2 + 15, yy + cellH / 2 - 10); ctx.stroke();
      }
    });
  });
  const by = y + 4 * cellH + 3 * gap + 20;
  ctx.textAlign = 'center'; ctx.fillStyle = ink; ctx.font = font(16, 600);
  [1, 2, 3, 4].forEach((i, c) => ctx.fillText(IMPACT[i], x + labelW + c * (cellW + gap) + cellW / 2, by));
  ctx.fillStyle = faint; ctx.font = font(14, 600);
  ctx.fillText('IMPACT  →', x + labelW + (width - labelW) / 2, by + 26);
  ctx.save(); ctx.translate(x + 10, y + (4 * cellH + 3 * gap) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('LIKELIHOOD  →', 0, 0); ctx.restore();
  ctx.textAlign = 'left';
  return { bottom: by + 40, has, L, I };
}

function drawPanel(ctx, w, { dark, logo }) {
  const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
  const ink = dark ? '#f4f7fb' : '#0b1220', soft = dark ? '#b4c0d0' : '#45566b', faint = dark ? '#8291a6' : '#6b7a8f';
  const P = PANEL;
  /* the card */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  ctx.fillStyle = dark ? 'rgba(13,18,28,0.94)' : 'rgba(255,255,255,0.96)';
  roundRect(ctx, P.x, P.y, P.w, P.h, 30); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'; ctx.lineWidth = 1.5;
  roundRect(ctx, P.x, P.y, P.w, P.h, 30); ctx.stroke();

  const x = P.x + 46, width = P.w - 92;
  let y = P.y + 44;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  /* brand */
  if (logo) {
    ctx.save(); ctx.beginPath(); ctx.arc(x + 26, y + 22, 26, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(logo, x, y - 4, 52, 52); ctx.restore();
  }
  const bx = logo ? x + 68 : x;
  ctx.fillStyle = ink; ctx.font = font(30, 800); ctx.fillText('MyWeather', bx, y + 24);
  const mw = ctx.measureText('MyWeather').width;
  ctx.fillStyle = dark ? '#56b6f5' : '#1d74c4'; ctx.fillText('UK', bx + mw, y + 24);
  ctx.fillStyle = faint; ctx.font = font(14, 700); ctx.fillText('WEATHER WARNING', bx, y + 46);
  y += 84;

  /* severity and type */
  ctx.fillStyle = hex; roundRect(ctx, x, y, width, 112, 20); ctx.fill();
  ctx.fillStyle = sevInkOn(w.severity);
  ctx.font = font(19, 800); ctx.fillText(`${String(w.severity).toUpperCase()} WARNING`, x + 28, y + 40);
  ctx.font = font(44, 800); ctx.fillText(String(w.type || 'Weather'), x + 28, y + 90);
  /* the triangle */
  ctx.save(); ctx.translate(x + width - 76, y + 22); ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(54, 50); ctx.lineTo(-2, 50); ctx.closePath();
  ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 4.5; ctx.strokeStyle = sevInkOn(w.severity); ctx.stroke();
  ctx.fillRect(24, 16, 4, 18); ctx.beginPath(); ctx.arc(26, 41, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  y += 112 + 34;

  /* starts / ends */
  const from = w.validFrom ? new Date(w.validFrom) : null, to = w.validTo ? new Date(w.validTo) : null;
  const half = (width - 30) / 2;
  [['STARTS', from], ['ENDS', to]].forEach(([label, d], i) => {
    const xx = x + i * (half + 30);
    ctx.fillStyle = faint; ctx.font = font(14, 700); ctx.fillText(label, xx, y);
    if (!d) { ctx.fillStyle = ink; ctx.font = font(24, 600); ctx.fillText('—', xx, y + 44); return; }
    ctx.fillStyle = ink; ctx.font = font(46, 750); ctx.fillText(hmFmt.format(d), xx, y + 52);
    const tw = ctx.measureText(hmFmt.format(d)).width;
    ctx.fillStyle = soft; ctx.font = font(17, 650); ctx.fillText(zoneOf(d), xx + tw + 10, y + 52);
    ctx.fillStyle = ink; ctx.font = font(18, 550);
    const lines = wrap(ctx, dayFmt.format(d), half);
    lines.slice(0, 2).forEach((ln, j) => ctx.fillText(ln, xx, y + 84 + j * 24));
  });
  y += 84 + 24 + 22;
  if (from && to) {
    ctx.fillStyle = hex; roundRect(ctx, x, y, width, 8, 4); ctx.fill();
    ctx.fillStyle = soft; ctx.font = font(16, 600);
    ctx.fillText(`In force for ${durationText(to - from)}`, x, y + 34);
    y += 34;
  }
  y += 40;

  /* the matrix, from the bottom up, so the description gets whatever room is left */
  const matrixH = 4 * 50 + 3 * 4 + 20 + 40;
  const footY = P.y + P.h - 40;
  const matrixTop = footY - 46 - 34 - matrixH;

  /* description */
  const text = w.description || w.headline || '';
  if (text) {
    ctx.fillStyle = faint; ctx.font = font(14, 700); ctx.fillText('WHAT THE MET OFFICE SAYS', x, y);
    y += 14;
    ctx.fillStyle = ink; ctx.font = font(21, 500);
    const lh = 30;
    const room = Math.max(1, Math.floor((matrixTop - 46 - y) / lh));
    let lines = wrap(ctx, text, width);
    if (lines.length > room) {
      lines = lines.slice(0, room);
      let last = lines[room - 1];
      while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
      lines[room - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`;
    }
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + 22 + i * lh));
    y += 22 + (lines.length - 1) * lh + 20;
  }

  /* what to expect, in whatever room the description leaves: whole points only */
  const expect = (Array.isArray(w.whatToExpect) ? w.whatToExpect : []).filter(Boolean);
  const limit = matrixTop - 52;
  if (expect.length && y + 40 + 2 * 26 < limit) {
    y += 22;
    ctx.fillStyle = faint; ctx.font = font(14, 700); ctx.fillText('WHAT TO EXPECT', x, y);
    y += 10;
    ctx.font = font(18, 500);
    const lh = 25;
    for (const point of expect) {
      const lines = wrap(ctx, point, width - 22);
      if (y + 6 + lines.length * lh > limit) break;
      ctx.fillStyle = hex; ctx.beginPath(); ctx.arc(x + 5, y + 6 + lh / 2 + 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ink;
      lines.forEach((ln, i) => ctx.fillText(ln, x + 22, y + 6 + lh * (i + 1) - 6));
      y += lines.length * lh + 8;
    }
  }

  /* likelihood and impact */
  ctx.fillStyle = faint; ctx.font = font(14, 700); ctx.textBaseline = 'alphabetic';
  ctx.fillText('LIKELIHOOD AND IMPACT', x, matrixTop - 16);
  const m = drawMatrix(ctx, x, matrixTop, width, w.likelihood, w.impactLevel, { ink, faint });
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = soft; ctx.font = font(17, 600);
  ctx.fillText(m.has
    ? `${LIKELIHOOD[m.L][0]} likelihood (${LIKELIHOOD[m.L][1]}), ${IMPACT[m.I].toLowerCase()} impact`
    : 'The Met Office did not publish a likelihood and impact for this warning.', x, m.bottom + 4);

  /* source */
  const issued = w.issuedDate ? new Date(w.issuedDate) : null;
  ctx.fillStyle = faint; ctx.font = font(14, 600);
  ctx.fillText(w.isManual ? 'Issued by MyWeatherUK' : `Source: Met Office${issued ? ` · issued ${hmFmt.format(issued)} ${zoneOf(issued)}, ${new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(issued)}` : ''}`, x, footY);
}

/** Draw the warning and save it as a JPG. Resolves when the download has been handed over. */
export async function saveWarningImage(w, { dark = true, logoUrl = '' } = {}) {
  try { await document.fonts?.ready; } catch { /* system fonts */ }
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const [logo] = await Promise.all([
    (logoUrl ? loadImage(logoUrl) : Promise.resolve(null)).then((im) => im || loadImage('/logo.png')),
    drawMap(ctx, w, { dark }),
  ]);
  drawPanel(ctx, w, { dark, logo });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('The picture could not be made.');
  const day = w.validFrom ? new Date(w.validFrom).toISOString().slice(0, 10) : 'warning';
  const name = `MyWeatherUK ${w.severity} ${w.type} warning ${day}.jpg`.replace(/[\\/:*?"<>|]+/g, '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30e3);
  return name;
}
