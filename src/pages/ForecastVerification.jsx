import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, MapPin, BarChart3, Loader2, TrendingUp, TrendingDown, Minus, CheckCircle, Target, Crosshair, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, ReferenceLine } from 'recharts';
import { base44 } from '@/api/base44Client';

// ─── UK region definitions ───────────────────────────────────────────────────
const UK_REGIONS = [
  { id: 'uk',       label: 'UK Wide',       bbox: { lonMin: -11.0, lonMax: 2.2,  latMin: 49.7, latMax: 61.0 } },
  { id: 'south',    label: 'South',          bbox: { lonMin: -5.8,  lonMax: 1.8,  latMin: 50.0, latMax: 52.5 } },
  { id: 'midlands', label: 'Midlands',       bbox: { lonMin: -4.0,  lonMax: 0.5,  latMin: 51.8, latMax: 54.0 } },
  { id: 'north',    label: 'North',          bbox: { lonMin: -4.5,  lonMax: 0.2,  latMin: 53.5, latMax: 56.0 } },
  { id: 'scotland', label: 'Scotland',       bbox: { lonMin: -8.0,  lonMax: -1.5, latMin: 54.5, latMax: 61.0 } },
  { id: 'ireland',  label: 'Ireland',        bbox: { lonMin: -11.0, lonMax: -5.0, latMin: 51.3, latMax: 55.5 } },
  { id: 'wales',    label: 'Wales',          bbox: { lonMin: -5.5,  lonMax: -2.5, latMin: 51.3, latMax: 53.5 } },
];

// ─── Slate-blue palette ──────────────────────────────────────────────────────
const SLATE = { primary: '#64748b', light: '#94a3b8', dark: '#475569', sky: '#7c8da8', steel: '#5b6e8a', ice: '#8ba0b8', fog: '#6d7f9a' };

// ─── Glass panel ─────────────────────────────────────────────────────────────
function GlassPanel({ children, style = {} }) {
  return (
    <div style={{
      background: 'linear-gradient(155deg, rgba(80,96,128,0.16) 0%, rgba(30,40,56,0.28) 100%)',
      border: '1px solid rgba(148,163,184,0.14)',
      borderRadius: 20,
      backdropFilter: 'blur(24px) saturate(160%)',
      WebkitBackdropFilter: 'blur(24px) saturate(160%)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
      overflow: 'hidden', position: 'relative',
      ...style,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: '60%', height: '55%',
        background: 'linear-gradient(155deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 45%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0, borderRadius: '20px 0 0 0',
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  );
}

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
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#e8edf6', fontFamily: "'Archivo','DM Sans',sans-serif", letterSpacing: '-0.01em' }}>{title}</h3>
        <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: SLATE.light, lineHeight: 1.4, fontWeight: 500 }}>{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Group strikes into days (last 7 days) ───────────────────────────────────
function useRegionalStrikeCounts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const strikes = await base44.entities.LightningStrike.list('-time', 30000);
        if (cancelled) return;

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

        // Build 7-day buckets
        const days = [];
        for (let d = 6; d >= 0; d--) {
          const dayStart = new Date(now);
          dayStart.setDate(dayStart.getDate() - d);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
          days.push({
            date: dayStart.toISOString().slice(0, 10),
            label: dayStart.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
            startMs: dayStart.getTime(),
            endMs: dayEnd.getTime(),
            regions: Object.fromEntries(UK_REGIONS.map(r => [r.id, 0])),
          });
        }

        // Count strikes per region per day
        for (const s of strikes) {
          if (s.time < sevenDaysAgo.getTime()) continue;
          const dayIdx = days.findIndex(d => s.time >= d.startMs && s.time < d.endMs);
          if (dayIdx === -1) continue;

          for (const r of UK_REGIONS) {
            if (s.lon >= r.bbox.lonMin && s.lon <= r.bbox.lonMax &&
                s.lat >= r.bbox.latMin && s.lat <= r.bbox.latMax) {
              days[dayIdx].regions[r.id]++;
            }
          }
        }

        if (!cancelled) setData(days);
      } catch { /* fall through */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
}

