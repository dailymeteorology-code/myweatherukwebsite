import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloudLightning, Zap, Wind, AlertTriangle, Play, Pause, RefreshCw, Loader2, Layers } from 'lucide-react';
import { RISK_LEVELS } from './RiskGridLayer';

const RISK_TYPES = [
  { id: 'lightning', label: 'Lightning', icon: CloudLightning, color: '#a78bfa' },
  { id: 'hail',      label: 'Hail',      icon: Zap,            color: '#38bdf8' },
  { id: 'tornado',   label: 'Tornado',   icon: AlertTriangle,  color: '#f97316' },
  { id: 'wind',      label: 'Wind',      icon: Wind,           color: '#34d399' },
];

// CHANGED: was 3 days, now 4 to match the grid's TOTAL_STEPS (32 steps = 4 days)
const DAY_LABELS = ['Today', 'Tomorrow', 'Day 3', 'Day 4'];

/**
 * Controls panel for the risk-grid overlay on the interactive map.
 * Includes: risk-type selector, day selector with play/pause, refresh, legend.
 *
 * CHANGED: DAY_LABELS extended to 4 days; play loop now cycles 0-3.
 */
export default function RiskMapControls({
  activeRiskType, onRiskTypeChange,
  activeDay,      onDayChange,
  showPolygons,   onTogglePolygons,
  showCells,      onToggleCells,
  onRefresh,
  loading,
  generatedAt,
  modelRun,
}) {
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(null);

  useEffect(() => {
    if (!playing) { clearInterval(playRef.current); return; }
    // CHANGED: mod 4 instead of mod 3
    playRef.current = setInterval(() => {
      onDayChange((activeDay + 1) % 4);
    }, 2500);
    return () => clearInterval(playRef.current);
  }, [playing, activeDay, onDayChange]);

  return (
    <div style={{
      background: 'rgba(6,13,26,0.95)',
      border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 14,
      padding: '12px 14px',
      backdropFilter: 'blur(14px)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(167,139,250,0.25), rgba(56,189,248,0.18))',
          border: '1px solid rgba(167,139,250,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Layers style={{ width: 13, height: 13, color: '#c4b5fd' }} />
        </div>
        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
          Convective Risk Outlook
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onRefresh} disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#94a3b8', fontSize: '0.68rem', fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer',
          }}>
          {loading
            ? <Loader2 style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} />
            : <RefreshCw style={{ width: 11, height: 11 }} />}
          Refresh
        </button>
      </div>

      {/* Risk type pills */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {RISK_TYPES.map(rt => {
          const Icon = rt.icon;
          const active = activeRiskType === rt.id;
          return (
            <button key={rt.id} onClick={() => onRiskTypeChange(rt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 9,
                fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${active ? rt.color : 'rgba(255,255,255,0.08)'}`,
                background: active ? `${rt.color}26` : 'rgba(255,255,255,0.03)',
                color: active ? rt.color : '#64748b',
                transition: 'all 0.2s',
              }}>
              <Icon style={{ width: 11, height: 11 }} />
              {rt.label}
            </button>
          );
        })}
      </div>

      {/* Day selector with play/pause */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => setPlaying(p => !p)}
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: playing ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${playing ? '#a78bfa' : 'rgba(255,255,255,0.1)'}`,
            color: playing ? '#a78bfa' : '#94a3b8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}>
          {playing ? <Pause style={{ width: 12, height: 12 }} /> : <Play style={{ width: 12, height: 12 }} />}
        </button>
        <div style={{ display: 'flex', flex: 1, gap: 4 }}>
          {DAY_LABELS.map((lbl, i) => (
            <button key={i} onClick={() => { setPlaying(false); onDayChange(i); }}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 8,
                fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${i === activeDay ? '#facc15' : 'rgba(255,255,255,0.08)'}`,
                background: i === activeDay ? 'rgba(250,204,21,0.12)' : 'rgba(255,255,255,0.03)',
                color: i === activeDay ? '#facc15' : '#64748b',
                transition: 'all 0.2s',
              }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Overlay toggles */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <button onClick={onToggleCells}
          style={{
            padding: '4px 10px', borderRadius: 7, fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer',
            background: showCells ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${showCells ? '#38bdf8' : 'rgba(255,255,255,0.08)'}`,
            color: showCells ? '#38bdf8' : '#475569',
          }}>
          {showCells ? '☑' : '☐'} Data shading
        </button>
        <button onClick={onTogglePolygons}
          style={{
            padding: '4px 10px', borderRadius: 7, fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer',
            background: showPolygons ? 'rgba(249,115,22,0.14)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${showPolygons ? '#f97316' : 'rgba(255,255,255,0.08)'}`,
            color: showPolygons ? '#f97316' : '#475569',
          }}>
          {showPolygons ? '☑' : '☐'} Risk areas (contours)
        </button>
      </div>

      {/* Legend */}
      <div style={{
        padding: '8px 10px', borderRadius: 9,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <p style={{ margin: '0 0 6px', fontSize: '0.58rem', fontWeight: 800, color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          % chance within 40 km
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {RISK_LEVELS.filter(l => l.threshold > 0).map(lvl => (
            <div key={lvl.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 14, height: 9, borderRadius: 2, background: lvl.color, opacity: lvl.fillOpacity + 0.15 }} />
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#e2e8f0' }}>{lvl.label}</span>
              <span style={{ fontSize: '0.62rem', color: '#64748b', fontFamily: 'monospace' }}>
                {lvl.threshold === 60 ? '≥60%' : `${lvl.threshold}–${RISK_LEVELS.find(l => l.threshold > lvl.threshold)?.threshold || 100}%`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer — model run */}
      {(generatedAt || modelRun) && (
        <div style={{ fontSize: '0.6rem', color: '#475569', fontFamily: 'monospace', letterSpacing: '0.02em', lineHeight: 1.5 }}>
          {modelRun    && <div style={{ wordBreak: 'break-word' }}>{modelRun}</div>}
          {generatedAt && <div>Built {new Date(generatedAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</div>}
        </div>
      )}
    </div>
  );
}