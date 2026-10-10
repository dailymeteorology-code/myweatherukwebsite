import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Minus, BarChart3, Zap, Loader2,
  CheckCircle, XCircle, AlertTriangle, Target, Activity, Info,
  Pencil, Check, X, Calendar,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine, ReferenceArea,
} from 'recharts';
import { base44 } from '@/api/base44Client';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/components/ThemeContext';

// ─── Constants ───────────────────────────────────────────────────────────────
// Semantic series colours — identical in both themes.
const C_BASE = {
  hit:       '#22c55e', hitDim:    'rgba(34,197,94,0.18)',
  miss:      '#ef4444', missDim:   'rgba(239,68,68,0.18)',
  warn:      '#f97316', warnDim:   'rgba(249,115,22,0.14)',
  score:     '#818cf8', scoreDim:  'rgba(129,140,248,0.15)',
  strike:    '#facc15', strikeDim: 'rgba(250,204,21,0.14)',
  trend:     '#38bdf8', trendDim:  'rgba(56,189,248,0.12)',
  forecast:  '#a78bfa', forecastDim:'rgba(167,139,250,0.4)',
};
const C_DARK = {
  ...C_BASE,
  text: '#f1f5f9', muted: '#94a3b8', dim: '#475569',
  surface: 'rgba(15,23,42,0.96)',
  border: 'rgba(255,255,255,0.09)', border2: 'rgba(255,255,255,0.16)',
  panel: 'rgba(255,255,255,0.02)', chip: 'rgba(255,255,255,0.05)',
  hair: 'rgba(255,255,255,0.06)', grid: 'rgba(255,255,255,0.04)',
  panelBorder: 'rgba(255,255,255,0.07)', btnBorder: 'rgba(255,255,255,0.08)',
  cardDeep: 'rgba(10,15,30,0.8)',
  tooltipBg: 'linear-gradient(155deg,rgba(10,15,30,0.98) 0%,rgba(15,23,42,0.98) 100%)',
  refLine: 'rgba(255,255,255,0.15)',
};
const C_LIGHT = {
  ...C_BASE,
  text: '#0f172a', muted: '#475569', dim: '#94a3b8',
  surface: 'rgba(255,255,255,0.98)',
  border: 'rgba(15,23,42,0.10)', border2: 'rgba(15,23,42,0.18)',
  panel: 'rgba(15,23,42,0.03)', chip: 'rgba(15,23,42,0.05)',
  hair: 'rgba(15,23,42,0.08)', grid: 'rgba(15,23,42,0.06)',
  panelBorder: 'rgba(15,23,42,0.10)', btnBorder: 'rgba(15,23,42,0.12)',
  cardDeep: 'rgba(255,255,255,0.75)',
  tooltipBg: 'linear-gradient(155deg,#ffffff 0%,#f4f8ff 100%)',
  refLine: 'rgba(15,23,42,0.18)',
};
// Mutable active palette — set once per render by applyChartTheme() before any
// child (KPI cards, tooltip, legend) reads it. Single chart instance, so safe.
let C = { ...C_DARK };
function applyChartTheme(isDark) { Object.assign(C, isDark ? C_DARK : C_LIGHT); }

// The chart plots a continuous day-spine (no gaps) from the earliest recorded
// day (bounded to 30 days back) through 2 days ahead (forecast-only). Everything
// persists to the public-read ForecastVerification entity, so an admin edit
// shows for every visitor.
const REGION = 'uk';
const EDIT_PAST_DAYS = 29;   // today + 29 back = 30-day verified window
const EDIT_AHEAD_DAYS = 2;   // 2 days of forecast-only points on the right

const isoOf = (d) => d.toISOString().slice(0, 10);
function todayIso() { const d = new Date(); d.setHours(0, 0, 0, 0); return isoOf(d); }
const labelOf = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayNum = (iso) => Math.round(new Date(iso + 'T12:00:00').getTime() / 86400000);
const isoShift = (iso, delta) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + delta); return isoOf(d); };
const maxIso = (a, b) => (a > b ? a : b);
const minIso = (a, b) => (a < b ? a : b);

// ─── Known verification data-gap ──────────────────────────────────────
// No reliable verification data was recorded in this window, so the rolling-hit
// line is broken across it and the span is annotated. Purely visual — it does NOT
// affect any KPI/score, which are derived only from real records.
const GAP_START_ISO = '2026-07-13';
const GAP_END_ISO   = '2026-07-20';
const GAP_START_LABEL = labelOf(GAP_START_ISO);
const GAP_END_LABEL   = labelOf(GAP_END_ISO);

