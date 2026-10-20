import React, { useState, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/ThemeContext';

/* ─────────────────────────────────────────────────────────────
   SEVERITY OPTIONS
   Each level carries full visual + semantic metadata.
───────────────────────────────────────────────────────────── */
const LEVELS = [
  {
    label: 'Yellow',
    sublabel: 'Low severity',
    value: 'yellow',
    hex: '#facc15',
    dimHex: 'rgba(250,204,21,0.15)',
    borderHex: 'rgba(250,204,21,0.35)',
    textHex: '#fef08a',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
        <line x1="7" y1="4" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7" cy="9.5" r="0.7" fill="currentColor" />
      </svg>
    ),
    description: 'Minor disruption expected',
    bars: 1,
  },
  {
    label: 'Amber',
    sublabel: 'Moderate severity',
    value: 'amber',
    hex: '#f97316',
    dimHex: 'rgba(249,115,22,0.15)',
    borderHex: 'rgba(249,115,22,0.35)',
    textHex: '#fed7aa',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1.5L12.5 12H1.5L7 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7" cy="10.2" r="0.7" fill="currentColor" />
      </svg>
    ),
    description: 'Significant impact likely',
    bars: 2,
  },
  {
    label: 'Red',
    sublabel: 'High severity',
    value: 'red',
    hex: '#ef4444',
    dimHex: 'rgba(239,68,68,0.15)',
    borderHex: 'rgba(239,68,68,0.35)',
    textHex: '#fca5a5',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <line x1="4.5" y1="4.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="9.5" y1="4.5" x2="4.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
    description: 'Dangerous conditions',
    bars: 3,
  },
];

