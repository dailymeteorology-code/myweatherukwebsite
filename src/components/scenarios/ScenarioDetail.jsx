/**
 * Scenario detail — the full information template (identification, setup,
 * outcomes, geography, timing, frequency, impacts, forecasting signals,
 * history, climate, safety, sources) for one record. Opens as a dialog over
 * the page; the URL carries ?s=<id> so every scenario has a shareable link.
 */
import React, { useEffect, useRef } from 'react';
import { X, MapPin, Activity, AlertTriangle, History, Thermometer, Shield, BookOpen, Link2, Layers, CalendarDays, Scale, Loader2 } from 'lucide-react';
import { useItem } from './scenarioApi';
import { FreqBadge, SevBadge, SourceLink, Icon, MonthStrip, FREQ_STYLE } from './ui';
import Diagram from './Diagrams';
import RegionMap from './RegionMap';

const IMPACT_LABELS = { people: 'People and public safety', transport: 'Roads and transport', aviation: 'Aviation', infrastructure: 'Infrastructure', property: 'Buildings and property', agriculture: 'Agriculture', rivers: 'Rivers and catchments', coast: 'Coastal areas', power: 'Power and communications' };
const SETUP_LABELS = { pressure: 'Pressure pattern', airmass: 'Air mass and airflow', jet: 'Jet stream', temperature: 'Temperature structure', moisture: 'Moisture', instability: 'Instability', shear: 'Wind shear', fronts: 'Fronts', orography: 'Orography (hills and mountains)', other: 'Other factors' };

function Block({ id, icon: I, title, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} style={{ padding: '18px 0', borderTop: '1px solid var(--line)' }}>
      <h3 id={`${id}-h`} className="h3" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>{I && <I size={16} aria-hidden="true" />}{title}</h3>
      {children}
    </section>
  );
}
const List = ({ items }) => (items?.length ? <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null);

