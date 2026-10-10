import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Activity } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * DataProviderStatusBar
 * ─────────────────────────────────────────────────────────────
 * Compact, always-visible health bar showing which weather data
 * providers are responding. Click to expand for per-provider detail.
 *
 * Probes (all run client-side except Met Office which goes via our
 * backend function so the API key never leaves the server):
 *   • Open-Meteo Forecast   — drives ensemble/convective math
 *   • Open-Meteo Historical — past-day archives
 *   • Met Office Atmos      — UKV / MOGREPS-UK / Global 10km runs
 *   • Blitzortung WS gate   — quick reachability check
 *   • RainViewer            — radar tile manifest
 *   • Country outlines CDN  — map base layer
 */

const PROVIDERS = [
  {
    id: 'om-forecast',
    label: 'Open-Meteo (Forecast)',
    probe: async () => {
      const t0 = performance.now();
      const r = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=51&longitude=0&hourly=cape&models=ukmo_seamless&forecast_days=1',
        { signal: AbortSignal.timeout(8000) }
      );
      return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0) };
    },
  },
  {
    id: 'om-historical',
    label: 'Open-Meteo (Historical)',
    probe: async () => {
      const t0 = performance.now();
      const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
      const r = await fetch(
        `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=51&longitude=0&hourly=cape&start_date=${y}&end_date=${y}`,
        { signal: AbortSignal.timeout(8000) }
      );
      return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0) };
    },
  },
  {
    id: 'metoffice-atmos',
    label: 'Met Office (UKV / MOGREPS)',
    probe: async () => {
      const t0 = performance.now();
      try {
        const res = await base44.functions.invoke('getMetOfficeAtmospheric', { action: 'runs' });
        const ms = Math.round(performance.now() - t0);
        const ok = !!res?.data?.ok;
        return { ok, status: res?.data?.status ?? (ok ? 200 : 'ERR'), ms };
      } catch (e) {
        return { ok: false, status: 'ERR', ms: Math.round(performance.now() - t0) };
      }
    },
  },
  {
    id: 'rainviewer',
    label: 'RainViewer Radar',
    probe: async () => {
      const t0 = performance.now();
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
        signal: AbortSignal.timeout(6000),
      });
      return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0) };
    },
  },
  {
    id: 'outlines',
    label: 'Country Outlines (CDN)',
    probe: async () => {
      const t0 = performance.now();
      const r = await fetch(
        'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
        { method: 'HEAD', signal: AbortSignal.timeout(6000) }
      );
      return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0) };
    },
  },
];

export default function DataProviderStatusBar({ lightMode = false }) {
  const [statuses, setStatuses] = useState({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const runAll = async () => {
      // Mark loading
      if (!cancelled) {
        setStatuses((prev) => {
          const next = { ...prev };
          PROVIDERS.forEach((p) => { next[p.id] = { ...(prev[p.id] || {}), loading: true }; });
          return next;
        });
      }
      await Promise.all(
        PROVIDERS.map(async (p) => {
          let res;
          try { res = await p.probe(); }
          catch (e) { res = { ok: false, status: 'ERR', ms: 0 }; }
          if (!cancelled) setStatuses((s) => ({ ...s, [p.id]: res }));
        })
      );
    };
    runAll();
    const id = setInterval(runAll, 90_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const entries = PROVIDERS.map((p) => [p, statuses[p.id]]);
  const total = entries.length;
  const upCount = entries.filter(([, s]) => s && !s.loading && s.ok).length;
  const downCount = entries.filter(([, s]) => s && !s.loading && !s.ok).length;
  const anyLoading = entries.some(([, s]) => s?.loading);

  const overall = downCount > 0 ? 'degraded' : (anyLoading || upCount < total ? 'probing' : 'ok');
  const overallColor = overall === 'ok' ? '#22c55e' : overall === 'degraded' ? '#ef4444' : '#facc15';
  const overallLabel =
    overall === 'ok' ? 'All providers operational'
    : overall === 'degraded' ? `${downCount} provider${downCount > 1 ? 's' : ''} unreachable`
    : 'Probing providers…';

  const tone = lightMode
    ? { bg: 'rgba(255,255,255,0.92)', border: 'rgba(15,23,42,0.10)', text: '#0f172a', sub: '#475569', faint: '#94a3b8', rule: 'rgba(15,23,42,0.07)', rowBg: 'rgba(15,23,42,0.03)' }
    : { bg: 'rgba(15,23,42,0.78)', border: 'rgba(255,255,255,0.08)', text: '#f1f5f9', sub: '#cbd5e1', faint: '#64748b', rule: 'rgba(255,255,255,0.06)', rowBg: 'rgba(255,255,255,0.03)' };

  return (
    <div style={{
      maxWidth: 1200, margin: '0 auto 16px', padding: '0 16px', position: 'relative', zIndex: 30,
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 12,
          background: tone.bg, backdropFilter: 'blur(12px)',
          border: `1px solid ${overall === 'degraded' ? 'rgba(239,68,68,0.4)' : tone.border}`,
          color: tone.text, cursor: 'pointer', textAlign: 'left',
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
      >
        <Activity style={{ width: 14, height: 14, color: overallColor, flexShrink: 0 }} />
        <span style={{
          width: 8, height: 8, borderRadius: 99, background: overallColor,
          boxShadow: `0 0 6px ${overallColor}`,
          animation: overall === 'probing' ? 'pulse 1.4s ease-in-out infinite' : 'none',
        }} />
        <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>Data providers</span>
        <span style={{ fontSize: '0.7rem', color: tone.sub }}>{overallLabel}</span>
        <span style={{
          marginLeft: 'auto', fontSize: '0.62rem', fontWeight: 700,
          padding: '2px 8px', borderRadius: 99,
          background: overall === 'ok' ? 'rgba(34,197,94,0.12)' : overall === 'degraded' ? 'rgba(239,68,68,0.12)' : 'rgba(250,204,21,0.12)',
          color: overallColor, letterSpacing: '0.08em', textTransform: 'uppercase',
          fontFamily: "'DM Mono', monospace",
        }}>
          {upCount}/{total} up
        </span>
        <ChevronDown style={{
          width: 14, height: 14, color: tone.faint, transition: 'transform .2s',
          transform: open ? 'rotate(180deg)' : 'none',
        }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              marginTop: 6, padding: '10px 12px',
              borderRadius: 12, background: tone.bg,
              border: `1px solid ${tone.border}`, backdropFilter: 'blur(12px)',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6,
            }}>
              {entries.map(([p, s]) => {
                const ok = s?.ok;
                const loading = s?.loading;
                const dot = loading ? tone.faint : ok ? '#22c55e' : '#ef4444';
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 9,
                    background: tone.rowBg, border: `1px solid ${tone.rule}`,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 99, background: dot, flexShrink: 0,
                      boxShadow: `0 0 5px ${dot}`,
                      animation: loading ? 'pulse 1.4s ease-in-out infinite' : 'none',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.72rem', fontWeight: 700, color: tone.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{p.label}</div>
                      <div style={{
                        fontSize: '0.6rem', color: tone.faint, fontFamily: "'DM Mono', monospace",
                      }}>
                        {loading ? 'probing…' : `${s?.status ?? '—'} · ${s?.ms ?? 0} ms`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );
}