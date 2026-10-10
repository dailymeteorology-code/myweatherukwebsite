import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, Clock, AlertTriangle, Wind, Droplets, Zap } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

/* ─────────────────────────────────────────────
   BST FORMATTING
───────────────────────────────────────────── */
const BST_TZ = 'Europe/London';

function formatBST(iso, fmt = 'dd MMM yyyy, HH:mm') {
  if (!iso) return null;
  const d = new Date(iso);
  if (!isValid(d)) return null;
  const zoned = toZonedTime(d, BST_TZ);
  return format(zoned, fmt);
}

/* ─────────────────────────────────────────────
   RICH TEXT RENDERER — sanitized
   Strips script/iframe/object tags and all
   event-handler / javascript: attributes before
   rendering so stored-XSS payloads can't execute.
───────────────────────────────────────────── */
function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  // Remove dangerous block-level tags and their content
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '');
  // Strip on* event handlers and javascript: hrefs/srcs from any remaining tag
  out = out.replace(/(<[^>]+?)\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '$1');
  out = out.replace(/(<[^>]+?(?:href|src|action)\s*=\s*)["']?\s*javascript:[^"'\s>]*/gi, '$1"#"');
  return out;
}

function RichText({ html, className = '', style = {} }) {
  if (!html) return null;
  return (
    <div
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      className={className}
      style={{ lineHeight: 1.7, ...style }}
    />
  );
}

/* ─────────────────────────────────────────────
   RISK LEVELS
   Very Low (dark green) · Low (light green) · Marginal (yellow)
   · Slight (orange/amber) · Moderate (red) · High (purple)
   · Severe (black, outlined)
───────────────────────────────────────────── */
const IMPACT_LEVELS = ['Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];

const IMPACT_CONFIG = {
  'Very Low': {
    gradient: 'from-green-800/25 to-green-900/5',
    border: 'border-green-800/50',
    activeBg: 'bg-green-800',
    activeText: 'text-white',
    dot: 'bg-green-700',
    text: 'text-green-400',
    glow: 'shadow-green-800/20',
  },
  Low: {
    gradient: 'from-emerald-400/20 to-emerald-500/5',
    border: 'border-emerald-400/40',
    activeBg: 'bg-emerald-400',
    activeText: 'text-slate-900',
    dot: 'bg-emerald-300',
    text: 'text-emerald-300',
    glow: 'shadow-emerald-400/20',
  },
  Marginal: {
    gradient: 'from-yellow-400/20 to-yellow-500/5',
    border: 'border-yellow-400/40',
    activeBg: 'bg-yellow-400',
    activeText: 'text-slate-900',
    dot: 'bg-yellow-400',
    text: 'text-yellow-400',
    glow: 'shadow-yellow-400/20',
  },
  Slight: {
    gradient: 'from-orange-500/20 to-orange-600/5',
    border: 'border-orange-500/40',
    activeBg: 'bg-orange-500',
    activeText: 'text-white',
    dot: 'bg-orange-400',
    text: 'text-orange-400',
    glow: 'shadow-orange-500/20',
  },
  Moderate: {
    gradient: 'from-red-500/20 to-red-600/5',
    border: 'border-red-500/40',
    activeBg: 'bg-red-500',
    activeText: 'text-white',
    dot: 'bg-red-400',
    text: 'text-red-400',
    glow: 'shadow-red-500/20',
  },
  High: {
    gradient: 'from-purple-500/20 to-purple-600/5',
    border: 'border-purple-500/40',
    activeBg: 'bg-purple-500',
    activeText: 'text-white',
    dot: 'bg-purple-400',
    text: 'text-purple-400',
    glow: 'shadow-purple-500/20',
  },
  Severe: {
    gradient: 'from-black/40 to-black/10',
    border: 'border-black',
    activeBg: 'bg-black',
    activeText: 'text-white',
    dot: 'bg-black',
    text: 'text-slate-200',
    glow: 'shadow-black/40',
  },
};

/* Range metadata so we can show friendly labels/units */
const RANGE_META = {
  snow_accumulation_cm: { label: 'Snow Accumulation', unit: 'cm' },
  ice_temp_c:           { label: 'Ice Temp Range',    unit: '°C' },
  storm_rain_mm_hr:     { label: 'Storm Rain Rate',   unit: 'mm/hr' },
  rain_total_mm:        { label: 'Rain Total',        unit: 'mm' },
  wind_gust_mph:        { label: 'Wind Gusts',        unit: 'mph' },
  temp_range_c:         { label: 'Temperature Range', unit: '°C' },
  visibility_m:         { label: 'Visibility',        unit: 'm' },
};

const STORM_RISKS = [
  { key: 'tornado_risk',      label: 'Tornadoes',    icon: '🌪',  bar: 'bg-gradient-to-r from-red-600 to-red-400',      badge: 'border-red-500/50 text-red-400' },
  { key: 'hail_risk',         label: 'Hail',         icon: '🧊',  bar: 'bg-gradient-to-r from-sky-600 to-sky-400',      badge: 'border-sky-500/50 text-sky-400' },
  { key: 'flash_flood_risk',  label: 'Flash Flood',  icon: '🌊',  bar: 'bg-gradient-to-r from-blue-600 to-blue-400',    badge: 'border-blue-500/50 text-blue-400' },
  { key: 'strong_winds_risk', label: 'Strong Winds', icon: '💨',  bar: 'bg-gradient-to-r from-teal-600 to-teal-400',    badge: 'border-teal-500/50 text-teal-400' },
  { key: 'supercell_risk',    label: 'Supercells',   icon: '⚡',  bar: 'bg-gradient-to-r from-purple-600 to-purple-400', badge: 'border-purple-500/50 text-purple-400' },
];

const STORM_BADGES = [
  { key: 'high_lightning', label: 'High Lightning', icon: <Zap className="w-3 h-3" />,           cls: 'bg-yellow-400/10 border-yellow-400/40 text-yellow-300' },
  { key: 'severe',         label: 'Severe',          icon: <AlertTriangle className="w-3 h-3" />, cls: 'bg-orange-500/10 border-orange-500/40 text-orange-300' },
  { key: 'heavy_rain',     label: 'Heavy Rain',      icon: <Droplets className="w-3 h-3" />,      cls: 'bg-blue-500/10 border-blue-500/40 text-blue-300' },
];

function AnimatedBar({ value, colorClass, delay = 0 }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(value), delay + 100);
    return () => clearTimeout(t);
  }, [value, delay]);

  return (
    <div className="relative h-1.5 rounded-full bg-slate-800 overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${colorClass}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function SectionLabel({ icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-slate-500">{icon}</span>}
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{children}</span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  );
}

function TimeRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 w-24 shrink-0">{label}</span>
      <span className="text-white font-semibold text-sm font-mono">{value}</span>
    </div>
  );
}

export default function ForecastFurtherInfo({ forecast, isOwner, onClose, onUpdate }) {
  const selectedImpact = IMPACT_CONFIG[forecast.impact_level];

  const inForceAt = formatBST(forecast.in_force_from);
  const expiresAt = formatBST(forecast.expires_at);
  const updatedAt = forecast.updated_date ? formatBST(forecast.updated_date) : null;

  const normalizeList = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return [];
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch (_) { /* not JSON */ }
      return t.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  };

  const normalizeRanges = (v) => {
    let obj = v;
    if (typeof v === 'string') {
      try { obj = JSON.parse(v); } catch (_) { obj = null; }
    }
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj).filter(([, val]) => val != null && val !== '');
  };

  const subtypes = normalizeList(forecast.condition_subtypes);
  const ranges = normalizeRanges(forecast.condition_ranges);

  const td = forecast.thunderstorm_data || {};
  const hasThunderstormData = Object.keys(td).length > 0;
  const activeStormRisks = STORM_RISKS.filter(r => td[r.key] != null);
  const activeBadges = STORM_BADGES.filter(b => td[b.key]);

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-lg flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, scale: 0.94, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="w-full max-w-[620px] max-h-[92vh] overflow-y-auto rounded-[28px] bg-[#0e1520] border border-white/[0.06] shadow-2xl"
          style={{ scrollbarWidth: 'none' }}
          onClick={e => e.stopPropagation()}
        >

          {/* ── Hero header ── */}
          <div className="relative overflow-hidden rounded-t-[28px]">
            {/* Forecast image at the very top of the panel */}
            {forecast.image_url && (
              <div className="relative w-full">
                <img
                  src={forecast.image_url}
                  alt={forecast.title}
                  className="w-full max-h-[280px] object-cover block"
                />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[#0e1520] pointer-events-none" />
              </div>
            )}

            {selectedImpact && (
              <div className={`absolute inset-0 opacity-20 bg-gradient-to-br ${selectedImpact.gradient} pointer-events-none`} />
            )}

            <div className="relative px-6 pt-6 pb-5">
              {/* Top row */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {forecast.weather_condition && (
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                        {forecast.weather_condition}
                      </span>
                    )}
                    {updatedAt && (
                      <>
                        <span className="text-slate-700">·</span>
                        <span className="text-[10px] text-slate-600 font-mono">
                          Updated {updatedAt}
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-white leading-snug truncate">
                    {forecast.title}
                  </h2>
                </div>

                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Risk level display (read-only) */}
              {forecast.impact_level && selectedImpact ? (
                <div className="flex flex-wrap gap-2">
                  <span className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-bold ${selectedImpact.activeBg} ${selectedImpact.activeText} ${forecast.impact_level === 'Severe' ? 'border-black ring-1 ring-white/30' : 'border-transparent'} shadow-lg ${selectedImpact.glow}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
                    {forecast.impact_level}
                  </span>
                </div>
              ) : forecast.impact_levels?.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {forecast.impact_levels.map(level => {
                    const cfg = IMPACT_CONFIG[level];
                    if (!cfg) return null;
                    return (
                      <span key={level} className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-bold ${cfg.activeBg} ${cfg.activeText} ${level === 'Severe' ? 'border-black ring-1 ring-white/30' : 'border-transparent'} shadow-lg ${cfg.glow}`}>
                        {level}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {/* ── Body ── */}
          <div className="px-6 pb-8 space-y-7">
            <div className="h-px bg-white/[0.04]" />

            {/* Description */}
            {forecast.description && (
              <div>
                <SectionLabel>Description</SectionLabel>
                <p className="text-sm text-slate-300 leading-relaxed">
                  <RichText html={forecast.description} />
                </p>
              </div>
            )}

            {/* Condition sub-types */}
            {subtypes.length > 0 && (
              <div>
                <SectionLabel icon={<AlertTriangle className="w-3.5 h-3.5" />}>Forecast Detail</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {subtypes.map(s => (
                    <span
                      key={s}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs font-semibold text-slate-200"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Quantitative ranges */}
            {ranges.length > 0 && (
              <div>
                <SectionLabel>Measurements</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  {ranges.map(([key, value]) => {
                    const meta = RANGE_META[key] || { label: key, unit: '' };
                    return (
                      <div key={key} className="rounded-xl bg-slate-900/60 border border-white/[0.05] px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                          {meta.label}
                        </p>
                        <p className="text-white font-bold text-sm font-mono">
                          {value}{meta.unit ? ` ${meta.unit}` : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Time fields */}
            <div>
              <SectionLabel icon={<Clock className="w-3.5 h-3.5" />}>Timeline</SectionLabel>
              <div className="space-y-2.5">
                <TimeRow label="In Force From" value={inForceAt} />
                <TimeRow label="Expires At"    value={expiresAt} />
                {!inForceAt && !expiresAt && (
                  <p className="text-slate-600 italic text-sm">No timeline set</p>
                )}
              </div>
            </div>

            {/* Locations */}
            <div>
              <SectionLabel icon={<MapPin className="w-3.5 h-3.5" />}>Locations Impacted</SectionLabel>
              {forecast.locations_impacted?.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {forecast.locations_impacted.map((rawLoc, i) => {
                    const loc = typeof rawLoc === 'string' ? { name: rawLoc } : rawLoc;
                    const hasRisk = loc.overall_risk || loc.highest_risk || loc.lowest_risk;
                    const riskColors = {
                      'Very Low': '#86efac', Low: '#bbf7d0', Marginal: '#fde047',
                      Slight: '#fdba74', Moderate: '#fca5a5', High: '#d8b4fe', Severe: '#f8fafc',
                    };
                    return (
                      <motion.div
                        key={loc.name || i}
                        layout
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col gap-1 px-3 py-2 rounded-2xl bg-slate-800/80 border border-slate-700/60"
                      >
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          {loc.name}
                        </div>
                        {hasRisk && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {loc.overall_risk && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                style={{ color: riskColors[loc.overall_risk] || '#94a3b8', borderColor: `${riskColors[loc.overall_risk] || '#94a3b8'}44`, background: `${riskColors[loc.overall_risk] || '#94a3b8'}11` }}>
                                Overall: {loc.overall_risk}
                              </span>
                            )}
                            {!loc.overall_risk && loc.lowest_risk && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                style={{ color: riskColors[loc.lowest_risk] || '#86efac', borderColor: `${riskColors[loc.lowest_risk] || '#86efac'}44`, background: `${riskColors[loc.lowest_risk] || '#86efac'}11` }}>
                                ↓ Low: {loc.lowest_risk}
                              </span>
                            )}
                            {!loc.overall_risk && loc.highest_risk && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                                style={{ color: riskColors[loc.highest_risk] || '#fca5a5', borderColor: `${riskColors[loc.highest_risk] || '#fca5a5'}44`, background: `${riskColors[loc.highest_risk] || '#fca5a5'}11` }}>
                                ↑ High: {loc.highest_risk}
                              </span>
                            )}
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-slate-600 italic text-sm">No locations specified</p>
              )}
            </div>

            {/* Thunderstorm data */}
            {hasThunderstormData && (
              <div>
                <SectionLabel icon={<Zap className="w-3.5 h-3.5 text-purple-400" />}>
                  <span className="text-purple-500">Thunderstorm Risk</span>
                </SectionLabel>

                <div className="rounded-2xl bg-slate-900/60 border border-white/[0.04] overflow-hidden">
                  {activeStormRisks.length > 0 && (
                    <div className="p-4 space-y-4">
                      {activeStormRisks.map(({ key, label, icon, bar, badge }, i) => {
                        const val = td[key];
                        return (
                          <div key={key} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{icon}</span>
                                <span className="text-xs font-semibold text-slate-300">{label}</span>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-900 ${badge}`}>
                                {val}%
                              </span>
                            </div>
                            <AnimatedBar value={val} colorClass={bar} delay={i * 80} />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(td.wind_speed_mph != null || td.rain_mm_per_hour != null || td.hail_diameter_mm != null || td.tornado_intensity) && (
                    <div className="grid grid-cols-2 gap-px bg-white/[0.04] border-t border-white/[0.04]">
                      {[
                        td.wind_speed_mph    != null && { label: 'Wind Speed', value: `${td.wind_speed_mph} mph`,     icon: <Wind className="w-3.5 h-3.5" />,     color: 'text-teal-400' },
                        td.rain_mm_per_hour  != null && { label: 'Rainfall',   value: `${td.rain_mm_per_hour} mm/hr`, icon: <Droplets className="w-3.5 h-3.5" />, color: 'text-blue-400' },
                        td.hail_diameter_mm  != null && { label: 'Hail Size',  value: `${td.hail_diameter_mm} mm`,    icon: '🧊',                                   color: 'text-sky-400' },
                        td.tornado_intensity         && { label: 'Tornado',    value: td.tornado_intensity,           icon: '🌪',                                   color: 'text-red-400' },
                      ].filter(Boolean).map(({ label, value, icon, color }) => (
                        <div key={label} className="bg-slate-900/80 px-4 py-3">
                          <div className={`flex items-center gap-1.5 mb-1 ${color}`}>
                            {typeof icon === 'string' ? <span className="text-sm">{icon}</span> : icon}
                            <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
                          </div>
                          <p className="text-white font-bold text-sm font-mono">{value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeBadges.length > 0 && (
                    <div className="flex flex-wrap gap-2 p-4 border-t border-white/[0.04]">
                      {activeBadges.map(({ key, label, icon, cls }) => (
                        <span key={key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${cls}`}>
                          {icon}
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}