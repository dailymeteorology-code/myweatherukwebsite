/* Zoom to a place (15 Nov 2026): the UK and Ireland, Europe, North Africa and North America without
   the United States, each down to its countries (the UK's nations) and their regions, from
   public/data/regions.json (Natural Earth; tools/modeldata/mdata/regions.py builds it). A search
   finds any of them by name. Places the grid on show does not reach are left out, so the UKV's map
   lists the British Isles and its neighbours, the wide map everything.

   Picking a place zooms to it; one with regions then lists them, one without closes the picker. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { GRIDS, projection } from '@/lib/modelGrids';

let regionsP = null;
const loadRegions = () => (regionsP ||= fetch('/data/regions.json').then((r) => r.json()).then((d) => d.areas || [])
  .catch(() => { regionsP = null; return []; }));

/** A lon/lat box [w, s, e, n] on a grid: its grid box [x0, y0, x1, y1] and the share of it the grid holds. */
export function gridBox(box, grid) {
  const P = projection(grid), g = GRIDS[grid];
  const [w, s, e, n] = box;
  const pts = [];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) pts.push(P.toGrid(w + ((e - w) * i) / 8, s + ((n - s) * j) / 8));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const inside = pts.filter(([x, y]) => x >= 0 && x <= g.nx && y >= 0 && y <= g.ny).length / pts.length;
  return {
    box: [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(g.nx, Math.max(...xs)), Math.min(g.ny, Math.max(...ys))],
    inside,
  };
}

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function RegionPicker({ grid, onPick, onClose, wholeBox, phone, titled }) {
  const [areas, setAreas] = useState(null);
  const [path, setPath] = useState([]);                    // [] areas, [a] an area's places, [a, i] a place's regions
  const [q, setQ] = useState('');
  const searchRef = useRef(null);
  useEffect(() => { let on = true; loadRegions().then((a) => on && setAreas(a)); return () => { on = false; }; }, []);
  useEffect(() => { if (!phone) searchRef.current?.focus({ preventScroll: true }); }, [phone]);

  /* what this grid reaches: every place with its grid box, those mostly off the grid left out */
  const tree = useMemo(() => {
    if (!areas) return null;
    const on = (b) => { const g = gridBox(b, grid); return g.inside >= 0.55 ? g.box : null; };
    return areas.map((a) => {
      const items = a.items.map((it) => {
        const gb = on(it.box);
        if (!gb) return null;
        const regions = it.regions.map((r) => { const rb = on(r.box); return rb && { name: r.name, gb: rb }; }).filter(Boolean);
        return { name: it.name, gb, regions };
      }).filter(Boolean);
      return items.length ? { name: a.name, gb: gridBox(a.box, grid).box, items } : null;
    }).filter(Boolean);
  }, [areas, grid]);

  const area = path.length ? tree?.[path[0]] : null;
  const place = path.length > 1 ? area?.items[path[1]] : null;
  const title = place ? place.name : area ? area.name : 'Zoom to';
  const go = (gb, closeAfter) => { onPick(gb); if (closeAfter) onClose?.(); };

  /* a search across every country and region on this grid */
  const found = useMemo(() => {
    const s = norm(q.trim());
    if (!s || !tree) return null;
    const out = [];
    tree.forEach((a) => a.items.forEach((it) => {
      if (norm(it.name).includes(s)) out.push({ name: it.name, sub: a.name, gb: it.gb });
      it.regions.forEach((r) => { if (norm(r.name).includes(s)) out.push({ name: r.name, sub: `${it.name}, ${a.name}`, gb: r.gb }); });
    }));
    return out.slice(0, 60);
  }, [q, tree]);

  const row = (key, label, sub, onClick, more) => (
    <button key={key} type="button" className="mdr-row" onClick={onClick}>
      <span className="mdr-name">{label}{sub ? <i>{sub}</i> : null}</span>
      {more ? <span className="mdr-more">{more}<ChevronRight size={15} /></span> : null}
    </button>
  );

  return (
    <div className={`mdr${phone ? ' is-phone' : ''}`}>
      {(path.length || !titled) ? <div className="mdr-head">
        {path.length ? (
          <button type="button" className="mdr-back" onClick={() => setPath((p) => p.slice(0, -1))} aria-label="Back"><ChevronLeft size={17} /></button>
        ) : null}
        <b className="mdr-title">{title}</b>
        {onClose && !titled ? <button type="button" className="mdr-back" onClick={onClose} aria-label="Close"><X size={15} /></button> : null}
      </div> : null}
      <label className="mdr-search">
        <Search size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a country or region…" aria-label="Find a country or region" />
        {q ? <button type="button" className="mdr-clear" onClick={() => setQ('')} aria-label="Clear"><X size={12} /></button> : null}
      </label>
      <div className="mdr-list">
        {!tree ? <div className="mdr-note">Loading the places…</div>
          : found ? (found.length ? found.map((f, i) => row(`f${i}`, f.name, f.sub, () => go(f.gb, true))) : <div className="mdr-note">No country or region called “{q.trim()}” on this map.</div>)
          : place ? (
            <>
              {row('all', `All of ${place.name}`, null, () => go(place.gb, true))}
              {place.regions.map((r, i) => row(`r${i}`, r.name, null, () => go(r.gb, true)))}
            </>
          ) : area ? (
            <>
              {row('all', `All of ${area.name}`, null, () => go(area.gb, false))}
              {area.items.map((it, i) => row(`i${i}`, it.name, null, () => { go(it.gb, !it.regions.length); if (it.regions.length) setPath([path[0], i]); },
                it.regions.length ? `${it.regions.length}` : null))}
            </>
          ) : (
            <>
              {wholeBox ? row('whole', 'Whole map', null, () => go(wholeBox, true)) : null}
              {tree.map((a, i) => row(`a${i}`, a.name, null, () => { go(a.gb, false); setPath([i]); }, `${a.items.length}`))}
            </>
          )}
      </div>
    </div>
  );
}
