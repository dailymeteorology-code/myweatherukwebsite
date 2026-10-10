/* ════════════════════════════════════════════════════════════════════════════
   HOURLY FORECAST — HORIZONTAL
   ────────────────────────────────────────────────────────────────────────────
   One column per step, reading top to bottom:

       time                ─ straight row
       weather symbol      ┐
       temperature         ├─ these ride the temperature curve
       the curve itself    ┘
       wind direction      ┐
       wind speed          ├─ straight rows
       gust                ┘

   The symbol and the temperature follow the line so the shape of the day is
   legible at a glance. The wind rows deliberately do NOT: an arrow that also
   moved up and down would read as the wind rising and falling, which is not
   what it means.

   HEADROOM IS RESERVED, NOT HOPED FOR. The curve is mapped into a band that
   stops short of the top by exactly the height of the label and symbol stacked
   above it, and the smoothing control points are clamped to that same band, so
   neither the points nor the curve between them can climb into the labels.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Wind as WindIcon, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';

const COL_W = 74;
const CHART_H = 168;
const HEAD_ROOM = 62;
const FOOT_ROOM = 16;
const SYMBOL_DY = -58;
const TEMP_DY = -26;

const PAST = '#94a3b8';
const FUTURE = '#7dd3fc';
const GUST = '#fbbf24';

/* Scroll affordances. Both are shown only on the side that actually has more
   to see, so an all-visible strip carries no furniture at all. */
