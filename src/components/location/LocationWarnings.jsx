/* Met Office warnings in force over the searched town, for the selected day.
 *
 * Sits directly above the hourly forecast: a warning is the single most
 * important thing on the page, so it goes before the detail rather than after
 * it. Collapsed it is one line — sign, type, times. Tapped it opens the full
 * Met Office wording plus the "what to expect" bullets.
 */
import React, { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const fmt = (iso) => (iso
  ? new Date(iso).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
    })
  : '—');

function WarningRow({ warning }) {
  const [open, setOpen] = useState(false);
  const c = warning.colour;

  return (
    <div style={{
      borderRadius: 14, overflow: 'hidden',
      background: `${c}1f`, border: `1px solid ${c}66`,
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left', color: '#fff', fontFamily: 'inherit',
        }}
      >
        <AlertTriangle style={{ width: 20, height: 20, color: c, flexShrink: 0 }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800 }}>
            {warning.severity} warning of {String(warning.type).toLowerCase()}
          </span>
          <span style={{ display: 'block', fontSize: '0.68rem', color: 'rgba(255,255,255,0.65)' }}>
            {fmt(warning.validFrom)} → {fmt(warning.validTo)}
          </span>
        </span>
        <ChevronDown style={{
          width: 15, height: 15, marginLeft: 'auto', flexShrink: 0,
          color: 'rgba(255,255,255,0.6)',
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
        }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${c}44` }}>
              {warning.headline && (
                <p style={{ margin: '10px 0 6px', fontSize: '0.78rem', fontWeight: 700 }}>
                  {warning.headline}
                </p>
              )}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '0 0 8px', fontSize: '0.68rem', color: 'rgba(255,255,255,0.7)' }}>
                <span><b style={{ color: c }}>Starts</b> {fmt(warning.validFrom)}</span>
                <span><b style={{ color: c }}>Ends</b> {fmt(warning.validTo)}</span>
              </div>
              {warning.description && (
                <p style={{ margin: 0, fontSize: '0.74rem', lineHeight: 1.55, color: 'rgba(255,255,255,0.82)', whiteSpace: 'pre-line' }}>
                  {warning.description}
                </p>
              )}
              {warning.whatToExpect.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.72rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.75)' }}>
                  {warning.whatToExpect.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function LocationWarnings({ warnings = [] }) {
  if (!warnings.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      {warnings.map(w => <WarningRow key={w.id} warning={w} />)}
    </div>
  );
}