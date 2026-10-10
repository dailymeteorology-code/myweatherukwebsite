import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Info, FileText, BarChart2, ChevronDown, MapPin, Filter,
  Zap, CloudRain, Wind, Shield, AlertTriangle, TrendingUp,
  Clock, Activity, Eye, Droplets, Gauge, Layers, Thermometer,
  Navigation, Target, Radar,
} from 'lucide-react';
import DiurnalTimingSection from '@/components/tcm/DiurnalTimingSection';
import SkewT from '@/components/tcm/SkewT';

// ─────────────────────────────────────────────────────────────────────────────
// LIQUID GLASS — master token system
// ─────────────────────────────────────────────────────────────────────────────
const G = {
  // Surfaces
  surface:       'rgba(255,255,255,0.042)',
  surfaceHover:  'rgba(255,255,255,0.068)',
  panel:         'rgba(255,255,255,0.026)',
  panelHover:    'rgba(255,255,255,0.044)',
  tile:          'rgba(255,255,255,0.050)',
  tileBorder:    'rgba(255,255,255,0.09)',
  // Borders
  border:        'rgba(255,255,255,0.08)',
  borderStrong:  'rgba(255,255,255,0.14)',
  divider:       'rgba(255,255,255,0.06)',
  // Text
  textPri:       'rgba(255,255,255,0.95)',
  textSec:       'rgba(255,255,255,0.60)',
  textMut:       'rgba(255,255,255,0.36)',
  textDim:       'rgba(255,255,255,0.20)',
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-risk visual identities — each type has a completely distinct
// gradient, colour palette, and atmosphere
// ─────────────────────────────────────────────────────────────────────────────
const RISK_IDENTITY = {
  thunderstorm: {
    icon: Zap,
    heroGradient: `
      radial-gradient(ellipse 130% 90% at 90% -15%, rgba(139,92,246,0.38) 0%, transparent 52%),
      radial-gradient(ellipse 80% 60% at 5% 85%,  rgba(79,70,229,0.20)  0%, transparent 48%),
      radial-gradient(ellipse 50% 40% at 50% 50%, rgba(109,40,217,0.08) 0%, transparent 60%),
      linear-gradient(165deg, rgba(12,8,38,0.95) 0%, rgba(8,6,28,0.98) 100%)
    `,
    cardBorder:   'rgba(139,92,246,0.30)',
    cardShadow:   '0 0 0 1px rgba(139,92,246,0.16), 0 12px 60px rgba(139,92,246,0.14), 0 4px 20px rgba(0,0,0,0.4)',
    accent:       '#8b5cf6',
    accentLight:  '#c4b5fd',
    accentMid:    '#7c3aed',
    accentBorder: 'rgba(196,181,253,0.28)',
    accentFill:   'rgba(139,92,246,0.10)',
    glow:         'rgba(139,92,246,0.55)',
    scoreColor:   '#a78bfa',
    orb1: { color: 'rgba(109,40,217,0.22)', top: -100, right: -80, size: 280 },
    orb2: { color: 'rgba(79,70,229,0.14)',  bottom: 80, left: -100, size: 320 },
    orb3: { color: 'rgba(167,139,250,0.06)', top: '40%', right: '20%', size: 200 },
    tagline: 'Convective Activity',
    metrics: { cape: '#c084fc', shear: '#818cf8', gust: '#e879f9', hail: '#7dd3fc', tornado: '#fb923c', supercell: '#a78bfa' },
    bars:    { tornado: '#fb923c', hail: '#7dd3fc', flashFlood: '#38bdf8', strongWinds: '#c084fc', supercell: '#f472b6', cape: '#a78bfa' },
  },
  hail: {
    icon: CloudRain,
    heroGradient: `
      radial-gradient(ellipse 120% 80% at 85% -10%, rgba(14,165,233,0.35)  0%, transparent 52%),
      radial-gradient(ellipse 70% 55% at 0%  90%,  rgba(6,182,212,0.18)   0%, transparent 48%),
      radial-gradient(ellipse 45% 35% at 45% 55%, rgba(2,132,199,0.08)   0%, transparent 60%),
      linear-gradient(165deg, rgba(3,16,36,0.95) 0%, rgba(2,12,30,0.98) 100%)
    `,
    cardBorder:   'rgba(14,165,233,0.28)',
    cardShadow:   '0 0 0 1px rgba(14,165,233,0.15), 0 12px 60px rgba(14,165,233,0.12), 0 4px 20px rgba(0,0,0,0.4)',
    accent:       '#0ea5e9',
    accentLight:  '#7dd3fc',
    accentMid:    '#0284c7',
    accentBorder: 'rgba(125,211,252,0.26)',
    accentFill:   'rgba(14,165,233,0.09)',
    glow:         'rgba(14,165,233,0.55)',
    scoreColor:   '#38bdf8',
    orb1: { color: 'rgba(3,105,161,0.24)', top: -90,  right: -70,  size: 260 },
    orb2: { color: 'rgba(6,182,212,0.12)', bottom: 60, left: -90,  size: 300 },
    orb3: { color: 'rgba(56,189,248,0.05)', top: '35%', right: '15%', size: 180 },
    tagline: 'Large Hail Potential',
    metrics: { hailMm: '#7dd3fc', cape: '#38bdf8', shear: '#bae6fd', gust: '#67e8f9', precip: '#0ea5e9' },
    bars:    { tornado: '#fb923c', hail: '#7dd3fc', flashFlood: '#38bdf8', strongWinds: '#bae6fd', supercell: '#22d3ee', cape: '#0ea5e9' },
  },
  tornado: {
    icon: Wind,
    heroGradient: `
      radial-gradient(ellipse 125% 85% at 85% -12%, rgba(239,68,68,0.36)  0%, transparent 52%),
      radial-gradient(ellipse 75% 55% at 0%  88%,  rgba(220,38,38,0.18)  0%, transparent 48%),
      radial-gradient(ellipse 48% 38% at 48% 52%, rgba(185,28,28,0.08)  0%, transparent 60%),
      linear-gradient(165deg, rgba(36,4,4,0.95) 0%, rgba(28,3,3,0.98) 100%)
    `,
    cardBorder:   'rgba(239,68,68,0.28)',
    cardShadow:   '0 0 0 1px rgba(239,68,68,0.15), 0 12px 60px rgba(239,68,68,0.12), 0 4px 20px rgba(0,0,0,0.4)',
    accent:       '#ef4444',
    accentLight:  '#fca5a5',
    accentMid:    '#dc2626',
    accentBorder: 'rgba(252,165,165,0.26)',
    accentFill:   'rgba(239,68,68,0.09)',
    glow:         'rgba(239,68,68,0.58)',
    scoreColor:   '#f87171',
    orb1: { color: 'rgba(185,28,28,0.24)', top: -95,  right: -75,  size: 270 },
    orb2: { color: 'rgba(239,68,68,0.12)', bottom: 70, left: -95,  size: 310 },
    orb3: { color: 'rgba(248,113,113,0.05)', top: '38%', right: '18%', size: 190 },
    tagline: 'Tornado Risk',
    metrics: { srh: '#fca5a5', shear: '#f87171', cape: '#ef4444', gust: '#fb923c', tornado: '#ff6b6b' },
    bars:    { tornado: '#fca5a5', hail: '#7dd3fc', flashFlood: '#38bdf8', strongWinds: '#f87171', supercell: '#f97316', cape: '#ef4444' },
  },
  lightning: {
    icon: Zap,
    heroGradient: `
      radial-gradient(ellipse 125% 85% at 85% -12%, rgba(234,179,8,0.34)  0%, transparent 52%),
      radial-gradient(ellipse 72% 52% at 0%  88%,  rgba(202,138,4,0.16)  0%, transparent 48%),
      radial-gradient(ellipse 46% 36% at 48% 52%, rgba(161,98,7,0.08)   0%, transparent 60%),
      linear-gradient(165deg, rgba(28,18,0,0.95) 0%, rgba(20,13,0,0.98) 100%)
    `,
    cardBorder:   'rgba(234,179,8,0.28)',
    cardShadow:   '0 0 0 1px rgba(234,179,8,0.15), 0 12px 60px rgba(234,179,8,0.12), 0 4px 20px rgba(0,0,0,0.4)',
    accent:       '#eab308',
    accentLight:  '#fde047',
    accentMid:    '#ca8a04',
    accentBorder: 'rgba(253,224,71,0.26)',
    accentFill:   'rgba(234,179,8,0.09)',
    glow:         'rgba(234,179,8,0.55)',
    scoreColor:   '#facc15',
    orb1: { color: 'rgba(161,98,7,0.24)', top: -90,  right: -70,  size: 260 },
    orb2: { color: 'rgba(234,179,8,0.12)', bottom: 65, left: -90,  size: 300 },
    orb3: { color: 'rgba(250,204,21,0.05)', top: '36%', right: '16%', size: 185 },
    tagline: 'Lightning Density',
    metrics: { cape: '#fde047', precip: '#fbbf24', coverage: '#f59e0b', shear: '#fef08a', gust: '#fdba74' },
    bars:    { tornado: '#fb923c', hail: '#7dd3fc', flashFlood: '#fde047', strongWinds: '#fbbf24', supercell: '#f59e0b', cape: '#facc15' },
  },
};

const getRiskIdentity = (rt) => RISK_IDENTITY[rt] ?? RISK_IDENTITY.thunderstorm;

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// Animated SVG score arc
const ScoreRing = ({ score, color, size = 60 }) => {
  const r    = (size - 7) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - Math.min(score, 100) / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="rgba(255,255,255,0.07)" strokeWidth={3.5} />
        {/* Glow track */}
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={`${color}20`} strokeWidth={6} />
        {/* Fill arc */}
        <motion.circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={color} strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: fill }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 5px ${color}88)` }}
        />
        {/* Score text */}
        <text
          x={size/2} y={size/2 + 1}
          textAnchor="middle" dominantBaseline="middle"
          fill={color}
          fontSize={score >= 100 ? 11 : 14}
          fontWeight={900}
          fontFamily="'DM Mono',monospace"
          style={{ transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px` }}
        >{score}</text>
      </svg>
    </div>
  );
};

