"""Every model, downscaled to the 2 km V5 grid, blended with the NOVA-V5 weighting, then
handed to TCM V5 as its input state.

Downscaling (per source, per frame) is NOVA's deterministic chain run directly onto V5's
2 km LAEA grid: bilinear remap of each model's native grid, log-p vertical interpolation
inside the model's own levels only, grid-relative winds, and the terrain height correction
of screen temperature/dew point against the 90 m Copernicus DEM aggregated to 2 km.

The weighting (reworked for V5, `blend_weights`):
  1  baseline table, interpolated CONTINUOUSLY in lead time (no jumps at 6/24/72 h)
  2  resolution credit for convective-scale fields: (2 km / model km) ** beta, beta
     decaying from 0.5 at T+0 to 0 by T+72 (fine models earn their keep early, not late)
  3  freshness: an older cycle loses weight, exp(-age / 36 h) relative to the newest
  4  verified skill (FSS vs radar/lightning, shrunk towards baseline by record length)
  5  hazard emphasis, then family caps (no single centre above its cap)
  6  per cell: sources that do not cover the cell drop out; then a CONSENSUS step
     down-weights a source by exp(-(z/2)^2) where it sits z robust-sigmas from the blend
     (outliers are damped, not removed; switched off where fewer than 3 sources)
"""
from __future__ import annotations

import concurrent.futures as cf
import math
from datetime import timedelta

import numpy as np

from . import terrain
from . import thermo as th
from . import weights as W
from .config import BASELINE, GRIDS, LEVELS, MODELS, WINDOWS
from .grid import Grid
from .io_aws import log
from .main_run import NATIVE_STEP, SourceCache, wmean
from .sources import READERS
from . import v5_bridge as B

GRID_NAME = 'gb_v5laea2km'           # 'gb' prefix: shipped with the other terrain in nova-static
GRIDS.setdefault(GRID_NAME, {'crs': B.TCM_PROJECTION, 'x0': B.V5_GRID.x0, 'y0': B.V5_GRID.y0,
                             'dx': B.V5_GRID.spacing_m, 'nx': B.V5_GRID.nx, 'ny': B.V5_GRID.ny})
CONVECTIVE = ('pl', 'precip', 'td2', 'u10', 'v10', 'gust')     # fields where resolution matters


def grid():
    return Grid.get(GRID_NAME)


def _baseline(m, lead):
    """Linear in lead between the centres of the lead windows."""
    mids = [(a + b) / 2 for a, b in WINDOWS]
    vals = BASELINE[m]
    if lead <= mids[0]:
        return vals[0] / 100
    for i in range(len(mids) - 1):
        if lead <= mids[i + 1]:
            f = (lead - mids[i]) / (mids[i + 1] - mids[i])
            return (vals[i] * (1 - f) + vals[i + 1] * f) / 100
    return vals[-1] / 100


def blend_weights(lead, available, cycles, hazard='environment', convective=True):
    """Scalar weights over models, with full provenance for the manifest."""
    w = {m: _baseline(m, lead) for m in available if BASELINE.get(m)}
    prov = {'lead_h': lead, 'baseline': {m: round(v * 100, 2) for m, v in w.items()}}
    if convective:
        beta = 0.5 * max(0.0, 1 - lead / 72)
        for m in w:
            w[m] *= (2.0 / max(MODELS[m]['res_km'], 2.0)) ** beta
        prov['resolution_beta'] = round(beta, 3)
    if cycles:
        newest = max(cycles.values())
        for m in w:
            if m in cycles:
                w[m] *= math.exp(-((newest - cycles[m]).total_seconds() / 3600) / 36)
    s = sum(w.values()) or 1
    w = {m: v / s for m, v in w.items()}
    # skill, emphasis and caps: reuse the NOVA machinery on the new prior
    skill_w, sprov = W.dynamic(lead, list(w), hazard)
    if skill_w:
        base_w = {m: _baseline(m, lead) for m in w}
        bs = sum(base_w.values()) or 1
        # dynamic() returns baseline x skill x emphasis x caps; apply its ratio to our prior
        w = {m: w[m] * skill_w.get(m, 0) / (base_w[m] / bs) for m in w if base_w[m] > 0}
    w = W.cap_families({m: v for m, v in w.items() if v > 0})
    prov['skill_alpha'] = sprov.get('skill_alpha', {})
    prov['final'] = {m: round(v * 100, 2) for m, v in w.items()}
    return w, prov


