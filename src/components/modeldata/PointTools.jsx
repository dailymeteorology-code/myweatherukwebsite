/* The point and column tools of Model Data (16 Nov 2026, at the user's request: "every model at a
   pin", "Skew-T at a pin", "cross-section", "back-trajectories"), drawn from server/modelExtras.js:

   - Every model: the layer on show at the pin, from each model's newest run (as much of it as is made),
     one line a model, with MWUK (the middle of the models) in bold when it has the layer.
   - Sounding: NOAA GFS's temperature, dew point and wind up through the air above the pin, as a
     skew-T log-p diagram, with the rising air's path (a surface parcel), its hodograph and the
     usual indices, worked out here from the GFS levels, and a plain reading of what they mean.
   - Cross-section: the air along a line drawn on the map, from the ground to 100 hPa: cloud (how
     humid), the temperature (0 °C in bold), theta-e and the jet stream's strongest winds.
   - Where the air came from: GFS back-trajectories, drawn on the map, and said in words.
   Every value is the models' own (the parcel's numbers are worked out from them). */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { contours } from 'd3-contour';

const KT = 1.943844;
export const MODEL_COLOURS = {
  consensus: '#0f172a', ukv: '#0284c7', mo_global: '#38bdf8', mix: '#0891b2', ifs: '#dc2626', aifs: '#f97316', gfs: '#16a34a',
  aigfs: '#65a30d', gefs_mean: '#86efac', icon: '#9333ea', icon_europe: '#c084fc', gdps: '#ca8a04', arpege: '#db2777', arome: '#f472b6', meps: '#0d9488',
};
const HIDE = new Set(['icon_europe']);              // the same model on the other grid
const fmtT = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDayShort = (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric' });
const fmtNum = (v, unit) => (v == null || !Number.isFinite(v) ? '—' : `${Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${unit ? ` ${unit}` : ''}`);

/* ── the panel each tool opens in ─────────────────────────────────────────────────────────────── */
export function ToolCard({ t, phone, title, sub, onClose, children, info }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...t.glass, borderRadius: 22, padding: phone ? '12px 12px 12px' : '14px 16px 14px', display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: phone ? 16 : 17.5, fontWeight: 800, letterSpacing: '-0.01em', color: t.ink }}>{title}</h2>
            {info && (
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="What this is and how to read it" title="What this is and how to read it"
                style={{ border: 'none', cursor: 'pointer', width: 24, height: 24, borderRadius: 999, display: 'inline-grid', placeItems: 'center', flexShrink: 0,
                  fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700, fontSize: 14, lineHeight: 1,
                  color: open ? t.onInk : t.accent, background: open ? t.on : t.track, boxShadow: open ? t.onShadow : `inset 0 0 0 1.5px ${t.accent}` }}>i</button>
            )}
          </div>
          {sub && <div style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.4, color: t.ink2 }}>{sub}</div>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" style={{ border: 'none', cursor: 'pointer', width: 30, height: 30, borderRadius: 999,
          display: 'grid', placeItems: 'center', background: t.track, color: t.ink3, flexShrink: 0 }}><X size={15} /></button>
      </div>
      {open && info && (
        <div style={{ background: t.track, boxShadow: t.trackShadow, borderRadius: 14, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, color: t.ink3, display: 'grid', gap: 6 }}>
          {info.map((p, i) => <p key={i} style={{ margin: 0 }}>{p}</p>)}
        </div>
      )}
      {children}
    </div>
  );
}
const Busy = ({ t, text }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: t.ink2, padding: '6px 2px' }}><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />{text}</div>
);
const Err = ({ t, text }) => <div style={{ fontSize: 12.5, color: t.light ? '#b91c1c' : '#fca5a5', lineHeight: 1.45, padding: '4px 2px' }}>{text}</div>;

function useJson(url) {
  const [state, setState] = useState({ busy: !!url });
  useEffect(() => {
    if (!url) { setState({}); return undefined; }
    let on = true;
    setState({ busy: true });
    fetch(url).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!on) return;
      if (!r.ok || j.error) setState({ err: j.error || `The server said ${r.status}.` }); else setState({ data: j });
    }).catch((e) => on && setState({ err: `It could not be fetched (${e.message}).` }));
    return () => { on = false; };
  }, [url]);
  return state;
}

