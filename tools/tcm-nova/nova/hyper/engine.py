"""Hyper-Short stage-1 engine: observation analysis + kinematic (Lagrangian) evolution.

WHAT THIS IS. An independent, observation-initialised forecast of the fields the
observations actually determine: surface rain rate and lightning activity, advected by
a motion field estimated from consecutive radar composites, with scale-dependent
Lagrangian decay (small convective scales lose memory in ~45 min, organised rain in
hours — the behaviour reported for STEPS/pySTEPS, Bowler et al. 2006, Pulkkinen 2019).

WHAT THIS IS NOT. It is not a 3-D atmospheric solver. The observations available
keylessly in real time (radar, lightning) do not determine temperature, humidity or
wind aloft, so CAPE/CIN/shear/LCL etc. are NOT produced and are marked unavailable —
not filled from any model. It cannot initiate new storms, so beyond a few hours it
only describes the decay of what exists now; the manifest states its skill horizon.
The physical core (dynamics + microphysics) is the staged work in docs/HYPER_SHORT.md.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

DT_MIN = 5                    # internal step
TAU_SMALL_MIN = 45            # e-folding of sub-20 km structure (convective cells)
TAU_LARGE_MIN = 360           # e-folding of the large-scale rain field
TAU_LIGHTNING_MIN = 40        # electrical activity of an existing cell
SPLIT_KM = 20


def motion_field(prev, cur, dx_m, dt_s, block_km=48, smooth_km=60):
    """Block-wise displacement between two rain fields by FFT phase-correlation on
    log-rain, then smoothed. Returns u, v in grid cells per second (row 0 = south)."""
    a = np.log1p(np.nan_to_num(prev))
    b = np.log1p(np.nan_to_num(cur))
    B = max(16, int(block_km * 1000 / dx_m))
    ny, nx = a.shape
    us, vs, ws, cy, cx = [], [], [], [], []
    win = np.outer(np.hanning(B), np.hanning(B))
    for y in range(0, ny - B + 1, B // 2):
        for x in range(0, nx - B + 1, B // 2):
            pa, pb = a[y:y + B, x:x + B], b[y:y + B, x:x + B]
            wet = (pa > 0.1).mean() + (pb > 0.1).mean()
            if wet < 0.05:
                continue
            Fa, Fb = np.fft.fft2(pa * win), np.fft.fft2(pb * win)
            R = Fb * np.conj(Fa)
            r = np.fft.ifft2(R / np.maximum(np.abs(R), 1e-9)).real
            iy, ix = np.unravel_index(np.argmax(r), r.shape)
            dy = (iy if iy <= B // 2 else iy - B) + _subpix(r[(iy - 1) % B, ix], r[iy, ix], r[(iy + 1) % B, ix])
            dx = (ix if ix <= B // 2 else ix - B) + _subpix(r[iy, (ix - 1) % B], r[iy, ix], r[iy, (ix + 1) % B])
            if abs(dx) > B // 3 or abs(dy) > B // 3:
                continue
            us.append(dx / dt_s); vs.append(dy / dt_s); ws.append(wet)
            cy.append(y + B / 2); cx.append(x + B / 2)
    if len(us) < 3:
        return np.zeros_like(a), np.zeros_like(a), 0
    # inverse-distance interpolation of block vectors, then smoothing
    yy, xx = np.mgrid[0:ny:8, 0:nx:8]
    pts = np.c_[cy, cx]
    d2 = (yy.ravel()[:, None] - pts[:, 0]) ** 2 + (xx.ravel()[:, None] - pts[:, 1]) ** 2
    w = np.asarray(ws)[None, :] / (d2 + (B / 2) ** 2)
    u8 = (w * np.asarray(us)).sum(1) / w.sum(1)
    v8 = (w * np.asarray(vs)).sum(1) / w.sum(1)
    zoom = (ny / yy.shape[0], nx / yy.shape[1])
    u = ndimage.zoom(u8.reshape(yy.shape), zoom, order=1)[:ny, :nx]
    v = ndimage.zoom(v8.reshape(yy.shape), zoom, order=1)[:ny, :nx]
    sig = smooth_km * 1000 / dx_m / 2.355
    return ndimage.gaussian_filter(u, sig), ndimage.gaussian_filter(v, sig), len(us)


def _subpix(a, b, c):
    """Parabolic sub-cell refinement of a correlation peak."""
    d = a - 2 * b + c
    return float(np.clip(0.5 * (a - c) / d, -0.5, 0.5)) if d < 0 else 0.0


def advect(field, u, v, dt_s):
    """Semi-Lagrangian backward advection (bilinear), outside-domain inflow = 0."""
    ny, nx = field.shape
    yy, xx = np.indices((ny, nx), dtype=np.float32)
    return ndimage.map_coordinates(np.nan_to_num(field), [yy - v * dt_s, xx - u * dt_s], order=1, mode='constant', cval=0.0)


def split_scales(rain, dx_m):
    large = ndimage.gaussian_filter(rain, SPLIT_KM * 1000 / dx_m / 2.355)
    return large, rain - large


def integrate(rain0, light0, u, v, dx_m, horizon_min=1440, out_every=30):
    """Yield (lead_min, rain, lightning_density) every `out_every` minutes from T+0."""
    large, small = split_scales(rain0, dx_m)
    lt = light0.copy()
    dt = DT_MIN * 60
    fs, fl, flt = np.exp(-DT_MIN / TAU_SMALL_MIN), np.exp(-DT_MIN / TAU_LARGE_MIN), np.exp(-DT_MIN / TAU_LIGHTNING_MIN)
    yield 0, np.clip(large + small, 0, None), lt
    for k in range(1, horizon_min // DT_MIN + 1):
        large = advect(large, u, v, dt) * fl
        small = advect(small, u, v, dt) * fs
        lt = advect(lt, u, v, dt) * flt
        if (k * DT_MIN) % out_every == 0:
            yield k * DT_MIN, np.clip(large + small, 0, None), lt


def probabilities(rain, light, lead_min, dx_m, speed_ms):
    """Neighbourhood probabilities: displacement uncertainty grows with lead and speed."""
    r_km = 3 + 0.08 * lead_min * (0.3 + speed_ms / 15)
    r = max(1, int(r_km * 1000 / dx_m))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    fp = (xx * xx + yy * yy) <= r * r
    frac = lambda m: ndimage.convolve(m.astype(np.float32), fp / fp.sum(), mode='constant')
    p_rain = frac(rain >= 1.0)
    p_heavy = frac(rain >= 10.0)
    p_light = np.clip(frac(light > 0.01) * 1.5, 0, 1)
    core = frac(rain >= 25.0)
    p_thunder = np.clip(np.maximum(p_light, 0.5 * core), 0, 1)
    return {'p_rain': p_rain, 'p_heavy_rain': p_heavy, 'p_lightning': p_light, 'p_thunder': p_thunder,
            'neighbourhood_km': r_km}
