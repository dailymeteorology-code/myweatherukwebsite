import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, Pause, Play, FlaskConical, Brain, ScrollText, Activity, Sliders, Loader2 } from 'lucide-react';
import { SEV, aiwGet, aiwSend, fmtAgo } from './aiwClient';
import { SevBadge } from './WarningDetail';

const TABS = [
  { id: 'health', label: 'Health', Icon: Activity },
  { id: 'active', label: 'Active warnings', Icon: ShieldAlert },
  { id: 'config', label: 'Thresholds', Icon: Sliders },
  { id: 'model', label: 'Model', Icon: Brain },
  { id: 'test', label: 'Test warning', Icon: FlaskConical },
  { id: 'logs', label: 'Logs', Icon: ScrollText },
];

const box = { borderRadius: 12, padding: '9px 11px', background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)' };
const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700, background: 'var(--glass-fill-strong)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)' };
const inp = { padding: '5px 7px', borderRadius: 7, fontSize: '0.74rem', fontFamily: 'inherit', background: 'var(--glass-fill)', color: 'var(--ink-1)', border: '1px solid var(--glass-hairline)', width: '100%', boxSizing: 'border-box' };
const fmtN = (v, d = 4) => (v == null ? '—' : Number(v).toFixed(d));

/**
 * Administrator controls for the AI warning system. Protected server-side by
 * the existing auth (role 'admin'); every action here is written to the audit
 * log with who did it.
 */
function AiwAdminPanel({ onAfterChange }) {
  const [tab, setTab] = useState('health');
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try { setOv(await aiwGet('/admin/overview')); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);

  const act = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); await load(); onAfterChange?.(); } catch (e) { setMsg(`Failed: ${e.message}`); } finally { setBusy(false); }
  };

  return (
    <div className="lg-pane" style={{ borderRadius: 20, overflow: 'hidden', border: '1.5px solid rgba(244,67,54,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 15px', borderBottom: '1px solid var(--glass-hairline)', flexWrap: 'wrap' }}>
        <ShieldAlert style={{ width: 16, height: 16, color: '#F44336' }} aria-hidden="true" />
        <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--ink-1)' }}>AI warnings — administrator</span>
        {ov?.paused && <span style={{ fontSize: '0.64rem', fontWeight: 800, padding: '2px 8px', borderRadius: 99, background: '#F44336', color: '#fff' }}>ISSUANCE PAUSED</span>}
        <div style={{ flex: 1 }} />
        {busy && <Loader2 style={{ width: 14, height: 14, animation: 'spin 0.9s linear infinite', color: 'var(--ink-3)' }} />}
        <button type="button" onClick={load} style={btn}><RefreshCw style={{ width: 12, height: 12 }} /> Refresh</button>
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: '8px 12px 0', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            style={{ ...btn, background: tab === t.id ? 'var(--glass-fill-strong)' : 'transparent', border: tab === t.id ? '1px solid var(--glass-hairline)' : '1px solid transparent' }}>
            <t.Icon style={{ width: 12, height: 12 }} /> {t.label}
          </button>
        ))}
      </div>
      <div style={{ padding: '10px 15px 15px' }}>
        {err && <p style={{ color: '#F44336', fontSize: '0.78rem' }}>{err}</p>}
        {msg && <p role="status" style={{ fontSize: '0.74rem', color: 'var(--ink-1)', margin: '0 0 8px' }}>{msg}</p>}
        {!ov ? <p style={{ fontSize: '0.78rem', color: 'var(--ink-3)' }}>Loading…</p> : (
          <>
            {tab === 'health' && <Health ov={ov} act={act} />}
            {tab === 'active' && <Active ov={ov} act={act} />}
            {tab === 'config' && <Config ov={ov} act={act} />}
            {tab === 'model' && <Model ov={ov} act={act} />}
            {tab === 'test' && <TestWarning act={act} />}
            {tab === 'logs' && <Logs ov={ov} />}
          </>
        )}
      </div>
    </div>
  );
}

