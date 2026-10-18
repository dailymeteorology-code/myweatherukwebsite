"""Probability calibration for TCM NOVA.

    python -m nova.calibrate hindcast 2026-07-01 2026-10-15 --every 5     # build the sample
    python -m nova.calibrate fit                                            # fit + cross-validate

1. HINDCAST. NOVA's own Main Run is re-run for past initialisations from the archived
   AWS forecasts (UKV, MO Global, IFS, IFS ENS, AIFS, AIFS ENS, GFS, GEFS — DWD keeps
   only ~24 h online, so ICON is absent from hindcasts and that is recorded).
   Runs go to their own namespace (`hindcast/`), never mixed with live runs.
2. EVENTS (independent observations). A thunderstorm event at a cell/valid time is
   observed when, within the forecast's own neighbourhood radius and ±90 min:
     radar rain rate ≥ 25 mm/h (≈45 dBZ, the conventional convective-core threshold), or
     a lightning strike in the local archive.
   Radar cores are a PROXY for thunder (some heavy showers are not electrified); this is
   stated in the calibration record.
3. FIT. Pool-adjacent-violators (isotonic) reliability mapping p_raw -> observed frequency,
   per lead window, on a spatially thinned sample (every 4th cell each way, to reduce
   neighbour autocorrelation). Deterministic statistics, not machine learning of fields.
4. VALIDATION. Leave-one-day-out: each day's Brier score is computed with a mapping fitted
   on the other days. The mapping is only applied if it improves the cross-validated Brier
   score; otherwise the record says "not applied".
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
from scipy import ndimage

from . import store
from .config import DATA
from .grid import Grid, coarsen_sampler
from .hyper import obs
from .io_aws import log
from .weights import WINDOWS, window_index

CAL_FILE = DATA / 'calibration.json'
THIN = 4
CORE_MMH = 25.0


def pav(x, y, w=None):
    """Isotonic regression by pool-adjacent-violators. Returns knots (x, fitted y)."""
    order = np.argsort(x)
    x, y = np.asarray(x, float)[order], np.asarray(y, float)[order]
    w = np.ones_like(y) if w is None else np.asarray(w, float)[order]
    blocks = [[y[i], w[i], x[i], x[i]] for i in range(len(y))]
    out = []
    for b in blocks:
        out.append(b)
        while len(out) > 1 and out[-2][0] > out[-1][0]:
            v2, w2, lo2, hi2 = out.pop()
            v1, w1, lo1, hi1 = out.pop()
            out.append([(v1 * w1 + v2 * w2) / (w1 + w2), w1 + w2, lo1, hi2])
    xs = np.array([(b[2] + b[3]) / 2 for b in out])
    ys = np.array([b[0] for b in out])
    return xs, ys


def binned(p, o, nbins=20):
    """Collapse a huge sample into bins (equal-width in p) before PAV."""
    idx = np.minimum((p * nbins).astype(int), nbins - 1)
    n = np.bincount(idx, minlength=nbins)
    pm = np.bincount(idx, p, minlength=nbins) / np.maximum(n, 1)
    om = np.bincount(idx, o, minlength=nbins) / np.maximum(n, 1)
    keep = n > 0
    return pm[keep], om[keep], n[keep]


def apply_curve(p, curve):
    if not curve or not curve.get('applied'):
        return p
    xs, ys = np.asarray(curve['x']), np.asarray(curve['y'])
    return np.interp(p, np.r_[0, xs, 1], np.r_[0, ys, ys[-1]]).astype(np.float32)


_CACHE = {}


def calibrate_field(p, lead_h, field='p_thunder'):
    """Used by the Main Run: map a raw probability through the fitted curve for its lead window."""
    if 'cal' not in _CACHE:
        try:
            _CACHE['cal'] = json.loads(CAL_FILE.read_text())
        except Exception:
            _CACHE['cal'] = {}
    cur = _CACHE['cal'].get(field, {}).get(str(window_index(lead_h)))
    return apply_curve(p, cur), bool(cur and cur.get('applied'))


# ── hindcast ──────────────────────────────────────────────────────────────────

def hindcast(days, local_hour=9, horizon=24):
    from .main_run import run
    for d in days:
        init = datetime(d.year, d.month, d.day, local_hour, tzinfo=ZoneInfo('Europe/London')).astimezone(timezone.utc)
        try:
            run(init, horizon, product='hindcast',
                sources=['ukv', 'mo_global', 'ifs', 'ifs_ens', 'aifs', 'aifs_ens', 'gfs', 'gefs'])
        except FileExistsError:
            log(f'hindcast {d}: exists')
        except Exception as e:
            log(f'hindcast {d} failed: {e}')


def observed_events(grid, vt, radius_cells, strikes):
    """Radar cores (and archived lightning) within ±90 min, dilated by the neighbourhood."""
    ev = np.zeros(grid.shape, bool)
    n_ok = 0
    for m in range(-90, 91, 15):
        t = vt + timedelta(minutes=m)
        try:
            r = obs.read_radar(t)
        except Exception:
            continue
        rr = coarsen_sampler(grid, r['projdef'], r['x'], r['y'])(np.where(r['rate'] > 250, np.nan, r['rate']))
        ev |= np.nan_to_num(rr) >= CORE_MMH
        n_ok += 1
    if strikes is not None and len(strikes):
        from pyproj import Transformer
        tr = Transformer.from_crs('EPSG:4326', grid.crs, always_xy=True)
        tt = strikes[:, 0]
        sel = np.abs(tt - vt.timestamp()) <= 5400
        if sel.any():
            x, y = tr.transform(strikes[sel, 2], strikes[sel, 1])
            ix, iy = (x // grid.dx).astype(int), (y // grid.dx).astype(int)
            ok = (ix >= 0) & (ix < grid.nx) & (iy >= 0) & (iy < grid.ny)
            ev[iy[ok], ix[ok]] = True
    if n_ok < 5:
        return None
    r = max(1, int(radius_cells))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    return ndimage.binary_dilation(ev, structure=(xx * xx + yy * yy) <= r * r)


def local_strikes():
    """Archived strikes from the site's lightning archive (server/data/aiw/strikes)."""
    from .config import REPO
    rows = []
    for f in (REPO / 'server' / 'data' / 'aiw' / 'strikes').glob('*/*.csv'):
        try:
            a = np.loadtxt(f, delimiter=',', ndmin=2, usecols=(0, 1, 2))
            a = a[(a[:, 1] > 49) & (a[:, 1] < 61.5) & (a[:, 2] > -11) & (a[:, 2] < 3)]
            if a.size:
                a[:, 0] /= 1000.0
                rows.append(a)
        except Exception:
            pass
    return np.concatenate(rows) if rows else None


