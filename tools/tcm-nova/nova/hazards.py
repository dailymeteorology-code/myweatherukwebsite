"""Hazard probabilities from the blended fields, source-model convective signals and
ensemble exceedance probabilities. Deterministic formulas only.

Every probability here is UNCALIBRATED until verify.py has a reliability record;
the manifest says so. A favourable environment is never turned into a storm on its
own: every hazard probability is conditional on P(thunderstorm), which needs a model
or ensemble convective signal, and terrain/environment terms can only modulate it
(raise or lower) where the column can support deep convection.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage


def s(x, a, b):
    """Smoothstep 0..1 from a to b (b<a gives a decreasing ramp)."""
    t = np.clip((np.asarray(x, np.float32) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def nb_max(a, radius_cells):
    if radius_cells < 1:
        return a
    r = int(radius_cells)
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    return ndimage.maximum_filter(np.nan_to_num(a), footprint=(xx * xx + yy * yy) <= r * r)


def nb_mean(a, radius_cells):
    return ndimage.uniform_filter(np.nan_to_num(a), 2 * max(int(radius_cells), 0) + 1)


def model_signal(sfc, cape_env):
    """Per-source convective signal 0..1 from its own precipitation and instability."""
    pr = sfc.get('precip')
    if pr is None:
        return None
    cape = sfc.get('cape_mu_src', cape_env)
    sig = s(cape, 100, 800) * s(pr, 0.3, 3.0)
    if 'cin_mu_src' in sfc:
        sig = sig * np.clip(1 + sfc['cin_mu_src'] / 250.0, 0.3, 1.0)
    if 'conv_rain' in sfc:                                   # MO Global's own convective rain
        sig = np.maximum(sig, s(cape, 100, 600) * s(sfc['conv_rain'] * 3600, 0.3, 2.0))
    if 'lightning_lpi' in sfc:                               # ICON-EU lightning potential index (J/kg)
        sig = np.maximum(sig, s(sfc['lightning_lpi'], 1.0, 8.0))
    if 'lightning' in sfc:                                   # UKV explicit lightning (flashes/km²/h)
        sig = np.maximum(sig, s(sfc['lightning'], 0.003, 0.08))
    return np.nan_to_num(sig).astype(np.float32)


def ensemble_probs(members, cape_env):
    """Event probabilities from members (equal member weights)."""
    pr = members['precip']
    cape = members.get('cape')
    if cape is not None:
        thunder = ((pr >= 0.5) & (cape >= 150)).mean(0)
    else:
        thunder = (pr >= 1.0).mean(0) * s(cape_env, 100, 600)     # environment from the blend
    return {
        'thunder': thunder.astype(np.float32),
        'p_rain_1': (pr >= 1).mean(0).astype(np.float32),
        'p_rain_5': (pr >= 5).mean(0).astype(np.float32),
        'p_rain_10': (pr >= 10).mean(0).astype(np.float32),
        'precip_mean': pr.mean(0).astype(np.float32),
        'precip_spread': pr.std(0).astype(np.float32),
        'cape_mean': None if cape is None else cape.mean(0).astype(np.float32),
        'cape_spread': None if cape is None else cape.std(0).astype(np.float32),
    }


def compute(F, D, terr, flow, signals, ens, w_init, w_haz, dx_m, lead_h, prev=None):
    """F blended surface fields, D diagnostics, terr static terrain, flow terrain–flow
    diagnostics, signals {model: 0..1}, ens {model: probs}, w_* {model: (ny,nx) weights}."""
    out = {}
    cape = np.nan_to_num(D['mu_cape'])
    cin = np.nan_to_num(D['ml_cin'])
    # 1. source blend of convective signal (deterministic signals + ensemble thunder probs)
    num = np.zeros_like(cape)
    den = np.zeros_like(cape)
    for m, sig in signals.items():
        if m in w_init:
            num += w_init[m] * sig
            den += w_init[m]
    for m, pr in ens.items():
        if m in w_init:
            num += w_init[m] * pr['thunder']
            den += w_init[m]
    p_models = np.where(den > 0, num / np.maximum(den, 1e-6), 0)
    out['p_thunder_models'] = p_models
    out['p_thunder_raw'] = p_models
    # 2. physical modulation by lift, inhibition and terrain — both signs
    env = s(cape, 50, 600) * s(cin, -250, -25)
    lift_syn = s(-np.nan_to_num(D.get('omega_700', np.zeros_like(cape))), 0.05, 0.6)
    lift_conv = s(np.nan_to_num(F['conv_10m']) * 1e4, 0.2, 1.5)
    w_oro = np.nan_to_num(flow.get('w_oro_eff', flow['w_oro']))
    oro_up = s(w_oro, 0.05, 0.5)
    oro_down = s(-w_oro, 0.05, 0.5)
    heat = s(np.nan_to_num(F.get('t2', cape * 0) - D['convective_temperature']), -3, 1)   # surface reaches Tc
    lift = np.clip(np.maximum.reduce([lift_syn, lift_conv, oro_up * s(D['pbl_height'], 300, 1200) + 0.0, heat]), 0, 1)
    out['ci_lift_index'] = lift
    factor = 1.0 + env * (0.45 * oro_up + 0.25 * lift_conv + 0.2 * heat - 0.35 * oro_down - 0.3 * s(-cin, 100, 300))
    factor = np.clip(factor, 0.55, 1.6)
    out['terrain_modulation'] = np.where(env > 0.05, 1.0 + env * (0.45 * oro_up - 0.35 * oro_down), 1.0).astype(np.float32)
    p_cell = np.clip(p_models * factor, 0, 1)
    # 3. neighbourhood: storm within ~r km; r grows with lead to reflect placement error
    r_km = 10 + 0.35 * lead_h
    rc = r_km * 1000 / dx_m
    p_ts = np.clip(0.6 * nb_max(p_cell, rc) + 0.4 * nb_mean(p_cell, rc), 0, 1)
    p_ts = ndimage.gaussian_filter(p_ts, 1.0)
    out['p_thunder'] = p_ts.astype(np.float32)
    out['neighbourhood_km'] = r_km
    # orographic CI probability: the terrain-attributable part only
    out['p_ci_orographic'] = np.clip(p_ts * env * oro_up * s(D['pbl_height'], 300, 1200), 0, 1).astype(np.float32)
    out['p_initiation'] = np.clip(p_ts - (prev if prev is not None else 0), 0, 1).astype(np.float32) if prev is not None else (p_ts * lift).astype(np.float32)
    # 4. lightning: mixed-phase depth and buoyancy there, UKV explicit lightning where present
    mp = s(D['mu_cape_mixed_phase'], 50, 500)
    if 'charging_index' in F:                                # graupel–ice–SLW collisions present in the model
        mp = np.maximum(mp, nb_max(s(np.nan_to_num(F['charging_index']), 0.5, 20), rc))
    p_lt = p_ts * (0.55 + 0.45 * mp)
    if 'lpi' in F:                                           # ICON-EU lightning potential index
        p_lt = np.maximum(p_lt, nb_max(s(np.nan_to_num(F['lpi']), 1.0, 8.0), rc) * 0.8)
    if 'lightning' in F:
        p_lt = np.maximum(p_lt, nb_max(s(np.nan_to_num(F['lightning']), 0.003, 0.08), rc) * 0.9)
    out['p_lightning'] = np.clip(p_lt, 0, 1).astype(np.float32)
    # lightning is what makes a thunderstorm: P(thunder) can never be below P(lightning)
    p_ts = np.maximum(p_ts, out['p_lightning'])
    out['p_thunder'] = p_ts.astype(np.float32)
    H = np.clip(np.nan_to_num(D['mu_el_z']) / 1000, 0, 16)
    fr = 3.44e-5 * H ** 4.9                                          # Price & Rind (1992), flashes/min/storm
    out['flash_rate_per_storm_min'] = (fr * (H > 5)).astype(np.float32)
    out['flash_density'] = (p_ts * fr * 60 / 100.0).astype(np.float32)   # per km² per h, storm area ~100 km²
    if 'lightning' in F:
        out['flash_density'] = np.maximum(out['flash_density'], np.nan_to_num(F['lightning']))
    # 5. hail: parcel-bound updraft, loading/entrainment factor, terminal-velocity balance, melting
    w_up = 0.5 * np.sqrt(2 * cape)
    D0 = (np.maximum(w_up, 0) / 9.0) ** 1.25                          # cm; v_t ≈ 9 D^0.8 (Knight & Heymsfield)
    D0 *= 0.6 + 0.4 * s(D['shear_0_6km'], 10, 25)                     # organised updrafts sustain growth
    wbz_km = np.nan_to_num(D['wbz'], nan=3000) / 1000
    melt = 0.12 * np.maximum(wbz_km, 0) ** 1.6
    Dsfc = np.maximum(D0 - melt * np.exp(-D0 / 3), 0)
    Dsfc *= s(D['lapse_700_500'], 5.5, 7.5) * 0.4 + 0.6
    out['updraft_estimate'] = w_up.astype(np.float32)
    out['hail_size_max_cm'] = (Dsfc * (p_ts > 0.05)).astype(np.float32)
    out['hail_melt_loss_cm'] = melt.astype(np.float32)
    p_h = p_ts * s(Dsfc, 0.8, 2.5)
    if 'hail' in F:
        p_h = np.maximum(p_h, nb_max(s(np.nan_to_num(F['hail']), 0.05, 1.0), rc) * p_ts)
    out['p_hail'] = np.clip(p_h, 0, 1).astype(np.float32)
    out['p_hail_sig'] = np.clip(p_ts * s(Dsfc, 3.0, 5.0), 0, 1).astype(np.float32)
    out['hail_survival'] = s(D0 - melt, 0, 1.5).astype(np.float32)
    # 6. wind: downdraft from DCAPE (with loading/entrainment 0.4), momentum transfer
    wd = 0.4 * np.sqrt(2 * np.maximum(np.nan_to_num(D['dcape']), 0))
    mean03 = np.hypot(D['mean_wind_u'], D['mean_wind_v'])
    g_conv = np.sqrt(wd ** 2 + (0.6 * np.nan_to_num(mean03)) ** 2)
    out['downdraft_estimate'] = wd.astype(np.float32)
    out['gust_convective'] = (g_conv * (p_ts > 0.1)).astype(np.float32)
    out['gust_max'] = np.fmax(np.nan_to_num(F.get('gust', g_conv * 0)), out['gust_convective']).astype(np.float32)
    dry_sub = s(np.nan_to_num(D['ml_lcl_z']), 800, 2000)
    out['p_downburst'] = np.clip(p_ts * s(D['dcape'], 400, 1100) * (0.5 + 0.5 * dry_sub), 0, 1).astype(np.float32)
    out['p_wind_damaging'] = np.clip(p_ts * s(g_conv, 18, 28), 0, 1).astype(np.float32)
    # 7. supercell / tornado ENVIRONMENT (not occurrence)
    out['p_supercell'] = np.clip(p_ts * s(D['scp'], 0.5, 4), 0, 1).astype(np.float32)
    out['p_tornado_env'] = np.clip(p_ts * s(D['stp'], 0.2, 1.5), 0, 1).astype(np.float32)
    # 8. heavy rain / training / flash-flood potential
    pr = np.nan_to_num(F.get('precip', cape * 0))
    pe = [e['p_rain_10'] for e in ens.values()]
    p_hr = np.maximum(nb_max(s(pr, 4, 15), rc) * 0.8, np.mean(pe, 0) if pe else 0)
    out['p_heavy_rain'] = np.clip(np.maximum(p_hr, p_ts * s(D['pw'], 25, 40)), 0, 1).astype(np.float32)
    out['p_training'] = np.clip(p_ts * s(D['corfidi_upshear'], 10, 3), 0, 1).astype(np.float32)
    # 9. organisation (0 none, 1 single, 2 multicell, 3 supercell, 4 linear/MCS)
    cov = nb_mean((p_ts > 0.4).astype(np.float32), 50000 / dx_m)
    org = np.zeros_like(cape, dtype=np.int8)
    sh = np.nan_to_num(D['shear_0_6km'])
    org[p_ts > 0.15] = 1
    org[(p_ts > 0.15) & (sh >= 10)] = 2
    org[(p_ts > 0.15) & (sh >= 15) & (cov > 0.35) & (D['dcape'] > 500)] = 4
    org[(p_ts > 0.15) & (sh >= 18) & (D['scp'] >= 1)] = 3
    out['organisation'] = org
    out['p_mcs'] = np.clip(p_ts * s(cov, 0.2, 0.6) * s(sh, 10, 20), 0, 1).astype(np.float32)
    out['coverage_50km'] = cov.astype(np.float32)
    # 10. intensity class and severe probability (independence assumed — documented)
    sev = 1 - (1 - out['p_hail_sig']) * (1 - out['p_wind_damaging']) * (1 - 0.5 * out['p_tornado_env'])
    out['p_severe'] = np.clip(sev, 0, 1).astype(np.float32)
    inten = np.zeros_like(org)
    inten[p_ts >= 0.15] = 1
    inten[(p_ts >= 0.3) & ((out['p_hail'] > 0.2) | (out['gust_convective'] > 18))] = 2
    inten[out['p_severe'] >= 0.15] = 3
    out['intensity_class'] = inten
    # 11. confidence: weighted disagreement among sources + ensemble spread
    vals = [signals[m] for m in signals] + [e['thunder'] for e in ens.values()]
    spread = np.std(vals, 0) if len(vals) > 1 else np.full_like(cape, 0.25)
    out['source_disagreement'] = spread.astype(np.float32)
    out['confidence'] = np.clip(1 - spread / 0.35, 0, 1).astype(np.float32) * (1 - 0.004 * lead_h)
    return out
