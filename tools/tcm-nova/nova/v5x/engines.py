"""The twelve V5 specialist engines (Stage 5) over the grid.

Each function mirrors one V5 engine's `evaluate`, line for line, returning arrays:
  has      bool   the engine produced a score (V5 status.has_score)
  score    float  NaN where it did not
  conf     float  V5 confidence (NaN where the result carries none)
  unc      float  V5 uncertainty, floored at IRREDUCIBLE_UNCERTAINTY as `_result` does
plus whatever later engines read (classes, extras). Transfers are V5's own objects.
"""
from __future__ import annotations

import numpy as np

from .core import NAN, compose, finite, r, tv
from app.engines import entrainment as E_ent  # noqa: E402
from app.engines import hazards as E_haz  # noqa: E402
from app.engines import initiation as E_ini  # noqa: E402
from app.engines import organisation as E_org  # noqa: E402
from app.engines import regime as E_reg  # noqa: E402
from app.engines import thermodynamic as E_thm  # noqa: E402
from app.engines import updraft as E_upd  # noqa: E402
from app.engines.base import IRREDUCIBLE_UNCERTAINTY  # noqa: E402
from app.engines.transfer import Rule  # noqa: E402


def _lcl(F, fixes):
    """V5's regime and tornado engines read a feature called `lcl`, which V5's feature
    builder never creates (it names the LCL `cloud_base`), so in V5 that factor is
    always absent. `fixes=True` (NOVA) reads the LCL that is actually there."""
    return F['cloud_base'] if fixes else np.full(F['cloud_base'].shape, NAN)


def _unc(u):
    """`Engine._result`: uncertainty floored at the irreducible level, rounded to 3."""
    return r(np.minimum(1.0, np.maximum(IRREDUCIBLE_UNCERTAINTY, u)), 3)


def _result(has, score, conf, unc, **extra):
    return dict(has=has, score=np.where(has, score, NAN), conf=np.where(has, conf, NAN),
                unc=np.where(has, _unc(unc), NAN), **extra)


def _ranked(classes, order, band):
    """Leader value, ambiguity count, as V5's sorted(...)-then-scan does."""
    vals = np.stack([np.where(np.isfinite(classes[k]), classes[k], -np.inf) for k in order])
    lead = vals.max(axis=0)
    lead_idx = vals.argmax(axis=0)          # first maximum, as a stable sort keeps it
    close = np.zeros(lead.shape, int)
    for i in range(len(order)):
        v = vals[i]
        close += ((i != lead_idx) & np.isfinite(v) & (lead - v <= band) & (v > 0.2)).astype(int)
    amb = np.where(close > 0, r(np.minimum(1.0, close / 3.0), 3), 0.0)
    return lead, amb


# ── weather_regime ──────────────────────────────────────────────────────────

def regime(F, hour, fixes=False):
    T = E_reg
    lcl = _lcl(F, fixes)
    night = np.where(hour < 12.0, hour + 24.0, hour)
    sep = F['mucape'] - F['sbcape']
    wanted = {
        'high_cape_surface_based': [tv(T.T_SBCAPE_HIGH, F['sbcape']), tv(T.T_CIN_WEAK, F['sbcin']),
                                    tv(T.T_LCL_BELOW_PBL, F['lcl_above_pbl']), tv(T.T_DAYTIME, hour)],
        'low_cape_high_shear': [tv(T.T_CAPE_MODEST, F['mucape']), tv(T.T_SHEAR_DEEP_STRONG, F['shear_0_6km'])],
        'elevated': [tv(T.T_ELEVATED_SEPARATION, sep), tv(T.T_CIN_STRONG, F['sbcin']), tv(T.T_MUCAPE_HIGH, F['mucape'])],
        'spanish_plume': [tv(T.T_LAPSE_MID_STEEP, F['lr_700_500']), tv(T.T_MUCAPE_HIGH, F['mucape']),
                          tv(T.T_CIN_STRONG, F['sbcin']), tv(T.T_FREEZING_HIGH, F['freezing_level']),
                          tv(T.T_PW_HIGH, F['precipitable_water'])],
        'maritime': [tv(T.T_LAPSE_LOW_STEEP, F['lr_0_3km']), tv(T.T_FREEZING_LOW, F['freezing_level']),
                     tv(T.T_LCL_LOW, lcl), tv(T.T_CAPE_MODEST, F['mucape'])],
        'orographic': [tv(T.T_ELEVATION_HIGH, F['elevation']), tv(T.T_MUCAPE_HIGH, F['mucape']),
                       tv(T.T_LCL_LOW, lcl)],
        'nocturnal': [tv(T.T_NIGHT, night), tv(T.T_ELEVATED_SEPARATION, sep), tv(T.T_MUCAPE_HIGH, F['mucape'])],
    }
    classes, evaluated = {}, 0
    requested = sum(len(v) for v in wanted.values())
    for name, ms in wanted.items():
        val, n = compose(Rule.INGREDIENTS, ms, 2)
        classes[name] = r(val, 4)
        evaluated = evaluated + np.where(np.isfinite(val), n, 0)
    has = np.any(np.stack([np.isfinite(c) for c in classes.values()]), axis=0)
    lead, amb = _ranked(classes, list(wanted), E_reg.WeatherRegimeEngine.AMBIGUITY_BAND)
    comp = evaluated / requested
    conf = r(comp * (1.0 - 0.4 * amb), 3)
    unc = r(np.minimum(1.0, 0.6 * (1.0 - comp) + 0.5 * amb), 3)
    return _result(has, lead, conf, unc, classes=classes, ambiguity=np.where(has, amb, 0.0))


