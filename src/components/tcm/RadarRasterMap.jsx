// RadarRasterMap — unified precipitation + hail radar for the TCM Outlooks
// page.  Renders a high-resolution, band-stepped raster that looks like an
// actual weather-radar product rather than filled risk polygons.
//
// Data source: the Open-Meteo ensemble grid already fetched for the TCM run.
// For every hourly step we combine two proxy fields:
//
//   • RAIN RATE (mm/hr) — stratiform background (wide, soft) boosted where the
//     thunderstorm score signals convective cores, so active cells push up
//     the reflectivity palette into the heavy/extreme bands just like real
//     radar echoes.
//   • HAIL DIAMETER (mm) — rebuilt from the hail score, CAPE, freezing level
//     and dry-aloft index.  Hail cores are painted in their OWN cool→hot palette
//     on top of the rain so a single map shows both hazards at once.
//
// Rendering pipeline (mirrors the temperature map's approach):
//   1. IDW interpolation of each field onto a low-res grid (coords encoded).
//   2. Bilinear upscale to a high-res canvas, then per-pixel banding — sharp
//      filled-contour steps (5 dBZ for rain, hail thresholds for hail) which is
//      exactly the "stepped" look of real radar displays.
//   3. Hail overlay composited over the rain.
//   4. Clipped to the real UK & Ireland coastline.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Play, Pause, SkipBack, Gauge, ChevronLeft, ChevronRight } from 'lucide-react';
import TCMLeafletBase from '@/components/tcm/TCMLeafletBase';
import {
  NWS_RADAR_PALETTE,
  HAIL_RADAR_PALETTE,
} from '@/components/tcm/tcmEngine';

// ── Speed presets (ms per frame) ────────────────────────────────────────────
const SPEEDS = [
  { label: '0.5×', ms: 2200 },
  { label: '1×',   ms: 1100 },
  { label: '2×',   ms:  550 },
  { label: '4×',   ms:  275 },
];

// ── Rain proxies ─────────────────────────────────────────────────────────────
// Stratiform background — wide and soft, only paints the lighter bands.
function stratiformRainRate(metrics) {
  if (!metrics) return 0;
  const raw = metrics.precip ?? metrics.rain ?? 0;
  if (raw <= 0) return 0;
  return Math.min(raw * 1.6, 3.0);
}
// Convective cores — boosted by thunderstorm score + CAPE so active cells
// reach the heavy / very-heavy / extreme bands.
function convectiveRainRate(metrics, scores) {
  if (!metrics) return 0;
  const raw = metrics.precip ?? metrics.rain ?? 0;
  if (raw <= 0) return 0;
  const tsScore  = scores?.thunderstorm ?? 0;
  const capeNorm = Math.min(1, (metrics.cape ?? 0) / 1400);
  const mult = 1 + Math.min(8, (tsScore / 100) * 7 + capeNorm * 2);
  return raw * mult;
}

// ── Hail diameter proxy (mm) ─────────────────────────────────────────────────
// perStep metrics do not carry hailMm (only perDay.ranges does). Reconstruct
// from hail score, freezing level, CAPE and wet-bulb spread.
function derivedHailMm(metrics, scores) {
  const hailScore = scores?.hail ?? scores?.sub?.hail ?? 0;
  if (hailScore < 12) return 0;
  const cape      = metrics?.cape ?? 0;
  const freezeLvl = metrics?.freezingLvl ?? 2500;
  const wbSpread  = (metrics?.wbSpread ?? 50) / 100;
  if (cape < 100) return 0;
  let mm = (hailScore / 100) * 50;
  const freezePenalty = Math.max(0, Math.min(1, (freezeLvl - 1500) / 2500));
  mm *= (1 - freezePenalty * 0.55);
  mm *= (1 + wbSpread * 0.3);
  mm *= (1 + Math.min(0.5, (cape - 200) / 1600));
  return Math.max(0, Math.min(80, Math.round(mm * 2) / 2));
}

