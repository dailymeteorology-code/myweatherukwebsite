"""Hyper-Short nowcast engine, version 2.

What changed from version 1 (engine.py), and why each matters for accuracy:

MOTION. v1 matched only the first and last radar frames, by FFT phase correlation in
48 km blocks, and returned ZERO motion wherever there was little rain. v2 matches every
consecutive pair and the whole 90-minute sequence (7 composites), weights each estimate by how much
echo it saw, and where echoes are sparse blends towards the steering-level wind
(850-500 hPa mean) from TCM V5's UKV environment. A cell that pops up in a previously
dry area therefore moves with the flow from its first frame.

EXTRAPOLATION WITHOUT SMEARING. v1 re-interpolated the field every 5 minutes for 24 h,
and each bilinear step blurs: by T+6 h a cell was a smudge. v2 integrates backward
trajectories through the motion field (on a coarse mesh, interpolated -- the motion is
smooth on 60 km scales) and samples the ANALYSIS once per output time.

GROWTH AND DECAY. v1 decayed every convective feature at one fixed rate, which the radar
showed to be wrong (it lost to plain persistence for heavy rain from T+30 min). v2 measures
the Lagrangian intensity trend from the radar sequence itself (the analysis against the
earliest frame carried forward along the motion) and extrapolates it with a 30-minute
damping (growing cells keep growing for a while, decaying ones keep decaying), and sets
each cell's lifetime from its environment: 30 min in stable air, up to 105 min where
TCM V5's MUCAPE exceeds 800 J/kg (Wilson et al. 1998: storm lifetime scales with the
environment far more than with anything in the radar image).

PROBABILITIES FROM AN ENSEMBLE. v1 thresholded one extrapolation and widened a disc.
v2 runs 16 members with perturbed speed, direction and growth (the leading sources of
nowcast error: Germann & Zawadzki 2002; Bowler et al. 2006) for the first 6 hours, and
takes probabilities as member frequencies on a small neighbourhood.

LIGHTNING. Recency-weighted analysis (last 10 min weighted above the 20 before), and a
lightning TREND field: a rapid rise in flash rate precedes severe weather (the
'lightning jump', Schultz et al. 2009, 2011). Reported as its own layer.

No machine learning: kinematics, measured trends and documented physical limits only.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit, prange
from scipy import ndimage
from scipy.signal import fftconvolve

from .engine import motion_field, split_scales

TAU_GROWTH_MIN = 30.0          # damping of the measured growth/decay trend
TAU_LARGE_MIN = 360.0          # stratiform / organised rain memory
ENSEMBLE = 16
ENSEMBLE_HORIZON_MIN = 360
TRAJ_STRIDE = 4                # trajectories on every 4th cell, then interpolated
MAX_GROWTH_PER_MIN = 1 / 20.0  # log-rate clip: at most e-fold per 20 min
TAU_SCALE_KM = 20.0            # predictability is measured at the scale the product is used at


def clean_radar(rain, prev=None, min_cells=4):
    """Remove isolated speckle: wet areas smaller than `min_cells` that have no echo
    within ~3 km in the previous frame (a real small shower persists; speckle does not)."""
    wet = np.nan_to_num(rain) > 0.2
    lab, n = ndimage.label(wet)
    if n == 0:
        return rain
    sizes = ndimage.sum(wet, lab, index=np.arange(1, n + 1))
    small_ids = np.flatnonzero(sizes < min_cells) + 1
    if prev is not None and small_ids.size:
        near = ndimage.binary_dilation(np.nan_to_num(prev) > 0.2, iterations=2)
        seen = np.unique(lab[near & wet])
        small_ids = np.setdiff1d(small_ids, seen)
    small = np.isin(lab, small_ids)
    out = rain.copy()
    out[small] = 0.0
    return out


def motion_multi(rains, times, dx_m, steer_u=None, steer_v=None):
    """Quality-weighted motion (grid cells per second) from every consecutive radar pair
    and the full sequence, blended towards the steering wind where echoes are sparse.
    Returns (u, v, info)."""
    est = []
    pairs = [(i, i + 1) for i in range(len(rains) - 1)] + ([(0, len(rains) - 1)] if len(rains) > 2 else [])
    for a, b in pairs:
        dt = (times[b] - times[a]).total_seconds()
        if dt <= 0:
            continue
        u, v, n = motion_field(np.nan_to_num(rains[a]), np.nan_to_num(rains[b]), dx_m, dt)
        if n >= 3:
            # longer pairs see displacement more precisely; more blocks = more evidence
            est.append((u, v, n * min(dt / 300.0, 3.0)))
    wet = np.nan_to_num(rains[-1]) > 0.2
    support = ndimage.gaussian_filter(wet.astype(np.float32), 60_000 / dx_m / 2.355)
    radar_w = np.clip(support / 0.04, 0, 1)
    if est:
        W = sum(e[2] for e in est)
        u = sum(e[0] * e[2] for e in est) / W
        v = sum(e[1] * e[2] for e in est) / W
    else:
        u = np.zeros(wet.shape, np.float32)
        v = np.zeros(wet.shape, np.float32)
        radar_w = np.zeros(wet.shape, np.float32)
    info = {'pairs': len(est), 'blocks': int(sum(e[2] for e in est)) if est else 0, 'steering': False}
    if steer_u is not None and steer_v is not None:
        su = np.nan_to_num(np.asarray(steer_u, np.float32)) / dx_m
        sv = np.nan_to_num(np.asarray(steer_v, np.float32)) / dx_m
        sig = 40_000 / dx_m / 2.355
        su, sv = ndimage.gaussian_filter(su, sig), ndimage.gaussian_filter(sv, sig)
        u = radar_w * u + (1 - radar_w) * su
        v = radar_w * v + (1 - radar_w) * sv
        info['steering'] = True
        info['radar_motion_fraction'] = round(float(radar_w.mean()), 3)
    return u.astype(np.float32), v.astype(np.float32), info


@njit(parallel=True, cache=True)
def _sample_stack(stack, dy, dx, s):
    """Every field in `stack` (nf, ny, nx) at its departure points, in one pass: the coarse
    displacement mesh (every s-th cell) is interpolated bilinearly to each cell, and the
    fields are sampled bilinearly there (zero outside the domain)."""
    nf, ny, nx = stack.shape
    cy, cx = dy.shape
    out = np.zeros((nf, ny, nx), np.float32)
    for i in prange(ny):
        fi = i / s
        i0 = min(int(fi), cy - 2)
        wi = fi - i0
        for j in range(nx):
            fj = j / s
            j0 = min(int(fj), cx - 2)
            wj = fj - j0
            a, b = (1 - wi) * (1 - wj), (1 - wi) * wj
            c, d = wi * (1 - wj), wi * wj
            y = i + a * dy[i0, j0] + b * dy[i0, j0 + 1] + c * dy[i0 + 1, j0] + d * dy[i0 + 1, j0 + 1]
            x = j + a * dx[i0, j0] + b * dx[i0, j0 + 1] + c * dx[i0 + 1, j0] + d * dx[i0 + 1, j0 + 1]
            if y < 0 or x < 0 or y > ny - 1 or x > nx - 1:
                continue
            y0, x0 = int(y), int(x)
            y1, x1 = min(y0 + 1, ny - 1), min(x0 + 1, nx - 1)
            fy, fx = y - y0, x - x0
            for k in range(nf):
                out[k, i, j] = ((1 - fy) * ((1 - fx) * stack[k, y0, x0] + fx * stack[k, y0, x1])
                                + fy * ((1 - fx) * stack[k, y1, x0] + fx * stack[k, y1, x1]))
    return out


class Trajectories:
    """Backward trajectories through a steady motion field, continued lead by lead: the
    departure point after t + dt is the departure point of the departure point after t
    (steady flow), so each output time costs one more short integration, not a restart.
    Integrated on a coarse mesh (midpoint rule, 5-minute steps); `advance_to` returns the
    coarse displacements, which _sample_stack interpolates to every cell -- the motion is
    smooth on 60 km scales."""

    def __init__(self, u, v, step_min=5.0):
        self.u, self.v = u, v
        self.ny, self.nx = u.shape
        s = TRAJ_STRIDE
        self.yc, self.xc = np.mgrid[0:self.ny:s, 0:self.nx:s].astype(np.float32)
        self.py, self.px = self.yc.copy(), self.xc.copy()
        self.step = step_min
        self.t = 0.0

    def advance_to(self, minutes):
        while self.t + 1e-6 < minutes:
            dtm = min(self.step, minutes - self.t)
            dt = dtm * 60.0
            u, v, py, px = self.u, self.v, self.py, self.px
            uu = ndimage.map_coordinates(u, [py, px], order=1, mode='nearest')
            vv = ndimage.map_coordinates(v, [py, px], order=1, mode='nearest')
            my, mx = py - 0.5 * vv * dt, px - 0.5 * uu * dt
            uu = ndimage.map_coordinates(u, [my, mx], order=1, mode='nearest')
            vv = ndimage.map_coordinates(v, [my, mx], order=1, mode='nearest')
            self.py, self.px = py - vv * dt, px - uu * dt
            self.t += dtm
        return (self.py - self.yc).astype(np.float64), (self.px - self.xc).astype(np.float64)


def sample(stack, disp):
    """Fields (nf, ny, nx) at the departure points of displacement `disp`."""
    return _sample_stack(np.ascontiguousarray(stack, np.float32), disp[0], disp[1], float(TRAJ_STRIDE))


def advance(field, u, v, minutes):
    """Carry a field forward `minutes` along the motion (single sampling)."""
    if minutes <= 0:
        return field
    return sample(np.nan_to_num(field)[None], Trajectories(u, v).advance_to(minutes))[0]


def growth_and_memory(rains, times, u, v, dx_m):
    """Lagrangian log-intensity trend (per minute, smoothed on 10 km) over the last ~30 min,
    and today's predictability time tau (minutes): the radar sequence forecasts itself --
    the earliest frame carried along the motion to the newest -- and its FSS (1 mm/h,
    TAU_SCALE_KM neighbourhood) is read as exp(-span / tau). That is the same score, at the
    same scale, as the UKV skill it is weighed against in blend_weight."""
    rN = np.nan_to_num(rains[-1])
    span = (times[-1] - times[0]).total_seconds() / 60.0
    if span <= 0:
        return np.zeros_like(rN), 120.0
    k = next((i for i, t in enumerate(times) if (times[-1] - t).total_seconds() <= 30 * 60), len(times) - 1)
    k = min(k, len(times) - 2)
    span_g = (times[-1] - times[k]).total_seconds() / 60.0
    carried = advance(np.nan_to_num(rains[k]), u, v, span_g)
    a, b = np.log1p(carried), np.log1p(rN)
    both = (carried > 0.2) | (rN > 0.2)
    g = np.where(both, (b - a) / span_g, 0.0)
    g = ndimage.gaussian_filter(g, 10_000 / dx_m / 2.355)
    g = np.clip(g, -MAX_GROWTH_PER_MIN, MAX_GROWTH_PER_MIN).astype(np.float32)
    seen = np.isfinite(rains[0]) & np.isfinite(rains[-1])
    f = fss(np.where(seen, advance(np.nan_to_num(rains[0]), u, v, span), 0), np.where(seen, rN, 0), 1.0,
            max(3, int(round(TAU_SCALE_KM * 1000 / dx_m))))
    if f is None:
        return g, 120.0
    f = min(max(f, 0.05), 0.98)
    return g, float(np.clip(-span / math.log(f), 30.0, 360.0))


def lifetimes(mu_cape):
    """Convective feature and lightning lifetimes (minutes) from the environment."""
    if mu_cape is None:
        return 45.0, 40.0
    s = np.clip((np.nan_to_num(mu_cape) - 50.0) / 750.0, 0, 1).astype(np.float32)
    return 30.0 + 75.0 * s, 25.0 + 50.0 * s


def nowcast(rain0, light0, u, v, g, tau_small, tau_light, dx_m, leads_min, seed=0, extra=None):
    """Yield (lead, control rain, control lightning, member list or None, carried extras)
    for each lead. Members (rain, lightning) are produced up to ENSEMBLE_HORIZON_MIN.
    tau_small / tau_light may be fields: they are read at each trajectory's departure
    point, so a storm keeps the lifetime of the air it formed in. `extra` = {name: (field,
    e-folding minutes)} is carried along the control trajectories too."""
    large, small = split_scales(np.nan_to_num(rain0), dx_m)
    tau_small = np.broadcast_to(np.asarray(tau_small, np.float32), rain0.shape)
    tau_light = np.broadcast_to(np.asarray(tau_light, np.float32), rain0.shape)
    extra = extra or {}
    rng = np.random.default_rng(seed)
    members = [(1.0, 0.0, 0.0)] + [(float(1 + 0.12 * rng.standard_normal()),
                                     float(np.deg2rad(10.0) * rng.standard_normal()),
                                     float(0.5 * rng.standard_normal())) for _ in range(ENSEMBLE - 1)]
    stack = np.stack([np.nan_to_num(a).astype(np.float32) for a in
                      (large, small, g, tau_small, tau_light, light0, *[f for f, _ in extra.values()])])
    trajs = []
    for spd, rot, _ in members:
        c, s_ = math.cos(rot), math.sin(rot)
        trajs.append(Trajectories((spd * (c * u - s_ * v)).astype(np.float32), (spd * (s_ * u + c * v)).astype(np.float32)))
    for lead in leads_min:
        if lead == 0:
            yield 0, np.clip(large + small, 0, None), light0, None, {k: f for k, (f, _) in extra.items()}
            continue
        out_members = []
        n_mem = len(members) if lead <= ENSEMBLE_HORIZON_MIN else 1
        for k in range(n_mem):
            gper = members[k][2]
            X = sample(stack if k == 0 else stack[:6], trajs[k].advance_to(lead))
            # No blanket decay inside the ensemble window: verified against the radar on 19 Oct
            # 2026 (7 inits), decaying the cells cost up to 0.27 FSS at 4 mm/h by T+2 h and
            # lost to plain persistence, while carrying them with the measured growth beat
            # persistence at every lead and threshold. Loss of predictability is carried by the
            # ensemble spread and the hand-over to UKV instead. Beyond it (nowcast-only
            # fallback, no UKV) the field fades on the storm lifetimes.
            over = max(0.0, lead - ENSEMBLE_HORIZON_MIN)
            L = X[0] * math.exp(-over / TAU_LARGE_MIN)
            gg = X[2] * (1.0 + gper)
            grow = np.clip(np.exp(gg * TAU_GROWTH_MIN * (1 - math.exp(-lead / TAU_GROWTH_MIN))), 0.2, 4.0)
            S = X[1] * np.exp(-over / np.maximum(X[3], 10.0)) if over else X[1]
            S = np.where(S > 0, S * grow, S)               # growth acts on the cells, not on the gaps
            R = np.clip(L + S, 0, None)
            Lt = X[5] * np.clip(grow, 0.5, 2.0) * np.exp(-lead / np.maximum(X[4], 10.0))
            out_members.append((R.astype(np.float32), Lt.astype(np.float32)))
            if k == 0:
                carried = {n: (X[6 + i] * math.exp(-lead / tau)).astype(np.float32)
                           for i, (n, (_, tau)) in enumerate(extra.items())}
        R0, L0 = out_members[0]
        yield lead, R0, L0, (out_members if n_mem > 1 else None), carried


def probabilities(members, control_rain, control_light, lead_min, dx_m, speed_ms):
    """Neighbourhood member frequencies (ensemble), or a widening neighbourhood on the
    control beyond the ensemble horizon."""
    if members:
        r_km = 3.0 + 0.02 * lead_min
    else:
        r_km = 3 + 0.08 * lead_min * (0.3 + speed_ms / 15)
    r = max(1, int(r_km * 1000 / dx_m))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    fp = (xx * xx + yy * yy) <= r * r
    k = (fp / fp.sum()).astype(np.float32)

    def freq(test):
        # the neighbourhood mean is linear, so average the members first, convolve once
        ms = members or [(control_rain, control_light)]
        acc = np.zeros(control_rain.shape, np.float32)
        for m in ms:
            acc += test(m)
        return np.clip(fftconvolve(acc / len(ms), k, mode='same'), 0, 1).astype(np.float32)
    p_rain = freq(lambda m: m[0] >= 1.0)
    p_heavy = freq(lambda m: m[0] >= 10.0)
    p_light = np.clip(freq(lambda m: m[1] > 0.01) * 1.3, 0, 1)
    core = freq(lambda m: m[0] >= 25.0)
    p_thunder = np.clip(np.maximum(p_light, 0.5 * core), 0, 1)
    return {'p_rain': p_rain, 'p_heavy_rain': p_heavy, 'p_lightning': p_light, 'p_thunder': p_thunder,
            'neighbourhood_km': r_km}


def blend_weight(lead_min, tau_now, nwp_skill):
    """Nowcast weight in the blend with TCM V5/UKV -- the STEPS skill-based weights
    (Bowler et al. 2006, eq. 11): each component is weighted by r^2 / (1 - r^2) of its
    correlation with the truth. The nowcast's correlation decays as r = exp(-t / tau),
    tau measured from today's radar sequence; UKV's is s, its skill against the radar at
    the analysis time. The hand-over happens where r falls to s -- early on a day UKV
    has right, late on a day it has wrong -- not at a fixed lead."""
    r2 = math.exp(-2.0 * lead_min / max(tau_now, 1.0))
    s2 = min(max(nwp_skill, 0.15), 0.9) ** 2
    if r2 >= 1.0:
        return 1.0
    return float(r2 * (1 - s2) / (r2 * (1 - s2) + s2 * (1 - r2)))


def fss(f, o, thr, n):
    bf, bo = (np.nan_to_num(f) >= thr).astype(np.float32), (np.nan_to_num(o) >= thr).astype(np.float32)
    pf, po = ndimage.uniform_filter(bf, n), ndimage.uniform_filter(bo, n)
    den = np.mean(pf ** 2) + np.mean(po ** 2)
    return None if den == 0 else float(1 - np.mean((pf - po) ** 2) / den)


def lightning_analysis(strikes, init, grid, transformer):
    """Recency-weighted flash density (per km2 per h) and its trend (recent - earlier)."""
    recent = np.zeros(grid.shape, np.float32)
    earlier = np.zeros(grid.shape, np.float32)
    cell_km2 = (grid.dx / 1000) ** 2
    for t, la, lo in strikes:
        age = (init - t).total_seconds() / 60
        if not (0 <= age <= 30):
            continue
        x, y = transformer.transform(lo, la)
        ix, iy = int((x - grid.x0) // grid.dx), int((y - grid.y0) // grid.dx)
        if 0 <= ix < grid.nx and 0 <= iy < grid.ny:
            if age <= 10:
                recent[iy, ix] += 6.0 / cell_km2       # per hour
            else:
                earlier[iy, ix] += 3.0 / cell_km2
    sig = 2.0
    recent, earlier = ndimage.gaussian_filter(recent, sig), ndimage.gaussian_filter(earlier, sig)
    density = 0.6 * recent + 0.4 * earlier
    trend = ndimage.gaussian_filter(recent - earlier, 8_000 / grid.dx / 2.355)
    return density.astype(np.float32), trend.astype(np.float32)
