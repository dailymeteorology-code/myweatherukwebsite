import React, { useState, useEffect } from 'react';
import { AC } from '@/components/admin/adminTheme';
import { base44 } from '@/api/base44Client';
import { Mail, Send, Users, CheckCircle, XCircle, Loader2, RefreshCw, Trash2 } from 'lucide-react';

/* the admin colours: CSS variables that Admin Settings sets for its light and dark themes */
const C = AC;

export default function NewsletterAdmin() {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { sent, failed, errors }
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const subs = await base44.entities.NewsletterSubscriber.list('-subscribed_at');
      setSubscribers(subs);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const verified = subscribers.filter(s => s.verified && !s.unsubscribed);
  const unverified = subscribers.filter(s => !s.verified && !s.unsubscribed);
  const unsubscribed = subscribers.filter(s => s.unsubscribed);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) { alert('Subject and body are required.'); return; }
    if (!verified.length) { alert('No verified subscribers to send to.'); return; }
    if (!window.confirm(`Send this email to ${verified.length} verified subscriber${verified.length !== 1 ? 's' : ''}?`)) return;

    setSending(true);
    setSendResult(null);
    let sent = 0, failed = 0, errors = [];

    for (const sub of verified) {
      try {
        await base44.integrations.Core.SendEmail({
          to: sub.email,
          subject: subject.trim(),
          body: body.trim() + '\n\n—\nMyWeatherUK Newsletter\nUnsubscribe: reply with "unsubscribe"',
        });
        sent++;
      } catch (e) {
        failed++;
        errors.push(`${sub.email}: ${e?.message || 'failed'}`);
      }
      // small delay between sends
      await new Promise(r => setTimeout(r, 150));
    }

    setSendResult({ sent, failed, errors });
    setSending(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this subscriber?')) return;
    await base44.entities.NewsletterSubscriber.delete(id);
    load();
  };

  const inp = {
    width: '100%', background: C.surface3, border: `1px solid ${C.border2}`,
    borderRadius: 10, color: C.text, padding: '10px 14px', fontSize: 13,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Verified', value: verified.length, color: C.green, icon: CheckCircle },
          { label: 'Pending verification', value: unverified.length, color: C.amber, icon: Mail },
          { label: 'Unsubscribed', value: unsubscribed.length, color: C.textDim, icon: XCircle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{ padding: '16px 18px', borderRadius: 14, background: C.surface, border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Icon size={15} color={color} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Compose */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Send size={16} color={C.sky} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Compose & Send Newsletter</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textMid }}>
            Sends to <strong style={{ color: C.green }}>{verified.length}</strong> verified subscriber{verified.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Subject</label>
            <input style={inp} placeholder="e.g. MyWeatherUK Weekly — 16 July 2026" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Body (plain text)</label>
            <textarea style={{ ...inp, minHeight: 200, resize: 'vertical' }}
              placeholder={`Hi everyone,\n\nHere's this week's weather summary from MyWeatherUK...\n\n— The MyWeatherUK team`}
              value={body} onChange={e => setBody(e.target.value)} />
          </div>

          {/* Preview toggle */}
          {body.trim() && (
            <div>
              <button type="button" onClick={() => setPreview(v => !v)} style={{ fontSize: 12, color: C.sky, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}>
                {preview ? '▲ Hide preview' : '▼ Preview email'}
              </button>
              {preview && (
                <div style={{ marginTop: 10, padding: '14px 16px', background: C.surface3, border: `1px solid ${C.border2}`, borderRadius: 10, fontSize: 13, color: C.textMid, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                  <strong style={{ color: C.text, display: 'block', marginBottom: 8 }}>Subject: {subject || '(no subject)'}</strong>
                  {body}
                  {'\n\n—\nMyWeatherUK Newsletter\nUnsubscribe: reply with "unsubscribe"'}
                </div>
              )}
            </div>
          )}

          {sendResult && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: sendResult.failed ? 'rgba(248,113,113,0.08)' : 'rgba(74,222,128,0.08)', border: `1px solid ${sendResult.failed ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}` }}>
              <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 13, color: sendResult.failed ? C.red : C.green }}>
                ✓ Sent to {sendResult.sent} subscriber{sendResult.sent !== 1 ? 's' : ''}
                {sendResult.failed > 0 ? ` · ${sendResult.failed} failed` : ''}
              </p>
              {sendResult.errors.length > 0 && (
                <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>
                  {sendResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: C.textMid }}>
                Note: SendEmail only delivers to registered MyWeatherUK app users. External-only subscribers will not receive it via this method.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim() || !verified.length}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 11, border: 'none', background: (sending || !subject.trim() || !body.trim() || !verified.length) ? C.surface3 : 'linear-gradient(135deg, #0ea5e9, #0284c7)', color: (sending || !subject.trim() || !body.trim() || !verified.length) ? C.textDim : '#fff', fontSize: 13, fontWeight: 700, cursor: (sending || !subject.trim() || !body.trim() || !verified.length) ? 'not-allowed' : 'pointer' }}>
              {sending ? <><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} />Sending…</> : <><Send size={14} />Send to {verified.length} subscriber{verified.length !== 1 ? 's' : ''}</>}
            </button>
          </div>
        </div>
      </div>

      {/* Subscriber list */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={16} color={C.textMid} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Subscribers</span>
          <button onClick={load} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.textMid, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <RefreshCw size={13} />Refresh
          </button>
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.textMid }}>
              <Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
            </div>
          ) : subscribers.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: C.textMid, fontSize: 13 }}>No subscribers yet.</div>
          ) : (
            subscribers.map(sub => (
              <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: sub.unsubscribed ? C.textDim : sub.verified ? C.green : C.amber }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.email}</div>
                  <div style={{ fontSize: 11, color: C.textMid }}>
                    {sub.name && <span>{sub.name} · </span>}
                    {sub.unsubscribed ? <span style={{ color: C.textDim }}>Unsubscribed</span> : sub.verified ? <span style={{ color: C.green }}>Verified</span> : <span style={{ color: C.amber }}>Pending</span>}
                    {sub.subscribed_at && <span> · {new Date(sub.subscribed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  </div>
                </div>
                <button onClick={() => handleDelete(sub.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 4, display: 'flex', alignItems: 'center' }} title="Remove subscriber">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}