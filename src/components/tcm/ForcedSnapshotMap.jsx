import { useEffect, useRef } from 'react';

function buildStrikeDensityGrid(strikes, cellDeg = 0.3) {
  const bins = {};
  strikes.forEach(s => {
    const latKey = Math.round(s.lat / cellDeg) * cellDeg;
    const lonKey = Math.round(s.lon / cellDeg) * cellDeg;
    const key = `${latKey.toFixed(2)}_${lonKey.toFixed(2)}`;
    if (!bins[key]) bins[key] = { lat: latKey, lon: lonKey, count: 0 };
    bins[key].count++;
  });
  return Object.values(bins);
}

function strikeDensityColor(count) {
  if (count >= 50)  return { fill: '#ef4444', opacity: 0.55 };
  if (count >= 20)  return { fill: '#f97316', opacity: 0.48 };
  if (count >= 8)   return { fill: '#facc15', opacity: 0.40 };
  if (count >= 3)   return { fill: '#a78bfa', opacity: 0.32 };
  return null;
}

function makeCircleIcon(color, size = 10) {
  // Plain filled circle — no outline, no inner highlight. The radius is
  // sized small relative to the SVG box so each strike reads as a precise
  // dot rather than a fuzzy blob.
  const c = size / 2;
  const r = Math.round(size * 0.36);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/>
  </svg>`;
}

/**
 * Renders a Leaflet map showing forced-snapshot live strikes for a given date.
 * Used inside HistoricalLightningPanel.
 */
export default function ForcedSnapshotMap({ snaps, histView }) {
  const mapRef  = useRef(null);
  const mapInst = useRef(null);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current || !snaps?.length) return;
    if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; }

    const center = histView === 'europe' ? [52, 12] : [54, -2];
    const zoom   = histView === 'europe' ? 4 : 5;
    const map = L.map(mapRef.current, { center, zoom, zoomControl: true, attributionControl: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12, subdomains: 'abcd' }).addTo(map);
    const layer = L.layerGroup().addTo(map);

    snaps.forEach(snap => {
      const strikes = snap.strikes || [];
      const snapTime = snap.capturedAt || Date.now();
      const sample = strikes.length > 10000
        ? strikes.filter((_, i) => i % Math.ceil(strikes.length / 10000) === 0)
        : strikes;
      sample.forEach(s => {
        const ageMin = (snapTime - s.time) / 60000;
        let color = '#ffffff';
        if (ageMin > 720) color = '#4c1d95';
        else if (ageMin > 360) color = '#7c3aed';
        else if (ageMin > 60)  color = '#7f1d1d';
        else if (ageMin > 30)  color = '#ef4444';
        else if (ageMin > 10)  color = '#f97316';
        else if (ageMin > 5)   color = '#facc15';
        const icon = L.divIcon({ html: makeCircleIcon(color, 10), iconAnchor: [5, 5], className: '' });
        L.marker([s.lat, s.lon], { icon }).addTo(layer);
      });
      const grid = buildStrikeDensityGrid(strikes, 0.25);
      grid.forEach(cell => {
        const cfg = strikeDensityColor(cell.count);
        if (!cfg) return;
        const degSize = 0.25;
        const latHalf = degSize / 2;
        const lonHalf = (degSize / Math.cos(cell.lat * Math.PI / 180)) / 2;
        L.rectangle(
          [[cell.lat - latHalf, cell.lon - lonHalf], [cell.lat + latHalf, cell.lon + lonHalf]],
          { color: 'transparent', fillColor: cfg.fill, fillOpacity: cfg.opacity * 0.55, weight: 0 }
        ).addTo(layer);
      });
    });

    mapInst.current = map;
    return () => { if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; } };
  }, [snaps, histView]);

  return <div ref={mapRef} style={{ width: '100%', height: 380, background: '#060d1a' }} />;
}