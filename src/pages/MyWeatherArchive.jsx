import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Archive, ArrowLeft, Search, Image as ImageIcon, Loader2, MapPin, Clock, X,
  Edit2, Upload, Plus, Check, Bold, Italic, Palette, RotateCcw, ChevronDown,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { format, isValid } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

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
───────────────────────────────────────────── */
function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '');
  out = out.replace(/(<[^>]+?)\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '$1');
  out = out.replace(/(<[^>]+?(?:href|src|action)\s*=\s*)["']?\s*javascript:[^"'\s>]*/gi, '$1"#"');
  return out;
}

function RichText({ html, className = '' }) {
  if (!html) return null;
  return (
    <div
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
      className={className}
      style={{ lineHeight: 1.7 }}
    />
  );
}

/* Robust to base44 returning arrays as JSON strings or CSV */
function normalizeList(v) {
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
}

const CONDITIONS = ['All', 'Snow', 'Ice', 'Thunderstorms', 'Rain', 'Wind', 'Heat', 'Daily Risks'];
const CONDITION_COLOR = {
  Snow: '#38bdf8', Ice: '#22d3ee', Thunderstorms: '#a78bfa', Rain: '#60a5fa',
  Wind: '#2dd4bf', Heat: '#f97316', 'Daily Risks': '#fbbf24',
};

/* New 7-level risk colours
   Very Low (dark green) · Low (light green) · Marginal (yellow)
   · Slight (orange/amber) · Moderate (red) · High (purple)
   · Severe (black, outlined) */
const IMPACT_COLOR = {
  'Very Low': { color: '#86efac', bg: 'rgba(21,128,61,0.14)',  border: 'rgba(21,128,61,0.45)' },
  Low:        { color: '#bbf7d0', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)' },
  Marginal:   { color: '#fde047', bg: 'rgba(250,204,21,0.12)', border: 'rgba(250,204,21,0.35)' },
  Slight:     { color: '#fdba74', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)' },
  Moderate:   { color: '#fca5a5', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)' },
  High:       { color: '#d8b4fe', bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.4)' },
  Severe:     { color: '#f8fafc', bg: 'rgba(10,10,12,0.85)',   border: '#000000' },
};

/* ─────────────────────────────────────────────
   EDITOR CONFIG (mirrors ForecastSection)
───────────────────────────────────────────── */
const EDIT_CONDITIONS = ['Snow', 'Ice', 'Thunderstorms', 'Rain', 'Wind', 'Heat', 'Daily Risks'];

const COND_CFG = {
  Snow:          { accent: '#7dd3fc', dim: 'rgba(125,211,252,0.1)', border: 'rgba(125,211,252,0.25)', text: '#bae6fd' },
  Ice:           { accent: '#67e8f9', dim: 'rgba(103,232,249,0.1)', border: 'rgba(103,232,249,0.25)', text: '#a5f3fc' },
  Thunderstorms: { accent: '#c084fc', dim: 'rgba(192,132,252,0.1)', border: 'rgba(192,132,252,0.25)', text: '#e9d5ff' },
  Rain:          { accent: '#60a5fa', dim: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)',  text: '#bfdbfe' },
  Wind:          { accent: '#2dd4bf', dim: 'rgba(45,212,191,0.1)',  border: 'rgba(45,212,191,0.25)',  text: '#99f6e4' },
  Heat:          { accent: '#fb923c', dim: 'rgba(251,146,60,0.1)',  border: 'rgba(251,146,60,0.25)',  text: '#fed7aa' },
  'Daily Risks': { accent: '#fbbf24', dim: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)',  text: '#fde68a' },
};

const RISK_CFG = {
  'Very Low': { bg: 'rgba(21,128,61,0.14)',  border: 'rgba(21,128,61,0.45)',  text: '#86efac', dot: '#15803d' },
  Low:        { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)', text: '#bbf7d0', dot: '#4ade80' },
  Marginal:   { bg: 'rgba(250,204,21,0.12)', border: 'rgba(250,204,21,0.35)', text: '#fde047', dot: '#facc15' },
  Slight:     { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.35)', text: '#fdba74', dot: '#f97316' },
  Moderate:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.4)',   text: '#fca5a5', dot: '#ef4444' },
  High:       { bg: 'rgba(168,85,247,0.14)', border: 'rgba(168,85,247,0.4)',  text: '#d8b4fe', dot: '#a855f7' },
  Severe:     { bg: 'rgba(10,10,12,0.85)',   border: '#000000',               text: '#f8fafc', dot: '#0a0a0c' },
};
const RISK_LEVELS = ['Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];

const CONDITION_SUBTYPES = {
  Snow: ['Light Snow', 'Heavy Snow', 'Snow Showers', 'Sleet', 'Blizzard', 'Drifting Snow', 'Snow & Ice Mix'],
  Ice: ['Ice on Untreated Surfaces', 'Black Ice', 'Freezing Rain', 'Hard Frost', 'Icy Patches', 'Glaze Ice'],
  Thunderstorms: ['Thundery Shower', 'Isolated Thunderstorm', 'Scattered Thunderstorms', 'Severe Thunderstorm', 'Embedded Thunderstorms', 'Frequent Lightning'],
  Rain: ['Light Rain', 'Heavy Rain', 'Persistent Rain', 'Showers', 'Heavy Showers', 'Localised Flooding', 'Thundery Rain'],
  Wind: ['Gusty Winds', 'Gale', 'Severe Gale', 'Storm Force', 'Coastal Gusts', 'Hill Gusts', 'Damaging Gusts'],
  Heat: ['Warm Spell', 'Hot Day', 'Heatwave', 'Extreme Heat', 'Tropical Night', 'Elevated UV'],
  'Daily Risks': ['Fog', 'Dense Fog', 'Mist', 'Hail', 'Lightning Risk', 'Low Visibility', 'Surface Water', 'Travel Disruption'],
};

const CONDITION_RANGES = {
  Snow:          [{ key: 'snow_accumulation_cm', label: 'Accumulation', unit: 'cm', placeholder: 'e.g. 2–5' }],
  Ice:           [{ key: 'ice_temp_c',           label: 'Temp Range',   unit: '°C', placeholder: 'e.g. -3 to 1' }],
  Thunderstorms: [{ key: 'storm_rain_mm_hr',     label: 'Rain Rate',    unit: 'mm/hr', placeholder: 'e.g. 20–40' }],
  Rain:          [{ key: 'rain_total_mm',        label: 'Rain Total',   unit: 'mm', placeholder: 'e.g. 15–30' }],
  Wind:          [{ key: 'wind_gust_mph',        label: 'Gusts',        unit: 'mph', placeholder: 'e.g. 45–60' }],
  Heat:          [{ key: 'temp_range_c',         label: 'Temp Range',   unit: '°C', placeholder: 'e.g. 30–34' }],
  'Daily Risks': [{ key: 'visibility_m',         label: 'Visibility',   unit: 'm',  placeholder: 'e.g. <100' }],
};

const TEXT_COLOURS = [
  '#f8fafc', '#cbd5e1', '#94a3b8', '#64748b', '#0f172a', '#38bdf8', '#22d3ee',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#dc2626', '#f97316', '#f59e0b', '#fbbf24', '#facc15',
  '#84cc16', '#22c55e', '#10b981', '#15803d', '#14b8a6', '#5eead4', '#92400e', '#d6c39a',
];

function normalizeRangesObj(v) {
  let obj = v;
  if (typeof v === 'string') { try { obj = JSON.parse(v); } catch (_) { obj = null; } }
  return (obj && typeof obj === 'object') ? obj : {};
}

/* ─────────────────────────────────────────────
   RICH TEXT EDITOR
───────────────────────────────────────────── */
function RichTextEditor({ value, onChange, placeholder, rows = 4 }) {
  const editorRef = useRef(null);
  const [showColours, setShowColours] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && editorRef.current) {
      editorRef.current.innerHTML = value || '';
      initialized.current = true;
    }
  }, []);

  const normalizeHtml = (html) => html
    .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
    .replace(/<div>(.*?)<\/div>/gi, (_, i) => i + '<br>')
    .replace(/<p><br\s*\/?><\/p>/gi, '<br>')
    .replace(/<p>(.*?)<\/p>/gi, (_, i) => i + '<br>')
    .replace(/(<br\s*\/?>)+$/i, '');

  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    onChange(normalizeHtml(editorRef.current.innerHTML));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px',
        background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
        borderBottom: 'none', borderRadius: '10px 10px 0 0',
      }}>
        <EdBtn onClick={() => exec('bold')}><Bold size={11} /></EdBtn>
        <EdBtn onClick={() => exec('italic')}><Italic size={11} /></EdBtn>
        <div style={{ position: 'relative' }}>
          <EdBtn onClick={() => setShowColours(v => !v)}><Palette size={11} /></EdBtn>
          {showColours && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
              background: '#0d1829', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10, padding: '8px 9px', display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, width: 196,
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            }}>
              {TEXT_COLOURS.map(c => (
                <button key={c} onMouseDown={e => { e.preventDefault(); exec('foreColor', c); setShowColours(false); }}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '2px solid rgba(255,255,255,0.15)', cursor: 'pointer' }} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(normalizeHtml(editorRef.current.innerHTML))}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          onChange(normalizeHtml(editorRef.current.innerHTML));
        }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); } }}
        data-placeholder={placeholder}
        style={{
          background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '0 0 10px 10px', color: '#e2e8f0', fontSize: 13,
          padding: '8px 12px', minHeight: rows * 22, outline: 'none',
          lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}
      />
      <style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:rgba(148,163,184,0.4);pointer-events:none}`}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────
   LOCATION ENTRY WITH RISK (archive edit)
───────────────────────────────────────────── */
const ARCH_RISK_LEVELS = ['None', 'Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];
const ARCH_RISK_COLORS = {
  None: '#64748b', 'Very Low': '#86efac', Low: '#bbf7d0', Marginal: '#fde047',
  Slight: '#fdba74', Moderate: '#fca5a5', High: '#d8b4fe', Severe: '#f8fafc',
};

function ArchiveLocationEntry({ loc, onRemove, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)', padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <MapPin size={10} style={{ color: 'rgba(148,163,184,0.4)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: '#e2e8f0', flex: 1 }}>{loc.name}</span>
        <button type="button" onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', cursor: 'pointer', color: 'rgba(148,163,184,0.6)', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Risk <ChevronDown size={9} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', display: 'inline' }} />
        </button>
        <button type="button" onClick={onRemove}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(148,163,184,0.4)', display: 'flex', lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(148,163,184,0.4)'}
        ><X size={10} /></button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.5)', marginBottom: 4 }}>Overall Risk</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {ARCH_RISK_LEVELS.map(level => (
                <button key={level} type="button"
                  onClick={() => onChange({ ...loc, overall_risk: level === 'None' ? null : level })}
                  style={{
                    padding: '2px 8px', borderRadius: 999, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
                    background: (loc.overall_risk || null) === (level === 'None' ? null : level) && (level === 'None' ? !loc.overall_risk : loc.overall_risk === level) ? `${ARCH_RISK_COLORS[level]}22` : 'transparent',
                    border: `1px solid ${loc.overall_risk === level || (!loc.overall_risk && level === 'None') ? ARCH_RISK_COLORS[level] : 'rgba(255,255,255,0.1)'}`,
                    color: loc.overall_risk === level || (!loc.overall_risk && level === 'None') ? ARCH_RISK_COLORS[level] : 'rgba(148,163,184,0.5)',
                  }}>{level}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#86efac', marginBottom: 4 }}>Lowest Risk</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {ARCH_RISK_LEVELS.filter(l => l !== 'None').map(level => (
                  <button key={level} type="button"
                    onClick={() => onChange({ ...loc, lowest_risk: loc.lowest_risk === level ? null : level })}
                    style={{
                      padding: '2px 7px', borderRadius: 999, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
                      background: loc.lowest_risk === level ? `${ARCH_RISK_COLORS[level]}22` : 'transparent',
                      border: `1px solid ${loc.lowest_risk === level ? ARCH_RISK_COLORS[level] : 'rgba(255,255,255,0.09)'}`,
                      color: loc.lowest_risk === level ? ARCH_RISK_COLORS[level] : 'rgba(148,163,184,0.4)',
                    }}>{level}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fca5a5', marginBottom: 4 }}>Highest Risk</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {ARCH_RISK_LEVELS.filter(l => l !== 'None').map(level => (
                  <button key={level} type="button"
                    onClick={() => onChange({ ...loc, highest_risk: loc.highest_risk === level ? null : level })}
                    style={{
                      padding: '2px 7px', borderRadius: 999, fontSize: 9, fontFamily: 'monospace', cursor: 'pointer',
                      background: loc.highest_risk === level ? `${ARCH_RISK_COLORS[level]}22` : 'transparent',
                      border: `1px solid ${loc.highest_risk === level ? ARCH_RISK_COLORS[level] : 'rgba(255,255,255,0.09)'}`,
                      color: loc.highest_risk === level ? ARCH_RISK_COLORS[level] : 'rgba(148,163,184,0.4)',
                    }}>{level}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EdBtn({ onClick, children }) {
  return (
    <button onMouseDown={e => { e.preventDefault(); onClick(); }}
      style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#94a3b8'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}>
      {children}
    </button>
  );
}

function EdField({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(148,163,184,0.5)' }}>
        {label}
        {hint && <span style={{ marginLeft: 5, color: 'rgba(100,116,139,0.5)', textTransform: 'none', letterSpacing: 0 }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ARCHIVE EDIT MODAL (admin only)
───────────────────────────────────────────── */
function ArchiveEditModal({ graphic, onClose, onSave, uploading, onUpload }) {
  const normalizeLocationsObjs = (raw) => {
    const list = normalizeList(raw);
    return list.map(l => typeof l === 'string' ? { name: l, overall_risk: null, highest_risk: null, lowest_risk: null } : l);
  };

  const [form, setForm] = useState(() => ({
    title:              graphic.title || '',
    image_url:          graphic.image_url || '',
    description:        graphic.description || '',
    weather_conditions: normalizeList(graphic.weather_conditions).length
                          ? normalizeList(graphic.weather_conditions)
                          : (graphic.weather_condition ? [graphic.weather_condition] : []),
    condition_subtypes: normalizeList(graphic.condition_subtypes),
    condition_ranges:   normalizeRangesObj(graphic.condition_ranges),
    expires_at:         graphic.expires_at ? graphic.expires_at.slice(0, 16) : '',
    in_force_from:      graphic.in_force_from ? graphic.in_force_from.slice(0, 16) : '',
    impact_levels:      normalizeList(graphic.impact_levels).length
                          ? normalizeList(graphic.impact_levels)
                          : (graphic.impact_level ? [graphic.impact_level] : []),
    locations_impacted: normalizeLocationsObjs(graphic.locations_impacted),
    update_reason:      '',
    is_archived:        graphic.is_archived ?? true,
    is_initial_forecast: graphic.is_initial_forecast ?? false,
  }));
  const [locationInput, setLocationInput] = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const toggleArr = (k, v) => setForm(p => ({
    ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v],
  }));
  const toggleCondition = (c) => setForm(p => {
    const has = p.weather_conditions.includes(c);
    const next = has ? p.weather_conditions.filter(x => x !== c) : [...p.weather_conditions, c];
    let subs = p.condition_subtypes;
    let ranges = { ...p.condition_ranges };
    if (has) {
      const drop = new Set(CONDITION_SUBTYPES[c] || []);
      subs = p.condition_subtypes.filter(s => !drop.has(s));
      for (const r of (CONDITION_RANGES[c] || [])) delete ranges[r.key];
    }
    return { ...p, weather_conditions: next, condition_subtypes: subs, condition_ranges: ranges };
  });
  const setRange = (k, v) => setForm(p => ({ ...p, condition_ranges: { ...p.condition_ranges, [k]: v } }));
  const addLocation = () => {
    const v = locationInput.trim();
    if (v && !form.locations_impacted.some(l => (typeof l === 'string' ? l : l.name) === v)) {
      set('locations_impacted', [...form.locations_impacted, { name: v, overall_risk: null, highest_risk: null, lowest_risk: null }]);
      setLocationInput('');
    }
  };

  const inputStyle = {
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 10, color: '#e2e8f0', fontSize: 13, padding: '8px 12px',
    width: '100%', fontFamily: 'inherit', outline: 'none',
  };

  const activeWithExtras = form.weather_conditions.filter(
    c => (CONDITION_SUBTYPES[c]?.length || CONDITION_RANGES[c]?.length)
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 740, maxHeight: '92vh', overflowY: 'auto', background: '#08101e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px 20px 0 0', boxShadow: '0 -24px 80px rgba(0,0,0,0.7)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }} />
        </div>
        <div style={{ padding: '16px 24px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                Edit Archived Graphic
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(148,163,184,0.6)', fontFamily: 'monospace' }}>
                Backfill new fields onto past graphics
              </p>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}>
              <X size={14} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* LEFT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <EdField label="Title *">
                <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Title" />
              </EdField>

              <EdField label="Weather Conditions" hint="select all that apply">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {EDIT_CONDITIONS.map(c => {
                    const cfg = COND_CFG[c];
                    const sel = form.weather_conditions.includes(c);
                    return (
                      <button key={c} type="button" onClick={() => toggleCondition(c)}
                        style={{
                          padding: '4px 12px', borderRadius: 999, fontSize: 11, fontFamily: 'monospace',
                          letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
                          background: sel ? cfg.dim : 'transparent',
                          border: `1px solid ${sel ? cfg.border : 'rgba(255,255,255,0.1)'}`,
                          color: sel ? cfg.text : 'rgba(148,163,184,0.5)',
                        }}>
                        {c}
                      </button>
                    );
                  })}
                </div>
              </EdField>

              {activeWithExtras.map(c => {
                const cfg = COND_CFG[c];
                const subs = CONDITION_SUBTYPES[c] || [];
                const ranges = CONDITION_RANGES[c] || [];
                return (
                  <div key={c} style={{ borderRadius: 12, padding: '12px 13px', background: cfg.dim, border: `1px solid ${cfg.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: cfg.text }}>
                      {c} — options
                    </span>
                    {subs.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {subs.map(s => {
                          const sel = form.condition_subtypes.includes(s);
                          return (
                            <button key={s} type="button" onClick={() => toggleArr('condition_subtypes', s)}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '3px 10px', borderRadius: 999, fontSize: 10,
                                fontFamily: 'monospace', cursor: 'pointer',
                                background: sel ? cfg.dim : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${sel ? cfg.border : 'rgba(255,255,255,0.08)'}`,
                                color: sel ? cfg.text : 'rgba(148,163,184,0.55)',
                              }}>
                              {sel && <Check size={9} />}{s}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {ranges.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: ranges.length > 1 ? '1fr 1fr' : '1fr', gap: 8 }}>
                        {ranges.map(r => (
                          <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(148,163,184,0.5)' }}>
                              {r.label} <span style={{ color: cfg.accent }}>({r.unit})</span>
                            </label>
                            <input style={{ ...inputStyle, fontSize: 12, padding: '6px 10px' }} placeholder={r.placeholder}
                              value={form.condition_ranges[r.key] || ''} onChange={e => setRange(r.key, e.target.value)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <EdField label="Description">
                <RichTextEditor value={form.description} onChange={v => set('description', v)} placeholder="Description…" />
              </EdField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <EdField label="In Force From">
                  <input type="datetime-local" style={{ ...inputStyle, fontSize: 11 }} value={form.in_force_from} onChange={e => set('in_force_from', e.target.value)} />
                </EdField>
                <EdField label="Expires At">
                  <input type="datetime-local" style={{ ...inputStyle, fontSize: 11 }} value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
                </EdField>
              </div>

              <EdField label="Risk Level" hint="select all that apply">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {RISK_LEVELS.map(level => {
                    const cfg = RISK_CFG[level];
                    const sel = form.impact_levels.includes(level);
                    const isSevere = level === 'Severe';
                    return (
                      <button key={level} type="button" onClick={() => toggleArr('impact_levels', level)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '5px 13px', borderRadius: 999, fontSize: 11,
                          fontFamily: 'monospace', textTransform: 'uppercase', cursor: 'pointer',
                          background: sel ? cfg.bg : 'transparent',
                          border: `1px solid ${sel ? cfg.border : (isSevere ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.1)')}`,
                          color: sel ? cfg.text : 'rgba(148,163,184,0.5)',
                          boxShadow: sel && isSevere ? '0 0 0 1px #000' : 'none',
                        }}>
                        {sel && <Check size={10} />}
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, border: isSevere ? '1px solid rgba(255,255,255,0.4)' : 'none' }} />
                        {level}
                      </button>
                    );
                  })}
                </div>
              </EdField>

              <EdField label="Reason for Update">
                <input style={inputStyle} placeholder="What changed? (optional)" value={form.update_reason} onChange={e => set('update_reason', e.target.value)} />
              </EdField>
            </div>

            {/* RIGHT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {form.image_url ? (
                <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'rgba(0,0,0,0.3)' }}>
                  <img src={form.image_url} alt="Preview" style={{ width: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' }} />
                  <button onClick={() => set('image_url', '')} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 8, background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94a3b8' }}>
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 180, borderRadius: 14, cursor: 'pointer', border: '1.5px dashed rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', gap: 8 }}>
                  {uploading ? <Loader2 size={24} style={{ color: '#60a5fa' }} className="animate-spin" /> : <Upload size={22} style={{ color: 'rgba(148,163,184,0.4)' }} />}
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(148,163,184,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Upload graphic</span>
                  <input type="file" style={{ display: 'none' }} accept="image/*" onChange={async e => { const url = await onUpload(e); if (url) set('image_url', url); }} />
                </label>
              )}

              <EdField label="Locations Impacted">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...inputStyle, flex: 1 }} placeholder="Add a location…" value={locationInput}
                    onChange={e => setLocationInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLocation(); } }} />
                  <button type="button" onClick={addLocation} style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94a3b8' }}>
                    <Plus size={14} />
                  </button>
                </div>
                {form.locations_impacted.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {form.locations_impacted.map((rawLoc) => {
                      const loc = typeof rawLoc === 'string' ? { name: rawLoc, overall_risk: null, highest_risk: null, lowest_risk: null } : rawLoc;
                      return (
                        <ArchiveLocationEntry
                          key={loc.name}
                          loc={loc}
                          onRemove={() => set('locations_impacted', form.locations_impacted.filter(l => (typeof l === 'string' ? l : l.name) !== loc.name))}
                          onChange={(updated) => set('locations_impacted', form.locations_impacted.map(l => (typeof l === 'string' ? l : l.name) === loc.name ? updated : l))}
                        />
                      );
                    })}
                  </div>
                )}
              </EdField>

              <EdField label="Archive Status">
                <button type="button" onClick={() => set('is_archived', !form.is_archived)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px',
                    borderRadius: 10, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    background: form.is_archived ? 'rgba(251,191,36,0.1)' : 'rgba(34,197,94,0.1)',
                    border: `1px solid ${form.is_archived ? 'rgba(251,191,36,0.3)' : 'rgba(34,197,94,0.3)'}`,
                    color: form.is_archived ? '#fbbf24' : '#86efac',
                  }}>
                  {form.is_archived ? <Archive size={12} /> : <RotateCcw size={12} />}
                  {form.is_archived ? 'Archived' : 'Restore to active'}
                </button>
              </EdField>

              <EdField label="Forecast Type">
                <button type="button" onClick={() => set('is_initial_forecast', !form.is_initial_forecast)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px',
                    borderRadius: 10, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    background: form.is_initial_forecast ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${form.is_initial_forecast ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    color: form.is_initial_forecast ? '#38bdf8' : 'rgba(148,163,184,0.5)',
                  }}>
                  {form.is_initial_forecast ? '🚩' : '○'} Initial Forecast
                </button>
              </EdField>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => onSave(form)} style={{ flex: 1, padding: '10px 0', borderRadius: 12, background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.35)', color: '#93c5fd', fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Save Changes
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function MyWeatherArchive() {
  const [search, setSearch] = useState('');
  const [activeCondition, setActiveCondition] = useState('All');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  // Admin / owner detection via base44 auth
  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      try { return await base44.auth.me(); } catch (_) { return null; }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const isOwner = !!currentUser && (
    currentUser.role === 'admin' ||
    currentUser.is_owner === true ||
    currentUser.isOwner === true
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.WeatherGraphic.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graphics-archive'] });
      queryClient.invalidateQueries({ queryKey: ['forecasts'] });
    },
  });

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      return file_url;
    } finally {
      setUploading(false);
    }
  };

  const handleSaveEdit = (form) => {
    if (!editing) return;
    updateMutation.mutate({
      id: editing.id,
      data: {
        title:              form.title || 'Forecast',
        image_url:          form.image_url,
        description:        form.description,
        weather_condition:  form.weather_conditions[0] ?? undefined,
        weather_conditions: form.weather_conditions.length ? form.weather_conditions : undefined,
        condition_subtypes: form.condition_subtypes.length ? form.condition_subtypes : null,
        condition_ranges:   Object.keys(form.condition_ranges || {}).length ? form.condition_ranges : null,
        expires_at:         form.expires_at || null,
        in_force_from:      form.in_force_from || null,
        impact_level:       form.impact_levels.length === 1 ? form.impact_levels[0] : form.impact_levels.at(-1) ?? undefined,
        impact_levels:      form.impact_levels.length ? form.impact_levels : undefined,
        locations_impacted: form.locations_impacted.length ? form.locations_impacted : undefined,
        update_reason:      form.update_reason || null,
        is_archived:        form.is_archived,
        is_initial_forecast: form.is_initial_forecast ?? false,
      },
    }, {
      onSuccess: () => {
        setEditing(null);
        setSelected(null);
      },
    });
  };

  const { data: allGraphics = [], isLoading } = useQuery({
    queryKey: ['graphics-archive'],
    queryFn: () => base44.entities.WeatherGraphic.list('-created_date'),
    initialData: [],
  });

  const archived = useMemo(() => {
    const now = Date.now();
    return allGraphics.filter(g =>
      g.is_archived ||
      (g.expires_at && new Date(g.expires_at).getTime() < now)
    );
  }, [allGraphics]);

  const filtered = useMemo(() => {
    return archived.filter(g => {
      if (activeCondition !== 'All' && g.weather_condition !== activeCondition) return false;
      if (search && !(`${g.title} ${g.description || ''}`.toLowerCase().includes(search.toLowerCase()))) return false;
      return true;
    });
  }, [archived, activeCondition, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const g of filtered) {
      const date = g.expires_at || g.created_date;
      const k = format(new Date(date), 'MMMM yyyy');
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(g);
    }
    return [...map.entries()];
  }, [filtered]);

  const counts = useMemo(() => {
    const c = { All: archived.length };
    for (const cond of CONDITIONS.slice(1)) {
      c[cond] = archived.filter(g => g.weather_condition === cond).length;
    }
    return c;
  }, [archived]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 text-slate-200">
      {/* Header */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-slate-900/80 border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3 flex-wrap">
          <Link to="/" className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-slate-300 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </Link>
          <div className="flex items-center gap-2.5 ml-1">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
              <Archive className="w-4.5 h-4.5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">MyWeather Archive</h1>
              <p className="text-[11px] text-slate-500">{archived.length} archived graphic{archived.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex-1 min-w-[200px] max-w-md ml-auto relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search archive…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-white/5 border-white/10 text-slate-200 placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Condition filter chips */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-3 flex gap-1.5 flex-wrap">
          {CONDITIONS.map(c => {
            const active = activeCondition === c;
            const color = c === 'All' ? '#94a3b8' : CONDITION_COLOR[c];
            return (
              <button
                key={c}
                onClick={() => setActiveCondition(c)}
                className="px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all"
                style={{
                  background: active ? `${color}22` : 'rgba(255,255,255,0.03)',
                  borderColor: active ? `${color}66` : 'rgba(255,255,255,0.08)',
                  color: active ? color : '#94a3b8',
                }}
              >
                {c}
                <span className="ml-1.5 opacity-60">{counts[c] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-sky-500" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-600">
            <ImageIcon className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No archived graphics match your filters.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {grouped.map(([month, items]) => (
              <section key={month}>
                <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-slate-500 mb-3">{month}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((g, i) => {
                    const color = CONDITION_COLOR[g.weather_condition] || '#64748b';
                    const impact = IMPACT_COLOR[g.impact_level];
                    return (
                      <div key={g.id} className="relative group/card">
                      {isOwner && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditing(g); }}
                          title="Edit graphic"
                          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-lg bg-black/60 hover:bg-violet-500/40 border border-white/15 backdrop-blur text-slate-300 hover:text-violet-200 flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-all"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <motion.button
                        onClick={() => setSelected(g)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="group relative w-full rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.07] hover:border-white/[0.15] transition-all text-left"
                      >
                        {g.image_url ? (
                          <div className="aspect-video overflow-hidden bg-black/30">
                            <img src={g.image_url} alt={g.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                          </div>
                        ) : (
                          <div className="aspect-video flex items-center justify-center" style={{ background: `${color}10`, borderBottom: `1px solid ${color}22` }}>
                            <Archive className="w-8 h-8" style={{ color }} />
                          </div>
                        )}
                        <div className="p-3.5">
                          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                            {g.is_initial_forecast && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-sky-500/15 border border-sky-500/30 text-sky-300">
                                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16"><path d="M4 1s.5 3-1 4.5C1.5 7 1 8 1 8s2-.5 3 0 3 3 3 3 .5-2.5 2-3.5 3-.5 3-.5-1.5-1-2-3-1-4-1-4-1.5 2-3 2.5S4 1 4 1z"/></svg>
                                Initial Forecast
                              </span>
                            )}
                            {g.weather_condition && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border" style={{ color, borderColor: `${color}55`, background: `${color}12` }}>
                                {g.weather_condition}
                              </span>
                            )}
                            {g.impact_level && impact && (
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                                style={{
                                  color: impact.color,
                                  borderColor: impact.border,
                                  background: impact.bg,
                                  boxShadow: g.impact_level === 'Severe' ? '0 0 0 1px #000' : 'none',
                                }}
                              >
                                {g.impact_level}
                              </span>
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">{g.title}</h3>
                          {(() => {
                            const subs = normalizeList(g.condition_subtypes);
                            return subs.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {subs.slice(0, 3).map(s => (
                                  <span key={s} className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-white/[0.04] border border-white/[0.08] text-slate-400">
                                    {s}
                                  </span>
                                ))}
                                {subs.length > 3 && (
                                  <span className="text-[9px] text-slate-600">+{subs.length - 3}</span>
                                )}
                              </div>
                            ) : null;
                          })()}
                          {/* Location risk preview */}
                          {(() => {
                            const locs = normalizeList(g.locations_impacted).map(l => typeof l === 'string' ? { name: l } : l);
                            const locsWithRisk = locs.filter(l => l.highest_risk || l.overall_risk);
                            if (!locsWithRisk.length) return null;
                            return (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {locsWithRisk.slice(0, 2).map(loc => {
                                  const display = loc.highest_risk || loc.overall_risk;
                                  const rcfg = RISK_CFG[display];
                                  return rcfg ? (
                                    <span key={loc.name} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border"
                                      style={{ color: rcfg.text, borderColor: rcfg.border, background: rcfg.bg }}>
                                      {loc.name}: {display}
                                    </span>
                                  ) : null;
                                })}
                              </div>
                            );
                          })()}
                          {g.expires_at && (
                            <p className="mt-1.5 text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" /> Expired {formatBST(g.expires_at)}
                            </p>
                          )}
                        </div>
                      </motion.button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 32, opacity: 0 }}
              className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden bg-slate-900 border border-white/[0.07] shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {selected.is_initial_forecast && (
                      <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 border border-sky-500/30 text-sky-300">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16"><path d="M4 1s.5 3-1 4.5C1.5 7 1 8 1 8s2-.5 3 0 3 3 3 3 .5-2.5 2-3.5 3-.5 3-.5-1.5-1-2-3-1-4-1-4-1.5 2-3 2.5S4 1 4 1z"/></svg>
                        Initial Forecast
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-white">{selected.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && (
                    <button
                      onClick={() => setEditing(selected)}
                      className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-bold transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selected.image_url && (
                  <img src={selected.image_url} alt={selected.title} className="w-full rounded-2xl border border-white/[0.06]" />
                )}
                {selected.description && (
                  <div className="text-sm text-slate-300 leading-relaxed">
                    <RichText html={selected.description} />
                  </div>
                )}

                {/* Sub-types */}
                {(() => {
                  const subs = normalizeList(selected.condition_subtypes);
                  return subs.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Forecast Detail</p>
                      <div className="flex flex-wrap gap-1.5">
                        {subs.map(s => (
                          <span key={s} className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-semibold text-slate-300">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Measurements */}
                {(() => {
                  let r = selected.condition_ranges;
                  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) { r = null; } }
                  const entries = r && typeof r === 'object'
                    ? Object.entries(r).filter(([, v]) => v != null && v !== '')
                    : [];
                  const META = {
                    snow_accumulation_cm: ['Snow Accumulation', 'cm'],
                    ice_temp_c: ['Ice Temp Range', '°C'],
                    storm_rain_mm_hr: ['Storm Rain Rate', 'mm/hr'],
                    rain_total_mm: ['Rain Total', 'mm'],
                    wind_gust_mph: ['Wind Gusts', 'mph'],
                    temp_range_c: ['Temperature Range', '°C'],
                    visibility_m: ['Visibility', 'm'],
                  };
                  return entries.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Measurements</p>
                      <div className="grid grid-cols-2 gap-2">
                        {entries.map(([k, v]) => {
                          const [label, unit] = META[k] || [k, ''];
                          return (
                            <div key={k} className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-3 py-2.5">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">{label}</p>
                              <p className="text-white font-bold text-sm font-mono">{v}{unit ? ` ${unit}` : ''}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Times */}
                <div className="space-y-1.5">
                  {selected.in_force_from && (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span className="text-slate-600 uppercase tracking-wider text-[9px] font-bold">In force from</span>
                      <span className="text-slate-400 font-mono">{formatBST(selected.in_force_from)}</span>
                    </p>
                  )}
                  {selected.expires_at && (
                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span className="text-slate-600 uppercase tracking-wider text-[9px] font-bold">Expired</span>
                      <span className="text-slate-400 font-mono">{formatBST(selected.expires_at)}</span>
                    </p>
                  )}
                </div>

                {selected.locations_impacted?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Locations Impacted</p>
                    <div className="space-y-1.5">
                      {normalizeList(selected.locations_impacted).map((rawLoc, i) => {
                        const loc = typeof rawLoc === 'string' ? { name: rawLoc } : rawLoc;
                        const hasRiskInfo = loc.overall_risk || loc.highest_risk || loc.lowest_risk;
                        return (
                          <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                            <MapPin className="w-3 h-3 text-slate-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-slate-300 font-medium">{loc.name}</span>
                              {hasRiskInfo && (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {loc.overall_risk && (() => {
                                    const rcfg = RISK_CFG[loc.overall_risk];
                                    return rcfg ? (
                                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                                        style={{ color: rcfg.text, borderColor: rcfg.border, background: rcfg.bg }}>
                                        Overall: {loc.overall_risk}
                                      </span>
                                    ) : null;
                                  })()}
                                  {loc.lowest_risk && !loc.overall_risk && (() => {
                                    const rcfg = RISK_CFG[loc.lowest_risk];
                                    return rcfg ? (
                                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                                        style={{ color: rcfg.text, borderColor: rcfg.border, background: rcfg.bg }}>
                                        ↓ Low: {loc.lowest_risk}
                                      </span>
                                    ) : null;
                                  })()}
                                  {loc.highest_risk && !loc.overall_risk && (() => {
                                    const rcfg = RISK_CFG[loc.highest_risk];
                                    return rcfg ? (
                                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                                        style={{ color: rcfg.text, borderColor: rcfg.border, background: rcfg.bg }}>
                                        ↑ High: {loc.highest_risk}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin edit modal */}
      <AnimatePresence>
        {isOwner && editing && (
          <ArchiveEditModal
            graphic={editing}
            onClose={() => setEditing(null)}
            onSave={handleSaveEdit}
            uploading={uploading}
            onUpload={handleUpload}
          />
        )}
      </AnimatePresence>
    </div>
  );
}