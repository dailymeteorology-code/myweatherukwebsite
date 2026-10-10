import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart2, Thermometer, Wind, Layers, Activity } from 'lucide-react';
import { useTCMTheme } from './TCMThemeContext';
import { scoreToLevel, RISK_COLOR, RISK_FILL } from './riskConfig';

const HOURS_PER_STEP = 3;
const STEPS_PER_DAY  = 8;

function getRunStartHour(run) {
  if (!run) return 0;
  try { return new Date(run).getUTCHours(); } catch { return 0; }
}

// ─── liquid glass tokens (local, consistent with DayOverview) ────────────────
const G = {
  surface:   'rgba(255,255,255,0.042)',
  panel:     'rgba(255,255,255,0.028)',
  border:    'rgba(255,255,255,0.08)',
  divider:   'rgba(255,255,255,0.06)',
  textPri:   'rgba(255,255,255,0.94)',
  textSec:   'rgba(255,255,255,0.58)',
  textMut:   'rgba(255,255,255,0.34)',
  textDim:   'rgba(255,255,255,0.20)',
};

// Phase colours and icons
const PHASE = {
  Night:     { color: '#6366f1', icon: '🌙', abbr: 'NGT' },
  Morning:   { color: '#38bdf8', icon: '🌤',  abbr: 'MRN' },
  Afternoon: { color: '#f59e0b', icon: '☀️',  abbr: 'AFN' },
  Evening:   { color: '#f97316', icon: '🌇', abbr: 'EVE' },
};

function phaseOf(hour) {
  if (hour < 6)  return 'Night';
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

// ─── sub-components ──────────────────────────────────────────────────────────

// Thin coloured phase strip above bars
const PhaseStrip = ({ steps, peakIdx }) => (
  <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
    {steps.map((d, i) => {
      const ph = PHASE[d.phase];
      return (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: '0.52rem', lineHeight: 1, opacity: i === peakIdx ? 1 : 0.55 }}>{ph.icon}</span>
          <div style={{
            height: i === peakIdx ? 3 : 2,
            width: '100%',
            borderRadius: 2,
            background: ph.color,
            opacity: i === peakIdx ? 1 : 0.30,
            transition: 'all 0.2s',
          }} />
        </div>
      );
    })}
  </div>
);