function Health({ ov, act }) {
  const feeds = ov.health?.feeds || {};
  const eng = ov.engine || {};
  const env = ov.health?.environment || {};
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
      <div style={box}>
        <b style={{ fontSize: '0.74rem' }}>Lightning feeds</b>
        {Object.values(feeds).map((f) => (
          <p key={f.id} style={{ margin: '5px 0 0', fontSize: '0.72rem' }}>
            {f.name}: <b style={{ color: f.status === 'live' ? '#34d399' : '#F44336' }}>{f.status}</b> · {f.sockets}/{f.socketsTarget || 3} sockets ·
            last strike {f.lastStrikeAgeMs == null ? 'never' : `${Math.round(f.lastStrikeAgeMs / 1000)} s ago`} · {f.received?.toLocaleString()} received · {f.invalid} rejected
          </p>
        ))}
      </div>
      <div style={box}>
        <b style={{ fontSize: '0.74rem' }}>Forecast engine</b>
        <p style={{ margin: '5px 0 0', fontSize: '0.72rem' }}>Last cycle {eng.lastCycleAt ? fmtAgo(eng.lastCycleAt) : 'never'} · took {eng.lastCycleMs} ms · {eng.cycles} cycles</p>
        <p style={{ margin: '3px 0 0', fontSize: '0.72rem' }}>{eng.cells} storm cells · {eng.tracksLive} tracked · {eng.assessed} assessed</p>
        {eng.lastError && <pre style={{ fontSize: '0.62rem', whiteSpace: 'pre-wrap', color: '#F44336' }}>{eng.lastError.slice(0, 600)}</pre>}
      </div>
      <div style={box}>
        <b style={{ fontSize: '0.74rem' }}>Model atmosphere (Open-Meteo)</b>
        <p style={{ margin: '5px 0 0', fontSize: '0.72rem' }}>Last OK {env.lastOkAt ? fmtAgo(env.lastOkAt) : 'never'} · {env.calls} calls · {env.failures} failures · {env.cached} cache hits</p>
        {env.lastError && <p style={{ margin: '3px 0 0', fontSize: '0.68rem', color: '#F44336' }}>{env.lastError}</p>}
        <p style={{ margin: '3px 0 0', fontSize: '0.68rem', color: 'var(--ink-3)' }}>Radar and satellite inputs are not integrated.</p>
      </div>
      <div style={box}>
        <b style={{ fontSize: '0.74rem' }}>Strike archive (training data)</b>
        <p style={{ margin: '5px 0 0', fontSize: '0.72rem' }}>
          {ov.archive.hourFiles} hour files · {(ov.archive.bytes / 1048576).toFixed(1)} MB ·
          {ov.archive.firstHour ? ` ${((ov.archive.lastHour - ov.archive.firstHour) / 3600e3 + 1).toFixed(0)} h span` : ' empty'}
        </p>
      </div>
      <div style={{ ...box, gridColumn: '1 / -1' }}>
        <b style={{ fontSize: '0.74rem' }}>Automated issuance</b>
        <p style={{ margin: '4px 0 6px', fontSize: '0.7rem', color: 'var(--ink-2)' }}>Pausing stops NEW warnings and changes from being issued. Active warnings keep running to their expiry. Use during a data or system fault.</p>
        {ov.paused ? (
          <button type="button" style={btn} onClick={() => act(() => aiwSend('POST', '/admin/pause', { paused: false }), 'Issuance resumed.')}><Play style={{ width: 12, height: 12 }} /> Resume issuance</button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={inp} placeholder="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" style={{ ...btn, background: '#F44336', color: '#fff', border: 'none' }} onClick={() => act(() => aiwSend('POST', '/admin/pause', { paused: true, reason }), 'Issuance paused.')}><Pause style={{ width: 12, height: 12 }} /> Pause</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Active({ ov, act }) {
  const [reason, setReason] = useState({});
  if (!ov.active.length) return <p style={{ fontSize: '0.78rem', color: 'var(--ink-2)' }}>No active warnings.</p>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {ov.active.map((w) => (
        <div key={w.id} style={{ ...box, borderLeft: `5px solid ${SEV[w.severity].color}` }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <SevBadge severity={w.severity} isTest={w.isTest} />
            <b style={{ fontSize: '0.78rem' }}>{w.areaLabel}</b>
            <span style={{ fontSize: '0.66rem', color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>{w.id} · {w.remainingMin} min left · {w.confidence}</span>
          </div>
          <ul style={{ margin: '5px 0 0', paddingLeft: 18, fontSize: '0.7rem' }}>{(w.reasons || []).map((r) => <li key={r}>{r}</li>)}</ul>
          {w.evidence && <p style={{ margin: '4px 0 0', fontSize: '0.66rem', color: 'var(--ink-2)', fontFamily: 'ui-monospace, monospace' }}>
            rate {w.evidence.ratePerMin}/min · trend {w.evidence.trendLogRatio} · peakP {w.evidence.peakProbability} · core {w.evidence.peakDensity100}/100km² · pop {w.evidence.exposedPopulation}+{w.evidence.populationAhead} · CAPE {w.evidence.environment?.cape ?? '—'}
          </p>}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input style={inp} placeholder="Reason for cancelling (required)" value={reason[w.id] || ''} onChange={(e) => setReason((r) => ({ ...r, [w.id]: e.target.value }))} />
            <button type="button" disabled={!reason[w.id]} style={{ ...btn, opacity: reason[w.id] ? 1 : 0.5 }}
              onClick={() => act(() => aiwSend('POST', `/admin/warnings/${encodeURIComponent(w.id)}/cancel`, { reason: reason[w.id] }), `${w.id} cancelled.`)}>
              Cancel warning
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Threshold editor: the numbers the decision engine uses, validated server-side. */
function Config({ ov, act }) {
  const [draft, setDraft] = useState(() => JSON.stringify(ov.config, null, 2));
  const [parseErr, setParseErr] = useState(null);
  const fields = [
    ['areaProbability', 'Warning-area probability contour'], ['corridorProbability', 'Uncertainty-corridor contour'],
    ['minAreaKm2', 'Minimum area (km²)'], ['minCyclesToIssue', 'Minutes a storm must persist before a first warning'],
    ['escalateCycles', 'Consecutive minutes to escalate'], ['downgradeCycles', 'Consecutive minutes to downgrade'],
    ['exitFactor', 'Exit-threshold factor (hysteresis)'], ['minDurationMin', 'Minimum duration (min)'], ['maxDurationMin', 'Maximum duration (min)'],
    ['quietCancelMin', 'Cancel after this many quiet minutes'],
  ];
  let parsed = null; try { parsed = JSON.parse(draft); } catch { /* shown below */ }
  const setField = (k, v) => { const p = JSON.parse(draft); p[k] = v; setDraft(JSON.stringify(p, null, 2)); };
  return (
    <div>
      {parsed && (
        <div style={{ display: 'grid', gap: 7, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', marginBottom: 9 }}>
          {fields.map(([k, label]) => (
            <label key={k} style={{ fontSize: '0.68rem', color: 'var(--ink-2)' }}>{label}
              <input style={inp} type="number" step="any" value={parsed[k]} onChange={(e) => setField(k, Number(e.target.value))} />
            </label>
          ))}
        </div>
      )}
      <details>
        <summary style={{ fontSize: '0.72rem', cursor: 'pointer', color: 'var(--ink-2)' }}>All criteria (yellow / amber / red) as JSON</summary>
        <textarea value={draft} onChange={(e) => { setDraft(e.target.value); try { JSON.parse(e.target.value); setParseErr(null); } catch (x) { setParseErr(x.message); } }}
          rows={18} spellCheck={false} style={{ ...inp, fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem', marginTop: 6 }} />
      </details>
      {parseErr && <p style={{ color: '#F44336', fontSize: '0.7rem' }}>{parseErr}</p>}
      {ov.latestModel?.suggestedThresholds && (
        <p style={{ fontSize: '0.7rem', color: 'var(--ink-2)' }}>
          Data-derived strike-rate suggestion from the latest training run: amber ≥ {ov.latestModel.suggestedThresholds.amber.minStrikesPerMin}/min, red ≥ {ov.latestModel.suggestedThresholds.red.minStrikesPerMin}/min
          (cell-rate percentiles: p90 {ov.latestModel.cellRatePercentiles.p90}, p99 {ov.latestModel.cellRatePercentiles.p99}).
        </p>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button type="button" disabled={!!parseErr} style={btn} onClick={() => act(() => aiwSend('PUT', '/admin/config', JSON.parse(draft)), 'Thresholds saved (audited).')}>Save thresholds</button>
        <button type="button" style={btn} onClick={() => setDraft(JSON.stringify(ov.defaults, null, 2))}>Load defaults</button>
      </div>
    </div>
  );
}

function Model({ ov, act }) {
  const m = ov.model || {};
  const latest = ov.latestModel;
  const job = ov.trainJob;
  const t = latest?.metrics?.test;
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      <div style={box}>
        <b style={{ fontSize: '0.74rem' }}>Deployed: {m.version}</b>
        <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--ink-2)' }}>
          {m.trained ? `Trained logistic model${m.skillPositive ? ', verified skill on held-out data.' : '.'}` : 'Baseline (advected persistence) — no trained model has passed the deployment gate yet.'}
        </p>
        <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
          <button type="button" style={btn} disabled={job?.status === 'running'} onClick={() => act(() => aiwSend('POST', '/admin/train', { deploy: false }), 'Training started (research only).')}>Train (don&apos;t deploy)</button>
          <button type="button" style={btn} disabled={job?.status === 'running'} onClick={() => act(() => aiwSend('POST', '/admin/train', { deploy: true }), 'Training started — deploys only if it passes the gate.')}>Train &amp; deploy if it passes</button>
          {m.trained && <button type="button" style={btn} onClick={() => act(() => aiwSend('POST', '/admin/models/baseline/deploy', {}), 'Rolled back to the baseline.')}>Roll back to baseline</button>}
        </div>
        {job && (
          <details style={{ marginTop: 7 }} open={job.status === 'running'}>
            <summary style={{ fontSize: '0.7rem', cursor: 'pointer' }}>Training job: {job.status}{job.result ? ` → ${job.result.version} (${job.result.status})` : ''}</summary>
            <pre style={{ fontSize: '0.62rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', margin: '5px 0 0' }}>{(job.log || []).join('\n')}</pre>
          </details>
        )}
      </div>
      {latest && t && (
        <div style={box}>
          <b style={{ fontSize: '0.74rem' }}>Latest trained: {latest.version} — {latest.status}</b>
          <p style={{ margin: '4px 0 0', fontSize: '0.7rem' }}>
            Trained on {latest.data.archiveHours} h of archive · {latest.data.trainSamples.toLocaleString()} train samples ({latest.data.trainPositives.toLocaleString()} lightning) ·
            tested on {latest.data.testSamples.toLocaleString()} later samples ({latest.data.testPositives.toLocaleString()} lightning), chronological split with a {latest.data.gapMin}-min gap.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', marginTop: 6 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}><th>Held-out test</th><th>Brier</th><th>Brier skill</th><th>POD</th><th>FAR</th><th>CSI</th></tr></thead>
            <tbody>
              {[['Trained model', t.overall], ['Baseline', t.baseline], ['Persistence', t.persistence]].map(([n, r]) => (
                <tr key={n} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                  <td>{n}</td><td>{fmtN(r.brier)}</td><td>{fmtN(r.brierSkill, 3)}</td><td>{fmtN(r.pod, 3)}</td><td>{fmtN(r.far, 3)}</td><td>{fmtN(r.csi, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: '6px 0 0', fontSize: '0.7rem', color: latest.gate.passed ? '#34d399' : '#F44336' }}>
            Deployment gate: {latest.gate.passed ? 'PASSED' : `not passed — ${latest.gate.failures.join('; ')}`}
          </p>
          {latest.gate.passed && latest.status !== 'deployed' && (
            <button type="button" style={{ ...btn, marginTop: 6 }} onClick={() => act(() => aiwSend('POST', `/admin/models/${latest.version}/deploy`, {}), `${latest.version} deployed.`)}>Deploy this model</button>
          )}
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: '0.7rem', cursor: 'pointer' }}>Per lead time</summary>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.66rem', marginTop: 4 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}><th>Lead</th><th>Model Brier</th><th>Baseline</th><th>Persistence</th><th>Model CSI</th><th>Base rate</th></tr></thead>
              <tbody>{Object.entries(t.byLead).map(([L, r]) => (
                <tr key={L} style={{ borderTop: '1px solid var(--glass-hairline)' }}><td>+{L}</td><td>{fmtN(r.model.brier)}</td><td>{fmtN(r.baseline.brier)}</td><td>{fmtN(r.persistence.brier)}</td><td>{fmtN(r.model.csi, 3)}</td><td>{fmtN(r.model.baseRate, 3)}</td></tr>
              ))}</tbody>
            </table>
          </details>
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: '0.7rem', cursor: 'pointer' }}>Per region</summary>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.66rem', marginTop: 4 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}><th>Region</th><th>Samples</th><th>Model Brier</th><th>Baseline</th><th>Persistence</th></tr></thead>
              <tbody>{Object.entries(t.byRegion).map(([R, r]) => (
                <tr key={R} style={{ borderTop: '1px solid var(--glass-hairline)' }}><td>{R}</td><td>{r.model.samples.toLocaleString()}</td><td>{fmtN(r.model.brier)}</td><td>{fmtN(r.baseline.brier)}</td><td>{fmtN(r.persistence.brier)}</td></tr>
              ))}</tbody>
            </table>
          </details>
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: '0.7rem', cursor: 'pointer' }}>Reliability (calibration)</summary>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.66rem', marginTop: 4 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}><th>Forecast bin</th><th>Samples</th><th>Mean forecast</th><th>Observed</th></tr></thead>
              <tbody>{t.overall.reliability.map((b) => (
                <tr key={b.bin} style={{ borderTop: '1px solid var(--glass-hairline)' }}><td>{b.bin}</td><td>{b.n.toLocaleString()}</td><td>{fmtN(b.meanForecast, 3)}</td><td>{fmtN(b.observed, 3)}</td></tr>
              ))}</tbody>
            </table>
          </details>
        </div>
      )}
      {!!ov.models?.length && (
        <div style={box}>
          <b style={{ fontSize: '0.74rem' }}>Model registry</b>
          {ov.models.map((x) => (
            <p key={x.version} style={{ margin: '4px 0 0', fontSize: '0.68rem', fontFamily: 'ui-monospace, monospace' }}>
              {x.version} · {x.status} · Brier {fmtN(x.brier)} (baseline {fmtN(x.baselineBrier)}) · {x.gate?.passed ? 'gate passed' : 'gate failed'} · {fmtAgo(x.createdAt)}
            </p>
          ))}
        </div>
      )}
      {!!ov.verification?.length && (
        <div style={box}>
          <b style={{ fontSize: '0.74rem' }}>Recent warning verification (30-min track vs observed)</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.66rem', marginTop: 4 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}><th>Warning</th><th>+10 captured</th><th>+30 captured</th><th>+30 empty area</th></tr></thead>
            <tbody>{ov.verification.slice().reverse().map((v) => (
              <tr key={v.id} style={{ borderTop: '1px solid var(--glass-hairline)' }}>
                <td>{v.id} ({v.severity})</td>
                <td>{v.verification.byLead?.[10]?.capture == null ? '—' : `${Math.round(v.verification.byLead[10].capture * 100)}%`}</td>
                <td>{v.verification.byLead?.[30]?.capture == null ? '—' : `${Math.round(v.verification.byLead[30].capture * 100)}%`}</td>
                <td>{v.verification.byLead?.[30]?.falseAreaFraction == null ? '—' : `${Math.round(v.verification.byLead[30].falseAreaFraction * 100)}%`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TestWarning({ act }) {
  const [f, setF] = useState({ lat: 51.88, lon: -0.42, severity: 'yellow', speedKmh: 40, towardDeg: 60, durationMin: 15 });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: '0.72rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
        Issues a clearly-labelled <b>TEST</b> warning to exercise the map, the forecast track, voice and notifications. It gets a <code>TEST-</code> id, says
        &ldquo;This is a test&rdquo; when spoken, is hidden from the public list by default, and expires on its own.
      </p>
      <div style={{ display: 'grid', gap: 7, gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
        <label style={{ fontSize: '0.68rem' }}>Latitude<input style={inp} type="number" step="0.01" value={f.lat} onChange={(e) => set('lat', Number(e.target.value))} /></label>
        <label style={{ fontSize: '0.68rem' }}>Longitude<input style={inp} type="number" step="0.01" value={f.lon} onChange={(e) => set('lon', Number(e.target.value))} /></label>
        <label style={{ fontSize: '0.68rem' }}>Severity
          <select style={inp} value={f.severity} onChange={(e) => set('severity', e.target.value)}>{['yellow', 'amber', 'red'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <label style={{ fontSize: '0.68rem' }}>Speed km/h<input style={inp} type="number" value={f.speedKmh} onChange={(e) => set('speedKmh', Number(e.target.value))} /></label>
        <label style={{ fontSize: '0.68rem' }}>Heading °<input style={inp} type="number" value={f.towardDeg} onChange={(e) => set('towardDeg', Number(e.target.value))} /></label>
        <label style={{ fontSize: '0.68rem' }}>Lasts (min)<input style={inp} type="number" value={f.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} /></label>
      </div>
      <button type="button" style={{ ...btn, marginTop: 8 }} onClick={() => act(() => aiwSend('POST', '/admin/test-warning', f), 'Test warning issued — tick "show test warnings" in Issued Warnings to see it in the list.')}>
        <FlaskConical style={{ width: 12, height: 12 }} /> Issue test warning
      </button>
    </div>
  );
}

function Logs({ ov }) {
  const [which, setWhich] = useState('events');
  const rows = which === 'audit' ? ov.audit : which === 'announcements' ? ov.announcements : ov.events;
  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
        {['events', 'announcements', 'audit'].map((w) => (
          <button key={w} type="button" onClick={() => setWhich(w)} style={{ ...btn, background: which === w ? 'var(--glass-fill-strong)' : 'transparent' }}>{w}</button>
        ))}
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {(rows || []).map((r) => (
          <p key={r.id} style={{ margin: 0, padding: '4px 0', borderTop: '1px solid var(--glass-hairline)', fontSize: '0.66rem', fontFamily: 'ui-monospace, monospace', color: 'var(--ink-1)' }}>
            {new Date(r.at).toISOString().slice(5, 19).replace('T', ' ')}Z ·{' '}
            {which === 'audit' && <>{r.actor} · {r.action} · {JSON.stringify(r.detail).slice(0, 160)}</>}
            {which === 'announcements' && <>{r.warningId} · {r.kind} · {r.isTest ? 'TEST · ' : ''}{r.text}</>}
            {which === 'events' && <>{r.warningId} · {r.type}{r.from ? ` ${r.from}→${r.to}` : ''} · {r.actor} · {r.reason}</>}
          </p>
        ))}
        {!rows?.length && <p style={{ fontSize: '0.72rem', color: 'var(--ink-3)' }}>Nothing yet.</p>}
      </div>
    </div>
  );
}

export default React.memo(AiwAdminPanel);
