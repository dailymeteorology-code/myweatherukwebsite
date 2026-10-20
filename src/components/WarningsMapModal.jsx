import { attachPlaceLabels, readPlaceLabelsOn, writePlaceLabelsOn } from '@/lib/placeLabels';
/* ════════════════════════════════════════════════════════════════════════════
   WarningsMapModal — every warning on one interactive map.

   The warning cards answer "what is warned where I am". This answers the other
   question: what is warned across the country, and when. It is a full-screen
   map you can pan and zoom, with each warning drawn as its real Met Office
   polygon and clickable for its details.

   THREE CONTROLS, and each exists because the map is unreadable without it:

     day bar      Warnings overlap in time. Showing five days at once stacks
                  four polygons over the same ground and none of them can be
                  read. One day at a time is the only version that works.
     severity     A yellow rain warning over half the country buries an amber
                  wind warning underneath it.
     type         During a mixed spell there can be rain, wind and snow
                  warnings live at once, and usually only one is being looked
                  for.

   EMPTY DAYS SAY SO. A day with nothing active says so in a banner over a
   sharp map of the UK, rather than leaving an empty map that is
   indistinguishable from one that failed to load.

   LIQUID GLASS. The map fills the whole sheet and every control floats on it in
   glass (warnings-glass.css): the title bar, the filters, the day strip and the
   warning's own sheet, which slides in from the side (up from the bottom on a
   phone). Light or dark with the site.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef, useMemo } from 'react';
/* Leaflet from the site's own bundle (the home page's radar already ships it), not the unpkg
   CDN: a blocked or slow CDN left this map blank. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '@/components/ThemeContext';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, SlidersHorizontal, MapPin, Tag, ArrowRight, Check } from 'lucide-react';
import { WarningDetailPanel, warningTagHtml, insideGeometries } from '@/components/warnings/MetOfficeWarning';
import '@/components/warnings/warnings-glass.css';

const SEV = {
  Red:    { hex: '#dc2626', rank: 3 },
  Amber:  { hex: '#f59e0b', rank: 2 },
  Yellow: { hex: '#facc15', rank: 1 },
};
const sevOf = (s) => SEV[s] || SEV.Yellow;
const SEV_ORDER = ['Red', 'Amber', 'Yellow'];

const UK_BOUNDS = [[49.85, -8.65], [61.0, 2.05]];
/* framing clear of the floating glass: the title bar above, the day strip below */
const FIT = { paddingTopLeft: [24, 86], paddingBottomRight: [24, 92] };
const DAY_MS = 86400000;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Is the warning in force at any point during that calendar day? */
function activeOn(w, day) {
  const from = w.validFrom ? new Date(w.validFrom).getTime() : null;
  const to   = w.validTo   ? new Date(w.validTo).getTime()   : null;
  if (!from || !to) return false;
  const s = day.getTime(), e = s + DAY_MS;
  // Overlap, not containment: a warning running 21:00-03:00 belongs to both days.
  return from < e && to > s;
}

const dayLabel = (d, i) => {
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short' });
};

