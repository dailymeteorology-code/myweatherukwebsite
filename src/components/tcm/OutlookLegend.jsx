import React, { useState } from 'react';
import { Layers, X, Info } from 'lucide-react';
import { RISK_META, RISK_COLOR, RISK_FILL, RISK_BORDER, fmtRange, descFor } from '@/components/tcm/riskConfig';
import { RISK_DESCRIPTIONS } from '@/components/tcm/riskDescriptions';

const RISK_TYPE_LABELS = {
  thunderstorm: 'Thunderstorm',
  hail: 'Hail',
  tornado: 'Tornado',
  lightning: 'Lightning',
};

// Per-hazard accent colour for the legend chrome
const RISK_TYPE_ACCENT = {
  thunderstorm: '#facc15',
  hail:         '#38bdf8',
  tornado:      '#f97316',
  lightning:    '#a78bfa',
};

/**
 * Risk-level legend overlaid on the outlook map.
 * On mobile (<640px), starts collapsed as a small "Key" pill so it doesn't
 * cover the map. Tap the pill to expand; tap the X to collapse again.
 *
 * Each risk level row is now hoverable/tappable to reveal the hazard-specific
 * description (Thunderstorm / Hail / Tornado / Lightning all have their own
 * descriptions and palettes).
 */
const OutlookLegend = React.memo(function OutlookLegend({ riskType, regionLabel, activeLevels, logoUrl }) {
  const tone = {
    bg: 'rgba(15,23,42,0.93)',
    border: 'rgba(255,255,255,0.15)',
    text: '#f1f5f9',
    sub: '#cbd5e1',
    dim: '#94a3b8',
    faint: '#64748b',
    rule: 'rgba(255,255,255,0.08)',
  };
  const headerLabel = RISK_TYPE_LABELS[riskType] || 'Risk';
  const accent = RISK_TYPE_ACCENT[riskType] || '#a78bfa';
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const [collapsed, setCollapsed] = useState(isMobile);
  const [activeDesc, setActiveDesc] = useState(null);

  // Pull the description bank for the current risk type
  const descBank = (RISK_DESCRIPTIONS && RISK_DESCRIPTIONS[riskType]) || {};
  const fallbackDesc = (level) => descFor(riskType, level);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 500,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 11px', borderRadius: 8,
          background: tone.bg, backdropFilter: 'blur(14px)',
          border: `1px solid ${tone.border}`, color: tone.text,
          fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
          fontFamily: "'DM Sans',system-ui,sans-serif",
          boxShadow: '0 6px 20px rgba(0,0,0,0.32)',
        }}>
        <Layers style={{ width: 11, height: 11, color: accent }} />
        Key
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'absolute', top: 10, right: 10, zIndex: 500,
        width: isMobile ? 'min(260px, calc(100vw - 24px))' : 300,
        background: tone.bg, backdropFilter: 'blur(14px)',
        borderRadius: 10, border: `1px solid ${tone.border}`,
        boxShadow: '0 12px 40px rgba(0,0,0,0.32)',
        overflow: 'hidden',
        fontFamily: "'DM Sans',system-ui,sans-serif",
      }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderBottom: `1px solid ${tone.rule}`,
        background: `linear-gradient(180deg, ${accent}1a, transparent)`,
      }}>
        {logoUrl && (
          <img
            src={logoUrl} alt=""
            onError={e => (e.currentTarget.style.display = 'none')}
            style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0, borderRadius: 4 }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '0.56rem', fontWeight: 800, color: tone.faint, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'DM Mono',monospace" }}>
            Risk Level
          </div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: accent }}>{headerLabel}</div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            width: 22, height: 22, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.05)', border: `1px solid ${tone.rule}`,
            color: tone.dim, cursor: 'pointer', padding: 0, flexShrink: 0,
          }}>
          <X style={{ width: 11, height: 11 }} />
        </button>
      </div>

      {/* Risk-level table */}
      <div style={{ padding: '10px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${tone.rule}` }}>
          <span style={{ fontSize: '0.60rem', fontWeight: 700, color: tone.sub, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{regionLabel}</span>
          <span style={{ fontSize: '0.56rem', fontStyle: 'italic', color: tone.dim, fontFamily: "'DM Mono',monospace" }}>tap a row for detail</span>
        </div>
        {[...RISK_META].reverse().map(r => {
          if (r.level === 'No Risk') return null;
          const active = activeLevels.has(r.level);
          const f = RISK_FILL(r.level, riskType);
          const b = RISK_BORDER(r.level, riskType);
          const isOpen = activeDesc === r.level;
          return (
            <div key={r.level}>
              <button
                type="button"
                onClick={() => setActiveDesc(isOpen ? null : r.level)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px',
                  width: '100%', background: isOpen ? 'rgba(255,255,255,0.04)' : 'transparent',
                  border: 'none', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}>
                <span style={{ width: 22, height: 11, flexShrink: 0, borderRadius: 3, background: f, border: `1.5px solid ${b}` }} />
                <span style={{ flex: 1, fontSize: '0.7rem', fontWeight: active ? 700 : 600, color: tone.text }}>{r.level}</span>
                <span style={{ fontSize: '0.56rem', fontFamily: "'DM Mono',monospace", color: tone.dim, minWidth: 30, textAlign: 'right' }}>{fmtRange(r.level)}</span>
              </button>
              {isOpen && (
                <div style={{
                  margin: '2px 4px 6px 32px', padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${tone.rule}`,
                  fontSize: '0.66rem', lineHeight: 1.55, color: tone.sub,
                }}>
                  {descBank[r.level] || fallbackDesc(r.level)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-hazard description footer */}
      <div style={{
        padding: '8px 12px 10px', borderTop: `1px solid ${tone.rule}`,
        background: 'rgba(0,0,0,0.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Info style={{ width: 10, height: 10, color: accent }} />
          <span style={{ fontSize: '0.56rem', fontWeight: 700, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            About {headerLabel} risk
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.62rem', color: tone.dim, lineHeight: 1.5 }}>
          Tap a level above for the hazard-specific description. Colours and impacts differ between Thunderstorm, Hail, Tornado and Lightning.
        </p>
      </div>
    </div>
  );
});

export default OutlookLegend;