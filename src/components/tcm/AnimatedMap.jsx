// AnimatedMap — risk-polygon animation AND radar (rain / hail) modes.
//
// Radar rendering v3 — two-pass stratiform + convective approach:
//
//  RAIN:
//  Pass 1 — Stratiform background:
//    All points with raw precip > 0 are included.  Wide IDW reach (reachMult 6)
//    + heavy blur (6 passes) spreads the field into a broad "background rain"
//    layer that covers the expected areal extent.  Only the lowest three palette
//    bands (trace/drizzle/light) are drawn from this pass at reduced opacity,
//    giving the characteristic wide, soft look of stratiform rain on radar.
//  Pass 2 — Convective cores:
//    Only points where the thunderstorm score > 15.  Values are boosted by a
//    convective rate multiplier (CAPE + TS score) to push them up the palette.
//    Narrow IDW reach (reachMult 2.0) + light blur (3 passes) keeps cores tight
//    and distinct.  All palette bands are drawn at full opacity so the heavy
//    and extreme bands actually appear over active cells.
//
//  HAIL:
//  Single-pass using a synthesised hail-size proxy (mm) from hail score +
//  CAPE + freezing level.  reachMult 2.5, blurPasses 3 — hail cores should
//  be tight, not smeared.
//
//  Other improvements:
//  • Animated UTC clock on map canvas.
//  • Day-boundary markers + labels on scrubber.
//  • Speed control (0.5× / 1× / 2× / 4×).
//  • Step-forward / step-back / reset buttons.
//  • Stats bar: peak rate + coverage for current step.
//  • Redesigned legend: ramp bar + threshold labels + source note.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, SkipBack, Gauge, ChevronLeft, ChevronRight } from 'lucide-react';
import TCMLeafletBase from '@/components/tcm/TCMLeafletBase';
import {
  NWS_RADAR_PALETTE, HAIL_RADAR_PALETTE,
} from '@/components/tcm/tcmEngine';
import {
  buildPrecipContourLayers,
  ringToSvgPath as ringToSvgPathImpl,
  buildSmoothedField as buildSmoothedFieldImpl,
} from '@/components/tcm/geometryEngine';
import { isInUKIreland as isInUKIrelandImpl } from '@/components/tcm/ukIrelandMask';

// ─── Speed presets (ms per frame) ─────────────────────────────────────────────
const SPEEDS = [
  { label: '0.5×', ms: 2200 },
  { label: '1×',   ms: 1100 },
  { label: '2×',   ms:  550 },
  { label: '4×',   ms:  275 },
];

// ─── Rain: convective rate proxy ───────────────────────────────────────────────
// Returns a convective peak rate (mm/hr) for use in the CONVECTIVE pass.
// Open-Meteo ensemble-mean precip is conservative (~0.1–2 mm/hr even in storms).
// We scale it by a multiplier that grows with thunderstorm score and CAPE so
// active convective cells push into the Heavy/VHeavy palette bands.
function convectiveRainRate(metrics, scores) {
  if (!metrics) return 0;
  const raw     = metrics.precip ?? metrics.rain ?? 0;
  if (raw <= 0) return 0;
  const tsScore  = scores?.thunderstorm ?? 0;          // 0–100
  const capeNorm = Math.min(1, (metrics.cape ?? 0) / 1400);
  // 1× stratiform → up to 9× for violent convection
  const mult = 1 + Math.min(8, (tsScore / 100) * 7 + capeNorm * 2);
  return raw * mult;
}

// ─── Rain: stratiform rate proxy ───────────────────────────────────────────────
// Light inflation so even weak precip cells contribute to the wide background
// layer.  Never boosted very high — stratiform should only paint trace/light bands.
function stratiformRainRate(metrics) {
  if (!metrics) return 0;
  const raw = metrics.precip ?? metrics.rain ?? 0;
  if (raw <= 0) return 0;
  // Cap at 3 mm/hr so it can't accidentally trigger heavy bands
  return Math.min(raw * 1.6, 3.0);
}

