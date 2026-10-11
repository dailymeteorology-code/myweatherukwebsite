/* ═════════════════════════════════════════════════════════════════════════
   ClimateAnomalyGraphicTool — "Monthly Climate": how a month (or a run of
   months) turned out across the UK, as a simple map + key, 1080×1920 JPG,
   light or dark.

   DATA (no Open-Meteo): the Met Office's own monthly statistics, via the server
   (/api/pastfuture/climate, server/pastFuture/index.js) — the HadUK-Grid areal
   series for the 10 UK climate districts and the UK, and the 37 historic
   stations, all back to the 19th century.

   MAP: one continuous field across the UK. The anomaly (difference, or % of
   average) is known at every station and as an area-average for every district;
   those anchors are blended with a Gaussian weight (≈70 km) onto a grid,
   interpolated per pixel and banded with the colour key, then clipped to the UK
   (the district outlines, so the Republic of Ireland, which has no Met Office
   data, stays plain). Anomalies vary smoothly in space, which is what makes
   interpolating them sound; the absolute values would not be.

   PERIODS: one month or up to twelve in a row. Temperatures are averaged over
   the period, rainfall / sunshine / day counts are summed, and each is compared
   with the same period's 1991-2020 average.
   ═════════════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, Thermometer, CloudRain, Sun, Snowflake, Droplets, Moon } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { loadUKCoastline, makeProjector, makeInverseProjector } from '@/lib/ukCoastline';
import { FONT, roundRect, fitFont, loadImage, downloadCanvas } from '@/lib/canvasGraphic';

const W = 1080, H = 1920;
const BBOX = { lonMin: -10.7, lonMax: 2.2, latMin: 49.8, latMax: 60.95 };
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const MAP_W = 900;
const MAP_H = Math.round((MAP_W * (mercY(BBOX.latMax) - mercY(BBOX.latMin))) / (((BBOX.lonMax - BBOX.lonMin) * Math.PI) / 180));
const MAP_X = (W - MAP_W) / 2, MAP_Y = 236;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));

const TEMP = {
  steps: [-3, -2.5, -2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2, 2.5, 3],
  colors: ['#08306b', '#1f5aa6', '#3a7fc4', '#6aa8d8', '#9cc9e6', '#cde3f1', '#f1f1ef', '#fbd9c6', '#f5ad8e', '#ea7c5c', '#d24a3a', '#b01e2a', '#7a0b1e'],
};
const VARS = {
  Tmean: { label: 'Mean temperature', short: 'Mean temp', mode: 'diff', agg: 'mean', pal: TEMP, hi: 'warmest', lo: 'coldest', st: (r) => (r.tmax != null && r.tmin != null ? (r.tmax + r.tmin) / 2 : null), icon: Thermometer, accent: '#e11d48' },
  Tmax: { label: 'Maximum temperature', short: 'Max temp', mode: 'diff', agg: 'mean', pal: TEMP, hi: 'warmest', lo: 'coldest', st: (r) => r.tmax, icon: Thermometer, accent: '#ea580c' },
  Tmin: { label: 'Minimum temperature', short: 'Min temp', mode: 'diff', agg: 'mean', pal: TEMP, hi: 'mildest', lo: 'coldest', st: (r) => r.tmin, icon: Thermometer, accent: '#2563eb' },
  Rainfall: {
    label: 'Rainfall', short: 'Rainfall', unit: 'mm', mode: 'pct', agg: 'sum', hi: 'wettest', lo: 'driest', st: (r) => r.rain, icon: CloudRain, accent: '#0284c7',
    pal: { steps: [30, 50, 70, 90, 110, 130, 150, 175, 200], colors: ['#5c3310', '#8c5520', '#c08a4a', '#e3c38e', '#f1f1ef', '#bfe3d6', '#7ccabd', '#3fa2b5', '#2b6fb3', '#2a3c94'] },
  },
  Sunshine: {
    label: 'Sunshine', short: 'Sunshine', unit: 'hrs', mode: 'pct', agg: 'sum', hi: 'sunniest', lo: 'dullest', st: (r) => r.sun, icon: Sun, accent: '#d97706',
    pal: { steps: [60, 70, 80, 90, 110, 120, 130, 140], colors: ['#3a4150', '#566072', '#7a8396', '#a6adbb', '#f1f1ef', '#f8e3a0', '#f5c84f', '#eda21f', '#d97706'] },
  },
  Raindays1mm: {
    label: 'Rain days', short: 'Rain days', unit: 'days', mode: 'days', agg: 'sum', hi: 'most rain days', lo: 'fewest rain days', st: null, icon: Droplets, accent: '#0891b2',
    pal: { steps: [-8, -6, -4, -2, 2, 4, 6, 8], colors: ['#8c5520', '#c08a4a', '#e3c38e', '#f2e6c9', '#f1f1ef', '#bfe3d6', '#7ccabd', '#3fa2b5', '#2a3c94'] },
  },
  AirFrost: {
    label: 'Air frost days', short: 'Air frosts', unit: 'days', mode: 'days', agg: 'sum', hi: 'most frosts', lo: 'fewest frosts', st: (r) => r.af, icon: Snowflake, accent: '#3b82f6',
    pal: { steps: [-6, -4, -2, -1, 1, 2, 4, 6], colors: ['#b45309', '#d97706', '#f59e0b', '#fcd34d', '#f1f1ef', '#bfdbfe', '#93c5fd', '#3b82f6', '#1e3a8a'] },
  },
};
const THEMES = {
  light: { bg: '#f7f9fc', bg2: '#eaf0f7', ink: '#0f172a', ink2: '#475569', ink3: '#94a3b8', sea: '#dce7f2', other: '#c9d3df', coast: 'rgba(15,23,42,0.55)', panel: '#ffffff', line: '#e2e8f0' },
  dark: { bg: '#081022', bg2: '#0d1a36', ink: '#ffffff', ink2: '#cbd5e1', ink3: '#94a3b8', sea: '#0f2142', other: '#2a3a55', coast: 'rgba(226,232,240,0.6)', panel: 'rgba(15,28,56,0.85)', line: 'rgba(148,163,184,0.25)' },
};

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const colorFor = (pal, v) => { let i = 0; while (i < pal.steps.length && v >= pal.steps[i]) i++; return pal.colors[i]; };
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** The months of a period starting (y, m) and n long, as [year, monthIndex]. */
const periodMonths = (y, m, n) => Array.from({ length: n }, (_, k) => [y + Math.floor((m + k) / 12), (m + k) % 12]);

