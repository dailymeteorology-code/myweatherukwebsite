/* A road's forecast (16 Nov 2026, at the user's request: "route forecast along roads (M6, A9)").

   Any UK or Irish road by its number (M6, A9, A1(M), N7...), from OpenStreetMap (server/modelExtras.js,
   /api/modeldata/road): it is drawn on the map, and the layer on show is read along it for every step
   of the run loaded so far, as a picture of the road (across) against time (down), in the map's own
   colours. Choose when you set off, how fast and which way, and your drive is drawn through it as a
   line, with what you would meet on the way said in words. Every value is the model's own. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { colourAt } from '@/lib/modelViewer';

const fmtT = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const SPEEDS = [[70, '70 mph'], [60, '60 mph'], [50, '50 mph'], [40, '40 mph'], [30, '30 mph']];
const fmtV = (v, unit) => (v == null || !Number.isFinite(v) ? '—' : `${Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${unit ? ` ${unit}` : ''}`);

export default function RouteForecast({ t, phone, road, busy, err, onRoad, label, unit, scale, rows, times, places, validMs, rainy, onClose }) {
  const [ref, setRef] = useState(road?.ref || '');
  const [dep, setDep] = useState(null);                       // when you set off (ms)
  const [mph, setMph] = useState(60);
  const [back, setBack] = useState(false);                    // from the far end
  const canvas = useRef(null);
  const ok = !!road && rows?.length > 1;
  const nKm = road?.km || 0;
  const nPts = rows?.[0]?.length || 0;
  useEffect(() => { if (times?.length && dep == null) setDep(times.reduce((b, x) => (Math.abs(x - (validMs ?? Date.now())) < Math.abs(b - (validMs ?? Date.now())) ? x : b), times[0])); }, [times, dep, validMs]);
  useEffect(() => { setRef(road?.ref || ''); }, [road?.ref]);
  /* the picture: one column a point along the road, one row a step */
  useEffect(() => {
    const c = canvas.current;
    if (!c || !ok) return;
    c.width = nPts;
    c.height = rows.length;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(nPts, rows.length);
    rows.forEach((row, j) => row.forEach((v, i) => {
      const col = v == null ? null : colourAt(scale, v);
      const o = (j * nPts + i) * 4;
      if (!col) { img.data[o + 3] = 0; return; }
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = Math.max(col[3] ?? 210, rainy ? 0 : 160);
    }));
    ctx.putImageData(img, 0, 0);
  }, [ok, rows, nPts, scale, rainy]);
  /* your drive through it: where you are at each time */
  const drive = useMemo(() => {
    if (!ok || dep == null) return null;
    const kmh = mph * 1.609344, hours = nKm / kmh;
    const out = [];
    for (let k = 0; k <= nKm; k += Math.max(1, Math.round(nKm / 120))) {
      const ms = dep + (k / kmh) * 3600e3;
      if (ms > times[times.length - 1] + 1.5 * 3600e3) break;
      const at = back ? nKm - k : k;
      const i = Math.min(nPts - 1, Math.round((at / Math.max(1, nKm)) * (nPts - 1)));
      let j = 0;
      times.forEach((x, jj) => { if (Math.abs(x - ms) < Math.abs(times[j] - ms)) j = jj; });
      out.push({ km: at, ms, v: rows[j][i], i, j });
    }
    return { pts: out, hours, arrive: dep + hours * 3600e3 };
  }, [ok, dep, mph, back, nKm, nPts, times, rows]);
  const placeAt = (km) => places?.reduce((b, p) => (!b || Math.abs(p.km - km) < Math.abs(b.km - km) ? p : b), null)?.name;
  /* what you would meet, in words */
  const words = useMemo(() => {
    if (!drive?.pts?.length) return [];
    const vals = drive.pts.filter((p) => p.v != null);
    if (!vals.length) return ['Nothing loaded for those hours yet.'];
    const out = [];
    if (rainy) {
      const wet = vals.filter((p) => p.v >= 0.5);
      if (!wet.length) out.push('Dry all the way (no rain or snow heavier than 0.5 mm an hour on the road).');
      else {
        const a = wet[0], b = wet[wet.length - 1], top = wet.reduce((m, p) => (p.v > m.v ? p : m));
        out.push(`Wet from about ${hhmm(a.ms)} near ${placeAt(a.km) || `${Math.round(a.km)} km`} to about ${hhmm(b.ms)} near ${placeAt(b.km) || `${Math.round(b.km)} km`}.`);
        out.push(`Heaviest about ${hhmm(top.ms)} near ${placeAt(top.km) || `${Math.round(top.km)} km`}: ${fmtV(top.v, unit)}.`);
      }
    } else {
      const hi = vals.reduce((m, p) => (p.v > m.v ? p : m)), lo = vals.reduce((m, p) => (p.v < m.v ? p : m));
      out.push(`Highest ${fmtV(hi.v, unit)} about ${hhmm(hi.ms)} near ${placeAt(hi.km) || `${Math.round(hi.km)} km`}; lowest ${fmtV(lo.v, unit)} about ${hhmm(lo.ms)} near ${placeAt(lo.km) || `${Math.round(lo.km)} km`}.`);
    }
    out.push(`${Math.round(nKm)} km at ${mph} mph: about ${Math.floor(drive.hours)} h ${Math.round((drive.hours % 1) * 60)} min, arriving about ${hhmm(drive.arrive)} (without stops or traffic).`);
    return out;
  }, [drive, rainy, unit, nKm, mph, places]);         // eslint-disable-line react-hooks/exhaustive-deps

  const W = phone ? 340 : 640, H = phone ? 300 : 280, L = 60, R = 8, TOP = 22, B = 8;
  const XP = (i) => L + (i / Math.max(1, nPts - 1)) * (W - L - R);
  const Y = (j) => TOP + (j / Math.max(1, rows?.length - 1 || 1)) * (H - TOP - B);
  const startName = places?.[0]?.name, endName = places?.[places.length - 1]?.name;
  return (
    <div style={{ ...t.glass, borderRadius: 22, padding: phone ? 12 : '14px 16px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ flex: 1, margin: 0, fontSize: phone ? 16 : 17.5, fontWeight: 800, color: t.ink }}>{road ? `${road.ref}: ${label}` : 'A road’s forecast'}</h2>
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" style={{ border: 'none', cursor: 'pointer', width: 30, height: 30, borderRadius: 999, display: 'grid', placeItems: 'center', background: t.track, color: t.ink3 }}><X size={15} /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (ref.trim()) onRoad(ref.trim().toUpperCase()); }} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Road number: M6, A9, A1(M)…" aria-label="Road number"
          style={{ flex: 1, minWidth: 140, border: 'none', outline: 'none', borderRadius: 999, padding: '9px 14px', background: t.track, boxShadow: t.trackShadow, color: t.ink, fontSize: phone ? 16 : 13, fontWeight: 650 }} />
        <button type="submit" className="md-act" style={{ height: 36 }}>Show</button>
        {!road && ['M6', 'M4', 'A9', 'M25', 'A1(M)'].map((r) => (
          <button key={r} type="button" onClick={() => { setRef(r); onRoad(r); }} style={{ border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: t.track, color: t.ink }}>{r}</button>
        ))}
      </form>
      {busy && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: t.ink2 }}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />Fetching the road from OpenStreetMap (the first time can take a minute or two)…</div>}
      {err && <div style={{ fontSize: 12.5, color: t.light ? '#b91c1c' : '#fca5a5' }}>{err}</div>}
      {road && !ok && !busy && <div style={{ fontSize: 12.5, color: t.ink2 }}>Waiting for the layer to load along the road…</div>}
      {ok && (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: t.ink2 }}>
            <span>Set off</span>
            <select value={dep ?? ''} onChange={(e) => setDep(Number(e.target.value))} aria-label="When you set off" style={{ border: 'none', borderRadius: 999, padding: '6px 10px', background: t.track, color: t.ink, fontWeight: 650 }}>
              {times.map((x) => <option key={x} value={x} style={{ color: '#111' }}>{fmtT(x)}</option>)}
            </select>
            <select value={mph} onChange={(e) => setMph(Number(e.target.value))} aria-label="How fast" style={{ border: 'none', borderRadius: 999, padding: '6px 10px', background: t.track, color: t.ink, fontWeight: 650 }}>
              {SPEEDS.map(([v, l]) => <option key={v} value={v} style={{ color: '#111' }}>{l}</option>)}
            </select>
            <button type="button" onClick={() => setBack((b) => !b)} style={{ border: 'none', cursor: 'pointer', padding: '6px 11px', borderRadius: 999, fontWeight: 700, background: t.track, color: t.ink }}>
              From {back ? endName || 'the far end' : startName || 'the start'}
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <canvas ref={canvas} style={{ position: 'absolute', left: `${(L / W) * 100}%`, top: `${(TOP / H) * 100}%`, width: `${((W - L - R) / W) * 100}%`, height: `${((H - TOP - B) / H) * 100}%`, imageRendering: 'auto', borderRadius: 6 }} />
            <svg viewBox={`0 0 ${W} ${H}`} style={{ position: 'relative', width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`${label} along the ${road.ref} through the run`}>
              <rect x={L} y={TOP} width={W - L - R} height={H - TOP - B} fill="none" stroke={t.line} />
              {places.map((p) => (
                <g key={p.name + p.km}>
                  <line x1={XP((p.km / nKm) * (nPts - 1))} x2={XP((p.km / nKm) * (nPts - 1))} y1={TOP - 4} y2={TOP} stroke={t.ink2} />
                  <text x={XP((p.km / nKm) * (nPts - 1))} y={TOP - 7} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={t.ink2}>{p.name}</text>
                </g>
              ))}
              {times.map((x, j) => (j % Math.max(1, Math.round(times.length / 8)) === 0 ? <text key={x} x={L - 4} y={Y(j) + 3.5} textAnchor="end" fontSize="9.5" fill={t.ink2}>{fmtT(x).replace(',', '')}</text> : null))}
              {drive && <path d={drive.pts.map((p, k) => `${k ? 'L' : 'M'}${XP(p.i).toFixed(1)},${(TOP + ((p.ms - times[0]) / Math.max(1, times[times.length - 1] - times[0])) * (H - TOP - B)).toFixed(1)}`).join('')}
                fill="none" stroke={t.light ? '#0f172a' : '#ffffff'} strokeWidth={2.4} strokeDasharray="6 4" />}
            </svg>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.ink3, display: 'grid', gap: 2 }}>{words.map((w, i) => <span key={i}>{w}</span>)}</div>
          <div style={{ fontSize: 11, color: t.ink2 }}>Across: the {road.ref} from {startName || 'its south or west end'} to {endName || 'its far end'} ({Math.round(nKm)} km). Down: time. The dashed line is your drive. Road: {road.source}.</div>
        </>
      )}
    </div>
  );
}
