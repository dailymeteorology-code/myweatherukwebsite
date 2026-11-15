/* Model Data's layer picker, in the STRATA look of the motion graphics (15 Nov 2026).

   Every layer is a card: its name, its unit, one line saying what it shows, and its colours as the
   map draws them (a stepped bar where the map is drawn in steps). The cards are sorted into
   categories, each with one of the website's weather icons on a navy badge; Popular comes first
   with the most-used layers the model has. Typing searches every layer by name, line and category.

   Desktop and tablet: a large card under the top bar, the categories down its side. Phones: a sheet
   from the bottom, the categories as a row of chips. Esc closes it. */
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
export default function LayerBrowser({ items, popular = [], selected, onPick, onClose, title, subtitle, note, layout, style, query, setQuery, extra }) {
  const phone = layout === 'phone';
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
    <button key={`${withCat ? 'f' : 'c'}${it.key}`} type="button" className="mdb-card" aria-pressed={it.key === selected} onClick={() => onPick(it.key)} title={it.desc || it.label}>
      <span className="mdb-card-top">
        <span className="mdb-name">{it.label}</span>
        {it.unit ? <span className="mdb-unit">{it.unit}</span> : null}
      </span>
      {withCat && <span className="mdb-cat-tag">{categoryOf(it.group).name}</span>}
      {it.desc ? <span className="mdb-desc">{it.desc}</span> : null}
      {it.ramp ? <i className="mdb-ramp" style={{ background: it.ramp }} /> : null}
    </button>
  );

  const list = found
    ? (found.length ? <div className="mdb-grid">{found.map((it) => card(it, true))}</div> : <div className="mdb-empty">Nothing called “{query.trim()}”. Try rain, snow, wind or cloud.</div>)
    : shown && (
      <>
        <div className="mdb-sect"><Badge icon={shown.icon} />{shown.name}<span className="mdb-count" style={{ marginLeft: 0 }}>{shown.keys.length}</span></div>
        <div className="mdb-grid">{shown.keys.map((k) => byKey.get(k)).filter(Boolean).map((it) => card(it, false))}</div>
      </>
    );

  return (
    <div className={`mdb${phone ? ' is-phone' : ''}`} role="dialog" aria-modal="false" aria-label={title} style={style}>
      <div className="mdb-head">
        <div className="mdb-title"><b>{title}</b>{subtitle ? <span>{subtitle}</span> : null}</div>
        <label className="mdb-search">
          <Search size={15} style={{ opacity: 0.6, flexShrink: 0 }} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rain, snow, wind, cloud…" aria-label="Search the layers" />
          {query ? <button type="button" className="mdb-x" style={{ width: 24, height: 24 }} onClick={() => setQuery('')} aria-label="Clear the search"><X size={12} /></button> : null}
        </label>
        <button type="button" className="mdb-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      {/* phones and tablets: the model and the run, above the layers */}
      {extra ? <div className="mdb-extra">{extra}</div> : null}
      <div className="mdb-body">
        {phone ? (
          <div className="mdb-chips" role="tablist" aria-label="Categories">
            {cats.map((c) => (
              <button key={c.id} type="button" role="tab" className="mdb-chip" aria-pressed={!found && c.id === shown?.id} onClick={() => { setQuery(''); setCat(c.id); }}>
                <Badge icon={c.icon} />{c.name}
              </button>
            ))}
          </div>
        ) : (
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
        <div className="mdb-cards">{list}</div>
      </div>
      {note ? <div className="mdb-foot">{note}</div> : null}
    </div>
  );
}
