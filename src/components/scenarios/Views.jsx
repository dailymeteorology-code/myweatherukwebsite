/**
 * Matrix, regional map, comparison, seasons, history and references views.
 * All derive from the same catalogue the month explorer and library use.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { filterScenarios, sortResults, matrixRows, seasonSummary, compareScenarios, filterEvents, SEV_RANK, FREQ_RANK } from './query';
import { FREQ_STYLE, FreqBadge, SevBadge, SourceLink, ScenarioCard, Empty, MonthStrip } from './ui';
import { loadItem } from './scenarioApi';
import RegionMap from './RegionMap';
import { ClimatePanel } from './MonthExplorer';
import { fmtRange, groupName } from './ScenarioDetail';
import Diagram, { DIAGRAM_IDS } from './Diagrams';

/* ── Annual matrix ───────────────────────────────────────────────────── */
export function MatrixView({ data, onOpen, onMonth }) {
  const t = data.taxonomy;
  const [cat, setCat] = useState('');
  const [region, setRegion] = useState('');
  const [minFreq, setMinFreq] = useState('');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const res = filterScenarios(data.scenarios, { q, categories: cat ? [cat] : [], regions: region ? [region] : [], minFreq });
    return matrixRows(sortResults(res, q ? 'relevance' : 'category', { catOrder: t.categories.map((c) => c.id) }).map((r) => r.s));
  }, [data, cat, region, minFreq, q]);

  return (
    <div>
      <div className="panel" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ position: 'relative', flex: '1 1 220px' }}><span className="sr">Search the matrix</span>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink3)' }} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a scenario…" style={{ width: '100%', paddingLeft: 28 }} />
        </label>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{t.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region"><option value="">All regions</option>{t.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select value={minFreq} onChange={(e) => setMinFreq(e.target.value)} aria-label="Frequency"><option value="">Any frequency</option><option value="C">Common somewhere in the year</option><option value="P">Plausible or more</option><option value="U">Uncommon or more</option></select>
        <span className="faint" style={{ fontSize: '.8rem' }}>{rows.length} rows</span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }} aria-label="Key">
        {['C', 'P', 'U', 'R', '-'].map((k) => <span key={k} className="tag" style={{ color: FREQ_STYLE[k].fg, border: `1px solid ${k === '-' ? 'var(--line2)' : FREQ_STYLE[k].fg}` }}><span aria-hidden="true">{FREQ_STYLE[k].mark}</span>{FREQ_STYLE[k].label}</span>)}
      </div>
      <div className="scroll-x panel" style={{ padding: 0, maxHeight: '75vh', overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 820, width: '100%', fontSize: '.8rem' }}>
          <caption className="sr">Annual scenario matrix: scenarios by month with climatological frequency</caption>
          <thead>
            <tr>
              <th scope="col" style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: 'var(--bg2)', textAlign: 'left', padding: '8px 10px', minWidth: 230 }}>Scenario</th>
              {t.monthNames.map((n, i) => (
                <th key={n} scope="col" style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg2)', padding: 0 }}>
                  <button type="button" onClick={() => onMonth(i)} style={{ background: 'none', border: 0, cursor: 'pointer', padding: '8px 4px', fontWeight: 800, width: '100%' }} aria-label={`Open ${n}`}>{n.slice(0, 3)}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = data.catById.get(r.cat);
              return (
                <tr key={r.id}>
                  <th scope="row" style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg2)', textAlign: 'left', padding: '3px 10px', borderTop: '1px solid var(--line)', fontWeight: 500 }}>
                    <button type="button" onClick={() => onOpen(r.id)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: c?.colour, flexShrink: 0 }} />{r.name}
                    </button>
                  </th>
                  {r.codes.map((code, i) => (
                    <td key={i} style={{ borderTop: '1px solid var(--line)', padding: 2, textAlign: 'center' }}>
                      <button type="button" onClick={() => onMonth(i)} title={`${r.name} — ${t.monthNames[i]}: ${FREQ_STYLE[code].label}`}
                        aria-label={`${r.name}, ${t.monthNames[i]}: ${FREQ_STYLE[code].label}`}
                        style={{ width: '100%', minWidth: 40, height: 22, borderRadius: 5, border: 0, cursor: 'pointer', background: code === '-' ? 'transparent' : FREQ_STYLE[code].bg, color: FREQ_STYLE[code].fg, fontWeight: 800 }}>
                        <span aria-hidden="true">{FREQ_STYLE[code].mark}</span>
                      </button>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 8 }}>The matrix is generated directly from the scenario records, so it always matches the month catalogues and scenario pages. Symbols as well as colours mark each level, so it does not depend on colour vision.</p>
    </div>
  );
}