/* ── every model at the pin ───────────────────────────────────────────────────────────────────── */
export function ModelsAtPoint({ t, phone, place, lat, lon, v, label, unit, models, names = {}, validMs, onClose }) {
  const ids = useMemo(() => models.filter((m) => !HIDE.has(m)), [models]);
  const [series, setSeries] = useState({});            // id -> { values, run, made } | { err }
  useEffect(() => {
    setSeries({});
    let on = true;
    for (const id of ids) {
      fetch(`/api/modeldata/point?v=${encodeURIComponent(v)}&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&models=${id}`)
        .then((r) => r.json()).then((j) => { if (on) setSeries((o) => ({ ...o, [id]: j.models?.[0] || { values: [], made: false } })); })
        .catch(() => { if (on) setSeries((o) => ({ ...o, [id]: { err: true, values: [] } })); });
    }
    return () => { on = false; };
  }, [ids, v, lat, lon]);
  const [off, setOff] = useState(() => new Set());
  const now = useMemo(() => Date.now(), [v, lat, lon]);
  const lines = ids.map((id) => ({ id, s: series[id], colour: MODEL_COLOURS[id] || t.ink2 })).filter((l) => l.s?.values?.length);
  const shown = lines.filter((l) => !off.has(l.id));
  const x0 = now - 6 * 3600e3;
  const x1 = Math.min(now + 10 * 86400e3, Math.max(x0 + 86400e3, ...lines.flatMap((l) => l.s.values.map(([x]) => x))));
  const vals = shown.flatMap((l) => l.s.values.filter(([x]) => x >= x0 && x <= x1).map(([, y]) => y));
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const W = phone ? 480 : 760, H = phone ? 300 : 300, L = 44, R = 12, TOP = 12, B = 28;
  const X = (ms) => L + ((ms - x0) / (x1 - x0)) * (W - L - R);
  const Y = (y) => TOP + ((yMax - y) / (yMax - yMin)) * (H - TOP - B);
  const path = (pts) => pts.filter(([x]) => x >= x0 && x <= x1).map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('');
  const days = [];
  for (let d = new Date(x0); d.getTime() <= x1; d = new Date(d.getTime() + 86400e3)) {
    const ms = Date.parse(new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) + 'T00:00:00Z');
    if (ms > x0 && ms < x1 && !days.includes(ms)) days.push(ms);
  }
  const step = (yMax - yMin) / 5, mag = 10 ** Math.floor(Math.log10(step || 1)), tickStep = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= step) || step;
  const ticks = [];
  for (let y = Math.ceil(yMin / tickStep) * tickStep; y <= yMax; y += tickStep) ticks.push(Math.round(y * 1000) / 1000);
  const [hover, setHover] = useState(null);
  const locate = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    if (sx < L || sx > W - R) return null;
    return x0 + ((sx - L) / (W - L - R)) * (x1 - x0);
  };
  const near = (pts, ms) => { let b = null; for (const p of pts) if (!b || Math.abs(p[0] - ms) < Math.abs(b[0] - ms)) b = p; return b && Math.abs(b[0] - ms) <= 3.1 * 3600e3 ? b : null; };
  const pending = ids.filter((id) => !series[id]).length;
  const notMade = ids.filter((id) => series[id] && !series[id].values?.length).map((id) => names[id] || id);
  return (
    <ToolCard t={t} phone={phone} title={`${label}: every model`} sub={`${place} · each model's newest run`} onClose={onClose}
      info={['Each line is one model’s newest run at this spot, for the layer on the map. Where the lines bunch together the models agree and the forecast is surer; where they fan out, it is not.',
        'MWUK, in bold, is the middle of the models at each hour. A model whose layer has not been made yet shows no line: open it on the map once and it appears here.',
        'Point at the chart, or press on it on a phone or tablet, to read every model at that time.']}>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y', userSelect: 'none' }}
          onPointerDown={(e) => setHover(locate(e))} onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) setHover(locate(e)); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }} role="img" aria-label={`${label} at ${place} from every model`}>
          {ticks.map((y) => (
            <g key={y}>
              <line x1={L} x2={W - R} y1={Y(y)} y2={Y(y)} stroke={t.line} />
              <text x={L - 6} y={Y(y) + 4} textAnchor="end" fontSize="11" fill={t.ink2}>{y}</text>
            </g>
          ))}
          {days.map((ms) => (
            <g key={ms}>
              <line x1={X(ms)} x2={X(ms)} y1={TOP} y2={H - B} stroke={t.line} strokeDasharray="2 4" />
              <text x={X(ms) + 4} y={H - B + 17} fontSize="11" fontWeight="650" fill={t.ink2}>{fmtDayShort(ms)}</text>
            </g>
          ))}
          {validMs != null && validMs >= x0 && validMs <= x1 && <line x1={X(validMs)} x2={X(validMs)} y1={TOP} y2={H - B} stroke={t.accent} strokeWidth={1.4} opacity={0.6} />}
          <text x={L} y={TOP - 2} fontSize="11" fill={t.ink2}>{unit}</text>
          {shown.map((l) => (
            <path key={l.id} d={path(l.s.values)} fill="none" stroke={l.id === 'consensus' ? (t.light ? '#0f172a' : '#f8fafc') : l.colour}
              strokeWidth={l.id === 'consensus' ? 3.4 : 1.8} strokeLinejoin="round" opacity={hover != null && l.id !== 'consensus' ? 0.75 : 1} />
          ))}
          {hover != null && <line x1={X(hover)} x2={X(hover)} y1={TOP} y2={H - B} stroke={t.ink} strokeWidth={1} opacity={0.5} />}
        </svg>
        {hover != null && (() => {
          const rows = shown.map((l) => ({ l, p: near(l.s.values, hover) })).filter((r) => r.p).sort((a, b) => b.p[1] - a.p[1]);
          if (!rows.length) return null;
          const px = (X(hover) / W) * 100;
          return (
            <div style={{ position: 'absolute', top: 6, ...(px > 55 ? { right: `calc(${100 - px}% + 10px)` } : { left: `calc(${px}% + 10px)` }), pointerEvents: 'none',
              ...t.glass, borderRadius: 12, padding: '7px 10px', fontSize: 11.5, lineHeight: 1.45, color: t.ink3, width: 'max-content', maxWidth: 230 }}>
              <div style={{ fontWeight: 800, color: t.ink, marginBottom: 2 }}>{fmtT(hover)}</div>
              {rows.map(({ l, p }) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 3, borderRadius: 2, background: l.id === 'consensus' ? t.ink : l.colour, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: l.id === 'consensus' ? 800 : 600 }}>{names[l.id] || l.id}</span>
                  <b style={{ color: t.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(p[1], unit)}</b>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {lines.map((l) => (
          <button key={l.id} type="button" onClick={() => setOff((o) => { const n = new Set(o); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
            aria-pressed={!off.has(l.id)} title={off.has(l.id) ? 'Show this model' : 'Hide this model'}
            style={{ border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
              background: t.track, color: off.has(l.id) ? t.ink2 : t.ink, opacity: off.has(l.id) ? 0.55 : 1 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: l.id === 'consensus' ? t.ink : l.colour }} />{names[l.id] || l.id}
          </button>
        ))}
      </div>
      {pending > 0 && <Busy t={t} text={`Reading ${pending} more model${pending === 1 ? '' : 's'}… (the first time at a place can take up to a minute)`} />}
      {!pending && notMade.length > 0 && <div style={{ fontSize: 11.5, color: t.ink2 }}>Not made yet: {notMade.join(', ')}.</div>}
    </ToolCard>
  );
}

/* ── the sounding ─────────────────────────────────────────────────────────────────────────────── */
const RD = 287.04, CP = 1005.7, LV = 2.501e6, EPS = 0.622;
const esHpa = (tk) => 6.112 * Math.exp((17.67 * (tk - 273.15)) / (tk - 29.65));
const rsOf = (tk, p) => { const e = esHpa(tk); return (EPS * e) / Math.max(p - e, 1e-3); };
const moistDtDp = (tk, p) => { const r = rsOf(tk, p); return (RD * tk + LV * r) / (CP + (LV * LV * r * EPS) / (RD * tk * tk)) / p; };
function moistLine(thetaW, pFrom, pTo, dp) {
  const out = [];
  let tk = thetaW + 273.15;
  let p = 1000;
  const step = (sgn) => { const h = sgn * dp; const k1 = moistDtDp(tk, p), k2 = moistDtDp(tk + (h * k1) / 2, p + h / 2), k3 = moistDtDp(tk + (h * k2) / 2, p + h / 2), k4 = moistDtDp(tk + h * k3, p + h); tk += (h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6; p += h; };
  const up = [];
  while (p > pTo + 1e-6) { step(-1); up.push([p, tk - 273.15]); }
  tk = thetaW + 273.15; p = 1000;
  const down = [];
  while (p < pFrom - 1e-6) { step(1); down.push([p, tk - 273.15]); }
  return [...down.reverse(), [1000, thetaW], ...up];
}
const COMPASS = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east',
  'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
const compassOf = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

function Barb({ x, y, u, v, colour }) {
  const sp = Math.hypot(u, v) * KT;
  if (sp < 2.5) return <circle cx={x} cy={y} r={3} fill="none" stroke={colour} strokeWidth={1.3} />;
  const dir = (Math.atan2(-u, -v) * 180) / Math.PI;           // where it comes from, clockwise from north
  const r = (dir * Math.PI) / 180, len = 22;
  const dx = Math.sin(r), dy = -Math.cos(r);                    // along the staff, towards where the wind comes from
  const nx = -dy, ny = dx;                                      // the barbs' side
  const ex = x + dx * len, ey = y + dy * len;
  let left = Math.round(sp / 5) * 5;
  const parts = [];
  let at = 0;
  while (left >= 50) { parts.push(['flag', at]); left -= 50; at += 6; }
  while (left >= 10) { parts.push(['full', at]); left -= 10; at += 4; }
  if (left >= 5) parts.push(['half', at === 0 ? 4 : at]);
  return (
    <g stroke={colour} strokeWidth={1.4} fill={colour} strokeLinecap="round">
      <line x1={x} y1={y} x2={ex} y2={ey} />
      {parts.map(([k, a], i) => {
        const bx = ex - dx * a, by = ey - dy * a;
        if (k === 'flag') return <polygon key={i} points={`${bx},${by} ${bx + nx * 9 - dx * 3},${by + ny * 9 - dy * 3} ${bx - dx * 6},${by - dy * 6}`} strokeWidth={1} />;
        const l = k === 'full' ? 10 : 5.5;
        return <line key={i} x1={bx} y1={by} x2={bx + nx * l + dx * 3} y2={by + ny * l + dy * 3} />;
      })}
    </g>
  );
}

function SkewT({ t, snd, phone }) {
  const W = phone ? 360 : 440, H = phone ? 420 : 470, L = 34, R = 48, TOP = 8, B = 24;
  const P0 = 1050, P1 = 100, T0 = -40, T1 = 40;
  const PW = W - L - R, PH = H - TOP - B;
  const Y = (p) => H - B - ((Math.log(P0) - Math.log(p)) / (Math.log(P0) - Math.log(P1))) * PH;
  const X = (tc, p) => L + ((tc - T0) / (T1 - T0)) * PW + (H - B - Y(p));
  const prof = [snd.surface, ...snd.levels];
  const line = (pts) => pts.map(([p, tc], i) => `${i ? 'L' : 'M'}${X(tc, p).toFixed(1)},${Y(p).toFixed(1)}`).join('');
  const bg = useMemo(() => {
    const iso = [];
    for (let tc = -130; tc <= 40; tc += 10) iso.push({ tc, d: `M${X(tc, P0)},${Y(P0)}L${X(tc, P1)},${Y(P1)}` });
    const dry = [];
    for (let th = 230; th <= 470; th += 10) {
      const pts = [];
      for (let p = P0; p >= P1; p -= 25) pts.push([p, th * (p / 1000) ** 0.2857 - 273.15]);
      dry.push(line(pts));
    }
    const moist = [];
    for (let tw = -20; tw <= 32; tw += 4) moist.push(line(moistLine(tw, P0, 200, 10)));
    const mix = [];
    for (const w of [1, 2, 4, 7, 10, 16, 24]) {
      const pts = [];
      for (let p = P0; p >= 600; p -= 25) { const e = ((w / 1000) * p) / (EPS + w / 1000), a = Math.log(e / 6.112); pts.push([p, (243.5 * a) / (17.67 - a)]); }
      mix.push({ w, d: line(pts), end: pts[pts.length - 1] });
    }
    return { iso, dry, moist, mix };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);
  const sb = snd.parcels.surface;
  const pathP = sb.path.filter(([p]) => p >= P1);
  /* the parcel's warm area: between its path and the air around it, from its LFC to its EL */
  const cape = (() => {
    if (!sb.lfc || !sb.el || sb.cape < 10) return null;
    const envT = (p) => {
      for (let i = 0; i + 1 < prof.length; i++) {
        const a = prof[i], b = prof[i + 1];
        if (p <= a.p && p >= b.p) { const f = (Math.log(a.p) - Math.log(p)) / (Math.log(a.p) - Math.log(b.p)); return a.t + f * (b.t - a.t); }
      }
      return null;
    };
    const seg = pathP.filter(([p]) => p <= sb.lfc + 1 && p >= sb.el - 1);
    if (seg.length < 2) return null;
    const back = seg.map(([p]) => [p, envT(p)]).filter(([, e]) => e != null).reverse();
    return `${line(seg)}${back.map(([p, e]) => `L${X(e, p).toFixed(1)},${Y(p).toFixed(1)}`).join('')}Z`;
  })();
  const pLabels = [1000, 850, 700, 500, 300, 200, 100];
  const zOf = (p) => snd.levels.find((l) => l.p === p)?.z;
  const barbLevels = (() => { const out = []; let lastY = Infinity; for (const l of prof) { const y = Y(l.p); if (lastY - y >= (phone ? 16 : 14)) { out.push(l); lastY = y; } } return out; })();
  const mark = (p, label, colour) => (p ? (
    <g key={label}>
      <line x1={W - R - 2} x2={W - R - 14} y1={Y(p)} y2={Y(p)} stroke={colour} strokeWidth={2} />
      <text x={W - R - 16} y={Y(p) + 3.5} textAnchor="end" fontSize="9.5" fontWeight="800" fill={colour}>{label}</text>
    </g>
  ) : null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Skew-T diagram of the air above the place">
      <defs><clipPath id="skewt-clip"><rect x={L} y={TOP} width={PW} height={PH} /></clipPath></defs>
      <rect x={L} y={TOP} width={PW} height={PH} fill={t.light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.03)'} stroke={t.line} />
      <g clipPath="url(#skewt-clip)">
        {bg.iso.map(({ tc, d }) => <path key={tc} d={d} stroke={tc === 0 ? '#2563eb' : t.line} strokeWidth={tc === 0 ? 1.4 : 1} fill="none" opacity={tc === 0 ? 0.7 : 1} />)}
        {bg.dry.map((d, i) => <path key={`d${i}`} d={d} stroke="#c2410c" strokeWidth={0.8} fill="none" opacity={0.28} />)}
        {bg.moist.map((d, i) => <path key={`m${i}`} d={d} stroke="#15803d" strokeWidth={0.8} fill="none" opacity={0.3} strokeDasharray="5 3" />)}
        {bg.mix.map(({ w, d }) => <path key={`w${w}`} d={d} stroke="#7c3aed" strokeWidth={0.8} fill="none" opacity={0.3} strokeDasharray="2 3" />)}
        {cape && <path d={cape} fill="#ef4444" opacity={0.18} />}
        <path d={line(pathP)} fill="none" stroke={t.ink} strokeWidth={1.6} strokeDasharray="5 3" />
        <path d={line(prof.map((l) => [l.p, l.td]))} fill="none" stroke="#16a34a" strokeWidth={2.6} strokeLinejoin="round" />
        <path d={line(prof.map((l) => [l.p, l.t]))} fill="none" stroke="#dc2626" strokeWidth={2.6} strokeLinejoin="round" />
      </g>
      {pLabels.map((p) => (
        <g key={p}>
          <text x={L - 4} y={Y(p) + 3.5} textAnchor="end" fontSize="10" fill={t.ink2}>{p}</text>
          {zOf(p) != null && p < 1000 && <text x={L + 3} y={Y(p) - 3} fontSize="9" fill={t.ink2} opacity={0.85}>{(zOf(p) / 1000).toFixed(1)} km</text>}
        </g>
      ))}
      {[-30, -20, -10, 0, 10, 20, 30].map((tc) => <text key={tc} x={X(tc, P0)} y={H - B + 14} textAnchor="middle" fontSize="10" fill={t.ink2}>{tc}°</text>)}
      {mark(sb.lcl, 'LCL', t.ink)}{mark(sb.lfc, 'LFC', '#dc2626')}{mark(sb.el, 'EL', '#7c3aed')}
      {barbLevels.map((l) => <Barb key={l.p} x={W - R + 24} y={Y(l.p)} u={l.u} v={l.v} colour={t.ink} />)}
    </svg>
  );
}

function Hodograph({ t, snd, size = 170 }) {
  const zs = snd.surface.z;
  const pts = [snd.surface, ...snd.levels].map((l) => ({ h: l === snd.surface ? 0 : l.z - zs, u: l.u * KT, v: l.v * KT })).filter((p) => p.h <= 10000);
  const max = Math.max(40, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p.u, p.v)), 1) / 10) * 10);
  const c = size / 2, k = (size / 2 - 8) / max;
  const XY = (u, v) => [c + u * k, c - v * k];
  const band = (h) => (h <= 1000 ? '#dc2626' : h <= 3000 ? '#16a34a' : h <= 6000 ? '#2563eb' : '#9333ea');
  const [su, sv] = snd.indices.storm || [0, 0];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, display: 'block', flexShrink: 0 }} role="img" aria-label="Hodograph: how the wind changes with height">
      {[...Array(max / 10)].map((_, i) => <circle key={i} cx={c} cy={c} r={(i + 1) * 10 * k} fill="none" stroke={t.line} />)}
      <line x1={0} x2={size} y1={c} y2={c} stroke={t.line} /><line y1={0} y2={size} x1={c} x2={c} stroke={t.line} />
      {pts.slice(1).map((p, i) => {
        const a = XY(pts[i].u, pts[i].v), b = XY(p.u, p.v);
        return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={band(p.h)} strokeWidth={2.6} strokeLinecap="round" />;
      })}
      {(() => { const [x, y] = XY(su * KT, sv * KT); return <circle cx={x} cy={y} r={3.5} fill={t.ink} />; })()}
      <text x={c + 3} y={10} fontSize="9" fill={t.ink2}>{max} kt</text>
    </svg>
  );
}

/* what the numbers say, in plain words */
function readSounding(s) {
  const mu = s.parcels.most_unstable, sb = s.parcels.surface, ix = s.indices;
  const cape = Math.max(mu.cape, sb.cape), shearKt = Math.round(ix.shear06 * KT);
  const out = [];
  if (cape < 50) out.push('Stable: the air has no energy for thunderstorms.');
  else if (cape < 400) out.push(`A little instability (${cape} J/kg of CAPE): showers can grow, but thunder is unlikely.`);
  else if (cape < 1200) out.push(`Moderately unstable (${cape} J/kg): showers and thunderstorms where something lifts the air${sb.cin < -100 ? `, though a lid (CIN ${sb.cin} J/kg) holds them back at first` : ''}.`);
  else out.push(`Very unstable (${cape} J/kg): strong thunderstorms are possible${sb.cin < -100 ? ` once the lid (CIN ${sb.cin} J/kg) breaks` : ''}.`);
  if (cape >= 300 && shearKt >= 40) out.push(`With strong wind shear (${shearKt} kt from the ground to 6 km), storms could be organised and long-lived${ix.srh01 >= 100 ? `, and the low-level spin (${ix.srh01} m²/s² helicity) favours rotating storms` : ''}.`);
  else if (cape >= 300 && shearKt >= 25) out.push(`Moderate shear (${shearKt} kt): storms could cluster into lines.`);
  if (ix.freezing_level_m != null && ix.freezing_level_m < 600) out.push(`The freezing level is low (about ${ix.freezing_level_m} m above the ground): rain may turn to sleet or snow if it is heavy.`);
  if (ix.pw_mm >= 30) out.push(`Very moist air (${ix.pw_mm} mm of water in the column): downpours could be heavy.`);
  if (sb.lcl_m != null && sb.lcl_m < 300) out.push(`Cloud base very low (about ${sb.lcl_m} m).`);
  return out;
}

export function Sounding({ t, phone, place, url, onClose }) {
  const { busy, err, data } = useJson(url);
  const s = data;
  const row = (k, v) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '2px 0', borderBottom: `1px solid ${t.line}` }}>
      <span style={{ color: t.ink2 }}>{k}</span><b style={{ color: t.ink, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</b>
    </div>
  );
  return (
    <ToolCard t={t} phone={phone} title="The air above" onClose={onClose}
      sub={s ? `${place} · GFS run ${s.run.slice(8, 10)}/${s.run.slice(5, 7)} ${s.run.slice(11, 13)}Z · ${fmtT(Date.parse(s.valid))}` : place}
      info={['A skew-T diagram: the temperature (red) and the dew point (green) of the air above this place, from the ground up to about 16 km (100 hPa), from NOAA’s GFS model. Height goes up the chart; the lines slope to the right because the temperature lines are drawn tilted.',
        'Where red and green are close the air is nearly saturated: cloud. The dashed black line is a bubble of air lifted from the ground: where it is warmer than the air around it (shaded red) it keeps rising, and that warmth is the CAPE, the energy for showers and thunderstorms.',
        'LCL is where the lifted air makes cloud (the cloud base), LFC where it starts to rise freely, EL where it stops (the storm tops). The barbs on the right are the wind at each height; the small circle chart beside the numbers (the hodograph) shows how the wind turns and strengthens with height, which is what organises storms.',
        'The numbers are worked out here from GFS’s levels, so they can differ a little from the model’s own CAPE.']}>
      {busy && <Busy t={t} text="Fetching the GFS levels from NOAA…" />}
      {err && <Err t={t} text={err} />}
      {s && (
        <>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: phone ? '1fr' : 'minmax(0, 1.25fr) minmax(0, 1fr)', alignItems: 'start' }}>
            <SkewT t={t} snd={s} phone={phone} />
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Hodograph t={t} snd={s} size={phone ? 140 : 160} />
                <div style={{ fontSize: 11.5, color: t.ink2, lineHeight: 1.5 }}>
                  {[['#dc2626', '0–1 km'], ['#16a34a', '1–3 km'], ['#2563eb', '3–6 km'], ['#9333ea', '6–10 km']].map(([c, l]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 3, background: c, borderRadius: 2 }} />{l}</div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 9, background: t.ink }} />storm motion</div>
                </div>
              </div>
              <div>
                {row('CAPE (from the ground / most unstable)', `${s.parcels.surface.cape} / ${s.parcels.most_unstable.cape} J/kg`)}
                {row('CIN', `${s.parcels.surface.cin} J/kg`)}
                {row('Cloud base (LCL)', s.parcels.surface.lcl_m != null ? `${s.parcels.surface.lcl_m} m · ${Math.round(s.parcels.surface.lcl)} hPa` : '—')}
                {row('Free rise from (LFC)', s.parcels.surface.lfc ? `${s.parcels.surface.lfc_m} m · ${Math.round(s.parcels.surface.lfc)} hPa` : 'none')}
                {row('Tops (EL)', s.parcels.surface.el ? `${(s.parcels.surface.el_m / 1000).toFixed(1)} km · ${Math.round(s.parcels.surface.el)} hPa` : 'none')}
                {row('Water in the column', `${s.indices.pw_mm} mm`)}
                {row('Freezing level', s.indices.freezing_level_m != null ? `${s.indices.freezing_level_m} m` : 'at the ground')}
                {row('Lapse rate 850–500 hPa', s.indices.lapse_850_500 != null ? `${s.indices.lapse_850_500} °C/km` : '—')}
                {row('Wind shear 0–6 km', `${Math.round(s.indices.shear06 * KT)} kt`)}
                {row('Helicity 0–1 / 0–3 km', `${s.indices.srh01} / ${s.indices.srh03} m²/s²`)}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.ink3, display: 'grid', gap: 3 }}>{readSounding(s).map((x, i) => <span key={i}>{x}</span>)}</div>
        </>
      )}
    </ToolCard>
  );
}

