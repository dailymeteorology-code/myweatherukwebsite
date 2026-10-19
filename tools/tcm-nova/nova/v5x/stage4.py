"""V5 Stage 4 parcel physics, compiled.

V5's `gridded.lift_grid` and `gridparams._dcape` march every cell through ~200 ascent
levels with RK4 pseudoadiabat steps as whole-grid numpy operations: 320 s of a 343 s
Stage 4 frame. This module runs the SAME algorithm column by column under Numba
(compiled, parallel over cells): same ascent grid (5 hPa offsets from each parcel's own
origin), same RK4 with four sub-steps at the LCL crossing, same Bolton thermodynamics,
same virtual-temperature buoyancy, same LFC/EL crossing interpolation, same trapezoid
areas, same DCAPE descent. Only the order of evaluation changes (a column at a time
instead of a level at a time), which changes nothing in exact arithmetic.

`compute_grid(cube)` is V5's own `gridparams.compute_grid` with the two expensive steps
swapped for these kernels; every other Stage 4 field is V5's own code, untouched.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

from .. import v5_bridge  # noqa: F401
from app.parameters import gridded as G  # noqa: E402
from app.parameters import gridparams as GP  # noqa: E402
from app.parameters import thermo as TH  # noqa: E402
from app.parameters.parcel import ASCENT_STEP_PA, BUOYANCY_EPSILON, MIXED_LAYER_DEPTH_PA, MOST_UNSTABLE_DEPTH_PA  # noqa: E402

RD = TH.R_DRY
EPS = TH.EPSILON
CP = TH.CP_DRY
P0 = TH.P_REFERENCE
KAPPA = TH.KAPPA
ZC = TH.ZERO_CELSIUS
NAN = np.nan


# ── thermodynamics (thermo.py, scalar) ──────────────────────────────────────

@njit(cache=True, fastmath=False)
def es(t):
    c = t - ZC
    return 611.2 * math.exp(17.67 * c / (c + 243.5))


@njit(cache=True)
def ws(t, p):
    e = es(t)
    d = p - e
    if d > 1.0:
        return EPS * e / d
    return NAN


@njit(cache=True)
def lv(t):
    return 2.501e6 - 2370.0 * (t - ZC)


@njit(cache=True)
def tvirt(t, w):
    return t * (1.0 + w / EPS) / (1.0 + w)


@njit(cache=True)
def td_from_w(w, p):
    e = p * w / (EPS + w)
    if not (e > 0):
        return NAN
    ln = math.log(e / 611.2)
    return ZC + 243.5 * ln / (17.67 - ln)


@njit(cache=True)
def t_lcl(t, td):
    return 1.0 / (1.0 / (td - 56.0) + math.log(t / td) / 800.0) + 56.0


@njit(cache=True)
def theta_e(t, td, p):
    w = ws(td, p)
    r_g = w * 1000.0
    e = p * w / (EPS + w)
    tl = t_lcl(t, td)
    th_dl = t * (P0 / (p - e)) ** KAPPA * (t / tl) ** (0.28e-3 * r_g)
    return th_dl * math.exp((3036.0 / tl - 1.78) * w * (1.0 + 0.448 * w))


@njit(cache=True)
def dtdp(t, p):
    w = ws(t, p)
    l = lv(t)
    return (RD * t + l * w) / (p * (CP + (l * l * w * EPS) / (RD * t * t)))


@njit(cache=True)
def rk4(t, p, h):
    k1 = dtdp(t, p)
    k2 = dtdp(t + 0.5 * h * k1, p + 0.5 * h)
    k3 = dtdp(t + 0.5 * h * k2, p + 0.5 * h)
    k4 = dtdp(t + h * k3, p + h)
    return t + h * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0


@njit(cache=True)
def wet_bulb(t, td, p):
    w = ws(td, p)
    low = min(td, t) if (td == td and t == t) else NAN
    high = t
    for _ in range(12):
        mid = 0.5 * (low + high)
        res = CP * (t - mid) - lv(mid) * (ws(mid, p) - w)
        if res < 0:
            high = mid
        else:
            low = mid
    return 0.5 * (low + high)


@njit(cache=True)
def nan0(x):
    return x if x == x else 0.0


@njit(cache=True)
def nanmin2(a, b):
    """np.minimum: NaN if either is NaN."""
    if a != a or b != b:
        return NAN
    return a if a < b else b


# ── column helpers ──────────────────────────────────────────────────────────

@njit(cache=True)
def interp_logp(lnP_asc, vals_asc, lt):
    """gridded._interp_log_p_grid for one target: searchsorted-left, clipped [1, n-1],
    no extrapolation (NaN outside the source range)."""
    n = lnP_asc.size
    if lt < lnP_asc[0] - 1e-9 or lt > lnP_asc[n - 1] + 1e-9:
        return NAN
    i = np.searchsorted(lnP_asc, lt)
    if i < 1:
        i = 1
    if i > n - 1:
        i = n - 1
    lo = i - 1
    span = lnP_asc[i] - lnP_asc[lo]
    w = (lt - lnP_asc[lo]) / span if span != 0 else 0.0
    return vals_asc[lo] + w * (vals_asc[i] - vals_asc[lo])


@njit(cache=True)
def env_at(lnP_asc, T_asc, D_asc, p, has_sfc, p_low, t_low, d_low, sp, st, sd):
    """gridded.environment_at for one pressure: aloft interpolation, or the blend
    between the lowest usable level and the screen state inside the surface layer."""
    lt = math.log(p) if p > 0 else NAN
    at = interp_logp(lnP_asc, T_asc, lt)
    ad = interp_logp(lnP_asc, D_asc, lt)
    if not has_sfc:
        return at, ad
    if (p > p_low + 1e-6) and (p <= sp + 1e-6) and (p_low == p_low):
        span = math.log(sp) - math.log(p_low)
        w = (math.log(p) - math.log(p_low)) / span if span != 0 else 0.0
        if w != w:
            w = 0.0
        elif w == np.inf:
            w = 1.0
        elif w == -np.inf:
            w = 0.0
        w = min(max(w, 0.0), 1.0)
        return t_low + w * (st - t_low), d_low + w * (sd - d_low)
    return at, ad


@njit(cache=True)
def at_pressure(lnP, vals, lt):
    """gridparams._at_pressure for one cell (stored order, first finite match wins)."""
    out = NAN
    for k in range(lnP.size - 1):
        lo = lnP[k]
        hi = lnP[k + 1]
        if not (min(lo, hi) <= lt <= max(lo, hi)):
            continue
        w = 0.0 if hi == lo else (lt - lo) / (hi - lo)
        cand = vals[k] + w * (vals[k + 1] - vals[k])
        if out != out:
            out = cand
    return out


@njit(cache=True)
def take_at(lnP, vals, ltarget):
    """gridparams._take_at for one cell."""
    out = NAN
    if ltarget != ltarget:
        return out
    for k in range(lnP.size - 1):
        lo = lnP[k]
        hi = lnP[k + 1]
        span = hi - lo
        if span == 0:
            continue
        w = (ltarget - lo) / span
        if w >= 0.0 and w <= 1.0 and out != out:
            out = vals[k] + w * (vals[k + 1] - vals[k])
    return out


# ── the ascent (lift_grid + _levels_and_areas), one column ──────────────────

@njit(cache=True)
def lift_column(lnP_asc, T_asc, D_asc, Z_asc, top, p0, t0, d0,
                has_sfc, p_low, t_low, d_low, sp, st, sd, step, out):
    """out[0..9] = cape, cin, p_lcl, z_lcl, p_lfc, z_lfc, p_el, z_el, no_lfc(1/0), ok."""
    if p0 != p0:
        # grid is NaN everywhere: no positive buoyancy, CAPE 0, CIN NaN, levels NaN
        out[0] = 0.0
        out[1] = NAN
        out[2] = NAN
        out[3] = NAN
        out[4] = NAN
        out[5] = NAN
        out[6] = NAN
        out[7] = NAN
        out[8] = 1.0
        return
    n = int(math.ceil((p0 - top) / step)) + 1
    if n < 1:
        n = 1
    grid = np.empty(n)
    for i in range(n):
        g = p0 - i * step
        grid[i] = g if g > top else top
    pl = p0 * (t_lcl(t0, d0) / t0) ** (1.0 / KAPPA)
    tl = t_lcl(t0, d0)
    w0 = ws(d0, p0)
    dtv = np.empty(n)
    envz = np.empty(n)
    lnp = np.empty(n)
    t_cur = tl
    p_cur = pl
    was_sat = False
    for i in range(n):
        lev = grid[i]
        lnp[i] = math.log(lev)
        sat = lev <= pl
        if not sat:
            pt = t0 * (lev / p0) ** KAPPA
            ptd = td_from_w(w0, lev)
        else:
            if not was_sat:
                total = lev - p_cur
                sub = total / 4.0
                tc = t_cur
                pc = p_cur
                for _ in range(4):
                    tc = rk4(tc, pc, sub)
                    pc = pc + sub
                t_cur = tc
            else:
                stp = (lev - grid[i - 1]) if i > 0 else 0.0
                t_cur = rk4(t_cur, p_cur, stp)
            p_cur = lev
            was_sat = True
            pt = t_cur
            ptd = t_cur
        et, ed = env_at(lnP_asc, T_asc, D_asc, lev, has_sfc, p_low, t_low, d_low, sp, st, sd)
        wp = ws(ptd, lev)
        if wp != wp:
            wp = 0.0
        we = ws(ed, lev)
        if we != we:
            we = 0.0
        d = tvirt(pt, wp) - tvirt(et, we)
        if abs(d) < BUOYANCY_EPSILON:
            d = 0.0
        dtv[i] = d
        envz[i] = interp_logp(lnP_asc, Z_asc, lnp[i])
    # positive area above the LCL
    first = -1
    last = -1
    for i in range(n):
        if dtv[i] == dtv[i] and dtv[i] > 0 and grid[i] <= pl + 1e-6:
            if first < 0:
                first = i
            last = i
    has_pos = first >= 0
    f = first if has_pos else 0
    lfc = NAN
    el = NAN
    if has_pos:
        below = f - 1 if f > 0 else 0
        a = dtv[below]
        b = dtv[f]
        crosses = (a == a) and (b == b) and a < 0 and b > 0
        frac = 0.0
        if crosses and b != a:
            frac = -a / (b - a)
            if frac != frac:
                frac = 0.0
            frac = min(max(frac, 0.0), 1.0)
        ln_lfc = lnp[below] + frac * (lnp[f] - lnp[below]) if crosses else math.log(pl)
        lfc = math.exp(ln_lfc)
        if f == 0:
            lfc = min(pl, grid[0]) if pl == pl else NAN
        l = last
        above = l + 1 if l + 1 < n else n - 1
        a2 = dtv[l]
        b2 = dtv[above]
        cd = (a2 == a2) and (b2 == b2) and a2 > 0 and b2 < 0
        frac2 = 0.0
        if cd and b2 != a2:
            frac2 = -a2 / (b2 - a2)
            if frac2 != frac2:
                frac2 = 0.0
            frac2 = min(max(frac2, 0.0), 1.0)
        el = math.exp(lnp[l] + frac2 * (lnp[above] - lnp[l]))
        if l == n - 1:
            el = NAN
    cape = 0.0
    cin = 0.0
    for i in range(n - 1):
        c0 = dtv[i] if (dtv[i] == dtv[i] and dtv[i] > 0 and grid[i] <= pl + 1e-6) else 0.0
        c1 = dtv[i + 1] if (dtv[i + 1] == dtv[i + 1] and dtv[i + 1] > 0 and grid[i + 1] <= pl + 1e-6) else 0.0
        d = lnp[i + 1] - lnp[i]
        cape += d * (c1 + c0) / 2.0
        n0 = dtv[i] if (dtv[i] == dtv[i] and dtv[i] < 0 and grid[i] > lfc) else 0.0
        n1 = dtv[i + 1] if (dtv[i + 1] == dtv[i + 1] and dtv[i + 1] < 0 and grid[i + 1] > lfc) else 0.0
        cin += d * (n1 + n0) / 2.0
    cape = RD * abs(cape)
    cin = -RD * abs(cin)
    if not has_pos:
        cape = 0.0
        cin = NAN
    out[0] = cape
    out[1] = cin
    out[2] = pl
    out[3] = _height_at(grid, lnp, envz, pl)
    out[4] = lfc
    out[5] = _height_at(grid, lnp, envz, lfc)
    out[6] = el
    out[7] = _height_at(grid, lnp, envz, el)
    out[8] = 0.0 if has_pos else 1.0


@njit(cache=True)
def _height_at(grid, lnp, envz, ptarget):
    if ptarget != ptarget:
        return NAN
    lt = math.log(ptarget)
    out = NAN
    for i in range(grid.size - 1):
        lo = lnp[i]
        hi = lnp[i + 1]
        if lt <= lo and lt >= hi:
            span = hi - lo
            w = (lt - lo) / span if span != 0 else 0.0
            out = envz[i] + w * (envz[i + 1] - envz[i])
    return out


@njit(cache=True)
def _lowest(Tc, Dc, P):
    for k in range(P.size):
        if Tc[k] == Tc[k] and Dc[k] == Dc[k]:
            return P[k], Tc[k], Dc[k]
    return NAN, NAN, NAN


@njit(parallel=True, cache=True)
def ascend_all(kind, P, T, D, Z, SP, ST, SD, has_sfc, top, step, ml_depth, mu_depth, tab, use_tab):
    """kind 0 surface, 1 mixed layer, 2 most unstable. T, D, Z: (nlev, ncell) in stored
    (decreasing-pressure) order. Returns (ncell, 12) = the 9 ascent outputs + parcel p,t,td."""
    nlev, ncell = T.shape
    lnP = np.log(P)
    lnP_asc = lnP[::-1].copy()
    res = np.empty((ncell, 12))
    for c in prange(ncell):
        Tc = T[:, c]
        Dc = D[:, c]
        T_asc = Tc[::-1].copy()
        D_asc = Dc[::-1].copy()
        Z_asc = Z[:, c][::-1].copy()
        p_low, t_low, d_low = _lowest(Tc, Dc, P)
        sp = SP[c]
        st = ST[c]
        sd = SD[c]
        if has_sfc and (sp == sp) and (p_low == p_low) and sp > p_low + 1e-6:
            base = sp
        else:
            base = p_low
        if kind == 0:
            if has_sfc:
                p0, t0, d0 = sp, st, nanmin2(sd, st)
            else:
                p0, t0, d0 = p_low, t_low, nanmin2(d_low, t_low)
        elif kind == 1:
            nst = int(ml_depth / step) + 1
            tot = 0.0
            ths = 0.0
            wsum = 0.0
            for k in range(nst):
                p = base - k * step
                et, ed = env_at(lnP_asc, T_asc, D_asc, p, has_sfc, p_low, t_low, d_low, sp, st, sd)
                ed = nanmin2(ed, et)
                if et == et and ed == ed:
                    tot += step
                    ths += nan0(et * (P0 / p) ** KAPPA) * step
                    wsum += nan0(ws(ed, p)) * step
            if tot > 0:
                thm = ths / tot
                wm = wsum / tot
            else:
                thm = NAN
                wm = NAN
            p0 = base
            t0 = thm * (base / P0) ** KAPPA
            d0 = nanmin2(td_from_w(wm, base), t0)
        else:
            nst = int(mu_depth / step) + 1
            best = -np.inf
            p0 = NAN
            t0 = NAN
            d0 = NAN
            first = True
            for k in range(nst + 1):
                if k < nst:
                    p = base - k * step
                    et, ed = env_at(lnP_asc, T_asc, D_asc, p, has_sfc, p_low, t_low, d_low, sp, st, sd)
                    ed = nanmin2(ed, et)
                else:
                    if has_sfc:
                        p, et, ed = sp, st, nanmin2(sd, st)
                    else:
                        p, et, ed = p_low, t_low, nanmin2(d_low, t_low)
                    ed = nanmin2(ed, et)
                te = theta_e(et, ed, p)
                if te != te:
                    te = -np.inf
                if first or te > best:
                    if first or te > best:
                        best = te
                        p0, t0, d0 = p, et, ed
                    first = False
        o = np.empty(9)
        if use_tab:
            lift_column_tab(tab, lnP_asc, T_asc, D_asc, Z_asc, top, p0, t0, d0,
                            has_sfc, p_low, t_low, d_low, sp, st, sd, step, o)
        else:
            lift_column(lnP_asc, T_asc, D_asc, Z_asc, top, p0, t0, d0,
                        has_sfc, p_low, t_low, d_low, sp, st, sd, step, o)
        for j in range(9):
            res[c, j] = o[j]
        res[c, 9] = p0
        res[c, 10] = t0
        res[c, 11] = d0
    return res


@njit(parallel=True, cache=True)
def dcape_all(P, T, D, SP, has_sp, tab, use_tab):
    nlev, ncell = T.shape
    lnP = np.log(P)
    out = np.empty(ncell)
    nsearch = 21
    for c in prange(ncell):
        Tc = T[:, c]
        Dc = D[:, c]
        best = np.inf
        src = 0
        have = False
        for i in range(nsearch):
            p = 70000.0 - 1000.0 * i
            lt = math.log(p)
            t = at_pressure(lnP, Tc, lt)
            td = nanmin2(at_pressure(lnP, Dc, lt), t)
            te = theta_e(t, td, p)
            if te == te:
                have = True
                if te < best:
                    best = te
                    src = i
        if not have:
            out[c] = NAN
            continue
        ps = 70000.0 - 1000.0 * src
        lts = math.log(ps)
        ts = at_pressure(lnP, Tc, lts)
        tds = nanmin2(at_pressure(lnP, Dc, lts), ts)
        twet = wet_bulb(ts, tds, ps)
        sfc = SP[c] if has_sp else P[0]
        sfc = nanmin2(sfc, P[0])
        cur_t = twet
        cur_p = ps
        curve = tab_inv(tab, twet, ps) if use_tab else NAN
        total = 0.0
        started = False
        prev_ln = lts
        w_src = ws(twet, ps)
        if w_src != w_src:
            w_src = 0.0
        tv_src = tvirt(twet, w_src)
        e_t0 = take_at(lnP, Tc, lts)
        e_td0 = nanmin2(take_at(lnP, Dc, lts), e_t0)
        w_e0 = ws(e_td0, ps)
        if w_e0 != w_e0:
            w_e0 = 0.0
        prev_dtv = tvirt(e_t0, w_e0) - tv_src
        for j in range(111):
            p = 50000.0 + 500.0 * j
            active = (twet == twet) and (p > ps) and (p <= sfc)
            if not active:
                continue
            if use_tab:
                cur_t = tab_T(tab, curve, p)
            else:
                h = (p - cur_p) / 4.0
                tt = cur_t
                pp = cur_p
                for _ in range(4):
                    tt = rk4(tt, pp, h)
                    pp = pp + h
                cur_t = tt
            cur_p = p
            wp = ws(cur_t, p)
            if wp != wp:
                wp = 0.0
            tvp = tvirt(cur_t, wp)
            lp = math.log(p)
            et = at_pressure(lnP, Tc, lp)
            ed = at_pressure(lnP, Dc, lp)
            we = ws(nanmin2(ed, et), p)
            if we != we:
                we = 0.0
            d = tvirt(et, we) - tvp
            if d == d and prev_dtv == prev_dtv:
                a = (d if d > 0 else 0.0) + (prev_dtv if prev_dtv > 0 else 0.0)
                total = total + RD * (0.5 * a * (lp - prev_ln))
            prev_dtv = d
            prev_ln = lp
            started = True
        out[c] = total if (started and total == total) else NAN
    return out


# ── pseudoadiabat table (production mode) ───────────────────────────────────
# V5 integrates the pseudoadiabat with RK4 at every ascent level. Pseudoadiabats are a
# one-parameter family of curves, so the family is integrated ONCE, with V5's own dT/dp
# and a finer step than V5 uses (1 hPa in four RK4 sub-steps), and read back by
# bilinear interpolation. A curve is labelled by its temperature at 1000 hPa.

TABLE_T0 = 203.15
TABLE_DT = 0.05
TABLE_NT = 2401              # 203.15 .. 323.15 K at 1000 hPa
TABLE_P0 = 110000.0
TABLE_DP = 100.0
TABLE_NP = 1001              # 1100 .. 100 hPa
_TABLE = None


@njit(parallel=True, cache=True)
def _build_table(nt, t0, dt, np_, p0, dp):
    tab = np.empty((nt, np_))
    j1000 = int(round((p0 - 100000.0) / dp))
    for i in prange(nt):
        t = t0 + i * dt
        tab[i, j1000] = t
        tc = t
        p = 100000.0
        for j in range(j1000 + 1, np_):          # upward
            for _ in range(4):
                tc = rk4(tc, p, -dp / 4.0)
                p = p - dp / 4.0
            tab[i, j] = tc
        tc = t
        p = 100000.0
        for j in range(j1000 - 1, -1, -1):        # downward
            for _ in range(4):
                tc = rk4(tc, p, dp / 4.0)
                p = p + dp / 4.0
            tab[i, j] = tc
    return tab


def table():
    global _TABLE
    if _TABLE is None:
        from ..config import CACHE
        f = CACHE / 'v5_pseudoadiabat_rk4_v1.npy'
        try:
            _TABLE = np.load(f) if f.exists() else None
        except Exception:                 # a parallel worker may be mid-write
            _TABLE = None
        if _TABLE is None or _TABLE.shape != (TABLE_NT, TABLE_NP):
            _TABLE = _build_table(TABLE_NT, TABLE_T0, TABLE_DT, TABLE_NP, TABLE_P0, TABLE_DP)
            f.parent.mkdir(parents=True, exist_ok=True)
            import os
            tmp = f.with_name(f'{f.stem}.{os.getpid()}.npy')
            np.save(tmp, _TABLE)
            try:
                os.replace(tmp, f)
            except OSError:
                pass
    return _TABLE


@njit(cache=True)
def tab_T(tab, i_f, p):
    """Pseudoadiabat temperature at pressure p on fractional curve i_f."""
    jf = (TABLE_P0 - p) / TABLE_DP
    if jf != jf or i_f != i_f:
        return NAN
    jf = min(max(jf, 0.0), TABLE_NP - 1.000001)
    i_f = min(max(i_f, 0.0), TABLE_NT - 1.000001)
    j = int(jf)
    i = int(i_f)
    fj = jf - j
    fi = i_f - i
    a = tab[i, j] + fj * (tab[i, j + 1] - tab[i, j])
    b = tab[i + 1, j] + fj * (tab[i + 1, j + 1] - tab[i + 1, j])
    return a + fi * (b - a)


@njit(cache=True)
def tab_inv(tab, t, p):
    """The curve through (t, p), as a fractional index (T rises with the index)."""
    if t != t or p != p:
        return NAN
    lo = 0.0
    hi = TABLE_NT - 1.000001
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if tab_T(tab, mid, p) < t:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


@njit(cache=True)
def lift_column_tab(tab, lnP_asc, T_asc, D_asc, Z_asc, top, p0, t0, d0,
                    has_sfc, p_low, t_low, d_low, sp, st, sd, step, out):
    """lift_column with the saturated ascent read from the pseudoadiabat table."""
    if p0 != p0:
        out[0] = 0.0
        for j in range(1, 8):
            out[j] = NAN
        out[8] = 1.0
        return
    n = int(math.ceil((p0 - top) / step)) + 1
    if n < 1:
        n = 1
    grid = np.empty(n)
    for i in range(n):
        g = p0 - i * step
        grid[i] = g if g > top else top
    tl = t_lcl(t0, d0)
    pl = p0 * (tl / t0) ** (1.0 / KAPPA)
    w0 = ws(d0, p0)
    curve = tab_inv(tab, tl, pl)
    dtv = np.empty(n)
    envz = np.empty(n)
    lnp = np.empty(n)
    for i in range(n):
        lev = grid[i]
        lnp[i] = math.log(lev)
        if not (lev <= pl):
            pt = t0 * (lev / p0) ** KAPPA
            ptd = td_from_w(w0, lev)
        else:
            pt = tab_T(tab, curve, lev)
            ptd = pt
        et, ed = env_at(lnP_asc, T_asc, D_asc, lev, has_sfc, p_low, t_low, d_low, sp, st, sd)
        wp = ws(ptd, lev)
        if wp != wp:
            wp = 0.0
        we = ws(ed, lev)
        if we != we:
            we = 0.0
        d = tvirt(pt, wp) - tvirt(et, we)
        if abs(d) < BUOYANCY_EPSILON:
            d = 0.0
        dtv[i] = d
        envz[i] = interp_logp(lnP_asc, Z_asc, lnp[i])
    # identical area/level logic to lift_column
    first = -1
    last = -1
    for i in range(n):
        if dtv[i] == dtv[i] and dtv[i] > 0 and grid[i] <= pl + 1e-6:
            if first < 0:
                first = i
            last = i
    has_pos = first >= 0
    f = first if has_pos else 0
    lfc = NAN
    el = NAN
    if has_pos:
        below = f - 1 if f > 0 else 0
        a = dtv[below]
        b = dtv[f]
        crosses = (a == a) and (b == b) and a < 0 and b > 0
        frac = 0.0
        if crosses and b != a:
            frac = -a / (b - a)
            if frac != frac:
                frac = 0.0
            frac = min(max(frac, 0.0), 1.0)
        ln_lfc = lnp[below] + frac * (lnp[f] - lnp[below]) if crosses else math.log(pl)
        lfc = math.exp(ln_lfc)
        if f == 0:
            lfc = min(pl, grid[0]) if pl == pl else NAN
        l = last
        above = l + 1 if l + 1 < n else n - 1
        a2 = dtv[l]
        b2 = dtv[above]
        cd = (a2 == a2) and (b2 == b2) and a2 > 0 and b2 < 0
        frac2 = 0.0
        if cd and b2 != a2:
            frac2 = -a2 / (b2 - a2)
            if frac2 != frac2:
                frac2 = 0.0
            frac2 = min(max(frac2, 0.0), 1.0)
        el = math.exp(lnp[l] + frac2 * (lnp[above] - lnp[l]))
        if l == n - 1:
            el = NAN
    cape = 0.0
    cin = 0.0
    for i in range(n - 1):
        c0 = dtv[i] if (dtv[i] == dtv[i] and dtv[i] > 0 and grid[i] <= pl + 1e-6) else 0.0
        c1 = dtv[i + 1] if (dtv[i + 1] == dtv[i + 1] and dtv[i + 1] > 0 and grid[i + 1] <= pl + 1e-6) else 0.0
        d = lnp[i + 1] - lnp[i]
        cape += d * (c1 + c0) / 2.0
        n0 = dtv[i] if (dtv[i] == dtv[i] and dtv[i] < 0 and grid[i] > lfc) else 0.0
        n1 = dtv[i + 1] if (dtv[i + 1] == dtv[i + 1] and dtv[i + 1] < 0 and grid[i + 1] > lfc) else 0.0
        cin += d * (n1 + n0) / 2.0
    cape = RD * abs(cape)
    cin = -RD * abs(cin)
    if not has_pos:
        cape = 0.0
        cin = NAN
    out[0] = cape
    out[1] = cin
    out[2] = pl
    out[3] = _height_at(grid, lnp, envz, pl)
    out[4] = lfc
    out[5] = _height_at(grid, lnp, envz, lfc)
    out[6] = el
    out[7] = _height_at(grid, lnp, envz, el)
    out[8] = 0.0 if has_pos else 1.0


@njit(parallel=True, cache=True)
def interp_at_height_nb(H, V, target):
    """gridparams._interp_at_height per cell: the first usable interval holding the target."""
    n, ncell = V.shape
    out = np.empty(ncell)
    for c in prange(ncell):
        o = NAN
        tg = target[c]
        for k in range(n - 1):
            lo = H[k, c]
            hi = H[k + 1, c]
            vlo = V[k, c]
            vhi = V[k + 1, c]
            span = hi - lo
            if not (span == span and span > 0):
                continue
            if vlo != vlo or vhi != vhi:
                continue
            if tg >= lo and tg <= hi:
                o = vlo + ((tg - lo) / span) * (vhi - vlo)
                break
        out[c] = o
    return out


@njit(parallel=True, cache=True)
def wet_bulb_nb(T, D, P):
    out = np.empty(T.size)
    for c in prange(T.size):
        out[c] = wet_bulb(T[c], D[c], P[c])
    return out


# ── fast helpers for the production kernels ─────────────────────────────────
# Saturation vapour pressure (Bolton eq. 10, as V5) tabulated every 0.005 K and read by
# linear interpolation: the relative error is ~1e-8, below the float32 resolution of every
# field it feeds, and it takes an exponential out of the innermost loops.
ES_T0 = 150.0
ES_DT = 0.005
_c = ES_T0 + np.arange(40001) * ES_DT - ZC
ES_TAB = 611.2 * np.exp(17.67 * _c / (_c + 243.5))
ES_N = ES_TAB.size
del _c
LN_DESCENT = np.log(50000.0 + 500.0 * np.arange(111))
LN_SEARCH = np.log(70000.0 - 1000.0 * np.arange(21))


@njit(cache=True)
def es_t(t):
    f = (t - ES_T0) / ES_DT
    if not (f >= 0.0 and f < ES_N - 1):
        return es(t)
    i = int(f)
    return ES_TAB[i] + (f - i) * (ES_TAB[i + 1] - ES_TAB[i])


@njit(cache=True)
def ws_t(t, p):
    e = es_t(t)
    d = p - e
    if d > 1.0:
        return EPS * e / d
    return NAN


@njit(cache=True)
def theta_e_t(t, td, p):
    w = ws_t(td, p)
    r_g = w * 1000.0
    e = p * w / (EPS + w)
    tl = t_lcl(t, td)
    th_dl = t * (P0 / (p - e)) ** KAPPA * (t / tl) ** (0.28e-3 * r_g)
    return th_dl * math.exp((3036.0 / tl - 1.78) * w * (1.0 + 0.448 * w))


@njit(cache=True)
def env_at_ln(lnP_asc, T_asc, D_asc, p, lt, has_sfc, p_low, ln_p_low, t_low, d_low, sp, ln_span, st, sd):
    """env_at with the logarithms supplied (identical arithmetic)."""
    if has_sfc and (p > p_low + 1e-6) and (p <= sp + 1e-6) and (p_low == p_low):
        w = (lt - ln_p_low) / ln_span if ln_span != 0 else 0.0
        if w != w:
            w = 0.0
        elif w == np.inf:
            w = 1.0
        elif w == -np.inf:
            w = 0.0
        w = min(max(w, 0.0), 1.0)
        return t_low + w * (st - t_low), d_low + w * (sd - d_low)
    return interp_logp(lnP_asc, T_asc, lt), interp_logp(lnP_asc, D_asc, lt)


def fixed_tables(lnP, lts):
    """For pressures that are the SAME in every cell, the stored-level intervals and
    weights _at_pressure would find, worked out once: up to 3 matching intervals each,
    in order (the first finite candidate wins, exactly as _at_pressure)."""
    n = len(lts)
    K = np.full((n, 3), -1, np.int64)
    W = np.zeros((n, 3))
    for i, lt in enumerate(lts):
        m = 0
        for k in range(lnP.size - 1):
            lo, hi = lnP[k], lnP[k + 1]
            if min(lo, hi) <= lt <= max(lo, hi) and m < 3:
                K[i, m] = k
                W[i, m] = 0.0 if hi == lo else (lt - lo) / (hi - lo)
                m += 1
    return K, W


@njit(cache=True)
def at_fixed(vals, K, W, i):
    out = NAN
    for m in range(3):
        k = K[i, m]
        if k < 0:
            break
        cand = vals[k] + W[i, m] * (vals[k + 1] - vals[k])
        if out != out:
            out = cand
    return out


# ── kernel v2 (production): all three parcels on one shared environment walk ─
# Every V5 parcel ascent starts from a 5 hPa grid anchored on its own origin. The
# surface and mixed-layer parcels both start at the search base, and the most-unstable
# parcel is chosen FROM that same grid (base - k * 5 hPa) or is the surface parcel, so
# all three ascend on the same pressures (the MU parcel on a suffix of them). The
# environment -- the expensive part: log-p interpolation with the surface-layer blend,
# saturation mixing ratio, virtual temperature -- is therefore evaluated once per level
# and shared. Saturated parcel virtual temperature comes from a table of the same
# pseudoadiabats (TV_TABLE); a dry parcel's mixing ratio is its source value, which is
# what V5's ws(td_from_w(w0)) returns.

_TVTABLE = None


@njit(parallel=True, cache=True)
def _build_tv(tab, p0, dp):
    nt, np_ = tab.shape
    out = np.empty((nt, np_))
    for i in prange(nt):
        for j in range(np_):
            p = p0 - j * dp
            t = tab[i, j]
            w = ws(t, p)
            if w != w:
                w = 0.0
            out[i, j] = tvirt(t, w)
    return out


def tv_table():
    global _TVTABLE
    if _TVTABLE is None:
        _TVTABLE = _build_tv(table(), TABLE_P0, TABLE_DP)
    return _TVTABLE


@njit(cache=True)
def _env_grid(lnP_asc, T_asc, D_asc, has_sfc, p_low, t_low, d_low, sp, st, sd, base, top, step, n,
              G, lnG, ET, ED, TVE):
    ln_p_low = math.log(p_low) if p_low > 0 else NAN
    ln_span = (math.log(sp) - ln_p_low) if (has_sfc and sp > 0) else NAN
    nl = lnP_asc.size
    ptr = nl - 1
    for i in range(n):
        g = base - i * step
        if g < top:
            g = top
        G[i] = g
        lg = math.log(g)
        lnG[i] = lg
        if has_sfc and (g > p_low + 1e-6) and (g <= sp + 1e-6) and (p_low == p_low):
            et, ed = env_at_ln(lnP_asc, T_asc, D_asc, g, lg, has_sfc, p_low, ln_p_low, t_low, d_low, sp, ln_span, st, sd)
        elif lg < lnP_asc[0] - 1e-9 or lg > lnP_asc[nl - 1] + 1e-9:
            et = NAN
            ed = NAN
        else:
            # searchsorted-left by a pointer that only moves upward through the column
            while ptr > 0 and lnP_asc[ptr - 1] >= lg:
                ptr -= 1
            j = ptr if ptr >= 1 else 1
            lo = j - 1
            span = lnP_asc[j] - lnP_asc[lo]
            wgt = (lg - lnP_asc[lo]) / span if span != 0 else 0.0
            et = T_asc[lo] + wgt * (T_asc[j] - T_asc[lo])
            ed = D_asc[lo] + wgt * (D_asc[j] - D_asc[lo])
        ET[i] = et
        ED[i] = ed
        we = ws_t(ed, g)
        if we != we:
            we = 0.0
        TVE[i] = tvirt(et, we)


@njit(cache=True)
def _lift_shared(tv_tab, tab, G, lnG, TVE, k0, n, p0, t0, d0, lnP_asc, Z_asc, out):
    """One parcel on G[k0:k0+n]; same LFC/EL/area logic as lift_column."""
    if p0 != p0 or t0 != t0 or d0 != d0:
        out[0] = 0.0
        for j in range(1, 8):
            out[j] = NAN
        out[8] = 1.0
        return
    tl = t_lcl(t0, d0)
    pl = p0 * (tl / t0) ** (1.0 / KAPPA)
    w0 = ws(d0, p0)
    if w0 != w0:
        w0 = 0.0
    curve = tab_inv(tab, tl, pl)
    dtv = np.empty(n)
    grid = G[k0:k0 + n]
    lnp = lnG[k0:k0 + n]
    lnp0 = math.log(p0)
    for i in range(n):
        lev = grid[i]
        if not (lev <= pl):
            tvp = tvirt(t0 * math.exp(KAPPA * (lnp[i] - lnp0)), w0)
        else:
            tvp = tab_T(tv_tab, curve, lev)
        d = tvp - TVE[k0 + i]
        if abs(d) < BUOYANCY_EPSILON:
            d = 0.0
        dtv[i] = d
    first = -1
    last = -1
    for i in range(n):
        if dtv[i] == dtv[i] and dtv[i] > 0 and grid[i] <= pl + 1e-6:
            if first < 0:
                first = i
            last = i
    has_pos = first >= 0
    f = first if has_pos else 0
    lfc = NAN
    el = NAN
    if has_pos:
        below = f - 1 if f > 0 else 0
        a = dtv[below]
        b = dtv[f]
        crosses = (a == a) and (b == b) and a < 0 and b > 0
        frac = 0.0
        if crosses and b != a:
            frac = -a / (b - a)
            if frac != frac:
                frac = 0.0
            frac = min(max(frac, 0.0), 1.0)
        ln_lfc = lnp[below] + frac * (lnp[f] - lnp[below]) if crosses else math.log(pl)
        lfc = math.exp(ln_lfc)
        if f == 0:
            lfc = min(pl, grid[0]) if pl == pl else NAN
        l = last
        above = l + 1 if l + 1 < n else n - 1
        a2 = dtv[l]
        b2 = dtv[above]
        cd = (a2 == a2) and (b2 == b2) and a2 > 0 and b2 < 0
        frac2 = 0.0
        if cd and b2 != a2:
            frac2 = -a2 / (b2 - a2)
            if frac2 != frac2:
                frac2 = 0.0
            frac2 = min(max(frac2, 0.0), 1.0)
        el = math.exp(lnp[l] + frac2 * (lnp[above] - lnp[l]))
        if l == n - 1:
            el = NAN
    cape = 0.0
    cin = 0.0
    for i in range(n - 1):
        c0 = dtv[i] if (dtv[i] == dtv[i] and dtv[i] > 0 and grid[i] <= pl + 1e-6) else 0.0
        c1 = dtv[i + 1] if (dtv[i + 1] == dtv[i + 1] and dtv[i + 1] > 0 and grid[i + 1] <= pl + 1e-6) else 0.0
        d = lnp[i + 1] - lnp[i]
        cape += d * (c1 + c0) / 2.0
        n0 = dtv[i] if (dtv[i] == dtv[i] and dtv[i] < 0 and grid[i] > lfc) else 0.0
        n1 = dtv[i + 1] if (dtv[i + 1] == dtv[i + 1] and dtv[i + 1] < 0 and grid[i + 1] > lfc) else 0.0
        cin += d * (n1 + n0) / 2.0
    cape = RD * abs(cape)
    cin = -RD * abs(cin)
    if not has_pos:
        cape = 0.0
        cin = NAN
    out[0] = cape
    out[1] = cin
    out[2] = pl
    out[3] = _height_lazy(grid, lnp, lnP_asc, Z_asc, pl)
    out[4] = lfc
    out[5] = _height_lazy(grid, lnp, lnP_asc, Z_asc, lfc)
    out[6] = el
    out[7] = _height_lazy(grid, lnp, lnP_asc, Z_asc, el)
    out[8] = 0.0 if has_pos else 1.0


@njit(cache=True)
def _height_lazy(grid, lnp, lnP_asc, Z_asc, ptarget):
    """_height_at, interpolating the environment height only at the two levels used."""
    if ptarget != ptarget:
        return NAN
    lt = math.log(ptarget)
    out = NAN
    for i in range(grid.size - 1):
        lo = lnp[i]
        hi = lnp[i + 1]
        if lt <= lo and lt >= hi:
            span = hi - lo
            w = (lt - lo) / span if span != 0 else 0.0
            z0 = interp_logp(lnP_asc, Z_asc, lo)
            z1 = interp_logp(lnP_asc, Z_asc, hi)
            out = z0 + w * (z1 - z0)
    return out


@njit(parallel=True, cache=True)
def ascend3_all(P, T, D, Z, SP, ST, SD, has_sfc, top, step, ml_depth, mu_depth, tab, tv_tab):
    """All three V5 parcels per cell. T, D, Z: (ncell, nlev) stored (decreasing-p) order.
    Returns (3, ncell, 12): surface, mixed layer, most unstable."""
    ncell, nlev = T.shape
    lnP_asc = np.log(P)[::-1].copy()
    res = np.empty((3, ncell, 12))
    nml = int(ml_depth / step) + 1
    nmu = int(mu_depth / step) + 1
    for c in prange(ncell):
        T_asc = T[c, ::-1].copy()
        D_asc = D[c, ::-1].copy()
        Z_asc = Z[c, ::-1].copy()
        p_low, t_low, d_low = _lowest(T[c], D[c], P)
        sp = SP[c]
        st = ST[c]
        sd = SD[c]
        if has_sfc and (sp == sp) and (p_low == p_low) and sp > p_low + 1e-6:
            base = sp
        else:
            base = p_low
        o = np.empty(9)
        if base != base:
            for k in range(3):
                for j in range(12):
                    res[k, c, j] = NAN
                res[k, c, 0] = 0.0
                res[k, c, 8] = 1.0
            continue
        n = int(math.ceil((base - top) / step)) + 1
        if n < max(nml, nmu) + 1:
            n = max(nml, nmu) + 1
        G = np.empty(n)
        lnG = np.empty(n)
        ET = np.empty(n)
        ED = np.empty(n)
        TVE = np.empty(n)
        _env_grid(lnP_asc, T_asc, D_asc, has_sfc, p_low, t_low, d_low, sp, st, sd, base, top, step, n,
                  G, lnG, ET, ED, TVE)
        n_asc = int(math.ceil((base - top) / step)) + 1
        # surface parcel
        if has_sfc:
            sp0, st0, sd0 = sp, st, nanmin2(sd, st)
        else:
            sp0, st0, sd0 = p_low, t_low, nanmin2(d_low, t_low)
        if sp0 == base or (sp0 != sp0):
            _lift_shared(tv_tab, tab, G, lnG, TVE, 0, n_asc, sp0, st0, sd0, lnP_asc, Z_asc, o)
        else:                               # surface not on the shared grid (rare): own grid
            lift_column_tab(tab, lnP_asc, T_asc, D_asc, Z_asc, top, sp0, st0, sd0,
                            has_sfc, p_low, t_low, d_low, sp, st, sd, step, o)
        for j in range(9):
            res[0, c, j] = o[j]
        res[0, c, 9] = sp0
        res[0, c, 10] = st0
        res[0, c, 11] = sd0
        # mixed layer
        tot = 0.0
        ths = 0.0
        wsum = 0.0
        for k in range(nml):
            p = G[k]
            et = ET[k]
            ed = nanmin2(ED[k], et)
            if et == et and ed == ed:
                tot += step
                ths += nan0(et * (P0 / p) ** KAPPA) * step
                wsum += nan0(ws_t(ed, p)) * step
        if tot > 0:
            t0 = (ths / tot) * (base / P0) ** KAPPA
            d0 = nanmin2(td_from_w(wsum / tot, base), t0)
        else:
            t0 = NAN
            d0 = NAN
        _lift_shared(tv_tab, tab, G, lnG, TVE, 0, n_asc, base, t0, d0, lnP_asc, Z_asc, o)
        for j in range(9):
            res[1, c, j] = o[j]
        res[1, c, 9] = base
        res[1, c, 10] = t0
        res[1, c, 11] = d0
        # most unstable: the maximum theta-e on the shared grid, or the surface parcel
        best = -np.inf
        kb = 0
        for k in range(nmu):
            et = ET[k]
            ed = nanmin2(ED[k], et)
            te = theta_e_t(et, ed, G[k])
            if te != te:
                te = -np.inf
            if k == 0 or te > best:
                best = te
                kb = k
        te = theta_e_t(st0, nanmin2(sd0, st0), sp0)
        if te != te:
            te = -np.inf
        if te > best:
            for j in range(12):
                res[2, c, j] = res[0, c, j]
        else:
            p0 = G[kb]
            t0 = ET[kb]
            d0 = nanmin2(ED[kb], t0)
            n_mu = int(math.ceil((p0 - top) / step)) + 1
            if kb + n_mu > n:
                n_mu = n - kb
            _lift_shared(tv_tab, tab, G, lnG, TVE, kb, n_mu, p0, t0, d0, lnP_asc, Z_asc, o)
            for j in range(9):
                res[2, c, j] = o[j]
            res[2, c, 9] = p0
            res[2, c, 10] = t0
            res[2, c, 11] = d0
    return res


@njit(parallel=True, cache=True)
def dcape2_all(P, T, D, SP, has_sp, tab, tv_tab, KS, WS, KD, WD):
    """dcape_all with the descent read from the pseudoadiabat tables."""
    ncell, nlev = T.shape
    lnP = np.log(P)
    out = np.empty(ncell)
    for c in prange(ncell):
        Tc = T[c]
        Dc = D[c]
        best = np.inf
        src = 0
        have = False
        for i in range(21):
            p = 70000.0 - 1000.0 * i
            t = at_fixed(Tc, KS, WS, i)
            td = nanmin2(at_fixed(Dc, KS, WS, i), t)
            te = theta_e_t(t, td, p)
            if te == te:
                have = True
                if te < best:
                    best = te
                    src = i
        if not have:
            out[c] = NAN
            continue
        ps = 70000.0 - 1000.0 * src
        lts = LN_SEARCH[src]
        ts = at_fixed(Tc, KS, WS, src)
        tds = nanmin2(at_fixed(Dc, KS, WS, src), ts)
        twet = wet_bulb(ts, tds, ps)
        sfc = SP[c] if has_sp else P[0]
        sfc = nanmin2(sfc, P[0])
        curve = tab_inv(tab, twet, ps)
        total = 0.0
        started = False
        prev_ln = lts
        w_src = ws(twet, ps)
        if w_src != w_src:
            w_src = 0.0
        e_t0 = ts
        e_td0 = nanmin2(at_fixed(Dc, KS, WS, src), e_t0)
        w_e0 = ws_t(e_td0, ps)
        if w_e0 != w_e0:
            w_e0 = 0.0
        prev_dtv = tvirt(e_t0, w_e0) - tvirt(twet, w_src)
        if twet != twet:
            out[c] = NAN
            continue
        for j in range(111):
            p = 50000.0 + 500.0 * j
            if not ((p > ps) and (p <= sfc)):
                continue
            lp = LN_DESCENT[j]
            tvp = tab_T(tv_tab, curve, p)
            et = at_fixed(Tc, KD, WD, j)
            ed = at_fixed(Dc, KD, WD, j)
            we = ws_t(nanmin2(ed, et), p)
            if we != we:
                we = 0.0
            d = tvirt(et, we) - tvp
            if d == d and prev_dtv == prev_dtv:
                a = (d if d > 0 else 0.0) + (prev_dtv if prev_dtv > 0 else 0.0)
                total = total + RD * (0.5 * a * (lp - prev_ln))
            prev_dtv = d
            prev_ln = lp
            started = True
        out[c] = total if (started and total == total) else NAN
    return out


# ── V5 compute_grid with the expensive kernels swapped in ───────────────────

def _flat(a):
    return np.ascontiguousarray(a.reshape(a.shape[0], -1), dtype='float64')


def _ascend_fast(columns, kind, tile_rows=None):
    shape = columns.shape
    ncell = shape[0] * shape[1]
    has_sfc = (columns.surface_pressure is not None and columns.surface_temperature is not None
               and columns.surface_dewpoint is not None)
    z = lambda a: (np.ascontiguousarray(np.asarray(a, dtype='float64').ravel()) if a is not None   # noqa: E731
                   else np.full(ncell, np.nan))
    k = {'surface': 0, 'mixed_layer': 1, 'most_unstable': 2}[kind]
    res = ascend_all(k, np.asarray(columns.pressure, dtype='float64'), _flat(columns.temperature),
                     _flat(columns.dewpoint), _flat(columns.height), z(columns.surface_pressure),
                     z(columns.surface_temperature), z(columns.surface_dewpoint), has_sfc,
                     float(np.nanmin(columns.pressure)), float(ASCENT_STEP_PA),
                     float(MIXED_LAYER_DEPTH_PA), float(MOST_UNSTABLE_DEPTH_PA), _tab(), not EXACT)
    f = lambda j: res[:, j].reshape(shape)   # noqa: E731
    return G.GriddedAscent(kind=kind, cape=f(0), cin=f(1), lcl_pressure=f(2), lcl_height=f(3),
                           lfc_pressure=f(4), lfc_height=f(5), el_pressure=f(6), el_height=f(7),
                           parcel_pressure=f(9), parcel_temperature=f(10), parcel_dewpoint=f(11),
                           no_lfc=f(8) > 0.5, notes=[])


def _dcape_fast(out, columns):
    shape = columns.shape
    sp = columns.surface_pressure
    vals = dcape_all(np.asarray(columns.pressure, dtype='float64'), _flat(columns.temperature),
                     _flat(columns.dewpoint),
                     np.ascontiguousarray(np.asarray(sp, dtype='float64').ravel()) if sp is not None
                     else np.zeros(shape[0] * shape[1]), sp is not None, _tab(), not EXACT).reshape(shape)
    if not np.isfinite(vals).any():
        out.issues.append('theta-e could not be evaluated in the 700-500 hPa source layer anywhere; DCAPE unavailable')
        return
    out.add(GP.Field('dcape', vals, 'J/kg', 'convective_environment', method='emanuel_1994_min_theta_e',
                     source_fields=('temperature', 'relative_humidity')))


#: True: V5's RK4 march, bit-for-bit (verification). False: the pseudoadiabat table
#: (production) -- `verify4 table` measures the difference.
EXACT = False


def _tab():
    return table() if not EXACT else np.zeros((2, 2))


def _interp_at_height_fast(height, values, target):
    n, ny, nx = values.shape
    tg = np.ascontiguousarray(np.broadcast_to(np.asarray(target, dtype='float64'), (ny, nx)).ravel())
    H = np.ascontiguousarray(np.broadcast_to(height, values.shape).reshape(n, -1), dtype='float64')
    return interp_at_height_nb(H, _flat(values), tg).reshape(ny, nx)


@njit(cache=True)
def wet_bulb_t(t, td, p):
    """wet_bulb with the tabulated saturation vapour pressure (production)."""
    w = ws_t(td, p)
    low = min(td, t) if (td == td and t == t) else NAN
    high = t
    for _ in range(12):
        mid = 0.5 * (low + high)
        res = CP * (t - mid) - lv(mid) * (ws_t(mid, p) - w)
        if res < 0:
            high = mid
        else:
            low = mid
    return 0.5 * (low + high)


@njit(parallel=True, cache=True)
def wet_bulb_t_nb(T, D, P):
    out = np.empty(T.size)
    for c in prange(T.size):
        out[c] = wet_bulb_t(T[c], D[c], P[c])
    return out


@njit(parallel=True, cache=True)
def dewpoint_from_rh_nb(RH, T):
    """thermo.dewpoint_from_rh, elementwise and exact."""
    out = np.empty(T.size)
    for c in prange(T.size):
        rh = RH[c]
        if rh == rh and rh < 1e-6:
            rh = 1e-6
        e = (rh / 100.0) * es(T[c])
        if e > 0:
            ln = math.log(e / 611.2)
            out[c] = ZC + 243.5 * ln / (17.67 - ln)
        else:
            out[c] = NAN
    return out


def _dewpoint_from_rh_fast(relative_humidity, temperature):
    rh = np.asarray(relative_humidity, dtype='float64')
    t = np.asarray(temperature, dtype='float64')
    shape = np.broadcast(rh, t).shape
    f = lambda a: np.ascontiguousarray(np.broadcast_to(a, shape).ravel())   # noqa: E731
    return dewpoint_from_rh_nb(f(rh), f(t)).reshape(shape)


def _wet_bulb_fast(temperature, dewpoint, pressure, iterations=12):
    t = np.asarray(temperature, dtype='float64')
    td = np.asarray(dewpoint, dtype='float64')
    p = np.asarray(pressure, dtype='float64')
    shape = np.broadcast(t, td, p).shape
    f = lambda a: np.ascontiguousarray(np.broadcast_to(a, shape).ravel())   # noqa: E731
    k = wet_bulb_nb if EXACT else wet_bulb_t_nb
    return k(f(t), f(td), f(p)).reshape(shape)


@njit(parallel=True, cache=True)
def sample_layer_nb(P, T, D, grid, K, W):
    """gridparams._sample_layer per cell: RH (%) and mixing ratio on the 10 hPa grid."""
    ncell, nlev = T.shape
    ng = grid.size
    rh = np.empty((ng, ncell))
    w = np.empty((ng, ncell))
    for c in prange(ncell):
        for i in range(ng):
            p = grid[i]
            t = at_fixed(T[c], K, W, i)
            td = nanmin2(at_fixed(D[c], K, W, i), t)
            rh[i, c] = 100.0 * es(td) / es(t)
            w[i, c] = ws(td, p)
    return rh, w


def _sample_layer_fast(columns, top_pa, bottom_pa):
    grid = np.arange(bottom_pa, top_pa - 1.0, -1000.0)
    shape = columns.shape
    P = np.asarray(columns.pressure, dtype='float64')
    rh, w = sample_layer_nb(P, np.ascontiguousarray(_flat(columns.temperature).T),
                            np.ascontiguousarray(_flat(columns.dewpoint).T), grid,
                            *fixed_tables(np.log(P), np.log(grid)))
    return grid, rh.reshape((grid.size,) + shape), w.reshape((grid.size,) + shape)


_V2 = {}


def _ascend_v2(columns, kind, tile_rows=None):
    """Production ascent: all three parcels in one shared-environment pass (cached for the
    three calls V5's _thermodynamics makes on the same columns)."""
    key = id(columns)
    if _V2.get('key') != key:
        shape = columns.shape
        ncell = shape[0] * shape[1]
        has_sfc = (columns.surface_pressure is not None and columns.surface_temperature is not None
                   and columns.surface_dewpoint is not None)
        z = lambda a: (np.ascontiguousarray(np.asarray(a, dtype='float64').ravel()) if a is not None   # noqa: E731
                       else np.full(ncell, np.nan))
        tr = lambda a: np.ascontiguousarray(_flat(a).T)     # noqa: E731   (ncell, nlev)
        res = ascend3_all(np.asarray(columns.pressure, dtype='float64'), tr(columns.temperature),
                          tr(columns.dewpoint), tr(columns.height), z(columns.surface_pressure),
                          z(columns.surface_temperature), z(columns.surface_dewpoint), has_sfc,
                          float(np.nanmin(columns.pressure)), float(ASCENT_STEP_PA),
                          float(MIXED_LAYER_DEPTH_PA), float(MOST_UNSTABLE_DEPTH_PA), table(), tv_table())
        _V2.clear()
        _V2.update(key=key, res=res, shape=shape)
    res, shape = _V2['res'], _V2['shape']
    k = {'surface': 0, 'mixed_layer': 1, 'most_unstable': 2}[kind]
    f = lambda j: res[k, :, j].reshape(shape)   # noqa: E731
    return G.GriddedAscent(kind=kind, cape=f(0), cin=f(1), lcl_pressure=f(2), lcl_height=f(3),
                           lfc_pressure=f(4), lfc_height=f(5), el_pressure=f(6), el_height=f(7),
                           parcel_pressure=f(9), parcel_temperature=f(10), parcel_dewpoint=f(11),
                           no_lfc=f(8) > 0.5, notes=[])


def _dcape_v2(out, columns):
    shape = columns.shape
    sp = columns.surface_pressure
    vals = dcape2_all(np.asarray(columns.pressure, dtype='float64'), np.ascontiguousarray(_flat(columns.temperature).T),
                      np.ascontiguousarray(_flat(columns.dewpoint).T),
                      np.ascontiguousarray(np.asarray(sp, dtype='float64').ravel()) if sp is not None
                      else np.zeros(shape[0] * shape[1]), sp is not None, table(), tv_table(),
                      *fixed_tables(np.log(np.asarray(columns.pressure, dtype='float64')), LN_SEARCH),
                      *fixed_tables(np.log(np.asarray(columns.pressure, dtype='float64')), LN_DESCENT)).reshape(shape)
    if not np.isfinite(vals).any():
        out.issues.append('theta-e could not be evaluated in the 700-500 hPa source layer anywhere; DCAPE unavailable')
        return
    out.add(GP.Field('dcape', vals, 'J/kg', 'convective_environment', method='emanuel_1994_min_theta_e',
                     source_fields=('temperature', 'relative_humidity')))


def compute_grid(cube):
    """V5 `gridparams.compute_grid` with the expensive kernels compiled: the ascent, DCAPE,
    height interpolation and wet-bulb. EXACT=True uses the bit-for-bit V5 kernels;
    otherwise the shared-environment table kernels (v2). Every other Stage 4
    calculation is V5's own code."""
    asc, dc = (_ascend_fast, _dcape_fast) if EXACT else (_ascend_v2, _dcape_v2)
    orig = (GP._ascend_tiled, GP._dcape, GP._interp_at_height, GP._sample_layer, TH.wet_bulb_temperature,
            TH.dewpoint_from_rh)
    GP._ascend_tiled, GP._dcape, GP._interp_at_height, GP._sample_layer = asc, dc, _interp_at_height_fast, _sample_layer_fast
    TH.wet_bulb_temperature = _wet_bulb_fast
    TH.dewpoint_from_rh = _dewpoint_from_rh_fast
    try:
        return GP.compute_grid(cube)
    finally:
        (GP._ascend_tiled, GP._dcape, GP._interp_at_height, GP._sample_layer, TH.wet_bulb_temperature,
         TH.dewpoint_from_rh) = orig
        _V2.clear()
