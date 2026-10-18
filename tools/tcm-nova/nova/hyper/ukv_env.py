"""Hyper-Short atmospheric environment from the LATEST UKV run (user instruction, 18 Oct 2026:
"get the other data for the hyper-short run from actual weather models — must be from the
latest UKV"). UKV is the only model Hyper-Short may read; tests enforce that.

UKV supplies what radar and lightning cannot: the 3-D temperature, humidity and wind, so
CAPE/CIN/LCL/LFC/shear/SRH/DCAPE/freezing levels, plus UKV's own lightning, hail,
precipitation and gust fields. Diagnostics are computed on UKV's own ~2 km columns (its
real resolution) on the NOVA 2 km grid, then remapped bilinearly to the 1.5 km grid —
1.5 km output does not pretend UKV has 1.5 km detail.

Blending with the observation nowcast (`blend_weight`): the nowcast dominates the first
hour and fades with an e-folding of 90 min (as in STEPS-style nowcast/NWP blending,
Bowler et al. 2006); beyond ~4 h the forecast is essentially UKV's.
"""
from __future__ import annotations

from datetime import timedelta

import numpy as np
from scipy import ndimage

from .. import hazards as hz
from .. import terrain
from ..grid import Grid
from ..io_aws import log
from ..main_run import environment, prepare
from ..sources import UKV

ENV_FIELDS = ['mu_cape', 'sb_cape', 'ml_cape', 'ml_cin', 'mu_cin', 'dcape', 'ml_lcl_z', 'mu_lfc_z', 'mu_el_z', 'lifted_index',
              'freezing_level', 'wbz', 'pw', 'shear_0_1km', 'shear_0_6km', 'srh_0_1km', 'srh_0_3km', 'esrh', 'scp', 'stp',
              'storm_u', 'storm_v', 'lapse_700_500', 'pbl_height']


def blend_weight(lead_min):
    """Weight of the observation nowcast at a lead time (UKV gets 1 − w)."""
    return float(np.exp(-lead_min / 90.0))


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
    def __init__(self, init):
        self.init = init
        self.coarse = Grid.get('gb2km')
        self.fine = Grid.get('gb1p5km')
        self.reader = UKV()
        self.run = self.reader.find_run(init, need_lead_h=24) or self.reader.find_run(init, need_lead_h=12)
        self.terr = terrain.load('gb2km')
        self.cache = {}
        log(f'hyper: UKV run {self.run}')

    def at_hour(self, vt):
        if vt in self.cache:
            return self.cache[vt]
        out = None
        if self.run is not None:
            f = self.reader.frame(self.run, vt, self.coarse, 1)
            if f and 'pl' in f:
                f = prepare('ukv', f, self.coarse, self.terr)
                prof = dict(f['pl'])
                D, ps, t2, td2, q2 = environment(prof, f['sfc'], self.terr, self.coarse)
                sfc = f['sfc']
                sig = hz.model_signal(sfc, D['mu_cape'])
                fields = {k: D[k] for k in ENV_FIELDS if k in D}
                fields.update(t2=t2, td2=td2, u10=sfc['u10'], v10=sfc['v10'], ukv_signal=sig,
                              ukv_precip=sfc.get('precip', np.zeros(self.coarse.shape, np.float32)),
                              ukv_lightning=np.nan_to_num(sfc.get('lightning', np.zeros(self.coarse.shape, np.float32))),
                              ukv_hail=np.nan_to_num(sfc.get('hail', np.zeros(self.coarse.shape, np.float32))),
                              gust=sfc.get('gust', np.zeros(self.coarse.shape, np.float32)))
                # UKV hazard probabilities through the same deterministic hazard code as the Main Run
                from ..diagnostics import grid_diagnostics
                flow = terrain.flow_diagnostics(self.terr, self.coarse, np.nanmean(prof['u'][:3], 0),
                                                np.nanmean(prof['v'][:3], 0), D['bv_freq_0_2km'])
                Gd = grid_diagnostics({'u10': sfc['u10'], 'v10': sfc['v10'], 'q2': q2}, self.coarse.lonlat[1], self.coarse.dx)
                F = dict(sfc, conv_10m=Gd['conv_10m'], q2=q2, t2=t2)
                lead_h = (vt - self.init).total_seconds() / 3600
                H = hz.compute(F, D, self.terr, flow, {'ukv': np.nan_to_num(sig)}, {},
                               {'ukv': np.ones(self.coarse.shape, np.float32)}, {}, self.coarse.dx, lead_h)
                for k in ('p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_supercell',
                          'p_tornado_env', 'p_heavy_rain', 'p_severe', 'hail_size_max_cm', 'gust_max', 'flash_density'):
                    fields['ukv_' + k] = H[k]
                out = {k: to_fine(np.asarray(v, np.float32), self.coarse, self.fine) for k, v in fields.items() if v is not None}
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
