/**
 * TemperatureMapTool
 *
 * Interactive Met-Office-style temperature map.
 * - Leaflet base map you can pan & zoom freely.
 * - A coloured temperature field (smooth interpolated heat surface) drawn from
 *   live Open-Meteo current temperatures sampled on a grid. Grid resolution
 *   increases as you zoom in (finer sampling) and stays coarse-but-smooth when
 *   zoomed out — so detail scales with zoom but the surface always looks high-res.
 * - Temperature boxes float above UK/Ireland cities. More cities appear as you
 *   zoom in; fewer when zoomed out (so labels never overcrowd).
 *
 * Open-Meteo is free and needs no key.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Thermometer, RefreshCw, Download } from 'lucide-react';
import { CITY_DB } from '@/components/tcm/cityDB';
import { StudioStyles, Btn } from '@/components/studio/StudioUI';

// UK & Ireland cities only, ranked by rough prominence (earlier = more major).
// The list order in CITY_DB roughly follows population for the UK section.
const UK_COUNTRIES = ['England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland'];
const UK_CITIES = CITY_DB
  .filter(c => UK_COUNTRIES.includes(c.country))
  .map((c, i) => ({ ...c, rank: i }));

// ─── Met Office temperature colour scale (°C → colour) ─────────────────────
const TEMP_STOPS = [
  { t: -10, c: [69, 0, 132] },    // deep purple
  { t: -5,  c: [40, 40, 160] },   // indigo
  { t: 0,   c: [40, 110, 200] },  // blue
  { t: 5,   c: [70, 170, 220] },  // light blue
  { t: 10,  c: [120, 200, 170] }, // teal-green
  { t: 13,  c: [180, 220, 120] }, // yellow-green
  { t: 16,  c: [240, 230, 110] }, // yellow
  { t: 20,  c: [250, 190, 70] },  // amber
  { t: 24,  c: [245, 140, 50] },  // orange
  { t: 28,  c: [230, 80, 40] },   // red-orange
  { t: 32,  c: [200, 30, 30] },   // red
  { t: 38,  c: [140, 10, 30] },   // dark red
];

function tempToRGB(t) {
  if (t <= TEMP_STOPS[0].t) return TEMP_STOPS[0].c;
  if (t >= TEMP_STOPS[TEMP_STOPS.length - 1].t) return TEMP_STOPS[TEMP_STOPS.length - 1].c;
  for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
    const a = TEMP_STOPS[i], b = TEMP_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * f),
      ];
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1].c;
}

// ─── Leaflet loader (shared pattern with the rest of the app) ──────────────
let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.body.appendChild(script);
  });
  return leafletPromise;
}

// Sample grid step (degrees) based on zoom — finer when zoomed in.
function gridStepForZoom(z) {
  if (z >= 9) return 0.12;
  if (z >= 8) return 0.2;
  if (z >= 7) return 0.32;
  if (z >= 6) return 0.5;
  return 0.75;
}
// How many city labels to show based on zoom — always shows a sensible set,
// more as you zoom in, fewer (but never zero) as you zoom out.
function cityCountForZoom(z) {
  if (z >= 10) return 140;
  if (z >= 9) return 100;
  if (z >= 8) return 65;
  if (z >= 7) return 40;
  if (z >= 6) return 24;
  if (z >= 5) return 14;
  return 8;
}

// IDW interpolation for smooth surface
function idw(lat, lon, samples) {
  let num = 0, den = 0;
  for (const s of samples) {
    const dLat = lat - s.lat, dLon = (lon - s.lon) * Math.cos(lat * Math.PI / 180);
    let d2 = dLat * dLat + dLon * dLon;
    if (d2 < 1e-7) return s.t;
    const w = 1 / (d2 * d2); // power 4 — sharper, more local detail
    num += w * s.t; den += w;
  }
  return den ? num / den : null;
}

export default function TemperatureMapTool() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const canvasLayerRef = useRef(null);
  const markersRef = useRef([]);
  const samplesRef = useRef([]);
  const [loading, setLoading] = useState(true);
  const [fetchingTemps, setFetchingTemps] = useState(false);
  const [, setZoom] = useState(6);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [exporting, setExporting] = useState(false);

  // ── Fetch live temps on a grid covering the current view ────────────────
  const fetchTempsForView = useCallback(async (map) => {
    const b = map.getBounds();
    const z = map.getZoom();
    const step = gridStepForZoom(z);
    const latMin = b.getSouth(), latMax = b.getNorth();
    const lonMin = b.getWest(), lonMax = b.getEast();

    const lats = [], lons = [];
    for (let la = latMin; la <= latMax; la += step) {
      for (let lo = lonMin; lo <= lonMax; lo += step) {
        lats.push(+la.toFixed(3)); lons.push(+lo.toFixed(3));
      }
    }
    // Cap the number of points to keep the API URL/response sane.
    const MAX = 220;
    let gridLats = lats, gridLons = lons;
    if (lats.length > MAX) {
      const stride = Math.ceil(lats.length / MAX);
      gridLats = lats.filter((_, i) => i % stride === 0);
      gridLons = lons.filter((_, i) => i % stride === 0);
    }
    if (!gridLats.length) return;

    setFetchingTemps(true);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${gridLats.join(',')}&longitude=${gridLons.join(',')}&current=temperature_2m`;
      const res = await fetch(url);
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [data];
      const samples = [];
      arr.forEach((d, i) => {
        const t = d?.current?.temperature_2m;
        if (typeof t === 'number') samples.push({ lat: gridLats[i], lon: gridLons[i], t });
      });
      samplesRef.current = samples;
      setUpdatedAt(new Date());
      drawTempField(map, samples);
      drawCityBoxes(map, samples);
    } catch (e) {
      console.warn('Open-Meteo fetch failed', e);
    } finally {
      setFetchingTemps(false);
    }
  }, []);

  // ── Draw the coloured temperature surface to a canvas overlay ───────────
  const drawTempField = useCallback((map, samples) => {
    const L = window.L;
    if (!samples.length) return;
    const size = map.getSize();
    const canvas = canvasLayerRef.current?._canvas;
    if (!canvas) return;
    canvas.width = size.x;
    canvas.height = size.y;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);

    // Render at low res then upscale (smooth, fast).
    const RES = 3; // pixels per cell before upscale
    const w = Math.ceil(size.x / RES), h = Math.ceil(size.y / RES);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    const img = octx.createImageData(w, h);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const pt = L.point(px * RES, py * RES);
        const ll = map.containerPointToLatLng(pt);
        const t = idw(ll.lat, ll.lng, samples);
        const idx = (py * w + px) * 4;
        if (t == null) { img.data[idx + 3] = 0; continue; }
        const [r, g, bl] = tempToRGB(t);
        img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = bl;
        img.data[idx + 3] = 150; // semi-transparent so map shows through
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, w, h, 0, 0, size.x, size.y);
  }, []);

  // ── Draw the temperature boxes above cities ─────────────────────────────
  const drawCityBoxes = useCallback((map, samples) => {
    const L = window.L;
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    const z = map.getZoom();
    const b = map.getBounds();
    const limit = cityCountForZoom(z);

    const visible = UK_CITIES
      .filter(c => b.contains([c.lat, c.lon]))
      .sort((a, bb) => a.rank - bb.rank)
      .slice(0, limit);

    for (const c of visible) {
      const t = idw(c.lat, c.lon, samples);
      if (t == null) continue;
      const [r, g, bl] = tempToRGB(t);
      const rounded = Math.round(t);
      const textColor = (0.299 * r + 0.587 * g + 0.114 * bl) > 150 ? '#0a0e1a' : '#ffffff';
      const html = `
        <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);font-family:'Archivo','DM Sans',sans-serif;">
          <div style="background:rgb(${r},${g},${bl});color:${textColor};font-weight:900;font-size:14px;line-height:1;
            padding:4px 7px;border-radius:7px;border:1.5px solid rgba(255,255,255,0.9);
            box-shadow:0 2px 6px rgba(0,0,0,0.4);white-space:nowrap;">${rounded}°</div>
          <div style="font-size:9px;font-weight:700;color:#fff;margin-top:2px;
            text-shadow:0 1px 3px rgba(0,0,0,0.9),0 0 4px rgba(0,0,0,0.7);white-space:nowrap;">${c.name}</div>
          <div style="width:6px;height:6px;border-radius:50%;background:#fff;border:1.5px solid rgba(0,0,0,0.5);margin-top:2px;"></div>
        </div>`;
      const icon = L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] });
      const marker = L.marker([c.lat, c.lon], { icon, interactive: false }).addTo(map);
      markersRef.current.push(marker);
    }
  }, []);

  // ── Init map ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !mapElRef.current || mapRef.current) return;
      const map = L.map(mapElRef.current, {
        center: [54.5, -3.0],
        zoom: 6,
        minZoom: 4,
        maxZoom: 10,
        zoomControl: true,
        attributionControl: false,
      });
      mapRef.current = map;

      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
      }).addTo(map);

      // Canvas overlay pinned to the map pane
      const CanvasOverlay = L.Layer.extend({
        onAdd: function (m) {
          const canvas = L.DomUtil.create('canvas', 'leaflet-temp-canvas');
          canvas.style.position = 'absolute';
          canvas.style.pointerEvents = 'none';
          canvas.style.zIndex = 200;
          this._canvas = canvas;
          m.getPanes().overlayPane.appendChild(canvas);
          m.on('move zoom viewreset', this._reposition, this);
          this._reposition();
        },
        onRemove: function (m) {
          m.off('move zoom viewreset', this._reposition, this);
          if (this._canvas && this._canvas.parentNode) {
            this._canvas.parentNode.removeChild(this._canvas);
          }
          this._canvas = null;
        },
        _reposition: function () {
          const m = mapRef.current; if (!m || !this._canvas) return;
          const topLeft = m.containerPointToLayerPoint([0, 0]);
          L.DomUtil.setPosition(this._canvas, topLeft);
          if (samplesRef.current.length) drawTempField(m, samplesRef.current);
        },
      });
      const overlay = new CanvasOverlay();
      overlay.addTo(map);
      canvasLayerRef.current = overlay;

      const onIdle = () => {
        setZoom(map.getZoom());
        fetchTempsForView(map);
      };
      map.on('moveend zoomend', onIdle);

      setLoading(false);
      // Fix sizing then first load
      setTimeout(() => { map.invalidateSize(); fetchTempsForView(map); }, 200);
    });

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [fetchTempsForView, drawTempField]);

  const refresh = () => { if (mapRef.current) fetchTempsForView(mapRef.current); };

  // ── Export the EXACT current view as a PNG ──────────────────────────────
  // We redraw to a clean canvas (dark basemap + temp surface + city boxes +
  // header + key) rather than html2canvas, which mangles Leaflet tiles.
  const downloadPNG = useCallback(async () => {
    const map = mapRef.current, L = window.L;
    const samples = samplesRef.current;
    if (!map || !L || !samples.length) return;
    setExporting(true);
    try {
      const SC = 2; // export scale for crispness
      const size = map.getSize();
      const W = size.x, H = size.y;
      const cv = document.createElement('canvas');
      cv.width = W * SC; cv.height = H * SC;
      const ctx = cv.getContext('2d');
      ctx.scale(SC, SC);

      // 1. Dark basemap background
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, W, H);

      // 2. Temperature surface (same IDW field as on screen)
      const RES = 3;
      const w = Math.ceil(W / RES), h = Math.ceil(H / RES);
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      const img = octx.createImageData(w, h);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const ll = map.containerPointToLatLng(L.point(px * RES, py * RES));
          const t = idw(ll.lat, ll.lng, samples);
          const idx = (py * w + px) * 4;
          if (t == null) { img.data[idx + 3] = 0; continue; }
          const [r, g, bl] = tempToRGB(t);
          img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = bl;
          img.data[idx + 3] = 210;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, w, h, 0, 0, W, H);

      // 3. City boxes (exactly the visible set)
      const z = map.getZoom(), b = map.getBounds();
      const visible = UK_CITIES
        .filter(c => b.contains([c.lat, c.lon]))
        .sort((a, bb) => a.rank - bb.rank)
        .slice(0, cityCountForZoom(z));
      ctx.textAlign = 'center';
      for (const c of visible) {
        const t = idw(c.lat, c.lon, samples);
        if (t == null) continue;
        const pt = map.latLngToContainerPoint([c.lat, c.lon]);
        const [r, g, bl] = tempToRGB(t);
        const rounded = Math.round(t);
        const textColor = (0.299 * r + 0.587 * g + 0.114 * bl) > 150 ? '#0a0e1a' : '#ffffff';
        const label = `${rounded}°`;
        ctx.font = '900 14px Archivo, sans-serif';
        const tw = ctx.measureText(label).width;
        const padX = 7, boxW = tw + padX * 2, boxH = 20;
        const bx = pt.x - boxW / 2, by = pt.y - boxH - 14;
        // pill
        ctx.fillStyle = `rgb(${r},${g},${bl})`;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        const rad = 7;
        ctx.beginPath();
        ctx.moveTo(bx + rad, by);
        ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, rad);
        ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, rad);
        ctx.arcTo(bx, by + boxH, bx, by, rad);
        ctx.arcTo(bx, by, bx + boxW, by, rad);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.fillText(label, pt.x, by + 14);
        // name
        ctx.font = '700 9px Archivo, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
        ctx.fillText(c.name, pt.x, by + boxH + 11);
        ctx.shadowBlur = 0;
        // dot
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      }

      // 4. Top accent bar
      const barGrad = ctx.createLinearGradient(0, 0, W, 0);
      barGrad.addColorStop(0, '#38bdf8'); barGrad.addColorStop(0.5, '#f59e0b'); barGrad.addColorStop(1, '#ef4444');
      ctx.fillStyle = barGrad;
      ctx.fillRect(0, 0, W, 4);

      // 5. Header card
      const roundRect = (x, y, ww, hh, rr) => {
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + ww, y, x + ww, y + hh, rr);
        ctx.arcTo(x + ww, y + hh, x, y + hh, rr);
        ctx.arcTo(x, y + hh, x, y, rr);
        ctx.arcTo(x, y, x + ww, y, rr);
        ctx.closePath();
      };
      const hX = 16, hY = 16, hW = 330, hH = 78;
      ctx.fillStyle = 'rgba(10,14,26,0.86)';
      roundRect(hX, hY, hW, hH, 14); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
      // icon square
      ctx.fillStyle = 'rgba(245,158,11,0.16)';
      roundRect(hX + 12, hY + 18, 42, 42, 11); ctx.fill();
      ctx.strokeStyle = 'rgba(245,158,11,0.4)'; ctx.stroke();
      ctx.fillStyle = '#fbbf24'; ctx.font = '800 22px Archivo, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('°', hX + 33, hY + 47);
      // texts
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(251,191,36,0.95)'; ctx.font = '800 9px Archivo, sans-serif';
      ctx.fillText('MYWEATHERUK · LIVE TEMPERATURES', hX + 64, hY + 18);
      ctx.fillStyle = '#ffffff'; ctx.font = '800 24px Archivo, sans-serif';
      ctx.fillText('TEMPERATURE MAP', hX + 64, hY + 45);
      ctx.fillStyle = 'rgba(226,232,240,0.85)'; ctx.font = '700 11px Archivo, sans-serif';
      const hdrDate = `${dateLabel}${updatedAt ? ` · ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`;
      ctx.fillText(hdrDate, hX + 64, hY + 64);
      ctx.textAlign = 'center';

      // 6. Colour key (bottom-left)
      const kW = Math.min(420, W - 32), kX = 16, kH = 50, kY = H - kH - 16;
      ctx.fillStyle = 'rgba(10,14,26,0.86)';
      roundRect(kX, kY, kW, kH, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#cbd5e1'; ctx.font = '800 9.5px Archivo, sans-serif';
      ctx.fillText('TEMPERATURE KEY · °C', kX + 14, kY + 16);
      // gradient bar
      const gbX = kX + 14, gbY = kY + 22, gbW = kW - 28, gbH = 13;
      const keyGrad = ctx.createLinearGradient(gbX, 0, gbX + gbW, 0);
      TEMP_STOPS.forEach((s, i) => keyGrad.addColorStop(i / (TEMP_STOPS.length - 1), `rgb(${s.c[0]},${s.c[1]},${s.c[2]})`));
      ctx.fillStyle = keyGrad; ctx.fillRect(gbX, gbY, gbW, gbH);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.strokeRect(gbX, gbY, gbW, gbH);
      // ticks
      ctx.fillStyle = '#e2e8f0'; ctx.font = '700 9px Archivo, sans-serif';
      const ticks = [-10, 0, 10, 16, 24, 32, 38];
      ticks.forEach((v, i) => {
        const tx = gbX + (gbW * i) / (ticks.length - 1);
        ctx.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center';
        ctx.fillText(`${v}°`, tx, gbY + gbH + 11);
      });

      // Download
      const link = document.createElement('a');
      link.download = `temperature-map-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = cv.toDataURL('image/png');
      link.click();
    } finally {
      setExporting(false);
    }
  }, [updatedAt]);

  const gradientCss = `linear-gradient(90deg, ${TEMP_STOPS.map(s => `rgb(${s.c[0]},${s.c[1]},${s.c[2]})`).join(',')})`;
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="sg" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StudioStyles />
      {/* Toolbar */}
      <div className="sg-toolbar" style={{ padding: '10px 12px' }}>
        <span className="sg-sec-icon" style={{ '--c': '#f59e0b' }}><Thermometer /></span>
        <span className="sg-sec-title" style={{ flex: 1 }}>
          <b>Live Temperature Map</b>
          <small>Pan & zoom · {dateLabel}{updatedAt ? ` · ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</small>
        </span>
        <Btn sm icon={fetchingTemps ? Loader2 : RefreshCw} onClick={refresh}>Refresh</Btn>
        <Btn sm primary color="#0284c7" icon={exporting ? Loader2 : Download} disabled={exporting || loading} onClick={downloadPNG}>{exporting ? 'Generating…' : 'Download PNG'}</Btn>
      </div>

      {/* Map — styled like the other graphics with a branded title header */}
      <div style={{
        position: 'relative', borderRadius: 18, overflow: 'hidden',
        border: '1px solid rgba(148,163,184,0.15)',
        fontFamily: "'Archivo','DM Sans',system-ui,sans-serif",
        width: 'min(100%, 800px)', margin: '0 auto',
      }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a' }}>
            <Loader2 style={{ width: 26, height: 26, color: '#f59e0b', animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        <div ref={mapElRef} style={{ width: '100%', aspectRatio: '800/640', background: '#0a0e1a' }} />

        {/* Top accent bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4, zIndex: 550, pointerEvents: 'none',
          background: 'linear-gradient(90deg, #38bdf8, #f59e0b, #ef4444)',
        }} />

        {/* Title header overlay */}
        <div style={{
          position: 'absolute', top: 16, left: 16, zIndex: 550, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 13,
          background: 'rgba(10,14,26,0.88)', backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          borderRadius: 16, padding: '12px 18px', border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>
          {/* Glass sheen */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent)',
            borderRadius: '16px 16px 0 0', pointerEvents: 'none',
          }} />
          <div style={{
            width: 44, height: 44, borderRadius: 13, flexShrink: 0, position: 'relative', zIndex: 1,
            background: 'rgba(245,158,11,0.16)',
            border: '1px solid rgba(245,158,11,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Thermometer style={{ width: 23, height: 23, color: '#fbbf24' }} strokeWidth={2} />
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(251,191,36,0.95)' }}>MyWeatherUK</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#fbbf24', opacity: 0.7 }} />
              <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(226,232,240,0.60)' }}>Live</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1, textTransform: 'uppercase', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
              Temperature Map
            </h2>
            <p style={{ margin: '5px 0 0', fontSize: 11, fontWeight: 700, color: 'rgba(226,232,240,0.80)', letterSpacing: '0.03em' }}>
              {dateLabel}{updatedAt ? ` · ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          </div>
        </div>

        {/* Temperature colour key */}
        <div style={{
          position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 550, pointerEvents: 'none',
          maxWidth: 420,
          background: 'rgba(10,14,26,0.88)', backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          borderRadius: 14, padding: '12px 16px', border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent)',
            borderRadius: '14px 14px 0 0', pointerEvents: 'none',
          }} />
          <p style={{ margin: '0 0 8px', fontSize: 9, fontWeight: 800, letterSpacing: '0.20em', color: '#cbd5e1', textTransform: 'uppercase', position: 'relative', zIndex: 1 }}>
            Temperature Key · °C
          </p>
          <div style={{ height: 16, borderRadius: 6, background: gradientCss, border: '1px solid rgba(255,255,255,0.22)', position: 'relative', zIndex: 1 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, position: 'relative', zIndex: 1 }}>
            {[-10, 0, 10, 16, 24, 32, 38].map(v => (
              <span key={v} style={{ fontSize: 9.5, fontWeight: 700, color: '#e2e8f0' }}>{v}°</span>
            ))}
          </div>
        </div>
      </div>

      <p className="sg-note" style={{ textAlign: 'center' }}>
        Pan and zoom freely — city temperatures scale with view. More detail as you zoom in. Live data from Open-Meteo.
      </p>

    </div>
  );
}