/* ── Regional map view ───────────────────────────────────────────────── */
export function RegionView({ data, region, setRegion, month, setMonth, onOpen, onLibrary, isDark }) {
  const reg = region ? data.regionById.get(region) : null;
  const list = useMemo(() => {
    if (!region) return [];
    return data.scenarios.filter((s) => (s.regions?.[region] || 0) >= 3 && FREQ_RANK[s.months[month]] >= 2)
      .sort((a, b) => FREQ_RANK[b.months[month]] - FREQ_RANK[a.months[month]] || SEV_RANK[b.sev] - SEV_RANK[a.sev]);
  }, [data, region, month]);
  return (
    <div>
      <RegionMap regions={data.taxonomy.regions} selected={region} onSelect={setRegion} isDark={isDark} height={460} />
      <div className="panel" style={{ padding: 14, marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: '.8rem' }}>Month</span>
        <div role="group" aria-label="Month" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {data.taxonomy.monthNames.map((n, i) => <button key={n} type="button" className="chip" aria-pressed={month === i} onClick={() => setMonth(i)}>{n.slice(0, 3)}</button>)}
        </div>
      </div>
      {!reg ? <div style={{ marginTop: 14 }}><Empty>Select a region on the map or in the list to see its local factors, typical climate and the scenarios that particularly concern it.</Empty></div> : (
        <div style={{ marginTop: 14 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
            <div className="panel" style={{ padding: 14 }}>
              <h3 className="h3">{reg.name}</h3>
              <p style={{ lineHeight: 1.6 }}>{reg.factors}</p>
              <p className="note">Climate district(s) used for averages: {reg.climateNames.join(' and ')}.</p>
            </div>
            <ClimatePanel climate={data.climate} month={month} regionClimate={reg.climate} regionName={reg.name} />
          </div>
          <h3 className="h3" style={{ margin: '18px 0 6px' }}>Particularly relevant to {reg.name} in {data.taxonomy.monthNames[month]}</h3>
          <p className="note" style={{ margin: '0 0 10px' }}>Scenarios rated "particularly relevant" to this region that are at least uncommon this month. <button type="button" className="btn" style={{ padding: '3px 8px', marginLeft: 6 }} onClick={() => onLibrary({ regions: [region], months: [month] })}>See all in the library</button></p>
          {list.length ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))' }}>
              {list.map((s) => <ScenarioCard key={s.id} s={s} cat={data.catById.get(s.cat)} month={month} onOpen={onOpen} />)}
            </div>
          ) : <Empty>No scenarios are rated particularly relevant to this region in this month.</Empty>}
        </div>
      )}
    </div>
  );
}

