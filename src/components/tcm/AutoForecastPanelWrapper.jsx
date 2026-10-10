/* AutoForecastPanel — extracted from pages/TCM */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloudLightning, Loader2, RefreshCw, Archive, ChevronDown } from 'lucide-react';
import { AutoForecastCard, ForecastEditModal } from '@/components/ForecastCardComponents';

const AUTO_FORECAST_KEY      = 'tcm_auto_forecasts';
const FORECAST_ARCHIVE_KEY   = 'tcm_forecast_archive';
const FORECAST_OVERRIDES_KEY = 'tcm_forecast_overrides';

function todayDateStr() { return new Date().toISOString().slice(0, 10); }
function loadAutoForecasts()    { try { return JSON.parse(localStorage.getItem(AUTO_FORECAST_KEY) || 'null'); } catch (_) { return null; } }
function saveAutoForecasts(d)   { try { localStorage.setItem(AUTO_FORECAST_KEY, JSON.stringify(d)); } catch (_) {} }
function loadForecastArchive()  { try { return JSON.parse(localStorage.getItem(FORECAST_ARCHIVE_KEY) || '[]'); } catch (_) { return []; } }
function saveForecastArchive(d) { try { localStorage.setItem(FORECAST_ARCHIVE_KEY, JSON.stringify(d)); } catch (_) {} }
function loadForecastOverrides(){ try { return JSON.parse(localStorage.getItem(FORECAST_OVERRIDES_KEY) || '{}'); } catch (_) { return {}; } }
function saveForecastOverrides(d){ try { localStorage.setItem(FORECAST_OVERRIDES_KEY, JSON.stringify(d)); } catch (_) {} }
function hexToRgb(hex) {
  if (!hex || hex[0] !== '#') return '148,163,184';
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',');
}

const RISK_ORDER = ['No Risk', 'Very Low', 'Low', 'Marginal', 'Moderate', 'High', 'Severe'];

const UK_GRID = [
  { lat: 51.5, lon: -0.1, name: 'London & SE England' },
  { lat: 52.5, lon: -1.8, name: 'Midlands' },
  { lat: 53.8, lon: -2.5, name: 'Northern England' },
  { lat: 55.8, lon: -4.2, name: 'Scotland' },
  { lat: 51.5, lon: -3.2, name: 'Wales' },
  { lat: 52.0, lon: -0.5, name: 'East Anglia' },
  { lat: 50.7, lon: -3.5, name: 'SW England' },
  { lat: 54.6, lon: -5.9, name: 'N Ireland' },
];
const EUROPE_GRID = [
  { lat: 51.5, lon: 0,    name: 'UK' },
  { lat: 48.8, lon: 2.3,  name: 'France' },
  { lat: 52.5, lon: 13.4, name: 'Germany' },
  { lat: 40.4, lon: -3.7, name: 'Spain' },
  { lat: 41.9, lon: 12.5, name: 'Italy' },
  { lat: 52.4, lon: 21.0, name: 'Poland' },
  { lat: 50.1, lon: 14.4, name: 'Czechia' },
  { lat: 45.8, lon: 15.9, name: 'Balkans' },
];

