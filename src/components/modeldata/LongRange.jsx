/* Long range (15 Nov 2026, at the user's request: "long range models like for the MJO and for the
   Stratospheric Vortex"). Two charts drawn from data the server makes every 6 hours
   (tools/modeldata/mdata/longrange.py, /api/modeldata/longrange):

   - The polar vortex: the westerly wind round the Arctic at 60°N and 10 hPa (about 30 km up), the
     usual measure of its strength. GFS's analyses for the past 60 days, the newest GFS run to 16 days,
     every one of the 30 GEFS members to 35 days with their mean, and the 1991-2020 normal. Below
     nought the wind has turned easterly: the vortex has broken down (a major sudden warming).
   - The MJO: the Bureau of Meteorology's RMM index over the past 40 days, as the usual phase diagram.
     The forecasting centres publish their MJO forecasts only as pictures, so none is drawn.

   Every value is the models' own; nothing here is smoothed or invented. */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Map as MapIcon } from 'lucide-react';

const DAY = 86400e3;
const GEFS_C = '#2F7FE0', GFS_C = '#E8862A', REV_C = '#DC2626';
const dms = (d) => Date.parse(d.length <= 10 ? `${d}T00:00:00Z` : d.replace(/Z$/, ':00Z').replace(/:00:00Z$/, ':00Z'));
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const doy = (ms) => Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / DAY);

function useLongRange() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let on = true, timer = null;
    const load = async () => {
      try {
        const r = await fetch('/api/modeldata/longrange', { cache: 'no-store' });
        if (r.status === 503) { setErr('The long-range charts are being made: back in a few minutes.'); timer = setTimeout(load, 30000); return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (on) { setData(j); setErr(null); }
      } catch (e) { if (on) setErr(`The long-range data could not be loaded (${e.message}).`); }
    };
    load();
    return () => { on = false; clearTimeout(timer); };
  }, []);
  return [data, err];
}

/* ── the polar vortex ── */
const PICK_C = '#9333EA';                                  // the line picked out: purple, apart from every other line
const fmtWhen = (ms) => {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  return d.getUTCHours() ? `${day} ${String(d.getUTCHours()).padStart(2, '0')}Z` : day;
};
/* a line's value at a time, between its points (only to find which line is nearest the pointer) */
function valueAt(pts, ms) {
  if (!pts.length || ms < pts[0][0] || ms > pts[pts.length - 1][0]) return null;
  let i = 1;
  while (i < pts.length && pts[i][0] < ms) i++;
  if (i >= pts.length) return pts[pts.length - 1][1];
  const [a, ua] = pts[i - 1], [b, ub] = pts[i];
  return b === a ? ua : ua + ((ub - ua) * (ms - a)) / (b - a);
}
/* the line's own point nearest a time: what the label shows, so its numbers are always the model's */
function pointNear(pts, ms) {
  let best = null;
  for (const p of pts) if (!best || Math.abs(p[0] - ms) < Math.abs(best[0] - ms)) best = p;
  return best;
}

/* Point at a line (or press on it, on a phone or tablet: 15 Nov 2026, at the user's request) to pick
   it out: that member's whole path in purple, the others faded, and a label with what it says that day,
   its lowest and highest, whether it reverses the winds, and the other lines on the same day. */
