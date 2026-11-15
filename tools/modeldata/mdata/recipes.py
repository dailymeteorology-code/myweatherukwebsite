"""Layers made from other layers (15 Nov 2026, at the user's request: "make your own variables with
existing variables"). Every model whose own layers include a recipe's inputs gets the recipe's layer
too (models.py adds them to its list), worked out frame by frame from those layers' frames in
job.py (recipe), so they cost no downloads. An input written (name, -h) is that layer h hours
earlier in the same run: a step without it is left out.

All inputs are in the frames' units: temperatures C, humidity %, wind mph, cloud %, rates mm/h,
totals mm, pressure hPa.
"""
from __future__ import annotations

import numpy as np

from .derived import wet_bulb

MPH = 2.236936


def _es(t):
    """Saturation vapour pressure over water (hPa) at t (C)."""
    return 6.112 * np.exp(17.67 * t / (t + 243.5))


def _td(t, rh):
    """Dew point (C) from temperature (C) and relative humidity (%), Magnus."""
    g = np.log(np.clip(rh, 1, 100) / 100.0) + 17.625 * t / (243.04 + t)
    return 243.04 * g / (17.625 - g)


def _rh(t, td):
    return np.clip(100.0 * _es(td) / _es(t), 0, 100)


def humidex(t, td):
    """Humidex (C), Environment Canada: the heat as humid air makes it feel."""
    e = 6.11 * np.exp(5417.7530 * (1 / 273.16 - 1 / (273.15 + td)))
    return t + 0.5555 * (e - 10.0)


def apparent(t, td, w_mph):
    """Apparent temperature (C), Steadman (1994) as the Bureau of Meteorology uses it: the air, its
    moisture and the wind together (no sun)."""
    e = np.clip(_rh(t, td), 0, 100) / 100.0 * _es(t)
    return t + 0.33 * e - 0.70 * (w_mph / MPH) - 4.00


def theta_e(t, rh, p):
    """Equivalent potential temperature (K) at a pressure level, Bolton (1980)."""
    tk = t + 273.15
    e = np.maximum(np.clip(rh, 1, 100) / 100.0 * _es(t), 1e-4)
    r = 0.622 * e / (p - e)
    tl = 2840.0 / (3.5 * np.log(tk) - np.log(e) - 4.805) + 55.0
    return tk * (1000.0 / p) ** (0.2854 * (1 - 0.28 * r)) * np.exp((3.376 / tl - 0.00254) * 1000.0 * r * (1 + 0.81 * r))


def theta_w(te):
    """Wet-bulb potential temperature (C) from theta-e (K): Davies-Jones (2008) fit, good to ~0.1 C."""
    x = te / 273.15
    a0, a1, a2, a3, a4 = 7.101574, -20.68208, 16.11182, 2.574631, -5.205688
    b1, b2, b3, b4 = -3.552497, 3.781782, -0.6899655, -0.5929340
    tw = te - 273.15 - np.exp((a0 + a1 * x + a2 * x ** 2 + a3 * x ** 3 + a4 * x ** 4) / (1 + b1 * x + b2 * x ** 2 + b3 * x ** 3 + b4 * x ** 4))
    return np.where(te >= 173.15, tw, te - 273.15)


def beaufort(w_mph):
    """Beaufort force 0-12 from the mean wind (mph)."""
    edges = np.array([1, 4, 8, 13, 19, 25, 32, 39, 47, 55, 64, 73], float)
    return np.searchsorted(edges, np.nan_to_num(w_mph), side='right').astype(np.float32)


def frost_risk(t2, td2, w_mph, tcc):
    """Frost risk, 0 none to 3 high: cold air near the ground, clear skies and light winds let the
    ground fall below freezing (an air frost is already one)."""
    score = (np.clip((4.0 - t2) / 4.0, 0, 1.5) * 1.6 + np.clip((60.0 - tcc) / 60.0, 0, 1) * 0.8
             + np.clip((10.0 - w_mph) / 10.0, 0, 1) * 0.6 + np.clip((3.0 - (t2 - td2)) / 3.0, 0, 1) * 0.2)
    risk = np.select([t2 <= 0, score >= 2.3, score >= 1.7, score >= 1.2], [3, 3, 2, 1], 0)
    return np.where(t2 > 7, 0, risk).astype(np.float32)


def ice_risk(t2, pr):
    """Icy surfaces, 0 none to 3 high: rain, sleet or snow falling at or near freezing, or a hard
    frost on its own."""
    wet = pr >= 0.1
    return np.select([wet & (t2 <= 0.5), wet & (t2 <= 2.0), t2 <= -3.0, t2 <= 0.5], [3, 2, 1, 1], 0).astype(np.float32)


