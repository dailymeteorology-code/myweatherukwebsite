/**
 * Month-by-month explorer: twelve month cards, and a full catalogue for each
 * month. Scenario lists come from the records' month codes; the climate
 * figures come from Met Office HadUK-Grid 1991–2020 averages.
 */
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Thermometer, Droplets, Sun, Snowflake, AlertTriangle, MapPin, ArrowRight } from 'lucide-react';
import { monthCatalogue, monthStats, monthDelta } from './query';
import { ScenarioCard, Icon, FreqBadge, SectionHead, SourceLink, FREQ_STYLE } from './ui';

const GROUP_ORDER = ['C', 'P', 'U', 'R'];

export function ClimatePanel({ climate, month, regionClimate, regionName }) {
  if (!climate) return null;
  const v = (series, key) => climate.series?.[series]?.vars?.[key]?.months?.[month];
  const rows = [
    ['Tmean', 'Mean temperature', '°C', Thermometer], ['Tmax', 'Average daily maximum', '°C', Thermometer], ['Tmin', 'Average daily minimum', '°C', Thermometer],
    ['Rainfall', 'Rainfall', 'mm', Droplets], ['Raindays1mm', 'Days with ≥1 mm rain', 'days', Droplets], ['Sunshine', 'Sunshine', 'hours', Sun], ['AirFrost', 'Days of air frost', 'days', Snowflake],
  ];
  const cols = [['UK', 'United Kingdom'], ...(regionClimate || []).map((k) => [k, climate.series?.[k]?.name || k])];
  return (
    <div className="panel" style={{ padding: 14 }}>
      <p className="h3" style={{ fontSize: '.95rem', marginBottom: 8 }}>Typical {regionName ? `${regionName} ` : ''}conditions, 1991–2020 averages</p>
      <div className="scroll-x">
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.86rem', minWidth: cols.length > 1 ? 420 : 260 }}>
          <thead><tr><th scope="col" style={{ textAlign: 'left', padding: '4px 6px' }} className="faint">Measure</th>{cols.map(([k, n]) => <th key={k} scope="col" style={{ textAlign: 'right', padding: '4px 6px' }} className="faint">{n}</th>)}</tr></thead>
          <tbody>
            {rows.map(([key, label, unit, I]) => (
              <tr key={key}>
                <th scope="row" style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500 }}><I size={12} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }} />{label}</th>
                {cols.map(([k]) => { const x = v(k, key); return <td key={k} style={{ textAlign: 'right', padding: '4px 6px', fontVariantNumeric: 'tabular-nums' }}>{x == null ? '—' : `${x} ${unit}`}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 8 }}>
        Area averages from the Met Office HadUK-Grid 1 km dataset (<SourceLink src={{ url: climate.sourceUrl, title: 'UK and regional series' }} />), mean of 1991–2020. {regionName && 'Region columns use the nearest Met Office climate district(s). '}Climatology describes typical conditions; it is not a forecast for this year.
      </p>
    </div>
  );
}