// ─── Hail: diameter proxy (mm) ─────────────────────────────────────────────────
// perStep metrics don't carry hailMm (only perDay.ranges does).  We reconstruct
// a proxy from the hail-risk score, freezing level, CAPE, and dry-aloft index.
function derivedHailMm(metrics, scores) {
  const hailScore = scores?.hail ?? scores?.sub?.hail ?? 0;
  if (hailScore < 12) return 0;
  const cape      = metrics?.cape ?? 0;
  const freezeLvl = metrics?.freezingLvl ?? 2500;
  const wbSpread  = (metrics?.wbSpread ?? 50) / 100;
  if (cape < 100) return 0;

  let mm = (hailScore / 100) * 50;
  // Freezing level penalty (melting on descent)
  const freezePenalty = Math.max(0, Math.min(1, (freezeLvl - 1500) / 2500));
  mm *= (1 - freezePenalty * 0.55);
  // Dry-aloft bonus (hail survival)
  mm *= (1 + wbSpread * 0.3);
  // CAPE boost
  mm *= (1 + Math.min(0.5, (cape - 200) / 1600));

  return Math.max(0, Math.min(80, Math.round(mm * 2) / 2));
}

// ─── Peak threshold label from rendered layers ─────────────────────────────────
function peakValue(layers, mode) {
  if (!layers?.length) return 0;
  let peak = 0;
  for (const l of layers) {
    const v = mode === 'radar-rain' ? (l.mmHr ?? l.threshold ?? 0) : (l.mm ?? l.threshold ?? 0);
    if (v > peak) peak = v;
  }
  return peak;
}