# name: (inputs, function, VARIABLES entry)
RECIPES = {
    'tw2': (('t2', 'td2'), wet_bulb, dict(label='Wet-bulb temperature (2 m)', unit='°C', group='Temperature', lo=-30, hi=35)),
    'rh2': (('t2', 'td2'), _rh, None),                                  # where a model lacks its own
    'td2': (('t2', 'rh2'), _td, None),
    'dpd2': (('t2', 'td2'), lambda t, td: np.maximum(t - td, 0), dict(label='Dew-point depression (2 m)', unit='°C', group='Temperature', lo=0, hi=30)),
    'humidex': (('t2', 'td2'), humidex, dict(label='Humidex (humid heat)', unit='°C', group='Temperature', lo=-30, hi=55)),
    'apparent': (('t2', 'td2', 'wind10'), apparent, dict(label='Apparent temperature', unit='°C', group='Temperature', lo=-45, hi=50)),
    't2_change24': (('t2', ('t2', -24)), lambda a, b: a - b, dict(label='Temperature change over 24 hours', unit='°C', group='Temperature', lo=-20, hi=20)),
    'inversion': (('t850', 't2'), lambda t8, t2: t8 - t2, dict(label='Inversion (850 hPa minus 2 m)', unit='°C', group='Temperature', lo=-25, hi=20)),
    'lcl': (('t2', 'td2'), lambda t, td: np.clip(125.0 * (t - td), 0, 4000),
            dict(label='Cloud base from the surface air (LCL)', unit='m', group='Cloud & visibility', lo=0, hi=4000)),
    'precip_6h': (('precip_total', ('precip_total', -6)), lambda a, b: np.clip(a - b, 0, None),
                  dict(label='Precipitation in the last 6 hours', unit='mm', group='Precipitation', lo=0, hi=200, scale='sqrt')),
    'precip_24h': (('precip_total', ('precip_total', -24)), lambda a, b: np.clip(a - b, 0, None),
                   dict(label='Precipitation in the last 24 hours', unit='mm', group='Precipitation', lo=0, hi=300, scale='sqrt')),
    'frost_risk': (('t2', 'td2', 'wind10', 'tcc'), frost_risk, dict(label='Frost risk', unit='', group='Snow & ice', lo=0, hi=254)),
    'ice_risk': (('t2', 'precip_rate'), ice_risk, dict(label='Icy surfaces risk', unit='', group='Snow & ice', lo=0, hi=254)),
    'sea_effect': (('tskin', 't850'), lambda ts, t8: np.clip(ts - t8, -10, 40),
                   dict(label='Sea-effect showers (sea minus 850 hPa)', unit='°C', group='Snow & ice', lo=-10, hi=35)),
    'beaufort': (('wind10',), beaufort, dict(label='Beaufort force', unit='', group='Wind & pressure', lo=0, hi=254)),
    'wind_power': (('wind100',), lambda w: 0.5 * 1.225 * (w / MPH) ** 3,
                   dict(label='Wind power (100 m)', unit='W/m²', group='Wind & pressure', lo=0, hi=5000, scale='sqrt')),
    'mslp_change24': (('mslp', ('mslp', -24)), lambda a, b: a - b, dict(label='Pressure change over 24 hours', unit='hPa', group='Wind & pressure', lo=-40, hi=40)),
    'mslp_tend3': (('mslp', ('mslp', -3)), lambda a, b: a - b, dict(label='Pressure change over 3 hours', unit='hPa', group='Wind & pressure', lo=-15, hi=15)),
    'td850': (('t850', 'rh850'), _td, dict(label='Dew point 850 hPa', unit='°C', group='Upper air', lo=-45, hi=25)),
    'thetae850': (('t850', 'rh850'), lambda t, rh: theta_e(t, rh, 850.0),
                  dict(label='Equivalent potential temperature 850 hPa (θe)', unit='K', group='Upper air', lo=250, hi=360)),
    'wbpt850': (('t850', 'rh850'), lambda t, rh: theta_w(theta_e(t, rh, 850.0)), None),
    'lapse85': (('t850', 't500'), lambda a, b: (a - b) / 4.1, dict(label='Lapse rate 850-500 hPa', unit='°C/km', group='Upper air', lo=0, hi=11)),
    'lapse75': (('t700', 't500'), lambda a, b: (a - b) / 2.6, dict(label='Lapse rate 700-500 hPa', unit='°C/km', group='Upper air', lo=0, hi=11)),
    'tt': (('t850', 'rh850', 't500'), lambda t8, rh8, t5: t8 + _td(t8, rh8) - 2 * t5, None),
    'kindex': (('t850', 't700', 't500', 'rh850', 'rh700'),
               lambda t8, t7, t5, r8, r7: (t8 - t5) + _td(t8, r8) - (t7 - _td(t7, r7)), None),
}
# code layers (classes, not values): stored lo 0 hi 254 so each class is its own byte; never blended between steps or cells
CODED = {'frost_risk', 'ice_risk', 'beaufort'}


def inputs_of(var):
    return [i if isinstance(i, str) else i[0] for i in RECIPES[var][0]]


def _lags_fit(m, var):
    """A recipe that looks back in time only for a model whose steps it can find for at least half
    its run (a 3-hour change has nothing to compare on a 6-hourly model)."""
    lags = [i[1] for i in RECIPES[var][0] if not isinstance(i, str)]
    if not lags or not hasattr(m, 'schedule'):
        return True
    from datetime import datetime, timezone
    try:
        steps = m.schedule(datetime(2026, 1, 1, 0, tzinfo=timezone.utc))
    except Exception:
        return True
    s = set(steps)
    ok = sum(all((h + lag) in s for lag in lags) for h in steps)
    return ok >= 0.5 * len(steps)


def add_recipes(models):
    """Give every model the recipes its own layers (and earlier recipes) allow; a model keeps its own
    version of a layer where it has one. Returns {model id: [recipes added]}."""
    added = {}
    for m in models:
        own = list(getattr(m, 'variables', []) or [])
        if not own or getattr(m, 'NO_RECIPES', False):
            continue
        have, extra = set(own), []
        changed = True
        while changed:                                   # recipes made from recipes (td850 -> tt ...)
            changed = False
            for v in RECIPES:
                if v not in have and all(i in have for i in inputs_of(v)) and _lags_fit(m, v):
                    have.add(v)
                    extra.append(v)
                    changed = True
        if extra:
            m.variables = own + extra                    # this model only (classes share their lists)
            m._recipes = set(extra)
            added[m.id] = extra
    return added
