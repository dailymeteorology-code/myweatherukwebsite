/**
 * Weather Scenarios — "Explore every season of UK weather".
 *
 * A searchable, filterable reference to the weather the UK can produce,
 * month by month, built from a structured scenario database
 * (server/scenarios). Every count, list, matrix cell and comparison on this
 * page is derived from those records at load time — nothing is hardcoded.
 *
 * Views (URL ?view=…): overview, months (?m=jan), library, matrix, regions
 * (?r=region), compare (?cmp=a,b), seasons, history, about, live (the original
 * live-model dashboard), admin. Any view can open a scenario (?s=id).
 */
import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays, Library as LibraryIcon, Grid3x3, Map as MapIcon, Scale, CalendarRange, History, BookOpen, Activity, Settings2,
  Layers, ArrowRight, AlertTriangle, Info, Loader2,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { useAuth } from '@/lib/AuthContext';
import { useCatalogue, loadCatalogue } from '@/components/scenarios/scenarioApi';
import { overviewStats, monthCatalogue, SEV_RANK, MONTH_KEYS } from '@/components/scenarios/query';
import { WSX_CSS, SectionHead, Icon } from '@/components/scenarios/ui';
import { MonthGrid, MonthDetail } from '@/components/scenarios/MonthExplorer';
import Library, { EMPTY_FILTERS } from '@/components/scenarios/Library';
import { MatrixView, RegionView, CompareView, SeasonsView, HistoryView, AboutView } from '@/components/scenarios/Views';
import ScenarioDetail from '@/components/scenarios/ScenarioDetail';

const LiveScenarios = lazy(() => import('@/components/scenarios/LiveScenarios'));
const ScenarioAdmin = lazy(() => import('@/components/scenarios/ScenarioAdmin'));

const TABS = [
  ['overview', 'Overview', Layers], ['months', 'Month by month', CalendarDays], ['library', 'Scenario library', LibraryIcon],
  ['matrix', 'Annual matrix', Grid3x3], ['regions', 'Regions', MapIcon], ['compare', 'Compare', Scale],
  ['seasons', 'Seasons', CalendarRange], ['history', 'History', History], ['about', 'Methods & sources', BookOpen],
  ['live', 'Live model scenarios', Activity],
];