def consensus(items, shape):
    """items [(w_cell, value)] -> damped-outlier weighted mean."""
    first = wmean(items, shape)
    if len(items) < 3:
        return first
    dev = np.stack([np.abs(a - first) for _, a in items])
    sig = 1.4826 * np.nanmedian(dev, axis=0) + 1e-6
    out = [(w * np.exp(-np.nan_to_num(d / sig / 2) ** 2), a) for (w, a), d in zip(items, dev)]
    return wmean(out, shape)


class Blender:
    def __init__(self, init, horizon_h):
        self.g = grid()
        self.terr = terrain.load(GRID_NAME)
        readers = {k: READERS[k]() for k in READERS}
        self.cycles = {}
        for k, r in readers.items():
            rr = r.find_run(init, need_lead_h=min(horizon_h, 54)) if k in ('ukv', 'icon_eu') else None
            rr = rr or r.find_run(init)
            if rr:
                self.cycles[k] = rr
        log('v5 blend cycles:', {k: f'{v:%d %HZ}' for k, v in self.cycles.items()})
        self.caches = {k: SourceCache(k, readers[k], self.cycles[k], self.g, self.terr) for k in self.cycles}

    def at(self, vt):
        with cf.ThreadPoolExecutor(len(self.caches) or 1) as ex:
            got = dict(zip(self.caches, ex.map(lambda c: c.at(vt), self.caches.values())))
        return {k: v for k, v in got.items() if v}


def blend(got, lead, cycles, g, terr):
    """Blended state on the V5 grid: prof (LEVELS) + surface + per-frame weight provenance."""
    shape = g.shape
    valid = {k: v['valid'] for k, v in got.items()}
    prof_src = [k for k, v in got.items() if 'pl' in v]
    if not prof_src:
        return None
    w_pl, prov_pl = blend_weights(lead, prof_src, cycles)
    w_sfc, prov_sfc = blend_weights(lead, [k for k, v in got.items() if v.get('sfc')], cycles, convective=False)
    w_cv, _ = blend_weights(lead, [k for k, v in got.items() if v.get('sfc')], cycles)
    pr_src = [k for k, v in got.items() if 'precip' in v.get('sfc', {}) or 'members' in v]
    w_pr, prov_pr = blend_weights(lead, pr_src, cycles, hazard='precip')
    cw_pl, cw_sfc, cw_cv, cw_pr = (W.cell_weights(w, valid) for w in (w_pl, w_sfc, w_cv, w_pr))
    prof = {}
    for var in ('t', 'q', 'u', 'v', 'z'):
        items = [(cw_pl[k][None], got[k]['pl'][var]) for k in cw_pl if var in got[k]['pl']]
        if items:
            prof[var] = consensus(items, (len(LEVELS),) + shape) if var in ('t', 'q') else wmean(items, (len(LEVELS),) + shape)
    sfc = {}
    for var in ('t2', 'td2', 'u10', 'v10', 'gust', 'mslp', 'tcc', 'cbh'):
        cw = cw_cv if var in CONVECTIVE else cw_sfc
        items = [(cw[k], got[k]['sfc'][var]) for k in cw if var in got[k].get('sfc', {})]
        if items:
            sfc[var] = consensus(items, shape)
    items = [(cw_pr[k], got[k]['sfc']['precip']) for k in cw_pr if 'precip' in got[k].get('sfc', {})]
    items += [(cw_pr[k], np.nanmean(got[k]['members']['precip'], 0)) for k in cw_pr if 'members' in got[k]]
    sfc['precip'] = consensus(items, shape) if items else np.zeros(shape, np.float32)
    for var in ('lightning', 'hail', 'cape_mu_src', 'cape_sb_src', 'frz_agl'):      # UKV-only explicit fields
        if 'ukv' in got and var in got['ukv']['sfc']:
            sfc[var] = np.where(valid['ukv'], got['ukv']['sfc'][var], np.nan)
    # surface pressure on the 2 km terrain from the blended 3-D state (hypsometric, as Main Run)
    h = terr['h_mean']
    z = prof['z']
    lnp = np.log(np.asarray(LEVELS, float))[:, None, None] * np.ones_like(z)
    ps = np.full(shape, np.nan, np.float32)
    for k in range(len(LEVELS) - 1):
        z0, z1 = z[k], z[k + 1]
        hit = np.isnan(ps) & np.isfinite(z0) & np.isfinite(z1) & (z0 <= h) & (z1 > h)
        f = np.where(hit, (h - z0) / np.where(z1 == z0, 1, z1 - z0), 0)
        ps = np.where(hit, np.exp(lnp[k] + f * (lnp[k + 1] - lnp[k])), ps)
    below = np.isnan(ps) & np.isfinite(z[0]) & (h < z[0])
    ps = np.where(below, 1000 * np.exp(9.80665 * (z[0] - h) / (287.04 * np.nan_to_num(prof['t'][0], nan=285))), ps)
    if 'mslp' in sfc:
        ps = np.where(np.isnan(ps), sfc['mslp'] / 100 * np.exp(-9.80665 * h / (287.04 * 285)), ps)
    sfc['ps_hpa'] = ps
    meta = {'sources': sorted(got), 'weights_environment': prov_pl, 'weights_surface': prov_sfc.get('final'),
            'weights_precip': prov_pr.get('final'),
            'ensembles': sorted(k for k, v in got.items() if 'members' in v)}
    return prof, sfc, meta