// ─── Demo data generator ─────────────────────────────────────────────────────
function generateDemoData() {
  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const wave = Math.sin(i * 0.4) * 0.4 + Math.sin(i * 0.15) * 0.3;
    const forecastScore = Math.round(Math.max(2, Math.min(98, 45 + wave * 40 + (Math.random() - 0.5) * 18)));
    // bias: model tends to over-forecast slightly (realistic)
    const biasFactor = 0.85 + Math.random() * 0.45;
    const observed  = Math.round(Math.max(0, forecastScore * biasFactor + (Math.random() - 0.5) * 10));
    const hit = forecastScore >= 30 ? observed >= forecastScore * 0.55 : observed < 15;
    days.push({
      date: labelOf(iso),
      fullDate: iso,
      forecastScore,
      observedStrikes: observed,
      hit,
      hasRecord: true,
      isFuture: false,
    });
  }
  return days;
}

// ─── Build the continuous day-spine from DB records ───────────────────────────
// Generates every day from the earliest recorded past day (clamped to 30 days
// back; falls back to today when there are no past records) through today+2, so
// the axis is gap-free and the 2 forecast days always have a slot. Days without
// a record carry null values (no bar, and the observed line bridges the gap).
function buildSpine(byDate) {
  const tIso = todayIso();
  const pastRecordDates = Object.keys(byDate).filter(iso => {
    const rel = dayNum(iso) - dayNum(tIso);
    return rel >= -EDIT_PAST_DAYS && rel <= 0;
  }).sort();
  const startIso = pastRecordDates.length
    ? maxIso(pastRecordDates[0], isoShift(tIso, -EDIT_PAST_DAYS))
    : tIso;
  const endIso = isoShift(tIso, EDIT_AHEAD_DAYS);

  const rows = [];
  let cur = startIso;
  let guard = 0;
  while (cur <= endIso && guard++ < 400) {
    const rec = byDate[cur];
    const future = cur > tIso;
    rows.push({
      date: labelOf(cur),
      fullDate: cur,
      forecastScore:   (rec && rec.forecast_score != null) ? rec.forecast_score : null,
      observedStrikes: (rec && !future && rec.observed_strike_count != null) ? rec.observed_strike_count : null,
      hit:             rec ? ((rec.hit_rate ?? 0) > 0.5) : false,
      hasRecord:       !!rec,
      isFuture:        future,
    });
    cur = isoShift(cur, 1);
  }
  return rows;
}