async function fetchEnsembleForPoint(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=cape,lifted_index,precipitation_probability,relative_humidity_2m,wind_gusts_10m` +
    `&daily=cape_max,precipitation_probability_max,wind_gusts_10m_max,wind_speed_10m_max,precipitation_sum` +
    `&timezone=Europe%2FLondon&forecast_days=3`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function aggregateHourlyByDay(data) {
  const hourly = data.hourly, daily = data.daily;
  if (!hourly || !daily) return null;
  const nDays = daily.time.length, results = [];
  for (let d = 0; d < nDays; d++) {
    const s = d * 24, e = Math.min(s + 24, hourly.time.length);
    const capeV = [], liV = [], rhV = [], ppV = [], gustV = [];
    for (let h = s; h < e; h++) {
      if (hourly.cape?.[h] != null) capeV.push(hourly.cape[h]);
      if (hourly.lifted_index?.[h] != null) liV.push(hourly.lifted_index[h]);
      if (hourly.relative_humidity_2m?.[h] != null) rhV.push(hourly.relative_humidity_2m[h]);
      if (hourly.precipitation_probability?.[h] != null) ppV.push(hourly.precipitation_probability[h]);
      if (hourly.wind_gusts_10m?.[h] != null) gustV.push(hourly.wind_gusts_10m[h]);
    }
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const max = a => a.length ? Math.max(...a) : 0;
    results.push({
      date: daily.time[d],
      capeMax: daily.cape_max?.[d] ?? max(capeV),
      capeAvg: avg(capeV),
      liMin:   liV.length ? Math.min(...liV) : 5,
      rhAvg:   avg(rhV),
      ppMax:   daily.precipitation_probability_max?.[d] ?? max(ppV),
      gustMax: daily.wind_gusts_10m_max?.[d] ?? max(gustV),
    });
  }
  return results;
}
function computeRiskFromMetrics({ capeMax, capeAvg, liMin, rhAvg, ppMax, gustMax }, type) {
  let score = 0;
  if      (capeMax >= 2000) score += 45;
  else if (capeMax >= 1000) score += 35;
  else if (capeMax >= 500)  score += 25;
  else if (capeMax >= 200)  score += 15;
  else if (capeMax >= 50)   score += 7;
  else if (capeAvg >= 20)   score += 3;
  if      (liMin <= -8) score += 25;
  else if (liMin <= -6) score += 20;
  else if (liMin <= -4) score += 14;
  else if (liMin <= -2) score += 8;
  else if (liMin <= 0)  score += 3;
  if      (rhAvg >= 85) score += 15;
  else if (rhAvg >= 75) score += 10;
  else if (rhAvg >= 65) score += 6;
  else if (rhAvg >= 55) score += 2;
  if      (ppMax >= 80) score += 10;
  else if (ppMax >= 60) score += 7;
  else if (ppMax >= 40) score += 4;
  else if (ppMax >= 20) score += 1;
  if      (gustMax >= 80) score += 5;
  else if (gustMax >= 60) score += 3;
  else if (gustMax >= 45) score += 1;
  if (type === 'hail')    { if (capeMax < 500 || gustMax < 40) score = Math.max(0, score - 20); if (capeMax >= 1500 && gustMax >= 60) score += 10; }
  else if (type === 'tornado') { score = Math.max(0, score - 35); if (capeMax >= 1000 && liMin <= -6 && gustMax >= 70) score += 15; }
  else if (type === 'lightning') { if (capeMax >= 300 && rhAvg >= 60) score += 5; }
  score = Math.max(0, Math.min(100, score));
  if (score >= 90) return 'Severe';
  if (score >= 75) return 'High';
  if (score >= 55) return 'Moderate';
  if (score >= 38) return 'Marginal';
  if (score >= 22) return 'Low';
  if (score >= 10) return 'Very Low';
  return 'No Risk';
}
async function buildEnsembleForecasts(useEurope, RISK_TYPES) {
  const grid = useEurope ? EUROPE_GRID : UK_GRID;
  const results = await Promise.allSettled(grid.map(pt => fetchEnsembleForPoint(pt.lat, pt.lon)));
  const pointData = results.map((r, i) => ({
    point: grid[i],
    days:  r.status === 'fulfilled' ? aggregateHourlyByDay(r.value) : null,
  })).filter(p => p.days && p.days.length > 0);
  if (!pointData.length) throw new Error('No forecast data available');
  const nDays = pointData[0].days.length;
  const forecasts = {};
  RISK_TYPES.forEach(({ id: type }) => {
    forecasts[type] = Array.from({ length: nDays }, (_, dayIdx) => {
      const regionRisks = {};
      let sumCape = 0, sumRH = 0, count = 0;
      pointData.forEach(({ point, days }) => {
        const d = days[dayIdx];
        if (!d) return;
        sumCape += d.capeMax; sumRH += d.rhAvg; count++;
        regionRisks[point.name] = computeRiskFromMetrics(d, type);
      });
      const avgCape = count ? sumCape / count : 0;
      const avgRH   = count ? sumRH   / count : 60;
      const sampleDay = pointData[0].days[dayIdx];
      const overallRisk = computeRiskFromMetrics(
        { capeMax: avgCape, capeAvg: avgCape * 0.6, liMin: sampleDay?.liMin ?? 5, rhAvg: avgRH, ppMax: sampleDay?.ppMax ?? 0, gustMax: sampleDay?.gustMax ?? 0 },
        type
      );
      const sortedRisks = [...new Set(Object.values(regionRisks))].sort((a, b) => RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b));
      const dateStr  = pointData[0].days[dayIdx].date;
      const dayLabel = dayIdx === 0 ? 'Today' : dayIdx === 1 ? 'Tomorrow' : 'Day 3';
      const formattedDate = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      return {
        date: dateStr, dayLabel, formattedDate, type,
        riskLevel: overallRisk,
        minRisk: sortedRisks[0] || 'No Risk',
        maxRisk: sortedRisks[sortedRisks.length - 1] || 'No Risk',
        avgCape: Math.round(avgCape), avgRH: Math.round(avgRH),
        regionRisks, generatedAt: new Date().toISOString(),
      };
    });
  });
  return { forecasts, generatedAt: new Date().toISOString() };
}

function ArchivedEnsembleSection({ forecasts, overrides, isAdmin, isEurope, RISK_TYPES }) {
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

export default function AutoForecastPanel({ isAdmin, isEurope, RISK_TYPES }) {
  const [activeType, setActiveType] = useState('thunderstorm');
  const [forecasts,  setForecasts]  = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [lastFetch,  setLastFetch]  = useState(null);
  const [overrides,  setOverrides]  = useState(loadForecastOverrides);
  const [editingFc,  setEditingFc]  = useState(null);
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
      const result = await buildEnsembleForecasts(isEurope, RISK_TYPES);
      setForecasts(result.forecasts); setLastFetch(new Date(result.generatedAt)); saveAutoForecasts(result);
      const todayKey = todayDateStr();
      const prev = loadForecastArchive();
      const updated = [{ date: todayKey, forecasts: result.forecasts, generatedAt: result.generatedAt }, ...prev.filter(e => e.date !== todayKey)].slice(0, 30);
      saveForecastArchive(updated);
    } catch (e) { setError('Unable to fetch ensemble data. ' + e.message); }
    setLoading(false);
  }, [isEurope, RISK_TYPES]);

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
  }, []); // eslint-disable-line

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
  const todayStr          = todayDateStr();
  const allTypedForecasts = forecasts?.[activeType] || [];
  const typedForecasts    = allTypedForecasts.filter(fc => fc.date >= todayStr);
  const archivedEnsemble  = allTypedForecasts.filter(fc => fc.date < todayStr);
  const currentType       = RISK_TYPES.find(t => t.id === activeType);
  const typeColor         = currentType?.color || '#facc15';
  const totalDays         = typedForecasts.length;
  const currentFc         = typedForecasts[activeDayIdx] || null;

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
          const Icon = rt.icon; const active = activeType === rt.id;
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
              <button key={fc.date} onClick={() => setActiveDayIdx(idx)} style={{ padding: '6px 14px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${idx === activeDayIdx ? typeColor : 'rgba(255,255,255,0.08)'}`, background: idx === activeDayIdx ? `rgba(${hexToRgb(typeColor)},0.14)` : 'transparent', color: idx === activeDayIdx ? typeColor : '#475569' }}>
                {fc.dayLabel}
              </button>
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
        <ArchivedEnsembleSection forecasts={archivedEnsemble} overrides={overrides} isAdmin={isAdmin} isEurope={isEurope} RISK_TYPES={RISK_TYPES} />
      )}
      <AnimatePresence>
        {editingFc && (
          <ForecastEditModal forecast={editingFc} currentOverride={overrides[`${editingFc.type}-${editingFc.date}`] || null} onSave={(data) => handleSaveOverride(editingFc, data)} onClose={() => setEditingFc(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}