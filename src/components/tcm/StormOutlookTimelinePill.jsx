// TimelinePill — the outlook graphics' timeline: a glass pill of time cells, each marked band
// filled in its level's colour and named underneath in that graphic's own words (TSTM … HIGH on
// a thunderstorm outlook, FLRY … HIGH on snow chance, 40-50 … 90+ mph on wind).
//
// `levels` is the graphic's ladder ({ id, short, color }), lowest first; a band of a higher level
// paints over a lower one. Without it the pill uses the thunderstorm ladder. Cells may carry
// `newDay` / `weekday` (studio/studioTimeline):
// a window that runs past midnight gets a divider and the new day's name.
import React from 'react';
import { Clock } from 'lucide-react';
import { GRAPHIC_RISK_LEVELS, inkOn } from '@/components/graphics/GraphicMeta';
import { glass, GlassSheen, useGlassMode } from '@/components/studio/graphicGlass';

// The glass (and its export backdrop) is the graphics' own: studio/graphicGlass.

const THUNDER_LEVELS = GRAPHIC_RISK_LEVELS.map((l) => ({ id: l.level, short: l.short, color: l.color }));
const SEVERE_ID = 'Severe', COND_ID = 'Conditional Severe';
const DEFAULT_STAMPS = ['06', '09', '12', '15', '18', '21', '00', '03', '06'].map((label) => ({ label }));

// Collapse a per-cell array into runs. A lower level's band reaches under neighbouring higher
// ones (so a SLGT inside an MRGL day reads as one MRGL band with SLGT on top) and is drawn first.
function timelineRuns(cells, sev) {
  const N = cells.length, runs = [];
  for (let i = 0; i < N;) {
    const r = cells[i];
    if (!r) { i++; continue; }
    let j = i;
    while (j + 1 < N && cells[j + 1] === r) j++;
    runs.push({ risk: r, start: i, end: j });
    i = j + 1;
  }
  for (const run of runs) {
    const s0 = sev[run.risk] ?? 0;
    let s = run.start, e = run.end;
    while (s - 1 >= 0 && cells[s - 1] && (sev[cells[s - 1]] ?? 0) > s0) s--;
    while (e + 1 < N && cells[e + 1] && (sev[cells[e + 1]] ?? 0) > s0) e++;
    run.drawStart = s; run.drawEnd = e;
  }
  return runs.sort((a, b) => (sev[a.risk] ?? 0) - (sev[b.risk] ?? 0));
}