const edgeFade = (side) => ({
  position: 'absolute', top: 0, bottom: 0, [side]: 0, width: 46, zIndex: 2,
  pointerEvents: 'none',
  background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, rgba(9,14,28,0.92), rgba(9,14,28,0))`,
});
const arrowBtn = (side) => ({
  position: 'absolute', top: '38%', [side]: 2, zIndex: 3,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
  background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(148,163,184,0.3)',
  color: 'rgba(226,232,240,0.9)', backdropFilter: 'blur(4px)',
});

/* Precipitation gets its own colour so a snow risk does not read as a rain
   risk at a glance. */
const KIND_COLOUR = {
  Rain: '#60a5fa', Sleet: '#a5b4fc', Snow: '#e2e8f0',
  Hail: '#67e8f9', Thunderstorm: '#fbbf24',
};

export function curvePoints(hours, opts = {}) {
  const { colW = COL_W, chartH = CHART_H, headRoom = HEAD_ROOM, footRoom = FOOT_ROOM } = opts;
  const temps = hours.map(h => h.temp).filter(t => t != null);
  if (!temps.length) return [];
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  // A flat day would divide by zero and stack every point on one line; a
  // nominal range puts the curve mid-band instead.
  const span = max - min || 1;
  const usable = chartH - headRoom - footRoom;
  return hours.map((h, i) => ({
    x: i * colW + colW / 2,
    y: h.temp == null ? null : headRoom + usable - ((h.temp - min) / span) * usable,
  }));
}

/**
 * Catmull-Rom segments through the points, as cubic Béziers.
 *
 * The control points are CLAMPED to the same band as the points. A cubic Bézier
 * is contained by the convex hull of its four control points, so clamping the
 * two handles guarantees the smoothed curve cannot bulge up into the headroom
 * the temperature label and symbol occupy — which an unclamped Catmull-Rom will
 * happily do wherever the temperature turns sharply.
 */
export function buildSegments(points, { minY = HEAD_ROOM, maxY = CHART_H - FOOT_ROOM } = {}) {
  const p = points.filter(q => q && q.y != null);
  const clamp = (v) => Math.min(maxY, Math.max(minY, v));
  const segs = [];
  for (let i = 0; i < p.length - 1; i += 1) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p[i + 1];
    segs.push({
      from: p1,
      to: p2,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: clamp(p1.y + (p2.y - p0.y) / 6) },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: clamp(p2.y - (p3.y - p1.y) / 6) },
    });
  }
  return segs;
}

/** SVG path for segments [start, end). */
export function pathFrom(segs, start = 0, end = segs.length) {
  if (!segs.length || end <= start) return '';
  let d = `M ${segs[start].from.x},${segs[start].from.y}`;
  for (let i = start; i < end; i += 1) {
    const s = segs[i];
    d += ` C ${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${s.to.x},${s.to.y}`;
  }
  return d;
}

/** The same run of segments closed down to a baseline, for the shaded fill. */
export function areaFrom(segs, start, end, baseY) {
  const d = pathFrom(segs, start, end);
  if (!d) return '';
  return `${d} L ${segs[end - 1].to.x},${baseY} L ${segs[start].from.x},${baseY} Z`;
}

/** Has this step finished? The step a reader is currently in is not past. */
export function firstFutureIndex(hours, now = Date.now(), stepHours = 1) {
  const ms = stepHours * 3600000;
  const idx = hours.findIndex(h => !h.time || new Date(h.time).getTime() + ms > now);
  return idx === -1 ? hours.length : idx;
}

/** Arrow showing which way the wind is blowing, labelled with where it is from. */
function WindArrow({ deg, from, size = 17, colour = FUTURE }) {
  if (deg == null) return <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>—</span>;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      role="img" aria-label={from ? `Wind from ${from}` : 'Wind direction'}
      /* The value is the direction the wind comes FROM, so the arrow is turned
         a further 180° to point the way the air is actually travelling. */
      style={{ transform: `rotate(${deg + 180}deg)`, display: 'block' }}
    >
      <path d="M12 3 L17.5 20 L12 16.2 L6.5 20 Z" fill={colour} />
    </svg>
  );
}

/** Two drops plus the chance, tucked under the symbol's bottom-right. */
/**
 * Precipitation chance for one hour, as a row cell.
 *
 * This used to be a badge pinned to the bottom-right of the weather symbol,
 * inside the symbol's own box — which meant that on any hour with a chance
 * worth showing it sat directly on top of the icon and hid a third of it. The
 * symbol is the thing being read at a glance; the number is a qualifier on it,
 * and a qualifier should not obscure what it qualifies. It has its own row
 * under the curve now, in the same column, so the two are still obviously
 * paired and neither covers the other.
 */
function PrecipCell({ chance, kind, past }) {
  const colour = KIND_COLOUR[kind] || KIND_COLOUR.Rain;
  const shown = chance != null && chance >= 5;
  return (
    <div
      title={shown ? `${chance}% chance of ${(kind || 'precipitation').toLowerCase()}` : 'No precipitation expected'}
      style={{
        width: COL_W, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
        opacity: past ? 0.4 : 1,
      }}>
      {shown ? (
        <>
          <svg width="9" height="11" viewBox="0 0 18 22" aria-hidden="true">
            <path d="M5 1 C5 1 1 6.5 1 9.5 A4 4 0 0 0 9 9.5 C9 6.5 5 1 5 1 Z" fill={colour} />
            <path d="M13 6 C13 6 10 10 10 12.4 A3 3 0 0 0 16 12.4 C16 10 13 6 13 6 Z" fill={colour} opacity="0.8" />
          </svg>
          <span style={{ fontSize: '0.66rem', fontWeight: 800, color: colour }}>{chance}%</span>
        </>
      ) : (
        <span style={{ fontSize: '0.66rem', color: 'rgba(148,163,184,0.30)' }}>—</span>
      )}
    </div>
  );
}

/** Which column a pointer at `clientX` is over. */
export function columnAt(clientX, rectLeft, colW = COL_W, count = 0) {
  const i = Math.floor((clientX - rectLeft) / colW);
  return Math.max(0, Math.min(count - 1, i));
}

/** Speed and gust as two lines, revealed on demand, readable by pointer. */
function WindGraph({ hours, width, cut, formatTime }) {
  const H = 78;
  const hostRef = useRef(null);
  const [hover, setHover] = useState(null);

  const values = hours.flatMap(h => [h.windSpeed, h.windGust]).filter(v => v != null);
  if (!values.length) return null;
  const max = Math.max(...values, 10);
  const y = (v) => (v == null ? null : H - 10 - (v / max) * (H - 22));
  const line = (key) => hours
    .map((h, i) => ({ x: i * COL_W + COL_W / 2, y: y(h[key]) }))
    .filter(p => p.y != null);
  const toPath = (pts) => (pts.length ? pathFrom(buildSegments(pts, { minY: 0, maxY: H }), 0) : '');

  const speed = line('windSpeed');
  const gust = line('windGust');

  /* One handler for mouse and finger. Pointer events cover both, so dragging a
     finger along the graph reads it exactly the way hovering does — no separate
     touch path to keep in step. touchAction is disabled on the graph alone so
     the swipe reads values instead of scrolling the strip underneath it. */
  const track = (e) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover(columnAt(e.clientX, rect.left, COL_W, hours.length));
  };

  const active = hover != null ? hours[hover] : null;
  const activeX = hover != null ? hover * COL_W + COL_W / 2 : 0;

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div
        ref={hostRef}
        onPointerDown={track}
        onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) track(e); }}
        onPointerUp={() => setHover(null)}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
        style={{ position: 'relative', width, touchAction: 'none', cursor: 'crosshair' }}
      >
        <svg width={width} height={H} style={{ display: 'block', overflow: 'visible' }}>
          {hover != null && (
            <line x1={activeX} y1={0} x2={activeX} y2={H} stroke="rgba(255,255,255,0.35)"
                  strokeWidth="1" strokeDasharray="3 3" />
          )}
          <path d={toPath(gust)} fill="none" stroke={GUST} strokeWidth="2" strokeDasharray="4 3"
                strokeLinecap="round" strokeLinejoin="round" />
          <path d={toPath(speed)} fill="none" stroke={FUTURE} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
          {speed.map((p, i) => (
            <circle key={`s${i}`} cx={p.x} cy={p.y} r={i === hover ? 4.6 : 2.6} fill="#0b1220"
                    stroke={i < cut ? PAST : FUTURE} strokeWidth={i === hover ? 2.4 : 1.6} />
          ))}
          {gust.map((p, i) => (
            <circle key={`g${i}`} cx={p.x} cy={p.y} r={i === hover ? 4.2 : 2.2} fill="#0b1220"
                    stroke={i < cut ? PAST : GUST} strokeWidth={i === hover ? 2.2 : 1.4} />
          ))}
        </svg>

        {active && (
          <div style={{
            position: 'absolute', top: -6,
            // Flip to the other side near the right edge so the readout is
            // never clipped off the end of the strip.
            left: activeX + (hover > hours.length - 3 ? -104 : 10),
            pointerEvents: 'none', zIndex: 5,
            background: 'rgba(2,6,23,0.94)', border: '1px solid rgba(148,163,184,0.35)',
            borderRadius: 9, padding: '5px 9px', minWidth: 92,
          }}>
            <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>
              {active.time && formatTime ? formatTime(active.time) : ''}
            </div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: FUTURE }}>
              {active.windSpeed ?? '—'} mph
            </div>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: GUST }}>
              gust {active.windGust ?? '—'} mph
            </div>
            {active.windDirection && (
              <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>
                from {active.windDirection}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: '0.64rem' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.75)' }}>
          <span style={{ width: 14, height: 0, borderTop: `2px solid ${FUTURE}` }} /> Wind speed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.75)' }}>
          <span style={{ width: 14, height: 0, borderTop: `2px dashed ${GUST}` }} /> Gusts
        </span>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.4)' }}>
          peak {max} mph · drag to read
        </span>
      </div>
    </div>
  );
}

/* ── Warning band ──────────────────────────────────────────────────────────
   A continuous bar in the warning's own severity colour, sitting under the
   timestamps and running from the warning's start to its end.

   It is positioned on TIME, not on columns: the strip's columns each cover
   `stepHours`, so the bar spans from the first step's start to the last step's
   end and a warning beginning at 15:00 starts halfway across a three-hourly
   column rather than snapping to its edge. A warning that began yesterday or
   runs into tomorrow is clipped to the day on show, so the bar is only ever as
   long as the visible timeline. */
function WarningBands({ warnings, hours, width, stepHours }) {
  const bars = useMemo(() => {
    if (!warnings?.length || !hours.length) return [];
    const t0 = new Date(hours[0].time).getTime();
    const tEnd = new Date(hours[hours.length - 1].time).getTime() + stepHours * 3600000;
    const span = tEnd - t0;
    if (!Number.isFinite(span) || span <= 0) return [];
    return warnings
      .map((w) => {
        if (!w.startMs || !w.endMs) return null;
        const from = Math.max(t0, w.startMs);
        const to = Math.min(tEnd, w.endMs);
        if (to <= from) return null;
        return {
          key: w.id,
          colour: w.colour,
          left: ((from - t0) / span) * width,
          w: Math.max(4, ((to - from) / span) * width),
          label: `${w.severity} warning of ${String(w.type).toLowerCase()}`,
          openEnd: w.endMs > tEnd,
          openStart: w.startMs < t0,
        };
      })
      .filter(Boolean);
  }, [warnings, hours, width, stepHours]);

  if (!bars.length) return null;

  return (
    <div style={{ width, marginBottom: 8 }}>
      {bars.map(b => (
        <div key={b.key} style={{ position: 'relative', height: 7, marginBottom: 3 }}>
          <div
            title={b.label}
            style={{
              position: 'absolute', left: b.left, width: b.w, top: 0, height: 7,
              background: b.colour,
              boxShadow: `0 0 8px ${b.colour}99`,
              borderTopLeftRadius: b.openStart ? 0 : 99,
              borderBottomLeftRadius: b.openStart ? 0 : 99,
              borderTopRightRadius: b.openEnd ? 0 : 99,
              borderBottomRightRadius: b.openEnd ? 0 : 99,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * @param icon  The page's WeatherIcon component, passed in rather than imported
 *              so this file stays free of the icon-key lookup and the dev-time
 *              contract check that guards it.
 */
export default function HourlyStrip({
  hours = [], unit = 'C', formatTime, icon: WeatherIcon, now, stepHours = 1, warnings = [],
}) {
  const [showWind, setShowWind] = useState(false);
  const points = useMemo(() => curvePoints(hours), [hours]);
  const segs = useMemo(() => buildSegments(points), [points]);
  const cut = useMemo(
    () => firstFutureIndex(hours, now ?? Date.now(), stepHours),
    [hours, now, stepHours],
  );

  /* ── Where the strip is looking ────────────────────────────────────────────
     It used to open at midnight and stay there, so arriving at a location in
     the afternoon meant a screen of hours that had already been and gone, with
     nothing to say the rest of the day was off to the right. It opens on the
     current hour instead, with a column and a half of the past still showing so
     it is obvious you can go back. */
  const scrollRef = useRef(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const [nowOffScreen, setNowOffScreen] = useState(false);
  const hasPast = cut > 0 && cut < hours.length;

  const syncScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft >= max - 4 });
    if (!hasPast) { setNowOffScreen(false); return; }
    const x = cut * COL_W;
    setNowOffScreen(x + COL_W < el.scrollLeft || x > el.scrollLeft + el.clientWidth);
  }, [cut, hasPast]);

  const scrollToNow = useCallback((behavior) => {
    const el = scrollRef.current;
    if (!el || !hasPast) return;
    el.scrollTo({ left: Math.max(0, cut * COL_W - COL_W * 1.5), behavior });
  }, [cut, hasPast]);

  /* Jump on arrival, without an animation — a strip that visibly slides on load
     reads as something going wrong rather than as a considered starting point. */
  useEffect(() => {
    scrollToNow('auto');
    /* Measure immediately — an instant scroll settles synchronously, so the
       edges are already correct. The timeout is a backstop for the case where
       layout has not finished and clientWidth still reads zero; it is NOT a
       requestAnimationFrame, because a tab that is not being painted never
       calls one and the arrows would then point the wrong way for as long as
       the page stayed in the background. */
    syncScroll();
    const id = setTimeout(syncScroll, 0);
    return () => clearTimeout(id);
  }, [scrollToNow, syncScroll, hours.length]);

  const nudge = (dir) => scrollRef.current?.scrollBy({ left: dir * COL_W * 3, behavior: 'smooth' });

  if (!hours.length) return null;

  const width = hours.length * COL_W;
  const baseY = CHART_H;
  /* Segment i joins point i to point i+1, so segments before `cut` are wholly
     in the past. The two runs share the boundary point, which keeps the colour
     change on the current step with no gap in the line. */
  const pastEnd = Math.max(0, Math.min(cut, segs.length));
  const show = (v) => (v == null ? '—' : `${v}`);
  const toF = c => Math.round(c * 9 / 5 + 32);
  const asTemp = c => (c == null ? '—' : `${unit === 'C' ? Math.round(c) : toF(c)}°`);

  return (
    <div>
      {stepHours > 1 && (
        <p style={{ margin: '0 0 8px', fontSize: '0.68rem', color: 'rgba(255,255,255,0.45)' }}>
          Three-hourly — the Met Office publishes hour-by-hour detail about two days ahead.
        </p>
      )}

      <div style={{ position: 'relative' }}>
        {/* Fades at the edges, so it reads as a strip that continues rather
            than one that ends where the panel does. They ignore the pointer. */}
        {!edge.start && <div aria-hidden="true" style={edgeFade('left')} />}
        {!edge.end && <div aria-hidden="true" style={edgeFade('right')} />}

        {!edge.start && (
          <button type="button" onClick={() => nudge(-1)} aria-label="Earlier hours" style={arrowBtn('left')}>
            <ChevronLeft style={{ width: 15, height: 15 }} />
          </button>
        )}
        {!edge.end && (
          <button type="button" onClick={() => nudge(1)} aria-label="Later hours" style={arrowBtn('right')}>
            <ChevronRight style={{ width: 15, height: 15 }} />
          </button>
        )}

      <div ref={scrollRef} onScroll={syncScroll}
           style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4, scrollBehavior: 'auto' }}>
        <div style={{ width, minWidth: '100%' }}>

          {/* ── Time, straight across the top ─────────────────────────── */}
          <div style={{ display: 'flex', width, marginBottom: 6 }}>
            {hours.map((h, i) => (
              <div key={h.time || i} style={{
                width: COL_W, textAlign: 'center', fontSize: '0.7rem',
                color: i < cut ? 'rgba(148,163,184,0.45)' : i === cut ? FUTURE : 'rgba(255,255,255,0.7)',
                fontWeight: i === cut ? 800 : 500,
              }}>
                {h.time && formatTime ? formatTime(h.time) : ''}
              </div>
            ))}
          </div>

          {/* ── Warning bar, straight under the timestamps ─────────────── */}
          <WarningBands warnings={warnings} hours={hours} width={width} stepHours={stepHours} />

          {/* ── Curve, with symbol and temperature riding it ──────────── */}
          <div style={{ position: 'relative', height: CHART_H, width }}>
            <svg width={width} height={CHART_H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
              <defs>
                <linearGradient id="hourly-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(125,211,252,0.28)" />
                  <stop offset="100%" stopColor="rgba(125,211,252,0)" />
                </linearGradient>
                <linearGradient id="hourly-fill-past" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(148,163,184,0.20)" />
                  <stop offset="100%" stopColor="rgba(148,163,184,0)" />
                </linearGradient>
              </defs>
              {pastEnd > 0 && (
                <>
                  <path d={areaFrom(segs, 0, pastEnd, baseY)} fill="url(#hourly-fill-past)" />
                  <path d={pathFrom(segs, 0, pastEnd)} fill="none" stroke={PAST} strokeWidth="2"
                        strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
              {pastEnd < segs.length && (
                <>
                  <path d={areaFrom(segs, pastEnd, segs.length, baseY)} fill="url(#hourly-fill)" />
                  <path d={pathFrom(segs, pastEnd, segs.length)} fill="none" stroke={FUTURE} strokeWidth="2"
                        strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
              {/* Where the present is. The curve already changes colour here,
                  but a colour change alone is easy to miss halfway along a
                  scrolling strip. */}
              {hasPast && (
                <>
                  <rect x={cut * COL_W} y="0" width={COL_W} height={CHART_H}
                        fill="rgba(125,211,252,0.07)" />
                  <line x1={cut * COL_W} y1="0" x2={cut * COL_W} y2={CHART_H}
                        stroke="rgba(125,211,252,0.45)" strokeWidth="1" strokeDasharray="3 3" />
                </>
              )}
              {points.map((p, i) => p.y == null ? null : (
                <circle key={i} cx={p.x} cy={p.y} r={i === cut ? 4.2 : 3.2}
                        fill="#0b1220" stroke={i < cut ? PAST : FUTURE} strokeWidth="2" />
              ))}
            </svg>

            {hours.map((h, i) => {
              const p = points[i];
              if (!p || p.y == null) return null;
              const past = i < cut;
              return (
                <div key={h.time || i} style={{ position: 'absolute', left: i * COL_W, width: COL_W, top: 0 }}>
                  <div style={{ position: 'absolute', top: p.y + SYMBOL_DY, width: '100%', display: 'flex', justifyContent: 'center' }}>
                    {/* Hours already gone are desaturated as well as dimmed, so
                        the distinction survives where opacity alone is easy to
                        miss. */}
                    <span title={h.desc} style={{
                      position: 'relative', display: 'block',
                      filter: past ? 'grayscale(1)' : 'none', opacity: past ? 0.45 : 1,
                    }}>
                      {WeatherIcon ? <WeatherIcon iconKey={h.iconKey} className="w-8 h-8" /> : null}
                    </span>
                  </div>
                  <div style={{
                    position: 'absolute', top: p.y + TEMP_DY, width: '100%', textAlign: 'center',
                    fontSize: '0.82rem', fontWeight: past ? 600 : 700,
                    color: past ? 'rgba(148,163,184,0.75)' : '#fff',
                  }}>
                    {asTemp(h.temp)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Straight rows below the curve ─────────────────────────── */}

          {/* Chance of precipitation, in its own row rather than sitting on the
              symbols it describes. */}
          <div style={{ display: 'flex', width, marginTop: 8 }}>
            {hours.map((h, i) => (
              <PrecipCell key={h.time || i} chance={h.rainChance} kind={h.precipKind} past={i < cut} />
            ))}
          </div>

          <div style={{ display: 'flex', width, marginTop: 8 }}>
            {hours.map((h, i) => (
              <div key={h.time || i} style={{ width: COL_W, display: 'flex', justifyContent: 'center', opacity: i < cut ? 0.4 : 1 }}>
                <WindArrow deg={h.windDirectionDeg} from={h.windDirection} colour={i < cut ? PAST : FUTURE} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', width, marginTop: 3 }}>
            {hours.map((h, i) => (
              <div key={h.time || i} style={{
                width: COL_W, textAlign: 'center', fontSize: '0.72rem', fontWeight: 600,
                color: i < cut ? 'rgba(148,163,184,0.6)' : 'rgba(255,255,255,0.85)',
              }}>
                {show(h.windSpeed)}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', width, marginTop: 1 }}>
            {hours.map((h, i) => (
              <div key={h.time || i} style={{
                width: COL_W, textAlign: 'center', fontSize: '0.66rem',
                // A gust worth noticing should look different from one that
                // isn't — unless it has already been and gone.
                color: i < cut ? 'rgba(148,163,184,0.45)'
                  : h.windGust >= 45 ? '#fdba74' : 'rgba(255,255,255,0.45)',
                fontWeight: (i >= cut && h.windGust >= 45) ? 700 : 500,
              }}>
                {show(h.windGust)}
              </div>
            ))}
          </div>

          {showWind && <WindGraph hours={hours} width={width} cut={cut} formatTime={formatTime} />}
        </div>
      </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <span style={{
          fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)',
        }}>
          Drop = chance · arrow = direction · mph wind · mph gust
        </span>
        {nowOffScreen && (
          <button
            type="button"
            onClick={() => scrollToNow('smooth')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '0.68rem', fontWeight: 700,
              background: 'rgba(125,211,252,0.18)',
              border: '1px solid rgba(125,211,252,0.5)',
              color: FUTURE,
            }}>
            <Clock style={{ width: 12, height: 12 }} />
            Back to now
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowWind(v => !v)}
          aria-expanded={showWind}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: '0.68rem', fontWeight: 700,
            background: showWind ? 'rgba(125,211,252,0.18)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${showWind ? 'rgba(125,211,252,0.5)' : 'rgba(255,255,255,0.16)'}`,
            color: showWind ? FUTURE : 'rgba(255,255,255,0.7)',
          }}>
          <WindIcon style={{ width: 12, height: 12 }} />
          {showWind ? 'Hide wind graph' : 'Wind graph'}
          <ChevronDown style={{ width: 11, height: 11, transform: showWind ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
      </div>
    </div>
  );
}