/* ── Comparison ──────────────────────────────────────────────────────── */
const PRESETS = [
  ['polar-maritime', 'polar-continental'], ['frontal-snow', 'convective-snow-showers'], ['multi-day-heatwave', 'warm-stable-no-storms'],
  ['airmass-thunderstorms', 'supercells'], ['zonal-atlantic-flow', 'scandinavian-block'], ['flash-flooding', 'river-flooding'],
  ['radiation-fog', 'advection-fog'], ['summer-anticyclone', 'winter-blocking-high'],
];
export function CompareView({ data, ids, setIds, onOpen }) {
  const [q, setQ] = useState('');
  const [full, setFull] = useState({});
  useEffect(() => { ids.forEach((id) => { if (!full[id]) loadItem(id).then((r) => setFull((f) => ({ ...f, [id]: r }))).catch(() => {}); }); }, [ids]); // eslint-disable-line
  const recs = ids.map((id) => data.byId.get(id)).filter(Boolean);
  const cmp = useMemo(() => compareScenarios(recs), [recs]);
  const suggestions = useMemo(() => (q ? sortResults(filterScenarios(data.scenarios, { q })).slice(0, 8).map((r) => r.s).filter((s) => !ids.includes(s.id)) : []), [q, data, ids]);
  const t = data.taxonomy;
  const cell = { padding: '8px 10px', borderTop: '1px solid var(--line)', verticalAlign: 'top', fontSize: '.86rem' };
  const fullRow = (label, get) => (
    <tr><th scope="row" style={{ ...cell, textAlign: 'left', width: 170 }} className="faint">{label}</th>{ids.map((id) => <td key={id} style={cell}>{full[id] ? get(full[id]) : '…'}</td>)}</tr>
  );
  return (
    <div>
      <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
        <p className="muted" style={{ marginTop: 0 }}>Choose two to four scenarios. Comparisons are generated from the scenario records, not written separately.</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {recs.map((s) => <span key={s.id} className="chip" aria-pressed="true">{s.name}<button type="button" onClick={() => setIds(ids.filter((x) => x !== s.id))} aria-label={`Remove ${s.name}`} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, color: 'inherit' }}><X size={12} /></button></span>)}
        </div>
        {ids.length < 4 && (
          <div style={{ position: 'relative', maxWidth: 420 }}>
            <label><span className="sr">Add a scenario to compare</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a scenario…" style={{ width: '100%' }} /></label>
            {suggestions.length > 0 && (
              <ul className="panel" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: '4px 0 0', padding: 4, listStyle: 'none' }}>
                {suggestions.map((s) => <li key={s.id}><button type="button" className="btn" style={{ width: '100%', justifyContent: 'flex-start', border: 0 }} onClick={() => { setIds([...ids, s.id]); setQ(''); }}><Plus size={12} aria-hidden="true" />{s.name}</button></li>)}
              </ul>
            )}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <span className="faint" style={{ fontSize: '.78rem' }}>Try: </span>
          {PRESETS.map(([a, b]) => data.byId.has(a) && data.byId.has(b) && (
            <button key={a + b} type="button" className="chip" style={{ margin: 2 }} onClick={() => setIds([a, b])}>{data.byId.get(a).name} vs {data.byId.get(b).name}</button>
          ))}
        </div>
      </div>
      {recs.length < 2 ? <Empty>Add at least two scenarios to compare them side by side.</Empty> : (
        <div className="scroll-x panel" style={{ padding: 0 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 300 + recs.length * 220 }}>
            <thead><tr><th style={cell} /> {recs.map((s) => <th key={s.id} scope="col" style={{ ...cell, textAlign: 'left' }}><button type="button" onClick={() => onOpen(s.id)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontWeight: 800, fontSize: '.95rem', textAlign: 'left', color: 'var(--accent)' }}>{s.name}</button></th>)}</tr></thead>
            <tbody>
              {cmp.diffs.map((d) => (
                <tr key={d.label}><th scope="row" style={{ ...cell, textAlign: 'left' }} className="faint">{d.label}{d.differs && <span className="sr"> (differs)</span>}</th>
                  {d.values.map((v, i) => <td key={i} style={{ ...cell, fontWeight: d.differs ? 700 : 400 }}>{d.label === 'Severity' ? <SevBadge sev={v} /> : d.label === 'Kind' ? t.kinds[v]?.label : d.label === 'Category' ? data.catById.get(v)?.short : d.label === 'Temperature' ? t.temperature[v] : v}</td>)}</tr>
              ))}
              <tr><th scope="row" style={{ ...cell, textAlign: 'left' }} className="faint">Seasonal relevance</th>{recs.map((s) => <td key={s.id} style={cell}><MonthStrip months={s.months} monthNames={t.monthNames} /></td>)}</tr>
              <tr><th scope="row" style={{ ...cell, textAlign: 'left' }} className="faint">Relative frequency</th>{recs.map((s) => <td key={s.id} style={cell}>{s.frequency}</td>)}</tr>
              <tr><th scope="row" style={{ ...cell, textAlign: 'left' }} className="faint">Most relevant regions</th>{recs.map((s) => <td key={s.id} style={cell}>{Object.entries(s.regions).filter(([, v]) => v >= 3).map(([r]) => data.regionById.get(r)?.name).join(', ') || '—'}</td>)}</tr>
              {fullRow('Main setup', (r) => <ul style={{ margin: 0, paddingLeft: 16 }}>{r.setup.essential.map((x, i) => <li key={i}>{x}</li>)}</ul>)}
              {fullRow('Weather outcomes', (r) => <ul style={{ margin: 0, paddingLeft: 16 }}>{r.outcomes.map((x, i) => <li key={i}>{x}</li>)}</ul>)}
              {fullRow('Possible impacts', (r) => Object.values(r.impacts || {}).join(' ') || '—')}
              {fullRow('Forecasting signals', (r) => (r.signals || []).map((x) => x[0]).join('; ') || '—')}
              {fullRow('Historical examples', (r) => (r.events || []).slice(0, 4).map((e) => `${e.title} (${e.start.slice(0, 4)})`).join('; ') || 'None linked')}
            </tbody>
          </table>
          {cmp.sharedRegions.length > 0 && <p className="note" style={{ padding: '0 10px 10px' }}>Both/all relevant to: {cmp.sharedRegions.map((r) => data.regionById.get(r)?.name).join(', ')}.</p>}
        </div>
      )}
    </div>
  );
}

