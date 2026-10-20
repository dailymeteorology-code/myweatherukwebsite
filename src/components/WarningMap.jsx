import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/components/ThemeContext';
import { loadWarningAreas, matchAreas } from '@/lib/ukWarningAreas';

/* Fallback framing when there is no geometry to fit to. Module scope, not the
   component body: a fresh array each render would make the map effect re-run,
   tearing down and rebuilding Leaflet on every parent update. */
const UK_BOUNDS = [[49.85, -8.65], [61.0, 2.05]];

const SEV = {
  Yellow: { hex: '#facc15', border: 'rgba(250,204,21,0.40)' },
  Amber:  { hex: '#f97316', border: 'rgba(249,115,22,0.45)' },
  Red:    { hex: '#ef4444', border: 'rgba(239,68,68,0.50)'  },
};
const getSev = (s) => SEV[s] || SEV.Yellow;

const REGION_POLYS = {
  'Scotland': [[58.65,-3.07],[59.10,-2.85],[59.36,-2.55],[59.48,-1.70],[60.05,-1.08],[60.68,-0.92],[60.85,-0.78],[60.85,-1.20],[60.50,-1.55],[60.76,-2.10],[60.40,-2.60],[59.92,-3.40],[60.10,-4.30],[60.30,-5.10],[59.75,-5.60],[58.90,-6.05],[58.50,-6.25],[57.70,-6.90],[57.20,-7.20],[57.00,-6.80],[56.80,-6.20],[56.50,-5.60],[55.75,-6.10],[55.42,-5.10],[54.95,-5.15],[54.65,-5.50],[55.00,-5.10],[55.50,-4.80],[55.85,-4.55],[55.95,-3.20],[55.80,-2.02],[55.80,-1.10],[56.00,-0.85],[56.45,-0.40],[57.15,-2.10],[57.70,-3.80],[58.65,-3.07]],
  'Northern Scotland': [[58.65,-3.07],[59.10,-2.85],[59.36,-2.55],[59.48,-1.70],[60.05,-1.08],[60.68,-0.92],[60.85,-0.78],[60.85,-1.20],[60.50,-1.55],[60.76,-2.10],[60.40,-2.60],[59.92,-3.40],[60.10,-4.30],[60.30,-5.10],[59.75,-5.60],[58.90,-6.05],[58.50,-6.25],[57.70,-6.90],[57.20,-7.20],[57.00,-6.80],[56.80,-6.20],[56.50,-5.60],[56.10,-4.80],[56.40,-4.20],[57.15,-3.60],[57.70,-3.80],[58.65,-3.07]],
  'Eastern Scotland': [[56.00,-0.85],[56.45,-0.40],[57.15,-2.10],[57.70,-3.80],[57.15,-3.60],[56.40,-4.20],[56.10,-4.80],[55.85,-4.55],[55.95,-3.20],[55.80,-2.02],[55.80,-1.10],[56.00,-0.85]],
  'Highlands': [[57.70,-6.90],[57.20,-7.20],[57.00,-6.80],[56.80,-6.20],[56.50,-5.60],[56.10,-4.80],[56.40,-4.20],[57.15,-3.60],[57.70,-3.80],[58.65,-3.07],[59.10,-2.85],[59.36,-2.55],[59.48,-1.70],[60.05,-1.08],[60.68,-0.92],[60.85,-0.78],[60.30,-5.10],[59.75,-5.60],[58.90,-6.05],[58.50,-6.25],[57.70,-6.90]],
  'Northern Ireland': [[55.30,-8.18],[55.27,-7.30],[55.20,-6.85],[54.96,-6.08],[54.66,-5.58],[54.10,-5.60],[53.98,-6.20],[54.15,-7.15],[54.10,-7.90],[54.40,-8.18],[55.00,-7.80],[55.30,-8.18]],
  'Northern England': [[55.80,-2.02],[55.42,-5.10],[54.95,-5.15],[54.65,-5.50],[54.60,-3.55],[53.35,-3.25],[53.30,-0.30],[53.70,0.05],[54.60,-0.04],[55.80,-1.10],[55.80,-2.02]],
  'North East England': [[55.80,-2.02],[55.80,-1.10],[54.60,-0.04],[53.70,0.05],[53.55,-0.85],[53.55,-2.02],[55.80,-2.02]],
  'North West England': [[55.42,-5.10],[54.95,-5.15],[54.65,-5.50],[54.60,-3.55],[53.35,-3.25],[53.55,-2.02],[53.55,-0.85],[53.70,0.05],[53.30,-0.30],[53.35,-3.25]],
  'Yorkshire and Humber': [[54.60,-0.04],[53.70,0.05],[53.30,-0.30],[53.35,-3.25],[53.55,-2.85],[53.55,-2.02],[53.55,-0.85],[54.60,-0.04]],
  'Yorkshire': [[54.60,-0.04],[53.70,0.05],[53.30,-0.30],[53.35,-3.25],[53.55,-2.85],[53.55,-2.02],[53.55,-0.85],[54.60,-0.04]],
  'East Midlands': [[53.30,-0.30],[53.55,-0.85],[53.55,-2.02],[52.88,-2.46],[52.20,-2.20],[52.00,-1.00],[52.00,0.55],[53.30,0.55],[53.30,-0.30]],
  'West Midlands': [[53.35,-3.25],[53.30,-0.30],[52.88,-2.46],[52.20,-2.20],[51.75,-2.90],[52.10,-3.35],[53.35,-3.25]],
  'Midlands': [[53.35,-3.25],[53.55,-2.02],[52.88,-2.46],[52.20,-2.20],[51.75,-2.90],[52.10,-3.35],[53.35,-3.25]],
  'East Anglia': [[53.30,0.55],[53.30,-0.30],[52.00,-1.00],[52.00,0.55],[51.70,0.60],[51.40,1.20],[51.70,1.70],[52.50,1.80],[52.90,1.65],[53.30,0.55]],
  'East of England': [[53.30,0.55],[53.30,-0.30],[52.00,-1.00],[52.00,0.55],[51.70,0.60],[51.40,1.20],[51.70,1.70],[52.50,1.80],[52.90,1.65],[53.30,0.55]],
  'London': [[51.70,-0.50],[51.70,0.30],[51.28,0.35],[51.25,-0.12],[51.42,-0.55],[51.70,-0.50]],
  'South East England': [[51.70,-0.50],[51.70,0.30],[51.28,0.35],[51.40,1.20],[51.70,1.70],[51.40,1.40],[51.10,1.55],[50.75,1.40],[50.72,0.30],[50.75,-0.40],[51.00,-1.05],[51.42,-0.55],[51.70,-0.50]],
  'South East': [[51.70,-0.50],[51.70,0.30],[51.28,0.35],[51.40,1.20],[51.70,1.70],[51.40,1.40],[51.10,1.55],[50.75,1.40],[50.72,0.30],[50.75,-0.40],[51.00,-1.05],[51.42,-0.55],[51.70,-0.50]],
  'South West England': [[51.75,-2.90],[52.20,-2.20],[52.00,-1.00],[51.42,-0.55],[51.00,-1.05],[50.85,-1.95],[50.62,-2.45],[50.32,-3.72],[50.00,-5.20],[49.95,-5.70],[50.10,-5.70],[50.50,-4.60],[51.00,-4.35],[51.20,-4.75],[51.40,-5.15],[51.60,-5.00],[51.60,-4.00],[51.75,-2.90]],
  'South West': [[51.75,-2.90],[52.20,-2.20],[52.00,-1.00],[51.42,-0.55],[51.00,-1.05],[50.85,-1.95],[50.62,-2.45],[50.32,-3.72],[50.00,-5.20],[49.95,-5.70],[50.10,-5.70],[50.50,-4.60],[51.00,-4.35],[51.20,-4.75],[51.40,-5.15],[51.60,-5.00],[51.60,-4.00],[51.75,-2.90]],
  'Wales': [[53.40,-4.70],[53.40,-3.25],[53.35,-3.25],[52.10,-3.35],[51.75,-2.90],[51.60,-4.00],[51.60,-5.00],[51.40,-5.15],[51.20,-4.75],[51.00,-4.35],[51.20,-4.25],[51.60,-5.20],[52.00,-5.08],[52.50,-5.10],[52.80,-4.75],[53.40,-4.70]],
  'England': [[55.80,-2.02],[55.42,-5.10],[54.65,-5.50],[54.60,-3.55],[53.35,-3.25],[52.10,-3.35],[51.75,-2.90],[51.60,-4.00],[51.60,-5.00],[50.10,-5.70],[49.95,-5.70],[50.00,-5.20],[50.32,-3.72],[50.72,0.30],[50.75,1.40],[51.10,1.55],[52.50,1.80],[52.90,1.65],[53.30,0.55],[53.70,0.05],[54.60,-0.04],[55.80,-1.10],[55.80,-2.02]],
  'UK': [[49.95,-5.70],[50.00,-5.20],[50.32,-3.72],[50.72,0.30],[51.40,1.40],[52.90,1.65],[53.70,0.05],[55.80,-1.10],[55.80,-2.02],[57.70,-3.80],[60.68,-0.92],[60.85,-0.78],[60.30,-5.10],[58.90,-6.05],[57.20,-7.20],[55.42,-5.10],[54.65,-5.50],[53.35,-3.25],[51.75,-2.90],[51.60,-5.00],[50.10,-5.70],[49.95,-5.70]],
};

