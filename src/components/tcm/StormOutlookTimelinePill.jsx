// TimelinePill — extracted from StormOutlookGraphicTool so the graphic file
// stays under the editor's line budget. Self-contained: it duplicates only the
// small render-only helpers it needs (glass sheen styling + the graphic's risk
// level colour table). The risk table mirrors the one in the graphic tool; if
// the graphic's palette ever changes, update both.
//
// Added: an optional `activeWindow` ({ from, to, color } in minutes after the
// 06:00 outlook start, i.e. 0..1440). When present the pill draws a single
// half-hour-precise risk band (set by the From/To time pickers) over the clock
// cells and suppresses the per-cell base pills while it is set.
import React from 'react';
import { Clock } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { RISK_META, RISK_PALETTES, LEVEL_RANGE } from '@/components/tcm/riskConfig';

const TOTAL_MIN = 24 * 60; // 06:00 outlook start -> 06:00 next day
// --- glass styling (duplicate of the graphic tool's helpers) ---------------
// Keep this in step with the copy in StormOutlookGraphicTool.jsx, which carries
// the full reasoning. In short: export mode differs in exactly one property,
// swapping the translucent tint for the colour it resolves to once flattened
// onto the backdrop, because `backdrop-filter` has nothing to filter inside the
// SVG the exporter draws into. Sheen, shadows and hairlines are identical in
// both — the browser renders the export, so it renders them correctly.
const glass = (extra = {}, exportMode = false) => ({
  background: exportMode
    ? 'linear-gradient(155deg, rgba(34,40,64,0.90) 0%, rgba(21,25,45,0.92) 45%, rgba(13,16,33,0.94) 100%)'
    : 'linear-gradient(155deg, rgba(70,86,124,0.40) 0%, rgba(40,54,86,0.34) 45%, rgba(16,24,44,0.46) 100%)',
  border: '1px solid rgba(255,255,255,0.26)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.46), 0 2px 10px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.40), inset 0 0 22px rgba(120,150,210,0.12), inset 0 -1px 0 rgba(0,0,0,0.24)',
  ...(exportMode ? {} : { backdropFilter: 'blur(22px) saturate(180%) brightness(1.08)', WebkitBackdropFilter: 'blur(22px) saturate(180%) brightness(1.08)' }),
  borderRadius: 14, position: 'relative', overflow: 'hidden', ...extra,
});
function GlassSheen() {
  return (
    <>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '58%',
        background: 'linear-gradient(158deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.07) 38%, transparent 72%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', top: 1, left: '8%', right: '8%', height: 1,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
    </>
  );
}

// --- Risk level colour table (mirrors StormOutlookGraphicTool) -------------
const COND_SEVERE_ID = 'Conditional Severe';
const COND_SEVERE_COLOR = '#0b0f1a';
const COND_SEVERE = { id: COND_SEVERE_ID, short: 'COND SVRE', range: 'COND SVR', color: COND_SEVERE_COLOR, fill: 'rgba(200,205,215,0.18)', border: COND_SEVERE_COLOR };
const GRAPHIC_LEVELS_BASE = RISK_META
  .filter(r => r.level !== 'No Risk')
  .map(r => {
    let [lo, hi] = LEVEL_RANGE[r.level] || [0, 0];
    if (r.level === 'High') hi = 100;
    const pal = RISK_PALETTES.thunderstorm[r.level];
    const G = { 'Very Low': ['#60a5fa', 'rgba(96,165,250,0.34)', 'TSTM'], 'Low': ['#86efac', 'rgba(134,239,172,0.38)', 'MRGL'], 'Marginal': ['#facc15', 'rgba(250,204,21,0.42)', 'SLGT'], 'Slight': ['#fb923c', 'rgba(249,115,22,0.45)', 'ENH'], 'Moderate': ['#f87171', 'rgba(248,113,113,0.45)', 'MDT'], 'High': ['#a78bfa', 'rgba(167,139,250,0.45)', 'HIGH'] };
    const g = G[r.level];
    return {
      id: r.level,
      short: g ? g[2] : (r.level === 'Severe' ? 'SVRE' : r.level.toUpperCase()),
      range: r.level === 'Severe' ? 'SVR TSTMS' : `${lo}-${hi}%`,
      color: g ? g[0] : pal.color,
      fill: g ? g[1] : pal.fill,
      border: g ? g[0] : pal.border,
    };
  });
