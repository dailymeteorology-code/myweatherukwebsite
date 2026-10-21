import React, { useState } from 'react';
import { AC, ADMIN_FONT, tint } from '@/components/admin/adminTheme';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Plus, Trash2, Pencil, X, Save, Megaphone, ChevronDown, Eye, EyeOff, Check,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Design tokens ─────────────────────────────────────────────────────────────
/* the admin colours: CSS variables that Admin Settings sets for its light and dark themes */
const C = { ...AC, violetBorder: tint(AC.violet, '33'), amberBorder: tint(AC.amber, '33'), redBorder: tint(AC.red, '33') };
const FONT = ADMIN_FONT;
const inputBase = {
  width: '100%', boxSizing: 'border-box', padding: '10px 14px',
  background: C.surface3, border: `1px solid ${C.border2}`, borderRadius: 10,
  color: C.text, fontSize: 13, fontFamily: FONT, outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s', lineHeight: 1.5,
};

// ─── Constants ─────────────────────────────────────────────────────────────────
const PRIORITIES = ['info', 'warning', 'urgent'];
const CATEGORIES = [
  { id: 'general',     label: 'General',     color: C.textMid,  bg: C.surface3,     border: C.border2 },
  { id: 'new_feature', label: 'New Feature', color: C.green,    bg: C.greenLow,     border: 'rgba(74,222,128,0.2)' },
  { id: 'coming_soon', label: 'Coming Soon', color: C.violet,   bg: C.violetLow,    border: C.violetBorder },
];
const PRI = {
  info:    { color: C.sky,   bg: C.skyLow,   border: C.skyBorder,  label: 'Info' },
  warning: { color: C.amber, bg: C.amberLow, border: C.amberBorder, label: 'Warning' },
  urgent:  { color: C.red,   bg: C.redLow,   border: C.redBorder,  label: 'Urgent' },
};
const PAGES = ['', 'Home', 'Graphics', 'LocationWeather', 'Subscription', 'Dashboard'];
const EMPTY = { title: '', message: '', is_active: true, priority: 'info', category: 'general', target_page: '', link_url: '', link_label: '' };

// ─── Primitives ────────────────────────────────────────────────────────────────
function DInput({ focusBorder = C.skyBorder, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props} style={{ ...inputBase, ...(focused ? { borderColor: focusBorder, boxShadow: `0 0 0 3px ${tint(focusBorder, '18')}` } : {}), ...props.style }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }} />
  );
}
function DTextarea({ rows = 3, focusBorder = C.skyBorder, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea rows={rows} {...props} style={{ ...inputBase, resize: 'vertical', ...(focused ? { borderColor: focusBorder, boxShadow: `0 0 0 3px ${tint(focusBorder, '18')}` } : {}), ...props.style }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }} />
  );
}
function DSelect({ children, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <select {...props} style={{ ...inputBase, appearance: 'none', paddingRight: 36, cursor: 'pointer', ...(focused ? { borderColor: C.skyBorder, boxShadow: `0 0 0 3px ${tint(C.skyBorder, '18')}` } : {}), ...props.style }}
        onFocus={e => { setFocused(true); props.onFocus?.(e); }}
        onBlur={e => { setFocused(false); props.onBlur?.(e); }}>
        {children}
      </select>
      <ChevronDown style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: C.textDim, pointerEvents: 'none' }} />
    </div>
  );
}
function Field({ label, hint, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {label && <label style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}</label>}
      {children}
      {hint && <p style={{ margin: 0, fontSize: 11, color: C.textFaint, lineHeight: 1.6 }}>{hint}</p>}
    </div>
  );
}