// ─── Coverage estimate ─────────────────────────────────────────────────────────
function computeCoverage(stratLayers, convLayers) {
  const polyCount = [...(stratLayers || []), ...(convLayers || [])]
    .reduce((n, l) => n + (l.polygons?.length ?? 0), 0);
  return Math.min(99, polyCount * 3);
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function AnimatedMap({
  data, region, riskType, run, dayIdx = 0, overlayMode = 'none',
  mode = 'risk',
  REGIONS, RISK_TYPES, LEVEL_OPACITY, TOTAL_STEPS, STEPS_PER_DAY,
  buildOutlookLayersForStep,
  buildOutlookLayers, buildFineGrid, buildSmoothedField, getRiskScore, scoreToLevel,
  isInUKIreland, detectGridStep,
  clusterToPath, ringToSvgPath, getPalette, stepLabel,
  TitleCard, OutlookLegend, useTCMTheme,
}) {
  const { lightMode } = useTCMTheme();
  const [playing, setPlaying]   = useState(true);
  const [step, setStep]         = useState(0);
  const [speedIdx, setSpeedIdx] = useState(1);
  const intervalRef             = useRef(null);

  const _ringToSvgPath      = ringToSvgPath      || ringToSvgPathImpl;
  const _isInUKIreland      = isInUKIreland      || isInUKIrelandImpl;
  const _buildSmoothedField = buildSmoothedField  || buildSmoothedFieldImpl;

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

  const bbox     = REGIONS[region].bbox;
  const gridStep = REGIONS[region].gridStep;
  const grid     = data?.grid ?? [];

  // ── RAIN RADAR — two-pass layers ────────────────────────────────────────────
  const { stratLayers, convLayers } = useMemo(() => {
    if (mode !== 'radar-rain' || !grid.length) return { stratLayers: [], convLayers: [] };

    const stratPts = [], convPts = [];

    for (const p of grid) {
      if (p.lat < bbox.latMin - 1.2 || p.lat > bbox.latMax + 1.2) continue;
      if (p.lon < bbox.lonMin - 1.2 || p.lon > bbox.lonMax + 1.2) continue;
      const sd     = p.perStep?.[step];
      const m      = sd?.scores?.metrics;
      const scores = sd?.scores;

      // Stratiform pass: every point with any model precip
      const sv = stratiformRainRate(m);
      if (sv > 0) stratPts.push({ lat: p.lat, lon: p.lon, value: sv });

      // Convective pass: only points with active thunderstorm signal
      const tsScore = scores?.thunderstorm ?? 0;
      if (tsScore >= 15) {
        const cv = convectiveRainRate(m, scores);
        if (cv > 0) convPts.push({ lat: p.lat, lon: p.lon, value: cv });
      }
    }

    // Palette bands — stratiform only uses lowest 3 (trace/drizzle/light rain)
    const allBands = NWS_RADAR_PALETTE.map((b, i) => ({
      key: i, threshold: b.mmHr,
      fill: b.fill, border: b.border, label: b.label, dbz: b.dbz, mmHr: b.mmHr, mm: b.mm,
    }));
    const stratBands = allBands.slice(0, 4);  // ≤ 1 mm/hr
    const convBands  = allBands;               // full palette

    const sL = stratPts.length >= 2
      ? buildPrecipContourLayers(stratPts, bbox, gridStep, stratBands, null,
          { reachMult: 6.0, blurPasses: 6, smoothPasses: 5, minPolyArea: 0.06 })
      : [];

    const cL = convPts.length >= 2
      ? buildPrecipContourLayers(convPts, bbox, gridStep, convBands, null,
          { reachMult: 2.2, blurPasses: 3, smoothPasses: 4, minPolyArea: 0.02 })
      : [];

    return { stratLayers: sL, convLayers: cL };
  }, [mode, grid, step, bbox, gridStep]);

  // ── HAIL RADAR — single-pass tight cores ────────────────────────────────────
  const hailLayers = useMemo(() => {
    if (mode !== 'radar-hail' || !grid.length) return [];

    const pts = [];
    for (const p of grid) {
      if (p.lat < bbox.latMin - 1.0 || p.lat > bbox.latMax + 1.0) continue;
      if (p.lon < bbox.lonMin - 1.0 || p.lon > bbox.lonMax + 1.0) continue;
      const sd     = p.perStep?.[step];
      const m      = sd?.scores?.metrics;
      const scores = sd?.scores;
      const v = derivedHailMm(m, scores);
      if (v > 0) pts.push({ lat: p.lat, lon: p.lon, value: v });
    }
    if (pts.length < 2) return [];

    const bands = HAIL_RADAR_PALETTE.map((b, i) => ({
      key: i, threshold: b.mm,
      fill: b.fill, border: b.border, label: b.label, mm: b.mm,
    }));

    return buildPrecipContourLayers(pts, bbox, gridStep, bands, null,
      { reachMult: 2.5, blurPasses: 3, smoothPasses: 4, minPolyArea: 0.015 });
  }, [mode, grid, step, bbox, gridStep]);

  // Unified view for stats / no-data checks
  const isRadar      = mode === 'radar-rain' || mode === 'radar-hail';
  const radarHasData = mode === 'radar-rain'
    ? (stratLayers.length > 0 || convLayers.length > 0)
    : hailLayers.length > 0;
  const allRadarLayers = mode === 'radar-rain'
    ? [...stratLayers, ...convLayers]
    : hailLayers;

  // ── Risk mode layers ────────────────────────────────────────────────────────
  const layers = useMemo(() => {
    if (mode !== 'risk') return [];
    if (!grid.length) return [];
    return buildOutlookLayersForStep(grid, riskType, step, gridStep, region);
  }, [mode, grid, riskType, step, region, gridStep, buildOutlookLayersForStep]);

  const actualStep = useMemo(
    () => (detectGridStep ? detectGridStep(grid, gridStep) : gridStep),
    [grid, gridStep, detectGridStep]
  );
  const overlayPolyLayers = useMemo(() => {
    if (mode !== 'risk' || overlayMode !== 'outlook' || !grid.length || !buildOutlookLayers) return [];
    return buildOutlookLayers(grid, riskType, dayIdx, actualStep, region);
  }, [mode, overlayMode, grid, riskType, dayIdx, actualStep, region, buildOutlookLayers]);

  const overlayCells = useMemo(() => {
    if (mode !== 'risk' || overlayMode !== 'hd-boxes' || !grid.length || !getRiskScore || !scoreToLevel) return [];
    return grid.filter((p) => {
      if (!_isInUKIreland(p.lat, p.lon)) return false;
      if (p.lat < bbox.latMin - 0.1 || p.lat > bbox.latMax + 0.1) return false;
      if (p.lon < bbox.lonMin - 0.1 || p.lon > bbox.lonMax + 0.1) return false;
      return true;
    }).map((p) => {
      const s = getRiskScore(p, riskType, dayIdx);
      return { lat: p.lat, lon: p.lon, score: s, level: scoreToLevel(s) };
    });
  }, [mode, overlayMode, grid, riskType, dayIdx, bbox, getRiskScore, scoreToLevel, _isInUKIreland]);

  const overlayFineCells = useMemo(() => {
    if (mode !== 'risk' || overlayMode !== 'hd-fill' || !grid.length || !getRiskScore) return null;
    const pad = 0.5;
    const scored = [];
    for (const p of grid) {
      if (p.lat < bbox.latMin - pad || p.lat > bbox.latMax + pad) continue;
      if (p.lon < bbox.lonMin - pad || p.lon > bbox.lonMax + pad) continue;
      const s = getRiskScore(p, riskType, dayIdx);
      if (s > 1) scored.push({ lat: p.lat, lon: p.lon, score: s });
    }
    if (!scored.length) return null;
    return _buildSmoothedField(scored, bbox, actualStep, 2);
  }, [mode, overlayMode, grid, riskType, dayIdx, bbox, actualStep, getRiskScore, _buildSmoothedField]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const radarStats = useMemo(() => {
    if (!isRadar) return null;
    const peak = peakValue(allRadarLayers, mode);
    const cov  = computeCoverage(stratLayers, mode === 'radar-rain' ? convLayers : hailLayers);
    return { peak, cov, hasData: radarHasData };
  }, [isRadar, allRadarLayers, stratLayers, convLayers, hailLayers, mode, radarHasData]);

  const activeLevels = useMemo(() => {
    const s = new Set();
    for (const l of layers) s.add(l.level);
    return s;
  }, [layers]);

  // ── Step date for clock overlay ─────────────────────────────────────────────
  const stepDate = useMemo(() => {
    if (!run) return null;
    const ms = run.getTime() + step * 3 * 3600_000;
    const d  = new Date(ms);
    return {
      weekday:  d.toLocaleDateString('en-GB', { weekday: 'short' }),
      dayMonth: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      hour:     d.getUTCHours().toString().padStart(2, '0'),
    };
  }, [run, step]);

  const mapHeight  = Math.max(380, Math.min(680, typeof window !== 'undefined' ? window.innerHeight * 0.62 : 520));
  const radarTitle = mode === 'radar-rain'
    ? `${REGIONS[region].label} — Rain Radar`
    : `${REGIONS[region].label} — Hail Radar`;

  const goStep     = useCallback((i) => { setPlaying(false); setStep(Math.max(0, Math.min(TOTAL_STEPS - 1, i))); }, [TOTAL_STEPS]);
  const cycleSpeed = () => setSpeedIdx((i) => (i + 1) % SPEEDS.length);

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <TCMLeafletBase bbox={bbox} height={mapHeight} lightMode={lightMode}>
        {({ projector }) => {
          if (!projector) return null;
          const { x: w, y: h } = projector.size;

          // Helper: render a layer array with a given base opacity multiplier
          const renderRadarLayer = (bandLayers, opacityMult, keyPrefix) =>
            bandLayers.map((band, li) =>
              (band.polygons || []).map((ring, ci) => {
                const d = _ringToSvgPath(ring, projector);
                if (!d) return null;
                return (
                  <motion.path
                    key={`${keyPrefix}-${step}-${li}-${ci}`}
                    d={d}
                    fill={band.fill}
                    stroke={band.border}
                    strokeWidth={keyPrefix === 'strat' ? 0.5 : 0.9}
                    strokeLinejoin="round"
                    strokeOpacity={keyPrefix === 'strat' ? 0.5 : 0.80}
                    fillOpacity={opacityMult}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: opacityMult }}
                    transition={{ duration: 0.18 }}
                  />
                );
              })
            );

          return (
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 400 }}>

              {/* ── RAIN RADAR ────────────────────────────────────────────── */}
              {mode === 'radar-rain' && (<>
                {/* Stratiform background — wide, soft, low opacity */}
                {renderRadarLayer(stratLayers, 0.55, 'strat')}
                {/* Convective cores — tight, full opacity */}
                {renderRadarLayer(convLayers, 0.92, 'conv')}
              </>)}

              {/* ── HAIL RADAR ────────────────────────────────────────────── */}
              {mode === 'radar-hail' && renderRadarLayer(hailLayers, 0.92, 'hail')}

              {/* ── No-data placeholder ─────────────────────────────────── */}
              {isRadar && !radarHasData && (
                <g>
                  <rect x={w / 2 - 130} y={h / 2 - 24} width={260} height={48}
                    rx={9} fill={lightMode ? 'rgba(255,255,255,0.78)' : 'rgba(10,18,36,0.78)'} />
                  <text x={w / 2} y={h / 2 - 5} textAnchor="middle" fontSize={12} fontWeight={700}
                    fill={lightMode ? '#334155' : '#94a3b8'} fontFamily="DM Sans">
                    {mode === 'radar-rain' ? 'No precipitation forecast' : 'No hail forecast'}
                  </text>
                  <text x={w / 2} y={h / 2 + 14} textAnchor="middle" fontSize={10}
                    fill={lightMode ? '#64748b' : '#64748b'} fontFamily="DM Mono">
                    at this time step
                  </text>
                </g>
              )}

              {/* ── UTC clock ────────────────────────────────────────────── */}
              {isRadar && stepDate && (() => {
                const bw = 112, bh = 54, cx = w - 12;
                return (
                  <g>
                    <rect x={cx - bw} y={12} width={bw} height={bh} rx={8}
                      fill={lightMode ? 'rgba(255,255,255,0.92)' : 'rgba(10,16,32,0.90)'}
                      stroke={lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)'}
                      strokeWidth={0.75} />
                    <text x={cx - bw / 2} y={29} textAnchor="middle"
                      fontFamily="DM Mono,monospace" fontSize={9} fontWeight={600}
                      fill={lightMode ? '#64748b' : '#64748b'} letterSpacing="0.05em">
                      {stepDate.weekday} {stepDate.dayMonth}
                    </text>
                    <text x={cx - bw / 2} y={52} textAnchor="middle"
                      fontFamily="DM Mono,monospace" fontSize={20} fontWeight={800}
                      fill={lightMode ? '#0f172a' : '#e2e8f0'}>
                      {stepDate.hour}
                      <tspan fontSize={12} fontWeight={600} fill={lightMode ? '#475569' : '#94a3b8'}>:00 UTC</tspan>
                    </text>
                  </g>
                );
              })()}

              {/* ── RISK MODE rendering ───────────────────────────────────── */}
              {!isRadar && overlayMode === 'hd-fill' && overlayFineCells && (() => {
                const { values, cols, rows, lat0, lon0, step: gs } = overlayFineCells;
                const [px0, py0] = projector.project(lat0, lon0);
                const [px1, py1] = projector.project(lat0 + gs, lon0 + gs);
                const cellPxW = Math.max(2, Math.abs(px1 - px0) * 1.05);
                const cellPxH = Math.max(2, Math.abs(py1 - py0) * 1.05);
                const rects = [];
                for (let r = 0; r < rows; r++) {
                  const lat = lat0 + r * gs;
                  for (let c = 0; c < cols; c++) {
                    const score = values[r * cols + c];
                    if (score < 5) continue;
                    const lon = lon0 + c * gs;
                    if (_isInUKIreland && !_isInUKIreland(lat, lon)) continue;
                    const [cx, cy] = projector.project(lat, lon);
                    const lvl = scoreToLevel(score);
                    if (lvl === 'No Risk') continue;
                    const pal = getPalette(riskType, lvl);
                    rects.push(
                      <rect key={`am-hd-${r}-${c}`}
                        x={Math.floor(cx - cellPxW / 2)} y={Math.floor(cy - cellPxH / 2)}
                        width={Math.ceil(cellPxW)} height={Math.ceil(cellPxH)}
                        fill={pal.fill}
                        opacity={(LEVEL_OPACITY[lvl] ?? 0.75) * 0.45}
                        pointerEvents="none" />
                    );
                  }
                }
                return rects;
              })()}
              {!isRadar && overlayMode === 'hd-boxes' && overlayCells.length > 0 && (() => {
                const refLat = overlayCells[0].lat;
                const refLon = overlayCells[0].lon;
                const [rx0]   = projector.project(refLat, refLon);
                const [rx1]   = projector.project(refLat, refLon + actualStep);
                const [, ry0] = projector.project(refLat, refLon);
                const [, ry1] = projector.project(refLat + actualStep, refLon);
                const cellW   = Math.max(6, Math.abs(rx1 - rx0) * 1.15);
                const cellH   = Math.max(6, Math.abs(ry1 - ry0) * 1.15);
                return overlayCells.map((cc, i) => {
                  if (cc.level === 'No Risk') return null;
                  const [cx, cy] = projector.project(cc.lat, cc.lon);
                  const pal = getPalette(riskType, cc.level);
                  return (
                    <rect key={`am-box-${i}`}
                      x={Math.floor(cx - cellW / 2)} y={Math.floor(cy - cellH / 2)}
                      width={Math.ceil(cellW)} height={Math.ceil(cellH)}
                      fill={pal.fill}
                      opacity={(LEVEL_OPACITY[cc.level] ?? 0.75) * 0.45}
                      pointerEvents="none" />
                  );
                });
              })()}
              {!isRadar && overlayMode === 'outlook' && overlayPolyLayers.map((layer, li) => {
                const items = layer.polygons
                  ? layer.polygons.map((ring) => _ringToSvgPath?.(ring, projector))
                  : [];
                const pal = getPalette(riskType, layer.level);
                return items.map((d, ci) => d ? (
                  <path key={`am-ovr-${li}-${ci}`} d={d}
                    fill="none" stroke={pal.border} strokeWidth={1.4}
                    strokeLinejoin="round"
                    opacity={(LEVEL_OPACITY[layer.level] ?? 0.7) * 0.7}
                    pointerEvents="none" />
                ) : null);
              })}
              {!isRadar && layers.map((layer) => {
                const items = layer.polygons
                  ? layer.polygons.map((ring) => _ringToSvgPath?.(ring, projector))
                  : layer.clusters.map((cluster) => clusterToPath(cluster, projector, gridStep, layer.level));
                const pal = getPalette(riskType, layer.level);
                const op  = LEVEL_OPACITY[layer.level] ?? 0.7;
                return items.map((d, ci) => {
                  if (!d) return null;
                  return (
                    <motion.path key={`anim-${step}-${layer.level}-${ci}`} d={d}
                      fill={pal.fill} stroke={pal.border} strokeWidth={1.5}
                      strokeLinejoin="round" opacity={op}
                      initial={{ opacity: 0 }} animate={{ opacity: op }} transition={{ duration: 0.25 }} />
                  );
                });
              })}
              {!isRadar && layers.length === 0 &&
                <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={13} fontWeight={600}
                  fill={lightMode ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.25)'}
                  fontFamily="DM Sans">No significant risk at this time</text>
              }

              <TitleCard
                w={Math.min(300, w - 140)} x={10} y={10}
                title={isRadar ? radarTitle : `${REGIONS[region].label} — ${RISK_TYPES.find((tt) => tt.id === riskType)?.label}`}
                sub={stepLabel && run ? stepLabel(step, run) : ''} />
            </svg>
          );
        }}
      </TCMLeafletBase>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      {isRadar
        ? <RadarLegend mode={mode} lightMode={lightMode} />
        : <OutlookLegend riskType={riskType} activeLevels={activeLevels} />}

      {/* ── Stats bar (radar only) ──────────────────────────────────────── */}
      {isRadar && radarStats && (
        <RadarStatsBar stats={radarStats} mode={mode} lightMode={lightMode} />
      )}

      {/* ── Scrubber ────────────────────────────────────────────────────── */}
      <Scrubber
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

