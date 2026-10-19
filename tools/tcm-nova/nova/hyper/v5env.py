"""Hyper-Short's UKV environment on the TCM V5 engine.

Hyper-Short blends an observation nowcast with the latest UKV. The UKV half is now the
same TCM V5 chain as the Main Run (one model: UKV), computed AS SOON AS a new UKV cycle
lands on AWS -- in parallel GitHub jobs, one valid hour per task -- and published to the
`nova-ukvenv` release. The hourly Hyper-Short run then only reads it, so it is not slowed
by the physics. Anything missing is computed on the spot.

    python -m nova.hyper.v5env --cycle 2026-10-19T12:00Z --hours 4,10,16

Files: <CACHE>/ukvenv/<cycle>/<valid>.npz on the V5 2 km grid (float32).
"""
from __future__ import annotations

import argparse
import logging
import time
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

from ..config import CACHE
from ..io_aws import log

FIELDS_OUT = ('p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst',
              'p_tornado_env', 'p_heavy_rain', 'p_severe', 'p_initiation', 'confidence', 'uncertainty',
              'mu_cape', 'sb_cape', 'ml_cape', 'ml_cin', 'mu_cin', 'dcape', 'ml_lcl_z', 'mu_lfc_z', 'mu_el_z',
              'freezing_level', 'wbz', 'pw', 'lapse_700_500', 'shear_0_1km', 'shear_0_6km', 'srh_0_1km',
              'srh_0_3km', 'pbl_height', 't2', 'td2', 'u10', 'v10', 'precip', 'flash_density', 'gust_max')


def path(cycle, vt):
    return CACHE / 'ukvenv' / f'{cycle:%Y%m%dT%H%MZ}' / f'{vt:%Y%m%dT%H%MZ}.npz'


def compute(cycle, vt):
    """The V5 chain on UKV `cycle` at valid time `vt`. Saves and returns the fields."""
    from .. import terrain, v5_blend as VB
    from ..main_run import SourceCache
    from ..sources import UKV
    from ..v5x import pipeline as PL
    g = VB.grid()
    terr = terrain.load(VB.GRID_NAME)
    cache = SourceCache('ukv', UKV(), cycle, g, terr)
    f = cache.at(vt)
    if not f or 'pl' not in f:
        return None
    lead = (vt - cycle).total_seconds() / 3600
    out, meta = PL.run_frame({'ukv': f}, lead, {'ukv': cycle}, terr, g, run=cycle, valid_time=vt, workers=1)
    if out is None:
        return None
    keep = {k: np.asarray(out[k], np.float32) for k in FIELDS_OUT if k in out}
    p = path(cycle, vt)
    p.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(p, **keep)
    return keep


def load(cycle, vt, compute_missing=True):
    p = path(cycle, vt)
    if p.exists():
        z = np.load(p)
        return {k: z[k] for k in z.files}
    return compute(cycle, vt) if compute_missing else None


def main():
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    ap = argparse.ArgumentParser()
    ap.add_argument('--cycle', required=True)
    ap.add_argument('--hours', required=True, help='lead hours from the cycle, comma-separated')
    a = ap.parse_args()
    cycle = datetime.fromisoformat(a.cycle.replace('Z', '+00:00')).astimezone(timezone.utc)
    for h in (int(x) for x in a.hours.split(',') if x.strip()):
        t = time.time()
        vt = cycle + timedelta(hours=h)
        res = compute(cycle, vt)
        log(f'ukv-env {cycle:%d %HZ} T+{h}: {"ok" if res else "no data"} ({time.time() - t:.0f}s)')


if __name__ == '__main__':
    main()
