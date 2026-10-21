/* ════════════════════════════════════════════════════════════════════════════
   SubscriptionMatrixAdmin — Admin Settings → Subscriptions editor.

   Edit everything shown on the public /Subscription page:
     • Tiers: name, price, period, price note, badge text + colour, "highlight"
       (featured) flag, and the API-credit usage lines.
     • Product matrix: each product's per-tier cell = Included / Not included /
       Custom text (e.g. "Application Only").
     • Add / remove tiers and products freely.
   Saves the whole config as one JSON blob via saveSubConfig().
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from 'react';
import { AC, ADMIN_FONT, tint } from '@/components/admin/adminTheme';
import { Plus, Trash2, Save, Loader2, Check, X as XIcon, Star, RotateCcw, ExternalLink } from 'lucide-react';
import { loadSubConfig, saveSubConfig, DEFAULT_SUB_CONFIG, cellFor } from '@/lib/subscriptionConfig';

/* the admin colours: CSS variables that Admin Settings sets for its light and dark themes */
const C = {
  text: AC.text, mid: AC.textMid, faint: AC.textDim, dim: AC.textFaint,
  surface: AC.surface, surface2: AC.surface2, border: AC.border2, border2: AC.border3,
  sky: AC.sky, green: AC.green, red: AC.red, violet: AC.violet, amber: AC.amber,
};
const FONT = ADMIN_FONT;
const clone = (x) => JSON.parse(JSON.stringify(x));
let _n = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${_n++}`;

const inp = {
  width: '100%', boxSizing: 'border-box', padding: '8px 11px', background: 'var(--ad-surface3)',
  border: `1px solid ${C.border2}`, borderRadius: 9, color: C.text, fontSize: 13, fontFamily: FONT, outline: 'none',
};
const btn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 9,
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, border: `1px solid ${C.border2}`,
  background: C.surface2, color: C.text,
};
const label = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.faint, marginBottom: 5, display: 'block' };

function Field({ title, children }) {
  return <div><span style={label}>{title}</span>{children}</div>;
}

/* ── One matrix cell editor: Included / Not / Custom ─────────────────── */
function CellEditor({ cell, onChange }) {
  const type = cell?.type || 'no';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 120 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {[
          { t: 'yes',  Icon: Check,  color: C.green, title: 'Included' },
          { t: 'no',   Icon: XIcon,  color: C.red,   title: 'Not included' },
          { t: 'text', label: 'Aa',  color: C.amber, title: 'Custom text' },
        ].map(({ t, Icon, label: lb, color, title }) => {
          const on = type === t;
          return (
            <button key={t} type="button" title={title}
              onClick={() => onChange(t === 'text' ? { type: 'text', text: cell?.text || '' } : { type: t })}
              style={{
                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                padding: '6px 0', borderRadius: 7, cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 800,
                background: on ? `${tint(color, '22')}` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${on ? color : 'rgba(255,255,255,0.08)'}`,
                color: on ? color : C.faint,
              }}>
              {Icon ? <Icon style={{ width: 13, height: 13 }} /> : lb}
            </button>
          );
        })}
      </div>
      {type === 'text' && (
        <input value={cell?.text || ''} placeholder="e.g. Application Only"
          onChange={(e) => onChange({ type: 'text', text: e.target.value })}
          style={{ ...inp, padding: '6px 9px', fontSize: 12 }} />
      )}
    </div>
  );
}

