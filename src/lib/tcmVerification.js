// ─────────────────────────────────────────────────────────────────────────────
// Forecast verification & calibration (probabilistic skill)
//
// Pure utilities to close the verification loop against observed convection
// (e.g. Blitzortung CG strikes). They take an array of { prob, hit } records —
// one per forecast point/time — where `prob` is the forecast probability
// (0–1 or 0–100, auto-detected) and `hit` is whether a storm was actually
// observed there (1/0). Field names are flexible (prob/p/forecast, hit/obs/
// observed/y) so they slot onto most record shapes without reshaping.
//
// A reliability diagram shows whether 30% means 30%, the Murphy/Brier
// decomposition splits skill into calibration vs information, ROC/AUC measures
// discrimination, and calibrateThresholds recovers the score cut-offs that best
// separate hits from misses.
// ─────────────────────────────────────────────────────────────────────────────
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function _vProb01(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return n > 1.0000001 ? clamp(n / 100, 0, 1) : clamp(n, 0, 1);
}
function _vHit(h) {
  if (h == null) return null;
  return (h === true || Number(h) >= 0.5) ? 1 : 0;
}

export function verifyForecast(pairs, { bins = 10 } = {}) {
  const clean = [];
  for (const r of (pairs || [])) {
    const p = _vProb01(r.prob ?? r.p ?? r.forecast);
    const h = _vHit(r.hit ?? r.obs ?? r.observed ?? r.y);
    if (p == null || h == null) continue;
    clean.push({ p, h });
  }
  const n = clean.length;
  if (!n) return { n: 0 };

  const baseRate = clean.reduce((s, r) => s + r.h, 0) / n;

  // Brier score (mean squared error of the probability forecast).
  let brier = 0;
  for (const r of clean) brier += (r.p - r.h) * (r.p - r.h);
  brier /= n;

  // Reliability diagram + Murphy decomposition.
  const binArr = Array.from({ length: bins }, () => ({ sumP: 0, sumH: 0, n: 0 }));
  for (const r of clean) {
    let bi = Math.floor(r.p * bins);
    if (bi >= bins) bi = bins - 1;
    if (bi < 0) bi = 0;
    const b = binArr[bi];
    b.sumP += r.p; b.sumH += r.h; b.n++;
  }
  let reliability = 0, resolution = 0;
  const diagram = [];
  for (let i = 0; i < bins; i++) {
    const b = binArr[i];
    if (!b.n) { diagram.push({ binLo: +(i / bins).toFixed(3), binHi: +((i + 1) / bins).toFixed(3), forecast: null, observed: null, n: 0 }); continue; }
    const meanP = b.sumP / b.n;
    const obsFreq = b.sumH / b.n;
    reliability += b.n * (meanP - obsFreq) * (meanP - obsFreq);
    resolution  += b.n * (obsFreq - baseRate) * (obsFreq - baseRate);
    diagram.push({ binLo: +(i / bins).toFixed(3), binHi: +((i + 1) / bins).toFixed(3), forecast: +meanP.toFixed(4), observed: +obsFreq.toFixed(4), n: b.n });
  }
  reliability /= n;
  resolution  /= n;
  const uncertainty = baseRate * (1 - baseRate);
  const bss = uncertainty > 0 ? 1 - brier / uncertainty : 0; // vs climatology

  return {
    n,
    baseRate:         +baseRate.toFixed(4),
    brier:            +brier.toFixed(4),
    brierSkillScore:  +bss.toFixed(4),     // >0 beats climatology, 1 = perfect
    reliability:      +reliability.toFixed(4), // lower = better calibrated
    resolution:       +resolution.toFixed(4),  // higher = more informative
    uncertainty:      +uncertainty.toFixed(4),
    diagram,
  };
}

export function rocAuc(pairs) {
  const clean = [];
  for (const r of (pairs || [])) {
    const p = _vProb01(r.prob ?? r.p ?? r.forecast);
    const h = _vHit(r.hit ?? r.obs ?? r.observed ?? r.y);
    if (p == null || h == null) continue;
    clean.push({ p, h });
  }
  if (!clean.length) return { auc: null, points: [] };
  clean.sort((a, b) => b.p - a.p);
  const P = clean.reduce((s, r) => s + r.h, 0);
  const N = clean.length - P;
  if (!P || !N) return { auc: null, points: [], note: 'need both hits and misses' };
  let tp = 0, fp = 0, auc = 0, prevFpr = 0, prevTpr = 0;
  const points = [{ fpr: 0, tpr: 0 }];
  for (const r of clean) {
    if (r.h) tp++; else fp++;
    const tpr = tp / P, fpr = fp / N;
    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2; // trapezoidal
    prevFpr = fpr; prevTpr = tpr;
    points.push({ fpr: +fpr.toFixed(4), tpr: +tpr.toFixed(4) });
  }
  return { auc: +auc.toFixed(4), points };
}

export function calibrateThresholds(records, { min = 1, max = 99, step = 1 } = {}) {
  const clean = [];
  for (const r of (records || [])) {
    const s = Number(r.score ?? r.ts ?? r.value);
    const h = _vHit(r.hit ?? r.obs ?? r.observed ?? r.y);
    if (!Number.isFinite(s) || h == null) continue;
    clean.push({ s, h });
  }
  if (!clean.length) return { n: 0 };
  const P = clean.reduce((a, r) => a + r.h, 0);
  const N = clean.length - P;
  let bestCSI = { thr: null, csi: -1 }, bestJ = { thr: null, j: -1 };
  for (let thr = min; thr <= max; thr += step) {
    let tp = 0, fp = 0, fn = 0;
    for (const r of clean) {
      const pos = r.s >= thr;
      if (pos && r.h) tp++;
      else if (pos && !r.h) fp++;
      else if (!pos && r.h) fn++;
    }
    const csi = (tp + fp + fn) ? tp / (tp + fp + fn) : 0;       // critical success index
    const tpr = P ? tp / P : 0, fpr = N ? fp / N : 0;
    const j = tpr - fpr;                                         // Youden's J
    if (csi > bestCSI.csi) bestCSI = { thr, csi: +csi.toFixed(4), tp, fp, fn };
    if (j   > bestJ.j)     bestJ   = { thr, j: +j.toFixed(4), tpr: +tpr.toFixed(4), fpr: +fpr.toFixed(4) };
  }
  return { n: clean.length, hits: P, misses: N, bestByCSI: bestCSI, bestByYoudenJ: bestJ };
}