// ─── Announcement Row ──────────────────────────────────────────────────────────
function AnnouncementRow({ a, onEdit, onDelete }) {
  const pri = PRI[a.priority] || PRI.info;
  const cat = CATEGORIES.find(c => c.id === a.category) || CATEGORIES[0];
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
      background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12,
      opacity: a.is_active ? 1 : 0.45, transition: 'all 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.border2}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      {/* Priority dot */}
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: pri.color, marginTop: 5, flexShrink: 0, boxShadow: `0 0 0 3px ${tint(pri.color, '20')}` }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}>{cat.label}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: pri.bg, color: pri.color, border: `1px solid ${pri.border}`, textTransform: 'capitalize' }}>{pri.label}</span>
          {a.target_page && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 6, background: C.surface3, color: C.textDim, border: `1px solid ${C.border2}` }}>{a.target_page} only</span>}
          {!a.is_active && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: C.surface3, color: C.textFaint, border: `1px solid ${C.border2}` }}>Hidden</span>}
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>{a.title}</p>
        <p style={{ margin: '4px 0 0', fontSize: 11.5, color: C.textDim, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.message}</p>
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {[{ icon: Pencil, onClick: onEdit, hover: C.sky, low: C.skyLow }, { icon: Trash2, onClick: onDelete, hover: C.red, low: C.redLow }].map(({ icon: Icon, onClick, hover, low }) => (
          <button key={hover} onClick={onClick}
            style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid transparent', cursor: 'pointer', color: C.textDim, transition: 'all 0.15s', fontFamily: FONT }}
            onMouseEnter={e => { e.currentTarget.style.background = low; e.currentTarget.style.color = hover; e.currentTarget.style.borderColor = `${tint(hover, '30')}`; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textDim; e.currentTarget.style.borderColor = 'transparent'; }}>
            <Icon style={{ width: 13, height: 13 }} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function AnnouncementsAdmin() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => base44.entities.Announcement.list('-created_date'),
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const { id, ...rest } = data;
      return id ? base44.entities.Announcement.update(id, rest) : base44.entities.Announcement.create(rest);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['announcements'] }); setEditing(null); toast.success('Announcement saved'); },
    onError: () => toast.error('Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => base44.entities.Announcement.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['announcements'] }); toast.success('Deleted'); },
  });

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
      <Loader2 style={{ width: 20, height: 20, color: C.sky, animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const canSave = editing?.title?.trim() && editing?.message?.trim();

  return (
    <div style={{ fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} select option{background:#0c1422;color:#f1f5f9}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: C.skyLow, border: `1px solid ${C.skyBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Megaphone style={{ width: 15, height: 15, color: C.sky }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Announcements</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textDim }}>{announcements.length} total · {announcements.filter(a => a.is_active).length} active</p>
          </div>
        </div>
        <button onClick={() => setEditing({ ...EMPTY })}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, boxShadow: '0 4px 16px rgba(56,189,248,0.2)', transition: 'all 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'none'}
        ><Plus style={{ width: 14, height: 14 }} /> New</button>
      </div>

      {/* Editor */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
            style={{ background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 18, overflow: 'hidden' }}>
            {/* Header bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', background: 'rgba(56,189,248,0.04)', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: C.skyLow, border: `1px solid ${C.skyBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Megaphone style={{ width: 13, height: 13, color: C.sky }} />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{editing.id ? 'Edit Announcement' : 'New Announcement'}</span>
              </div>
              <button onClick={() => setEditing(null)}
                style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textDim, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = C.redLow; e.currentTarget.style.color = C.red; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textDim; }}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            </div>

            <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Title & Message */}
              <Field label="Title" required>
                <DInput value={editing.title} onChange={e => setEditing(p => ({ ...p, title: e.target.value }))} placeholder="Announcement title…" />
              </Field>
              <Field label="Message" required>
                <DTextarea rows={3} value={editing.message} onChange={e => setEditing(p => ({ ...p, message: e.target.value }))} placeholder="Announcement body text…" />
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Category */}
                <Field label="Category">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {CATEGORIES.map(c => {
                      const active = editing.category === c.id;
                      return (
                        <button key={c.id} type="button" onClick={() => setEditing(p => ({ ...p, category: c.id }))}
                          style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.15s', background: active ? c.bg : 'transparent', border: `1px solid ${active ? c.border : C.border2}`, color: active ? c.color : C.textMid, display: 'flex', alignItems: 'center', gap: 5 }}>
                          {active && <Check style={{ width: 10, height: 10 }} />}{c.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                {/* Priority */}
                <Field label="Priority">
                  <div style={{ display: 'flex', gap: 8 }}>
                    {PRIORITIES.map(p => {
                      const pc = PRI[p];
                      const active = editing.priority === p;
                      return (
                        <button key={p} type="button" onClick={() => setEditing(prev => ({ ...prev, priority: p }))}
                          style={{ flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s', textTransform: 'capitalize', background: active ? pc.bg : C.surface3, border: `1.5px solid ${active ? pc.border : C.border2}`, color: active ? pc.color : C.textDim }}>
                          {pc.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Target Page */}
                <Field label="Target Page" hint="Leave blank for all pages">
                  <DSelect value={editing.target_page} onChange={e => setEditing(p => ({ ...p, target_page: e.target.value }))}>
                    {PAGES.map(pg => <option key={pg} value={pg}>{pg === '' ? 'All Pages' : pg}</option>)}
                  </DSelect>
                </Field>

                {/* Active toggle */}
                <Field label="Visibility">
                  <button type="button" onClick={() => setEditing(p => ({ ...p, is_active: !p.is_active }))}
                    style={{ width: '100%', height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.2s', background: editing.is_active ? C.greenLow : C.surface3, border: `1.5px solid ${editing.is_active ? 'rgba(74,222,128,0.2)' : C.border2}`, color: editing.is_active ? C.green : C.textDim }}>
                    {editing.is_active ? <><Eye style={{ width: 14, height: 14 }} /> Active</> : <><EyeOff style={{ width: 14, height: 14 }} /> Hidden</>}
                  </button>
                </Field>
              </div>

              {/* Link */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
                <Field label="Link URL" hint="Optional CTA button">
                  <DInput value={editing.link_url} onChange={e => setEditing(p => ({ ...p, link_url: e.target.value }))} placeholder="https://… or #section" />
                </Field>
                <Field label="Button Label">
                  <DInput value={editing.link_label} onChange={e => setEditing(p => ({ ...p, link_label: e.target.value }))} placeholder="Check it out" />
                </Field>
              </div>

              {/* Save */}
              <button type="button" onClick={() => saveMutation.mutate(editing)} disabled={saveMutation.isPending || !canSave}
                style={{ width: '100%', padding: '12px 0', borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: saveMutation.isPending || !canSave ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: saveMutation.isPending || !canSave ? C.surface3 : 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', color: saveMutation.isPending || !canSave ? C.textDim : '#fff', boxShadow: saveMutation.isPending || !canSave ? 'none' : '0 4px 20px rgba(56,189,248,0.25)', transition: 'all 0.2s', fontFamily: FONT }}>
                {saveMutation.isPending ? <><Loader2 style={{ width: 15, height: 15, animation: 'spin 0.8s linear infinite' }} />Saving…</> : <><Save style={{ width: 15, height: 15 }} />{editing.id ? 'Update' : 'Create'}</>}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {announcements.map(a => (
          <AnnouncementRow key={a.id} a={a} onEdit={() => setEditing({ ...a })}
            onDelete={() => { if (window.confirm('Delete this announcement?')) deleteMutation.mutate(a.id); }} />
        ))}
        {announcements.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '48px 0', color: C.textFaint }}>
            <Megaphone style={{ width: 28, height: 28, opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: 13 }}>No announcements yet</p>
          </div>
        )}
      </div>
    </div>
  );
}