/* Model Data's timeline, as the STRATA graphics show time (UiDays: a story-style progress bar of the
   days). The run's span is cut into days (hours for the live last few hours, months for a long
   observed record), each with its name over a slim bar; what is behind the time on show is filled,
   the day it is in with the accent. A tick marks every step (faint while it is still loading), the
   playhead sits on the step on show, and a press or drag anywhere picks the nearest step, with the
   time it lands on above the finger. */
import React, { useMemo, useRef, useState } from 'react';

const LONDON = 'Europe/London';
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: LONDON });
const hourKey = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: LONDON, day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const monthKey = (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: LONDON, year: 'numeric', month: '2-digit' });

/* the pieces of [t0, t1]: where each London day (hour, month) starts and ends, and its label */
function segments(t0, t1, unit) {
  const out = [];
  const key = unit === 'hour' ? hourKey : unit === 'month' ? monthKey : dayKey;
  const label = unit === 'hour'
    ? (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: LONDON, hour: '2-digit', minute: '2-digit' })
    : unit === 'month'
      ? (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: LONDON, month: 'short' })
      : (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: LONDON, weekday: 'short', day: 'numeric' });
  const stepMs = unit === 'hour' ? 15 * 60e3 : unit === 'month' ? 6 * 3600e3 : 15 * 60e3;
  let a = t0, k = key(t0);
  for (let t = t0 + stepMs; t <= t1 + stepMs; t += stepMs) {
    const tt = Math.min(t, t1);
    const kk = key(tt);
    if (kk !== k || t >= t1) {
      const b = t >= t1 && kk === k ? t1 : tt;
      out.push({ a, b, label: label(a + 1), key: k });
      a = b; k = kk;
      if (t >= t1) break;
    }
  }
  return out.filter((s) => s.b > s.a);
}

/**
 * times:  each step's time (ms), in order;  idx: the step on show;  onPick(i);  loaded(i) -> bool
 * label:  ms -> words for the tip
 */
export default function Timeline({ times, idx, onPick, loaded, label }) {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const [drag, setDrag] = useState(false);
  const t0 = times[0], t1 = times[times.length - 1], span = Math.max(1, (t1 ?? 0) - (t0 ?? 0));
  const unit = span <= 30 * 3600e3 ? 'hour' : span <= 21 * 864e5 ? 'day' : 'month';
  const segs = useMemo(() => (times.length > 1 ? segments(t0, t1, unit) : []), [t0, t1, unit, times.length]);
  if (times.length < 2) return <div className="mdt" />;
  const pos = (t) => ((t - t0) / span) * 100;
  const now = times[Math.min(idx, times.length - 1)];
  const nearest = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const t = t0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    return { i: best, x: ((times[best] - t0) / span) * r.width };
  };
  const down = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(true); const n = nearest(e.clientX); onPick(n.i); setTip(n); };
  const move = (e) => {
    const n = nearest(e.clientX);
    if (drag) onPick(n.i);
    setTip(n);
  };
  const up = () => { setDrag(false); };
  /* with little room a label is left out rather than squeezed */
  const width = ref.current?.clientWidth || 600;
  const gap = 4;
  return (
    <div ref={ref} className={`mdt${drag ? ' is-drag' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={() => { if (!drag) setTip(null); }} role="slider" aria-label="Time" aria-valuemin={0} aria-valuemax={times.length - 1} aria-valuenow={idx}
      aria-valuetext={label(now)} tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onPick(Math.max(0, idx - 1)); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onPick(Math.min(times.length - 1, idx + 1)); }
        if (e.key === 'Home') { e.preventDefault(); onPick(0); }
        if (e.key === 'End') { e.preventDefault(); onPick(times.length - 1); }
      }}>
      {segs.map((s, k) => {
        const left = pos(s.a), w = pos(s.b) - left, on = now >= s.a && (now < s.b || (k === segs.length - 1 && now <= s.b));
        const fill = now >= s.b ? 100 : now <= s.a ? 0 : ((now - s.a) / (s.b - s.a)) * 100;
        const px = (w / 100) * width;
        return (
          <div key={s.key} className="mdt-seg" style={{ left: `${left}%`, width: `calc(${w}% - ${k < segs.length - 1 ? gap : 0}px)` }}>
            {px >= (unit === 'hour' ? 40 : 46) && <span className={`mdt-lab${on ? ' is-on' : ''}`}>{s.label}</span>}
            <div className="mdt-track"><div className={`mdt-fill${on ? ' is-on' : ''}`} style={{ width: `${fill}%` }} /></div>
          </div>
        );
      })}
      {times.length <= 240 && times.map((t, i) => <i key={t} className={`mdt-tick${loaded(i) ? '' : ' is-wait'}`} style={{ left: `calc(${pos(t)}% - 1px)` }} />)}
      <span className="mdt-head" style={{ left: `${pos(now)}%` }} />
      {tip && <span className="mdt-tip" style={{ left: tip.x }}>{label(times[tip.i])}</span>}
    </div>
  );
}
