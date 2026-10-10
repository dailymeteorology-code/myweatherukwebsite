// ── Admin-only API status + usage panel ────────────────────────────────────
// Hidden behind a collapsible admin button. Auto-ping is DISABLED on mount —
// admin must click "Ping All" explicitly. MeteoSwiss and ICON removed.
import React, { useState, useCallback } from 'react';
import { Database, RefreshCw, CheckCircle2, XCircle, Loader2, ShieldAlert, ChevronDown, ChevronUp, BarChart2, Info } from 'lucide-react';
import { getOMApiUsage } from '@/lib/openMeteoTCM';

// Only Open-Meteo ensemble models relevant to UK TCM — no MeteoSwiss, no ICON
const PROBES = [
  { name: 'Open-Meteo Ensemble (root)', url: 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=51.5&longitude=-0.1&hourly=cape&forecast_days=1&timezone=UTC' },
  { name: 'ECMWF IFS Ensemble',         url: 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=51.5&longitude=-0.1&hourly=cape&models=ecmwf_ifs025_ensemble&forecast_days=1&timezone=UTC' },
  { name: 'ECMWF AIFS Ensemble',        url: 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=51.5&longitude=-0.1&hourly=cape&models=ecmwf_aifs025_ensemble&forecast_days=1&timezone=UTC' },
  { name: 'UKMO UK 2km Ensemble',       url: 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=51.5&longitude=-0.1&hourly=cape&models=ukmo_uk_ensemble_2km&forecast_days=1&timezone=UTC' },
  { name: 'UKMO Global 20km Ensemble',  url: 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=51.5&longitude=-0.1&hourly=cape&models=ukmo_global_ensemble_20km&forecast_days=1&timezone=UTC' },
  { name: 'NCEP GEFS 0.25°',            url: 'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=51.5&longitude=-0.1&hourly=cape&models=ncep_gefs025&forecast_days=1&timezone=UTC' },
];

async function probe(p) {
  const t0 = performance.now();
  try {
    const res = await fetch(p.url, { method: 'GET' });
    const ms = Math.round(performance.now() - t0);
    return { name: p.name, ok: res.ok, status: res.status, ms };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { name: p.name, ok: false, status: 0, ms, error: String(e?.message || e) };
  }
}

const PING_CACHE_KEY = 'tcm_api_ping_cache_v2';
function loadCachedPing() {
  try { const raw = localStorage.getItem(PING_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveCachedPing(results, checkedAt) {
  try { localStorage.setItem(PING_CACHE_KEY, JSON.stringify({ results, checkedAt })); } catch {}
}

const FREE_LIMIT = 10000;

export default function TCMApiStatus({ tokens }) {
  const t = tokens;
  const cached = loadCachedPing();
  const [results, setResults] = useState(cached?.results ?? null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState(cached?.checkedAt ?? null);
  const [expanded, setExpanded] = useState(false);
  const [usage, setUsage] = useState(() => { try { return getOMApiUsage(); } catch { return {}; } });
  const [activeTab, setActiveTab] = useState('connection'); // 'connection' | 'usage'

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await Promise.all(PROBES.map(probe));
    const now = Date.now();
    setResults(r);
    setCheckedAt(now);
    saveCachedPing(r, now);
    setLoading(false);
  }, []);

  const refreshUsage = useCallback(() => {
    try { setUsage(getOMApiUsage()); } catch {}
  }, []);

  const okCount = results?.filter(r => r.ok).length ?? 0;
  const totalCount = results?.length ?? 0;
  const allOk = results && okCount === totalCount;

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayData = usage[todayKey] || { primary: 0, backup: 0, total: 0 };
  const usagePct = Math.min(100, Math.round((todayData.total / FREE_LIMIT) * 100));
  const usageDays = Object.entries(usage).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Admin-only toggle button — this is the only visible entry point */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
          borderRadius: 10, background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)', cursor: 'pointer',
          fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', width: '100%',
        }}
      >
        <ShieldAlert style={{ width: 13, height: 13 }} />
        API Status &amp; Usage
        <span style={{ fontSize: '0.58rem', padding: '1px 6px', borderRadius: 99, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>ADMIN ONLY</span>
        {results && (
          <span style={{ fontSize: '0.62rem', fontWeight: 700, color: allOk ? '#22c55e' : okCount > 0 ? '#f59e0b' : '#dc2626', padding: '1px 6px', borderRadius: 99, background: allOk ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)', border: `1px solid ${allOk ? 'rgba(34,197,94,0.30)' : 'rgba(245,158,11,0.30)'}`, fontFamily: "'DM Mono',monospace" }}>
            {okCount}/{totalCount} online
          </span>
        )}
        <span style={{ fontSize: '0.62rem', fontFamily: "'DM Mono',monospace", color: usagePct > 80 ? '#ef4444' : usagePct > 50 ? '#f59e0b' : '#22c55e', marginLeft: 4 }}>
          {usagePct}% quota
        </span>
        <div style={{ flex: 1 }} />
        {expanded ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
      </button>

      {expanded && (
        <div style={{ marginTop: 8, padding: 16, background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 14, backdropFilter: 'blur(12px)', boxShadow: t.cardShadow }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${t.cardBorder}`, paddingBottom: 10 }}>
            {[{ id: 'connection', label: 'Connection Status', icon: Database }, { id: 'usage', label: 'API Usage', icon: BarChart2 }].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, background: activeTab === tab.id ? 'rgba(56,189,248,0.18)' : 'transparent', color: activeTab === tab.id ? '#38bdf8' : t.textMuted }}>
                <tab.icon style={{ width: 12, height: 12 }} />
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'connection' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: t.textPrimary, flex: 1 }}>Open-Meteo Ensemble Endpoints</span>
                <button onClick={refresh} disabled={loading} style={{ padding: '5px 9px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700, background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.35)', color: '#38bdf8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {loading ? <Loader2 className="animate-spin" style={{ width: 11, height: 11 }} /> : <RefreshCw style={{ width: 11, height: 11 }} />} Ping All
                </button>
              </div>
              {results?.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                  {results.map(r => (
                    <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: r.ok ? 'rgba(34,197,94,0.06)' : 'rgba(220,38,38,0.06)', border: `1px solid ${r.ok ? 'rgba(34,197,94,0.25)' : 'rgba(220,38,38,0.25)'}`, borderRadius: 8 }}>
                      {r.ok ? <CheckCircle2 style={{ width: 14, height: 14, color: '#22c55e', flexShrink: 0 }} /> : <XCircle style={{ width: 14, height: 14, color: '#dc2626', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: t.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                        <div style={{ fontSize: '0.62rem', color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>{r.ok ? `${r.status} · ${r.ms} ms` : `FAIL${r.status ? ` · ${r.status}` : ''} · ${r.ms} ms`}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: t.textMuted, fontSize: '0.78rem' }}>
                  <Database style={{ width: 14, height: 14 }} /> {loading ? 'Pinging endpoints…' : 'Click "Ping All" to test API connections. Not triggered automatically.'}
                </div>
              )}
              {checkedAt && <div style={{ marginTop: 8, fontSize: '0.62rem', color: t.textMuted, fontFamily: "'DM Mono',monospace", textAlign: 'right' }}>Last check: {new Date(checkedAt).toLocaleTimeString()}</div>}
            </div>
          )}

          {activeTab === 'usage' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: t.textPrimary, flex: 1 }}>Open-Meteo API Usage <span style={{ fontSize: '0.62rem', color: t.textMuted, fontWeight: 400 }}>(local browser counts)</span></span>
                <button onClick={refreshUsage} style={{ padding: '5px 9px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700, background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.35)', color: '#38bdf8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <RefreshCw style={{ width: 11, height: 11 }} /> Refresh
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                {[{ label: "Today's Total", value: todayData.total, color: '#38bdf8' }, { label: 'Primary', value: todayData.primary || 0, color: '#22c55e' }, { label: 'Backup', value: todayData.backup || 0, color: '#f59e0b' }].map(item => (
                  <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${item.color}30`, borderLeft: `3px solid ${item.color}`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Mono',monospace", marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: item.color, fontFamily: "'DM Mono',monospace" }}>{item.value.toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: '0.7rem' }}>
                  <span style={{ color: t.textMuted }}>Free tier today</span>
                  <span style={{ color: usagePct > 80 ? '#ef4444' : usagePct > 50 ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>{todayData.total.toLocaleString()} / {FREE_LIMIT.toLocaleString()} ({usagePct}%)</span>
                </div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 99, width: `${usagePct}%`, background: usagePct > 80 ? '#ef4444' : usagePct > 50 ? '#f59e0b' : '#22c55e', transition: 'width 0.3s' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.18)', borderRadius: 8, marginBottom: 12 }}>
                <Info style={{ width: 13, height: 13, color: '#38bdf8', flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: '0.7rem', color: t.textSecondary, lineHeight: 1.5 }}>Each grid point fetch = 1 API call. UK grid at 0.20° step ≈ 3,200 calls/run. Free tier: 10,000 calls/day. Counts stored in this browser only.</span>
              </div>
              {usageDays.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>7-Day History</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {usageDays.map(([date, d]) => {
                      const p = Math.min(100, Math.round((d.total / FREE_LIMIT) * 100));
                      return (
                        <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: '0.66rem', fontFamily: "'DM Mono',monospace", color: date === todayKey ? '#38bdf8' : t.textMuted, minWidth: 80 }}>{date === todayKey ? 'Today' : date}</span>
                          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 99, width: `${p}%`, background: p > 80 ? '#ef4444' : p > 50 ? '#f59e0b' : '#22c55e' }} />
                          </div>
                          <span style={{ fontSize: '0.64rem', fontFamily: "'DM Mono',monospace", color: t.textSecondary, minWidth: 90, textAlign: 'right' }}>{d.total.toLocaleString()} ({d.primary || 0}p / {d.backup || 0}b)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {usageDays.length === 0 && <p style={{ margin: 0, fontSize: '0.75rem', color: t.textMuted, textAlign: 'center' }}>No usage data recorded in this browser yet.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}