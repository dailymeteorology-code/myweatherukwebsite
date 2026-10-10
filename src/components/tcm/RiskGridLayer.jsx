import { useEffect, useRef } from 'react';

// ── SPC-style colour ramp ────────────────────────────────────────────────────
// Tuned to read clearly on both light and dark basemaps, with translucent
// fills that nest cleanly.
export const RISK_LEVELS = [
  { threshold: 75, label: 'High',     color: '#b91c1c', glow: '#dc2626', fillOpacity: 0.58 },
  { threshold: 60, label: 'Moderate', color: '#dc2626', glow: '#ef4444', fillOpacity: 0.52 },
  { threshold: 45, label: 'Enhanced', color: '#f97316', glow: '#fb923c', fillOpacity: 0.46 },
  { threshold: 30, label: 'Slight',   color: '#eab308', glow: '#facc15', fillOpacity: 0.40 },
  { threshold: 15, label: 'Marginal', color: '#84cc16', glow: '#a3e635', fillOpacity: 0.34 },
  { threshold: 5,  label: 'Very Low', color: '#06b6d4', glow: '#22d3ee', fillOpacity: 0.26 },
  { threshold: 1,  label: 'Low',      color: '#475569', glow: '#64748b', fillOpacity: 0.18 },
  { threshold: 0,  label: 'No Risk',  color: '#1e293b', glow: '#334155', fillOpacity: 0.06 },
];

function colorFor(p) {
  for (const lvl of RISK_LEVELS) if (p >= lvl.threshold) return lvl;
  return RISK_LEVELS[RISK_LEVELS.length - 1];
}

// Inject one-time CSS for the polygon glow, hover, and nicer tooltip
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected || typeof document === 'undefined') return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .tcm-risk-poly { transition: opacity 0.18s ease; }
    .tcm-risk-poly:hover { opacity: 0.92 !important; }
    .tcm-risk-cell { transition: fill-opacity 0.15s ease; cursor: pointer; }
    .tcm-risk-cell:hover { fill-opacity: 0.85 !important; }
    .tcm-tooltip {
      background: rgba(10,15,30,0.96) !important;
      color: #e2e8f0 !important;
      border: 1px solid rgba(148,163,184,0.35) !important;
      border-radius: 8px !important;
      padding: 8px 10px !important;
      box-shadow: 0 10px 28px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset;
      font-family: 'DM Sans', system-ui, sans-serif !important;
    }
    .tcm-tooltip strong { letter-spacing: 0.02em; }
  `;
  document.head.appendChild(style);
}

/**
 * Renders a probability grid as semi-transparent rounded cells PLUS smooth
 * nested risk polygons on a Leaflet map.
 *
 * Major improvements over the previous version:
 *   • Stacked outer-glow + inner-stroke for each polygon, so nested layers
 *     read clearly without muddy colour mixing.
 *   • Rounded grid cells with a subtle hover state.
 *   • Cleaner styled tooltip.
 *   • Levels sorted outer-first so the smallest, most severe area sits on top.
 */
export default function RiskGridLayer({
  map,
  cells = [],
  polygons = [],
  showCells = true,
  showPolygons = true,
  wmoLabel = null,
}) {
  const layerRef = useRef(null);

  useEffect(() => { injectStyles(); }, []);

  useEffect(() => {
    const L = window.L;
    if (!L || !map) return;
    if (!layerRef.current) layerRef.current = L.layerGroup().addTo(map);
    const layer = layerRef.current;
    layer.clearLayers();

    const CELL_HALF = 0.15;

    if (showCells) {
      cells.forEach(c => {
        const lvl = colorFor(c.p);
        if (!lvl.color || lvl.color === 'transparent') return;

        const rect = L.rectangle(
          [[c.lat - CELL_HALF, c.lon - CELL_HALF * 1.4], [c.lat + CELL_HALF, c.lon + CELL_HALF * 1.4]],
          {
            color: 'transparent',
            fillColor: lvl.color,
            fillOpacity: lvl.fillOpacity * 0.78,
            weight: 0,
            interactive: true,
            className: 'tcm-risk-cell',
          }
        ).addTo(layer);

        if (c.metrics || c.p != null) {
          const m = c.metrics || {};
          const wmoStr = wmoLabel && m.wmoCode ? `<br/><span style="color:#94a3b8">${wmoLabel(m.wmoCode)}</span>` : '';
          const spreadStr = m.tempSpread != null
            ? `<br/><span style="color:#64748b;font-size:0.7em">Model spread: ${m.tempSpread.toFixed(1)}°C</span>`
            : '';

          rect.bindTooltip(
            `<div style="font-size:0.78rem;line-height:1.5">
              <strong style="color:${lvl.color}">${lvl.label}</strong>
              <span style="color:#94a3b8"> · ${Math.round(c.p)}%</span>
              ${wmoStr}
              ${m.cape != null ? `<br/><span style="color:#cbd5e1">CAPE</span> <span style="font-family:'DM Mono',monospace">${m.cape}</span> J/kg` : ''}
              ${m.gust != null ? `<br/><span style="color:#cbd5e1">Gust</span> <span style="font-family:'DM Mono',monospace">${m.gust}</span> mph` : ''}
              ${m.precip != null ? `<br/><span style="color:#cbd5e1">Rain</span> <span style="font-family:'DM Mono',monospace">${m.precip}</span> mm` : ''}
              ${spreadStr}
            </div>`,
            { sticky: true, opacity: 1, className: 'tcm-tooltip' }
          );
        }
      });
    }

    if (showPolygons) {
      // Render outer (lower-threshold) layers first so higher-threshold
      // areas sit cleanly on top.
      const sorted = [...polygons].sort((a, b) => a.level - b.level);
      sorted.forEach(poly => {
        const lvl = colorFor(poly.level);
        if (!poly?.coords?.length) return;

        // Soft outer glow — broad, low-opacity halo
        L.polygon(poly.coords, {
          color: lvl.glow,
          fillColor: lvl.glow,
          fillOpacity: lvl.fillOpacity * 0.18,
          weight: 6,
          opacity: 0.28,
          lineJoin: 'round',
          lineCap: 'round',
          interactive: false,
          className: 'tcm-risk-poly',
        }).addTo(layer);

        // Main fill
        L.polygon(poly.coords, {
          color: lvl.color,
          fillColor: lvl.color,
          fillOpacity: lvl.fillOpacity * 0.72,
          weight: 2,
          opacity: 0.85,
          lineJoin: 'round',
          lineCap: 'round',
          interactive: false,
          className: 'tcm-risk-poly',
        }).addTo(layer);

        // Crisp inner stroke
        L.polygon(poly.coords, {
          color: lvl.color,
          fillOpacity: 0,
          weight: 1.2,
          opacity: 0.95,
          lineJoin: 'round',
          lineCap: 'round',
          interactive: false,
          className: 'tcm-risk-poly',
        }).addTo(layer);
      });
    }

    return () => {
      try { layer.clearLayers(); } catch (_) {}
    };
  }, [map, cells, polygons, showCells, showPolygons, wmoLabel]);

  useEffect(() => {
    return () => {
      if (layerRef.current && map) {
        try { map.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
}