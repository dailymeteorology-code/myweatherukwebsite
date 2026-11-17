/* ════════════════════════════════════════════════════════════════════════════
   The Warnings tab (17 Nov 2026, at the user's request: "make the warnings tab show the warning map, not the
   section"). The whole screen is the map of the UK with every warning in force or to come drawn as its real
   Met Office area, and everything else floats on it in glass:

     the header     the status, the warnings archive, and the two switches the user asked for, In force
                    and Upcoming, both on to start with (the severity and type filters and the map's names
                    sit behind Filters)
     the day strip  a week of days, each marked with its worst warning, raised clear of the tab bar
     the sheet      a warning, tapped: WarningSheet (up from the bottom on a phone, at the side on a
                    computer); drag it up for all of it, or down to put it away

   A day with nothing to show greys the map out, holds it still and says "No warnings in force" in the
   middle, with the days that do have a warning under it. The warnings are read every minute, and a
   warning the Met Office has updated says so on its name tag and at the top of its sheet.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, Check, History, SlidersHorizontal, Tag, MapPin, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';
import { attachPlaceLabels, readPlaceLabelsOn, writePlaceLabelsOn } from '@/lib/placeLabels';
import { SEV_HEX, sevInkOn, insideGeometries } from '@/components/warnings/MetOfficeWarning';
import { phaseOf, isUpdated, warningKey, areaOf } from '@/components/warnings/warningState';
import WarningSheet from '@/components/warnings/WarningSheet';
import WarningsArchiveModal from '@/components/warnings/WarningsArchiveModal';
import { saveWarningImage } from '@/components/warnings/warningImage';
import { useLogo } from '@/components/MobileHeaderLogo';
import { useSectionActive } from '@/components/app/sectionActive';
import './warnings-screen.css';

const RANK = { Red: 3, Amber: 2, Yellow: 1 };
const SEV_ORDER = ['Red', 'Amber', 'Yellow'];
const UK = [[49.85, -8.65], [61.0, 2.05]];
const PHONE = '(max-width: 767.98px)';
const DAYS = 7;                                   // the Met Office warns up to a week ahead
const basemap = (dark) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? 'Dark' : 'Light'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

/* the midnight n calendar days on (not n × 24 h, which a clock change throws off) */
const daysOn = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const midnight = () => { const x = new Date(); x.setHours(0, 0, 0, 0); return x; };
/** Is the warning in force at any point during that calendar day? (A warning from 21:00 to 03:00 is on both.) */
function activeOn(w, day) {
  const from = w.validFrom ? Date.parse(w.validFrom) : NaN, to = w.validTo ? Date.parse(w.validTo) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  return from < daysOn(day, 1).getTime() && to > day.getTime();
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* the name tag on a warning's area: [Yellow | Rain ›], with "Updated" on one the Met Office has changed */
function tagHtml(w) {
  const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
  return '<div class="wm-tag">'
    + `<span class="wm-tag-sev" style="background:${hex};color:${sevInkOn(w.severity)}">${esc(w.severity || 'Yellow')}</span>`
    + `<span class="wm-tag-type">${esc(w.type || 'Weather')}${isUpdated(w) ? '<em>Updated</em>' : ''}`
    + '<svg width="7" height="11" viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1 L6.5 6 L1.5 11" stroke="currentColor" stroke-width="2" fill="none"/></svg></span></div>';
}
const longDate = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export default function WarningsMapScreen({ warnings = [], loading = false, checkedAt = null, banner = null }) {
  const { isDark } = useTheme();
  const rootRef = useRef(null);
  const mapEl = useRef(null);
  const topRef = useRef(null);
  const daysRef = useRef(null);
  const sheetRef = useRef(null);
  const mapRef = useRef(null);
  const tilesRef = useRef(null);
  const layersRef = useRef([]);
  const labelsRef = useRef(null);
  const geomsRef = useRef([]);
  const fitRef = useRef({ key: '', target: UK, side: false });
  const movedRef = useRef(false);

  /* the screen's height: all of it below whatever sits above (the computer's site bar), measured while on show */
  const active = useSectionActive();
  const [topOffset, setTopOffset] = useState(0);
  useEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (el && !el.closest('[data-off]')) setTopOffset(Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);

  /* the time, kept fresh: warnings start and end by themselves */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const today = new Date(now).toDateString();
  const days = useMemo(() => { const t = midnight(); return Array.from({ length: DAYS }, (_, i) => daysOn(t, i)); }, [today]);

  const [dayIdx, setDayIdx] = useState(0);
  const [showInForce, setShowInForce] = useState(true);
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [sevFilter, setSevFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [detent, setDetent] = useState('mid');      // the phone sheet: 'mid' or 'full'
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [labelsOn, setLabelsOn] = useState(readPlaceLabelsOn);
  const [namesOn, setNamesOn] = useState(() => { try { return localStorage.getItem('mwuk_warning_names') !== '0'; } catch { return true; } });
  useEffect(() => { writePlaceLabelsOn(labelsOn); labelsRef.current?.setVisible(labelsOn); }, [labelsOn]);
  useEffect(() => { try { localStorage.setItem('mwuk_warning_names', namesOn ? '1' : '0'); } catch { /* blocked */ } }, [namesOn]);

  /* ── the warnings ──────────────────────────────────────────────────────── */
  const mappable = useMemo(() => warnings
    .map((w) => { const area = areaOf(w); return area ? { ...w, polygons: area } : null; })
    .filter((w) => w && phaseOf(w, now) !== 'ended'), [warnings, now]);
  const shown = useMemo(() => mappable.filter((w) => (phaseOf(w, now) === 'inforce' ? showInForce : showUpcoming)
    && (!sevFilter.length || sevFilter.includes(w.severity))
    && (!typeFilter.length || typeFilter.includes(w.type))), [mappable, now, showInForce, showUpcoming, sevFilter, typeFilter]);
  const day = days[dayIdx];
  const forDay = useMemo(() => mappable.filter((w) => activeOn(w, day)), [mappable, day]);
  const visible = useMemo(() => shown.filter((w) => activeOn(w, day)), [shown, day]);
  const counts = useMemo(() => ({
    inforce: mappable.filter((w) => phaseOf(w, now) === 'inforce').length,
    upcoming: mappable.filter((w) => phaseOf(w, now) === 'upcoming').length,
  }), [mappable, now]);
  const types = useMemo(() => [...new Set(mappable.map((w) => w.type).filter(Boolean))].sort(), [mappable]);
  const dayPeak = useMemo(() => days.map((d) => {
    const on = shown.filter((w) => activeOn(w, d));
    return on.length ? on.reduce((b, w) => ((RANK[w.severity] || 1) > (RANK[b] || 1) ? w.severity : b), on[0].severity) : null;
  }), [shown, days]);
  /* the warning open in the sheet, by its id, so a new version of it replaces the old as it arrives */
  const selected = selectedKey ? mappable.find((w) => warningKey(w) === selectedKey) || null : null;
  useEffect(() => { if (selectedKey && !selected) setSelectedKey(null); }, [selectedKey, selected]);
  /* another day: the open warning stays open if it is on that day too */
  useEffect(() => { setSelectedKey((k) => { const w = k && mappable.find((x) => warningKey(x) === k); return w && activeOn(w, day) ? k : null; }); }, [dayIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the days other than this one with something on them, for the empty screen */
  const others = useMemo(() => days.map((d, i) => ({ i, d, list: shown.filter((w) => activeOn(w, d)) })).filter((x) => x.i !== dayIdx && x.list.length), [days, shown, dayIdx]);
  const jumpTo = others.find((x) => x.i > dayIdx)?.i ?? others[others.length - 1]?.i ?? null;
  const othersText = (() => {
    if (!others.length) return '';
    const n = new Set(others.flatMap((x) => x.list.map(warningKey))).size;
    const names = others.length === 1 ? [longDate(others[0].d)] : others.map((x) => shortDate(x.d));
    const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${n === 1 ? 'A warning has' : 'Warnings have'} been issued for ${joined}`;
  })();
  const empty = !loading && visible.length === 0;
  const hiddenHere = forDay.length - visible.length;    // on this day, but switched off

  /* ── framing ──────────────────────────────────────────────────────────── */
  /* clear of the glass: the header above, the day strip (or the sheet) below, the sheet at the side on a computer */
  const framing = (side) => {
    const root = rootRef.current?.getBoundingClientRect();
    if (!root) return { padding: [40, 40] };
    const topGap = Math.max(20, (topRef.current?.getBoundingClientRect().bottom ?? root.top) - root.top + 14);
    const phone = window.matchMedia?.(PHONE).matches;
    /* the sheet where it settles (offsetTop and offsetLeft ignore its sliding in) */
    const sheet = side ? sheetRef.current : null;
    if (sheet && phone) return { paddingTopLeft: [18, topGap], paddingBottomRight: [18, Math.max(40, root.height - sheet.offsetTop + 14)], maxZoom: 9 };
    const stripTop = daysRef.current?.getBoundingClientRect().top ?? root.bottom;
    const bottomGap = Math.max(20, root.bottom - stripTop + 14);
    if (sheet) return { paddingTopLeft: [24, topGap], paddingBottomRight: [Math.max(24, root.width - sheet.offsetLeft + 18), bottomGap], maxZoom: 9 };
    return { paddingTopLeft: [18, topGap], paddingBottomRight: [18, bottomGap] };
  };
  const frame = (force = false) => {
    const map = mapRef.current;
    if (!map || (movedRef.current && !force)) return;
    const f = fitRef.current;
    try { map.fitBounds(f.target, framing(f.side)); } catch { /* not laid out yet */ }
  };

  /* ── the map, made once ────────────────────────────────────────────────── */
  useEffect(() => {
    const el = mapEl.current;
    if (!el || mapRef.current) return undefined;
    const map = L.map(el, { center: [54.6, -3.2], zoom: 5, zoomControl: false, attributionControl: false, zoomSnap: 0.25, minZoom: 4, maxZoom: 11 });
    tilesRef.current = L.tileLayer(basemap(isDark), { maxZoom: 12 }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    mapRef.current = map;
    labelsRef.current = attachPlaceLabels(L, map, { dark: isDark, visible: labelsOn, extraTiers: 1, filter: (lat, lon) => insideGeometries(geomsRef.current, lat, lon) });
    /* the reader's own moves stop the re-framing until the warnings change */
    const mine = () => { movedRef.current = true; };
    ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.addEventListener(ev, mine, { passive: true }));
    const ro = new ResizeObserver(() => { map.invalidateSize({ animate: false }); frame(); });
    ro.observe(el);
    return () => {
      ro.disconnect();
      ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.removeEventListener(ev, mine));
      labelsRef.current?.remove?.();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* light or dark with the app */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tilesRef.current?.setUrl(basemap(isDark));
    labelsRef.current?.remove?.();
    labelsRef.current = attachPlaceLabels(L, map, { dark: isDark, visible: labelsOn, extraTiers: 1, filter: (lat, lon) => insideGeometries(geomsRef.current, lat, lon) });
  }, [isDark]); // eslint-disable-line react-hooks/exhaustive-deps

  /* an empty day holds the map still on the whole of the UK */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'].forEach((h) => { if (map[h]) (empty ? map[h].disable() : map[h].enable()); });
  }, [empty]);

  /* ── the warnings drawn ────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch { /* gone */ } });
    layersRef.current = [];
    const ordered = [...visible].sort((a, b) => (RANK[a.severity] || 1) - (RANK[b.severity] || 1));   // the worst on top
    const drawn = [], picked = [];
    ordered.forEach((w) => {
      const key = warningKey(w);
      const isSel = key === selectedKey;
      const dim = selectedKey && !isSel;
      const hex = SEV_HEX[w.severity] || SEV_HEX.Yellow;
      let biggest = null, bigArea = -1;
      w.polygons.forEach((g) => {
        (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach((rings) => {
          const poly = L.polygon(rings.map((r) => r.map(([lng, lat]) => [lat, lng])), {
            color: hex, fillColor: hex, weight: isSel ? 3 : 2, opacity: dim ? 0.5 : 1, fillOpacity: dim ? 0.14 : isSel ? 0.46 : 0.34,
          }).addTo(map);
          poly.on('click', () => { setSelectedKey(key); setDetent('mid'); });
          layersRef.current.push(poly);
          drawn.push(poly);
          if (isSel) picked.push(poly);
          const b = poly.getBounds();
          const a = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
          if (a > bigArea) { bigArea = a; biggest = poly; }
        });
      });
      if (namesOn && biggest) {
        let at;
        try { at = biggest.getCenter(); } catch { at = biggest.getBounds().getCenter(); }
        const m = L.marker(at, { icon: L.divIcon({ className: 'wm-tag-icon', iconSize: [0, 0], html: tagHtml(w) }), zIndexOffset: isSel ? 2000 : 1000, keyboard: false, title: `${w.severity} ${w.type} warning` }).addTo(map);
        m.on('click', () => { setSelectedKey(key); setDetent('mid'); });
        layersRef.current.push(m);
      }
    });
    geomsRef.current = visible.flatMap((w) => w.polygons);
    labelsRef.current?.setFilter((lat, lon) => insideGeometries(geomsRef.current, lat, lon));

    /* framed again only when what is on the map changes (or a warning is opened), not on a redraw */
    const key = `${dayIdx}|${visible.map(warningKey).join(',')}|${selectedKey || ''}`;
    if (fitRef.current.key !== key) {
      let target = UK;
      if (picked.length) { try { target = L.featureGroup(picked).getBounds(); } catch { /* the UK */ } }
      else if (drawn.length) { try { target = L.featureGroup(drawn).getBounds(); } catch { /* the UK */ } }
      fitRef.current = { key, target, side: !!picked.length };
      movedRef.current = false;
      /* after the sheet has its size */
      requestAnimationFrame(() => frame(true));
    }
  }, [visible, selectedKey, namesOn, dayIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the sheet changing height moves the framing with it, once it has settled */
  useEffect(() => {
    if (!selected) return undefined;
    const t = setTimeout(() => frame(true), 340);
    return () => clearTimeout(t);
  }, [detent]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the sheet on a phone: drag the handle or its head up for all of it, down to make it smaller or put it away ── */
  const drag = useRef(null);
  const sheetDrag = {
    down: (e) => {
      const el = sheetRef.current;
      if (!el || !window.matchMedia?.(PHONE).matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target.closest('button, a, input, select, textarea') || !e.target.closest('.wm-grab, .ws-head, .ws-pills')) return;
      drag.current = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0, h0: el.offsetHeight };
      try { el.setPointerCapture(e.pointerId); } catch { /* follows without */ }
      el.style.transition = 'none';
    },
    move: (e) => {
      const d = drag.current, el = sheetRef.current;
      if (!d || e.pointerId !== d.id || !el) return;
      d.dy = e.clientY - d.y0;
      if (d.dy < 0) { el.style.transform = ''; el.style.height = `${Math.min(d.h0 - d.dy, el.parentElement.clientHeight - 70)}px`; }
      else { el.style.height = ''; el.style.transform = `translateY(${d.dy}px)`; }
    },
    up: (e) => {
      const d = drag.current, el = sheetRef.current;
      if (!d || e.pointerId !== d.id || !el) return;
      drag.current = null;
      const speed = d.dy / Math.max(1, performance.now() - d.t0);
      el.style.transition = '';
      el.style.height = '';
      if (d.dy < -50 || speed < -0.5) { el.style.transform = ''; setDetent('full'); return; }
      if (d.dy > Math.min(120, d.h0 * 0.3) || speed > 0.6) {
        if (detent === 'full') { el.style.transform = ''; setDetent('mid'); return; }
        el.style.transform = `translateY(${d.h0 + 30}px)`;
        setTimeout(() => { setSelectedKey(null); if (sheetRef.current) sheetRef.current.style.transform = ''; }, 200);
        return;
      }
      el.style.transform = '';
    },
  };
  sheetDrag.cancel = sheetDrag.up;

  /* "Save picture": the warning as a picture to keep or share (components/warnings/warningImage.js) */
  const logoUrl = useLogo();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => { setSaveError(''); }, [selectedKey]);
  const savePicture = async () => {
    if (!selected || saving) return;
    setSaving(true); setSaveError('');
    try { await saveWarningImage(selected, { dark: isDark, logoUrl }); } catch (e) { setSaveError(e?.message || 'The picture could not be made.'); }
    setSaving(false);
  };

  /* Escape closes the warning, then the filters */
  useEffect(() => {
    const onKey = (e) => { if (e.key !== 'Escape') return; if (selectedKey) setSelectedKey(null); else setFiltersOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey]);

  const toggle = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const extraFilters = sevFilter.length + typeFilter.length;
  const status = loading ? 'Reading the Met Office warnings…'
    : counts.inforce ? `${counts.inforce} in force${counts.upcoming ? ` · ${counts.upcoming} upcoming` : ''}`
      : counts.upcoming ? `None in force · ${counts.upcoming} upcoming` : 'No warnings in force';
  const checked = checkedAt ? new Date(checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    /* touches stay on the map: the app's pull-to-refresh would read a drag down the map as a reload */
    <div ref={rootRef} className={`wm${isDark ? '' : ' is-light'}${empty ? ' is-empty' : ''}${selected ? ' has-sheet' : ''}`} style={{ '--wm-top': `${topOffset}px` }}
      onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div ref={mapEl} className="wm-map" aria-label="Map of the UK's weather warnings" />

      {/* a day with nothing on it: the map greyed out and held still, and the news in the middle */}
      {empty && (
        <div className="wm-veil">
          <div className="wm-none" role="status">
            <span className="wm-none-mark" aria-hidden="true"><Check strokeWidth={2.6} /></span>
            <b>{hiddenHere > 0 ? 'Nothing to show' : 'No warnings in force'}</b>
            {hiddenHere > 0 && (
              <button type="button" className="wm-none-go" onClick={() => { setShowInForce(true); setShowUpcoming(true); setSevFilter([]); setTypeFilter([]); }}>
                {hiddenHere} {hiddenHere === 1 ? 'warning is' : 'warnings are'} switched off here: show {hiddenHere === 1 ? 'it' : 'them'}
              </button>
            )}
            {hiddenHere === 0 && othersText && (
              <button type="button" className="wm-none-go" onClick={() => jumpTo != null && setDayIdx(jumpTo)}>
                {othersText}<ChevronRight aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* the header: the status, the archive, In force and Upcoming, and the other filters */}
      <div ref={topRef} className="wm-top wm-glass">
        <div className="wm-top-row">
          <div className="wm-title">
            <b>Warnings</b>
            <span>
              {status}
              {checked && <em className="wm-live" title={`The Met Office's warnings are checked every minute. Last read ${checked}.`}><i />Live · {checked}</em>}
            </span>
          </div>
          <button type="button" className="wm-btn" onClick={() => setArchiveOpen(true)} title="Every past warning">
            <History /><span>Archive</span>
          </button>
        </div>
        <div className="wm-switches" role="group" aria-label="Which warnings to show">
          <button type="button" className={`wm-switch${showInForce ? ' is-on' : ''}`} aria-pressed={showInForce} onClick={() => setShowInForce((v) => !v)}>
            <i className="is-inforce" />In force<em>{counts.inforce}</em>
          </button>
          <button type="button" className={`wm-switch${showUpcoming ? ' is-on' : ''}`} aria-pressed={showUpcoming} onClick={() => setShowUpcoming((v) => !v)}>
            <i className="is-upcoming" />Upcoming<em>{counts.upcoming}</em>
          </button>
          <button type="button" className={`wm-switch is-more${filtersOpen || extraFilters ? ' is-on' : ''}`} aria-expanded={filtersOpen} aria-label={extraFilters ? `Filters, ${extraFilters} on` : 'Filters'} onClick={() => setFiltersOpen((v) => !v)}>
            <SlidersHorizontal />{extraFilters ? `Filters · ${extraFilters}` : 'Filters'}
          </button>
        </div>
        {banner}
      </div>

      {filtersOpen && (
        <div className="wm-pop wm-glass is-strong" style={{ top: (topRef.current?.offsetTop || 0) + (topRef.current?.offsetHeight || 0) + 8 }}>
          <div className="wm-pop-row">
            <span className="wm-label">Severity</span>
            {SEV_ORDER.map((s) => (
              <button key={s} type="button" className="wm-chip" aria-pressed={sevFilter.includes(s)} onClick={() => toggle(sevFilter, setSevFilter, s)}>
                <i style={{ background: SEV_HEX[s] }} />{s}
              </button>
            ))}
          </div>
          <div className="wm-pop-row">
            <span className="wm-label">Type</span>
            {types.length === 0 && <span className="wm-soft">No warnings to filter</span>}
            {types.map((t) => <button key={t} type="button" className="wm-chip" aria-pressed={typeFilter.includes(t)} onClick={() => toggle(typeFilter, setTypeFilter, t)}>{t}</button>)}
          </div>
          <div className="wm-pop-row">
            <span className="wm-label">On the map</span>
            <button type="button" className="wm-chip" aria-pressed={namesOn} onClick={() => setNamesOn((v) => !v)}><Tag />Warning names</button>
            <button type="button" className="wm-chip" aria-pressed={labelsOn} onClick={() => setLabelsOn((v) => !v)}><MapPin />Places</button>
          </div>
          {extraFilters > 0 && <button type="button" className="wm-btn" style={{ alignSelf: 'flex-start' }} onClick={() => { setSevFilter([]); setTypeFilter([]); }}>Clear filters</button>}
        </div>
      )}

      {/* a week of days in one slim capsule, a dot in the colour of each day's worst warning */}
      <div ref={daysRef} className="wm-days wm-glass" role="tablist" aria-label="Day">
        {days.map((d, i) => {
          const peak = dayPeak[i];
          return (
            <button key={i} type="button" role="tab" aria-selected={i === dayIdx} className={`wm-day${i === dayIdx ? ' is-on' : ''}`} onClick={() => setDayIdx(i)}
              aria-label={`${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${peak ? `, ${peak.toLowerCase()} warning` : ''}`}>
              {i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' })}
              {peak && <i className="wm-day-dot" style={{ background: SEV_HEX[peak] }} />}
            </button>
          );
        })}
      </div>

      {/* the warning, in full */}
      {selected && (
        <div key={warningKey(selected)} ref={sheetRef} className={`wm-sheet wm-glass is-strong is-${detent}`}
          onPointerDown={sheetDrag.down} onPointerMove={sheetDrag.move} onPointerUp={sheetDrag.up} onPointerCancel={sheetDrag.cancel}>
          <div className="wm-grab" aria-hidden="true"><i /></div>
          <WarningSheet warning={selected} now={now} onClose={() => setSelectedKey(null)}
            actions={(
              <button type="button" className="wm-btn wm-icon" onClick={savePicture} disabled={saving} aria-label="Save this warning as a picture" title="Save this warning as a picture">
                {saving ? <Loader2 className="animate-spin" /> : <Download />}
              </button>
            )} />
          {saveError && <p className="wm-save-err" role="alert">{saveError}</p>}
        </div>
      )}

      <WarningsArchiveModal isOpen={archiveOpen} onClose={() => setArchiveOpen(false)} />
    </div>
  );
}
