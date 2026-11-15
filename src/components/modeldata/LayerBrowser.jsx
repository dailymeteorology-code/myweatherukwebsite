/* Model Data's layer picker, in the STRATA look of the motion graphics (15 Nov 2026).

   Every layer is a card: its name, its unit, one line saying what it shows, and its colours as the
   map draws them (a stepped bar where the map is drawn in steps). The cards are sorted into
   categories, each with one of the website's weather icons on a navy badge; Popular comes first
   with the most-used layers the model has. Typing searches every layer by name, line and category.

   Desktop and tablet: a large card under the top bar, the categories down its side. Phones: a solid
   sheet from the bottom with every category in one list that scrolls up and down (headings stay in
   view), a "Jump to" menu beside the search, and nothing that has to be swiped sideways. Esc closes it.

   An "i" on every card says what the layer shows, and one beside the title what the model is (15 Nov
   2026, at the user's request). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { categoryOf } from '@/lib/modelLayers';

const Badge = ({ icon }) => (
  <span className="mdb-badge" aria-hidden="true"><img src={`/icons/wx/${icon}.svg`} alt="" draggable={false} /></span>
);

/**
 * items:   [{ key, label, group, desc, unit, ramp }] in the order they should be listed
 * popular: keys for the Popular category, most-used first (those present)
 */
