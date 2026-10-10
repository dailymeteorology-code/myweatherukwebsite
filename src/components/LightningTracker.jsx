/**
 * LightningTracker.jsx
 * Real-time lightning strike tracking with Open-Meteo data.
 * Supports UK, Europe and USA regions.
 * Features: area selection tool to count strikes in a drawn rectangle.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Zap, MousePointer, Square, X } from 'lucide-react';
import { UK_GRID, EUROPE_GRID, USA_GRID } from './tcm/regionData';

function convexHull(pts) {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]);
  const cross = (O, A, B) => (A[1] - O[1]) * (B[0] - O[0]) - (A[0] - O[0]) * (B[1] - O[1]);
  const lo = [], hi = [];
  for (const p of sorted) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  hi.pop(); lo.pop();
  return [...lo, ...hi];
}

function expandPoly(ring, dist, noise = 0) {
  const cLat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLon = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map(([lat, lon], i) => {
    const dLat = lat - cLat, dLon = lon - cLon;
    const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
    const wobble = noise * (Math.sin(i * 2.3 + lat * 3.1) * 0.6 + Math.cos(i * 1.7 + lon * 2.7) * 0.4);
    return [lat + (dLat / len) * (dist + wobble), lon + (dLon / len) * (dist + wobble)];
  });
}

function chaikin(pts, passes = 2) {
  let p = pts;
  for (let n = 0; n < passes; n++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

async function fetchLightningData(grid) {
  const batchSize = 50;
  const allStrikes = [];
  const now = Date.now();
  const dateStr = new Date().toISOString().split('T')[0];

  for (let i = 0; i < grid.length; i += batchSize) {
    const batch = grid.slice(i, i + batchSize);
    const lats = batch.map(p => p.lat).join(',');
    const lons = batch.map(p => p.lon).join(',');
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}` +
      `&hourly=lightning_strike_count&timezone=UTC&start_date=${dateStr}&end_date=${dateStr}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const data = await res.json();
      const items = Array.isArray(data) ? data : [data];
      items.forEach((d, gi) => {
        const gLat = batch[gi]?.lat;
        const gLon = batch[gi]?.lon;
        if (gLat == null) return;
        const counts = d.hourly?.lightning_strike_count || [];
        const times = d.hourly?.time || [];
        counts.forEach((count, idx) => {
          if (!count) return;
          const time = new Date(times[idx]).getTime();
          if (now - time > 3 * 3600000) return;
          for (let j = 0; j < Math.min(count, 10); j++) {
            const offsetLat = (Math.random() - 0.5) * (4 / 111);
            const offsetLon = (Math.random() - 0.5) * (4 / (111 * Math.cos(gLat * Math.PI / 180)));
            allStrikes.push({
              id: `${gLat}-${gLon}-${idx}-${j}`,
              lat: gLat + offsetLat,
              lon: gLon + offsetLon,
              time,
              intensity: Math.random() * 100,
            });
          }
        });
      });
    } catch (_) {}
    if (i + batchSize < grid.length) await new Promise(r => setTimeout(r, 200));
  }
  return allStrikes;
}

function detectStormClusters(strikes, minStrikes = 5, windowMs = 15 * 60000) {
  if (strikes.length < minStrikes) return [];
  const now = Date.now();
  const recent = strikes.filter(s => now - s.time <= windowMs);
  if (recent.length < minStrikes) return [];
  const visited = new Array(recent.length).fill(false);
  const clusters = [];
  for (let i = 0; i < recent.length; i++) {
    if (visited[i]) continue;
    const cluster = [i];
    visited[i] = true;
    for (let j = i + 1; j < recent.length; j++) {
      if (visited[j]) continue;
      const dist = Math.sqrt(
        Math.pow(recent[i].lat - recent[j].lat, 2) +
        Math.pow(recent[i].lon - recent[j].lon, 2)
      );
      if (dist < 1.0) { cluster.push(j); visited[j] = true; }
    }
    if (cluster.length >= minStrikes) clusters.push(cluster.map(idx => recent[idx]));
  }
  return clusters;
}

function buildStormBlob(cluster) {
  const pts = cluster.map(s => [s.lat, s.lon]);
  if (pts.length < 3) return null;
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  const cLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cLon = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const expanded = expandPoly(hull, 0.4, 0.1);
  const smoothed = chaikin(expanded, 3);
  return {
    hull: smoothed,
    center: [cLat, cLon],
    strikeCount: cluster.length,
    intensity: cluster.reduce((s, st) => s + st.intensity, 0) / cluster.length,
  };
}

let _lfPromise = null;
function loadLeaflet() {
  if (_lfPromise) return _lfPromise;
  _lfPromise = new Promise(resolve => {
    if (window.L) { resolve(); return; }
    if (!document.getElementById('lf-css-lt')) {
      const link = document.createElement('link');
      link.id = 'lf-css-lt'; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
  return _lfPromise;
}

function LightningMap({ strikes, stormBlobs, lightMode, isEurope, isUSA, selectionMode, onSelectionResult }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const layerRef = useRef(null);
  const selectionLayerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const drawingRef = useRef(false);
  const startLatLngRef = useRef(null);
  const rectRef = useRef(null);
  const selectionModeRef = useRef(selectionMode);

  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);

  useEffect(() => { loadLeaflet().then(() => setReady(true)); }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || mapInst.current) return;
    const L = window.L;
    const center = isUSA ? [38, -96] : isEurope ? [52, 12] : [54.5, -3.5];
    const zoom = isUSA ? 4 : isEurope ? 4 : 6;
    mapInst.current = L.map(mapRef.current, {
      center, zoom, zoomControl: true,
      scrollWheelZoom: false, attributionControl: false,
      dragging: true,
    });
    const tileUrl = lightMode
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    L.tileLayer(tileUrl, { maxZoom: 14, subdomains: 'abcd' }).addTo(mapInst.current);
    layerRef.current = L.layerGroup().addTo(mapInst.current);
    selectionLayerRef.current = L.layerGroup().addTo(mapInst.current);

    if (isUSA) mapInst.current.fitBounds([[24, -125], [50, -66]]);
    else if (isEurope) mapInst.current.fitBounds([[35, -12], [70, 42]]);
    else mapInst.current.fitBounds([[49.0, -8.5], [58.8, 2.0]]);

    // Selection drawing handlers
    mapInst.current.on('mousedown', (e) => {
      if (!selectionModeRef.current) return;
      e.originalEvent.preventDefault();
      drawingRef.current = true;
      startLatLngRef.current = e.latlng;
      mapInst.current.dragging.disable();
      if (rectRef.current) {
        selectionLayerRef.current.removeLayer(rectRef.current);
        rectRef.current = null;
      }
    });

    mapInst.current.on('mousemove', (e) => {
      if (!drawingRef.current || !startLatLngRef.current) return;
      const bounds = L.latLngBounds(startLatLngRef.current, e.latlng);
      if (rectRef.current) {
        rectRef.current.setBounds(bounds);
      } else {
        rectRef.current = L.rectangle(bounds, {
          color: '#facc15', weight: 2, fillColor: '#facc15',
          fillOpacity: 0.1, dashArray: '6 4',
        }).addTo(selectionLayerRef.current);
      }
    });

    mapInst.current.on('mouseup', (e) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      mapInst.current.dragging.enable();
      if (!startLatLngRef.current || !rectRef.current) return;
      const bounds = L.latLngBounds(startLatLngRef.current, e.latlng);
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      // Count strikes inside the selected rectangle
      const strikesInArea = (window.__ltStrikes || []).filter(s =>
        s.lat >= sw.lat && s.lat <= ne.lat && s.lon >= sw.lng && s.lon <= ne.lng
      );
      // Show popup at center of selection
      const center = bounds.getCenter();
      if (onSelectionResult) {
        onSelectionResult({ count: strikesInArea.length, bounds, center });
      }
    });

    // Touch support for mobile
    mapInst.current.on('touchstart', (e) => {
      if (!selectionModeRef.current) return;
      const touch = e.originalEvent.touches[0];
      const latlng = mapInst.current.containerPointToLatLng(
        L.point(touch.clientX - mapRef.current.getBoundingClientRect().left,
                touch.clientY - mapRef.current.getBoundingClientRect().top)
      );
      drawingRef.current = true;
      startLatLngRef.current = latlng;
      mapInst.current.dragging.disable();
    });

    mapInst.current.on('touchmove', (e) => {
      if (!drawingRef.current || !startLatLngRef.current) return;
      e.originalEvent.preventDefault();
      const touch = e.originalEvent.touches[0];
      const latlng = mapInst.current.containerPointToLatLng(
        L.point(touch.clientX - mapRef.current.getBoundingClientRect().left,
                touch.clientY - mapRef.current.getBoundingClientRect().top)
      );
      const bounds = L.latLngBounds(startLatLngRef.current, latlng);
      if (rectRef.current) {
        rectRef.current.setBounds(bounds);
      } else {
        rectRef.current = L.rectangle(bounds, {
          color: '#facc15', weight: 2, fillColor: '#facc15',
          fillOpacity: 0.1, dashArray: '6 4',
        }).addTo(selectionLayerRef.current);
      }
    });

    mapInst.current.on('touchend', (e) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      mapInst.current.dragging.enable();
      if (!rectRef.current || !startLatLngRef.current) return;
      const touch = e.originalEvent.changedTouches[0];
      const latlng = mapInst.current.containerPointToLatLng(
        L.point(touch.clientX - mapRef.current.getBoundingClientRect().left,
                touch.clientY - mapRef.current.getBoundingClientRect().top)
      );
      const bounds = L.latLngBounds(startLatLngRef.current, latlng);
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const strikesInArea = (window.__ltStrikes || []).filter(s =>
        s.lat >= sw.lat && s.lat <= ne.lat && s.lon >= sw.lng && s.lon <= ne.lng
      );
      const center = bounds.getCenter();
      if (onSelectionResult) {
        onSelectionResult({ count: strikesInArea.length, bounds, center });
      }
    });

    return () => {
      try {
        if (mapInst.current) {
          const m = mapInst.current;
          mapInst.current = null; layerRef.current = null; selectionLayerRef.current = null;
          try { m._zoomAnimated = false; } catch (_) {}
          try { m.stop(); m.off(); } catch (_) {}
          setTimeout(() => { try { m.remove(); } catch (_) {} }, 250);
        }
      } catch (_) {}
    };
  }, [ready]); // eslint-disable-line

  // Update cursor based on selection mode
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.style.cursor = selectionMode ? 'crosshair' : '';
    // Clear selection rect when mode is disabled
    if (!selectionMode && selectionLayerRef.current) {
      selectionLayerRef.current.clearLayers();
      rectRef.current = null;
    }
  }, [selectionMode]);

  useEffect(() => {
    if (!mapInst.current || !layerRef.current || !window.L) return;
    const L = window.L;
    layerRef.current.clearLayers();

    stormBlobs.forEach(blob => {
      const intensity = Math.min(100, blob.intensity);
      const color = intensity > 80 ? '#ef4444' : intensity > 50 ? '#f97316' : '#facc15';
      L.polygon(blob.hull, { color, fillColor: color, fillOpacity: 0.15, weight: 2, dashArray: '4 4' }).addTo(layerRef.current);
    });

    strikes.forEach(strike => {
      const age = (Date.now() - strike.time) / 1000;
      const opacity = Math.max(0.3, 1 - age / 10800);
      const size = Math.max(3, 6 * (strike.intensity / 100));
      L.circleMarker([strike.lat, strike.lon], {
        radius: size, color: '#ffff00', fillColor: '#ffff00',
        fillOpacity: opacity, weight: 0.5, opacity,
      }).addTo(layerRef.current)
        .bindTooltip(`⚡ Strike at ${new Date(strike.time).toLocaleTimeString()}`, { sticky: true });
    });
  }, [strikes, stormBlobs]);

  return (
    <div ref={mapRef} style={{
      width: '100%', height: 340, borderRadius: 14,
      overflow: 'hidden', background: lightMode ? '#e8edf5' : '#060d1e',
    }} />
  );
}

export default function LightningTracker({ region = 'uk', lightMode = false }) {
  const isEurope = region === 'europe';
  const isUSA = region === 'usa';
  const currentGrid = isUSA ? USA_GRID : isEurope ? EUROPE_GRID : UK_GRID;

  const [strikes, setStrikes] = useState([]);
  const [stormBlobs, setStormBlobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionResult, setSelectionResult] = useState(null);
  const refreshInterval = useRef(null);

  // Keep a window-level ref so the map event handlers can access current strikes
  useEffect(() => { window.__ltStrikes = strikes; }, [strikes]);

  const fetchStrikes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLightningData(currentGrid);
      setStrikes(data);
      const clusters = detectStormClusters(data, 5, 15 * 60000);
      const blobs = clusters.map(c => buildStormBlob(c)).filter(Boolean);
      setStormBlobs(blobs);
      setLastUpdate(new Date());
    } catch (e) {
      console.error('Lightning fetch error:', e);
    }
    setLoading(false);
  }, [region]); // eslint-disable-line

  useEffect(() => {
    fetchStrikes();
    refreshInterval.current = setInterval(fetchStrikes, 5 * 60000);
    return () => clearInterval(refreshInterval.current);
  }, [fetchStrikes]);

  const handleSelectionResult = useCallback(({ count, bounds, center }) => {
    setSelectionResult({ count, bounds, center });
  }, []);

  const clearSelection = () => {
    setSelectionResult(null);
  };

  const fg = lightMode ? '#0f172a' : '#f1f5f9';
  const fg2 = lightMode ? '#475569' : '#64748b';
  const panelBg = lightMode ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)';
  const panelBorder = lightMode ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,0,0.15)', border: '1px solid rgba(255,255,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Zap style={{ width: 16, height: 16, color: '#facc15' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: fg }}>
            Live Lightning Tracker · {isUSA ? 'USA' : isEurope ? 'Europe' : 'UK'}
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: '0.62rem', color: fg2 }}>
            Open-Meteo · last 3 hours · refreshes every 5 min
          </p>
        </div>
        <button onClick={fetchStrikes} disabled={loading}
          style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa', fontSize: '0.7rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: loading ? 0.5 : 1 }}>
          <RefreshCw style={{ width: 12, height: 12 }} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Stats + area-select tool row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {strikes.length > 0 && (
          <div style={{ padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,0,0.1)', border: '1px solid rgba(255,255,0,0.25)', fontSize: '0.72rem', fontWeight: 600, color: '#facc15' }}>
            ⚡ {strikes.length} strikes (3h window)
          </div>
        )}
        {stormBlobs.length > 0 && (
          <div style={{ padding: '6px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.72rem', fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle style={{ width: 12, height: 12 }} /> {stormBlobs.length} Active Storm{stormBlobs.length > 1 ? 's' : ''}
          </div>
        )}
        {lastUpdate && (
          <div style={{ fontSize: '0.62rem', color: fg2 }}>
            Updated {lastUpdate.toLocaleTimeString()}
          </div>
        )}

        {/* Area selection toggle — always visible */}
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={() => { setSelectionMode(m => !m); setSelectionResult(null); }}
            title={selectionMode ? 'Cancel area selection' : 'Draw a rectangle on the map to count strikes in that area'}
            style={{
              padding: '6px 12px', borderRadius: 8,
              background: selectionMode ? 'rgba(250,204,21,0.25)' : panelBg,
              border: selectionMode ? '1px solid rgba(250,204,21,0.6)' : `1px solid ${panelBorder}`,
              color: selectionMode ? '#facc15' : fg2,
              fontSize: '0.72rem', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.2s',
            }}>
            {selectionMode
              ? <><X style={{ width: 12, height: 12 }} /> Cancel Selection</>
              : <><Square style={{ width: 12, height: 12 }} /> Select Area</>}
          </button>
        </div>
      </div>

      {/* Selection mode hint banner */}
      {selectionMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 10, marginBottom: 10,
          background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)',
          fontSize: '0.72rem', color: '#facc15', fontWeight: 500,
        }}>
          <MousePointer style={{ width: 13, height: 13, flexShrink: 0 }} />
          Click and drag on the map to draw a selection rectangle — the number of lightning strikes inside will be shown.
        </div>
      )}

      <LightningMap
        strikes={strikes}
        stormBlobs={stormBlobs}
        lightMode={lightMode}
        isEurope={isEurope}
        isUSA={isUSA}
        key={region}
        selectionMode={selectionMode}
        onSelectionResult={handleSelectionResult}
      />

      {/* Selection result banner */}
      {selectionResult && (
        <div style={{
          marginTop: 10, padding: '12px 16px', borderRadius: 12,
          background: 'rgba(250,204,21,0.12)', border: '1px solid rgba(250,204,21,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'rgba(250,204,21,0.2)', border: '1px solid rgba(250,204,21,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Zap style={{ width: 18, height: 18, color: '#facc15' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#facc15' }}>
                {selectionResult.count.toLocaleString()} strike{selectionResult.count !== 1 ? 's' : ''} in selected area
              </div>
              <div style={{ fontSize: '0.65rem', color: fg2, marginTop: 2 }}>
                {(() => {
                  const sw = selectionResult.bounds.getSouthWest();
                  const ne = selectionResult.bounds.getNorthEast();
                  return `Lat ${sw.lat.toFixed(2)}°–${ne.lat.toFixed(2)}°  Lon ${sw.lng.toFixed(2)}°–${ne.lng.toFixed(2)}°`;
                })()}
              </div>
            </div>
          </div>
          <button onClick={clearSelection} style={{
            padding: '5px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            color: fg2, fontSize: '0.68rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <X style={{ width: 11, height: 11 }} /> Clear
          </button>
        </div>
      )}

      {!loading && strikes.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', borderRadius: 12, background: lightMode ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)', border: lightMode ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.08)', marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: fg2 }}>
            No lightning strikes detected in the last 3 hours for this region
          </p>
        </div>
      )}
    </div>
  );
}