// Marshall–Palmer: rain rate (mm/hr) → dBZ.  Used so reflectivity equals what
// a real radar would see for the model rain rate.
function rateToDBZ(mmPerHour) {
  if (!mmPerHour || mmPerHour <= 0) return 0;
  const Z = 200 * Math.pow(mmPerHour, 1.6);
  return 10 * Math.log10(Math.max(Z, 1));
}

// ── Colour lookups ───────────────────────────────────────────────────────────
// Pre-compute RGB + alpha from each palette colour so per-pixel work is cheap.
function hexToRgba(h, alpha = 255) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}
function parseFill(fill) {
  // rgba(r,g,b,a) → [r,g,b,a]
  const m = fill.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return [parts[0], parts[1], parts[2], Math.round((parts[3] ?? 1) * 255)];
  }
  return hexToRgba(fill);
}

// Rain band LUT: dBZ → [r,g,b,a] (stepped).  NWS palette thresholds are dBZ.
const RAIN_LUT = (() => {
  const out = [];
  for (const b of NWS_RADAR_PALETTE) {
    const [r, g, bl, a] = parseFill(b.fill);
    out.push({ dbz: b.dbz, mmHr: b.mmHr, rgb: [r, g, bl], a });
  }
  return out;
})();
function rainBand(dBZ) {
  if (dBZ < RAIN_LUT[0].dbz) return null;
  let band = RAIN_LUT[0];
  for (const b of RAIN_LUT) { if (dBZ >= b.dbz) band = b; else break; }
  return band;
}

// Hail band LUT: mm → [r,g,b,a]
const HAIL_LUT = (() => {
  const out = [];
  for (const b of HAIL_RADAR_PALETTE) {
    const [r, g, bl, a] = parseFill(b.fill);
    out.push({ mm: b.mm, rgb: [r, g, bl], a });
  }
  return out;
})();
function hailBand(mm) {
  if (mm < HAIL_LUT[0].mm) return null;
  let band = HAIL_LUT[0];
  for (const b of HAIL_LUT) { if (mm >= b.mm) band = b; else break; }
  return band;
}

// Coarse coastline is loaded lazily from the UK county polygons so the raster
// is clipped beautifully to the land mass — same source the temperature map
// uses.
let _coastlinePromise = null;
function loadCoastline() {
  if (_coastlinePromise) return _coastlinePromise;
  _coastlinePromise = import('@/components/tcm/ukIrelandMask')
    .then((m) => m.UK_IRELAND_COUNTIES)
    .catch(() => null);
  return _coastlinePromise;
}

