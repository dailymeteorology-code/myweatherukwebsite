// ArchiveRunSwitcher — shows ONLY admin-saved runs (not fixed 6-hourly placeholders)
// Runs stay until manually deleted by an admin in admin settings.
// Non-existent runs are never shown — only runs with real saved data appear.

import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Loader2, CheckCircle2, AlertTriangle, Trash2, RefreshCw } from 'lucide-react';
import { loadRunFromCache, listSavedRuns, deleteRunFromCache } from '@/lib/tcmForecastCache';

function fmtRunLabel(runISO) {
  if (!runISO) return '?Z';
  try {
    const d = new Date(runISO);
    const h = d.getUTCHours().toString().padStart(2, '0');
    const date = d.toISOString().slice(0, 10);
    return `${date} ${h}Z`;
  } catch { return runISO; }
}

function fmtShortLabel(runISO) {
  if (!runISO) return '?Z';
  try {
    const d = new Date(runISO);
    const h = d.getUTCHours().toString().padStart(2, '0');
    const mn = d.toISOString().slice(5, 10).replace('-', '/');
    return `${mn} ${h}Z`;
  } catch { return runISO; }
}

function scoreToLevelLite(score) {
  if (score >= 80) return 'Severe';
  if (score >= 65) return 'High';
  if (score >= 50) return 'Moderate';
  if (score >= 35) return 'Slight';
  if (score >= 22) return 'Marginal';
  if (score >= 12) return 'Low';
  if (score >= 5) return 'Very Low';
  return 'No Risk';
}

