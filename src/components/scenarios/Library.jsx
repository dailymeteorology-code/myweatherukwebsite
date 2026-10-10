/**
 * Complete scenario library — search plus multi-select filters across month,
 * season, category, region, frequency, severity, temperature, precipitation
 * and circulation. Filters combine (AND across groups, OR within a group).
 */
import React, { useMemo, useState, useDeferredValue } from 'react';
import { Search, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { filterScenarios, sortResults } from './query';
import { ScenarioCard, Empty, MonthStrip } from './ui';

const PAGE = 24;

function ChipGroup({ label, options, value = [], onChange, single }) {
  const toggle = (id) => {
    if (single) return onChange(value[0] === id ? [] : [id]);
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
      <legend className="faint" style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {options.map(([id, l]) => <button key={id} type="button" className="chip" aria-pressed={value.includes(id)} onClick={() => toggle(id)}>{l}</button>)}
      </div>
    </fieldset>
  );
}

export const EMPTY_FILTERS = { q: '', months: [], seasons: [], categories: [], regions: [], minFreq: '', severity: [], temps: [], precip: [], circulation: [], kinds: [] };

export default function Library({ data, filters, setFilters, onOpen, onMonth }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('relevance');
  const [showFilters, setShowFilters] = useState(true);
  const deferred = useDeferredValue(filters);
  const t = data.taxonomy;
  const results = useMemo(() => {
    const months = (deferred.months || []).map(Number);
    return sortResults(filterScenarios(data.scenarios, { ...deferred, months }), sort, { month: months.length === 1 ? months[0] : null, catOrder: data.taxonomy.categories.map((c) => c.id) });
  }, [data, deferred, sort]);
  const set = (k) => (v) => { setPage(1); setFilters({ ...filters, [k]: v }); };
  const active = Object.entries(filters).filter(([k, v]) => (Array.isArray(v) ? v.length : !!v)).length;
  const monthSel = (filters.months || []).map(Number);

  return (
    <div>
      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ flex: '1 1 280px', position: 'relative' }}>
            <span className="sr">Search scenarios</span>
            <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 10, top: 11, color: 'var(--ink3)' }} />
            <input type="search" value={filters.q} onChange={(e) => set('q')(e.target.value)} placeholder="Search: heatwave, Beast from the East, supercell, haar, flooding…"
              style={{ width: '100%', paddingLeft: 32 }} />
          </label>
          <label className="faint" style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: 6 }}>Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="relevance">Best match</option><option value="frequency">Most typical first</option>
              <option value="severity">Highest impact first</option><option value="name">Name A–Z</option><option value="category">Category</option>
            </select>
          </label>
          <button type="button" className="btn" aria-expanded={showFilters} onClick={() => setShowFilters((x) => !x)}><SlidersHorizontal size={14} aria-hidden="true" />Filters{active ? ` (${active})` : ''}</button>
          <button type="button" className="btn" onClick={() => { setPage(1); setFilters(EMPTY_FILTERS); }} disabled={!active}><RotateCcw size={14} aria-hidden="true" />Reset</button>
        </div>
        {showFilters && (
          <div style={{ marginTop: 14 }}>
            <ChipGroup label="Month" options={t.monthNames.map((n, i) => [i, n.slice(0, 3)])} value={monthSel} onChange={(v) => set('months')(v)} />
            <ChipGroup label="Season" options={t.seasons.map((s) => [s.id, s.name])} value={filters.seasons} onChange={set('seasons')} />
            <ChipGroup label="Category" options={t.categories.map((c) => [c.id, c.short])} value={filters.categories} onChange={set('categories')} />
            <ChipGroup label="Region (particularly relevant or relevant)" options={t.regions.map((r) => [r.id, r.name])} value={filters.regions} onChange={set('regions')} />
            <ChipGroup label="At least this typical (in the chosen months)" single options={[['C', 'Seasonally common'], ['P', 'Plausible or more'], ['U', 'Uncommon or more'], ['R', 'Including rare']]} value={filters.minFreq ? [filters.minFreq] : []} onChange={(v) => set('minFreq')(v[0] || '')} />
            <ChipGroup label="Severity / impact potential" options={Object.entries(t.severity).map(([k, v]) => [k, v.label])} value={filters.severity} onChange={set('severity')} />
            <ChipGroup label="Temperature regime" options={Object.entries(t.temperature)} value={filters.temps} onChange={set('temps')} />
            <ChipGroup label="Precipitation type" options={Object.entries(t.precip)} value={filters.precip} onChange={set('precip')} />
            <ChipGroup label="Circulation pattern" options={Object.entries(t.circulation).filter(([k]) => k !== 'any')} value={filters.circulation} onChange={set('circulation')} />
            <ChipGroup label="Type of record" options={Object.entries(t.kinds).map(([k, v]) => [k, v.label])} value={filters.kinds} onChange={set('kinds')} />
          </div>
        )}
      </div>

      <p role="status" aria-live="polite" className="muted" style={{ margin: '0 0 10px' }}>
        {results.length} of {data.scenarios.length} scenarios match{active ? ' your filters' : ''}.
      </p>

      {results.length === 0 ? (
        <Empty>No scenarios match. Try removing a filter — remember a region filter only keeps scenarios rated relevant to that region.</Empty>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
            {results.slice(0, page * PAGE).map(({ s }) => (
              <ScenarioCard key={s.id} s={s} cat={data.catById.get(s.cat)} month={monthSel.length === 1 ? monthSel[0] : null} onOpen={onOpen}
                extra={<div style={{ marginTop: 10 }}><MonthStrip months={s.months} monthNames={t.monthNames} size={11} /></div>} />
            ))}
          </div>
          {results.length > page * PAGE && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setPage((p) => p + 1)}>Show more ({results.length - page * PAGE} remaining)</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