/* ── the cross-section ────────────────────────────────────────────────────────────────────────── */
/* contour lines of a field on the section's grid (points across, levels up), as SVG paths, with the
   grid's own edges left out so only the lines themselves are drawn */
function isolines(values, n, m, levels, toXY) {
  const gen = contours().size([n, m]).smooth(true);
  return levels.map((lv) => {
    const g = gen.contour(values, lv);
    let d = '';
    for (const poly of g.coordinates) {
      for (const ring of poly) {
        let open = false;
        for (const [x, y] of ring) {
          const edge = x <= 0.5 || y <= 0.5 || x >= n - 0.5 || y >= m - 0.5;
          if (edge) { open = false; continue; }
          const [px, py] = toXY(x - 0.5, y - 0.5);
          d += `${open ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
          open = true;
        }
      }
    }
    return { lv, d };
  });
}
function bands(values, n, m, levels, toXY) {
  const gen = contours().size([n, m]).smooth(true);
  return levels.map((lv) => {
    const g = gen.contour(values, lv);
    const d = g.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y], i) => {
      const [px, py] = toXY(Math.min(Math.max(x - 0.5, 0), n - 1), Math.min(Math.max(y - 0.5, 0), m - 1));
      return `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
    }).join('') + 'Z').join('')).join('');
    return { lv, d };
  });
}