def _cls(res, name, default=0.0):
    """regime.classes.get(name, default) where the engine has a score, else None (NaN)."""
    c = res['classes'].get(name)
    v = np.full(res['has'].shape, default) if c is None else np.where(np.isfinite(c), c, default)
    return np.where(res['has'], v, NAN)


# ── thermodynamic ───────────────────────────────────────────────────────────

def thermodynamic(F, reg):
    T = E_thm
    has_reg = reg['has']
    g = lambda k: np.where(has_reg, np.nan_to_num(reg['classes'][k], nan=0.0), 0.0)   # noqa: E731
    elevated = np.maximum.reduce([g('elevated'), g('spanish_plume'), g('nocturnal')])
    surface = g('high_cape_surface_based')
    A = T.ThermodynamicEngine.ELEVATED_AFFINITY
    mode = np.where((elevated >= A) & (elevated > surface), 0, np.where(surface >= A, 1, 2))
    orders = {0: ('mu', 'ml', 'sb'), 1: ('sb', 'ml', 'mu'), 2: ('ml', 'mu', 'sb')}
    cape = np.full(mode.shape, NAN)
    cin = np.full(mode.shape, NAN)
    parcel = np.full(mode.shape, -1, int)          # 0 sb, 1 ml, 2 mu
    pid = {'sb': 0, 'ml': 1, 'mu': 2}
    for m, order in orders.items():
        sel = mode == m
        for p in reversed(order):                   # first available in the order wins
            ok = sel & finite(F[f'{p}cape'])
            cape = np.where(ok, F[f'{p}cape'], cape)
            cin = np.where(ok, F[f'{p}cin'], cin)
            parcel = np.where(ok, pid[p], parcel)
    ms = [tv(T.T_CAPE_DEPTH, cape), tv(T.T_STORM_DEPTH, F['storm_depth']),
          tv(T.T_LAPSE_DEEP, F['lr_700_500']), tv(T.T_MOISTURE_DEPTH, F['precipitable_water'])]
    val, n = compose(Rule.INGREDIENTS, ms, 2)
    has = finite(cape) & finite(val)
    sb, mu = F['sbcape'], F['mucape']
    with np.errstate(invalid='ignore', divide='ignore'):
        dis = np.where(finite(sb) & finite(mu) & (mu > 50.0), r(np.minimum(1.0, np.maximum(0.0, (mu - sb) / mu)), 3), 0.0)
    amb = np.where(has_reg, reg['ambiguity'], 0.0)
    comp = n / 4.0
    conf = r(comp * (1.0 - 0.3 * amb), 3)
    unc = r(np.minimum(1.0, 0.5 * (1.0 - comp) + 0.4 * dis + 0.3 * amb), 3)
    out = _result(has, r(val, 4), conf, unc)
    out.update(representative_cape=np.where(has, r(cape, 1), NAN), parcel=parcel,
               cin_barrier=tv(T.T_CIN_BARRIER, cin), disagreement=dis)
    return out


# ── entrainment ─────────────────────────────────────────────────────────────

