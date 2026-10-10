import React, { useEffect, useRef } from 'react';
import { Play, Pause } from 'lucide-react';
import { SEV, SEV_ORDER } from './aiwClient';

const STEPS = [0, 5, 10, 15, 20, 25, 30];

/**
 * Forecast-time slider: NOW, +5 … +30 min, with play/pause.
 *
 * Whenever it is off NOW, a banner on the map says plainly that what is shown
 * is a FORECAST for that time and not an observation, with the clock time it
 * corresponds to. Animation respects prefers-reduced-motion (it steps without
 * auto-playing) and stops at +30 rather than looping endlessly.
 */
export function ForecastSlider({ lead, setLead, playing, setPlaying, lightMode, now = Date.now() }) {
  const timer = useRef(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setInterval(() => {
      setLead((l) => {
        const i = STEPS.indexOf(l);
        if (i >= STEPS.length - 1) { setPlaying(false); return l; }
        return STEPS[i + 1];
      });
    }, reduced ? 1600 : 900);
    return () => clearInterval(timer.current);
  }, [playing, setLead, setPlaying, reduced]);

  const idx = Math.max(0, STEPS.indexOf(lead));
  const at = new Date(now + lead * 60e3).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="aiw-slider" role="group" aria-label="Forecast time"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 11px', borderRadius: 14,
        background: 'var(--glass-fill-strong)', border: '1px solid var(--glass-hairline)',
        backdropFilter: 'blur(18px) saturate(180%)', WebkitBackdropFilter: 'blur(18px) saturate(180%)',
        boxShadow: 'var(--glass-shadow)', minWidth: 0,
      }}>
      <button type="button"
        onClick={() => { if (!playing && lead === 30) setLead(0); setPlaying(!playing); }}
        aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'}
        style={{
          width: 30, height: 30, borderRadius: 9, flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--glass-fill)', border: '1px solid var(--glass-hairline)', color: 'var(--ink-1)',
        }}>
        {playing ? <Pause style={{ width: 14, height: 14 }} /> : <Play style={{ width: 14, height: 14 }} />}
      </button>
      <div style={{ flex: 1, minWidth: 150 }}>
        <input type="range" min={0} max={STEPS.length - 1} step={1} value={idx}
          onChange={(e) => { setPlaying(false); setLead(STEPS[Number(e.target.value)]); }}
          aria-valuetext={lead === 0 ? 'Now' : `Forecast plus ${lead} minutes`}
          style={{ width: '100%', accentColor: lead === 0 ? '#38bdf8' : '#FF9800', cursor: 'pointer' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }} aria-hidden="true">
          {STEPS.map((s) => (
            <button key={s} type="button" tabIndex={-1} onClick={() => { setPlaying(false); setLead(s); }}
              style={{
                fontSize: '0.56rem', fontWeight: s === lead ? 800 : 600, fontFamily: 'ui-monospace, monospace',
                color: s === lead ? 'var(--ink-1)' : 'var(--ink-3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              }}>{s === 0 ? 'NOW' : `+${s}`}</button>
          ))}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 74 }} aria-live="polite">
        <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.04em', color: lead === 0 ? (lightMode ? '#0369a1' : '#38bdf8') : (lightMode ? '#B05E00' : '#FF9800') }}>
          {lead === 0 ? 'NOW' : `FORECAST +${lead}`}
        </div>
        <div style={{ fontSize: '0.6rem', color: 'var(--ink-3)', fontFamily: 'ui-monospace, monospace' }}>{at}</div>
      </div>
    </div>
  );
}

/** The banner that says "this is a forecast" whenever the slider is off NOW. */
export function ForecastBanner({ lead, now = Date.now() }) {
  if (!lead) return null;
  const at = new Date(now + lead * 60e3).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <div role="status" style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1002,
      padding: '6px 13px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.03em',
      background: 'rgba(255,152,0,0.92)', color: '#1F1200', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      FORECAST for {at} (+{lead} min) — predicted warning areas, not observations
    </div>
  );
}

/** Legend for the AI warning layer. */
export function AiwLegend({ lightMode }) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px', marginBottom: 7 }}>
        {SEV_ORDER.slice().reverse().map((k) => {
          const s = SEV[k];
          return (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.62rem', color: lightMode ? '#334155' : '#cbd5e1' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, background: s.color, color: s.ink }}>
                <s.Icon style={{ width: 10, height: 10 }} aria-hidden="true" />
              </span>
              <b>{s.label}</b> · {s.name.toLowerCase()}
            </span>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 14px', fontSize: '0.6rem', color: lightMode ? '#475569' : '#94a3b8' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="22" height="12" aria-hidden="true"><rect x="1" y="1" width="20" height="10" rx="3" fill="rgba(255,152,0,0.3)" stroke="#FF9800" strokeWidth="2" /></svg>
          warning area now
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="22" height="12" aria-hidden="true"><rect x="1" y="1" width="20" height="10" rx="3" fill="rgba(255,152,0,0.08)" stroke="#FF9800" strokeWidth="1.6" strokeDasharray="4 3" /></svg>
          forecast area (+5…+30 min)
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="22" height="12" aria-hidden="true"><rect x="1" y="1" width="20" height="10" rx="3" fill="rgba(255,152,0,0.04)" stroke="#FF9800" strokeWidth="1" strokeDasharray="1 3" /></svg>
          uncertainty corridor
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="22" height="12" aria-hidden="true"><path d="M2 6 H16" stroke="#FF9800" strokeWidth="2" strokeDasharray="1 3" strokeLinecap="round" /><path d="M16 2 L21 6 L16 10 Z" fill="#FF9800" /></svg>
          expected movement
        </span>
      </div>
      <p style={{ margin: '7px 0 0', fontSize: '0.56rem', lineHeight: 1.45, color: lightMode ? '#64748b' : '#64748b' }}>
        Experimental MyWeatherUK AI levels — not official warnings and not equivalent to any national weather service&apos;s levels.
      </p>
    </div>
  );
}
