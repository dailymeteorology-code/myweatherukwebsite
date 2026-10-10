import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, ChevronDown, CloudLightning, Loader2, RefreshCw } from 'lucide-react';
import { AutoForecastCard, ForecastEditModal } from '@/components/ForecastCardComponents';

const RISK_TYPES = [
  { id: 'thunderstorm', label: 'Thunderstorm', color: '#facc15', icon: CloudLightning },
  { id: 'tornado',      label: 'Tornado',       color: '#f97316', icon: CloudLightning },
  { id: 'hail',         label: 'Hail',           color: '#38bdf8', icon: CloudLightning },
];

function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return '148,163,184';
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',');
}

const FORECAST_OVERRIDES_KEY = 'tcm_forecast_overrides';
const AUTO_FORECAST_KEY      = 'tcm_auto_forecasts';
const FORECAST_ARCHIVE_KEY   = 'tcm_forecast_archive';

function loadForecastOverrides(){ try { return JSON.parse(localStorage.getItem(FORECAST_OVERRIDES_KEY) || '{}'); } catch (_) { return {}; } }
function saveForecastOverrides(d){ try { localStorage.setItem(FORECAST_OVERRIDES_KEY, JSON.stringify(d)); } catch (_) {} }
function loadAutoForecasts()  { try { return JSON.parse(localStorage.getItem(AUTO_FORECAST_KEY) || 'null'); } catch (_) { return null; } }
function saveAutoForecasts(d) { try { localStorage.setItem(AUTO_FORECAST_KEY, JSON.stringify(d)); } catch (_) {} }
function loadForecastArchive()  { try { return JSON.parse(localStorage.getItem(FORECAST_ARCHIVE_KEY) || '[]'); } catch (_) { return []; } }
function saveForecastArchive(d) { try { localStorage.setItem(FORECAST_ARCHIVE_KEY, JSON.stringify(d)); } catch (_) {} }
function todayDateStr() { return new Date().toISOString().slice(0,10); }

async function buildEnsembleForecasts(isEurope) {
  // Placeholder — actual impl is in TCM.jsx (imported by reference)
  throw new Error('buildEnsembleForecasts not provided');
}