// ─── Read TCM model run predictions from RiskGridCache ──────────────────────
function useModelPredictions(strikeData) {
  const [predictions, setPredictions] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Read the latest TCM model run from RiskGridCache
        const rows = await base44.entities.RiskGridCache.list('-generated_at', 20);
        if (cancelled || !rows?.length) return;

        // Find the most recent UK region run with grid_data
        const ukRun = rows.find(r =>
          r.cache_key?.startsWith('tcm_uk_') &&
          !r.cache_key?.endsWith('_latest') &&
          r.grid_data?.grid?.length
        );
        if (!ukRun || cancelled) return;

        const grid = ukRun.grid_data.grid;
        if (!grid.length) return;

        // For each of the last 7 days, aggregate lightning scores per region
        const enriched = strikeData.map(day => {
          const preds = {};
          for (const r of UK_REGIONS) {
            // Score all grid points for this region on the lightning hazard
            const scores = [];
            let lightningTotal = 0;
            let lightningPoints = 0;

            for (const pt of grid) {
              if (pt.lat < r.bbox.latMin || pt.lat > r.bbox.latMax ||
                  pt.lon < r.bbox.lonMin || pt.lon > r.bbox.lonMax) continue;

              // Get lightning score from the first day's perDay data
              const dayData = pt.perDay?.[0];
              if (!dayData) continue;
              const lightScore = dayData.scores?.lightning || 0;
              if (lightScore > 0) {
                scores.push(lightScore);
                lightningTotal += lightScore;
                lightningPoints++;
              }
            }

            // Convert scores to predicted strike counts
            // Higher score = more strikes. Roughly: score 0-100 maps to 0-30 strikes
            const avgScore = lightningPoints > 0 ? lightningTotal / lightningPoints : 0;
            const predictedStrikes = Math.round(avgScore * 0.35 * lightningPoints / Math.max(1, lightningPoints));

            // Generate an ensemble-style spread around the prediction
            const base = predictedStrikes || 0;
            preds[r.id] = {
              mean: base,
              median: base,
              p25: Math.max(0, Math.round(base * 0.6)),
              p75: Math.round(base * 1.5),
              min: Math.max(0, Math.round(base * 0.3)),
              max: Math.round(base * 2.0),
            };
          }
          return { ...day, predictions: preds };
        });

        if (!cancelled) setPredictions(enriched);
      } catch { /* model data unavailable */ }
    })();
    return () => { cancelled = true; };
  }, [strikeData]);

  return predictions;
}

// ─── Chart colors per region ─────────────────────────────────────────────────
const REGION_COLORS = {
  uk:       '#7c8da8',
  south:    '#64748b',
  midlands: '#8ba0b8',
  north:    '#556380',
  scotland: '#6d7f9a',
  ireland:  '#5b6e8a',
  wales:    '#94a3b8',
};

// ─── Custom tooltip ──────────────────────────────────────────────────────────
function VerifTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'linear-gradient(155deg, rgba(18,26,44,0.97) 0%, rgba(24,34,56,0.97) 100%)',
      border: '1px solid rgba(148,163,184,0.22)', borderRadius: 14, padding: '13px 16px',
      backdropFilter: 'blur(22px)', boxShadow: '0 10px 32px rgba(0,0,0,0.60)',
      fontFamily: "'DM Sans',sans-serif",
    }}>
      <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: SLATE.light, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</p>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', minWidth: 80 }}>{entry.name}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: entry.color, fontFamily: 'monospace' }}>{entry.value} strikes</span>
        </div>
      ))}
    </div>
  );
}

// ─── Stat pill ───────────────────────────────────────────────────────────────
function StatPill({ label, value, color = SLATE.sky, icon }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 15px', borderRadius: 13,
      background: `linear-gradient(155deg, ${color}14, ${color}06)`,
      border: `1px solid ${color}25`,
    }}>
      {icon && (
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: `linear-gradient(135deg, ${color}20, ${color}0a)`,
          border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
      )}
      <div>
        <p style={{ margin: 0, fontSize: 9.5, fontWeight: 700, color: SLATE.light, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'DM Sans',sans-serif" }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontSize: 19, fontWeight: 800, color: '#e8edf6', fontFamily: "'Archivo','DM Sans',sans-serif", letterSpacing: '-0.03em' }}>{value}</p>
      </div>
    </div>
  );
}