export function CrossSection({ t, phone, url, fromName, toName, onClose }) {
  const { busy, err, data: s } = useJson(url);
  const W = phone ? 480 : 760, H = phone ? 330 : 360, L = 40, R = 12, TOP = 12, B = 34;
  const [show, setShow] = useState({ cloud: true, temp: true, jet: true, thetae: false });
  const geo = useMemo(() => {
    if (!s) return null;
    const n = s.lats.length, m = s.levels.length, PB = Math.max(1000, ...s.surface_p) + 5, PT = 100;
    const Y = (p) => H - B - ((Math.log(PB) - Math.log(p)) / (Math.log(PB) - Math.log(PT))) * (H - TOP - B);
    const X = (i) => L + (i / (n - 1)) * (W - L - R);
    const toXY = (gx, gy) => {
      const k0 = Math.min(Math.floor(gy), m - 2), f = gy - k0;
      const lp = Math.log(s.levels[k0]) + f * (Math.log(s.levels[k0 + 1]) - Math.log(s.levels[k0]));
      return [X(gx), Y(Math.exp(lp))];
    };
    const flat = (k) => s[k].flat();
    return {
      n, m, X, Y, PB,
      cloud: bands(flat('rh'), n, m, [70, 85, 95], toXY),
      temp: isolines(flat('t'), n, m, [-60, -50, -40, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25], toXY),
      jet: bands(flat('wind'), n, m, [60, 90, 120], toXY),
      thetae: isolines(flat('thetae'), n, m, Array.from({ length: 40 }, (_, i) => 270 + i * 4), toXY),
      ground: `M${X(0)},${H - B}${s.surface_p.map((p, i) => `L${X(i).toFixed(1)},${Y(Math.min(p, PB)).toFixed(1)}`).join('')}L${X(n - 1)},${H - B}Z`,
    };
  }, [s, W, H]);
  const tog = (k, label) => (
    <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow((o) => ({ ...o, [k]: !o[k] }))}
      style={{ border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: show[k] ? t.on : t.track, color: show[k] ? t.onInk : t.ink3 }}>{label}</button>
  );
  return (
    <ToolCard t={t} phone={phone} title="Cross-section" onClose={onClose}
      sub={s ? `${fromName} → ${toName} · ${s.km} km · GFS run ${s.run.slice(8, 10)}/${s.run.slice(5, 7)} ${s.run.slice(11, 13)}Z · ${fmtT(Date.parse(s.valid))}` : `${fromName} → ${toName}`}
      info={['A slice through the air along the line drawn on the map, from the ground (bottom) to about 16 km (100 hPa, top), from NOAA’s GFS model.',
        'Grey shading is humid air, where cloud is likely (the darker, the closer to saturation). The red and blue lines are the temperature every 5 °C, with 0 °C in bold blue: above it snow, below it rain. Yellow and orange show the jet stream’s strongest winds (over 60, 90 and 120 knots). Theta-e lines bunch together at fronts.',
        'The brown at the bottom is the ground: hills and mountains along the line.']}>
      {busy && <Busy t={t} text="Fetching the GFS levels along the line from NOAA…" />}
      {err && <Err t={t} text={err} />}
      {s && geo && (
        <>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{tog('cloud', 'Cloud')}{tog('temp', 'Temperature')}{tog('jet', 'Jet stream')}{tog('thetae', 'Theta-e')}</div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Cross-section of the air along the line">
            <defs><clipPath id="xs-clip"><rect x={L} y={TOP} width={W - L - R} height={H - TOP - B} /></clipPath></defs>
            <rect x={L} y={TOP} width={W - L - R} height={H - TOP - B} fill={t.light ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.04)'} stroke={t.line} />
            <g clipPath="url(#xs-clip)">
              {show.cloud && geo.cloud.map(({ lv, d }) => <path key={lv} d={d} fill={t.light ? '#64748b' : '#cbd5e1'} opacity={lv === 70 ? 0.16 : lv === 85 ? 0.2 : 0.26} fillRule="evenodd" />)}
              {show.jet && geo.jet.map(({ lv, d }) => <path key={lv} d={d} fill={lv === 60 ? '#facc15' : lv === 90 ? '#fb923c' : '#ef4444'} opacity={0.3} fillRule="evenodd" />)}
              {show.thetae && geo.thetae.map(({ lv, d }) => <path key={lv} d={d} fill="none" stroke="#7c3aed" strokeWidth={0.9} opacity={0.55} />)}
              {show.temp && geo.temp.map(({ lv, d }) => <path key={lv} d={d} fill="none" stroke={lv === 0 ? '#1d4ed8' : lv > 0 ? '#dc2626' : '#2563eb'} strokeWidth={lv === 0 ? 2.6 : 1.1} opacity={lv === 0 ? 1 : 0.7} strokeDasharray={lv < 0 && lv !== 0 ? '4 3' : undefined} />)}
              <path d={geo.ground} fill={t.light ? '#8b6b4a' : '#6b4f35'} />
            </g>
            {[1000, 850, 700, 500, 300, 200, 100].filter((p) => p <= geo.PB).map((p) => <text key={p} x={L - 4} y={geo.Y(p) + 3.5} textAnchor="end" fontSize="10" fill={t.ink2}>{p}</text>)}
            <text x={L} y={H - B + 16} fontSize="11" fontWeight="700" fill={t.ink2}>{fromName}</text>
            <text x={W - R} y={H - B + 16} fontSize="11" fontWeight="700" textAnchor="end" fill={t.ink2}>{toName}</text>
            <text x={(L + W - R) / 2} y={H - B + 16} fontSize="10.5" textAnchor="middle" fill={t.ink2}>{Math.round(s.km / 2)} km</text>
          </svg>
        </>
      )}
    </ToolCard>
  );
}

