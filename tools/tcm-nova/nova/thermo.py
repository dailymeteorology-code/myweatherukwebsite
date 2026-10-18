"""Column thermodynamics and kinematics, vectorised over every grid column.

Arrays are (K, N): K levels bottom->top (index 0 = the surface), N columns. Every
column has its own pressure array, because levels below the terrain are removed and
the surface is inserted (see `build_columns`), so no profile is ever extrapolated
through the ground. Missing levels at the top are NaN and skipped by every integral.

Formulae: Bolton (1980) for saturation vapour pressure, LCL temperature and
equivalent potential temperature; pseudo-adiabats by Newton iteration on θe
conservation; virtual-temperature correction on parcel buoyancy (Doswell & Rasmussen
1994); Bunkers et al. (2000) storm motion; SRH after Davies-Jones (1990); SCP / STP
after Thompson et al. (2003, 2012). Units: K, Pa->hPa where noted, m, m/s, J/kg.
"""
from __future__ import annotations

import numpy as np

G = 9.80665
RD = 287.04
CP = 1004.0
KAPPA = RD / CP
EPS = 0.622
LV = 2.501e6


# ── basic moisture & temperature relations ───────────────────────────────────

def es_hpa(T):
    """Saturation vapour pressure over water (hPa), Bolton (1980)."""
    Tc = T - 273.15
    return 6.112 * np.exp(17.67 * Tc / (Tc + 243.5))


def mixing_ratio(e, p):
    return EPS * e / np.maximum(p - e, 1e-3)


def q_from_rh(rh, T, p):
    e = np.clip(rh, 0, 100) / 100.0 * es_hpa(T)
    r = mixing_ratio(e, p)
    return r / (1 + r)


def vapour_pressure_from_q(q, p):
    r = q / np.maximum(1 - q, 1e-6)
    return r * p / (EPS + r)


def dewpoint_from_e(e):
    lne = np.log(np.maximum(e, 1e-6) / 6.112)
    return 273.15 + 243.5 * lne / (17.67 - lne)


def theta(T, p):
    return T * (1000.0 / p) ** KAPPA


def virtual_t(T, r):
    return T * (1 + r / EPS) / (1 + r)


def t_lcl(T, Td):
    """Bolton (1980) eq. 15."""
    return 1.0 / (1.0 / (Td - 56.0) + np.log(T / Td) / 800.0) + 56.0


def theta_e(T, Td, p):
    """Bolton (1980) eq. 43, using the LCL temperature."""
    e = es_hpa(Td)
    r = mixing_ratio(e, p)
    TL = t_lcl(T, Td)
    th_l = T * (1000.0 / np.maximum(p - e, 1e-3)) ** KAPPA * (T / TL) ** (0.28 * r)
    return th_l * np.exp((3036.0 / TL - 1.78) * r * (1 + 0.448 * r))


def theta_e_sat(T, p):
    return theta_e(T, T, p)


def moist_t(the, p, guess=None, iters=10):
    """Temperature on the pseudo-adiabat with equivalent potential temperature `the` at p."""
    T = np.where(np.isfinite(guess), guess, 280.0) if guess is not None else np.full(np.broadcast(the, p).shape, 280.0)
    T = np.clip(T, 150, 330)
    for _ in range(iters):
        f = theta_e_sat(T, p) - the
        d = (theta_e_sat(T + 0.1, p) - theta_e_sat(T - 0.1, p)) / 0.2
        T = np.clip(T - f / np.where(np.abs(d) < 1e-6, 1e-6, d), 150, 340)
    return T


def wet_bulb(T, Td, p):
    """Normand's rule: the temperature on the moist adiabat through the LCL, back at p."""
    return moist_t(theta_e(T, Td, p), p, guess=0.5 * (T + Td))


# ── column assembly ─────────────────────────────────────────────────────────

