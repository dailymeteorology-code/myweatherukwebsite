import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Plus, Trash2, Pencil, X, Save,
  ShieldAlert, Clock, CheckCircle2, History, AlertTriangle, MapPin, EyeOff, Download, CloudDownload,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, isValid } from 'date-fns';
import MobileSelect from '@/components/MobileSelect';
import ImpactDrawingMap from '@/components/ImpactDrawingMap';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:        '#05090f',
  surface:   '#0c1422',
  surface2:  '#101c2e',
  surface3:  '#142030',
  border:    'rgba(148,163,184,0.07)',
  border2:   'rgba(148,163,184,0.12)',
  border3:   'rgba(148,163,184,0.18)',
  text:      '#f1f5f9',
  textMid:   '#94a3b8',
  textDim:   'rgba(148,163,184,0.5)',
  textFaint: 'rgba(148,163,184,0.3)',
  sky:       '#38bdf8',
  skyLow:    'rgba(56,189,248,0.06)',
  skyBorder: 'rgba(56,189,248,0.2)',
  violet:    '#a78bfa',
  green:     '#4ade80',
  greenLow:  'rgba(74,222,128,0.08)',
  amber:     '#fbbf24',
  amberLow:  'rgba(251,191,36,0.08)',
  red:       '#f87171',
  redLow:    'rgba(248,113,113,0.08)',
  orange:    '#fb923c',
};
const FONT = "'Geist', 'DM Sans', system-ui, sans-serif";

const inputBase = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 14px',
  background: C.surface3,
  border: `1px solid ${C.border2}`,
  borderRadius: 10, color: C.text, fontSize: 13,
  fontFamily: FONT, outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s', lineHeight: 1.5,
};

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPES = ['Rain', 'Snow', 'Ice', 'Wind', 'Thunderstorms', 'Fog', 'Extreme Heat', 'Wild Fire', 'Other'];
const SEVERITIES = ['Yellow', 'Amber', 'Red'];
const STATUSES = ['active', 'upcoming', 'past'];

const SEV = {
  Yellow: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24', border: 'rgba(251,191,36,0.3)', dot: '#fbbf24' },
  Amber:  { bg: 'rgba(251,146,60,0.15)', text: '#fb923c', border: 'rgba(251,146,60,0.3)', dot: '#fb923c' },
  Red:    { bg: 'rgba(248,113,113,0.15)', text: '#f87171', border: 'rgba(248,113,113,0.3)', dot: '#f87171' },
};

const STAT = {
  active:   { bg: 'rgba(74,222,128,0.08)',  text: '#4ade80', border: 'rgba(74,222,128,0.2)',  icon: CheckCircle2 },
  upcoming: { bg: 'rgba(56,189,248,0.08)',  text: '#38bdf8', border: 'rgba(56,189,248,0.2)',  icon: Clock },
  past:     { bg: 'rgba(148,163,184,0.08)', text: '#94a3b8', border: 'rgba(148,163,184,0.2)', icon: History },
};

const EMPTY = {
  title: '', type: 'Rain', severity: 'Yellow', status: 'active',
  description: '', areas: [], valid_from: '', valid_to: '', is_published: true,
};

// Map a scraped Met Office warning object into the editor shape so the admin
// can adjust its details and draw the area before publishing it as a warning.
function metToEditing(w) {
  const rawType = (w.type || '').trim();
  const typeMatch = TYPES.find(t => t.toLowerCase() === rawType.toLowerCase())
    || TYPES.find(t => t.toLowerCase().startsWith(rawType.toLowerCase()))
    || (/thunder/i.test(rawType) ? 'Thunderstorms' : 'Other');
  const sevMatch = SEVERITIES.find(s => s.toLowerCase() === (w.severity || '').toLowerCase()) || 'Yellow';
  const regions = Array.isArray(w.regions) ? w.regions : (w.region ? [w.region] : []);
  const now = new Date();
  const to = w.validTo ? new Date(w.validTo) : null;
  const from = w.validFrom ? new Date(w.validFrom) : null;
  const status = (to && to < now) ? 'past' : (from && from > now) ? 'upcoming' : 'active';
  const toLocal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isValid(d) ? format(d, "yyyy-MM-dd'T'HH:mm") : '';
  };
  const desc = [w.description, w.impacts && `Impacts: ${w.impacts}`].filter(Boolean).join('\n\n');
  return {
    ...EMPTY,
    title: `${typeMatch} Warning${regions.length ? ` — ${regions.slice(0, 2).join(', ')}` : ''}`,
    type: typeMatch,
    severity: sevMatch,
    status,
    description: desc,
    // Keep both: areas (text chips) AND regions (so WarningMap renders region
    // polygons immediately, until the admin draws a custom area).
    areas: regions,
    regions,
    valid_from: toLocal(w.validFrom),
    valid_to: toLocal(w.validTo),
    is_published: true,
  };
}

