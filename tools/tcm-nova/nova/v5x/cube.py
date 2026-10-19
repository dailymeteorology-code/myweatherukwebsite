"""A model's downscaled 2 km state, as a V5 Stage 3 profile cube -- in memory.

The source frame comes from NOVA's readers, already put on V5's 2 km grid by
`v5_blend.Blender` (bilinear from each model's native grid, log-p vertical
interpolation to NOVA's 19 levels inside the model's own range, grid-relative winds,
screen temperature/dew point corrected to the 90 m DEM). This module turns it into the
fields V5 Stage 3 reads, under V5's names and units, and hands them to V5's own
`build_profile` (below-ground masking, native-first, no extrapolation) through an
in-memory field source instead of the disk store.

Fields AWS does not publish are DERIVED here, by code, and named as derived:
  * surface pressure on the 2 km terrain, hypsometrically from the model's own column
  * the wind profile on heights above ground (V5's hodograph), from the pressure-level
    winds and geopotential heights over the 2 km terrain, with the 10 m wind as the base
  * boundary-layer depth (NOVA addition; V5 had none on AWS): the parcel method
    (Holzworth 1964) -- the lowest height where the virtual potential temperature
    exceeds the surface value by 0.5 K
"""
from __future__ import annotations

import numpy as np

from ..config import LEVELS
from .. import v5_bridge  # noqa: F401
from app.profiles import build as PB  # noqa: E402
from app.profiles.levels import STANDARD_HEIGHT_LEVELS  # noqa: E402

RD, G, CP, EPS = 287.04, 9.80665, 1005.7, 0.62198


def _es(t):
    c = t - 273.15
    return 611.2 * np.exp(17.67 * c / (c + 243.5))      # Bolton eq. 10, as V5


def surface_pressure_pa(prof, terrain, mslp=None):
    """Pa. Hypsometric from the column onto the 2 km terrain; never extrapolates the
    profile upward, falls back to MSLP reduction only where the column has nothing."""
    z = prof['z']
    lnp = np.log(np.asarray(LEVELS, float) * 100.0)[:, None, None] * np.ones_like(z)
    h = terrain
    ps = np.full(h.shape, np.nan)
    for k in range(len(LEVELS) - 1):
        z0, z1 = z[k], z[k + 1]
        hit = np.isnan(ps) & np.isfinite(z0) & np.isfinite(z1) & (z0 <= h) & (z1 > h)
        f = np.where(hit, (h - z0) / np.where(z1 == z0, 1, z1 - z0), 0)
        ps = np.where(hit, np.exp(lnp[k] + f * (lnp[k + 1] - lnp[k])), ps)
    below = np.isnan(ps) & np.isfinite(z[0]) & (h < z[0])
    t0 = np.nan_to_num(prof['t'][0], nan=285.0)
    ps = np.where(below, 1e5 * np.exp(G * (z[0] - h) / (RD * t0)), ps)
    if mslp is not None:
        ps = np.where(np.isnan(ps), mslp * np.exp(-G * h / (RD * 285.0)), ps)
    return ps


def height_winds(prof, terrain, u10, v10):
    """u, v at V5's standard heights above ground, from the pressure-level winds.
    Below the lowest level above 10 m the profile is interpolated from the 10 m wind;
    above the top of the data it is NaN (V5 never extrapolates a hodograph)."""
    from .hodo import height_winds_nb
    zagl = np.ascontiguousarray(prof['z'] - terrain[None], dtype='float64')
    u = np.ascontiguousarray(prof['u'], dtype='float64')
    v = np.ascontiguousarray(prof['v'], dtype='float64')
    shape = terrain.shape
    has10 = u10 is not None and v10 is not None
    u10a = np.ascontiguousarray(u10 if has10 else np.full(shape, np.nan), dtype='float64')
    v10a = np.ascontiguousarray(v10 if has10 else np.full(shape, np.nan), dtype='float64')
    hs = np.array([h for h in STANDARD_HEIGHT_LEVELS], dtype='float64')
    uo, vo = height_winds_nb(zagl.reshape(zagl.shape[0], -1), u.reshape(u.shape[0], -1),
                             v.reshape(v.shape[0], -1), u10a.ravel(), v10a.ravel(), hs)
    out = {}
    for i, h in enumerate(hs):
        if h == 10.0 and has10:
            out[h] = (u10, v10)
        else:
            out[h] = (uo[i].reshape(shape), vo[i].reshape(shape))
    return out