// ─── Derived stats (verified days with data only) ─────────────────────────────
function deriveStats(data) {
  const verified = data.filter(d => !d.isFuture && d.hasRecord && d.forecastScore != null);
  const total = verified.length;
  if (!total) return null;

  const hits   = verified.filter(d => d.hit).length;
  const misses = total - hits;
  const hitPct = Math.round((hits / total) * 100);

  const avgForecast = verified.reduce((s, d) => s + d.forecastScore, 0) / total;
  const avgObserved = verified.reduce((s, d) => s + (d.observedStrikes || 0), 0) / total;
  const bias        = avgObserved > 0 ? avgForecast / avgObserved : 1;

  // Brier-style skill (normalised RMSE improvement vs climatology)
  const rmse = Math.sqrt(verified.reduce((s, d) => {
    const err = (d.forecastScore - (d.observedStrikes || 0));
    return s + err * err;
  }, 0) / total);
  const climatologyMSE = verified.reduce((s, d) => {
    const err = avgObserved - (d.observedStrikes || 0);
    return s + err * err;
  }, 0) / total;
  const skill = climatologyMSE > 0
    ? Math.round((1 - (rmse * rmse) / climatologyMSE) * 100)
    : 0;

  // 7-day rolling hit rate — only verified days contribute; empty/future → null
  const withRolling = data.map((d, i) => {
    if (d.isFuture || !d.hasRecord || d.forecastScore == null) return { ...d, rollingHit: null };
    const window = data.slice(Math.max(0, i - 6), i + 1).filter(x => !x.isFuture && x.hasRecord && x.forecastScore != null);
    const rollingHit = window.length ? Math.round((window.filter(x => x.hit).length / window.length) * 100) : null;
    return { ...d, rollingHit };
  });

  // Trend (last 7 vs previous 7 verified days)
  const recent7 = verified.slice(-7).filter(d => d.hit).length / 7;
  const prev7   = verified.slice(-14, -7).filter(d => d.hit).length / Math.max(1, verified.slice(-14, -7).length);
  const trendDir = recent7 > prev7 + 0.08 ? 'up' : recent7 < prev7 - 0.08 ? 'down' : 'flat';
  const trendDelta = Math.round(Math.abs(recent7 - prev7) * 100);

  return {
    total, hits, misses, hitPct,
    avgForecast: Math.round(avgForecast),
    avgObserved: Math.round(avgObserved),
    bias: Math.round(bias * 100) / 100,
    skill: Math.max(-99, Math.min(100, skill)),
    rmse: Math.round(rmse),
    withRolling,
    trendDir,
    trendDelta,
  };
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const future = d.isFuture;
  const hasPred = d.forecastScore != null;
  const accent = future ? 'rgba(167,139,250,0.35)' : (d.hit ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)');
  return (
    <div style={{
      background: C.tooltipBg,
      border: `1px solid ${accent}`,
      borderRadius: 14, padding: '12px 15px',
      backdropFilter: 'blur(24px)',
      boxShadow: `0 12px 36px rgba(0,0,0,0.7), 0 0 0 1px ${accent}`,
      minWidth: 190,
    }}>
      {/* Date + verdict */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</p>
        <span style={{
          padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
          background: future ? C.forecastDim : (d.hit ? C.hitDim : C.missDim),
          color: future ? '#0b1020' : (d.hit ? C.hit : C.miss),
          border: `1px solid ${future ? 'rgba(167,139,250,0.3)' : (d.hit ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)')}`,
        }}>{future ? '◇ FORECAST' : (d.hit ? '✓ HIT' : '✗ MISS')}</span>
      </div>
      {/* Predicted — always first, always shown when set */}
      {hasPred && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${C.hair}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: future ? C.forecast : C.score, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: C.text, fontWeight: 700 }}>Predicted</span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 900, color: future ? C.forecast : C.score, fontFamily: 'monospace' }}>{d.forecastScore}</span>
        </div>
      )}
      {/* Rows */}
      {[
        { key: 'observedStrikes',  label: 'Observed strikes',color: C.strike, suffix: '' },
        { key: 'rollingHit',       label: '7-day hit rate', color: C.trend,  suffix: '%' },
      ].map(({ key, label, color, suffix }) => d[key] != null && (
        <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: C.muted }}>{label}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: 'monospace' }}>{d[key]}{suffix}</span>
        </div>
      ))}
      {/* Error */}
      {!future && hasPred && d.observedStrikes != null && (
        <div style={{
          marginTop: 8, paddingTop: 8,
          borderTop: `1px solid ${C.hair}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 10.5, color: C.dim }}>Error</span>
          <span style={{
            fontSize: 11.5, fontFamily: 'monospace', fontWeight: 800,
            color: Math.abs(d.forecastScore - d.observedStrikes) > 20 ? C.warn : C.muted,
          }}>
            {d.forecastScore - d.observedStrikes > 0 ? '+' : ''}{d.forecastScore - d.observedStrikes} pts
          </span>
        </div>
      )}
      {future && (
        <p style={{ margin: '8px 0 0', paddingTop: 8, borderTop: `1px solid ${C.hair}`, fontSize: 10, color: C.dim, fontStyle: 'italic' }}>
          Predicted — not yet verified
        </p>
      )}
    </div>
  );
}

// ─── Skill badge ──────────────────────────────────────────────────────────────
function SkillBadge({ skill }) {
  const { label, color, bg, border } =
    skill >= 60  ? { label: 'Excellent', color: C.hit,    bg: C.hitDim,  border: 'rgba(34,197,94,0.3)' }
  : skill >= 35  ? { label: 'Good',      color: C.trend,  bg: C.trendDim,border: 'rgba(56,189,248,0.3)' }
  : skill >= 10  ? { label: 'Fair',      color: C.warn,   bg: C.warnDim, border: 'rgba(249,115,22,0.3)' }
  : skill >= 0   ? { label: 'Low',       color: '#f59e0b',bg: 'rgba(245,158,11,0.12)',border:'rgba(245,158,11,0.3)' }
  :               { label: 'No skill',   color: C.miss,   bg: C.missDim, border: 'rgba(239,68,68,0.3)' };
  return (
    <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  );
}

// ─── Big stat card ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, accent = C.trend, wide = false, children }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 14,
      background: `linear-gradient(140deg, ${accent}12 0%, ${C.cardDeep} 100%)`,
      border: `1px solid ${accent}28`,
      display: 'flex', flexDirection: 'column', gap: 5,
      gridColumn: wide ? 'span 2' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
        <span style={{ color: accent, opacity: 0.7 }}>{icon}</span>
      </div>
      {value !== undefined && (
        <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color: accent, fontFamily: 'monospace', letterSpacing: '-0.03em', lineHeight: 1 }}>
          {value}
        </p>
      )}
      {sub && <p style={{ margin: 0, fontSize: 10.5, color: C.muted, fontWeight: 600 }}>{sub}</p>}
      {children}
    </div>
  );
}

// ─── Hit/miss day dots row ────────────────────────────────────────────────────
function HitMissDots({ data, onHover }) {
  const verified = data.filter(d => !d.isFuture && d.hasRecord && d.forecastScore != null);
  if (!verified.length) return null;
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 9.5, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        Daily hit · miss record
      </p>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 4 }}>
        {verified.map((d, i) => (
          <div
            key={i}
            title={`${d.date}: ${d.hit ? 'HIT' : 'MISS'} — predicted ${d.forecastScore}, observed ${d.observedStrikes}`}
            onMouseEnter={() => onHover?.(d)}
            onMouseLeave={() => onHover?.(null)}
            style={{
              width: 10, height: 28, borderRadius: 3, flexShrink: 0, cursor: 'default',
              background: d.hit
                ? `linear-gradient(180deg, ${C.hit}, rgba(34,197,94,0.4))`
                : `linear-gradient(180deg, ${C.miss}, rgba(239,68,68,0.35))`,
              opacity: 0.9,
              transition: 'opacity 0.15s',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 9, color: C.dim, fontFamily: 'monospace' }}>{verified[0]?.date}</span>
        <span style={{ fontSize: 9, color: C.dim, fontFamily: 'monospace' }}>{verified[verified.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ─── Bias bar ─────────────────────────────────────────────────────────────────
function BiasBar({ bias }) {
  // bias = avgForecast / avgObserved. 1.0 = perfect, >1 = over-forecast, <1 = under
  const clamped = Math.max(0.2, Math.min(2.0, bias));
  const pct     = ((clamped - 0.2) / 1.8) * 100; // 0–100% position on bar
  const isOver  = bias > 1.1;
  const isUnder = bias < 0.9;
  const color   = isOver ? C.warn : isUnder ? C.trend : C.hit;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Forecast bias</span>
        <span style={{ fontSize: 11, fontWeight: 800, color, fontFamily: 'monospace' }}>
          {bias.toFixed(2)}× {isOver ? '↑ over' : isUnder ? '↓ under' : '✓ neutral'}
        </span>
      </div>
      <div style={{ position: 'relative', height: 8, borderRadius: 4, background: C.hair }}>
        {/* Perfect centre line */}
        <div style={{
          position: 'absolute', left: `${((1.0 - 0.2) / 1.8) * 100}%`,
          top: -2, bottom: -2, width: 1.5, background: C.hit, borderRadius: 1, opacity: 0.6,
        }} />
        {/* Thumb */}
        <div style={{
          position: 'absolute', left: `${Math.min(94, pct)}%`,
          top: '50%', transform: 'translate(-50%, -50%)',
          width: 12, height: 12, borderRadius: '50%',
          background: color, boxShadow: `0 0 8px ${color}80`,
          border: '2px solid rgba(15,23,42,0.9)', transition: 'left 0.5s ease',
        }} />
        {/* Fill */}
        <div style={{
          position: 'absolute', left: `${((1.0 - 0.2) / 1.8) * 100}%`,
          top: 0, bottom: 0,
          width: `${Math.abs(pct - ((1.0 - 0.2) / 1.8) * 100)}%`,
          background: color, opacity: 0.35, borderRadius: 4,
          transform: bias < 1 ? 'scaleX(-1)' : undefined,
          transformOrigin: 'left',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 8.5, color: C.dim }}>Under (0.2×)</span>
        <span style={{ fontSize: 8.5, color: C.hit }}>Perfect (1.0×)</span>
        <span style={{ fontSize: 8.5, color: C.dim }}>Over (2.0×)</span>
      </div>
    </div>
  );
}

// ─── Admin editor ─────────────────────────────────────────────────────────────
// A window of the last 30 days + 2 ahead merged with existing DB records.
// Past/today rows edit the predicted value, observed strikes and a hit/miss
// verdict; future rows are prediction-only. The predicted value is uncapped
// (0 → any). Saving writes each touched row to the public ForecastVerification
// entity, so the graph updates for every visitor.
function buildDraftRows(byDate) {
  const tIso = todayIso();
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const rows = [];
  for (let i = EDIT_AHEAD_DAYS; i >= -EDIT_PAST_DAYS; i--) {   // future first, oldest last
    const d = new Date(base); d.setDate(base.getDate() + i);
    const iso = isoOf(d);
    const rec = byDate[iso];
    rows.push({
      date: iso,
      id: rec?.id ?? null,
      forecast_score: (rec && rec.forecast_score != null) ? rec.forecast_score : '',
      observed_strike_count: (rec && rec.observed_strike_count != null) ? rec.observed_strike_count : '',
      hit: rec ? ((rec.hit_rate ?? 0) > 0.5) : false,
      isFuture: iso > tIso,
      isToday: iso === tIso,
    });
  }
  return rows;
}

function EditorPanel({ rows, setRows, onSave, onCancel, saving }) {
  const setField = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };
  const inputStyle = (disabled) => ({
    width: 66, padding: '5px 7px', borderRadius: 7, fontSize: 12, fontFamily: 'monospace',
    color: disabled ? C.dim : C.text, background: disabled ? C.panel : C.chip,
    border: `1px solid ${C.border}`, textAlign: 'center', boxSizing: 'border-box',
  });
  return (
    <div style={{ padding: '14px 16px', borderRadius: 16, background: C.panel, border: `1px solid ${C.border2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.text }}>Edit verification graph</p>
          <p style={{ margin: '2px 0 0', fontSize: 10, color: C.dim }}>Set the predicted value (no upper limit), observed strikes and the hit/miss verdict for each day. Publishes to all visitors on save.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, cursor: saving ? 'default' : 'pointer', fontSize: 11, fontWeight: 700, color: C.muted, background: 'transparent', border: `1px solid ${C.border}` }}>
            <X style={{ width: 13, height: 13 }} /> Cancel
          </button>
          <button type="button" onClick={onSave} disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, cursor: saving ? 'default' : 'pointer', fontSize: 11, fontWeight: 800, color: '#0b1020', background: 'linear-gradient(135deg,#6366f1,#38bdf8)', border: 'none' }}>
            {saving ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Check style={{ width: 14, height: 14 }} />}
            {saving ? 'Saving…' : 'Save & publish'}
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 76px 78px', gap: 8, alignItems: 'center', padding: '6px 4px' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Day</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>Predicted</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>Observed</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center' }}>Verdict</span>
      </div>

      <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
        {rows.map((r, idx) => (
          <div key={r.date} style={{
            display: 'grid', gridTemplateColumns: '1fr 76px 76px 78px', gap: 8, alignItems: 'center',
            padding: '5px 4px', borderTop: `1px solid ${C.grid}`,
            background: r.isToday ? 'rgba(56,189,248,0.06)' : undefined,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{labelOf(r.date)}</span>
              {r.isToday && <span style={{ fontSize: 8.5, fontWeight: 800, color: C.trend, letterSpacing: '0.06em' }}>TODAY</span>}
              {r.isFuture && <span style={{ fontSize: 8.5, fontWeight: 800, color: C.forecast, letterSpacing: '0.06em' }}>+FCST</span>}
            </div>
            <input type="number" min={0} value={r.forecast_score}
              onChange={e => setField(idx, 'forecast_score', e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              placeholder="—" style={{ ...inputStyle(false), justifySelf: 'center' }} />
            <input type="number" min={0} value={r.isFuture ? '' : r.observed_strike_count}
              disabled={r.isFuture}
              onChange={e => setField(idx, 'observed_strike_count', e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              placeholder={r.isFuture ? 'n/a' : '—'} style={{ ...inputStyle(r.isFuture), justifySelf: 'center' }} />
            <button type="button" disabled={r.isFuture}
              onClick={() => setField(idx, 'hit', !r.hit)}
              title={r.isFuture ? 'Not verifiable yet' : 'Toggle hit / miss'}
              style={{
                justifySelf: 'center', width: 74, padding: '5px 0', borderRadius: 7, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em',
                cursor: r.isFuture ? 'default' : 'pointer',
                color: r.isFuture ? C.dim : (r.hit ? C.hit : C.miss),
                background: r.isFuture ? C.panel : (r.hit ? C.hitDim : C.missDim),
                border: `1px solid ${r.isFuture ? C.border : (r.hit ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)')}`,
              }}>
              {r.isFuture ? '—' : (r.hit ? '✓ Hit' : '✗ Miss')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Date-range zoom toolbar ──────────────────────────────────────────────────
function RangeToolbar({ start, end, min, max, onChange, onPreset, activePreset }) {
  const dateInput = {
    padding: '5px 8px', borderRadius: 7, fontSize: 11, fontFamily: 'monospace',
    color: C.text, background: C.chip, border: `1px solid ${C.border}`,
    colorScheme: 'dark', cursor: 'pointer',
  };
  const preset = (id, label) => (
    <button type="button" key={id} onClick={() => onPreset(id)}
      style={{
        padding: '5px 11px', borderRadius: 7, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.03em',
        background: activePreset === id ? 'rgba(56,189,248,0.15)' : 'transparent',
        color: activePreset === id ? C.trend : C.muted,
        border: `1px solid ${activePreset === id ? 'rgba(56,189,248,0.4)' : C.btnBorder}`,
      }}>{label}</button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        <Calendar style={{ width: 12, height: 12 }} /> Range
      </span>
      <input type="date" value={start} min={min} max={end} onChange={e => onChange(e.target.value, end)} style={dateInput} />
      <span style={{ fontSize: 11, color: C.dim }}>→</span>
      <input type="date" value={end} min={start} max={max} onChange={e => onChange(start, e.target.value)} style={dateInput} />
      <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
        {preset('7d', '7d')}
        {preset('30d', '30d')}
        {preset('all', 'All')}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ForecastVerificationChart({ compact: compactProp = false }) {
  const isMobile = useIsMobile();
  const compact = compactProp || isMobile;
  const { isDark } = useTheme();
  applyChartTheme(isDark);
  const [rawData,  setRawData]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [isDemo,   setIsDemo]   = useState(false);
  const [hoveredDay, setHoveredDay] = useState(null);
  const [activeView, setActiveView] = useState('overlay'); // 'overlay' | 'error'

  const [isAdmin, setIsAdmin] = useState(false);
  const [recordsByDate, setRecordsByDate] = useState({});
  const [editing, setEditing] = useState(false);
  const [draftRows, setDraftRows] = useState([]);
  const [saving, setSaving] = useState(false);

  // Date-range zoom (null = full span)
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  const [activePreset, setActivePreset] = useState('all');

  const load = useCallback(async () => {
    try {
      const records = await base44.entities.ForecastVerification.list('-date', 60);
      const byDate = {};
      (records || []).forEach(r => { if (r?.date) byDate[r.date] = r; });
      setRecordsByDate(byDate);

      const tIso = todayIso();
      const inWindow = (records || []).some(r => {
        if (!r?.date) return false;
        const rel = dayNum(r.date) - dayNum(tIso);
        return rel >= -EDIT_PAST_DAYS && rel <= EDIT_AHEAD_DAYS;
      });

      if (inWindow) {
        setRawData(buildSpine(byDate));
        setIsDemo(false);
      } else {
        setRawData(generateDemoData());
        setIsDemo(true);
      }
    } catch {
      setRawData(generateDemoData());
      setIsDemo(true);
      setRecordsByDate({});
    }
    setLoading(false);
  }, []);

  useEffect(() => { base44.auth.me().then(u => setIsAdmin(u?.role === 'admin')).catch(() => {}); }, []);
  useEffect(() => { let alive = true; (async () => { if (alive) await load(); })(); return () => { alive = false; }; }, [load]);

  const openEditor = () => { setDraftRows(buildDraftRows(recordsByDate)); setEditing(true); };

  const saveEdits = async () => {
    setSaving(true);
    try {
      for (const row of draftRows) {
        const fs = row.forecast_score === '' ? null : Number(row.forecast_score);
        const os = row.observed_strike_count === '' ? null : Number(row.observed_strike_count);
        // Only write rows the admin gave data to, or that already exist in the DB.
        if (fs == null && os == null && !row.id) continue;
        const payload = {
          date: row.date,
          region: REGION,
          forecast_score: fs ?? 0,
          observed_strike_count: row.isFuture ? 0 : (os ?? 0),
          hit_rate: row.isFuture ? 0 : (row.hit ? 1 : 0),
        };
        if (row.id) await base44.entities.ForecastVerification.update(row.id, payload);
        else await base44.entities.ForecastVerification.create(payload);
      }
      await load();          // refetch → graph + every visitor updated on next load
      setEditing(false);
    } catch (e) {
      console.warn('[ForecastVerification] save failed:', e?.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Full span + range zoom ──
  const fullData = rawData ?? [];
  const spanStart = fullData[0]?.fullDate ?? todayIso();
  const spanEnd   = fullData[fullData.length - 1]?.fullDate ?? todayIso();
  const effStart  = minIso(maxIso(rangeStart || spanStart, spanStart), spanEnd);
  const effEnd    = maxIso(minIso(rangeEnd || spanEnd, spanEnd), effStart);
  const visibleData = useMemo(
    () => fullData.filter(d => d.fullDate >= effStart && d.fullDate <= effEnd),
    [fullData, effStart, effEnd]
  );

  const setRange = (s, e) => {
    setActivePreset(null);
    setRangeStart(minIso(s || spanStart, e || spanEnd));
    setRangeEnd(maxIso(e || spanEnd, s || spanStart));
  };
  const applyPreset = (id) => {
    setActivePreset(id);
    if (id === 'all') { setRangeStart(null); setRangeEnd(null); return; }
    const tIso = todayIso();
    const back = id === '7d' ? 6 : 29;
    setRangeStart(maxIso(spanStart, isoShift(tIso, -back)));
    setRangeEnd(spanEnd);
  };

  const stats = useMemo(() => visibleData.length ? deriveStats(visibleData) : null, [visibleData]);
  const chartData = stats?.withRolling ?? visibleData;

  // Error series (predicted − observed) — verified days with both values
  const errorData = useMemo(() => chartData.filter(d => !d.isFuture && d.forecastScore != null && d.observedStrikes != null).map(d => ({
    ...d,
    error: d.forecastScore - d.observedStrikes,
  })), [chartData]);

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 20px', gap: 10, color: C.muted }}>
        <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Loading verification data…</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (!fullData.length) return null;

  const TrendIcon = stats?.trendDir === 'up' ? TrendingUp : stats?.trendDir === 'down' ? TrendingDown : Minus;
  const trendColor = stats?.trendDir === 'up' ? C.hit : stats?.trendDir === 'down' ? C.miss : C.muted;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 16 : 22, fontFamily: 'system-ui, sans-serif' }}>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .vchart-view-btn { padding: 5px 13px; border-radius: 7px; font-size: 10.5px; font-weight: 700; cursor: pointer; border: 1px solid ${C.btnBorder}; transition: all 0.18s; letter-spacing: 0.04em; }
        .vchart-view-btn:hover { border-color: ${C.border2}; }
        .vchart-edit-btn:hover { border-color: rgba(139,92,246,0.55) !important; }
      `}</style>

      {/* ── Demo banner ── */}
      {isDemo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          fontSize: 11, color: '#f59e0b', fontWeight: 600,
        }}>
          <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
          {isAdmin ? 'Demo data — click “Edit graph” to enter real predicted & observed values for each day.' : 'Demo data — real verification statistics will appear here soon.'}
        </div>
      )}

      {/* ── Admin editor ── */}
      {isAdmin && editing && (
        <EditorPanel rows={draftRows} setRows={setDraftRows} onSave={saveEdits} onCancel={() => setEditing(false)} saving={saving} />
      )}

      {/* ── Top KPI row ── */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 10 }}>
          {/* Hit rate — big feature card */}
          <div style={{
            padding: '16px 18px', borderRadius: 16,
            background: `linear-gradient(140deg, ${stats.hitPct >= 60 ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.12)'} 0%, ${C.cardDeep} 100%)`,
            border: `1px solid ${stats.hitPct >= 60 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            gridColumn: compact ? 'span 2' : undefined,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Hit Rate</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <TrendIcon style={{ width: 12, height: 12, color: trendColor }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: trendColor }}>
                  {stats.trendDelta > 0 ? `${stats.trendDelta}% in 7d` : 'flat'}
                </span>
              </div>
            </div>
            <p style={{ margin: '0 0 4px', fontSize: 38, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, fontFamily: 'monospace', color: stats.hitPct >= 60 ? C.hit : C.miss }}>
              {stats.hitPct}<span style={{ fontSize: 18, color: C.muted }}>%</span>
            </p>
            <p style={{ margin: 0, fontSize: 11, color: C.muted, fontWeight: 600 }}>
              {stats.hits} hits · {stats.misses} misses in {stats.total} days
            </p>
          </div>

          {/* Skill score */}
          <StatCard label="Skill Score" value={`${stats.skill >= 0 ? '+' : ''}${stats.skill}`}
            sub={`vs climatology baseline`}
            icon={<Target style={{ width: 13, height: 13 }} />}
            accent={stats.skill >= 35 ? C.trend : C.warn}>
            <SkillBadge skill={stats.skill} />
          </StatCard>

          {/* Bias */}
          <StatCard label="Forecast Bias" icon={<Activity style={{ width: 13, height: 13 }} />} accent={Math.abs(stats.bias - 1) > 0.15 ? C.warn : C.hit}>
            <BiasBar bias={stats.bias} />
          </StatCard>

          {/* RMSE */}
          <StatCard label="RMSE" value={stats.rmse}
            sub={`avg ${stats.avgForecast} predicted · ${stats.avgObserved} observed`}
            icon={<BarChart3 style={{ width: 13, height: 13 }} />}
            accent={C.score}>
          </StatCard>
        </div>
      )}

      {/* ── Chart ── */}
      <div style={{ padding: '16px 16px 10px', borderRadius: 16, background: C.panel, border: `1px solid ${C.panelBorder}` }}>
        {/* Chart header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: C.text, letterSpacing: '-0.01em' }}>Verification — up to 30 days + 2-day forecast</p>
            <p style={{ margin: '2px 0 0', fontSize: 10, color: C.dim }}>predicted score vs observed strikes with 7-day rolling hit rate</p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Admin edit toggle */}
            {isAdmin && !editing && (
              <button
                type="button"
                className="vchart-view-btn vchart-edit-btn"
                onClick={openEditor}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', borderColor: 'rgba(139,92,246,0.4)' }}
              >
                <Pencil style={{ width: 12, height: 12 }} /> Edit graph
              </button>
            )}
            {/* View switcher */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[['overlay', 'Overlay'], ['error', 'Error']].map(([id, label]) => (
                <button
                  key={id}
                  className="vchart-view-btn"
                  onClick={() => setActiveView(id)}
                  style={{
                    background: activeView === id ? 'rgba(56,189,248,0.15)' : 'transparent',
                    color: activeView === id ? C.trend : C.muted,
                    borderColor: activeView === id ? 'rgba(56,189,248,0.4)' : undefined,
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Range zoom ── */}
        <RangeToolbar
          start={effStart} end={effEnd} min={spanStart} max={spanEnd}
          onChange={setRange} onPreset={applyPreset} activePreset={activePreset}
        />

        {/* ── Overlay chart ── */}
        {activeView === 'overlay' && (
          <ResponsiveContainer width="100%" height={compact ? 200 : 260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="vScoreGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={C.score} stopOpacity="0.50" />
                  <stop offset="100%" stopColor={C.score} stopOpacity="0.04" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: C.dim, fontFamily: 'monospace' }}
                interval={Math.max(0, Math.floor(chartData.length / 6))}
                axisLine={{ stroke: C.chip }}
                tickLine={false}
              />
              <YAxis
                yAxisId="score"
                tick={{ fontSize: 9, fill: C.dim, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
                domain={[0, d => Math.max(100, Math.ceil((d + 10) / 10) * 10)]}
                allowDataOverflow={false}
              />
              <YAxis
                yAxisId="rolling"
                orientation="right"
                tick={{ fontSize: 9, fill: C.dim, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
                domain={[0, 100]}
                tickFormatter={v => `${v}%`}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: C.panelBorder, strokeWidth: 1 }} />
              {/* Insufficient-data gap — visual annotation only, does not affect scores */}
              {!isDemo && (
                <ReferenceArea
                  yAxisId="score" x1={GAP_START_LABEL} x2={GAP_END_LABEL}
                  fill="rgba(148,163,184,0.13)" fillOpacity={1}
                  stroke="rgba(148,163,184,0.45)" strokeDasharray="3 3"
                  ifOverflow="hidden"
                  label={{ value: 'Insufficient data for Verification', position: 'insideTop', fill: C.muted, fontSize: 8.5, fontWeight: 700 }}
                />
              )}
              {/* Predicted score bars — green/red by hit, indigo for future forecast */}
              <Bar yAxisId="score" dataKey="forecastScore" radius={[4, 4, 0, 0]} barSize={compact ? 10 : 16} name="Predicted Score">
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.isFuture ? C.forecastDim : (d.hit ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.42)')} />
                ))}
              </Bar>
              {/* Observed strikes line — continuous across the whole range */}
              <Line
                yAxisId="score" type="monotone" dataKey="observedStrikes"
                stroke={C.strike} strokeWidth={2} dot={false}
                name="Observed Strikes"
                strokeDasharray="none"
                connectNulls
              />
              {/* 7-day rolling hit rate */}
              <Line
                yAxisId="rolling" type="monotone" dataKey="rollingHit"
                stroke={C.trend} strokeWidth={2.5} dot={false}
                name="7-day Hit Rate"
                strokeDasharray="5 3"
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* ── Error chart ── */}
        {activeView === 'error' && (
          errorData.length ? (
          <ResponsiveContainer width="100%" height={compact ? 200 : 260}>
            <ComposedChart data={errorData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: C.dim, fontFamily: 'monospace' }}
                interval={Math.max(0, Math.floor(errorData.length / 6))}
                axisLine={{ stroke: C.chip }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: C.dim, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: C.panelBorder, strokeWidth: 1 }} />
              <ReferenceLine y={0} stroke={C.refLine} strokeWidth={1.5} strokeDasharray="4 3" label={{ value: 'Perfect', fill: C.dim, fontSize: 9, position: 'insideTopRight' }} />
              <Bar dataKey="error" radius={[3, 3, 0, 0]} barSize={compact ? 10 : 16} name="Forecast Error">
                {errorData.map((d, i) => (
                  <Cell key={i}
                    fill={d.error > 0
                      ? `rgba(249,115,22,${Math.min(0.85, 0.2 + Math.abs(d.error) / 60)})`   // over-forecast orange
                      : `rgba(56,189,248,${Math.min(0.85, 0.2 + Math.abs(d.error) / 60)})`}  // under-forecast blue
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: compact ? 200 : 260, color: C.dim, fontSize: 12 }}>
              No verified days in this range yet.
            </div>
          )
        )}

        {/* Chart legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          {activeView === 'overlay' ? (
            <>
              <LegendDot color={C.hit}      label="Hit day (bars)" />
              <LegendDot color={C.miss}     label="Miss day (bars)" />
              <LegendDot color={C.forecast} label="Forecast (2-day)" />
              <LegendDot color={C.strike}   label="Observed strikes" line />
              <LegendDot color={C.trend}    label="7-day hit rate" line dashed />
            </>
          ) : (
            <>
              <LegendDot color={C.warn}  label="Over-forecast" />
              <LegendDot color={C.trend} label="Under-forecast" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 18, height: 1.5, background: 'rgba(255,255,255,0.25)', borderTop: '1.5px dashed rgba(255,255,255,0.25)' }} />
                <span style={{ fontSize: 9.5, color: C.dim }}>Zero error</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Hit/miss dot row ── */}
      {stats && (
        <div style={{ padding: '14px 16px', borderRadius: 14, background: C.panel, border: `1px solid ${C.panelBorder}` }}>
          <HitMissDots data={chartData} onHover={setHoveredDay} />
          {hoveredDay && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 8, background: hoveredDay.hit ? C.hitDim : C.missDim, border: `1px solid ${hoveredDay.hit ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: hoveredDay.hit ? C.hit : C.miss }}>
                {hoveredDay.hit ? '✓ HIT' : '✗ MISS'}
              </span>
              <span style={{ fontSize: 10.5, color: C.muted }}>{hoveredDay.date}</span>
              <span style={{ fontSize: 10, color: C.dim }}>Predicted {hoveredDay.forecastScore} · Observed {hoveredDay.observedStrikes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function LegendDot({ color, label, line = false, dashed = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {line
        ? <div style={{ width: 18, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
        : <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
      }
      <span style={{ fontSize: 9.5, color: C.dim }}>{label}</span>
    </div>
  );
}