export default function RadarRasterMap({
  data, region, run, REGIONS,
  TOTAL_STEPS = 32, STEPS_PER_DAY = 8,
  dayIdx = 0,
  onInspect,
  pin = null,
  enableSearch = false,
  enableLocate = false,
  enableFullscreen = false,
  captureRef,
  useTCMTheme,
  stepLabel,
  regionLabel,
}) {
  const { lightMode } = useTCMTheme();
  const [playing, setPlaying]   = useState(true);
  const [step, setStep]         = useState(0);
  const [speedIdx, setSpeedIdx] = useState(1);
  const intervalRef             = useRef(null);

  const bbox     = REGIONS[region].bbox;
  const grid      = data?.grid ?? [];

  // ── Animation loop ──────────────────────────────────────────────────────────
  const advanceStep = useCallback(
    () => setStep((s) => (s + 1) % TOTAL_STEPS),
    [TOTAL_STEPS]
  );
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!playing) return;
    intervalRef.current = setInterval(advanceStep, SPEEDS[speedIdx].ms);
    return () => clearInterval(intervalRef.current);
  }, [playing, speedIdx, advanceStep]);

  const [coastline, setCoastline] = useState(null);
  useEffect(() => { loadCoastline().then(setCoastline); }, []);

  // ── Source points for the current step ──────────────────────────────────────
  const pts = useMemo(() => {
    if (!grid.length) return [];
    const out = [];
    for (const p of grid) {
      if (p.lat < bbox.latMin - 1.2 || p.lat > bbox.latMax + 1.2) continue;
      if (p.lon < bbox.lonMin - 1.2 || p.lon > bbox.lonMax + 1.2) continue;
      const sd     = p.perStep?.[step];
      const day    = Math.floor(step / STEPS_PER_DAY);
      const scores = sd?.scores ?? p.perDay?.[day]?.scores ?? {};
      const m      = scores?.metrics ?? p.perDay?.[day]?.scores?.metrics ?? {};
      let rain = stratiformRainRate(m);
      const ts = scores?.thunderstorm ?? 0;
      if (ts >= 15) rain = Math.max(rain, convectiveRainRate(m, scores));
      const hail = derivedHailMm(m, scores);
      if (rain < 0.05 && hail < 1) continue;
      out.push({ lat: p.lat, lon: p.lon, rain, hail, dbz: rateToDBZ(rain) });
    }
    return out;
  }, [grid, step, bbox, STEPS_PER_DAY]);

  // ── Raster (high-res, band-stepped) ──────────────────────────────────────────
  const raster = useMemo(() => {
    if (typeof document === 'undefined' || !bbox || pts.length < 3) return null;
    const rad = Math.PI / 180;
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));
    const yTop = mercY(bbox.latMax), yBot = mercY(bbox.latMin);
    const lonMin = bbox.lonMin, lonSpan = bbox.lonMax - bbox.lonMin;
    const aspect = (yTop - yBot) / (lonSpan * rad);

    const N = pts.length;
    const PLat = new Float64Array(N), PLon = new Float64Array(N);
    const PRain = new Float64Array(N), PHail = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      PLat[i] = pts[i].lat; PLon[i] = pts[i].lon;
      PRain[i] = pts[i].rain; PHail[i] = pts[i].hail;
    }
    const lonK = Math.cos(((bbox.latMin + bbox.latMax) / 2) * rad);
    const smooth2 = 0.08;

    // ── Pass 1: low-res IDW of RAIN (encoded dBZ) and HAIL (encoded mm) ───────
    const loW = 220;
    const loH = Math.max(130, Math.min(520, Math.round(loW * aspect)));
    let loC; try { loC = document.createElement('canvas'); } catch { return null; }
    loC.width = loW; loC.height = loH;
    const loCtx = loC.getContext('2d'); if (!loCtx) return null;
    const loImg = loCtx.createImageData(loW, loH), lod = loImg.data;
    // Encode dBZ into red channel (0..255 over 0..70 dBZ), hail mm into green
    // channel (0..255 over 0..80 mm), and a "has precip" mask into alpha.
    for (let py = 0; py < loH; py++) {
      const mY = yTop - ((py + 0.5) / loH) * (yTop - yBot);
      const lat = (2 * Math.atan(Math.exp(mY)) - Math.PI / 2) / rad;
      for (let px = 0; px < loW; px++) {
        const lon = lonMin + ((px + 0.5) / loW) * lonSpan;
        let sw = 0, svRain = 0, svHail = 0;
        for (let i = 0; i < N; i++) {
          const dlat = PLat[i] - lat, dlon = (PLon[i] - lon) * lonK;
          const w = 1 / (dlat * dlat + dlon * dlon + smooth2);
          sw += w; svRain += w * PRain[i]; svHail += w * PHail[i];
        }
        const rain = svRain / sw; const hail = svHail / sw;
        const dbz = rateToDBZ(rain);
        const encDbz = Math.max(0, Math.min(255, Math.round((dbz / 70) * 255)));
        const encHail = Math.max(0, Math.min(255, Math.round((hail / 80) * 255)));
        const k = (py * loW + px) * 4;
        lod[k] = encDbz; lod[k + 1] = encHail; lod[k + 2] = 0;
        lod[k + 3] = (rain >= 0.1 || hail >= 2) ? 255 : 0;
      }
    }
    loCtx.putImageData(loImg, 0, 0);

    // ── Pass 2: hi-res bilinear upscale, then band-step each pixel ───────────
    const hiW = 760;
    const hiH = Math.max(220, Math.round(hiW * aspect));
    let hiC; try { hiC = document.createElement('canvas'); } catch { return null; }
    hiC.width = hiW; hiC.height = hiH;
    const hiCtx = hiC.getContext('2d'); if (!hiCtx) return null;
    hiCtx.imageSmoothingEnabled = true; hiCtx.imageSmoothingQuality = 'high';
    hiCtx.drawImage(loC, 0, 0, loW, loH, 0, 0, hiW, hiH);
    // Re-snap the DATABASE into a 5-dBZ staircase so the radar looks stepped.
    const BAND_DBZ = 5;
    const hiImg = hiCtx.getImageData(0, 0, hiW, hiH), hid = hiImg.data;
    for (let k = 0; k < hid.length; k += 4) {
      const dbz = (hid[k] / 255) * 70;
      const hail = (hid[k + 1] / 255) * 80;
      const aFrac = hid[k + 3] / 255;            // feather from the bilinear upscale
      // Default fully transparent — let the basemap show through.
      hid[k] = 0; hid[k + 1] = 0; hid[k + 2] = 0; hid[k + 3] = 0;
      if (aFrac >= 0.08) {
        const steppedDbz = Math.floor(dbz / BAND_DBZ) * BAND_DBZ;
        const rband = rainBand(steppedDbz);
        if (rband) {
          // Lightrain alpha falloff so trace/drizzle are translucent.
          const baseA = steppedDbz < 15 ? rband.a * 0.55 : (steppedDbz < 25 ? rband.a * 0.82 : rband.a);
          hid[k] = rband.rgb[0]; hid[k + 1] = rband.rgb[1]; hid[k + 2] = rband.rgb[2];
          hid[k + 3] = Math.min(255, Math.round(baseA * aFrac));
        }
        // Hail overlay — paint using its own cool→hot palette where hail is
        // notable (>= "Pea" size).  Anything below stays as rain echo.
        if (hail >= 8) {
          const hband = hailBand(hail);
          if (hband) {
            hid[k] = hband.rgb[0]; hid[k + 1] = hband.rgb[1]; hid[k + 2] = hband.rgb[2];
            hid[k + 3] = Math.min(255, Math.round(hband.a * aFrac));
          }
        }
      }
    }
    hiCtx.putImageData(hiImg, 0, 0);

    // ── Coastline clip — erase everything off the land mass ──────────────────
    if (coastline) {
      const projC = (lat, lon) => [
        ((lon - lonMin) / lonSpan) * hiW,
        ((yTop - mercY(lat)) / (yTop - yBot)) * hiH,
      ];
      const land = new Path2D();
      const addRing = (ring) => {
        for (let i = 0; i < ring.length; i++) {
          const [lo, la] = ring[i];
          const [x, y] = projC(la, lo);
          if (i === 0) land.moveTo(x, y); else land.lineTo(x, y);
        }
        land.closePath();
      };
      for (const f of (coastline?.features || [])) {
        const g = f.geometry; if (!g) continue;
        if (g.type === 'Polygon') for (const ring of g.coordinates) addRing(ring);
        else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const ring of poly) addRing(ring);
      }
      hiCtx.globalCompositeOperation = 'destination-in';
      hiCtx.fill(land, 'nonzero');
      hiCtx.globalCompositeOperation = 'source-over';
      hiCtx.lineJoin = 'round'; hiCtx.lineWidth = 0.9;
      hiCtx.strokeStyle = 'rgba(255,255,255,0.55)';
      hiCtx.stroke(land);
    }
    try { return { url: hiC.toDataURL('image/png') }; } catch { return null; }
  }, [pts, bbox, coastline]);

  // ── Stats for current step ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!pts.length) return { peakDbz: 0, peakRate: 0, peakHail: 0, cov: 0 };
    let peakDbz = 0, peakHail = 0, active = 0;
    for (const p of pts) {
      if (p.rain >= 0.5) active++;
      if (p.dbz > peakDbz) peakDbz = p.dbz;
      if (p.hail > peakHail) peakHail = p.hail;
    }
    const peakRate = pts.length ? Math.max(...pts.map((p) => p.rain)) : 0;
    // Coverage ≈ fraction of grid points with meaningful rain
    const cov = pts.length ? Math.min(100, Math.round((active / pts.length) * 100)) : 0;
    return { peakDbz, peakRate, peakHail, cov };
  }, [pts]);

  const mapHeight = Math.max(420, Math.min(720, typeof window !== 'undefined' ? window.innerHeight * 0.66 : 560));
  const goStep     = useCallback((i) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(TOTAL_STEPS - 1, i)));
  }, [TOTAL_STEPS]);
  const cycleSpeed = () => setSpeedIdx((i) => (i + 1) % SPEEDS.length);

  const handleInspect = useCallback((info) => {
    if (onInspect) onInspect({ lat: info.lat, lon: info.lon });
  }, [onInspect]);

  return (
    <div ref={captureRef} style={{ position: 'relative', userSelect: 'none' }}>
      <TCMLeafletBase bbox={bbox} height={mapHeight} lightMode={lightMode}
        onInspect={handleInspect} pin={pin} showOpacitySlider={false}
        enableSearch={enableSearch} enableLocate={enableLocate} enableFullscreen={enableFullscreen}>
        {({ projector }) => {
          if (!projector) return null;
          const { x: w, y: h } = projector.size;
          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>
              {raster && (() => {
                const [x0, y0] = projector.project(bbox.latMax, bbox.lonMin);
                const [x1, y1] = projector.project(bbox.latMin, bbox.lonMax);
                const ix = Math.min(x0, x1), iy = Math.min(y0, y1);
                const iw = Math.abs(x1 - x0), ih = Math.abs(y1 - y0);
                return <image href={raster.url} x={ix} y={iy} width={iw} height={ih}
                  preserveAspectRatio="none" opacity={1} style={{ imageRendering: 'auto' }} />;
              })()}

              {/* No-data placeholder */}
              {!pts.length && (
                <g>
                  <rect x={w / 2 - 130} y={h / 2 - 24} width={260} height={48} rx={9}
                    fill={lightMode ? 'rgba(255,255,255,0.78)' : 'rgba(10,18,36,0.78)'} />
                  <text x={w / 2} y={h / 2 - 5} textAnchor="middle" fontSize={12} fontWeight={700}
                    fill={lightMode ? '#334155' : '#94a3b8'} fontFamily="DM Sans">
                    No precipitation forecast
                  </text>
                  <text x={w / 2} y={h / 2 + 14} textAnchor="middle" fontSize={10}
                    fill={lightMode ? '#64748b' : '#64748b'} fontFamily="DM Mono">
                    at this time step
                  </text>
                </g>
              )}
            </svg>
          );
        }}
      </TCMLeafletBase>

      {/* Title chip — top-left, compact */}
      <div data-map-overlay style={{
        position: 'absolute', top: 56, left: 10, zIndex: 600,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px', borderRadius: 10,
        background: lightMode ? 'rgba(255,255,255,0.94)' : 'rgba(10,16,32,0.92)',
        border: `1px solid ${lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)'}`,
        boxShadow: lightMode ? '0 2px 10px rgba(0,0,0,0.10)' : '0 2px 10px rgba(0,0,0,0.40)',
        backdropFilter: 'blur(10px)',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: lightMode ? '#0f172a' : '#e2e8f0' }}>
          Radar · {regionLabel}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 99,
          background: stats.peakHail > 0 ? 'rgba(56,189,248,0.18)' : 'rgba(56,189,248,0.10)',
          color: '#38bdf8', letterSpacing: '0.04em', whiteSpace: 'nowrap',
        }}>
          {stats.peakRate > 0 ? `${stats.peakRate.toFixed(1)} mm/hr` : 'dry'}
          {stats.peakHail > 0 ? ` · hail ${Math.round(stats.peakHail)}mm` : ''}
        </span>
      </div>

      {/* Combined legend — right side, vertically stacked rain + hail ramps */}
      <RadarLegend lightMode={lightMode} />

      {/* Combined draggable timeline bar — bottom */}
      <Timeline
        step={step}
        totalSteps={TOTAL_STEPS}
        stepsPerDay={STEPS_PER_DAY}
        playing={playing}
        speedIdx={speedIdx}
        lightMode={lightMode}
        run={run}
        onPlay={() => setPlaying((p) => !p)}
        onStep={goStep}
        onCycleSpeed={cycleSpeed}
        onReset={() => { setStep(0); setPlaying(true); }}
        stepLabel={stepLabel}
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Timeline — a continuous line with a draggable handle (click-drag or press-
// drag), plus play / step / speed controls in one decluttered bar.
// ═════════════════════════════════════════════════════════════════════════════
function Timeline({ step, totalSteps, stepsPerDay, playing, speedIdx, lightMode, run,
  onPlay, onStep, onCycleSpeed, onReset, stepLabel }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const bg     = lightMode ? 'rgba(255,255,255,0.95)' : 'rgba(10,16,32,0.95)';
  const border = lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)';
  const textC  = lightMode ? '#334155' : '#94a3b8';
  const accent = '#38bdf8';

  const setFromPointer = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const i = Math.round(frac * (totalSteps - 1));
    onStep(i);
  }, [onStep, totalSteps]);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setFromPointer(x);
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [setFromPointer]);

  const pct = totalSteps > 1 ? (step / (totalSteps - 1)) * 100 : 0;

  const dayMarkers = useMemo(() => {
    if (!run) return [];
    const out = [];
    for (let i = 0; i < totalSteps; i += stepsPerDay) {
      const ms = run.getTime() + i * 3 * 3600_000;
      const d  = new Date(ms);
      out.push({ step: i, label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }), pct: (i / (totalSteps - 1)) * 100 });
    }
    return out;
  }, [run, totalSteps, stepsPerDay]);

  const timeLabel = stepLabel && run ? stepLabel(step, run) : `Step ${step}`;

  return (
    <div style={{
      position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
      zIndex: 700, width: 'min(380px, calc(100% - 24px))',
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '6px 10px 7px', fontFamily: "'DM Sans', sans-serif",
      boxShadow: lightMode ? '0 2px 14px rgba(0,0,0,0.10)' : '0 2px 14px rgba(0,0,0,0.45)',
      backdropFilter: 'blur(12px)',
    }}>
      {/* Day markers row */}
      <div style={{ position: 'relative', height: 10, marginBottom: 1, marginLeft: 4, marginRight: 4 }}>
        {dayMarkers.map((dm, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${dm.pct}%`, transform: 'translateX(-50%)',
            fontSize: 9, fontWeight: 700, color: textC, opacity: 0.75, whiteSpace: 'nowrap',
          }}>{dm.label}</div>
        ))}
      </div>

      {/* Continuous track */}
      <div
        ref={trackRef}
        onPointerDown={(e) => { draggingRef.current = true; (e.currentTarget.setPointerCapture?.(e.pointerId)); setFromPointer(e.clientX); }}
        style={{ position: 'relative', height: 16, cursor: 'pointer', touchAction: 'none' }}
      >
        {/* Base track line */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0, height: 4,
          transform: 'translateY(-50%)', borderRadius: 99,
          background: lightMode ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.14)',
        }} />
        {/* Filled progress line */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, width: `${pct}%`, height: 4,
          transform: 'translateY(-50%)', borderRadius: 99,
          background: `linear-gradient(90deg, #38bdf8, #818cf8)`,
          boxShadow: '0 0 8px rgba(56,189,248,0.6)',
        }} />
        {/* Step tick marks */}
        {Array.from({ length: totalSteps }).map((_, i) => {
          const isDay = i % stepsPerDay === 0;
          const left = (i / (totalSteps - 1)) * 100;
          return (
            <div key={i} style={{
              position: 'absolute', top: '50%', left: `${left}%`,
              transform: 'translate(-50%, -50%)',
              width: isDay ? 2 : 1, height: isDay ? 10 : 5,
              background: lightMode ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.30)',
              borderRadius: 1,
            }} />
          );
        })}
        {/* Draggable handle */}
        <div style={{
          position: 'absolute', top: '50%', left: `${pct}%`,
          transform: 'translate(-50%, -50%)',
          width: 13, height: 13, borderRadius: '50%',
          background: '#fff', border: `2px solid ${accent}`,
          boxShadow: `0 0 10px ${accent}aa, 0 1px 4px rgba(0,0,0,0.3)`,
          pointerEvents: 'none',
        }} />
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
        <button onClick={onReset} title="Reset"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: textC, padding: 0, display: 'flex', opacity: 0.7 }}>
          <SkipBack style={{ width: 13, height: 13 }} />
        </button>
        <button onClick={onPlay} title={playing ? 'Pause' : 'Play'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent, padding: 0, display: 'flex' }}>
          {playing ? <Pause style={{ width: 15, height: 15 }} /> : <Play style={{ width: 15, height: 15 }} />}
        </button>
        <button onClick={() => onStep(step - 1)} disabled={step === 0}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: textC, padding: 0, display: 'flex', opacity: step === 0 ? 0.3 : 0.7 }}>
          <ChevronLeft style={{ width: 13, height: 13 }} />
        </button>
        <button onClick={() => onStep(step + 1)} disabled={step === totalSteps - 1}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: textC, padding: 0, display: 'flex', opacity: step === totalSteps - 1 ? 0.3 : 0.7 }}>
          <ChevronRight style={{ width: 13, height: 13 }} />
        </button>

        <div style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: 700, color: textC, fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {timeLabel}
        </div>

        <button onClick={onCycleSpeed} title="Cycle speed"
          style={{
            background: 'none', border: `1px solid ${border}`, borderRadius: 7,
            cursor: 'pointer', color: textC, padding: '2px 7px',
            fontSize: 9, fontWeight: 800, fontFamily: "'DM Mono', monospace",
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
          <Gauge style={{ width: 10, height: 10 }} />
          {SPEEDS[speedIdx].label}
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Combined legend — vertically stacked rain (NWS) + hail ramps, bottom-right.
// ═════════════════════════════════════════════════════════════════════════════
function RadarLegend({ lightMode }) {
  const bg     = lightMode ? 'rgba(255,255,255,0.93)' : 'rgba(10,16,32,0.93)';
  const border = lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)';
  const textC  = lightMode ? '#0f172a' : '#e2e8f0';
  const subC   = lightMode ? '#475569' : '#64748b';

  // Vertical ramps: gradient bar runs top-to-bottom; high values at the TOP.
  // Reversing the palette order makes the palette read high→low top→bottom.
  const rainGradient = `linear-gradient(180deg, ${[...NWS_RADAR_PALETTE].reverse().map((b) => b.fill).join(', ')})`;
  const hailGradient = `linear-gradient(180deg, ${[...HAIL_RADAR_PALETTE].reverse().map((b) => b.fill).join(', ')})`;

  return (
    <div style={{
      position: 'absolute', right: 8, bottom: 8, zIndex: 600,
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '7px 12px 8px', fontFamily: "'DM Sans', sans-serif",
      maxWidth: 'calc(100% - 16px)',
      boxShadow: lightMode ? '0 2px 10px rgba(0,0,0,0.10)' : '0 2px 10px rgba(0,0,0,0.40)',
      backdropFilter: 'blur(10px)',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      {/* Rain — vertical */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: textC, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 1 }}>Rain</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ width: 12, height: 120, borderRadius: 4, background: rainGradient }} />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 120, padding: '1px 0' }}>
            {[70, 45, 25, 5].map((d) => <span key={d} style={{ fontSize: 8, color: subC, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{d}</span>)}
          </div>
        </div>
        <div style={{ fontSize: 8, fontWeight: 700, color: subC, fontFamily: "'DM Mono', monospace" }}>dBZ</div>
      </div>
      {/* Hail — vertical */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, borderTop: `1px solid ${border}`, paddingTop: 7 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: textC, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 1 }}>Hail</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ width: 12, height: 120, borderRadius: 4, background: hailGradient }} />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 120, padding: '1px 0' }}>
            {[70, 30, 12, 2].map((d) => <span key={d} style={{ fontSize: 8, color: subC, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{d}</span>)}
          </div>
        </div>
        <div style={{ fontSize: 8, fontWeight: 700, color: subC, fontFamily: "'DM Mono', monospace" }}>mm</div>
      </div>
    </div>
  );
}