// Timing rings: a dashed ring round the stamps each timed risk area is active over, in that area's
// outline colour. Rings sharing stretches of the pill interleave: each takes every k-th dash
// (k = how many overlap there), lined up on the pill's own x so the dashes of one fall in the
// gaps of the other, and two areas live at once read as one line in two shades.
const DASH = 5;
function TimingRings({ rings, cellW, cellH, W, exportMode }) {
  const items = rings.map((r) => ({ ...r })).sort((p, q) => p.a - q.a || p.b - q.b);
  /* lanes: greedy colouring of the overlapping spans; k: the lanes in each run of overlaps */
  const laneEnd = [];
  let group = [], groupEnd = -1;
  const closeGroup = () => { const k = Math.max(1, ...group.map((g) => g.lane + 1)); group.forEach((g) => { g.k = k; }); group = []; };
  for (const it of items) {
    if (it.a > groupEnd && group.length) closeGroup();
    let lane = laneEnd.findIndex((e) => e < it.a);
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(it.b); } else laneEnd[lane] = it.b;
    it.lane = lane;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.b);
  }
  if (group.length) closeGroup();
  /* on the band's own edge, like the Conditional Severe dashed border */
  const y0 = 1, y1 = cellH - 1, ry = (y1 - y0) / 2;
  const mod = (x, p) => ((x % p) + p) % p;
  return (
    <svg width={W} height={cellH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 2 }}
      aria-hidden="true">
      <g style={{ filter: 'drop-shadow(0 0 1.2px rgba(0,0,0,0.95))' }}>
        {items.map((r) => {
          const x0 = r.openA ? -2 : r.a * cellW + 1, x1 = r.openB ? (r.b + 1) * cellW + 2 : (r.b + 1) * cellW - 1;
          const rx = Math.min(ry, (x1 - x0) / 2);
          const l = r.openA ? x0 : x0 + rx, rr = r.openB ? x1 : x1 - rx;
          const P = r.k > 1 ? r.k * DASH : DASH * 1.8;
          const dash = r.k > 1 ? `${DASH} ${(r.k - 1) * DASH}` : `${DASH} ${DASH * 0.8}`;
          const common = { fill: 'none', stroke: r.color, strokeWidth: r.sel && !exportMode ? 2.6 : 2, strokeDasharray: dash, strokeLinecap: 'butt' };
          const lineOff = mod(l - r.lane * DASH, P), capOff = mod(-r.lane * DASH, P);
          return (
            <g key={r.key} style={r.sel && !exportMode ? { filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.85))' } : undefined}>
              {rr > l && [y0, y1].map((y) => <path key={y} d={`M${l},${y} L${rr},${y}`} {...common} strokeDashoffset={lineOff} />)}
              {!r.openA && <path d={`M${l},${y0} A${rx},${ry} 0 0 0 ${l},${y1}`} {...common} strokeDashoffset={capOff} />}
              {!r.openB && <path d={`M${rr},${y0} A${rx},${ry} 0 0 1 ${rr},${y1}`} {...common} strokeDashoffset={capOff} />}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function TimelinePill({
  stamps = DEFAULT_STAMPS,
  stampRisks,
  stampOverlays = [],
  levels = THUNDER_LEVELS,
  onStampClick,
  rangeAnchor = null,
  validLabel = null,
  playhead = null,
  exportMode = false,
  showNames = true,
  rings = [],
}) {
  const N = stamps.length;
  const mode = useGlassMode(exportMode);
  const byId = Object.fromEntries(levels.map((l) => [l.id, l]));
  const sev = Object.fromEntries(levels.map((l, i) => [l.id, i]));
  const runs = timelineRuns(stampRisks, sev);
  const overlayRuns = timelineRuns(stampOverlays, sev);
  const CELL_H = 26;
  const CELL_W = N <= 9 ? 31 : N <= 13 ? 27 : Math.max(9, Math.floor(520 / N));
  const stampFont = CELL_W >= 30 ? 16 : CELL_W >= 24 ? 13 : 11;
  const every = Math.max(1, Math.ceil(17 / CELL_W));   // label every cell that has room
  const W = CELL_W * N;

  /* names under the bands: most severe placed first, any that would overlap is left out */
  const names = [];
  if (showNames) {
    const taken = [];
    const cands = [...runs, ...overlayRuns].map((r) => ({ ...r, meta: byId[r.risk] })).filter((r) => r.meta)
      .sort((a, b) => (sev[b.risk] ?? 0) - (sev[a.risk] ?? 0));
    for (const r of cands) {
      const text = r.meta.short;
      const w = text.length * 5.3 + 4;
      const x = ((r.start + r.end + 1) / 2) * CELL_W;
      const box = [Math.max(0, x - w / 2), Math.min(W, x + w / 2)];
      if (taken.some(([a, b]) => box[0] < b + 3 && box[1] > a - 3)) continue;
      taken.push(box);
      names.push({ x: Math.max(w / 2, Math.min(W - w / 2, x)), text, color: r.risk === COND_ID ? '#cbd5e1' : r.meta.color, key: `${r.risk}-${r.start}` });
    }
  }
  const days = stamps.map((s, i) => (s.newDay ? { i, text: s.weekday } : null)).filter(Boolean);
  const nameRow = names.length > 0 || days.length > 0;
  const ringed = rings.length > 0;
  /* the colour under each cell, so its hour reads on it */
  const under = stamps.map((_, i) => {
    let best = null;
    for (const r of runs) if (i >= r.drawStart && i <= r.drawEnd && (best == null || (sev[r.risk] ?? 0) >= (sev[best] ?? 0))) best = r.risk;
    return best ? byId[best]?.color : null;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
      <div style={{
        ...glass({ padding: nameRow ? '6px 12px 4px' : '6px 12px', display: 'flex', alignItems: 'center', gap: 9, borderRadius: nameRow ? 20 : 999, alignSelf: 'flex-start' }, mode),
        border: '1px solid rgba(255,255,255,0.18)', pointerEvents: 'auto',
      }}>
        <GlassSheen />
        <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: nameRow ? 'flex-start' : 'center', marginTop: nameRow ? 1 : 0 }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.85)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock style={{ width: 14, height: 14, color: '#fff' }} strokeWidth={2.2} />
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>›</span>
        </span>

        <div style={{ position: 'relative', zIndex: 1, width: W, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ position: 'relative', width: W, height: CELL_H }}>
            {runs.map((run, k) => {
              const meta = byId[run.risk];
              if (!meta) return null;
              return (
                <div key={`base-${k}`} style={{
                  position: 'absolute', top: 0, bottom: 0, left: run.drawStart * CELL_W, width: (run.drawEnd - run.drawStart + 1) * CELL_W,
                  background: meta.color, borderRadius: 999, transition: 'left 0.15s, width 0.15s',
                }} />
              );
            })}
            {/* Severe = hatch + outline, Conditional Severe = dashed outline, both over the base band */}
            {overlayRuns.map((run, k) => {
              const meta = byId[run.risk];
              if (!meta) return null;
              const common = {
                position: 'absolute', top: 0, bottom: 0, left: run.drawStart * CELL_W, width: (run.drawEnd - run.drawStart + 1) * CELL_W,
                borderRadius: 999, boxSizing: 'border-box', transition: 'left 0.15s, width 0.15s', pointerEvents: 'none', background: 'transparent',
              };
              return run.risk === SEVERE_ID
                ? <div key={`ov-${k}`} style={{ ...common, backgroundImage: 'repeating-linear-gradient(45deg, rgba(49,46,129,0.9) 0 3px, transparent 3px 8px)', border: `2px solid ${meta.color}` }} />
                : <div key={`ov-${k}`} style={{ ...common, border: `2px dashed ${run.risk === COND_ID ? '#0b0f1a' : meta.color}` }} />;
            })}
            {days.map((d) => (
              <div key={`d-${d.i}`} style={{ position: 'absolute', top: -3, bottom: -3, left: d.i * CELL_W - 1, width: 2, borderRadius: 1, background: 'rgba(255,255,255,0.7)', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.45)', zIndex: 2, pointerEvents: 'none' }} />
            ))}
            {rangeAnchor != null && rangeAnchor >= 0 && rangeAnchor < N && (
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: rangeAnchor * CELL_W, width: CELL_W, border: '2px dashed rgba(255,255,255,0.95)', borderRadius: 8, boxSizing: 'border-box', pointerEvents: 'none', zIndex: 2 }} />
            )}
            {stamps.map((s, i) => {
              const ink = under[i] ? inkOn(under[i]) : '#ffffff';
              const dark = ink !== '#ffffff';
              return (
                <button key={i} type="button" onClick={() => onStampClick?.(i)} title={s.weekday ? `${s.weekday} ${s.label}:00` : undefined} style={{
                  position: 'absolute', top: 0, bottom: 0, left: i * CELL_W, width: CELL_W, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: 'transparent', padding: 0, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3,
                }}>
                  {i % every === 0 && (
                    <span style={{
                      fontSize: stampFont, fontWeight: 800, fontFamily: "'Archivo','DM Sans',system-ui,sans-serif", letterSpacing: '-0.01em', lineHeight: 1,
                      color: dark ? ink : '#fff', WebkitTextStroke: dark ? '0' : '0.6px #000', textShadow: dark ? 'none' : '0 1px 1px rgba(0,0,0,0.55)',
                    }}>{s.label}</span>
                  )}
                </button>
              );
            })}
            {ringed && <TimingRings rings={rings} cellW={CELL_W} cellH={CELL_H} W={W} exportMode={exportMode} />}
            {playhead != null && (
              <div style={{
                position: 'absolute', top: -3, bottom: -3, left: Math.max(0, Math.min(N, playhead)) * CELL_W, width: 2, borderRadius: 2, boxSizing: 'border-box', marginLeft: -1,
                background: '#fff', boxShadow: '0 0 7px rgba(255,255,255,0.9)', zIndex: 5, pointerEvents: 'none',
              }}>
                <div style={{ position: 'absolute', top: -4, left: -3, width: 8, height: 8, borderRadius: '50%', background: '#fff', boxShadow: '0 0 7px rgba(255,255,255,0.95)' }} />
              </div>
            )}
          </div>
          {nameRow && (
            <div style={{ position: 'relative', width: W, height: 11 }}>
              {days.map((d) => (names.some((n) => Math.abs(n.x - d.i * CELL_W) < n.text.length * 2.7 + 16) ? null : (
                <span key={`dn-${d.i}`} style={{ position: 'absolute', left: d.i * CELL_W + 3, top: 0, fontSize: 7.5, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.62)', textTransform: 'uppercase', lineHeight: '11px' }}>{d.text}</span>
              )))}
              {names.map((n) => (
                <span key={n.key} style={{
                  position: 'absolute', left: n.x, top: 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap',
                  fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em', lineHeight: '11px', color: n.color,
                  textShadow: '0 0 3px rgba(0,0,0,0.85), 0 1px 1px rgba(0,0,0,0.6)',
                }}>{n.text}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      {validLabel && (
        <div style={{
          ...glass({ padding: '3px 11px', borderRadius: 999, alignSelf: 'flex-start' }, mode),
          border: '1px solid rgba(255,255,255,0.16)', pointerEvents: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <GlassSheen />
          <span style={{ position: 'relative', zIndex: 1, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(148,163,184,0.95)' }}>Valid</span>
          <span style={{ position: 'relative', zIndex: 1, fontSize: 11, fontWeight: 800, letterSpacing: '0.02em', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{validLabel}</span>
        </div>
      )}
    </div>
  );
}
