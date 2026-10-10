import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Radio, Zap, Loader2 } from 'lucide-react';
import TCMLeafletBase from '@/components/tcm/TCMLeafletBase';
import useBlitzortung from '@/components/tcm/useBlitzortung';

/* ─────────────────────────────────────────────────────────────────────────
   MyWeather Lightning Verification — compact live strike map for Graphics
   - Uses Blitzortung WebSocket via the shared useBlitzortung hook
   - Persists today's strikes in localStorage (shared key with TCM page)
   - UK & Ireland bbox only; minimal UI for Graphics page embed
   ───────────────────────────────────────────────────────────────────────── */

const UK_BBOX = { lonMin: -10.5, lonMax: 2.0, latMin: 50.0, latMax: 60.5 };
const STRIKE_CACHE_KEY = 'tcm_today_strikes'; // shared key with TCM.jsx and TCMLightningVerification

function loadTodayStrikes(bbox) {
  try {
    const raw = localStorage.getItem(STRIKE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (parsed.date !== today) return [];
    const strikes = parsed.strikes || [];
    return strikes.filter(
      (s) =>
        s.lat >= bbox.latMin &&
        s.lat <= bbox.latMax &&
        s.lon >= bbox.lonMin &&
        s.lon <= bbox.lonMax
    );
  } catch {
    return [];
  }
}

function saveTodayStrikes(strikes) {
  try {
    const cutoff24h = Date.now() - 25 * 60 * 60 * 1000;
    const toSave = strikes.filter(s => s && s.time && s.time > cutoff24h).slice(-10000);
    // Store as plain array — compatible with strikeStorage.jsx and TCMLightningVerification
    localStorage.setItem(STRIKE_CACHE_KEY, JSON.stringify(toSave));
  } catch {}
}

export default function MyWeatherLightningVerification() {
  const [strikes, setStrikes] = useState(() => loadTodayStrikes(UK_BBOX));
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState('idle');
  const freshRef = useRef(new Set());
  const [, setTick] = useState(0);

  const onStrike = useCallback((s) => {
    freshRef.current.add(s.time);
    setTimeout(() => freshRef.current.delete(s.time), 90_000);
    setStrikes((prev) => {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const next = [...prev.filter((x) => x.time >= todayStart.getTime()), s].slice(-5000);
      saveTodayStrikes(next);
      return next;
    });
  }, []);

  useBlitzortung({ enabled: live, bbox: UK_BBOX, onStrike, onStatus: setStatus });

  // Re-render once per second so strike age/opacity smoothly fades
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(() => {
    const now = Date.now();
    const last30 = strikes.filter((s) => now - s.time < 30 * 60 * 1000);
    const last60 = strikes.filter((s) => now - s.time < 60 * 60 * 1000);
    return {
      total: strikes.length,
      last30: last30.length,
      last60: last60.length,
    };
  }, [strikes]);

  const statusColor = {
    live: '#22c55e',
    connecting: '#eab308',
    reconnecting: '#eab308',
    error: '#dc2626',
    disabled: '#64748b',
    idle: '#64748b',
  }[status] || '#64748b';

  const mapHeight = typeof window !== 'undefined' && window.innerWidth < 640 ? 320 : 460;

  return (
    <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-yellow-50/60 to-amber-50/40 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-yellow-100 border border-yellow-200 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4.5 h-4.5 text-yellow-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800">Lightning Verification</p>
          <p className="text-[11px] text-slate-500">Live strikes — UK &amp; Ireland · Blitzortung</p>
        </div>

        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider font-mono"
          style={{ color: statusColor }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
          />
          {status}
        </span>

        <button
          onClick={() => setLive((l) => !l)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
            live
              ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
              : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
          }`}
        >
          <Radio className="w-3 h-3" />
          {live ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {/* Map */}
      <div className="relative">
        <TCMLeafletBase bbox={UK_BBOX} height={mapHeight} lightMode={true}>
          {({ projector }) => {
            if (!projector) return null;
            const { x: w, y: h } = projector.size;
            const now = Date.now();
            return (
              <svg
                width={w}
                height={h}
                viewBox={`0 0 ${w} ${h}`}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}
              >
                {strikes.map((s, i) => {
                  const [x, y] = projector.project(s.lat, s.lon);
                  const isFresh = freshRef.current.has(s.time);
                  return (
                    <g
                      key={`${s.time}_${i}`}
                      opacity={1}
                      transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
                    >
                      {isFresh && (
                        <circle r={2} fill="none" stroke="#ffffff" strokeWidth={1.4}>
                          <animate attributeName="r" from="2" to="22" dur="0.8s" fill="freeze" />
                          <animate
                            attributeName="opacity"
                            from="0.9"
                            to="0"
                            dur="0.8s"
                            fill="freeze"
                          />
                        </circle>
                      )}
                      <circle r={4.5} fill="#ffffff" opacity={0.85} />
                      <circle r={2} fill="#fde047" opacity={0.75} />
                    </g>
                  );
                })}
                {strikes.length === 0 && status !== 'live' && (
                  <text
                    x={w / 2}
                    y={h / 2}
                    textAnchor="middle"
                    fontSize={13}
                    fontWeight={600}
                    fill="rgba(0,0,0,0.30)"
                    fontFamily="DM Sans,system-ui,sans-serif"
                  >
                    {status === 'connecting' || status === 'reconnecting'
                      ? 'Connecting to lightning feed…'
                      : 'No strikes detected yet today'}
                  </text>
                )}
              </svg>
            );
          }}
        </TCMLeafletBase>

        {status === 'connecting' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-white/90 border border-slate-200 rounded-full px-3 py-1 flex items-center gap-2 shadow-sm">
            <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
            <span className="text-[11px] font-medium text-slate-600">Connecting…</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50/50">
        {[
          { label: 'Today', value: stats.total, color: '#eab308' },
          { label: 'Last 60 min', value: stats.last60, color: '#f97316' },
          { label: 'Last 30 min', value: stats.last30, color: '#dc2626' },
        ].map((p) => (
          <div key={p.label} className="text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
              {p.label}
            </div>
            <div
              className="text-lg font-extrabold font-mono mt-0.5"
              style={{ color: p.value > 0 ? p.color : '#94a3b8' }}
            >
              {p.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}