def build_columns(levels, T, q, u, v, z, ps, t2, q2, zs, u10, v10, w=None):
    """levels (L,) hPa; T,q,u,v,z (L,N) on pressure levels; surface values (N,).
    Returns dict of (K=L+1, N) arrays with the surface at index 0 and every level
    below ground removed (compacted upwards) — never extrapolated."""
    L, N = T.shape
    plev = np.broadcast_to(np.asarray(levels, float)[:, None], (L, N))
    below = (plev >= ps[None, :] - 1.0) | ~np.isfinite(T) | (z <= zs[None, :] + 2.0)
    nb = np.zeros(N, np.int64)
    # number of contiguous bottom levels that are underground (pressure-ordered)
    for k in range(L):
        nb = np.where(below[k] & (nb == k), k + 1, nb)
    K = L + 1
    src = np.arange(K - 1)[:, None] + nb[None, :]                   # level index feeding row k+1
    ok = src < L
    srcc = np.minimum(src, L - 1)
    cols = np.arange(N)[None, :]

    def stack(sfc, a, fill=np.nan):
        out = np.full((K, N), fill, np.float32)
        out[0] = sfc
        out[1:] = np.where(ok, a[srcc, cols], np.nan)
        return out
    C = {
        'p': stack(ps, plev), 'T': stack(t2, T), 'q': stack(q2, q), 'u': stack(u10, u), 'v': stack(v10, v),
        'z': stack(zs, z),
    }
    if w is not None:
        C['w'] = stack(np.zeros(N, np.float32), w)
    C['z_agl'] = C['z'] - zs[None, :]
    C['zs'] = zs
    e = vapour_pressure_from_q(C['q'], C['p'])
    C['e'] = e
    C['Td'] = np.minimum(dewpoint_from_e(e), C['T'])
    C['r'] = C['q'] / np.maximum(1 - C['q'], 1e-6)
    C['Tv'] = virtual_t(C['T'], C['r'])
    C['theta'] = theta(C['T'], C['p'])
    C['theta_v'] = theta(C['Tv'], C['p'])
    C['theta_e'] = theta_e(C['T'], C['Td'], C['p'])
    C['rh'] = 100 * np.clip(e / es_hpa(C['T']), 0, 1)
    C['rho'] = C['p'] * 100.0 / (RD * C['Tv'])
    return C


def interp_at(C, key, coord, target, coordkey='z_agl'):
    """Value of C[key] where C[coordkey] == target (first crossing from below)."""
    c = C[coordkey]
    a = C[key]
    if np.ndim(target) == 0:
        target = np.full(c.shape[1], target, np.float32)
    out = np.full(c.shape[1], np.nan, np.float32)
    done = np.zeros(c.shape[1], bool)
    for k in range(c.shape[0] - 1):
        c0, c1 = c[k], c[k + 1]
        hit = ~done & np.isfinite(c0) & np.isfinite(c1) & (((c0 <= target) & (c1 >= target)) | ((c0 >= target) & (c1 <= target)))
        f = np.where(hit, (target - c0) / np.where(c1 == c0, 1, c1 - c0), 0)
        out = np.where(hit, a[k] + f * (a[k + 1] - a[k]), out)
        done |= hit
    return out


def interp_p(C, key, p_target):
    """Interpolate in log-p to a pressure; NaN where the level is underground."""
    lp = -np.log(C['p'])
    return interp_at({'x': lp, 'a': C[key]}, 'a', None, -np.log(p_target), coordkey='x')


def crossing_height(C, key, value):
    """Lowest height AGL where C[key] crosses `value` going up (e.g. 0 °C level)."""
    a, z = C[key], C['z_agl']
    out = np.full(a.shape[1], np.nan, np.float32)
    done = np.zeros(a.shape[1], bool)
    above0 = a[0] <= value                    # already below the value at the surface
    out = np.where(above0, 0.0, out)
    done |= above0
    for k in range(a.shape[0] - 1):
        a0, a1 = a[k], a[k + 1]
        hit = ~done & np.isfinite(a0) & np.isfinite(a1) & (a0 > value) & (a1 <= value)
        f = np.where(hit, (a0 - value) / np.where(a0 == a1, 1, a0 - a1), 0)
        out = np.where(hit, z[k] + f * (z[k + 1] - z[k]), out)
        done |= hit
    return out


