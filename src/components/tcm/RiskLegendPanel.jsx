import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ChevronDown } from 'lucide-react';

/* RiskLegend — extracted from pages/TCM.jsx. Self-contained expandable
   risk-level guide panel, themed light/dark. */
export default function RiskLegend({ lightMode = false }) {
  const [expanded, setExpanded] = useState(false);
  const [activeLevel, setActiveLevel] = useState(null);

  const RISK_META = [
    { level: 'No Risk',  color: '#64748b', fill: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.35)', darkBorder: 'rgba(100,116,139,0.55)', description: 'The atmosphere is stable and firmly capped — no energy for thunderstorms. Outdoor plans unaffected.' },
    { level: 'Very Low', color: '#16a34a', fill: 'rgba(22,163,74,0.12)',  border: 'rgba(22,163,74,0.35)',  darkBorder: 'rgba(22,163,74,0.60)',  description: 'Just enough instability for an isolated brief thunderstorm. Most areas see nothing. Single rumble possible but not guaranteed.' },
    { level: 'Low',      color: '#15803d', fill: 'rgba(21,128,61,0.12)',  border: 'rgba(21,128,61,0.35)',  darkBorder: 'rgba(21,128,61,0.60)',  description: 'Thunderstorms expected, mostly afternoon. Disorganised and short-lived. Small hail <2 cm and gusty winds possible.' },
    { level: 'Marginal', color: '#ca8a04', fill: 'rgba(202,138,4,0.12)',  border: 'rgba(202,138,4,0.35)',  darkBorder: 'rgba(202,138,4,0.60)',  description: 'Genuine severe threat. Clusters can persist for hours. Frequent lightning, hail 2–3 cm, flooding and 60 mph gusts.' },
    { level: 'Moderate', color: '#ea580c', fill: 'rgba(234,88,12,0.12)',  border: 'rgba(234,88,12,0.35)',  darkBorder: 'rgba(234,88,12,0.60)',  description: 'Significant organised severe weather. Long-lived squall lines, hail 3–5 cm, 60–80 mph gusts, flash flooding.' },
    { level: 'High',     color: '#dc2626', fill: 'rgba(220,38,38,0.12)',  border: 'rgba(220,38,38,0.35)',  darkBorder: 'rgba(220,38,38,0.60)',  description: 'Exceptionally rare and dangerous. Violent supercells possible. Giant hail ≥5 cm, 80–100 mph gusts, credible tornado threat.' },
    { level: 'Severe',   color: '#000000', fill: 'rgba(0,0,0,0.08)',     border: 'rgba(0,0,0,0.30)',     darkBorder: 'rgba(255,255,255,0.25)', description: 'Catastrophic life-threatening event — effectively unprecedented for the UK. Violent supercells, devastating hail, hurricane gusts, multiple tornadoes.' },
  ];

  const textC = lightMode ? '#1e293b' : '#f1f5f9';
  const subC = lightMode ? '#475569' : '#94a3b8';
  const mutedC = lightMode ? '#64748b' : '#64748b';
  const panelBg = lightMode ? 'rgba(255,255,255,0.92)' : 'rgba(8,13,28,0.92)';
  const trigBg = lightMode ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)';
  const trigBdr = lightMode ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
  const divider = lightMode ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.5 }} className="mx-auto max-w-3xl px-6 mb-10">
      <button onClick={() => setExpanded(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderRadius: 16, cursor: 'pointer', background: trigBg, border: `1px solid ${trigBdr}`, transition: 'all 0.2s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShieldAlert style={{ width: 15, height: 15, color: '#a78bfa', flexShrink: 0 }} />
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: textC }}>Risk Level Guide</span>
          <div style={{ display: 'flex', gap: 0, marginLeft: 4, borderRadius: 6, overflow: 'hidden', border: `1px solid ${trigBdr}` }}>
            {RISK_META.map(r => (
              <div key={r.level} title={r.level} style={{ width: 18, height: 18, background: r.level === 'Severe' ? (lightMode ? '#1e293b' : '#e2e8f0') : r.color, opacity: 0.85 }} />
            ))}
          </div>
        </div>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.25 }}>
          <ChevronDown style={{ width: 15, height: 15, color: mutedC }} />
        </motion.div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35 }} style={{ overflow: 'hidden' }}>
            <div style={{ marginTop: 8, borderRadius: 20, border: `1px solid ${trigBdr}`, background: panelBg, backdropFilter: 'blur(20px)', overflow: 'hidden' }}>
              {RISK_META.map((r, i) => {
                const isActive = activeLevel === r.level;
                const isSevere = r.level === 'Severe';
                const swatchColor = isSevere ? (lightMode ? '#1e293b' : '#e2e8f0') : r.color;
                const labelColor = swatchColor;
                const activeBorder = isSevere ? (lightMode ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.30)') : r.darkBorder;
                return (
                  <div key={r.level} style={{ borderBottom: i < RISK_META.length - 1 ? `1px solid ${divider}` : 'none' }}>
                    <button onClick={() => setActiveLevel(isActive ? null : r.level)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', background: isActive ? r.fill : 'transparent', border: 'none', borderLeft: `4px solid ${isActive ? swatchColor : 'transparent'}`, cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: isActive ? swatchColor : r.fill, border: `2px solid ${isActive ? activeBorder : r.border}`, boxShadow: isActive ? `0 0 0 3px ${r.fill}` : 'none' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: labelColor, letterSpacing: '-0.01em' }}>{r.level}</p>
                        {!isActive && (
                          <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: mutedC, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.description.slice(0, 72)}…</p>
                        )}
                      </div>
                      <motion.div animate={{ rotate: isActive ? 180 : 0 }} transition={{ duration: 0.2 }} style={{ flexShrink: 0 }}>
                        <ChevronDown style={{ width: 14, height: 14, color: isActive ? labelColor : mutedC }} />
                      </motion.div>
                    </button>
                    <AnimatePresence>
                      {isActive && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} style={{ overflow: 'hidden' }}>
                          <div style={{ padding: '0 18px 16px 72px', background: r.fill, borderLeft: `4px solid ${swatchColor}` }}>
                            <div style={{ height: 2, width: 32, borderRadius: 99, background: swatchColor, marginBottom: 10, opacity: 0.6 }} />
                            <p style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.75, color: subC }}>{r.description}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}