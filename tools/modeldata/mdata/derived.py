"""Fields made from other fields' frames rather than downloaded.

wx — the weather type behind the symbols above the place names, one code per cell:

    0 Clear  1 Partly cloudy  2 Cloudy  3 Overcast  4 Fog  5 Drizzle  6 Light rain  7 Rain
    8 Heavy rain  9 Sleet  10 Light snow  11 Snow  12 Heavy snow  13 Thunderstorm  14 Hail

from what each model publishes: its precipitation rate, its snow rate (Met Office) or the
wet-bulb temperature (the others) for rain/sleet/snow, total cloud, visibility for fog, and
its lightning (UKV), hail (UKV) or CAPE with heavy precipitation for thunder. The client
draws the same codes (src/lib/modelViewer.js WX_NAMES).

fog_vis — the visibility in metres, in the fog areas only (nothing elsewhere).

ptype — precipitation type and strength, four kinds: rain, sleet, snow and ice (freezing rain,
ice pellets, freezing drizzle and hail), each with its rate, in one byte (typed_rate). Every model's
is made this way: the Met Office models from the rate of each kind they give (precip_type), ECMWF
and GFS from their own types and their precipitation rate (models.py).

radar_phase — the type of what the radar sees, for the current-conditions analysis (mdata/now.py),
and the radar coloured by it (typed_rate again).
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


# Snow share of what falls, and the type it makes: the weather symbols' thresholds (weather_type)
SNOW_SHARE, SLEET_SHARE = 0.7, 0.3


def ptype_inputs(variables):
    """The frames ptype is made from, out of what a model has."""
    return [v for v in ('precip_rate', 'snow_rate', 'hail_rate', 't2') if v in variables]


def precip_type(f):
    """f: {'precip_rate', 'snow_rate', ['hail_rate'], ['t2']} -> typed_rate's bytes (0 dry, NaN off
    the model). By the snow share: 70 % or more snow, 30-70 % sleet, less rain; rain with the
    screen temperature at or below freezing is ice (freezing rain); so is hail, where it is at
    least 0.1 mm/h and a third of what falls (the UKV gives a hail rate)."""
    pr = np.nan_to_num(f['precip_rate'])
    sf = np.clip(np.nan_to_num(f['snow_rate']) / np.maximum(pr, 1e-6), 0, 1) if 'snow_rate' in f else np.zeros_like(pr)
    code = np.select([sf >= SNOW_SHARE, sf >= SLEET_SHARE], [5, 7], 1)
    if 't2' in f:
        code = np.where((code == 1) & (np.nan_to_num(f['t2'], nan=10) <= 0), 3, code)
    if 'hail_rate' in f:
        hr = np.nan_to_num(f['hail_rate'])
        code = np.where((hr >= 0.1) & (hr >= pr / 3), 10, code)
    return typed_rate(f['precip_rate'], code)


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


def radar_phase(model, t2, td2, reach_cells=15):
    """What would fall at each cell now, as ECMWF codes (1 rain, 3 freezing rain, 5 snow, 7 sleet),
    and the snow share behind it. model: the UKV at the time ({'precip_rate', 'snow_rate'}, any
    missing); t2, td2: the analysed screen temperature and dew point (the stations' correction of the
    model's air).

    Two views of the phase, averaged: the UKV's own snow share (it has the melting layer aloft, which
    no surface reading sees), carried ~15 cells (30 km) beyond its precipitation so that radar echoes
    the model has a little out of place still take it; and the wet bulb's share from the analysis
    (all snow at -0.2 C or below, all rain from +1.2 C, as in weather_type), which keeps the stations'
    say where they are warmer or colder than the model. Where the model has no precipitation near,
    the wet bulb alone. Rain from the model where the analysed air is at or below freezing is
    freezing rain (the melting layer aloft, the ground below zero), whatever the wet bulb says."""
    from scipy import ndimage
    t2 = np.nan_to_num(t2, nan=10.0)
    tw = wet_bulb(t2, np.nan_to_num(td2, nan=10.0))
    sf_wb = np.clip((1.2 - tw) / 1.4, 0, 1)
    pr = np.nan_to_num(model.get('precip_rate', np.zeros_like(t2)))
    frz = np.zeros(t2.shape, bool)
    if 'snow_rate' in model:
        wet = (pr >= 0.05).astype(np.float32)
        share = np.clip(np.nan_to_num(model['snow_rate']) / np.maximum(pr, 1e-6), 0, 1) * wet
        size = 2 * reach_cells + 1
        w = ndimage.uniform_filter(wet, size=size, mode='nearest')
        s = ndimage.uniform_filter(share, size=size, mode='nearest')
        near = w > 1e-3
        sf_model = np.where(near, s / np.maximum(w, 1e-6), 0)
        sf = np.where(near, 0.5 * sf_model + 0.5 * sf_wb, sf_wb)
        frz = near & (sf_model < 0.2) & (t2 <= 0)
    else:
        sf = sf_wb
    code = np.select([sf >= SNOW_SHARE, sf >= SLEET_SHARE], [5, 7], 1)
    code = np.where(frz, 3, code)
    return code.astype(np.uint8), sf.astype(np.float32)


# Precipitation by kind and strength, one byte a cell (every model's ptype, and the radar's
# radar_type): 0 dry, else 1 + 63 x kind + level; kind 0 rain, 1 sleet, 2 snow, 3 ice, and level
# 0-62 the rate on a log scale from 0.05 to 128 mm/h (13.7 % a level). src/lib/modelViewer.js
# decodes the same.
RT_LO, RT_HI, RT_LEVELS = 0.05, 128.0, 62
# ECMWF's type codes to the kinds: wet snow is snow, rain and snow together sleet, and freezing
# rain, ice pellets, freezing drizzle and hail all ice
KIND_OF = {1: 0, 11: 0, 7: 1, 5: 2, 6: 2, 3: 3, 8: 3, 10: 3, 12: 3}


def typed_rate(rate, code):
    """rate: mm/h (NaN off the grid); code: ECMWF type codes on the same grid (anything else rain)."""
    r = np.nan_to_num(rate)
    code = np.asarray(code)
    fam = np.zeros(np.shape(code), np.int32)
    for c, k in KIND_OF.items():
        fam[code == c] = k
    with np.errstate(divide='ignore', invalid='ignore'):
        lvl = np.rint(RT_LEVELS * np.log(np.maximum(r, RT_LO) / RT_LO) / np.log(RT_HI / RT_LO))
    lvl = np.clip(lvl, 0, RT_LEVELS).astype(np.int32)
    out = np.where(r >= RT_LO, 1 + 63 * fam + lvl, 0).astype(np.float32)
    return np.where(np.isfinite(rate), out, np.nan).astype(np.float32)


# A grid box is a fog area when at least half of it is in fog. On the UKV of 7 Nov 2026 nine in ten
# boxes with visibility under 1 km had a fog fraction above 56%, while at 25-50% the median
# visibility was still 5-7 km: below a half the model is not saying "fog" at that place.
FOG_FRACTION = 50.0


def fog_inputs(variables):
    """The frames fog_vis is made from: the visibility, and the fog fraction where the model has one."""
    return [v for v in ('vis', 'fog') if v in variables]


def fog_visibility(f):
    """f: {'vis': km, 'fog': %}. Visibility in metres where there is fog, NaN everywhere else. By the
    model's fog fraction, so rain or snow cutting the visibility does not count as fog; a model with
    no fog fraction (GFS) falls back on what fog means, visibility under 1 km."""
    vis = f['vis']
    foggy = np.nan_to_num(f['fog']) >= FOG_FRACTION if 'fog' in f else np.nan_to_num(vis, nan=99) < 1.0
    return np.where(foggy & np.isfinite(vis), vis * 1000.0, np.nan).astype(np.float32)