def entrainment(F, levels=0):
    T = E_ent
    dry, nd = compose(Rule.DOMINANT, [tv(T.T_MID_DRYNESS, F['mid_level_rh']), tv(T.T_DRIEST_LAYER, F['mid_level_min_rh'])], 1)
    exposure = tv(T.T_EXPOSURE, F['storm_depth'])
    val, _ = compose(Rule.INGREDIENTS, [dry, exposure], 1)
    has = finite(F['mid_level_rh']) & finite(dry) & finite(val)
    comp = (nd + finite(exposure).astype(int)) / 3.0
    levels = np.asarray(levels)
    pen = np.where(levels >= 12, 0.0, np.where(levels >= 8, 0.3, 0.5))
    conf = r(np.maximum(0.0, comp * (1.0 - pen)), 3)
    unc = r(np.minimum(1.0, 0.5 * (1.0 - comp) + pen), 3)
    return _result(has, r(val, 4), conf, unc)


# ── updraft ─────────────────────────────────────────────────────────────────

def updraft(F, thermo, ent):
    T = E_upd
    cape = np.where(thermo['has'], thermo['representative_cape'], NAN)
    cape = np.where(finite(cape), cape, F['mucape'])
    dil = np.where(ent['has'], ent['score'], NAN)
    has_dil = finite(dil)
    ms = [tv(T.T_BUOYANCY, cape), tv(T.T_DEPTH_FOR_ACCELERATION, F['storm_depth']),
          tv(T.T_LAPSE_ACCELERATION, F['lr_700_500']), np.where(has_dil, tv(T.T_DILUTION_SURVIVAL, dil), NAN)]
    val, n = compose(Rule.INGREDIENTS, ms, 2)
    has = finite(cape) & finite(val)
    nf = np.where(has_dil, 4.0, 3.0)
    comp = n / nf
    conf = r(comp * np.where(has_dil, 1.0, 0.6), 3)
    unc = r(np.minimum(1.0, 0.4 * (1.0 - comp) + 0.4 * np.where(has_dil, dil, 0.5)), 3)
    out = _result(has, r(val, 4), conf, unc)
    out['w_max'] = np.sqrt(2.0 * np.maximum(np.nan_to_num(cape), 0.0))
    return out


# ── convective_initiation ──────────────────────────────────────────────────

def initiation(F, hour):
    T = E_ini
    mu = F['mucape']
    core = [tv(T.T_INSTABILITY_PRESENT, mu), tv(T.T_CAP_BREAKABLE, F['sbcin']),
            tv(T.T_CLOUD_BASE_REACHABLE, F['lcl_above_pbl']), tv(T.T_BL_MOISTURE, F['boundary_layer_mixing_ratio'])]
    conv = F['convergence']
    has_forcing = finite(conv)
    forcing = np.where(has_forcing, tv(T.T_CONVERGENCE, conv), NAN)
    support, _ = compose(Rule.DOMINANT, [tv(T.T_HEATING, hour), tv(T.T_ELEVATION_TRIGGER, F['elevation'])], 1)
    use_trigger = ~has_forcing & finite(support)
    trigger = np.where(use_trigger, support, NAN)
    val, n = compose(Rule.INGREDIENTS, core + [forcing, trigger], 2)
    has = finite(mu) & finite(val)
    ceiling = T.InitiationEngine.NO_FORCING_CEILING
    score = np.where(has_forcing, val, np.minimum(val, ceiling))
    nf = 4 + has_forcing.astype(int) + use_trigger.astype(int)
    comp = n / nf
    cin = F['sbcin']
    cap_u = np.where(finite(cin), r(np.maximum(0.0, 1.0 - np.abs(np.abs(cin) - 50.0) / 50.0), 3), 0.5)
    conf = r(comp * np.where(has_forcing, 1.0, 0.35), 3)
    unc = r(np.minimum(1.0, 0.4 * (1.0 - comp) + np.where(has_forcing, 0.0, 0.5) + 0.3 * cap_u), 3)
    out = _result(has, r(np.clip(score, 0.0, 1.0), 4), conf, unc)
    out['forcing_available'] = has_forcing
    out['capability'] = np.where(has, r(val, 4), NAN)
    return out


# ── storm_organisation ─────────────────────────────────────────────────────

