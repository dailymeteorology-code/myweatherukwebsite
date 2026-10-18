"""NOVA-AI: TCM NOVA's own calibration network (no external AI service).

A small neural network (pure numpy) learns P(thunderstorm observed | forecast, situation),
replacing the one-size-fits-all isotonic curve with a correction that depends on WHERE and
in WHAT ENVIRONMENT the forecast was made — so it can learn that, say, the blend over-forecasts
on Welsh windward slopes under strong CIN, or under-forecasts on Scottish sea lochs at long
lead, and correct each differently.

Inputs per grid cell (standardised):
  forecast       logit(p_raw), lead time
  environment    log MUCAPE, MLCIN, 0–6 km shear, orographic ascent (w_oro), source disagreement
  topography     terrain height, slope, distance to coast, landform one-hot
                 (flat, ridge, valley, slope, sea)
  region         one-hot England / Wales / Scotland / Ireland / sea
  product        Main Run vs Hyper-Short
Network: 1 hidden layer (32 tanh units) -> sigmoid, trained with Adam on log-loss with L2
weight decay and early stopping on held-out DAYS (never held-out cells of a training day,
which would leak through spatial autocorrelation).

Acceptance: the network is only switched on when its day-held-out Brier score beats BOTH the
raw forecast and the isotonic curve; overall and per region scores are recorded. Training data:
hindcasts + the nightly learning record. It is a post-processing calibrator: the Main Run's
downscaling itself stays deterministic and AI-free, as specified.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from .config import DATA
from .regions import REGIONS

MODEL_FILE = DATA / 'nova_ai.json'
FEATURES = ['logit_p', 'lead', 'log_cape', 'cin', 'shear', 'w_oro', 'disagree', 'h', 'slope', 'coast',
            'lf_flat', 'lf_ridge', 'lf_valley', 'lf_slope', 'lf_sea'] + [f'r_{r}' for r in REGIONS] + ['hyper']
ENV_FIELDS = ['mu_cape', 'ml_cin', 'shear_0_6km', 'w_oro', 'source_disagreement']
LANDFORMS = [0, 1, -1, 2, 9]


def features(p, lead_h, env, static, product='main'):
    """p (N,), env {field: (N,)}, static {'h','slope','coast','landform','region': (N,)} -> X (N, F)."""
    n = p.size
    g = lambda k, d=0.0: np.nan_to_num(np.asarray(env.get(k, np.full(n, d)), np.float32), nan=d)
    pc = np.clip(np.nan_to_num(p), 1e-4, 1 - 1e-4)
    cols = [np.log(pc / (1 - pc)), np.full(n, lead_h / 96.0, np.float32), np.log1p(np.maximum(g('mu_cape'), 0)) / 7,
            np.clip(g('ml_cin'), -500, 0) / 200, g('shear_0_6km') / 25, np.clip(g('w_oro'), -2, 2), g('source_disagreement') * 3,
            static['h'] / 500, np.minimum(static['slope'] * 20, 3), np.minimum(static['coast'] / 50, 3)]
    lf = static['landform']
    cols += [(lf == c).astype(np.float32) for c in LANDFORMS]
    rg = static['region']
    cols += [(rg == i).astype(np.float32) for i in range(len(REGIONS))]
    cols.append(np.full(n, 1.0 if product == 'hyper' else 0.0, np.float32))
    return np.stack(cols, 1).astype(np.float32)


class Net:
    def __init__(self, nin, nh=32, seed=0):
        r = np.random.default_rng(seed)
        self.W1 = (r.standard_normal((nin, nh)) / np.sqrt(nin)).astype(np.float32)
        self.b1 = np.zeros(nh, np.float32)
        self.W2 = (r.standard_normal(nh) / np.sqrt(nh) * 0.1).astype(np.float32)
        self.b2 = np.float32(0.0)
        self.skip = np.float32(1.0)            # starts as "trust the raw logit"

    def forward(self, X):
        H = np.tanh(X @ self.W1 + self.b1)
        z = H @ self.W2 + self.b2 + self.skip * X[:, 0]
        return 1 / (1 + np.exp(-np.clip(z, -30, 30))), H

    def predict(self, X):
        return self.forward(X)[0]

    def params(self):
        return ['W1', 'b1', 'W2', 'b2', 'skip']

    def to_json(self):
        return {k: np.asarray(getattr(self, k)).tolist() for k in self.params()}

    @classmethod
    def from_json(cls, d):
        n = cls(len(d['W1']), len(d['b1']))
        for k in n.params():
            setattr(n, k, np.asarray(d[k], np.float32) if k not in ('b2', 'skip') else np.float32(d[k]))
        return n


def train(X, y, Xv=None, yv=None, epochs=40, lr=3e-3, l2=1e-4, batch=4096, seed=0):
    net = Net(X.shape[1], seed=seed)
    m = {k: 0 for k in net.params()}
    v = {k: 0 for k in net.params()}
    t = 0
    rng = np.random.default_rng(seed)
    best, best_state, bad = np.inf, net.to_json(), 0
    # class balance is NOT re-weighted: we want calibrated probabilities, not a classifier
    for ep in range(epochs):
        idx = rng.permutation(len(y))
        for s in range(0, len(y), batch):
            b = idx[s:s + batch]
            xb, yb = X[b], y[b]
            p, H = net.forward(xb)
            d = (p - yb) / len(b)                                    # dLogLoss/dz
            g = {'W2': H.T @ d + l2 * net.W2, 'b2': d.sum(), 'skip': (d * xb[:, 0]).sum()}
            dH = np.outer(d, net.W2) * (1 - H ** 2)
            g['W1'] = xb.T @ dH + l2 * net.W1
            g['b1'] = dH.sum(0)
            t += 1
            for k in net.params():
                m[k] = 0.9 * m[k] + 0.1 * g[k]
                v[k] = 0.999 * v[k] + 0.001 * g[k] ** 2
                upd = lr * (m[k] / (1 - 0.9 ** t)) / (np.sqrt(v[k] / (1 - 0.999 ** t)) + 1e-8)
                setattr(net, k, (getattr(net, k) - upd).astype(np.float32))
        if Xv is not None:
            bs = float(np.mean((net.predict(Xv) - yv) ** 2))
            if bs < best - 1e-6:
                best, best_state, bad = bs, net.to_json(), 0
            else:
                bad += 1
                if bad >= 4:
                    break
    return Net.from_json(best_state) if Xv is not None else net


def fit(rows, iso_curve_for=None, folds=5, max_rows=300_000):
    """rows: list of (day, X, y). Day-blocked cross-validation, then a final fit on all days."""
    days = sorted({d for d, _, _ in rows})
    if len(days) < 6:
        return {'applied': False, 'why_not_applied': f'only {len(days)} days of training data (need 6)', 'n_days': len(days)}
    rng = np.random.default_rng(1)
    fold_of = {d: i % folds for i, d in enumerate(rng.permutation(days))}
    raw_bs, ai_bs, iso_bs, by_region = [], [], [], {r: {'raw': [], 'ai': [], 'n': 0} for r in REGIONS}
    n_te = [0]
    rcols = [FEATURES.index(f'r_{r}') for r in REGIONS]

    def cat(sel):
        X = np.concatenate([x for d, x, _ in rows if sel(d)])
        y = np.concatenate([yy for d, _, yy in rows if sel(d)])
        if len(y) > max_rows:
            k = rng.choice(len(y), max_rows, replace=False)
            X, y = X[k], y[k]
        return X, y.astype(np.float32)
    for f in range(folds):
        Xtr, ytr = cat(lambda d: fold_of[d] != f)
        Xte, yte = cat(lambda d: fold_of[d] == f)
        if len(yte) == 0 or ytr.sum() == 0:
            continue
        # early-stopping split by day inside the training folds
        tr_days = [d for d in days if fold_of[d] != f]
        hold = set(tr_days[::5])
        Xa, ya = cat(lambda d: fold_of[d] != f and d not in hold)
        Xh, yh = cat(lambda d: d in hold)
        net = train(Xa, ya, Xh if len(yh) else None, yh if len(yh) else None)
        p_raw = 1 / (1 + np.exp(-Xte[:, 0]))
        p_ai = net.predict(Xte)
        n_te[0] += len(yte)
        raw_bs.append(np.mean((p_raw - yte) ** 2) * len(yte))
        ai_bs.append(np.mean((p_ai - yte) ** 2) * len(yte))
        if iso_curve_for is not None:
            iso_bs.append(np.mean((iso_curve_for(p_raw) - yte) ** 2) * len(yte))
        for i, r in enumerate(REGIONS):
            sel = Xte[:, rcols[i]] > 0.5
            if sel.any():
                by_region[r]['raw'].append(np.sum((p_raw[sel] - yte[sel]) ** 2))
                by_region[r]['ai'].append(np.sum((p_ai[sel] - yte[sel]) ** 2))
                by_region[r]['n'] += int(sel.sum())
    n = sum(len(yy) for _, _, yy in rows)
    tot = lambda a: float(np.sum(a) / max(1, n_te[0])) if a else None
    res = {'n_days': len(days), 'n_samples': int(n), 'features': FEATURES,
           'brier_raw_cv': tot(raw_bs), 'brier_ai_cv': tot(ai_bs), 'brier_isotonic_cv': tot(iso_bs) if iso_bs else None,
           'by_region_cv': {r: {'n': v['n'], 'brier_raw': (float(np.sum(v['raw']) / v['n']) if v['n'] else None),
                                'brier_ai': (float(np.sum(v['ai']) / v['n']) if v['n'] else None)} for r, v in by_region.items()}}
    beats = res['brier_ai_cv'] is not None and res['brier_ai_cv'] < res['brier_raw_cv'] and \
        (res['brier_isotonic_cv'] is None or res['brier_ai_cv'] < res['brier_isotonic_cv'])
    res['applied'] = bool(beats)
    res['why_not_applied'] = None if beats else 'did not beat raw and isotonic on day-held-out Brier'
    if beats:
        X, y = cat(lambda d: True)
        hold = set(days[::5])
        Xa, ya = cat(lambda d: d not in hold)
        Xh, yh = cat(lambda d: d in hold)
        res['model'] = train(Xa, ya, Xh, yh).to_json()
    res['trained_utc'] = datetime.now(timezone.utc).isoformat()
    return res


_LOADED = {}


def load():
    if 'm' not in _LOADED:
        try:
            d = json.loads(MODEL_FILE.read_text())
            _LOADED['m'] = (Net.from_json(d['model']), d) if d.get('applied') and 'model' in d else (None, d)
        except Exception:
            _LOADED['m'] = (None, {})
    return _LOADED['m']


def apply_grid(p, lead_h, env_grid, static_grid, product='main'):
    """Calibrate a whole probability grid. Returns (p_calibrated, used_ai)."""
    net, _ = load()
    if net is None:
        return p, False
    shp = p.shape
    X = features(p.ravel(), lead_h, {k: np.asarray(v).ravel() for k, v in env_grid.items()},
                 {k: np.asarray(v).ravel() for k, v in static_grid.items()}, product)
    return net.predict(X).reshape(shp).astype(np.float32), True


def static_fields(terr, region):
    return {'h': terr['h_mean'], 'slope': terr['slope'], 'coast': terr['dist_coast_km'],
            'landform': terr['landform_class'], 'region': region}
