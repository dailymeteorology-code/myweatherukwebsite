/* The detailed charts on the Location page: one UK calendar day at a time, ten measures, every
   one straight from the UKV hours (src/lib/ukvLocation.js). Smooth monotone curves (no
   overshoot past the data), a "now" line on today, and a read-out that follows the pointer or
   a finger. Beyond T+54 UKV is three-hourly for most fields, so those curves simply have
   fewer points; temperature stays hourly. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChartSpline } from 'lucide-react';
import { compass, hhmm, hourOf, longDay, uvWord, visWord } from '@/lib/ukvLocation';

/* ── temperature colours (shared with the day rows) ── */
const T_STOPS = [[-10, [155, 183, 255]], [-2, [111, 182, 255]], [3, [79, 200, 240]], [8, [77, 212, 180]], [12, [139, 219, 91]], [16, [242, 212, 60]], [20, [255, 170, 51]], [25, [255, 122, 47]], [30, [255, 77, 58]]];
export function tempColour(t) {
  if (t == null) return '#ffffff';
  if (t <= T_STOPS[0][0]) return `rgb(${T_STOPS[0][1]})`;
  for (let i = 1; i < T_STOPS.length; i++) {
    if (t <= T_STOPS[i][0]) {
      const [a, ca] = T_STOPS[i - 1], [b, cb] = T_STOPS[i], f = (t - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + f * (cb[k] - c))).join(',')})`;
    }
  }
  return `rgb(${T_STOPS[T_STOPS.length - 1][1]})`;
}

export function londonMidnight(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  return t - hourOf(t) * 36e5;
}
const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

/* a monotone cubic through points (Fritsch-Carlson): smooth, never overshooting the data */
function smooth(pts) {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : '';
  const m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) m.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    d += `C${(pts[i][0] + dx).toFixed(1)},${(pts[i][1] + t[i] * dx).toFixed(1)},${(pts[i + 1][0] - dx).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * dx).toFixed(1)},${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}
/* split a series at its gaps */
const runs = (pts) => pts.reduce((acc, p) => { if (p[1] == null) acc.push([]); else acc[acc.length - 1].push(p); return acc; }, [[]]).filter((r) => r.length);

