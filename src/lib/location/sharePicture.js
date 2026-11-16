/* Share as a picture (Location Weather, 16 Nov 2026, Phase F): the place's forecast as a 1080 x 1920
   picture in the site's graphic style, clean and simple: the real logo, the sky of the moment behind,
   the temperature and the weather now, the forecast in words, the next hours and the next days.

   Laid out TikTok-safe, as every MyWeatherUK vertical graphic is: nothing to read above y 176 or below
   y 1440, and nothing to the right of x 900 below y 760, where the apps put their own buttons. The
   symbols are the page's own (WxIcon.jsx), drawn by React and read back as SVG, so the picture always
   shows the current set; the numbers are the page's, in the reader's units. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import WxIcon from '@/components/location/WxIcon';
import { condLabel, hhmm, isWet } from '@/lib/ukvLocation';
import { writtenForecast } from '@/lib/location/forecastText';
import { dayRange } from '@/lib/location/travel';
import { roundRect, loadImage } from '@/lib/canvasGraphic';

const W = 1080, H = 1920;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif";
const L = 72;                 // the left edge of everything
const R_HIGH = 1008;          // the right edge above y 760
const R_LOW = 900;            // ... and below it
const CARD_W = R_LOW - L;     // 828

/* ── the page's own symbols as images ── */
const icons = new Map();
function iconImage(cond, day, windy) {
  const k = `${cond}|${day ? 1 : 0}|${windy ? 1 : 0}`;
  if (!icons.has(k)) {
    const div = document.createElement('div');
    const root = createRoot(div);
    flushSync(() => root.render(React.createElement(WxIcon, { cond: cond || 'cloudy', day, windy, size: 256 })));
    let svg = div.innerHTML;
    root.unmount();
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    icons.set(k, loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`));
  }
  return icons.get(k);
}

/* ── the sky of the moment ── */
function skyOf(cond, sun) {
  const wet = isWet(cond);
  const grey = wet || ['cloudy', 'overcast', 'fog', 'mist', 'mostlyCloudy'].includes(cond);
  if (sun < -6) return { stops: grey ? ['#0b1626', '#162236', '#22303f'] : ['#040b1c', '#0a1a36', '#152c50'], glow: grey ? null : 'rgba(190,210,255,0.16)', stars: !grey };
  if (sun < 6) return { stops: grey ? ['#253045', '#444c5f', '#676573'] : ['#13254a', '#56508a', '#d08b6c'], glow: grey ? null : 'rgba(255,190,140,0.30)', stars: false };
  if (wet) return { stops: ['#334459', '#4b5c71', '#6b7c90'], glow: null, stars: false };
  if (grey) return { stops: ['#45576e', '#647690', '#8b9bb0'], glow: 'rgba(255,255,255,0.10)', stars: false };
  return { stops: ['#1352b0', '#2c7bd6', '#6cb2ee'], glow: 'rgba(255,240,190,0.42)', stars: false };
}
function drawSky(ctx, sky) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky.stops[0]); g.addColorStop(0.55, sky.stops[1]); g.addColorStop(1, sky.stops[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (sky.glow) {
    const r = ctx.createRadialGradient(W * 0.84, H * 0.16, 0, W * 0.84, H * 0.16, W * 0.95);
    r.addColorStop(0, sky.glow); r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  }
  if (sky.stars) {
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < 140; k++) {
      const x = rnd() * W, y = rnd() * H * 0.62, r = 0.6 + rnd() * 1.6;
      ctx.globalAlpha = 0.25 + rnd() * 0.6;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* ── text ── */
const font = (ctx, weight, size) => { ctx.font = `${weight} ${size}px ${FONT}`; };
function fit(ctx, text, weight, size, maxW) {
  font(ctx, weight, size);
  const w = ctx.measureText(text).width;
  if (w > maxW) font(ctx, weight, Math.floor((size * maxW) / w));
}
function lines(ctx, text, maxW) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width <= maxW || !line) line = t;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}
/* whole sentences that fit in `max` lines; the first one cut short with an ellipsis if it alone does not */
function sentencesIn(ctx, text, maxW, max) {
  /* a sentence ends at a full stop followed by a space and a capital: "6.2 mm" stays whole */
  const sentences = String(text).split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
  let take = [];
  for (const s of sentences) {
    const next = lines(ctx, [...take, s].join(' '), maxW);
    if (next.length > max) break;
    take = [...take, s];
  }
  if (take.length) return lines(ctx, take.join(' '), maxW);
  const ls = lines(ctx, sentences[0] || text, maxW).slice(0, max);
  ls[ls.length - 1] = `${ls[ls.length - 1].replace(/[,.;:]?$/, '')}…`;
  return ls;
}
function glass(ctx, x, y, w, h) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 34);
  ctx.fillStyle = 'rgba(6, 16, 34, 0.40)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.restore();
}
function caps(ctx, text, x, y, size = 24) {
  font(ctx, 700, size);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fillText(text.toUpperCase(), x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
const SEVERITY = { red: '#e23b3b', amber: '#f5a623', yellow: '#ffd426' };

/** The picture as a JPEG blob. */
export async function drawForecastPicture(model, { U, warnings = [] }) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const n = model.now;
  const deg = (c) => (c == null ? '—' : `${Math.round(U.temp(c))}°`);
  const nowMs = Date.now();

  try { await document.fonts?.ready; } catch { /* the system fonts are there anyway */ }
  const ahead = model.full.filter((h) => h.t > nowMs);
  const first = ahead[0];
  const hours = first ? ahead.filter((h) => (h.t - first.t) % (2 * 36e5) === 0).slice(0, 6) : [];
  const ol = (model.outlook?.days || []).filter((d) => !d.isToday).slice(0, 3);
  const [logo, nowIcon, ...rest] = await Promise.all([
    loadImage('/logo.png'),
    iconImage(n.cond, n.isDay, n.windy),
    ...hours.map((h) => iconImage(h.cond, h.isDay, h.windy)),
    ...ol.map((d) => iconImage(d.cond, true, d.windy)),
  ]);
  const hourIcons = rest.slice(0, hours.length), dayIcons = rest.slice(hours.length);

  drawSky(ctx, skyOf(n.cond, n.sun));
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 10, 30, 0.28)'; ctx.shadowBlur = 18;

  /* the brand: the real logo, the name, and when */
  const top = 196;
  if (logo) {
    /* the logo's middle is see-through: a navy disc behind it keeps its sun and cloud clear on a blue sky */
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b1a2c';
    ctx.beginPath(); ctx.arc(L + 46, top + 46, 45, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(logo, L, top, 92 * (logo.width / logo.height), 92);
    ctx.restore();
  }
  ctx.fillStyle = '#fff'; font(ctx, 800, 40); ctx.textAlign = 'left';
  ctx.fillText('MyWeatherUK', L + 114, top + 42);
  font(ctx, 500, 26); ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('Location weather', L + 114, top + 80);
  ctx.textAlign = 'right';
  const issued = new Date(nowMs).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).replace(',', ' ·');
  ctx.fillText(issued, R_HIGH, top + 42);
  ctx.textAlign = 'left';

  /* the place and now */
  ctx.fillStyle = '#fff';
  fit(ctx, model.location.name, 700, 70, R_HIGH - L);
  ctx.fillText(model.location.name, L, 392);
  font(ctx, 200, 250);
  ctx.fillText(deg(n.t2), L - 10, 642);
  if (nowIcon) { ctx.save(); ctx.shadowBlur = 0; ctx.drawImage(nowIcon, 768, 398, 236, 236); ctx.restore(); }
  font(ctx, 500, 46);
  ctx.fillText(condLabel(n.cond, n.isDay, n.windy), L, 706);
  const range = dayRange(model, nowMs);
  font(ctx, 400, 33); ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillText(`Feels like ${deg(n.feels)}${range ? `   ·   H:${deg(range.hi)}  L:${deg(range.lo)}` : ''}`, L, 752);
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

  /* the forecast in words, with the first warning for the place */
  const part = writtenForecast(model, U)[0];
  let y = 788;
  if (part) {
    font(ctx, 500, 33);
    const ls = sentencesIn(ctx, part.text, CARD_W - 64, 3);
    const h = 84 + ls.length * 44;
    glass(ctx, L, y, CARD_W, h);
    caps(ctx, part.label, L + 32, y + 52);
    const w = warnings[0];
    if (w) {
      const sev = String(w.severity || 'yellow').toLowerCase();
      const label = `${w.severity || 'Yellow'} warning · ${String(w.type || '').toLowerCase()}`;
      font(ctx, 700, 22);
      const pw = ctx.measureText(label).width + 36;
      roundRect(ctx, L + CARD_W - 28 - pw, y + 24, pw, 40, 20);
      ctx.fillStyle = SEVERITY[sev] || SEVERITY.yellow; ctx.fill();
      ctx.fillStyle = sev === 'red' ? '#fff' : '#1b1300'; ctx.textAlign = 'center';
      ctx.fillText(label, L + CARD_W - 28 - pw / 2, y + 52);
      ctx.textAlign = 'left';
    }
    font(ctx, 500, 33); ctx.fillStyle = '#fff';
    ls.forEach((t, k) => ctx.fillText(t, L + 32, y + 104 + k * 44));
    y += h + 18;
  }

  /* the next hours, every two */
  if (hours.length) {
    const h = 182;
    glass(ctx, L, y, CARD_W, h);
    const col = (CARD_W - 32) / hours.length;
    hours.forEach((x, k) => {
      const cx = L + 16 + col * (k + 0.5);
      ctx.textAlign = 'center';
      font(ctx, 600, 25); ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillText(hhmm(x.t), cx, y + 44);
      if (hourIcons[k]) ctx.drawImage(hourIcons[k], cx - 34, y + 58, 68, 68);
      font(ctx, 600, 36); ctx.fillStyle = '#fff';
      ctx.fillText(deg(x.t2), cx, y + 160);
    });
    ctx.textAlign = 'left';
    y += h + 18;
  }

  /* the next days: as many as fit above the safe line at y 1440 (three at most) */
  const row = 60;
  const fits = Math.min(ol.length, Math.floor((1440 - y - 28) / row));
  if (fits > 0) {
    const days = ol.slice(0, fits), h = 28 + fits * row;
    {
      glass(ctx, L, y, CARD_W, h);
      days.forEach((d, k) => {
        const ry = y + 14 + k * row, mid = ry + row / 2;
        font(ctx, 700, 32); ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
        ctx.fillText(d.label, L + 32, mid + 11);
        const lw = ctx.measureText(d.label).width;
        font(ctx, 400, 22); ctx.fillStyle = 'rgba(255,255,255,0.6)';
        if (L + 32 + lw + 12 + ctx.measureText(d.date).width < L + 286) ctx.fillText(d.date, L + 32 + lw + 12, mid + 9);
        if (dayIcons[k]) ctx.drawImage(dayIcons[k], L + 296, mid - 28, 56, 56);
        if ((d.pRain ?? 0) >= 20) {
          font(ctx, 700, 25); ctx.fillStyle = '#8fd0ff';
          ctx.fillText(`${Math.round(d.pRain / 10) * 10}%`, L + 372, mid + 9);
        }
        ctx.textAlign = 'right';
        font(ctx, 500, 32); ctx.fillStyle = 'rgba(255,255,255,0.62)';
        ctx.fillText(deg(d.lo), L + CARD_W - 132, mid + 11);
        font(ctx, 700, 32); ctx.fillStyle = '#fff';
        ctx.fillText(deg(d.hi), L + CARD_W - 32, mid + 11);
        ctx.textAlign = 'left';
        if (k < days.length - 1) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(L + 32, ry + row, CARD_W - 64, 1.5); }
      });
    }
  }

  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/jpeg', 0.92));
}

/** "MyWeatherUK-Dunstable-2026-11-16-0040.jpg" */
export function pictureName(model) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const v = (t) => p.find((x) => x.type === t)?.value || '';
  const place = String(model.location.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';
  return `MyWeatherUK-${place}-${v('year')}-${v('month')}-${v('day')}-${v('hour')}${v('minute')}.jpg`;
}
