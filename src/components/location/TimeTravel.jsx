/* Time travel (Location Weather, 16 Nov 2026, Phase F): a ruler of the hours under the hero. Sliding it
   turns the page to that hour (the sky and what falls from it, the frost and snow on the cards, the hero
   and the tiles), and "Back to now" turns it back.

   The ruler is a strip of hours scrolled under a fixed marker, like the hourly strip, so a finger moves
   it with the momentum of any scroll and every day is the same width. It stops on the forecast's own
   hours (hourly to T+54, then three-hourly, then the outlook's steps: src/lib/location/travel.js). A
   mouse drags it, the arrow keys step it an hour at a time, and a click on the ruler goes to that time. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clock3, RotateCcw } from 'lucide-react';
import { useUnits } from '@/components/useUnits';
import { hourOf, condLabel } from '@/lib/ukvLocation';
import { travelSteps, travelLabel, travelLabelLong } from '@/lib/location/travel';

const PX = 11;                                   // one hour of the ruler
const dayName = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' });

export default function TimeTravel({ model, value, onChange, onSettle }) {
  const U = useUnits();
  const steps = useMemo(() => travelSteps(model), [model]);
  /* the ruler starts at the minute the page was drawn for, its origin "now" */
  const start = useMemo(() => Date.now(), [model]);
  const x = useCallback((t) => ((t - start) / 36e5) * PX, [start]);
  const total = steps.length ? x(steps[steps.length - 1].t) : 0;

  const ref = useRef(null);
  const [W, setW] = useState(0);
  const has = steps.length > 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [has]);

  /* the step under the marker for a scroll position: now, or the nearest of the forecast's hours */
  const stepAt = useCallback((left) => {
    if (!steps.length || left <= x(steps[0].t) / 2) return null;
    let best = steps[0];
    for (const s of steps) if (Math.abs(x(s.t) - left) < Math.abs(x(best.t) - left)) best = s;
    return best.t;
  }, [steps, x]);

  /* scrolling we do ourselves (back to now, the keys, a click) is not read back until it has arrived */
  const going = useRef(null);
  const last = useRef(value ?? null);
  const goTo = useCallback((t, smooth = true) => {
    const el = ref.current;
    if (!el) return;
    const left = t == null ? 0 : x(t);
    const g = { left, until: Date.now() + 900 };
    going.current = g;
    el.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    /* a smooth scroll the browser never finished (a page in the background) is finished at once */
    setTimeout(() => { if (going.current === g && Math.abs(el.scrollLeft - left) > 2) el.scrollTo({ left, behavior: 'auto' }); }, 940);
  }, [x]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const g = going.current;
    if (g) {
      if (Math.abs(el.scrollLeft - g.left) > 1.5 && Date.now() < g.until) return;
      going.current = null;
    }
    const t = stepAt(el.scrollLeft);
    if (t !== last.current) { last.current = t; onChange(t); }
  };

  /* a value set from outside (back to now, story mode) moves the ruler */
  useEffect(() => {
    const el = ref.current;
    if (!el || !W) return;
    if (stepAt(el.scrollLeft) === (value ?? null)) return;
    last.current = value ?? null;
    goTo(value ?? null, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, W]);

  /* settled: the hourly strip follows (debounced, once the finger or the momentum has stopped) */
  const settleTimer = useRef(0);
  useEffect(() => {
    clearTimeout(settleTimer.current);
    if (value == null) return undefined;
    settleTimer.current = setTimeout(() => onSettle?.(value), 450);
    return () => clearTimeout(settleTimer.current);
  }, [value, onSettle]);

  /* a mouse drags the ruler (a finger scrolls it natively); a click without a drag goes to that time */
  const drag = useRef(null);
  const down = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = ref.current;
    drag.current = { x0: e.clientX, left0: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 3) d.moved = true;
    ref.current.scrollLeft = d.left0 - dx;
  };
  const up = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const el = ref.current;
    el.classList.remove('is-dragging');
    if (!d.moved) {
      const r = el.getBoundingClientRect();
      const left = el.scrollLeft + (e.clientX - r.left) - W / 2;
      const t = stepAt(Math.max(0, left));
      last.current = t; onChange(t); goTo(t);
    } else {
      /* let the snap settle on the nearest hour */
      const t = stepAt(el.scrollLeft);
      last.current = t; onChange(t); goTo(t);
    }
  };

  const key = (e) => {
    const i = value == null ? -1 : steps.findIndex((s) => s.t === value);
    let j = null;
    if (e.key === 'ArrowRight') j = Math.min(steps.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') j = i - 1;
    else if (e.key === 'PageDown') j = Math.min(steps.length - 1, i + 6);
    else if (e.key === 'PageUp') j = Math.max(-1, i - 6);
    else if (e.key === 'Home') j = -1;
    else if (e.key === 'End') j = steps.length - 1;
    else return;
    e.preventDefault();
    const t = j < 0 ? null : steps[j].t;
    last.current = t; onChange(t); goTo(t);
  };

  /* the ruler's marks: every hour, longer every three, the hour every six and the day at midnight */
  const marks = useMemo(() => {
    if (!steps.length) return [];
    const out = [];
    const end = steps[steps.length - 1].t;
    for (let t = Math.ceil(start / 36e5) * 36e5; t <= end; t += 36e5) {
      const h = hourOf(t);
      /* no label so close to the start that it would sit on "Now" */
      const room = x(t) > 30;
      out.push({ t, h, mid: h === 0, label: !room ? null : h === 0 ? dayName(t) : h % 6 === 0 ? String(h).padStart(2, '0') : null, major: h % 3 === 0 });
    }
    return out;
  }, [steps, start, x]);

  if (!steps.length) return null;
  const away = value != null;
  const half = W / 2;
  /* away from now: that hour's weather beside its time, so the bar says it while it stays in view */
  const at = away ? steps.find((s) => s.t === value) : null;
  const hint = at ? `${Math.round(U.temp(at.t2))}° · ${condLabel(at.cond, at.isDay, at.windy)}` : 'Slide to see any hour';
  return (
    <div className={`lw-glass lw-travel${away ? ' is-away' : ''}`}>
      <div className="lw-travel-head">
        <Clock3 size={15} aria-hidden="true" />
        <b className="lw-travel-when">{away ? travelLabel(value) : 'Now'}</b>
        <span className="lw-travel-hint">{hint}</span>
        {away && (
          <button type="button" className="lw-travel-back" onClick={() => { last.current = null; onChange(null); goTo(null); }}>
            <RotateCcw size={13} />Back to now
          </button>
        )}
      </div>
      <div className="lw-travel-ruler">
        <div
          ref={ref} className="lw-travel-scroll" onScroll={onScroll}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
          tabIndex={0} role="slider" aria-label="See the weather at another hour"
          aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={away ? steps.findIndex((s) => s.t === value) + 1 : 0}
          aria-valuetext={away ? travelLabelLong(value) : 'Now'}
        >
          <div className="lw-travel-track" style={{ width: `${total + W}px` }}>
            <i className="lw-travel-snap" style={{ left: `${half}px` }} />
            {steps.map((s) => <i key={s.t} className="lw-travel-snap" style={{ left: `${half + x(s.t)}px` }} />)}
            {marks.map((m) => (
              <span key={m.t} className={`lw-travel-mark${m.major ? ' is-major' : ''}${m.mid ? ' is-mid' : ''}`} style={{ left: `${half + x(m.t)}px` }}>
                {m.label && <em>{m.label}</em>}
              </span>
            ))}
            <span className="lw-travel-now" style={{ left: `${half}px` }}>Now</span>
          </div>
        </div>
        <span className="lw-travel-marker" aria-hidden="true" />
      </div>
    </div>
  );
}