def organisation(F, reg):
    T = E_org
    mu = F['mucape']
    elev = np.where(reg['has'], np.maximum(np.where(reg['has'], np.nan_to_num(reg['classes']['elevated'], nan=0.0), 0.0),
                                           np.nan_to_num(reg['classes']['nocturnal'], nan=0.0)), NAN)
    s6, s3 = F['shear_0_6km'], F['shear_0_3km']
    modes = {
        'pulse_single_cell': [tv(T.T_SHEAR_DEEP_WEAK, s6), tv(T.T_CAPE_PULSE, mu)],
        'multicell': [tv(T.T_SHEAR_MULTICELL, s6), tv(T.T_CAPE_FOR_ORGANISATION, mu)],
        'organised_multicell': [tv(T.T_SHEAR_MULTICELL, s6), tv(T.T_CAPE_FOR_ORGANISATION, mu),
                                tv(T.T_INFLOW, F['storm_relative_inflow_1km'])],
        'linear_qlcs': [tv(T.T_SHEAR_LOW_LINEAR, s3), tv(T.T_CAPE_FOR_ORGANISATION, mu)],
        'supercell_favourable': [tv(T.T_SHEAR_DEEP_SUPERCELL, s6), tv(T.T_SRH_ROTATION, F['srh_0_3km']),
                                 tv(T.T_CAPE_FOR_ORGANISATION, mu), tv(T.T_BRN_SUPERCELL, F['bulk_richardson_number'])],
        'elevated': [tv(T.T_ELEVATED_ORIGIN, elev), tv(T.T_CAPE_FOR_ORGANISATION, mu)],
    }
    classes, evaluated = {}, 0
    requested = sum(len(v) for v in modes.values())
    for name, ms in modes.items():
        val, n = compose(Rule.INGREDIENTS, ms, 2)
        classes[name] = r(val, 4)
        evaluated = evaluated + np.where(np.isfinite(val), n, 0)
    anyc = np.any(np.stack([np.isfinite(c) for c in classes.values()]), axis=0)
    has = finite(mu) & anyc
    lead, amb = _ranked(classes, list(modes), T.OrganisationEngine.AMBIGUITY_BAND)
    comp = evaluated / requested
    conf = r(comp * (1.0 - 0.35 * amb), 3)
    unc = r(np.minimum(1.0, 0.5 * (1.0 - comp) + 0.4 * amb), 3)
    return _result(has, lead, conf, unc, classes=classes)


def _cls_get(res, name):
    """organisation.classes.get(name) -> None where not evaluated or no score."""
    return np.where(res['has'], res['classes'][name], NAN)


# ── hazard engines ─────────────────────────────────────────────────────────

def _hazard(rule, minimum, members, init):
    val, n = compose(rule, members, minimum)
    has = finite(val)
    sp = np.where(init['has'], init['score'], NAN)
    have_sp = finite(sp)
    score = np.where(have_sp, val * sp, val)
    comp = n / max(len(members), 1)
    ic = np.where(finite(init['conf']), init['conf'], 0.3)
    iu = np.where(finite(init['unc']), init['unc'], 0.6)
    conf = r(comp * ic, 3)
    unc = r(np.minimum(1.0, 0.4 * (1.0 - comp) + 0.6 * iu), 3)
    out = _result(has, r(np.clip(score, 0.0, 1.0), 4), conf, unc)
    out['conditional'] = np.where(has, r(val, 4), NAN)
    return out


def lightning(F, upd, init):
    T = E_haz
    us = np.where(upd['has'], upd['score'], NAN)
    return _hazard(Rule.INGREDIENTS, 2, [tv(T.T_MIXED_PHASE_DEPTH, F['cold_cloud_depth']),
                                         tv(T.T_UPDRAFT_FOR_CHARGE, us),
                                         tv(T.T_STORM_DEPTH_LIGHTNING, F['storm_depth'])], init)


def hail(F, upd, org, init):
    T = E_haz
    us = np.where(upd['has'], upd['score'], NAN)
    out = _hazard(Rule.INGREDIENTS, 2, [tv(T.T_HAIL_GROWTH_DEPTH, F['cold_cloud_depth']),
                                        tv(T.T_WBZ_SURVIVAL, F['wet_bulb_zero']),
                                        tv(T.T_UPDRAFT_FOR_HAIL, us), tv(T.T_MID_LAPSE_HAIL, F['lr_700_500'])], init)
    orgf, _ = compose(Rule.DOMINANT, [tv(T.T_ORGANISATION_FOR_HAIL, _cls_get(org, 'supercell_favourable')),
                                      tv(T.T_MULTICELL_FOR_HAIL, _cls_get(org, 'organised_multicell'))], 1)
    orgf = np.where(org['has'], orgf, NAN)
    sig, _ = compose(Rule.INGREDIENTS, [tv(T.T_HAIL_GROWTH_DEPTH, F['cold_cloud_depth']), tv(T.T_UPDRAFT_FOR_HAIL, us),
                                        orgf, tv(T.T_WBZ_SURVIVAL, F['wet_bulb_zero'])], 3)
    out['significant'] = np.where(out['has'], r(sig, 4), NAN)
    return out


