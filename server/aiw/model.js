/**
 * The lightning nowcast model: features -> P(lightning within 8 km of this
 * point during the 5 minutes ending at lead L).
 *
 * WHY LOGISTIC REGRESSION. The prompt asks for a measurable baseline first
 * and complexity only where it earns its place. A logistic model over a small
 * set of physically meaningful features:
 *   - is calibrated by construction (it is fitted to maximise likelihood), so
 *     a 0.7 means seven-in-ten on the training climate — which is what the
 *     warning thresholds need;
 *   - trains exactly (Newton's method on ~12 weights) in seconds on CPU;
 *   - is fully inspectable — the admin panel shows every weight;
 *   - is a fair, hard-to-beat reference that any future neural model must
 *     beat on the same held-out data before it is deployed.
 *
 * Until a model has been trained on archived strikes and has beaten the
 * baselines on held-out data, the engine runs the BASELINE below and every
 * warning says so.
 */
import { LEADS } from './nowcast.js';

export const FEATURE_NAMES = [
  'bias',
  'log1p(advected density, last 10 min)',
  'log1p(advected density, last 30 min)',
  'log1p(current density here, no advection)',
  'lead time / 30 min',
  'cell strike-rate trend (log ratio)',
  'log1p(cell strikes, last 10 min)',
  'log1p(CAPE) / 8',
  'CAPE unavailable',
  'advected density x lead (decay)',
  'track age (cycles, capped)',
  // the rest of the model atmosphere (GFS); appended, so a model trained before them still reads
  // its own weights in the same order
  'surface lifted index / 10 (negative = unstable)',
  'wind shear 10 m to 500 hPa / 100 km/h',
  'log1p(model convective rain, mm/h)',
];

/** Feature vector for one grid point. */
export function featureVector(fields, L, k, ctx) {
  const d10 = Math.log1p(fields.leads[L].d10[k]);
  const d30 = Math.log1p(fields.leads[L].d30[k]);
  const here = Math.log1p(fields.now10[k]);
  const lead = L / 30;
  const capeKnown = Number.isFinite(ctx.cape);
  return [
    1, d10, d30, here, lead,
    Math.max(-3, Math.min(3, ctx.trend)),
    Math.log1p(ctx.n10),
    capeKnown ? Math.log1p(Math.max(0, ctx.cape)) / 8 : 0,
    capeKnown ? 0 : 1,
    d10 * lead,
    Math.min(ctx.cycles, 20) / 10,
    Number.isFinite(ctx.liftedIndex) ? Math.max(-10, Math.min(15, ctx.liftedIndex)) / 10 : 0,
    Number.isFinite(ctx.shearKmh) ? Math.min(150, Math.max(0, ctx.shearKmh)) / 100 : 0,
    Number.isFinite(ctx.showersMmH) ? Math.log1p(Math.max(0, ctx.showersMmH)) : 0,
  ];
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/* ── the baseline ─────────────────────────────────────────────────────── */

/**
 * Advected persistence: lightning is where the last ten minutes of lightning
 * will be after moving with the storm, smeared by forecast uncertainty. One
 * strike per 100 km² in ten minutes maps to ~0.55. No learned parameters —
 * this is the reference the trained model has to beat.
 */
export const BASELINE = {
  version: 'baseline-advected-persistence',
  kind: 'baseline',
  trained: false,
  predict(fields, L, k) {
    return 1 - Math.exp(-0.8 * fields.leads[L].d10[k]);
  },
};

/* ── logistic model ───────────────────────────────────────────────────── */

export function makeLogistic(spec) {
  return {
    ...spec,
    kind: 'logistic',
    predict(fields, L, k, ctx) {
      const x = featureVector(fields, L, k, ctx);
      let z = 0;
      const n = Math.min(x.length, spec.weights.length);      // a model from before newer features uses its own
      for (let i = 0; i < n; i += 1) z += spec.weights[i] * x[i];
      return sigmoid(z);
    },
  };
}

/**
 * Weighted L2-regularised logistic regression by Newton's method (IRLS).
 * X: array of feature arrays, y: 0/1, w: sample weights.
 */
export function fitLogistic(X, y, w, { l2 = 1e-2, iters = 30 } = {}) {
  const d = X[0].length;
  let beta = new Array(d).fill(0);
  for (let it = 0; it < iters; it += 1) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let n = 0; n < X.length; n += 1) {
      const x = X[n];
      let z = 0;
      for (let i = 0; i < d; i += 1) z += beta[i] * x[i];
      const p = sigmoid(z);
      const r = w[n] * (p - y[n]);
      const s = w[n] * p * (1 - p);
      for (let i = 0; i < d; i += 1) {
        g[i] += r * x[i];
        const sxi = s * x[i];
        for (let j = i; j < d; j += 1) H[i][j] += sxi * x[j];
      }
    }
    for (let i = 0; i < d; i += 1) {
      for (let j = 0; j < i; j += 1) H[i][j] = H[j][i];
      if (i > 0) { g[i] += l2 * beta[i]; H[i][i] += l2; } // don't shrink the bias
      H[i][i] += 1e-9;
    }
    const step = solve(H, g);
    let maxStep = 0;
    for (let i = 0; i < d; i += 1) { beta[i] -= step[i]; maxStep = Math.max(maxStep, Math.abs(step[i])); }
    if (maxStep < 1e-6) break;
  }
  return beta;
}

/** Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      if (!f) continue;
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/* ── verification metrics ─────────────────────────────────────────────── */

/**
 * Accumulates the standard verification scores over (probability, outcome,
 * weight) triples:
 *   Brier score and Brier skill vs the sample climatology,
 *   POD / FAR / CSI at a probability threshold,
 *   a 10-bin reliability table (forecast probability vs observed frequency).
 */
export function createScorer(threshold = 0.5) {
  let n = 0; let brier = 0; let obs = 0;
  let hits = 0; let misses = 0; let fa = 0; let cn = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, o: 0 }));
  return {
    add(p, o, w = 1) {
      n += w; brier += w * (p - o) ** 2; obs += w * o;
      const yes = p >= threshold;
      if (yes && o) hits += w; else if (!yes && o) misses += w; else if (yes && !o) fa += w; else cn += w;
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.n += w; b.p += w * p; b.o += w * o;
    },
    result() {
      const base = n ? obs / n : 0;
      const bs = n ? brier / n : null;
      const bsClim = base * (1 - base);
      return {
        samples: Math.round(n), baseRate: base,
        brier: bs, brierSkill: bsClim > 0 && bs != null ? 1 - bs / bsClim : null,
        threshold,
        pod: hits + misses ? hits / (hits + misses) : null,
        far: hits + fa ? fa / (hits + fa) : null,
        csi: hits + misses + fa ? hits / (hits + misses + fa) : null,
        reliability: bins.map((b, i) => ({
          bin: `${i / 10}-${(i + 1) / 10}`, n: Math.round(b.n),
          meanForecast: b.n ? b.p / b.n : null, observed: b.n ? b.o / b.n : null,
        })),
      };
    },
  };
}

export { LEADS };