/* ── Seasons ─────────────────────────────────────────────────────────── */
export function SeasonsView({ data, onOpen, onMonth }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
      {data.taxonomy.seasons.map((season) => {
        const sum = seasonSummary(data.scenarios, season.id);
        return (
          <section key={season.id} className="panel" style={{ padding: 18 }} aria-labelledby={`s-${season.id}`}>
            <h3 id={`s-${season.id}`} className="h2" style={{ color: season.colour }}>{season.name} <span className="faint" style={{ fontSize: '.9rem', fontWeight: 600 }}>— {season.months.map((m) => data.taxonomy.monthNames[m]).join(', ')}</span></h3>
            <p style={{ lineHeight: 1.65, maxWidth: 900 }}>{data.seasonText[season.id]}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {season.months.map((m) => <button key={m} type="button" className="btn" onClick={() => onMonth(m)}>{data.taxonomy.monthNames[m]} catalogue</button>)}
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
              {[['Seasonally common', sum.common], ['Main hazards', sum.hazards], ['Uncommon and rare but high-impact', sum.rare]].map(([label, rows]) => (
                <div key={label}>
                  <p className="faint" style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', margin: '0 0 6px' }}>{label} ({rows.length})</p>
                  <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                    {rows.slice(0, 12).map(({ s, codes }) => (
                      <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                        <span style={{ display: 'flex', gap: 2 }} aria-label={codes.map((c, i) => `${data.taxonomy.monthNames[season.months[i]]}: ${FREQ_STYLE[c].label}`).join('; ')}>
                          {codes.map((c, i) => <span key={i} aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: c === '-' ? 'transparent' : FREQ_STYLE[c].fg, border: `1px solid ${c === '-' ? 'var(--line2)' : FREQ_STYLE[c].fg}`, opacity: c === 'C' ? 1 : c === 'P' ? 0.7 : 0.45 }} />)}
                        </span>
                        <button type="button" onClick={() => onOpen(s.id)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--ink)', fontSize: '.86rem' }}>{s.name}</button>
                      </li>
                    ))}
                  </ul>
                  {rows.length > 12 && <p className="note">…and {rows.length - 12} more in the month catalogues.</p>}
                </div>
              ))}
            </div>
            <p className="note" style={{ marginTop: 10 }}>This overview is assembled from the three monthly catalogues, so it cannot contradict them.</p>
          </section>
        );
      })}
    </div>
  );
}

