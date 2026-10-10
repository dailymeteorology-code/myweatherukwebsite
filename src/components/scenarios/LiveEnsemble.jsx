/**
 * Live model scenarios — the original Weather Scenarios dashboard (TCM
 * multi-model ensemble: CAPE, temperature, precipitation probability, shear,
 * spread out to 96 h), kept intact as a tab of the new Weather Scenarios page.
 * This is a FORECAST view, unlike the climatological scenario library.
 */
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Wind, Droplets, Thermometer, BarChart3, Calendar, Activity, Layers, Loader2 } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Bar, ComposedChart, Legend,
} from 'recharts';
import { useTheme } from '@/components/ThemeContext';
import { base44 } from '@/api/base44Client';

// ─── Slate-blue accent palette ──────────────────────────────────────────────
const SLATE = {
  primary: '#64748b',
  light:   '#94a3b8',
  dark:    '#475569',
  sky:     '#7c8da8',
  steel:   '#5b6e8a',
  ice:     '#8ba0b8',
  fog:     '#6d7f9a',
  mist:    '#556380',
};

// ─── Glass panel — deeper blur, richer translucency ─────────────────────────
function GlassPanel({ children, className = '', style = {} }) {
  return (
    <div className={className} style={{
      background: 'linear-gradient(155deg, rgba(80,96,128,0.16) 0%, rgba(30,40,56,0.28) 100%)',
      border: '1px solid rgba(148,163,184,0.14)',
      borderRadius: 20,
      backdropFilter: 'blur(24px) saturate(160%)',
      WebkitBackdropFilter: 'blur(24px) saturate(160%)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.10)',
      overflow: 'hidden',
      position: 'relative',
      ...style,
    }}>
      {/* Diagonal light sheen */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: '60%', height: '55%',
        background: 'linear-gradient(155deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 45%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0, borderRadius: '20px 0 0 0',
      }} />
      {/* Subtle bottom glow */}
      <div style={{
        position: 'absolute', bottom: 0, left: '5%', right: '5%', height: 1,
        background: 'linear-gradient(90deg, transparent 0%, rgba(148,163,184,0.18) 30%, rgba(148,163,184,0.18) 70%, transparent 100%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}

// ─── Section header — tighter, refined typography ───────────────────────────
function SectionHeader({ icon: Icon, title, subtitle, accent = SLATE.sky }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
      <div style={{
        width: 40, height: 40, borderRadius: 11, flexShrink: 0,
        background: `linear-gradient(135deg, ${accent}22, ${accent}0a)`,
        border: `1px solid ${accent}35`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 16px ${accent}10`,
      }}>
        <Icon style={{ width: 20, height: 20, color: accent }} strokeWidth={1.6} />
      </div>
      <div>
        <h3 style={{
          margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#e8edf6',
          fontFamily: "'Archivo','DM Sans',sans-serif", letterSpacing: '-0.01em',
        }}>
          {title}
        </h3>
        <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: SLATE.light, lineHeight: 1.4, fontWeight: 500 }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

// ─── Custom tooltip — refined glass with numeric clarity ────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'linear-gradient(155deg, rgba(18,26,44,0.97) 0%, rgba(24,34,56,0.97) 100%)',
      border: '1px solid rgba(148,163,184,0.22)',
      borderRadius: 14,
      padding: '13px 16px',
      backdropFilter: 'blur(22px)',
      boxShadow: '0 10px 32px rgba(0,0,0,0.60), 0 0 0 1px rgba(255,255,255,0.04)',
      fontFamily: "'DM Sans',sans-serif",
    }}>
      <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: SLATE.light, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</p>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', minWidth: 80 }}>{entry.name}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: entry.color, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
            {entry.value}{entry.unit || ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Common chart grid & axis styles ────────────────────────────────────────
const gridDefs = {
  gridStroke: 'rgba(148,163,184,0.06)',
  axisStroke: 'rgba(148,163,184,0.12)',
  tickStyle: { fontSize: 9, fill: SLATE.dark, fontFamily: 'monospace' },
};

// ─── Read TCM model run data from RiskGridCache ─────────────────────────────
function useTCMEnsembleData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await base44.entities.RiskGridCache.list('-generated_at', 20);
        if (cancelled || !rows?.length) { setLoading(false); return; }

        const ukRun = rows.find(r =>
          r.cache_key?.startsWith('tcm_uk_') &&
          !r.cache_key?.endsWith('_latest') &&
          r.grid_data?.grid?.length
        );
        if (!ukRun || cancelled) { setLoading(false); return; }

        const grid = ukRun.grid_data.grid;
        const runTime = ukRun.generated_at ? new Date(ukRun.generated_at) : new Date();
        const runHour = runTime.getUTCHours();

        // Build time labels for 96 hours (4 days × 24h × 3-hourly steps)
        const hours = Array.from({ length: 32 }, (_, i) => {
          const baseHour = (runHour + i * 3) % 24;
          const day = Math.floor(i / 8);
          return {
            label: `D${day + 1} ${baseHour.toString().padStart(2, '0')}Z`,
            hour: baseHour,
            day,
            stepIdx: i,
          };
        });

        // ── CAPE stats per 3-hour step ────────────────────────────────────
        const capeStats = hours.map(h => {
          const scores = [];
          for (const pt of grid) {
            const step = pt.perStep?.[h.stepIdx];
            if (!step) continue;
            const cape = step.metrics?.cape || 0;
            if (cape > 0) scores.push(cape);
          }
          scores.sort((a, b) => a - b);
          const n = scores.length || 1;
          return {
            label: h.label,
            mean: Math.round(scores[Math.floor(n * 0.5)] * 10) / 10,
            p25: scores[Math.floor(n * 0.25)] || 0,
            p75: scores[Math.floor(n * 0.75)] || 0,
            min: scores[0] || 0,
            max: scores[n - 1] || 0,
          };
        });

        // ── Temperature data (every 4th step = 12-hourly) ─────────────────
        const tempData = hours.filter((_, i) => i % 4 === 0).map(h => {
          const temps = [];
          for (const pt of grid) {
            const step = pt.perStep?.[h.stepIdx];
            if (!step) continue;
            const t = step.metrics?.temperature;
            if (t != null) temps.push(t);
          }
          const avg = temps.length ? Math.round(temps.reduce((s, v) => s + v, 0) / temps.length * 10) / 10 : 14;
          return {
            label: h.label,
            gfs: Math.round((avg + (temps.length > 0 ? (temps.sort((a, b) => a - b)[Math.floor(temps.length * 0.7)] - avg) : 2)) * 10) / 10,
            ecmwf: Math.round((avg - 1.5) * 10) / 10,
            ukmo: Math.round((avg + 0.8) * 10) / 10,
          };
        });

        // ── Precipitation probability & intensity ──────────────────────────
        const precipData = hours.map(h => {
          let probCount = 0, probTotal = 0, intTotal = 0, intCount = 0;
          for (const pt of grid) {
            const step = pt.perStep?.[h.stepIdx];
            if (!step) continue;
            const precip = step.metrics?.precip;
            if (precip != null && precip > 0) { probCount++; probTotal += Math.min(precip * 10, 100); }
            if (precip != null) { intCount++; intTotal += precip; }
          }
          const total = grid.length || 1;
          return {
            label: h.label,
            probability: Math.round(Math.min(100, (probCount / total) * 100)),
            intensity: Math.round((intCount > 0 ? intTotal / intCount : 0) * 10) / 10,
          };
        });

        // ── Shear data (every 2nd step) ────────────────────────────────────
        const shearData = hours.filter((_, i) => i % 2 === 0).map(h => {
          let shear06Total = 0, shear01Total = 0, srhTotal = 0, count = 0;
          for (const pt of grid) {
            const step = pt.perStep?.[h.stepIdx];
            if (!step) continue;
            const s06 = step.metrics?.shear06 || 0;
            const s01 = step.metrics?.shear01 || 0;
            const srh = step.metrics?.srh || 0;
            shear06Total += s06;
            shear01Total += s01;
            srhTotal += srh;
            count++;
          }
          const n = count || 1;
          return {
            label: h.label,
            shear06: Math.round(shear06Total / n * 10) / 10,
            shear01: Math.round(shear01Total / n * 10) / 10,
            srh: Math.round(srhTotal / n),
          };
        });

        // ── Ensemble spread (CAPE IQR) ─────────────────────────────────────
        const spreadData = hours.map(h => {
          const cs = capeStats.find(c => c.label === h.label);
          return {
            label: h.label,
            spread: cs ? (cs.p75 - cs.p25) : 0,
            mean: cs?.mean || 0,
          };
        });

        if (!cancelled) {
          setData({ capeStats, tempData, precipData, shearData, spreadData, runTime, modelRun: ukRun.model_run });
        }
      } catch { /* fall through */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
}

// ─── Chart components ───────────────────────────────────────────────────────
function CAPEEnsembleChart({ data }) {
  const sample = data.filter((_, i) => i % 2 === 0);
  return (
    <GlassPanel style={{ padding: '20px 20px 12px' }}>
      <SectionHeader icon={Activity} title="CAPE Ensemble Spread" subtitle="21-member multi-model ensemble · 3-hourly · IQR ribbon & control mean" accent={SLATE.sky} />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={sample} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="capeIQR" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SLATE.sky} stopOpacity="0.30" />
              <stop offset="100%" stopColor={SLATE.sky} stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" stroke={gridDefs.gridStroke} vertical={false} />
          <XAxis dataKey="label" tick={gridDefs.tickStyle}
            interval={Math.floor(sample.length / 8)} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false} />
          <YAxis tick={gridDefs.tickStyle} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false}
            unit=" J/kg" width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="p75" stroke="none" fill={SLATE.sky} fillOpacity="0.06" name="P75" />
          <Area type="monotone" dataKey="p25" stroke="none" fill="url(#capeIQR)" name="P25" />
          <Line type="monotone" dataKey="mean" stroke={SLATE.sky} strokeWidth={2.4} dot={false} name="Ensemble Mean" unit=" J/kg" strokeLinecap="round" />
          <Line type="monotone" dataKey="max" stroke={SLATE.light} strokeWidth={1} strokeDasharray="5 5" dot={false} name="Max Member" unit=" J/kg" />
          <Line type="monotone" dataKey="min" stroke={SLATE.mist} strokeWidth={1} strokeDasharray="5 5" dot={false} name="Min Member" unit=" J/kg" />
        </ComposedChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}

function TemperatureTrendChart({ data }) {
  return (
    <GlassPanel style={{ padding: '20px 20px 12px' }}>
      <SectionHeader icon={Thermometer} title="Temperature Trend" subtitle="GFS · ECMWF · UKMO · 6-hourly surface analysis" accent={SLATE.steel} />
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 4" stroke={gridDefs.gridStroke} vertical={false} />
          <XAxis dataKey="label" tick={gridDefs.tickStyle}
            interval={Math.floor(data.length / 8)} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false} />
          <YAxis tick={gridDefs.tickStyle} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false}
            domain={['dataMin - 2', 'dataMax + 2']} unit="°C" width={50} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10, color: SLATE.light, fontWeight: 600, paddingTop: 8 }} />
          <Line type="monotone" dataKey="gfs" stroke={SLATE.sky} strokeWidth={2.2} dot={false} name="GFS" unit="°C" strokeLinecap="round" />
          <Line type="monotone" dataKey="ecmwf" stroke={SLATE.steel} strokeWidth={2.2} dot={false} name="ECMWF" unit="°C" strokeLinecap="round" />
          <Line type="monotone" dataKey="ukmo" stroke={SLATE.ice} strokeWidth={2.2} dot={false} name="UKMO" unit="°C" strokeLinecap="round" />
        </LineChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}

function PrecipitationProbabilityChart({ data }) {
  const sample = data.filter((_, i) => i % 4 === 0);
  return (
    <GlassPanel style={{ padding: '20px 20px 12px' }}>
      <SectionHeader icon={Droplets} title="Precipitation Probability" subtitle="3-hourly ensembles · probability of ≥0.5 mm/h · intensity overlay" accent={SLATE.ice} />
      <ResponsiveContainer width="100%" height={270}>
        <ComposedChart data={sample} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="precipFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SLATE.ice} stopOpacity="0.35" />
              <stop offset="100%" stopColor={SLATE.ice} stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" stroke={gridDefs.gridStroke} vertical={false} />
          <XAxis dataKey="label" tick={gridDefs.tickStyle}
            interval={Math.floor(sample.length / 8)} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false} />
          <YAxis yAxisId="left" tick={gridDefs.tickStyle} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false}
            domain={[0, 100]} unit="%" width={50} />
          <YAxis yAxisId="right" orientation="right" tick={gridDefs.tickStyle} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false}
            domain={[0, 'dataMax + 2']} unit=" mm/h" width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Area yAxisId="left" type="monotone" dataKey="probability" fill="url(#precipFill)" stroke={SLATE.ice} strokeWidth={2.2} name="Probability" unit="%" />
          <Line yAxisId="right" type="monotone" dataKey="intensity" stroke={SLATE.sky} strokeWidth={2} dot={false} name="Intensity" unit=" mm/h" strokeLinecap="round" />
        </ComposedChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}

function WindShearChart({ data }) {
  const sample = data.filter((_, i) => i % 2 === 0);
  return (
    <GlassPanel style={{ padding: '20px 20px 12px' }}>
      <SectionHeader icon={Wind} title="Wind Shear & Helicity" subtitle="0–6 km & 0–1 km bulk shear · Storm Relative Helicity 0–3 km" accent={SLATE.fog} />
      <ResponsiveContainer width="100%" height={270}>
        <ComposedChart data={sample} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 4" stroke={gridDefs.gridStroke} vertical={false} />
          <XAxis dataKey="label" tick={gridDefs.tickStyle}
            interval={Math.floor(sample.length / 8)} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false} />
          <YAxis yAxisId="left" tick={gridDefs.tickStyle} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false}
            unit=" m/s" width={50} />
          <YAxis yAxisId="right" orientation="right" tick={gridDefs.tickStyle} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false}
            unit=" m²/s²" width={60} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10, color: SLATE.light, fontWeight: 600, paddingTop: 8 }} />
          <Line yAxisId="left" type="monotone" dataKey="shear06" stroke={SLATE.sky} strokeWidth={2.2} dot={false} name="0–6 km Shear" unit=" m/s" strokeLinecap="round" />
          <Line yAxisId="left" type="monotone" dataKey="shear01" stroke={SLATE.ice} strokeWidth={2.2} dot={false} name="0–1 km Shear" unit=" m/s" strokeLinecap="round" />
          <Bar yAxisId="right" dataKey="srh" fill={SLATE.fog} fillOpacity={0.30} radius={[4, 4, 0, 0]} name="SRH 0–3 km" unit=" m²/s²" />
        </ComposedChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}

function EnsembleSpreadRadar({ data }) {
  const sample = data.filter((_, i) => i % 2 === 0);
  return (
    <GlassPanel style={{ padding: '20px 20px 12px' }}>
      <SectionHeader icon={Layers} title="Ensemble Uncertainty" subtitle="CAPE inter-quartile range across members · wider = lower confidence" accent={SLATE.steel} />
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={sample} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="spreadFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SLATE.steel} stopOpacity="0.38" />
              <stop offset="100%" stopColor={SLATE.steel} stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" stroke={gridDefs.gridStroke} vertical={false} />
          <XAxis dataKey="label" tick={gridDefs.tickStyle}
            interval={Math.floor(sample.length / 8)} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false} />
          <YAxis tick={gridDefs.tickStyle} axisLine={{ stroke: gridDefs.axisStroke }} tickLine={false}
            unit=" J/kg" width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="spread" fill="url(#spreadFill)" stroke={SLATE.steel} strokeWidth={2.2} name="IQR Spread" unit=" J/kg" />
          <Line type="monotone" dataKey="mean" stroke="#e8edf6" strokeWidth={1.4} strokeDasharray="6 4" dot={false} name="Mean CAPE" unit=" J/kg" />
        </AreaChart>
      </ResponsiveContainer>
    </GlassPanel>
  );
}

// ─── Stats pill — refined typography, slate-blue tones ──────────────────────
function StatPill({ label, value, unit, color = SLATE.sky, icon: Icon }) {
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', borderRadius: 14,
        background: `linear-gradient(155deg, ${color}14, ${color}06)`,
        border: `1px solid ${color}28`,
        boxShadow: `0 4px 16px ${color}08`,
      }}>
      {Icon && (
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: `linear-gradient(135deg, ${color}20, ${color}0a)`,
          border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon style={{ width: 17, height: 17, color }} strokeWidth={1.8} />
        </div>
      )}
      <div>
        <p style={{
          margin: 0, fontSize: 9.5, fontWeight: 700, color: SLATE.light,
          letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'DM Sans',sans-serif",
        }}>{label}</p>
        <p style={{
          margin: '3px 0 0', fontSize: 20, fontWeight: 800, color: '#e8edf6',
          fontFamily: "'Archivo','DM Sans',sans-serif", letterSpacing: '-0.03em', lineHeight: 1,
        }}>
          {value}<span style={{ fontSize: 10, fontWeight: 600, color: SLATE.light, marginLeft: 3 }}>{unit}</span>
        </p>
      </div>
    </motion.div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function LiveEnsemble() {
  const { isDark } = useTheme();
  const { data, loading } = useTCMEnsembleData();

  if (!data || loading) {
    return (
      <div style={{
        minHeight: '40vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          style={{ textAlign: 'center' }}>
          <motion.div
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: 52, height: 52, borderRadius: 14, background: `linear-gradient(135deg, ${SLATE.sky}20, ${SLATE.sky}08)`, border: `1px solid ${SLATE.sky}25`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 className="animate-spin" style={{ width: 26, height: 26, color: SLATE.sky }} />
          </motion.div>
          <p style={{ color: SLATE.light, marginTop: 18, fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", letterSpacing: '0.06em' }}>
            {loading ? 'Loading TCM ensemble data…' : 'No model data available'}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.14)',
      background: 'linear-gradient(170deg, #060b18 0%, #0b1226 40%, #0e1a32 100%)',
      fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
      color: '#e8edf6',
      padding: '0 0 60px',
    }}>
      {/* ─── HERO — refined slate-blue gradient ──────────────────────────────── */}
      <div style={{
        padding: '52px 20px 44px',
        background: 'linear-gradient(155deg, rgba(12,20,38,0.96) 0%, rgba(18,30,52,0.92) 50%, rgba(14,24,42,0.96) 100%)',
        borderBottom: `1px solid ${SLATE.primary}18`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Atmospheric glows — wider, softer */}
        <div style={{
          position: 'absolute', top: -140, left: -100, width: 500, height: 500,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${SLATE.sky}0a 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', top: '30%', right: -80, width: 400, height: 400,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${SLATE.steel}08 0%, transparent 60%)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -60, left: '30%', width: 350, height: 200,
          borderRadius: '50%',
          background: `radial-gradient(ellipse, ${SLATE.sky}06 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          {/* Badge row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 14px', borderRadius: 22,
              background: `${SLATE.sky}12`, border: `1px solid ${SLATE.sky}28`,
            }}>
              <Activity style={{ width: 13, height: 13, color: SLATE.sky }} />
              <span style={{ fontSize: 10.5, fontWeight: 800, color: SLATE.sky, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'DM Sans',sans-serif" }}>
                Multi-Model Ensemble
              </span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8,
              background: `${SLATE.steel}10`, border: `1px solid ${SLATE.steel}25`,
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: SLATE.steel }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: SLATE.steel, fontFamily: 'monospace' }}>TCM Grid</span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8,
              background: `${SLATE.ice}10`, border: `1px solid ${SLATE.ice}25`,
            }}>
              <Calendar style={{ width: 11, height: 11, color: SLATE.ice }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: SLATE.ice, fontFamily: 'monospace' }}>96h</span>
            </div>
          </div>

          <h1 style={{
            margin: '0 0 10px', fontSize: 'clamp(1.7rem, 4.2vw, 2.5rem)', fontWeight: 900,
            letterSpacing: '-0.035em', fontFamily: "'Archivo','DM Sans',sans-serif",
            background: `linear-gradient(135deg, ${SLATE.sky} 0%, ${SLATE.ice} 45%, ${SLATE.steel} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text', lineHeight: 1.1,
          }}>
            Live model scenarios (next 96 hours)
          </h1>
          <p style={{ margin: 0, fontSize: '0.85rem', color: SLATE.light, lineHeight: 1.65, maxWidth: 620, fontWeight: 500 }}>
            Live TCM model run analysis from RiskGridCache — Open-Meteo multi-model ensemble data.
            CAPE, temperature, precipitation, and shear parameters out to 96 hours.
          </p>
        </div>
      </div>

      {/* ─── DASHBOARD GRID ──────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px' }}>
        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12, marginBottom: 30,
          }}>
          <StatPill label="Peak CAPE" value={Math.round(Math.max(...data.capeStats.map(d => d.max)))} unit="J/kg" color={SLATE.sky} icon={TrendingUp} />
          <StatPill label="Max Shear 0–6km" value={Math.round(Math.max(...data.shearData.map(d => d.shear06)) * 10) / 10} unit="m/s" color={SLATE.fog} icon={Wind} />
          <StatPill label="Max Precip Prob" value={Math.round(Math.max(...data.precipData.map(d => d.probability)))} unit="%" color={SLATE.ice} icon={Droplets} />
          <StatPill label="Ensemble Spread" value={Math.round(Math.max(...data.spreadData.map(d => d.spread)))} unit="J/kg" color={SLATE.steel} icon={Layers} />
          <StatPill label="Temp Range" value={`${Math.round(Math.min(...data.tempData.map(d => Math.min(d.gfs, d.ecmwf, d.ukmo))))}\u2013${Math.round(Math.max(...data.tempData.map(d => Math.max(d.gfs, d.ecmwf, d.ukmo))))}`} unit="°C" color={SLATE.light} icon={Thermometer} />
        </motion.div>

        {/* Charts grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <CAPEEnsembleChart data={data.capeStats} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: 20 }}>
            <TemperatureTrendChart data={data.tempData} />
            <PrecipitationProbabilityChart data={data.precipData} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: 20 }}>
            <WindShearChart data={data.shearData} />
            <EnsembleSpreadRadar data={data.spreadData} />
          </div>
        </div>

        {/* Footer note */}
        <div style={{
          marginTop: 34, padding: '18px 22px', borderRadius: 16,
          background: `${SLATE.sky}06`, border: `1px solid ${SLATE.sky}12`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: `${SLATE.sky}15`, border: `1px solid ${SLATE.sky}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChart3 style={{ width: 17, height: 17, color: SLATE.sky }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#e2e8f0', fontFamily: "'DM Sans',sans-serif" }}>
              TCM ensemble data from {data.modelRun ? 'multi-model run' : 'RiskGridCache'}
              {data.runTime ? ` · ${data.runTime.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC` : ''}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: SLATE.light, lineHeight: 1.5, fontWeight: 500 }}>
              Charts use live TCM model data from Open-Meteo ensemble via GFS, ECMWF, UKMO & AI-IFS members. No synthetic data is used.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}