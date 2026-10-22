/* The detailed charts on the Location page: one UK calendar day at a time, ten measures, every
   one straight from the UKV hours (src/lib/ukvLocation.js). Smooth monotone curves (no
   overshoot past the data), a "now" line on today, and a read-out that follows the pointer or a
   finger to the minute: the values are read off the same curves the chart draws, a dot marks
   each line at that moment, and the arrow keys step through the day a quarter of an hour at a
   time. Beyond T+54 UKV is three-hourly for most fields, so those curves simply have fewer
   points; temperature stays hourly. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChartSpline } from 'lucide-react';
import { compass, condLabel, hhmm, hourOf, longDay, uvWord, visWord } from '@/lib/ukvLocation';
import WxIcon from '@/components/location/WxIcon';

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

/* ── the curves: monotone cubics (Fritsch-Carlson), smooth and never overshooting the data ──
   The tangents are shared by the drawing and by curveAt, so a value read off at any moment is
   exactly where the drawn line is. */
function tangents(pts) {
  const n = pts.length, m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) m.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return t;
}
function smooth(pts) {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : '';
  const t = tangents(pts);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    d += `C${(pts[i][0] + dx).toFixed(1)},${(pts[i][1] + t[i] * dx).toFixed(1)},${(pts[i + 1][0] - dx).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * dx).toFixed(1)},${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}
/** the curve through pts (sorted by x, no gaps) at x; null outside it */
function curveAt(pts, x) {
  const n = pts.length;
  if (!n || x < pts[0][0] || x > pts[n - 1][0]) return null;
  if (n === 1) return pts[0][1];
  let i = 0;
  while (i < n - 2 && x > pts[i + 1][0]) i++;
  const t = tangents(pts);
  const h = pts[i + 1][0] - pts[i][0] || 1, s = (x - pts[i][0]) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  return h00 * pts[i][1] + h10 * h * t[i] + h01 * pts[i + 1][1] + h11 * h * t[i + 1];
}
/* split a series at its gaps */
const runs = (pts) => pts.reduce((acc, p) => { if (p[1] == null) acc.push([]); else acc[acc.length - 1].push(p); return acc; }, [[]]).filter((r) => r.length);
/** a series' value at time t, off the drawn curve (the run of data t falls in) */
const seriesAt = (pts, t) => { for (const r of runs(pts)) { const v = curveAt(r, t); if (v != null) return v; } return null; };

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

const STEP = 15 * 60e3;                                  // the arrow keys move a quarter of an hour
const ARROW_GAP = 26;                                    // px between wind arrows

/* `band`: a strip above the plot for the wind's arrows, so no line can run through them.
   `range`: the times there is data for (the read-out stays inside it). */
function Plot({ width, x0, x1, nowMs, left, right, items, range, tip, band = 0 }) {
  const H = 200 + band, PL = 34, PR = right ? 38 : 10, PT = 12 + band, PB = 24;
  const iw = Math.max(10, width - PL - PR), ih = H - PT - PB;
  const X = (t) => PL + ((t - x0) / (x1 - x0)) * iw;
  const Y = (v, ax = left) => PT + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * ih;
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const clip = useMemo(() => `lwclip${Math.random().toString(36).slice(2)}`, []);
  const lo = Math.max(x0, range[0]), hi = Math.min(x1, range[1]);
  const clampT = (t) => Math.min(hi, Math.max(lo, t));
  /* any moment, not only the whole hours: to the minute, read off the curves */
  const onMove = (e) => {
    const r = box.current.getBoundingClientRect();
    const t = x0 + ((e.clientX - r.left - PL) / iw) * (x1 - x0);
    setHover(Math.round(clampT(t) / 60e3) * 60e3);
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const base = hover ?? clampT(nowMs > lo && nowMs < hi ? nowMs : lo);
    const next = Math.round(base / STEP) * STEP + (e.key === 'ArrowRight' ? STEP : -STEP);
    setHover(clampT(next));
  };
  const hx = hover != null ? X(hover) : null;
  const xTicks = [];
  for (let h = 0; h <= 24; h += 3) xTicks.push(x0 + h * 36e5);
  return (
    <div className="lw-chart" ref={box} tabIndex={0} role="group" aria-label="Chart. Move along it, or use the left and right arrow keys, to read the values."
      onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}>
      <svg width={width} height={H} aria-hidden="true">
        <defs><clipPath id={clip}><rect x={PL} y={0} width={iw} height={H} /></clipPath></defs>
        {band > 0 && <line x1={PL} x2={PL + iw} y1={PT - 4} y2={PT - 4} stroke="rgba(255,255,255,0.08)" />}
        {left.ticks.map((v) => (
          <g key={`l${v}`}>
            {!left.noGrid && <line x1={PL} x2={PL + iw} y1={Y(v)} y2={Y(v)} stroke="rgba(255,255,255,0.1)" />}
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
              return <g key={k}>{it.bars.map(([a, b, v, c]) => (v > 0 ? <rect key={a} x={X(a) + 0.8} y={Y(v, ax)} width={Math.max(1.5, X(b) - X(a) - 1.6)} height={Math.max(0, Y(ax.lo, ax) - Y(v, ax))} rx="2" fill={c} opacity={hover != null && !(hover > a && hover <= b) ? 0.55 : 1} /> : null))}</g>;
            }
            if (it.type === 'arrows') {
              /* in their own strip, as many as fit without crowding */
              let last = -Infinity;
              return (
                <g key={k}>{it.pts.map(([t, deg, sp]) => {
                  const x = X(t);
                  if (deg == null || x - last < ARROW_GAP) return null;
                  last = x;
                  const s = 0.8 + Math.min(1, (sp ?? 0) / 40) * 0.45;          // a stronger wind, a bigger arrow
                  return (
                    <g key={t} transform={`translate(${x} ${12 + band / 2 - 2}) rotate(${deg + 180}) scale(${s})`}>
                      <path d="M0 -6 L4 3 L0 1 L-4 3 Z" fill="rgba(255,255,255,0.88)" />
                    </g>
                  );
                })}</g>
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
        {hx != null && (
          <g>
            <line x1={hx} x2={hx} y1={PT} y2={PT + ih} stroke="rgba(255,255,255,0.75)" />
            {/* where each line is at that moment */}
            {items.filter((it) => it.type === 'line' && !it.noDot).map((it, k) => {
              const ax = it.axis === 'right' ? right : left;
              const v = seriesAt(it.pts, hover);
              if (v == null) return null;
              const c = it.gradient ? it.gradient(v) : it.colour;
              return <circle key={k} cx={hx} cy={Y(v, ax)} r="4.2" fill={c} stroke="rgba(8,14,24,0.85)" strokeWidth="2" />;
            })}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="lw-tip" style={{ top: band, ...(hx > width / 2 ? { right: width - hx + 10 } : { left: hx + 10 }) }}>
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
  if (!day || !model.hours.length) return null;
  const x0 = londonMidnight(day.day), x1 = londonMidnight(nextDay(day.day));
  const near = (h) => h.t >= x0 - 3 * 36e5 && h.t <= x1 + 3 * 36e5;
  const hs = model.hours.filter(near);
  const fs = hs.filter((h) => h.full);
  const nowMs = Date.now();
  const T = (c) => (c == null ? null : unit === 'F' ? (c * 9) / 5 + 32 : c);
  const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);
  const rnd = (v, d = 0) => (v == null ? '—' : d ? v.toFixed(d) : Math.round(v));
  /* a field at any moment, off its curve (`list`: the hours it is drawn from) */
  const v = (k, t, list = fs, f = (x) => x) => seriesAt(list.map((h) => [h.t, h[k] == null ? null : f(h[k])]), t);
  /* the hour a moment falls in, for what is not a curve (the weather, rain amounts, direction) */
  const hourAt = (t, list = fs) => (list.length ? list.reduce((best, h) => (Math.abs(h.t - t) < Math.abs(best.t - t) ? h : best), list[0]) : {});
  const range = [Math.max(x0, (hs[0]?.t ?? x0)), Math.min(x1, (hs[hs.length - 1]?.t ?? x1))];
  const tipHead = (t) => {
    const h = hourAt(t, hs);
    return (
      <div className="lw-tip-head">
        <b>{hhmm(t)}</b>
        {h?.cond && <><WxIcon cond={h.cond} day={h.isDay} windy={h.windy} size={18} /><span>{condLabel(h.cond, h.isDay, h.windy)}</span></>}
      </div>
    );
  };

  let plot = null, legend = [], note = null;
  if (metric === 'temp') {
    const left = domain(hs.flatMap((h) => [T(h.t2), T(h.feels), T(h.td)]), { span: 6 });
    left.fmt = (x) => `${Math.round(x)}°`;
    plot = {
      left,
      items: [
        { type: 'line', pts: hs.map((h) => [h.t, T(h.td)]), colour: '#7fe0cf', width: 1.6 },
        { type: 'line', pts: hs.map((h) => [h.t, T(h.feels)]), colour: 'rgba(255,255,255,0.75)', width: 1.8, dash: '4 4' },
        { type: 'line', pts: hs.map((h) => [h.t, T(h.t2)]), gradient: (x) => tempColour(unit === 'F' ? ((x - 32) * 5) / 9 : x), width: 3.2 },
      ],
      tip: (t) => <>{tipHead(t)}<div>Temperature <b>{deg(v('t2', t, hs, T))}</b></div><div>Feels like {deg(v('feels', t, hs, T))}</div><div>Dew point {deg(v('td', t, hs, T))}</div></>,
    };
    legend = [['Temperature', 'linear-gradient(90deg,#4fc8f0,#f2d43c,#ff7a2f)'], ['Feels like', 'rgba(255,255,255,0.75)'], ['Dew point', '#7fe0cf']];
  } else if (metric === 'rain') {
    const bars = fs.filter((h) => h.span > 0).map((h) => [h.t - h.span * 36e5, h.t, (h.precip ?? 0) / h.span, (h.snow ?? 0) > (h.precip ?? 0) / 2 ? '#eef5ff' : '#4cb0ff']);
    const left = domain(bars.map((b) => b[2]), { min: 0, span: 1 });
    left.fmt = (x) => (x ? `${x}` : '0');
    const right = { lo: 0, hi: 100, ticks: [0, 50, 100], fmt: (x) => `${x}%` };
    plot = {
      left, right,
      items: [{ type: 'bars', bars }, { type: 'line', axis: 'right', pts: fs.map((h) => [h.t, h.pRain]), colour: '#9fd8ff', width: 1.6, dash: '3 3' }],
      tip: (t) => {
        const h = fs.find((x) => x.span > 0 && t > x.t - x.span * 36e5 && t <= x.t) || hourAt(t);
        return (
          <>{tipHead(t)}
            <div><b>{(h.precip ?? 0).toFixed(1)} mm</b> {h.span > 1 ? `in the three hours to ${hhmm(h.t)}` : `in the hour to ${hhmm(h.t)}`}{(h.snow ?? 0) > 0.05 ? ` (${h.snow.toFixed(1)} mm as snow)` : ''}</div>
            <div>Chance within 10 km {rnd(v('pRain', t))}%</div>
          </>
        );
      },
    };
    legend = [['Rain per hour (mm)', '#4cb0ff'], ['Snow', '#eef5ff'], ['Chance of rain', '#9fd8ff']];
    note = 'Bars show each hour’s rain as mm per hour; past T+54 UKV gives three-hour totals, spread over the three hours.';
  } else if (metric === 'wind') {
    const left = domain(fs.flatMap((h) => [h.wind, h.gust]), { min: 0, span: 10 });
    left.fmt = (x) => `${x}`;
    plot = {
      left, band: 26,
      items: [
        { type: 'area', pts: fs.map((h) => [h.t, h.wind]), colour: '#8fd3ff', opacity: 0.55 },
        { type: 'line', pts: fs.map((h) => [h.t, h.wind]), colour: '#8fd3ff', width: 2.4 },
        { type: 'line', pts: fs.map((h) => [h.t, h.gust]), colour: '#ffffff', width: 1.8, dash: '5 4' },
        { type: 'arrows', pts: fs.map((h) => [h.t, h.wdir, h.wind]) },
      ],
      tip: (t) => { const h = hourAt(t); return <>{tipHead(t)}<div>Wind <b>{rnd(v('wind', t))} mph</b> from the {compass(h.wdir)}</div><div>Gusts {rnd(v('gust', t))} mph</div></>; },
    };
    legend = [['Wind (mph)', '#8fd3ff'], ['Gusts', '#ffffff'], ['Direction (arrows, top)', 'rgba(255,255,255,0.88)']];
  } else if (metric === 'cloud') {
    const cells = (k) => fs.map((h, i) => [h.t - (i ? (h.t - fs[i - 1].t) / 2 : 18e5), h.t + (i < fs.length - 1 ? (fs[i + 1].t - h.t) / 2 : 18e5), Math.min(1, (h[k] ?? 0) / 100)]);
    /* the rows named down the left, where a value axis would be */
    const left = { lo: 0, hi: 3, ticks: [0.5, 1.5, 2.5], noGrid: true, fmt: (x) => ({ 2.5: 'High', 1.5: 'Mid', 0.5: 'Low' }[x]) };
    plot = {
      left,
      items: [{ type: 'strips', rows: [{ label: 'High', colour: '#dfe8f3', cells: cells('hcc') }, { label: 'Middle', colour: '#c4d1df', cells: cells('mcc') }, { label: 'Low', colour: '#aebccb', cells: cells('lcc') }] }],
      tip: (t) => { const h = hourAt(t); return <>{tipHead(t)}<div>Total <b>{rnd(v('tcc', t))}%</b></div><div>High {rnd(v('hcc', t))}% · middle {rnd(v('mcc', t))}% · low {rnd(v('lcc', t))}%</div>{h.cloudBase != null && <div>Cloud base {Math.round(h.cloudBase / 10) * 10} m</div>}</>; },
    };
    legend = [['High cloud', '#dfe8f3'], ['Middle', '#c4d1df'], ['Low', '#aebccb']];
    note = 'Each row is a layer of the sky; the brighter the block, the more of that layer is covered.';
  } else if (metric === 'humidity') {
    const left = { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100], fmt: (x) => `${x}%` };
    plot = {
      left,
      items: [{ type: 'area', pts: fs.map((h) => [h.t, h.rh]), colour: '#7cc4ff', opacity: 0.4 }, { type: 'line', pts: fs.map((h) => [h.t, h.rh]), colour: '#7cc4ff', width: 2.6 }],
      tip: (t) => <>{tipHead(t)}<div>Humidity <b>{rnd(v('rh', t))}%</b></div><div>Dew point {deg(v('td', t, fs, T))}</div></>,
    };
    legend = [['Relative humidity', '#7cc4ff']];
  } else if (metric === 'pressure') {
    const left = domain(fs.map((h) => h.mslp), { span: 6 });
    left.fmt = (x) => `${Math.round(x)}`;
    plot = {
      left,
      items: [{ type: 'line', pts: fs.map((h) => [h.t, h.mslp]), colour: '#c9b8ff', width: 2.8 }],
      tip: (t) => <>{tipHead(t)}<div>Pressure <b>{rnd(v('mslp', t))} hPa</b></div></>,
    };
    legend = [['Mean sea-level pressure (hPa)', '#c9b8ff']];
  } else if (metric === 'vis') {
    const left = { lo: 0, hi: 40, ticks: [0, 10, 20, 30, 40], fmt: (x) => `${x}` };
    plot = {
      left,
      items: [{ type: 'area', pts: fs.map((h) => [h.t, Math.min(40, h.vis ?? 0)]), colour: '#d5dde6', opacity: 0.35 }, { type: 'line', pts: fs.map((h) => [h.t, Math.min(40, h.vis ?? 0)]), colour: '#e8eef4', width: 2.4 }],
      tip: (t) => { const vis = v('vis', t), fog = v('fog', t); return <>{tipHead(t)}<div>Visibility <b>{vis == null ? '—' : vis >= 10 ? Math.round(vis) : vis.toFixed(1)} km</b> · {visWord(vis)}</div>{(fog ?? 0) >= 10 && <div>Fog chance {Math.round(fog)}%</div>}</>; },
    };
    legend = [['Visibility (km, top 40)', '#e8eef4']];
  } else if (metric === 'sun') {
    const left = domain(fs.map((h) => h.sw), { min: 0, span: 100 });
    left.fmt = (x) => `${x}`;
    const right = { lo: 0, hi: 8, ticks: [0, 2, 4, 6, 8], fmt: (x) => `${x}` };
    plot = {
      left, right,
      items: [{ type: 'area', pts: fs.map((h) => [h.t, h.sw]), colour: '#ffd36b', opacity: 0.55 }, { type: 'line', pts: fs.map((h) => [h.t, h.sw]), colour: '#ffd36b', width: 2 }, { type: 'line', axis: 'right', pts: fs.map((h) => [h.t, h.uvi]), colour: '#ff9f5a', width: 2.2, dash: '4 3' }],
      tip: (t) => { const uv = v('uvi', t); return <>{tipHead(t)}<div>Sunshine power <b>{rnd(Math.max(0, v('sw', t) ?? 0))} W/m²</b></div><div>UV index {rnd(uv == null ? null : Math.max(0, uv))} · {uvWord(uv)}</div></>; },
    };
    legend = [['Solar radiation (W/m²)', '#ffd36b'], ['UV index (right)', '#ff9f5a']];
  } else if (metric === 'thunder') {
    const bars = fs.filter((h, i) => i > 0).map((h, i) => [fs[i].t, h.t, h.cape ?? 0, '#ffb547']);
    const left = domain(bars.map((b) => b[2]), { min: 0, span: 200 });
    left.fmt = (x) => `${x}`;
    /* the thunderstorm risk is TCM NOVA's, every hour (the UKV's lightning chance where NOVA has none) */
    const nova = (model.nova?.hours || []).filter(near).map((x) => [x.t, x.p]);
    const pts = nova.length ? nova : fs.map((h) => [h.t, h.pThunder]);
    const hi = Math.max(20, ...pts.map((p) => (p[1] ?? 0) * 1.2));
    const right = { lo: 0, hi, ticks: [0, Math.round(hi / 2), Math.round(hi)], fmt: (x) => `${x}%` };
    plot = {
      left, right,
      items: [{ type: 'bars', bars }, { type: 'line', axis: 'right', pts, colour: '#ffe066', width: 2.2 }],
      tip: (t) => {
        const p = seriesAt(pts, t);
        return <>{tipHead(t)}<div>CAPE <b>{rnd(v('cape', t))} J/kg</b></div>
          <div>{p == null ? 'Thunderstorm risk: not forecast this far ahead' : nova.length ? `Thunderstorm risk ${Math.round(Math.max(0, p))}% (TCM NOVA)` : `Lightning within 16 km ${Math.round(Math.max(0, p))}%`}</div></>;
      },
    };
    legend = [['CAPE (storm fuel, J/kg)', '#ffb547'], [nova.length ? 'Thunderstorm risk, TCM NOVA (right)' : 'Chance of lightning (right)', '#ffe066']];
    note = nova.length ? 'Thunderstorm risk from MyWeatherUK’s TCM NOVA model, to the end of its Main Run (4 days); storm fuel from the UKV.'
      : 'UKV forecasts lightning to T+54; beyond that only the storm fuel (CAPE) is shown.';
  } else if (metric === 'snow') {
    const left = domain(fs.map((h) => h.frz), { min: 0, span: 500 });
    left.fmt = (x) => `${x}`;
    const right = domain(hs.flatMap((h) => [T(h.ground), T(h.t2)]), { span: 6 });
    right.fmt = (x) => `${Math.round(x)}°`;
    plot = {
      left, right,
      items: [
        { type: 'area', pts: fs.map((h) => [h.t, h.frz]), colour: '#9fd8ff', opacity: 0.35 },
        { type: 'line', pts: fs.map((h) => [h.t, h.frz]), colour: '#9fd8ff', width: 2.4 },
        { type: 'line', axis: 'right', pts: fs.map((h) => [h.t, T(h.ground)]), colour: '#f0f6ff', width: 1.8, dash: '4 3' },
      ],
      tip: (t) => { const h = hourAt(t), frz = v('frz', t); return <>{tipHead(t)}<div>Freezing level <b>{frz == null ? '—' : Math.round(Math.max(0, frz) / 10) * 10} m</b></div><div>Ground {deg(v('ground', t, fs, T))}</div>{(h.snowLying ?? 0) > 0.5 && <div>Lying snow {Math.round(h.snowLying)} mm water</div>}</>; },
    };
    legend = [['Freezing level (m)', '#9fd8ff'], ['Ground temperature (right)', '#f0f6ff']];
  }

  return (
    <div className="lw-glass lw-card">
      <div className="lw-title"><ChartSpline />Detailed forecast<span className="lw-title-aside">{longDay(day.day)}</span></div>
      <div className="lw-chips is-wrap" role="group" aria-label="Day" style={{ marginBottom: 8 }}>
        {model.days.map((d, i) => <button key={d.day} type="button" className="lw-chip" aria-pressed={i === dayIdx} onClick={() => onDay(i)}>{d.label}</button>)}
      </div>
      <div className="lw-chips is-wrap" role="group" aria-label="Measure" style={{ marginBottom: 10 }}>
        {METRICS.map(([k, l]) => <button key={k} type="button" className="lw-chip" aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}
      </div>
      <div ref={wrap}>
        {plot && <Plot key={`${metric}${day.day}`} width={width} x0={x0} x1={x1} nowMs={nowMs} range={range} {...plot} />}
      </div>
      <div className="lw-legend">{legend.map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>
      {note && <div className="lw-mini" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
}