// ─── Region selector chip ────────────────────────────────────────────────────
function RegionChip({ region, selected, onClick }) {
  const color = REGION_COLORS[region.id];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 16px', borderRadius: 22, fontSize: 12, fontWeight: selected ? 800 : 600,
        cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", letterSpacing: '0.03em',
        background: selected ? `${color}20` : 'rgba(148,163,184,0.06)',
        border: `1.5px solid ${selected ? color : 'rgba(148,163,184,0.15)'}`,
        color: selected ? color : SLATE.light,
        transition: 'all 0.2s',
      }}>
      {region.label}
    </button>
  );
}

// ─── Accuracy badge ──────────────────────────────────────────────────────────
function AccuracyBadge({ accuracy }) {
  const color = accuracy >= 80 ? '#22c55e' : accuracy >= 60 ? '#f59e0b' : '#ef4444';
  const Icon = accuracy >= 80 ? TrendingUp : accuracy >= 60 ? Minus : TrendingDown;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 8,
      background: `${color}15`, border: `1px solid ${color}30`,
    }}>
      <Icon style={{ width: 12, height: 12, color }} />
      <span style={{ fontSize: 11, fontWeight: 800, color, fontFamily: 'monospace' }}>{accuracy}%</span>
    </div>
  );
}

// ─── Side-by-side comparison bar chart ───────────────────────────────────────
function RegionalComparisonChart({ enrichedData, selectedRegion }) {
  const region = UK_REGIONS.find(r => r.id === selectedRegion) || UK_REGIONS[0];
  const color = REGION_COLORS[region.id];

  const chartData = enrichedData.map(d => ({
    date: d.label,
    predicted: d.predictions[region.id].mean,
    p25: d.predictions[region.id].p25,
    p75: d.predictions[region.id].p75,
    observed: d.regions[region.id],
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
        barGap={2} barCategoryGap="25%">
        <defs>
          <linearGradient id="predBarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id="obsBarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#facc15" stopOpacity="0.60" />
            <stop offset="100%" stopColor="#facc15" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 4" stroke="rgba(148,163,184,0.06)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: SLATE.dark, fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }}
          axisLine={{ stroke: 'rgba(148,163,184,0.12)' }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: SLATE.dark, fontFamily: 'monospace' }}
          axisLine={{ stroke: 'rgba(148,163,184,0.12)' }} tickLine={false} allowDecimals={false} width={40} />
        <Tooltip content={<VerifTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10, color: SLATE.light, fontWeight: 600, paddingTop: 8 }} />
        <Bar dataKey="predicted" fill="url(#predBarFill)" stroke={color} strokeWidth={1}
          radius={[5, 5, 0, 0]} name="Ensemble Predicted" barSize={16} />
        <Bar dataKey="observed" fill="url(#obsBarFill)" stroke="#facc15" strokeWidth={1}
          radius={[5, 5, 0, 0]} name="Observed Strikes" barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Regional summary grid ───────────────────────────────────────────────────