export default function WeatherScenarios() {
  const { isDark } = useTheme();
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const { data, error } = useCatalogue();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, q: params.get('q') || '' }));
  const [reload, setReload] = useState(0);

  const view = params.get('view') || 'overview';
  const mParam = params.get('m');
  const monthIdx = mParam ? MONTH_KEYS.indexOf(mParam) : -1;
  const now = new Date().getMonth();
  const focusMonth = monthIdx >= 0 ? monthIdx : now;
  const region = params.get('r') || null;
  const openId = params.get('s');
  const cmpIds = (params.get('cmp') || '').split(',').filter(Boolean);

  const update = useCallback((patch, { replace = false } = {}) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') p.delete(k); else p.set(k, v); }
    setParams(p, { replace });
  }, [params, setParams]);

  const go = (v) => { update({ view: v === 'overview' ? null : v }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openScenario = useCallback((id) => update({ s: id }), [update]);
  const closeScenario = useCallback(() => update({ s: null }), [update]);
  const openMonth = useCallback((i) => { update({ view: 'months', m: i == null ? null : MONTH_KEYS[i], s: null }); window.scrollTo({ top: 0 }); }, [update]);
  const setRegion = useCallback((r) => update({ r }), [update]);
  const toLibrary = useCallback((f) => { setFilters({ ...EMPTY_FILTERS, ...f }); update({ view: 'library', s: null }); window.scrollTo({ top: 0 }); }, [update]);
  const addCompare = useCallback((id) => { const next = [...new Set([...cmpIds, id])].slice(-4); update({ view: 'compare', cmp: next.join(','), s: null }); }, [cmpIds, update]);

  const tabs = isAdmin ? [...TABS, ['admin', 'Admin', Settings2]] : TABS;

  return (
    <div className={`wsx${isDark ? '' : ' light'}`}>
      <style>{WSX_CSS}</style>
      <Hero data={data} month={focusMonth} onMonth={openMonth} onTab={go} />
      <div className="wrap" style={{ position: 'sticky', top: 0, zIndex: 20, paddingTop: 8, paddingBottom: 8, background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
        <div role="tablist" aria-label="Weather Scenarios sections" className="tabs">
          {tabs.map(([id, label, I]) => (
            <button key={id} role="tab" type="button" className="tab" aria-selected={view === id} onClick={() => go(id)}><I size={14} aria-hidden="true" />{label}</button>
          ))}
        </div>
      </div>

      <main className="wrap" style={{ paddingTop: 20, paddingBottom: 60 }} key={reload}>
        {error && <div className="panel" role="alert" style={{ padding: 18 }}><p style={{ margin: 0 }}>The scenario library could not be loaded ({error.message}). The live model view still works.</p></div>}
        {!data && !error && view !== 'live' && <p className="muted" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading the scenario library…</p>}

        {data && view === 'overview' && <Overview data={data} month={focusMonth} region={region} onMonth={openMonth} onOpen={openScenario} onLibrary={toLibrary} onTab={go} setMonth={(i) => update({ m: MONTH_KEYS[i] }, { replace: true })} />}
        {data && view === 'months' && (monthIdx >= 0
          ? <MonthDetail data={data} month={monthIdx} region={region} onMonth={openMonth} onOpen={openScenario} onRegion={setRegion} onLibrary={toLibrary} />
          : (<><SectionHead icon={CalendarDays} title="Month-by-month explorer" sub="Each month has its own catalogue: what is typical, what is plausible, and what is uncommon or rare." /><MonthGrid data={data} onMonth={openMonth} region={region} /></>))}
        {data && view === 'library' && (<><SectionHead icon={LibraryIcon} title="Complete scenario library" sub="Search everyday or technical terms and combine filters — for example thunderstorms in July in South East England, or snow and ice in Scotland in January." /><Library data={data} filters={filters} setFilters={(f) => { setFilters(f); update({ q: f.q || null }, { replace: true }); }} onOpen={openScenario} onMonth={openMonth} /></>)}
        {data && view === 'matrix' && (<><SectionHead icon={Grid3x3} title="Annual scenario matrix" sub="Every scenario across the twelve months. Click a name to open it, or a cell to open that month." /><MatrixView data={data} onOpen={openScenario} onMonth={openMonth} /></>)}
        {data && view === 'regions' && (<><SectionHead icon={MapIcon} title="Regions of the UK" sub="The UK is not one climate. Select a region to see its local factors, its typical conditions and the scenarios that particularly concern it." /><RegionView data={data} region={region} setRegion={setRegion} month={focusMonth} setMonth={(i) => update({ m: MONTH_KEYS[i] }, { replace: true })} onOpen={openScenario} onLibrary={toLibrary} isDark={isDark} /></>)}
        {data && view === 'compare' && (<><SectionHead icon={Scale} title="Compare scenarios" sub="Setups, outcomes, timing, regions, impacts, forecasting signals and history side by side." /><CompareView data={data} ids={cmpIds} setIds={(ids) => update({ cmp: ids.join(',') || null }, { replace: true })} onOpen={openScenario} /></>)}
        {data && view === 'seasons' && (<><SectionHead icon={CalendarRange} title="The four seasons" sub="Seasonal overviews assembled from their three monthly catalogues." /><SeasonsView data={data} onOpen={openScenario} onMonth={openMonth} /></>)}
        {data && view === 'history' && (<><SectionHead icon={History} title="Historical scenario explorer" sub={`${data.events.length} verified UK weather events from official Met Office accounts.`} /><HistoryView data={data} onOpen={openScenario} /></>)}
        {data && view === 'about' && (<><SectionHead icon={BookOpen} title="Methods, definitions and sources" /><AboutView data={data} /></>)}
        {view === 'live' && (
          <>
            <SectionHead icon={Activity} title="Live model scenarios" sub="A FORECAST view, unlike the rest of this page: the next seven days as three scenarios, one each from the ECMWF, GFS and Met Office (UKMO) global models, ranked by how well each agrees with the others. Rebuilt every day at 06:00 UK time." />
            <Suspense fallback={<p className="muted">Loading live model data…</p>}><LiveScenarios /></Suspense>
          </>
        )}
        {data && view === 'admin' && isAdmin && (
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <SectionHead icon={Settings2} title="Scenario management" sub="Edit records, publish or unpublish, add history and fix sources. Every change is validated and audited." />
            <ScenarioAdmin data={data} onChanged={() => loadCatalogue(true).then(() => setReload((x) => x + 1))} />
          </Suspense>
        )}
      </main>

      {data && openId && (data.byId.has(openId)
        ? <ScenarioDetail id={openId} cat={data} onClose={closeScenario} onOpen={openScenario} onMonth={(i) => openMonth(i)} onCompare={addCompare} isDark={isDark} />
        : <MissingScenario onClose={closeScenario} />)}
    </div>
  );
}

function MissingScenario({ onClose }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Scenario not found" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: 'rgba(3,8,18,.6)' }}>
      <div className="panel" style={{ padding: 20, maxWidth: 420 }}><p>That scenario is not in the library (it may have been renamed or unpublished).</p><button type="button" className="btn" onClick={onClose}>Close</button></div>
    </div>
  );
}

function Hero({ data, month, onMonth, onTab }) {
  const names = data?.taxonomy.monthNames || ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return (
    <header style={{ padding: '40px 0 22px', background: 'radial-gradient(1200px 380px at 15% -10%, rgba(124,176,255,.18), transparent 60%), radial-gradient(900px 300px at 90% 0%, rgba(169,139,255,.14), transparent 60%)' }}>
      <div className="wrap">
        <p className="faint" style={{ margin: 0, fontSize: '.75rem', fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>MyWeatherUK reference</p>
        <h1 style={{ margin: '6px 0 4px', fontFamily: "'Archivo','DM Sans',sans-serif", fontWeight: 900, letterSpacing: '-.03em', fontSize: 'clamp(1.9rem,4.6vw,3rem)', lineHeight: 1.05 }}>Weather Scenarios</h1>
        <p style={{ margin: 0, fontSize: 'clamp(1rem,2vw,1.2rem)', color: 'var(--ink2)', fontWeight: 600 }}>Explore every season of UK weather</p>
        <div style={{ marginTop: 18 }}>
          <p className="faint" id="pick-month" style={{ margin: '0 0 6px', fontSize: '.78rem', fontWeight: 700 }}>Jump to a month</p>
          <div role="group" aria-labelledby="pick-month" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {names.map((n, i) => (
              <button key={n} type="button" className="chip" aria-pressed={i === month} onClick={() => onMonth(i)} style={{ padding: '7px 12px', fontWeight: 700 }}>
                <span aria-hidden="true">{n.slice(0, 3)}</span><span className="sr">{n}</span>
              </button>
            ))}
            <button type="button" className="chip" onClick={() => onTab('library')} style={{ padding: '7px 12px' }}>Search all scenarios <ArrowRight size={12} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
    </header>
  );
}

function Overview({ data, month, region, onMonth, onOpen, onLibrary, onTab, setMonth }) {
  const st = useMemo(() => overviewStats(data.scenarios, data.events, month), [data, month]);
  const mName = data.taxonomy.monthNames[month];
  const hazards = useMemo(() => {
    const g = monthCatalogue(data.scenarios, month);
    return [...g.C, ...g.P].filter((s) => SEV_RANK[s.sev] >= 3 && s.kind !== 'process' && s.kind !== 'phenomenon').slice(0, 8);
  }, [data, month]);
  const stat = (n, label, onClick) => (
    <button type="button" className="panel" onClick={onClick} style={{ padding: 14, textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: '1.9rem', fontWeight: 900, fontFamily: "'Archivo',sans-serif", fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div className="muted" style={{ fontSize: '.82rem' }}>{label}</div>
    </button>
  );
  return (
    <div>
      <section className="panel" style={{ padding: 18, marginBottom: 16 }} aria-labelledby="ov-intro">
        <h2 id="ov-intro" className="h2">The UK's variable maritime climate</h2>
        <div className="prose" style={{ marginTop: 10, maxWidth: 940 }}>
          <p>The UK sits where the Atlantic meets Europe, beneath the jet stream, between polar and tropical air. Its weather is decided by which air mass arrives — mild and moist from the Atlantic most of the time, but bitterly cold from the continent or the Arctic, or hot from Iberia, when the pattern allows — and by the lows and highs the jet stream steers. Mountains wring rain out of western air and shelter the east; the surrounding seas soften the cold in winter and cool the coasts in spring and summer.</p>
          <p>That is why every month can produce a wide range of weather. This library sets out that range: the typical, the plausible, the uncommon and the rare, for every month and region, each with its atmospheric setup, outcomes, forecasting signals, verified historical examples and sources. It is a reference about climate and possibility — <strong>not a forecast</strong>.</p>
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', marginBottom: 16 }}>
        {stat(st.total, 'documented weather scenarios', () => onTab('library'))}
        {stat(st.month.relevant, `scenarios relevant to ${mName}`, () => onMonth(month))}
        {stat(st.month.common, `seasonally common in ${mName}`, () => onMonth(month))}
        {stat(data.taxonomy.categories.length, 'categories', () => onTab('library'))}
        {stat(data.taxonomy.regions.length, 'UK regions covered', () => onTab('regions'))}
        {stat(st.events, 'verified historical events', () => onTab('history'))}
      </div>
      <p className="note" style={{ margin: '-6px 0 16px' }}>All figures are counted from the scenario database each time the page loads.</p>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', marginBottom: 20 }}>
        <section className="panel" style={{ padding: 16 }} aria-labelledby="ov-haz">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 id="ov-haz" className="h3"><AlertTriangle size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Main seasonal hazards in {mName}</h3>
            <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label="Month for the overview">{data.taxonomy.monthNames.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
          </div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 0, listStyle: 'none' }}>
            {hazards.map((s) => (
              <li key={s.id} style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}>
                <button type="button" onClick={() => onOpen(s.id)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}>
                  <strong>{s.name}</strong> <span className="faint" style={{ fontSize: '.8rem' }}>— {data.taxonomy.frequency[s.months[month]].label.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => onMonth(month)}>Full {mName} catalogue <ArrowRight size={14} aria-hidden="true" /></button>
        </section>
        <section className="panel" style={{ padding: 16 }} aria-labelledby="ov-cats">
          <h3 id="ov-cats" className="h3">Categories</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {data.taxonomy.categories.map((c) => (
              <button key={c.id} type="button" className="chip" onClick={() => onLibrary({ categories: [c.id] })} style={{ borderColor: `${c.colour}88` }} title={c.blurb}>
                <Icon name={c.icon} size={13} style={{ color: c.colour }} />{c.short} <span className="faint">{st.cats[c.id] || 0}</span>
              </button>
            ))}
          </div>
          <p className="note" style={{ marginTop: 10 }}><Info size={12} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Many scenarios belong to more than one category; counts are by primary category.</p>
        </section>
      </div>

      <SectionHead icon={CalendarDays} title="Month-by-month explorer" sub="Twelve months, each with its own catalogue." right={<button type="button" className="btn" onClick={() => onTab('matrix')}>See the annual matrix <ArrowRight size={14} aria-hidden="true" /></button>} />
      <MonthGrid data={data} onMonth={onMonth} region={region} />
    </div>
  );
}
