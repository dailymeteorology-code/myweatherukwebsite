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

   EMPTY DAYS SAY SO. A day with nothing active shows a blurred map behind a
   plain statement rather than an empty map, which is indistinguishable from a
   map that failed to load — the exact failure mode the old warning map had.
   ════════════════════════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTheme } from '@/components/ThemeContext';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, SlidersHorizontal, MapPin, Tag, ArrowRight } from 'lucide-react';
import { WarningDetailPanel, warningTagHtml, insideGeometries } from '@/components/warnings/MetOfficeWarning';

const SEV = {
  Red:    { hex: '#dc2626', rank: 3 },
  Amber:  { hex: '#f59e0b', rank: 2 },
  Yellow: { hex: '#facc15', rank: 1 },
};
const sevOf = (s) => SEV[s] || SEV.Yellow;
const SEV_ORDER = ['Red', 'Amber', 'Yellow'];

const UK_BOUNDS = [[49.85, -8.65], [61.0, 2.05]];
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
      const L = window.L, map = mapInst.current;
      if (!L || !map) return;
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
        if (drawn.length) {
          try { map.fitBounds(L.featureGroup(drawn).getBounds().pad(0.2)); } catch { /* noop */ }
        } else {
          try { map.fitBounds(UK_BOUNDS, { padding: [10, 10] }); } catch { /* noop */ }
        }
      }
    };

    const build = () => {
      const L = window.L;
      if (!L || !mapRef.current || cancelled) return;
      if (!mapInst.current) {
        const map = L.map(mapRef.current, {
          center: [54.6, -3.2], zoom: 5, zoomControl: true, attributionControl: false,
        });
        L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${isDark ? 'Dark' : 'Light'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
          { maxZoom: 12, subdomains: 'abcd' }).addTo(map);
        map.fitBounds(UK_BOUNDS, { padding: [10, 10] });
        mapInst.current = map;
        labelsRef.current = attachPlaceLabels(L, map, { dark: isDark, visible: labelsOn, extraTiers: 1, filter: insideWarned });
        // Leaflet measures the container on creation; inside a modal that is
        // still animating open it reads zero and renders a grey box.
        setTimeout(() => { try { map.invalidateSize(); } catch { /* gone */ } }, 260);
      }
      draw();
    };

    if (window.L) build();
    else {
      if (!document.getElementById('leaflet-css-wm')) {
        const l = document.createElement('link');
        l.id = 'leaflet-css-wm'; l.rel = 'stylesheet';
        l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(l);
      }
      let s = document.getElementById('leaflet-js-wm');
      if (!s) {
        s = document.createElement('script');
        s.id = 'leaflet-js-wm';
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        document.head.appendChild(s);
      }
      s.addEventListener('load', () => { if (!cancelled) build(); });
      const poll = setInterval(() => { if (window.L) { clearInterval(poll); if (!cancelled) build(); } }, 90);
      return () => { cancelled = true; clearInterval(poll); };
    }
    return () => { cancelled = true; };
  }, [isOpen, visible, isDark, namesOn, dayIdx]);

  // Tear the map down on close so reopening builds against a live container.
  useEffect(() => {
    if (isOpen) return;
    if (mapInst.current) { try { mapInst.current.remove(); } catch { /* noop */ } mapInst.current = null; labelsRef.current = null; }
    layersRef.current = [];
    fitKeyRef.current = '';
    setSelected(null);
  }, [isOpen]);

  useEffect(() => { setSelected(null); }, [dayIdx]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  const chip = (on, hex) => ({
    padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.03em',
    background: on ? `${hex}26` : 'rgba(148,163,184,0.08)',
    border: `1.5px solid ${on ? hex : 'rgba(148,163,184,0.2)'}`,
    color: on ? hex : '#94a3b8',
  });

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center p-3 sm:p-6"
          style={{ zIndex: 1300, background: 'rgba(2,6,16,0.82)', backdropFilter: 'blur(6px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 1040, height: 'min(88vh, 820px)',
              display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden',
              background: isDark ? '#070d18' : '#ffffff', border: '1px solid rgba(148,163,184,0.18)',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid rgba(148,163,184,0.14)' }}>
              <AlertTriangle style={{ width: 16, height: 16, color: '#facc15' }} />
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f1f5f9' }}>UK Weather Warnings</span>
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                {visible.length} shown{forDay.length !== visible.length ? ` of ${forDay.length}` : ''}
              </span>
              <button onClick={() => setNamesOn(v => !v)} aria-pressed={namesOn} title="Show or hide warning names on the map"
                      style={{ ...chip(namesOn, '#facc15'), marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Tag style={{ width: 12, height: 12 }} /> Warning names
              </button>
              <button onClick={() => setLabelsOn(v => !v)} aria-pressed={labelsOn} title="Show or hide the names of places inside the warning areas"
                      style={{ ...chip(labelsOn, '#38bdf8'), display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <MapPin style={{ width: 12, height: 12 }} /> Place names
              </button>
              <button onClick={() => setShowFilters(v => !v)}
                      style={{ ...chip(showFilters, '#38bdf8'), display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <SlidersHorizontal style={{ width: 12, height: 12 }} /> Filters
              </button>
              <button onClick={onClose} aria-label="Close"
                      style={{ width: 30, height: 30, borderRadius: 9, cursor: 'pointer', background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X style={{ width: 15, height: 15, color: '#cbd5e1' }} />
              </button>
            </div>

            {/* Filters */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  style={{ overflow: 'hidden', borderBottom: '1px solid rgba(148,163,184,0.14)' }}
                >
                  <div style={{ padding: '11px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', width: 62 }}>Severity</span>
                      {SEV_ORDER.map(s => (
                        <button key={s} onClick={() => toggle(sevFilter, setSevFilter, s)} style={chip(sevFilter.includes(s), SEV[s].hex)}>{s}</button>
                      ))}
                      {sevFilter.length > 0 && (
                        <button onClick={() => setSevFilter([])} style={{ ...chip(false, '#94a3b8'), fontWeight: 600 }}>Clear</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', width: 62 }}>Type</span>
                      {types.length === 0 && <span style={{ fontSize: '0.7rem', color: '#475569' }}>No warnings to filter</span>}
                      {types.map(t => (
                        <button key={t} onClick={() => toggle(typeFilter, setTypeFilter, t)} style={chip(typeFilter.includes(t), '#38bdf8')}>{t}</button>
                      ))}
                      {typeFilter.length > 0 && (
                        <button onClick={() => setTypeFilter([])} style={{ ...chip(false, '#94a3b8'), fontWeight: 600 }}>Clear</button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Map */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              <div ref={mapRef} style={{
                position: 'absolute', inset: 0, background: isDark ? '#060d1a' : '#e8eef6',
                // Blurred rather than hidden when empty: the map stays as
                // context, but is clearly not the thing to read.
                filter: visible.length === 0 ? 'blur(5px) saturate(0.6)' : 'none',
                transition: 'filter 0.3s',
              }} />

              {visible.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none', padding: 24, textAlign: 'center' }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle style={{ width: 20, height: 20, color: '#4ade80' }} />
                  </div>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9' }}>
                    {forDay.length === 0 ? 'No warnings active' : 'Nothing matches those filters'}
                  </span>
                  <span style={{ fontSize: '0.76rem', color: '#94a3b8', maxWidth: 300 }}>
                    {forDay.length === 0
                      ? `There are no Met Office weather warnings in force for ${dayLabel(days[dayIdx], dayIdx).toLowerCase()}.`
                      : `${forDay.length} warning${forDay.length === 1 ? '' : 's'} on this day are hidden by the severity or type filter.`}
                  </span>
                  {forDay.length === 0 && nextWarnedDay != null && (
                    <button type="button" onClick={() => setDayIdx(nextWarnedDay)}
                      style={{ pointerEvents: 'auto', marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 800,
                        background: sevOf(dayPeak[nextWarnedDay]).hex, color: dayPeak[nextWarnedDay] === 'Red' ? '#fff' : '#0a0f1e', border: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}>
                      {warnedDays > 1 ? 'View warnings on ' : 'View the warning on '}
                      {days[nextWarnedDay].toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                      <ArrowRight style={{ width: 15, height: 15 }} />
                    </button>
                  )}
                </div>
              )}

              {/* The full warning, laid out like the Met Office's own page */}
              <AnimatePresence>
                {selected && (
                  <motion.div
                    key={selected.warningId || selected.type}
                    initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
                    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(440px, 100%)', zIndex: 700, display: 'flex', boxShadow: '-12px 0 40px rgba(0,0,0,0.45)' }}
                  >
                    <WarningDetailPanel warning={selected} onClose={() => setSelected(null)} style={{ flex: 1, minHeight: 0 }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Day bar */}
            <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderTop: '1px solid rgba(148,163,184,0.14)', background: isDark ? 'rgba(4,9,18,0.7)' : 'rgba(241,245,249,0.9)' }}>
              {days.map((d, i) => {
                const peak = dayPeak[i];
                const on = i === dayIdx;
                return (
                  <button key={i} onClick={() => setDayIdx(i)} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    background: on ? 'rgba(56,189,248,0.14)' : 'rgba(148,163,184,0.05)',
                    border: `1.5px solid ${on ? '#38bdf8' : 'rgba(148,163,184,0.14)'}`,
                    transition: 'all 0.15s',
                  }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: on ? '#7dd3fc' : '#cbd5e1' }}>
                      {dayLabel(d, i)}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: '#64748b' }}>
                      {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {/* Highest severity that day, so the worst day in the week is
                        findable without opening each one. */}
                    {peak ? (
                      <AlertTriangle style={{ width: 15, height: 15, color: sevOf(peak).hex }} fill={sevOf(peak).hex} fillOpacity={0.25} />
                    ) : (
                      <span style={{ width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#334155' }}>—</span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}