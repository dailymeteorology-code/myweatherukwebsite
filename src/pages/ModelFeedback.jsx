import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Star, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
  Calendar, Zap, BarChart3, Edit3, Trash2, X, Save, Tag, MapPin,
} from 'lucide-react';

const RISK_LEVELS = ['No Risk', 'Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];
const OUTCOMES = ['No storms', 'Isolated', 'Scattered', 'Widespread', 'Severe'];
const BIAS_OPTIONS = ['over-forecast', 'accurate', 'under-forecast'];
const COMMON_TAGS = ['Spanish Plume', 'Cold Front', 'Warm Sector', 'Orographic', 'MCS', 'Supercell', 'Sea Breeze', 'Trough', 'Blocking High'];

const BIAS_ICON = { 'over-forecast': TrendingUp, 'accurate': Minus, 'under-forecast': TrendingDown };
const BIAS_COLOR = { 'over-forecast': '#f59e0b', 'accurate': '#34d399', 'under-forecast': '#60a5fa' };
const ACCURACY_COLORS = ['', '#ef4444', '#f59e0b', '#eab308', '#34d399', '#22c55e'];

function StarRating({ value, onChange, readonly = false }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => !readonly && onChange?.(n)}
          onMouseEnter={() => !readonly && setHover(n)}
          onMouseLeave={() => setHover(0)}
          style={{ background: 'none', border: 'none', cursor: readonly ? 'default' : 'pointer', padding: 0 }}>
          <Star size={readonly ? 14 : 18}
            fill={(hover || value) >= n ? ACCURACY_COLORS[Math.max(1, Math.min(5, value || hover || 1))] : 'none'}
            stroke={(hover || value) >= n ? ACCURACY_COLORS[Math.max(1, Math.min(5, value || hover || 1))] : '#475569'}
          />
        </button>
      ))}
    </div>
  );
}

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  day_label: 'Day 1',
  forecast_risk: 'Slight',
  actual_outcome: 'No storms',
  accuracy_rating: 3,
  notes: '',
  peak_lightning: '',
  peak_region: '',
  model_score: '',
  bias_direction: 'accurate',
  tags: [],
};

function FeedbackForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleTag = (tag) => set('tags', form.tags?.includes(tag) ? form.tags.filter(t => t !== tag) : [...(form.tags || []), tag]);

  const handleSave = async () => {
    if (!form.date) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const inp = {
    background: 'rgba(15,26,46,0.9)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, color: '#e2e8f0', padding: '8px 11px', fontSize: 13,
    outline: 'none', width: '100%',
  };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 5 };

  return (
    <div style={{ background: 'rgba(10,16,34,0.97)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0' }}>{initial ? 'Edit Entry' : 'New Feedback Entry'}</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <div>
          <span style={lbl}>Date</span>
          <input style={inp} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <span style={lbl}>Day Label</span>
          <select style={inp} value={form.day_label} onChange={e => set('day_label', e.target.value)}>
            {['Day 1', 'Day 2', 'Day 3'].map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <span style={lbl}>Forecast Risk</span>
          <select style={inp} value={form.forecast_risk} onChange={e => set('forecast_risk', e.target.value)}>
            {RISK_LEVELS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <span style={lbl}>Actual Outcome</span>
          <select style={inp} value={form.actual_outcome} onChange={e => set('actual_outcome', e.target.value)}>
            {OUTCOMES.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <span style={lbl}>Bias Direction</span>
          <select style={inp} value={form.bias_direction} onChange={e => set('bias_direction', e.target.value)}>
            {BIAS_OPTIONS.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <span style={lbl}>Model Score (0–100)</span>
          <input style={inp} type="number" min={0} max={100} placeholder="e.g. 42" value={form.model_score} onChange={e => set('model_score', e.target.value)} />
        </div>
        <div>
          <span style={lbl}>Peak Lightning</span>
          <input style={inp} type="number" min={0} placeholder="strike count" value={form.peak_lightning} onChange={e => set('peak_lightning', e.target.value)} />
        </div>
        <div>
          <span style={lbl}>Peak Region</span>
          <input style={inp} placeholder="e.g. Midlands" value={form.peak_region} onChange={e => set('peak_region', e.target.value)} />
        </div>
      </div>

      <div>
        <span style={lbl}>Accuracy Rating</span>
        <StarRating value={form.accuracy_rating} onChange={v => set('accuracy_rating', v)} />
      </div>

      <div>
        <span style={lbl}>Notes</span>
        <textarea style={{ ...inp, minHeight: 80, resize: 'vertical' }}
          placeholder="What happened vs what was forecast? Key features, timing errors, missed events…"
          value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      <div>
        <span style={lbl}>Tags</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COMMON_TAGS.map(tag => {
            const on = form.tags?.includes(tag);
            return (
              <button key={tag} type="button" onClick={() => toggleTag(tag)} style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                background: on ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${on ? '#38bdf8' : 'rgba(255,255,255,0.12)'}`,
                color: on ? '#7dd3fc' : '#94a3b8',
              }}>{tag}</button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '9px 18px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, #38bdf8, #818cf8)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Save size={14} />{saving ? 'Saving…' : 'Save Entry'}
        </button>
      </div>
    </div>
  );
}

function FeedbackCard({ entry, onEdit, onDelete, isAdmin }) {
  const [expanded, setExpanded] = useState(false);
  const BiasIcon = BIAS_ICON[entry.bias_direction] || Minus;
  const biasColor = BIAS_COLOR[entry.bias_direction] || '#94a3b8';

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      style={{ background: 'rgba(10,16,34,0.85)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => setExpanded(v => !v)}>
        <div style={{ flexShrink: 0, width: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>{entry.day_label}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{entry.date}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{entry.forecast_risk} → {entry.actual_outcome}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: biasColor }}>
              <BiasIcon size={12} />
              <span style={{ fontSize: 10.5, fontWeight: 700 }}>{entry.bias_direction}</span>
            </div>
          </div>
          <StarRating value={entry.accuracy_rating} readonly />
        </div>
        {entry.peak_region && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#64748b', fontSize: 11 }}>
            <MapPin size={11} />{entry.peak_region}
          </div>
        )}
        {expanded ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {entry.notes && <p style={{ margin: '10px 0 0', fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>{entry.notes}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {entry.peak_lightning != null && <span style={{ fontSize: 11, color: '#64748b' }}><Zap size={11} style={{ display: 'inline', marginRight: 3 }} />{entry.peak_lightning?.toLocaleString()} strikes</span>}
                {entry.model_score != null && entry.model_score !== '' && <span style={{ fontSize: 11, color: '#64748b' }}><BarChart3 size={11} style={{ display: 'inline', marginRight: 3 }} />Score: {entry.model_score}</span>}
              </div>
              {entry.tags?.length > 0 && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {entry.tags.map(t => <span key={t} style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10.5, background: 'rgba(255,255,255,0.06)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.2)' }}><Tag size={9} style={{ display: 'inline', marginRight: 3 }} />{t}</span>)}
                </div>
              )}
              {isAdmin && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => onEdit(entry)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}><Edit3 size={12} />Edit</button>
                  <button onClick={() => onDelete(entry.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer' }}><Trash2 size={12} />Delete</button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function ModelFeedback() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterBias, setFilterBias] = useState('all');

  useEffect(() => {
    base44.auth.me().then(u => setIsAdmin(u?.role === 'admin')).catch(() => {});
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.ModelFeedback.list('-date');
      setEntries(data);
    } finally { setLoading(false); }
  };

  const handleSave = async (form) => {
    const payload = { ...form, peak_lightning: form.peak_lightning !== '' ? Number(form.peak_lightning) : null, model_score: form.model_score !== '' ? Number(form.model_score) : null };
    if (editing) {
      await base44.entities.ModelFeedback.update(editing.id, payload);
    } else {
      await base44.entities.ModelFeedback.create(payload);
    }
    setShowForm(false); setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    await base44.entities.ModelFeedback.delete(id);
    load();
  };

  const filtered = useMemo(() => filterBias === 'all' ? entries : entries.filter(e => e.bias_direction === filterBias), [entries, filterBias]);

  // Stats
  const stats = useMemo(() => {
    if (!entries.length) return null;
    const rated = entries.filter(e => e.accuracy_rating);
    const avg = rated.length ? (rated.reduce((s, e) => s + (e.accuracy_rating || 0), 0) / rated.length).toFixed(1) : null;
    const over = entries.filter(e => e.bias_direction === 'over-forecast').length;
    const under = entries.filter(e => e.bias_direction === 'under-forecast').length;
    const accurate = entries.filter(e => e.bias_direction === 'accurate').length;
    return { avg, over, under, accurate, total: entries.length };
  }, [entries]);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #060b18 0%, #0b1226 100%)', padding: '0 0 80px' }}>
      {/* Header */}
      <div style={{ padding: '24px 20px 16px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: '#e2e8f0', letterSpacing: '-0.01em' }}>Model Feedback Log</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Track forecast accuracy vs observed weather</p>
          </div>
          {isAdmin && !showForm && (
            <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #38bdf8, #818cf8)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <Plus size={15} />New Entry
            </button>
          )}
        </div>

        {/* Stats row */}
        {stats && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
            {[
              { label: 'Total Entries', value: stats.total, color: '#94a3b8' },
              { label: 'Avg Accuracy', value: stats.avg ? `${stats.avg}/5 ★` : '—', color: '#eab308' },
              { label: 'Over-forecast', value: stats.over, color: '#f59e0b' },
              { label: 'Accurate', value: stats.accurate, color: '#34d399' },
              { label: 'Under-forecast', value: stats.under, color: '#60a5fa' },
            ].map(s => (
              <div key={s.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Form */}
        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <FeedbackForm initial={editing || undefined} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter */}
        {entries.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', 'over-forecast', 'accurate', 'under-forecast'].map(f => (
              <button key={f} onClick={() => setFilterBias(f)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${filterBias === f ? '#38bdf8' : 'rgba(255,255,255,0.10)'}`, background: filterBias === f ? 'rgba(56,189,248,0.18)' : 'transparent', color: filterBias === f ? '#7dd3fc' : '#64748b' }}>
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
        )}

        {/* Entries */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
            <BarChart3 size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ margin: 0 }}>{isAdmin ? 'No entries yet — add your first feedback above.' : 'No feedback entries yet.'}</p>
          </div>
        ) : (
          filtered.map(entry => (
            <FeedbackCard key={entry.id} entry={entry} isAdmin={isAdmin}
              onEdit={(e) => { setEditing(e); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onDelete={handleDelete} />
          ))
        )}
      </div>
    </div>
  );
}