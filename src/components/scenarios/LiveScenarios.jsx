/**
 * Live week-ahead scenarios graphic.
 *
 * Three scenarios built from 100 real ensemble members (ECMWF, GFS, UKMO),
 * drawn on one canvas so the exact image on screen can be downloaded as a
 * JPG and shared. Data: GET /api/scenarios/live (rebuilt daily at 06:00 UK
 * time by GitHub Actions, see .github/workflows/live-scenarios.yml).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { getJson, LIVE_FALLBACK } from './scenarioApi';

const W = 2400; const H = 1960;
const PANEL_W = 746; const PANEL_X = (i) => 40 + i * (PANEL_W + 40);
const MAP = { lon0: -11.2, lon1: 2.6, lat0: 49.6, lat1: 61.0 };
const MAP_W = 600;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const MAP_H = Math.round(MAP_W * (merc(MAP.lat1) - merc(MAP.lat0)) / ((MAP.lon1 - MAP.lon0) * Math.PI / 180));
const MAP_Y = 312;
const RANK_COL = ['#3ecf8e', '#f2b53a', '#ff6b81'];
const RAIN = [[10, 'rgba(120,190,255,0.30)'], [20, 'rgba(70,145,255,0.45)'], [40, 'rgba(80,95,240,0.55)'], [70, 'rgba(165,75,230,0.62)'], [100, 'rgba(230,70,190,0.68)']];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FONT = "'Archivo','DM Sans',system-ui,sans-serif";

function project(lon, lat, ox, oy) {
  const x = ox + ((lon - MAP.lon0) / (MAP.lon1 - MAP.lon0)) * MAP_W;
  const y = oy + ((merc(MAP.lat1) - merc(lat)) / (merc(MAP.lat1) - merc(MAP.lat0))) * MAP_H;
  return [x, y];
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function polys(geo, ctx, ox, oy) {
  ctx.beginPath();
  for (const f of geo.features) for (const poly of f.geometry.coordinates) for (const ring of poly) {
    ring.forEach(([lo, la], i) => { const [x, y] = project(lo, la, ox, oy); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
  }
}
/** Bilinear upsample of a lat×lon grid. */
function sampler(field, lats, lons) {
  const nl = lons.length; const dLat = lats[1] - lats[0]; const dLon = lons[1] - lons[0];
  return (lat, lon) => {
    const fi = Math.max(0, Math.min(lats.length - 1.0001, (lat - lats[0]) / dLat)); const fj = Math.max(0, Math.min(nl - 1.0001, (lon - lons[0]) / dLon));
    const i = Math.floor(fi); const j = Math.floor(fj); const ti = fi - i; const tj = fj - j;
    const v = (a, b) => field[a * nl + b];
    return (1 - ti) * ((1 - tj) * v(i, j) + tj * v(i, j + 1)) + ti * ((1 - tj) * v(i + 1, j) + tj * v(i + 1, j + 1));
  };
}
/** Marching squares on a fine grid → line segments in map pixels. */
function isobars(sample, ox, oy, level, n = 90) {
  const segs = [];
  const lon = (j) => MAP.lon0 - 1 + (j / n) * (MAP.lon1 - MAP.lon0 + 2);
  const lat = (i) => MAP.lat0 - 1 + (i / n) * (MAP.lat1 - MAP.lat0 + 2);
  const g = [];
  for (let i = 0; i <= n; i += 1) { g.push([]); for (let j = 0; j <= n; j += 1) g[i].push(sample(lat(i), lon(j))); }
  const interp = (i1, j1, i2, j2) => { const a = g[i1][j1]; const b = g[i2][j2]; const t = (level - a) / (b - a); return project(lon(j1 + (j2 - j1) * t), lat(i1 + (i2 - i1) * t), ox, oy); };
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const pts = [];
    const e = [[i, j, i, j + 1], [i, j + 1, i + 1, j + 1], [i + 1, j + 1, i + 1, j], [i + 1, j, i, j]];
    for (const [a, b, c, d] of e) { const v1 = g[a][b]; const v2 = g[c][d]; if ((v1 < level) !== (v2 < level)) pts.push(interp(a, b, c, d)); }
    if (pts.length === 2) segs.push(pts);
    if (pts.length === 4) { segs.push([pts[0], pts[1]]); segs.push([pts[2], pts[3]]); }
  }
  return segs;
}
const fmtDate = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', opts);

