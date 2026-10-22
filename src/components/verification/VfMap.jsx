/* The Verification pages' map: Leaflet over the UK & Ireland with a basemap in the site's light or
   dark theme, one forecast image (a canvas from novaMaps.renderField) and the lightning strikes on
   top, coloured from the period's first strike (dark red) to its last (pale yellow) or all yellow.
   The wheel scrolls the page; Ctrl (or a trackpad pinch) and the wheel zoom the map. */
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_BOUNDS } from './novaMaps';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const tiles = (dark) => [`${ESRI}/World_${dark ? 'Dark' : 'Light'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/World_${dark ? 'Dark' : 'Light'}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`];
const UK = [[49.9, -10.7], [59.0, 2.0]];

export const strikeColour = (a) => (a > 0.85 ? '#fffbe6' : a > 0.6 ? '#facc15' : a > 0.3 ? '#f97316' : '#ef4444');

/* every strike on one canvas, redrawn when the map stops moving */
const StrikeLayer = L.Layer.extend({
  initialize(opts) { this.o = opts; },
  onAdd(map) {
    this._map = map;
    this._c = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
    Object.assign(this._c.style, { position: 'absolute', pointerEvents: 'none' });
    map.getPane('strikes').appendChild(this._c);
    map.on('moveend zoomend resize', this._draw, this);
    this._draw();
  },
  onRemove(map) { map.off('moveend zoomend resize', this._draw, this); this._c.remove(); },
  set(opts) { this.o = opts; this._draw(); },
  _draw() {
    const map = this._map;
    if (!map) return;
    const size = map.getSize(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
    this._c.width = size.x * dpr; this._c.height = size.y * dpr;
    this._c.style.width = `${size.x}px`; this._c.style.height = `${size.y}px`;
    const ctx = this._c.getContext('2d');
    ctx.scale(dpr, dpr);
    const { strikes = [], byTime = true } = this.o || {};
    if (!strikes.length) return;
    const t0 = strikes[0][0], span = Math.max(strikes[strikes.length - 1][0] - t0, 1);
    const z = map.getZoom(), r = z >= 9 ? 3 : z >= 7 ? 2.3 : 1.7;
    const b = map.getBounds().pad(0.05);
    for (const [t, lat, lon] of strikes) {
      if (!b.contains([lat, lon])) continue;
      const a = (t - t0) / span;
      const p = map.latLngToContainerPoint([lat, lon]);
      ctx.fillStyle = byTime ? strikeColour(a) : '#facc15';
      ctx.globalAlpha = byTime ? 0.6 + 0.4 * a : 0.9;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
});

/**
 * overlay   a canvas (or null) drawn over MAP_BOUNDS
 * strikes   [[t, lat, lon], …] in time order
 * onHover   (lat, lon) | null, as the pointer moves
 */
export default function VfMap({ dark, overlay = null, opacity = 0.85, strikes = null, byTime = true, onHover, height = 560, interactive = true, fit = UK }) {
  const el = useRef(null), map = useRef(null), base = useRef([]), img = useRef(null), sl = useRef(null), hover = useRef(onHover);
  hover.current = onHover;
  const [hint, setHint] = useState(false);

  useEffect(() => {
    const m = L.map(el.current, {
      zoomControl: interactive, attributionControl: interactive, dragging: interactive, scrollWheelZoom: false,
      doubleClickZoom: interactive, touchZoom: interactive, boxZoom: false, keyboard: interactive,
      minZoom: 4, maxZoom: 11, zoomSnap: 0.25,
    });
    m.fitBounds(fit);
    m.createPane('strikes').style.zIndex = 640;
    m.createPane('labels');
    Object.assign(m.getPane('labels').style, { zIndex: 650, pointerEvents: 'none' });
    m.on('mousemove', (e) => hover.current?.(e.latlng.lat, e.latlng.lng));
    m.on('mouseout', () => hover.current?.(null));
    map.current = m;
    /* the box can still be settling when the map is made */
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    let hideHint = null;
    const onWheel = (e) => {
      if (!interactive) return;
      if (!e.ctrlKey && !e.metaKey) {
        setHint(true); clearTimeout(hideHint); hideHint = setTimeout(() => setHint(false), 1300);
        return;
      }
      e.preventDefault();
      m.setZoomAround(m.mouseEventToContainerPoint(e), m.getZoom() - Math.sign(e.deltaY) * 0.5);
    };
    const box = el.current;
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => { clearTimeout(hideHint); box.removeEventListener('wheel', onWheel); ro.disconnect(); m.remove(); map.current = null; base.current = []; img.current = null; sl.current = null; };
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const t of base.current) t.remove();
    const [b, r] = tiles(dark);
    base.current = [
      L.tileLayer(b, { attribution: '© Esri', maxZoom: 16 }).addTo(m),
      L.tileLayer(r, { pane: 'labels', maxZoom: 16 }).addTo(m),
    ];
  }, [dark, interactive]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!overlay) { img.current?.remove(); img.current = null; return; }
    const url = overlay.toDataURL();
    if (img.current) { img.current.setUrl(url); img.current.setOpacity(opacity); }
    else img.current = L.imageOverlay(url, MAP_BOUNDS, { opacity, interactive: false }).addTo(m);
  }, [overlay, opacity, interactive]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!strikes?.length) { sl.current?.remove(); sl.current = null; return; }
    if (sl.current) sl.current.set({ strikes, byTime });
    else sl.current = new StrikeLayer({ strikes, byTime }).addTo(m);
  }, [strikes, byTime, interactive]);

  return (
    <div className="vf-mapwrap">
      <div ref={el} className="vf-leaflet" style={{ height }} />
      <div className={`vf-maphint${hint ? ' on' : ''}`} aria-hidden="true">Hold Ctrl and scroll to zoom the map</div>
    </div>
  );
}
