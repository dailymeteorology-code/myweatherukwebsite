/* Model Data's layer picker on a phone (17 Nov 2026, at the user's request: "make the variable selection screen
   much much better, as the section title is off and the design of it doesn't look good at all; and make it so
   you can pull down to close it").

   An iOS sheet: a handle and a large title, the model and run under it, a search field, and a row of categories
   that scrolls sideways and keeps up with the list. The layers are grouped lists, as iOS Settings has them: a
   small capital heading over each group, and a row for each layer with its colours, its name, its unit and a
   line saying what it shows; a tick on the one on show. Pull the sheet down by its top, or pull the list down
   when it is at its top, and it closes (a flick is enough). The desktop and tablet picker is LayerBrowser.jsx. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star, X, Check, Info } from 'lucide-react';
import { categoryOf } from '@/lib/modelLayers';
import './layer-sheet.css';

export default function LayerSheet({ items, popular = [], selected, onPick, onClose, title, subtitle, note, query, setQuery, extra, modelAbout, favs = [], onFav, light = false }) {
  const byKey = useMemo(() => new Map(items.map((it) => [it.key, it])), [items]);
  const pop = useMemo(() => popular.filter((k) => byKey.has(k)).slice(0, 12), [popular, byKey]);
  /* the groups in their first-seen order: your favourites, then Popular, then each category */
  const cats = useMemo(() => {
    const out = [];
    const fav = favs.filter((k) => byKey.has(k));
    if (fav.length) out.push({ id: '__favs', name: 'Favourites', icon: 'mostlyClear', keys: fav });
    if (pop.length >= 4) out.push({ id: '__popular', name: 'Popular', icon: 'partly', keys: pop });
    const seen = new Map();
    for (const it of items) {
      if (!seen.has(it.group)) { const c = categoryOf(it.group); seen.set(it.group, { id: it.group, name: c.name, icon: c.icon, keys: [] }); out.push(seen.get(it.group)); }
      seen.get(it.group).keys.push(it.key);
    }
    return out;
  }, [items, pop, favs, byKey]);
  const q = (query || '').trim().toLowerCase();
  const found = useMemo(() => (!q ? null : items.filter((it) => [it.label, it.desc, categoryOf(it.group).name, it.unit].some((s) => s && s.toLowerCase().includes(q)))), [q, items]);
  const [info, setInfo] = useState(null);                  // the row whose line is open, or '__model'

  /* the list, and the category row keeping up with it */
  const listRef = useRef(null);
  const chipsRef = useRef(null);
  const [current, setCurrent] = useState(() => byKey.get(selected)?.group || cats[0]?.id);
  const onScroll = () => {
    const el = listRef.current;
    if (!el || found) return;
    let at = cats[0]?.id;
    for (const sec of el.querySelectorAll('[data-cat]')) { if (sec.offsetTop - el.offsetTop <= el.scrollTop + 24) at = sec.dataset.cat; }
    if (at && at !== current) setCurrent(at);
  };
  useEffect(() => {
    const chip = chipsRef.current?.querySelector(`[data-chip="${CSS.escape(current || '')}"]`);
    chip?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [current]);
  const jump = (id, smooth = true) => {
    const el = listRef.current, sec = el?.querySelector(`[data-cat="${CSS.escape(id)}"]`);
    if (el && sec) el.scrollTo({ top: sec.offsetTop - el.offsetTop - 4, behavior: smooth ? 'smooth' : 'auto' });
  };
  /* open at the layer on show */
  useEffect(() => {
    const g = byKey.get(selected)?.group;
    if (!g) return;
    requestAnimationFrame(() => {
      const el = listRef.current, row = el?.querySelector(`[data-key="${CSS.escape(selected)}"]`);
      const sec = el?.querySelector(`[data-cat="${CSS.escape(g)}"]`);
      if (el && sec) el.scrollTop = Math.max(0, sec.offsetTop - el.offsetTop - 4);
      if (row && el && row.offsetTop - el.offsetTop > el.scrollTop + el.clientHeight - 80) el.scrollTop = row.offsetTop - el.offsetTop - 120;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Escape closes it */
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  /* ── pulling it down ───────────────────────────────────────────────────── */
  const sheetRef = useRef(null);
  const drag = useRef(null);
  const follow = (dy) => { const el = sheetRef.current; if (el) el.style.transform = dy > 0 ? `translateY(${dy}px)` : ''; };
  const release = (dy, ms) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = '';
    const speed = dy / Math.max(1, ms);
    if (dy > Math.min(140, el.offsetHeight * 0.25) || (dy > 30 && speed > 0.55)) {
      el.style.transform = `translateY(${el.offsetHeight + 20}px)`;
      setTimeout(onClose, 200);
    } else follow(0);
  };
  /* by the handle and the header */
  const head = {
    onPointerDown: (e) => {
      if (e.target.closest('button, input, select, a, label') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* follows without */ }
      if (sheetRef.current) sheetRef.current.style.transition = 'none';
    },
    onPointerMove: (e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; d.dy = Math.max(0, e.clientY - d.y0); follow(d.dy); },
    onPointerUp: (e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; drag.current = null; release(d.dy, performance.now() - d.t0); },
  };
  head.onPointerCancel = head.onPointerUp;
  /* and by the list, when it is already at its top: a pull down moves the sheet instead of the list */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    let t = null;
    const start = (e) => { t = el.scrollTop <= 0 ? { y0: e.touches[0].clientY, t0: performance.now(), dy: 0, on: false } : null; };
    const move = (e) => {
      if (!t) return;
      const dy = e.touches[0].clientY - t.y0;
      if (!t.on && (dy <= 4 || el.scrollTop > 0)) { if (dy < 0) t = null; return; }
      if (!t.on) { t.on = true; if (sheetRef.current) sheetRef.current.style.transition = 'none'; }
      e.preventDefault();
      t.dy = Math.max(0, dy);
      follow(t.dy);
    };
    const end = () => { if (t?.on) release(t.dy, performance.now() - t.t0); t = null; };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (it, i, n, withCat) => {
    const on = it.key === selected, fav = favs.includes(it.key);
    return (
      <div key={`${withCat ? 'f' : 'c'}${it.key}`} className={`ls-row${on ? ' is-on' : ''}${i === n - 1 ? ' is-last' : ''}`} data-key={it.key}>
        <button type="button" className="ls-pick" onClick={() => onPick(it.key)} aria-pressed={on}>
          <span className="ls-ramp" style={it.ramp ? { background: it.ramp } : undefined} aria-hidden="true" />
          <span className="ls-text">
            <span className="ls-name">{it.label}{it.unit ? <em>{it.unit}</em> : null}</span>
            <span className="ls-desc">{withCat ? `${categoryOf(it.group).name} · ` : ''}{it.desc || ''}</span>
          </span>
          {on && <Check className="ls-tick" aria-hidden="true" />}
        </button>
        <div className="ls-acts">
          <button type="button" className={`ls-act${info === it.key ? ' is-on' : ''}`} onClick={() => setInfo((o) => (o === it.key ? null : it.key))}
            aria-expanded={info === it.key} aria-label={`What ${it.label} shows`}><Info /></button>
          {onFav && (
            <button type="button" className={`ls-act ls-fav${fav ? ' is-on' : ''}`} onClick={() => onFav(it.key)} aria-pressed={fav}
              aria-label={fav ? `Take ${it.label} out of your favourites` : `Add ${it.label} to your favourites`}><Star /></button>
          )}
        </div>
        {info === it.key && <p className="ls-info">{it.desc || `${it.label}, in ${categoryOf(it.group).name.toLowerCase()}.`}</p>}
      </div>
    );
  };

  return (
    <>
      <div className="ls-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className={`ls${light ? ' is-light' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ls-top" {...head}>
          <div className="ls-grab" aria-hidden="true"><i /></div>
          <div className="ls-head">
            <div className="ls-title">
              <b>{title}</b>
              {subtitle && (
                <span>{subtitle}
                  {modelAbout && (
                    <button type="button" className={`ls-about${info === '__model' ? ' is-on' : ''}`} onClick={() => setInfo((o) => (o === '__model' ? null : '__model'))}
                      aria-expanded={info === '__model'} aria-label={`What ${modelAbout.name} is`}><Info /></button>
                  )}
                </span>
              )}
            </div>
            <button type="button" className="ls-close" onClick={onClose} aria-label="Close"><X /></button>
          </div>
          {info === '__model' && modelAbout && <p className="ls-model"><b>{modelAbout.name}</b> {modelAbout.text}</p>}
          {extra && <div className="ls-extra">{extra}</div>}
          <label className="ls-search">
            <Search aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rain, snow, wind, cloud…" aria-label="Search the layers" enterKeyHint="search" />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear the search"><X /></button> : null}
          </label>
          {!found && (
            <div ref={chipsRef} className="ls-chips" role="tablist" aria-label="Categories">
              {cats.map((c) => (
                <button key={c.id} type="button" role="tab" data-chip={c.id} aria-selected={c.id === current} className={`ls-chip${c.id === current ? ' is-on' : ''}`}
                  onClick={() => { setCurrent(c.id); jump(c.id); }}>
                  <img src={`/icons/wx/${c.icon}.svg`} alt="" draggable={false} />{c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div ref={listRef} className="ls-list" onScroll={onScroll}>
          {found ? (
            found.length ? (
              <section className="ls-sec">
                <h3>{found.length} {found.length === 1 ? 'layer' : 'layers'}</h3>
                <div className="ls-group">{found.map((it, i) => row(it, i, found.length, true))}</div>
              </section>
            ) : <p className="ls-empty">Nothing called “{query.trim()}”. Try rain, snow, wind or cloud.</p>
          ) : cats.map((c) => {
            const list = c.keys.map((k) => byKey.get(k)).filter(Boolean);
            return (
              <section key={c.id} className="ls-sec" data-cat={c.id}>
                <h3><span>{c.name}</span><em>{list.length}</em></h3>
                <div className="ls-group">{list.map((it, i) => row(it, i, list.length, false))}</div>
              </section>
            );
          })}
          {note && <p className="ls-note">{note}</p>}
        </div>
      </div>
    </>
  );
}