def write_store(run, fh, prof, sfc, terr, model_run_label):
    """The blended state, in V5's own field names and units, into the V5 store."""
    w = B._Writer(run, fh)
    src = f'nova-blend:{model_run_label}'
    T, q = prof['t'], prof['q']
    P = np.asarray(LEVELS, float)[:, None, None]
    e = q * P / (0.622 + 0.378 * q)
    rh = np.clip(100 * e / th.es_hpa(T), 0, 100)
    ws = np.hypot(prof['u'], prof['v'])
    for i, p in enumerate(LEVELS):
        for stem, arr, units in (('temperature', T, 'K'), ('relative_humidity', rh, '%'),
                                 ('geopotential_height', prof['z'], 'gpm'), ('u_wind', prof['u'], 'm/s'),
                                 ('v_wind', prof['v'], 'm/s'), ('wind_speed', ws, 'm/s')):
            w.put(f'{stem}_{p}', arr[i], units, 'isobaric', float(p), src)
    t2 = sfc.get('t2')
    td2 = np.minimum(sfc['td2'], t2) if 'td2' in sfc and t2 is not None else None
    put = lambda n, a, u, lt='surface', lv=None: w.put(n, a, u, lt, lv, src)      # noqa: E731
    put('pressure_surface', sfc['ps_hpa'] * 100, 'Pa')
    if 'mslp' in sfc:
        put('pressure_msl', sfc['mslp'], 'Pa', 'meansea')
    if t2 is not None:
        put('temperature_2m', t2, 'K', 'agl', 1.5)
    if td2 is not None:
        put('dewpoint_2m', td2, 'K', 'agl', 1.5)
        put('relative_humidity_2m', np.clip(100 * th.es_hpa(td2) / th.es_hpa(t2), 0, 100), '%', 'agl', 1.5)
    if 'u10' in sfc and 'v10' in sfc:
        put('u_wind_10m', sfc['u10'], 'm/s', 'agl', 10.0)
        put('v_wind_10m', sfc['v10'], 'm/s', 'agl', 10.0)
        put('wind_speed_10m', np.hypot(sfc['u10'], sfc['v10']), 'm/s', 'agl', 10.0)
    put('terrain_height', terr['h_mean'], 'm')
    # The 90 m DSM puts cliffs and piers into mostly-sea 2 km cells; V5 validates that sea is
    # low, so a cell standing above 50 m counts as land.
    put('land_cover', np.where(terr['h_mean'] > 50, np.maximum(terr['land_frac'], 0.51), terr['land_frac']), '1')
    put('precip_rate', np.clip(sfc['precip'], 0, None) / 3600.0, 'kg m**-2 s**-1')
    put('precip_accum_1h', np.clip(sfc['precip'], 0, None), 'kg m**-2')
    for k, n, u in (('lightning', 'lightning_flash_density_1h', 'flashes/km2/h'), ('cape_sb_src', 'cape_surface', 'J/kg'),
                    ('cape_mu_src', 'cape_most_unstable', 'J/kg'), ('frz_agl', 'freezing_level_height', 'm')):
        if k in sfc:
            put(n, sfc[k], u)
    if 'hail' in sfc:                                       # mm per hour -> kg m-2 s-1
        put('hail_fall_rate', sfc['hail'] / 3600.0, 'kg/m2/s')
    if 'tcc' in sfc:
        tcc = sfc['tcc']
        put('total_cloud_cover', tcc * 100 if np.nanmax(tcc) <= 1.5 else tcc, '%')
    if 'gust' in sfc:
        put('wind_gust_10m', sfc['gust'], 'm/s', 'agl', 10.0)
    return w.n
