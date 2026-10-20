"""Fields made from other fields' frames rather than downloaded.

wx — the weather type behind the symbols above the place names, one code per cell:

    0 Clear  1 Partly cloudy  2 Cloudy  3 Overcast  4 Fog  5 Drizzle  6 Light rain  7 Rain
    8 Heavy rain  9 Sleet  10 Light snow  11 Snow  12 Heavy snow  13 Thunderstorm  14 Hail

from what each model publishes: its precipitation rate, its snow rate (Met Office) or the
wet-bulb temperature (the others) for rain/sleet/snow, total cloud, visibility for fog, and
its lightning (UKV), hail (UKV) or CAPE with heavy precipitation for thunder. The client
draws the same codes (src/lib/modelViewer.js WX_NAMES).
"""
from __future__ import annotations

import numpy as np

WX_NAMES = ['Clear', 'Partly cloudy', 'Cloudy', 'Overcast', 'Fog', 'Drizzle', 'Light rain', 'Rain', 'Heavy rain',
            'Sleet', 'Light snow', 'Snow', 'Heavy snow', 'Thunderstorm', 'Hail']


def wx_inputs(variables):
    """The frames wx is made from, out of what a model has."""
    want = ['precip_rate', 'tcc']
    want += ['snow_rate'] if 'snow_rate' in variables else ['t2', 'td2']
    want += next(([v] for v in ('vis', 'fog') if v in variables), [])                  # fog
    want += next(([v] for v in ('lightning', 'cape_mu', 'cape_sb') if v in variables), [])  # thunder
    want += ['hail_rate'] if 'hail_rate' in variables else []
    return [v for v in want if v in variables]


def wet_bulb(t, td):
    """Wet-bulb temperature (C) from temperature and dew point — the one-third rule, plenty for
    rain/sleet/snow, which turns on whether Tw is about +1 C."""
    return t - (t - td) / 3.0


def weather_type(f):
    """f: {name: float array}. Returns float codes (NaN where there is no data)."""
    pr = np.nan_to_num(f['precip_rate'])
    tcc = f.get('tcc')
    shape = pr.shape
    code = np.zeros(shape, np.float32)
    if tcc is not None:
        c = np.nan_to_num(tcc)
        code = np.select([c >= 87.5, c >= 55, c >= 20], [3, 2, 1], 0).astype(np.float32)
    if 'vis' in f:
        code = np.where(np.nan_to_num(f['vis'], nan=99) < 1.0, 4, code)
    elif 'fog' in f:
        code = np.where(np.nan_to_num(f['fog']) >= 50, 4, code)
    # phase: the snow share of the precipitation, or wet bulb
    if 'snow_rate' in f:
        sf = np.clip(np.nan_to_num(f['snow_rate']) / np.maximum(pr, 1e-6), 0, 1)
    elif 't2' in f and 'td2' in f:
        tw = wet_bulb(np.nan_to_num(f['t2'], nan=10), np.nan_to_num(f['td2'], nan=10))
        sf = np.clip((1.2 - tw) / 1.4, 0, 1)
    else:
        sf = np.zeros(shape)
    wet = pr >= 0.1
    rain = np.select([pr >= 4, pr >= 1, pr >= 0.25], [8, 7, 6], 5)
    snow = np.select([pr >= 2.5, pr >= 0.5], [12, 11], 10)
    code = np.where(wet, np.where(sf >= 0.7, snow, np.where(sf >= 0.3, 9, rain)), code)
    thunder = np.zeros(shape, bool)
    if 'lightning' in f:
        thunder |= np.nan_to_num(f['lightning']) >= 0.01
    for k in ('cape_mu', 'cape_sb'):
        if k in f:
            thunder |= (np.nan_to_num(f[k]) >= 300) & (pr >= 1.5)
    code = np.where(thunder & wet, 13, code)
    if 'hail_rate' in f:
        code = np.where(np.nan_to_num(f['hail_rate']) >= 0.1, 14, code)
    return np.where(np.isfinite(f['precip_rate']) | (tcc is not None and np.isfinite(tcc)), code, np.nan).astype(np.float32)
