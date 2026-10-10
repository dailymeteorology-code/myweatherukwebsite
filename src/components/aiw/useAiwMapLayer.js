/**
 * Draws the AI lightning warnings on the existing Leaflet map.
 *
 *   NOW          current warning area: solid severity outline, semi-opaque fill
 *   FORECAST     the area at the selected lead (+5…+30 min): same colour,
 *                much fainter fill, DASHED outline — visibly a prediction
 *   CORRIDOR     the uncertainty corridor (lower-probability envelope over the
 *                whole 30 minutes): very faint, dotted
 *   TRACK        centroid path now -> +30 min, with an arrowhead
 *   LABELS       "+30 min forecast", severity tag — hidden at continental zoom
 *
 * When the forecast-time slider is at NOW and tracks are on, the +30 min area
 * is shown alongside the current one. When the slider is moved, the area for
 * that lead is shown and the current area fades back, so it is always clear
 * which shape is observation-based and which is forecast.
 *
 * Everything goes into the dedicated warnings pane (above the strike canvases)
 * so it can be clicked.
 */
import { useEffect, useRef } from 'react';
import { SEV } from './aiwClient';

/** [south, north, centre-lon] of a GeoJSON polygon, for placing labels clear of it. */
function edges(geom) {
  let s = 90; let n = -90; let w = 180; let e = -180;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of polys) for (const [lon, lat] of p[0]) { if (lat < s) s = lat; if (lat > n) n = lat; if (lon < w) w = lon; if (lon > e) e = lon; }
  return [s, n, (w + e) / 2];
}

function geoToLayers(L, geom, style, renderer) {
  return L.geoJSON(geom, { style: () => style, pane: 'warningsPane', renderer, interactive: style.interactive !== false });
}

/** A small arrowhead polygon at `tip`, pointing along bearing from `from`. */
function arrowHead(L, from, tip, color, renderer) {
  const dLat = tip[0] - from[0];
  const dLon = (tip[1] - from[1]) * Math.cos((tip[0] * Math.PI) / 180);
  const len = Math.hypot(dLat, dLon);
  if (len < 1e-4) return null;
  const ux = dLon / len; const uy = dLat / len;
  const size = Math.min(0.12, Math.max(0.04, len * 0.25));
  const back = [tip[0] - uy * size, tip[1] - (ux * size) / Math.cos((tip[0] * Math.PI) / 180)];
  const side = size * 0.55;
  const left = [back[0] + ux * side, back[1] - (uy * side) / Math.cos((tip[0] * Math.PI) / 180)];
  const right = [back[0] - ux * side, back[1] + (uy * side) / Math.cos((tip[0] * Math.PI) / 180)];
  return L.polygon([tip, left, right], { color, fillColor: color, fillOpacity: 0.9, weight: 1, pane: 'warningsPane', renderer, interactive: false });
}

