// ─────────────────────────────────────────────────────────────────────────────
// tcmEngine — RADAR PALETTES for the Animated (rain / hail radar) map view.
//
// This file used to be ~2,200 lines: a SECOND, independent copy of the entire
// scoring engine, a SECOND fetch pipeline (runTCM), and the featuresFromHourly /
// combineEnsemble / scoreFromCombined machinery. None of it was ever called — the
// live TCM runs entirely through lib/openMeteoTCM.js + lib/tcmEngineScores.js — and
// the duplicate scorer had already DIVERGED from the real one (missing the parcel-
// physics blend, the CAPE×shear coupling and the variable cross-checks), so it was
// both dead weight and a correctness trap: anyone reading it would have believed
// the forecast used maths it hadn't used in a long time.
//
// The only thing anything imports from here is the two radar colour palettes
// (AnimatedMap.jsx). Everything else has been removed. The palettes and their
// band-lookup helpers — small, pure, and squarely a "radar rendering" concern —
// are kept together here.
//
// The convective SCORING that produces the outlook lives in lib/tcmEngineScores.js;
// the DATA PIPELINE that fetches and assembles a run lives in lib/openMeteoTCM.js.
// ─────────────────────────────────────────────────────────────────────────────

// Marshall–Palmer reflectivity (dBZ) from a rain rate (mm/hr): Z = 200·R^1.6.
export function precipToDBZ(mmPerHour) {
  if (!mmPerHour || mmPerHour <= 0) return 0;
  const Z = 200 * Math.pow(mmPerHour, 1.6);
  return 10 * Math.log10(Math.max(Z, 1));
}

// NWS-style reflectivity palette (dBZ → colour), used by the Rain Radar view.
export const NWS_RADAR_PALETTE = [
  { dbz:  5, mmHr: 0.10, label: 'Trace',        fill: 'rgba(99,182,243,0.55)',  border: '#4ea0e0', text: '#0f1e36' },
  { dbz: 10, mmHr: 0.25, label: 'Light drizzle',fill: 'rgba(72,140,210,0.65)',  border: '#3573b0', text: '#ffffff' },
  { dbz: 15, mmHr: 0.50, label: 'Light rain',   fill: 'rgba(58,176,135,0.70)',  border: '#2f8e6a', text: '#ffffff' },
  { dbz: 20, mmHr: 1.00, label: 'Light rain',   fill: 'rgba(80,200,80,0.78)',   border: '#3da33d', text: '#0d2a0d' },
  { dbz: 25, mmHr: 2.00, label: 'Moderate',     fill: 'rgba(45,170,45,0.82)',   border: '#1f7e1f', text: '#ffffff' },
  { dbz: 30, mmHr: 4.00, label: 'Moderate',     fill: 'rgba(20,128,30,0.86)',   border: '#0f5f15', text: '#ffffff' },
  { dbz: 35, mmHr: 8.00, label: 'Heavy',        fill: 'rgba(245,235,80,0.86)',  border: '#c8b427', text: '#3d3504' },
  { dbz: 40, mmHr: 14.0, label: 'Heavy',        fill: 'rgba(245,180,40,0.90)',  border: '#c08620', text: '#3a2604' },
  { dbz: 45, mmHr: 25.0, label: 'V. heavy',     fill: 'rgba(240,120,30,0.92)',  border: '#b85a14', text: '#ffffff' },
  { dbz: 50, mmHr: 50.0, label: 'V. heavy',     fill: 'rgba(225,55,40,0.94)',   border: '#a51e10', text: '#ffffff' },
  { dbz: 55, mmHr: 100,  label: 'Extreme',      fill: 'rgba(190,30,90,0.95)',   border: '#8a0e4a', text: '#ffffff' },
  { dbz: 60, mmHr: 180,  label: 'Extreme',      fill: 'rgba(165,45,180,0.95)',  border: '#6f1681', text: '#ffffff' },
  { dbz: 65, mmHr: 280,  label: 'Hail core',    fill: 'rgba(230,200,230,0.95)', border: '#a78ba7', text: '#3d1a3d' },
  { dbz: 70, mmHr: 400,  label: 'Hail core',    fill: 'rgba(255,255,255,0.95)', border: '#bdbdbd', text: '#222222' },
];

// Highest palette band at or below a given dBZ (null below the lowest band).
export function radarBandForDBZ(dbz) {
  if (dbz == null || dbz < NWS_RADAR_PALETTE[0].dbz) return null;
  let band = NWS_RADAR_PALETTE[0];
  for (const b of NWS_RADAR_PALETTE) { if (dbz >= b.dbz) band = b; else break; }
  return band;
}

// Hail-size palette (mm → colour).  Deliberately a purple / magenta / pink
// family so hail cores read as a completely different signal from the
// green→yellow→orange→red rain palette, just like real hail radar imagery.
export const HAIL_RADAR_PALETTE = [
  { mm:  2, label: 'Trace',        fill: 'rgba(205,175,255,0.55)', border: '#9a72e0', text: '#2a0f4d' },
  { mm:  5, label: 'Graupel',      fill: 'rgba(175,130,245,0.70)', border: '#7a45d8', text: '#ffffff' },
  { mm:  8, label: 'Pea',          fill: 'rgba(150,85,235,0.78)',  border: '#6a3ad0', text: '#ffffff' },
  { mm: 12, label: 'Marble',       fill: 'rgba(125,55,220,0.85)',  border: '#5a28b0', text: '#ffffff' },
  { mm: 20, label: 'Severe',       fill: 'rgba(190,45,170,0.90)',  border: '#a01a8e', text: '#ffffff' },
  { mm: 30, label: 'Significant',  fill: 'rgba(220,55,135,0.92)',  border: '#c81e6a', text: '#ffffff' },
  { mm: 50, label: 'Giant',        fill: 'rgba(215,45,200,0.94)',  border: '#a01aa0', text: '#ffffff' },
  { mm: 70, label: 'Extreme',      fill: 'rgba(255,215,250,0.96)', border: '#d8a0d0', text: '#3a0833' },
];

// Highest hail band at or below a given diameter (null below the lowest band).
export function hailBandForMM(mm) {
  if (mm == null || mm < HAIL_RADAR_PALETTE[0].mm) return null;
  let band = HAIL_RADAR_PALETTE[0];
  for (const b of HAIL_RADAR_PALETTE) { if (mm >= b.mm) band = b; else break; }
  return band;
}