function drawGraphic(ctx, data, ukGeo, ctxGeo, logo) {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#08101f'); bg.addColorStop(1, '#0c1830');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Header
  if (logo) ctx.drawImage(logo, 40, 30, 140, 140);
  ctx.fillStyle = '#ffffff'; ctx.font = `900 76px ${FONT}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText('UK Weather Scenarios: The Week Ahead', 205, 108);
  ctx.fillStyle = '#9fb4d6'; ctx.font = `700 38px ${FONT}`;
  const from = fmtDate(data.validFrom, { weekday: 'short', day: 'numeric', month: 'short' });
  const to = fmtDate(data.validTo, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  ctx.fillText(`${from} – ${to}`, 207, 160);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff'; ctx.font = `800 34px ${FONT}`;
  const iss = new Date(data.issued);
  ctx.fillText(`Issued ${iss.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Europe/London' }).replace(/\//g, '.')} · ${iss.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`, W - 40, 92);
  ctx.fillStyle = '#9fb4d6'; ctx.font = `600 26px ${FONT}`;
  ctx.fillText('ECMWF · GFS · UKMO model runs', W - 40, 134);
  ctx.fillStyle = '#5f7598'; ctx.font = `700 24px ${FONT}`;
  ctx.fillText('MyWeatherUK V5.00', W - 40, 170);
  ctx.textAlign = 'left';

  data.scenarios.forEach((s, i) => {
    const px = PANEL_X(i); const col = RANK_COL[i];
    rr(ctx, px, 200, PANEL_W, H - 268, 28); ctx.fillStyle = 'rgba(20,32,58,0.92)'; ctx.fill();
    ctx.strokeStyle = `${col}66`; ctx.lineWidth = 3; ctx.stroke();

    // Rank + probability
    ctx.fillStyle = col; ctx.font = `900 44px ${FONT}`; ctx.fillText(`Scenario ${i + 1} · ${s.model}`, px + 30, 262);
    ctx.fillStyle = '#c9d6ea'; ctx.font = `700 28px ${FONT}`; ctx.fillText(`${s.rank} · ${s.modelFull}`, px + 30, 296);
    const pTxt = `${s.probability}%`; ctx.font = `900 64px ${FONT}`;
    const pw = ctx.measureText(pTxt).width + 48;
    rr(ctx, px + PANEL_W - pw - 26, 222, pw, 80, 40); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = '#07101f'; ctx.fillText(pTxt, px + PANEL_W - pw - 2, 285);

    // Map
    const ox = px + (PANEL_W - MAP_W) / 2; const oy = MAP_Y;
    ctx.save(); rr(ctx, ox, oy, MAP_W, MAP_H, 20); ctx.clip();
    ctx.fillStyle = '#0a1a33'; ctx.fillRect(ox, oy, MAP_W, MAP_H);
    // land first, rain over it, then coastlines
    polys(ctxGeo, ctx, ox, oy); ctx.fillStyle = '#7d8ea8'; ctx.fill('evenodd');
    polys(ukGeo, ctx, ox, oy); ctx.fillStyle = '#e4ebf5'; ctx.fill();
    const rain = sampler(s.rain, data.grid.lats, data.grid.lons);
    const step = 4;
    for (let y = oy; y < oy + MAP_H; y += step) for (let x = ox; x < ox + MAP_W; x += step) {
      const lon = MAP.lon0 + ((x + step / 2 - ox) / MAP_W) * (MAP.lon1 - MAP.lon0);
      const m = merc(MAP.lat1) - ((y + step / 2 - oy) / MAP_H) * (merc(MAP.lat1) - merc(MAP.lat0));
      const lat = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI;
      const v = rain(lat, lon); let c = null;
      for (const [t, cc] of RAIN) if (v >= t) c = cc;
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, step, step); }
    }
    polys(ctxGeo, ctx, ox, oy); ctx.strokeStyle = 'rgba(220,232,250,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    // isobars
    const p = sampler(s.mslp, data.grid.lats, data.grid.lons);
    const lo = Math.floor(Math.min(...s.mslp) / 4) * 4; const hi = Math.ceil(Math.max(...s.mslp) / 4) * 4;
    ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(20,30,50,0.55)';
    for (let lev = lo; lev <= hi; lev += 4) {
      const segs = isobars(p, ox, oy, lev);
      ctx.beginPath(); for (const [[x1, y1], [x2, y2]] of segs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(8,16,30,0.55)'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.stroke();
      const lab = segs.find(([[x, y]]) => x > ox + 40 && x < ox + MAP_W - 60 && y > oy + 30 && y < oy + MAP_H - 30 && (Math.abs(x - ox - 40) < 30 || Math.abs(y - oy - 30) < 20));
      if (lab) { ctx.font = `700 20px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText(String(lev), lab[0][0] + 4, lab[0][1] - 4); }
    }
    // pressure centres: big letters on the map; systems beyond the edge as edge markers
    const placed = [];
    for (const c of [...s.centres].sort((p, q) => Math.abs(q.hPa - 1012) - Math.abs(p.hPa - 1012))) {
      let [x, y] = project(c.lon, c.lat, ox, oy);
      const inside = x > ox + 30 && x < ox + MAP_W - 30 && y > oy + 50 && y < oy + MAP_H - 20;
      const colr = c.type === 'H' ? '#ffb648' : '#5aa9ff';
      ctx.textAlign = 'center';
      if (inside) {
        if (placed.some(([px2, py2]) => Math.hypot(px2 - x, py2 - y) < 90)) continue;
        placed.push([x, y]);
        ctx.font = `900 72px ${FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(5,12,26,0.85)'; ctx.strokeText(c.type, x, y); ctx.fillStyle = colr; ctx.fillText(c.type, x, y);
        ctx.font = `800 22px ${FONT}`; ctx.lineWidth = 5; ctx.strokeText(String(c.hPa), x, y + 28); ctx.fillStyle = '#ffffff'; ctx.fillText(String(c.hPa), x, y + 28);
      } else {
        if (Math.abs(c.hPa - 1012) < 6) continue;
        const ex = Math.max(ox + 46, Math.min(ox + MAP_W - 46, x)); const ey = Math.max(oy + 30, Math.min(oy + MAP_H - 30, y));
        if (placed.some(([px2, py2]) => Math.hypot(px2 - ex, py2 - ey) < 80)) continue;
        placed.push([ex, ey]);
        rr(ctx, ex - 42, ey - 22, 84, 44, 22); ctx.fillStyle = 'rgba(5,12,26,0.82)'; ctx.fill(); ctx.strokeStyle = colr; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = `900 26px ${FONT}`; ctx.fillStyle = colr; ctx.fillText(c.type, ex - 22, ey + 9);
        ctx.font = `800 18px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(String(c.hPa), ex + 12, ey + 7);
        const ang = Math.atan2(y - ey, x - ex); ctx.save(); ctx.translate(ex + Math.cos(ang) * 44, ey + Math.sin(ang) * 26); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fillStyle = colr; ctx.fill(); ctx.restore();
      }
      ctx.textAlign = 'left';
    }
    ctx.restore();
    rr(ctx, ox, oy, MAP_W, MAP_H, 20); ctx.strokeStyle = 'rgba(160,180,215,0.35)'; ctx.lineWidth = 2; ctx.stroke();

    // Headline + stats
    let y = MAP_Y + MAP_H + 52;
    ctx.fillStyle = '#ffffff'; ctx.font = `900 36px ${FONT}`;
    y = wrap(ctx, s.headline, px + 30, y, PANEL_W - 60, 42, 2);
    ctx.fillStyle = '#b8c6dc'; ctx.font = `500 23px ${FONT}`;
    y = wrap(ctx, s.summary, px + 30, y + 4, PANEL_W - 60, 30, 3);

    const w = s.week; const statY = y + 14; const cw = (PANEL_W - 60 - 30) / 4;
    const anom = (a) => (a == null ? '' : `${a >= 0 ? '+' : ''}${a.toFixed(1)}° vs avg`);
    [['Highs', `${Math.round(w.tmax)}°C`, anom(w.tmaxAnom)], ['Lows', `${Math.round(w.tmin)}°C`, anom(w.tminAnom)], ['Rain (UK avg)', `${Math.round(w.rain)} mm`, 'over 7 days'], ['Peak wind', `${w.windiest.mph} mph`, w.windiest.city]].forEach(([l, v, sub], k) => {
      const x = px + 30 + k * (cw + 10);
      rr(ctx, x, statY, cw, 118, 16); ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
      ctx.fillStyle = '#8ea3c4'; ctx.font = `700 19px ${FONT}`; ctx.fillText(l, x + 14, statY + 30);
      ctx.fillStyle = '#ffffff'; ctx.font = `900 36px ${FONT}`; ctx.fillText(v, x + 14, statY + 72);
      ctx.fillStyle = '#8ea3c4'; ctx.font = `600 17px ${FONT}`; ctx.fillText(sub, x + 14, statY + 100);
    });

    // 7-day strip
    const dY = statY + 140; const dw = (PANEL_W - 60) / 7;
    s.daily.forEach((d, k) => {
      const x = px + 30 + k * dw;
      ctx.fillStyle = '#c9d6ea'; ctx.font = `800 21px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(DOW[new Date(`${d.date}T12:00:00Z`).getUTCDay()], x + dw / 2, dY + 24);
      if (d.missing) { ctx.fillStyle = '#5f7598'; ctx.font = `700 18px ${FONT}`; ctx.fillText('no data', x + dw / 2, dY + 60); ctx.textAlign = 'left'; return; }
      ctx.fillStyle = '#ffffff'; ctx.font = `800 25px ${FONT}`; ctx.fillText(`${Math.round(d.tmax)}°`, x + dw / 2, dY + 56);
      const bh = Math.min(48, d.rain * 6); ctx.fillStyle = '#5aa9ff';
      rr(ctx, x + dw / 2 - 12, dY + 112 - bh, 24, Math.max(bh, 3), 4); ctx.fill();
      ctx.fillStyle = '#8ea3c4'; ctx.font = `600 16px ${FONT}`; ctx.fillText(`${d.rain.toFixed(1)}mm`, x + dw / 2, dY + 134);
      ctx.textAlign = 'left';
    });

    // Model agreement
    const mY = dY + 160;
    ctx.fillStyle = '#8ea3c4'; ctx.font = `700 19px ${FONT}`; ctx.fillText('Agreement with the other models (7-day pressure pattern)', px + 30, mY);
    s.agreement.forEach((m, k) => {
      const x = px + 30 + k * ((PANEL_W - 60) / 2); const bw = (PANEL_W - 60) / 2 - 20;
      ctx.fillStyle = '#ffffff'; ctx.font = `800 20px ${FONT}`; ctx.fillText(`${m.model} ${m.pct}%`, x, mY + 30);
      ctx.fillStyle = '#8ea3c4'; ctx.font = `600 16px ${FONT}`; ctx.fillText(`±${m.rms} hPa`, x + bw - 80, mY + 30);
      rr(ctx, x, mY + 42, bw, 12, 6); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
      rr(ctx, x, mY + 42, Math.max(6, bw * m.pct / 100), 12, 6); ctx.fillStyle = col; ctx.fill();
    });
  });

  // Footer: rain key + method
  const fy = H - 30;
  ctx.fillStyle = '#8ea3c4'; ctx.font = `700 22px ${FONT}`; ctx.fillText('7-day rain:', 40, fy);
  let kx = 180;
  for (const [t, c] of RAIN) { ctx.fillStyle = c.replace(/[\d.]+\)$/, '1)'); rr(ctx, kx, fy - 20, 30, 22, 5); ctx.fill(); ctx.fillStyle = '#c9d6ea'; ctx.fillText(`${t}+mm`, kx + 38, fy); kx += 140; }
  ctx.fillStyle = '#6f84a6'; ctx.font = `600 17px ${FONT}`; ctx.textAlign = 'right';
  ctx.fillText('Isobars: 7-day mean pressure (4 hPa). Likelihood = agreement between models, not a calibrated probability. Data: ECMWF, NOAA GFS, Met Office via Open-Meteo.', W - 40, fy);
  ctx.textAlign = 'left';
}
function wrap(ctx, text, x, y, maxW, lh, maxLines) {
  const words = text.split(' '); let line = ''; let n = 0;
  for (let i = 0; i < words.length; i += 1) {
    const t = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(t).width > maxW && line) {
      n += 1; if (n === maxLines) { ctx.fillText(`${line}…`, x, y); return y + lh; }
      ctx.fillText(line, x, y); y += lh; line = words[i];
    } else line = t;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}