export function useAiwMapLayer({ map, renderer, warnings, showAreas, showTracks, lead, selectedId, onSelect, lightMode }) {
  const groupRef = useRef(null);
  const zoomRef = useRef(map ? map.getZoom() : 5);

  useEffect(() => {
    if (!map || !window.L) return undefined;
    const L = window.L;
    const g = L.layerGroup().addTo(map);
    groupRef.current = g;
    zoomRef.current = map.getZoom();
    const onZoom = () => { zoomRef.current = map.getZoom(); draw(); };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); g.remove(); groupRef.current = null; };
    // draw is defined below and reads current props via the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // `draw` reads the latest props through a ref so the zoom handler above
  // always paints current data.
  const propsRef = useRef({});
  propsRef.current = { warnings, showAreas, showTracks, lead, selectedId, onSelect, lightMode, renderer };

  function draw() {
    const g = groupRef.current;
    const L = window.L;
    if (!g || !L || !map) return;
    g.clearLayers();
    const { warnings: ws, showAreas: areas, showTracks: tracks, lead: ld, selectedId: sel, onSelect: pick, lightMode: light, renderer: rd } = propsRef.current;
    if (!areas || !ws?.length) return;
    const z = zoomRef.current;
    const detailed = z >= 5;   // labels, corridors and arrows only when they can be read
    const outline = light ? 'rgba(15,23,42,0.55)' : 'rgba(0,0,0,0.55)';

    // Lowest severity first, so red sits on top where warnings overlap.
    const ordered = [...ws].sort((a, b) => SEV[a.severity].level - SEV[b.severity].level);
    for (const w of ordered) {
      const c = SEV[w.severity].color;
      const isSel = w.id === sel;
      const click = (e) => { L.DomEvent.stopPropagation(e); pick?.(w); };

      /* DECLUTTER. With several storms close together, drawing every
         warning's corridor, labels and tags at once turned the map into a
         pile of overlapping outlines and text. The SELECTED warning gets
         everything; the others get their area, a light dashed forecast
         outline and a direction arrow — enough to read, not enough to bury
         each other. Tags for every warning appear only when zoomed right in. */
      const focus = isSel || ws.length === 1;

      // Uncertainty corridor — selected warning only.
      if (tracks && detailed && focus && w.corridor) {
        geoToLayers(L, w.corridor, { color: c, weight: 1, opacity: 0.55, dashArray: '2 6', fillColor: c, fillOpacity: 0.04, interactive: false }, rd).addTo(g);
      }

      // Forecast area for the selected lead (or +30 at NOW).
      const fcLead = ld > 0 ? ld : 30;
      const fc = (w.forecast || []).find((f) => f.lead === fcLead);
      if (tracks && fc?.geometry) {
        const lyr = geoToLayers(L, fc.geometry, {
          color: c, weight: focus ? 2.4 : 1.2, opacity: focus ? 0.95 : 0.6, dashArray: focus ? '8 6' : '5 6',
          fillColor: c, fillOpacity: ld > 0 ? (focus ? 0.16 : 0.08) : (focus ? 0.08 : 0.03),
        }, rd);
        lyr.on('click', click);
        lyr.addTo(g);
        if (detailed && focus) {
          // Below the forecast area, so it never sits on the severity tag.
          const [fs2, , fcx] = edges(fc.geometry);
          L.marker([fs2, fcx], {
            pane: 'warningsPane', interactive: false,
            icon: L.divIcon({
              className: 'aiw-fc-label',
              html: `<span style="border-color:${c};color:${light ? '#1e293b' : '#f8fafc'}">+${fcLead} min forecast</span>`,
              iconSize: null,
            }),
          }).addTo(g);
        }
      }

      // Track: centroid path and arrowhead.
      const pts = (w.track?.points || []).map((p) => [p.lat, p.lon]);
      if (tracks && detailed && pts.length >= 2) {
        if (focus) L.polyline(pts, { color: outline, weight: 4.5, opacity: 0.5, pane: 'warningsPane', renderer: rd, interactive: false }).addTo(g);
        L.polyline(pts, { color: c, weight: focus ? 2.2 : 1.4, opacity: focus ? 0.95 : 0.7, dashArray: '1 5', lineCap: 'round', pane: 'warningsPane', renderer: rd, interactive: false }).addTo(g);
        const head = arrowHead(L, pts[pts.length - 2], pts[pts.length - 1], c, rd);
        if (head) head.addTo(g);
      }

      // Current area — solid. Faded while the slider shows a future time.
      if (w.geometry) {
        const halo = geoToLayers(L, w.geometry, { color: outline, weight: isSel ? 6 : 4, opacity: ld > 0 ? 0.25 : 0.55, fill: false, interactive: false }, rd);
        halo.addTo(g);
        const lyr = geoToLayers(L, w.geometry, {
          color: c, weight: isSel ? 3.4 : 2.4, opacity: ld > 0 ? 0.45 : 1,
          fillColor: c, fillOpacity: ld > 0 ? 0.08 : (isSel ? 0.34 : 0.26),
        }, rd);
        lyr.on('click', click);
        lyr.addTo(g);
      }

      /* Zoomed out, a storm-sized polygon is a few pixels across and effectively
         invisible. Each warning also gets a severity pin at its centre — with
         the level letter, so it reads without colour — that can be clicked. */
      if (!detailed && w.centroid) {
        const pin = L.marker(w.centroid, {
          pane: 'warningsPane', keyboard: true, title: `${SEV[w.severity].label} AI lightning warning — ${w.areaLabel}`,
          icon: L.divIcon({
            className: 'aiw-pin',
            html: `<span style="background:${c};color:${SEV[w.severity].ink};${isSel ? 'outline:3px solid ' + (light ? '#0f172a' : '#fff') + ';' : ''}">${w.isTest ? 'T' : SEV[w.severity].label[0]}</span>`,
            iconSize: [22, 22], iconAnchor: [11, 11],
          }),
        });
        pin.on('click', click);
        pin.addTo(g);
      }

      if (detailed && w.geometry && (focus || z >= 8)) {
        // Above the warning area (the forecast label sits below its own area).
        const [, wn, wx] = edges(w.geometry);
        L.marker([wn, wx], {
          pane: 'warningsPane', interactive: false,
          icon: L.divIcon({
            className: 'aiw-tag',
            html: `<span style="background:${c};color:${SEV[w.severity].ink}">${w.isTest ? 'TEST · ' : ''}${SEV[w.severity].label.toUpperCase()}</span>`,
            iconSize: null,
          }),
        }).addTo(g);
      }
    }
  }

  /* Repaint only when something the drawing depends on changes. This used to
     run after EVERY render of the page — which happens constantly while
     lightning is arriving — clearing and re-creating every warning polygon
     each time. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { draw(); }, [warnings, showAreas, showTracks, lead, selectedId, lightMode, renderer]);

  // Fly to a warning when it is selected from the list.
  const lastSel = useRef(null);
  useEffect(() => {
    if (!map || !selectedId || lastSel.current === selectedId) return;
    lastSel.current = selectedId;
    const w = warnings?.find((x) => x.id === selectedId);
    if (!w?.geometry || !window.L) return;
    try {
      const b = window.L.geoJSON(w.geometry).getBounds();
      // Include the forecast so the whole track is in view.
      const last = w.forecast?.[w.forecast.length - 1];
      if (last?.geometry) b.extend(window.L.geoJSON(last.geometry).getBounds());
      // Capped at 7: the Esri Canvas basemap has gaps beyond that (the
      // 'Zoom Level Not Supported' tiles), the same reason the world-alert
      // fly-to is capped.
      map.flyToBounds(b, { padding: [50, 50], maxZoom: 7, duration: 1 });
    } catch { /* ignore */ }
  }, [selectedId, warnings, map]);
}

/** CSS for the map labels. Injected once by the page. */
export const AIW_MAP_CSS = `
.aiw-fc-label span { display:inline-block; transform:translate(-50%,6px); white-space:nowrap;
  font:700 10px/1.2 system-ui,sans-serif; letter-spacing:.02em; padding:2px 7px; border-radius:99px;
  border:1.5px dashed; background:var(--glass-fill-strong); backdrop-filter:blur(8px); }
.aiw-pin span { display:flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:6px;
  font:900 11px/1 system-ui,sans-serif; border:1.5px solid rgba(0,0,0,.55); box-shadow:0 1px 5px rgba(0,0,0,.45); cursor:pointer; }
.aiw-tag span { display:inline-block; transform:translate(-50%,calc(-100% - 6px)); white-space:nowrap;
  font:800 9.5px/1.2 system-ui,sans-serif; letter-spacing:.08em; padding:2px 6px; border-radius:5px;
  box-shadow:0 1px 4px rgba(0,0,0,.35); }
`;
