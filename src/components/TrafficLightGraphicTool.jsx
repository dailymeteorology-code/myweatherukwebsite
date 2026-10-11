/* ═════════════════════════════════════════════════════════════════════════
   TrafficLightGraphicTool — "Likelihood Card": how likely a hazard is over the
   next seven days, as a 1080×1920 JPG.

   DATA (no Open-Meteo): the Met Office DataHub site-specific DAILY forecast for
   14 UK places (/api/pastfuture/likelihood, server/pastFuture/index.js). For
   thunder, heavy rain, snow, heavy snow and hail the card shows the Met Office's
   own day/night probabilities (the higher of the two). Heat, frost and strong
   wind have no published probability, so they are ESTIMATED from the forecast and
   its upper/lower bounds, and the graphic says so.

   Tiers: LOW under 20 %, MODERATE 20–49 %, HIGH 50 % or more.
   ═════════════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, CloudLightning, CloudRain, Snowflake, CloudHail, Thermometer, Wind, Sun } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { FONT, roundRect, glassCard, pill, fitFont, loadImage, backdrop, brandFooter, downloadCanvas } from '@/lib/canvasGraphic';

const W = 1080, H = 1920;
const TIERS = [
  { id: 'low', label: 'LOW', min: 0, color: '#22c55e', dark: '#14532d', word: 'unlikely' },
  { id: 'mod', label: 'MODERATE', min: 20, color: '#f59e0b', dark: '#78350f', word: 'possible' },
  { id: 'high', label: 'HIGH', min: 50, color: '#ef4444', dark: '#7f1d1d', word: 'likely' },
];
const tierOf = (p) => (p >= 50 ? TIERS[2] : p >= 20 ? TIERS[1] : TIERS[0]);

const est = (hit, near, edge) => (hit ? 90 : near ? 60 : edge ? 25 : 3);
const HAZARDS = {
  thunder: { label: 'Thunderstorms', icon: CloudLightning, accent: '#facc15', p: (d) => d.p.thunder },
  heavyRain: { label: 'Heavy rain', icon: CloudRain, accent: '#38bdf8', p: (d) => d.p.heavyRain },
  snow: { label: 'Snow', icon: Snowflake, accent: '#bae6fd', p: (d) => d.p.snow },
  heavySnow: { label: 'Heavy snow', icon: Snowflake, accent: '#a5b4fc', p: (d) => d.p.heavySnow },
  hail: { label: 'Hail', icon: CloudHail, accent: '#67e8f9', p: (d) => d.p.hail },
  heat: { label: 'Heat', icon: Sun, accent: '#fb923c', derived: true,
    p: (d, o) => est(d.tmaxLo >= o.heat, d.tmax >= o.heat, d.tmaxHi >= o.heat), note: (o) => `${o.heat} °C or more` },
  frost: { label: 'Frost', icon: Thermometer, accent: '#93c5fd', derived: true,
    p: (d) => est(d.tminHi <= 0, d.tmin <= 0, d.tminLo <= 0), note: () => 'air temperature 0 °C or lower' },
  wind: { label: 'Strong winds', icon: Wind, accent: '#a78bfa', derived: true,
    p: (d, o) => { const g = d.gust / 0.44704; return g >= o.wind ? 70 : g >= o.wind * 0.85 ? 35 : g >= o.wind * 0.7 ? 12 : 3; },
    note: (o) => `gusts of ${o.wind} mph or more` },
};
const dayName = (iso, o) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' '); let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = w; } else line = t;
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

/** The three-lamp traffic light, lit on `tier`. */
function drawLight(ctx, x, y, tier) {
  const w = 150, h = 360;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 30;
  const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#3f3f46'); g.addColorStop(1, '#18181b');
  roundRect(ctx, x, y, w, h, 34); ctx.fillStyle = g; ctx.fill(); ctx.restore();
  roundRect(ctx, x, y, w, h, 34); ctx.strokeStyle = '#52525b'; ctx.lineWidth = 3; ctx.stroke();
  [TIERS[2], TIERS[1], TIERS[0]].forEach((t, i) => {
    const cx = x + w / 2, cy = y + 66 + i * 114, on = t.id === tier.id;
    ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fillStyle = '#0a0a0c'; ctx.fill();
    if (on) {
      ctx.save(); ctx.shadowColor = t.color; ctx.shadowBlur = 60;
      const r = ctx.createRadialGradient(cx - 12, cy - 14, 4, cx, cy, 42); r.addColorStop(0, '#ffffff'); r.addColorStop(0.3, t.color); r.addColorStop(1, t.dark);
      ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.fillStyle = r; ctx.fill(); ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.fillStyle = `${t.dark}88`; ctx.fill();
    }
  });
}