def severe_wind(F, org, init):
    T = E_haz
    linear = np.where(org['has'], np.maximum(np.nan_to_num(org['classes']['linear_qlcs'], nan=0.0),
                                             np.nan_to_num(org['classes']['organised_multicell'], nan=0.0)), NAN)
    evap, _ = compose(Rule.INGREDIENTS, [tv(T.T_DCAPE_WIND, F['dcape']), tv(T.T_LOW_LAPSE_WIND, F['lr_0_3km'])], 1)
    mom, _ = compose(Rule.INGREDIENTS, [tv(T.T_DEEP_FLOW_MOMENTUM, F['shear_0_6km']),
                                        tv(T.T_ORGANISATION_FOR_WIND, linear)], 1)
    # V5 passes only the mechanisms that exist, so completeness is 1 wherever it scores
    val, n = compose(Rule.ALTERNATIVES, [evap, mom], 1)
    has = finite(val)
    sp = np.where(init['has'], init['score'], NAN)
    score = np.where(finite(sp), val * sp, val)
    nf = np.maximum(finite(evap).astype(int) + finite(mom).astype(int), 1)
    comp = n / nf
    ic = np.where(finite(init['conf']), init['conf'], 0.3)
    iu = np.where(finite(init['unc']), init['unc'], 0.6)
    out = _result(has, r(np.clip(score, 0, 1), 4), r(comp * ic, 3), r(np.minimum(1.0, 0.4 * (1 - comp) + 0.6 * iu), 3))
    out['conditional'] = np.where(has, r(val, 4), NAN)
    out['evaporative'] = r(evap, 4)
    out['momentum'] = r(mom, 4)
    return out


def downburst(F, init):
    T = E_haz
    return _hazard(Rule.INGREDIENTS, 2, [tv(T.T_DCAPE_DOWNBURST, F['dcape']), tv(T.T_SUBCLOUD_DRYNESS, F['low_level_rh']),
                                         tv(T.T_DEEP_SUBCLOUD, F['sub_cloud_depth']), tv(T.T_LOW_LAPSE_WIND, F['lr_0_3km'])], init)


def tornado(F, org, init, fixes=False):
    T = E_haz
    return _hazard(Rule.INGREDIENTS, 2, [tv(T.T_LOW_LEVEL_SHEAR_TOR, F['shear_0_1km']), tv(T.T_SRH_LOW_TOR, F['srh_0_1km']),
                                         tv(T.T_LCL_TORNADO, _lcl(F, fixes)),
                                         tv(T.T_SUPERCELL_FOR_TORNADO, _cls_get(org, 'supercell_favourable'))], init)


def heavy_rain(F, init):
    T = E_haz
    return _hazard(Rule.INGREDIENTS, 2, [tv(T.T_PW_RAIN, F['precipitable_water']), tv(T.T_WARM_CLOUD_RAIN, F['warm_cloud_depth']),
                                         tv(T.T_INFLOW_MOISTURE, F['boundary_layer_mixing_ratio']),
                                         tv(T.T_SLOW_STORM_MOTION, F['storm_motion_speed'])], init)


def run_all(F, hour, levels=0, fixes=False):
    """Every engine in V5's dependency order."""
    R = {}
    R['weather_regime'] = regime(F, hour, fixes)
    R['thermodynamic'] = thermodynamic(F, R['weather_regime'])
    R['entrainment'] = entrainment(F, levels)
    R['updraft'] = updraft(F, R['thermodynamic'], R['entrainment'])
    R['convective_initiation'] = initiation(F, hour)
    R['storm_organisation'] = organisation(F, R['weather_regime'])
    init = R['convective_initiation']
    R['lightning'] = lightning(F, R['updraft'], init)
    R['hail'] = hail(F, R['updraft'], R['storm_organisation'], init)
    R['severe_wind'] = severe_wind(F, R['storm_organisation'], init)
    R['downburst'] = downburst(F, init)
    R['tornado_environment'] = tornado(F, R['storm_organisation'], init, fixes)
    R['heavy_rainfall'] = heavy_rain(F, init)
    return R
