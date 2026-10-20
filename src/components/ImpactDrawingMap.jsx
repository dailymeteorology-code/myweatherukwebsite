import React, { useRef, useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { Maximize2, Minimize2, Trash2, Pen, Check, Undo2, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const DRAW_COLORS = {
  Low: '#22c55e',
  SLGT: '#eab308',
  Moderate: '#f97316',
  High: '#ef4444',
  Severe: '#9333ea',
};

// Geo-anchored SVG overlay: re-projects stored lat/lng paths on every render.
// Also draws the in-progress click-to-place polygon (vertices + live outline).
function GeoShapesOverlay({ paths, draftLatLngs, color, containerRef, mapRef }) {
  const canvasRef = useRef(null);
  const map = useMap();

  useEffect(() => {
    if (mapRef) mapRef.current = map;
  }, [map, mapRef]);

  const syncSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
  }, [containerRef]);

  useEffect(() => {
    syncSize();
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, [syncSize]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const mapContainer = map.getContainer();
    const mapRect = mapContainer.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const offsetX = mapRect.left - canvasRect.left;
    const offsetY = mapRect.top - canvasRect.top;

    const latLngToCanvas = (lat, lng) => {
      const point = map.latLngToContainerPoint([lat, lng]);
      return { x: point.x + offsetX, y: point.y + offsetY };
    };

    const drawPolygon = (pts, col, closed = true) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      if (closed) ctx.closePath();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = col;
      if (closed) ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Saved, geo-anchored paths
    paths.forEach(path => {
      if (!path.latLngs || path.latLngs.length < 2) return;
      const screenPts = path.latLngs.map(([lat, lng]) => latLngToCanvas(lat, lng));
      drawPolygon(screenPts, path.color);
    });

    // In-progress draft (click-to-place). Show the filling area live + vertex dots.
    if (draftLatLngs && draftLatLngs.length > 0) {
      const pts = draftLatLngs.map(([lat, lng]) => latLngToCanvas(lat, lng));
      if (pts.length >= 2) {
        // dashed live outline; fill once there are 3+ points
        ctx.setLineDash([7, 5]);
        drawPolygon(pts, color, pts.length >= 3);
        ctx.setLineDash([]);
      }
      // vertex handles
      pts.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 ? 6 : 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      });
    }
  }, [paths, draftLatLngs, color, map]);

  useEffect(() => {
    if (!map) return;
    map.on('move', redraw);
    map.on('zoom', redraw);
    map.on('moveend', redraw);
    map.on('zoomend', redraw);
    return () => {
      map.off('move', redraw);
      map.off('zoom', redraw);
      map.off('moveend', redraw);
      map.off('zoomend', redraw);
    };
  }, [map, redraw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none', zIndex: 900 }}
    />
  );
}

// Keeps the SAME map instance alive across fullscreen toggles. When the
// container resizes we call invalidateSize() so Leaflet re-reads dimensions —
// this avoids remounting the map (which leaves an orphaned zoom-transition
// callback firing on a torn-down container → "_leaflet_pos" crash).
function ResizeHandler({ trigger, mapRef }) {
  const map = useMap();
  useEffect(() => {
    if (mapRef) mapRef.current = map;
  }, [map, mapRef]);
  useEffect(() => {
    if (!map) return;
    // Stop any in-flight zoom animation before resizing, then recalc size.
    const id = setTimeout(() => {
      try { map.stop(); map.invalidateSize({ animate: false }); } catch (_) {}
    }, 60);
    return () => clearTimeout(id);
  }, [trigger, map]);
  return null;
}