export default function WarningsMapModal({ isOpen, onClose, warnings = [] }) {
  /* The map, the panel behind it and the ground under it all followed the dark
     basemap regardless of the site theme, so this opened as a black sheet over
     a white page. */
  const { isDark } = useTheme();
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const layersRef = useRef([]);

  const [dayIdx, setDayIdx] = useState(0);
  const [sevFilter, setSevFilter] = useState([]);   // empty = all
  const [typeFilter, setTypeFilter] = useState([]); // empty = all
  const [selected, setSelected] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [labelsOn, setLabelsOn] = useState(readPlaceLabelsOn);
  const labelsRef = useRef(null);
  useEffect(() => { writePlaceLabelsOn(labelsOn); labelsRef.current?.setVisible(labelsOn); }, [labelsOn]);
  /* Warning name tags ("Yellow | Wind >") on each area, remembered per browser. */
  const [namesOn, setNamesOn] = useState(() => { try { return localStorage.getItem('mwuk_warning_names') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('mwuk_warning_names', namesOn ? '1' : '0'); } catch { /* blocked */ } }, [namesOn]);
  /* Place names are only drawn INSIDE the warning areas on show: the places
     being warned, not every town in the country. */
  const geomsRef = useRef([]);
  const insideWarned = useRef((lat, lon) => insideGeometries(geomsRef.current, lat, lon)).current;
  const fitKeyRef = useRef('');
  const fitTargetRef = useRef(UK_BOUNDS);   // what the map is framed on: the warnings shown, or the UK
  const movedRef = useRef(false);           // the reader has panned or zoomed: stop re-framing
  const roRef = useRef(null);

  const days = useMemo(() => {
    const t = startOfDay(new Date());
    return Array.from({ length: 5 }, (_, i) => new Date(t.getTime() + i * DAY_MS));
  }, []);

  /* Only warnings with real geometry can be drawn. One that never got a polygon
     would otherwise count towards a day's badge and then not appear when that
     day is opened, which reads as a broken map.

     Manually-issued warnings keep their hand-drawn area under `area_drawing`
     as [lat, lng] rings, so convert those to the same GeoJSON shape the Met
     Office feed uses rather than teaching the drawing code a second format. */
  const mappable = useMemo(
    () => warnings.map(w => {
      if (Array.isArray(w.polygons) && w.polygons.length > 0) return w;
      // Met Office NSWWS warnings carry their official area as `geometry`.
      if (w.geometry && (w.geometry.type === 'Polygon' || w.geometry.type === 'MultiPolygon')) return { ...w, polygons: [w.geometry] };
      const drawn = (w.area_drawing || [])
        .map(s => (s?.latLngs || []).filter(p => Array.isArray(p) && p.length === 2))
        .filter(ring => ring.length >= 3)
        .map(ring => ({ type: 'Polygon', coordinates: [ring.map(([lat, lng]) => [lng, lat])] }));
      return drawn.length ? { ...w, polygons: drawn } : w;
    }).filter(w => Array.isArray(w.polygons) && w.polygons.length > 0),
    [warnings]);

  const types = useMemo(
    () => Array.from(new Set(mappable.map(w => w.type).filter(Boolean))).sort(),
    [mappable]);

  const forDay = useMemo(
    () => mappable.filter(w => activeOn(w, days[dayIdx])),
    [mappable, days, dayIdx]);

  const visible = useMemo(() => forDay.filter(w =>
    (!sevFilter.length || sevFilter.includes(w.severity)) &&
    (!typeFilter.length || typeFilter.includes(w.type))
  ), [forDay, sevFilter, typeFilter]);

  /** Highest severity per day, for the badges on the day bar. */
  const dayPeak = useMemo(() => days.map(d => {
    const on = mappable.filter(w => activeOn(w, d));
    if (!on.length) return null;
    return on.reduce((best, w) =>
      sevOf(w.severity).rank > sevOf(best).rank ? w.severity : best, on[0].severity);
  }), [mappable, days]);

  /** The nearest day with a warning: the next one after this day, else the latest before it. */
  const nextWarnedDay = useMemo(() => {
    const after = dayPeak.findIndex((p, i) => p && i > dayIdx);
    if (after >= 0) return after;
    for (let i = dayIdx - 1; i >= 0; i -= 1) if (dayPeak[i]) return i;
    return null;
  }, [dayPeak, dayIdx]);
  const warnedDays = dayPeak.filter(Boolean).length;

  const toggle = (list, setList, v) =>
    setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  /* ── Map ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    /* draw() is declared before build() because build() calls it. Hoisting
       would have covered it, but relying on that hides the dependency. */
    const draw = () => {
      const map = mapInst.current;
      if (!map) return;
      layersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /* gone */ } });
      layersRef.current = [];

      // Most severe last, so an amber area is never hidden under a yellow one.
      const ordered = [...visible].sort(
        (a, b) => sevOf(a.severity).rank - sevOf(b.severity).rank);

      const drawn = [];
      const tags = [];
      ordered.forEach(w => {
        let biggest = null, bigArea = -1;
        const hex = sevOf(w.severity).hex;
        w.polygons.forEach(g => {
          const polyList = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
          polyList.forEach(rings => {
            const latLngs = rings.map(r => r.map(([lng, lat]) => [lat, lng]));
            const poly = L.polygon(latLngs, {
              color: hex, fillColor: hex, fillOpacity: 0.34, weight: 2, interactive: true,
            }).addTo(map);
            poly.on('click', () => setSelected(w));
            poly.on('mouseover', () => poly.setStyle({ fillOpacity: 0.5 }));
            poly.on('mouseout', () => poly.setStyle({ fillOpacity: 0.34 }));
            layersRef.current.push(poly);
            drawn.push(poly);
            const b = poly.getBounds();
            const area = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
            if (area > bigArea) { bigArea = area; biggest = poly; }
          });
        });
        if (namesOn && biggest) tags.push([w, biggest]);
      });
      // Name tags on top of every area, at the centre of each warning's largest piece.
      tags.forEach(([w, poly]) => {
        let at;
        try { at = poly.getCenter(); } catch { at = poly.getBounds().getCenter(); }
        const m = L.marker(at, { icon: L.divIcon({ className: '', iconSize: [0, 0], html: warningTagHtml(w) }), zIndexOffset: 1000, title: `${w.severity} ${w.type} warning` }).addTo(map);
        m.on('click', () => setSelected(w));
        layersRef.current.push(m);
      });
      geomsRef.current = visible.flatMap(w => w.polygons);
      labelsRef.current?.setFilter(insideWarned);

      // Refit only when the set of warnings changes, not when a tag toggle redraws.
      const fitKey = `${dayIdx}|${visible.map(w => w.warningId || `${w.type}${w.validFrom}${w.severity}`).join(',')}`;
      if (fitKeyRef.current !== fitKey) {
        fitKeyRef.current = fitKey;
        try { fitTargetRef.current = drawn.length ? L.featureGroup(drawn).getBounds() : UK_BOUNDS; } catch { fitTargetRef.current = UK_BOUNDS; }
        movedRef.current = false;
        try { map.fitBounds(fitTargetRef.current, FIT); } catch { /* noop */ }
      }
    };

    const build = () => {
      const el = mapRef.current;
      if (!el || cancelled) return;
      if (!mapInst.current) {
        const map = L.map(el, {
          center: [54.6, -3.2], zoom: 5, zoomControl: false, attributionControl: false,
        });
        L.control.zoom({ position: 'bottomleft' }).addTo(map);
        L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${isDark ? 'Dark' : 'Light'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
          { maxZoom: 12 }).addTo(map);
        map.fitBounds(UK_BOUNDS, FIT);
        mapInst.current = map;
        labelsRef.current = attachPlaceLabels(L, map, { dark: isDark, visible: labelsOn, extraTiers: 1, filter: insideWarned });
        /* The sheet is still opening when the map is made, so its first size is not its last: it
           was framed on a box of the wrong shape and the UK landed off-centre, half under the
           message and the glass bars. Re-measure whenever the box changes size, and keep the
           framing until the reader moves the map themselves. */
        const mine = () => { movedRef.current = true; };
        ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.addEventListener(ev, mine, { passive: true }));
        const ro = new ResizeObserver(() => {
          map.invalidateSize({ animate: false });
          if (!movedRef.current) { try { map.fitBounds(fitTargetRef.current, FIT); } catch { /* noop */ } }
        });
        ro.observe(el);
        roRef.current = () => { ro.disconnect(); ['mousedown', 'touchstart', 'wheel'].forEach((ev) => el.removeEventListener(ev, mine)); };
      }
      draw();
    };

    build();
    return () => { cancelled = true; };
  }, [isOpen, visible, isDark, namesOn, dayIdx]);

  // Tear the map down on close so reopening builds against a live container.
  useEffect(() => {
    if (isOpen) return;
    roRef.current?.();
    roRef.current = null;
    if (mapInst.current) { try { mapInst.current.remove(); } catch { /* noop */ } mapInst.current = null; labelsRef.current = null; }
    layersRef.current = [];
    fitKeyRef.current = '';
    fitTargetRef.current = UK_BOUNDS;
    setSelected(null);
  }, [isOpen]);

  useEffect(() => { setSelected(null); }, [dayIdx]);

  /* Escape closes the open warning first, then the map; the page behind does not scroll */
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null); else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [isOpen, onClose, selected]);

  if (typeof document === 'undefined' || !isOpen) return null;

  const filtersOn = sevFilter.length + typeFilter.length;
  const nextHex = nextWarnedDay != null ? sevOf(dayPeak[nextWarnedDay]).hex : null;
  const dayWord = dayIdx < 2 ? dayLabel(days[dayIdx], dayIdx).toLowerCase() : days[dayIdx].toLocaleDateString('en-GB', { weekday: 'long' });

  return createPortal(
    <div className={`wg wg-mapmodal${isDark ? '' : ' is-light'}`} role="dialog" aria-modal="true" aria-label="UK weather warnings map" onClick={onClose}>
      <div className="wg-sheet wg-glass" onClick={(e) => e.stopPropagation()}>
        {/* the map fills the whole sheet; everything else floats on it in glass */}
        <div ref={mapRef} className="wg-map" />

        <div className="wg-top wg-glass">
          <div className="wg-top-title">
            <span className="wg-top-mark"><AlertTriangle /></span>
            <div style={{ minWidth: 0 }}>
              <b>Weather warnings</b>
              <small>
                {visible.length} {visible.length === 1 ? 'warning' : 'warnings'} {dayIdx < 2 ? dayWord : `on ${dayWord}`}
                {forDay.length !== visible.length ? ` · ${forDay.length - visible.length} filtered out` : ''}
              </small>
            </div>
          </div>
          <button type="button" className={`wg-btn${namesOn ? ' is-on' : ''}`} onClick={() => setNamesOn((v) => !v)} aria-pressed={namesOn} title="Warning names on the map">
            <Tag /><span className="wg-txt">Names</span>
          </button>
          <button type="button" className={`wg-btn${labelsOn ? ' is-on' : ''}`} onClick={() => setLabelsOn((v) => !v)} aria-pressed={labelsOn} title="Names of places inside the warning areas">
            <MapPin /><span className="wg-txt">Places</span>
          </button>
          <button type="button" className={`wg-btn${showFilters || filtersOn ? ' is-on' : ''}`} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} title="Filter by severity and type">
            <SlidersHorizontal /><span className="wg-txt">Filters{filtersOn ? ` · ${filtersOn}` : ''}</span>
          </button>
          <button type="button" className="wg-btn wg-icon" onClick={onClose} aria-label="Close the warning map"><X /></button>
        </div>

        {showFilters && (
          <div className="wg-pop wg-glass is-strong">
            <div className="wg-pop-row">
              <span className="wg-label">Severity</span>
              {SEV_ORDER.map((s) => (
                <button key={s} type="button" className="wg-chip" aria-pressed={sevFilter.includes(s)} onClick={() => toggle(sevFilter, setSevFilter, s)}>
                  <i style={{ background: SEV[s].hex }} />{s}
                </button>
              ))}
            </div>
            <div className="wg-pop-row">
              <span className="wg-label">Type</span>
              {types.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--wg-ink3)' }}>No warnings to filter</span>}
              {types.map((t) => (
                <button key={t} type="button" className="wg-chip" aria-pressed={typeFilter.includes(t)} onClick={() => toggle(typeFilter, setTypeFilter, t)}>{t}</button>
              ))}
            </div>
            {filtersOn > 0 && (
              <button type="button" className="wg-btn" style={{ alignSelf: 'flex-start' }} onClick={() => { setSevFilter([]); setTypeFilter([]); }}>Clear filters</button>
            )}
          </div>
        )}

        {/* An empty day says so in a slim banner under the title, and the map of the UK stays sharp
            and in full view below it. It used to be blurred behind a card over Britain, which read
            as a map that had not loaded. */}
        {visible.length === 0 && (
          <div className="wg-empty">
            <div className="wg-empty-card wg-glass is-strong">
              <span className="wg-empty-mark"><Check /></span>
              <span className="wg-empty-text">
                <b>{forDay.length === 0 ? 'No warnings in force' : 'Nothing matches those filters'}</b>
                <span>
                  {forDay.length === 0
                    ? `The Met Office has no weather warnings for ${dayWord}.`
                    : `${forDay.length} warning${forDay.length === 1 ? '' : 's'} on this day ${forDay.length === 1 ? 'is' : 'are'} hidden by the filters.`}
                </span>
              </span>
              {forDay.length === 0 && nextWarnedDay != null && (
                <button type="button" className="wg-go" onClick={() => setDayIdx(nextWarnedDay)}
                  style={{ background: nextHex, color: dayPeak[nextWarnedDay] === 'Red' ? '#fff' : '#111' }}>
                  {warnedDays > 1 ? 'Warnings on ' : 'The warning on '}
                  {days[nextWarnedDay].toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                  <ArrowRight style={{ width: 15, height: 15 }} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* the day strip: one day at a time, each marked with its worst warning */}
        <div className="wg-days wg-glass">
          {days.map((d, i) => {
            const peak = dayPeak[i];
            return (
              <button key={i} type="button" className={`wg-day${i === dayIdx ? ' is-on' : ''}`} onClick={() => setDayIdx(i)} aria-pressed={i === dayIdx}>
                <b>{dayLabel(d, i)}</b>
                <small>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
                <span className="wg-day-sev">
                  {peak
                    ? <AlertTriangle style={{ width: 14, height: 14, color: sevOf(peak).hex }} fill={sevOf(peak).hex} fillOpacity={0.3} />
                    : <span style={{ width: 14, height: 2, borderRadius: 2, background: 'var(--wg-hair)' }} />}
                </span>
              </button>
            );
          })}
        </div>

        {/* the full warning, in the Met Office's order */}
        {selected && (
          <div key={selected.warningId || `${selected.type}${selected.validFrom}`} className="wg-side wg-glass is-strong">
            <WarningDetailPanel warning={selected} onClose={() => setSelected(null)} style={{ flex: 1, minHeight: 0 }} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
