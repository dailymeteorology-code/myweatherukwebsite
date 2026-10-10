// Admin-only panel showing Open-Meteo API usage counts
// Open-Meteo counts each coordinate fetch as 1 API call.
// Primary = ensemble-api.open-meteo.com, Backup = api.open-meteo.com

import React, { useState, useEffect } from 'react';
import { BarChart2, RefreshCw, Info } from 'lucide-react';
import { getOMApiUsage } from '@/lib/openMeteoTCM';

export default function OMApiUsagePanel({ tokens: t }) {
  const [usage, setUsage] = useState({});

  useEffect(() => {
    setUsage(getOMApiUsage());
  }, []);

  const refresh = () => setUsage(getOMApiUsage());

  const days = Object.entries(usage)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 7);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayData = usage[todayKey] || { primary: 0, backup: 0, total: 0 };

  // Open-Meteo free tier: 10,000 calls/day
  const FREE_LIMIT = 10000;
  const pct = Math.min(100, Math.round((todayData.total / FREE_LIMIT) * 100));

  return (
    <div style={{
      background: t?.cardBg || 'rgba(15,23,42,0.7)',
      border: `1px solid ${t?.cardBorder || 'rgba(255,255,255,0.08)'}`,
      borderRadius: 14,
      padding: 18,
      marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <BarChart2 style={{ width: 16, height: 16, color: '#38bdf8' }} />
        <span style={{ fontSize: '0.88rem', fontWeight: 700, color: t?.textPrimary || '#f1f5f9' }}>
          Open-Meteo API Usage
        </span>
        <span style={{ fontSize: '0.68rem', color: t?.textMuted || '#64748b', fontFamily: "'DM Mono',monospace" }}>
          (admin only · local browser counts)
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={refresh} style={{
          padding: '4px 10px', borderRadius: 8, background: 'rgba(56,189,248,0.10)',
          border: '1px solid rgba(56,189,248,0.30)', color: '#38bdf8',
          fontSize: '0.7rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer'
        }}>
          <RefreshCw style={{ width: 11, height: 11 }} /> Refresh
        </button>
      </div>

      {/* Today summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: "Today's Total", value: todayData.total, color: '#38bdf8' },
          { label: 'Primary (Ensemble)', value: todayData.primary || 0, color: '#22c55e' },
          { label: 'Backup (Forecast)', value: todayData.backup || 0, color: '#f59e0b' },
        ].map(item => (
          <div key={item.label} style={{
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${item.color}30`,
            borderLeft: `3px solid ${item.color}`,
            borderRadius: 10, padding: '10px 12px', textAlign: 'center'
          }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: t?.textMuted || '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Mono',monospace", marginBottom: 4 }}>
              {item.label}
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: item.color, fontFamily: "'DM Mono',monospace" }}>
              {item.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Free tier usage bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: '0.7rem', fontFamily: "'DM Mono',monospace' " }}>
          <span style={{ color: t?.textMuted || '#64748b' }}>Free tier usage today</span>
          <span style={{ color: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>
            {todayData.total.toLocaleString()} / {FREE_LIMIT.toLocaleString()} ({pct}%)
          </span>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 99,
            width: `${pct}%`,
            background: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e',
            transition: 'width 0.3s'
          }} />
        </div>
      </div>

      {/* Note about how OM counts */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.18)', borderRadius: 8, marginBottom: 14 }}>
        <Info style={{ width: 13, height: 13, color: '#38bdf8', flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: '0.7rem', color: t?.textSecondary || '#94a3b8', lineHeight: 1.5 }}>
          Open-Meteo counts each grid point fetch as 1 API call. A full UK grid (0.20° step) = ~3,200 calls per run.
          Primary = ensemble API, Backup = standard forecast API. Free tier: 10,000 calls/day.
          These counts are stored in this browser only.
        </span>
      </div>

      {/* 7-day history */}
      {days.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: t?.textMuted || '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>
            7-Day History
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {days.map(([date, d]) => {
              const isToday = date === todayKey;
              const dayPct = Math.min(100, Math.round((d.total / FREE_LIMIT) * 100));
              return (
                <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '0.68rem', fontFamily: "'DM Mono',monospace", color: isToday ? '#38bdf8' : t?.textMuted || '#64748b', minWidth: 80 }}>
                    {isToday ? 'Today' : date}
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 99,
                      width: `${dayPct}%`,
                      background: dayPct > 80 ? '#ef4444' : dayPct > 50 ? '#f59e0b' : '#22c55e',
                    }} />
                  </div>
                  <span style={{ fontSize: '0.66rem', fontFamily: "'DM Mono',monospace", color: t?.textSecondary || '#94a3b8', minWidth: 90, textAlign: 'right' }}>
                    {d.total.toLocaleString()} ({d.primary || 0}p / {d.backup || 0}b)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {days.length === 0 && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: t?.textMuted || '#64748b', textAlign: 'center' }}>
          No usage data recorded yet in this browser.
        </p>
      )}
    </div>
  );
}