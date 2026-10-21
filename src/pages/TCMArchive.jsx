// TCM Outlook Archive — restructured to mirror mesocast.uk/archive
// Information architecture borrowed from Mesocast:
//   • Month title with ← Previous / Current Month / Next → nav
//   • Year + Month + Category dropdowns with a "Go" button
//   • Monthly CALENDAR GRID (Mon–Sun), each day a risk-coloured cell,
//     leading/trailing days from adjacent months dimmed
//   • Risk legend strip (NF · V LOW · LOW · SLGT · MDT · HIGH · SVR · MGL SVR)
//   • Chronological "Forecast Archive" list below the calendar w/ pagination
//   • Detail panel retained from the original radar-room design
// Aesthetic preserved: deep charcoal, electric amber, ice blue instrument panel.

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Search, X, Calendar, Zap, CloudLightning,
  Clock, CheckCircle2, AlertTriangle, List, Grid3x3,
  Database, PenLine, Trash2, Loader2 } from
'lucide-react';
import ArchiveSummaryCard from '@/components/tcm/ArchiveSummaryCard';
import ArchiveMapPanel from '@/components/tcm/ArchiveMapPanel';
import ArchiveRunSwitcher from '@/components/tcm/ArchiveRunSwitcher';
import { RISK_COLOR, RISK_FILL, RISK_BORDER } from '@/components/tcm/riskConfig';
import { base44 } from '@/api/base44Client';
import { listRunsFromDB, loadAdminDrawnOutlooksForDate, deleteAdminDrawnOutlook } from '@/lib/tcmForecastCache';

// ─── constants ──────────────────────────────────────────────────────────────


// Mesocast watch-category taxonomy (lowest → highest), incl. "No Forecast".
// `match` lists the entry.level strings that map onto each category so this
// works whether the data uses "Medium"/"Moderate" or short codes.
const CATEGORIES = [
{ id: 'all', label: 'All categories', short: 'ALL', match: null },
{ id: 'NF', label: 'No Forecast', short: 'NF', match: ['No Risk', 'No Forecast', 'NF', 'None', null, undefined, ''] },
{ id: 'Very Low', label: 'Very Low', short: 'V LOW', match: ['Very Low', 'V Low', 'VLOW'] },
{ id: 'Low', label: 'Low', short: 'LOW', match: ['Low'] },
{ id: 'Slight', label: 'Slight', short: 'SLGT', match: ['Slight', 'SLGT', 'Medium'] },
{ id: 'Moderate', label: 'Moderate', short: 'MDT', match: ['Moderate', 'MDT', 'Mod'] },
{ id: 'High', label: 'High', short: 'HIGH', match: ['High'] },
{ id: 'Severe', label: 'Severe', short: 'SVR', match: ['Severe', 'SVR', 'Extreme'] },
{ id: 'Mgl Svr', label: 'Marginal Severe', short: 'MGL SVR', match: ['Mgl Svr', 'Marginal Severe', 'MGL SVR'] }];


const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// Resolve an entry's level string to a category id.
function categoryOf(level) {
  if (level == null || level === '') return 'NF';
  for (const c of CATEGORIES) {
    if (c.match && c.match.includes(level)) return c.id;
  }
  return 'NF';
}