/* ── History ─────────────────────────────────────────────────────────── */
export function HistoryView({ data, onOpen }) {
  const years = data.events.map((e) => +e.start.slice(0, 4));
  const minY = Math.min(...years); const maxY = Math.max(...years);
  const [f, setF] = useState({ from: minY, to: maxY, month: '', category: '', region: '' });
  const list = useMemo(() => filterEvents(data.events, f, data.taxonomy.regionGroups).slice().reverse(), [data, f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value === '' ? '' : (k === 'from' || k === 'to' || k === 'month' ? +e.target.value : e.target.value) });
  return (
    <div>
      <div className="panel" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="faint" style={{ fontSize: '.8rem' }}>From <input type="number" min={minY} max={maxY} value={f.from} onChange={set('from')} style={{ width: 84 }} /></label>
        <label className="faint" style={{ fontSize: '.8rem' }}>to <input type="number" min={minY} max={maxY} value={f.to} onChange={set('to')} style={{ width: 84 }} /></label>
        <select value={f.month} onChange={set('month')} aria-label="Month"><option value="">Any month</option>{data.taxonomy.monthNames.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
        <select value={f.category} onChange={set('category')} aria-label="Category"><option value="">Any category</option>{data.taxonomy.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={f.region} onChange={set('region')} aria-label="Region"><option value="">Any region</option>{data.taxonomy.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <span className="faint" role="status" style={{ fontSize: '.8rem' }}>{list.length} events</span>
      </div>
      <p className="note" style={{ margin: '0 0 12px' }}>Every event is taken from an official Met Office account, linked below it. These are records of what happened — not forecasts, and not predictions that the same will recur.</p>
      {list.length === 0 ? <Empty>No events match these filters.</Empty> : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid var(--line2)' }}>
          {list.map((e) => (
            <li key={e.id} className="cv" style={{ position: 'relative', padding: '0 0 16px 18px' }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: -6, top: 4, width: 10, height: 10, borderRadius: 5, background: 'var(--accent)' }} />
              <article className="panel" style={{ padding: 14 }}>
                <p className="faint" style={{ margin: 0, fontSize: '.78rem' }}>{fmtRange(e.start, e.end)} · {e.regions.map((r) => data.regionById.get(r)?.name || groupName(r)).join(', ')}</p>
                <h3 className="h3" style={{ margin: '4px 0 6px' }}>{e.title}</h3>
                <p style={{ margin: 0, lineHeight: 1.55 }}>{e.summary}</p>
                {e.observations?.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{e.observations.map((o, i) => <li key={i} style={{ fontSize: '.86rem' }}>{o}</li>)}</ul>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {e.scenarios.map((sid) => data.byId.get(sid) && <button key={sid} type="button" className="chip" onClick={() => onOpen(sid)}>{data.byId.get(sid).name}</button>)}
                </div>
                <p className="note" style={{ margin: '8px 0 0' }}>Source: {e.sources.map((sid, i) => <React.Fragment key={sid}>{i > 0 && ' · '}<SourceLink src={data.sourceById.get(sid)} /></React.Fragment>)}</p>
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ── References, methodology and quality control ─────────────────────── */
export function AboutView({ data }) {
  const t = data.taxonomy;
  const bySrcKind = useMemo(() => {
    const g = {};
    for (const s of data.sources) (g[s.kind] = g[s.kind] || []).push(s);
    return g;
  }, [data]);
  const KIND_LABEL = { archive: 'Archives', dataset: 'Datasets', records: 'Records', climatology: 'Climatology', assessment: 'Climate assessments', projections: 'Projections', warnings: 'Warnings', 'case-study': 'Met Office case studies', explainer: 'Met Office explainers', safety: 'Safety advice', official: 'Official flood and mountain services', research: 'Research organisations' };
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
      <section className="panel" style={{ padding: 18 }}>
        <h3 className="h2">How this library was compiled</h3>
        <div className="prose" style={{ marginTop: 10, maxWidth: 900 }}>
          <p>Each of the {data.scenarios.length} scenarios is a structured record: identification, setup (essential ingredients kept separate from factors that only make it more likely), outcomes and alternatives, regional applicability with reasons, a month-by-month relevance code, impacts, forecasting signals with their limitations, climate context, safety advice and sources. The month explorer, library, matrix, maps, comparisons and seasonal overviews are all generated from those records, so they cannot disagree with one another.</p>
          <p>Explanations draw on Met Office explainers and the National Climate Information Centre case studies. Every figure shown with a scenario or event appears in its cited source. Where no verified example or statistic was available it has been left out rather than invented, and the page says so. Typical monthly conditions are the arithmetic mean of 1991–2020 from the Met Office HadUK-Grid areal series for the UK and its climate districts.</p>
          <p>Regions: England’s nine statistical regions (with London separate), Wales and Northern Ireland are official areas; Scotland has no official four-way split, so its 32 council areas are grouped here into Southern, Central, Northern/Highlands and the Islands. Boundaries are ONS local authority districts (December 2024).</p>
        </div>
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <h3 className="h2">What the frequency labels mean</h3>
        <dl style={{ margin: '10px 0 0' }}>
          {Object.entries(t.frequency).map(([k, v]) => <div key={k} style={{ marginBottom: 10 }}><dt><FreqBadge code={k} /></dt><dd style={{ margin: '4px 0 0' }}>{v.def}</dd></div>)}
        </dl>
        <ul style={{ paddingLeft: 18, lineHeight: 1.6 }}>{t.frequencyNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        <h4 className="h3" style={{ marginTop: 12 }}>Four distinctions kept throughout</h4>
        <ul style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li><strong>Climatology is not a forecast.</strong> Averages describe the long term, not this year.</li>
          <li><strong>Possibility is not probability.</strong> "Plausible" never means "expected".</li>
          <li><strong>Regional applicability is not certainty.</strong> A region rated relevant will not see a scenario everywhere.</li>
          <li><strong>A pressure pattern is not one outcome.</strong> The same pattern gives different weather by season, moisture and track.</li>
        </ul>
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <h3 className="h2">Quality-control checklist for new scenarios</h3>
        <ol style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Unique kebab-case id; checked against existing ids and synonyms before adding.</li>
          <li>Kind is stated (pattern, air mass, scenario, hazard, process or phenomenon).</li>
          <li>Essential ingredients separated from factors that merely increase likelihood.</li>
          <li>Alternatives given where the same setup can produce different outcomes.</li>
          <li>Month codes justified; nothing marked impossible because it is uncommon.</li>
          <li>Regions explained, not just listed.</li>
          <li>Every number has a source, a period and an area. No invented percentages or recurrence periods.</li>
          <li>Historical examples only from a citable official account.</li>
          <li>Climate statements distinguish observation, projection and uncertainty — and are omitted rather than generalised.</li>
          <li>Safety lines match the wording of the linked official guidance.</li>
          <li>Run <code>npm test</code> (data structure, links between records) and <code>npm run scenarios:check-links</code> (every URL).</li>
        </ol>
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <h3 className="h2">Conceptual diagrams</h3>
        <p className="muted">Illustrations of how a process works. They are schematic — not maps of data and not forecasts.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))' }}>{DIAGRAM_IDS.map((id) => <Diagram key={id} id={id} />)}</div>
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <h3 className="h2">References ({data.sources.length})</h3>
        {Object.entries(bySrcKind).map(([k, list]) => (
          <details key={k} style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{KIND_LABEL[k] || k} ({list.length})</summary>
            <ul style={{ paddingLeft: 18, lineHeight: 1.7, marginTop: 6 }}>{list.map((s) => <li key={s.id}><SourceLink src={s} /> <span className="note">— {s.publisher}</span></li>)}</ul>
          </details>
        ))}
        <p className="note" style={{ marginTop: 12 }}>Contains public sector information licensed under the Open Government Licence v3.0. Boundaries: Office for National Statistics; contains OS data © Crown copyright and database right 2024.</p>
      </section>
    </div>
  );
}