export default function ScenarioDetail({ id, cat: catalog, onClose, onOpen, onMonth, onCompare, isDark }) {
  const { data: s, error, loading } = useItem(id);
  const ref = useRef(null);
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    const prev = opener.current;
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose]);

  const light = catalog.byId.get(id);
  const category = light ? catalog.catById.get(light.cat) : null;
  const monthNames = catalog.taxonomy.monthNames;
  const kinds = catalog.taxonomy.kinds;
  const src = (sid) => catalog.sourceById.get(sid);

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(3,8,18,.62)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sd-title"
        style={{ width: 'min(920px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--bg2)', borderLeft: '1px solid var(--line2)', outline: 'none' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg2)', borderBottom: '1px solid var(--line)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {category && <span className="tag" style={{ color: category.colour, border: `1px solid ${category.colour}66` }}><Icon name={category.icon} size={12} />{category.name}</span>}
          <span style={{ flex: 1 }} />
          {light && <button type="button" className="btn" onClick={() => onCompare(id)}><Scale size={14} aria-hidden="true" />Compare</button>}
          <button type="button" className="btn" onClick={onClose} aria-label="Close scenario details"><X size={16} aria-hidden="true" /></button>
        </div>

        <div style={{ padding: '18px 22px 60px' }}>
          {loading && <p className="muted" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading scenario…</p>}
          {error && <p role="alert" className="muted">{error.message}</p>}
          {s && (
            <>
              {/* A — Identification */}
              <header>
                <p className="faint" style={{ margin: '0 0 4px', fontSize: '.75rem', letterSpacing: '.04em' }}>
                  {kinds[s.kind]?.label} · ID <code>{s.id}</code>{s.origin !== 'base' && ` · ${s.origin === 'edited' ? 'edited by an editor' : 'added by an editor'}`}
                </p>
                <h2 id="sd-title" className="h2" style={{ fontSize: '1.6rem' }}>{s.name}</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
                  <SevBadge sev={s.sev} />
                  {(s.also || []).map((c) => { const x = catalog.catById.get(c); return x ? <span key={c} className="tag" style={{ color: x.colour, border: `1px solid ${x.colour}55` }}>{x.short}</span> : null; })}
                </div>
                {s.aka?.length > 0 && <p className="note">Also known as: {s.aka.join(', ')}</p>}
                <p style={{ fontSize: '1.02rem', lineHeight: 1.6, margin: '8px 0 0' }}>{s.summary}</p>
                <p className="note" style={{ marginTop: 6 }}>{kinds[s.kind]?.help}</p>
              </header>

              <nav aria-label="Sections" className="tabs" style={{ margin: '14px 0 4px', flexWrap: 'wrap' }}>
                {[['d-explain', 'Explanation'], ['d-setup', 'Setup'], ['d-outcomes', 'Outcomes'], ['d-where', 'Where'], ['d-when', 'When'], ['d-freq', 'How often'], ['d-impacts', 'Impacts'], ['d-signals', 'Forecasting'], ['d-history', 'History'], ['d-climate', 'Climate'], ['d-safety', 'Safety'], ['d-sources', 'Sources']].map(([h, l]) => (
                  <a key={h} href={`#${h}`} className="chip" style={{ textDecoration: 'none', color: 'var(--ink2)' }}
                    onClick={(e) => { e.preventDefault(); document.getElementById(h)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{l}</a>
                ))}
              </nav>

              <Block id="d-explain" icon={BookOpen} title="Detailed explanation">
                <div className="prose">{(s.body || []).map((p, i) => <p key={i}>{p}</p>)}</div>
                {s.diagram && <div style={{ marginTop: 12 }}><Diagram id={s.diagram} /></div>}
              </Block>

              {/* B — Setup */}
              <Block id="d-setup" icon={Layers} title="Meteorological setup">
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
                  <div className="panel" style={{ padding: 14 }}>
                    <p className="h3" style={{ marginBottom: 6, fontSize: '.9rem' }}>Essential ingredients</p>
                    <List items={s.setup?.essential} />
                  </div>
                  {s.setup?.favourable?.length > 0 && (
                    <div className="panel" style={{ padding: 14 }}>
                      <p className="h3" style={{ marginBottom: 6, fontSize: '.9rem' }}>Factors that make it more likely</p>
                      <List items={s.setup.favourable} />
                      <p className="note" style={{ marginTop: 8 }}>These raise the odds; they are not required.</p>
                    </div>
                  )}
                </div>
                <dl style={{ margin: '12px 0 0', display: 'grid', gridTemplateColumns: 'minmax(140px,max-content) 1fr', gap: '6px 14px' }}>
                  {Object.entries(SETUP_LABELS).filter(([k]) => s.setup?.[k]).map(([k, l]) => (
                    <React.Fragment key={k}><dt className="faint" style={{ fontSize: '.82rem' }}>{l}</dt><dd style={{ margin: 0, fontSize: '.9rem' }}>{s.setup[k]}</dd></React.Fragment>
                  ))}
                </dl>
              </Block>

              {/* C — Outcomes */}
              <Block id="d-outcomes" icon={Activity} title="Likely weather outcomes">
                <List items={s.outcomes} />
                {s.alternatives && <p className="muted" style={{ marginTop: 10 }}><strong>The same setup can also produce:</strong> {s.alternatives}</p>}
                {s.duration && <p className="muted" style={{ marginTop: 6 }}><strong>Typical duration:</strong> {s.duration}</p>}
              </Block>

              {/* D — Geography */}
              <Block id="d-where" icon={MapPin} title="Geographic distribution">
                <RegionMap regions={catalog.taxonomy.regions} highlight={light?.regions || {}} height={360} isDark={isDark} showList={false}
                  label={`Map of regional relevance for ${s.name}`} />
                <ul style={{ margin: '12px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                  {s.regionRows.filter((r) => r.explicit).sort((a, b) => (b.level === 'high') - (a.level === 'high')).map((r) => (
                    <li key={r.region}><strong>{catalog.regionById.get(r.region)?.name}</strong> — {catalog.taxonomy.relevance[r.level].label.toLowerCase()}{r.reason ? `: ${r.reason}` : ''}</li>
                  ))}
                </ul>
                <p className="note" style={{ marginTop: 8 }}>Regional applicability is not certainty: a scenario relevant to a region will not affect every place within it. Regions not listed are rated "less characteristic" — not immune.</p>
              </Block>

              {/* E — Timing */}
              <Block id="d-when" icon={CalendarDays} title="Timing and seasonality">
                <div className="scroll-x">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,minmax(54px,1fr))', gap: 4, minWidth: 660 }}>
                    {[...s.months].map((c, i) => (
                      <button key={i} type="button" onClick={() => onMonth(i)} className="panel"
                        style={{ padding: '8px 4px', textAlign: 'center', cursor: 'pointer', borderColor: c === '-' ? 'var(--line)' : FREQ_STYLE[c].fg }}
                        aria-label={`${monthNames[i]}: ${FREQ_STYLE[c].label}. Open ${monthNames[i]}`}>
                        <div style={{ fontWeight: 800, fontSize: '.8rem' }}>{monthNames[i].slice(0, 3)}</div>
                        <div style={{ color: FREQ_STYLE[c].fg, fontSize: '.7rem', marginTop: 2 }} aria-hidden="true">{FREQ_STYLE[c].short}</div>
                      </button>
                    ))}
                  </div>
                </div>
                {Object.keys(s.monthNotes || {}).length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                    {Object.entries(s.monthNotes).map(([k, t]) => <li key={k}><strong>{monthNames[catalog.taxonomy.monthKeys.indexOf(k)]}:</strong> {t}</li>)}
                  </ul>
                )}
              </Block>

              {/* F — Frequency */}
              <Block id="d-freq" icon={Activity} title="Frequency and rarity">
                <p style={{ margin: 0 }}>{s.frequency}</p>
                {(s.stats || []).map((st, i) => (
                  <div key={i} className="panel" style={{ padding: 12, marginTop: 10 }}>
                    <p style={{ margin: 0 }}>{st.text}</p>
                    <p className="note" style={{ margin: '6px 0 0' }}>Source: <SourceLink src={src(st.source)} /> · Period: {st.period} · Coverage: {st.scope}</p>
                  </div>
                ))}
                <p className="note" style={{ marginTop: 10 }}>Frequency labels describe climatology — how often this has happened in a month historically — not the chance of it happening in any particular forecast.</p>
              </Block>

              {/* G — Impacts */}
              <Block id="d-impacts" icon={AlertTriangle} title="Severity and impacts">
                <p className="muted" style={{ marginTop: 0 }}>{catalog.taxonomy.severity[s.sev]?.def}</p>
                {Object.keys(s.impacts || {}).length ? (
                  <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(150px,max-content) 1fr', gap: '6px 14px' }}>
                    {Object.entries(s.impacts).map(([k, v]) => <React.Fragment key={k}><dt className="faint" style={{ fontSize: '.82rem' }}>{IMPACT_LABELS[k]}</dt><dd style={{ margin: 0 }}>{v}</dd></React.Fragment>)}
                  </dl>
                ) : <p className="note">No specific impacts are recorded beyond those in the outcomes above.</p>}
              </Block>

              {/* H — Forecasting signals */}
              <Block id="d-signals" icon={Activity} title="Forecasting signals">
                {s.signals?.length ? (
                  <div className="scroll-x"><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560, fontSize: '.88rem' }}>
                    <thead><tr>{['Signal', 'What it tells forecasters', 'Limitations'].map((h) => <th key={h} scope="col" style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line2)' }}>{h}</th>)}</tr></thead>
                    <tbody>{s.signals.map(([a, b, c], i) => <tr key={i}>{[a, b, c].map((t, j) => <td key={j} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' }}>{t}</td>)}</tr>)}</tbody>
                  </table></div>
                ) : <p className="note">No scenario-specific forecasting signals recorded yet.</p>}
              </Block>

              {/* I — History */}
              <Block id="d-history" icon={History} title="Historical examples">
                {s.events?.length ? s.events.map((e) => (
                  <article key={e.id} className="panel" style={{ padding: 14, marginBottom: 10 }}>
                    <p className="faint" style={{ margin: 0, fontSize: '.78rem' }}>{fmtRange(e.start, e.end)} · {e.regions.map((r) => catalog.regionById.get(r)?.name || groupName(r)).join(', ')}</p>
                    <h4 className="h3" style={{ margin: '4px 0 6px' }}>{e.title}</h4>
                    <p style={{ margin: 0, lineHeight: 1.55 }}>{e.summary}</p>
                    {e.observations?.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{e.observations.map((o, i) => <li key={i} style={{ fontSize: '.88rem' }}>{o}</li>)}</ul>}
                    <p className="note" style={{ margin: '8px 0 0' }}>Source: {e.sources.map((sid, i) => <React.Fragment key={sid}>{i > 0 && ' · '}<SourceLink src={src(sid)} /></React.Fragment>)}</p>
                  </article>
                )) : <p className="note">No verified historical example is linked to this scenario yet. Examples are added only when an official account can be cited.</p>}
                <p className="note">Historical examples show what can happen; they are not predictions that the same event will recur.</p>
              </Block>

              {/* J — Climate */}
              <Block id="d-climate" icon={Thermometer} title="Climate change context">
                {s.climate ? (
                  <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(150px,max-content) 1fr', gap: '6px 14px' }}>
                    {s.climate.observed && <><dt className="faint">Observed</dt><dd style={{ margin: 0 }}>{s.climate.observed}</dd></>}
                    {s.climate.projected && <><dt className="faint">Projected</dt><dd style={{ margin: 0 }}>{s.climate.projected}</dd></>}
                    {s.climate.uncertainty && <><dt className="faint">Uncertainty</dt><dd style={{ margin: 0 }}>{s.climate.uncertainty}</dd></>}
                    <dt className="faint">Sources</dt><dd style={{ margin: 0 }}>{(s.climate.sources || []).map((sid, i) => <React.Fragment key={sid}>{i > 0 && ' · '}<SourceLink src={src(sid)} /></React.Fragment>)}</dd>
                  </dl>
                ) : <p className="note">No scenario-specific climate statement is made here: the effect of climate change differs between phenomena, and we only state one where credible evidence is cited.</p>}
              </Block>

              {/* K — Safety */}
              <Block id="d-safety" icon={Shield} title="Safety information">
                {s.safety?.length ? <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{s.safety.map(([t, sid], i) => <li key={i}>{t} <span className="note">(<SourceLink src={src(sid)}>{src(sid)?.publisher}</SourceLink>)</span></li>)}</ul> : <p className="note">No specific safety guidance for this scenario.</p>}
                <p className="note" style={{ marginTop: 8 }}>This library is educational. For live warnings always check <SourceLink src={src('mo-uk-warnings')}>Met Office weather warnings</SourceLink> and your local flood-warning service.</p>
              </Block>

              <Block id="d-related" icon={Link2} title="Related scenarios">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {s.related.map((rid) => { const r = catalog.byId.get(rid); return r ? <button key={rid} type="button" className="chip" onClick={() => onOpen(rid)}>{r.name}</button> : null; })}
                </div>
                <div style={{ marginTop: 10 }}><span className="note">Year at a glance: </span><MonthStrip months={s.months} monthNames={monthNames} onMonth={onMonth} /></div>
              </Block>

              <Block id="d-sources" icon={BookOpen} title="Sources">
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                  {s.sourceRecords.map((x) => <li key={x.id}><SourceLink src={x} /> <span className="note">— {x.publisher}</span></li>)}
                </ul>
                {s.verifiedAt && <p className="note">Content reviewed by an editor on {new Date(s.verifiedAt).toLocaleDateString('en-GB')}.</p>}
              </Block>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const GROUP_NAMES = { all: 'Whole UK', england: 'England', scotland: 'Scotland', south: 'Southern England', 'south-east': 'South-east England', midlands: 'Midlands', north: 'Northern Britain', 'east-coast': 'Eastern coasts', 'west-coast': 'Western coasts', 'south-and-midlands': 'Southern England and Midlands', 'north-england': 'Northern England', 'far-north': 'Northern Scotland and islands', 'inland-england': 'Inland England' };
export const groupName = (g) => GROUP_NAMES[g] || g;
export function fmtRange(a, b) {
  const f = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
}
