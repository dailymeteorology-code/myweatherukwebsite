"""Ensemble scenarios (16 Nov 2026, at the user's request: "ensemble scenarios (clusters)"): the ways
an ensemble's members split at one time ahead.

Each member's sea-level pressure over the North Atlantic and Europe (40 W to 30 E, 35 to 72 N, on the
ensembles' 30 km cells, weighted by area) is compared with the others: their main differences
(principal components, as many as explain 90 %) are grouped by k-means into two, three or four
scenarios, the fewest that separate them clearly (each a tenth of the members or more); if none do,
the members agree and there is one. Each scenario has its members, its share, its mean pressure map
and what it means for the UK against the ensemble as a whole.

    python -m mdata.scenarios <ensemble> <run iso> <step>        (MDATA_GRID=eu)  -> JSON
"""
from __future__ import annotations

import base64
import json
import sys
import time

import numpy as np

from . import models  # noqa: F401  (first: mdata.ens reads the models as it loads)
from .common import lonlat
from .ens import ENSEMBLES, frame_dir, main as make_members
from .ensmean import read_members
from .models import _utc

BOX = (-40.0, 30.0, 35.0, 72.0)                  # west, east, south, north
UK = (-8.0, 2.0, 50.0, 59.0)
COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']


def _kmeans(X, k, tries=12, seed=0):
    """k-means++ several times over, the tightest kept: (labels, centres, inertia)."""
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(tries):
        c = [X[rng.integers(len(X))]]
        for _ in range(1, k):
            d = np.min([((X - ci) ** 2).sum(1) for ci in c], axis=0)
            c.append(X[rng.choice(len(X), p=d / d.sum())] if d.sum() > 0 else X[rng.integers(len(X))])
        c = np.array(c)
        for _ in range(100):
            lab = np.argmin(((X[:, None, :] - c[None]) ** 2).sum(2), 1)
            new = np.array([X[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
            if np.allclose(new, c):
                break
            c = new
        inertia = float(((X - c[lab]) ** 2).sum())
        if best is None or inertia < best[2]:
            best = (lab, c, inertia)
    return best


def _silhouette(X, lab):
    d = np.sqrt(((X[:, None, :] - X[None]) ** 2).sum(2))
    s = []
    for i in range(len(X)):
        own = lab == lab[i]
        if own.sum() <= 1:
            s.append(0.0)
            continue
        a = d[i, own].sum() / (own.sum() - 1)
        b = min(d[i, lab == j].mean() for j in set(lab.tolist()) if j != lab[i])
        s.append((b - a) / max(a, b) if max(a, b) > 0 else 0.0)
    return float(np.mean(s))


def scenarios(ens_id, run_s, step):
    run, step = _utc(run_s), int(step)
    p = frame_dir(ens_id, run, 'mslp') / f'{step}.bin'
    if not p.exists():                                   # the members are made first (as the Chances view would)
        make_members(ens_id, run.isoformat(), 'mslp', step)
    for _ in range(40):
        if p.exists():
            break
        time.sleep(0.5)
    if not p.exists():
        raise KeyError(f'{ens_id} has no pressure at T+{step}')
    m, head = read_members(p)                            # (members, cny, cnx), hPa
    k = int(head.get('k', 3))
    lon, lat = lonlat()
    clon, clat = lon[(k - 1) // 2::k, (k - 1) // 2::k][:m.shape[1], :m.shape[2]], lat[(k - 1) // 2::k, (k - 1) // 2::k][:m.shape[1], :m.shape[2]]
    inbox = (clon >= BOX[0]) & (clon <= BOX[1]) & (clat >= BOX[2]) & (clat <= BOX[3])
    rows, cols = np.where(inbox)
    j0, j1, i0, i1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    sub = m[:, j0:j1, i0:i1]
    ok = inbox[j0:j1, i0:i1] & np.isfinite(sub).all(0)
    X = sub[:, ok]                                       # (members, cells)
    w = np.sqrt(np.cos(np.radians(clat[j0:j1, i0:i1][ok])))
    A = (X - X.mean(0)) * w
    U, S, _ = np.linalg.svd(A, full_matrices=False)
    var = S ** 2 / max((S ** 2).sum(), 1e-9)
    npc = int(min(8, max(2, np.searchsorted(np.cumsum(var), 0.9) + 1)))
    P = U[:, :npc] * S[:npc]
    n = len(X)
    spread = float(np.sqrt(X.var(0).mean()))             # hPa: how far the members are apart, on the whole
    choice = None
    if spread >= 1.5:                                     # closer than that they agree: one scenario
        for kk in (2, 3, 4):
            lab, _, _ = _kmeans(P, kk)
            sizes = np.bincount(lab, minlength=kk)
            if sizes.min() < max(3, int(np.ceil(0.1 * n))):
                continue
            sil = _silhouette(P, lab)
            if choice is None or sil > choice[1] + 0.02:   # more scenarios only when they are clearly better apart
                choice = (lab, sil)
    lab = choice[0] if choice else np.zeros(n, int)
    mean_all = sub.mean(0)
    uk = (clon[j0:j1, i0:i1] >= UK[0]) & (clon[j0:j1, i0:i1] <= UK[1]) & (clat[j0:j1, i0:i1] >= UK[2]) & (clat[j0:j1, i0:i1] <= UK[3])
    out = []
    order = sorted(set(lab.tolist()), key=lambda j: -(lab == j).sum())
    lo, hi = 940.0, 1060.0
    for j in order:
        mem = np.flatnonzero(lab == j)
        f = sub[mem].mean(0)
        diff = f - mean_all
        d_uk = float(np.nanmean(diff[uk])) if uk.any() else 0.0
        jj, ii = np.unravel_index(np.nanargmax(np.abs(np.where(ok, diff, 0))), diff.shape)
        bearing = np.degrees(np.arctan2(clon[j0 + jj, i0 + ii] - (-2.5), clat[j0 + jj, i0 + ii] - 54.5)) % 360
        q = np.where(np.isfinite(f), np.clip(np.rint((f - lo) / (hi - lo) * 254), 0, 254), 255).astype(np.uint8)
        out.append({
            'members': [int(x) + 1 for x in mem], 'share': round(len(mem) / n, 3),
            'uk_diff_hpa': round(d_uk, 1), 'uk_mslp': round(float(np.nanmean(f[uk])), 1) if uk.any() else None,
            'biggest': {'diff_hpa': round(float(diff[jj, ii]), 1), 'towards': COMPASS[int(((bearing + 22.5) % 360) // 45)]},
            'mslp': base64.b64encode(q.tobytes()).decode(),
        })
    return {
        'ensemble': ens_id, 'run': run.isoformat(), 'step': step, 'valid': (run.timestamp() + step * 3600) * 1000, 'members': n,
        'separation': round(choice[1], 2) if choice else None, 'spread_hpa': round(spread, 1),
        'distinct': None if not choice else 'clearly' if choice[1] >= 0.25 else 'fairly' if choice[1] >= 0.18 else 'only in detail',
        'k': k, 'box': [int(j0), int(j1), int(i0), int(i1)],
        'lo': lo, 'hi': hi, 'scenarios': out,
    }


if __name__ == '__main__':
    import warnings
    warnings.filterwarnings('ignore')
    try:
        print(json.dumps(scenarios(*sys.argv[1:4]), separators=(',', ':')))
    except Exception as e:                                # noqa: BLE001
        print(json.dumps({'error': f'{type(e).__name__}: {e}'[:300]}))
        sys.exit(1)