// Individual bar column
const RiskBar = ({ d, peakIdx, idx, maxH, riskType, lightMode }) => {
  const [hovered, setHovered] = useState(false);
  const isPeak   = idx === peakIdx;
  const isActive = d.stepMax >= 3;
  const barH     = Math.max(3, Math.round((d.stepMax / 100) * maxH));
  const lvl      = scoreToLevel(d.stepMax);
  const rawColor = RISK_COLOR(lvl, riskType);
  const bc       = rawColor === '#64748b' ? 'rgba(255,255,255,0.10)' : rawColor;
  const ph       = PHASE[d.phase];

  return (
    <div
      key={idx}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', cursor: 'default' }}
    >
      {/* PEAK label */}
      {isPeak && isActive && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            position: 'absolute',
            bottom: barH + maxH * 0.05 + 22,
            left: '50%', transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            zIndex: 10, pointerEvents: 'none',
          }}
        >
          <span style={{
            fontSize: '0.46rem', fontWeight: 900, color: bc,
            letterSpacing: '0.10em', whiteSpace: 'nowrap',
            textShadow: `0 0 10px ${bc}99, 0 0 20px ${bc}44`,
            fontFamily: "'DM Mono',monospace",
          }}>▲ PEAK</span>
          <div style={{ width: 1, height: 8, background: bc, opacity: 0.5 }} />
        </motion.div>
      )}

      {/* Score label above bar */}
      <div style={{
        height: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        fontSize: '0.50rem', fontWeight: 800, color: isActive ? bc : 'transparent',
        fontFamily: "'DM Mono',monospace", marginBottom: 2,
        filter: isActive && isPeak ? `drop-shadow(0 0 4px ${bc})` : 'none',
      }}>
        {isActive ? Math.round(d.stepMax) : ''}
      </div>

      {/* The bar */}
      <motion.div
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.6, delay: idx * 0.045, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: '100%', height: barH, borderRadius: '5px 5px 0 0',
          background: isActive
            ? `linear-gradient(0deg, ${bc}33 0%, ${bc}88 55%, ${bc}cc 100%)`
            : lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
          border: `1.5px solid ${isActive ? bc + '66' : 'transparent'}`,
          borderBottom: 'none',
          boxShadow: isPeak && isActive
            ? `0 0 20px ${bc}44, inset 0 1px 0 rgba(255,255,255,0.15)`
            : hovered && isActive ? `0 0 10px ${bc}33` : 'none',
          position: 'relative', overflow: 'hidden',
          transformOrigin: 'bottom',
          transition: 'box-shadow 0.15s',
        }}
      >
        {isPeak && isActive && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, transparent 60%)',
            borderRadius: '5px 5px 0 0',
          }} />
        )}
        {/* Animated shimmer on peak */}
        {isPeak && isActive && (
          <motion.div
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
            style={{
              position: 'absolute', inset: 0, width: '40%',
              background: `linear-gradient(90deg, transparent, ${bc}44, transparent)`,
            }}
          />
        )}
      </motion.div>

      {/* Hover tooltip */}
      <AnimatePresence>
        {hovered && isActive && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            style={{
              position: 'absolute', bottom: barH + 38, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(10,12,28,0.92)', border: `1px solid ${bc}55`,
              borderRadius: 8, padding: '5px 8px', zIndex: 20, minWidth: 80,
              backdropFilter: 'blur(12px)', boxShadow: `0 4px 20px rgba(0,0,0,0.5)`,
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: '0.54rem', color: bc, fontWeight: 800, fontFamily: "'DM Mono',monospace", whiteSpace: 'nowrap' }}>
              {d.hour.toString().padStart(2, '0')}–{((d.hour + 3) % 24).toString().padStart(2, '0')}Z
            </div>
            <div style={{ fontSize: '0.50rem', color: G.textSec, fontFamily: "'DM Mono',monospace" }}>
              Risk: <span style={{ color: bc, fontWeight: 700 }}>{Math.round(d.stepMax)}</span>
            </div>
            {d.avgCape > 0 && <div style={{ fontSize: '0.50rem', color: G.textMut, fontFamily: "'DM Mono',monospace" }}>CAPE {d.avgCape} J/kg</div>}
            {d.avgShear > 0 && <div style={{ fontSize: '0.50rem', color: G.textMut, fontFamily: "'DM Mono',monospace" }}>Shear {d.avgShear.toFixed(0)} kt</div>}
            {d.avgLi != null && <div style={{ fontSize: '0.50rem', color: G.textMut, fontFamily: "'DM Mono',monospace" }}>LI {d.avgLi.toFixed(1)} K</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Micro atmosphere metric bar
const AtmosBar = ({ value, max, color, h = 32, width = '100%', animated = true }) => {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1)) * 100));
  const barH = Math.max(1, Math.round((pct / 100) * h));
  return animated ? (
    <motion.div
      initial={{ height: 0 }}
      animate={{ height: barH }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      style={{
        width, borderRadius: '3px 3px 0 0',
        background: `linear-gradient(0deg, ${color}44, ${color}99)`,
        border: `1px solid ${color}44`, borderBottom: 'none',
        minHeight: 1,
      }}
    />
  ) : <div style={{ width, height: barH, borderRadius: '3px 3px 0 0', background: `${color}66`, minHeight: 1 }} />;
};

// ─── main component ──────────────────────────────────────────────────────────