export default function SubscriptionMatrixAdmin() {
  const [cfg, setCfg] = useState(null);
  const [recId, setRecId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const { id, config } = await loadSubConfig();
      if (!alive) return;
      setRecId(id);
      setCfg(clone(config));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const mutate = (fn) => setCfg((prev) => { const next = clone(prev); fn(next); return next; });

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const res = await saveSubConfig(recId, cfg);
      if (res?.id) setRecId(res.id);
      setMsg('Saved — the Subscription page is now updated for everyone.');
    } catch (e) {
      setMsg('Save failed: ' + (e?.message || 'unknown error'));
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 5000);
    }
  };

  const resetDefaults = () => {
    if (window.confirm('Reset the whole subscriptions page back to the default tiers and matrix? Unsaved changes are lost — you still need to press Save.')) {
      setCfg(clone(DEFAULT_SUB_CONFIG));
    }
  };

  if (loading || !cfg) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '40px 0', color: C.mid, fontFamily: FONT }}>
        <Loader2 style={{ width: 16, height: 16, animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Loading subscriptions…</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const { tiers, products, intro } = cfg;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontFamily: FONT, color: C.text }}>
      {/* Header / actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Subscriptions</p>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: C.mid }}>
            Edit the pricing tiers, the API product matrix and the credit limits shown on the public
            <a href="/Subscription" target="_blank" rel="noreferrer" style={{ color: C.sky, textDecoration: 'none', margin: '0 4px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              Subscription page <ExternalLink style={{ width: 11, height: 11 }} />
            </a>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={resetDefaults} style={{ ...btn, background: 'transparent', color: C.mid }}>
            <RotateCcw style={{ width: 13, height: 13 }} /> Reset
          </button>
          <button type="button" onClick={save} disabled={saving}
            style={{ ...btn, background: saving ? C.surface2 : 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.4)', color: C.sky, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 0.8s linear infinite' }} /> : <Save style={{ width: 13, height: 13 }} />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {msg && (
        <div style={{ padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600,
          background: msg.startsWith('Save failed') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
          border: `1px solid ${msg.startsWith('Save failed') ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: msg.startsWith('Save failed') ? C.red : C.green }}>
          {msg}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Intro */}
      <section style={{ padding: 16, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}`, display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text }}>Page heading</p>
        <Field title="Title">
          <input value={intro.title} onChange={(e) => mutate(c => { c.intro.title = e.target.value; })} style={inp} />
        </Field>
        <Field title="Subtitle">
          <textarea value={intro.subtitle} onChange={(e) => mutate(c => { c.intro.subtitle = e.target.value; })} rows={2} style={{ ...inp, resize: 'vertical' }} />
        </Field>
      </section>

      {/* Tiers */}
      <section style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>Tiers, prices &amp; API usage</p>
          <button type="button" onClick={() => mutate(c => c.tiers.push({ id: uid('tier'), name: 'New Tier', price: '£0', period: '/month', priceNote: '', badge: '', badgeColor: '#38bdf8', highlight: false, apiUsage: [''] }))} style={btn}>
            <Plus style={{ width: 13, height: 13 }} /> Add tier
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {tiers.map((t, i) => (
            <div key={t.id} style={{ padding: 16, borderRadius: 14, background: C.surface, border: `1px solid ${t.highlight ? 'rgba(167,139,250,0.4)' : C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: C.violet }}>Tier {i + 1}</span>
                <button type="button" onClick={() => mutate(c => c.tiers.splice(i, 1))} title="Remove tier"
                  style={{ ...btn, padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: C.red }}>
                  <Trash2 style={{ width: 12, height: 12 }} /> Remove
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
                <Field title="Name"><input value={t.name} onChange={(e) => mutate(c => { c.tiers[i].name = e.target.value; })} style={inp} /></Field>
                <Field title="Price"><input value={t.price} onChange={(e) => mutate(c => { c.tiers[i].price = e.target.value; })} style={inp} placeholder="£0" /></Field>
                <Field title="Period"><input value={t.period} onChange={(e) => mutate(c => { c.tiers[i].period = e.target.value; })} style={inp} placeholder="/month" /></Field>
                <Field title="Price note"><input value={t.priceNote} onChange={(e) => mutate(c => { c.tiers[i].priceNote = e.target.value; })} style={inp} placeholder="e.g. custom quote" /></Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12, alignItems: 'end' }}>
                <Field title="Badge text (Best Value, Best Seller…)"><input value={t.badge} onChange={(e) => mutate(c => { c.tiers[i].badge = e.target.value; })} style={inp} placeholder="(none)" /></Field>
                <Field title="Badge colour">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="color" value={t.badgeColor || '#38bdf8'} onChange={(e) => mutate(c => { c.tiers[i].badgeColor = e.target.value; })} style={{ width: 38, height: 34, padding: 0, border: `1px solid ${C.border2}`, borderRadius: 8, background: 'transparent', cursor: 'pointer' }} />
                    <input value={t.badgeColor || ''} onChange={(e) => mutate(c => { c.tiers[i].badgeColor = e.target.value; })} style={{ ...inp, flex: 1 }} placeholder="#38bdf8" />
                  </div>
                </Field>
                <Field title="Featured">
                  <button type="button" onClick={() => mutate(c => { c.tiers[i].highlight = !c.tiers[i].highlight; })}
                    style={{ ...btn, width: '100%', justifyContent: 'center', background: t.highlight ? 'rgba(167,139,250,0.18)' : C.surface2, borderColor: t.highlight ? 'rgba(167,139,250,0.5)' : C.border2, color: t.highlight ? C.violet : C.mid }}>
                    <Star style={{ width: 13, height: 13, fill: t.highlight ? C.violet : 'none' }} /> {t.highlight ? 'Highlighted' : 'Highlight this tier'}
                  </button>
                </Field>
              </div>

              {/* API usage lines */}
              <div>
                <span style={label}>API credit usage lines</span>
                <div style={{ display: 'grid', gap: 6 }}>
                  {(t.apiUsage || []).map((ln, j) => (
                    <div key={j} style={{ display: 'flex', gap: 6 }}>
                      <input value={ln} onChange={(e) => mutate(c => { c.tiers[i].apiUsage[j] = e.target.value; })} style={inp} placeholder="e.g. 5,000 credits/day" />
                      <button type="button" onClick={() => mutate(c => { c.tiers[i].apiUsage.splice(j, 1); })} title="Remove line"
                        style={{ ...btn, padding: '0 10px', background: 'transparent', color: C.faint }}><XIcon style={{ width: 13, height: 13 }} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => mutate(c => { (c.tiers[i].apiUsage ||= []).push(''); })} style={{ ...btn, justifySelf: 'start', padding: '6px 11px', background: 'transparent', color: C.sky, borderColor: 'rgba(56,189,248,0.3)' }}>
                    <Plus style={{ width: 12, height: 12 }} /> Add usage line
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Product matrix */}
      <section style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>API product matrix</p>
          <button type="button" onClick={() => mutate(c => c.products.push({ id: uid('prod'), name: 'New Product', cells: {} }))} style={btn}>
            <Plus style={{ width: 13, height: 13 }} /> Add product
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 11.5, color: C.faint }}>
          For each product, set every tier to <b style={{ color: C.green }}>Included</b>, <b style={{ color: C.red }}>Not included</b>, or a <b style={{ color: C.amber }}>Custom</b> label.
        </p>

        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 14 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 120 + tiers.length * 150 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--ad-bg)', textAlign: 'left', padding: '12px 14px', fontSize: 11, color: C.mid, borderBottom: `1px solid ${C.border}`, minWidth: 200 }}>Product</th>
                {tiers.map(t => (
                  <th key={t.id} style={{ padding: '12px 10px', fontSize: 11, color: C.mid, borderBottom: `1px solid ${C.border}`, minWidth: 140 }}>{t.name || '—'}</th>
                ))}
                <th style={{ borderBottom: `1px solid ${C.border}` }} />
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={p.id}>
                  <td style={{ position: 'sticky', left: 0, background: 'var(--ad-bg)', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
                    <input value={p.name} onChange={(e) => mutate(c => { c.products[i].name = e.target.value; })} style={{ ...inp, minWidth: 170 }} />
                  </td>
                  {tiers.map(t => (
                    <td key={t.id} style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                      <CellEditor cell={cellFor(p, t.id)} onChange={(cell) => mutate(c => { (c.products[i].cells ||= {})[t.id] = cell; })} />
                    </td>
                  ))}
                  <td style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, textAlign: 'center' }}>
                    <button type="button" onClick={() => mutate(c => c.products.splice(i, 1))} title="Remove product"
                      style={{ ...btn, padding: '7px', background: 'transparent', color: C.faint, borderColor: 'transparent' }}>
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sticky-ish footer save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
        <button type="button" onClick={save} disabled={saving}
          style={{ ...btn, padding: '11px 20px', background: saving ? C.surface2 : 'rgba(56,189,248,0.15)', borderColor: 'rgba(56,189,248,0.4)', color: C.sky, cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 0.8s linear infinite' }} /> : <Save style={{ width: 14, height: 14 }} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
