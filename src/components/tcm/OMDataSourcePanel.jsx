/* ════════════════════════════════════════════════════════════════════════════
   OMDataSourcePanel — Admin Settings → TCM

   Points the TCM model run at a SELF-HOSTED Open-Meteo node (e.g. a local Docker
   container at http://localhost:8080) instead of the public API. The URL is
   stored per-browser (localStorage), so ONLY this machine — the one running
   Docker — fetches from localhost when you press Run Model; every visitor just
   reads the cached run from the database. Empty = use the public Open-Meteo API.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState } from 'react';
import { Server, Save, RotateCcw, Loader2, CheckCircle2, XCircle, Cloud, HardDrive } from 'lucide-react';
import { getOmBaseUrl, setOmBaseUrl, normalizeOmBase } from '@/lib/openMeteoTCM';

const C = {
  text: '#f1f5f9', mid: '#94a3b8', faint: '#64748b',
  surface: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.09)', border2: 'rgba(255,255,255,0.16)',
  sky: '#38bdf8', green: '#22c55e', red: '#ef4444', amber: '#f59e0b', violet: '#a78bfa',
};
const FONT = "'DM Sans', system-ui, sans-serif";
const inp = { flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(2,6,15,0.6)', border: `1px solid ${C.border2}`, borderRadius: 9, color: C.text, fontSize: 13, fontFamily: 'monospace', outline: 'none' };
const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, border: `1px solid ${C.border2}`, background: 'rgba(255,255,255,0.05)', color: C.text, whiteSpace: 'nowrap' };

export default function OMDataSourcePanel() {
  const [url, setUrl] = useState(getOmBaseUrl());
  const [saved, setSaved] = useState(getOmBaseUrl());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { ok, msg }

  const active = !!saved;

  const save = () => {
    setOmBaseUrl(url);
    const now = getOmBaseUrl();
    setSaved(now); setUrl(now);
    setResult(now
      ? { ok: true, msg: `Saved — Run Model will now fetch from ${now}` }
      : { ok: true, msg: 'Cleared — using the public Open-Meteo API.' });
  };
  const clear = () => { setOmBaseUrl(''); setSaved(''); setUrl(''); setResult(null); };

  const test = async () => {
    setTesting(true); setResult(null);
    const base = normalizeOmBase(url);
    const endpoint = base ? `${base}/v1/ensemble` : 'https://ensemble-api.open-meteo.com/v1/ensemble';
    try {
      const r = await fetch(`${endpoint}?latitude=51.5085&longitude=-0.1257&hourly=cape&models=ukmo_uk_ensemble_mean_2km`);
      if (!r.ok) {
        let reason = '';
        try { const j = await r.json(); reason = j?.reason || j?.error_message || ''; }
        catch { try { reason = (await r.text()).slice(0, 240); } catch { /* ignore */ } }
        setResult({ ok: false, msg: `Server responded ${r.status}${reason ? ` — ${reason}` : ''}` });
        return;
      }
      const j = await r.json();
      const hasData = j?.hourly && Object.keys(j.hourly).some(k => k.startsWith('cape'));
      setResult(hasData
        ? { ok: true, msg: 'Connected — CAPE data received from the ukmo_uk_ensemble_mean_2km model.' }
        : { ok: false, msg: 'Reached the server, but no CAPE data came back — the model may not be synced.' });
    } catch (e) {
      setResult({ ok: false, msg: `Couldn't reach the server: ${e?.message || 'network error'}. If the box is running, this is usually CORS — the Open-Meteo API must send Access-Control-Allow-Origin.` });
    } finally {
      setTesting(false);
    }
  };

  const dirty = normalizeOmBase(url) !== saved;

  return (
    <div style={{ borderRadius: 16, border: `1px solid ${C.border}`, background: C.surface, overflow: 'hidden', fontFamily: FONT, color: C.text }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.28)' }}>
          <Server style={{ width: 16, height: 16, color: C.sky }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>TCM Data Source</p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: C.mid }}>Where <b>Run Model</b> pulls Open-Meteo ensemble data from.</p>
        </div>
        {/* Current-state chip */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 999,
          fontSize: 11, fontWeight: 800, letterSpacing: '0.03em',
          background: active ? 'rgba(167,139,250,0.14)' : 'rgba(56,189,248,0.12)',
          border: `1px solid ${active ? 'rgba(167,139,250,0.4)' : 'rgba(56,189,248,0.3)'}`,
          color: active ? C.violet : C.sky,
        }}>
          {active ? <><HardDrive style={{ width: 12, height: 12 }} /> Self-hosted</> : <><Cloud style={{ width: 12, height: 12 }} /> Public API</>}
        </span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.faint, marginBottom: 6 }}>
            Self-host base URL <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(leave blank for the public API)</span>
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:8080"
              spellCheck={false}
              style={inp}
            />
            <button type="button" onClick={test} disabled={testing} style={{ ...btn, borderColor: 'rgba(56,189,248,0.4)', color: C.sky, background: 'rgba(56,189,248,0.12)', cursor: testing ? 'wait' : 'pointer' }}>
              {testing ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 0.8s linear infinite' }} /> : <Server style={{ width: 13, height: 13 }} />}
              Test
            </button>
            <button type="button" onClick={save} disabled={!dirty} style={{ ...btn, borderColor: dirty ? 'rgba(34,197,94,0.45)' : C.border2, color: dirty ? C.green : C.faint, background: dirty ? 'rgba(34,197,94,0.12)' : 'transparent', cursor: dirty ? 'pointer' : 'default' }}>
              <Save style={{ width: 13, height: 13 }} /> Save
            </button>
            <button type="button" onClick={clear} title="Revert to the public Open-Meteo API" style={{ ...btn, background: 'transparent', color: C.mid }}>
              <RotateCcw style={{ width: 13, height: 13 }} /> Public
            </button>
          </div>
        </div>

        {result && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5,
            background: result.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${result.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: result.ok ? '#86efac' : '#fca5a5',
          }}>
            {result.ok ? <CheckCircle2 style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }} /> : <XCircle style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }} />}
            <span>{result.msg}</span>
          </div>
        )}

        {/* Notes */}
        <div style={{ fontSize: 11.5, color: C.mid, lineHeight: 1.6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
          <p style={{ margin: '0 0 5px', fontWeight: 700, color: C.text }}>How this works</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <li>Only <b>this browser</b> (the PC running Docker) uses the self-host URL — it's stored locally, not shared.</li>
            <li>Press <b>Run Model</b> on the TCM page while Docker is up; the fresh run is cached to the database for <b>every</b> visitor.</li>
            <li>If your box is off, switch back to <b>Public</b> here, or the run will fail to reach it.</li>
            <li>Requires your node to serve the 8 configured ensemble models (incl. Google WeatherNext 2 &amp; GEM) with CORS enabled.</li>
          </ul>
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
