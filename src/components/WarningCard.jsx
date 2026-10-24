import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, MapPin, Eye, Trash2, RefreshCw, ChevronDown,
} from 'lucide-react';
import { warningSymbol } from '@/components/warnings/WarningSymbols';
import { format, isValid } from 'date-fns';
import WarningCardModal from './WarningCardModal';
import WarningAreaDiffMap from './WarningAreaDiffMap';
import { useTheme } from '@/components/ThemeContext';

/* ─── Helpers ──────────────────────────────────────────────────── */
const fmtDT = (d) => {
  if (!d) return 'N/A';
  const date = new Date(d);
  return isValid(date) ? format(date, 'EEE d MMM, HH:mm') : d;
};

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

/* ─── Severity config ──────────────────────────────────────────── */
/* `hex` is the severity's own colour, and the text colour on the dark card. On the light card a
   yellow (or orange) label on near-white is barely there, so text takes `ink` there instead: the
   same hue, dark enough to read. */
const SEV = {
  Yellow: {
    hex: '#facc15', rgb: '250,204,21', ink: '#a16207',
    border: 'rgba(250,204,21,0.35)',
    glow: 'rgba(250,204,21,0.18)',
    bar: 'linear-gradient(90deg,#fef08a,#facc15)',
    badge: { bg: '#facc15', text: '#0a0f1e' },
  },
  Amber: {
    hex: '#f97316', rgb: '249,115,22', ink: '#c2410c',
    border: 'rgba(249,115,22,0.40)',
    glow: 'rgba(249,115,22,0.22)',
    bar: 'linear-gradient(90deg,#fdba74,#f97316)',
    badge: { bg: '#f97316', text: '#fff' },
  },
  Red: {
    hex: '#ef4444', rgb: '239,68,68', ink: '#b91c1c',
    border: 'rgba(239,68,68,0.45)',
    glow: 'rgba(239,68,68,0.28)',
    bar: 'linear-gradient(90deg,#fca5a5,#ef4444)',
    badge: { bg: '#ef4444', text: '#fff' },
  },
};
const getSev = (s) => SEV[s] || SEV.Yellow;

/* No emoji on warnings. A severe-weather notice is not the place for a
   cartoon: the coloured severity chip and the type icon already carry the
   meaning, emoji render differently on every platform, and screen readers
   announce them as their unicode name mid-sentence. */

/* ─── Countdown hook ───────────────────────────────────────────── */
/** Field names as a reader would say them, for the "what changed" line. */
const FIELD_LABEL = {
  severity: 'severity', validFrom: 'start time', validTo: 'end time',
  description: 'details', headline: 'headline', regions: 'regions',
  counties: 'counties', impacts: 'impacts', polygons: 'warning area',
};
const fieldLabel = (k) => FIELD_LABEL[k] || k;

/* The geometry is shown on the before/now map, never as text — printing a few
   thousand coordinate pairs into the card would be worse than saying nothing. */
const MAPPED_FIELDS = new Set(['polygons']);

const fmtWhen = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
};

/** Render a stored value the way a reader would say it. */
const fmtValue = (field, v) => {
  if (field === 'validFrom' || field === 'validTo') return fmtWhen(v) || '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  const s = String(v ?? '').trim();
  return s || '—';
};

/** Severity reads as a colour, so show it as one rather than as the word. */
function SevPill({ value }) {
  const s = getSev(value);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 99,
      fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.04em',
      color: s.hex, background: `rgba(${s.rgb},0.16)`, border: `1px solid rgba(${s.rgb},0.45)`,
    }}>
      {value || '—'}
    </span>
  );
}

/* One changed field, as two labelled panels rather than a cramped
   old → new line. They sit side by side when there is room and stack on a
   phone, so a rewritten description stays readable instead of being squeezed
   into a half-width column. Long values are clamped — an amended description
   can run to several paragraphs and would otherwise bury the rest of the card. */
