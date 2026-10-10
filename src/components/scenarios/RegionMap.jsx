/**
 * Region map — real boundaries (ONS local authority districts, Dec 2024,
 * grouped into MyWeatherUK's 15 forecasting regions), drawn with Leaflet, the
 * map library the rest of the site uses. Shading shows the CLASSIFICATION
 * stored in the scenario records (how relevant a scenario is to each region),
 * which is an illustrative regional guide — never a forecast or observation.
 *
 * Every region is also a button in the list beside the map, so the map is
 * fully usable by keyboard and screen reader.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { loadRegionsGeo } from './scenarioApi';

const LEVEL_FILL = { 3: '#ff8a5b', 2: '#f2c14e', 1: '#5b7fb3', 0: '#5b6b86' };

export default function RegionMap({ regions, selected, onSelect, highlight, height = 420, label, isDark = true, showList = true }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const [err, setErr] = useState(null);
  const names = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  useEffect(() => { loadRegionsGeo().then(setGeo).catch(() => setErr('Region boundaries could not be loaded.')); }, []);

  useEffect(() => {
    if (!box.current || mapRef.current) return undefined;
    const map = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.25, minZoom: 4.5, maxZoom: 9 });
    map.setView([55.2, -3.4], 5.25);
    map.attributionControl.setPrefix(false);
    mapRef.current = map;
    // Refit whenever the box changes size (fonts, list wrapping, rotation),
    // until the user pans or zooms themselves.
    let userMoved = false;
    map.on('dragstart zoomstart', (e) => { if (e.originalEvent || map._userZoom) userMoved = true; });
    map.getContainer().addEventListener('wheel', () => { userMoved = true; }, { passive: true });
    const ro = new ResizeObserver(() => { map.invalidateSize(); if (!userMoved && map._ukBounds) map.fitBounds(map._ukBounds, { padding: [6, 6] }); });
    ro.observe(box.current);
    map._ro = ro;
    return () => { map._ro?.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  // Same grey Esri base the Lightning map uses, for coastline context only;
  // swapped when the site theme changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const theme = isDark ? 'Canvas/World_Dark_Gray_Base' : 'Canvas/World_Light_Gray_Base';
    const base = L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${theme}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution: 'Basemap © Esri' }).addTo(map);
    base.bringToBack();
    return () => { base.remove(); };
  }, [isDark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geo) return;
    if (layerRef.current) layerRef.current.remove();
    const style = (f) => {
      const id = f.properties.region;
      const rank = highlight ? (highlight[id] || 0) : null;
      const isSel = selected === id;
      const fill = highlight ? LEVEL_FILL[rank] : (isSel ? '#7cb0ff' : (isDark ? '#3b5683' : '#9db6dd'));
      return { color: fill, weight: isSel ? 2 : 0.6, opacity: 1, fillColor: fill, fillOpacity: isSel ? 0.85 : highlight ? (rank ? 0.75 : 0.25) : 0.55 };
    };
    const layer = L.geoJSON(geo, {
      style,
      onEachFeature: (f, lyr) => {
        const id = f.properties.region;
        lyr.bindTooltip(names.get(id) || id, { sticky: true, direction: 'top' });
        if (onSelect) lyr.on('click', () => onSelect(selected === id ? null : id));
      },
    }).addTo(map);
    layerRef.current = layer;
    if (!map._ukBounds) { map._ukBounds = layer.getBounds(); map.invalidateSize(); map.fitBounds(map._ukBounds, { padding: [6, 6] }); }
    map.attributionControl.addAttribution('Boundaries: ONS (OGL v3), contains OS data © Crown copyright 2024');
  }, [geo, selected, highlight, isDark, names, onSelect]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: showList ? 'minmax(0,1.4fr) minmax(0,1fr)' : '1fr', gap: 12 }} className="wsx-map-grid">
      <div>
        <div ref={box} style={{ height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', background: isDark ? '#0a1426' : '#dfe8f4' }}
          role="application" aria-label={label || 'Map of UK forecasting regions'} />
        {err && <p className="note" role="alert">{err}</p>}
        <p className="note" style={{ marginTop: 6 }}>
          {highlight ? 'Shading = how relevant this scenario is to each region in the MyWeatherUK classification (orange: particularly relevant, yellow: relevant, blue: less characteristic). An illustrative regional guide, not a forecast or a map of observations.' : 'Click a region (or use the list) to filter by it. Scottish regions are MyWeatherUK\'s own grouping of council areas.'}
        </p>
      </div>
      {showList && (
        <div role="group" aria-label="Choose a region" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start' }}>
          <button type="button" className="chip" aria-pressed={!selected} onClick={() => onSelect && onSelect(null)}>All of the UK</button>
          {regions.map((r) => (
            <button key={r.id} type="button" className="chip" aria-pressed={selected === r.id} onClick={() => onSelect && onSelect(selected === r.id ? null : r.id)}
              style={highlight ? { borderColor: LEVEL_FILL[highlight[r.id] || 0] } : undefined}>
              {r.name}
            </button>
          ))}
        </div>
      )}
      <style>{'@media (max-width:820px){.wsx-map-grid{grid-template-columns:1fr!important}}'}</style>
    </div>
  );
}
