/* ════════════════════════════════════════════════════════════════════════════
   WarningsArchiveModal — every UK weather warning on record, in liquid glass.

   Reads /api/warning-archive: every warning the site has seen since it started
   recording (each refresh of the Met Office feed writes one durable row per
   warning, and now keeps its real shape and its full Met Office detail) plus the
   warnings issued here by hand.

     left    what the archive holds (totals for the filters in force), a search
             across types, wording, regions and councils, severity and type
             filters, the year at a glance and the month as a calendar, each day
             coloured by its worst warning
     right   the warnings for the chosen day, the month, or the whole archive;
             each opens into its map and everything the Met Office said

   THE CALENDAR STARTS AT 1 JANUARY 2026. Days before the archive began
   recording are hatched rather than left blank: "no warnings that day" and
   "nothing was being recorded yet" are different claims, and a blank square
   makes the second look like the first.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import WarningMap from '@/components/WarningMap';
import { groupAreas, SEV_HEX, sevInkOn, WarningDetailBody } from '@/components/warnings/MetOfficeWarning';
import './warnings-glass.css';

const SEVS = ['Red', 'Amber', 'Yellow'];
const RANK = { Red: 3, Amber: 2, Yellow: 1 };
const TZ = 'Europe/London';
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const capSev = (s) => { const v = String(s || '').toLowerCase(); return v === 'red' ? 'Red' : v === 'amber' ? 'Amber' : 'Yellow'; };
const monthName = (ym, opts = { month: 'long', year: 'numeric' }) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/* An archive row (stored in snake_case) as the warning the map and the detail read. Built once
   per load: WarningMap rebuilds its map whenever its warning changes identity. */
function toWarning(r) {
  const g = r.geometry && (r.geometry.type === 'Polygon' || r.geometry.type === 'MultiPolygon') ? r.geometry : null;
  const areas = groupAreas({ areas: r.areas, regions: r.regions || [] });
  return {
    ...r,
    severity: capSev(r.severity),
    validFrom: r.valid_from,
    validTo: r.valid_to || null,
    whatToExpect: r.what_to_expect,
    furtherDetails: r.further_details,
    impactLevel: r.impact_level,
    issuedDate: r.issued_at,
    warningVersion: r.version,
    geometry: g,
    polygons: g ? [g] : undefined,
    manual: r.issued_by === 'manual',
    regionNames: areas.map((a) => a.region),
    search: [r.type, r.description, r.headline, ...(r.regions || []), ...areas.flatMap((a) => [a.region, ...(a.authorities || [])])]
      .filter(Boolean).join(' ').toLowerCase(),
  };
}

function when(w) {
  const f = new Date(w.validFrom), t = w.validTo ? new Date(w.validTo) : null;
  if (Number.isNaN(f.getTime())) return '';
  const day = (x) => x.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const hm = (x) => x.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  if (!t || Number.isNaN(t.getTime()) || t < f) return `${day(f)} ${hm(f)} onwards`;   // an end before the start was a typing slip
  const h = Math.round((t - f) / 36e5);
  const dur = h > 0 ? (h < 24 ? `${h} h` : `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`) : '';
  return `${day(f)} ${hm(f)} – ${day(f) === day(t) ? '' : `${day(t)} `}${hm(t)}${dur ? ` · ${dur}` : ''}`;
}

function ArchiveCard({ w, open, onToggle }) {
  const more = w.regionNames.length - 4;
  return (
    <div className={`wa-card${open ? ' is-open' : ''}`} style={{ '--wg-sev': SEV_HEX[w.severity] }}>
      <button type="button" className="wa-card-hit" onClick={onToggle} aria-expanded={open}>
        <span className="wa-card-badge" style={{ color: sevInkOn(w.severity) }}><AlertTriangle fill="currentColor" fillOpacity={0.18} strokeWidth={2.2} /></span>
        <span className="wa-card-main">
          <span className="wa-card-top">
            <b>{w.severity} · {w.type}</b>
            {w.manual && <span className="wa-tag">Issued here</span>}
            {w.versions > 1 && <span className="wa-tag">Updated</span>}
          </span>
          <span className="wa-when">{when(w)}</span>
          {w.description && !open && <span className="wa-desc">{w.description}</span>}
          {w.regionNames.length > 0 && !open && (
            <span className="wa-areas">{w.regionNames.slice(0, 4).join(' · ')}{more > 0 ? ` +${more}` : ''}</span>
          )}
        </span>
        <ChevronDown className="wa-chev" size={18} />
      </button>
      {open && (
        <div className="wa-card-more">
          <div className="wa-card-map"><WarningMap warning={w} height={250} /></div>
          <WarningDetailBody warning={w} flat />
        </div>
      )}
    </div>
  );
}