/** One value for a period from a series lookup get(y, m); null if any month is missing. */
function periodValue(get, y, m, n, agg) {
  let t = 0;
  for (const [yy, mm] of periodMonths(y, m, n)) { const v = get(yy, mm); if (v == null) return null; t += v; }
  return agg === 'mean' ? t / n : t;
}
/** Same period's 1991-2020 average (periods STARTING in 1991..2020; needs 20+). */
function periodNormal(get, m, n, agg) {
  const v = [];
  for (let y = 1991; y <= 2020; y++) { const x = periodValue(get, y, m, n, agg); if (x != null) v.push(x); }
  return v.length >= 20 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const anomaly = (meta, value, normal) => (value == null || normal == null ? null : meta.mode === 'pct' ? (100 * value) / normal : value - normal);
function fmtAnom(meta, a) {
  if (a == null) return '–';
  if (meta.mode === 'pct') return `${Math.round(a)}%`;
  const s = a > 0 ? '+' : a < 0 ? '−' : '±';
  return meta.mode === 'days' ? `${s}${Math.abs(Math.round(a))} days` : `${s}${Math.abs(a).toFixed(1)}°C`;
}
const fmtVal = (meta, v) => (v == null ? '–' : meta.mode === 'diff' ? `${v.toFixed(1)} °C` : `${Math.round(v)} ${meta.unit}`);
function periodLabel(y, m, n) {
  if (n === 1) return `${MONTHS[m]} ${y}`;
  const [ey, em] = periodMonths(y, m, n)[n - 1];
  return ey === y ? `${MON[m]}–${MON[em]} ${y}` : `${MON[m]} ${y} – ${MON[em]} ${ey}`;
}

export default function ClimateAnomalyGraphicTool({ siteLogoUrl = '' }) {
  const canvasRef = useRef(null);
  const [logoUrl, setLogoUrl] = useState(siteLogoUrl || '');
  const [variable, setVariable] = useState('Tmean');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [geo, setGeo] = useState(null);
  const [coast, setCoast] = useState(null);
  const [start, setStart] = useState(null);      // { y, m }
  const [end, setEnd] = useState(null);          // { y, m }
  const [theme, setTheme] = useState('light');
  const [handle, setHandle] = useState('@MyWeatherUK');
  const meta = VARS[variable];
  const T = THEMES[theme];

  useEffect(() => {
    if (siteLogoUrl) return;
    base44.entities.SiteSettings.list().then((l) => { if (l[0]?.logo_url) setLogoUrl(l[0].logo_url); }).catch(() => {});
  }, [siteLogoUrl]);
  useEffect(() => {
    fetch('/static-data/uk-climate-districts.geo.json').then((r) => r.json()).then(setGeo).catch(() => setError('District outlines missing'));
    loadUKCoastline({ bbox: BBOX, viewW: MAP_W, viewH: MAP_H }).then(setCoast);
  }, []);

  const load = useCallback(async (v) => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/pastfuture/climate?var=${v}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
      const ys = Object.keys(j.regions.UK).map(Number).sort((a, b) => b - a);
      for (const y of ys) {
        const m = j.regions.UK[y].map((x) => x != null).lastIndexOf(true);
        if (m >= 0) { setStart((c) => c ?? { y, m }); setEnd((c) => c ?? { y, m }); break; }
      }
    } catch (e) { setError(`Could not load Met Office data: ${e.message}`); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(variable); }, [variable, load]);

  const n = start && end ? (end.y - start.y) * 12 + (end.m - start.m) + 1 : 0;
  const nValid = n >= 1 && n <= 12;

  /* Anchors (stations + district area-averages) and the UK headline for the period. */
  const stats = useMemo(() => {
    if (!data || !geo || !nValid) return null;
    const { y, m } = start;
    const R = data.regions;
    const regionAnom = (id) => {
      const get = (yy, mm) => R[id]?.[yy]?.[mm] ?? null;
      const value = periodValue(get, y, m, n, meta.agg), normal = periodNormal(get, m, n, meta.agg);
      return { value, normal, anom: anomaly(meta, value, normal), get };
    };
    const uk = regionAnom('UK');
    if (uk.value == null) return { empty: true };
    const series = Object.keys(R.UK).map(Number).map((yy) => periodValue(uk.get, yy, m, n, meta.agg)).filter((v) => v != null);
    const high = uk.anom >= (meta.mode === 'pct' ? 100 : 0);
    const rank = 1 + series.filter((v) => (high ? v > uk.value : v < uk.value)).length;
    const since = Math.min(...Object.keys(R.UK).map(Number).filter((yy) => periodValue(uk.get, yy, m, n, meta.agg) != null));
    const anchors = [];
    for (const f of geo.features) {
      const a = regionAnom(f.properties.id).anom;
      if (a != null && f.properties.label) anchors.push({ lon: f.properties.label[0], lat: f.properties.label[1], a, w: 1.4 });
    }
    if (meta.st) for (const s of data.stations || []) {
      const by = {};
      for (const r of s.rows) (by[r.y] ||= [])[r.m - 1] = meta.st(r);
      const get = (yy, mm) => by[yy]?.[mm] ?? null;
      const a = anomaly(meta, periodValue(get, y, m, n, meta.agg), periodNormal(get, m, n, meta.agg));
      if (a != null) anchors.push({ lon: s.lon, lat: s.lat, a, w: 1 });
    }
    return { uk, rank, high, since, total: series.length, anchors };
  }, [data, geo, start, n, nValid, meta]);

  const draw = useCallback(async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const logo = await loadImage(logoUrl);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, T.bg); g.addColorStop(1, T.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!stats || stats.empty) {
      ctx.fillStyle = T.ink2; ctx.font = `700 36px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(loading ? 'Loading Met Office data…' : !nValid ? 'Pick 1 to 12 months' : 'No Met Office data for that period yet', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    // ── Title ──
    ctx.textBaseline = 'alphabetic';
    ctx.font = `900 24px ${FONT}`; ctx.fillStyle = meta.accent;
    ctx.fillText(periodLabel(start.y, start.m, n).toUpperCase(), 56, 86);
    fitFont(ctx, meta.label, 900, 72, logo ? W - 260 : W - 112); ctx.fillStyle = T.ink;
    ctx.fillText(meta.label, 56, 160);
    const { uk } = stats;
    const rankTxt = stats.rank <= 25 ? ` · ${stats.rank === 1 ? 'the' : ordinal(stats.rank)} ${stats.high ? meta.hi : meta.lo} since ${stats.since}` : '';
    ctx.font = `700 26px ${FONT}`; ctx.fillStyle = T.ink2;
    ctx.fillText(`UK ${fmtVal(meta, uk.value)} · ${fmtAnom(meta, uk.anom)}${meta.mode === 'pct' ? ' of average' : ''}${rankTxt}`, 56, 206);
    if (logo) { const s = 136; ctx.save(); ctx.beginPath(); ctx.arc(W - 56 - s / 2, 48 + s / 2, s / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(logo, W - 56 - s, 48, s, s); ctx.restore(); }

    // ── Map ──
    ctx.save(); ctx.translate(MAP_X, MAP_Y);
    roundRect(ctx, 0, 0, MAP_W, MAP_H, 28); ctx.fillStyle = T.sea; ctx.fill(); ctx.clip();
    const project = makeProjector({ bbox: BBOX, viewW: MAP_W, viewH: MAP_H });
    const land = new Path2D(); for (const d of coast || []) land.addPath(new Path2D(d));
    ctx.fillStyle = T.other; ctx.fill(land);
    const ukShape = new Path2D();
    for (const f of geo.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) ring.forEach(([lo, la], i) => { const [x, y] = project(lo, la); if (i) ukShape.lineTo(x, y); else ukShape.moveTo(x, y); });
    }
    // Gaussian blend of the anchors onto a coarse grid, then bilinear per pixel and banded.
    {
      const S = 5, gw = Math.ceil(MAP_W / S) + 1, gh = Math.ceil(MAP_H / S) + 1;
      const inv = makeInverseProjector({ bbox: BBOX, viewW: MAP_W, viewH: MAP_H });
      const A = stats.anchors.map((a) => ({ ...a, x: Math.cos((a.lat * Math.PI) / 180) * a.lon * 111, y: a.lat * 111 }));
      const L2 = 70 * 70, field = new Float32Array(gw * gh);
      for (let j = 0; j < gh; j++) {
        const lat = inv(0, j * S)[1], ky = lat * 111, kc = Math.cos((lat * Math.PI) / 180) * 111;
        for (let i = 0; i < gw; i++) {
          const kx = inv(i * S, 0)[0] * kc;
          let sw = 0, sv = 0, best = Infinity, bestA = 0;
          for (const a of A) {
            const d2 = (a.x - kx) ** 2 + (a.y - ky) ** 2, w = a.w * Math.exp(-d2 / L2);
            sw += w; sv += w * a.a;
            if (d2 < best) { best = d2; bestA = a.a; }
          }
          field[j * gw + i] = sw > 1e-6 ? sv / sw : bestA;
        }
      }
      const off = document.createElement('canvas'); off.width = MAP_W; off.height = MAP_H;
      const octx = off.getContext('2d'), img = octx.createImageData(MAP_W, MAP_H), px = img.data;
      const cols = meta.pal.colors.map(hexRgb);
      for (let y = 0; y < MAP_H; y++) {
        const fy = y / S, j0 = Math.min(gh - 2, Math.floor(fy)), v = fy - j0;
        for (let x = 0; x < MAP_W; x++) {
          const fx = x / S, i0 = Math.min(gw - 2, Math.floor(fx)), u = fx - i0, k = j0 * gw + i0;
          const val = (field[k] * (1 - u) + field[k + 1] * u) * (1 - v) + (field[k + gw] * (1 - u) + field[k + gw + 1] * u) * v;
          let b = 0; while (b < meta.pal.steps.length && val >= meta.pal.steps[b]) b++;
          const c = cols[b], o = (y * MAP_W + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.save(); ctx.clip(ukShape, 'nonzero'); ctx.drawImage(off, 0, 0); ctx.restore();
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = T.coast; ctx.lineWidth = 1.4; ctx.stroke(land);
    ctx.restore();

    // ── Key ──
    const KY = MAP_Y + MAP_H + 40;
    ctx.font = `900 19px ${FONT}`; ctx.fillStyle = T.ink3;
    ctx.fillText(meta.mode === 'pct' ? 'PERCENTAGE OF THE 1991–2020 AVERAGE' : meta.mode === 'days' ? 'DAYS ABOVE OR BELOW THE 1991–2020 AVERAGE' : '°C ABOVE OR BELOW THE 1991–2020 AVERAGE', 56, KY);
    {
      const nC = meta.pal.colors.length, lx = 56, lw = W - 112, bw = lw / nC;
      meta.pal.colors.forEach((c, i) => {
        ctx.fillStyle = c;
        if (i === 0) { roundRect(ctx, lx, KY + 18, bw + 10, 30, 8); ctx.fill(); }
        else if (i === nC - 1) { roundRect(ctx, lx + i * bw - 10, KY + 18, bw + 10, 30, 8); ctx.fill(); }
        else ctx.fillRect(lx + i * bw, KY + 18, bw, 30);
      });
      ctx.strokeStyle = T.line; ctx.lineWidth = 1; roundRect(ctx, lx, KY + 18, lw, 30, 8); ctx.stroke();
      ctx.font = `800 18px ${FONT}`; ctx.fillStyle = T.ink2; ctx.textAlign = 'center';
      meta.pal.steps.forEach((s, i) => ctx.fillText(meta.mode === 'pct' ? `${s}%` : `${s > 0 ? '+' : ''}${s}`, lx + (i + 1) * bw, KY + 76));
      ctx.textAlign = 'left';
    }

    // ── Footer ──
    ctx.font = `900 28px ${FONT}`; ctx.fillStyle = T.ink; ctx.fillText(handle, 56, H - 44);
    ctx.textAlign = 'right'; ctx.font = `600 16px ${FONT}`; ctx.fillStyle = T.ink3;
    ctx.fillText(`Contains Met Office data © Crown copyright ${new Date().getFullYear()}`, W - 56, H - 64);
    ctx.fillText('HadUK-Grid district series and station records · average 1991–2020', W - 56, H - 40);
    ctx.textAlign = 'left';
  }, [stats, meta, coast, geo, logoUrl, handle, start, n, nValid, loading, T]);

  useEffect(() => { draw(); }, [draw]);

  const years = useMemo(() => (data ? Object.keys(data.regions.UK).map(Number).sort((a, b) => b - a) : []), [data]);
  const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 8px' };
  const input = { padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.7)', color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit' };
  const chip = (on, col = '#38bdf8') => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, fontSize: 12, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: 'inherit',
    background: on ? `${col}2e` : 'rgba(148,163,184,0.06)', border: `1px solid ${on ? `${col}80` : 'rgba(148,163,184,0.15)'}`, color: on ? col : '#94a3b8',
  });
  const MonthPick = ({ value, onChange, title }) => (
    <div><p style={label}>{title}</p>
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={value?.m ?? ''} onChange={(e) => onChange({ ...value, m: +e.target.value })} style={input}>{MONTHS.map((mm, i) => <option key={mm} value={i}>{mm}</option>)}</select>
        <select value={value?.y ?? ''} onChange={(e) => onChange({ ...value, y: +e.target.value })} style={input}>{years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 18, padding: 20, borderRadius: 16, background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}>
        <div>
          <p style={label}>Variable</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(VARS).map(([id, v]) => {
              const I = v.icon;
              return <button key={id} type="button" style={chip(variable === id, v.accent)} onClick={() => setVariable(id)}><I style={{ width: 13, height: 13 }} />{v.short}</button>;
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <MonthPick title="From" value={start} onChange={setStart} />
          <MonthPick title="To" value={end} onChange={setEnd} />
          <button type="button" onClick={() => setEnd(start)} style={chip(false)}>Single month</button>
        </div>
        {!nValid && start && <p style={{ margin: 0, color: '#fcd34d', fontSize: 12.5 }}>"To" must be the same month as "From" or up to 11 months after it.</p>}
        {stats?.empty && <p style={{ margin: 0, color: '#fcd34d', fontSize: 12.5 }}>The Met Office hasn't published every month of that period yet. Figures appear early the following month.</p>}
        {error && <p style={{ margin: 0, color: '#fca5a5', fontSize: 12.5 }}>{error}</p>}
        <div>
          <p style={label}>Theme</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={chip(theme === 'light')} onClick={() => setTheme('light')}><Sun style={{ width: 13, height: 13 }} />Light</button>
            <button type="button" style={chip(theme === 'dark')} onClick={() => setTheme('dark')}><Moon style={{ width: 13, height: 13 }} />Dark</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><p style={label}>Handle</p><input value={handle} onChange={(e) => setHandle(e.target.value)} style={input} /></div>
          <button type="button" onClick={() => load(variable)} disabled={loading} style={chip(false)}>
            {loading ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <RefreshCw style={{ width: 13, height: 13 }} />} Refresh
          </button>
        </div>
        <button type="button" disabled={!stats || stats.empty}
          onClick={() => downloadCanvas(canvasRef.current, `uk-climate-${variable.toLowerCase()}-${start.y}-${String(start.m + 1).padStart(2, '0')}${n > 1 ? `-${n}m` : ''}-${theme}.jpg`)}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px', borderRadius: 10, background: '#0284c7', color: '#fff', border: 'none', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Download style={{ width: 16, height: 16 }} /> Download JPG (1080×1920)
        </button>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
          Met Office HadUK-Grid monthly series (10 climate districts) and the 37 historic stations, back to the 1800s. The map blends their differences from the 1991–2020 average into one smooth field across the UK.
        </p>
      </div>
      <canvas ref={canvasRef} width={W} height={H} style={{ width: 405, height: 720, borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.45)', flex: '0 0 auto' }} />
    </div>
  );
}