// Colour helpers keyed by category — fall back to riskConfig where possible.
function catColor(catId) {
  if (catId === 'NF' || catId === 'all') return '#475569';
  return RISK_COLOR(CAT_BY_ID[catId]?.label || catId, 'thunderstorm') || '#64748b';
}
function catFill(catId) {
  if (catId === 'NF' || catId === 'all') return 'rgba(148,163,184,0.06)';
  return RISK_FILL(CAT_BY_ID[catId]?.label || catId, 'thunderstorm') || 'rgba(255,255,255,0.04)';
}
function catBorder(catId) {
  if (catId === 'NF' || catId === 'all') return 'rgba(148,163,184,0.18)';
  return RISK_BORDER(CAT_BY_ID[catId]?.label || catId, 'thunderstorm') || 'rgba(255,255,255,0.08)';
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadArchive(region) {
  try {
    const raw = localStorage.getItem(`tcm_archive_${region}`);
    return raw ? JSON.parse(raw) : [];
  } catch {return [];}
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

function isoOf(y, m, day) {
  return `${y}-${(m + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

// Build a 6-row Mon–Sun calendar matrix for the given year/month (0-based month).
function buildCalendar(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  // getUTCDay: 0=Sun..6=Sat → convert to Mon=0..Sun=6
  const startOffset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const prevDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells = [];
  // leading (previous month)
  for (let i = startOffset - 1; i >= 0; i--) {
    const day = prevDays - i;
    const dt = new Date(Date.UTC(year, month - 1, day));
    cells.push({ day, iso: isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), day), inMonth: false });
  }
  // current month
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, iso: isoOf(year, month, day), inMonth: true });
  }
  // trailing (next month) to fill to a multiple of 7
  let next = 1;
  while (cells.length % 7 !== 0) {
    const dt = new Date(Date.UTC(year, month + 1, next));
    cells.push({ day: next, iso: isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), next), inMonth: false });
    next++;
  }
  // rows of 7
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

// Simple count-up hook
function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setVal(Math.round(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target, duration]);
  return val;
}

// ─── sub-components ──────────────────────────────────────────────────────────

function StatPill({ icon: Icon, label, value, accent = '#38bdf8' }) {
  const n = useCountUp(value);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      flex: '1 1 120px', minWidth: 110
    }}>
      <Icon style={{ width: 15, height: 15, color: accent, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9', fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>
          {n}
        </div>
        <div style={{ fontSize: '0.62rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
          {label}
        </div>
      </div>
    </div>);

}

function Dropdown({ value, options, onChange, width = 150 }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: 'none', WebkitAppearance: 'none',
        padding: '7px 28px 7px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#cbd5e1', fontSize: '0.72rem', fontWeight: 700,
        fontFamily: "'Space Mono', monospace", cursor: 'pointer',
        minWidth: width,
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='3'><path d='M6 9l6 6 6-6'/></svg>")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center'
      }}>
      {options.map((o) =>
      <option key={o.value} value={o.value} style={{ background: '#0d1526', color: '#cbd5e1' }}>
          {o.label}
        </option>
      )}
    </select>);

}

function LegendStrip() {
  const items = CATEGORIES.filter((c) => c.id !== 'all');
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
      padding: '10px 14px', borderRadius: 10,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)'
    }}>
      <span style={{ fontSize: '0.58rem', color: '#475569', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'Space Mono',monospace", marginRight: 4 }}>
        Legend
      </span>
      {items.map((c) =>
      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 6, background: catFill(c.id), border: `1px solid ${catBorder(c.id)}` }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: catColor(c.id), flexShrink: 0 }} />
          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: catColor(c.id), letterSpacing: '0.06em', fontFamily: "'Space Mono',monospace" }}>
            {c.short}
          </span>
        </div>
      )}
    </div>);

}

function VerificationBadge({ entry }) {
  const verified = entry?.verified;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 6,
      background: verified ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
      border: `1px solid ${verified ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.2)'}`,
      fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
      color: verified ? '#4ade80' : '#64748b',
      textTransform: 'uppercase'
    }}>
      {verified ?
      <><CheckCircle2 style={{ width: 10, height: 10 }} /> Verified</> :
      <><AlertTriangle style={{ width: 10, height: 10 }} /> Pending</>}
    </div>);

}


// ─── Calendar grid ───────────────────────────────────────────────────────────

function CalendarGrid({ year, month, byDate, selectedDate, onPick }) {
  const rows = useMemo(() => buildCalendar(year, month), [year, month]);
  const todayIso = useMemo(() => {
    const d = new Date();
    return isoOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }, []);

  return (
    <div style={{
      borderRadius: 14, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(255,255,255,0.015)'
    }}>
      {/* Weekday header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {WEEKDAYS.map((w) =>
        <div key={w} style={{
          padding: '9px 0', textAlign: 'center',
          fontSize: '0.6rem', fontWeight: 800, color: '#475569',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          fontFamily: "'Space Mono',monospace",
          background: 'rgba(255,255,255,0.02)'
        }} className="rounded-xl">
            {w}
          </div>
        )}
      </div>

      {/* Day cells */}
      {rows.map((row, ri) =>
      <div key={ri} style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        borderBottom: ri < rows.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
      }}>
          {row.map((cell, ci) => {
          const entry = byDate.get(cell.iso);
          const catId = entry ? categoryOf(entry.level) : null;
          const hasData = !!entry;
          const isSelected = selectedDate === cell.iso;
          const isToday = cell.iso === todayIso;
          const color = hasData ? catColor(catId) : '#334155';

          return (
            <button
              key={cell.iso + ci}
              onClick={() => hasData && onPick(isSelected ? null : cell.iso)}
              disabled={!hasData}
              title={hasData ?
              `${cell.iso} — ${CAT_BY_ID[catId]?.label || 'No Forecast'}` :
              `${cell.iso} — no data`}
              style={{
                position: 'relative',
                aspectRatio: '1 / 0.82',
                border: 'none',
                borderRight: ci < 6 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                background: !cell.inMonth ?
                'rgba(0,0,0,0.18)' :
                hasData ? catFill(catId) : 'transparent',
                cursor: hasData ? 'pointer' : 'default',
                padding: '7px 8px',
                display: 'flex', flexDirection: 'column',
                alignItems: 'flex-start', justifyContent: 'space-between',
                opacity: cell.inMonth ? 1 : 0.4,
                transition: 'background 0.15s, box-shadow 0.15s',
                boxShadow: isSelected ? `inset 0 0 0 2px ${color}` : 'none',
                outline: 'none'
              }}
              onMouseEnter={(e) => {if (hasData && !isSelected) e.currentTarget.style.background = catFill(catId).replace(/0\.0?\d+\)/, '0.16)');}}
              onMouseLeave={(e) => {if (hasData && !isSelected) e.currentTarget.style.background = catFill(catId);}} className="rounded-2xl">
              
                {/* Day number */}
                <span style={{
                fontSize: '0.72rem', fontWeight: 800,
                fontFamily: "'Space Mono',monospace",
                color: !cell.inMonth ? '#334155' : hasData ? '#f1f5f9' : '#475569',
                display: 'flex', alignItems: 'center', gap: 5
              }}>
                  {cell.day}
                  {isToday && cell.inMonth &&
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                }
                </span>

                {/* Risk badge */}
                {hasData &&
              <span style={{
                alignSelf: 'stretch',
                fontSize: '0.54rem', fontWeight: 800,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                fontFamily: "'Space Mono',monospace",
                color, padding: '2px 0',
                borderTop: `1px solid ${catBorder(catId)}`,
                textAlign: 'left'
              }}>
                    {CAT_BY_ID[catId]?.short || 'NF'}
                  </span>
              }
              </button>);

        })}
        </div>
      )}
    </div>);

}