def collect():
    grid = Grid.get('gb2km')
    strikes = local_strikes()
    samples = {}
    for rd in sorted((DATA / 'hindcast').glob('hindcast-*')):
        if rd.name.endswith('.partial'):
            continue
        m = json.loads((rd / 'manifest.json').read_text())
        day = m['init_utc'][:10]
        for fr in m['frames']:
            if not fr.get('valid') or 'p_thunder_raw' not in m['fields']:
                continue
            vt = datetime.fromisoformat(fr['valid'])
            r = (10 + 0.35 * fr['lead_h']) * 1000 / grid.dx
            ev = observed_events(grid, vt, r, strikes)
            if ev is None:
                continue
            for field in ('p_thunder', 'p_lightning'):
                raw_name = 'p_thunder_uncal' if field == 'p_thunder' else 'p_lightning_uncal'
                name = raw_name if raw_name in m['fields'] else field
                p = store.read_frame('hindcast', rd.name, fr['lead_min'], name, grid.shape).astype(np.float32)
                pp, oo = p[::THIN, ::THIN].ravel(), ev[::THIN, ::THIN].ravel().astype(np.float32)
                ok = np.isfinite(pp)
                samples.setdefault(field, {}).setdefault(str(window_index(fr['lead_h'])), []).append((day, pp[ok], oo[ok]))
        log(f'collected {rd.name}')
    return samples


def fit():
    samples = collect()
    out = {'event_definition': f'radar >= {CORE_MMH} mm/h (convective-core proxy) or archived lightning, within the forecast neighbourhood, ±90 min',
           'method': 'isotonic (pool-adjacent-violators) reliability mapping, binned; leave-one-day-out cross-validation',
           'fitted_utc': datetime.now(timezone.utc).isoformat(), 'thinning': THIN}
    for field, by_win in samples.items():
        out[field] = {}
        for wi, rows in by_win.items():
            days = sorted({d for d, _, _ in rows})
            P = np.concatenate([p for _, p, _ in rows])
            O = np.concatenate([o for _, _, o in rows])
            bx, by_, bn = binned(P, O)
            xs, ys = pav(bx, by_, bn)
            bs_raw, bs_cv = [], []
            for d in days:                                 # leave-one-day-out
                tr = [(p, o) for dd, p, o in rows if dd != d]
                te = [(p, o) for dd, p, o in rows if dd == d]
                if not tr or not te:
                    continue
                tp, to = np.concatenate([a for a, _ in tr]), np.concatenate([b for _, b in tr])
                cx, cy = pav(*binned(tp, to)[:2], binned(tp, to)[2])
                ep, eo = np.concatenate([a for a, _ in te]), np.concatenate([b for _, b in te])
                bs_raw.append(np.mean((ep - eo) ** 2))
                bs_cv.append(np.mean((apply_curve(ep, {'applied': True, 'x': cx.tolist(), 'y': cy.tolist()}) - eo) ** 2))
            clim = float(O.mean())
            br, bc = (float(np.mean(bs_raw)), float(np.mean(bs_cv))) if bs_raw else (None, None)
            applied = bool(br is not None and bc < br and len(days) >= 8)
            out[field][wi] = {
                'window': f'{WINDOWS[int(wi)][0]}-{WINDOWS[int(wi)][1]} h', 'x': xs.round(4).tolist(), 'y': ys.round(4).tolist(),
                'n_samples': int(P.size), 'n_days': len(days), 'event_rate': round(clim, 4),
                'brier_raw_cv': br, 'brier_calibrated_cv': bc,
                'bss_vs_climatology_cv': None if bc is None or clim in (0, 1) else round(1 - bc / (clim * (1 - clim)), 4),
                'reliability_bins': {'p': bx.round(3).tolist(), 'obs': by_.round(4).tolist(), 'n': bn.tolist()},
                'applied': applied,
                'why_not_applied': None if applied else ('fewer than 8 days' if len(days) < 8 else 'did not improve cross-validated Brier'),
            }
    store._write_json(CAL_FILE, out)
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['hindcast', 'fit'])
    ap.add_argument('start', nargs='?')
    ap.add_argument('end', nargs='?')
    ap.add_argument('--every', type=int, default=4)
    a = ap.parse_args()
    if a.cmd == 'hindcast':
        d0, d1 = datetime.fromisoformat(a.start).date(), datetime.fromisoformat(a.end).date()
        days = [d0 + timedelta(days=i) for i in range(0, (d1 - d0).days + 1, a.every)]
        hindcast(days)
    else:
        r = fit()
        print(json.dumps({f: {w: {k: v[k] for k in ('n_days', 'event_rate', 'brier_raw_cv', 'brier_calibrated_cv', 'applied')}
                              for w, v in d.items()} for f, d in r.items() if isinstance(d, dict) and f.startswith('p_')}, indent=1))