// Click-to-place capture: each tap/click drops a vertex. Map stays draggable
// when not drawing; while drawing we still allow the map click to register points.
function DrawingCapture({ isDrawingMode, onAddPoint, mapRef }) {
  const map = useMap();

  useEffect(() => {
    if (mapRef) mapRef.current = map;
  }, [map, mapRef]);

  useEffect(() => {
    if (!map) return;
    // While placing points, disable double-click zoom (we use single clicks),
    // but keep dragging enabled so the admin can pan between points.
    if (isDrawingMode) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
    return () => { try { map.doubleClickZoom.enable(); } catch (_) {} };
  }, [isDrawingMode, map]);

  useEffect(() => {
    if (!map || !isDrawingMode) return;
    const handleClick = (e) => { onAddPoint([e.latlng.lat, e.latlng.lng]); };
    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [map, isDrawingMode, onAddPoint]);

  return null;
}

export default function ImpactDrawingMap({ paths = [], onPathsChange, isOwner = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [currentColor, setCurrentColor] = useState(DRAW_COLORS.Low);
  const [draftLatLngs, setDraftLatLngs] = useState([]); // in-progress vertices

  const toggleFullscreen = () => setIsFullscreen(f => !f);

  const addPoint = useCallback((latlng) => {
    setDraftLatLngs(prev => [...prev, latlng]);
  }, []);

  const undoPoint = () => setDraftLatLngs(prev => prev.slice(0, -1));

  const finishArea = () => {
    if (draftLatLngs.length < 3) return;
    onPathsChange?.([...paths, { latLngs: draftLatLngs, color: currentColor }]);
    setDraftLatLngs([]);
    setIsDrawingMode(false);
  };

  const cancelDrawing = () => {
    setDraftLatLngs([]);
    setIsDrawingMode(false);
  };

  const startDrawing = () => {
    setDraftLatLngs([]);
    setIsDrawingMode(true);
  };

  const mapContainerClass = isFullscreen
    ? 'fixed inset-0 z-[9999] bg-slate-900'
    : 'relative w-full h-64 rounded-2xl overflow-hidden border border-slate-700';

  const ptCount = draftLatLngs.length;

  return (
    <div className={mapContainerClass}>
      <div ref={containerRef} className="relative w-full h-full">
        <MapContainer
          center={[54.5, -3.5]}
          zoom={5}
          style={{ width: '100%', height: isFullscreen ? '100vh' : '256px' }}
          zoomControl={true}
          dragging={true}
          scrollWheelZoom={true}
          doubleClickZoom={true}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
          />

          <ResizeHandler trigger={isFullscreen} mapRef={mapRef} />

          <GeoShapesOverlay
            paths={paths}
            draftLatLngs={draftLatLngs}
            color={currentColor}
            containerRef={containerRef}
            mapRef={mapRef}
          />

          {isOwner && (
            <DrawingCapture
              isDrawingMode={isDrawingMode}
              onAddPoint={addPoint}
              mapRef={mapRef}
            />
          )}
        </MapContainer>

        {/* Top-right controls */}
        <div className="absolute top-3 right-3 z-[1001] flex flex-col gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-2 bg-slate-900/90 backdrop-blur-sm rounded-lg border border-slate-600 text-white hover:bg-slate-700 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          {isOwner && !isDrawingMode && (
            <>
              <button
                onClick={startDrawing}
                title="Draw area"
                className="p-2 rounded-lg border text-white backdrop-blur-sm transition-colors bg-slate-900/90 border-slate-600 hover:bg-slate-700"
              >
                <Pen className="w-4 h-4" />
              </button>
              {paths.length > 0 && (
                <button
                  onClick={() => onPathsChange?.([])}
                  title="Clear all areas"
                  className="p-2 bg-red-600/80 backdrop-blur-sm rounded-lg border border-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Drawing action bar — Finish / Undo / Cancel while placing points */}
        {isOwner && isDrawingMode && (
          <div className="absolute top-3 right-3 z-[1001] flex flex-col gap-2 items-end">
            <button
              onClick={finishArea}
              disabled={ptCount < 3}
              title="Finish area"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-white backdrop-blur-sm text-xs font-bold transition-colors ${ptCount < 3 ? 'bg-slate-800/80 border-slate-700 opacity-50 cursor-not-allowed' : 'bg-emerald-600 border-emerald-500 hover:bg-emerald-500'}`}
            >
              <Check className="w-3.5 h-3.5" /> Finish ({ptCount})
            </button>
            <button
              onClick={undoPoint}
              disabled={ptCount === 0}
              title="Undo last point"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 text-white bg-slate-900/90 backdrop-blur-sm text-xs font-bold hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
            <button
              onClick={cancelDrawing}
              title="Cancel"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500 text-white bg-red-600/80 backdrop-blur-sm text-xs font-bold hover:bg-red-600 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        )}

        {/* Drawing color picker */}
        {isOwner && isDrawingMode && (
          <div className="absolute bottom-3 left-3 z-[1001] flex items-center gap-2 bg-slate-900/90 backdrop-blur-sm rounded-xl px-3 py-2 border border-slate-600">
            <span className="text-xs text-slate-400 mr-1">Colour:</span>
            {Object.entries(DRAW_COLORS).map(([label, col]) => (
              <button
                key={label}
                onClick={() => setCurrentColor(col)}
                title={label}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  currentColor === col ? 'scale-125 border-white' : 'border-slate-700'
                }`}
                style={{ backgroundColor: col }}
              />
            ))}
          </div>
        )}

        {/* Drawing hint */}
        {isDrawingMode && (
          <div className="absolute top-3 left-3 z-[1001] bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs text-sky-300 border border-sky-700 max-w-[60%]">
            {ptCount === 0
              ? 'Click a point on the map to start the area'
              : ptCount < 3
                ? `${ptCount} point${ptCount > 1 ? 's' : ''} — keep clicking to add more`
                : `${ptCount} points — keep adding, or press Finish`}
          </div>
        )}

        {/* Fullscreen close */}
        {isFullscreen && (
          <button
            onClick={toggleFullscreen}
            className="absolute top-4 left-4 z-[10000] bg-slate-900/90 backdrop-blur-sm rounded-xl px-4 py-2 text-sm text-white border border-slate-600 hover:bg-slate-800 flex items-center gap-2 transition-colors"
          >
            <Minimize2 className="w-4 h-4" /> Exit Fullscreen
          </button>
        )}
      </div>
    </div>
  );
}