const GRAPHIC_LEVELS = (() => {
  const out = [];
  let inserted = false;
  for (const lvl of GRAPHIC_LEVELS_BASE) {
    if (lvl.id === 'Severe' && !inserted) { out.push(COND_SEVERE); inserted = true; }
    out.push(lvl);
  }
  if (!inserted) out.push(COND_SEVERE);
  return out;
})();
const RISK_BY_ID = Object.fromEntries(GRAPHIC_LEVELS.map(l => [l.id, l]));
const RISK_SEVERITY = Object.fromEntries(GRAPHIC_LEVELS.map((l, i) => [l.id, i]));
const isSevereId = (id) => id === 'Severe';

// --- Timeline stamp labels (default 3-hourly) -------------------------------
const TIMELINE_PRESETS = {
  '3h': ['06', '09', '12', '15', '18', '21', '00', '03', '06'],
  '2h': ['06', '08', '10', '12', '14', '16', '18', '20', '22', '00', '02', '04', '06'],
  '1h': ['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18',
         '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06'],
};
const buildStamps = (gran) => (TIMELINE_PRESETS[gran] || TIMELINE_PRESETS['3h']).map(label => ({ label }));
const TIMELINE_STAMPS = buildStamps('3h');

// Collapse a per-cell array into consecutive runs. Runs of lower severity are
// drawn first so higher-severity bands paint on top where they overlap.
function timelineRuns(stampRisks) {
  const N = stampRisks.length;
  const runs = [];
  let i = 0;
  while (i < N) {
    const r = stampRisks[i];
    if (!r) { i++; continue; }
    let j = i;
    while (j + 1 < N && stampRisks[j + 1] === r) j++;
    runs.push({ risk: r, start: i, end: j });
    i = j + 1;
  }
  for (const run of runs) {
    const sev = RISK_SEVERITY[run.risk];
    let s = run.start;
    while (s - 1 >= 0 && stampRisks[s - 1] && RISK_SEVERITY[stampRisks[s - 1]] > sev) s--;
    let e = run.end;
    while (e + 1 < N && stampRisks[e + 1] && RISK_SEVERITY[stampRisks[e + 1]] > sev) e++;
    run.drawStart = s; run.drawEnd = e;
  }
  runs.sort((a, b) => RISK_SEVERITY[a.risk] - RISK_SEVERITY[b.risk]);
  return runs;
}