/* ─────────────────────────────────────────────────────────────
   SEVERITY BARS — visual indicator strip
───────────────────────────────────────────────────────────── */
function SeverityBars({ count, hex, small = false }) {
  return (
    <div style={{ display: 'flex', gap: small ? 2 : 3, alignItems: 'flex-end' }}>
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: i <= count ? 1 : 0.3 }}
          transition={{ delay: i * 0.05, duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
          style={{
            width: small ? 3 : 4,
            height: small ? (i * 4 + 4) : (i * 5 + 5),
            borderRadius: 2,
            background: i <= count ? hex : 'rgba(255,255,255,0.1)',
            transformOrigin: 'bottom',
            transition: 'background 0.3s',
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ANIMATED DOT — pulsing indicator
───────────────────────────────────────────────────────────── */
function PulseDot({ hex, active }) {
  return (
    <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
      {active && (
        <motion.div
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
          style={{
            position: 'absolute', inset: 0,
            borderRadius: '50%', background: hex,
          }}
        />
      )}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: hex,
        boxShadow: active ? `0 0 6px 1px ${hex}80` : 'none',
        transition: 'box-shadow 0.3s',
      }} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────── */
export default function SeverityFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(null);
  const ref = useRef(null);
  const menuId = useId();

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const selected = LEVELS.find((l) => l.label === value) ?? null;
  const preview = hovered ? LEVELS.find((l) => l.label === hovered) : selected;

  const { isDark } = useTheme();
  const T = {
    subtleBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.05)',
    line:     isDark ? 'rgba(255,255,255,0.1)'  : 'rgba(15,23,42,0.12)',
    text:     isDark ? 'rgba(255,255,255,0.5)'  : 'rgba(15,23,42,0.6)',
    textHov:  isDark ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.9)',
    dim:      isDark ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.42)',
    idle:     isDark ? 'rgba(255,255,255,0.3)'  : 'rgba(15,23,42,0.42)',
    dashed:   isDark ? 'rgba(255,255,255,0.2)'  : 'rgba(15,23,42,0.32)',
    panelBg:  isDark ? 'rgba(10,14,26,0.97)'    : 'rgba(255,255,255,0.98)',
    hair:     isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
  };

  const handleSelect = (label) => {
    onChange(label === value ? null : label);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', fontFamily: "'DM Mono', 'Fira Code', monospace" }}>

      {/* ── TRIGGER BUTTON ── */}
      <motion.button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        whileTap={{ scale: 0.96 }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 12,
          background: selected ? selected.dimHex : T.subtleBg,
          border: `1px solid ${selected ? selected.borderHex : T.line}`,
          color: selected ? selected.textHex : T.text,
          cursor: 'pointer', userSelect: 'none',
          fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
          transition: 'background 0.25s, border-color 0.25s, color 0.25s',
          whiteSpace: 'nowrap', minWidth: 120,
          position: 'relative', overflow: 'hidden',
        }}
      >
        {/* Shimmer on open */}
        {open && (
          <motion.div
            initial={{ x: '-100%', opacity: 0.4 }}
            animate={{ x: '200%', opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Left: dot or icon */}
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.span
              key={selected.label + '-dot'}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.18, type: 'spring', stiffness: 500 }}
              style={{ display: 'flex', alignItems: 'center', color: selected.hex }}
            >
              <PulseDot hex={selected.hex} active={open} />
            </motion.span>
          ) : (
            <motion.span
              key="no-dot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                width: 10, height: 10, borderRadius: '50%',
                border: `1.5px dashed ${T.dashed}`,
                flexShrink: 0,
              }}
            />
          )}
        </AnimatePresence>

        {/* Label */}
        <AnimatePresence mode="wait">
          <motion.span
            key={value ?? 'placeholder'}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.14 }}
            style={{ flex: 1, textAlign: 'left' }}
          >
            {selected ? selected.label : 'Severity'}
          </motion.span>
        </AnimatePresence>

        {/* Right: bars or chevron */}
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.span
              key="bars"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.2 }}
            >
              <SeverityBars count={selected.bars} hex={selected.hex} small />
            </motion.span>
          ) : (
            <motion.span
              key="chevron"
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              style={{ display: 'flex', alignItems: 'center', opacity: 0.35 }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M2 4L5.5 7.5L9 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.span>
          )}
        </AnimatePresence>

        {/* Clear X — only when selected */}
        <AnimatePresence>
          {selected && (
            <motion.span
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 16, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', cursor: 'pointer', opacity: 0.5,
                borderRadius: 4,
              }}
              whileHover={{ opacity: 1 }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── DROPDOWN MENU ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              width: 240, zIndex: 50, borderRadius: 16,
              background: T.panelBg,
              border: `1px solid ${T.line}`,
              boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 2px 12px rgba(0,0,0,0.5)',
              overflow: 'hidden',
              backdropFilter: 'blur(16px)',
            }}
          >
            {/* Menu header */}
            <div style={{
              padding: '10px 14px 8px',
              borderBottom: `1px solid ${T.hair}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.dim }}>
                Alert Threshold
              </span>
              {/* Live preview */}
              <AnimatePresence mode="wait">
                {preview && (
                  <motion.span
                    key={preview.label + '-preview'}
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.15 }}
                    style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: preview.hex }}
                  >
                    {preview.sublabel}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Options */}
            <div style={{ padding: '6px 6px' }}>
              {LEVELS.map((level, i) => {
                const isActive = value === level.label;
                const isHov = hovered === level.label;

                return (
                  <motion.button
                    key={level.label}
                    role="option"
                    aria-selected={isActive}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.055, duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => handleSelect(level.label)}
                    onHoverStart={() => setHovered(level.label)}
                    onHoverEnd={() => setHovered(null)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                      background: isActive ? level.dimHex : isHov ? T.subtleBg : 'transparent',
                      border: `1px solid ${isActive ? level.borderHex : 'transparent'}`,
                      transition: 'background 0.15s, border-color 0.15s',
                      textAlign: 'left',
                    }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {/* Icon */}
                    <motion.span
                      animate={{ color: isActive || isHov ? level.hex : T.idle }}
                      transition={{ duration: 0.2 }}
                      style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                    >
                      {level.icon}
                    </motion.span>

                    {/* Text block */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
                        color: isActive ? level.textHex : isHov ? T.textHov : T.text,
                        transition: 'color 0.2s', fontFamily: "'DM Mono', monospace",
                      }}>
                        {level.label}
                      </div>
                      <div style={{
                        fontSize: 10, color: T.dim,
                        marginTop: 1, letterSpacing: '0.03em',
                        fontFamily: 'system-ui, sans-serif',
                      }}>
                        {level.description}
                      </div>
                    </div>

                    {/* Severity bars */}
                    <motion.span
                      animate={{ opacity: isActive || isHov ? 1 : 0.3 }}
                      transition={{ duration: 0.2 }}
                    >
                      <SeverityBars count={isActive || isHov ? level.bars : level.bars} hex={isActive || isHov ? level.hex : T.dim} />
                    </motion.span>

                    {/* Active checkmark */}
                    <AnimatePresence>
                      {isActive && (
                        <motion.span
                          initial={{ scale: 0, rotate: -20 }}
                          animate={{ scale: 1, rotate: 0 }}
                          exit={{ scale: 0, rotate: 20 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                          style={{ color: level.hex, fontSize: 12, lineHeight: 1, flexShrink: 0 }}
                        >
                          ✓
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </div>

            {/* Footer — clear all */}
            <AnimatePresence>
              {value && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden', borderTop: `1px solid ${T.hair}` }}
                >
                  <button
                    onClick={() => { onChange(null); setOpen(false); }}
                    style={{
                      width: '100%', padding: '9px 14px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: T.dim, cursor: 'pointer',
                      background: 'transparent', border: 'none',
                      transition: 'color 0.2s',
                      fontFamily: "'DM Mono', 'Fira Code', monospace",
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.25)'}
                  >
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M1.5 1.5L7.5 7.5M7.5 1.5L1.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    Clear filter
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}