# ── parcels ─────────────────────────────────────────────────────────────────

def lift(C, p0, T0, Td0, z0=None):
    """Lift a parcel (per column) from p0 with T0/Td0. Returns dict with parcel Tv
    profile, buoyancy and the standard CAPE/CIN/LCL/LFC/EL diagnostics."""
    P, Tenv, Tvenv, Z = C['p'], C['T'], C['Tv'], C['z']
    TL = t_lcl(T0, np.minimum(Td0, T0))
    pL = p0 * (TL / T0) ** (1 / KAPPA)
    r0 = mixing_ratio(es_hpa(np.minimum(Td0, T0)), p0)
    the = theta_e(T0, np.minimum(Td0, T0), p0)
    dry = T0[None, :] * (P / p0[None, :]) ** KAPPA
    wet = moist_t(np.broadcast_to(the[None, :], P.shape), P, guess=dry)
    above_start = P <= p0[None, :] + 0.01
    sat = P <= pL[None, :]
    Tp = np.where(sat, wet, dry)
    rp = np.where(sat, mixing_ratio(es_hpa(Tp), P), r0[None, :])
    Tvp = virtual_t(Tp, rp)
    B = G * (Tvp - Tvenv) / Tvenv
    B = np.where(above_start & np.isfinite(Tvenv), B, np.nan)
    # layer integrals
    dz = np.diff(Z, axis=0)
    Bm = 0.5 * (B[1:] + B[:-1])
    lay_ok = np.isfinite(Bm) & np.isfinite(dz)
    Bm = np.where(lay_ok, Bm, 0.0)
    pos = np.maximum(Bm, 0) * np.where(lay_ok, dz, 0)
    neg = np.minimum(Bm, 0) * np.where(lay_ok, dz, 0)
    # LFC: first layer above the LCL with positive buoyancy; EL: top of the last positive layer
    zL = np.full(P.shape[1], np.nan, np.float32)
    lcl_z = interp_at({'x': -np.log(P), 'a': C['z_agl']}, 'a', None, -np.log(pL), coordkey='x')
    cand = (Bm > 0) & (0.5 * (P[1:] + P[:-1]) <= pL[None, :] + 25)
    has = cand.any(0)
    k_lfc = np.argmax(cand, axis=0)
    k_el = cand.shape[0] - 1 - np.argmax(cand[::-1], axis=0)
    cols = np.arange(P.shape[1])
    zagl = C['z_agl']
    lfc = np.where(has, zagl[k_lfc, cols], np.nan)
    el = np.where(has, zagl[np.minimum(k_el + 1, P.shape[0] - 1), cols], np.nan)
    kk = np.arange(Bm.shape[0])[:, None]
    in_cape = has[None, :] & (kk >= k_lfc[None, :]) & (kk <= k_el[None, :])
    cape = np.where(in_cape, pos, 0).sum(0)
    below_lfc = kk < np.where(has, k_lfc, Bm.shape[0])[None, :]
    cin = np.where(below_lfc, neg, 0).sum(0)
    z_mid = 0.5 * (zagl[1:] + zagl[:-1])
    cape03 = np.where(in_cape & (z_mid <= 3000), pos, 0).sum(0)
    # mixed-phase CAPE (-10 to -40 °C environmental layer): electrification proxy input
    T_mid = 0.5 * (Tenv[1:] + Tenv[:-1])
    cape_mp = np.where(in_cape & (T_mid <= 263.15) & (T_mid >= 233.15), pos, 0).sum(0)
    return {
        'cape': cape.astype(np.float32), 'cin': np.where(has, cin, np.minimum(cin, 0)).astype(np.float32),
        'lcl_z': lcl_z, 'lcl_p': pL.astype(np.float32), 'lfc_z': lfc.astype(np.float32), 'el_z': el.astype(np.float32),
        'cape_0_3km': cape03.astype(np.float32), 'cape_mixed_phase': cape_mp.astype(np.float32),
        'bmax': np.nanmax(np.where(np.isfinite(B), B, -9), 0).astype(np.float32), 'Tvp': Tvp, 'B': B,
    }


