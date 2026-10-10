/**
 * Weather Scenarios admin — for authorised editors (role 'admin').
 * Edit or add scenarios, change month associations and regional
 * applicability, review frequency text, add historical examples, correct
 * source links, publish/unpublish, record verification and re-check links.
 * Every write is validated server-side and written to an audit log.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, BadgeCheck, RotateCcw, Plus, Link2, Loader2, AlertTriangle } from 'lucide-react';
import { adminCall, clearScenarioCaches } from './scenarioApi';

const TEMPLATE = {
  id: 'new-scenario-id', name: 'New scenario', cat: 'winter', also: [], aka: [], kind: 'scenario', sev: 'moderate', temp: 'cold',
  precip: ['snow'], circ: ['northerly'], months: 'PP---------P', monthNotes: {},
  summary: 'One or two sentences summarising the scenario for a general reader (40+ characters).',
  body: ['A detailed explanation paragraph.'],
  regions: [['north', 'high', 'Why it matters here.']],
  setup: { essential: ['Required ingredient.'], favourable: ['Factor that makes it more likely.'] },
  outcomes: ['Possible outcome.'], impacts: {}, signals: [['Signal', 'What it tells forecasters', 'Limitation']],
  frequency: 'Qualitative frequency statement.', stats: [], related: [], sources: ['mo-past-events'],
};

export default function ScenarioAdmin({ data, onChanged }) {
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [sel, setSel] = useState('');
  const [text, setText] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [evText, setEvText] = useState('');
  const [srcText, setSrcText] = useState('');

  const refresh = () => adminCall('/overview').then(setOv).catch((e) => setErr(e.message));
  useEffect(() => { refresh(); }, []);

  const open = async (id) => {
    setSel(id); setIsNew(false); setErrors([]); setMsg(null);
    try { const r = await adminCall(`/record/${id}`); setText(JSON.stringify(r.record, null, 2)); } catch (e) { setErr(e.message); }
  };
  const save = async () => {
    setBusy(true); setErrors([]); setMsg(null);
    try {
      const record = JSON.parse(text);
      const r = isNew ? await adminCall('/scenario', { method: 'POST', body: { record } }) : await adminCall(`/scenario/${sel}`, { method: 'PUT', body: { record } });
      setMsg(isNew ? `Added "${r.id}" as a draft (unpublished). Publish it when it has been checked.` : 'Saved.');
      setIsNew(false); setSel(r.id); clearScenarioCaches(); onChanged?.(); refresh();
    } catch (e) { setErrors(e.details || [e.message]); } finally { setBusy(false); }
  };
  const status = async (id, body) => { try { await adminCall(`/status/${id}`, { method: 'POST', body }); clearScenarioCaches(); onChanged?.(); refresh(); } catch (e) { setErr(e.message); } };
  const revert = async (id) => { if (!window.confirm('Discard the edited version and restore the original record?')) return; try { await adminCall(`/scenario/${id}`, { method: 'DELETE' }); clearScenarioCaches(); onChanged?.(); refresh(); open(id); } catch (e) { setErr(e.message); } };
  const saveEvent = async () => { setErrors([]); try { const ev = JSON.parse(evText); await adminCall(`/event/${ev.id}`, { method: 'PUT', body: { event: ev } }); setMsg(`Event "${ev.id}" saved.`); clearScenarioCaches(); onChanged?.(); refresh(); } catch (e) { setErrors(e.details || [e.message]); } };
  const saveSource = async () => { setErrors([]); try { const s = JSON.parse(srcText); await adminCall(`/source/${s.id}`, { method: 'PUT', body: { source: s } }); setMsg(`Source "${s.id}" saved.`); clearScenarioCaches(); onChanged?.(); refresh(); } catch (e) { setErrors(e.details || [e.message]); } };
  const checkLinks = async () => { try { await adminCall('/check-links', { method: 'POST' }); setMsg('Link check started — refresh in a minute.'); } catch (e) { setErr(e.message); } };

  const list = useMemo(() => (ov?.scenarios || []).filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.id.includes(q.toLowerCase())), [ov, q]);
  if (err && !ov) return <p role="alert" className="muted">{err}</p>;
  if (!ov) return <p className="muted"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading admin data…</p>;

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel" style={{ padding: 14, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span><strong>{ov.counts.scenarios}</strong> scenarios ({ov.counts.base} authored)</span>
        <span><strong>{ov.counts.events}</strong> events</span><span><strong>{ov.counts.sources}</strong> sources</span>
        <span style={{ color: ov.problems.length ? 'var(--bad)' : 'var(--good)' }}><strong>{ov.problems.length}</strong> validation problems</span>
        <span className="faint">Catalogue version {ov.version}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={checkLinks}><Link2 size={14} aria-hidden="true" />Re-check all source links</button>
      </div>
      {ov.linkCheck && <p className="note">Last link check {new Date(ov.linkCheck.at).toLocaleString('en-GB')}: {ov.linkCheck.ok}/{ov.linkCheck.total} OK{ov.linkCheck.failed.length ? ` — failing: ${ov.linkCheck.failed.map((f) => `${f.id} (${f.status})`).join(', ')}` : ''}.</p>}
      {ov.problems.length > 0 && <div className="panel" style={{ padding: 12, borderColor: 'var(--bad)' }}><p className="h3"><AlertTriangle size={14} aria-hidden="true" /> Records excluded until fixed</p><ul>{ov.problems.slice(0, 40).map((p, i) => <li key={i}><code>{p.kind}:{p.id}</code> — {p.problem}</li>)}</ul></div>}
      {msg && <p role="status" style={{ color: 'var(--good)' }}>{msg}</p>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(260px,340px) 1fr', alignItems: 'start' }}>
        <div className="panel" style={{ padding: 10, maxHeight: '70vh', overflowY: 'auto' }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find…" aria-label="Find scenario" style={{ width: '100%', marginBottom: 8 }} />
          <button type="button" className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={() => { setIsNew(true); setSel(''); setText(JSON.stringify(TEMPLATE, null, 2)); setErrors([]); setMsg(null); }}><Plus size={14} aria-hidden="true" />Add a scenario</button>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {list.map((s) => (
              <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px', borderTop: '1px solid var(--line)' }}>
                <button type="button" onClick={() => open(s.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, cursor: 'pointer', fontWeight: sel === s.id ? 800 : 500, color: s.published ? 'var(--ink)' : 'var(--ink3)' }}>
                  {s.name}{s.origin !== 'base' && <span className="tag" style={{ marginLeft: 4, border: '1px solid var(--warn)', color: 'var(--warn)' }}>{s.origin}</span>}
                </button>
                <button type="button" title={s.published ? 'Unpublish' : 'Publish'} aria-label={`${s.published ? 'Unpublish' : 'Publish'} ${s.name}`} onClick={() => status(s.id, { published: !s.published })} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--ink2)' }}>{s.published ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <button type="button" title={s.verifiedAt ? `Verified ${new Date(s.verifiedAt).toLocaleDateString('en-GB')} by ${s.verifiedBy}` : 'Mark content as verified'} aria-label={`Mark ${s.name} verified`} onClick={() => status(s.id, { verified: true })} style={{ background: 'none', border: 0, cursor: 'pointer', color: s.verifiedAt ? 'var(--good)' : 'var(--ink3)' }}><BadgeCheck size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel" style={{ padding: 14 }}>
          {!text ? <p className="muted">Choose a scenario to edit, or add a new one. Records are JSON in the same structure as the authored catalogue (see docs/WEATHER-SCENARIOS.md). Month codes: C common, P plausible, U uncommon, R rare, - outside its season.</p> : (
            <>
              <p className="h3" style={{ marginBottom: 8 }}>{isNew ? 'New scenario (saved as an unpublished draft)' : `Editing ${sel}`}</p>
              <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Scenario record JSON"
                style={{ width: '100%', minHeight: 420, fontFamily: 'ui-monospace,Consolas,monospace', fontSize: '.78rem', lineHeight: 1.45 }} />
              {errors.length > 0 && <ul role="alert" style={{ color: 'var(--bad)' }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Validate and save'}</button>
                {!isNew && ov.edits.scenarios.includes(sel) && <button type="button" className="btn" onClick={() => revert(sel)}><RotateCcw size={14} aria-hidden="true" />Revert to original</button>}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
        <div className="panel" style={{ padding: 14 }}>
          <p className="h3">Add or edit a historical event</p>
          <p className="note">Only events with a citable official source. Fields: id, title, start, end (YYYY-MM-DD), regions, categories, scenarios, summary, observations, sources.</p>
          <select aria-label="Load an existing event" onChange={(e) => { const ev = data.eventById.get(e.target.value); if (ev) setEvText(JSON.stringify(ev, null, 2)); }} defaultValue="">
            <option value="">Load existing event…</option>{data.events.map((e) => <option key={e.id} value={e.id}>{e.start.slice(0, 4)} — {e.title}</option>)}
          </select>
          <textarea value={evText} onChange={(e) => setEvText(e.target.value)} aria-label="Event JSON" style={{ width: '100%', minHeight: 200, marginTop: 8, fontFamily: 'ui-monospace,monospace', fontSize: '.78rem' }} />
          <button type="button" className="btn" onClick={saveEvent} disabled={!evText}>Validate and save event</button>
        </div>
        <div className="panel" style={{ padding: 14 }}>
          <p className="h3">Add or correct a source</p>
          <p className="note">Fields: id, title, url (https), publisher, kind.</p>
          <select aria-label="Load an existing source" onChange={(e) => { const s = data.sourceById.get(e.target.value); if (s) setSrcText(JSON.stringify(s, null, 2)); }} defaultValue="">
            <option value="">Load existing source…</option>{data.sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <textarea value={srcText} onChange={(e) => setSrcText(e.target.value)} aria-label="Source JSON" style={{ width: '100%', minHeight: 140, marginTop: 8, fontFamily: 'ui-monospace,monospace', fontSize: '.78rem' }} />
          <button type="button" className="btn" onClick={saveSource} disabled={!srcText}>Validate and save source</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <p className="h3">Audit log</p>
        <ul style={{ fontSize: '.82rem', maxHeight: 260, overflowY: 'auto' }}>{ov.audit.map((a, i) => <li key={i}>{new Date(a.at).toLocaleString('en-GB')} — {a.by} — {a.action} {a.target || ''}</li>)}</ul>
        {!ov.audit.length && <p className="note">No edits yet.</p>}
      </div>
    </div>
  );
}
