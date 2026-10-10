/* ════════════════════════════════════════════════════════════════════════════
   PAST WARNINGS
   ────────────────────────────────────────────────────────────────────────────
   Everything the Met Office has stopped publishing in the last five days, which
   is two different endings: a warning that ran to its published end time
   (expired) and one the Met Office withdrew early (cancelled).

   FIVE DAYS IS NOT A UI CHOICE. The backend trims its history at five days, so
   that is genuinely all there is. This says so rather than offering a range
   picker whose longer options would always come back empty.

   NOTHING HERE IS DECORATIVE. The counts, the busiest-day strip and the peak
   severity are all measured from the warnings actually in the list — an earlier
   version of this panel showed a row of fixed chips reading "Region: All areas"
   and "Last checked: Just now", which were hardcoded and told the reader
   nothing.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CloudRain, Search, SlidersHorizontal, RotateCcw, History } from 'lucide-react';
import WarningCard from './WarningCard';
import { useTheme } from '@/components/ThemeContext';
import { selectPast, bucketDays, startOfDay, endedAt, LOOKBACK_DAYS } from '@/lib/pastWarnings';

/* Matches WarningCard, so the chips here and the cards below agree. */
const SEV = {
  Yellow: { hex: '#facc15', rgb: '250,204,21', rank: 1 },
  Amber: { hex: '#f97316', rgb: '249,115,22', rank: 2 },
  Red: { hex: '#ef4444', rgb: '239,68,68', rank: 3 },
};
const SEV_ORDER = ['Red', 'Amber', 'Yellow'];
const sevOf = (s) => SEV[s] || SEV.Yellow;

const DAY_MS = 86400000;

const OUTCOMES = [
  { id: 'expired', label: 'Expired', hint: 'Ran to its published end time' },
  { id: 'cancelled', label: 'Cancelled', hint: 'Withdrawn early by the Met Office' },
];

const dayHeading = (date, today) => {
  const diff = Math.round((today - startOfDay(date)) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
};

/** Stable identity for a list key — index would reorder cards under filtering. */
const keyOf = (w) => w.id || `${w.type}|${w.severity}|${w.validFrom}|${w.validTo}`;

/* ─── Small building blocks ──────────────────────────────────────────────── */

function Chip({ active, colour, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        cursor: 'pointer', fontFamily: 'inherit',
        padding: '4px 11px', borderRadius: 99,
        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.01em',
        background: active ? `rgba(${colour},0.20)` : 'rgba(148,163,184,0.10)',
        border: `1px solid ${active ? `rgba(${colour},0.65)` : 'rgba(148,163,184,0.22)'}`,
        color: active ? `rgb(${colour})` : 'inherit',
        opacity: active ? 1 : 0.75,
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, colour, ink }) {
  return (
    <div style={{
      flex: '1 1 90px', minWidth: 0, borderRadius: 12, padding: '9px 11px',
      background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.16)',
    }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.1, color: colour || ink }}>
        {value}
      </div>
      <div style={{
        fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.09em',
        textTransform: 'uppercase', color: ink, opacity: 0.5, marginTop: 2,
      }}>
        {label}
      </div>
    </div>
  );
}

/* ─── Modal ──────────────────────────────────────────────────────────────── */