export default function LayerBrowser({ items, popular = [], selected, onPick, onClose, title, subtitle, note, layout, style, query, setQuery, extra, modelAbout }) {
  const phone = layout === 'phone';
  const [info, setInfo] = useState(null);                  // the card whose "i" is open, or '__model'
  const byKey = useMemo(() => new Map(items.map((it) => [it.key, it])), [items]);
  const pop = useMemo(() => popular.filter((k) => byKey.has(k)).slice(0, 12), [popular, byKey]);
  /* the categories in their first-seen order, Popular first */
  const cats = useMemo(() => {
    const out = [];
    if (pop.length >= 4) out.push({ id: '__popular', name: 'Popular', icon: 'partly', keys: pop });
    const seen = new Map();
    for (const it of items) {
      if (!seen.has(it.group)) { const c = categoryOf(it.group); seen.set(it.group, { id: it.group, name: c.name, icon: c.icon, keys: [] }); out.push(seen.get(it.group)); }
      seen.get(it.group).keys.push(it.key);
    }
    return out;
  }, [items, pop]);
  /* open on the category of the layer on show */
  const [cat, setCat] = useState(() => (byKey.get(selected)?.group) || cats[0]?.id);
  useEffect(() => { if (!cats.some((c) => c.id === cat)) setCat(cats[0]?.id); }, [cats, cat]);
  const searchRef = useRef(null);
  useEffect(() => { if (!phone) searchRef.current?.focus({ preventScroll: true }); }, [phone]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const q = (query || '').trim().toLowerCase();
  const found = useMemo(() => (!q ? null : items.filter((it) => [it.label, it.desc, categoryOf(it.group).name, it.unit].some((s) => s && s.toLowerCase().includes(q)))), [q, items]);
  const shown = cats.find((c) => c.id === cat) || cats[0];

  const card = (it, withCat) => (
    <div key={`${withCat ? 'f' : 'c'}${it.key}`} className="mdb-cardwrap">
      <button type="button" className="mdb-card" aria-pressed={it.key === selected} onClick={() => onPick(it.key)} title={it.desc || it.label}>
        <span className="mdb-card-top">
          <span className="mdb-name">{it.label}</span>
          {it.unit ? <span className="mdb-unit">{it.unit}</span> : null}
        </span>
        {withCat && <span className="mdb-cat-tag">{categoryOf(it.group).name}</span>}
        {it.ramp ? <i className="mdb-ramp" style={{ background: it.ramp }} /> : null}
      </button>
      <button type="button" className={`mdb-i${info === it.key ? ' is-on' : ''}`} onClick={() => setInfo((o) => (o === it.key ? null : it.key))}
        aria-expanded={info === it.key} aria-label={`What ${it.label} shows`} title={`What ${it.label} shows`}>i</button>
      {info === it.key && (
        <div className="mdb-info" role="note">
          <b>{it.label}{it.unit ? ` (${it.unit})` : ''}</b>
          <span>{it.desc || `${it.label}, in ${categoryOf(it.group).name.toLowerCase()}.`}</span>
        </div>
      )}
    </div>
  );

  const section = (c) => (
    <section key={c.id} data-cat={c.id} className="mdb-section">
      <div className="mdb-sect"><Badge icon={c.icon} />{c.name}<span className="mdb-count" style={{ marginLeft: 0 }}>{c.keys.length}</span></div>
      <div className="mdb-grid">{c.keys.map((k) => byKey.get(k)).filter(Boolean).map((it) => card(it, false))}</div>
    </section>
  );
  const list = found
    ? (found.length ? <div className="mdb-grid">{found.map((it) => card(it, true))}</div> : <div className="mdb-empty">Nothing called “{query.trim()}”. Try rain, snow, wind or cloud.</div>)
    : phone ? cats.map(section)                                   // phones: every category in one list that scrolls up and down
      : shown && section(shown);
  /* phones: open the list at the layer on show's category, and jump to any other from the menu */
  const cardsRef = useRef(null);
  const jump = (id, smooth) => {
    const el = cardsRef.current?.querySelector(`[data-cat="${CSS.escape(id)}"]`);
    if (el && cardsRef.current) cardsRef.current.scrollTo({ top: el.offsetTop - cardsRef.current.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => { if (phone && !q) jump(byKey.get(selected)?.group || cats[0]?.id, false); }, [phone]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`mdb${phone ? ' is-phone' : ''}`} role="dialog" aria-modal="false" aria-label={title} style={style}>
      <div className="mdb-head">
        <div className="mdb-title">
          <b>{title}</b>
          {subtitle ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{subtitle}
              {modelAbout ? <button type="button" className={`mdb-i is-inline${info === '__model' ? ' is-on' : ''}`} onClick={() => setInfo((o) => (o === '__model' ? null : '__model'))}
                aria-expanded={info === '__model'} aria-label={`What ${modelAbout.name} is`} title={`What ${modelAbout.name} is`}>i</button> : null}
            </span>
          ) : null}
        </div>
        <label className="mdb-search">
          <Search size={15} style={{ opacity: 0.6, flexShrink: 0 }} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rain, snow, wind, cloud…" aria-label="Search the layers" />
          {query ? <button type="button" className="mdb-x" style={{ width: 24, height: 24 }} onClick={() => setQuery('')} aria-label="Clear the search"><X size={12} /></button> : null}
        </label>
        {phone && (
          <label className="mdb-jump" title="Jump to a category">
            <select value="" onChange={(e) => { if (e.target.value) { setQuery(''); requestAnimationFrame(() => jump(e.target.value, true)); } }} aria-label="Jump to a category">
              <option value="">Jump to…</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="mdb-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      {info === '__model' && modelAbout ? <div className="mdb-info is-model" role="note"><b>{modelAbout.name}</b><span>{modelAbout.text}</span></div> : null}
      {/* phones and tablets: the model and the run, above the layers */}
      {extra ? <div className="mdb-extra">{extra}</div> : null}
      <div className="mdb-body">
        {!phone && (
          <nav className="mdb-cats" aria-label="Categories">
            {cats.map((c) => (
              <button key={c.id} type="button" className="mdb-cat" aria-pressed={!found && c.id === shown?.id} onClick={() => { setQuery(''); setCat(c.id); }}>
                <Badge icon={c.icon} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span className="mdb-count">{c.keys.length}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="mdb-cards" ref={cardsRef}>{list}</div>
      </div>
      {note ? <div className="mdb-foot">{note}</div> : null}
    </div>
  );
}
