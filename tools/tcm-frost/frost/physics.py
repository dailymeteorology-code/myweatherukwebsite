"""From a model's coarse fields to the snow that falls on each 2 km cell.

Snow in the UK is decided by a few hundred metres: the same air gives rain at the coast and a
covering on the hills. Global models see the ground at 10-50 km, so their snow line sits at the
wrong height. Each member's fields are brought down to the 2 km ground:

1. Temperature: the model's own lapse rate between the screen and 850 hPa (where it gives that,
   held between 3 and 9.8 K/km; 6.5 otherwise) carries the screen temperature from the model's
   ground to the real one; the dew point keeps its depression.
2. Phase: the model's own frozen share of what falls (its snowfall over its precipitation, or its
   frozen percentage) is kept where the ground is the model's, and moved by exactly as much as
   the wet bulb's share changes with the height difference (all snow at -0.2 C, all rain from
   +1.2 C, as the site's radar typing uses). So a warm nose aloft the model resolved is kept,
   and the snow line follows the real hills.
3. Precipitation: hills the model smoothed away get a little more, and valleys a little less
   (5 % per 100 m against the model's ground, held between -30 % and +60 %).
4. Depth: water to snow by a ratio that rises as it gets colder (wet snow about 7:1 near 0 C,
   about 12:1 at -5 C, up to 18:1 in very cold air).

The UKV is already at 2 km on this grid: its own snow is used as it is.
"""
from __future__ import annotations

import numpy as np

Z850 = 1450.0                                  # a typical height of 850 hPa (m)
SLR_T = np.array([-15.0, -10.0, -5.0, -2.0, 0.0, 1.0, 2.0])
SLR_R = np.array([18.0, 15.0, 12.0, 10.0, 8.5, 7.0, 6.0])


def rh_from(t, td):
    """Relative humidity (%) from temperature and dew point (C), Magnus."""
    return np.clip(100.0 * np.exp(17.625 * td / (243.04 + td)) / np.exp(17.625 * t / (243.04 + t)), 1.0, 100.0)


def wet_bulb(t, rh):
    """Wet-bulb temperature (C) from temperature (C) and relative humidity (%), Stull (2011)."""
    return (t * np.arctan(0.151977 * np.sqrt(rh + 8.313659)) + np.arctan(t + rh) - np.arctan(rh - 1.676331)
            + 0.00391838 * rh ** 1.5 * np.arctan(0.023101 * rh) - 4.686035)


def phase(tw):
    """The frozen share of precipitation from the wet bulb alone (the site's radar typing)."""
    return np.clip((1.2 - tw) / 1.4, 0.0, 1.0)


def slr(t):
    """Snow depth per depth of water, from the screen temperature (C)."""
    return np.interp(t, SLR_T, SLR_R)


def snowfall(p, s, fs, t2, td2, t850, z, zc, downscale=True):
    """Snow (cm) falling on each 2 km cell in a window, for every member.

    p     precipitation in the window (mm), at the model's ground          (members, cells)
    s     snowfall in the window (mm of water), or None                    (members, cells)
    fs    frozen share at the window (0-1, NaN where nothing falls), or None
    t2, td2, t850   mean over the window (C); t850 may be None or NaN
    z     the cells' real height (m)                                       (cells,)
    zc    the model's own (smoothed) ground at the cells (m)               (cells,)
    -> (snow cm, frozen share used, temperature at the real ground)        (members, cells)
    """
    p = np.maximum(np.nan_to_num(p), 0.0)
    t2 = np.nan_to_num(t2, nan=5.0)
    td2 = np.minimum(np.nan_to_num(td2, nan=3.0), t2)
    dz = (z - zc)[None, :] if downscale else np.zeros((1, z.size), np.float32)
    if t850 is not None and downscale:
        depth_km = np.maximum((Z850 - zc) / 1000.0, 0.3)[None, :]
        gamma = np.where(np.isfinite(t850), (t2 - np.nan_to_num(t850)) / depth_km, 6.5)
        gamma = np.clip(gamma, 3.0, 9.8)
    else:
        gamma = 6.5
    t2f = t2 - gamma * dz / 1000.0
    td2f = td2 - gamma * dz / 1000.0
    twc = wet_bulb(t2, rh_from(t2, td2))
    twf = wet_bulb(t2f, rh_from(t2f, td2f))
    # the model's own frozen share at its own ground
    with np.errstate(invalid='ignore', divide='ignore'):
        own = np.where(p >= 0.05, np.clip(np.nan_to_num(s) / np.maximum(p, 1e-6), 0, 1), np.nan) if s is not None else None
    fs_c = own if own is not None else (fs if fs is not None else np.full(p.shape, np.nan, np.float32))
    fs_c = np.where(np.isfinite(fs_c), fs_c, phase(twc))
    fs_f = np.clip(fs_c + phase(twf) - phase(twc), 0.0, 1.0)
    pf = p * np.clip(1.0 + 0.5 * dz / 1000.0, 0.7, 1.6) if downscale else p
    cm = np.where(pf >= 0.05, pf * fs_f * slr(t2f) / 10.0, 0.0)
    return cm.astype(np.float32), fs_f.astype(np.float32), t2f.astype(np.float32)
