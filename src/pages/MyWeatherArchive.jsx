import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Archive, Search, Image as ImageIcon, Loader2, MapPin, X,
  Edit2, Upload, Plus, Check, Bold, Italic, Palette, RotateCcw, ChevronDown,
  ChevronLeft, ChevronRight, Maximize2, ArrowUpDown,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { ThunderstormRisks, GRAPHIC_LEVEL_NAMES, GraphicLevelPill, GraphicLevelChoice, graphicLevel, normLevel } from '@/components/graphics/GraphicMeta';
import GraphicViewer from '@/components/graphics/GraphicViewer';
import { sized, sizedSet } from '@/lib/sizedImage';
import { cleanHtml, plainText, TEXT_COLOURS, richTextCss } from '@/lib/cleanHtml';
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

/* a description, cleaned of whatever page it was pasted from (lib/cleanHtml) */
function RichText({ html, className = '' }) {
  if (!html) return null;
  return (
    <div
      dangerouslySetInnerHTML={{ __html: cleanHtml(html) }}
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

const CONDITION_COLOR = {
  Snow: '#38bdf8', Ice: '#22d3ee', Thunderstorms: '#a78bfa', Rain: '#60a5fa',
  Wind: '#2dd4bf', Heat: '#f97316', 'Daily Risks': '#fbbf24',
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

/* the risk ladder is the Thunderstorm graphic's own (components/graphics/GraphicMeta): its colours
   and its short labels, TSTM to SVRE, so what is picked and shown here is what the graphic drew */
const RISK_LEVELS = GRAPHIC_LEVEL_NAMES;
/* a graphic's levels, with older graphics' short labels ("SLGT") read as the level they are */
const levelsList = (v) => [...new Set(normalizeList(v).map((l) => normLevel(l) || l))];

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
              {TEXT_COLOURS.map(({ value: c, label }) => (
                <button key={c} title={label} onMouseDown={e => { e.preventDefault(); exec('foreColor', c); setShowColours(false); }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {[['overall_risk', 'Overall risk', 'rgba(148,163,184,0.6)'], ['lowest_risk', 'Lowest risk', '#86efac'], ['highest_risk', 'Highest risk', '#fca5a5']].map(([key, label, tone]) => (
            <div key={key}>
              <div style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: tone, marginBottom: 4 }}>{label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {RISK_LEVELS.map((level) => (
                  <GraphicLevelChoice key={level} level={level} small selected={normLevel(loc[key]) === level}
                    onClick={() => onChange({ ...loc, [key]: normLevel(loc[key]) === level ? null : level })} />
                ))}
              </div>
            </div>
          ))}
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
                          ? levelsList(graphic.impact_levels)
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
                  {RISK_LEVELS.map((level) => (
                    <GraphicLevelChoice key={level} level={level} range selected={form.impact_levels.includes(level)} onClick={() => toggleArr('impact_levels', level)} />
                  ))}
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

/* ─────────────────────────────────────────────
   THE ARCHIVE PAGE — liquid glass
   Every MyWeatherUK graphic that has ended, month by month, shown whole (they are portrait
   graphics; the old 16:9 crop cut their titles off). A frosted toolbar filters by search,
   condition, year and risk level; a glass panel opens a graphic beside everything about it,
   with ← → through the list; the shared viewer shows it full screen. The glass tokens match the
   home page's, in a light and a dark set that follow the site's theme.
───────────────────────────────────────────── */
const GA_CSS = `
.ga-page { --glass-fill: rgba(255,255,255,0.055); --glass-fill-strong: rgba(255,255,255,0.09); --glass-hairline: rgba(255,255,255,0.11);
  --glass-highlight: rgba(255,255,255,0.15); --glass-shadow: 0 1px 2px rgba(0,0,0,.3), 0 16px 40px -12px rgba(0,0,0,.6);
  --ink-1: #f2f6fc; --ink-2: #9fb0c6; --ink-3: rgba(159,176,198,.62); --page-bg: #070c16; --accent: #56b6f5;
  --amb-a: rgba(14,165,233,.28); --amb-b: rgba(129,140,248,.22); --amb-c: rgba(45,212,191,.14);
  position: relative; min-height: 100vh; background: var(--page-bg); color: var(--ink-1);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI Variable Display', 'Segoe UI', Inter, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
.ga-page.ga-light { --glass-fill: rgba(255,255,255,0.66); --glass-fill-strong: rgba(255,255,255,0.86); --glass-hairline: rgba(15,23,42,0.08);
  --glass-highlight: rgba(255,255,255,0.92); --glass-shadow: 0 1px 2px rgba(15,23,42,.05), 0 18px 40px -14px rgba(15,23,42,.2);
  --ink-1: #0b1220; --ink-2: #4a5b70; --ink-3: rgba(74,91,112,.68); --page-bg: #eef3fb; --accent: #1d74c4;
  --amb-a: rgba(14,165,233,.22); --amb-b: rgba(129,140,248,.18); --amb-c: rgba(45,212,191,.12); }
.ga-ambient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.ga-ambient i { position: absolute; display: block; border-radius: 50%; }
.ga-ambient i:nth-child(1) { width: 70vw; height: 70vw; top: -24vw; left: -20vw; background: radial-gradient(circle, var(--amb-a), transparent 62%); }
.ga-ambient i:nth-child(2) { width: 62vw; height: 62vw; top: 14vh; right: -22vw; background: radial-gradient(circle, var(--amb-b), transparent 62%); }
.ga-ambient i:nth-child(3) { width: 60vw; height: 60vw; bottom: -22vw; left: 12vw; background: radial-gradient(circle, var(--amb-c), transparent 62%); }
.ga-wrap { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: 0 16px 64px; }
.ga-glass { position: relative; border-radius: 24px; background: var(--glass-fill); border: 1px solid var(--glass-hairline);
  -webkit-backdrop-filter: blur(22px) saturate(180%); backdrop-filter: blur(22px) saturate(180%); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight); }
.ga-hero { padding: clamp(22px, 5vw, 48px) 0 clamp(16px, 3vw, 26px); }
.ga-back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 18px; padding: 6px 12px 6px 8px; border-radius: 99px; font-size: .84rem; font-weight: 600; color: var(--ink-2); text-decoration: none; background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.ga-back:hover { color: var(--ink-1); background: var(--glass-fill-strong); }
.ga-eyebrow { margin: 0 0 6px; font-size: .7rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-3); }
.ga-title { margin: 0; font-size: clamp(2rem, 6vw, 3.4rem); font-weight: 700; letter-spacing: -.035em; line-height: 1.05; }
.ga-sub { margin: 10px 0 0; max-width: 60ch; font-size: clamp(.95rem, 1.6vw, 1.05rem); line-height: 1.55; color: var(--ink-2); }
.ga-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 22px; }
.ga-stat { padding: 14px 16px; min-width: 0; }
.ga-stat span { display: block; font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
.ga-stat b { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; margin-top: 4px; overflow-wrap: break-word; font-size: clamp(.98rem, 1.9vw, 1.35rem); font-weight: 650; letter-spacing: -.02em; }
.ga-stat small { font-size: .82rem; font-weight: 500; color: var(--ink-2); }
.ga-toolbar { position: sticky; top: 64px; z-index: 30; display: flex; flex-direction: column; gap: 10px; padding: 12px; margin-bottom: 8px; border-radius: 22px; }
@media (max-width: 767px) { .ga-toolbar { top: 56px; } }
.ga-row { display: flex; gap: 8px; align-items: center; min-width: 0; }
.ga-search { position: relative; flex: 1; min-width: 0; }
.ga-search svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--ink-3); pointer-events: none; }
.ga-search input { width: 100%; height: 42px; padding: 0 36px 0 38px; border-radius: 14px; font: inherit; font-size: 16px; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); outline: none; }
.ga-search input::placeholder { color: var(--ink-3); }
.ga-search input:focus { border-color: var(--accent); }
.ga-search button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 99px; cursor: pointer; color: var(--ink-2); background: var(--glass-fill); }
.ga-select { height: 42px; padding: 0 30px 0 12px; border-radius: 14px; font: inherit; font-size: .88rem; font-weight: 600; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); cursor: pointer; appearance: none; -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%); background-position: calc(100% - 15px) 52%, calc(100% - 10px) 52%; background-size: 5px 5px; background-repeat: no-repeat; }
.ga-select option { color: #0b1220; }
.ga-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, #000 92%, transparent); mask-image: linear-gradient(90deg, #000 92%, transparent); padding-right: 24px; }
.ga-chips::-webkit-scrollbar { display: none; }
.ga-chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 99px; cursor: pointer; font: inherit; font-size: .82rem; font-weight: 600; white-space: nowrap; color: var(--ink-2); background: var(--glass-fill); border: 1px solid var(--glass-hairline); }
.ga-chip:hover { color: var(--ink-1); }
.ga-chip[aria-pressed='true'] { color: var(--page-bg); background: var(--ink-1); border-color: transparent; }
.ga-chip i { width: 8px; height: 8px; border-radius: 99px; flex-shrink: 0; }
.ga-chip em { font-style: normal; font-size: .72rem; opacity: .65; }
.ga-month { position: relative; display: flex; align-items: baseline; gap: 10px; margin: 30px 2px 14px; }
.ga-month h2 { margin: 0; font-size: clamp(1.15rem, 2.4vw, 1.45rem); font-weight: 650; letter-spacing: -.02em; }
.ga-month span { font-size: .82rem; color: var(--ink-3); }
.ga-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 16px; }
.ga-card { overflow: hidden; transition: transform .26s cubic-bezier(.22,.61,.36,1), box-shadow .26s ease; }
@media (hover: hover) { .ga-card:hover { transform: translateY(-3px); box-shadow: var(--glass-shadow), 0 26px 52px -18px rgba(0,0,0,.45), inset 0 1px 0 var(--glass-highlight); } }
.ga-card-hit { display: block; width: 100%; padding: 8px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.ga-thumb { display: block; aspect-ratio: 4 / 5; overflow: hidden; border-radius: 18px; background: rgba(0,0,0,.2); }
.ga-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform .5s ease; }
@media (hover: hover) { .ga-card:hover .ga-thumb img { transform: scale(1.03); } }
.ga-thumb-none { display: grid; place-items: center; height: 100%; color: var(--ink-3); }
.ga-card-body { display: flex; flex-direction: column; gap: 7px; padding: 12px 6px 6px; }
.ga-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.ga-tag { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; font-size: .72rem; font-weight: 650; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); white-space: nowrap; }
.ga-tag i { width: 7px; height: 7px; border-radius: 99px; }
.ga-level { padding: 3px 9px !important; font-size: .72rem !important; }
.ga-card-title { font-size: .98rem; font-weight: 650; line-height: 1.3; letter-spacing: -.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ga-card-meta { font-size: .78rem; color: var(--ink-3); }
.ga-edit { position: absolute; top: 16px; right: 16px; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; cursor: pointer; color: #fff; background: rgba(10,16,28,.5); border: 1px solid rgba(255,255,255,.22); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); opacity: 0; transition: opacity .15s; }
.ga-card:hover .ga-edit, .ga-edit:focus-visible { opacity: 1; }
@media (hover: none) { .ga-edit { opacity: 1; } }
.ga-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 20px; margin-top: 18px; text-align: center; color: var(--ink-2); }
.ga-empty b { color: var(--ink-1); font-size: 1.05rem; }
.ga-modal { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(2,6,14,.55); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); animation: ga-fade .2s ease both; }
@keyframes ga-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ga-rise { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
/* A wide screen: picture and text side by side, the panel at most the window's height, and the
   text column scrolling inside it. The row has to be told it may shrink (minmax(0, 1fr)); without
   it the row grew to the text's full height, the panel clipped it, and anything below the fold
   (the description's end, the places, the buttons) could not be scrolled to. */
.ga-detail { width: min(1080px, 100%); max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px); display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); overflow: hidden; animation: ga-rise .28s cubic-bezier(.22,1,.36,1) both;
  --glass-fill: var(--glass-fill-strong); }
.ga-page:not(.ga-light) .ga-detail { background: rgba(16,24,38,.82); }
.ga-page.ga-light .ga-detail { background: rgba(255,255,255,.9); }
.ga-detail-media { display: flex; align-items: center; justify-content: center; padding: 16px; min-height: 0; overflow: hidden; }
.ga-detail-media button { display: block; padding: 0; border: 0; background: none; cursor: zoom-in; max-height: 100%; }
.ga-detail-media img { display: block; max-width: 100%; max-height: calc(100vh - 80px); object-fit: contain; border-radius: 18px; box-shadow: 0 18px 40px -16px rgba(0,0,0,.55); }
.ga-detail-body { display: flex; flex-direction: column; gap: 14px; min-width: 0; min-height: 0; padding: 20px 22px 22px 6px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.ga-detail-body > * { flex-shrink: 0; }
.ga-detail-top { display: flex; align-items: center; gap: 8px; }
.ga-detail-top .ga-tags { flex: 1; }
.ga-icon { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: 12px; cursor: pointer; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.ga-icon:disabled { opacity: .35; cursor: default; }
.ga-detail h2 { margin: 0; font-size: clamp(1.3rem, 2.6vw, 1.75rem); font-weight: 700; letter-spacing: -.025em; line-height: 1.15; text-wrap: balance; }
.ga-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.ga-tile { padding: 10px 12px; border-radius: 14px; background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.ga-tile span { display: block; font-size: .64rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.ga-tile b { display: block; margin-top: 2px; font-size: .92rem; font-weight: 650; }
.ga-label { margin: 0 0 -6px; font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
.ga-desc { font-size: .95rem; line-height: 1.68; color: var(--ink-2); }
.ga-locs { display: grid; gap: 6px; }
.ga-loc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-radius: 14px; font-size: .9rem; background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.ga-loc svg { color: var(--ink-3); flex-shrink: 0; }
.ga-loc b { font-weight: 600; margin-right: auto; }
.ga-note { padding: 10px 12px; border-radius: 14px; font-size: .88rem; line-height: 1.5; background: rgba(56,189,248,.12); border: 1px solid var(--glass-hairline); }
.ga-note b { display: block; margin-bottom: 2px; font-size: .64rem; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
.ga-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ga-btn { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 14px; border-radius: 12px; cursor: pointer; font: inherit; font-size: .84rem; font-weight: 600; color: var(--ink-1); background: var(--glass-fill-strong); border: 1px solid var(--glass-hairline); }
.ga-btn.is-primary { color: var(--page-bg); background: var(--ink-1); border-color: transparent; }
@media (max-width: 860px) {
  .ga-modal { padding: 0; align-items: flex-end; }
  .ga-detail { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; max-height: 94vh; max-height: 94dvh; border-radius: 24px 24px 0 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .ga-detail-media { padding: 12px 12px 0; }
  .ga-detail-media img { max-height: 58vh; }
  .ga-detail-body { padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px)); overflow: visible; }
}
/* phones: two graphics a row, like a photo library, so a month fits on a screen */
@media (max-width: 560px) {
  .ga-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .ga-card-hit { padding: 6px; }
  .ga-thumb { border-radius: 14px; }
  .ga-card-body { gap: 5px; padding: 9px 4px 4px; }
  .ga-card .ga-tag { padding: 2px 7px; font-size: .64rem; }
  .ga-card .ga-level { padding: 2px 7px !important; font-size: .64rem !important; }
  .ga-card-title { font-size: .84rem; }
  .ga-card-meta { font-size: .7rem; }
  .ga-edit { top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 10px; }
  .ga-stat { padding: 12px 14px; }
}
@media (prefers-reduced-motion: reduce) { .ga-modal, .ga-detail { animation: none; } .ga-card, .ga-thumb img { transition: none; } }
${richTextCss('.ga-desc', '.ga-page.ga-light', '.ga-page:not(.ga-light)')}
`;

const MEASURE = {
  snow_accumulation_cm: ['Snow accumulation', 'cm'], ice_temp_c: ['Ice temperature', '°C'], storm_rain_mm_hr: ['Storm rain rate', 'mm/h'],
  rain_total_mm: ['Rain total', 'mm'], wind_gust_mph: ['Wind gusts', 'mph'], temp_range_c: ['Temperature range', '°C'], visibility_m: ['Visibility', 'm'],
};
const condsOf = (g) => { const l = normalizeList(g.weather_conditions); return l.length ? l : g.weather_condition ? [g.weather_condition] : []; };
const levelsOf = (g) => { const l = levelsList(g.impact_levels); return l.length ? l : g.impact_level ? [normLevel(g.impact_level) || g.impact_level] : []; };
const levelRank = (l) => GRAPHIC_LEVEL_NAMES.indexOf(l);
const topLevel = (g) => levelsOf(g).reduce((a, b) => (levelRank(b) > levelRank(a) ? b : a), null);
const issuedOf = (g) => g.created_date || g.expires_at;
/* a risk level as the Thunderstorm graphic prints it (SLGT, ENH…), in its colour */
function Level({ level }) {
  return <GraphicLevelPill level={level} className="ga-level" />;
}
function Tag({ dot, children }) {
  return <span className="ga-tag">{dot && <i style={{ background: dot }} />}{children}</span>;
}

function ArchiveCard({ g, index, onOpen, isOwner, onEdit }) {
  const top = topLevel(g);
  return (
    <motion.article className="ga-glass ga-card" initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: Math.min(index * 0.04, 0.24), duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      <button type="button" className="ga-card-hit" onClick={onOpen}>
        <span className="ga-thumb">
          {g.image_url
            ? <img src={sized(g.image_url, 800)} srcSet={sizedSet(g.image_url, [480, 800, 1200])} sizes="(min-width: 1100px) 280px, (min-width: 600px) 45vw, 92vw" alt={g.title || 'Forecast graphic'} loading="lazy" decoding="async" />
            : <span className="ga-thumb-none"><ImageIcon size={30} /></span>}
        </span>
        <span className="ga-card-body">
          <span className="ga-tags">
            {condsOf(g).slice(0, 2).map((c) => <Tag key={c} dot={CONDITION_COLOR[c]}>{c}</Tag>)}
            {top && <Level level={top} />}
            {g.is_initial_forecast && <Tag dot="#38bdf8">Initial</Tag>}
          </span>
          <span className="ga-card-title">{g.title || 'Forecast'}</span>
          <span className="ga-card-meta">Issued {formatBST(issuedOf(g), 'd MMM yyyy, HH:mm')}</span>
        </span>
      </button>
      {isOwner && <button type="button" className="ga-edit" onClick={() => onEdit(g)} aria-label="Edit graphic" title="Edit graphic"><Edit2 size={14} /></button>}
    </motion.article>
  );
}

function ArchiveDetail({ g, onClose, onPrev, onNext, onView, isOwner, onEdit, onRestore, restoring }) {
  useEffect(() => {
    const key = (e) => {
      if (document.querySelector('.gv')) return;                       // the full-screen viewer has the keys
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; };
  }, [onClose, onPrev, onNext]);

  let ranges = g.condition_ranges;
  if (typeof ranges === 'string') { try { ranges = JSON.parse(ranges); } catch { ranges = null; } }
  const measures = ranges && typeof ranges === 'object' ? Object.entries(ranges).filter(([, v]) => v != null && v !== '') : [];
  const subs = normalizeList(g.condition_subtypes);
  const locs = normalizeList(g.locations_impacted).map((l) => (typeof l === 'string' ? { name: l } : l));
  return (
    <div className="ga-modal" onClick={onClose} role="dialog" aria-modal="true" aria-label={g.title || 'Forecast graphic'}>
      <div className="ga-glass ga-detail" onClick={(e) => e.stopPropagation()}>
        <div className="ga-detail-media">
          {g.image_url
            ? <button type="button" onClick={() => onView(g)} aria-label="View full size"><img src={sized(g.image_url, 1200)} alt={g.title || 'Forecast graphic'} /></button>
            : <ImageIcon size={40} />}
        </div>
        <div className="ga-detail-body">
          <div className="ga-detail-top">
            <span className="ga-tags">
              {condsOf(g).map((c) => <Tag key={c} dot={CONDITION_COLOR[c]}>{c}</Tag>)}
              {levelsOf(g).map((l) => <Level key={l} level={l} />)}
              {g.is_initial_forecast && <Tag dot="#38bdf8">Initial forecast</Tag>}
              {g.forecast_update_label && !g.is_initial_forecast && <Tag dot="#f59e0b">{g.forecast_update_label}</Tag>}
            </span>
            <button type="button" className="ga-icon" disabled={!onPrev} onClick={onPrev} aria-label="Previous graphic"><ChevronLeft size={17} /></button>
            <button type="button" className="ga-icon" disabled={!onNext} onClick={onNext} aria-label="Next graphic"><ChevronRight size={17} /></button>
            <button type="button" className="ga-icon" onClick={onClose} aria-label="Close"><X size={17} /></button>
          </div>

          <h2>{g.title || 'Forecast'}</h2>

          <div className="ga-tiles">
            {g.in_force_from && <div className="ga-tile"><span>In force</span><b>{formatBST(g.in_force_from, 'd MMM, HH:mm')}</b></div>}
            <div className="ga-tile"><span>Issued</span><b>{formatBST(issuedOf(g), 'd MMM yyyy, HH:mm')}</b></div>
            {g.expires_at && <div className="ga-tile"><span>Ended</span><b>{formatBST(g.expires_at, 'd MMM yyyy, HH:mm')}</b></div>}
          </div>

          {measures.length > 0 && (
            <>
              <p className="ga-label">Measurements</p>
              <div className="ga-tiles">
                {measures.map(([k, v]) => {
                  const [label, unit] = MEASURE[k] || [k.replace(/_/g, ' '), ''];
                  return <div key={k} className="ga-tile"><span>{label}</span><b>{v}{unit ? ` ${unit}` : ''}</b></div>;
                })}
              </div>
            </>
          )}

          <ThunderstormRisks data={g.thunderstorm_data} />

          {subs.length > 0 && <div className="ga-tags">{subs.map((s) => <Tag key={s}>{s}</Tag>)}</div>}

          {g.description && <div className="ga-desc"><RichText html={g.description} /></div>}

          {locs.length > 0 && (
            <>
              <p className="ga-label">Places affected</p>
              <div className="ga-locs">
                {locs.map((l, i) => (
                  <div key={`${l.name}${i}`} className="ga-loc">
                    <MapPin size={14} /><b>{l.name}</b>
                    {l.overall_risk && <Level level={l.overall_risk} />}
                    {!l.overall_risk && l.lowest_risk && <Level level={l.lowest_risk} />}
                    {!l.overall_risk && l.highest_risk && l.highest_risk !== l.lowest_risk && <Level level={l.highest_risk} />}
                  </div>
                ))}
              </div>
            </>
          )}

          {g.update_reason && <div className="ga-note"><b>What changed</b>{g.update_reason}</div>}

          <div className="ga-actions">
            {g.image_url && <button type="button" className="ga-btn is-primary" onClick={() => onView(g)}><Maximize2 size={14} />View full size</button>}
            {isOwner && <button type="button" className="ga-btn" onClick={() => onEdit(g)}><Edit2 size={14} />Edit</button>}
            {/* archived by hand before it ended: it can go straight back on the home page */}
            {isOwner && g.is_archived && (!g.expires_at || new Date(g.expires_at).getTime() > Date.now()) && (
              <button type="button" className="ga-btn" onClick={() => onRestore(g)} disabled={restoring}>
                {restoring ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}Put back on the home page
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MyWeatherArchive() {
  const [search, setSearch] = useState('');
  const [cond, setCond] = useState('All');
  const [year, setYear] = useState('All');
  const [risk, setRisk] = useState('Any');
  const [order, setOrder] = useState('newest');
  const [openId, setOpenId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();
  const { isDark } = useTheme();

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
        setOpenId(null);
      },
    });
  };

  const { data: allGraphics = [], isLoading } = useQuery({
    queryKey: ['graphics-archive'],
    queryFn: () => base44.entities.WeatherGraphic.list('-created_date'),
  });   // no initialData: an empty list would read as "nothing has ended yet" while it loads

  /* ended graphics: archived by hand, or past their expiry */
  const archived = useMemo(() => {
    const now = Date.now();
    return allGraphics.filter((g) => g.is_archived || (g.expires_at && new Date(g.expires_at).getTime() < now));
  }, [allGraphics]);

  const years = useMemo(() => [...new Set(archived.map((g) => new Date(issuedOf(g)).getFullYear()).filter(Boolean))].sort((a, b) => b - a), [archived]);
  const condCounts = useMemo(() => {
    const c = {};
    for (const g of archived) for (const x of condsOf(g)) c[x] = (c[x] || 0) + 1;
    return c;
  }, [archived]);
  const levelsPresent = useMemo(() => GRAPHIC_LEVEL_NAMES.filter((l) => archived.some((g) => levelsOf(g).includes(l))), [archived]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = archived.filter((g) => {
      if (cond !== 'All' && !condsOf(g).includes(cond)) return false;
      if (year !== 'All' && new Date(issuedOf(g)).getFullYear() !== Number(year)) return false;
      if (risk !== 'Any' && !levelsOf(g).includes(risk)) return false;
      if (q) {
        const text = `${g.title || ''} ${plainText(g.description)} ${normalizeList(g.locations_impacted).map((l) => (typeof l === 'string' ? l : l.name)).join(' ')}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
    return list.sort((a, b) => (order === 'newest' ? -1 : 1) * (new Date(issuedOf(a)) - new Date(issuedOf(b))));
  }, [archived, cond, year, risk, search, order]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const g of filtered) {
      const k = formatBST(issuedOf(g), 'MMMM yyyy') || 'Undated';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(g);
    }
    return [...map.entries()];
  }, [filtered]);

  /* the summary tiles */
  const topCond = Object.entries(condCounts).sort((a, b) => b[1] - a[1])[0];
  const highest = archived.reduce((m, g) => { const t = topLevel(g); return t && levelRank(t) > levelRank(m) ? t : m; }, null);
  const firstIssued = archived.reduce((m, g) => { const t = new Date(issuedOf(g)).getTime(); return t && (!m || t < m) ? t : m; }, null);
  const filtersOn = cond !== 'All' || year !== 'All' || risk !== 'Any' || search.trim();

  const openIdx = filtered.findIndex((g) => g.id === openId);
  const open = openIdx >= 0 ? filtered[openIdx] : null;
  const viewIdx = viewing ? filtered.findIndex((g) => g.id === viewing.id) : -1;

  return (
    <div className={`ga-page${isDark ? '' : ' ga-light'}`}>
      <style>{GA_CSS}</style>
      <div className="ga-ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="ga-wrap">
        <header className="ga-hero">
          <Link to="/" className="ga-back"><ChevronLeft size={16} />Home</Link>
          <p className="ga-eyebrow">MyWeatherUK Graphics</p>
          <h1 className="ga-title">Archive</h1>
          <p className="ga-sub">Every forecast graphic we have issued, kept once it has ended, so you can look back at what was forecast and when.</p>
          {!isLoading && <div className="ga-stats">
            <div className="ga-glass ga-stat"><span>Graphics</span><b>{archived.length}</b></div>
            {topCond && <div className="ga-glass ga-stat"><span>Most often</span><b><i style={{ width: 9, height: 9, borderRadius: 9, background: CONDITION_COLOR[topCond[0]] }} />{topCond[0]} <small>×{topCond[1]}</small></b></div>}
            {highest && <div className="ga-glass ga-stat"><span>Highest risk issued</span><b><Level level={highest} /></b></div>}
            {firstIssued && <div className="ga-glass ga-stat"><span>Since</span><b>{formatBST(new Date(firstIssued).toISOString(), 'MMMM yyyy')}</b></div>}
          </div>}
        </header>

        <div className="ga-glass ga-toolbar">
          <div className="ga-row">
            <label className="ga-search">
              <Search />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles, forecasts and places" aria-label="Search the archive" />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></button>}
            </label>
            <button type="button" className="ga-chip" onClick={() => setOrder((o) => (o === 'newest' ? 'oldest' : 'newest'))} aria-label="Change the order" title="Change the order">
              <ArrowUpDown size={14} />{order === 'newest' ? 'Newest' : 'Oldest'}
            </button>
          </div>
          <div className="ga-row">
            <div className="ga-chips" role="group" aria-label="Condition" style={{ flex: 1 }}>
              <button type="button" className="ga-chip" aria-pressed={cond === 'All'} onClick={() => setCond('All')}>All <em>{archived.length}</em></button>
              {EDIT_CONDITIONS.filter((c) => condCounts[c]).map((c) => (
                <button key={c} type="button" className="ga-chip" aria-pressed={cond === c} onClick={() => setCond(c)}>
                  <i style={{ background: CONDITION_COLOR[c] }} />{c} <em>{condCounts[c]}</em>
                </button>
              ))}
            </div>
            {years.length > 1 && (
              <select className="ga-select" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
                <option value="All">All years</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            {levelsPresent.length > 1 && (
              <select className="ga-select" value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Risk level">
                <option value="Any">Any risk</option>
                {levelsPresent.map((l) => { const g = graphicLevel(l); return <option key={l} value={l}>{g ? `${g.short}${g.range ? ` · ${g.range}` : ''}` : l}</option>; })}
              </select>
            )}
          </div>
        </div>

        {isLoading && !archived.length ? (
          <div className="ga-glass ga-empty"><Loader2 className="animate-spin" size={26} /><span>Loading the archive…</span></div>
        ) : !filtered.length ? (
          <div className="ga-glass ga-empty">
            <Archive size={28} />
            <b>{archived.length ? 'Nothing matches those filters' : 'No graphics have ended yet'}</b>
            <span>{archived.length ? 'Try another search, or clear the filters.' : 'Graphics move here once they expire or are archived.'}</span>
            {filtersOn && <button type="button" className="ga-btn" onClick={() => { setSearch(''); setCond('All'); setYear('All'); setRisk('Any'); }}><RotateCcw size={14} />Clear filters</button>}
          </div>
        ) : (
          grouped.map(([month, items]) => (
            <section key={month}>
              <div className="ga-month"><h2>{month}</h2><span>{items.length} graphic{items.length === 1 ? '' : 's'}</span></div>
              <div className="ga-grid">
                {items.map((g, i) => (
                  <ArchiveCard key={g.id} g={g} index={i} isOwner={isOwner} onEdit={setEditing} onOpen={() => setOpenId(g.id)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {open && !viewing && (
        <ArchiveDetail
          g={open}
          isOwner={isOwner}
          onEdit={setEditing}
          onRestore={(x) => updateMutation.mutate({ id: x.id, data: { is_archived: false } }, { onSuccess: () => setOpenId(null) })}
          restoring={updateMutation.isPending}
          onClose={() => setOpenId(null)}
          onPrev={openIdx > 0 ? () => setOpenId(filtered[openIdx - 1].id) : null}
          onNext={openIdx < filtered.length - 1 ? () => setOpenId(filtered[openIdx + 1].id) : null}
          onView={setViewing}
        />
      )}
      {viewing && (
        <GraphicViewer
          graphic={viewing}
          onClose={() => setViewing(null)}
          onPrev={viewIdx > 0 ? () => setViewing(filtered[viewIdx - 1]) : null}
          onNext={viewIdx >= 0 && viewIdx < filtered.length - 1 ? () => setViewing(filtered[viewIdx + 1]) : null}
        />
      )}

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