function normaliseRegion(r) {
  if (!r) return null;
  const s = r.trim();
  if (REGION_POLYS[s]) return s;
  const lo = s.toLowerCase();
  const found = Object.keys(REGION_POLYS).find(k => k.toLowerCase() === lo);
  if (found) return found;
  if (lo.includes('scotland') && (lo.includes('north') || lo.includes('highland') || lo.includes('orkney') || lo.includes('shetland'))) return 'Northern Scotland';
  if (lo.includes('highland')) return 'Highlands';
  if (lo.includes('scotland')) return 'Scotland';
  if (lo.includes('northern ireland')) return 'Northern Ireland';
  if (lo.includes('north east') && !lo.includes('scotland')) return 'North East England';
  if (lo.includes('north west') && !lo.includes('scotland')) return 'North West England';
  if (lo.includes('yorkshire') || lo.includes('humber')) return 'Yorkshire and Humber';
  if (lo.includes('east midlands')) return 'East Midlands';
  if (lo.includes('west midlands')) return 'West Midlands';
  if (lo.includes('midlands')) return 'Midlands';
  if (lo.includes('east anglia') || lo.includes('east of england')) return 'East Anglia';
  if (lo.includes('london')) return 'London';
  if (lo.includes('south east')) return 'South East England';
  if (lo.includes('south west')) return 'South West England';
  if (lo.includes('wales')) return 'Wales';
  if (lo.includes('northern england') || lo.includes('north of england')) return 'Northern England';
  if (lo.includes('england')) return 'England';
  return null;
}