function VortexChart({ v, t, phone, touch }) {
  const W = phone ? 480 : 760, H = phone ? 330 : 340, L = 44, R = 14, TOP = 16, B = 30;   // narrower on phones: its words larger
  const now = useMemo(() => Date.now(), [v]);
  const gefs = v?.gefs, gfs = v?.gfs;
  const series = useMemo(() => {
    const an = (v?.analysis || []).map(([d, u]) => [dms(d), u]);
    const gf = (gfs?.points || []).map(([d, u]) => [dms(d), u]);
    const days = (gefs?.days || []).map(dms);
    const members = (gefs?.members || []).map((m) => m.map((u, i) => [days[i], u]).filter(([, u]) => u != null));
    const mean = (gefs?.mean || []).map((u, i) => [days[i], u]).filter(([, u]) => u != null);
    return { an, gf, days, members, mean };
  }, [v, gefs, gfs]);
  const x0 = now - 60 * DAY;
  const x1 = Math.max(now + 16 * DAY, ...series.days, ...series.gf.map(([x]) => x));
  const normal = useMemo(() => {
    const n = v?.normal, out = [];
    if (!n?.length) return out;
    for (let ms = Date.UTC(new Date(x0).getUTCFullYear(), new Date(x0).getUTCMonth(), new Date(x0).getUTCDate()); ms <= x1; ms += DAY) {
      if (ms >= x0) out.push([ms, n[Math.min(n.length - 1, doy(ms))]]);
    }
    return out;
  }, [v, x0, x1]);
  const all = [...series.an, ...series.gf, ...series.mean, ...normal, ...series.members.flat()].map(([, u]) => u).filter((u) => u != null);
  const yMin = Math.min(-10, Math.floor(Math.min(...all, 0) / 10) * 10);
  const yMax = Math.max(40, Math.ceil(Math.max(...all, 0) / 10) * 10);
  const X = (ms) => L + ((ms - x0) / (x1 - x0)) * (W - L - R);
  const Y = (u) => TOP + ((yMax - u) / (yMax - yMin)) * (H - TOP - B);
  const path = (pts) => pts.filter(([x]) => x >= x0 && x <= x1).map(([x, u], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(u).toFixed(1)}`).join('');
  const months = [];
  for (let d = new Date(x0); d.getTime() <= x1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    if (ms >= x0) months.push(ms);
  }
  const ticks = [];
  for (let u = yMin; u <= yMax; u += 10) ticks.push(u);

  /* every line that can be picked out, members first */
  const lines = useMemo(() => [
    ...series.members.map((pts, i) => ({ key: `m${i}`, kind: 'member', n: i + 1, pts, colour: PICK_C })),
    { key: 'mean', kind: 'mean', pts: series.mean, colour: GEFS_C },
    { key: 'gfs', kind: 'gfs', pts: series.gf, colour: GFS_C },
    { key: 'an', kind: 'an', pts: series.an, colour: t.ink },
    { key: 'normal', kind: 'normal', pts: normal, colour: t.ink2 },
  ], [series, normal, t]);
  const [pick, setPick] = useState(null);                   // { key, ms, u }: the line picked out and its own point
  const locate = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W, sy = ((e.clientY - r.top) / r.height) * H;
    if (sx < L - 6 || sx > W - R + 6 || sy < TOP - 10 || sy > H - B + 10) return null;
    const ms = x0 + ((Math.min(Math.max(sx, L), W - R) - L) / (W - L - R)) * (x1 - x0);
    let best = null;
    for (const ln of lines) {
      const u = valueAt(ln.pts, ms);
      if (u == null) continue;
      const d = Math.abs(Y(u) - sy);
      if (!best || d < best.d) best = { ln, d };
    }
    if (!best || best.d > (touch ? 44 : 26)) return null;   // a finger is wider than a pointer
    const p = pointNear(best.ln.pts, ms);
    return p ? { key: best.ln.key, ms: p[0], u: p[1] } : null;
  };
  const picked = pick ? lines.find((l) => l.key === pick.key) : null;
  const label = useMemo(() => {
    if (!picked) return null;
    const runOf = (iso) => (iso ? ` ${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 13)}Z` : '');
    const name = picked.kind === 'member' ? `GEFS member ${picked.n} of ${series.members.length}`
      : picked.kind === 'mean' ? 'GEFS mean (the average of the members)'
        : picked.kind === 'gfs' ? `GFS${runOf(gfs?.run)}`
          : picked.kind === 'an' ? 'Observed (GFS analysis)' : 'Normal (the 1991–2020 average)';
    const rows = [`${fmtWhen(pick.ms)}: ${pick.u.toFixed(1)} m/s`];
    if (picked.kind === 'member' || picked.kind === 'mean' || picked.kind === 'gfs') {
      const pts = picked.pts.filter(([x]) => x > now - DAY);
      if (pts.length) {
        const lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a)), hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
        rows.push(`Lowest ${lo[1].toFixed(1)} m/s (${fmtDay(lo[0])}), highest ${hi[1].toFixed(1)} (${fmtDay(hi[0])})`);
        const rev = pts.find(([, u]) => u < 0);
        rows.push(rev ? `Reverses the winds on ${fmtDay(rev[0])}: a major warming` : `Keeps the winds westerly to ${fmtDay(pts[pts.length - 1][0])}`);
      }
    }
    const same = [['mean', 'mean', series.mean], ['gfs', 'GFS', series.gf], ['an', 'observed', series.an], ['normal', 'normal', normal]]
      .filter(([k]) => k !== picked.key)
      .map(([, l, pts]) => { const p = pts.find(([x]) => Math.abs(x - pick.ms) < 3600e3) || (l === 'normal' ? pointNear(pts, pick.ms) : null); return p ? `${l} ${p[1].toFixed(1)}` : null; })
      .filter(Boolean);
    return { name, rows, same: same.length ? `Same day: ${same.join(' · ')}` : '' };
  }, [picked, pick, series, normal, gfs, now]);

  const fadeMembers = picked?.kind === 'member';
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y', cursor: 'crosshair', userSelect: 'none' }}
        role="img" aria-label="The westerly wind at 60 degrees north and 10 hPa: point at or press on a line to see what it says"
        onPointerDown={(e) => setPick(locate(e))}
        onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) setPick(locate(e)); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPick(null); }}>
        {ticks.map((u) => (
          <g key={u}>
            <line x1={L} x2={W - R} y1={Y(u)} y2={Y(u)} stroke={t.line} strokeWidth={u === 0 ? 0 : 1} />
            <text x={L - 6} y={Y(u) + 4} textAnchor="end" fontSize="11" fill={t.ink2}>{u}</text>
          </g>
        ))}
        {months.map((ms) => (
          <g key={ms}>
            <line x1={X(ms)} x2={X(ms)} y1={TOP} y2={H - B} stroke={t.line} strokeDasharray="2 4" />
            <text x={X(ms) + 4} y={H - B + 18} fontSize="11.5" fontWeight="650" fill={t.ink2}>{new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' })}</text>
          </g>
        ))}
        {/* below nought: the vortex has broken down */}
        <rect x={L} y={Y(0)} width={W - L - R} height={Math.max(0, Y(yMin) - Y(0))} fill={REV_C} opacity={0.06} />
        <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke={REV_C} strokeWidth={1.5} strokeDasharray="6 4" />
        {/* on the right on wide screens (the forecasts are above it there), on the left on phones (the past is above it there) */}
        <text x={phone ? L + 4 : W - R - 4} y={Y(0) + 14} textAnchor={phone ? 'start' : 'end'} fontSize="11" fontWeight="700" fill={REV_C}>Below 0: winds reversed (major warming)</text>
        <path d={path(normal)} fill="none" stroke={t.ink2} strokeWidth={1.6} strokeDasharray="5 4" />
        {series.members.map((m, i) => <path key={i} d={path(m)} fill="none" stroke={GEFS_C} strokeWidth={1} opacity={fadeMembers ? 0.14 : 0.28} />)}
        <path d={path(series.mean)} fill="none" stroke={GEFS_C} strokeWidth={3} opacity={fadeMembers ? 0.55 : 1} />
        <path d={path(series.gf)} fill="none" stroke={GFS_C} strokeWidth={2.2} opacity={fadeMembers ? 0.55 : 1} />
        <path d={path(series.an)} fill="none" stroke={t.ink} strokeWidth={2.6} />
        <line x1={X(now)} x2={X(now)} y1={TOP} y2={H - B} stroke={t.ink} strokeWidth={1} opacity={0.5} />
        <text x={X(now) + 4} y={TOP + 11} fontSize="11" fontWeight="700" fill={t.ink}>Today</text>
        <text x={L} y={TOP - 4} fontSize="11" fill={t.ink2}>m/s</text>
        {picked && (
          <g pointerEvents="none">
            <path d={path(picked.pts)} fill="none" stroke={picked.colour} strokeWidth={picked.kind === 'member' ? 2.8 : 4} strokeDasharray={picked.kind === 'normal' ? '5 4' : undefined} />
            <line x1={X(pick.ms)} x2={X(pick.ms)} y1={TOP} y2={H - B} stroke={picked.colour} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
            <circle cx={X(pick.ms)} cy={Y(pick.u)} r={5} fill={picked.colour} stroke={t.light ? '#fff' : '#0E1624'} strokeWidth={2} />
          </g>
        )}
      </svg>
      {picked && label && (() => {
        const px = X(pick.ms) / W, py = Y(pick.u) / H;
        return (
          <div role="status" aria-live="polite" style={{
            /* anchored by the side it opens towards, so it keeps its full width near either edge */
            position: 'absolute', ...(px > 0.55 ? { right: `calc(${(1 - px) * 100}% + 12px)` } : { left: `calc(${px * 100}% + 12px)` }), top: `${py * 100}%`,
            pointerEvents: 'none', zIndex: 2, width: 'max-content', maxWidth: phone ? 236 : 300,
            transform: `translateY(${py > 0.42 ? 'calc(-100% - 10px)' : '10px'})`,
            ...t.glass, borderRadius: 14, padding: '8px 11px', fontSize: 12, lineHeight: 1.45, color: t.ink3,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, color: t.ink, fontSize: 12.5 }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: picked.colour, flexShrink: 0 }} />{label.name}
            </div>
            {label.rows.map((r, i) => <div key={i} style={{ fontWeight: i ? 550 : 750, color: i ? t.ink3 : t.ink }}>{r}</div>)}
            {label.same && <div style={{ marginTop: 3, color: t.ink2, fontSize: 11.5 }}>{label.same}</div>}
          </div>
        );
      })()}
    </div>
  );
}

function vortexSummary(v) {
  const an = v?.analysis || [];
  const last = an[an.length - 1];
  const n = v?.normal;
  const lines = [];
  if (last) {
    const ms = dms(last[0]);
    const nu = n?.length ? n[Math.min(n.length - 1, doy(ms))] : null;
    const diff = nu != null ? last[1] - nu : null;
    lines.push(`On ${fmtDay(ms)}: ${last[1].toFixed(1)} m/s${diff != null ? `, ${Math.abs(diff).toFixed(0)} m/s ${diff < 0 ? 'below' : 'above'} the 1991–2020 normal of ${nu.toFixed(0)}` : ''}.`);
  }
  const g = v?.gefs;
  if (g?.below0?.length) {
    let best = 0, bestI = -1, firstI = -1;
    g.below0.forEach((f, i) => { if (f != null && f > best) { best = f; bestI = i; } if (firstI < 0 && f > 0) firstI = i; });
    const members = g.members?.length || 30;
    lines.push(best > 0
      ? `GEFS: ${Math.round(best * members)} of its ${members} members have the winds reversed on ${fmtDay(dms(g.days[bestI]))} (the first from ${fmtDay(dms(g.days[firstI]))}).`
      : `GEFS: none of its ${members} members reverses the winds in the next ${g.days.length} days.`);
  }
  return lines;
}

/* ── the MJO ── */
const PHASE_AT = [202.5, 247.5, 292.5, 337.5, 22.5, 67.5, 112.5, 157.5];   // the middle of each phase's octant, degrees from RMM1
function MjoChart({ days, t }) {
  const S = 360, C = S / 2;
  const tail = days.slice(-40);
  const maxAmp = Math.max(3, ...tail.map((d) => Math.ceil(d[4])));
  const k = (C - 18) / maxAmp;
  const P = (r1, r2) => [C + r1 * k, C - r2 * k];
  const pts = tail.map((d) => P(d[1], d[2]));
  const lab = (deg, r) => [C + Math.cos((deg * Math.PI) / 180) * r, C - Math.sin((deg * Math.PI) / 180) * r];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} style={{ width: '100%', maxWidth: 420, height: 'auto', display: 'block', margin: '0 auto' }} role="img" aria-label="The MJO phase diagram">
      <rect x={1} y={1} width={S - 2} height={S - 2} rx={10} fill="none" stroke={t.line} />
      <line x1={C} x2={C} y1={6} y2={S - 6} stroke={t.line} />
      <line x1={6} x2={S - 6} y1={C} y2={C} stroke={t.line} />
      <line x1={6} x2={S - 6} y1={6} y2={S - 6} stroke={t.line} strokeDasharray="3 4" />
      <line x1={6} x2={S - 6} y1={S - 6} y2={6} stroke={t.line} strokeDasharray="3 4" />
      <circle cx={C} cy={C} r={k} fill={t.track} stroke={t.ink2} strokeWidth={1} />
      <text x={C} y={C + 4} textAnchor="middle" fontSize="10.5" fill={t.ink2}>weak</text>
      {PHASE_AT.map((deg, i) => { const [x, y] = lab(deg, C - 30); return <text key={i} x={x} y={y + 5} textAnchor="middle" fontSize="15" fontWeight="800" fill={t.ink2}>{i + 1}</text>; })}
      <text x={C} y={S - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill={t.ink2}>Indian Ocean</text>
      <text x={C} y={18} textAnchor="middle" fontSize="11" fontWeight="700" fill={t.ink2}>Western Pacific</text>
      <text x={S - 12} y={C - 8} textAnchor="end" fontSize="11" fontWeight="700" fill={t.ink2}>Maritime</text>
      <text x={S - 12} y={C + 18} textAnchor="end" fontSize="11" fontWeight="700" fill={t.ink2}>Continent</text>
      <text x={12} y={C - 8} fontSize="11" fontWeight="700" fill={t.ink2}>West. Hem.</text>
      <text x={12} y={C + 18} fontSize="11" fontWeight="700" fill={t.ink2}>and Africa</text>
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={GEFS_C} strokeWidth={2} strokeLinejoin="round" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 6 : 2.6} fill={i === pts.length - 1 ? GEFS_C : t.light ? '#fff' : '#0E1624'} stroke={GEFS_C} strokeWidth={1.5} opacity={0.35 + (0.65 * i) / Math.max(1, pts.length - 1)} />)}
      {pts.length > 0 && <text x={pts[0][0] + 6} y={pts[0][1] - 6} fontSize="10.5" fill={t.ink2}>{fmtDay(dms(tail[0][0]))}</text>}
    </svg>
  );
}

const strength = (amp) => (amp < 1 ? 'weak' : amp < 2 ? 'active' : 'strong');

/* the "i" beside each title (15 Nov 2026, at the user's request: "for people who don't know what the
   MJO or a polar vortex is and how to read the graphic"): what it is, how to read the chart, and why
   it matters for the UK, in plain words, opened under the title */
function InfoButton({ t, open, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={label} title={label} style={{
      border: 'none', cursor: 'pointer', width: 26, height: 26, borderRadius: 999, display: 'inline-grid', placeItems: 'center', flexShrink: 0,
      fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700, fontSize: 15, lineHeight: 1,
      color: open ? t.onInk : t.accent, background: open ? t.on : t.track, boxShadow: open ? t.onShadow : `inset 0 0 0 1.5px ${t.accent}`,
    }}>i</button>
  );
}
function Explainer({ t, sections, onClose }) {
  return (
    <div role="region" aria-label="About this chart" style={{ background: t.track, boxShadow: t.trackShadow, borderRadius: 16, padding: '12px 14px 4px', margin: '2px 0 12px', position: 'relative' }}>
      <button type="button" onClick={onClose} aria-label="Close" title="Close" style={{ position: 'absolute', top: 8, right: 8, border: 'none', cursor: 'pointer', width: 24, height: 24,
        borderRadius: 999, background: t.idle, color: t.ink3, fontSize: 15, lineHeight: 1 }}>×</button>
      {sections.map(([head, items]) => (
        <div key={head} style={{ marginBottom: 10 }}>
          <h3 style={{ margin: '0 0 5px', fontSize: 13.5, fontWeight: 800, color: t.ink, paddingRight: 28 }}>{head}</h3>
          {items.map((it, i) => (Array.isArray(it) ? (
            <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', margin: '0 0 5px' }}>
              <span style={{ flexShrink: 0, marginTop: 4 }}>{it[0]}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: t.ink3 }}>{it[1]}</span>
            </div>
          ) : <p key={i} style={{ margin: '0 0 6px', fontSize: 12.5, lineHeight: 1.5, color: t.ink3 }}>{it}</p>))}
        </div>
      ))}
    </div>
  );
}
const swatch = (c, { dash, thin, band } = {}) => (
  <svg width="26" height="12" aria-hidden="true">
    {band ? <rect x="1" y="1" width="24" height="10" rx="2" fill={c} opacity="0.25" stroke={c} strokeDasharray="3 2" />
      : <line x1="1" x2="25" y1="6" y2="6" stroke={c} strokeWidth={thin ? 1.2 : 2.8} strokeDasharray={dash ? '4 3' : undefined} opacity={thin ? 0.6 : 1} />}
  </svg>
);
const dot = (c, big) => <svg width="26" height="12" aria-hidden="true"><circle cx="13" cy="6" r={big ? 5 : 3} fill={big ? c : 'none'} stroke={c} strokeWidth="1.5" /></svg>;

const VORTEX_INFO = (t, members) => [
  ['What is the polar vortex?', [
    'Every winter a ring of strong west-to-east winds forms 15 to 50 km above the Arctic, in the stratosphere, around a huge pool of very cold air over the pole. That is the stratospheric polar vortex. While it is strong it keeps the cold air locked up over the Arctic.',
    'Now and then it is knocked off the pole, stretched or split in two, and the air above the Arctic warms by tens of degrees in a few days: a sudden stratospheric warming. If the winds round the pole turn from westerly to easterly, it is a major warming.',
  ]],
  ['How to read the chart', [
    'Each line is the speed of the west-to-east wind all the way round the 60°N circle, about 30 km up (10 hPa), day by day. The higher the line, the stronger the vortex. Everything left of "Today" has happened; everything right of it is forecast.',
    [swatch(t.ink), 'What actually happened (the GFS model’s analyses).'],
    [swatch(GFS_C), 'The newest GFS forecast, 16 days ahead.'],
    [swatch(GEFS_C, { thin: true }), `Each of the ${members} GEFS ensemble members: the same model run ${members} times with slightly different starts, 35 days ahead. Where they fan out, the forecast is unsure; where they stay together, it is confident.`],
    [swatch(GEFS_C), 'The average of the members: the most likely path.'],
    [swatch(t.ink2, { dash: true }), 'The normal for each date (the 1991–2020 average). Below it the vortex is weaker than usual, above it stronger.'],
    [swatch(REV_C, { band: true }), 'Below 0 the winds have reversed: the vortex has broken down (a major sudden warming).'],
    [swatch(PICK_C), 'Point at any line, or press on it on a phone or tablet, to pick it out: one member’s whole path turns purple, with what it says that day, its lowest and highest, whether it reverses the winds, and the other lines on the same day.'],
  ]],
  ['Why it matters for the UK', [
    'After a major warming the weather lower down often turns blocked over the next two to six weeks: high pressure near Greenland or Scandinavia, winds from the north or east, and a better chance of cold and snow in the UK. It shifts the odds; it does not guarantee it, and not every warming reaches the ground. A strong vortex tends to mean the opposite: mild, wet and windy westerlies.',
  ]],
];
const MJO_INFO = (t) => [
  ['What is the MJO?', [
    'The Madden–Julian Oscillation is a vast area of thunderstorms and heavy rain over the tropics, with a dry, settled area beside it, that drifts east round the globe every 30 to 60 days. As it moves it bends the jet streams thousands of miles away, the North Atlantic’s included.',
  ]],
  ['How to read the diagram', [
    [dot(GEFS_C), 'Each dot is one day; the line joins the past 40 days to show where the MJO has travelled.'],
    [dot(GEFS_C, true), 'The big dot is the latest day.'],
    'The eight slices are its phases, 1 to 8, named for where the storms are: the Indian Ocean (phases 2–3), the Maritime Continent, around Indonesia (4–5), the Western Pacific (6–7), and the Western Hemisphere and Africa (8 and 1). It normally travels anticlockwise, 1 → 2 → … → 8 → 1.',
    'The further from the middle, the stronger it is. Inside the grey circle it is weak and has little effect; beyond 2 it is strong.',
  ]],
  ['Why it matters for the UK', [
    'In winter the MJO’s phase tends to nudge the North Atlantic’s pattern one to two weeks later. Phases 6 and 7 are often followed by more blocking near the UK and a better chance of cold spells; phases 3 and 4 by stronger westerlies, milder and wetter weather. These are tendencies that shift the odds, not rules.',
  ]],
];

export default function LongRange({ t, phone, style, onMap }) {
  const [data, err] = useLongRange();
  const [info, setInfo] = useState(null);                 // 'vortex' | 'mjo': the explanation open under that title
  const touch = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches, []);   // phones and tablets: press, not point
  const toggle = (k) => setInfo((o) => (o === k ? null : k));
  const v = data?.vortex;
  const mjo = data?.mjo?.days || [];
  const lastMjo = mjo[mjo.length - 1];
  const card = { ...t.glass, borderRadius: 22, padding: phone ? '14px 14px 12px' : '16px 18px 14px', minWidth: 0 };
  const h = { margin: 0, fontSize: phone ? 17 : 19, fontWeight: 800, letterSpacing: '-0.015em', color: t.ink };
  const sub = { margin: '3px 0 10px', fontSize: 12.5, lineHeight: 1.45, color: t.ink2 };
  const key = (c, label, dash, thin) => (
    <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.ink3, whiteSpace: 'nowrap' }}>
      <svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke={c} strokeWidth={thin ? 1.2 : 2.6} strokeDasharray={dash ? '4 3' : undefined} opacity={thin ? 0.6 : 1} /></svg>{label}
    </span>
  );
  return (
    <div className="md-noscroll" style={{ ...style, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start', borderRadius: 24, padding: phone ? 0 : 0,
      background: t.light ? 'rgba(226,235,245,0.94)' : 'rgba(6,11,20,0.94)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
      {!data && (
        <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: t.ink2 }}>
          {!err && <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />}{err || 'Loading the long-range charts…'}
        </div>
      )}
      {data && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: phone ? '1fr' : 'minmax(0, 1.75fr) minmax(300px, 1fr)', alignItems: 'start' }}>
          <section style={card}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={h}>The polar vortex</h2>
                  <InfoButton t={t} open={info === 'vortex'} onClick={() => toggle('vortex')} label="What is the polar vortex, and how to read this chart" />
                </div>
                <p style={sub}>The westerly wind all the way round the Arctic at 60°N, 10 hPa (about 30 km up): the usual measure of the vortex's strength. A weak or broken vortex often brings colder, blocked weather to the UK two to six weeks later.</p>
              </div>
              {onMap && (
                <button type="button" className="md-act" onClick={onMap} title="The 10 hPa winds on the map (GFS)" style={{ flexShrink: 0 }}>
                  <MapIcon size={15} />See it on the map
                </button>
              )}
            </div>
            {info === 'vortex' && <Explainer t={t} sections={VORTEX_INFO(t, v?.gefs?.members?.length || 30)} onClose={() => setInfo(null)} />}
            <VortexChart v={v} t={t} phone={phone} touch={touch} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', margin: '6px 0 8px' }}>
              {key(t.ink, 'Observed (GFS analyses)')}
              {key(GFS_C, 'GFS')}
              {key(GEFS_C, 'GEFS mean')}
              {key(GEFS_C, `GEFS members (${v?.gefs?.members?.length || 30})`, false, true)}
              {key(t.ink2, 'Normal (1991–2020)', true)}
            </div>
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 650, color: t.accent }}>{touch ? 'Press on any line to see what that member (or line) says.' : 'Point at any line to see what that member (or line) says.'}</p>
            {vortexSummary(v).map((s) => <p key={s} style={{ margin: '2px 0', fontSize: 13, fontWeight: 600, color: t.ink3 }}>{s}</p>)}
            <p style={{ ...sub, margin: '8px 0 0', fontSize: 11.5 }}>
              {v?.gfs?.run ? `GFS ${v.gfs.run.slice(8, 10)}/${v.gfs.run.slice(5, 7)} ${v.gfs.run.slice(11, 13)}Z` : ''}{v?.gefs?.run ? ` · GEFS ${v.gefs.run.slice(8, 10)}/${v.gefs.run.slice(5, 7)} 00Z` : ''} · NOAA via AWS · normal: NCEP/NCAR reanalysis, NOAA PSL
            </p>
          </section>
          <section style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={h}>The MJO</h2>
              <InfoButton t={t} open={info === 'mjo'} onClick={() => toggle('mjo')} label="What is the MJO, and how to read this diagram" />
            </div>
            <p style={sub}>The Madden–Julian Oscillation: a belt of tropical storms that circles the globe every 30 to 60 days. Its phase (where it is) and strength (how far from the middle) steer the weather far beyond the tropics, the UK's included, a week or more later.</p>
            {info === 'mjo' && <Explainer t={t} sections={MJO_INFO(t)} onClose={() => setInfo(null)} />}
            {lastMjo ? <MjoChart days={mjo} t={t} /> : <p style={sub}>No MJO data yet.</p>}
            {lastMjo && (
              <p style={{ margin: '8px 0 2px', fontSize: 13, fontWeight: 650, color: t.ink3 }}>
                {fmtDay(dms(lastMjo[0]))}: phase {lastMjo[3]}, amplitude {lastMjo[4].toFixed(1)} ({strength(lastMjo[4])}).
              </p>
            )}
            <p style={{ ...sub, margin: '6px 0 0', fontSize: 11.5 }}>
              The past 40 days, from the Bureau of Meteorology's real-time RMM index. Inside the circle the MJO is weak. The forecasting centres publish their MJO forecasts only as pictures, so no forecast is drawn here.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