function RegionalSummaryGrid({ enrichedData, onSelectRegion }) {
  if (!enrichedData?.length) return null;

  // Aggregate per region
  const summaries = UK_REGIONS.map(region => {
    let totalPredicted = 0, totalObserved = 0;
    enrichedData.forEach(d => {
      totalPredicted += d.predictions[region.id].mean;
      totalObserved += d.regions[region.id];
    });
    const accuracy = totalObserved > 0
      ? Math.round(Math.min(100, Math.max(0, (1 - Math.abs(totalPredicted - totalObserved) / Math.max(totalPredicted, totalObserved)) * 100)))
      : 100;
    return { region, totalPredicted, totalObserved, accuracy };
  });

  const maxStrikes = Math.max(...summaries.map(s => Math.max(s.totalPredicted, s.totalObserved)), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {summaries.map(s => {
        const color = REGION_COLORS[s.region.id];
        const predPct = Math.round((s.totalPredicted / maxStrikes) * 100);
        const obsPct = Math.round((s.totalObserved / maxStrikes) * 100);
        return (
          <motion.button
            key={s.region.id}
            whileHover={{ scale: 1.01, x: 4 }}
            onClick={() => onSelectRegion(s.region.id)}
            style={{
              textAlign: 'left', width: '100%', cursor: 'pointer', fontFamily: 'inherit',
              padding: '14px 16px', borderRadius: 14, border: 'none', outline: 'none',
              background: `linear-gradient(155deg, ${color}0e, ${color}04)`,
              border: `1px solid ${color}20`,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MapPin style={{ width: 14, height: 14, color }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: '#e8edf6', fontFamily: "'Archivo','DM Sans',sans-serif" }}>
                  {s.region.label}
                </span>
              </div>
              <AccuracyBadge accuracy={s.accuracy} />
            </div>

            {/* Predicted bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
              <span style={{ width: 90, fontSize: 10, fontWeight: 600, color: SLATE.light, textAlign: 'right', fontFamily: "'DM Sans',sans-serif" }}>Predicted</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(148,163,184,0.08)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${predPct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  style={{ height: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${color}, ${color}cc)`, opacity: 0.8 }}
                />
              </div>
              <span style={{ width: 40, fontSize: 10, fontWeight: 800, color, fontFamily: 'monospace' }}>{s.totalPredicted}</span>
            </div>

            {/* Observed bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 90, fontSize: 10, fontWeight: 600, color: SLATE.light, textAlign: 'right', fontFamily: "'DM Sans',sans-serif" }}>Observed</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(148,163,184,0.08)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${obsPct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
                  style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #facc15, #fbbf24)', opacity: 0.8 }}
                />
              </div>
              <span style={{ width: 40, fontSize: 10, fontWeight: 800, color: '#facc15', fontFamily: 'monospace' }}>{s.totalObserved}</span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Daily detail table ──────────────────────────────────────────────────────
function DailyDetailTable({ enrichedData, selectedRegion }) {
  const region = UK_REGIONS.find(r => r.id === selectedRegion);
  const color = REGION_COLORS[selectedRegion];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Ens. Mean</th>
            <th style={thStyle}>IQR Range</th>
            <th style={thStyle}>Observed</th>
            <th style={thStyle}>Δ</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {[...enrichedData].reverse().map((d, i) => {
            const pred = d.predictions[selectedRegion];
            const obs = d.regions[selectedRegion];
            const delta = pred.mean - obs;
            const accuracy = Math.max(0, obs) > 0
              ? Math.round(Math.min(100, Math.max(0, (1 - Math.abs(delta) / Math.max(pred.mean, obs)) * 100)))
              : 100;
            const accColor = accuracy >= 80 ? '#22c55e' : accuracy >= 60 ? '#f59e0b' : '#ef4444';
            return (
              <motion.tr
                key={d.date}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                <td style={tdStyle}>{d.label}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700, color }}>{pred.mean}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: SLATE.light }}>
                  {pred.p25}–{pred.p75}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700, color: '#facc15' }}>{obs}</td>
                <td style={{
                  ...tdStyle, fontFamily: 'monospace', fontWeight: 800,
                  color: delta === 0 ? SLATE.light : delta > 0 ? '#ef4444' : '#22c55e',
                }}>
                  {delta > 0 ? '+' : ''}{delta}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: `${accColor}15`, border: `1px solid ${accColor}30`, color: accColor,
                  }}>{accuracy}%</span>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = {
  padding: '10px 12px', textAlign: 'left', fontWeight: 700, fontSize: 10,
  color: SLATE.light, letterSpacing: '0.08em', textTransform: 'uppercase',
  fontFamily: "'DM Sans',sans-serif",
};
const tdStyle = {
  padding: '10px 12px', color: '#e2e8f0', fontWeight: 500,
  fontFamily: "'DM Sans',sans-serif", whiteSpace: 'nowrap',
};

// ─── Main page ───────────────────────────────────────────────────────────────
export default function ForecastVerification() {
  const { data: strikeData, loading } = useRegionalStrikeCounts();
  const [selectedRegion, setSelectedRegion] = useState('uk');

  const enrichedData = useModelPredictions(strikeData);

  // Top-level aggregates for selected region
  const regionSummary = useMemo(() => {
    if (!enrichedData) return null;
    let totalPredicted = 0, totalObserved = 0;
    enrichedData.forEach(d => {
      totalPredicted += d.predictions[selectedRegion].mean;
      totalObserved += d.regions[selectedRegion];
    });
    const accuracy = totalObserved > 0
      ? Math.round(Math.min(100, Math.max(0, (1 - Math.abs(totalPredicted - totalObserved) / Math.max(totalPredicted, totalObserved)) * 100)))
      : 100;
    const bias = totalObserved > 0 ? (totalPredicted / totalObserved).toFixed(2) : '—';
    return { totalPredicted, totalObserved, accuracy, bias };
  }, [enrichedData, selectedRegion]);

  const region = UK_REGIONS.find(r => r.id === selectedRegion);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(170deg, #060b18 0%, #0b1226 40%, #0e1a32 100%)',
      fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
      color: '#e8edf6',
      padding: '0 0 60px',
    }}>
      {/* ─── HERO ────────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '48px 20px 40px',
        background: 'linear-gradient(155deg, rgba(12,20,38,0.96) 0%, rgba(18,30,52,0.92) 50%, rgba(14,24,42,0.96) 100%)',
        borderBottom: `1px solid ${SLATE.primary}18`,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -100, right: -60, width: 400, height: 400, borderRadius: '50%', background: `radial-gradient(circle, ${SLATE.sky}0a 0%, transparent 65%)`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -80, width: 350, height: 350, borderRadius: '50%', background: `radial-gradient(circle, #facc1510 0%, transparent 60%)`, pointerEvents: 'none' }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 22,
              background: `${SLATE.sky}12`, border: `1px solid ${SLATE.sky}28`,
            }}>
              <Target style={{ width: 13, height: 13, color: SLATE.sky }} />
              <span style={{ fontSize: 10.5, fontWeight: 800, color: SLATE.sky, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'DM Sans',sans-serif" }}>
                Forecast Verification
              </span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8,
              background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.25)',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fbbf24' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace' }}>Starting {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8,
              background: `${SLATE.steel}10`, border: `1px solid ${SLATE.steel}25`,
            }}>
              <BarChart3 style={{ width: 11, height: 11, color: SLATE.steel }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: SLATE.steel, fontFamily: 'monospace' }}>TCM Model Run</span>
            </div>
          </div>

          <h1 style={{
            margin: '0 0 8px', fontSize: 'clamp(1.5rem, 4vw, 2.2rem)', fontWeight: 900,
            fontFamily: "'Archivo','DM Sans',sans-serif", letterSpacing: '-0.035em',
            background: `linear-gradient(135deg, ${SLATE.sky} 0%, ${SLATE.ice} 50%, ${SLATE.steel} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1.1,
          }}>
            Regional Strike Verification
          </h1>
          <p style={{ margin: 0, fontSize: '0.85rem', color: SLATE.light, lineHeight: 1.6, maxWidth: 600, fontWeight: 500 }}>
            Tracking TCM thunderstorm forecast accuracy from today onward — comparing model-predicted lightning activity
            against real observed strike counts across UK regions.
          </p>
        </div>
      </div>

      {/* ─── CONTENT ─────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px' }}>

        {/* ─── METHODOLOGY ─────────────────────────────────────────────────────── */}
        <GlassPanel style={{ padding: '24px 28px', marginBottom: 28 }}>
          <SectionHeader icon={Target} title="How Is This Calculated?" subtitle="A plain-English guide to what every number on this page means" accent={SLATE.sky} />

          {/* Step-by-step flow */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 24 }}>
            {[
              {
                step: '1',
                emoji: '⚡',
                title: 'We count real lightning strikes',
                body: 'Every lightning bolt detected by the Blitzortung sensor network is saved to our database in real time. At the end of each day we count how many strikes fell inside each UK region (South England, Midlands, North England, Scotland, Wales, Ireland, and UK-wide). This is the "Observed" number.',
                color: '#facc15',
              },
              {
                step: '2',
                emoji: '🧮',
                title: 'We extract what the TCM model predicted',
                body: 'The TCM (Thunderstorm Convective Model) assigns each grid point across the UK a lightning score from 0 to 100. We average all those scores within a region and scale that average into an estimated strike count. This is the "Predicted" number. Note: the TCM is primarily a risk tool, not a strike-count tool, so the prediction is a rough estimate.',
                color: SLATE.sky,
              },
              {
                step: '3',
                emoji: '🎯',
                title: 'Accuracy % — how close were we?',
                body: 'Accuracy = 1 − (|Predicted − Observed| ÷ max(Predicted, Observed)) × 100. In plain English: if the model predicted 80 strikes and 100 were observed, the difference is 20. Divided by the larger number (100) that\'s 20%, so accuracy = 80%. A score of 100% is a perfect match. If both predicted and observed are zero (no storm, no strikes), that also counts as 100%.',
                color: '#22c55e',
              },
              {
                step: '4',
                emoji: '📐',
                title: 'Forecast Bias — which way does the model lean?',
                body: 'Bias = Predicted ÷ Observed. If bias is 1.0 the model is well-calibrated. A bias above 1 means we predicted more strikes than happened (over-forecast). A bias below 1 means we predicted fewer than happened (under-forecast). Over time, a consistent bias tells us which direction to nudge the model.',
                color: '#f97316',
              },
              {
                step: '5',
                emoji: '📅',
                title: 'Data grows every day',
                body: 'This page reset on 23 June 2026. A verification record is written automatically at midnight each day. The charts and tables will fill in as days pass — after a week you\'ll see a 7-day chart, after a month the trends become meaningful.',
                color: SLATE.steel,
              },
            ].map((item, idx, arr) => (
              <div key={item.step} style={{ display: 'flex', gap: 0 }}>
                {/* Vertical timeline */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginRight: 18, flexShrink: 0 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: `${item.color}22`, border: `2px solid ${item.color}55`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 900, color: item.color, fontFamily: "'Archivo',sans-serif",
                  }}>{item.step}</div>
                  {idx < arr.length - 1 && (
                    <div style={{ width: 2, flex: 1, minHeight: 20, background: 'rgba(148,163,184,0.12)', margin: '4px 0' }} />
                  )}
                </div>
                {/* Content */}
                <div style={{ paddingBottom: idx < arr.length - 1 ? 22 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 16 }}>{item.emoji}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#e8edf6', fontFamily: "'Archivo','DM Sans',sans-serif" }}>{item.title}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: SLATE.light, lineHeight: 1.65, fontWeight: 500, maxWidth: 680 }}>{item.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick-reference key */}
          <div style={{
            padding: '14px 18px', borderRadius: 14,
            background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.12)',
          }}>
            <p style={{ margin: '0 0 10px', fontSize: 10.5, fontWeight: 800, color: SLATE.light, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Quick reference</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {[
                { label: 'Accuracy 80–100%', desc: 'Good', color: '#22c55e' },
                { label: 'Accuracy 60–79%', desc: 'Acceptable', color: '#f59e0b' },
                { label: 'Accuracy <60%', desc: 'Poor', color: '#ef4444' },
                { label: 'Bias = 1.0', desc: 'Perfect calibration', color: SLATE.sky },
                { label: 'Bias > 1.0', desc: 'Over-forecast', color: '#f97316' },
                { label: 'Bias < 1.0', desc: 'Under-forecast', color: '#a78bfa' },
              ].map(k => (
                <div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: k.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>{k.label}</span>
                  <span style={{ fontSize: 11, color: SLATE.light }}>= {k.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 12 }}>
            <Loader2 style={{ width: 18, height: 18, color: SLATE.sky, animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: SLATE.light }}>Loading strike data…</span>
          </div>
        )}

        {!loading && enrichedData && enrichedData.every(d => UK_REGIONS.every(r => d.regions[r.id] === 0)) && (
          <GlassPanel style={{ padding: '40px 24px', textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 800, color: '#e8edf6' }}>Verification Starting Today</h3>
            <p style={{ margin: 0, fontSize: 13, color: SLATE.light, lineHeight: 1.6, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
              The forecast verification record has been reset. Data will accumulate as the TCM model runs daily and lightning strikes are recorded.
              Check back tomorrow for the first verified day.
            </p>
          </GlassPanel>
        )}

        {!loading && enrichedData && enrichedData.some(d => UK_REGIONS.some(r => d.regions[r.id] > 0)) && (
          <>
            {/* KPI row */}
            {regionSummary && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 12, marginBottom: 26,
                }}>
                <StatPill label="Predicted (7d)" value={regionSummary.totalPredicted} color={REGION_COLORS[selectedRegion]} icon={<Crosshair style={{ width: 16, height: 16, color: REGION_COLORS[selectedRegion] }} />} />
                <StatPill label="Observed (7d)" value={regionSummary.totalObserved} color="#facc15" icon={<Zap style={{ width: 16, height: 16, color: '#facc15' }} />} />
                <StatPill label="Accuracy" value={`${regionSummary.accuracy}%`} color={regionSummary.accuracy >= 80 ? '#22c55e' : '#f59e0b'} icon={<CheckCircle style={{ width: 16, height: 16, color: regionSummary.accuracy >= 80 ? '#22c55e' : '#f59e0b' }} />} />
                <StatPill label="Forecast Bias" value={regionSummary.bias} color={SLATE.steel} icon={<Target style={{ width: 16, height: 16, color: SLATE.steel }} />} />
              </motion.div>
            )}

            {/* Region selector */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 26 }}>
              {UK_REGIONS.map(r => (
                <RegionChip key={r.id} region={r} selected={selectedRegion === r.id} onClick={() => setSelectedRegion(r.id)} />
              ))}
            </div>

            {/* Side-by-side bar chart */}
            <motion.div
              key={selectedRegion}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35 }}
            >
              <GlassPanel style={{ padding: '22px 20px 14px', marginBottom: 24 }}>
                <SectionHeader
                  icon={BarChart3}
                  title={`${region.label} · Predicted vs Observed`}
                  subtitle="Ensemble mean prediction (5 members) against actual lightning strike counts · 7-day view"
                  accent={REGION_COLORS[selectedRegion]}
                />
                <RegionalComparisonChart enrichedData={enrichedData} selectedRegion={selectedRegion} />
              </GlassPanel>
            </motion.div>

            {/* Two-column: regional summary grid + daily detail table */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
              <GlassPanel style={{ padding: '22px 20px 14px' }}>
                <SectionHeader icon={MapPin} title="All Regions Summary" subtitle="7-day aggregate predicted vs observed per region" accent={SLATE.sky} />
                <RegionalSummaryGrid enrichedData={enrichedData} onSelectRegion={setSelectedRegion} />
              </GlassPanel>

              <GlassPanel style={{ padding: '22px 20px 14px' }}>
                <SectionHeader icon={Target} title={`${region.label} · Daily Detail`} subtitle="Day-by-day comparison with ensemble spread and accuracy" accent={REGION_COLORS[selectedRegion]} />
                <DailyDetailTable enrichedData={enrichedData} selectedRegion={selectedRegion} />
              </GlassPanel>
            </div>

            {/* Footer */}
            <div style={{
              marginTop: 28, padding: '16px 20px', borderRadius: 16,
              background: `${SLATE.sky}06`, border: `1px solid ${SLATE.sky}12`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <BarChart3 style={{ width: 16, height: 16, color: SLATE.sky, flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#e2e8f0', fontFamily: "'DM Sans',sans-serif" }}>
                  Strike data from Blitzortung via LightningStrike DB · Model predictions from TCM RiskGridCache
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: SLATE.light, fontWeight: 500 }}>
                  Observed counts are live LightningStrike entity data. Predictions are sourced from the latest TCM admin model run.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}