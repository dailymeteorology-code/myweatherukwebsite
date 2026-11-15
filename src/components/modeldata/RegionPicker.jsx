/* Zoom to a place (15 Nov 2026): the UK and Ireland, Europe, North Africa and North America without
   the United States, each down to its countries (the UK's nations) and their regions, from
   public/data/regions.json (Natural Earth; tools/modeldata/mdata/regions.py builds it). A search
   finds any of them by name. Places the grid on show does not reach are left out, so the UKV's map
   lists the British Isles and its neighbours, the wide map everything.

   Picking a place zooms to it; one with regions then lists them, one without closes the picker.

   The search (15 Nov 2026, at the user's request: "search up a location or county and it brings me
   to that point; if it is a county it is highlighted in green") also finds the counties of the UK
   and Ireland (public/geo/uk-ie-counties.json: the UK's ceremonial counties, Scotland's regions,
   Wales's preserved counties, Ireland's 26 counties, the Isle of Man and the Channel Islands, from OS
   Boundary-Line and OSi) and every place on the map (the grid's cities and the GeoNames towns and
   villages of Great Britain and Ireland). A county is handed back with its outline to be drawn in
   green; a place with its grid cell, to be zoomed to and pinned. */
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

/* the counties, with their outlines as lon/lat rings */
let countiesP = null;
const unflat = (f) => { const out = []; for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]); return out; };
const loadCounties = () => (countiesP ||= fetch('/geo/uk-ie-counties.json').then((r) => r.json())
  .then((d) => (d.areas || []).map((a) => ({ id: a.id, name: a.name, group: a.group, country: a.country, bbox: a.bbox, polys: a.polys.map((poly) => poly.map(unflat)) })))
  .catch(() => { countiesP = null; return []; }));
/* is a point in a county (even-odd over its rings, so lakes and enclaves are outside)? */
function inCounty(c, lon, lat) {
  const [w, s, e, n] = c.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return false;
  let inside = false;
  for (const poly of c.polys) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}
/* how well a name matches what was typed: the whole name, its start, a word's start, anywhere */
const matchOf = (name, s) => {
  const n = norm(name);
  if (n === s) return 0;
  if (n.startsWith(s)) return 1;
  if (n.split(/[\s\-'’,.()]+/).some((w) => w.startsWith(s))) return 2;
  return n.includes(s) ? 3 : 9;
};
const KIND_ORDER = { county: 0, region: 1, place: 2 };
const placeKind = (p) => (p.pop == null ? 'City' : p.pop >= 100000 ? 'City' : p.pop >= 5000 ? 'Town' : 'Village');

export default function RegionPicker({ grid, onPick, onClose, wholeBox, phone, titled, cities, onCounty, onPlace }) {
  const [areas, setAreas] = useState(null);
  const [counties, setCounties] = useState(null);
  const [path, setPath] = useState([]);                    // [] areas, [a] an area's places, [a, i] a place's regions
  const [q, setQ] = useState('');
  const searchRef = useRef(null);
  useEffect(() => { let on = true; loadRegions().then((a) => on && setAreas(a)); return () => { on = false; }; }, []);
  useEffect(() => { let on = true; loadCounties().then((c) => on && setCounties(c)); return () => { on = false; }; }, []);
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

  /* a search across every county, place, country and region on this grid: the best matches first
     (the whole name, then its start, then a word's), a county before a place of the same name,
     bigger places before smaller */
  const found = useMemo(() => {
    const s = norm(q.trim());
    if (!s || !tree) return null;
    const out = [];
    for (const c of counties || []) {
      const m = matchOf(c.name, s);
      if (m > 3) continue;
      const g = gridBox(c.bbox, grid);
      if (g.inside >= 0.5) out.push({ kind: 'county', m, name: c.name, sub: `County · ${c.group}`, c, gb: g.box });
    }
    for (const p of cities || []) {
      const m = matchOf(p.name, s);
      if (m <= 3) out.push({ kind: 'place', m, name: p.name, p, pop: p.pop ?? (p.rank ? 1e9 / p.rank : 0) });
    }
    tree.forEach((a) => a.items.forEach((it) => {
      const m = matchOf(it.name, s);
      if (m <= 3) out.push({ kind: 'region', m, name: it.name, sub: a.name, gb: it.gb });
      it.regions.forEach((r) => { const mr = matchOf(r.name, s); if (mr <= 3) out.push({ kind: 'region', m: mr, name: r.name, sub: `${it.name}, ${a.name}`, gb: r.gb }); });
    }));
    out.sort((a, b) => a.m - b.m || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.pop || 0) - (a.pop || 0) || a.name.localeCompare(b.name));
    const top = out.slice(0, 40);
    /* a place says which county it is in (Newport, Gwent or Newport, Isle of Wight) */
    const P = projection(grid);
    for (const f of top) {
      if (f.kind !== 'place') continue;
      const [lon, lat] = P.fromGrid(f.p.x, f.p.y);
      const c = (counties || []).find((k) => inCounty(k, lon, lat));
      f.sub = c ? `${placeKind(f.p)} · ${c.name}` : placeKind(f.p);
    }
    return top;
  }, [q, tree, counties, cities, grid]);
  const choose = (f) => {
    if (f.kind === 'county' && onCounty) onCounty(f.c, f.gb);
    else if (f.kind === 'place' && onPlace) onPlace(f.p);
    else onPick(f.gb);
    onClose?.();
  };

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
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a place, county or country…" aria-label="Find a place, county, country or region"
          onKeyDown={(e) => { if (e.key === 'Enter' && found?.length) { e.preventDefault(); choose(found[0]); } }} />
        {q ? <button type="button" className="mdr-clear" onClick={() => setQ('')} aria-label="Clear"><X size={12} /></button> : null}
      </label>
      <div className="mdr-list">
        {!tree ? <div className="mdr-note">Loading the places…</div>
          : found ? (found.length ? found.map((f, i) => row(`f${i}`, f.name, f.sub, () => choose(f))) : <div className="mdr-note">Nothing called “{q.trim()}” on this map.</div>)
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
