import React, { useMemo, useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchPointHourly, extractSoundingAtPeakCape } from '@/lib/openMeteoPointHourly';

// ── Synthetic fallback sounding (only used when network fetch fails) ─────────
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(seed) { return function () { let t = (seed += 0x6D2B79F5) >>> 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function syntheticSounding(pt, dayIdx, run) {
  const seed = hashStr(`sounding_${pt?.lat ?? 51}_${pt?.lon ?? -1}_${dayIdx}_${run?.toISOString?.() ?? ''}`);
  const rng = mulberry32(seed);
  const cape = pt?.perDay?.[dayIdx]?.scores?.metrics?.cape ?? Math.round(rng() * 600);
  const li = -(rng() * 4 + 1);
  const pressures = [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100];
  const surfaceT = 18 + rng() * 8;
  const surfaceTd = surfaceT - 6 - rng() * 6;
  const levels = pressures.map((p) => {
    const z = (1 - Math.pow(p / 1013.25, 0.190284)) * 44307.7;
    const T = surfaceT - z / 1000 * 6.5 + (rng() - 0.5) * 1.5;
    const Td = Math.min(T, surfaceTd - z / 1000 * 5 + (rng() - 0.5) * 1.0);
    return { p, z, T, Td, windSpeed: 10 + rng() * 30, windDir: (180 + z / 100) % 360 };
  });
  return { levels, cape, li, surfaceT, surfaceTd, peakHour: 15, synthetic: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Skew-T Log-P plot — built to mirror a real Skew-T as closely as possible.
// Includes:
//   • Skewed isotherms (every 10°C, 45° tilt)
//   • Log-spaced isobars (every standard level)
//   • Dry adiabats (potential-temperature θ family)
//   • Saturated mixing-ratio lines (constant w family)
//   • Parcel ascent path from the surface (with LCL / EL markers)
//   • Wind barbs in standard meteorological notation
//   • CAPE / LI / CIN / FL annotations
// ─────────────────────────────────────────────────────────────────────────────

const SkewT = React.memo(function SkewT({ pt, dayIdx, run, t, lightMode }) {
  const W = 420, H = 380;
  const pad = { top: 22, right: 60, bottom: 36, left: 48 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const [realSounding, setRealSounding] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRealSounding(null);
    if (!pt?.lat || !pt?.lon || !run) { setLoading(false); return; }
    fetchPointHourly({ lat: pt.lat, lon: pt.lon, run })
      .then(data => {
        if (!alive || !data) { setLoading(false); return; }
        const sounding = extractSoundingAtPeakCape(data, dayIdx, run);
        if (alive) { setRealSounding(sounding); setLoading(false); }
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pt?.lat, pt?.lon, dayIdx, run]);

  const { levels, cape, li, peakHour, synthetic, surfaceT, surfaceTd } = useMemo(() => {
    if (realSounding && realSounding.levels?.length >= 5) return { ...realSounding, synthetic: false };
    return syntheticSounding(pt, dayIdx, run);
  }, [realSounding, pt, dayIdx, run]);

  // ── Axis transforms ─────────────────────────────────────────────────────
  // Pressure on a log axis from 1050 hPa (bottom) to 100 hPa (top).
  // Temperature axis: -50°C → +40°C across the chart width, plus a 45° skew
  // applied as you go up the chart.
  const pMin = 100, pMax = 1050;
  const tMin = -50, tMax = 40;
  const SKEW = 45; // degrees

  function logP(p) {
    return (Math.log(pMax) - Math.log(p)) / (Math.log(pMax) - Math.log(pMin));
  }
  function yP(p) { return pad.top + logP(p) * ch; }
  function xT(T, p) {
    const u = (T - tMin) / (tMax - tMin);
    return pad.left + u * cw + logP(p) * cw * Math.tan(SKEW * Math.PI / 180) * 0.6;
  }

  // ── Theme colours ───────────────────────────────────────────────────────
  const bg          = lightMode ? '#f8fafc' : '#0a0f1e';
  const chartBg     = lightMode ? '#ffffff' : '#0c1426';
  const gridFaint   = lightMode ? 'rgba(15,23,42,0.06)'  : 'rgba(255,255,255,0.06)';
  const gridMid     = lightMode ? 'rgba(15,23,42,0.12)'  : 'rgba(255,255,255,0.10)';
  const gridStrong  = lightMode ? 'rgba(15,23,42,0.25)'  : 'rgba(255,255,255,0.22)';
  const axisText    = lightMode ? '#475569' : '#94a3b8';
  const tempColor   = '#ef4444';
  const dewColor    = '#22c55e';
  const parcelColor = '#f59e0b';
  const isothermZero = '#38bdf8';

  // ── Lines & curve families ──────────────────────────────────────────────
  const pLines = [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100];
  const tLines = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40];

  // Dry adiabats (constant potential temperature θ).
  // T(p) = θ × (p / 1000)^(R/cp), with R/cp ≈ 0.2854.
  const dryAdiabats = [-30, -20, -10, 0, 10, 20, 30, 40, 50, 60];
  function buildAdiabat(theta) {
    const pts = [];
    for (let p = pMax; p >= pMin; p -= 25) {
      const tempK = (theta + 273.15) * Math.pow(p / 1000, 0.2854);
      const T = tempK - 273.15;
      pts.push([xT(T, p), yP(p)]);
    }
    return pts;
  }

  // Saturation mixing-ratio lines (g/kg).
  // ws(T, p) = 622 × es(T) / (p - es(T))   where es ≈ 6.112 × exp(17.67 T / (T+243.5))
  const mixRatios = [0.5, 1, 2, 4, 8, 12, 20];
  function buildMixingRatio(ws) {
    const pts = [];
    for (let p = pMax; p >= 200; p -= 25) {
      // Invert: solve es from ws and p → es = ws*p / (622+ws)
      const es = (ws * p) / (622 + ws);
      // Invert Bolton's es(T): T = 243.5 × ln(es/6.112) / (17.67 − ln(es/6.112))
      if (es <= 0) continue;
      const ln = Math.log(es / 6.112);
      const T = 243.5 * ln / (17.67 - ln);
      if (Number.isFinite(T)) pts.push([xT(T, p), yP(p)]);
    }
    return pts;
  }

  function pointsToPath(pts) {
    if (!pts.length) return '';
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
    }
    return d;
  }

  function isothermPath(T) {
    return pointsToPath([
      [xT(T, pMax), yP(pMax)],
      [xT(T, pMin), yP(pMin)],
    ]);
  }

  const tempPathD = pointsToPath(levels.map(l => [xT(l.T, l.p), yP(l.p)]));
  const dewPathD  = pointsToPath(levels.map(l => [xT(l.Td, l.p), yP(l.p)]));

  // ── Parcel ascent (dry adiabat from surface to LCL, then moist adiabat) ──
  // Compute LCL using Espy's approximation: P_LCL ≈ p × ((T_LCL+273.15) / (T+273.15))^(1/0.2854)
  // T_LCL approx: T_LCL = Td - (T - Td) × 0.001296 × (T - Td) + Td ... simplified:
  // Use Bolton (1980) T_LCL = 1/(1/(Td+273.15) - ln(RH/100)/2840) - 273.15; here we
  // approximate via T_LCL ≈ Td - (T - Td)/4.4 which is good enough for visualisation.
  function buildParcel(Tsfc, Tdsfc, pSfc) {
    const pts = [];
    const tLcl = Tdsfc - (Tsfc - Tdsfc) / 4.4;
    const theta = (Tsfc + 273.15) * Math.pow(1000 / pSfc, 0.2854) - 273.15;
    // Dry adiabat from sfc until parcel temp == tLcl
    let lclP = pSfc;
    for (let p = pSfc; p >= pMin; p -= 5) {
      const tempK = (theta + 273.15) * Math.pow(p / 1000, 0.2854);
      const T = tempK - 273.15;
      pts.push([xT(T, p), yP(p), p, T]);
      if (T <= tLcl) { lclP = p; break; }
    }
    // From the LCL upwards: pseudoadiabatic ascent approximated as a moist
    // lapse around 6 K/km. Convert dP→dz via hypsometric: dz = -R T/g d(ln p).
    const lastTop = pts[pts.length - 1];
    let prevT = lastTop[3];
    let prevP = lastTop[2];
    for (let p = prevP - 5; p >= pMin; p -= 5) {
      // dz between prevP and p (m), assuming mean T ≈ prevT
      const dz = 287 * (prevT + 273.15) / 9.81 * Math.log(prevP / p);
      const newT = prevT - 0.006 * dz; // 6 K/km moist lapse
      pts.push([xT(newT, p), yP(p), p, newT]);
      prevT = newT; prevP = p;
    }
    return { pts, lclP };
  }

  const sfcLevel = levels[0];
  const parcel = (sfcLevel && Number.isFinite(sfcLevel.T) && Number.isFinite(sfcLevel.Td))
    ? buildParcel(sfcLevel.T, sfcLevel.Td, sfcLevel.p)
    : null;
  const parcelPath = parcel ? pointsToPath(parcel.pts.map(p => [p[0], p[1]])) : '';

  // Find the equilibrium level (EL) — where parcel curve crosses environment.
  let elP = null;
  if (parcel) {
    for (const [, , p, T] of parcel.pts) {
      // Interpolate environment T at this pressure
      let envT = null;
      for (let i = 0; i < levels.length - 1; i++) {
        if (levels[i].p >= p && levels[i + 1].p <= p) {
          const f = (Math.log(levels[i].p) - Math.log(p)) /
                    (Math.log(levels[i].p) - Math.log(levels[i + 1].p) || 1);
          envT = levels[i].T + f * (levels[i + 1].T - levels[i].T);
          break;
        }
      }
      if (envT != null && T < envT && p < (parcel.lclP - 50)) { elP = p; break; }
    }
  }

  // ── Wind barb renderer ──────────────────────────────────────────────────
  function WindBarb({ x, y, speed, dir }) {
    // speed in knots (or mph close enough), dir 0° = from N
    if (speed == null) return null;
    const rad = ((dir ?? 0) - 90) * Math.PI / 180;
    const sx = Math.cos(rad) * 14, sy = Math.sin(rad) * 14;
    const px = -sy / 14, py = sx / 14; // perpendicular unit
    const barbs = [];
    let s = speed;
    // 50 kt pennant, 10 kt full barb, 5 kt half barb
    let off = 13;
    while (s >= 50) {
      barbs.push(
        <polygon key={`p${off}`} points={`${(-sx) * (off / 14)},${(-sy) * (off / 14)} ${(-sx) * ((off - 4) / 14) + px * 7},${(-sy) * ((off - 4) / 14) + py * 7} ${(-sx) * ((off - 4) / 14)},${(-sy) * ((off - 4) / 14)}`} fill={axisText} />
      );
      off -= 5; s -= 50;
    }
    while (s >= 10) {
      barbs.push(
        <line key={`f${off}`}
          x1={(-sx) * (off / 14)} y1={(-sy) * (off / 14)}
          x2={(-sx) * (off / 14) + px * 6} y2={(-sy) * (off / 14) + py * 6}
          stroke={axisText} strokeWidth={1.3} strokeLinecap="round" />
      );
      off -= 3; s -= 10;
    }
    if (s >= 5) {
      barbs.push(
        <line key={`h${off}`}
          x1={(-sx) * (off / 14)} y1={(-sy) * (off / 14)}
          x2={(-sx) * (off / 14) + px * 3} y2={(-sy) * (off / 14) + py * 3}
          stroke={axisText} strokeWidth={1.3} strokeLinecap="round" />
      );
    }
    return (
      <g transform={`translate(${x},${y})`}>
        <line x1={0} y1={0} x2={-sx} y2={-sy} stroke={axisText} strokeWidth={1.3} strokeLinecap="round" />
        <circle cx={0} cy={0} r={2} fill={axisText} />
        {barbs}
      </g>
    );
  }

  return (
    <div style={{ background: bg, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: t.textSecondary, marginBottom: 8, fontFamily: "'DM Mono',monospace", display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {loading && <Loader2 className="animate-spin" style={{ width: 11, height: 11, color: '#38bdf8' }} />}
        <span>Skew-T Log-P · CAPE <span style={{ color: '#ef4444' }}>{cape} J/kg</span> · LI <span style={{ color: li < -3 ? '#ef4444' : '#22c55e' }}>{li.toFixed(1)}</span></span>
        {peakHour != null && !synthetic && (
          <span style={{ padding: '2px 7px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 99, color: '#f59e0b', fontSize: '0.65rem' }}>
            Peak {peakHour.toString().padStart(2, '0')}Z
          </span>
        )}
        {synthetic && !loading && (
          <span style={{ padding: '2px 7px', background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.30)', borderRadius: 99, color: t.textMuted, fontSize: '0.62rem' }}>
            Estimated
          </span>
        )}
      </div>

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: '100%' }}>
        <defs>
          <clipPath id="skewt-clip">
            <rect x={pad.left} y={pad.top} width={cw} height={ch} />
          </clipPath>
        </defs>

        {/* Chart background */}
        <rect x={pad.left} y={pad.top} width={cw} height={ch} fill={chartBg} stroke={gridStrong} strokeWidth={1} rx={3} />

        <g clipPath="url(#skewt-clip)">
          {/* Dry adiabats — light reddish */}
          {dryAdiabats.map(theta => (
            <path key={`th${theta}`} d={pointsToPath(buildAdiabat(theta))}
              fill="none" stroke={lightMode ? 'rgba(239,68,68,0.18)' : 'rgba(239,68,68,0.22)'} strokeWidth={0.7} />
          ))}

          {/* Mixing-ratio lines — dashed green */}
          {mixRatios.map(ws => (
            <path key={`mr${ws}`} d={pointsToPath(buildMixingRatio(ws))}
              fill="none" stroke={lightMode ? 'rgba(34,197,94,0.32)' : 'rgba(34,197,94,0.38)'} strokeWidth={0.7} strokeDasharray="2,3" />
          ))}

          {/* Skewed isotherms */}
          {tLines.map(T => (
            <path key={`t${T}`} d={isothermPath(T)}
              fill="none" stroke={T === 0 ? isothermZero : gridFaint} strokeWidth={T === 0 ? 1.0 : 0.6} />
          ))}

          {/* Isobars (horizontal) */}
          {pLines.map(p => (
            <line key={`p${p}`} x1={pad.left} x2={pad.left + cw} y1={yP(p)} y2={yP(p)}
              stroke={p === 500 || p === 850 ? gridMid : gridFaint} strokeWidth={p === 500 || p === 850 ? 0.9 : 0.6} />
          ))}

          {/* Parcel ascent path */}
          {parcelPath && (
            <path d={parcelPath} fill="none" stroke={parcelColor} strokeWidth={1.6}
              strokeDasharray="4,3" opacity={0.85} />
          )}

          {/* LCL marker */}
          {parcel && (
            <g>
              <line x1={pad.left} x2={pad.left + cw} y1={yP(parcel.lclP)} y2={yP(parcel.lclP)}
                stroke={parcelColor} strokeWidth={0.6} strokeDasharray="2,4" opacity={0.6} />
              <text x={pad.left + cw - 4} y={yP(parcel.lclP) - 3} textAnchor="end"
                fontSize={8} fill={parcelColor} fontFamily="DM Mono,monospace" fontWeight={700}>LCL</text>
            </g>
          )}
          {elP && (
            <g>
              <line x1={pad.left} x2={pad.left + cw} y1={yP(elP)} y2={yP(elP)}
                stroke="#a78bfa" strokeWidth={0.6} strokeDasharray="2,4" opacity={0.7} />
              <text x={pad.left + cw - 4} y={yP(elP) - 3} textAnchor="end"
                fontSize={8} fill="#a78bfa" fontFamily="DM Mono,monospace" fontWeight={700}>EL</text>
            </g>
          )}

          {/* Dewpoint trace */}
          <path d={dewPathD} fill="none" stroke={dewColor} strokeWidth={2.4}
            strokeLinejoin="round" strokeLinecap="round" />
          {/* Temperature trace */}
          <path d={tempPathD} fill="none" stroke={tempColor} strokeWidth={2.6}
            strokeLinejoin="round" strokeLinecap="round" />
        </g>

        {/* Pressure labels (left axis) */}
        {pLines.map(p => (
          <text key={`pl${p}`} x={pad.left - 6} y={yP(p) + 3} textAnchor="end"
            fontSize={9} fill={axisText} fontFamily="DM Mono,monospace">{p}</text>
        ))}

        {/* Temperature labels (bottom axis) — every 10°C */}
        {tLines.filter(T => T % 10 === 0).map(T => (
          <text key={`tl${T}`} x={xT(T, pMax)} y={pad.top + ch + 12} textAnchor="middle"
            fontSize={9} fill={T === 0 ? isothermZero : axisText} fontFamily="DM Mono,monospace">{T}°</text>
        ))}

        {/* Wind barbs along right edge */}
        {levels.filter((_, i) => i % 1 === 0).map((l, i) => (
          <g key={`wb${i}`}>
            <WindBarb x={pad.left + cw + 24} y={yP(l.p)} speed={l.windSpeed || 0} dir={l.windDir || 0} />
          </g>
        ))}

        {/* Axis titles */}
        <text x={pad.left + cw / 2} y={H - 6} textAnchor="middle" fontSize={9}
          fill={axisText} fontFamily="DM Mono,monospace">Temperature (°C)</text>
        <text x={12} y={pad.top + ch / 2} textAnchor="middle" fontSize={9}
          fill={axisText} fontFamily="DM Mono,monospace"
          transform={`rotate(-90,12,${pad.top + ch / 2})`}>Pressure (hPa)</text>

        {/* Legend */}
        <g transform={`translate(${pad.left + 8},${pad.top + 8})`}>
          <rect x={-4} y={-3} width={104} height={48} rx={4}
            fill={lightMode ? 'rgba(255,255,255,0.85)' : 'rgba(10,15,30,0.85)'}
            stroke={gridMid} strokeWidth={0.6} />
          <line x1={0} x2={16} y1={4} y2={4} stroke={tempColor} strokeWidth={2.4} />
          <text x={20} y={7} fontSize={8} fill={axisText} fontFamily="DM Mono,monospace">Temp</text>
          <line x1={0} x2={16} y1={16} y2={16} stroke={dewColor} strokeWidth={2.4} />
          <text x={20} y={19} fontSize={8} fill={axisText} fontFamily="DM Mono,monospace">Dewpoint</text>
          <line x1={0} x2={16} y1={28} y2={28} stroke={parcelColor} strokeWidth={1.8} strokeDasharray="3,2" />
          <text x={20} y={31} fontSize={8} fill={axisText} fontFamily="DM Mono,monospace">Parcel</text>
          <text x={0} y={42} fontSize={7.5} fill={axisText} fontFamily="DM Mono,monospace">
            Sfc T {surfaceT?.toFixed?.(1) ?? '—'}°C · Td {surfaceTd?.toFixed?.(1) ?? '—'}°C
          </text>
        </g>
      </svg>
    </div>
  );
});

export default SkewT;