export default function WarningsArchiveModal({ isOpen, onClose }) {
  const { isDark } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sevs, setSevs] = useState([]);       // empty = every severity
  const [types, setTypes] = useState([]);     // empty = every type
  const [q, setQ] = useState('');
  const [month, setMonth] = useState(null);   // 'YYYY-MM' on show
  const [day, setDay] = useState(null);       // 'YYYY-MM-DD' chosen
  const [scope, setScope] = useState('month');
  const [open, setOpen] = useState(null);     // the expanded card
  const rightRef = useRef(null);

  /* fresh on every opening (a warning may have been archived since) */
  useEffect(() => {
    if (!isOpen) return undefined;
    let live = true;
    setError(null);
    fetch('/api/warning-archive')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (live) setData(j); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [isOpen, onClose]);

  const all = useMemo(() => (data?.warnings || []).map(toWarning)
    .sort((a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || ''))), [data]);

  const typeCounts = useMemo(() => {
    const c = {};
    for (const w of all) c[w.type] = (c[w.type] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [all]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((w) => (!sevs.length || sevs.includes(w.severity))
      && (!types.length || types.includes(w.type))
      && (!needle || w.search.includes(needle)));
  }, [all, sevs, types, q]);

  const epoch = data?.epoch || '2026-01-01';
  /* each day's worst warning and its count by severity, for what is shown */
  const days = useMemo(() => {
    const out = {};
    for (const w of shown) {
      for (const d of w.days || []) {
        if (d < epoch) continue;
        const o = out[d] || (out[d] = { top: 'Yellow', n: 0, c: { Red: 0, Amber: 0, Yellow: 0 } });
        o.n += 1; o.c[w.severity] += 1;
        if (RANK[w.severity] > RANK[o.top]) o.top = w.severity;
      }
    }
    return out;
  }, [shown, epoch]);

  const months = useMemo(() => {
    const out = {};
    for (const [d, o] of Object.entries(days)) {
      const m = out[d.slice(0, 7)] || (out[d.slice(0, 7)] = { days: 0, top: 'Yellow' });
      m.days += 1;
      if (RANK[o.top] > RANK[m.top]) m.top = o.top;
    }
    return out;
  }, [days]);

  /* open on the latest month with anything in it, not on an empty current month */
  useEffect(() => {
    if (!data || month) return;
    const withData = Object.keys(days).sort();
    setMonth((withData.length ? withData[withData.length - 1] : ymd(new Date())).slice(0, 7));
  }, [data, days, month]);

  useEffect(() => { if (!isOpen) { setOpen(null); } }, [isOpen]);

  if (typeof document === 'undefined' || !isOpen) return null;

  const today = ymd(new Date());
  const thisMonth = today.slice(0, 7);
  const recording = (data?.recordingSince ? ymd(new Date(data.recordingSince)) : today);
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filtersOn = sevs.length + types.length + (q.trim() ? 1 : 0);

  /* the month as a Monday-first calendar */
  const cells = [];
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let d = 1; d <= total; d += 1) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  const year = month ? Number(month.slice(0, 4)) : new Date().getFullYear();
  const yearMax = Math.max(1, ...Object.entries(months).filter(([k]) => k.startsWith(`${year}-`)).map(([, v]) => v.days));

  /* what the right-hand side lists */
  const pick = scope === 'day' && day
    ? shown.filter((w) => (w.days || []).includes(day)).sort((a, b) => RANK[b.severity] - RANK[a.severity] || String(a.validFrom).localeCompare(String(b.validFrom)))
    : scope === 'month' && month
      ? shown.filter((w) => (w.days || []).some((d) => d.startsWith(month)))
      : shown;
  /* the whole archive reads as months, newest first */
  const groups = [];
  if (scope === 'all') {
    for (const w of pick) {
      const k = String(w.validFrom || '').slice(0, 7) || 'Undated';
      if (groups.at(-1)?.k !== k) groups.push({ k, list: [] });
      groups.at(-1).list.push(w);
    }
  } else groups.push({ k: null, list: pick });
  const title = scope === 'day' && day
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : scope === 'month' && month ? monthName(month) : 'Every warning';

  const chooseDay = (iso) => {
    if (day === iso && scope === 'day') { setDay(null); setScope('month'); return; }
    setDay(iso); setScope('day'); setOpen(null);
    if (window.matchMedia('(max-width: 860px)').matches) setTimeout(() => rightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const topType = typeCounts.length ? Object.entries(shown.reduce((c, w) => ({ ...c, [w.type]: (c[w.type] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0] : null;
  const severe = shown.filter((w) => w.severity !== 'Yellow').length;

  return createPortal(
    <div className={`wg${isDark ? '' : ' is-light'}`} role="dialog" aria-modal="true" aria-label="Weather warnings archive" onClick={onClose}>
      <div className="wg-sheet wg-glass is-solid" onClick={(e) => e.stopPropagation()}>
        <div className="wa-head">
          <div>
            <h2>Warnings archive</h2>
            <p>
              {data
                ? `${all.length.toLocaleString()} warning${all.length === 1 ? '' : 's'} on record · recording since ${new Date(`${recording}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
                : 'Every Met Office warning the site has seen, and those issued here'}
            </p>
          </div>
          <button type="button" className="wg-btn wg-icon" onClick={onClose} aria-label="Close the archive"><X /></button>
        </div>

        {error ? (
          <div className="wa-loading"><span>The archive is unavailable right now ({error}).</span></div>
        ) : !data || !month ? (
          <div className="wa-loading"><Loader2 className="animate-spin" size={26} /><span>Loading the archive…</span></div>
        ) : (
          <div className="wa-body">
            <div className="wa-left">
              <div className="wa-stats">
                <div className="wa-stat"><span className="wg-label">Warnings</span><b>{shown.length.toLocaleString()}{filtersOn ? <small>of {all.length}</small> : null}</b></div>
                <div className="wa-stat"><span className="wg-label">Days warned</span><b>{Object.keys(days).length}</b></div>
                <div className="wa-stat"><span className="wg-label">Amber or red</span><b>{severe}</b></div>
                <div className="wa-stat"><span className="wg-label">Most often</span><b>{topType ? topType[0] : '—'}{topType ? <small>×{topType[1]}</small> : null}</b></div>
              </div>

              <div className="wa-search">
                <Search />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place, council or wording" aria-label="Search the archive" />
                {q && <button type="button" onClick={() => setQ('')} aria-label="Clear the search"><X size={14} /></button>}
              </div>

              <div className="wa-filters">
                <div>
                  {SEVS.map((s) => (
                    <button key={s} type="button" className="wg-chip" aria-pressed={sevs.includes(s)} onClick={() => toggle(sevs, setSevs, s)}>
                      <i style={{ background: SEV_HEX[s] }} />{s}<em>{all.filter((w) => w.severity === s).length}</em>
                    </button>
                  ))}
                </div>
                <div>
                  {typeCounts.map(([t, n]) => (
                    <button key={t} type="button" className="wg-chip" aria-pressed={types.includes(t)} onClick={() => toggle(types, setTypes, t)}>{t}<em>{n}</em></button>
                  ))}
                  {filtersOn > 0 && <button type="button" className="wg-chip" onClick={() => { setSevs([]); setTypes([]); setQ(''); }}>Clear</button>}
                </div>
              </div>

              {/* the year at a glance: how many days each month had a warning, in its worst colour */}
              <div>
                <div className="wa-year">
                  <button type="button" className="wg-btn wg-icon" onClick={() => setMonth(`${year - 1}-12`)} disabled={`${year - 1}-12` < epoch.slice(0, 7)} aria-label="Previous year"><ChevronLeft /></button>
                  <b>{year}</b>
                  <button type="button" className="wg-btn wg-icon" onClick={() => setMonth(`${year + 1}-01`)} disabled={`${year + 1}-01` > thisMonth} aria-label="Next year"><ChevronRight /></button>
                </div>
                <div className="wa-months" style={{ marginTop: 8 }}>
                  {MONTH_LETTERS.map((L, i) => {
                    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
                    const info = months[ym];
                    return (
                      <button key={ym} type="button" className={`wa-month${ym === month ? ' is-on' : ''}`} disabled={ym < epoch.slice(0, 7) || ym > thisMonth}
                        onClick={() => { setMonth(ym); setScope('month'); setDay(null); }} title={`${monthName(ym)}: ${info ? `${info.days} day${info.days === 1 ? '' : 's'} with a warning` : 'no warnings'}`}>
                        <i>{info && <span style={{ height: `${Math.max(14, (info.days / yearMax) * 100)}%`, background: SEV_HEX[info.top] }} />}</i>
                        {L}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="wa-cal-head">
                  <button type="button" className="wg-btn wg-icon" onClick={() => { setMonth(shiftMonth(month, -1)); setScope('month'); setDay(null); }} disabled={shiftMonth(month, -1) < epoch.slice(0, 7)} aria-label="Previous month"><ChevronLeft /></button>
                  <b>{monthName(month)}</b>
                  <button type="button" className="wg-btn wg-icon" onClick={() => { setMonth(shiftMonth(month, 1)); setScope('month'); setDay(null); }} disabled={shiftMonth(month, 1) > thisMonth} aria-label="Next month"><ChevronRight /></button>
                </div>
                <div className="wa-cal" style={{ marginTop: 10 }}>
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
                  {cells.map((iso, i) => {
                    if (!iso) return <span key={`pad${i}`} />;
                    const info = days[iso];
                    const hex = info ? SEV_HEX[info.top] : null;
                    const future = iso > today && !info;   // a future day is open only if a warning is already out for it
                    const unrecorded = !info && iso < recording;
                    return (
                      <button key={iso} type="button" disabled={future}
                        className={`wa-cell${info ? ' has' : ''}${iso === today ? ' is-today' : ''}${day === iso && scope === 'day' ? ' is-on' : ''}${unrecorded ? ' is-unrecorded' : ''}`}
                        style={hex ? { background: `${hex}33`, borderColor: `${hex}99` } : undefined}
                        onClick={() => chooseDay(iso)}
                        title={info ? SEVS.filter((s) => info.c[s]).map((s) => `${info.c[s]} ${s.toLowerCase()}`).join(', ') : unrecorded ? 'Before the archive began recording' : 'No warnings'}>
                        {Number(iso.slice(-2))}
                        <span className="wa-dots">{info && SEVS.filter((s) => info.c[s]).map((s) => <i key={s} style={{ background: SEV_HEX[s] }} />)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="wa-key">
                {SEVS.map((s) => <span key={s}><i style={{ background: SEV_HEX[s] }} />{s}</span>)}
                <span><i style={{ background: 'repeating-linear-gradient(135deg, var(--wg-ink3) 0 2px, transparent 2px 4px)' }} />Not yet recorded</span>
              </div>
              {month < recording.slice(0, 7) && (
                <p className="wa-note">Nothing was being recorded this month. The archive holds what it has seen since it started, plus warnings issued here by hand, so an empty day means no record, not no warning.</p>
              )}
            </div>

            <div className="wa-right" ref={rightRef}>
              <div className="wa-scope">
                <h3>{title}<small>{pick.length} warning{pick.length === 1 ? '' : 's'}{filtersOn ? ' matching the filters' : ''}</small></h3>
                <div className="wa-seg" role="group" aria-label="What to list">
                  <button type="button" aria-pressed={scope === 'day'} disabled={!day} onClick={() => setScope('day')}>Day</button>
                  <button type="button" aria-pressed={scope === 'month'} onClick={() => setScope('month')}>Month</button>
                  <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All</button>
                </div>
              </div>
              {pick.length === 0 ? (
                <div className="wa-empty">
                  <b>{filtersOn ? 'Nothing matches' : scope === 'day' ? 'No warnings this day' : 'No warnings'}</b>
                  {filtersOn ? 'Try fewer filters, or a different search.' : scope === 'day' && day < recording ? 'This day is before the archive began recording.' : 'The Met Office issued no warnings on record for this period.'}
                </div>
              ) : groups.map((g) => (
                <div key={g.k || 'list'}>
                  {g.k && <div className="wa-group">{g.k === 'Undated' ? g.k : monthName(g.k)}</div>}
                  <div className="wa-list">
                    {g.list.map((w) => (
                      <ArchiveCard key={w.id} w={w} open={open === w.id} onToggle={() => setOpen(open === w.id ? null : w.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