def parcels(C):
    """Surface-based, mixed-layer (lowest 100 hPa) and most-unstable (lowest 300 hPa)."""
    P = C['p']
    ps = P[0]
    sb = lift(C, ps, C['T'][0], C['Td'][0])
    # mixed layer: pressure-weighted mean θ and r over sfc..sfc-100 hPa
    inml = (P >= ps[None, :] - 100) & np.isfinite(C['T'])
    w = np.where(inml, 1.0, 0.0)
    th = (np.where(inml, C['theta'], 0) * w).sum(0) / np.maximum(w.sum(0), 1)
    rr = (np.where(inml, C['r'], 0) * w).sum(0) / np.maximum(w.sum(0), 1)
    T0 = th * (ps / 1000.0) ** KAPPA
    Td0 = np.minimum(dewpoint_from_e(rr * ps / (EPS + rr)), T0)
    ml = lift(C, ps, T0, Td0)
    # most unstable: max θe in the lowest 300 hPa
    the = np.where((P >= ps[None, :] - 300) & np.isfinite(C['theta_e']), C['theta_e'], -1)
    k = np.argmax(the, 0)
    cols = np.arange(P.shape[1])
    mu = lift(C, P[k, cols], C['T'][k, cols], C['Td'][k, cols])
    mu['src_p'] = P[k, cols]
    return sb, ml, mu


def dcape(C):
    """Downdraft CAPE: a parcel at the minimum-θe level in the 700–500 hPa layer, brought
    to saturation at its wet-bulb temperature and descended pseudo-adiabatically."""
    P = C['p']
    layer = (P <= 700) & (P >= 500) & np.isfinite(C['theta_e'])
    the = np.where(layer, C['theta_e'], 1e9)
    k = np.argmin(the, 0)
    cols = np.arange(P.shape[1])
    ok = layer.any(0)
    p0 = P[k, cols]
    th0 = theta_e(C['T'][k, cols], C['Td'][k, cols], p0)
    Tp = moist_t(np.broadcast_to(th0[None, :], P.shape), P, guess=C['T'])
    Tvp = virtual_t(Tp, mixing_ratio(es_hpa(Tp), P))
    B = G * (Tvp - C['Tv']) / C['Tv']                        # negative = parcel colder
    below = P >= p0[None, :]
    dz = np.diff(C['z'], axis=0)
    Bm = 0.5 * (B[1:] + B[:-1])
    lay = below[1:] & below[:-1] & np.isfinite(Bm) & np.isfinite(dz)
    dc = -np.where(lay, np.minimum(Bm, 0) * dz, 0).sum(0)
    return np.where(ok, dc, np.nan).astype(np.float32), np.where(ok, C['z_agl'][k, cols], np.nan)


def precipitable_water(C, p_bot=None, p_top=None):
    """∫ q dp / g (kg m-2 == mm) between two pressures (default whole column)."""
    P, q = C['p'], C['q']
    pb = P[0] if p_bot is None else np.minimum(p_bot, P[0])
    pt = 0 if p_top is None else p_top
    dp = -np.diff(P, axis=0) * 100.0
    qm = 0.5 * (q[1:] + q[:-1])
    pm = 0.5 * (P[1:] + P[:-1])
    m = np.isfinite(dp) & np.isfinite(qm) & (pm <= pb) & (pm >= pt)
    return (np.where(m, qm * dp, 0).sum(0) / G).astype(np.float32)


# ── kinematics ──────────────────────────────────────────────────────────────

HEIGHTS = np.array([0, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 5500, 6000, 7000, 8000, 9000], float)


def winds_on_heights(C):
    u = np.stack([interp_at(C, 'u', None, h) for h in HEIGHTS])
    v = np.stack([interp_at(C, 'v', None, h) for h in HEIGHTS])
    u[0], v[0] = C['u'][0], C['v'][0]
    return u, v


