"""The 1991-2020 normals for the anomaly layers (16 Nov 2026, at the user's request: "anomaly layers
vs 1991-2020"): NOAA PSL's daily long-term means of the NCEP/NCAR Reanalysis 1 (2.5 degrees), fetched
once over OPeNDAP and kept on D: (modeldata/climate), drawn onto the display grid for a day of the year.

    t850   temperature at 850 hPa (C)
    z500   500 hPa height (dam)
    mslp   sea-level pressure (hPa)

These three are free of the ground and change little through the day, so a model's value at any hour
against that day's normal is a fair comparison. A 2 m temperature anomaly is not offered: on a 2.5
degree grid the normal knows nothing of hills and the daily cycle, so the Highlands would look cold
and every night colder than normal.

    python -m mdata.climate fetch          (once: about 40 MB on D:)
"""
from __future__ import annotations

import sys
import threading
from datetime import datetime

import numpy as np

from .common import DATA, regular_frac, smooth_sample

PSL = 'https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis.derived'
SOURCES = {
    't850': (f'{PSL}/pressure/air.day.ltm.1991-2020.nc', 'air', 850.0),
    'z500': (f'{PSL}/pressure/hgt.day.ltm.1991-2020.nc', 'hgt', 500.0),
    'mslp': (f'{PSL}/surface/slp.day.ltm.1991-2020.nc', 'slp', None),
}
CLIMATE = DATA / 'climate'
_LOCK = threading.Lock()
_RAW, _FRAC, _DAY = {}, {}, {}


def fetch(name):
    """One normal, every day of the year: (365, lat N->S, lon 0..357.5) in the frames' units."""
    f = CLIMATE / f'{name}.npz'
    if f.exists():
        z = np.load(f)
        return z['v'], z['lat'], z['lon']
    import netCDF4
    url, var, lev = SOURCES[name]
    ds = netCDF4.Dataset(url)
    lat = np.asarray(ds['lat'][:], float)
    lon = np.asarray(ds['lon'][:], float)
    k = None if lev is None else list(np.asarray(ds['level'][:], float)).index(lev)
    parts = []
    for d0 in range(0, 365, 31):                          # a month at a time: the whole year in one asking comes back cut short
        d1 = min(d0 + 31, 365)
        for tries in range(4):
            a = np.asarray(ds[var][d0:d1] if k is None else ds[var][d0:d1, k], float)
            if np.nanstd(a) > 0.01:                       # a cut-short answer is all one value
                break
        else:
            raise IOError(f'{name}: days {d0}-{d1} came back empty')
        parts.append(a)
    v = np.concatenate(parts)
    units = getattr(ds[var], 'units', '')
    ds.close()
    if name == 't850' and ('K' in units or np.nanmean(v) > 150):
        v = v - 273.15
    if name == 'z500':
        v = v / 10.0                                      # m -> dam, as the frames
    if name == 'mslp' and np.nanmean(v) > 5000:
        v = v / 100.0                                     # Pa -> hPa
    if lat[0] < lat[-1]:
        v, lat = v[:, ::-1, :], lat[::-1]
    CLIMATE.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(f, v=v.astype(np.float32), lat=lat, lon=lon)
    return v.astype(np.float32), lat, lon


def doy(when: datetime):
    """The normal's day (0..364): 29 February takes 28 February's."""
    d = when.timetuple().tm_yday - 1
    leap = when.year % 4 == 0 and (when.year % 100 != 0 or when.year % 400 == 0)
    if leap and d >= 59:
        d -= 1
    return min(d, 364)


def normal(name, when: datetime):
    """That day's normal on the display grid, smoothly (cubic, never overshooting)."""
    k = doy(when)
    key = (name, k)
    with _LOCK:
        if key in _DAY:
            return _DAY[key]
        if name not in _RAW:
            _RAW[name] = fetch(name)
        v, lat, lon = _RAW[name]
        if name not in _FRAC:
            _FRAC[name] = regular_frac(lat, lon)
        out = smooth_sample(v[k], _FRAC[name]).astype(np.float32)
        if len(_DAY) > 24:
            _DAY.clear()
        _DAY[key] = out
        return out


def _anomaly(name):
    def fn(a, vt=None):
        return a - normal(name, vt)
    fn.wants_time = True
    return fn


# recipes (mdata/recipes.py's form: inputs, the sum, the layer's description), added there once the page
# has their colours
ANOMALY_RECIPES = {
    't850_anom': (('t850',), _anomaly('t850'), dict(label='Temperature anomaly 850 hPa (vs 1991-2020)', unit='°C', group='Upper air', lo=-25, hi=25)),
    'z500_anom': (('z500',), _anomaly('z500'), dict(label='500 hPa height anomaly (vs 1991-2020)', unit='dam', group='Upper air', lo=-50, hi=50)),
    'mslp_anom': (('mslp',), _anomaly('mslp'), dict(label='Pressure anomaly (vs 1991-2020)', unit='hPa', group='Wind & pressure', lo=-50, hi=50)),
}


if __name__ == '__main__':
    if sys.argv[1:] == ['fetch']:
        for n in SOURCES:
            v, la, lo = fetch(n)
            print(n, v.shape, f'{np.nanmin(v):.1f}..{np.nanmax(v):.1f}', 'lat', la[0], '..', la[-1])