export default function LiveScenarios() {
  const canvas = useRef(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [ready, setReady] = useState(false);

  const load = () => {
    setErr(null);
    getJson('/api/scenarios/live', `${LIVE_FALLBACK}?t=${Math.floor(Date.now() / 600000)}`).then(setData).catch(() => setErr('The week-ahead scenarios are not available yet — they are rebuilt every day at 06:00 UK time.'));
  };
  useEffect(load, []);

  useEffect(() => {
    if (!data || !canvas.current) return;
    let live = true;
    (async () => {
      const [uk, ctxGeo] = await Promise.all([getJson('/api/scenarios/regions.geo.json', '/static-data/regions.geo.json'), getJson('/api/scenarios/context.geo.json', '/static-data/context.geo.json')]);
      const logo = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = '/logo.png'; });
      try { await Promise.all([document.fonts.load(`900 40px Archivo`), document.fonts.load(`700 20px "DM Sans"`)]); } catch { /* fallback fonts */ }
      if (!live) return;
      drawGraphic(canvas.current.getContext('2d'), data, uk, ctxGeo, logo);
      setReady(true);
    })();
    return () => { live = false; };
  }, [data]);

  const download = () => {
    canvas.current.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `MyWeatherUK-week-ahead-scenarios-${data.validFrom}.jpg`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/jpeg', 0.93);
  };

  if (err) return <div className="panel" style={{ padding: 18 }}><p style={{ margin: 0 }}>{err}</p><button type="button" className="btn" style={{ marginTop: 10 }} onClick={load}><RefreshCw size={14} aria-hidden="true" />Try again</button></div>;
  if (!data) return <p className="muted"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading the latest ensemble scenarios…</p>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" className="btn primary" onClick={download} disabled={!ready}><Download size={15} aria-hidden="true" />Download JPG</button>
        <span className="note">Updated daily at 06:00 UK time from ECMWF, GFS and UKMO · issued {new Date(data.issued).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })}{data.ageHours > 30 ? ' — this is older than usual' : ''}</span>
      </div>
      <canvas ref={canvas} width={W} height={H} role="img" aria-label="Week-ahead UK weather scenarios graphic"
        style={{ width: '100%', height: 'auto', borderRadius: 16, border: '1px solid var(--line)', display: 'block', background: '#08101f' }} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', marginTop: 14 }}>
        {data.scenarios.map((s, i) => (
          <section key={i} className="panel" style={{ padding: 14 }}>
            <p className="h3" style={{ margin: 0, color: RANK_COL[i] }}>Scenario {i + 1} · {s.model} — {s.rank} ({s.probability}%)</p>
            <p style={{ margin: '6px 0', fontWeight: 700 }}>{s.headline}</p>
            <p className="muted" style={{ margin: 0, fontSize: '.88rem', lineHeight: 1.5 }}>{s.summary}</p>
            <p className="note" style={{ marginTop: 6 }}>{s.modelFull} · agreement {s.agreement.map((m) => `${m.pct}% with ${m.model}`).join(', ')}{s.daysAvailable < 7 ? ` · ${s.daysAvailable} of 7 days available` : ''}.</p>
          </section>
        ))}
      </div>
      <p className="note" style={{ marginTop: 10 }}>{data.method} These are forecasts, not certainties; the percentages describe how the ensemble members split, not a guarantee.</p>
    </div>
  );
}