export default function DiurnalTimingSection({ data, dayIdx, riskType, peakStep, peakLocation, summary, run }) {
  const { t, lightMode } = useTCMTheme();
  const runStartHour = getRunStartHour(run);
  const BAR_H = 110;

  const dayHeadlineScore = useMemo(() => {
    const s = summary?.[riskType];
    if (typeof s === 'number') return Math.max(0, Math.min(100, s));
    let m = 0;
    for (const p of (data?.grid || [])) {
      const sc = p.perDay?.[dayIdx]?.scores?.[riskType] ?? 0;
      if (sc > m) m = sc;
    }
    return m;
  }, [summary, data, dayIdx, riskType]);

  const stepData = useMemo(() => {
    const grid = data?.grid || [];
    return Array.from({ length: STEPS_PER_DAY }).map((_, si) => {
      const globalStep  = dayIdx * STEPS_PER_DAY + si;
      const stepHour    = (runStartHour + si * HOURS_PER_STEP) % 24;
      const phase       = phaseOf(stepHour);

      let stepMax = 0, capeSum = 0, shearSum = 0, liSum = 0, count = 0, stormyCount = 0;
      for (const p of grid) {
        const sc = p.perStep?.[globalStep]?.scores?.[riskType] ?? 0;
        if (sc > stepMax) stepMax = sc;
        const m = p.perStep?.[globalStep]?.scores?.metrics;
        if (m && (m.cape || 0) > 0) {
          capeSum  += m.cape  || 0;
          shearSum += m.shear || 0;
          liSum    += m.li    || 0;
          count++;
        }
        if (sc >= 10) stormyCount++;
      }
      stepMax = Math.min(stepMax, dayHeadlineScore);

      return {
        si, hour: stepHour, stepMax,
        avgCape:  count ? Math.round(capeSum  / count) : 0,
        avgShear: count ? Math.round(shearSum / count * 10) / 10 : 0,
        avgLi:    count ? Math.round(liSum    / count * 10) / 10 : 0,
        stormyCount, lvl: scoreToLevel(stepMax), phase,
      };
    });
  }, [data, dayIdx, riskType, dayHeadlineScore, runStartHour]);

  const computedPeakIdx = useMemo(() => {
    let best = -1, bestVal = -1;
    stepData.forEach((d, i) => { if (d.stepMax > bestVal) { bestVal = d.stepMax; best = i; } });
    return bestVal > 0 ? best : null;
  }, [stepData]);

  const effectivePeak = computedPeakIdx ?? peakStep;
  const peakSD        = effectivePeak != null ? stepData[effectivePeak] : null;

  const peakHrs = peakSD
    ? `${String(peakSD.hour).padStart(2, '0')}:00–${String((peakSD.hour + HOURS_PER_STEP) % 24).padStart(2, '0')}:00 UTC`
    : null;

  const maxCape  = Math.max(...stepData.map(d => d.avgCape),  1);
  const maxShear = Math.max(...stepData.map(d => d.avgShear), 1);

  // ── Atmospheric narrative ────────────────────────────────────────────────
  const atmosNarrative = useMemo(() => {
    const peakCape  = Math.max(...stepData.map(d => d.avgCape));
    const peakShear = Math.max(...stepData.map(d => d.avgShear));
    const minLi     = Math.min(...stepData.map(d => d.avgLi || 0));
    const peakPhase = peakSD?.phase ?? 'Afternoon';

    if (peakCape < 100 && peakShear < 8) {
      return 'A stable, weakly-sheared airmass throughout — convection is heavily suppressed and any showers will be shallow and brief.';
    }
    if (peakCape < 400) {
      return `Marginal instability builds through the ${peakPhase.toLowerCase()} (peak CAPE ~${Math.round(peakCape)} J/kg). Shear ${peakShear < 12 ? 'remains modest' : `at ~${Math.round(peakShear)} kt adds some organisation`}. Isolated weakly-organised showers are the primary expectation.`;
    }
    if (peakCape < 1000) {
      return `Moderate instability develops with CAPE peaking near ${Math.round(peakCape)} J/kg during the ${peakPhase.toLowerCase()} phase. Combined with ~${Math.round(peakShear)} kt deep-layer shear, organised multicell clusters become achievable — locally significant impacts are possible from the stronger cells.`;
    }
    return `Strong instability builds to a peak CAPE of ~${Math.round(peakCape)} J/kg (LI ${minLi.toFixed(1)} K) during the ${peakPhase.toLowerCase()} window. Combined with ${Math.round(peakShear)} kt deep-layer shear, the environment supports organised, potentially severe convection. This is the primary risk window.`;
  }, [stepData, peakSD]);

  // ── Level badge label cells (below bars) ──────────────────────────────────
  const barColor = (lvl) => {
    const c = RISK_COLOR(lvl, riskType);
    return c === '#64748b' ? 'rgba(255,255,255,0.07)' : c;
  };

  return (
    <div style={{ paddingTop: 4 }}>

      {/* Region/aggregation badge */}
      <div style={{ marginBottom: 10 }}>
        <span style={{
          fontSize: '0.55rem', padding: '2px 8px', borderRadius: 99,
          background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.22)',
          color: '#38bdf8', fontWeight: 700, fontFamily: "'DM Mono',monospace",
          letterSpacing: '0.07em',
        }}>
          UK-WIDE ENSEMBLE · peak across all grid cells
        </span>
      </div>

      {/* Phase strip */}
      <PhaseStrip steps={stepData} peakIdx={effectivePeak} />

      {/* ── RISK BARS ── */}
      <div style={{ position: 'relative', marginBottom: 2 }}>
        {/* Grid lines */}
        {[25, 50, 75, 100].map(v => (
          <div key={v} style={{
            position: 'absolute', left: 0, right: 0,
            bottom: 38 + (v / 100) * BAR_H,
            borderTop: `1px dashed ${v === 100 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)'}`,
            pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', right: 2, top: -8,
              fontSize: '0.42rem', color: G.textDim,
              fontFamily: "'DM Mono',monospace", lineHeight: 1,
            }}>{v}</span>
          </div>
        ))}

        {/* Bar columns */}
        <div style={{
          display: 'flex', gap: 3, alignItems: 'flex-end',
          height: BAR_H + 36, paddingBottom: 36, paddingRight: 14,
        }}>
          {stepData.map((d, i) => (
            <RiskBar
              key={i} d={d} idx={i}
              peakIdx={effectivePeak}
              maxH={BAR_H} riskType={riskType}
              lightMode={lightMode}
            />
          ))}
        </div>

        {/* UTC hour labels */}
        <div style={{ display: 'flex', gap: 3, paddingRight: 14 }}>
          {stepData.map((d, i) => {
            const ph = PHASE[d.phase];
            const isPeak = i === effectivePeak;
            return (
              <div key={i} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '3px 0', gap: 1,
                background: isPeak ? `${ph.color}10` : 'transparent',
                borderRadius: 6, border: isPeak ? `1px solid ${ph.color}22` : '1px solid transparent',
                transition: 'all 0.2s',
              }}>
                <div style={{ width: 1, height: 4, background: G.textMut, opacity: 0.4 }} />
                <span style={{
                  fontSize: '0.50rem', color: isPeak ? ph.color : G.textMut,
                  fontFamily: "'DM Mono',monospace", fontWeight: isPeak ? 800 : 600,
                  lineHeight: 1,
                }}>{String(d.hour).padStart(2, '0')}Z</span>
                <span style={{
                  fontSize: '0.42rem', color: ph.color, fontWeight: 700, opacity: 0.65,
                  letterSpacing: '0.04em',
                }}>{ph.abbr}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Level label cells */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 14, paddingRight: 14 }}>
        {stepData.map((d, i) => {
          const bc = barColor(d.lvl);
          const isActive = d.stepMax >= 3;
          const isPeak   = i === effectivePeak;
          return (
            <div key={i} style={{
              flex: 1, padding: '2px 1px',
              background: isActive ? `${bc}12` : 'transparent',
              border: `1px solid ${isActive ? bc + '33' : 'transparent'}`,
              borderRadius: 5, textAlign: 'center',
              boxShadow: isPeak && isActive ? `0 0 8px ${bc}22` : 'none',
            }}>
              {isActive && (
                <span style={{
                  fontSize: '0.42rem', fontWeight: 800, color: bc,
                  fontFamily: "'DM Mono',monospace", letterSpacing: '0.04em',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
                }}>
                  {d.lvl === 'No Risk' ? '—' : d.lvl.slice(0, 4).toUpperCase()}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── ATMOSPHERIC TREND PANEL ── */}
      <div style={{
        background: G.panel,
        border: `1px solid ${G.border}`,
        borderRadius: 14,
        padding: '12px 14px',
        marginBottom: 12,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}>
        {/* Panel header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
          paddingBottom: 8, borderBottom: `1px solid ${G.divider}`,
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: 6,
            background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChart2 style={{ width: 10, height: 10, color: '#38bdf8' }} />
          </div>
          <span style={{
            fontSize: '0.60rem', fontWeight: 800, color: G.textSec,
            textTransform: 'uppercase', letterSpacing: '0.10em', fontFamily: "'DM Mono',monospace",
          }}>Atmospheric Trend</span>
          <div style={{ flex: 1, height: '0.5px', background: G.divider, marginLeft: 4 }} />
          <span style={{ fontSize: '0.52rem', color: G.textMut, fontFamily: "'DM Mono',monospace" }}>
            3-hourly averages · active cells only
          </span>
        </div>

        {/* Metric rows with labels */}
        {[
          {
            key: 'cape', label: 'CAPE', unit: 'J/kg', color: '#ef4444',
            icon: Thermometer, h: 36,
            values: stepData.map(d => d.avgCape),
            max: maxCape,
          },
          {
            key: 'shear', label: 'Shear', unit: 'kt', color: '#38bdf8',
            icon: Wind, h: 24,
            values: stepData.map(d => d.avgShear),
            max: maxShear,
          },
          {
            key: 'li', label: 'LI', unit: 'K', color: '#a78bfa',
            icon: Layers, h: 22,
            values: stepData.map(d => Math.abs(Math.min(d.avgLi || 0, 0))),
            max: 8,
            inverted: true,
          },
        ].map(({ key, label, unit, color, icon: Icon, h, values, max, inverted }) => {
          const peakVal = inverted
            ? Math.min(...stepData.map(d => d.avgLi || 0))
            : Math.max(...values);
          return (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <Icon style={{ width: 9, height: 9, color, opacity: 0.7 }} />
                <span style={{ fontSize: '0.54rem', color: G.textMut, fontFamily: "'DM Mono',monospace", fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {label}
                </span>
                <span style={{ fontSize: '0.52rem', color, fontWeight: 800, fontFamily: "'DM Mono',monospace", marginLeft: 'auto' }}>
                  {inverted ? `min ${peakVal.toFixed(1)}` : `max ${Math.round(peakVal)}`} {unit}
                </span>
              </div>
              <div style={{
                display: 'flex', gap: 2.5,
                alignItems: inverted ? 'flex-start' : 'flex-end',
                height: h,
              }}>
                {values.map((v, i) => {
                  const isPk = i === effectivePeak;
                  const pct  = Math.max(0, Math.min(1, v / Math.max(max, 1)));
                  const barH = Math.max(1, Math.round(pct * h));
                  const isOn = v > (inverted ? 0.5 : max * 0.05);
                  return (
                    <div key={i} style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: inverted ? 'flex-start' : 'flex-end',
                      height: h,
                    }}>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: barH }}
                        transition={{ duration: 0.5, delay: i * 0.04 }}
                        style={{
                          width: '80%', minHeight: 1,
                          borderRadius: inverted ? '0 0 3px 3px' : '3px 3px 0 0',
                          background: isOn
                            ? `linear-gradient(${inverted ? '180deg' : '0deg'}, ${color}44, ${color}88)`
                            : lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isOn ? color + '40' : 'transparent'}`,
                          [inverted ? 'borderTop' : 'borderBottom']: 'none',
                          boxShadow: isPk && isOn ? `0 0 6px ${color}44` : 'none',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Narrative */}
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: 'rgba(255,255,255,0.02)',
          border: `1px solid ${G.divider}`,
          borderRadius: 8,
        }}>
          <p style={{ margin: 0, fontSize: '0.68rem', lineHeight: 1.6, color: G.textSec, fontStyle: 'italic' }}>
            {atmosNarrative}
          </p>
        </div>
      </div>

      {/* ── PEAK CONVECTIVE WINDOW CALLOUT ── */}
      {effectivePeak != null && peakSD && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          style={{
            display: 'flex', alignItems: 'stretch', gap: 0,
            background: 'rgba(167,139,250,0.08)',
            border: '1px solid rgba(167,139,250,0.22)',
            borderRadius: 12, overflow: 'hidden',
          }}
        >
          {/* Left accent bar */}
          <div style={{
            width: 3, flexShrink: 0,
            background: 'linear-gradient(180deg, #a78bfa, #7c3aed)',
          }} />

          <div style={{ flex: 1, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Pulse dot */}
            <motion.div
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ width: 8, height: 8, borderRadius: 99, background: '#a78bfa', boxShadow: '0 0 10px #a78bfa', flexShrink: 0 }}
            />

            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{
                fontSize: '0.60rem', fontWeight: 800, color: '#a78bfa',
                textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 3,
                fontFamily: "'DM Mono',monospace",
              }}>Peak Convective Window</div>
              <div style={{ fontSize: '0.76rem', color: G.textSec, lineHeight: 1.5 }}>
                <strong style={{ color: G.textPri, fontFamily: "'DM Mono',monospace" }}>{peakHrs}</strong>
                {peakLocation?.bearing && (
                  <> · Focus: <strong style={{ color: G.textPri }}>{peakLocation.bearing}</strong></>
                )}
              </div>
            </div>

            {/* Metric tiles */}
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { label: 'Risk',  value: `${Math.round(peakSD.stepMax)}`, unit: '/100', color: barColor(peakSD.lvl) },
                { label: 'CAPE',  value: `${peakSD.avgCape}`,             unit: 'J/kg', color: '#ef4444' },
                { label: 'Shear', value: `${peakSD.avgShear.toFixed(0)}`, unit: 'kt',   color: '#38bdf8' },
              ].map(m => (
                <div key={m.label} style={{
                  padding: '5px 9px',
                  background: `${m.color}0d`,
                  border: `1px solid ${m.color}28`,
                  borderRadius: 8, textAlign: 'center',
                  backdropFilter: 'blur(4px)',
                }}>
                  <div style={{ fontSize: '0.46rem', color: G.textMut, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'DM Mono',monospace", marginBottom: 1 }}>{m.label}</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 900, color: m.color, fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
                    {m.value}<span style={{ fontSize: '0.50rem', fontWeight: 600, opacity: 0.7 }}>{m.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}