export function MonthGrid({ data, onMonth, region }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>
      {data.months.map((m, i) => {
        const st = monthStats(data.scenarios, i);
        const top = monthCatalogue(data.scenarios, i).C.filter((s) => !region || (s.regions?.[region] || 0) >= 2).slice(0, 4);
        const season = data.taxonomy.seasons.find((x) => x.id === m.season);
        return (
          <article key={m.key} className="panel cv" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: `linear-gradient(135deg, ${m.theme.from}, ${m.theme.to})`, padding: '14px 16px', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 className="h3" style={{ fontSize: '1.15rem', color: '#fff' }}>{m.name}</h3>
                <Icon name={m.theme.icon} size={22} />
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '.75rem', opacity: 0.9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{season?.name} · {st.relevant} scenarios</p>
            </div>
            <div style={{ padding: '12px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p className="muted" style={{ margin: 0, fontSize: '.85rem', lineHeight: 1.5 }}>{m.tagline}</p>
              <div>
                <p className="faint" style={{ margin: '0 0 4px', fontSize: '.72rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>Seasonally common</p>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: '.83rem', lineHeight: 1.5 }}>{top.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {m.hazards.map((h) => <span key={h} className="tag" style={{ border: '1px solid var(--line2)', color: 'var(--ink2)' }}><AlertTriangle size={10} aria-hidden="true" />{h}</span>)}
              </div>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn primary" onClick={() => onMonth(i)} aria-label={`Open the full ${m.name} scenario catalogue`}>
                Full {m.name} catalogue <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function MonthDetail({ data, month, region, onMonth, onOpen, onRegion, onLibrary }) {
  const m = data.months[month];
  const groups = useMemo(() => monthCatalogue(data.scenarios, month), [data, month]);
  const stats = useMemo(() => monthStats(data.scenarios, month), [data, month]);
  const prev = (month + 11) % 12; const next = (month + 1) % 12;
  const deltaNext = useMemo(() => monthDelta(data.scenarios, month, next), [data, month, next]);
  const deltaPrev = useMemo(() => monthDelta(data.scenarios, prev, month), [data, month, prev]);
  const [catFilter, setCatFilter] = useState(null);
  const [expanded, setExpanded] = useState({ C: false, P: false, U: false, R: false });
  const reg = region ? data.regionById.get(region) : null;
  const pass = (s) => (!catFilter || s.cat === catFilter || s.also.includes(catFilter)) && (!region || (s.regions?.[region] || 0) >= 2);
  const catsHere = data.taxonomy.categories.filter((c) => stats.cats[c.id]);

  return (
    <div>
      <nav aria-label="Month navigation" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => onMonth(prev)}><ChevronLeft size={14} aria-hidden="true" />{data.months[prev].name}</button>
        <button type="button" className="btn" onClick={() => onMonth(null)}><CalendarDays size={14} aria-hidden="true" />All months</button>
        <button type="button" className="btn" onClick={() => onMonth(next)}>{data.months[next].name}<ChevronRight size={14} aria-hidden="true" /></button>
      </nav>

      <header className="panel" style={{ overflow: 'hidden', padding: 0, marginBottom: 14 }}>
        <div style={{ background: `linear-gradient(120deg, ${m.theme.from}, ${m.theme.to})`, padding: '20px 20px', color: '#fff' }}>
          <p style={{ margin: 0, fontSize: '.75rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.9 }}>{data.taxonomy.seasons.find((s) => s.id === m.season)?.name} · month {month + 1} of 12</p>
          <h2 className="h2" style={{ color: '#fff', fontSize: '1.7rem', marginTop: 4 }}>{m.title}</h2>
          <p style={{ margin: '6px 0 0', opacity: 0.95, maxWidth: 820 }}>{m.tagline}</p>
        </div>
        <div style={{ padding: 18 }}>
          <p style={{ margin: 0, lineHeight: 1.65, maxWidth: 900 }}>{m.intro}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {GROUP_ORDER.map((k) => <span key={k} className="tag" style={{ border: `1px solid ${FREQ_STYLE[k].fg}`, color: FREQ_STYLE[k].fg }}>{groups[k].length} {FREQ_STYLE[k].short.toLowerCase()}</span>)}
          </div>
        </div>
      </header>

      {m.special && (
        <aside className="panel" style={{ padding: 14, marginBottom: 14, borderColor: 'var(--accent)' }}>
          <p className="h3" style={{ marginBottom: 4 }}>{m.special.title}</p>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{m.special.text} <span className="note">(<SourceLink src={data.sourceById.get(m.special.source)} />)</span></p>
        </aside>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', marginBottom: 14 }}>
        <ClimatePanel climate={data.climate} month={month} regionClimate={reg?.climate} regionName={reg?.name} />
        <div className="panel" style={{ padding: 14 }}>
          <p className="h3" style={{ fontSize: '.95rem', marginBottom: 8 }}>Compared with neighbouring months</p>
          <p style={{ margin: '0 0 6px', fontSize: '.9rem' }}><strong>vs {data.months[prev].name}:</strong> {m.compare.prev}</p>
          <p style={{ margin: '0 0 10px', fontSize: '.9rem' }}><strong>vs {data.months[next].name}:</strong> {m.compare.next}</p>
          {deltaPrev.rising.length > 0 && <p className="note" style={{ margin: '0 0 4px' }}>More typical now than in {data.months[prev].name}: {deltaPrev.rising.slice(0, 6).map((s) => s.name).join(', ')}{deltaPrev.rising.length > 6 ? '…' : ''}</p>}
          {deltaNext.falling.length > 0 && <p className="note" style={{ margin: 0 }}>Less typical by {data.months[next].name}: {deltaNext.falling.slice(0, 6).map((s) => s.name).join(', ')}{deltaNext.falling.length > 6 ? '…' : ''}</p>}
        </div>
      </div>

      <section className="panel" style={{ padding: 14, marginBottom: 14 }} aria-labelledby="md-reg">
        <h3 id="md-reg" className="h3" style={{ fontSize: '.95rem', marginBottom: 8 }}><MapPin size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Regional differences in {m.name}</h3>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          {m.regional.map(([rid, t]) => <li key={rid}><strong>{data.regionById.get(rid)?.name || groupLabel(rid)}:</strong> {t}</li>)}
        </ul>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="note">Show this month for a region:</span>
          <select value={region || ''} onChange={(e) => onRegion(e.target.value || null)} aria-label="Region">
            <option value="">All of the UK</option>
            {data.taxonomy.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {reg && <p className="note" style={{ marginTop: 8 }}>{reg.factors}</p>}
      </section>

      <SectionHead title={`All ${m.name} scenarios${reg ? ` relevant to ${reg.name}` : ''}`}
        sub="Grouped by how typical they are this month. Labels are climatological categories, not forecast probabilities."
        right={<button type="button" className="btn" onClick={() => onLibrary({ months: [month], regions: region ? [region] : [] })}>Filter in the library <ArrowRight size={14} aria-hidden="true" /></button>} />
      <div role="group" aria-label="Filter by category" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" className="chip" aria-pressed={!catFilter} onClick={() => setCatFilter(null)}>All categories</button>
        {catsHere.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={catFilter === c.id} onClick={() => setCatFilter(catFilter === c.id ? null : c.id)}>{c.short} ({stats.cats[c.id]})</button>)}
      </div>

      {GROUP_ORDER.map((k) => {
        const list = groups[k].filter(pass);
        if (!list.length) return null;
        const shown = expanded[k] ? list : list.slice(0, 9);
        return (
          <section key={k} style={{ marginBottom: 18 }} aria-labelledby={`g-${k}`}>
            <h3 id={`g-${k}`} className="h3" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><FreqBadge code={k} /> <span className="faint" style={{ fontWeight: 600 }}>{list.length}</span></h3>
            <p className="note" style={{ margin: '0 0 10px' }}>{data.taxonomy.frequency[k].def}</p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))' }}>
              {shown.map((s) => (
                <ScenarioCard key={s.id} s={s} cat={data.catById.get(s.cat)} month={month} onOpen={onOpen}
                  extra={s.monthNotes?.[m.key] ? <p className="note" style={{ margin: '8px 0 0', fontStyle: 'italic' }}>{m.name}: {s.monthNotes[m.key]}</p> : null} />
              ))}
            </div>
            {list.length > 9 && <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setExpanded((e) => ({ ...e, [k]: !e[k] }))}>{expanded[k] ? 'Show fewer' : `Show all ${list.length}`}</button>}
          </section>
        );
      })}
      <p className="note">Not listed means "outside its season" for that scenario in {m.name}: not documented as part of this month's weather — not impossible.</p>
    </div>
  );
}

const groupLabel = (g) => ({ 'east-coast': 'Eastern coasts', 'west-coast': 'Western coasts', 'west-uplands': 'Western uplands', 'south-east': 'South-east England', south: 'Southern England', north: 'Northern Britain', scotland: 'Scotland', midlands: 'Midlands', 'inland-england': 'Inland England', 'far-north': 'Northern Scotland and islands' }[g] || g);