function domain(vals, { min = null, max = null, span = 1, pad = 0.08 } = {}) {
  const v = vals.filter((x) => x != null && Number.isFinite(x));
  let lo = v.length ? Math.min(...v) : 0, hi = v.length ? Math.max(...v) : 1;
  if (min != null) lo = Math.min(lo, min);
  if (max != null) hi = Math.max(hi, max);
  if (hi - lo < span) { const c = (hi + lo) / 2; lo = c - span / 2; hi = c + span / 2; }
  const p = (hi - lo) * pad;
  lo = min != null && lo >= min ? Math.max(min, lo - p) : lo - p;
  hi += p;
  const step = niceStep((hi - lo) / 3);
  const ticks = [];
  for (let x = Math.ceil(lo / step) * step; x <= hi + 1e-9; x += step) ticks.push(Math.round(x * 1000) / 1000);
  return { lo, hi, ticks };
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

const METRICS = [
  ['temp', 'Temperature'], ['rain', 'Rain'], ['wind', 'Wind'], ['cloud', 'Cloud'], ['humidity', 'Humidity'],
  ['pressure', 'Pressure'], ['vis', 'Visibility'], ['sun', 'Sun & UV'], ['thunder', 'Thunder'], ['snow', 'Snow & ice'],
];

function Plot({ width, x0, x1, nowMs, left, right, items, hoverTimes, tip }) {
  const H = 200, PL = 34, PR = right ? 38 : 10, PT = 12, PB = 24;
  const iw = Math.max(10, width - PL - PR), ih = H - PT - PB;
  const X = (t) => PL + ((t - x0) / (x1 - x0)) * iw;
  const Y = (v, ax = left) => PT + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * ih;
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const clip = useMemo(() => `lwclip${Math.random().toString(36).slice(2)}`, []);
  const onMove = (e) => {
    const r = box.current.getBoundingClientRect();
    const t = x0 + ((e.clientX - r.left - PL) / iw) * (x1 - x0);
    let best = null;
    for (const h of hoverTimes) if (best == null || Math.abs(h - t) < Math.abs(best - t)) best = h;
    setHover(best);
  };
  const hx = hover != null ? X(hover) : null;
  const xTicks = [];
  for (let h = 0; h <= 24; h += 3) xTicks.push(x0 + h * 36e5);
  return (
    <div className="lw-chart" ref={box} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img">
        <defs><clipPath id={clip}><rect x={PL} y={0} width={iw} height={H} /></clipPath></defs>
        {left.ticks.map((v) => (
          <g key={`l${v}`}>
            <line x1={PL} x2={PL + iw} y1={Y(v)} y2={Y(v)} stroke="rgba(255,255,255,0.1)" />
            <text x={PL - 6} y={Y(v) + 4} textAnchor="end">{left.fmt(v)}</text>
          </g>
        ))}
        {right && right.ticks.map((v) => <text key={`r${v}`} x={PL + iw + 6} y={Y(v, right) + 4}>{right.fmt(v)}</text>)}
        {xTicks.map((t, i) => (
          <text key={t} x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{String((i * 3) % 24).padStart(2, '0')}</text>
        ))}
        <g clipPath={`url(#${clip})`}>
          {items.map((it, k) => {
            const ax = it.axis === 'right' ? right : left;
            if (it.type === 'strips') {
              const rowH = ih / it.rows.length;
              return (
                <g key={k}>
                  {it.rows.map((row, ri) => row.cells.map(([a, b, alpha]) => (
                    <rect key={`${ri}-${a}`} x={X(a)} y={PT + ri * rowH + 2} width={Math.max(1, X(b) - X(a) + 0.5)} height={rowH - 4} rx="3" fill={row.colour} opacity={alpha} />
                  )))}
                </g>
              );
            }
            if (it.type === 'bars') {
              return <g key={k}>{it.bars.map(([a, b, v, c]) => (v > 0 ? <rect key={a} x={X(a) + 0.8} y={Y(v, ax)} width={Math.max(1.5, X(b) - X(a) - 1.6)} height={Math.max(0, Y(ax.lo, ax) - Y(v, ax))} rx="2" fill={c} /> : null))}</g>;
            }
            if (it.type === 'arrows') {
              return (
                <g key={k}>{it.pts.map(([t, deg]) => (deg == null ? null : (
                  <g key={t} transform={`translate(${X(t)} ${PT + 8}) rotate(${deg + 180})`}>
                    <path d="M0 -6 L4 3 L0 1 L-4 3 Z" fill="rgba(255,255,255,0.85)" />
                  </g>
                )))}</g>
              );
            }
            const segs = runs(it.pts.map(([t, v]) => [X(t), v == null ? null : Y(v, ax)]));
            if (it.type === 'area') {
              return (
                <g key={k}>
                  <defs>
                    <linearGradient id={`${clip}a${k}`} x1="0" x2="0" y1={PT} y2={PT + ih} gradientUnits="userSpaceOnUse">
                      <stop offset="0" stopColor={it.colour} stopOpacity={it.opacity ?? 0.5} />
                      <stop offset="1" stopColor={it.colour} stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  {segs.map((s, i) => <path key={i} d={`${smooth(s)}L${s[s.length - 1][0]},${PT + ih}L${s[0][0]},${PT + ih}Z`} fill={`url(#${clip}a${k})`} />)}
                </g>
              );
            }
            let stroke = it.colour;
            let grad = null;
            if (it.gradient) {
              const id = `${clip}g${k}`;
              const stops = [];
              for (let v = Math.floor(ax.lo); v <= Math.ceil(ax.hi); v += Math.max(1, Math.round((ax.hi - ax.lo) / 8))) stops.push(v);
              grad = (
                <linearGradient id={id} x1="0" x2="0" y1={PT} y2={PT + ih} gradientUnits="userSpaceOnUse">
                  {stops.map((v) => <stop key={v} offset={Math.min(1, Math.max(0, (ax.hi - v) / (ax.hi - ax.lo)))} stopColor={it.gradient(v)} />)}
                </linearGradient>
              );
              stroke = `url(#${id})`;
            }
            return (
              <g key={k}>
                {grad && <defs>{grad}</defs>}
                {segs.map((s, i) => <path key={i} d={smooth(s)} fill="none" stroke={stroke} strokeWidth={it.width ?? 2.5} strokeDasharray={it.dash} strokeLinecap="round" strokeLinejoin="round" />)}
              </g>
            );
          })}
          {nowMs != null && nowMs > x0 && nowMs < x1 && (
            <g>
              <line x1={X(nowMs)} x2={X(nowMs)} y1={PT} y2={PT + ih} stroke="rgba(255,255,255,0.5)" strokeDasharray="2 3" />
              <rect x={PL} y={PT} width={X(nowMs) - PL} height={ih} fill="rgba(0,0,0,0.12)" />
            </g>
          )}
        </g>
        {hx != null && <line x1={hx} x2={hx} y1={PT} y2={PT + ih} stroke="rgba(255,255,255,0.75)" />}
      </svg>
      {hover != null && (
        <div className="lw-tip" style={hx > width / 2 ? { right: width - hx + 10 } : { left: hx + 10 }}>
          {tip(hover)}
        </div>
      )}
    </div>
  );
}

export default function LocationCharts({ model, unit, dayIdx, onDay }) {
  const [metric, setMetric] = useState('temp');
  const wrap = useRef(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const day = model.days[Math.min(dayIdx, model.days.length - 1)];
  if (!day) return null;
  const x0 = londonMidnight(day.day), x1 = londonMidnight(nextDay(day.day));
  const near = (h) => h.t >= x0 - 3 * 36e5 && h.t <= x1 + 3 * 36e5;
  const hs = model.hours.filter(near);
  const fs = hs.filter((h) => h.full);
  const inDay = (h) => h.t >= x0 && h.t <= x1;
  const nowMs = Date.now();
  const T = (c) => (c == null ? null : unit === 'F' ? (c * 9) / 5 + 32 : c);
  const deg = (v) => `${Math.round(v)}°`;
  const at = (t, list = hs) => list.find((h) => h.t === t);
  const tipHead = (t) => <div><b>{hhmm(t)}</b></div>;

  let plot = null, legend = [], note = null;
  if (metric === 'temp') {
    const left = domain(hs.flatMap((h) => [T(h.t2), T(h.feels), T(h.td)]), { span: 6 });
    left.fmt = deg;
    plot = {
      left, hoverTimes: hs.filter(inDay).map((h) => h.t),
      items: [
        { type: 'line', pts: hs.map((h) => [h.t, T(h.td)]), colour: '#7fe0cf', width: 1.6 },
        { type: 'line', pts: hs.map((h) => [h.t, T(h.feels)]), colour: 'rgba(255,255,255,0.75)', width: 1.8, dash: '4 4' },
        { type: 'line', pts: hs.map((h) => [h.t, T(h.t2)]), gradient: (v) => tempColour(unit === 'F' ? ((v - 32) * 5) / 9 : v), width: 3.2 },
      ],
      tip: (t) => { const h = at(t); return <>{tipHead(t)}<div>Temperature <b>{deg(T(h.t2))}</b></div>{h.feels != null && <div>Feels like {deg(T(h.feels))}</div>}{h.td != null && <div>Dew point {deg(T(h.td))}</div>}</>; },
    };
    legend = [['Temperature', 'linear-gradient(90deg,#4fc8f0,#f2d43c,#ff7a2f)'], ['Feels like', 'rgba(255,255,255,0.75)'], ['Dew point', '#7fe0cf']];
  } else if (metric === 'rain') {
    const bars = fs.filter((h) => h.span > 0).map((h) => [h.t - h.span * 36e5, h.t, (h.precip ?? 0) / h.span, (h.snow ?? 0) > (h.precip ?? 0) / 2 ? '#eef5ff' : '#4cb0ff']);
    const left = domain(bars.map((b) => b[2]), { min: 0, span: 1 });
    left.fmt = (v) => (v ? `${v}` : '0');
    const right = { lo: 0, hi: 100, ticks: [0, 50, 100], fmt: (v) => `${v}%` };
    plot = {
      left, right, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [{ type: 'bars', bars }, { type: 'line', axis: 'right', pts: fs.map((h) => [h.t, h.pRain]), colour: '#9fd8ff', width: 1.6, dash: '3 3' }],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div><b>{(h.precip ?? 0).toFixed(1)} mm</b> in the {h.span > 1 ? `${h.span} hours` : 'hour'}{(h.snow ?? 0) > 0.05 ? ` (${(h.snow).toFixed(1)} mm as snow)` : ''}</div>{h.pRain != null && <div>Chance within 10 km {h.pRain}%</div>}<div>Rate at {hhmm(t)}: {(h.precipRate ?? 0).toFixed(1)} mm/h</div></>; },
    };
    legend = [['Rain per hour (mm)', '#4cb0ff'], ['Snow', '#eef5ff'], ['Chance of rain', '#9fd8ff']];
    note = 'Bars show each hour’s rain as mm per hour; past T+54 UKV gives three-hour totals, spread over the three hours.';
  } else if (metric === 'wind') {
    const left = domain(fs.flatMap((h) => [h.wind, h.gust]), { min: 0, span: 10 });
    left.fmt = (v) => `${v}`;
    plot = {
      left, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [
        { type: 'area', pts: fs.map((h) => [h.t, h.wind]), colour: '#8fd3ff', opacity: 0.55 },
        { type: 'line', pts: fs.map((h) => [h.t, h.wind]), colour: '#8fd3ff', width: 2.4 },
        { type: 'line', pts: fs.map((h) => [h.t, h.gust]), colour: '#ffffff', width: 1.8, dash: '5 4' },
        { type: 'arrows', pts: fs.filter((h, i) => i % (fs.length > 14 ? 2 : 1) === 0).map((h) => [h.t, h.wdir]) },
      ],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>Wind <b>{Math.round(h.wind)} mph</b> {compass(h.wdir)}</div><div>Gusts {Math.round(h.gust)} mph</div></>; },
    };
    legend = [['Wind (mph)', '#8fd3ff'], ['Gusts', '#ffffff']];
  } else if (metric === 'cloud') {
    const cells = (k) => fs.map((h, i) => [h.t - (i ? (h.t - fs[i - 1].t) / 2 : 18e5), h.t + (i < fs.length - 1 ? (fs[i + 1].t - h.t) / 2 : 18e5), Math.min(1, (h[k] ?? 0) / 100)]);
    const left = { lo: 0, hi: 3, ticks: [], fmt: () => '' };
    plot = {
      left, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [{ type: 'strips', rows: [{ label: 'High', colour: '#dfe8f3', cells: cells('hcc') }, { label: 'Middle', colour: '#c4d1df', cells: cells('mcc') }, { label: 'Low', colour: '#aebccb', cells: cells('lcc') }] }],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>Total <b>{Math.round(h.tcc)}%</b></div><div>High {Math.round(h.hcc ?? 0)}% · middle {Math.round(h.mcc ?? 0)}% · low {Math.round(h.lcc ?? 0)}%</div>{h.cloudBase != null && <div>Cloud base {Math.round(h.cloudBase / 10) * 10} m</div>}</>; },
    };
    legend = [['High cloud (top row)', '#dfe8f3'], ['Middle', '#c4d1df'], ['Low (bottom row)', '#aebccb']];
    note = 'Each row is a layer of the sky; the brighter the block, the more of that layer is covered.';
  } else if (metric === 'humidity') {
    const left = { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100], fmt: (v) => `${v}%` };
    plot = {
      left, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [{ type: 'area', pts: fs.map((h) => [h.t, h.rh]), colour: '#7cc4ff', opacity: 0.4 }, { type: 'line', pts: fs.map((h) => [h.t, h.rh]), colour: '#7cc4ff', width: 2.6 }],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>Humidity <b>{Math.round(h.rh)}%</b></div><div>Dew point {deg(T(h.td))}</div></>; },
    };
    legend = [['Relative humidity', '#7cc4ff']];
  } else if (metric === 'pressure') {
    const left = domain(fs.map((h) => h.mslp), { span: 6 });
    left.fmt = (v) => `${Math.round(v)}`;
    plot = {
      left, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [{ type: 'line', pts: fs.map((h) => [h.t, h.mslp]), colour: '#c9b8ff', width: 2.8 }],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>Pressure <b>{Math.round(h.mslp)} hPa</b></div></>; },
    };
    legend = [['Mean sea-level pressure (hPa)', '#c9b8ff']];
  } else if (metric === 'vis') {
    const left = { lo: 0, hi: 40, ticks: [0, 10, 20, 30, 40], fmt: (v) => `${v}` };
    plot = {
      left, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [{ type: 'area', pts: fs.map((h) => [h.t, Math.min(40, h.vis ?? 0)]), colour: '#d5dde6', opacity: 0.35 }, { type: 'line', pts: fs.map((h) => [h.t, Math.min(40, h.vis ?? 0)]), colour: '#e8eef4', width: 2.4 }],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>Visibility <b>{h.vis >= 10 ? Math.round(h.vis) : h.vis?.toFixed(1)} km</b> · {visWord(h.vis)}</div>{(h.fog ?? 0) >= 10 && <div>Fog chance {Math.round(h.fog)}%</div>}</>; },
    };
    legend = [['Visibility (km, top 40)', '#e8eef4']];
  } else if (metric === 'sun') {
    const left = domain(fs.map((h) => h.sw), { min: 0, span: 100 });
    left.fmt = (v) => `${v}`;
    const right = { lo: 0, hi: 8, ticks: [0, 2, 4, 6, 8], fmt: (v) => `${v}` };
    plot = {
      left, right, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [{ type: 'area', pts: fs.map((h) => [h.t, h.sw]), colour: '#ffd36b', opacity: 0.55 }, { type: 'line', pts: fs.map((h) => [h.t, h.sw]), colour: '#ffd36b', width: 2 }, { type: 'line', axis: 'right', pts: fs.map((h) => [h.t, h.uvi]), colour: '#ff9f5a', width: 2.2, dash: '4 3' }],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>Sunshine power <b>{Math.round(h.sw ?? 0)} W/m²</b></div><div>UV index {Math.round(h.uvi ?? 0)} · {uvWord(h.uvi)}</div></>; },
    };
    legend = [['Solar radiation (W/m²)', '#ffd36b'], ['UV index (right)', '#ff9f5a']];
  } else if (metric === 'thunder') {
    const bars = fs.filter((h, i) => i > 0).map((h, i) => [fs[i].t, h.t, h.cape ?? 0, '#ffb547']);
    const left = domain(bars.map((b) => b[2]), { min: 0, span: 200 });
    left.fmt = (v) => `${v}`;
    const right = { lo: 0, hi: 100, ticks: [0, 50, 100], fmt: (v) => `${v}%` };
    plot = {
      left, right, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [{ type: 'bars', bars }, { type: 'line', axis: 'right', pts: fs.map((h) => [h.t, h.pThunder]), colour: '#ffe066', width: 2 }],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>CAPE <b>{Math.round(h.cape ?? 0)} J/kg</b></div><div>{h.pThunder != null ? `Lightning within 16 km ${h.pThunder}%` : 'Lightning chance: not forecast this far ahead'}</div></>; },
    };
    legend = [['CAPE (storm fuel, J/kg)', '#ffb547'], ['Chance of lightning (right)', '#ffe066']];
    note = 'UKV forecasts lightning to T+54; beyond that only the storm fuel (CAPE) is shown.';
  } else if (metric === 'snow') {
    const left = domain(fs.map((h) => h.frz), { min: 0, span: 500 });
    left.fmt = (v) => `${v}`;
    const right = domain(hs.flatMap((h) => [T(h.ground), T(h.t2)]), { span: 6 });
    right.fmt = deg;
    plot = {
      left, right, hoverTimes: fs.filter(inDay).map((h) => h.t),
      items: [
        { type: 'area', pts: fs.map((h) => [h.t, h.frz]), colour: '#9fd8ff', opacity: 0.35 },
        { type: 'line', pts: fs.map((h) => [h.t, h.frz]), colour: '#9fd8ff', width: 2.4 },
        { type: 'line', axis: 'right', pts: fs.map((h) => [h.t, T(h.ground)]), colour: '#f0f6ff', width: 1.8, dash: '4 3' },
      ],
      tip: (t) => { const h = at(t, fs); return <>{tipHead(t)}<div>Freezing level <b>{Math.round((h.frz ?? 0) / 10) * 10} m</b></div><div>Ground {deg(T(h.ground))}</div>{(h.snowLying ?? 0) > 0.5 && <div>Lying snow {Math.round(h.snowLying)} mm water</div>}</>; },
    };
    legend = [['Freezing level (m)', '#9fd8ff'], ['Ground temperature (right)', '#f0f6ff']];
  }

  return (
    <div className="lw-glass lw-card">
      <div className="lw-title"><ChartSpline />Detailed forecast<span className="lw-title-aside">{longDay(day.day)}</span></div>
      <div className="lw-chips" role="group" aria-label="Day" style={{ marginBottom: 8 }}>
        {model.days.map((d, i) => <button key={d.day} type="button" className="lw-chip" aria-pressed={i === dayIdx} onClick={() => onDay(i)}>{d.label}</button>)}
      </div>
      <div className="lw-chips" role="group" aria-label="Measure" style={{ marginBottom: 10 }}>
        {METRICS.map(([k, l]) => <button key={k} type="button" className="lw-chip" aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}
      </div>
      <div ref={wrap}>
        {plot && <Plot key={`${metric}${day.day}`} width={width} x0={x0} x1={x1} nowMs={nowMs} {...plot} />}
      </div>
      <div className="lw-legend">{legend.map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>
      {note && <div className="lw-mini" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
}
