"""Compiled helpers for the 2 km cube (cube.py)."""
from __future__ import annotations

import numpy as np
from numba import njit, prange


@njit(parallel=True, cache=True)
def height_winds_nb(zagl, u, v, u10, v10, hs):
    """Per cell: wind at each height above ground in `hs`. zagl, u, v: (nlev, ncell) with
    level 0 the lowest pressure level. Between 10 m and the lowest level above 10 m the
    wind is interpolated from the 10 m value; inside the profile it is interpolated
    linearly in height; outside the data it is NaN."""
    nlev, ncell = u.shape
    nh = hs.size
    uo = np.empty((nh, ncell))
    vo = np.empty((nh, ncell))
    for c in prange(ncell):
        bz = np.nan
        bu = np.nan
        bv = np.nan
        for k in range(nlev):
            z = zagl[k, c]
            if z == z and z > 10.0 and u[k, c] == u[k, c]:
                bz = z
                bu = u[k, c]
                bv = v[k, c]
                break
        for i in range(nh):
            h = hs[i]
            ou = np.nan
            ov = np.nan
            if h < bz and u10[c] == u10[c]:
                w = (h - 10.0) / max(bz - 10.0, 1.0)
                ou = u10[c] + w * (bu - u10[c])
                ov = v10[c] + w * (bv - v10[c])
            else:
                for k in range(nlev - 1):
                    z0 = zagl[k, c]
                    z1 = zagl[k + 1, c]
                    if not (z0 == z0 and z1 == z1 and z1 > z0):
                        continue
                    if u[k, c] != u[k, c] or u[k + 1, c] != u[k + 1, c]:
                        continue
                    if z0 <= h and z1 >= h:
                        f = (h - z0) / (z1 - z0)
                        ou = u[k, c] + f * (u[k + 1, c] - u[k, c])
                        ov = v[k, c] + f * (v[k + 1, c] - v[k, c])
                        break
            uo[i, c] = ou
            vo[i, c] = ov
    return uo, vo