export default function TimelinePill({
  stamps = TIMELINE_STAMPS,
  stampRisks,
  stampOverlays = [],
  onStampClick,
  rangeAnchor = null,
  validLabel = null,
  activeWindow = null,
  playhead = null,
  exportMode = false,
}) {
  const N = stamps.length;
  const runs = timelineRuns(stampRisks);
  const overlayRuns = timelineRuns(stampOverlays);
  const CELL_H = 26;
  const CELL_W = N <= 9 ? 31 : N <= 13 ? 27 : Math.max(16, Math.floor(520 / N));
  const stampFont = CELL_W >= 30 ? 16 : CELL_W >= 24 ? 13 : 11;
  const W = CELL_W * N;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
    <div style={{
      ...glass({
        padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 9,
        borderRadius: 999, alignSelf: 'flex-start',
      }, exportMode),
      border: '1px solid rgba(255,255,255,0.18)',
      pointerEvents: 'auto',
    }}>
      <GlassSheen />
      <span style={{
        position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 4,
      }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.85)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Clock style={{ width: 14, height: 14, color: '#fff' }} strokeWidth={2.2} />
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>›</span>
      </span>

      <div style={{
        position: 'relative', zIndex: 1,
        width: W, height: CELL_H,
      }}>
        {/* Half-hour-precise active window (overrides per-cell base pills) */}
        {activeWindow && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: (activeWindow.from / TOTAL_MIN) * W,
            width: ((activeWindow.to - activeWindow.from) / TOTAL_MIN) * W,
            background: activeWindow.color, borderRadius: 999,
            transition: 'left 0.15s, width 0.15s',
          }} />
        )}
        {/* Base risk pills (solid colour) — hidden while the active window is set */}
        {!activeWindow && runs.map((run, k) => {
          const meta = RISK_BY_ID[run.risk];
          return (
            <div key={`base-${k}`} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: run.drawStart * CELL_W,
              width: (run.drawEnd - run.drawStart + 1) * CELL_W,
              background: meta.color, borderRadius: 999,
              transition: 'left 0.15s, width 0.15s',
            }} />
          );
        })}
        {/* Overlay tiers drawn ON TOP — Severe = hatch + outline, Conditional =
            dashed BLACK outline. The base risk underneath stays fully intact. */}
        {overlayRuns.map((run, k) => {
          const meta = RISK_BY_ID[run.risk];
          const severe = isSevereId(run.risk);
          const common = {
            position: 'absolute', top: 0, bottom: 0,
            left: run.drawStart * CELL_W,
            width: (run.drawEnd - run.drawStart + 1) * CELL_W,
            borderRadius: 999, boxSizing: 'border-box',
            transition: 'left 0.15s, width 0.15s', pointerEvents: 'none',
          };
          return severe ? (
            <div key={`ov-${k}`} style={{
              ...common, background: 'transparent',
              backgroundImage: 'repeating-linear-gradient(45deg, rgba(49,46,129,0.9) 0 3px, transparent 3px 8px)',
              border: `2px solid ${meta.color}`,
            }} />
          ) : (
            <div key={`ov-${k}`} style={{
              ...common, background: 'transparent',
              border: `2px dashed ${meta.color}`,
            }} />
          );
        })}
        {/* Pending range anchor: a dashed ring on the first-clicked cell. */}
        {rangeAnchor != null && rangeAnchor >= 0 && rangeAnchor < N && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: rangeAnchor * CELL_W, width: CELL_W,
            border: '2px dashed rgba(255,255,255,0.95)', borderRadius: 8,
            boxSizing: 'border-box', pointerEvents: 'none', zIndex: 2,
          }} />
        )}
        {stamps.map((s, i) => (
          <button key={i} type="button" onClick={() => onStampClick(i)} style={{
            position: 'absolute', top: 0, bottom: 0, left: i * CELL_W, width: CELL_W,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            background: 'transparent', padding: 0, margin: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3,
          }}>
            <span style={{
              fontSize: stampFont, fontWeight: 800, fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
              color: '#fff', letterSpacing: '-0.01em', lineHeight: 1,
              WebkitTextStroke: '0.6px #000',
              textShadow: '0 1px 1px rgba(0,0,0,0.55)',
            }}>{s.label}</span>
          </button>
        ))}
        {/* Playhead marker (animation): a glowing vertical line at the sweep position */}
        {playhead != null && (
          <div style={{
            position: 'absolute', top: -3, bottom: -3,
            left: Math.max(0, Math.min(N, playhead)) * CELL_W,
            width: 2, borderRadius: 2, boxSizing: 'border-box', marginLeft: -1,
            background: '#fff', boxShadow: '0 0 7px rgba(255,255,255,0.9)',
            zIndex: 5, pointerEvents: 'none',
          }}>
            <div style={{ position: 'absolute', top: -4, left: -3, width: 8, height: 8, borderRadius: '50%', background: '#fff', boxShadow: '0 0 7px rgba(255,255,255,0.95)' }} />
          </div>
        )}
      </div>
    </div>
    {/* Valid-time caption: the active risk band's real start->end datetime. */}
    {validLabel && (
      <div style={{
        ...glass({ padding: '3px 11px', borderRadius: 999, alignSelf: 'flex-start' }, exportMode),
        border: '1px solid rgba(255,255,255,0.16)', pointerEvents: 'none',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <GlassSheen />
        <span style={{
          position: 'relative', zIndex: 1, fontSize: 8.5, fontWeight: 800,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(148,163,184,0.95)',
        }}>Valid</span>
        <span style={{
          position: 'relative', zIndex: 1, fontSize: 11, fontWeight: 800,
          letterSpacing: '0.02em', color: '#fff', fontVariantNumeric: 'tabular-nums',
        }}>{validLabel}</span>
      </div>
    )}
    </div>
  );
}