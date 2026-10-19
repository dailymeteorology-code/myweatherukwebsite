import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CloudRain, Wind, Snowflake, Thermometer, Zap,
  Waves, X, Clock, MapPin, Calendar, ExternalLink, Navigation2,
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import WarningMap from './WarningMap';
import { OfficialImpactMatrix, matrixSentence } from '@/components/warnings/MetOfficeWarning';

const fmtDT = (d) => {
  if (!d) return 'N/A';
  const date = new Date(d);
  return isValid(date) ? format(date, 'EEE d MMM, HH:mm') : d;
};

const SEV = {
  Yellow: {
    hex: '#facc15', rgb: '250,204,21',
    border: 'rgba(250,204,21,0.35)', borderStrong: 'rgba(250,204,21,0.55)',
    glow: 'rgba(250,204,21,0.18)',
    bar: 'linear-gradient(90deg,#fef08a,#facc15)',
    badge: { bg: '#facc15', text: '#0a0f1e' },
  },
  Amber: {
    hex: '#f97316', rgb: '249,115,22',
    border: 'rgba(249,115,22,0.40)', borderStrong: 'rgba(249,115,22,0.60)',
    glow: 'rgba(249,115,22,0.22)',
    bar: 'linear-gradient(90deg,#fdba74,#f97316)',
    badge: { bg: '#f97316', text: '#fff' },
  },
  Red: {
    hex: '#ef4444', rgb: '239,68,68',
    border: 'rgba(239,68,68,0.45)', borderStrong: 'rgba(239,68,68,0.65)',
    glow: 'rgba(239,68,68,0.28)',
    bar: 'linear-gradient(90deg,#fca5a5,#ef4444)',
    badge: { bg: '#ef4444', text: '#fff' },
  },
};
const getSev = (s) => SEV[s] || SEV.Yellow;

const ICONS = {
  Rain: CloudRain, Wind, Snow: Snowflake, Ice: Snowflake,
  Thunderstorm: Zap, Thunderstorms: Zap, 'Extreme Heat': Thermometer, Fog: CloudRain, Flood: Waves,
};
/* No emoji on warnings. A severe-weather notice is not the place for a
   cartoon: the coloured severity chip and the type icon already carry the
   meaning, emoji render differently on every platform, and screen readers
   announce them as their unicode name mid-sentence. */

const extractImpacts = (w) => {
  const t = `${w.type || ''} ${w.description || ''}`.toLowerCase();
  const out = [];
  if (/travel|transport|rail|road|flight|delay|disruption/i.test(t)) out.push({ label: 'Travel' });
  if (/flood|water|inundat/i.test(t)) out.push({ label: 'Flooding' });
  if (/health|heat|cold|vulnerable/i.test(t)) out.push({ label: 'Health' });
  if (/power|electric|outage/i.test(t)) out.push({ label: 'Power' });
  if (/school|closure|cancel/i.test(t)) out.push({ label: 'Closures' });
  if (/lightning|thunder/i.test(t)) out.push({ label: 'Lightning' });
  return out;
};