def _hi(h):
    return int(np.argmin(np.abs(HEIGHTS - h)))


def bulk_shear(u, v, z0, z1):
    return np.hypot(u[_hi(z1)] - u[_hi(z0)], v[_hi(z1)] - v[_hi(z0)]).astype(np.float32)


def mean_wind(u, v, z0, z1):
    sel = (HEIGHTS >= z0) & (HEIGHTS <= z1)
    return np.nanmean(u[sel], 0), np.nanmean(v[sel], 0)


def bunkers(u, v):
    """Right-moving supercell motion (Bunkers et al. 2000)."""
    mu, mv = mean_wind(u, v, 0, 6000)
    su = np.nanmean(u[(HEIGHTS >= 5500) & (HEIGHTS <= 6000)], 0) - np.nanmean(u[HEIGHTS <= 500], 0)
    sv = np.nanmean(v[(HEIGHTS >= 5500) & (HEIGHTS <= 6000)], 0) - np.nanmean(v[HEIGHTS <= 500], 0)
    mag = np.maximum(np.hypot(su, sv), 1e-3)
    return mu + 7.5 * sv / mag, mv - 7.5 * su / mag, mu, mv


def srh(u, v, cx, cy, z0, z1):
    sel = np.where((HEIGHTS >= z0) & (HEIGHTS <= z1))[0]
    out = np.zeros(u.shape[1], np.float32)
    for a, b in zip(sel[:-1], sel[1:]):
        t = (u[b] - cx) * (v[a] - cy) - (u[a] - cx) * (v[b] - cy)
        out += np.where(np.isfinite(t), t, 0)
    return out


def srh_layer(u, v, cx, cy, zb, zt):
    """SRH over a per-column layer [zb, zt] (effective inflow layer)."""
    out = np.zeros(u.shape[1], np.float32)
    for a in range(len(HEIGHTS) - 1):
        b = a + 1
        inl = (HEIGHTS[a] >= zb - 1) & (HEIGHTS[b] <= zt + 1)
        t = (u[b] - cx) * (v[a] - cy) - (u[a] - cx) * (v[b] - cy)
        out += np.where(inl & np.isfinite(t), t, 0)
    return out


def interp_heights(a, h):
    """Per-column linear interpolation of a (len(HEIGHTS), N) array at heights h (N,)."""
    h = np.clip(h, HEIGHTS[0], HEIGHTS[-1])
    i = np.clip(np.searchsorted(HEIGHTS, h) - 1, 0, len(HEIGHTS) - 2)
    cols = np.arange(a.shape[1])
    f = (h - HEIGHTS[i]) / (HEIGHTS[i + 1] - HEIGHTS[i])
    return a[i, cols] * (1 - f) + a[i + 1, cols] * f


def effective_layer(C, max_parcels=8):
    """Effective inflow layer (Thompson et al. 2007): contiguous lowest levels whose parcels
    have CAPE >= 100 J/kg and CIN >= -250 J/kg. Returns bottom/top heights AGL (NaN = none)."""
    P = C['p']
    N = P.shape[1]
    bot = np.full(N, np.nan, np.float32)
    top = np.full(N, np.nan, np.float32)
    done = np.zeros(N, bool)
    started = np.zeros(N, bool)
    cols = np.arange(N)
    for k in range(min(max_parcels, P.shape[0] - 1)):
        valid = np.isfinite(C['T'][k])
        r = lift(C, np.where(valid, P[k], P[0]), np.where(valid, C['T'][k], C['T'][0]), np.where(valid, C['Td'][k], C['Td'][0]))
        good = valid & (r['cape'] >= 100) & (r['cin'] >= -250)
        newb = good & ~started & ~done
        bot = np.where(newb, C['z_agl'][k, cols], bot)
        started |= newb
        top = np.where(started & ~done & good, C['z_agl'][k, cols], top)
        done |= started & ~good
    return bot, top
