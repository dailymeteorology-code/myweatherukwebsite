import React, { useState, useEffect, useCallback } from 'react';
import { Radio, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Copy, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const C = {
  surface: '#0c1422', surface2: '#101c2e', surface3: '#142030',
  border: 'rgba(148,163,184,0.12)', sky: '#38bdf8', green: '#4ade80',
  amber: '#fbbf24', red: '#f87171', text: '#f1f5f9', textMid: '#94a3b8',
  textFaint: 'rgba(148,163,184,0.4)',
};

const INGEST_URL = `https://base44.app/api/apps/${base44.getConfig?.().appId || ''}/functions/ingestRelayStrikes`;

/**
 * RelayStatusPanel
 * Confirms the always-on 24/7 lightning relay is delivering strikes by reading
 * recently-saved LightningStrike records straight from the database.
 */
export default function RelayStatusPanel() {
  const [loading, setLoading] = useState(true);
  const [lastStrikeTime, setLastStrikeTime] = useState(null);
  const [lastHourCount, setLastHourCount] = useState(0);
  const [last5mCount, setLast5mCount] = useState(0);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nowMs = Date.now();
      const hourAgo = nowMs - 60 * 60 * 1000;
      const fiveMinAgo = nowMs - 5 * 60 * 1000;
      // Pull the most recent strikes (sorted newest first) and tally windows.
      const recent = await base44.entities.LightningStrike.filter(
        { time: { $gte: hourAgo } }, '-time', 5000
      ).catch(() => []);
      setLastStrikeTime(recent.length ? recent[0].time : null);
      setLastHourCount(recent.length);
      setLast5mCount(recent.filter(s => s.time >= fiveMinAgo).length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000); // refresh once a minute
    return () => clearInterval(id);
  }, [load]);

  // "Healthy" = a strike landed in the last 10 minutes.
  const minutesSince = lastStrikeTime ? Math.floor((Date.now() - lastStrikeTime) / 60000) : null;
  const healthy = minutesSince !== null && minutesSince <= 10;
  const statusColor = healthy ? C.green : (minutesSince === null ? C.textFaint : C.amber);

  const copyUrl = () => {
    navigator.clipboard?.writeText(INGEST_URL).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden' }}>
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${statusColor}50, transparent)` }} />
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `${statusColor}14`, border: `1px solid ${statusColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Radio style={{ width: 17, height: 17, color: statusColor }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>24/7 Lightning Relay</h3>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, letterSpacing: '0.06em', textTransform: 'uppercase', background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                {healthy ? 'Receiving' : minutesSince === null ? 'No data yet' : 'Quiet'}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textMid }}>Strikes posted by the external always-on relay</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', background: `${C.sky}12`, border: `1px solid ${C.sky}30`, color: C.sky }}>
          {loading ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 0.8s linear infinite' }} /> : <RefreshCw style={{ width: 13, height: 13 }} />}
          Refresh
        </button>
      </div>

      <div style={{ padding: '22px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { label: 'Last 5 min', value: loading ? '…' : last5mCount.toLocaleString(), color: C.sky },
            { label: 'Last hour', value: loading ? '…' : lastHourCount.toLocaleString(), color: C.green },
            { label: 'Last strike', value: loading ? '…' : (minutesSince === null ? '—' : minutesSince === 0 ? 'just now' : `${minutesSince} min ago`), color: statusColor },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '14px 16px', borderRadius: 12, background: C.surface2, border: `1px solid ${C.border}` }}>
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: C.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{stat.label}</p>
              <p style={{ margin: '6px 0 0', fontSize: 19, fontWeight: 800, color: stat.color, letterSpacing: '-0.02em' }}>{stat.value}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, padding: '12px 16px', borderRadius: 10, background: healthy ? `${C.green}0c` : `${C.amber}0c`, border: `1px solid ${healthy ? C.green : C.amber}28`, display: 'flex', gap: 10 }}>
          {healthy
            ? <CheckCircle2 style={{ width: 14, height: 14, color: C.green, flexShrink: 0, marginTop: 1 }} />
            : <AlertTriangle style={{ width: 14, height: 14, color: C.amber, flexShrink: 0, marginTop: 1 }} />}
          <p style={{ margin: 0, fontSize: 12, color: healthy ? C.green : C.amber, lineHeight: 1.6 }}>
            {healthy
              ? 'The relay is connected and delivering strikes in real time.'
              : 'No strikes received in the last 10 minutes. This is normal during calm weather — if it persists during active storms, check the relay host\u2019s logs (deploy steps are in the relay/README.md file).'}
          </p>
        </div>

        <div style={{ marginTop: 14 }}>
          <p style={{ margin: '0 0 6px', fontSize: 10.5, fontWeight: 700, color: C.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Relay ingest URL</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 9, background: C.surface3, border: `1px solid ${C.border}`, color: C.textMid, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{INGEST_URL}</code>
            <button onClick={copyUrl}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: copied ? `${C.green}14` : C.surface3, border: `1px solid ${copied ? C.green + '40' : C.border}`, color: copied ? C.green : C.textMid }}>
              {copied ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: C.textFaint, lineHeight: 1.6 }}>
            Set this as the relay\u2019s <strong>INGEST_URL</strong> and your secret as <strong>RELAY_SECRET</strong> when deploying it (see the relay/README.md file).
          </p>
        </div>
      </div>
    </div>
  );
}