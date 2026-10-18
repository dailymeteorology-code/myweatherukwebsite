"""Cloud-microphysics fields from published hydrometeor data.

What the models actually publish (no microphysics is invented here):
  GFS (AWS)       cloud water, cloud ice, rain, snow and graupel mixing ratios on pressure
                  levels (CLMR, ICMR, RWMR, SNMR, GRLE; GFDL single-moment microphysics)
  ICON-EU (DWD)   column-integrated cloud water / ice / rain / snow (TQC, TQI, TQR, TQS),
                  convective cloud base/top, lightning potential index
  UKV (AWS)       hail fall, cloud base, cloud amount

What is DERIVED, with the assumption stated on every field:
  water contents (g m-3) = ρ q;  paths (kg m-2) = ∫ q dp / g
  droplet number Nd: single-moment schemes do not predict it, so the climatological value is
    ASSUMED (continental 300 cm-3, maritime 100 cm-3 by land fraction; Miles et al. 2000)
  droplet mean-volume and effective radius from LWC and the assumed Nd (Martin et al. 1994:
    re = rv / k^(1/3), k = 0.67 continental, 0.80 maritime)
  ice effective radius from temperature (Ou & Liou 1995 parameterisation)
  rain mass-weighted fall speed (Klemp & Wilhelmson 1978 from ρ·qr)
  non-inductive charging potential: Σ over the −10…−40 °C layer of ρ²·qg·(qi + qs) where
    supercooled water is present (Takahashi 1978 / Saunders et al. 1991 mechanism) — a
    relative INDEX for where graupel–ice collisions with SLW occur, not a charge density.
Still not available from any open source: number concentrations other than assumed Nd,
size distributions, process rates (autoconversion, riming, …) and electric fields.
"""
from __future__ import annotations

import numpy as np

G = 9.80665


def compute(prof, levels, land_frac, sfc):
    """prof: blended profile dict on LEVELS with optional qc/qi/qr/qs/qg (L, ny, nx)."""
    out = {}
    p = np.asarray(levels, float)[:, None, None] * 100.0
    T = prof['t']
    rho = p / (287.04 * T * (1 + 0.61 * np.nan_to_num(prof['q'])))
    dp = np.abs(np.gradient(p, axis=0))
    have = [k for k in ('qc', 'qi', 'qr', 'qs', 'qg') if k in prof]
    for k in have:
        q = np.clip(np.nan_to_num(prof[k]), 0, 0.05)
        out[f'{k}_path'] = (q * dp / G).sum(0).astype(np.float32)                       # kg m-2
        out[f'{k}_max_gm3'] = (np.max(q * rho, 0) * 1000).astype(np.float32)             # g m-3
    # ICON-EU columns where GFS is absent or to blend (simple mean of what exists)
    for k, ik in (('qc', 'tqc'), ('qi', 'tqi'), ('qr', 'tqr'), ('qs', 'tqs')):
        if ik in sfc:
            a = np.nan_to_num(sfc[ik])
            out[f'{k}_path'] = 0.5 * (out[f'{k}_path'] + a) if f'{k}_path' in out else a.astype(np.float32)
    if 'qc' in prof:
        qc = np.clip(np.nan_to_num(prof['qc']), 0, 0.01)
        lwc = qc * rho                                                                 # kg m-3
        cold = T < 273.15
        out['slw_max_gm3'] = (np.max(np.where(cold, lwc, 0), 0) * 1000).astype(np.float32)
        out['slw_path'] = (np.where(cold, qc, 0) * dp / G).sum(0).astype(np.float32)
        nd = np.where(land_frac >= 0.5, 300e6, 100e6)                                  # m-3 (ASSUMED)
        k = np.where(land_frac >= 0.5, 0.67, 0.80)
        lwc_max = lwc.max(0)
        rv = (3 * lwc_max / (4 * np.pi * 1000.0 * nd)) ** (1 / 3)                      # m
        re = rv / k ** (1 / 3)
        out['droplet_re_um'] = np.where(lwc_max > 1e-5, re * 1e6, np.nan).astype(np.float32)
        out['droplet_nd_assumed_cm3'] = (nd / 1e6).astype(np.float32)
    if 'qi' in prof:
        tc = np.clip(T - 273.15, -60, -20)
        de = 326.3 + 12.42 * tc + 0.197 * tc ** 2 + 0.0012 * tc ** 3                    # µm, Ou & Liou 1995
        qi = np.nan_to_num(prof['qi'])
        w = np.where(qi > 1e-7, qi, 0)
        out['ice_re_um'] = np.where(w.sum(0) > 0, (w * de / 2).sum(0) / np.maximum(w.sum(0), 1e-12), np.nan).astype(np.float32)
    if 'qr' in prof:
        rq = np.clip(np.nan_to_num(prof['qr']), 0, 0.02) * rho
        vt = 36.34 * np.maximum(rq / 1000.0, 1e-12) ** 0.1364 * np.sqrt(1.2 / rho)        # m/s; ρq in g cm-3 (KW78)
        out['rain_fall_speed_max'] = np.where(rq.max(0) > 1e-5, np.max(np.where(rq > 1e-5, vt, 0), 0), np.nan).astype(np.float32)
    if all(k in prof for k in ('qg', 'qc')) and ('qi' in prof or 'qs' in prof):
        mp = (T <= 263.15) & (T >= 233.15) & (np.nan_to_num(prof['qc']) > 1e-6)
        ice = np.nan_to_num(prof.get('qi', 0)) + np.nan_to_num(prof.get('qs', 0))
        ci = np.where(mp, rho ** 2 * np.nan_to_num(prof['qg']) * ice, 0).sum(0)
        out['charging_index'] = (ci * 1e9).astype(np.float32)                          # relative index
    return out