// Glass panel wrapper with optional accent tint
const GlassPanel = ({ children, style = {}, accent, hover = false }) => {
  const [isHover, setIsHover] = useState(false);
  return (
    <div
      onMouseEnter={hover ? () => setIsHover(true) : undefined}
      onMouseLeave={hover ? () => setIsHover(false) : undefined}
      style={{
        background: accent
          ? `linear-gradient(140deg, ${accent}0a 0%, rgba(255,255,255,0.018) 100%)`
          : isHover ? G.panelHover : G.panel,
        border: `1px solid ${accent ? accent + '20' : isHover ? G.borderStrong : G.border}`,
        borderRadius: 18,
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxShadow: accent
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.2)`
          : `inset 0 1px 0 rgba(255,255,255,0.04)`,
        transition: 'background 0.2s, border-color 0.2s',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// Level badge
const LevelBadge = ({ level, pal, identity }) => {
  const critical = ['High', 'Severe'].includes(level);
  const warn     = level === 'Moderate';
  const mild     = ['Slight', 'Marginal'].includes(level);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 13px', borderRadius: 99,
      background: `linear-gradient(135deg, ${pal.fill}, ${pal.fill}66)`,
      border: `1px solid ${pal.border}`,
      backdropFilter: 'blur(8px)',
      fontSize: '0.70rem', fontWeight: 900, color: pal.border,
      letterSpacing: '0.08em', textTransform: 'uppercase',
      boxShadow: critical ? `0 0 18px ${identity.glow}, inset 0 1px 0 rgba(255,255,255,0.10)`
                : warn ? `0 0 10px ${identity.glow}55`
                : `inset 0 1px 0 rgba(255,255,255,0.06)`,
    }}>
      {critical ? (
        <motion.span
          animate={{ opacity: [1, 0.25, 1] }}
          transition={{ duration: 0.75, repeat: Infinity }}
          style={{ width: 6, height: 6, borderRadius: 99, background: pal.border, display: 'inline-block', boxShadow: `0 0 6px ${pal.border}` }}
        />
      ) : (
        <span style={{ width: 5, height: 5, borderRadius: 99, background: pal.border, display: 'inline-block', opacity: mild ? 0.7 : 1 }} />
      )}
      {level}
    </span>
  );
};

// Stat tile — glass with pulsing radial glow
const StatTile = ({ label, value, sub, color, icon: Icon, pulse = false, highlight = false, footnote }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '12px 14px',
        background: highlight
          ? `linear-gradient(135deg, ${color}14 0%, ${color}06 100%)`
          : hover ? G.tile : `${G.tile}bb`,
        border: `1px solid ${highlight ? color + '2a' : hover ? G.tileBorder : G.border}`,
        borderRadius: 16,
        flex: '1 1 0', minWidth: 0,
        position: 'relative', overflow: 'hidden',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        boxShadow: highlight
          ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 20px ${color}18`
          : `inset 0 1px 0 rgba(255,255,255,0.05)`,
        transition: 'all 0.2s',
      }}
    >
      {pulse && (
        <motion.div
          animate={{ opacity: [0, 0.35, 0], scale: [0.6, 1.5, 0.6] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(circle at 75% 15%, ${color}40 0%, transparent 65%)`,
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Top shimmer line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${color}40, transparent)`,
      }} />

      {Icon && (
        <div style={{
          width: 22, height: 22, borderRadius: 7,
          background: `${color}15`, border: `1px solid ${color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 8,
        }}>
          <Icon style={{ width: 11, height: 11, color }} />
        </div>
      )}

      <div style={{
        fontSize: '0.52rem', fontWeight: 700, color: G.textMut,
        textTransform: 'uppercase', letterSpacing: '0.10em',
        fontFamily: "'DM Mono',monospace", marginBottom: 4,
      }}>{label}</div>

      <div style={{
        fontSize: '1.05rem', fontWeight: 900, color,
        fontFamily: "'DM Mono',monospace", lineHeight: 1,
        filter: highlight ? `drop-shadow(0 0 6px ${color}66)` : 'none',
      }}>{value}</div>

      {sub && <div style={{ fontSize: '0.55rem', color: G.textMut, marginTop: 4, fontFamily: "'DM Mono',monospace" }}>{sub}</div>}
      {footnote && <div style={{ fontSize: '0.50rem', color: G.textDim, marginTop: 2 }}>{footnote}</div>}
    </div>
  );
};

// Hazard bar with dual-zone colour shift
const HazardBar = ({ label, value, max = 100, color, unit = '', hint }) => {
  const pct     = Math.min(100, (value / max) * 100);
  const critical = pct > 75;
  const warning  = pct > 45;
  const fillCol  = critical ? '#ef4444' : warning ? '#f59e0b' : color;
  const [hov, setHov] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
        <span style={{ fontSize: '0.67rem', color: G.textSec, fontWeight: 600 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {hint && hov && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ fontSize: '0.54rem', color: G.textMut, fontStyle: 'italic' }}
            >{hint}</motion.span>
          )}
          <span style={{
            fontSize: '0.70rem', color: fillCol, fontWeight: 900,
            fontFamily: "'DM Mono',monospace",
            textShadow: critical ? `0 0 10px ${fillCol}88` : 'none',
          }}>{value}{unit}</span>
        </div>
      </div>
      <div style={{
        height: 5.5, background: 'rgba(255,255,255,0.04)',
        borderRadius: 99, overflow: 'hidden',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.35)',
        position: 'relative',
      }}>
        {/* Background segments */}
        <div style={{
          position: 'absolute', left: '45%', top: 0, bottom: 0, width: 1,
          background: 'rgba(255,255,255,0.08)',
        }} />
        <div style={{
          position: 'absolute', left: '75%', top: 0, bottom: 0, width: 1,
          background: 'rgba(255,255,255,0.08)',
        }} />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{
            height: '100%', borderRadius: 99,
            background: `linear-gradient(90deg, ${color}88 0%, ${fillCol} 100%)`,
            boxShadow: pct > 25 ? `0 0 8px ${fillCol}66` : 'none',
            position: 'relative', overflow: 'hidden',
          }}
        >
          {/* Shimmer */}
          {pct > 20 && (
            <motion.div
              animate={{ x: ['-100%', '300%'] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 2, ease: 'easeInOut' }}
              style={{
                position: 'absolute', inset: 0, width: '30%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
              }}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
};

// Section header with icon, label, divider, and optional right slot
const SectionHeader = ({ icon: Icon, label, color, right, sub }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 8,
        background: `${color}14`, border: `1px solid ${color}28`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08)`,
      }}>
        <Icon style={{ width: 12, height: 12, color }} />
      </div>
      <span style={{
        fontSize: '0.65rem', fontWeight: 900, color,
        textTransform: 'uppercase', letterSpacing: '0.12em',
      }}>{label}</span>
      {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
      <div style={{ flex: right ? 'unset' : 1, height: '0.5px', background: `${color}18`, marginLeft: right ? 0 : 4 }} />
    </div>
    {sub && <p style={{ margin: '5px 0 0 34px', fontSize: '0.62rem', color: G.textMut, lineHeight: 1.5 }}>{sub}</p>}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// STORM-INTELLIGENCE SUB-COMPONENTS  (new — surface the ingredients-based
// engine's descriptive outputs: storm mode, confidence, motion, plume, etc.)
// ─────────────────────────────────────────────────────────────────────────────

// 16-point compass label from a meteorological "moving toward" bearing.
const COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const bearingToCompass = (deg) => COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// Small SVG compass showing the direction a storm is moving toward.
const StormMotionCompass = ({ dir, mph, color, size = 64 }) => {
  const c = size / 2;
  const rad = ((dir ?? 0) - 90) * Math.PI / 180; // 0° = N (up); SVG 0° points east
  const len = c - 12;
  const tipX = c + len * Math.cos(rad);
  const tipY = c + len * Math.sin(rad);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={c} cy={c} r={c - 3} fill="rgba(255,255,255,0.03)" stroke={`${color}40`} strokeWidth={1} />
        {['N','E','S','W'].map((lbl, i) => {
          const a = (i * 90 - 90) * Math.PI / 180;
          return (
            <text key={lbl}
              x={c + (c - 9) * Math.cos(a)} y={c + (c - 9) * Math.sin(a) + 3}
              textAnchor="middle" fontSize={7} fontWeight={700}
              fill={G.textMut} fontFamily="'DM Mono',monospace">{lbl}</text>
          );
        })}
        {dir != null && (
          <>
            <defs>
              <marker id="storm-arrow-head" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill={color} />
              </marker>
            </defs>
            <line x1={c} y1={c} x2={tipX} y2={tipY}
              stroke={color} strokeWidth={2.4} strokeLinecap="round"
              markerEnd="url(#storm-arrow-head)" style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
            <circle cx={c} cy={c} r={2.6} fill={color} />
          </>
        )}
      </svg>
      <span style={{ fontSize: '0.6rem', fontWeight: 800, color, fontFamily: "'DM Mono',monospace" }}>
        {dir != null ? `${bearingToCompass(dir)} ${mph ?? 0}mph` : '—'}
      </span>
    </div>
  );
};

// Horizontal 0–100 ingredient meter (instability / moisture / lift / cap / shear …).
const IngredientMeter = ({ label, value, color, limiting = false }) => {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: '0.6rem', color: limiting ? '#f59e0b' : G.textSec, fontWeight: limiting ? 800 : 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          {limiting && <AlertTriangle style={{ width: 8, height: 8, color: '#f59e0b' }} />}
          {label}
        </span>
        <span style={{ fontSize: '0.6rem', color: limiting ? '#f59e0b' : color, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>{v}</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${v}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: '100%', borderRadius: 99, background: limiting ? '#f59e0b' : `linear-gradient(90deg, ${color}77, ${color})`, boxShadow: v > 25 ? `0 0 6px ${limiting ? '#f59e0b' : color}55` : 'none' }}
        />
      </div>
    </div>
  );
};

// Map a storm-mode string to a colour + short descriptor for the badge.
const STORM_MODE_META = {
  'None':                  { color: '#64748b', blurb: 'No organised convection expected' },
  'Pulse / single cells':  { color: '#22c55e', blurb: 'Brief, heat-driven single cells' },
  'Cold-pool showers':     { color: '#38bdf8', blurb: 'Cold-air thundery showers / graupel' },
  'Multicell clusters':    { color: '#eab308', blurb: 'Grouped cells, locally heavy' },
  'Organised multicells':  { color: '#f97316', blurb: 'Sheared, longer-lived clusters' },
  'Squall line / QLCS':    { color: '#ef4444', blurb: 'Linear system — damaging winds' },
  'Supercells possible':   { color: '#a855f7', blurb: 'Rotating storms — large hail / tornado' },
  'Elevated / nocturnal':  { color: '#818cf8', blurb: 'Elevated convection above the boundary layer' },
  'Spanish plume — severe':{ color: '#e11d48', blurb: 'Loaded-gun plume — high-end severe' },
};
const stormModeMeta = (m) => STORM_MODE_META[m] || { color: '#94a3b8', blurb: '' };

// Impacted location chip
const LocationChip = ({ loc, scoreToLevel, getPalette, riskType }) => {
  const lvl    = scoreToLevel(loc.score);
  const pal    = getPalette(riskType, lvl);
  const [hov, setHov] = useState(false);
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.82 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.82 }}
      transition={{ duration: 0.14 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 99,
        background: hov ? `${pal.fill}cc` : pal.fill,
        border: `1px solid ${hov ? pal.border : pal.border + 'aa'}`,
        backdropFilter: 'blur(6px)',
        fontSize: '0.66rem', fontWeight: 700, cursor: 'default',
        color: pal.border === 'transparent' ? G.textMut : pal.border,
        boxShadow: hov ? `0 0 8px ${pal.border}44` : 'none',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 99, background: pal.border, flexShrink: 0 }} />
      <span style={{ color: G.textPri, fontWeight: 800 }}>{loc.name}</span>
      <span style={{ fontSize: '0.54rem', color: G.textMut, fontFamily: "'DM Mono',monospace" }}>{loc.score}</span>
    </motion.span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Paragraph renderer — bold markdown → styled spans
// ─────────────────────────────────────────────────────────────────────────────
const renderParagraph = (text, i, arr, accentLight) => (
  <p key={i} style={{
    margin: 0, marginBottom: i < arr.length - 1 ? 12 : 0,
    fontSize: '0.83rem', color: G.textSec, lineHeight: 1.75,
  }}>
    {text.split(/\*\*(.*?)\*\*/g).map((part, j) =>
      j % 2 === 1
        ? <strong key={j} style={{ color: accentLight, fontWeight: 700 }}>{part}</strong>
        : part,
    )}
  </p>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DayOverview COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function DayOverview({
  data, summary, riskType, regionLabel, dayLabel, dayIdx, run,
  t, RISK_TYPES, scoreToLevel, getPalette, getRiskScore,
  generateDayDescription, lightMode, Section, Card,
  impactedLocations = [],
}) {
  const [showSounding,       setShowSounding]       = useState(false);
  const [locationRiskFilter, setLocationRiskFilter] = useState('All');
  const [descExpanded,       setDescExpanded]       = useState(false);
  const [hazardView,         setHazardView]         = useState('bars');
  const [ingredientsOpen,    setIngredientsOpen]    = useState(false);

  const identity  = getRiskIdentity(riskType);
  const RiskIcon  = identity.icon;

  // Most unstable grid point for Skew-T
  const bestPoint = useMemo(() => {
    if (!data?.grid?.length) return null;
    let best = null, bestScore = -1;
    for (const p of data.grid) {
      const s = getRiskScore(p, riskType, dayIdx);
      if (s > bestScore) { bestScore = s; best = p; }
    }
    return best;
  }, [data, riskType, dayIdx]);

  // ── Peak-cell descriptive scores (storm mode, confidence, motion, plume …) ──
  // The ingredients-based engine attaches a rich, coherent set of descriptive
  // fields to the peak THUNDERSTORM hour of every grid cell. For the day-level
  // "storm intelligence" readout we take the cell with the highest thunderstorm
  // score that day — i.e. the most organised storm expected anywhere in the
  // region — and surface its mode, confidence, motion vector and ingredients.
  const peakScores = useMemo(() => {
    if (!data?.grid?.length) return null;
    let best = null, bestVal = -1;
    for (const p of data.grid) {
      const s = p.perDay?.[dayIdx]?.scores;
      if (!s) continue;
      const v = s.thunderstorm ?? 0;
      if (v > bestVal) { bestVal = v; best = s; }
    }
    return best;
  }, [data, dayIdx]);

  // Descriptions
  const descriptions = useMemo(
    () => generateDayDescription(summary, riskType, dayIdx, regionLabel, run ?? new Date(), impactedLocations),
    [summary, riskType, dayIdx, regionLabel, run, impactedLocations],
  );

  // Grid max metrics
  const gridMax = useMemo(() => {
    const grid = data?.grid || [];
    let cape = 0, precip = 0, shear = 0;
    for (const p of grid) {
      const m = p.perDay?.[dayIdx]?.scores?.metrics;
      if (!m) continue;
      if ((m.cape  || 0) > cape)   cape  = m.cape   || 0;
      if ((m.precip|| m.rain || 0) > precip) precip = m.precip || m.rain || 0;
      if ((m.shear || 0) > shear)  shear = m.shear  || 0;
    }
    const hailMm = Math.round(Math.max(summary?.sub?.hail || 0, 0) * 0.7);
    return { cape: Math.round(cape), precip: Math.round(precip * 10) / 10, hailMm, shear: Math.round(shear) };
  }, [data, dayIdx, summary]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!summary) return (
    <GlassPanel style={{ margin: '12px 0', padding: '22px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
          <Activity style={{ width: 16, height: 16, color: identity.accentLight }} />
        </motion.div>
        <span style={{ color: G.textMut, fontSize: '0.84rem' }}>Forecast initialising — model output loading…</span>
      </div>
    </GlassPanel>
  );

  // ── Derived values ────────────────────────────────────────────────────────
  const score = summary[riskType] ?? 0;
  const level = scoreToLevel(score);
  const pal   = getPalette(riskType, level);
  const r     = summary.ranges || { cape: {}, shear: {}, gust: {}, precip: {}, hailMm: {} };
  const sub   = summary.sub    || {};
  const cov   = summary.totalCells
    ? Math.round((summary.stormyCells / summary.totalCells) * 100) : 0;

  const peakCape   = Math.max(r.cape?.max   ?? 0, gridMax.cape);
  const peakPrecip = Math.max(r.precip?.max ?? 0, gridMax.precip);
  const peakHail   = Math.max(r.hailMm?.max ?? 0, gridMax.hailMm);
  const peakShear  = Math.max(r.shear?.max  ?? 0, gridMax.shear);
  const peakGust   = r.gust?.max ?? 0;

  const isCritical = ['High', 'Severe'].includes(level);
  const isWarning  = level === 'Moderate';

  // ── Storm-intelligence values from the peak cell ──────────────────────────
  const pm          = peakScores?.metrics || {};
  const stormMode   = peakScores?.stormMode || pm.stormMode || 'None';
  const confidence  = peakScores?.confidence ?? pm.confidence ?? null;
  const thunderProb = peakScores?.thunderProb ?? pm.thunderProb ?? null;
  const motionDir   = peakScores?.stormMotionDir ?? pm.stormMotionDir ?? null;
  const motionMph   = peakScores?.stormMotionMph ?? pm.stormMotionMph ?? null;
  const plumeStr    = peakScores?.spanishPlume ?? pm.spanishPlume ?? 0;
  const flashRate   = peakScores?.flashRate ?? pm.flashRate ?? null;
  const dominantHaz = peakScores?.dominantHazard || pm.dominantHazard || null;
  const limiting    = peakScores?.limitingIngredient || pm.limitingIngredient || 'none';
  // Ensemble probabilistic outputs (probability of exceedance, member agreement,
  // scenario spread). Populated once the engine has scored ≥2 ensemble members.
  const poeSevere    = pm.poeSevere ?? null;
  const poeSigSevere = pm.poeSigSevere ?? null;
  const poeThunder   = pm.poeThunder ?? null;
  const ensAgree     = pm.ensembleAgreement ?? null;
  const tpHigh       = pm.thunderProbHigh ?? null;
  const tpLow        = pm.thunderProbLow ?? null;
  const ensMembers   = pm.ensembleMembers ?? null;
  const modeMeta    = stormModeMeta(stormMode);
  const hasStormIntel = !!peakScores && (peakScores.thunderstorm ?? 0) >= 5;
  const HAZ_LABEL   = { tornado: 'Tornado', hail: 'Large hail', wind: 'Damaging winds', lightning: 'Frequent lightning', flood: 'Flash flooding', none: '—' };

  // Location filter
  const riskOrder     = ['No Risk','Very Low','Low','Marginal','Slight','Moderate','High','Severe'];
  const availLevels   = ['All', ...riskOrder.filter(l => impactedLocations.some(loc => scoreToLevel(loc.score) === l))];
  const filteredLocs  = locationRiskFilter === 'All'
    ? impactedLocations
    : impactedLocations.filter(loc => scoreToLevel(loc.score) === locationRiskFilter);

  // Description split
  const descPreview = descriptions.slice(0, 2);
  const descMore    = descriptions.slice(2);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        borderRadius: 26,
        overflow: 'hidden',
        border: `1px solid ${identity.cardBorder}`,
        boxShadow: identity.cardShadow,
        background: identity.heroGradient,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        marginBottom: 20,
        position: 'relative',
      }}
    >

      {/* ── DEPTH ORBS ─────────────────────────────────────────────────── */}
      {[identity.orb1, identity.orb2, identity.orb3].map((orb, i) => (
        <div key={i} style={{
          position: 'absolute',
          top:    orb.top    ?? 'auto',
          bottom: orb.bottom ?? 'auto',
          left:   orb.left   ?? 'auto',
          right:  orb.right  ?? 'auto',
          width: orb.size, height: orb.size,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${orb.color} 0%, transparent 68%)`,
          pointerEvents: 'none', zIndex: 0,
        }} />
      ))}

      {/* Noise texture overlay */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.03\'/%3E%3C/svg%3E")',
        backgroundSize: '256px',
        opacity: 0.4,
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ═══════════════════════════════════════════════════════════════
            HERO HEADER
        ═══════════════════════════════════════════════════════════════ */}
        <div style={{
          padding: '22px 22px 18px',
          borderBottom: `1px solid ${identity.accentBorder}`,
          background: `linear-gradient(180deg, rgba(0,0,0,0.12) 0%, transparent 100%)`,
          position: 'relative',
        }}>
          {/* Top shimmer line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 1,
            background: `linear-gradient(90deg, transparent 0%, ${identity.accentLight}44 40%, ${identity.accentLight}88 50%, ${identity.accentLight}44 60%, transparent 100%)`,
          }} />

          {/* Row 1: Risk icon + badge + score ring */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            {/* Icon box */}
            <div style={{
              width: 42, height: 42, borderRadius: 14,
              background: `linear-gradient(135deg, ${identity.accentMid}30, ${identity.accentMid}10)`,
              border: `1px solid ${identity.accentBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), 0 0 20px ${identity.glow}30`,
              backdropFilter: 'blur(6px)',
            }}>
              {isCritical ? (
                <motion.div
                  animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
                  transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 4 }}
                >
                  <RiskIcon style={{ width: 20, height: 20, color: identity.accentLight, filter: `drop-shadow(0 0 6px ${identity.accentLight}88)` }} />
                </motion.div>
              ) : (
                <RiskIcon style={{ width: 20, height: 20, color: identity.accentLight }} />
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <LevelBadge level={level} pal={pal} identity={identity} />
                {isCritical && (
                  <motion.div
                    animate={{ opacity: [1, 0.1, 1] }}
                    transition={{ duration: 1.0, repeat: Infinity }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 99, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}
                  >
                    <AlertTriangle style={{ width: 11, height: 11, color: '#ef4444' }} />
                    <span style={{ fontSize: '0.58rem', color: '#ef4444', fontWeight: 800, letterSpacing: '0.08em' }}>ACTIVE WARNING</span>
                  </motion.div>
                )}
              </div>
            </div>

            <ScoreRing score={score} color={identity.scoreColor} size={56} />
          </div>

          {/* Title */}
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ margin: '0 0 5px', fontSize: '1.12rem', fontWeight: 900, color: G.textPri, lineHeight: 1.18, letterSpacing: '-0.018em' }}>
              <span style={{ color: identity.accentLight, filter: isCritical ? `drop-shadow(0 0 8px ${identity.accentLight}66)` : 'none' }}>
                {RISK_TYPES.find(tt => tt.id === riskType)?.label ?? identity.tagline}
              </span>
              <span style={{ color: G.textDim }}> · </span>
              <span style={{ fontWeight: 700, color: G.textSec }}>{regionLabel}</span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', color: G.textMut, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{dayLabel}</span>
              <span style={{ color: G.textDim }}>·</span>
              <span style={{ fontSize: '0.70rem', color: G.textMut }}>{identity.tagline}</span>
            </div>
          </div>

          {/* Quick-glance metric strip */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {[
              { icon: Eye,        label: 'Cov',  value: `~${cov}%`,          color: '#22c55e',                  glow: true },
              { icon: Thermometer,label: 'CAPE', value: `${peakCape}`,       color: identity.metrics.cape,       unit: 'J/kg', glow: peakCape > 1500 },
              { icon: Target,     label: 'Hail', value: `${peakHail}mm`,     color: identity.metrics.hailMm ?? '#7dd3fc', glow: peakHail >= 20 },
              { icon: Droplets,   label: 'Rain', value: `${peakPrecip}mm/h`, color: '#38bdf8' },
              { icon: Gauge,      label: 'Shear',value: `${peakShear}kt`,    color: identity.metrics.shear,      glow: peakShear > 25 },
              ...(peakGust > 0 ? [{ icon: Wind, label: 'Gust', value: `${peakGust}mph`, color: '#a3e635', glow: peakGust > 50 }] : []),
            ].map(({ icon: MI, label, value, color, unit, glow }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 10,
                background: `${color}0c`,
                border: `1px solid ${color}22`,
                backdropFilter: 'blur(6px)',
                fontSize: '0.67rem',
                boxShadow: glow ? `0 0 10px ${color}22` : 'none',
              }}>
                <MI style={{ width: 10, height: 10, color: `${color}88`, flexShrink: 0 }} />
                <span style={{ color: G.textMut, fontWeight: 600 }}>{label}</span>
                <span style={{ color, fontWeight: 900, fontFamily: "'DM Mono',monospace" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            BODY
        ═══════════════════════════════════════════════════════════════ */}
        <div style={{ padding: '18px 20px' }}>

          {/* ── STAT TILES ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <StatTile
              label="Peak CAPE"
              value={`${peakCape}`}
              sub="J/kg · instability"
              footnote={peakCape > 2000 ? '⚠ extreme for region' : peakCape > 1000 ? 'strong updraught support' : ''}
              color={identity.metrics.cape}
              icon={Thermometer}
              pulse={peakCape > 1800}
              highlight={peakCape > 1000}
            />
            <StatTile
              label="Coverage"
              value={`~${cov}%`}
              sub="of region · active cells"
              footnote={cov > 50 ? 'widespread threat' : cov > 25 ? 'scattered' : 'isolated'}
              color="#22c55e"
              icon={Activity}
              pulse={cov > 50}
              highlight={cov > 35}
            />
            <StatTile
              label="Max Hail"
              value={`${peakHail}mm`}
              sub={peakHail >= 30 ? 'very large — damaging' : peakHail >= 20 ? 'large — crop risk' : peakHail >= 10 ? 'notable' : 'pea-size'}
              color={identity.metrics.hailMm ?? '#7dd3fc'}
              icon={CloudRain}
              highlight={peakHail >= 20}
            />
            <StatTile
              label="Rain Rate"
              value={`${peakPrecip}mm`}
              sub="per hour · peak"
              footnote={peakPrecip > 30 ? 'flash-flood threshold' : ''}
              color={identity.metrics.precip ?? '#0ea5e9'}
              icon={Droplets}
              highlight={peakPrecip > 30}
            />
          </div>

          {/* ── STORM INTELLIGENCE ─────────────────────────────────────────
              Surfaces the ingredients-based engine's descriptive outputs for
              the most organised storm expected in the region today: storm
              mode, forecast confidence, thunder probability, Bunkers storm
              motion, Spanish-plume detection, flash rate, the limiting
              ingredient, and the full ingredient / composite-index breakdown. */}
          {hasStormIntel && (
            <GlassPanel accent={identity.accent} style={{ padding: '16px 18px', marginBottom: 14 }}>
              <SectionHeader
                icon={Radar}
                label="Storm Intelligence"
                color={identity.accentLight}
                sub="Mode, confidence, motion & ingredients for the most organised storm expected region-wide"
                right={
                  dominantHaz && dominantHaz !== 'none' ? (
                    <span style={{ fontSize: '0.6rem', fontWeight: 800, color: identity.accentLight, fontFamily: "'DM Mono',monospace", padding: '2px 8px', borderRadius: 99, background: `${identity.accent}14`, border: `1px solid ${identity.accent}30` }}>
                      Main threat: {HAZ_LABEL[dominantHaz] ?? dominantHaz}
                    </span>
                  ) : null
                }
              />

              {/* Top row: storm-mode badge + plume flag + motion compass */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 14 }}>
                {/* Storm mode */}
                <div style={{
                  flex: '1 1 220px', minWidth: 0,
                  borderRadius: 14, padding: '12px 14px',
                  background: `linear-gradient(135deg, ${modeMeta.color}14, ${modeMeta.color}04)`,
                  border: `1px solid ${modeMeta.color}33`,
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: '0.52rem', fontWeight: 700, color: G.textMut, textTransform: 'uppercase', letterSpacing: '0.10em', fontFamily: "'DM Mono',monospace" }}>Expected storm mode</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: modeMeta.color, boxShadow: `0 0 8px ${modeMeta.color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.92rem', fontWeight: 900, color: modeMeta.color, letterSpacing: '-0.01em' }}>{stormMode}</span>
                  </div>
                  {modeMeta.blurb && <span style={{ fontSize: '0.64rem', color: G.textSec, lineHeight: 1.45 }}>{modeMeta.blurb}</span>}
                  {plumeStr > 0 && (
                    <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', padding: '2px 9px', borderRadius: 99, background: 'rgba(225,29,72,0.12)', border: '1px solid rgba(225,29,72,0.40)' }}>
                      <AlertTriangle style={{ width: 9, height: 9, color: '#fb7185' }} />
                      <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#fb7185', fontFamily: "'DM Mono',monospace" }}>SPANISH PLUME · {plumeStr}%</span>
                    </div>
                  )}
                </div>

                {/* Storm motion compass */}
                <div style={{
                  flex: '0 0 auto',
                  borderRadius: 14, padding: '10px 16px',
                  background: G.tile, border: `1px solid ${G.border}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: '0.52rem', fontWeight: 700, color: G.textMut, textTransform: 'uppercase', letterSpacing: '0.10em', fontFamily: "'DM Mono',monospace" }}>Storm motion</span>
                  <StormMotionCompass dir={motionDir} mph={motionMph} color={identity.accentLight} size={62} />
                </div>
              </div>

              {/* Confidence / thunder-probability / flash-rate strip */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                {confidence != null && (
                  <StatTile label="Confidence" value={`${confidence}%`} color={confidence >= 70 ? '#22c55e' : confidence >= 45 ? '#f59e0b' : '#ef4444'} icon={Gauge}
                    sub={confidence >= 70 ? 'high — clear signal' : confidence >= 45 ? 'moderate' : 'low — marginal setup'} highlight={confidence >= 70} />
                )}
                {thunderProb != null && (
                  <StatTile label="Thunder Prob" value={`${thunderProb}%`} color={identity.scoreColor} icon={Zap}
                    sub="≤15 mi of a point" highlight={thunderProb >= 50} />
                )}
                {flashRate != null && flashRate > 0 && (
                  <StatTile label="Flash Rate" value={`${flashRate}`} color="#facc15" icon={Activity}
                    sub="flashes / min · peak cell" footnote={flashRate >= 5 ? 'very frequent lightning' : ''} highlight={flashRate >= 2} />
                )}
                {limiting && limiting !== 'none' && (
                  <StatTile label="Limiting factor" value={limiting.charAt(0).toUpperCase() + limiting.slice(1)} color="#f59e0b" icon={AlertTriangle}
                    sub="ingredient holding storms back" />
                )}
              </div>

              {/* Ensemble probability strip — probability of exceedance, member
                  agreement and scenario spread. Only the central run can't tell
                  you a 40%-of-members-go-severe situation apart from a benign
                  one; these tiles surface exactly that. */}
              {(poeSevere != null || ensAgree != null) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  {poeSevere != null && (
                    <StatTile label="Severe prob" value={`${poeSevere}%`}
                      color={poeSevere >= 30 ? '#ef4444' : poeSevere >= 10 ? '#f59e0b' : '#64748b'} icon={Shield}
                      sub="members reaching severe" highlight={poeSevere >= 30} />
                  )}
                  {poeSigSevere != null && poeSigSevere > 0 && (
                    <StatTile label="Sig-severe prob" value={`${poeSigSevere}%`} color="#b91c1c" icon={AlertTriangle}
                      sub="significant-severe (conditional)" footnote={poeSigSevere >= 15 ? 'conditional-severe signal' : ''} highlight={poeSigSevere >= 15} />
                  )}
                  {ensAgree != null && (
                    <StatTile label="Ensemble agreement" value={`${Math.round(ensAgree * 100)}%`}
                      color={ensAgree >= 0.7 ? '#22c55e' : ensAgree >= 0.4 ? '#f59e0b' : '#ef4444'} icon={Gauge}
                      sub={ensAgree >= 0.7 ? 'members agree' : ensAgree >= 0.4 ? 'some spread' : 'members split'}
                      footnote={ensMembers != null ? `${ensMembers} members` : ''} />
                  )}
                  {tpHigh != null && tpLow != null && (tpHigh - tpLow) >= 5 && (
                    <StatTile label="Scenario range" value={`${tpLow}–${tpHigh}%`} color={identity.accentLight} icon={TrendingUp}
                      sub="lowest → highest member" />
                  )}
                </div>
              )}

              {/* Expandable ingredient + composite-index breakdown */}
              <button
                onClick={() => setIngredientsOpen(o => !o)}
                style={{
                  marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                  background: ingredientsOpen ? `${identity.accent}10` : G.surface,
                  border: `1px solid ${ingredientsOpen ? identity.accentBorder : G.border}`,
                  color: identity.accentLight, fontSize: '0.68rem', fontWeight: 700,
                }}
              >
                <Layers style={{ width: 11, height: 11 }} />
                Ingredient & composite-index breakdown
                <ChevronDown style={{ width: 13, height: 13, marginLeft: 'auto', transform: ingredientsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s' }} />
              </button>

              <AnimatePresence>
                {ingredientsOpen && (
                  <motion.div
                    key="ingredients"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 22px' }}>
                      {/* Necessary ingredients (multiplicative families) */}
                      <div>
                        <p style={{ fontSize: '0.56rem', fontWeight: 800, color: G.textMut, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px', fontFamily: "'DM Mono',monospace" }}>Necessary ingredients</p>
                        <IngredientMeter label="Instability"  value={pm.instability}  color="#ef4444" limiting={limiting === 'instability'} />
                        <IngredientMeter label="Moisture"     value={pm.moisture}     color="#0ea5e9" limiting={limiting === 'moisture'} />
                        <IngredientMeter label="Lift / trigger" value={pm.liftTrigger} color="#22c55e" limiting={limiting === 'lift'} />
                        <IngredientMeter label="Cap release"  value={pm.capRelease}   color="#f59e0b" limiting={limiting === 'cap'} />
                      </div>
                      {/* Organisation / kinematics */}
                      <div>
                        <p style={{ fontSize: '0.56rem', fontWeight: 800, color: G.textMut, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px', fontFamily: "'DM Mono',monospace" }}>Organisation</p>
                        <IngredientMeter label="Deep-layer shear" value={pm.organisation} color="#818cf8" />
                        <IngredientMeter label="0–3 km SRH"        value={pm.srhNorm}      color="#a78bfa" />
                        <IngredientMeter label="Upper divergence"  value={pm.upperDiv}     color="#38bdf8" />
                        <IngredientMeter label="Mid-level lapse"   value={pm.lapseInst}    color="#fb923c" />
                      </div>
                    </div>

                    {/* Composite indices + derived physics */}
                    <div style={{ marginTop: 6, paddingTop: 10, borderTop: `1px solid ${G.divider}` }}>
                      <p style={{ fontSize: '0.56rem', fontWeight: 800, color: G.textMut, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px', fontFamily: "'DM Mono',monospace" }}>Composite indices &amp; derived physics</p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[
                          { label: 'EHI',  value: pm.ehi,        hint: 'Energy-Helicity (tornado)', color: '#fca5a5' },
                          { label: 'SCP',  value: pm.scp,        hint: 'Supercell Composite',       color: '#a78bfa' },
                          { label: 'STP',  value: pm.stp,        hint: 'Sig-Tornado Parameter',     color: '#fb923c' },
                          { label: 'WBZ',  value: pm.wbzHeight, unit: 'm', hint: 'Wet-bulb-zero (hail)', color: '#7dd3fc' },
                          { label: 'DCAPE',value: pm.dcapeJ,    unit: 'J', hint: 'Downdraught CAPE (wind)', color: '#a3e635' },
                          { label: 'Top',  value: pm.cloudTopKm, unit: 'km', hint: 'Cloud-top height', color: '#c4b5fd' },
                        ].filter(x => x.value != null).map(x => (
                          <div key={x.label} title={x.hint} style={{
                            flex: '1 1 90px', minWidth: 0,
                            padding: '7px 10px', borderRadius: 10,
                            background: `${x.color}0c`, border: `1px solid ${x.color}26`,
                          }}>
                            <div style={{ fontSize: '0.5rem', fontWeight: 700, color: G.textMut, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'DM Mono',monospace" }}>{x.label}</div>
                            <div style={{ fontSize: '0.86rem', fontWeight: 900, color: x.color, fontFamily: "'DM Mono',monospace", lineHeight: 1.1 }}>
                              {x.value}<span style={{ fontSize: '0.5rem', fontWeight: 600, opacity: 0.7, marginLeft: 1 }}>{x.unit ?? ''}</span>
                            </div>
                            <div style={{ fontSize: '0.46rem', color: G.textDim, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.hint}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassPanel>
          )}

          {/* ── DAY SYNOPSIS ───────────────────────────────────────────── */}
          <GlassPanel accent={identity.accent} style={{ padding: '16px 18px', marginBottom: 14 }}>
            <SectionHeader
              icon={FileText}
              label="Day Synopsis"
              color={identity.accentLight}
              sub="AI-generated meteorologist-style narrative tailored to today's specific conditions"
            />

            {/* Always-visible paragraphs */}
            {descPreview.map((d, i) => renderParagraph(d, i, descPreview, identity.accentLight))}

            {/* Expandable rest */}
            <AnimatePresence>
              {descExpanded && descMore.length > 0 && (
                <motion.div
                  key="desc-more"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${G.divider}` }}>
                    {descMore.map((d, i) => renderParagraph(d, i, descMore, identity.accentLight))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {descMore.length > 0 && (
              <button
                onClick={() => setDescExpanded(s => !s)}
                style={{
                  marginTop: 12, background: 'none', border: 'none', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 0',
                  color: identity.accentLight, fontSize: '0.70rem', fontWeight: 700,
                }}
              >
                {descExpanded ? 'Collapse synopsis' : `Read full synopsis (+${descMore.length} paragraphs)`}
                <ChevronDown style={{
                  width: 13, height: 13,
                  transform: descExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.22s',
                }} />
              </button>
            )}
          </GlassPanel>

          {/* ── HAZARD BREAKDOWN ───────────────────────────────────────── */}
          <GlassPanel accent={identity.accent} style={{ padding: '16px 18px', marginBottom: 14 }}>
            <SectionHeader icon={Shield} label="Hazard Breakdown" color={identity.accentLight} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 22px' }}>
              <div>
                <HazardBar label="Tornado"    value={sub.tornado    ?? 0} color={identity.bars.tornado}   hint="rotation potential" />
                <HazardBar label="Large Hail" value={sub.hail       ?? 0} color={identity.bars.hail}      hint="updraught depth" />
                <HazardBar label="Flash Flood" value={sub.flashFlood ?? 0} color={identity.bars.flashFlood} hint="precip rate + saturation" />
              </div>
              <div>
                <HazardBar label="Strong Winds" value={sub.strongWinds ?? 0} color={identity.bars.strongWinds} hint="downburst gusts" />
                <HazardBar label="Supercell"    value={sub.supercell   ?? 0} color={identity.bars.supercell}   hint="storm organisation" />
                <HazardBar label="CAPE"         value={peakCape} max={3000}  color={identity.bars.cape} unit=" J/kg" hint="thermodynamic energy" />
              </div>
            </div>
            <div style={{ marginTop: 6, paddingTop: 10, borderTop: `1px solid ${G.divider}` }}>
              <HazardBar label="Deep-Layer Shear" value={peakShear} max={60} color="#818cf8" unit=" kt" hint="storm mode driver" />
              {peakGust > 0 && <HazardBar label="Max Gust" value={peakGust} max={80} color="#a3e635" unit=" mph" hint="cold pool / downburst" />}
            </div>

            {/* Hazard key */}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: 'Low (<25)', color: identity.bars.cape },
                { label: 'Moderate (25–45)', color: '#f59e0b' },
                { label: 'High (>45)', color: '#ef4444' },
              ].map(k => (
                <div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 18, height: 3, borderRadius: 2, background: k.color }} />
                  <span style={{ fontSize: '0.54rem', color: G.textMut, fontFamily: "'DM Mono',monospace" }}>{k.label}</span>
                </div>
              ))}
            </div>
          </GlassPanel>

          {/* ── LOCATIONS IMPACTED ─────────────────────────────────────── */}
          {impactedLocations.length > 0 && (
            <GlassPanel accent={identity.accent} style={{ padding: '16px 18px', marginBottom: 14 }}>
              <SectionHeader
                icon={MapPin}
                label="Locations Impacted"
                color={identity.accentLight}
                right={
                  <span style={{ fontSize: '0.62rem', color: G.textMut, fontFamily: "'DM Mono',monospace" }}>
                    {filteredLocs.length} / {impactedLocations.length}
                  </span>
                }
              />

              {/* Filter chips */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                {availLevels.map(lvl => {
                  const active  = locationRiskFilter === lvl;
                  const lvlPal  = lvl === 'All' ? null : getPalette(riskType, lvl);
                  const count   = lvl === 'All'
                    ? impactedLocations.length
                    : impactedLocations.filter(l => scoreToLevel(l.score) === lvl).length;
                  return (
                    <motion.button
                      key={lvl}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => setLocationRiskFilter(lvl)}
                      style={{
                        padding: '3px 10px', borderRadius: 99, cursor: 'pointer',
                        fontSize: '0.62rem', fontWeight: 700,
                        border: active
                          ? `1px solid ${lvlPal?.border ?? identity.accentLight}`
                          : `1px solid ${G.border}`,
                        background: active
                          ? (lvlPal?.fill ?? identity.accentFill)
                          : 'rgba(255,255,255,0.03)',
                        color: active
                          ? (lvlPal?.border ?? identity.accentLight)
                          : G.textMut,
                        backdropFilter: 'blur(6px)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {lvl} <span style={{ opacity: 0.65, fontSize: '0.56rem' }}>({count})</span>
                    </motion.button>
                  );
                })}
              </div>

              {/* Location chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <AnimatePresence mode="popLayout">
                  {filteredLocs.slice(0, 36).map((loc) => (
                    <LocationChip
                      key={`${loc.name}-${loc.country}`}
                      loc={loc}
                      scoreToLevel={scoreToLevel}
                      getPalette={getPalette}
                      riskType={riskType}
                    />
                  ))}
                </AnimatePresence>
                {filteredLocs.length > 36 && (
                  <span style={{ fontSize: '0.64rem', color: G.textMut, fontStyle: 'italic', alignSelf: 'center' }}>
                    +{filteredLocs.length - 36} more locations
                  </span>
                )}
                {filteredLocs.length === 0 && (
                  <span style={{ fontSize: '0.70rem', color: G.textMut, fontStyle: 'italic' }}>
                    No locations at {locationRiskFilter} risk
                  </span>
                )}
              </div>
            </GlassPanel>
          )}

          {/* ── DIURNAL TIMING ─────────────────────────────────────────── */}
          <GlassPanel accent={identity.accent} style={{ padding: '16px 18px', marginBottom: 14 }}>
            <SectionHeader
              icon={Clock}
              label="Timing & Atmospheric Trend"
              color={identity.accentLight}
              sub="3-hourly risk scores with CAPE / shear / LI evolution · UK-wide ensemble peak"
            />
            <DiurnalTimingSection
              data={data}
              dayIdx={dayIdx}
              riskType={riskType}
              peakStep={null}
              peakLocation={null}
              summary={summary}
              run={run}
            />
          </GlassPanel>

          {/* ── SKEW-T SOUNDING ────────────────────────────────────────── */}
          <div>
            <motion.button
              whileTap={{ scale: 0.995 }}
              onClick={() => setShowSounding(s => !s)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 15px', borderRadius: 15, cursor: 'pointer',
                background: showSounding
                  ? `linear-gradient(135deg, ${identity.accentMid}16, ${identity.accentMid}06)`
                  : G.surface,
                border: `1px solid ${showSounding ? identity.accentBorder : G.border}`,
                backdropFilter: 'blur(10px)',
                transition: 'all 0.2s',
                boxShadow: showSounding
                  ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 20px ${identity.glow}18`
                  : `inset 0 1px 0 rgba(255,255,255,0.04)`,
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 9,
                background: `${identity.accentMid}18`,
                border: `1px solid ${identity.accentBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <BarChart2 style={{ width: 13, height: 13, color: identity.accentLight }} />
              </div>
              <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: G.textPri }}>
                  Skew-T Log-P Sounding
                </div>
                {bestPoint && (
                  <div style={{ fontSize: '0.61rem', color: G.textMut, fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
                    {bestPoint.lat.toFixed(1)}°N {bestPoint.lon.toFixed(1)}° — most unstable grid point
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.60rem', color: G.textMut }}>
                  {showSounding ? 'collapse' : 'expand'}
                </span>
                <ChevronDown style={{
                  width: 14, height: 14, color: G.textMut, flexShrink: 0,
                  transform: showSounding ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.22s',
                }} />
              </div>
            </motion.button>

            <AnimatePresence>
              {showSounding && (
                <motion.div
                  key="sounding"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{
                    marginTop: 8, borderRadius: 15, overflow: 'hidden',
                    border: `1px solid ${identity.accentBorder}`,
                    background: 'rgba(0,0,0,0.25)',
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06)`,
                  }}>
                    <SkewT pt={bestPoint} dayIdx={dayIdx} run={run} t={t} lightMode={lightMode} />
                  </div>
                  <p style={{
                    margin: '7px 0 0', fontSize: '0.63rem',
                    color: G.textMut, fontStyle: 'italic', paddingLeft: 4,
                  }}>
                    Most unstable grid point · Red = temperature · Green = dewpoint · Purple = wet-bulb
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>{/* /body */}
      </div>{/* /z-index wrapper */}
    </motion.div>
  );
}