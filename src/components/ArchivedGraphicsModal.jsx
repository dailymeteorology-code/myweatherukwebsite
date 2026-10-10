import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Clock, ChevronRight, Archive, Plus, Upload,
  Loader2, MapPin, Check, Wind, Droplets, Zap,
  AlertTriangle, Trash2, ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isValid } from 'date-fns';
import { toast } from 'sonner';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONDITIONS = ['Snow', 'Ice', 'Thunderstorms', 'Rain', 'Wind', 'Heat', 'Daily Risks'];
const IMPACTS    = ['Low', 'SLGT', 'Moderate', 'High'];

const CONDITION_CONFIG = {
  Snow:          { accent: '#38bdf8', dot: 'bg-sky-400',    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',     bar: 'from-sky-900/50 to-transparent' },
  Ice:           { accent: '#22d3ee', dot: 'bg-cyan-400',   badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',   bar: 'from-cyan-900/50 to-transparent' },
  Thunderstorms: { accent: '#a78bfa', dot: 'bg-violet-400', badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30', bar: 'from-violet-900/50 to-transparent' },
  Rain:          { accent: '#60a5fa', dot: 'bg-blue-400',   badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',  bar: 'from-blue-900/50 to-transparent' },
  Wind:          { accent: '#2dd4bf', dot: 'bg-teal-400',   badge: 'bg-teal-500/15 text-teal-300 border-teal-500/30',  bar: 'from-teal-900/50 to-transparent' },
  Heat:          { accent: '#f97316', dot: 'bg-orange-400', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30', bar: 'from-orange-900/50 to-transparent' },
  'Daily Risks': { accent: '#fbbf24', dot: 'bg-amber-400',  badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', bar: 'from-amber-900/50 to-transparent' },
};
const DEFAULT_COND = { accent: '#64748b', dot: 'bg-slate-400', badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30', bar: 'from-slate-800/50 to-transparent' };

const IMPACT_CONFIG = {
  Low:      { cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', dot: '#34d399' },
  SLGT:     { cls: 'bg-amber-400/10 text-amber-300 border-amber-400/30',       dot: '#fbbf24' },
  Moderate: { cls: 'bg-orange-500/10 text-orange-300 border-orange-500/30',    dot: '#fb923c' },
  High:     { cls: 'bg-red-500/10 text-red-300 border-red-500/30',             dot: '#f87171' },
};

const STORM_RISKS = [
  { key: 'tornado_risk',      label: 'Tornadoes',   fill: '#ef4444', track: 'bg-red-950',    bar: 'bg-gradient-to-r from-red-700 to-red-400',      text: 'text-red-400',    badge: 'bg-red-500/10 border-red-500/30 text-red-400' },
  { key: 'hail_risk',         label: 'Hail',        fill: '#38bdf8', track: 'bg-sky-950',    bar: 'bg-gradient-to-r from-sky-700 to-sky-400',       text: 'text-sky-400',   badge: 'bg-sky-500/10 border-sky-500/30 text-sky-400' },
  { key: 'flash_flood_risk',  label: 'Flash Flood', fill: '#3b82f6', track: 'bg-blue-950',   bar: 'bg-gradient-to-r from-blue-700 to-blue-400',     text: 'text-blue-400',  badge: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  { key: 'strong_winds_risk', label: 'Winds',       fill: '#14b8a6', track: 'bg-teal-950',   bar: 'bg-gradient-to-r from-teal-700 to-teal-400',     text: 'text-teal-400',  badge: 'bg-teal-500/10 border-teal-500/30 text-teal-400' },
  { key: 'supercell_risk',    label: 'Supercells',  fill: '#a78bfa', track: 'bg-violet-950', bar: 'bg-gradient-to-r from-violet-700 to-violet-400', text: 'text-violet-400', badge: 'bg-violet-500/10 border-violet-500/30 text-violet-400' },
];

const STORM_BADGES = [
  { key: 'high_lightning', label: 'High Lightning', icon: Zap,           cls: 'bg-yellow-400/10 border-yellow-400/30 text-yellow-300' },
  { key: 'severe',         label: 'Severe',          icon: AlertTriangle, cls: 'bg-orange-500/10 border-orange-500/30 text-orange-300' },
  { key: 'heavy_rain',     label: 'Heavy Rain',      icon: Droplets,      cls: 'bg-blue-500/10 border-blue-500/30 text-blue-300' },
];

const emptyForm = {
  title: '', description: '', image_url: '', weather_condition: '',
  impact_level: '', in_force_from: '', expires_at: '',
  locations_impacted: [], is_archived: true, published: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isValid(d) ? format(d, 'dd MMM yyyy, HH:mm') : null;
}

function condCfg(wc) {
  return wc ? (CONDITION_CONFIG[wc] || DEFAULT_COND) : DEFAULT_COND;
}

// ─── Micro-components ─────────────────────────────────────────────────────────

function FieldLabel({ children }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">
      {children}
    </p>
  );
}

function AnimatedBar({ value, barClass, delay = 0 }) {
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const t = setTimeout(() => setW(value), delay + 80);
    return () => clearTimeout(t);
  }, [value, delay]);
  return (
    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ease-out ${barClass}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function ImpactBadge({ level }) {
  const cfg = IMPACT_CONFIG[level];
  if (!cfg) return null;
  return (
    <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${cfg.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {level}
    </span>
  );
}

function ConditionBadge({ condition }) {
  const cfg = condCfg(condition);
  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${cfg.badge}`}>
      {condition}
    </span>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function DetailPanel({ graphic, onClose }) {
  const cfg = condCfg(graphic.weather_condition);
  const td  = graphic.thunderstorm_data || {};
  const activeRisks  = STORM_RISKS.filter(r => td[r.key] != null);
  const activeBadges = STORM_BADGES.filter(b => td[b.key]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-xl flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 48, opacity: 0, scale: 0.97 }}
        animate={{ y: 0,  opacity: 1, scale: 1 }}
        exit={{ y: 32, opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col rounded-t-[28px] sm:rounded-[28px] overflow-hidden bg-[#0c1118] border border-white/[0.07] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Accent bar */}
        <div className="h-0.5 w-full" style={{ background: cfg.accent }} />

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/[0.06]">
          <button
            onClick={onClose}
            className="mt-0.5 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {graphic.weather_condition && <ConditionBadge condition={graphic.weather_condition} />}
              {graphic.impact_level && <ImpactBadge level={graphic.impact_level} />}
            </div>
            <h3 className="text-base font-bold text-white leading-snug">{graphic.title}</h3>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5" style={{ scrollbarWidth: 'none' }}>

          {graphic.image_url && (
            <div className="rounded-2xl overflow-hidden border border-white/[0.06] bg-black/30">
              <img src={graphic.image_url} alt={graphic.title} className="w-full max-h-60 object-contain" />
            </div>
          )}

          {graphic.description && (
            <p className="text-slate-300 text-sm leading-relaxed" style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {graphic.description}
            </p>
          )}

          {/* Timestamps */}
          {(formatDt(graphic.in_force_from) || formatDt(graphic.expires_at)) && (
            <div className="grid grid-cols-2 gap-3">
              {formatDt(graphic.in_force_from) && (
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">In Force From</p>
                  <p className="text-slate-200 text-xs font-medium">{formatDt(graphic.in_force_from)}</p>
                </div>
              )}
              {formatDt(graphic.expires_at) && (
                <div className="rounded-xl bg-red-500/[0.05] border border-red-500/20 px-3.5 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-500/70 mb-1">Expired</p>
                  <p className="text-red-400 text-xs font-medium">{formatDt(graphic.expires_at)}</p>
                </div>
              )}
            </div>
          )}

          {/* Locations */}
          {graphic.locations_impacted?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2.5 flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> Locations Impacted
              </p>
              <div className="flex flex-wrap gap-1.5">
                {graphic.locations_impacted.map(loc => (
                  <span key={loc} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs text-slate-300">
                    <MapPin className="w-2.5 h-2.5 text-slate-500" />
                    {loc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Thunderstorm data */}
          {Object.keys(td).length > 0 && (
            <div className="rounded-2xl bg-violet-500/[0.04] border border-violet-500/20 overflow-hidden">
              <div className="px-4 pt-4 pb-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-400 flex items-center gap-1.5 mb-4">
                  <Zap className="w-3 h-3" /> Thunderstorm Risk
                </p>
                {activeRisks.length > 0 && (
                  <div className="space-y-3.5 mb-4">
                    {activeRisks.map(({ key, label, bar, text, badge }, i) => (
                      <div key={key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-semibold ${text}`}>{label}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge}`}>
                            {td[key]}%
                          </span>
                        </div>
                        <AnimatedBar value={td[key]} barClass={bar} delay={i * 60} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Stat tiles */}
              {(td.wind_speed_mph != null || td.rain_mm_per_hour != null || td.hail_diameter_mm != null || td.tornado_intensity) && (
                <div className="grid grid-cols-2 gap-px bg-violet-500/10 border-t border-violet-500/20">
                  {[
                    td.wind_speed_mph    != null && { icon: Wind,     color: 'text-teal-400',   label: 'Wind Speed', value: `${td.wind_speed_mph} mph` },
                    td.rain_mm_per_hour  != null && { icon: Droplets, color: 'text-blue-400',   label: 'Rainfall',   value: `${td.rain_mm_per_hour} mm/hr` },
                    td.hail_diameter_mm  != null && { icon: null,     color: 'text-sky-400',    label: 'Hail Size',  value: `${td.hail_diameter_mm} mm` },
                    td.tornado_intensity         && { icon: null,     color: 'text-red-400',    label: 'Tornado',    value: td.tornado_intensity },
                  ].filter(Boolean).map(({ icon: Icon, color, label, value }) => (
                    <div key={label} className="bg-[#0c1118] px-4 py-3">
                      <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${color}`}>{label}</p>
                      <p className="text-white font-bold text-sm font-mono">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {activeBadges.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-violet-500/20">
                  {activeBadges.map(({ key, label, icon: Icon, cls }) => (
                    <span key={key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold ${cls}`}>
                      <Icon className="w-3 h-3" /> {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Add Past Graphic Form ────────────────────────────────────────────────────

function AddPastGraphicForm({ onSaved, onCancel }) {
  const queryClient = useQueryClient();
  const [form, setForm]       = useState({ ...emptyForm });
  const [uploading, setUploading] = useState(false);
  const [locInput, setLocInput]   = useState('');

  const saveMutation = useMutation({
    mutationFn: data => base44.entities.WeatherGraphic.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forecasts'] });
      toast.success('Past graphic added to archive!');
      onSaved();
    },
  });

  const handleUpload = async e => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(p => ({ ...p, image_url: file_url }));
    setUploading(false);
  };

  const addLocation = () => {
    if (!locInput.trim()) return;
    setForm(p => ({ ...p, locations_impacted: [...(p.locations_impacted || []), locInput.trim()] }));
    setLocInput('');
  };

  const styledInput = 'h-9 bg-[#0c1118] border-white/[0.08] text-slate-200 placeholder:text-slate-600 text-sm focus:border-sky-500/40 focus:ring-0 rounded-xl';
  const styledSelect = 'w-full h-9 rounded-xl border border-white/[0.08] bg-[#0c1118] text-slate-200 text-sm px-3 focus:outline-none focus:border-sky-500/40';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-2xl bg-white/[0.02] border border-white/[0.07] p-4 space-y-4"
    >
      <p className="text-xs font-bold text-slate-300 uppercase tracking-[0.12em]">Add Past Graphic</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Title */}
        <div className="sm:col-span-2">
          <FieldLabel>Title *</FieldLabel>
          <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            placeholder="e.g. Snow event — Jan 2026" className={styledInput} />
        </div>

        {/* Condition */}
        <div>
          <FieldLabel>Weather Condition</FieldLabel>
          <select value={form.weather_condition} onChange={e => setForm(p => ({ ...p, weather_condition: e.target.value }))} className={styledSelect}>
            <option value="">Select…</option>
            {CONDITIONS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {/* Impact */}
        <div>
          <FieldLabel>Impact Level</FieldLabel>
          <select value={form.impact_level} onChange={e => setForm(p => ({ ...p, impact_level: e.target.value }))} className={styledSelect}>
            <option value="">Select…</option>
            {IMPACTS.map(i => <option key={i}>{i}</option>)}
          </select>
        </div>

        {/* Dates */}
        <div>
          <FieldLabel>In Force From</FieldLabel>
          <Input type="datetime-local" value={form.in_force_from}
            onChange={e => setForm(p => ({ ...p, in_force_from: e.target.value }))} className={styledInput} />
        </div>
        <div>
          <FieldLabel>Expired At</FieldLabel>
          <Input type="datetime-local" value={form.expires_at}
            onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))} className={styledInput} />
        </div>

        {/* Locations */}
        <div className="sm:col-span-2">
          <FieldLabel>Locations</FieldLabel>
          <div className="flex gap-2">
            <Input value={locInput} onChange={e => setLocInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLocation())}
              placeholder="e.g. Yorkshire" className={`${styledInput} flex-1`} />
            <button type="button" onClick={addLocation}
              className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {(form.locations_impacted || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {form.locations_impacted.map((l, i) => (
                <span key={i} className="flex items-center gap-1 text-xs bg-white/[0.05] border border-white/[0.08] text-slate-300 px-2.5 py-1 rounded-full">
                  {l}
                  <button onClick={() => setForm(p => ({ ...p, locations_impacted: p.locations_impacted.filter((_, j) => j !== i) }))}
                    className="text-slate-500 hover:text-red-400 transition-colors ml-0.5">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        <div className="sm:col-span-2">
          <FieldLabel>Description</FieldLabel>
          <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            rows={2} placeholder="e.g. Heavy snow fell across northern England…"
            className="bg-[#0c1118] border-white/[0.08] text-slate-200 placeholder:text-slate-600 text-sm focus:border-sky-500/40 focus:ring-0 rounded-xl resize-none" />
        </div>

        {/* Image upload */}
        <div className="sm:col-span-2">
          <FieldLabel>Graphic Image</FieldLabel>
          {form.image_url ? (
            <div className="relative inline-block">
              <img src={form.image_url} alt="" className="h-24 object-contain rounded-xl border border-white/[0.08]" />
              <button onClick={() => setForm(p => ({ ...p, image_url: '' }))}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center h-20 border border-dashed border-white/[0.1] rounded-xl cursor-pointer hover:border-white/20 hover:bg-white/[0.02] transition-all">
              {uploading
                ? <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
                : <>
                    <Upload className="w-4 h-4 text-slate-600 mb-1" />
                    <span className="text-xs text-slate-600">Upload image</span>
                  </>
              }
              <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
            </label>
          )}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white text-sm transition-all">
          Cancel
        </button>
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending || !form.title}
          className="flex-1 h-9 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all">
          {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save to Archive
        </button>
      </div>
    </motion.div>
  );
}

// ─── Archive card ─────────────────────────────────────────────────────────────

function GraphicCard({ graphic, onOpen, onDelete, isOwner }) {
  const cfg = condCfg(graphic.weather_condition);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="group relative rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-200 overflow-hidden"
    >
      {/* Left accent line */}
      <div className="absolute inset-y-0 left-0 w-0.5" style={{ background: cfg.accent }} />

      <div className="flex items-start gap-3 p-4 pl-5">
        {/* Thumbnail */}
        {graphic.image_url ? (
          <img src={graphic.image_url} alt={graphic.title}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover bg-black/20 flex-shrink-0 border border-white/[0.06]" />
        ) : (
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex-shrink-0 flex items-center justify-center"
            style={{ background: `${cfg.accent}14`, border: `1px solid ${cfg.accent}30` }}>
            <Archive className="w-5 h-5" style={{ color: cfg.accent }} />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-white text-sm leading-snug truncate mb-1.5">{graphic.title}</h4>

          <div className="flex items-center gap-1.5 flex-wrap">
            {graphic.weather_condition && <ConditionBadge condition={graphic.weather_condition} />}
            {graphic.impact_level && <ImpactBadge level={graphic.impact_level} />}
          </div>

          {graphic.description && (
            <p className="text-slate-500 text-xs mt-1.5 line-clamp-1">{graphic.description}</p>
          )}

          {/* Timestamps */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2">
            {formatDt(graphic.in_force_from) && (
              <span className="flex items-center gap-1 text-[10px] text-slate-600">
                <Clock className="w-2.5 h-2.5" />
                {formatDt(graphic.in_force_from)}
              </span>
            )}
            {formatDt(graphic.expires_at) && (
              <span className="flex items-center gap-1 text-[10px] text-red-500/60">
                <Clock className="w-2.5 h-2.5" />
                exp. {formatDt(graphic.expires_at)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button onClick={() => onOpen(graphic)}
            className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 transition-all whitespace-nowrap">
            Details <ChevronRight className="w-2.5 h-2.5" />
          </button>
          {isOwner && (
            confirmDelete ? (
              <div className="flex gap-1">
                <button onClick={() => setConfirmDelete(false)}
                  className="text-[10px] text-slate-400 px-2 py-1 rounded-full border border-white/[0.08] hover:bg-white/[0.04]">
                  Cancel
                </button>
                <button onClick={() => { onDelete(graphic.id); setConfirmDelete(false); }}
                  className="text-[10px] text-red-400 px-2 py-1 rounded-full border border-red-500/30 bg-red-500/10 hover:bg-red-500/20">
                  Confirm
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="p-1.5 rounded-full text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all">
                <Trash2 className="w-3 h-3" />
              </button>
            )
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function ArchivedGraphicsModal({ graphics, onClose, onDelete, isOwner }) {
  const [selectedGraphic, setSelectedGraphic] = useState(null);
  const [showAddForm, setShowAddForm]         = useState(false);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[110] bg-black/75 backdrop-blur-xl flex items-end sm:items-center justify-center sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 56, opacity: 0 }}
          animate={{ y: 0,  opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[80vh] flex flex-col rounded-t-[28px] sm:rounded-[28px] overflow-hidden bg-[#0e1520] border border-white/[0.06] shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-white/10" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center shrink-0">
                <Archive className="w-4 h-4 text-slate-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-white">Archived Graphics</h2>
                <p className="text-[10px] text-slate-500">
                  {graphics.length} expired graphic{graphics.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isOwner && !showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 transition-all">
                  <Plus className="w-3 h-3" />
                  <span className="hidden xs:inline">Add Past</span>
                </button>
              )}
              <button onClick={onClose}
                className="w-8 h-8 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white transition-all flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Add form */}
          <AnimatePresence>
            {showAddForm && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden border-b border-white/[0.06] shrink-0"
              >
                <div className="p-4 overflow-y-auto max-h-[50vh]">
                  <AddPastGraphicForm
                    onSaved={() => setShowAddForm(false)}
                    onCancel={() => setShowAddForm(false)}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* List */}
          <div className="overflow-y-auto flex-1 p-4 space-y-2" style={{ scrollbarWidth: 'none' }}>
            {graphics.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                <Archive className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">No archived graphics yet</p>
              </div>
            ) : (
              <AnimatePresence>
                {graphics.map((g, i) => (
                  <motion.div key={g.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                    <GraphicCard
                      graphic={g}
                      onOpen={setSelectedGraphic}
                      onDelete={onDelete}
                      isOwner={isOwner}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </motion.div>
      </motion.div>

      {selectedGraphic && (
        <DetailPanel graphic={selectedGraphic} onClose={() => setSelectedGraphic(null)} />
      )}
    </AnimatePresence>
  );
}