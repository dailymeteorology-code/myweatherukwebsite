"""Hold the vectorised chain to V5's own scalar chain, cell by cell.

    python -m nova.v5x.verify <run YYYYmmddTHH> <forecast hour> [n_cells]

Uses a frame already in the V5 field store (D:/TCM-NOVA/v5). Runs V5's
`gridchain._forecast_cell` (engines, stages, aggregation, hazards, confidence,
uncertainty) on sampled cells and compares every output with `nova.v5x`.
"""
from __future__ import annotations

import logging
import pickle
import sys
import time
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

logging.disable(logging.WARNING)
warnings.filterwarnings('ignore')

from .. import v5_bridge as B  # noqa: E402
from ..config import CACHE  # noqa: E402
from . import engines as EV, features as FV, stages as SV  # noqa: E402
from . import core as CORE  # noqa: E402
CORE.EXACT_ROUND = True


def gridded(run, fh):
    path = CACHE / f'v5x_gp_{run:%Y%m%dT%H}_{fh:03d}.pkl'
    if path.exists():
        return pickle.loads(path.read_bytes())
    from app.parameters.gridparams import compute_grid
    from app.profiles.build import build_profile
    t = time.time()
    cube = build_profile('ukv', run, fh, provider=B.PROVIDER, grid_id=B.V5_GRID.name)
    gp = compute_grid(cube)
    print(f'compute_grid {time.time() - t:.0f}s', flush=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pickle.dumps(gp))
    return gp


def spatial(run, fh):
    from app.grid import grid_lonlat
    from app.pipeline.ingest import load_field
    from app.spatial import intelligence as SI
    from app.spatial import static as SS

    def fld(n):
        f = load_field('ukv', run, n, fh)
        return None if f is None else f.values
    geo = SS.load('ukv', refresh=True)
    return SI.build(geo, SI.AtmosphericInputs(
        u=fld('u_wind_10m'), v=fld('v_wind_10m'), temperature=fld('temperature_2m'),
        theta_e=fld('wet_bulb_potential_temperature_850'), boundary_layer_depth=fld('boundary_layer_height'),
        cape=fld('cape_surface'), cin=fld('cin'), wind_level='10m'),
        model='ukv', run=run, valid_time=run + timedelta(hours=fh), lonlat=grid_lonlat(B.V5_GRID))


def forcing_arrays(si):
    from app.spatial.integrate import STAGE5_FORCING
    out = {}
    for s5, fname in STAGE5_FORCING.items():
        f = si.features.get(fname) if si is not None else None
        if f is not None and f.usable:
            out[s5] = f.masked()
    elev = None
    f = si.features.get('elevation') if si is not None else None
    if f is not None and f.usable:
        elev = f.masked()
    return out, elev


def vectorised(gp, si, lons, fixes=False, levels=0):
    forcing, elev = forcing_arrays(si)
    F = FV.build(gp, elevation=elev, forcing=forcing)
    hour = FV.local_solar_hour(gp.valid_time, lons)
    R = EV.run_all(F, hour, levels=levels, fixes=fixes)
    sf = SV.source_forecast(R)
    agg = SV.aggregate([('ukv', None, sf)], None, lead_h=gp.forecast_hour)
    return R, sf, agg


def main():
    run = datetime.strptime(sys.argv[1], '%Y%m%dT%H').replace(tzinfo=timezone.utc)
    fh = int(sys.argv[2])
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 400
    from app.grid import grid_lonlat
    from app.tcm import gridchain as GC
    from app.engines import pipeline as EP
    from app.spatial import integrate as SPI
    gp = gridded(run, fh)
    lons, lats = grid_lonlat(B.V5_GRID)
    t = time.time()
    si = spatial(run, fh)
    print(f'spatial {time.time() - t:.1f}s', flush=True)
    t = time.time()
    R, sf, agg = vectorised(gp, si, lons)
    print(f'vectorised stages 5-7, whole grid: {time.time() - t:.2f}s', flush=True)

    GC._init_worker(gp, lons, lats, 'ukv', si)
    mu = gp.value('mucape')
    rng = np.random.default_rng(1)
    cand = np.argwhere(np.isfinite(mu))
    # half random, half from the most unstable cells so the interesting branches are exercised
    hot = cand[np.argsort(-mu[tuple(cand.T)])[: max(1, n // 2) * 20]]
    pick = np.concatenate([cand[rng.choice(len(cand), n // 2, replace=False)],
                           hot[rng.choice(len(hot), n - n // 2, replace=False)]])
    worst = {}
    eng_worst = {}
    t = time.time()
    for iy, ix in pick:
        iy, ix = int(iy), int(ix)
        res = GC._forecast_cell(iy, ix, gp, lons, lats, 1)
        # per-engine reference
        params = gp.at(iy, ix, latitude=float(lats[iy, ix]), longitude=float(lons[iy, ix]))
        sup = SPI.stage5_forcing(si, iy, ix)
        spec = EP.run_for_parameters(params, elevation=sup.context.get('elevation'), forcing=sup.as_overrides())
        for e in spec.results:
            vr = R[e.engine]
            for key, ref, vec in (('score', e.score if e.status.has_score else None, vr['score'][iy, ix]),
                                  ('conf', e.confidence, vr['conf'][iy, ix]),
                                  ('unc', e.uncertainty, vr['unc'][iy, ix])):
                d = _diff(ref, vec)
                k = f'{e.engine}.{key}'
                if d > eng_worst.get(k, (-1,))[0]:
                    eng_worst[k] = (d, iy, ix, ref, float(vec))
        if res is None:
            d = 0.0 if not np.isfinite(agg['probability'][iy, ix]) else 1.0
            worst['probability'] = max(worst.get('probability', (0,)), (d, iy, ix))
            continue
        p, raw, conf, unc, hz, _ = res
        for key, ref, vec in (('probability', p, agg['probability'][iy, ix]),
                              ('confidence', conf, agg['confidence'][iy, ix]),
                              ('uncertainty', unc, agg['uncertainty'][iy, ix])):
            d = _diff(ref, vec)
            if d > worst.get(key, (-1,))[0]:
                worst[key] = (d, iy, ix, ref, float(vec))
        for name, ref in hz.items():
            vec = agg['hazards'][name]['probability'][iy, ix]
            d = _diff(ref, vec)
            if d > worst.get(name, (-1,))[0]:
                worst[name] = (d, iy, ix, ref, float(vec))
    dt = time.time() - t
    print(f'V5 scalar reference: {len(pick)} cells in {dt:.1f}s ({1000 * dt / len(pick):.1f} ms/cell)')
    print('ENGINES (max abs difference, cell, V5, vectorised):')
    for k, v in sorted(eng_worst.items()):
        print(f'  {k:38s} {v[0]:.2e}  {v[1:]}')
    print('FORECAST:')
    for k, v in sorted(worst.items()):
        print(f'  {k:38s} {v[0]:.2e}  {v[1:]}')
    bad = [k for k, v in list(worst.items()) + list(eng_worst.items()) if v[0] > 2e-4]
    print('RESULT:', 'PASS' if not bad else f'FAIL {bad}')


def _diff(ref, vec):
    rf = ref is not None and np.isfinite(ref)
    vf = vec is not None and np.isfinite(vec)
    if not rf and not vf:
        return 0.0
    if rf != vf:
        return 1.0
    return abs(float(ref) - float(vec))


if __name__ == '__main__':
    main()
