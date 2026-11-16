"""The ensembles in Forecast mode (15 Nov 2026, at the user's request: "add ECMWF ENS"): each
layer the mean of the members, and for some the spread between them or the most extreme member.

ECMWF's open data has no ensemble mean any more (only the members, 'ef'), so the mean is worked
out here from the members the Chances view already keeps (mdata/ens.py: every member of a field on
a coarse version of the wide grid, 30 km cells, about the ensembles' own 18-28 km). A layer's job
makes that field's members first if they are not there yet (no extra downloads when the Chances
view has them), then each step's mean is drawn back up onto the display grid, smoothly.

    ecmwf_ensm   ECMWF ENS, 50 members, 0.25 deg, 6-hourly to T+240 (T+144 from 06Z and 18Z)
    aifs_ensm    ECMWF AIFS ENS (machine-learned), 50 members, 6-hourly to T+360
"""
from __future__ import annotations

import gzip
import json
import struct

import numpy as np

from .common import NX, NY, smooth_sample

# our layer: (the ensemble's field, the statistic)
SRC = {
    't2': ('t2', 'mean'), 't2_spread': ('t2', 'std'),
    'mslp': ('mslp', 'mean'), 'mslp_spread': ('mslp', 'std'),
    'wind10': ('wind', 'mean'), 'gust10': ('gust', 'mean'), 'gust_ensmax': ('gust', 'max'),
    'precip_6h': ('precip_6h', 'mean'), 'precip_24h': ('precip_24h', 'mean'), 'precip_24h_ensmax': ('precip_24h', 'max'),
    'snow_24h': ('snow_24h', 'mean'), 'runoff_24h': ('runoff_24h', 'mean'),
    'cape_mu': ('cape', 'mean'), 'tcc': ('tcc', 'mean'),
}

VARIABLES_ENS = {
    't2_spread': dict(label='Temperature spread (2 m)', unit='°C', group='Temperature', lo=0, hi=10),
    'mslp_spread': dict(label='Pressure spread', unit='hPa', group='Wind & pressure', lo=0, hi=20),
    'gust_ensmax': dict(label='Strongest gust (any member)', unit='mph', group='Wind & pressure', lo=0, hi=150),
    'precip_24h_ensmax': dict(label='Wettest member (24 h)', unit='mm', group='Precipitation', lo=0, hi=300, scale='sqrt'),
    'snow_24h': dict(label='Snowfall in 24 hours (10:1)', unit='cm', group='Snow & ice', lo=0, hi=100, scale='sqrt'),
    'runoff_24h': dict(label='Runoff in 24 hours', unit='mm', group='Precipitation', lo=0, hi=200, scale='sqrt'),
}


def read_members(path):
    """An ensemble frame (mdata/ens.py main) -> (members, ny, nx) float32 in its units, and its head."""
    raw = gzip.decompress(path.read_bytes())
    n = struct.unpack('<I', raw[:4])[0]
    head = json.loads(raw[4:4 + n])
    b = np.frombuffer(raw[4 + n:], np.uint8).reshape(head['members'], head['ny'], head['nx'])
    lo, hi = float(head['lo']), float(head['hi'])
    q = b.astype(np.float32) / 254.0
    if head.get('scale') == 'sqrt':
        v = (np.sqrt(max(lo, 0)) + (np.sqrt(hi) - np.sqrt(max(lo, 0))) * q) ** 2
    else:
        v = lo + (hi - lo) * q
    return np.where(b == 255, np.nan, v).astype(np.float32), head


class EnsStats:
    """One ensemble's means (and spreads) as a forecast model."""
    res_km = 25.0

    def __init__(self, mid, ens_id, label):
        self.id, self.ens_id, self.label = mid, ens_id, label
        self._frac = None

    @property
    def _ens(self):
        from .ens import ENSEMBLES
        return ENSEMBLES[self.ens_id]

    @property
    def variables(self):
        if not hasattr(self, '_vars'):
            have = set(self._ens.fields)
            self._vars = [v for v, (f, _) in SRC.items() if f in have]
        return self._vars

    @variables.setter
    def variables(self, v):                              # recipes.add_recipes gives a model its extra layers
        self._vars = v

    def schedule(self, run):
        return self._ens.schedule(run)

    def runs(self, n=None):
        return self._ens.runs(n)

    def prepare(self, run, var, first=None):
        """The members of the field this layer is made from, made first if they are not there yet."""
        from .ens import frame_dir, main
        f = SRC[var][0]
        try:                                             # complete for every step the run has now (16 Nov 2026: the
            st = json.loads((frame_dir(self.ens_id, run, f) / 'status.json').read_text())   # ENS went to T+360)
            done = st.get('state') == 'complete' and set(self.schedule(run)) <= set(st.get('steps') or [])
        except Exception:                                # noqa: BLE001  (not made yet)
            done = False
        if not done:
            main(self.ens_id, run.isoformat(), f, first)

    def _up(self, a, k):
        """A coarse field (every k-th display cell) smoothly back onto the display grid."""
        cny, cnx = a.shape
        if self._frac is None or self._frac[0] != a.shape:
            j, i = np.meshgrid(np.arange(NY, dtype=np.float64), np.arange(NX, dtype=np.float64), indexing='ij')
            fj = np.clip((j - (k - 1) / 2) / k, 0, cny - 1)
            fi = np.clip((i - (k - 1) / 2) / k, 0, cnx - 1)
            self._frac = (a.shape, (fj.ravel(), fi.ravel(), False))
        ok = np.isfinite(a)
        out = smooth_sample(np.where(ok, a, np.nanmean(a) if ok.any() else 0), self._frac[1]).astype(np.float32)
        if not ok.all():
            out[smooth_sample(ok.astype(np.float32), self._frac[1]) < 0.5] = np.nan
        return out

    def field(self, run, h, var, prev_h, prev_raw=None):
        from .ens import frame_dir
        f, stat = SRC[var]
        p = frame_dir(self.ens_id, run, f) / f'{h}.bin'
        if not p.exists():
            raise KeyError(f'{self.ens_id} has no {f} at T+{h}')
        m, head = read_members(p)
        with np.errstate(all='ignore'):
            a = {'mean': np.nanmean, 'std': np.nanstd, 'max': np.nanmax}[stat](m, axis=0)
        return self._up(a, int(head.get('k', 3)))


SOURCES_ENS = {
    'ecmwf_ensm': 'ECMWF ENS 0.25° — the mean of its 50 members (ECMWF open data)',
    'aifs_ensm': 'ECMWF AIFS ENS 0.25° — the mean of its 50 members (ECMWF open data)',
}
MODELS_ENS = [EnsStats('ecmwf_ensm', 'ecmwf_ens', 'ECMWF ENS (mean)'), EnsStats('aifs_ensm', 'aifs_ens', 'ECMWF AIFS ENS (mean)')]