import { attachPlaceLabels, readPlaceLabelsOn, writePlaceLabelsOn } from '@/lib/placeLabels';
import { insideGeometries } from '@/components/warnings/MetOfficeWarning';

export default function WarningMap({ warning, height = 220 }) {
  /* The basemap and the ground behind it follow the site theme — this drew a
     dark-grey canvas on a near-black ground whatever the page around it was
     doing, so on the light theme each warning sat in a black box. */
  const { isDark } = useTheme();
  const mapRef  = useRef(null);
  const mapInst = useRef(null);
  const sev = getSev(warning.severity);
  const [labelsOn, setLabelsOn] = useState(readPlaceLabelsOn);
  const labelsRef = useRef(null);
  useEffect(() => { writePlaceLabelsOn(labelsOn); labelsRef.current?.setVisible(labelsOn); }, [labelsOn]);


  /* Council boundaries for the named areas, loaded once and shared. `null`
     means still loading; an empty array means loaded but nothing matched — two
     states the map has to tell apart, because one is temporary and the other
     needs explaining to the reader. */
  const [areas, setAreas] = useState(null);

  /* The Met Office's own warning shapes, attached by the backend. When present
     nothing else is needed — these ARE the warning area, not an approximation
     of it, so the council lookup below is skipped entirely. */
  const exactPolys = React.useMemo(() => (
    (Array.isArray(warning.polygons) && warning.polygons.length ? warning.polygons : [warning.geometry])
      .filter(g => g && (g.type === 'Polygon' || g.type === 'MultiPolygon'))
  ), [warning.polygons, warning.geometry]);
  const hasExact = exactPolys.length > 0;

  const names = React.useMemo(() => {
    const c = Array.isArray(warning.counties) ? warning.counties : [];
    const r = Array.isArray(warning.regions) ? warning.regions : (warning.region ? [warning.region] : []);
    // Counties first: they are the finer geometry. Regions are a fallback for
    // older cached warnings saved before counties were captured.
    return c.length ? c : r;
  }, [warning.counties, warning.regions, warning.region]);

  useEffect(() => {
    // Don't download 2 MB of council boundaries when the exact shape is in hand.
    if (hasExact) { setAreas([]); return; }
    let live = true;
    loadWarningAreas()
      .then(all => { if (live) setAreas(matchAreas(all, names)); })
      .catch(() => { if (live) setAreas([]); });
    return () => { live = false; };
  }, [names, hasExact]);

  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    const build = () => {
      const L = window.L;
      if (!L || !mapRef.current || cancelled) return;
      if (mapInst.current) { try { mapInst.current.remove(); } catch(_){} mapInst.current = null; }

      const map = L.map(mapRef.current, {
        center: [54.5, -3.0], zoom: 5,
        zoomControl: false, attributionControl: false,
        scrollWheelZoom: false, dragging: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false,
      });
      L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${isDark ? 'Dark' : 'Light'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 10, subdomains: 'abcd' }).addTo(map);

      const polys = [];

      // 1) Admin-drawn warning area (manual warnings) — exact shapes the admin
      //    drew, in their chosen colours. These take priority over everything.
      const drawing = Array.isArray(warning.area_drawing) ? warning.area_drawing : [];
      const validDrawing = drawing.filter(shape => shape?.latLngs && shape.latLngs.length >= 2);
      validDrawing.forEach(shape => {
        polys.push(L.polygon(shape.latLngs, {
          color: shape.color || sev.hex, fillColor: shape.color || sev.hex, fillOpacity: 0.3,
          weight: 2, smoothFactor: 2, lineCap: 'round', lineJoin: 'round', interactive: false,
        }).addTo(map));
      });

      /* 2) The Met Office's exact warning polygon, when we have it. GeoJSON is
            [lng, lat]; Leaflet wants [lat, lng], hence the flip. */
      if (validDrawing.length === 0 && hasExact) {
        const toLatLng = (ring) => ring.map(([lng, lat]) => [lat, lng]);
        exactPolys.forEach(g => {
          const polyList = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
          polyList.forEach(rings => {
            // First ring is the outline; any others are holes, which Leaflet
            // takes as further entries in the same array.
            const latLngs = rings.map(toLatLng);
            polys.push(L.polygon(latLngs, {
              color: sev.hex, fillColor: sev.hex, fillOpacity: 0.3,
              weight: 2, smoothFactor: 1, interactive: false,
            }).addTo(map));
          });
        });
      }

      /* 3) Fallback only: council boundaries for the areas the warning names.
            Used when the Met Office page no longer exposes its polygons (this
            is scraped, so it can break). Approximate — it fills whole councils
            where the real warning is a freehand shape — but far better than the
            blank map the dead PNG overlay used to leave. */
      if (validDrawing.length === 0 && !hasExact && Array.isArray(areas)) {
        areas.forEach(a => {
          a.rings.forEach(ring => {
            polys.push(L.polygon(ring, {
              color: sev.hex, fillColor: sev.hex, fillOpacity: 0.34,
              weight: 1.4, smoothFactor: 1.5, interactive: false,
            }).addTo(map));
          });
        });
      }

      /* Fit to what was actually drawn. Falling back to the whole UK only when
         there is nothing — zooming to the UK with shapes present would make a
         single-county warning an invisible speck. */
      if (polys.length) {
        try { map.fitBounds(L.featureGroup(polys).getBounds().pad(0.25)); } catch (_) {}
      } else {
        try { map.fitBounds(UK_BOUNDS, { padding: [2, 2] }); } catch (_) {}
      }
      mapInst.current = map;
      /* Only the places inside this warning's area are named: the official shape
         when we have it, else the admin drawing, else the council areas. */
      const areaGeoms = (validDrawing.length
        ? validDrawing.map(sh => ({ type: 'Polygon', coordinates: [sh.latLngs.map(([la, lo]) => [lo, la])] }))
        : hasExact ? exactPolys
          : (Array.isArray(areas) ? areas.flatMap(a => a.rings.map(r => ({ type: 'Polygon', coordinates: [r.map(([la, lo]) => [lo, la])] }))) : []));
      labelsRef.current = attachPlaceLabels(L, map, {
        dark: isDark, visible: labelsOn, extraTiers: 1,
        filter: areaGeoms.length ? (lat, lon) => insideGeometries(areaGeoms, lat, lon) : null,
      });
    };

    if (window.L) { build(); }
    else {
      if (!document.getElementById('leaflet-css-wc2')) {
        const l = document.createElement('link'); l.id = 'leaflet-css-wc2'; l.rel = 'stylesheet';
        l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
      }
      if (!document.getElementById('leaflet-js-wc2')) {
        const s = document.createElement('script'); s.id = 'leaflet-js-wc2';
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        s.onload = () => { if (!cancelled) build(); }; document.head.appendChild(s);
      } else {
        const poll = setInterval(() => { if (window.L) { clearInterval(poll); if (!cancelled) build(); } }, 80);
        return () => { cancelled = true; clearInterval(poll); };
      }
    }
    return () => {
      cancelled = true;
      if (mapInst.current) { try { mapInst.current.remove(); } catch(_){} mapInst.current = null; labelsRef.current = null; }
    };
  }, [warning, areas, sev.hex, hasExact, exactPolys, isDark]);

  const regionNames = Array.isArray(warning.regions) ? warning.regions : (warning.region ? [warning.region] : []);
  const hasDrawing = Array.isArray(warning.area_drawing) && warning.area_drawing.some(s => s?.latLngs?.length >= 2);
  // Nothing to place at all — no drawing and no named area to look up.
  if (!hasDrawing && regionNames.length === 0 && names.length === 0) return null;

  const loadingAreas = !hasDrawing && !hasExact && areas === null;
  const noMatch = !hasDrawing && !hasExact && Array.isArray(areas) && areas.length === 0;

  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${sev.border}`, position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height, background: isDark ? '#060d1a' : '#e8eef6' }} />

      {/* The two states an empty map can be in, told apart rather than both
          rendering as a blank box — which is exactly how the dead Met Office
          image overlay hid its own failure. */}
      {(loadingAreas || noMatch) && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 16, pointerEvents: 'none',
        }}>
          <span style={{
            padding: '6px 12px', borderRadius: 999, textAlign: 'center',
            fontSize: '0.7rem', fontWeight: 600, lineHeight: 1.4,
            background: 'rgba(6,13,26,0.88)', color: '#cbd5e1',
            border: `1px solid ${sev.border}`,
          }}>
            {loadingAreas
              ? 'Loading warning area…'
              : `Area shown by name only — ${regionNames.join(', ') || 'see warning details'}`}
          </span>
        </div>
      )}

      {/* Only the FALLBACK is labelled approximate. When the exact Met Office
          shape is drawn there is nothing to caveat, and a permanent "approx"
          badge over an accurate map would undersell it. */}
      {!hasDrawing && !hasExact && Array.isArray(areas) && areas.length > 0 && (
        <div style={{
          position: 'absolute', top: 8, right: 8, padding: '3px 8px', borderRadius: 6,
          background: 'rgba(6,13,26,0.82)', color: '#94a3b8', fontSize: '0.6rem',
          fontWeight: 600, letterSpacing: '0.03em', pointerEvents: 'none',
        }}>
          Approx. council areas
        </div>
      )}
      <button type="button" onClick={() => setLabelsOn(v => !v)} aria-pressed={labelsOn} title="Show or hide place names"
        style={{
          position: 'absolute', bottom: 8, right: 8, zIndex: 500, padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
          fontSize: '0.62rem', fontWeight: 700, fontFamily: 'inherit', border: `1px solid ${labelsOn ? sev.border : 'rgba(148,163,184,0.35)'}`,
          background: 'rgba(6,13,26,0.86)', color: labelsOn ? '#f1f5f9' : '#94a3b8',
        }}>
        {labelsOn ? 'Place names on' : 'Place names off'}
      </button>
      <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', alignItems: 'center', gap: 0, borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.6)', pointerEvents: 'none' }}>
        <div style={{ padding: '4px 10px', background: sev.hex, color: warning.severity === 'Yellow' ? '#0a0f1e' : '#fff', fontWeight: 800, fontSize: '0.68rem', letterSpacing: '0.05em' }}>
          {warning.severity}
        </div>
        <div style={{ padding: '4px 10px', background: 'rgba(6,13,26,0.92)', color: '#f1f5f9', fontWeight: 600, fontSize: '0.68rem', borderLeft: `1px solid ${sev.border}` }}>
          {warning.type} Warning
        </div>
      </div>
    </div>
  );
}

export { normaliseRegion, REGION_POLYS };