function useCountdown(targetDate) {
  const [remaining, setRemaining] = React.useState('');
  const [elapsed, setElapsed] = React.useState(null);

  React.useEffect(() => {
    if (!targetDate) return;
    const end = new Date(targetDate).getTime();
    const calc = () => {
      const now = Date.now();
      const diff = end - now;
      if (diff <= 0) { setRemaining('Expired'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [targetDate]);

  return { remaining, elapsed };
}

export default function WarningCardModal({ warning, isUpcoming, onClose, mapUrl }) {
  const sev     = getSev(warning.severity);
  const Icon    = ICONS[warning.type] || AlertTriangle;
  const impacts = extractImpacts(warning);
  const regionList = Array.isArray(warning.regions) ? warning.regions : (warning.region ? [warning.region] : []);

  const validFrom = warning.validFrom ? new Date(warning.validFrom).getTime() : null;
  const validTo   = warning.validTo   ? new Date(warning.validTo).getTime()   : null;
  const windowMs  = (validFrom && validTo) ? Math.max(1, validTo - validFrom) : null;
  const elapsedFrac = (validFrom && validTo && !isUpcoming) ? Math.max(0, Math.min(1, (Date.now() - validFrom) / windowMs)) : null;

  const { remaining } = useCountdown(isUpcoming ? warning.validFrom : warning.validTo);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="modal-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9500,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16, background: 'rgba(2,6,15,0.82)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        }}
        onClick={onClose}
      >
        <motion.div
          key="modal-panel"
          initial={{ opacity: 0, scale: 0.90, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'relative', width: '100%', maxWidth: 540,
            borderRadius: 26, overflow: 'hidden',
            background: 'linear-gradient(160deg, rgba(8,12,26,0.99) 0%, rgba(12,18,36,0.99) 100%)',
            border: `1.5px solid ${sev.borderStrong}`,
            boxShadow: `0 40px 100px rgba(0,0,0,0.80), 0 0 60px ${sev.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
            maxHeight: '92vh', overflowY: 'auto',
          }}
        >
          {/* Accent bar */}
          <div style={{ height: 4, background: sev.bar, boxShadow: `0 0 16px ${sev.hex}88` }} />

          {/* Ambient glow */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 180, pointerEvents: 'none',
            background: `radial-gradient(ellipse 80% 100% at 50% 0%, ${sev.hex}18 0%, transparent 70%)`,
          }} />

          <div style={{ padding: '22px 24px', position: 'relative' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <motion.div
                  initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }}
                  transition={{ delay: 0.05, type: 'spring', stiffness: 240, damping: 18 }}
                  style={{
                    width: 58, height: 58, borderRadius: 18, flexShrink: 0,
                    background: `linear-gradient(135deg, rgba(${sev.rgb},0.32), rgba(${sev.rgb},0.08))`,
                    border: `1.5px solid rgba(${sev.rgb},0.55)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 0 28px rgba(${sev.rgb},0.25), inset 0 1px 0 rgba(255,255,255,0.12)`,
                  }}
                >
                  <Icon style={{ width: 28, height: 28, color: sev.hex }} />
                </motion.div>
                <div>
                  <h2 style={{ margin: '0 0 6px', fontSize: '1.35rem', fontWeight: 900, color: '#f8fafc', letterSpacing: '-0.025em', lineHeight: 1.15 }}>
                    {warning.type} Warning
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      padding: '4px 12px', borderRadius: 99,
                      background: sev.badge.bg, color: sev.badge.text,
                      fontSize: '0.66rem', fontWeight: 900, letterSpacing: '0.07em', textTransform: 'uppercase',
                      boxShadow: `0 0 14px ${sev.hex}66`,
                    }}>
                      {warning.severity} Warning
                    </span>
                    {isUpcoming && (
                      <span style={{ padding: '4px 11px', borderRadius: 99, background: 'rgba(56,189,248,0.14)', border: '1px solid rgba(56,189,248,0.32)', color: '#38bdf8', fontSize: '0.63rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                        UPCOMING
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}>
                <X style={{ width: 15, height: 15 }} />
              </button>
            </div>

            {/* Region */}
            {regionList.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', borderRadius: 14, background: `rgba(${sev.rgb},0.07)`, border: `1px solid rgba(${sev.rgb},0.20)`, marginBottom: 16 }}>
                <MapPin style={{ width: 15, height: 15, color: sev.hex, flexShrink: 0, marginTop: 1 }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {regionList.map((r, i) => (
                    <span key={r} style={{ fontSize: '0.78rem', fontWeight: 600, color: '#cbd5e1' }}>{r}{i < regionList.length - 1 ? ',' : ''}</span>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Map */}
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} style={{ marginBottom: 18 }}>
              <p style={{ margin: '0 0 8px', fontSize: '0.58rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Navigation2 style={{ width: 9, height: 9 }} /> Warning Area
              </p>
              <WarningMap warning={warning} height={230} mapUrl={mapUrl} />
            </motion.div>

            {/* Summary — the Met Office headline */}
            {warning.description && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: '0.58rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Summary</p>
                <p style={{ ...{ margin: 0, fontSize: '0.82rem', lineHeight: 1.65, color: '#cbd5e1', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '13px 15px' }, color: '#e2e8f0', fontWeight: 600 }}>{warning.description}</p>
              </motion.div>
            )}

            {/* Further details — the Met Office's full description */}
            {warning.furtherDetails && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: '0.58rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Further Details</p>
                <div style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.65, color: '#cbd5e1', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '13px 15px' }}>
                  {warning.furtherDetails.split(/\n+/).filter(Boolean).map((para, i) => (
                    <p key={i} style={{ margin: i ? '8px 0 0' : 0 }}>{para}</p>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Impacts expected — the Met Office's "what to expect" statements */}
            {(Array.isArray(warning.whatToExpect) && warning.whatToExpect.length > 0) ? (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.20 }} style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: '0.58rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Impacts Expected</p>
                <ul style={{ ...{ margin: 0, fontSize: '0.82rem', lineHeight: 1.65, color: '#cbd5e1', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '13px 15px' }, margin: 0, paddingLeft: 30, listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {warning.whatToExpect.map((t, i) => (
                    <li key={i} style={{ paddingLeft: 2, display: 'list-item' }}>{t}</li>
                  ))}
                </ul>
              </motion.div>
            ) : impacts.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.20 }} style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: '0.58rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Impacts Expected</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {impacts.map(imp => (
                    <span key={imp.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 13px', borderRadius: 99, background: `rgba(${sev.rgb},0.12)`, border: `1px solid rgba(${sev.rgb},0.28)`, fontSize: '0.73rem', fontWeight: 700, color: sev.hex }}>
                      {imp.label}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Impact matrix — the Met Office's own design */}
            {(warning.likelihood != null || warning.impactLevel != null) && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontSize: '0.58rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Why is the warning {String(warning.severity || 'yellow').toLowerCase()}?</p>
                <div style={{ background: '#2b2b2b', borderRadius: 12, padding: '14px 16px' }}>
                  {matrixSentence(warning.likelihood, warning.impactLevel) && (
                    <p style={{ margin: '0 0 14px', fontSize: '0.86rem', lineHeight: 1.5, color: '#f3f4f6' }}>{matrixSentence(warning.likelihood, warning.impactLevel)}</p>
                  )}
                  <OfficialImpactMatrix likelihood={warning.likelihood} impact={warning.impactLevel} />
                </div>
              </motion.div>
            )}

            {/* Timing grid */}
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { label: 'Valid From', value: fmtDT(warning.validFrom) },
                { label: 'Valid Until', value: fmtDT(warning.validTo) },
              ].map(({ label, value }) => (
                <div key={label} style={{ padding: '12px 14px', borderRadius: 13, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p style={{ margin: '0 0 5px', fontSize: '0.58rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.10em', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Calendar style={{ width: 10, height: 10 }} /> {label}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.80rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{value}</p>
                </div>
              ))}
            </motion.div>

            {/* Countdown tile */}
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}
              style={{ padding: '14px 16px', borderRadius: 15, background: `linear-gradient(135deg, rgba(${sev.rgb},0.12), rgba(${sev.rgb},0.04))`, border: `1.5px solid rgba(${sev.rgb},0.28)`, marginBottom: 16, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06)` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: elapsedFrac !== null ? 10 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8' }}>
                  <Clock style={{ width: 14, height: 14, color: sev.hex }} />
                  {isUpcoming ? 'Starts in' : 'Expires in'}
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 900, color: sev.hex, fontFamily: 'monospace', letterSpacing: '-0.02em', filter: `drop-shadow(0 0 8px ${sev.hex}88)` }}>
                  {remaining}
                </span>
              </div>
              {elapsedFrac !== null && (
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${elapsedFrac * 100}%`, background: sev.bar, borderRadius: 3, boxShadow: `0 0 8px ${sev.hex}55`, transition: 'width 1s linear' }} />
                </div>
              )}
            </motion.div>

            {/* CTA */}
            <motion.a
              href="https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings"
              target="_blank" rel="noopener noreferrer"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.32 }}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', borderRadius: 14, background: `linear-gradient(135deg, rgba(${sev.rgb},0.14), rgba(${sev.rgb},0.06))`, border: `1.5px solid rgba(${sev.rgb},0.30)`, color: sev.hex, fontSize: '0.82rem', fontWeight: 800, textDecoration: 'none', transition: 'all 0.2s', boxShadow: `0 0 20px rgba(${sev.rgb},0.10)` }}
            >
              View on Met Office <ExternalLink style={{ width: 14, height: 14 }} />
            </motion.a>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}