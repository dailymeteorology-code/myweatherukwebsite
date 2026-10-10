/**
 * TCMLeafletBase — real OpenStreetMap basemap (UK or Europe) used under every
 * TCM map. Uses a ResizeObserver to wait for real pixel dimensions before
 * exposing the projector, preventing the SVG overlay from rendering at 0,0.
 *
 * Interaction model
 * -----------------
 * The map is fully interactive (drag / wheel-zoom / pinch / double-tap /
 * momentum). Hover & inspect are routed through Leaflet's own event bus
 * (`onHover` / `onInspect`) rather than a DOM overlay, so the risk-polygon
 * overlay can stay `pointer-events:none` and NEVER blocks panning or pinching —
 * on desktop or touch. Parents that want a hover tooltip / inspect card just
 * pass those callbacks and render from the emitted { lat, lon, x, y }.
 *
 * Built-in map-app controls (opt-in): a place SEARCH (OSM Nominatim, UK+IE),
 * a LOCATE (device GPS) button, and a FULLSCREEN toggle. An optional `pin`
 * ({lat,lon}) drops a marker.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { UK_IRELAND_COUNTIES } from '@/components/tcm/ukIrelandMask';

// ── Base-map style registry ──────────────────────────────────────────────────
export const MAP_STYLES = {
  counties: {
    label: 'Counties',
    url: null,
    vector: true,
    bg: '#d9e8f5',            // sea
    landFill: '#ffffff',     // land (UK & Ireland)
    strokeCountry: '#0f172a',
    strokeCounty: '#475569',
    attribution: 'County boundaries © open data (OS / Tailte Éireann), simplified',
    subdomains: [],
    maxZoom: 19,
    dark: false,
  },
  dark: {
    label: 'Dark',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© <a href="https://www.openstreetmap.org/">OSM</a> © <a href="https://www.esri.com/">Esri</a>',
    subdomains: ['a', 'b', 'c', 'd'],
    maxZoom: 19,
    dark: true,
  },
  light: {
    label: 'Light',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© <a href="https://www.openstreetmap.org/">OSM</a> © <a href="https://www.esri.com/">Esri</a>',
    subdomains: ['a', 'b', 'c', 'd'],
    maxZoom: 19,
    dark: false,
  },
  voyager: {
    label: 'Voyager',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© <a href="https://www.openstreetmap.org/">OSM</a> © <a href="https://www.esri.com/">Esri</a>',
    subdomains: ['a', 'b', 'c', 'd'],
    maxZoom: 19,
    dark: false,
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, GIS User Community',
    subdomains: [],
    maxZoom: 19,
    dark: true,
  },
  terrain: {
    label: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data © <a href="https://www.openstreetmap.org/">OSM</a> contributors, SRTM | © <a href="https://opentopomap.org/">OpenTopoMap</a>',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 17,
    dark: false,
  },
  streets: {
    label: 'Streets',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 19,
    dark: false,
  },
};

export const MAP_STYLE_ORDER = ['counties', 'light', 'dark', 'voyager', 'satellite', 'terrain', 'streets'];

function resolveStyleKey(mapStyle, lightMode) {
  if (mapStyle && MAP_STYLES[mapStyle]) return mapStyle;
  return lightMode ? 'counties' : 'dark';
}

let leafletCSSLoaded = false;
function ensureLeafletCSS() {
  if (leafletCSSLoaded) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
  leafletCSSLoaded = true;
}

let leafletPromise = null;
function loadLeaflet() {
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve) => {
    if (window.L) { resolve(window.L); return; }
    ensureLeafletCSS();
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(window.L);
    document.head.appendChild(script);
  });
  return leafletPromise;
}

// Spread onto any on-map control wrapper so clicks, drags, wheel and
// double-clicks on the control don't leak through to the Leaflet map beneath.
const stopMapEvents = {
  onMouseDown:    (e) => e.stopPropagation(),
  onTouchStart:   (e) => e.stopPropagation(),
  onWheel:        (e) => e.stopPropagation(),
  onDoubleClick:  (e) => e.stopPropagation(),
  onPointerDown:  (e) => e.stopPropagation(),
};

export default function TCMLeafletBase({
  bbox,
  height = 540,
  lightMode,
  mapStyle: mapStyleProp,
  onMapStyleChange,
  overlayOpacity: overlayOpacityProp,
  onOverlayOpacityChange,
  showStyleSwitcher = true,
  showOpacitySlider = true,
  children,
  onMapReady,
  // ── Interaction (routed through Leaflet so overlays never block gestures) ──
  onHover,          // ({lat,lon,x,y}) on mousemove, null on mouseout — desktop
  onInspect,        // ({lat,lon,x,y}) on click/tap
  pin = null,       // {lat,lon} → drops a marker
  onPinClear,       // optional: called when the marker's ✕ is tapped
  // ── Optional map-app controls ──
  enableSearch = false,
  enableLocate = false,
  enableFullscreen = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const baseLayerRef = useRef(null);
  const switcherRef = useRef(null);
  const searchRef = useRef(null);
  const [projector, setProjector] = useState(null);
  const [mapObj, setMapObj] = useState(null);
  const [tick, setTick] = useState(0);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [cw, setCw] = useState(0);              // container width for responsive controls
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  // Keep the latest interaction callbacks in refs so the map event handlers
  // (bound once at mount) always call the current versions without re-binding.
  const onHoverRef = useRef(onHover);   onHoverRef.current = onHover;
  const onInspectRef = useRef(onInspect); onInspectRef.current = onInspect;

  const isNarrow = cw > 0 && cw < 560;
  const CBTN = isNarrow ? 30 : 32;              // control button size

  const [styleInternal, setStyleInternal] = useState(
    () => resolveStyleKey(mapStyleProp, lightMode)
  );
  const styleKey = resolveStyleKey(mapStyleProp ?? styleInternal, lightMode);
  const style = MAP_STYLES[styleKey] || MAP_STYLES.dark;
  const isDark = !!style.dark;

  const setStyleKey = useCallback((key) => {
    if (!MAP_STYLES[key]) return;
    setStyleInternal(key);
    onMapStyleChange?.(key);
  }, [onMapStyleChange]);

  const [opacityInternal, setOpacityInternal] = useState(
    () => (typeof overlayOpacityProp === 'number' ? overlayOpacityProp : 1)
  );
  const overlayOpacity = typeof overlayOpacityProp === 'number'
    ? overlayOpacityProp
    : opacityInternal;
  const setOverlayOpacity = useCallback((v) => {
    const clamped = Math.max(0, Math.min(1, v));
    setOpacityInternal(clamped);
    onOverlayOpacityChange?.(clamped);
  }, [onOverlayOpacityChange]);

  const applyBaseLayer = useCallback((map, styleDef) => {
    if (!map || !window.L) return;
    if (baseLayerRef.current) {
      try { map.removeLayer(baseLayerRef.current); } catch (_) {}
      baseLayerRef.current = null;
    }
    if (styleDef.vector) {
      const layer = window.L.geoJSON(UK_IRELAND_COUNTIES, {
        style: () => ({
          color: styleDef.strokeCounty || '#475569',
          weight: 0.8,
          opacity: 1,
          fill: true,
          fillColor: styleDef.landFill || '#ffffff',
          fillOpacity: 1,
          lineJoin: 'round',
          lineCap: 'round',
        }),
        interactive: false,
      });
      layer.addTo(map);
      layer.bringToBack();
      baseLayerRef.current = layer;
      return;
    }
    const tileOpts = {
      attribution: styleDef.attribution,
      maxNativeZoom: styleDef.maxZoom ?? 19,
      maxZoom: 18,
      minZoom: 3,
    };
    if (styleDef.subdomains && styleDef.subdomains.length) {
      tileOpts.subdomains = styleDef.subdomains;
    }
    const layer = window.L.tileLayer(styleDef.url, tileOpts);
    layer.addTo(map);
    layer.bringToBack();
    baseLayerRef.current = layer;
  }, []);

  const buildProjector = useCallback((map) => {
    const size = map.getSize();
    if (!size || size.x < 10 || size.y < 10) return null;
    return {
      project: (lat, lon) => {
        const p = map.latLngToContainerPoint([lat, lon]);
        return [p.x, p.y];
      },
      unproject: (x, y) => {
        const ll = map.containerPointToLatLng([x, y]);
        return [ll.lat, ll.lng];
      },
      size,
    };
  }, []);

  const refreshProjector = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const p = buildProjector(map);
    if (p) setProjector(p);
  }, [buildProjector]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let map = null;

    loadLeaflet().then((L) => {
      if (!containerRef.current || mapRef.current) return;

      map = L.map(el, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        tap: true,
        bounceAtZoomLimits: true,
        inertia: true,
        zoomSnap: 0.5,
        zoomDelta: 0.5,
        wheelDebounceTime: 30,
        wheelPxPerZoomLevel: 90,
        minZoom: 3,
        maxZoom: 18,
      });

      map.scrollWheelZoom.enable();
      map.dragging.enable();
      map.touchZoom.enable();

      applyBaseLayer(map, style);

      map.fitBounds([[bbox.latMin, bbox.lonMin], [bbox.latMax, bbox.lonMax]], {
        animate: false,
        padding: [4, 4],
      });

      mapRef.current = map;
      onMapReady?.(map);
      setMapObj(map);

      const handle = () => {
        map.invalidateSize({ animate: false });
        refreshProjector();
        setTick(t => t + 1);
      };
      map.on('moveend zoomend resize', handle);

      // ── Interaction routed through Leaflet ──
      map.on('mousemove', (e) => {
        const cb = onHoverRef.current;
        if (!cb) return;
        const cp = e.containerPoint;
        cb({ lat: e.latlng.lat, lon: e.latlng.lng, x: cp.x, y: cp.y });
      });
      map.on('mouseout', () => { onHoverRef.current?.(null); });
      map.on('click', (e) => {
        const cb = onInspectRef.current;
        if (!cb) return;
        const cp = e.containerPoint;
        cb({ lat: e.latlng.lat, lon: e.latlng.lng, x: cp.x, y: cp.y });
      });

      map.invalidateSize({ animate: false });
      setTimeout(() => {
        if (!mapRef.current) return;
        map.invalidateSize({ animate: false });
        refreshProjector();
        setTick(t => t + 1);
      }, 120);
      setTimeout(() => {
        if (!mapRef.current) return;
        map.invalidateSize({ animate: false });
        refreshProjector();
        setTick(t => t + 1);
      }, 400);
    });

    const ro = new ResizeObserver((entries) => {
      const m = mapRef.current;
      if (entries && entries[0]) setCw(entries[0].contentRect.width);
      if (!m) return;
      m.invalidateSize({ animate: false });
      const p = buildProjector(m);
      if (p) setProjector(p);
      setTick(t => t + 1);
    });
    ro.observe(el);
    setCw(el.getBoundingClientRect().width);

    return () => {
      ro.disconnect();
      if (map) {
        map.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    map.fitBounds([[bbox.latMin, bbox.lonMin], [bbox.latMax, bbox.lonMax]], {
      animate: false,
      padding: [4, 4],
    });
    setTimeout(() => {
      if (!mapRef.current) return;
      mapRef.current.invalidateSize({ animate: false });
      refreshProjector();
      setTick(t => t + 1);
    }, 80);
  }, [bbox, refreshProjector]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    applyBaseLayer(map, style);
  }, [styleKey, applyBaseLayer, style]);

  // Recompute map size when entering / leaving fullscreen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = setTimeout(() => {
      map.invalidateSize({ animate: false });
      refreshProjector();
      setTick(t => t + 1);
    }, 60);
    const onKey = (e) => { if (e.key === 'Escape') setIsFullscreen(false); };
    if (isFullscreen) document.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); document.removeEventListener('keydown', onKey); };
  }, [isFullscreen, refreshProjector]);

  useEffect(() => {
    if (!styleMenuOpen) return;
    const onDown = (e) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target)) {
        setStyleMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setStyleMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [styleMenuOpen]);

  // Close search results on outside click.
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [searchOpen]);

  // ── Actions ──
  const flyTo = useCallback((lat, lon, zoom = 9, inspect = true) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([lat, lon], zoom, { duration: 0.7 });
    if (inspect) {
      const cp = map.latLngToContainerPoint([lat, lon]);
      onInspectRef.current?.({ lat, lon, x: cp.x, y: cp.y });
    }
  }, []);

  const runSearch = useCallback(async (q) => {
    const query = (q ?? '').trim();
    if (query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&countrycodes=gb,ie&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const json = await res.json();
      setSearchResults((json || []).map(r => ({
        lat: parseFloat(r.lat), lon: parseFloat(r.lon),
        label: r.display_name?.split(',').slice(0, 3).join(', ') || r.display_name || query,
      })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon)));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) { alert('Location is not available on this device.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        flyTo(pos.coords.latitude, pos.coords.longitude, 9, true);
      },
      () => { setLocating(false); alert('Could not get your location — check permissions.'); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }, [flyTo]);

  // ── Shared control button style ──
  const ctlBtn = (extra = {}) => ({
    width: CBTN, height: CBTN, borderRadius: 8, border: 'none', cursor: 'pointer',
    background: isDark ? 'rgba(15,25,50,0.88)' : 'rgba(255,255,255,0.92)',
    color: isDark ? '#e2e8f0' : '#1e293b',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)',
    transition: 'background 0.15s', ...extra,
  });
  const hoverBg = (e, on) => { e.currentTarget.style.background = on ? (isDark ? 'rgba(30,50,90,0.95)' : 'rgba(255,255,255,1)') : (isDark ? 'rgba(15,25,50,0.88)' : 'rgba(255,255,255,0.92)'); };

  const outerStyle = isFullscreen
    ? { position: 'fixed', inset: 0, width: '100vw', height: '100dvh', borderRadius: 0, zIndex: 9998, border: 'none' }
    : { position: 'relative', width: '100%', height, borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)' };

  return (
    <div
      style={{
        ...outerStyle,
        overflow: 'hidden',
        background: style.vector ? (style.bg || '#ffffff') : (isDark ? '#0a1426' : '#dbe6f3'),
      }}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'grab', outline: 'none' }}
        tabIndex={0}
      />

      {/* Risk overlay — pointer-events:none so it NEVER blocks pan/pinch. */}
      {projector && mapObj && (
        <div style={{ position: 'absolute', inset: 0, opacity: overlayOpacity, transition: 'opacity 0.12s ease-out', pointerEvents: 'none', zIndex: 400 }}>
          {children?.({ projector, map: mapObj, overlayOpacity })}
        </div>
      )}

      {/* Pin marker */}
      {pin && mapObj && projector && (() => {
        const [px, py] = projector.project(pin.lat, pin.lon);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
        return (
          <div style={{ position: 'absolute', left: px, top: py, transform: 'translate(-50%,-100%)', zIndex: 620, pointerEvents: 'none', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.45))' }}>
            <svg width="30" height="38" viewBox="0 0 30 38" fill="none" aria-hidden="true">
              <path d="M15 1C7.8 1 2 6.8 2 14c0 8.7 11 21.5 12.2 22.9.4.5 1.2.5 1.6 0C17 35.5 28 22.7 28 14 28 6.8 22.2 1 15 1Z" fill="#6366f1" stroke="#fff" strokeWidth="2"/>
              <circle cx="15" cy="14" r="5" fill="#fff"/>
            </svg>
          </div>
        );
      })()}

      {/* ── Top-right controls: locate / fullscreen / zoom ── */}
      {mapObj && (
        <div {...stopMapEvents} style={{ position: 'absolute', top: 10, right: 10, zIndex: 810, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {enableLocate && (
            <button title="Find my location" onClick={locateMe} style={ctlBtn()}
              onMouseEnter={e => hoverBg(e, true)} onMouseLeave={e => hoverBg(e, false)}>
              {locating
                ? <svg width="15" height="15" viewBox="0 0 24 24" style={{ animation: 'tcmlspin 0.9s linear infinite' }}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42" strokeLinecap="round" opacity="0.9"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>}
            </button>
          )}
          {enableFullscreen && (
            <button title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen map'} onClick={() => setIsFullscreen(f => !f)} style={ctlBtn({ color: isDark ? '#38bdf8' : '#0284c7' })}
              onMouseEnter={e => hoverBg(e, true)} onMouseLeave={e => hoverBg(e, false)}>
              {isFullscreen
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v3a3 3 0 0 1-3 3H3M21 9h-3a3 3 0 0 1-3-3V3M3 15h3a3 3 0 0 1 3 3v3M15 21v-3a3 3 0 0 1 3-3h3"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4"/></svg>}
            </button>
          )}
          {(enableLocate || enableFullscreen) && <div style={{ height: 2 }} />}
          <button title="Zoom in" onClick={() => mapObj.zoomIn()} style={ctlBtn({ fontSize: '1.1rem', fontWeight: 700 })}
            onMouseEnter={e => hoverBg(e, true)} onMouseLeave={e => hoverBg(e, false)}>+</button>
          <button title="Zoom out" onClick={() => mapObj.zoomOut()} style={ctlBtn({ fontSize: '1.1rem', fontWeight: 700 })}
            onMouseEnter={e => hoverBg(e, true)} onMouseLeave={e => hoverBg(e, false)}>−</button>
          <button title="Reset view" onClick={() => mapObj.fitBounds([[bbox.latMin, bbox.lonMin],[bbox.latMax, bbox.lonMax]], { animate: true, padding:[4,4] })}
            style={ctlBtn({ color: isDark ? '#818cf8' : '#6366f1', fontSize: '0.85rem', fontWeight: 900 })}
            onMouseEnter={e => hoverBg(e, true)} onMouseLeave={e => hoverBg(e, false)}>⊙</button>
        </div>
      )}

      {/* ── Search (top-centre, collapsible) ── */}
      {mapObj && enableSearch && (
        <div ref={searchRef} {...stopMapEvents} style={{ position: 'absolute', top: 10, right: CBTN + 18, zIndex: 815, width: searchOpen ? (isNarrow ? 'min(74vw, 300px)' : 288) : CBTN, transition: 'width 0.18s' }}>
          {!searchOpen ? (
            <button title="Search a place" onClick={() => setSearchOpen(true)} style={ctlBtn()}
              onMouseEnter={e => hoverBg(e, true)} onMouseLeave={e => hoverBg(e, false)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            </button>
          ) : (
            <div style={{ background: isDark ? 'rgba(10,18,38,0.94)' : 'rgba(255,255,255,0.96)', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}`, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
                <input autoFocus value={searchQ}
                  onChange={(e) => { setSearchQ(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(searchQ); if (e.key === 'Escape') setSearchOpen(false); }}
                  placeholder="Search a UK / Ireland place…"
                  style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: isDark ? '#f1f5f9' : '#0f172a', fontSize: '0.82rem', fontFamily: "'DM Sans',system-ui,sans-serif" }} />
                <button title="Search" onClick={() => runSearch(searchQ)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: isDark ? '#818cf8' : '#6366f1', fontWeight: 800, fontSize: '0.72rem', padding: '2px 4px' }}>
                  {searching ? '…' : 'Go'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, maxHeight: 220, overflowY: 'auto' }}>
                  {searchResults.map((r, i) => (
                    <button key={i} onClick={() => { flyTo(r.lat, r.lon, 9, true); setSearchOpen(false); setSearchResults([]); setSearchQ(r.label); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', cursor: 'pointer', background: 'transparent', color: isDark ? '#cbd5e1' : '#334155', fontSize: '0.76rem', fontFamily: "'DM Sans',system-ui,sans-serif", lineHeight: 1.3 }}
                      onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Base-map style switcher (top-left) ── */}
      {mapObj && showStyleSwitcher && (
        <div ref={switcherRef} data-style-switcher="true" {...stopMapEvents}
          style={{ position: 'absolute', top: 10, left: 10, zIndex: 810, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <button title="Map style" aria-haspopup="true" aria-expanded={styleMenuOpen} onClick={() => setStyleMenuOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: CBTN, padding: '0 12px', borderRadius: 8, cursor: 'pointer', border: 'none', background: isDark ? 'rgba(15,25,50,0.88)' : 'rgba(255,255,255,0.92)', color: isDark ? '#e2e8f0' : '#1e293b', fontSize: '0.78rem', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', whiteSpace: 'nowrap' }}
            onMouseEnter={e => hoverBg(e, true)} onMouseLeave={e => hoverBg(e, false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
              <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
            </svg>
            {!isNarrow && <span>{style.label}</span>}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7, transform: styleMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s' }} aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {styleMenuOpen && (
            <div role="menu" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 4, borderRadius: 10, minWidth: 132, background: isDark ? 'rgba(10,18,38,0.94)' : 'rgba(255,255,255,0.96)', boxShadow: '0 6px 20px rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}` }}>
              {MAP_STYLE_ORDER.filter(k => MAP_STYLES[k]).map((key) => {
                const active = key === styleKey;
                const def = MAP_STYLES[key];
                return (
                  <button key={key} role="menuitemradio" aria-checked={active} onClick={() => { setStyleKey(key); setStyleMenuOpen(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, cursor: 'pointer', border: 'none', textAlign: 'left', width: '100%', background: active ? (isDark ? 'rgba(99,102,241,0.30)' : 'rgba(99,102,241,0.14)') : 'transparent', color: active ? (isDark ? '#c7d2fe' : '#4338ca') : (isDark ? '#cbd5e1' : '#334155'), fontSize: '0.78rem', fontWeight: active ? 800 : 600, whiteSpace: 'nowrap' }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0, color: isDark ? '#818cf8' : '#6366f1' }}>
                      {active ? (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>) : null}
                    </span>
                    <span>{def.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Risk-area opacity slider (bottom-left) ── */}
      {mapObj && showOpacitySlider && (
        <div data-opacity-slider="true" {...stopMapEvents}
          style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 810, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', borderRadius: 10, maxWidth: 'calc(100% - 20px)', background: isDark ? 'rgba(10,18,38,0.82)' : 'rgba(255,255,255,0.86)', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isDark ? '#94a3b8' : '#475569', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {isNarrow ? 'Opacity' : 'Risk opacity'}
          </span>
          <input type="range" min={0} max={100} step={1} value={Math.round(overlayOpacity * 100)}
            onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)} aria-label="Risk area opacity"
            style={{ width: isNarrow ? 80 : 110, minWidth: 60, maxWidth: '40vw', accentColor: '#6366f1', cursor: 'pointer', touchAction: 'none' }} />
          <span style={{ fontSize: '0.7rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: isDark ? '#c7d2fe' : '#4338ca', minWidth: 32, textAlign: 'right', userSelect: 'none' }}>
            {Math.round(overlayOpacity * 100)}%
          </span>
        </div>
      )}

      <style>{`@keyframes tcmlspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