// ─── main page ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 24;

export default function TCMArchive() {
  const [params, setParams] = useSearchParams();
  // Archive is UK-only now — Europe archive removed per request.
  const region = 'uk';

  // Local-first (instant render) + DB merge (cross-device sync)
  const [localArchive, setLocalArchive] = useState(() => loadArchive(region));
  const [dbArchive, setDbArchive] = useState([]);

  useEffect(() => {
    setLocalArchive(loadArchive(region));
  }, [region]);

  // Pull all archived days from the LightningArchive entity so every device
  // sees the full archive — not just days captured while this browser was open.
  // Archive entries are saved with region='global' (covers both UK & EU bboxes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await base44.entities.LightningArchive.list('-date', 500);
        if (cancelled || !Array.isArray(rows)) return;
        // Map DB rows → archive entry shape used by this page
        const mapped = rows.map((r) => ({
          date: r.date,
          capturedAt: r.captured_at,
          strikeCount: r.strike_count,
          ukCount: r.uk_count,
          euCount: r.eu_count,
          peakHour: r.peak_hour,
          strikes: r.strikes || [],
          level: r.level || null,
          narrative: r.narrative || null,
          verified: r.verified || false,
        }));
        setDbArchive(mapped);
      } catch (e) {
        console.warn('[TCMArchive] LightningArchive fetch failed:', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [region]);

  // Merge local + DB, dedup by date (DB wins for shared fields, local keeps strikes if DB is empty)
  const archive = useMemo(() => {
    const map = new Map();
    for (const e of localArchive) if (e?.date) map.set(e.date, e);
    for (const e of dbArchive) {
      if (!e?.date) continue;
      const existing = map.get(e.date);
      if (existing) {
        map.set(e.date, {
          ...existing,
          ...e,
          strikes: (e.strikes && e.strikes.length) ? e.strikes : existing.strikes,
        });
      } else {
        map.set(e.date, e);
      }
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [localArchive, dbArchive]);

  // Default view month = latest entry's month, or current month.
  const latestKey = useMemo(() => {
    if (!archive.length) return monthKey(new Date());
    const sorted = [...archive].sort((a, b) => b.date.localeCompare(a.date));
    const d = new Date(sorted[0].date);
    return monthKey(d);
  }, [archive]);

  const initialKey = params.get('mcac_month') || latestKey;
  const [viewYear, setViewYear] = useState(() => Number(initialKey.split('-')[0]));
  const [viewMonth, setViewMonth] = useState(() => Number(initialKey.split('-')[1]) - 1);

  // Pending dropdown selections (applied on "Go")
  const [pendingYear, setPendingYear] = useState(viewYear);
  const [pendingMonth, setPendingMonth] = useState(viewMonth);
  const [pendingCat, setPendingCat] = useState('all');
  const [catFilter, setCatFilter] = useState('all');

  const [search, setSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState(params.get('date') || null);
  const [listView, setListView] = useState(false);
  // DB model runs — loaded once on mount, used in detail panel
  const [allDbRuns, setAllDbRuns] = useState([]);
  const [loadingDbRuns, setLoadingDbRuns] = useState(false);
  // Admin drawn outlooks — loaded per-date when a day is selected
  const [drawnOutlooks, setDrawnOutlooks] = useState([]);
  const [loadingDrawn, setLoadingDrawn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState(1);
  const searchRef = useRef(null);

  // Load all DB model runs for run-switcher in detail panel
  useEffect(() => {
    let cancelled = false;
    setLoadingDbRuns(true);
    listRunsFromDB(region).then(rows => {
      if (!cancelled) setAllDbRuns(rows);
      if (!cancelled) setLoadingDbRuns(false);
    }).catch(() => { if (!cancelled) setLoadingDbRuns(false); });
    return () => { cancelled = true; };
  }, [region]);

  // Check admin
  useEffect(() => {
    import('@/lib/tcmFetchPolicy').then(m => m.isCurrentUserAdmin()).then(setIsAdmin).catch(() => {});
  }, []);

  // Load drawn outlooks when a date is selected
  useEffect(() => {
    if (!selectedDate) { setDrawnOutlooks([]); return; }
    let cancelled = false;
    setLoadingDrawn(true);
    loadAdminDrawnOutlooksForDate(region, selectedDate).then(rows => {
      if (!cancelled) setDrawnOutlooks(rows);
      if (!cancelled) setLoadingDrawn(false);
    }).catch(() => { if (!cancelled) setLoadingDrawn(false); });
    return () => { cancelled = true; };
  }, [selectedDate, region]);

  const byDate = useMemo(() => {
    const m = new Map();
    for (const e of archive) m.set(e.date, e);
    return m;
  }, [archive]);

  const selected = useMemo(
    () => archive.find((e) => e.date === selectedDate) || null,
    [archive, selectedDate]
  );

  // Years available (from data + current)
  const years = useMemo(() => {
    const s = new Set(archive.map((e) => Number(e.date.slice(0, 4))));
    s.add(new Date().getUTCFullYear());
    s.add(viewYear);
    return [...s].sort((a, b) => b - a);
  }, [archive, viewYear]);

  // Full filtered + sorted list for the list view / chronological feed
  const feed = useMemo(() => {
    let out = [...archive].sort((a, b) => b.date.localeCompare(a.date));
    if (catFilter !== 'all') out = out.filter((e) => categoryOf(e.level) === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((e) =>
      e.date.includes(q) ||
      (e.narrative || '').toLowerCase().includes(q) ||
      (e.level || '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [archive, catFilter, search]);

  const pageCount = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
  const pagedFeed = useMemo(
    () => feed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [feed, page]
  );

  // Header stats
  const highPlus = useMemo(
    () => archive.filter((e) => ['High', 'Severe', 'Extreme'].includes(e.level)).length,
    [archive]
  );
  const thisMonthCount = useMemo(() => {
    const k = monthKey(new Date());
    return archive.filter((e) => e.date.startsWith(k)).length;
  }, [archive]);

  // Sync URL
  useEffect(() => {
    const next = new URLSearchParams(params);
    next.set('region', region);
    next.set('mcac_month', `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}`);
    if (selectedDate) next.set('date', selectedDate);else next.delete('date');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, viewYear, viewMonth, selectedDate]);

  // Keyboard: Esc closes detail, / focuses search
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setSelectedDate(null);
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const shiftMonth = useCallback((delta) => {
    setSelectedDate(null);
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {m = 11;y -= 1;}
    if (m > 11) {m = 0;y += 1;}
    setViewMonth(m);
    setViewYear(y);
    setPendingMonth(m);
    setPendingYear(y);
  }, [viewMonth, viewYear]);

  const goToCurrentMonth = useCallback(() => {
    const d = new Date();
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
    setPendingYear(d.getUTCFullYear());
    setPendingMonth(d.getUTCMonth());
    setSelectedDate(null);
  }, []);

  const applyGo = useCallback(() => {
    setViewYear(pendingYear);
    setViewMonth(pendingMonth);
    setCatFilter(pendingCat);
    setPage(1);
    setSelectedDate(null);
  }, [pendingYear, pendingMonth, pendingCat]);

  const monthEntryCount = useMemo(() => {
    const k = `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}`;
    return archive.filter((e) => e.date.startsWith(k)).length;
  }, [archive, viewYear, viewMonth]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080d1a',
      color: '#cbd5e1',
      fontFamily: "'Syne', system-ui, sans-serif"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.15); border-radius: 99px }

        .tcma-root::before {
          content: '';
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background: repeating-linear-gradient(
            0deg, transparent, transparent 2px,
            rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px
          );
        }
        .tcma-search:focus {
          outline: none;
          border-color: rgba(56,189,248,0.5) !important;
          box-shadow: 0 0 0 3px rgba(56,189,248,0.1);
        }
        .region-btn-active {
          background: rgba(56,189,248,0.15) !important;
          color: #38bdf8 !important;
          border-color: rgba(56,189,248,0.4) !important;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.6); }
        }
        .feed-row:hover { background: rgba(255,255,255,0.04) !important; }
      `}</style>

      <div className="tcma-root" style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(8,13,26,0.85)',
          backdropFilter: 'blur(16px)',
          position: 'sticky', top: 0, zIndex: 10
        }}>
          <div style={{
            maxWidth: 1280, margin: '0 auto', padding: '0 24px',
            display: 'flex', alignItems: 'center', gap: 12, height: 56
          }}>
            <Link to="/TCMOutlooks" style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              color: '#475569', textDecoration: 'none',
              fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase', padding: '5px 9px', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              <ChevronLeft style={{ width: 12, height: 12 }} />
              TCM
            </Link>

            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 'clamp(0.95rem, 2vw, 1.2rem)', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                Outlook Archive
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse-dot 2s ease-in-out infinite' }} />
                <span style={{ fontSize: '0.62rem', color: '#22c55e', fontFamily: "'Space Mono',monospace", fontWeight: 700 }}>LIVE</span>
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{
              padding: '5px 12px', borderRadius: 6, fontSize: '0.68rem', fontWeight: 800,
              background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.25)',
              color: '#38bdf8', letterSpacing: '0.04em'
            }}>
              🇬🇧 UK & Ireland
            </div>
          </div>
        </header>

        {/* ── Stat strip ─────────────────────────────────────────────────── */}
        {archive.length > 0 &&
        <div style={{ background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ maxWidth: 1280, margin: '0 auto', padding: '12px 24px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <StatPill icon={Calendar} label="Total days" value={archive.length} accent="#38bdf8" />
              <StatPill icon={Zap} label="High+" value={highPlus} accent="#f59e0b" />
              <StatPill icon={Clock} label="This month" value={thisMonthCount} accent="#a78bfa" />
              <StatPill icon={CloudLightning} label="Regions" value={2} accent="#34d399" />
            </div>
          </div>
        }

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 24px 60px' }}>

          {/* Month title + prev/current/next */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            flexWrap: 'wrap', marginBottom: 16
          }}>
            <h2 style={{
              margin: 0, fontSize: 'clamp(1.3rem, 3vw, 1.9rem)', fontWeight: 800,
              color: '#f1f5f9', letterSpacing: '-0.03em'
            }}>
              {MONTH_NAMES[viewMonth]} <span style={{ color: '#38bdf8' }}>{viewYear}</span>
            </h2>
            <span style={{ fontSize: '0.66rem', color: '#475569', fontFamily: "'Space Mono',monospace" }}>
              {monthEntryCount} outlook{monthEntryCount !== 1 ? 's' : ''}
            </span>

            <div style={{ flex: 1 }} />

            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => shiftMonth(-1)} style={navBtn}>
                <ChevronLeft style={{ width: 12, height: 12 }} /> Previous
              </button>
              <button onClick={goToCurrentMonth} style={{ ...navBtn, color: '#38bdf8', borderColor: 'rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.08)' }}>
                Current Month
              </button>
              <button onClick={() => shiftMonth(1)} style={navBtn}>
                Next <ChevronRight style={{ width: 12, height: 12 }} />
              </button>
            </div>
          </div>

          {/* Controls row: Year / Month / Category + Go, search, view toggle */}
          <div style={{
            display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
            marginBottom: 14
          }}>
            <Dropdown
              value={String(pendingYear)}
              onChange={(v) => setPendingYear(Number(v))}
              width={90}
              options={years.map((y) => ({ value: String(y), label: String(y) }))} />
            
            <Dropdown
              value={String(pendingMonth)}
              onChange={(v) => setPendingMonth(Number(v))}
              width={130}
              options={MONTH_NAMES.map((m, i) => ({ value: String(i), label: m }))} />
            
            <Dropdown
              value={pendingCat}
              onChange={setPendingCat}
              width={170}
              options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
            
            <button onClick={applyGo} style={{
              padding: '7px 18px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 800,
              background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.4)',
              color: '#38bdf8', cursor: 'pointer', fontFamily: "'Space Mono',monospace",
              letterSpacing: '0.08em', boxShadow: '0 0 12px rgba(56,189,248,0.15)'
            }}>
              GO
            </button>

            <div style={{ flex: 1, minWidth: 12 }} />

            {/* Search */}
            <div style={{ position: 'relative', flex: '0 1 240px', minWidth: 180 }}>
              <Search style={{ width: 13, height: 13, color: '#334155', position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                ref={searchRef}
                className="tcma-search"
                type="text" value={search}
                onChange={(e) => {setSearch(e.target.value);setPage(1);}}
                placeholder="Search… ( / )"
                style={{
                  width: '100%', padding: '8px 32px 8px 34px', borderRadius: 9,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e2e8f0', fontSize: '0.76rem', fontFamily: 'inherit'
                }} />
              
              {search &&
              <button onClick={() => setSearch('')} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 3,
                color: '#475569', display: 'flex'
              }}>
                  <X style={{ width: 12, height: 12 }} />
                </button>
              }
            </div>

            {/* Grid / list toggle */}
            <div style={{ display: 'flex', gap: 3, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 3 }}>
              <button onClick={() => setListView(false)} title="Calendar view"
              style={{ ...toggleBtn, ...(listView ? {} : toggleActive) }}>
                <Grid3x3 style={{ width: 13, height: 13 }} />
              </button>
              <button onClick={() => setListView(true)} title="List view"
              style={{ ...toggleBtn, ...(listView ? toggleActive : {}) }}>
                <List style={{ width: 13, height: 13 }} />
              </button>
            </div>
          </div>

          {/* Legend */}
          <div style={{ marginBottom: 18 }}>
            <LegendStrip />
          </div>

          {/* Empty archive */}
          {archive.length === 0 &&
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            style={{
              padding: '60px 40px', textAlign: 'center',
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 16
            }}>
              <div style={{
              width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px',
              background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
                <Calendar style={{ width: 24, height: 24, color: '#38bdf8' }} />
              </div>
              <p style={{ margin: '0 0 8px', fontSize: '1rem', color: '#f1f5f9', fontWeight: 800 }}>
                Archive is empty
              </p>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', maxWidth: 340, marginInline: 'auto', lineHeight: 1.7 }}>
                Outlooks are automatically archived at 23:59 UTC each day. Check back later or switch region.
              </p>
            </motion.div>
          }

          {/* Main split: calendar/list + detail */}
          {archive.length > 0 &&
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 20, alignItems: 'flex-start'
          }}>
              <div>
                {/* CALENDAR VIEW */}
                {!listView &&
              <motion.div
                key={`${viewYear}-${viewMonth}`}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}>
                    <CalendarGrid
                  year={viewYear}
                  month={viewMonth}
                  byDate={byDate}
                  selectedDate={selectedDate}
                  onPick={setSelectedDate} />
                
                    {monthEntryCount === 0 &&
                <p style={{ textAlign: 'center', marginTop: 16, fontSize: '0.74rem', color: '#475569' }}>
                        No archived outlooks for this month. Use Previous / Next to browse.
                      </p>
                }
                  </motion.div>
              }

                {/* LIST VIEW (chronological feed, paginated) */}
                {listView &&
              <div>
                    <div style={{
                  borderRadius: 12, overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.08)'
                }}>
                      {pagedFeed.length === 0 &&
                  <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                          <p style={{ margin: '0 0 4px', color: '#94a3b8', fontSize: '0.9rem', fontWeight: 700 }}>
                            No outlooks match
                          </p>
                          <button onClick={() => {setSearch('');setCatFilter('all');setPendingCat('all');}} style={{
                      marginTop: 12, padding: '6px 14px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700,
                      background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)',
                      color: '#38bdf8', cursor: 'pointer', fontFamily: 'inherit'
                    }}>
                            Clear filters
                          </button>
                        </div>
                  }
                      {pagedFeed.map((entry, i) => {
                    const catId = categoryOf(entry.level);
                    const isSel = selected?.date === entry.date;
                    const d = new Date(entry.date);
                    return (
                      <button
                        key={entry.date}
                        className="feed-row"
                        onClick={() => setSelectedDate(isSel ? null : entry.date)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                          padding: '11px 16px', cursor: 'pointer', textAlign: 'left',
                          background: isSel ? 'rgba(56,189,248,0.08)' : 'transparent',
                          border: 'none',
                          borderBottom: i < pagedFeed.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                          borderLeft: `3px solid ${isSel ? '#38bdf8' : catColor(catId)}`,
                          transition: 'background 0.15s'
                        }}>
                            <span style={{
                          fontSize: '0.74rem', fontWeight: 700, color: '#e2e8f0',
                          fontFamily: "'Space Mono',monospace", minWidth: 142
                        }}>
                              {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                            <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '3px 10px', borderRadius: 6,
                          background: catFill(catId), border: `1px solid ${catBorder(catId)}`,
                          fontSize: '0.62rem', fontWeight: 800, color: catColor(catId),
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                          fontFamily: "'Space Mono',monospace", flexShrink: 0
                        }}>
                              <span style={{ width: 7, height: 7, borderRadius: 2, background: catColor(catId) }} />
                              {CAT_BY_ID[catId]?.short || 'NF'}
                            </span>
                            <span style={{
                          flex: 1, fontSize: '0.7rem', color: '#64748b',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}>
                              {entry.issued ?
                          `Issued ${entry.issued}` :
                          entry.narrative ?
                          entry.narrative :
                          CAT_BY_ID[catId]?.id === 'NF' ? 'No forecast issued' : 'Mesocast Outlook'}
                            </span>
                            <ChevronRight style={{ width: 13, height: 13, color: '#334155', flexShrink: 0 }} />
                          </button>);

                  })}
                    </div>

                    {/* Pagination */}
                    {pageCount > 1 &&
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 18 }}>
                        <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    style={{ ...pageBtn, opacity: page === 1 ? 0.4 : 1 }}>
                          <ChevronLeft style={{ width: 12, height: 12 }} />
                        </button>
                        {Array.from({ length: pageCount }, (_, i) => i + 1).
                  filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === pageCount).
                  map((p, idx, arr) =>
                  <React.Fragment key={p}>
                              {idx > 0 && p - arr[idx - 1] > 1 &&
                    <span style={{ color: '#334155', fontSize: '0.7rem' }}>…</span>
                    }
                              <button
                      onClick={() => setPage(p)}
                      style={{
                        ...pageBtn,
                        minWidth: 30,
                        background: p === page ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.04)',
                        color: p === page ? '#38bdf8' : '#64748b',
                        borderColor: p === page ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.08)'
                      }}>
                                {p}
                              </button>
                            </React.Fragment>
                  )}
                        <button
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={page === pageCount}
                    style={{ ...pageBtn, opacity: page === pageCount ? 0.4 : 1 }}>
                          <ChevronRight style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                }
                  </div>
              }
              </div>

              {/* ── DETAIL PANEL — full-screen popup modal ──────────────────── */}
              {createPortal(
              <AnimatePresence>
                {selected &&
              <motion.div
                key="tcma-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSelectedDate(null)}
                style={{
                  position: 'fixed', inset: 0, zIndex: 1000,
                  background: 'rgba(4,8,18,0.78)', backdropFilter: 'blur(6px)',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                  padding: '32px 20px', overflowY: 'auto'
                }}>
                <motion.div
                  key={selected.date}
                  initial={{ opacity: 0, scale: 0.96, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 12 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: '100%', maxWidth: 960, margin: 'auto 0' }}>
                    <div style={{
                  background: 'rgba(12,18,35,0.98)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 16, overflow: 'hidden',
                  boxShadow: '0 30px 90px rgba(0,0,0,0.6)'
                }}>
                      {/* Panel header */}
                      <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(255,255,255,0.02)'
                  }}>
                        <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: catColor(categoryOf(selected.level)),
                      boxShadow: `0 0 8px ${catColor(categoryOf(selected.level))}`
                    }} />
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
                          {new Date(selected.date).toLocaleDateString(undefined, {
                        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                      })}
                        </span>
                        <div style={{ flex: 1 }} />
                        <VerificationBadge entry={selected} />
                        <button onClick={() => setSelectedDate(null)} style={{
                      width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#64748b', cursor: 'pointer'
                    }}>
                          <X style={{ width: 11, height: 11 }} />
                        </button>
                      </div>

                      {/* Risk tag */}
                      <div style={{ padding: '10px 16px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 6,
                      background: catFill(categoryOf(selected.level)),
                      border: `1px solid ${catBorder(categoryOf(selected.level))}`,
                      fontSize: '0.68rem', fontWeight: 800,
                      color: catColor(categoryOf(selected.level)),
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      fontFamily: "'Space Mono',monospace"
                    }}>
                          <Zap style={{ width: 10, height: 10 }} />
                          {CAT_BY_ID[categoryOf(selected.level)]?.label || 'No Forecast'}
                        </div>
                        <span style={{ fontSize: '0.62rem', color: '#475569', fontFamily: "'Space Mono',monospace" }}>
                          06Z outlook
                        </span>
                      </div>

                      {/* Model-run toggle: compare past forecasts at 00/06/12/18Z vs observed */}
                      <div style={{ marginTop: 12 }}>
                        <ArchiveRunSwitcher
                          date={selected.date}
                          region={region}
                          observedLevel={selected.level}
                          observedScore={selected.score} />
                      </div>

                      {/* DB model runs for this date */}
                      {(() => {
                        const dateRuns = allDbRuns.filter(r => r.runISO && r.runISO.startsWith(selected.date));
                        if (loadingDbRuns) return (
                          <div style={{ padding:'8px 16px', display:'flex', alignItems:'center', gap:6 }}>
                            <Loader2 className="animate-spin" style={{width:11,height:11,color:'#38bdf8'}}/>
                            <span style={{ fontSize:'0.66rem', color:'#475569' }}>Loading model runs…</span>
                          </div>
                        );
                        if (dateRuns.length === 0) return null;
                        return (
                          <div style={{ margin:'8px 16px 0', padding:'10px 12px', borderRadius:10, background:'rgba(56,189,248,0.05)', border:'1px solid rgba(56,189,248,0.15)' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                              <Database style={{width:11,height:11,color:'#38bdf8'}}/>
                              <span style={{ fontSize:'0.62rem', fontWeight:800, color:'#38bdf8', textTransform:'uppercase', letterSpacing:'0.08em' }}>Model Runs This Day</span>
                              <span style={{ fontSize:'0.58rem', color:'#475569' }}>{dateRuns.length} saved</span>
                            </div>
                            <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                              {dateRuns.map(r => {
                                const d = r.runISO ? new Date(r.runISO) : null;
                                const label = d ? d.getUTCHours().toString().padStart(2,'0')+'Z' : r.cacheKey;
                                const genLabel = r.generatedAt ? new Date(r.generatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '';
                                return (
                                  <div key={r.cacheKey} style={{ padding:'5px 9px', borderRadius:7, background:'rgba(56,189,248,0.1)', border:'1px solid rgba(56,189,248,0.25)', fontSize:'0.68rem', color:'#94a3b8', fontFamily:"'DM Mono',monospace" }}>
                                    <span style={{ fontWeight:800, color:'#38bdf8' }}>{label}</span>
                                    {genLabel && <span style={{ fontSize:'0.58rem', color:'#475569', marginLeft:5 }}>{genLabel}</span>}
                                    <span style={{ fontSize:'0.58rem', color:'#334155', marginLeft:5 }}>{r.points}pts</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Admin drawn outlooks for this date */}
                      {drawnOutlooks.length > 0 && (
                        <div style={{ margin:'8px 16px 0', padding:'10px 12px', borderRadius:10, background:'rgba(245,158,11,0.05)', border:'1px solid rgba(245,158,11,0.2)' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                            <PenLine style={{width:11,height:11,color:'#f59e0b'}}/>
                            <span style={{ fontSize:'0.62rem', fontWeight:800, color:'#f59e0b', textTransform:'uppercase', letterSpacing:'0.08em' }}>Admin Drawn Outlooks</span>
                            <span style={{ fontSize:'0.58rem', color:'#475569' }}>{drawnOutlooks.length} saved</span>
                          </div>
                          {drawnOutlooks.map((outlook, oi) => (
                            <div key={oi} style={{ marginBottom:6, padding:'6px 9px', borderRadius:7, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                                <span style={{ fontSize:'0.68rem', fontWeight:700, color:'#f1f5f9' }}>{outlook.label || 'Drawn Outlook'}</span>
                                <span style={{ fontSize:'0.6rem', color:'#475569' }}>
                                  {outlook.createdAt ? new Date(outlook.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' UTC' : ''}
                                </span>
                                {isAdmin && (
                                  <button onClick={async () => {
                                    // Find the DB row id
                                    try {
                                      const rows = await base44.entities.RiskGridCache.list('-generated_at', 200);
                                      const row = rows.find(r => r.grid_data?.createdAt === outlook.createdAt);
                                      if (row?.id) { await deleteAdminDrawnOutlook(row.id); }
                                      const updated = await import('@/lib/tcmForecastCache').then(m => m.loadAdminDrawnOutlooksForDate(region, selected.date));
                                      setDrawnOutlooks(updated);
                                    } catch {}
                                  }} style={{ marginLeft:'auto', padding:'2px 6px', borderRadius:5, background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171', fontSize:'0.6rem', cursor:'pointer' }}>
                                    <Trash2 style={{width:9,height:9}}/>
                                  </button>
                                )}
                              </div>
                              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                                {(outlook.shapes || []).map((s, si) => (
                                  <span key={si} style={{ fontSize:'0.6rem', padding:'2px 7px', borderRadius:5, background: s.color || 'rgba(245,158,11,0.2)', border:`1px solid ${s.border || '#f59e0b'}`, color: s.border || '#f59e0b', fontWeight:700 }}>
                                    {s.riskLevel}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {loadingDrawn && (
                        <div style={{ padding:'6px 16px', display:'flex', alignItems:'center', gap:5 }}>
                          <Loader2 className="animate-spin" style={{width:10,height:10,color:'#f59e0b'}}/>
                          <span style={{ fontSize:'0.62rem', color:'#475569' }}>Loading drawn outlooks…</span>
                        </div>
                      )}

                      <div style={{ padding: '10px 16px 0' }}>
                        <ArchiveSummaryCard entry={selected} compact={false} />
                      </div>

                      <div style={{ padding: '0 16px 16px', marginTop: 12 }}>
                        <ArchiveMapPanel entry={{ ...selected, region }} height={Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.62)} />
                      </div>

                      {/* Prev / next entry nav */}
                      {(() => {
                    const sorted = [...archive].sort((a, b) => b.date.localeCompare(a.date));
                    const idx = sorted.findIndex((e) => e.date === selected.date);
                    const prev = sorted[idx + 1];
                    const next = sorted[idx - 1];
                    return (
                      <div style={{
                        padding: '10px 16px',
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex', justifyContent: 'space-between', gap: 8
                      }}>
                            {prev ?
                        <button onClick={() => setSelectedDate(prev.date)} style={entryNavBtn}>
                                <ChevronLeft style={{ width: 11, height: 11 }} />
                                {new Date(prev.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                              </button> :
                        <div />}
                            {next ?
                        <button onClick={() => setSelectedDate(next.date)} style={entryNavBtn}>
                                {new Date(next.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                <ChevronRight style={{ width: 11, height: 11 }} />
                              </button> :
                        <div />}
                          </div>);

                  })()}
                    </div>
                  </motion.div>
                </motion.div>
              }
              </AnimatePresence>,
              document.body)}
            </div>
          }
        </div>
      </div>
    </div>);

}

// ─── shared inline style objects ─────────────────────────────────────────────

const navBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 12px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.03em'
};

const toggleBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: '1px solid transparent', color: '#64748b'
};
const toggleActive = {
  background: 'rgba(56,189,248,0.15)', color: '#38bdf8',
  border: '1px solid rgba(56,189,248,0.4)'
};

const pageBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 30, padding: '0 9px', borderRadius: 7, cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  color: '#64748b', fontSize: '0.7rem', fontWeight: 700,
  fontFamily: "'Space Mono',monospace"
};

const entryNavBtn = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '5px 10px', borderRadius: 7,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  color: '#94a3b8', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700,
  fontFamily: 'inherit'
};