const LEVEL_ORDER = ['No Risk', 'Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];

function compareLevels(forecast, observed) {
  const fi = LEVEL_ORDER.indexOf(forecast);
  const oi = LEVEL_ORDER.indexOf(observed);
  if (fi < 0 || oi < 0) return null;
  const diff = fi - oi;
  if (diff === 0) return { match: true, color: '#22c55e', bg: 'rgba(34,197,94,0.10)', label: 'Forecast matched observed' };
  if (Math.abs(diff) === 1) return { match: true, color: '#84cc16', bg: 'rgba(132,204,22,0.10)', label: diff > 0 ? 'Slight over-forecast (1 level)' : 'Slight under-forecast (1 level)' };
  if (diff > 0) return { match: false, color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', label: `Over-forecast by ${diff} levels` };
  return { match: false, color: '#ef4444', bg: 'rgba(239,68,68,0.10)', label: `Under-forecast by ${Math.abs(diff)} levels` };
}

export default function ArchiveRunSwitcher({
  region,
  observedLevel,
  observedScore,
  onRunChange,
  isAdmin = false,
  // Optional: if provided, only show runs for this date (YYYY-MM-DD)
  date,
}) {
  const [savedRuns, setSavedRuns] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // key to confirm delete

  const refreshList = useCallback(() => {
    const runs = listSavedRuns(region);
    // Filter to date if provided
    const filtered = date
      ? runs.filter(r => r.runISO && r.runISO.startsWith(date))
      : runs;
    setSavedRuns(filtered);
    // Auto-select newest if nothing selected or current selection gone
    if (filtered.length > 0) {
      const stillExists = filtered.find(r => r.key === selectedKey);
      if (!stillExists) {
        setSelectedKey(filtered[0].key);
      }
    } else {
      setSelectedKey(null);
      setPayload(null);
    }
  }, [region, date, selectedKey]);

  // Load run list on mount and when region/date changes
  useEffect(() => { refreshList(); }, [region, date]); // eslint-disable-line

  // Load payload when selection changes
  useEffect(() => {
    if (!selectedKey) { setPayload(null); return; }
    const entry = savedRuns.find(r => r.key === selectedKey);
    if (!entry?.runISO) { setPayload(null); return; }
    setLoading(true);
    try {
      const run = new Date(entry.runISO);
      const data = loadRunFromCache(region, run);
      setPayload(data);
      onRunChange?.(run, data);
    } catch { setPayload(null); }
    setLoading(false);
  }, [selectedKey, savedRuns, region, onRunChange]);

  const handleDelete = useCallback((key) => {
    deleteRunFromCache(key);
    if (key === selectedKey) setSelectedKey(null);
    setDeleteConfirm(null);
    refreshList();
  }, [selectedKey, refreshList]);

  const forecastLevel = payload?.summary?.[0]?.thunderstormLevel
    || payload?.summary?.[0]?.level
    || (typeof payload?.summary?.[0]?.thunderstorm === 'number'
        ? scoreToLevelLite(payload.summary[0].thunderstorm)
        : null);
  const forecastScore = payload?.summary?.[0]?.thunderstorm ?? null;
  const verdict = forecastLevel && observedLevel ? compareLevels(forecastLevel, observedLevel) : null;

  if (savedRuns.length === 0) {
    return (
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: '0.72rem' }}>
          <Clock style={{ width: 12, height: 12 }} />
          <span>No saved runs yet{date ? ` for ${date}` : ''}. Admin runs appear here after "Run Model".</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', padding: '10px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Clock style={{ width: 12, height: 12, color: '#a78bfa' }} />
        <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'Space Mono',monospace" }}>
          Saved Runs
        </span>
        <span style={{ fontSize: '0.58rem', color: '#475569', fontFamily: "'Space Mono',monospace" }}>
          {savedRuns.length} run{savedRuns.length !== 1 ? 's' : ''} stored
        </span>
        <div style={{ flex: 1 }} />
        {loading && <Loader2 className="animate-spin" style={{ width: 11, height: 11, color: '#64748b' }} />}
        <button onClick={refreshList} title="Refresh list" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2 }}>
          <RefreshCw style={{ width: 11, height: 11 }} />
        </button>
      </div>

      {/* Run pills — only existing saved runs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: payload ? 10 : 0 }}>
        {savedRuns.map(r => {
          const isActive = r.key === selectedKey;
          const ts = new Date(r.builtAt);
          return (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                onClick={() => setSelectedKey(r.key)}
                title={`Run: ${fmtRunLabel(r.runISO)} | Saved: ${ts.toLocaleString()} | ${r.gridPoints} grid pts`}
                style={{
                  padding: '6px 10px', borderRadius: 7,
                  background: isActive ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${isActive ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  color: isActive ? '#a78bfa' : '#cbd5e1',
                  fontSize: '0.68rem', fontWeight: 800,
                  fontFamily: "'Space Mono',monospace",
                  cursor: 'pointer', position: 'relative', transition: 'all 0.15s',
                }}>
                {fmtShortLabel(r.runISO)}
                <span style={{ position: 'absolute', top: 3, right: 4, width: 5, height: 5, borderRadius: '50%', background: isActive ? '#a78bfa' : '#22c55e' }} />
              </button>
              {/* Admin delete button */}
              {isAdmin && (
                deleteConfirm === r.key ? (
                  <button onClick={() => handleDelete(r.key)} title="Confirm delete" style={{ padding: '4px 7px', borderRadius: 5, background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer' }}>✓ Del?</button>
                ) : (
                  <button onClick={() => setDeleteConfirm(r.key)} title="Delete this run" style={{ padding: '4px 6px', borderRadius: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#475569', cursor: 'pointer' }}>
                    <Trash2 style={{ width: 10, height: 10 }} />
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Comparison panel */}
      {payload && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ padding: '6px 9px', borderRadius: 7, background: 'rgba(255,255,255,0.03)', border: '1px solid #38bdf830', borderLeft: '3px solid #38bdf8' }}>
              <div style={{ fontSize: '0.55rem', fontWeight: 800, color: '#38bdf8', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'Space Mono',monospace", marginBottom: 2 }}>Forecast</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f1f5f9' }}>{forecastLevel || '—'}</span>
                {typeof forecastScore === 'number' && <span style={{ fontSize: '0.66rem', color: '#64748b', fontFamily: "'Space Mono',monospace" }}>{Math.round(forecastScore)}</span>}
              </div>
            </div>
            <div style={{ padding: '6px 9px', borderRadius: 7, background: 'rgba(255,255,255,0.03)', border: '1px solid #22c55e30', borderLeft: '3px solid #22c55e' }}>
              <div style={{ fontSize: '0.55rem', fontWeight: 800, color: '#22c55e', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'Space Mono',monospace", marginBottom: 2 }}>Observed</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f1f5f9' }}>{observedLevel || '—'}</span>
                {typeof observedScore === 'number' && <span style={{ fontSize: '0.66rem', color: '#64748b', fontFamily: "'Space Mono',monospace" }}>{Math.round(observedScore)}</span>}
              </div>
            </div>
            {verdict && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 7, background: verdict.bg, border: `1px solid ${verdict.color}40` }}>
                {verdict.match ? <CheckCircle2 style={{ width: 12, height: 12, color: verdict.color }} /> : <AlertTriangle style={{ width: 12, height: 12, color: verdict.color }} />}
                <span style={{ fontSize: '0.66rem', fontWeight: 800, color: verdict.color, letterSpacing: '0.04em', fontFamily: "'Space Mono',monospace" }}>{verdict.label}</span>
              </div>
            )}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '0.62rem', color: '#475569', fontFamily: "'Space Mono',monospace" }}>
            {payload.grid?.length ?? 0} pts · saved {new Date(payload.builtAt || 0).toLocaleString()}
          </p>
        </div>
      )}

      {deleteConfirm && (
        <div style={{ marginTop: 6 }}>
          <button onClick={() => setDeleteConfirm(null)} style={{ fontSize: '0.62rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>✕ Cancel delete</button>
        </div>
      )}
    </div>
  );
}