function DiffField({ field, before, after, ink, hair, sky }) {
  const clamp = { overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical' };
  const isSev = field === 'severity';

  const Panel = ({ label, value, current }) => (
    <div style={{
      flex: '1 1 200px', minWidth: 0, borderRadius: 9, padding: '7px 10px',
      background: current ? 'rgba(56,189,248,0.10)' : 'rgba(148,163,184,0.09)',
      border: `1px solid ${current ? 'rgba(56,189,248,0.32)' : 'rgba(148,163,184,0.22)'}`,
    }}>
      <div style={{
        fontSize: '0.53rem', fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase',
        color: current ? sky : ink, opacity: current ? 1 : 0.45, marginBottom: 4,
      }}>
        {label}
      </div>
      {isSev
        ? <SevPill value={value} />
        : (
          <div style={{
            fontSize: '0.71rem', lineHeight: 1.45, color: ink,
            opacity: current ? 0.95 : 0.6, fontWeight: current ? 600 : 400, ...clamp,
          }}>
            {fmtValue(field, value)}
          </div>
        )}
    </div>
  );

  return (
    <div style={{ padding: '9px 11px', borderTop: `1px solid ${hair}` }}>
      <div style={{
        fontSize: '0.57rem', fontWeight: 800, letterSpacing: '0.09em',
        textTransform: 'uppercase', color: sky, marginBottom: 6,
      }}>
        {fieldLabel(field)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
        <Panel label="Before" value={before} current={false} />
        <Panel label="Now" value={after} current />
      </div>
    </div>
  );
}

function useCountdown(targetDate) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
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

  return remaining;
}

/* ─── MAIN CARD ────────────────────────────────────────────────── */
export default function WarningCard({ warning, index, isUpcoming = false, isOwner = false, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const sev     = getSev(warning.severity);
  const Icon    = warningSymbol(warning.type);
  const impacts = extractImpacts(warning);
  const { isDark } = useTheme();
  const T = {
    ink:         isDark ? '#f8fafc' : '#0f172a',
    deep:        isDark ? 'rgba(10,15,30,0.95)' : 'rgba(255,255,255,0.96)',
    faintBg:     isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)',
    faintBorder: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.12)',
    hair:        isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.10)',
    track:       isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
    sub:         isDark ? '#a3b1c4' : '#475569',     // the description
    muted:       isDark ? '#8392a8' : '#64748b',     // labels and the date
    sky:         isDark ? '#7dd3fc' : '#0369a1',     // "Upcoming", "Updated"
  };
  const sevInk = isDark ? sev.hex : sev.ink;
  const cardBg = `linear-gradient(135deg, rgba(${sev.rgb},0.14) 0%, rgba(${sev.rgb},0.05) 55%, ${T.deep} 100%)`;

  const remaining = useCountdown(isUpcoming ? warning.validFrom : warning.validTo);

  const regionList = Array.isArray(warning.regions)
    ? warning.regions
    : (warning.region ? [warning.region] : []);

  // Progress through warning window
  const validFrom = warning.validFrom ? new Date(warning.validFrom).getTime() : null;
  const validTo   = warning.validTo   ? new Date(warning.validTo).getTime()   : null;
  const windowMs  = (validFrom && validTo) ? Math.max(1, validTo - validFrom) : null;
  const elapsed   = (validFrom && validTo && !isUpcoming)
    ? Math.max(0, Math.min(1, (Date.now() - validFrom) / windowMs))
    : null;

  const isRed   = warning.severity === 'Red';
  const isAmber = warning.severity === 'Amber';

  return (
    <>
      {/* ── Summary card ── */}
      <motion.div
        className="warning-card-wrapper"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: index * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        whileHover={{ y: -5, transition: { duration: 0.2 } }}
        whileTap={{ scale: 0.985 }}
        onClick={() => setExpanded(true)}
        style={{
          position: 'relative', borderRadius: 22, overflow: 'hidden',
          background: cardBg,
          border: `1.5px solid ${sev.border}`,
          boxShadow: `0 4px 28px ${sev.glow}, 0 1px 0 rgba(255,255,255,0.06) inset`,
          cursor: 'pointer', userSelect: 'none',
          backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: 3, background: sev.bar, boxShadow: `0 0 12px ${sev.hex}88` }} />

        {/* Red: pulsing border ring */}
        {isRed && (
          <motion.div
            animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.02, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            style={{ position: 'absolute', inset: 0, borderRadius: 22, border: `2px solid ${sev.hex}`, pointerEvents: 'none' }}
          />
        )}

        {/* Ambient glow orb */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%',
          background: `radial-gradient(circle, ${sev.hex}20 0%, transparent 70%)`, pointerEvents: 'none',
        }} />

        <div style={{ padding: '18px 20px 16px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
            {/* Icon with pulse */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              {(isRed || isAmber) && (
                <motion.div
                  animate={{ scale: [1, 1.55, 1], opacity: [0.45, 0, 0.45] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut' }}
                  style={{
                    position: 'absolute', inset: -8, borderRadius: '50%',
                    background: `radial-gradient(circle, ${sev.hex}55 0%, transparent 65%)`,
                    pointerEvents: 'none',
                  }}
                />
              )}
              <div style={{
                width: 52, height: 52, borderRadius: 16, flexShrink: 0,
                background: `linear-gradient(135deg, rgba(${sev.rgb},0.28), rgba(${sev.rgb},0.08))`,
                border: `1.5px solid rgba(${sev.rgb},0.50)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 0 20px rgba(${sev.rgb},0.22), inset 0 1px 0 rgba(255,255,255,0.12)`,
              }}>
                <Icon style={{ width: 24, height: 24, color: sevInk }} />
              </div>
            </div>

            {/* Title */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: '0 0 5px', fontSize: '1.08rem', fontWeight: 900, color: T.ink, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
                {warning.type} Warning
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 99,
                  background: sev.badge.bg, color: sev.badge.text,
                  fontSize: '0.62rem', fontWeight: 900, letterSpacing: '0.07em', textTransform: 'uppercase',
                  boxShadow: `0 0 10px ${sev.hex}55`,
                }}>
                  {isRed && (
                    <motion.span
                      animate={{ opacity: [1, 0.2, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                      style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', display: 'inline-block' }}
                    />
                  )}
                  {warning.severity}
                </span>
                {isUpcoming && (
                  <span style={{ padding: '3px 9px', borderRadius: 99, background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.30)', color: T.sky, fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                    UPCOMING
                  </span>
                )}

                {/* How a past warning ended, sat in the status row beside the
                    severity rather than floating over the card's corner — where
                    it overlapped the artwork and read as a sticker stuck on top
                    rather than part of the card. Driven by warning.status, so it
                    appears anywhere a past warning is rendered, not only inside
                    the Past Warnings modal. */}
                {(warning.status === 'cancelled' || warning.status === 'expired') && (
                  <span style={{
                    padding: '3px 9px', borderRadius: 99,
                    fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
                    ...(warning.status === 'cancelled'
                      ? { background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.42)', color: isDark ? '#fbbf24' : '#b45309' }
                      : { background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.32)', color: T.muted }),
                  }}>
                    {warning.status === 'cancelled' ? 'Cancelled' : 'Expired'}
                  </span>
                )}
                {isRed && (
                  <motion.span
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.1, repeat: Infinity }}
                    style={{ padding: '3px 9px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.40)', color: isDark ? '#fca5a5' : '#b91c1c', fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em' }}
                  >
                    SEVERE
                  </motion.span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* Admin-only delete (manual warnings only) */}
              {isOwner && warning.isManual && warning.id && onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(warning); }}
                  title="Delete warning"
                  style={{
                    width: 28, height: 28, borderRadius: 9, flexShrink: 0, cursor: 'pointer',
                    background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.30)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.22)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
                >
                  <Trash2 style={{ width: 13, height: 13, color: '#f87171' }} />
                </button>
              )}

              {/* Eye icon */}
              <div style={{
                width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                background: `rgba(${sev.rgb},0.10)`, border: `1px solid rgba(${sev.rgb},0.22)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Eye style={{ width: 13, height: 13, color: sevInk }} />
              </div>
            </div>
          </div>

          {/* Amendment notice. The Met Office amends live warnings and the card
              used to silently become something else; this says it changed, when,
              what changed and why, with the old values behind a toggle so the
              card is not permanently twice as tall. */}
          {warning.updatedAt && (
            <div style={{
              marginBottom: 12, borderRadius: 12, overflow: 'hidden',
              background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.28)',
            }}>
              {/* Header — when it changed, what changed, and the toggle. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '2px 9px', borderRadius: 99,
                  background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.42)',
                  fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.09em', color: T.sky,
                }}>
                  <RefreshCw style={{ width: 10, height: 10 }} />
                  UPDATED
                </span>
                <span style={{ fontSize: '0.66rem', fontWeight: 700, color: T.ink, opacity: 0.9 }}>
                  {fmtWhen(warning.updatedAt)}
                </span>
                {warning.previousVersions?.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowDiff(v => !v); }}
                    style={{
                      marginLeft: 'auto', cursor: 'pointer', fontFamily: 'inherit',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 10px', borderRadius: 99, fontSize: '0.62rem', fontWeight: 800,
                      background: showDiff ? 'rgba(56,189,248,0.28)' : 'rgba(56,189,248,0.14)',
                      border: '1px solid rgba(56,189,248,0.4)', color: T.sky,
                    }}>
                    {showDiff ? 'Hide changes' : 'Before / now'}
                    <ChevronDown style={{
                      width: 11, height: 11,
                      transform: showDiff ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
                    }} />
                  </button>
                )}
              </div>

              {/* What changed, as chips — easier to scan than a comma list. */}
              {warning.updatedFields?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '0 11px 9px' }}>
                  {warning.updatedFields.map(f => (
                    <span key={f} style={{
                      padding: '2px 8px', borderRadius: 6,
                      background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.24)',
                      fontSize: '0.6rem', fontWeight: 700, color: T.ink, opacity: 0.85,
                    }}>
                      {fieldLabel(f)}
                    </span>
                  ))}
                </div>
              )}

              {warning.updateReason && (
                <div style={{ padding: '0 11px 10px' }}>
                  <div style={{
                    borderLeft: '3px solid rgba(56,189,248,0.5)', borderRadius: '0 8px 8px 0',
                    background: 'rgba(56,189,248,0.06)', padding: '7px 10px',
                  }}>
                    <div style={{
                      fontSize: '0.53rem', fontWeight: 800, letterSpacing: '0.11em',
                      textTransform: 'uppercase', color: T.sky, marginBottom: 3,
                    }}>
                      Why it changed
                    </div>
                    <p style={{ margin: 0, fontSize: '0.72rem', lineHeight: 1.5, color: T.ink, opacity: 0.88 }}>
                      {warning.updateReason}
                    </p>
                  </div>
                </div>
              )}

              {showDiff && warning.previousVersions?.[0] && (
                <div>
                  {/* The area map first: when the Met Office redraws a warning
                      this is the change, and no wording conveys it. */}
                  {warning.polygons?.length > 0 && (
                    <div style={{ padding: '9px 11px', borderTop: `1px solid ${T.hair}` }}>
                      <div style={{
                        fontSize: '0.57rem', fontWeight: 800, letterSpacing: '0.09em',
                        textTransform: 'uppercase', color: T.sky, marginBottom: 6,
                      }}>
                        Warning area
                      </div>
                      <WarningAreaDiffMap
                        before={warning.previousVersions[0].polygons}
                        after={warning.polygons}
                        severityHex={sev.hex}
                        isDark={isDark}
                      />
                    </div>
                  )}

                  {(warning.updatedFields || [])
                    .filter(f => !MAPPED_FIELDS.has(f))
                    .map(f => (
                      <DiffField key={f} field={f}
                                 before={warning.previousVersions[0][f]}
                                 after={warning[f]} ink={T.ink} hair={T.hair} sky={T.sky} />
                    ))}

                  {warning.previousVersions.length > 1 && (
                    <div style={{ padding: '7px 11px', borderTop: `1px solid ${T.hair}`, fontSize: '0.62rem', color: T.ink, opacity: 0.55 }}>
                      Amended {warning.previousVersions.length} times — showing the most recent change
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Region chips */}
          {regionList.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {regionList.slice(0, 5).map(r => (
                <span key={r} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '2px 8px', borderRadius: 99,
                  background: `rgba(${sev.rgb},0.09)`, border: `1px solid rgba(${sev.rgb},0.22)`,
                  fontSize: '0.62rem', fontWeight: 600, color: sevInk,
                }}>
                  <MapPin style={{ width: 9, height: 9 }} />
                  {r}
                </span>
              ))}
              {regionList.length > 5 && (
                <span style={{ padding: '2px 8px', borderRadius: 99, background: T.faintBg, border: `1px solid ${T.faintBorder}`, fontSize: '0.62rem', color: T.muted }}>
                  +{regionList.length - 5} more
                </span>
              )}
            </div>
          )}

          {/* Description */}
          {warning.description && (
            <p style={{
              margin: '0 0 12px', fontSize: '0.78rem', lineHeight: 1.6, color: T.sub,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {warning.description}
            </p>
          )}

          {/* Impact pills */}
          {impacts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
              {impacts.map(imp => (
                <span key={imp.label} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 9px', borderRadius: 99,
                  background: `rgba(${sev.rgb},0.10)`, border: `1px solid rgba(${sev.rgb},0.22)`,
                  fontSize: '0.63rem', fontWeight: 700, color: sevInk,
                }}>
                  {imp.label}
                </span>
              ))}
            </div>
          )}

          {/* Progress bar + countdown */}
          <div style={{ borderTop: `1px solid ${T.hair}`, paddingTop: 11 }}>
            {elapsed !== null && (
              <div style={{ marginBottom: 9 }}>
                <div style={{ height: 5, borderRadius: 3, background: T.track, overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${elapsed * 100}%` }}
                    transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                    style={{ height: '100%', background: sev.bar, borderRadius: 3, boxShadow: `0 0 8px ${sev.hex}66` }}
                  />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 7,
                  background: `rgba(${sev.rgb},0.14)`, border: `1px solid rgba(${sev.rgb},0.28)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Clock style={{ width: 11, height: 11, color: sevInk }} />
                </div>
                <span style={{ fontSize: '0.7rem', color: T.muted, fontWeight: 600 }}>
                  {isUpcoming ? 'Starts' : 'Expires'}:
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: remaining === 'Expired' ? '#ef4444' : sevInk, fontFamily: 'monospace' }}>
                  {remaining}
                </span>
              </div>
              <span style={{ fontSize: '0.63rem', color: T.muted, fontFamily: 'monospace' }}>
                {fmtDT(isUpcoming ? warning.validFrom : warning.validTo)}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Modal — rendered via portal to document.body, escaping any CSS transform ancestor */}
      {expanded && (
        <WarningCardModal
          warning={warning}
          isUpcoming={isUpcoming}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}