// ─────────────────────────────────────────────────────────────────────────────
// Scrubber
// ─────────────────────────────────────────────────────────────────────────────
function Scrubber({ step, totalSteps, stepsPerDay, playing, speedIdx, lightMode, run,
  onPlay, onStep, onCycleSpeed, onReset, stepLabel }) {

  const bg     = lightMode ? 'rgba(255,255,255,0.94)' : 'rgba(10,16,32,0.94)';
  const border = lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
  const textC  = lightMode ? '#334155' : '#94a3b8';
  const accent = '#a78bfa';

  const dayLabels = useMemo(() => {
    if (!run) return [];
    const labels = [];
    for (let i = 0; i < totalSteps; i += stepsPerDay) {
      const ms = run.getTime() + i * 3 * 3600_000;
      const d  = new Date(ms);
      labels.push({ step: i, label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) });
    }
    return labels;
  }, [run, totalSteps, stepsPerDay]);

  return (
    <div style={{
      position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
      zIndex: 500, maxWidth: '96%', width: 520,
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '7px 10px', fontFamily: 'DM Sans, sans-serif',
      boxShadow: lightMode ? '0 2px 12px rgba(0,0,0,0.10)' : '0 2px 12px rgba(0,0,0,0.40)',
    }}>
      {/* Day labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, paddingLeft: 52, paddingRight: 36 }}>
        {dayLabels.map((dl, di) => (
          <div key={di} style={{
            fontSize: 9, fontWeight: 600, color: textC, opacity: 0.75,
            whiteSpace: 'nowrap', flex: 1, textAlign: di === 0 ? 'left' : 'center',
          }}>{dl.label}</div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
        <button onClick={onReset} title="Reset"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: textC, padding: 0, flexShrink: 0, display: 'flex', opacity: 0.7 }}>
          <SkipBack style={{ width: 12, height: 12 }} />
        </button>
        <button onClick={onPlay} title={playing ? 'Pause' : 'Play'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent, padding: 0, flexShrink: 0, display: 'flex' }}>
          {playing ? <Pause style={{ width: 14, height: 14 }} /> : <Play style={{ width: 14, height: 14 }} />}
        </button>
        <button onClick={() => onStep(step - 1)} disabled={step === 0}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: textC, padding: 0, flexShrink: 0, display: 'flex', opacity: step === 0 ? 0.3 : 0.7 }}>
          <ChevronLeft style={{ width: 12, height: 12 }} />
        </button>
        <button onClick={() => onStep(step + 1)} disabled={step === totalSteps - 1}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: textC, padding: 0, flexShrink: 0, display: 'flex', opacity: step === totalSteps - 1 ? 0.3 : 0.7 }}>
          <ChevronRight style={{ width: 12, height: 12 }} />
        </button>

        {/* Step dots */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, overflow: 'hidden' }}>
          {Array.from({ length: totalSteps }).map((_, i) => {
            const isDayBoundary = i % stepsPerDay === 0;
            const isActive      = i === step;
            return (
              <div key={i} onClick={() => onStep(i)}
                title={stepLabel && run ? stepLabel(i, run) : `Step ${i}`}
                style={{
                  width:      isActive ? 14 : isDayBoundary ? 5 : 3,
                  height:     isDayBoundary ? 8 : 4,
                  borderRadius: 2, flexShrink: 0,
                  background: isActive
                    ? accent
                    : isDayBoundary
                      ? (lightMode ? 'rgba(99,102,241,0.45)' : 'rgba(167,139,250,0.45)')
                      : (lightMode ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.18)'),
                  cursor: 'pointer', transition: 'all .15s',
                }} />
            );
          })}
        </div>

        {/* Speed */}
        <button onClick={onCycleSpeed}
          style={{
            background: 'none', border: `1px solid ${border}`, borderRadius: 6,
            cursor: 'pointer', color: textC, padding: '2px 6px', flexShrink: 0,
            fontSize: 9, fontWeight: 700, fontFamily: 'DM Mono, monospace',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
          <Gauge style={{ width: 9, height: 9 }} />
          {SPEEDS[speedIdx].label}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RadarLegend — colour ramp + two-column threshold list
// ─────────────────────────────────────────────────────────────────────────────
function RadarLegend({ mode, lightMode }) {
  const palette   = mode === 'radar-rain' ? NWS_RADAR_PALETTE : HAIL_RADAR_PALETTE;
  const unitLabel = mode === 'radar-rain' ? 'Precip rate (mm/hr)' : 'Hail diameter (mm)';
  const bg        = lightMode ? 'rgba(255,255,255,0.93)' : 'rgba(10,16,32,0.93)';
  const border    = lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)';
  const textC     = lightMode ? '#0f172a' : '#e2e8f0';
  const subC      = lightMode ? '#475569' : '#64748b';

  return (
    <div style={{
      position: 'absolute', right: 10, bottom: 80, zIndex: 500,
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      padding: '8px 10px', fontFamily: 'DM Sans, sans-serif', minWidth: 152,
      boxShadow: lightMode ? '0 2px 8px rgba(0,0,0,0.10)' : '0 2px 8px rgba(0,0,0,0.35)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: textC, marginBottom: 6 }}>
        {unitLabel}
      </div>

      {/* Colour ramp swatch */}
      <div style={{ display: 'flex', height: 10, borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
        {palette.map((b, i) => (
          <div key={i} style={{ flex: 1, background: b.fill }} />
        ))}
      </div>

      {/* Per-band rows (reversed = highest first) */}
      {palette.slice().reverse().map((b, i) => {
        const val = mode === 'radar-rain' ? b.mmHr : b.mm;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <div style={{
              width: 16, height: 10, background: b.fill,
              border: `1px solid ${b.border}`, borderRadius: 2, flexShrink: 0,
            }} />
            <span style={{ fontSize: 9, fontWeight: 800, color: textC, fontFamily: 'DM Mono, monospace', minWidth: 30 }}>
              {val}+
            </span>
            <span style={{ fontSize: 8, color: subC }}>
              {mode === 'radar-rain' ? `${b.label} (${b.dbz}dBZ)` : b.label}
            </span>
          </div>
        );
      })}

      <div style={{ marginTop: 6, fontSize: 8, color: subC, borderTop: `1px solid ${border}`, paddingTop: 5, lineHeight: 1.4 }}>
        {mode === 'radar-rain'
          ? 'Stratiform + convective rate proxy\nOpen-Meteo ensemble'
          : 'Hail-size proxy — CAPE + shear + freeze level'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RadarStatsBar
// ─────────────────────────────────────────────────────────────────────────────
function RadarStatsBar({ stats, mode, lightMode }) {
  if (!stats) return null;
  const bg    = lightMode ? 'rgba(248,250,252,0.94)' : 'rgba(15,23,42,0.88)';
  const bdr   = lightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
  const textC = lightMode ? '#334155' : '#94a3b8';
  const valC  = lightMode ? '#0f172a' : '#e2e8f0';

  const { peak, cov, hasData } = stats;
  const peakLabel = mode === 'radar-rain'
    ? (peak > 0 ? `${peak.toFixed(1)} mm/hr` : '—')
    : (peak > 0 ? `${peak.toFixed(0)} mm` : '—');
  const peakDesc = mode === 'radar-rain' ? 'Peak rate' : 'Max hail';

  return (
    <div style={{
      position: 'absolute', left: 10, bottom: 80, zIndex: 500,
      background: bg, border: `1px solid ${bdr}`, borderRadius: 10,
      padding: '7px 12px', fontFamily: 'DM Sans, sans-serif',
      display: 'flex', gap: 18,
      boxShadow: lightMode ? '0 2px 8px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.30)',
    }}>
      <div>
        <div style={{ fontSize: 8, color: textC, fontWeight: 600, marginBottom: 1 }}>{peakDesc}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: valC, fontFamily: 'DM Mono, monospace' }}>{peakLabel}</div>
      </div>
      <div>
        <div style={{ fontSize: 8, color: textC, fontWeight: 600, marginBottom: 1 }}>Coverage</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: valC, fontFamily: 'DM Mono, monospace' }}>
          {hasData ? `~${Math.min(99, cov)}%` : 'None'}
        </div>
      </div>
    </div>
  );
}