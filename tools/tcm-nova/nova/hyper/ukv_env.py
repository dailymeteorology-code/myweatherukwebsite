"""Hyper-Short atmospheric environment from the LATEST UKV run (user instruction, 18 Oct 2026:
"get the other data for the hyper-short run from actual weather models — must be from the
latest UKV"). UKV is the only model Hyper-Short may read; tests enforce that.

UKV supplies what radar and lightning cannot: the 3-D temperature, humidity and wind, so
CAPE/CIN/LCL/LFC/shear/SRH/DCAPE/freezing levels, plus UKV's own lightning, hail,
precipitation and gust fields. Diagnostics are computed on UKV's own ~2 km columns (its
real resolution) on the NOVA 2 km grid, then remapped bilinearly to the 1.5 km grid —
1.5 km output does not pretend UKV has 1.5 km detail.

Blending with the observation nowcast is engine2.blend_weight: STEPS skill weights, the
hand-over coming where the nowcast's measured correlation falls to UKV's current skill
against the radar (Bowler et al. 2006).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
from scipy import ndimage

from ..grid import Grid
from ..io_aws import log
from ..sources import UKV

ENV_FIELDS = ['mu_cape', 'sb_cape', 'ml_cape', 'ml_cin', 'mu_cin', 'dcape', 'ml_lcl_z', 'mu_lfc_z', 'mu_el_z', 'lifted_index',
              'freezing_level', 'wbz', 'pw', 'shear_0_1km', 'shear_0_6km', 'srh_0_1km', 'srh_0_3km', 'esrh', 'scp', 'stp',
              'storm_u', 'storm_v', 'lapse_700_500', 'pbl_height']


def env_hours(horizon_h=24):
    return list(range(0, 13)) + list(range(15, horizon_h + 1, 3))


def to_fine(a, coarse: Grid, fine: Grid):
    """Bilinear remap between two BNG grids sharing an origin."""
    yy, xx = np.indices(fine.shape, dtype=np.float32)
    fx = ((xx + 0.5) * fine.dx) / coarse.dx - 0.5
    fy = ((yy + 0.5) * fine.dx) / coarse.dx - 0.5
    if a.dtype.kind in 'iu':
        return ndimage.map_coordinates(a, [fy, fx], order=0, mode='nearest')
    ok = np.isfinite(a)
    out = ndimage.map_coordinates(np.where(ok, a, 0), [fy, fx], order=1, mode='nearest').astype(np.float32)
    if not ok.all():                                    # keep 'undefined' undefined (e.g. CIN with no LFC)
        m = ndimage.map_coordinates(ok.astype(np.float32), [fy, fx], order=1, mode='nearest')
        out = np.where(m >= 0.5, out / np.maximum(m, 1e-6), np.nan).astype(np.float32)
    return out


class UKVEnvironment:
    """The UKV half of Hyper-Short, on the TCM V5 engine (hyper/v5env.py).

    Uses the newest UKV cycle whose V5 environment has been published (computed in
    parallel as soon as the cycle reached AWS); computes any missing hour on the spot.
    Fields arrive on the V5 2 km grid and are remapped to the 1.5 km grid here, so the
    1.5 km output does not pretend UKV has 1.5 km detail."""

    def __init__(self, init):
        from ..config import CACHE
        self.init = init
        self.fine = Grid.get('gb1p5km')
        self.reader = UKV()
        self.cache = {}
        self.run = None
        d = CACHE / 'ukvenv'
        if d.exists():
            need = [init + timedelta(hours=h) for h in env_hours()]
            for c in sorted((p.name for p in d.iterdir() if p.is_dir() and any(p.glob('*.npz'))), reverse=True):
                cyc = datetime.strptime(c, '%Y%m%dT%H%MZ').replace(tzinfo=timezone.utc)
                have = sum((d / c / f'{vt:%Y%m%dT%H%MZ}.npz').exists() for vt in need)
                if timedelta(0) <= init - cyc <= timedelta(hours=12) and have >= len(need) - 2:
                    self.run = cyc
                    break
        if self.run is None:
            self.run = self.reader.find_run(init, need_lead_h=24) or self.reader.find_run(init, need_lead_h=12)
        log(f'hyper: UKV run {self.run} (TCM V5 environment)')

    def at_hour(self, vt):
        if vt in self.cache:
            return self.cache[vt]
        out = None
        if self.run is not None:
            from . import v5env
            from .. import v5_bridge as B
            try:
                f = v5env.load(self.run, vt)
            except Exception as e:
                log(f'hyper: V5 UKV environment failed for {vt:%d %HZ}: {e!r}')
                f = None
            if f:
                out = {}
                for k, a in f.items():
                    name = k if k in ENV_FIELDS or k in ('t2', 'td2', 'u10', 'v10') else 'ukv_' + k
                    if k == 'precip':
                        name = 'ukv_precip'
                    out[name] = B.to_nova(a, self.fine).astype(np.float32)
        if len(self.cache) > 2:
            self.cache.pop(min(self.cache))
        self.cache[vt] = out
        return out

    def at(self, vt):
        """Environment at any valid time: exact UKV hour or linear in time between the
        bracketing computed hours (never beyond the run's last available hour)."""
        hrs = [self.init + timedelta(hours=h) for h in env_hours()]
        if vt in hrs:
            e = self.at_hour(vt)
            return dict(e) if e else None
        lo = max(h for h in hrs if h <= vt)
        hi = min(h for h in hrs if h >= vt)
        a, b = self.at_hour(lo), self.at_hour(hi)
        if not a or not b:
            return None
        w = (vt - lo).total_seconds() / (hi - lo).total_seconds()
        return {k: (a[k] * (1 - w) + b[k] * w).astype(np.float32) for k in a if k in b}