function ArchivedEnsembleSection({ forecasts, overrides, isAdmin, isEurope }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 24 }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', marginBottom: open ? 12 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Archive style={{ width: 14, height: 14, color: 'rgba(148,163,184,0.4)' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Archived Ensemble Forecasts</span>
          <span style={{ fontSize: '0.68rem', padding: '1px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', color: '#475569' }}>{forecasts.length}</span>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown style={{ width: 14, height: 14, color: 'rgba(148,163,184,0.3)' }} />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {forecasts.map(fc => (
                <AutoForecastCard key={fc.date} forecast={fc} override={overrides[`${fc.type}-${fc.date}`] || null} isAdmin={isAdmin} onEdit={() => {}} riskTypes={RISK_TYPES} isEurope={isEurope} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AutoForecastPanel({ isAdmin, isEurope, buildEnsembleForecasts: buildFn }) {
  const [activeType, setActiveType]   = useState('thunderstorm');
  const [forecasts,  setForecasts]    = useState(null);
  const [loading,    setLoading]      = useState(false);
  const [error,      setError]        = useState(null);
  const [lastFetch,  setLastFetch]    = useState(null);
  const [overrides,  setOverrides]    = useState(loadForecastOverrides);
  const [editingFc,  setEditingFc]    = useState(null);
  const intervalRef = useRef(null);

  const fetchForecasts = useCallback(async (force = false) => {
    const cached = loadAutoForecasts();
    function lastBoundaryMs() {
      const now = new Date();
      const ukParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now);
      const get = (type) => parseInt(ukParts.find(p => p.type === type).value, 10);
      const ukYear = get('year'), ukMonth = get('month') - 1, ukDay = get('day'), ukHour = get('hour');
      const lastBoundary = [18, 12, 6, 0].find(h => h <= ukHour) ?? 0;
      const pad = (n) => String(n).padStart(2, '0');
      const ukBoundaryStr = `${ukYear}-${pad(ukMonth + 1)}-${pad(ukDay)}T${pad(lastBoundary)}:00:00`;
      const candidateUtc = new Date(ukBoundaryStr + 'Z');
      for (let offsetHours = -2; offsetHours <= 2; offsetHours++) {
        const trial = new Date(candidateUtc.getTime() - offsetHours * 3600000);
        const trialUkHour = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(trial), 10);
        if (trialUkHour === lastBoundary) return trial.getTime();
      }
      return candidateUtc.getTime();
    }
    if (!force && cached && cached.generatedAt && new Date(cached.generatedAt).getTime() >= lastBoundaryMs()) {
      setForecasts(cached.forecasts); setLastFetch(new Date(cached.generatedAt)); return;
    }
    setLoading(true); setError(null);
    try {
      const result = await buildFn(isEurope);
      setForecasts(result.forecasts); setLastFetch(new Date(result.generatedAt)); saveAutoForecasts(result);
      const todayKey = todayDateStr();
      const prev = loadForecastArchive();
      const updated = [{ date: todayKey, forecasts: result.forecasts, generatedAt: result.generatedAt }, ...prev.filter(e => e.date !== todayKey)].slice(0, 30);
      saveForecastArchive(updated);
    } catch (e) { setError('Unable to fetch ensemble data. ' + e.message); }
    setLoading(false);
  }, [isEurope, buildFn]);

  const fetchForecastsRef = useRef(fetchForecasts);
  useEffect(() => { fetchForecastsRef.current = fetchForecasts; }, [fetchForecasts]);

  useEffect(() => {
    fetchForecastsRef.current(false);
    function scheduleNextFetch() {
      const now = new Date();
      const ukParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now);
      const getP = (type) => parseInt(ukParts.find(p => p.type === type).value, 10);
      const ukHour = getP('hour'), ukMin = getP('minute'), ukSec = getP('second');
      const nextBoundary = [0, 6, 12, 18, 24].find(h => h > ukHour) ?? 24;
      const msUntil = (nextBoundary - ukHour) * 3600000 - ukMin * 60000 - ukSec * 1000 - (now.getTime() % 1000);
      intervalRef.current = setTimeout(() => { fetchForecastsRef.current(true); scheduleNextFetch(); }, msUntil);
    }
    scheduleNextFetch();
    return () => clearTimeout(intervalRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveOverride = (fc, overrideData) => {
    const key = `${fc.type}-${fc.date}`;
    setOverrides(prev => {
      const updated = { ...prev };
      if (overrideData === null) delete updated[key]; else updated[key] = overrideData;
      saveForecastOverrides(updated);
      return updated;
    });
  };

  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const todayStr           = todayDateStr();
  const allTypedForecasts  = forecasts?.[activeType] || [];
  const typedForecasts     = allTypedForecasts.filter(fc => fc.date >= todayStr);
  const archivedEnsemble   = allTypedForecasts.filter(fc => fc.date < todayStr);
  const currentType        = RISK_TYPES.find(t => t.id === activeType);
  const typeColor          = currentType?.color || '#facc15';
  const totalDays          = typedForecasts.length;
  const currentFc          = typedForecasts[activeDayIdx] || null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="mx-auto max-w-6xl px-6 mb-10">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: `rgba(${hexToRgb(typeColor)},0.15)`, border: `1px solid ${typeColor}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CloudLightning style={{ width: 18, height: 18, color: typeColor }} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Auto Ensemble Forecast</h2>
            <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0 }}>
              10-model ensemble · ECMWF, UKMO, ICON, GFS · updated every 6 hrs
              {lastFetch && ` · Last: ${lastFetch.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
        </div>
        <button onClick={() => fetchForecasts(true)} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: '0.71rem', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> : <RefreshCw style={{ width: 12, height: 12 }} />}
          Refresh
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {RISK_TYPES.map(rt => {
          const Icon = rt.icon;
          const active = activeType === rt.id;
          return (
            <button key={rt.id} onClick={() => { setActiveType(rt.id); setActiveDayIdx(0); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', border: `1.5px solid ${active ? rt.color : 'rgba(255,255,255,0.08)'}`, background: active ? `rgba(${hexToRgb(rt.color)},0.12)` : 'rgba(255,255,255,0.03)', color: active ? rt.color : '#64748b' }}>
              <Icon style={{ width: 13, height: 13 }} />{rt.label}
            </button>
          );
        })}
      </div>
      {loading && !forecasts && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 12 }}>
          <Loader2 style={{ width: 20, height: 20, color: typeColor, animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: '0.82rem', color: '#475569' }}>Fetching ensemble model data…</span>
        </div>
      )}
      {error && <div style={{ padding: '16px 20px', borderRadius: 14, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '0.8rem', marginBottom: 16 }}>⚠ {error}</div>}
      {!loading && !error && totalDays > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 18 }}>
          <button onClick={() => setActiveDayIdx(i => Math.max(0, i - 1))} disabled={activeDayIdx === 0} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: activeDayIdx === 0 ? 'transparent' : 'rgba(255,255,255,0.06)', color: activeDayIdx === 0 ? '#334155' : '#94a3b8', cursor: activeDayIdx === 0 ? 'default' : 'pointer', fontSize: '0.78rem' }}>← Previous</button>
          <div style={{ display: 'flex', gap: 6 }}>
            {typedForecasts.map((fc, idx) => (
              <button key={fc.date} onClick={() => setActiveDayIdx(idx)} style={{ padding: '6px 14px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${idx === activeDayIdx ? typeColor : 'rgba(255,255,255,0.08)'}`, background: idx === activeDayIdx ? `rgba(${hexToRgb(typeColor)},0.14)` : 'transparent', color: idx === activeDayIdx ? typeColor : '#475569' }}>{fc.dayLabel}</button>
            ))}
          </div>
          <button onClick={() => setActiveDayIdx(i => Math.min(totalDays - 1, i + 1))} disabled={activeDayIdx === totalDays - 1} style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: activeDayIdx === totalDays - 1 ? 'transparent' : 'rgba(255,255,255,0.06)', color: activeDayIdx === totalDays - 1 ? '#334155' : '#94a3b8', cursor: activeDayIdx === totalDays - 1 ? 'default' : 'pointer', fontSize: '0.78rem' }}>Next →</button>
        </div>
      )}
      {!loading && !error && currentFc && (
        <AnimatePresence mode="wait">
          <motion.div key={`${activeType}-${activeDayIdx}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
            <AutoForecastCard forecast={currentFc} override={overrides[`${currentFc.type}-${currentFc.date}`] || null} isAdmin={isAdmin} onEdit={setEditingFc} riskTypes={RISK_TYPES} isEurope={isEurope} />
          </motion.div>
        </AnimatePresence>
      )}
      {!loading && !error && archivedEnsemble.length > 0 && (
        <ArchivedEnsembleSection forecasts={archivedEnsemble} overrides={overrides} isAdmin={isAdmin} isEurope={isEurope} />
      )}
      <AnimatePresence>
        {editingFc && (
          <ForecastEditModal forecast={editingFc} currentOverride={overrides[`${editingFc.type}-${editingFc.date}`] || null} onSave={(data) => handleSaveOverride(editingFc, data)} onClose={() => setEditingFc(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}