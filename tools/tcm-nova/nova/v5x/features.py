"""V5 engines/features.py over the grid: every shared feature as an array (NaN = absent)."""
from __future__ import annotations

import numpy as np

NAN = np.nan


def _a(x, shape):
    if x is None:
        return np.full(shape, NAN)
    x = np.asarray(x, dtype='float64')
    return np.where(np.isfinite(x), x, NAN)


def build(gp, *, elevation=None, forcing=None, extra=None):
    """gp: V5 GriddedParameters. forcing: {name: array} from the spatial stage (fills
    only where the profile has nothing, which on a grid is everywhere). Returns a dict."""
    shape = gp.shape
    v = lambda n: _a(gp.value(n), shape)             # noqa: E731
    F = {}
    lfc, el, lcl = v('lfc'), v('el'), v('lcl')
    F['storm_depth'] = el - lfc
    F['cloud_base'] = lcl
    F['sub_cloud_depth'] = lcl
    F['equilibrium_level'] = el
    F['freezing_level'] = v('freezing_level')
    F['cold_cloud_depth'] = v('cold_cloud_depth')
    F['warm_cloud_depth'] = v('warm_cloud_depth')
    F['glaciated_depth'] = F['cold_cloud_depth']
    F['wet_bulb_zero'] = v('wet_bulb_zero')
    for p in ('sb', 'ml', 'mu'):
        F[f'{p}cape'] = v(f'{p}cape')
        F[f'{p}cin'] = v(f'{p}cin')
    # entrainment indicators: extras exist only where the diagnostic itself is finite
    ent = gp.fields.get('entrainment_indicators')
    if ent is not None:
        have = np.isfinite(ent.values)
        ex = lambda k: np.where(have, _a(ent.extra.get(k), shape), NAN)   # noqa: E731
        F['mid_level_rh'] = ex('mid_level_mean_rh_percent')
        F['mid_level_min_rh'] = ex('mid_level_min_rh_percent')
        F['low_level_rh'] = ex('low_level_mean_rh_percent')
        F['low_to_mid_moisture_contrast'] = ex('low_to_mid_mixing_ratio_contrast_g_kg')
    else:
        for k in ('mid_level_rh', 'mid_level_min_rh', 'low_level_rh', 'low_to_mid_moisture_contrast'):
            F[k] = np.full(shape, NAN)
    F['precipitable_water'] = v('precipitable_water')
    F['boundary_layer_mixing_ratio'] = v('boundary_layer_moisture') * 1000.0
    for n in ('lr_0_1km', 'lr_0_3km', 'lr_0_6km', 'lr_850_500', 'lr_700_500',
              'shear_0_1km', 'shear_0_3km', 'shear_0_6km', 'shear_0_8km', 'srh_0_1km', 'srh_0_3km',
              'effective_srh', 'bulk_richardson_number', 'pbl_depth', 'boundary_layer_temperature', 'dcape'):
        F[n] = v(n)
    # not gridded by V5 Stage 4 (storm-relative flow profile): absent, as in V5's grid chain
    F['storm_relative_inflow_1km'] = np.full(shape, NAN)
    F['storm_relative_anvil_flow'] = np.full(shape, NAN)
    F['storm_motion_speed'] = np.full(shape, NAN)
    F['lcl_above_pbl'] = lcl - F['pbl_depth']
    F['low_level_dryness'] = 100.0 - F['low_level_rh']
    F['mid_level_dryness'] = 100.0 - F['mid_level_rh']
    F['elevation'] = _a(elevation, shape)
    for name in ('convergence', 'frontogenesis', 'moisture_flux_convergence', 'vertical_velocity'):
        F[name] = _a((forcing or {}).get(name), shape)
    for k, a in (extra or {}).items():          # NOVA additions (declared where used)
        F[k] = _a(a, shape)
    return F


def local_solar_hour(valid_time, lon):
    utc_hour = valid_time.hour + valid_time.minute / 60.0
    return np.mod(utc_hour + np.asarray(lon, dtype='float64') / 15.0, 24.0)