export default function PastWarningsModal({ isOpen, onClose, warnings = [] }) {
  const { isDark } = useTheme();

  const [query, setQuery] = useState('');
  const [sevFilter, setSevFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [outcomeFilter, setOutcomeFilter] = useState([]);
  const [dayFilter, setDayFilter] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  const P = isDark
    ? {
      panel: 'linear-gradient(160deg, rgba(23,33,54,0.96) 0%, rgba(11,17,32,0.98) 100%)',
      border: 'rgba(148,163,184,0.16)',
      shadow: '0 32px 80px rgba(0,0,0,0.6)',
      ink: '#f8fafc', muted: '#94a3b8',
      field: 'rgba(0,0,0,0.30)', fieldBorder: 'rgba(255,255,255,0.10)',
      hair: 'rgba(148,163,184,0.14)',
      stickyBg: 'rgba(11,17,32,0.96)',
    }
    : {
      panel: 'linear-gradient(160deg, #ffffff 0%, #eef4ff 100%)',
      border: 'rgba(15,23,42,0.12)',
      shadow: '0 32px 80px rgba(15,23,42,0.20)',
      ink: '#0f172a', muted: '#475569',
      field: 'rgba(15,23,42,0.04)', fieldBorder: 'rgba(15,23,42,0.12)',
      hair: 'rgba(15,23,42,0.10)',
      stickyBg: 'rgba(244,248,255,0.97)',
    };

  const pastWarnings = useMemo(() => selectPast(warnings || [], Date.now()), [warnings]);

  const today = useMemo(() => startOfDay(new Date()).getTime(), []);

  /* The days covered, oldest first so the strip reads left to right.

     Buckets are built by stepping the calendar date rather than subtracting a
     fixed 24 hours: the UK clock change makes one day 23 or 25 hours long, and
     millisecond arithmetic would slide every bucket off midnight for half the
     year.

     LOOKBACK_DAYS + 1 of them, because a rolling five-times-twenty-four-hours
     window always touches six calendar days — the oldest one partially. That
     way everything retained lands in exactly one bucket and the bars add up to
     the total in the header. */
  const days = useMemo(
    () => bucketDays(pastWarnings, Date.now()).map((b) => ({
      ...b,
      peak: b.warnings.reduce((acc, w) => Math.max(acc, sevOf(w.severity).rank), 0),
    })),
    [pastWarnings],
  );

  const busiest = Math.max(1, ...days.map((d) => d.count));

  const types = useMemo(
    () => [...new Set(pastWarnings.map((w) => w.type).filter(Boolean))].sort(),
    [pastWarnings],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pastWarnings.filter((w) => {
      if (sevFilter.length && !sevFilter.includes(w.severity)) return false;
      if (typeFilter.length && !typeFilter.includes(w.type)) return false;
      if (outcomeFilter.length && !outcomeFilter.includes(w.status)) return false;
      // Compare the bucket a warning falls in, not a 24-hour offset from the
      // bucket start, for the same clock-change reason as above.
      if (dayFilter !== null && startOfDay(endedAt(w)).getTime() !== dayFilter) return false;
      if (q) {
        const hay = [w.headline, w.description, w.type, w.severity,
          ...(w.regions || []), ...(w.counties || [])].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pastWarnings, sevFilter, typeFilter, outcomeFilter, dayFilter, query]);

  /* Grouped by the day it ended, newest day first — a flat list of a dozen
     cards gives no sense of when any of it happened. */
  const groups = useMemo(() => {
    const map = new Map();
    for (const w of filtered) {
      const k = startOfDay(endedAt(w)).getTime();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(w);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  const stats = useMemo(() => {
    const peak = pastWarnings.reduce((acc, w) => Math.max(acc, sevOf(w.severity).rank), 0);
    return {
      total: pastWarnings.length,
      cancelled: pastWarnings.filter((w) => w.status === 'cancelled').length,
      expired: pastWarnings.filter((w) => w.status !== 'cancelled').length,
      peakName: SEV_ORDER.find((s) => SEV[s].rank === peak) || null,
    };
  }, [pastWarnings]);

  const filtersOn = sevFilter.length || typeFilter.length || outcomeFilter.length
    || dayFilter !== null || query.trim();

  const clearFilters = () => {
    setSevFilter([]); setTypeFilter([]); setOutcomeFilter([]);
    setDayFilter(null); setQuery('');
  };

  const toggle = (setter) => (val) =>
    setter((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]));

  // Escape to close and a scroll lock on the page behind, matching every other
  // modal in the app. Kept in a ref so a fresh onClose arrow does not tear the
  // lock down and re-apply it on each keystroke in the search box.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  // Filters set during one visit should not silently still be applied the next.
  useEffect(() => { if (!isOpen) clearFilters(); }, [isOpen]);

  const labelStyle = {
    fontSize: '0.56rem', fontWeight: 800, letterSpacing: '0.11em',
    textTransform: 'uppercase', color: P.ink, opacity: 0.45, marginBottom: 6,
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md"
          style={{ zIndex: 1200 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 24 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-3xl overflow-hidden flex flex-col"
            style={{
              background: P.panel,
              border: `1px solid ${P.border}`,
              boxShadow: P.shadow,
              maxHeight: '92vh',
            }}
          >
            <div style={{ height: 3, background: 'linear-gradient(90deg,#3b82f6 0%,#60a5fa 40%,rgba(96,165,250,0.15) 100%)', flexShrink: 0 }} />

            {/* ── Header ─────────────────────────────────────────────── */}
            <div style={{ padding: '16px 18px 12px', flexShrink: 0 }}>
              <div className="flex items-start justify-between gap-3">
                <div style={{ minWidth: 0 }}>
                  <p style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0,
                    fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: '#60a5fa',
                  }}>
                    <History style={{ width: 11, height: 11 }} />
                    Weather history
                  </p>
                  <h2 style={{ margin: '3px 0 0', fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em', color: P.ink }}>
                    Past Warnings
                  </h2>
                  <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: P.muted }}>
                    {stats.total === 0
                      ? `Nothing ended in the last ${LOOKBACK_DAYS} days`
                      : `${stats.total} warning${stats.total === 1 ? '' : 's'} ended in the last ${LOOKBACK_DAYS} days`}
                  </p>
                </div>

                <motion.button
                  whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
                  onClick={onClose}
                  className="p-2 rounded-xl flex-shrink-0"
                  style={{ background: P.field, border: `1px solid ${P.fieldBorder}` }}
                  aria-label="Close past warnings"
                >
                  <X className="w-4 h-4" style={{ color: P.muted }} />
                </motion.button>
              </div>
            </div>

            {stats.total > 0 && (
              <>
                {/* ── Measured summary ───────────────────────────────── */}
                <div style={{ display: 'flex', gap: 8, padding: '0 18px 12px', flexShrink: 0 }}>
                  <Stat label="Total" value={stats.total} ink={P.ink} />
                  <Stat label="Expired" value={stats.expired} ink={P.ink} />
                  <Stat label="Cancelled" value={stats.cancelled} ink={P.ink}
                        colour={stats.cancelled ? '#38bdf8' : undefined} />
                  <Stat label="Peak level" value={stats.peakName || '—'} ink={P.ink}
                        colour={stats.peakName ? sevOf(stats.peakName).hex : undefined} />
                </div>

                {/* ── Five-day strip. Bar height is the count, colour is the
                       worst severity that day. Tap one to narrow to it. ── */}
                <div style={{ padding: '0 18px 12px', flexShrink: 0 }}>
                  <div style={labelStyle}>When they ended</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    {days.map((d) => {
                      const active = dayFilter === d.start;
                      const colour = d.peak ? sevOf(SEV_ORDER.find((s) => SEV[s].rank === d.peak)).hex : null;
                      const date = new Date(d.start);
                      return (
                        <button
                          key={d.start}
                          type="button"
                          onClick={() => setDayFilter(active ? null : (d.count ? d.start : null))}
                          disabled={!d.count}
                          title={d.count ? `${d.count} ended ${dayHeading(date, today)}` : `Nothing ended ${dayHeading(date, today)}`}
                          style={{
                            flex: 1, minWidth: 0, cursor: d.count ? 'pointer' : 'default',
                            fontFamily: 'inherit', padding: '6px 4px 5px', borderRadius: 10,
                            background: active ? 'rgba(96,165,250,0.16)' : 'rgba(148,163,184,0.07)',
                            border: `1px solid ${active ? 'rgba(96,165,250,0.55)' : P.hair}`,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ height: 30, display: 'flex', alignItems: 'flex-end', width: '100%', justifyContent: 'center' }}>
                            {d.count > 0 ? (
                              <div style={{
                                width: '62%', borderRadius: 3,
                                height: `${Math.max(18, (d.count / busiest) * 100)}%`,
                                background: colour, opacity: active ? 1 : 0.85,
                              }} />
                            ) : (
                              <div style={{ width: '62%', height: 2, borderRadius: 2, background: P.hair }} />
                            )}
                          </div>
                          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: P.ink, opacity: d.count ? 0.9 : 0.3 }}>
                            {d.count || '—'}
                          </span>
                          <span style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: P.ink, opacity: 0.42 }}>
                            {d.start === today ? 'Today' : date.toLocaleDateString('en-GB', { weekday: 'short' })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Search + filters ───────────────────────────────── */}
                <div style={{ padding: '0 18px 10px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                      <Search style={{
                        position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                        width: 13, height: 13, color: P.muted, pointerEvents: 'none',
                      }} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search headline, region or county…"
                        style={{
                          width: '100%', padding: '8px 10px 8px 30px', borderRadius: 10,
                          background: P.field, border: `1px solid ${P.fieldBorder}`,
                          color: P.ink, fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFilters((v) => !v)}
                      style={{
                        cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '0 12px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 700,
                        background: showFilters ? 'rgba(96,165,250,0.18)' : P.field,
                        border: `1px solid ${showFilters ? 'rgba(96,165,250,0.5)' : P.fieldBorder}`,
                        color: showFilters ? '#93c5fd' : P.muted,
                      }}
                    >
                      <SlidersHorizontal style={{ width: 13, height: 13 }} />
                      Filter
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {showFilters && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
                          <div>
                            <div style={labelStyle}>Severity</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {SEV_ORDER.map((s) => (
                                <Chip key={s} active={sevFilter.includes(s)} colour={SEV[s].rgb}
                                      onClick={() => toggle(setSevFilter)(s)}>
                                  {s}
                                </Chip>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div style={labelStyle}>How it ended</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {OUTCOMES.map((o) => (
                                <Chip key={o.id} active={outcomeFilter.includes(o.id)} colour="56,189,248"
                                      title={o.hint} onClick={() => toggle(setOutcomeFilter)(o.id)}>
                                  {o.label}
                                </Chip>
                              ))}
                            </div>
                          </div>

                          {types.length > 1 && (
                            <div>
                              <div style={labelStyle}>Type</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {types.map((t) => (
                                  <Chip key={t} active={typeFilter.includes(t)} colour="148,163,184"
                                        onClick={() => toggle(setTypeFilter)(t)}>
                                    {t}
                                  </Chip>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {filtersOn && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
                      <span style={{ fontSize: '0.68rem', color: P.muted }}>
                        Showing {filtered.length} of {stats.total}
                      </span>
                      <button
                        type="button"
                        onClick={clearFilters}
                        style={{
                          cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto',
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 10px', borderRadius: 99, fontSize: '0.65rem', fontWeight: 700,
                          background: 'rgba(148,163,184,0.12)', border: `1px solid ${P.hair}`, color: P.muted,
                        }}
                      >
                        <RotateCcw style={{ width: 10, height: 10 }} />
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Results ────────────────────────────────────────────── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 18px', minHeight: 0 }}>
              {stats.total === 0 ? (
                <AllClear P={P} />
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <Search style={{ width: 26, height: 26, color: P.muted, opacity: 0.5, margin: '0 auto 10px' }} />
                  <p style={{ margin: 0, fontWeight: 700, color: P.ink }}>No warnings match</p>
                  <p style={{ margin: '4px 0 14px', fontSize: '0.75rem', color: P.muted }}>
                    There are {stats.total} past warnings, but none fit the current filters.
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    style={{
                      cursor: 'pointer', fontFamily: 'inherit',
                      padding: '6px 16px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
                      background: 'rgba(96,165,250,0.16)', border: '1px solid rgba(96,165,250,0.45)', color: '#93c5fd',
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                groups.map(([dayStart, list]) => (
                  <div key={dayStart}>
                    <div style={{
                      position: 'sticky', top: 0, zIndex: 2,
                      display: 'flex', alignItems: 'center', gap: 8,
                      margin: '0 -18px', padding: '8px 18px 7px',
                      background: P.stickyBg, backdropFilter: 'blur(8px)',
                    }}>
                      <span style={{
                        fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: P.ink, opacity: 0.65,
                      }}>
                        {dayHeading(new Date(dayStart), today)}
                      </span>
                      <span style={{ flex: 1, height: 1, background: P.hair }} />
                      <span style={{ fontSize: '0.62rem', fontWeight: 700, color: P.muted }}>
                        {list.length}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 12 }}>
                      {list.map((w, i) => (
                        <motion.div
                          key={keyOf(w)}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(0.25, i * 0.04), ease: [0.4, 0, 0.2, 1] }}
                        >
                          {/* The Cancelled / Expired badge lives inside
                              WarningCard, in its status row beside the severity
                              chip, rather than floating over a corner. */}
                          <WarningCard warning={w} index={i} />
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* Genuinely nothing to show. Distinct from "your filters matched nothing",
   which is a different message with a different fix. */
function AllClear({ P }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35 }}
      className="flex flex-col items-center py-12 px-4"
    >
      <div className="relative mb-5">
        <motion.div
          animate={{ scale: [1, 1.08, 1], opacity: [0.3, 0.15, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)', margin: '-16px' }}
        />
        <div className="w-20 h-20 rounded-full flex items-center justify-center"
             style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}>
            <CloudRain className="w-9 h-9" style={{ color: 'rgba(96,165,250,0.55)' }} />
          </motion.div>
        </div>
      </div>

      <p className="font-semibold text-lg mb-1.5" style={{ letterSpacing: '-0.01em', color: P.ink }}>
        All clear
      </p>
      <p className="text-center text-sm leading-relaxed" style={{ color: P.muted, maxWidth: 300 }}>
        No Met Office warning has expired or been cancelled anywhere in the UK in
        the last {LOOKBACK_DAYS} days.
      </p>
    </motion.div>
  );
}