def pbl_depth(prof, t2, td2, ps, terrain):
    """Parcel-method boundary-layer depth, m above ground (NaN where undetermined)."""
    q2 = None
    with np.errstate(invalid='ignore'):
        e2 = _es(td2)
        w2 = EPS * e2 / np.maximum(ps - e2, 1.0)
        thv_s = t2 * (1e5 / ps) ** (RD / CP) * (1 + w2 / EPS) / (1 + w2)
        P = np.asarray(LEVELS, float)[:, None, None] * 100.0
        q = prof['q']
        w = q / np.maximum(1 - q, 1e-6)
        thv = prof['t'] * (1e5 / P) ** (RD / CP) * (1 + w / EPS) / (1 + w)
    zagl = prof['z'] - terrain[None]
    top = np.full(terrain.shape, np.nan)
    prev_z = np.zeros(terrain.shape)
    prev_ex = np.zeros(terrain.shape)
    for k in range(thv.shape[0]):
        above = np.isfinite(zagl[k]) & (zagl[k] > 0) & np.isfinite(thv[k])
        ex = thv[k] - (thv_s + 0.5)
        cross = np.isnan(top) & above & (ex > 0)
        f = np.where(cross, -prev_ex / np.where(ex - prev_ex != 0, ex - prev_ex, 1.0), 0.0)
        f = np.clip(f, 0.0, 1.0)
        top = np.where(cross, prev_z + f * (zagl[k] - prev_z), top)
        prev_z = np.where(above, zagl[k], prev_z)
        prev_ex = np.where(above, ex, prev_ex)
    return np.clip(top, 50.0, 4000.0)


def fields(frame, terr):
    """{V5 name: 2-D array} for one source frame on the V5 grid."""
    prof = frame['pl']
    sfc = frame['sfc']
    h = terr['h_mean']
    out = {}
    T, q = prof['t'], prof['q']
    P = np.asarray(LEVELS, float)[:, None, None] * 100.0
    with np.errstate(invalid='ignore', divide='ignore'):
        e = q * P / (EPS + (1 - EPS) * q)
        rh = 100.0 * e / _es(T)
    for i, p in enumerate(LEVELS):
        out[f'temperature_{p}'] = T[i]
        out[f'relative_humidity_{p}'] = rh[i]
        out[f'geopotential_height_{p}'] = prof['z'][i]
        out[f'u_wind_{p}'] = prof['u'][i]
        out[f'v_wind_{p}'] = prof['v'][i]
        out[f'wind_speed_{p}'] = np.hypot(prof['u'][i], prof['v'][i])
    ps = surface_pressure_pa(prof, h, sfc.get('mslp'))
    out['pressure_surface'] = ps
    t2 = sfc.get('t2', T[0])
    td2 = np.minimum(sfc.get('td2', t2 - 5.0), t2)
    out['temperature_2m'] = t2
    out['dewpoint_2m'] = td2
    out['terrain_height'] = h
    out['boundary_layer_height'] = pbl_depth(prof, t2, td2, ps, h)
    u10, v10 = sfc.get('u10'), sfc.get('v10')
    for hgt, (u, v) in height_winds(prof, h, u10, v10).items():
        lab = '10m' if hgt == 10.0 else f'agl_{int(hgt)}'
        out[f'u_wind_{lab}'] = u
        out[f'v_wind_{lab}'] = v
        out[f'wind_speed_{lab}'] = np.hypot(u, v)
    return out


def build(frame, terr, *, model, run, forecast_hour):
    """V5 `build_profile` on the in-memory fields. Returns the gridded Profile cube."""
    store = fields(frame, terr)

    def _load(model_id, run_, name, fh, member, root=None):
        v = store.get(name)
        return None if v is None else np.asarray(v, dtype='float32')
    orig = PB._load, PB._derive_wind_direction
    PB._load = _load
    # Wind DIRECTION is derived by V5 Stage 3 for display only; Stage 4 reads u and v.
    PB._derive_wind_direction = lambda profile: None
    try:
        return PB.build_profile(model, run, forecast_hour, provider='nova', grid_id='v5_tcm_laea_2km',
                                pressure_levels=tuple(float(p) for p in LEVELS))
    finally:
        PB._load, PB._derive_wind_direction = orig