/* ── where the air came from ──────────────────────────────────────────────────────────────────── */
export const TRAJ_COLOURS = { 925: '#ef4444', 850: '#f97316', 700: '#16a34a', 500: '#2563eb' };
const HEIGHT_OF = { 925: 'about 750 m up', 850: 'about 1.5 km up', 700: 'about 3 km up', 500: 'about 5.5 km up' };
function haversine(a, b) {
  const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
export function airPathWords(tr, hours) {
  const p = tr.path, a = p[0], o = p[p.length - 1];
  const km = haversine([a[0], a[1]], [o[0], o[1]]), dir = compassOf(bearing([a[0], a[1]], [o[0], o[1]]));
  const back = -o[3];
  const dp = o[2] - a[2];
  const vert = dp < -60 ? `sinking from ${o[2]} hPa` : dp > 60 ? `rising from ${o[2]} hPa` : 'at much the same height';
  return `Air arriving ${HEIGHT_OF[tr.from_p] || `at ${tr.from_p} hPa`} came from the ${dir}, ${Math.round(km / 10) * 10} km away ${back < hours ? `${back} hours ago (it came from outside the area the winds are known in before that)` : `${hours / 24} days ago`}, ${vert}.`;
}
export function AirPath({ t, phone, place, data, busy, err, onClose }) {
  const W = phone ? 460 : 560, H = 170, L = 40, R = 10, TOP = 10, B = 24;
  const hours = data?.hours || 72;
  const X = (h) => L + ((hours + h) / hours) * (W - L - R);
  const Y = (p) => TOP + ((Math.log(p) - Math.log(250)) / (Math.log(1030) - Math.log(250))) * (H - TOP - B);
  return (
    <ToolCard t={t} phone={phone} title="Where the air came from" onClose={onClose}
      sub={data ? `${place} · GFS run ${data.run.slice(8, 10)}/${data.run.slice(5, 7)} ${data.run.slice(11, 13)}Z · arriving ${fmtT(Date.parse(data.valid))}` : place}
      info={['The air over this place at the time on show, traced back through NOAA GFS’s winds: one path for each height, drawn on the map with an arrow at the place.',
        'The chart shows each path’s height over the past days: air that sinks warms and dries out (clear skies), air that rises cools and makes cloud and rain. Air from the Arctic is cold; from the Azores or Iberia, mild or warm and often moist.']}>
      {busy && <Busy t={t} text="Tracing the air back through the GFS winds…" />}
      {err && <Err t={t} text={err} />}
      {data && (
        <>
          <div style={{ display: 'grid', gap: 5 }}>
            {data.trajectories.map((tr) => (
              <div key={tr.from_p} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.45, color: t.ink3 }}>
                <span style={{ width: 14, height: 4, borderRadius: 2, background: TRAJ_COLOURS[tr.from_p], marginTop: 7, flexShrink: 0 }} />{airPathWords(tr, hours)}
              </div>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="The height of each path over the past days">
            {[1000, 850, 700, 500, 300].map((p) => (
              <g key={p}>
                <line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke={t.line} />
                <text x={L - 4} y={Y(p) + 3.5} textAnchor="end" fontSize="10" fill={t.ink2}>{p}</text>
              </g>
            ))}
            {Array.from({ length: hours / 24 + 1 }, (_, i) => -i * 24).map((h) => (
              <text key={h} x={X(h)} y={H - 6} textAnchor="middle" fontSize="10" fill={t.ink2}>{h ? `${h} h` : 'now'}</text>
            ))}
            {data.trajectories.map((tr) => (
              <path key={tr.from_p} d={tr.path.map(([, , p, h], i) => `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Y(p).toFixed(1)}`).join('')} fill="none" stroke={TRAJ_COLOURS[tr.from_p]} strokeWidth={2.4} strokeLinejoin="round" />
            ))}
            <text x={L} y={TOP - 1} fontSize="10" fill={t.ink2}>hPa</text>
          </svg>
        </>
      )}
    </ToolCard>
  );
}

/* ── the ensemble's scenarios ─────────────────────────────────────────────────────────────────── */
const SCEN_NAMES = ['A', 'B', 'C', 'D'];
function scenarioWords(s) {
  const d = s.uk_diff_hpa, b = s.biggest;
  const uk = Math.abs(d) < 1 ? 'much the same pressure over the UK as the ensemble as a whole'
    : `${d > 0 ? 'higher' : 'lower'} pressure over the UK (${d > 0 ? '+' : ''}${d} hPa)`;
  const far = Math.abs(b.diff_hpa) >= 3 ? `, ${b.diff_hpa > 0 ? 'highest' : 'lowest'} against the rest (${b.diff_hpa > 0 ? '+' : ''}${b.diff_hpa} hPa) to the ${b.towards}` : '';
  const feel = d >= 2 ? ': drier and more settled' : d <= -2 ? ': more unsettled, wetter and windier' : '';
  return `${uk[0].toUpperCase()}${uk.slice(1)}${far}${feel}.`;
}
export function Scenarios({ t, phone, url, lines, ensName, onClose }) {
  const { busy, err, data: d } = useJson(url);
  const maps = useMemo(() => {
    if (!d) return null;
    const [j0, j1, i0, i1] = d.box, nj = j1 - j0, ni = i1 - i0, k = d.k;
    const dec = (b64) => { const b = atob(b64); const out = new Float32Array(b.length); for (let i = 0; i < b.length; i++) { const q = b.charCodeAt(i); out[i] = q === 255 ? NaN : d.lo + (q / 254) * (d.hi - d.lo); } return out; };
    const fields = d.scenarios.map((s) => dec(s.mslp));
    const n = d.scenarios.reduce((a, s) => a + s.members.length, 0);
    const mean = new Float32Array(nj * ni);
    d.scenarios.forEach((s, c) => { const w = s.members.length / n; for (let i = 0; i < mean.length; i++) mean[i] += w * fields[c][i]; });
    const W = 300, H = Math.round((W * nj) / ni);
    const sx = W / ni, sy = H / nj;
    const toXY = (gx, gy) => [gx * sx, gy * sy];
    const gen = contours().size([ni, nj]).smooth(true);
    const iso = (f) => {
      const g = Array.from(f, (v) => (Number.isFinite(v) ? v : 1013));
      return Array.from({ length: 31 }, (_, i) => 940 + i * 4).map((lv) => {
        let path = '';
        for (const poly of gen.contour(g, lv).coordinates) for (const ring of poly) {
          let open = false;
          for (const [x, y] of ring) {
            if (x <= 0.5 || y <= 0.5 || x >= ni - 0.5 || y >= nj - 0.5) { open = false; continue; }
            const [px, py] = toXY(x - 0.5, y - 0.5);
            path += `${open ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
            open = true;
          }
        }
        return { lv, d: path };
      }).filter((x) => x.d);
    };
    const shade = (f) => {
      const diff = Array.from(f, (v, i) => (Number.isFinite(v) ? v - mean[i] : 0));
      return [-12, -8, -4, 4, 8, 12].map((lv) => ({ lv, d: gen.contour(lv < 0 ? diff.map((x) => -x) : diff, Math.abs(lv)).coordinates.map((poly) => poly.map((ring) => ring.map(([x, y], i) => {
        const [px, py] = toXY(Math.min(Math.max(x - 0.5, 0), ni - 1), Math.min(Math.max(y - 0.5, 0), nj - 1));
        return `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
      }).join('') + 'Z').join('')).join('') }));
    };
    /* the coasts, from the display grid's cells to this box's */
    const x0 = i0 * k + (k - 1) / 2, y0 = j0 * k + (k - 1) / 2;
    const coast = (lines?.coast || []).map((flat) => {
      let p = '', open = false;
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const gx = (flat[i] - x0) / k, gy = (flat[i + 1] - y0) / k;
        if (gx < -2 || gy < -2 || gx > ni + 2 || gy > nj + 2) { open = false; continue; }
        const [px, py] = toXY(gx, gy);
        p += `${open ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
        open = true;
      }
      return p;
    }).filter(Boolean).join('');
    return { W, H, coast, maps: d.scenarios.map((s, c) => ({ s, iso: iso(fields[c]), shade: shade(fields[c]) })) };
  }, [d, lines]);
  const SH = { '-12': '#1d4ed8', '-8': '#3b82f6', '-4': '#93c5fd', 4: '#fca5a5', 8: '#ef4444', 12: '#b91c1c' };
  return (
    <ToolCard t={t} phone={phone} title="Scenarios" onClose={onClose}
      sub={d ? `${ensName} · run ${d.run.slice(8, 10)}/${d.run.slice(5, 7)} ${d.run.slice(11, 13)}Z · ${fmtT(d.valid)} · T+${d.step}` : ensName}
      info={['The ensemble’s members (the same model run many times from slightly different starts) grouped by how alike their sea-level pressure is over the North Atlantic and Europe: each group is one way the weather could go.',
        'Each map is a group’s average pressure (the lines, every 4 hPa). Red is where its pressure is higher than the ensemble as a whole, blue where it is lower: that is what sets it apart. The share is how many members say it: the bigger the share, the likelier.',
        'When the members agree there is one group; when they split only in detail the groups are close, and it says so.']}>
      {busy && <Busy t={t} text="Grouping the members (this can take a minute the first time)…" />}
      {err && <Err t={t} text={err} />}
      {d && maps && (
        <>
          <div style={{ fontSize: 12.5, color: t.ink3, lineHeight: 1.45 }}>
            {d.scenarios.length === 1 ? `The ${d.members} members agree closely (they are ${d.spread_hpa} hPa apart on average): one scenario.`
              : `${d.scenarios.length} scenarios, ${d.distinct === 'clearly' ? 'clearly different' : d.distinct === 'fairly' ? 'fairly different' : 'different only in detail'} (the members are ${d.spread_hpa} hPa apart on average).`}
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: phone ? '1fr' : `repeat(${Math.min(2, maps.maps.length)}, minmax(0, 1fr))` }}>
            {maps.maps.map(({ s, iso, shade }, c) => (
              <div key={c} style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <b style={{ fontSize: 14, color: t.ink }}>Scenario {SCEN_NAMES[c]}</b>
                  <span style={{ fontSize: 12, color: t.ink2 }}>{s.members.length} of {d.members} members ({Math.round(s.share * 100)}%)</span>
                </div>
                <svg viewBox={`0 0 ${maps.W} ${maps.H}`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 12, background: t.light ? '#eef4fa' : '#0b1422' }}
                  role="img" aria-label={`Scenario ${SCEN_NAMES[c]}: average sea-level pressure`}>
                  {d.scenarios.length > 1 && shade.map(({ lv, d: p }) => <path key={lv} d={p} fill={SH[lv]} opacity={0.32} fillRule="evenodd" />)}
                  <path d={maps.coast} fill="none" stroke={t.light ? '#475569' : '#94a3b8'} strokeWidth={0.8} />
                  {iso.map(({ lv, d: p }) => <path key={lv} d={p} fill="none" stroke={t.light ? '#0f172a' : '#e2e8f0'} strokeWidth={lv % 20 === 0 ? 1.4 : 0.8} opacity={0.85} />)}
                </svg>
                <div style={{ fontSize: 12, color: t.ink3, lineHeight: 1.45 }}>{scenarioWords(s)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </ToolCard>
  );
}

/* ── the ensemble's members at the pin (a plume) ──────────────────────────────────────────────── */
export function EnsemblePlume({ t, phone, place, data, thr, dir, unit, label, ensName, validMs, onClose }) {
  const W = phone ? 480 : 760, H = 290, L = 44, R = 12, TOP = 12, B = 28;
  const [hover, setHover] = useState(null);
  const ok = data && data.times.length > 1;
  const all = ok ? data.members.flat().filter((v) => v != null) : [];
  const lo0 = all.length ? Math.min(...all, thr) : 0, hi0 = all.length ? Math.max(...all, thr) : 1;
  const pad = (hi0 - lo0) * 0.08 || 1, yMin = lo0 - pad, yMax = hi0 + pad;
  const x0 = ok ? data.times[0] : 0, x1 = ok ? data.times[data.times.length - 1] : 1;
  const X = (ms) => L + ((ms - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v) => TOP + ((yMax - v) / (yMax - yMin)) * (H - TOP - B);
  const mean = ok ? data.times.map((_, i) => { const v = data.members.map((m) => m[i]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }) : [];
  const path = (vals) => vals.map((v, i) => (v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${X(data.times[i]).toFixed(1)},${Y(v).toFixed(1)}`)).join('');
  const step = (yMax - yMin) / 5, mag = 10 ** Math.floor(Math.log10(step || 1)), ts = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= step) || step;
  const ticks = [];
  for (let y = Math.ceil(yMin / ts) * ts; y <= yMax; y += ts) ticks.push(Math.round(y * 1000) / 1000);
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), sx = ((e.clientX - r.left) / r.width) * W;
    if (!ok || sx < L || sx > W - R) return null;
    const ms = x0 + ((sx - L) / (W - L - R)) * (x1 - x0);
    let best = 0;
    data.times.forEach((x, i) => { if (Math.abs(x - ms) < Math.abs(data.times[best] - ms)) best = i; });
    return best;
  };
  const row = hover != null && ok ? (() => {
    const v = data.members.map((m) => m[hover]).filter((x) => x != null).sort((a, b) => a - b);
    const n = v.filter((x) => (dir === 'below' ? x <= thr : x >= thr)).length;
    return { ms: data.times[hover], n, of: v.length, min: v[0], max: v[v.length - 1], mean: mean[hover] };
  })() : null;
  return (
    <ToolCard t={t} phone={phone} title={`${label}: every member`} sub={`${place} · ${ensName}`} onClose={onClose}
      info={['Each thin line is one member of the ensemble: the same model run many times from slightly different starts. Together they show the range of what could happen at this spot.',
        'The bold line is their average; the dashed red line is the threshold of the chance on the map. Where most lines are past it, the chance is high; where they fan out widely, the forecast is unsure.']}>
      {!ok && <Busy t={t} text="Waiting for the members to load…" />}
      {ok && (
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y', userSelect: 'none' }} role="img" aria-label={`Every member's ${label} at ${place}`}
            onPointerDown={(e) => setHover(at(e))} onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) setHover(at(e)); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}>
            {ticks.map((y) => (
              <g key={y}><line x1={L} x2={W - R} y1={Y(y)} y2={Y(y)} stroke={t.line} /><text x={L - 6} y={Y(y) + 4} textAnchor="end" fontSize="11" fill={t.ink2}>{y}</text></g>
            ))}
            {data.members.map((m, i) => <path key={i} d={path(m)} fill="none" stroke="#2f7fe0" strokeWidth={1} opacity={0.3} />)}
            <line x1={L} x2={W - R} y1={Y(thr)} y2={Y(thr)} stroke="#dc2626" strokeWidth={1.6} strokeDasharray="6 4" />
            <path d={path(mean)} fill="none" stroke={t.light ? '#0f172a' : '#f8fafc'} strokeWidth={3} />
            {validMs != null && validMs >= x0 && validMs <= x1 && <line x1={X(validMs)} x2={X(validMs)} y1={TOP} y2={H - B} stroke={t.accent} strokeWidth={1.4} opacity={0.6} />}
            {hover != null && <line x1={X(data.times[hover])} x2={X(data.times[hover])} y1={TOP} y2={H - B} stroke={t.ink} opacity={0.5} />}
            {[0, Math.floor(data.times.length / 2), data.times.length - 1].map((i) => (
              <text key={i} x={X(data.times[i])} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.times.length - 1 ? 'end' : 'middle'} fontSize="11" fill={t.ink2}>{fmtDayShort(data.times[i])}</text>
            ))}
            <text x={L} y={TOP - 2} fontSize="11" fill={t.ink2}>{unit}</text>
          </svg>
          {row && (
            <div style={{ position: 'absolute', top: 6, left: 52, pointerEvents: 'none', ...t.glass, borderRadius: 12, padding: '7px 10px', fontSize: 11.5, lineHeight: 1.45, color: t.ink3 }}>
              <div style={{ fontWeight: 800, color: t.ink }}>{fmtT(row.ms)}</div>
              <div><b style={{ color: t.ink }}>{row.n} of {row.of}</b> members {dir === 'below' ? 'at or below' : 'at or above'} {fmtNum(thr, unit)}</div>
              <div>Average {fmtNum(row.mean, unit)} · lowest {fmtNum(row.min, unit)} · highest {fmtNum(row.max, unit)}</div>
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
}