export default function TrafficLightGraphicTool({ siteLogoUrl = '' }) {
  const canvasRef = useRef(null);
  const [logoUrl, setLogoUrl] = useState(siteLogoUrl || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hazard, setHazard] = useState('thunder');
  const [opts, setOpts] = useState({ heat: 27, wind: 50 });
  const [handle, setHandle] = useState('@MyWeatherUK');
  const [version, setVersion] = useState('V5.00');
  const hz = HAZARDS[hazard];

  useEffect(() => {
    if (siteLogoUrl) return;
    base44.entities.SiteSettings.list().then((l) => { if (l[0]?.logo_url) setLogoUrl(l[0].logo_url); }).catch(() => {});
  }, [siteLogoUrl]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/pastfuture/likelihood');
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setError(`Could not load the Met Office forecast: ${e.message}`); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const table = useMemo(() => {
    if (!data) return null;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const days = [...new Set(data.places.flatMap((p) => p.days.map((d) => d.date)))].filter((d) => d >= today).sort().slice(0, 7);
    const rows = data.places.map((pl) => ({
      name: pl.name,
      vals: days.map((date) => { const d = pl.days.find((x) => x.date === date); return d ? Math.round(hz.p(d, opts)) : null; }),
    }));
    const dayMax = days.map((_, i) => Math.max(0, ...rows.map((r) => r.vals[i] ?? 0)));
    const peak = Math.max(0, ...dayMax), peakDay = dayMax.indexOf(peak);
    const peakPlaces = rows.filter((r) => (r.vals[peakDay] ?? 0) >= Math.max(20, peak - 10)).sort((a, b) => b.vals[peakDay] - a.vals[peakDay]).map((r) => r.name);
    return { days, rows, dayMax, peak, peakDay, peakPlaces, run: data.places[0]?.modelRunDate };
  }, [data, hz, opts]);

  const draw = useCallback(async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const logo = await loadImage(logoUrl);
    backdrop(ctx, W, H, `${hz.accent}40`);
    if (!table) {
      ctx.fillStyle = '#cbd5e1'; ctx.font = `700 36px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(loading ? 'Loading the Met Office forecast…' : 'No forecast loaded', W / 2, H / 2); ctx.textAlign = 'left';
      return;
    }
    const tier = tierOf(table.peak);

    // ── Header ──
    glassCard(ctx, 36, 36, W - 72, 250, 30);
    ctx.textBaseline = 'alphabetic';
    ctx.font = `900 22px ${FONT}`; ctx.fillStyle = hz.accent; ctx.fillText('LIKELIHOOD  ·  NEXT 7 DAYS', 72, 92);
    fitFont(ctx, hz.label.toUpperCase(), 900, 84, W - 144); ctx.fillStyle = '#fff';
    ctx.save(); ctx.shadowColor = `${hz.accent}66`; ctx.shadowBlur = 28; ctx.fillText(hz.label.toUpperCase(), 72, 180); ctx.restore();
    ctx.font = `600 23px ${FONT}`; ctx.fillStyle = 'rgba(203,213,225,0.92)';
    ctx.fillText(hz.derived ? `Chance of ${hz.note(opts)}, from the Met Office forecast` : 'Met Office forecast probabilities for 14 UK places', 72, 234);

    // ── Verdict ──
    glassCard(ctx, 36, 312, W - 72, 430, 30);
    drawLight(ctx, 76, 347, tier);
    const tx = 270;
    ctx.font = `900 22px ${FONT}`; ctx.fillStyle = 'rgba(148,163,184,0.95)'; ctx.fillText('OVERALL RISK', tx, 380);
    ctx.save(); ctx.shadowColor = tier.color; ctx.shadowBlur = 34;
    ctx.font = `900 104px ${FONT}`; ctx.fillStyle = tier.color; ctx.fillText(tier.label, tx, 480); ctx.restore();
    const when = table.peak >= 20 ? dayName(table.days[table.peakDay], { weekday: 'long', day: 'numeric', month: 'short' }) : null;
    const where = table.peakPlaces.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const sentence = table.peak >= 20
      ? `${hz.label} ${tier.word}, most so on ${when}${where ? `, especially around ${where}` : ''}.`
      : `${hz.label} unlikely anywhere in the next seven days.`;
    ctx.font = `700 30px ${FONT}`; ctx.fillStyle = '#f1f5f9';
    wrapText(ctx, sentence, tx, 540, W - 72 - tx - 40, 42);
    pill(ctx, tx, 662, `PEAK ${table.peak}%${table.peak >= 20 ? `  ·  ${dayName(table.days[table.peakDay], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}` : ''}`,
      { bg: `${tier.color}`, fg: tier.id === 'mod' ? '#1c1917' : '#fff', size: 22, h: 50 });

    // ── Day strip ──
    glassCard(ctx, 36, 768, W - 72, 200, 26);
    const n = table.days.length, cw = (W - 72 - 40) / n;
    table.days.forEach((d, i) => {
      const cx = 56 + cw * i + cw / 2, t = tierOf(table.dayMax[i]);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `900 22px ${FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(dayName(d, { weekday: 'short' }).toUpperCase(), cx, 812);
      ctx.font = `600 17px ${FONT}`; ctx.fillStyle = 'rgba(148,163,184,0.95)'; ctx.fillText(dayName(d, { day: 'numeric', month: 'short' }), cx, 838);
      ctx.save(); ctx.shadowColor = t.color; ctx.shadowBlur = i === table.peakDay && table.peak >= 20 ? 26 : 0;
      ctx.beginPath(); ctx.arc(cx, 896, 40, 0, Math.PI * 2); ctx.fillStyle = t.color; ctx.fill(); ctx.restore();
      ctx.font = `900 24px ${FONT}`; ctx.fillStyle = t.id === 'mod' ? '#1c1917' : '#fff'; ctx.fillText(`${table.dayMax[i]}%`, cx, 905);
    });
    ctx.textAlign = 'left';

    // ── Place × day grid ──
    const GY = 994, rows = table.rows, rh = 47, gh = 72 + rows.length * rh;
    glassCard(ctx, 36, GY, W - 72, gh, 26);
    const nameW = 230, gx = 56 + nameW, gw = (W - 112 - nameW) / n;
    ctx.font = `900 17px ${FONT}`; ctx.fillStyle = '#7dd3fc'; ctx.fillText('BY PLACE', 62, GY + 44);
    table.days.forEach((d, i) => { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(203,213,225,0.9)'; ctx.font = `800 17px ${FONT}`; ctx.fillText(dayName(d, { weekday: 'short' }), gx + gw * i + gw / 2, GY + 44); });
    ctx.textAlign = 'left';
    rows.forEach((r, j) => {
      const y = GY + 64 + j * rh;
      ctx.font = `800 22px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(r.name, 62, y + rh / 2);
      r.vals.forEach((v, i) => {
        const x = gx + gw * i + 4, t = tierOf(v ?? 0);
        roundRect(ctx, x, y + 5, gw - 8, rh - 10, 10);
        ctx.fillStyle = v == null ? 'rgba(51,65,85,0.5)' : t.id === 'low' ? `rgba(34,197,94,${0.14 + (v / 20) * 0.2})` : t.color; ctx.fill();
        ctx.textAlign = 'center'; ctx.font = `800 19px ${FONT}`;
        ctx.fillStyle = v == null ? '#64748b' : t.id === 'mod' ? '#1c1917' : '#fff';
        ctx.fillText(v == null ? '–' : `${v}%`, x + (gw - 8) / 2, y + rh / 2 + 1); ctx.textAlign = 'left';
      });
      ctx.textBaseline = 'alphabetic';
    });

    // ── Legend ──
    const LY = GY + gh + 22;
    let lx = 62;
    TIERS.forEach((t) => {
      ctx.beginPath(); ctx.arc(lx + 12, LY + 18, 12, 0, Math.PI * 2); ctx.fillStyle = t.color; ctx.fill();
      ctx.font = `800 20px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      const txt = `${t.label[0]}${t.label.slice(1).toLowerCase()} ${t.id === 'low' ? 'under 20%' : t.id === 'mod' ? '20–49%' : '50%+'}`;
      ctx.fillText(txt, lx + 32, LY + 19); lx += ctx.measureText(txt).width + 70;
    });
    ctx.textBaseline = 'alphabetic';

    // ── Footer ──
    brandFooter(ctx, H, { logo, handle, version });
    ctx.textAlign = 'right'; ctx.font = `600 16px ${FONT}`; ctx.fillStyle = 'rgba(203,213,225,0.85)';
    ctx.fillText('Met Office DataHub site-specific forecast', W - 60, H - 96);
    ctx.fillText(hz.derived ? 'Estimated from the forecast and its upper/lower range' : 'Higher of the day and night probability', W - 60, H - 72);
    if (table.run) ctx.fillText(`Model run ${new Date(table.run).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`, W - 60, H - 48);
    ctx.textAlign = 'left';
  }, [table, hz, opts, logoUrl, handle, version, loading]);

  useEffect(() => { draw(); }, [draw]);

  const label = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 8px' };
  const input = { padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.7)', color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit' };
  const chip = (on, col = '#38bdf8') => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, fontSize: 12, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: 'inherit',
    background: on ? `${col}2e` : 'rgba(148,163,184,0.06)', border: `1px solid ${on ? `${col}80` : 'rgba(148,163,184,0.15)'}`, color: on ? col : '#94a3b8',
  });

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 18, padding: 20, borderRadius: 16, background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(148,163,184,0.12)' }}>
        <div>
          <p style={label}>Hazard</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(HAZARDS).map(([id, h]) => {
              const I = h.icon;
              return <button key={id} type="button" style={chip(hazard === id, h.accent)} onClick={() => setHazard(id)}><I style={{ width: 13, height: 13 }} />{h.label}</button>;
            })}
          </div>
        </div>
        {hazard === 'heat' && (
          <div><p style={label}>Heat threshold (°C)</p>
            <input type="number" value={opts.heat} onChange={(e) => setOpts((o) => ({ ...o, heat: +e.target.value || 27 }))} style={{ ...input, width: 90 }} /></div>
        )}
        {hazard === 'wind' && (
          <div><p style={label}>Gust threshold (mph)</p>
            <input type="number" value={opts.wind} onChange={(e) => setOpts((o) => ({ ...o, wind: +e.target.value || 50 }))} style={{ ...input, width: 90 }} /></div>
        )}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><p style={label}>Handle</p><input value={handle} onChange={(e) => setHandle(e.target.value)} style={input} /></div>
          <div><p style={label}>Version</p><input value={version} onChange={(e) => setVersion(e.target.value)} style={{ ...input, width: 90 }} /></div>
          <button type="button" onClick={load} disabled={loading} style={chip(false)}>
            {loading ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <RefreshCw style={{ width: 13, height: 13 }} />} Refresh
          </button>
        </div>
        {error && <p style={{ margin: 0, color: '#fca5a5', fontSize: 12.5 }}>{error}</p>}
        {data?.errors?.length > 0 && <p style={{ margin: 0, color: '#fcd34d', fontSize: 12 }}>Some places did not load: {data.errors.join('; ')}</p>}
        <button type="button" disabled={!table}
          onClick={() => downloadCanvas(canvasRef.current, `likelihood-${hazard}-${table?.days?.[0] || 'week'}.jpg`)}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px', borderRadius: 10, background: '#0284c7', color: '#fff', border: 'none', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Download style={{ width: 16, height: 16 }} /> Download JPG (1080×1920)
        </button>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
          Met Office DataHub daily forecast for 14 places, cached for 3 hours to protect the daily allowance.
          Thunder, rain, snow and hail use the Met Office's own probabilities. Heat, frost and wind are estimated from the forecast and its range.
        </p>
      </div>
      <canvas ref={canvasRef} width={W} height={H} style={{ width: 405, height: 720, borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.45)', flex: '0 0 auto' }} />
    </div>
  );
}
