"""Derived thermodynamic, kinematic and synoptic diagnostics from the blended 3-D state.

Column diagnostics come from thermo.py on every 2 km column; horizontal-derivative
diagnostics (vorticity, divergence, advection, frontogenesis, Q-vectors, PV) are computed
on the grid in metres (BNG scale factor ≈1, error <0.04 %). Fields that need storm-scale
model output NOT published on AWS (updraft helicity, hydrometeor mixing ratios, explicit
updraft speeds) are not faked here — see variables.py for their status.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from . import thermo as th

OMEGA = 7.2921e-5


def column_diagnostics(C, shape):
    N = C['p'].shape[1]
    sb, ml, mu = th.parcels(C)
    dc, dc_src = th.dcape(C)
    u, v = th.winds_on_heights(C)
    rmu, rmv, mwu, mwv = th.bunkers(u, v)
    eb, et = th.effective_layer(C, mucape=mu['cape'])
    out = {}
    for name, P in (('sb', sb), ('ml', ml), ('mu', mu)):
        for k in ('cape', 'cin', 'lcl_z', 'lfc_z', 'el_z', 'cape_0_3km', 'cape_mixed_phase', 'bmax'):
            out[f'{name}_{k}'] = P[k]
    out['dcape'] = dc
    out['wmax_parcel'] = np.sqrt(2 * np.maximum(mu['cape'], 0)).astype(np.float32)   # parcel-theory upper bound
    # indices (kept alongside — never instead of — the fields they summarise)
    T850, T700, T500 = (th.interp_p(C, 'T', p) for p in (850, 700, 500))
    Td850, Td700 = th.interp_p(C, 'Td', 850), th.interp_p(C, 'Td', 700)
    out['k_index'] = ((T850 - T500) + (Td850 - 273.15) - (T700 - Td700)).astype(np.float32)
    out['total_totals'] = (T850 + Td850 - 2 * T500).astype(np.float32)
    k500 = np.argmin(np.abs(C['p'] - 500), 0)
    cols = np.arange(N)
    out['lifted_index'] = (T500 - _parcel_at(ml, C, 500)).astype(np.float32)
    p850 = np.full(N, 850.0)
    ok850 = C['p'][0] > 850
    s850 = th.lift(C, p850, np.where(ok850, T850, C['T'][0]), np.where(ok850, Td850, C['Td'][0]))
    out['showalter_index'] = np.where(ok850, T500 - _parcel_at(s850, C, 500), np.nan).astype(np.float32)
    # lapse rates (K/km, positive = cooling with height)
    for a, b, nm in ((0, 1000, 'lapse_0_1km'), (0, 3000, 'lapse_0_3km'), (3000, 6000, 'lapse_3_6km')):
        ta, tb = (C['T'][0] if a == 0 else th.interp_at(C, 'T', None, a)), th.interp_at(C, 'T', None, b)
        out[nm] = ((ta - tb) / ((b - a) / 1000)).astype(np.float32)
    z700, z500, z300 = (th.interp_p(C, 'z', p) for p in (700, 500, 300))
    out['lapse_700_500'] = ((T700 - T500) / np.maximum((z500 - z700) / 1000, 0.1)).astype(np.float32)
    out['lapse_500_300'] = ((T500 - th.interp_p(C, 'T', 300)) / np.maximum((z300 - z500) / 1000, 0.1)).astype(np.float32)
    # freezing / isotherm levels, wet-bulb zero
    for t, nm in ((273.15, 'freezing_level'), (263.15, 'z_m10'), (253.15, 'z_m20'), (243.15, 'z_m30'), (233.15, 'z_m40')):
        out[nm] = th.crossing_height(C, 'T', t)
    C['Tw'] = th.wet_bulb(C['T'], C['Td'], C['p'])
    out['wbz'] = th.crossing_height(C, 'Tw', 273.15)
    out['tw_2m'] = C['Tw'][0]
    out['mixed_phase_depth'] = (out['z_m40'] - out['z_m10']).astype(np.float32)
    # moisture
    out['pw'] = th.precipitable_water(C)
    out['pw_low'] = th.precipitable_water(C, None, 850)
    out['pw_mid'] = th.precipitable_water(C, 850, 500)
    out['pw_upper'] = th.precipitable_water(C, 500, 200)
    out['rh_700_500'] = np.nanmean(np.where((C['p'] <= 700) & (C['p'] >= 500), C['rh'], np.nan), 0).astype(np.float32)
    out['rh_subcloud'] = np.nanmean(np.where(C['z_agl'] <= np.maximum(ml['lcl_z'], 250)[None, :], C['rh'], np.nan), 0).astype(np.float32)
    out['dewpoint_depression_850'] = (T850 - Td850).astype(np.float32)
    # convective temperature: dry adiabat from the surface-mean-r intersection with the env
    r0 = C['r'][0]
    rs = th.mixing_ratio(th.es_hpa(C['T']), C['p'])
    hit = (rs <= r0[None, :]) & np.isfinite(rs)
    kc = np.argmax(hit, 0)
    pc, Tcl = C['p'][kc, cols], C['T'][kc, cols]
    out['convective_temperature'] = np.where(hit.any(0), Tcl * (C['p'][0] / pc) ** th.KAPPA, np.nan).astype(np.float32)
    # capping inversion: max SB parcel deficit below 700 hPa and inversion depth
    def_ = np.where((C['p'] >= 700) & np.isfinite(sb['B']), -sb['B'] / th.G * C['Tv'], np.nan)
    out['cap_strength'] = np.nanmax(np.where(np.isfinite(def_), def_, -99), 0).clip(0).astype(np.float32)
    dT = np.diff(C['T'], axis=0)
    dz = np.diff(C['z'], axis=0)
    inv = (dT > 0) & (0.5 * (C['p'][1:] + C['p'][:-1]) >= 700)
    out['inversion_depth'] = np.where(inv & np.isfinite(dz), dz, 0).sum(0).astype(np.float32)
    # boundary layer: parcel method (Holtzworth / Seibert et al. 2000) on θv
    thv = C['theta_v']
    above = (thv > thv[0][None, :] + 0.5) & (np.arange(thv.shape[0])[:, None] > 0)
    kb = np.argmax(above, 0)
    out['pbl_height'] = np.where(above.any(0), C['z_agl'][kb, cols], np.nan).astype(np.float32)
    N2 = th.G / thv[0] * (th.interp_at(C, 'theta_v', None, 2000) - thv[0]) / 2000
    out['bv_freq_0_2km'] = np.sqrt(np.clip(N2, 1e-8, None)).astype(np.float32)
    # kinematics
    for a, b in ((0, 1000), (0, 3000), (0, 6000), (0, 8000)):
        out[f'shear_{a // 1000}_{b // 1000}km'] = th.bulk_shear(u, v, a, b)
    out['storm_u'], out['storm_v'] = rmu.astype(np.float32), rmv.astype(np.float32)
    out['mean_wind_u'], out['mean_wind_v'] = mwu.astype(np.float32), mwv.astype(np.float32)
    out['srh_0_1km'] = th.srh(u, v, rmu, rmv, 0, 1000)
    out['srh_0_3km'] = th.srh(u, v, rmu, rmv, 0, 3000)
    has_eff = np.isfinite(eb)
    out['eff_inflow_base'] = eb
    out['eff_inflow_top'] = et
    out['eff_inflow_depth'] = np.where(has_eff, et - eb, 0).astype(np.float32)
    out['esrh'] = np.where(has_eff, th.srh_layer(u, v, rmu, rmv, np.nan_to_num(eb), np.nan_to_num(et)), 0).astype(np.float32)
    ebwd_top = np.where(has_eff, eb + 0.5 * np.nan_to_num(mu['el_z'] - eb), 6000)
    ub, vb = th.interp_heights(u, np.nan_to_num(eb)), th.interp_heights(v, np.nan_to_num(eb))
    ut, vt = th.interp_heights(u, ebwd_top), th.interp_heights(v, ebwd_top)
    out['ebwd'] = np.where(has_eff, np.hypot(ut - ub, vt - vb), 0).astype(np.float32)
    # composite parameters (Thompson et al. 2003/2012; Hart & Korotky 1991)
    ebwd_t = np.where(out['ebwd'] < 10, 0, np.minimum(out['ebwd'] / 20, 1.5))
    out['scp'] = (np.maximum(mu['cape'], 0) / 1000 * np.maximum(out['esrh'], 0) / 50 * ebwd_t).astype(np.float32)
    lcl_t = np.clip((2000 - ml['lcl_z']) / 1000, 0, 1)
    cin_t = np.clip((ml['cin'] + 200) / 150, 0, 1)
    ebwd_s = np.where(out['ebwd'] < 12.5, 0, np.minimum(out['ebwd'] / 20, 1.5))
    out['stp'] = (np.maximum(ml['cape'], 0) / 1500 * np.maximum(out['esrh'], 0) / 150 * ebwd_s * lcl_t * cin_t).astype(np.float32)
    out['ehi_0_1km'] = (sb['cape'] * out['srh_0_1km'] / 160000).astype(np.float32)
    out['ehi_0_3km'] = (sb['cape'] * out['srh_0_3km'] / 160000).astype(np.float32)
    u05, v05 = th.mean_wind(u, v, 0, 500)
    shr = 0.5 * ((mwu - u05) ** 2 + (mwv - v05) ** 2)
    out['brn_shear'] = shr.astype(np.float32)
    out['brn'] = (mu['cape'] / np.maximum(shr, 1)).astype(np.float32)
    srx, sry = u[:5].mean(0) - rmu, v[:5].mean(0) - rmv
    out['sr_inflow_speed'] = np.hypot(srx, sry).astype(np.float32)
    out['sr_inflow_dir'] = ((np.degrees(np.arctan2(-srx, -sry)) + 360) % 360).astype(np.float32)
    out['horiz_vorticity_0_500m'] = (np.hypot(u[2] - u[0], v[2] - v[0]) / 500).astype(np.float32)
    ws = np.hypot(C['u'], C['v'])
    low = (C['z_agl'] <= 1500) & np.isfinite(ws)
    wlow = np.where(low, ws, -1)
    kj = np.argmax(wlow, 0)
    out['llj_speed'] = wlow.max(0).clip(0).astype(np.float32)
    out['llj_height'] = C['z_agl'][kj, cols].astype(np.float32)
    out['wind_500'] = np.hypot(th.interp_p(C, 'u', 500), th.interp_p(C, 'v', 500)).astype(np.float32)
    out['wind_250'] = np.hypot(th.interp_p(C, 'u', 250), th.interp_p(C, 'v', 250)).astype(np.float32)
    # Corfidi upshear vector: cloud-layer mean wind minus the low-level jet (Corfidi 2003)
    ucl = np.nanmean([th.interp_p(C, 'u', p) for p in (850, 700, 500, 300)], 0)
    vcl = np.nanmean([th.interp_p(C, 'v', p) for p in (850, 700, 500, 300)], 0)
    out['corfidi_upshear'] = np.hypot(ucl - th.interp_p(C, 'u', 850), vcl - th.interp_p(C, 'v', 850)).astype(np.float32)
    if 'w' in C:
        out['omega_700'] = th.interp_p(C, 'w', 700).astype(np.float32)
        out['omega_850'] = th.interp_p(C, 'w', 850).astype(np.float32)
    return {k: np.asarray(v, np.float32).reshape(shape) for k, v in out.items()}


def _parcel_at(P, C, p):
    """Parcel temperature (not virtual) at pressure p from a lift() result."""
    Tvp = P['Tvp']
    tv = th.interp_at({'x': -np.log(C['p']), 'a': Tvp}, 'a', None, -np.log(p), coordkey='x')
    r = th.mixing_ratio(th.es_hpa(tv), p)
    return tv * (1 + r) / (1 + r / th.EPS)


def grid_diagnostics(fields, lat, dx, smooth_km=25):
    """Horizontal-derivative diagnostics. Inputs on pressure levels (2-D arrays)."""
    f = 2 * OMEGA * np.sin(np.deg2rad(lat))
    sig = smooth_km * 1000 / dx / 2.355
    S = lambda a: ndimage.gaussian_filter(np.nan_to_num(a, nan=np.nanmean(a) if np.isfinite(a).any() else 0), sig)
    d_dx = lambda a: np.gradient(a, dx, axis=1)
    d_dy = lambda a: np.gradient(a, dx, axis=0)
    out = {}
    u10, v10 = S(fields['u10']), S(fields['v10'])
    out['div_10m'] = d_dx(u10) + d_dy(v10)
    out['conv_10m'] = -out['div_10m']
    out['vort_10m'] = d_dx(v10) - d_dy(u10)
    q2 = S(fields['q2'])
    out['mfc_sfc'] = -(d_dx(q2 * u10) + d_dy(q2 * v10)) * 1000 * 3600          # g/kg per hour
    for p in (925, 850, 500, 300, 250):
        if f'u{p}' not in fields:
            continue
        u, v = S(fields[f'u{p}']), S(fields[f'v{p}'])
        out[f'div_{p}'] = d_dx(u) + d_dy(v)
        out[f'vort_{p}'] = d_dx(v) - d_dy(u)
    if 'vort_500' in out:
        za = out['vort_500'] + f
        out['abs_vort_500'] = za
        out['vort_adv_500'] = -(S(fields['u500']) * d_dx(za) + S(fields['v500']) * d_dy(za))
    if 't850' in fields:
        t = S(fields['t850'])
        u, v = S(fields['u850']), S(fields['v850'])
        out['tadv_850'] = -(u * d_dx(t) + v * d_dy(t)) * 3600                   # K/h
        thp = t * (1000 / 850) ** th.KAPPA
        gx, gy = d_dx(thp), d_dy(thp)
        gm = np.hypot(gx, gy)
        D = (d_dx(u) - d_dy(v))
        D2 = (d_dx(v) + d_dy(u))
        beta = 0.5 * np.arctan2(D2, D) - np.arctan2(gy, gx)
        out['frontogenesis_850'] = 0.5 * gm * (np.hypot(D, D2) * np.cos(2 * beta) - (d_dx(u) + d_dy(v))) * 1e5 * 3 * 3600  # K/100km/3h
        out['theta_grad_850'] = gm * 1e5
    if 'q850' in fields:
        q, u, v = S(fields['q850']), S(fields['u850']), S(fields['v850'])
        out['qadv_850'] = -(u * d_dx(q) + v * d_dy(q)) * 1000 * 3600
    if 'z700' in fields and 't700' in fields:
        # Q-vector convergence (Hoskins et al. 1978) on geostrophic wind from smoothed Z
        Z, T = ndimage.gaussian_filter(S(fields['z700']), sig), S(fields['t700'])
        ug, vg = -9.81 / f * d_dy(Z), 9.81 / f * d_dx(Z)
        R_p = th.RD / 70000.0
        Q1 = -R_p * (d_dx(ug) * d_dx(T) + d_dx(vg) * d_dy(T))
        Q2 = -R_p * (d_dy(ug) * d_dx(T) + d_dy(vg) * d_dy(T))
        out['qvec_conv_700'] = -2 * (d_dx(Q1) + d_dy(Q2)) * 1e18
    if 't500' in fields and 't300' in fields and 'abs_vort_500' in out:
        th5, th3 = fields['t500'] * 2 ** th.KAPPA, fields['t300'] * (1000 / 300) ** th.KAPPA
        out['pv_400'] = (-9.81 * out['abs_vort_500'] * S((th3 - th5) / -20000.0)) * 1e6        # PVU, isobaric approx
    for k in ('z500', 'mslp'):
        if k in fields:
            a = S(fields[k])
            out[f'{k}_grad'] = np.hypot(d_dx(a), d_dy(a)) * 1e5
    return {k: np.asarray(v, np.float32) for k, v in out.items()}