// ─── Shared primitives ────────────────────────────────────────────────────────
function DInput({ focusBorder = C.skyBorder, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      style={{ ...inputBase, ...(focused ? { borderColor: focusBorder, boxShadow: `0 0 0 3px ${focusBorder}18` } : {}), ...props.style }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function DTextarea({ rows = 3, focusBorder = C.skyBorder, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea rows={rows} {...props}
      style={{ ...inputBase, resize: 'vertical', ...(focused ? { borderColor: focusBorder, boxShadow: `0 0 0 3px ${focusBorder}18` } : {}), ...props.style }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function Field({ label, hint, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {label && (
        <label style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
        </label>
      )}
      {children}
      {hint && <p style={{ margin: 0, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>{hint}</p>}
    </div>
  );
}


// ─── Warning Row ──────────────────────────────────────────────────────────────
function WarningRow({ warning: w, onEdit, onDelete, deleting }) {
  const sev = SEV[w.severity] || SEV.Yellow;
  const stat = STAT[w.status] || STAT.past;
  const StatIcon = stat.icon;

  const fmtDate = d => {
    if (!d) return null;
    const p = new Date(d);
    return isValid(p) ? format(p, 'dd MMM HH:mm') : d;
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '14px 16px',
      background: C.surface2,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${sev.dot}`,
      borderRadius: 12,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.border2}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      {/* Severity dot */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: sev.dot, flexShrink: 0, marginTop: 5,
        boxShadow: `0 0 0 3px ${sev.dot}22`,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: sev.bg, color: sev.text, border: `1px solid ${sev.border}` }}>
            {w.severity}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: C.surface3, color: C.textMid, border: `1px solid ${C.border2}` }}>
            {w.type}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4, background: stat.bg, color: stat.text, border: `1px solid ${stat.border}` }}>
            <StatIcon style={{ width: 10, height: 10 }} />{w.status}
          </span>
          {!w.is_published && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: C.surface3, color: C.textFaint, border: `1px solid ${C.border2}` }}>
              Draft
            </span>
          )}
        </div>

        {/* Title */}
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>{w.title}</p>

        {/* Meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
          {(w.valid_from || w.valid_to) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textDim }}>
              <Clock style={{ width: 11, height: 11 }} />
              {w.valid_from && `From ${fmtDate(w.valid_from)}`}
              {w.valid_from && w.valid_to && ' · '}
              {w.valid_to && `To ${fmtDate(w.valid_to)}`}
            </span>
          )}
          {w.areas?.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textDim }}>
              <MapPin style={{ width: 11, height: 11 }} />
              {w.areas.slice(0, 3).join(', ')}{w.areas.length > 3 ? ` +${w.areas.length - 3}` : ''}
            </span>
          )}
        </div>
        {w.description && (
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: C.textDim, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {w.description}
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {[
          { icon: Pencil, onClick: onEdit, hover: C.sky, title: 'Edit' },
          { icon: deleting ? Loader2 : Trash2, onClick: onDelete, hover: C.red, title: 'Delete', danger: true },
        ].map(({ icon: Icon, onClick, hover, title, danger }) => (
          <button key={title} onClick={onClick} disabled={deleting} title={title}
            style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid transparent`, cursor: 'pointer', transition: 'all 0.15s', color: C.textDim, fontFamily: FONT }}
            onMouseEnter={e => { e.currentTarget.style.background = danger ? C.redLow : C.skyLow; e.currentTarget.style.color = hover; e.currentTarget.style.borderColor = `${hover}30`; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textDim; e.currentTarget.style.borderColor = 'transparent'; }}
          >
            <Icon style={{ width: 13, height: 13, ...(deleting && danger ? { animation: 'spin 0.8s linear infinite' } : {}) }} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Status Group Header ──────────────────────────────────────────────────────
function GroupHeader({ status, count }) {
  const stat = STAT[status] || STAT.past;
  const Icon = stat.icon;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 10px' }}>
      <div style={{ width: 24, height: 24, borderRadius: 7, background: stat.bg, border: `1px solid ${stat.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon style={{ width: 12, height: 12, color: stat.text }} />
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: stat.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{status}</span>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: stat.bg, color: stat.text, border: `1px solid ${stat.border}` }}>{count}</span>
      <div style={{ flex: 1, height: 1, background: `${stat.border}` }} />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ManualWarningsAdmin() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [areaInput, setAreaInput] = useState('');

  const [showImport, setShowImport] = useState(false);

  const { data: warnings = [], isLoading } = useQuery({
    queryKey: ['manualWarnings'],
    queryFn: () => base44.entities.ManualWarning.list('-valid_from'),
  });

  // Auto-scraped Met Office warnings (from CachedWarnings) — read-only source
  // the admin can import & customise into editable manual warnings.
  const { data: metWarnings = [], isLoading: metLoading } = useQuery({
    queryKey: ['cachedMetWarnings'],
    queryFn: async () => {
      const recs = await base44.entities.CachedWarnings.list();
      const all = Array.isArray(recs?.[0]?.all_warnings) ? recs[0].all_warnings : [];
      const now = new Date();
      // Only offer current / upcoming ones for import (skip expired)
      return all.filter(w => { const to = w.validTo ? new Date(w.validTo) : null; return !to || to >= now; });
    },
  });

  const importMet = (w) => { setEditing(metToEditing(w)); setAreaInput(''); setShowImport(false); };

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      // `regions` is only used in-memory for the import flow / map preview — it's
      // not a ManualWarning field, so drop it before persisting (areas covers it).
      const { regions, ...clean } = data;
      const payload = { ...clean, valid_from: clean.valid_from || null, valid_to: clean.valid_to || null };
      if (clean.id) { const { id, ...rest } = payload; return base44.entities.ManualWarning.update(id, rest); }
      return base44.entities.ManualWarning.create(payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manualWarnings'] }); closeForm(); toast.success('Warning saved'); },
    onError: () => toast.error('Failed to save warning'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => base44.entities.ManualWarning.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['manualWarnings'] }); toast.success('Warning deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  const openNew = () => { setEditing({ ...EMPTY }); setAreaInput(''); };
  const closeForm = () => { setEditing(null); setAreaInput(''); };
  const openEdit = w => { setEditing({ ...w, valid_from: w.valid_from?.slice(0, 16) || '', valid_to: w.valid_to?.slice(0, 16) || '' }); setAreaInput(''); };
  const patch = (k, v) => setEditing(p => ({ ...p, [k]: v }));

  const addArea = () => {
    const val = areaInput.trim();
    if (!val || editing.areas?.includes(val)) return;
    patch('areas', [...(editing.areas || []), val]);
    setAreaInput('');
  };

  const grouped = { active: [], upcoming: [], past: [] };
  warnings.forEach(w => { if (grouped[w.status]) grouped[w.status].push(w); });

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
      <Loader2 style={{ width: 20, height: 20, color: C.sky, animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle style={{ width: 15, height: 15, color: C.amber }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Manual Warnings</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textDim }}>{warnings.length} total · {grouped.active.length} active</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowImport(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, background: showImport ? C.amberLow : C.surface3, border: `1px solid ${showImport ? 'rgba(251,191,36,0.4)' : C.border2}`, color: showImport ? C.amber : C.textMid, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.15s' }}
          >
            <CloudDownload style={{ width: 14, height: 14 }} /> Import Met Office
            {metWarnings.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: 'rgba(251,191,36,0.2)', color: C.amber }}>{metWarnings.length}</span>
            )}
          </button>
          <button
            onClick={openNew}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, boxShadow: '0 4px 16px rgba(56,189,248,0.2)', transition: 'all 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'none'}
          >
            <Plus style={{ width: 14, height: 14 }} /> New Warning
          </button>
        </div>
      </div>

      {/* Import-from-Met-Office picker */}
      <AnimatePresence>
        {showImport && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={{ background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 16, padding: 18 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <CloudDownload style={{ width: 15, height: 15, color: C.amber }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Auto Met Office Warnings</span>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 11.5, color: C.textDim, lineHeight: 1.6 }}>
              Pick a warning to load it into the editor — then adjust the details and draw the exact area before publishing.
            </p>
            {metLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <Loader2 style={{ width: 18, height: 18, color: C.amber, animation: 'spin 0.8s linear infinite' }} />
              </div>
            ) : metWarnings.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
                No current Met Office warnings to import.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {metWarnings.map((w, i) => {
                  const sev = SEV[w.severity] || SEV.Yellow;
                  const regions = Array.isArray(w.regions) ? w.regions : (w.region ? [w.region] : []);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: C.surface2, border: `1px solid ${C.border}`, borderLeft: `3px solid ${sev.dot}`, borderRadius: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: sev.bg, color: sev.text, border: `1px solid ${sev.border}` }}>{w.severity}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>{w.type} Warning</span>
                        </div>
                        {regions.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.textDim }}>
                            <MapPin style={{ width: 11, height: 11 }} />{regions.slice(0, 4).join(', ')}{regions.length > 4 ? ` +${regions.length - 4}` : ''}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => importMet(w)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, background: C.amberLow, border: '1px solid rgba(251,191,36,0.35)', color: C.amber, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, flexShrink: 0, transition: 'all 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(251,191,36,0.16)'}
                        onMouseLeave={e => e.currentTarget.style.background = C.amberLow}
                      >
                        <Download style={{ width: 13, height: 13 }} /> Import & Edit
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Form */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
            style={{ background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 18, overflow: 'hidden' }}
          >
            {/* Form Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', background: 'rgba(56,189,248,0.04)', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: C.skyLow, border: `1px solid ${C.skyBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ShieldAlert style={{ width: 13, height: 13, color: C.sky }} />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>
                  {editing.id ? 'Edit Warning' : 'Create Warning'}
                </span>
              </div>
              <button onClick={closeForm} style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textDim, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = C.redLow; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textDim; }}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            </div>

            <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Title & Description */}
              <Field label="Title" required>
                <DInput value={editing.title} onChange={e => patch('title', e.target.value)} placeholder="e.g. Heavy Rain Warning — South East England" />
              </Field>
              <Field label="Description">
                <DTextarea rows={3} value={editing.description} onChange={e => patch('description', e.target.value)} placeholder="What to expect, safety advice, impact level…" />
              </Field>

              {/* Type selector — pills on desktop, bottom-drawer select on mobile */}
              <Field label="Warning Type">
                <div className="hidden sm:block">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {TYPES.map(t => {
                      const active = editing.type === t;
                      return (
                        <button key={t} type="button" onClick={() => patch('type', t)}
                          style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.15s', background: active ? C.skyLow : 'transparent', border: `1px solid ${active ? C.skyBorder : C.border2}`, color: active ? C.sky : C.textMid }}
                          onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = C.border3; e.currentTarget.style.color = C.text; } }}
                          onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMid; } }}
                        >{t}</button>
                      );
                    })}
                  </div>
                </div>
                <div className="sm:hidden">
                  <MobileSelect
                    value={editing.type}
                    onChange={v => patch('type', v)}
                    options={TYPES.map(t => ({ value: t, label: t }))}
                    placeholder="Select type..."
                    label="Warning Type"
                  />
                </div>
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Severity */}
                <Field label="Severity">
                  <div style={{ display: 'flex', gap: 8 }}>
                    {SEVERITIES.map(s => {
                      const sc = SEV[s];
                      const active = editing.severity === s;
                      return (
                        <button key={s} type="button" onClick={() => patch('severity', s)}
                          style={{ flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s', background: active ? sc.bg : C.surface3, border: `1.5px solid ${active ? sc.border : C.border2}`, color: active ? sc.text : C.textDim, boxShadow: active ? `0 0 0 3px ${sc.dot}15` : 'none' }}
                        >{s}</button>
                      );
                    })}
                  </div>
                </Field>

                {/* Status */}
                <Field label="Status">
                  <div style={{ display: 'flex', gap: 8 }}>
                    {STATUSES.map(s => {
                      const sc = STAT[s];
                      const Icon = sc.icon;
                      const active = editing.status === s;
                      return (
                        <button key={s} type="button" onClick={() => patch('status', s)}
                          style={{ flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: active ? sc.bg : C.surface3, border: `1.5px solid ${active ? sc.border : C.border2}`, color: active ? sc.text : C.textDim, textTransform: 'capitalize' }}
                        ><Icon style={{ width: 11, height: 11 }} />{s}</button>
                      );
                    })}
                  </div>
                </Field>
              </div>

              {/* Visibility */}
              <Field label="Visibility">
                <button type="button" onClick={() => patch('is_published', !editing.is_published)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s', background: editing.is_published ? 'rgba(74,222,128,0.08)' : C.surface3, border: `1.5px solid ${editing.is_published ? 'rgba(74,222,128,0.2)' : C.border2}`, color: editing.is_published ? C.green : C.textDim }}>
                  {editing.is_published
                    ? <><CheckCircle2 style={{ width: 14, height: 14 }} /> Published — visible on site</>
                    : <><EyeOff style={{ width: 14, height: 14 }} /> Draft — hidden from users</>}
                </button>
              </Field>

              {/* Date range */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Valid From">
                  <DInput type="datetime-local" value={editing.valid_from || ''} onChange={e => patch('valid_from', e.target.value)} />
                </Field>
                <Field label="Valid To">
                  <DInput type="datetime-local" value={editing.valid_to || ''} onChange={e => patch('valid_to', e.target.value)} />
                </Field>
              </div>

              {/* Areas */}
              <Field label="Areas Affected" hint="Press Enter or + to add. Comma-separated paste also works.">
                <div style={{ display: 'flex', gap: 8 }}>
                  <DInput
                    placeholder="e.g. Yorkshire"
                    value={areaInput}
                    onChange={e => setAreaInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } }}
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={addArea}
                    style={{ width: 40, height: 40, borderRadius: 10, background: C.skyLow, border: `1px solid ${C.skyBorder}`, color: C.sky, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = C.skyLow}
                  ><Plus style={{ width: 14, height: 14 }} /></button>
                </div>
                <DTextarea rows={2} placeholder="Paste multiple areas: Yorkshire, Humberside, Lincolnshire" onChange={e => {
                  const raw = e.target.value;
                  if (raw.includes(',') || raw.includes('\n')) {
                    const parsed = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                    patch('areas', [...new Set([...(editing.areas || []), ...parsed])]);
                    e.target.value = '';
                  }
                }} style={{ fontSize: 12, marginTop: 8 }} />
                {editing.areas?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
                    {editing.areas.map(area => (
                      <span key={area} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: C.skyLow, border: `1px solid ${C.skyBorder}`, fontSize: 12, color: C.sky, fontWeight: 600 }}>
                        {area}
                        <button type="button" onClick={() => patch('areas', editing.areas.filter(a => a !== area))}
                          style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: C.sky, padding: 0, opacity: 0.7 }}
                          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                          onMouseLeave={e => e.currentTarget.style.opacity = '0.7'}
                        ><X style={{ width: 10, height: 10 }} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </Field>

              {/* Draw warning area */}
              <Field label="Warning Area" hint="Tap the pen icon, then click point-by-point around the area. The shape fills in as you go — press Finish when done. Shows to everyone exactly as drawn.">
                <ImpactDrawingMap
                  isOwner
                  paths={editing.area_drawing || []}
                  onPathsChange={(paths) => patch('area_drawing', paths)}
                />
              </Field>

              {/* Save */}
              <button
                type="button"
                onClick={() => saveMutation.mutate(editing)}
                disabled={saveMutation.isPending || !editing?.title?.trim()}
                style={{ width: '100%', padding: '12px 0', borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: saveMutation.isPending || !editing?.title?.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: saveMutation.isPending || !editing?.title?.trim() ? C.surface3 : 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: saveMutation.isPending || !editing?.title?.trim() ? C.textDim : '#fff', boxShadow: saveMutation.isPending || !editing?.title?.trim() ? 'none' : '0 4px 20px rgba(56,189,248,0.25)', transition: 'all 0.2s', fontFamily: FONT }}
              >
                {saveMutation.isPending ? <><Loader2 style={{ width: 15, height: 15, animation: 'spin 0.8s linear infinite' }} />Saving…</> : <><Save style={{ width: 15, height: 15 }} />{editing.id ? 'Update Warning' : 'Create Warning'}</>}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warning list grouped */}
      {Object.entries(grouped).map(([status, items]) => (
        <div key={status}>
          <GroupHeader status={status} count={items.length} />
          {items.length === 0 ? (
            <p style={{ fontSize: 12, color: C.textFaint, fontStyle: 'italic', paddingLeft: 4 }}>None</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map(w => (
                <WarningRow key={w.id} warning={w} onEdit={() => openEdit(w)}
                  onDelete={() => { if (window.confirm(`Delete "${w.title}"?`)) deleteMutation.mutate(w.id); }}
                  deleting={deleteMutation.isPending} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}