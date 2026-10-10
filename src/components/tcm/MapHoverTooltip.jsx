// MapHoverTooltip
// Floating tooltip shown when the user hovers over the Outlook map.
// Displays the localized convective risk and key impact data for the exact
// grid cell under the cursor.

import React from 'react';
import { CloudLightning, Wind, CloudRain, Zap, MapPin } from 'lucide-react';

export default function MapHoverTooltip({
  x, y, containerW, containerH,
  point,           // { lat, lon, score, level, palette, summary }
  riskTypeLabel,
  dayLabel,
  lightMode,
}) {
  if (!point) return null;

  // Position the tooltip near cursor, flipping sides near edges so it stays in view.
  const W = 250;
  const H = 200;
  const flipRight = x + W + 20 > containerW;
  const flipDown  = y + H + 20 > containerH;
  const left = flipRight ? Math.max(8, x - W - 14) : x + 14;
  const top  = flipDown  ? Math.max(8, y - H - 14) : y + 14;

  const bg = lightMode ? 'rgba(255,255,255,0.97)' : 'rgba(15,23,42,0.96)';
  const border = lightMode ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.12)';
  const text = lightMode ? '#0f172a' : '#f1f5f9';
  const sub = lightMode ? '#475569' : '#94a3b8';
  const muted = lightMode ? '#64748b' : '#64748b';

  const s = point.summary || {};
  const sub2 = s.sub || {};

  return (
    <div
      style={{
        position: 'absolute',
        left, top,
        width: W,
        pointerEvents: 'none',
        zIndex: 600,
        background: bg,
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${point.palette?.border || '#64748b'}`,
        borderRadius: 10,
        boxShadow: lightMode ? '0 8px 24px rgba(15,23,42,0.18)' : '0 8px 24px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
        padding: '10px 12px',
        fontFamily: "'DM Sans',system-ui,sans-serif",
        transition: 'left 80ms ease-out, top 80ms ease-out',
      }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <MapPin style={{ width: 12, height: 12, color: muted }} />
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: '0.65rem', fontWeight: 700, color: sub }}>
          {point.lat.toFixed(2)}°, {point.lon.toFixed(2)}°
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {dayLabel}
        </span>
      </div>

      {/* Risk level + score */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
        background: point.palette?.fill || 'rgba(100,116,139,0.1)',
        border: `1.5px solid ${point.palette?.border || 'rgba(100,116,139,0.3)'}`,
        borderRadius: 8, marginBottom: 8,
      }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%',
          background: point.palette?.border || '#64748b',
          boxShadow: `0 0 6px ${point.palette?.border || '#64748b'}`,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.82rem', fontWeight: 800,
            color: point.palette?.border === 'transparent' ? text : (point.palette?.border || text),
            lineHeight: 1.1,
          }}>
            {point.level}
          </div>
          <div style={{ fontSize: '0.6rem', color: sub, fontFamily: "'DM Mono',monospace", marginTop: 1 }}>
            {riskTypeLabel} Risk
          </div>
        </div>
        <div style={{
          fontSize: '1.1rem', fontWeight: 900,
          fontFamily: "'DM Mono',monospace",
          color: point.palette?.border === 'transparent' ? text : (point.palette?.border || text),
        }}>
          {Math.round(point.score)}
        </div>
      </div>

      {/* Quick impact metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
        <MetricCell icon={CloudLightning} label="Storm" value={Math.round(s.thunderstorm ?? 0)} unit="" color="#e65100" sub={sub} text={text} />
        <MetricCell icon={Zap} label="Lightning" value={Math.round(s.lightning ?? sub2.lightning ?? 0)} unit="" color="#f59e0b" sub={sub} text={text} />
        <MetricCell icon={CloudRain} label="Hail" value={Math.round(sub2.hail ?? 0)} unit="%" color="#2e7d32" sub={sub} text={text} />
        <MetricCell icon={Wind} label="Wind" value={Math.round(sub2.strongWinds ?? 0)} unit="%" color="#6a1b9a" sub={sub} text={text} />
      </div>

      {/* CAPE / Shear */}
      {(s.ranges?.cape?.max || s.ranges?.shear?.max) && (
        <div style={{
          display: 'flex', gap: 8, marginTop: 7, paddingTop: 7,
          borderTop: `1px solid ${border}`,
        }}>
          {s.ranges?.cape?.max > 0 && (
            <span style={{ fontSize: '0.62rem', color: sub, fontFamily: "'DM Mono',monospace" }}>
              <strong style={{ color: '#ef4444', fontWeight: 800 }}>{Math.round(s.ranges.cape.max)}</strong> CAPE
            </span>
          )}
          {s.ranges?.shear?.max > 0 && (
            <span style={{ fontSize: '0.62rem', color: sub, fontFamily: "'DM Mono',monospace" }}>
              <strong style={{ color: '#38bdf8', fontWeight: 800 }}>{Math.round(s.ranges.shear.max)}</strong> kt shear
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCell({ icon: Icon, label, value, unit, color, sub, text }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 6px', borderRadius: 6,
      background: `${color}10`, border: `1px solid ${color}25`,
    }}>
      <Icon style={{ width: 11, height: 11, color, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.52rem', fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'DM Mono',monospace" }}>
          {label}
        </div>
        <div style={{ fontSize: '0.78rem', fontWeight: 800, color: text, fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
          {value}{unit}
        </div>
      </div>
    </div>
  );
}