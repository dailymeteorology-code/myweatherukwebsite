"""One TCM NOVA frame on the TCM V5 engine.

For every model with a vertical profile at the valid time:
    2 km cube (cube.py) -> V5 Stage 4 (stage4.py, compiled, bit-identical to V5)
    -> shared features -> the twelve V5 engines -> V5 per-source forecast
then V5 Stage 6-7 across the models (linear pooling with the NOVA-V5 weights, hazards,
nesting, confidence, uncertainty), and the published NOVA fields.

`fixes=True` applies NOVA's declared corrections to V5 (each is listed in FIXES and in
the run manifest); `fixes=False` is V5 exactly, which is what `verify.py` holds us to.
"""
from __future__ import annotations

import time

import numpy as np

from ..config import MODELS
from .. import v5_blend as VB
from . import cube as C, engines as EV, features as FV, stage4 as S4, stages as SV
from app.spatial import boundaries as BND  # noqa: E402

FIXES = {
    'lcl_feature': "V5's regime and tornado engines read a feature named 'lcl' that V5 never builds "
                   "(it is called cloud_base), so their cloud-base factor was always missing. NOVA reads it.",
    'heights_agl': "V5 Stage 4 reports LCL/LFC/EL, freezing level and wet-bulb zero as heights above sea "
                   "level while its transfers are anchored above ground; NOVA subtracts the 2 km terrain.",
    'column_levels': "V5's gridded path never records how many levels a column has, so the entrainment "
                     "engine always assumed fewer than 8 and halved its confidence. NOVA passes the real count.",
    'pbl_depth': "AWS carries no boundary-layer depth, so V5's 'cloud base reachable' test never ran. NOVA "
                 "derives it by the parcel method (Holzworth 1964).",
    'hodograph': "AWS carries height-level winds only for UKV; NOVA builds V5's hodograph for every model "
                 "from its pressure-level winds over the 2 km terrain, so shear and helicity exist for all.",
}
PROFILE_SOURCES = ('ukv', 'icon_d2', 'icon_eu', 'ifs', 'aifs', 'gfs')


def run_source(key, frame, terr, *, run, fh, valid_time, lon, fixes=True):
    """The V5 chain for one model on the 2 km grid. Returns a dict of arrays, or None."""
    t0 = time.time()
    cube = C.build(frame, terr, model=key, run=run, forecast_hour=fh)
    gp = S4.compute_grid(cube)
    if gp is None:
        return None
    t4 = time.time() - t0
    sfc = frame['sfc']
    forcing = {}
    if 'u10' in sfc and 'v10' in sfc:
        forcing['convergence'] = BND.convergence(np.asarray(sfc['u10'], 'float64'),
                                                 np.asarray(sfc['v10'], 'float64'), 2000.0)
    h = terr['h_mean']
    F = FV.build(gp, elevation=h, forcing=forcing)
    if fixes:
        for k in ('cloud_base', 'sub_cloud_depth', 'equilibrium_level', 'freezing_level', 'wet_bulb_zero'):
            F[k] = F[k] - h
        F['lcl_above_pbl'] = F['cloud_base'] - F['pbl_depth']
    hour = FV.local_solar_hour(valid_time, lon)
    levels = int(np.count_nonzero(np.isfinite(frame['pl']['t']).reshape(frame['pl']['t'].shape[0], -1).any(1))) if fixes else 0
    R = EV.run_all(F, hour, levels=levels, fixes=fixes)
    sf = SV.source_forecast(R)
    valid = np.asarray(frame.get('valid', np.ones(h.shape, bool)), bool)
    sf['probability'] = np.where(valid, sf['probability'], np.nan)
    v = lambda n: gp.value(n)   # noqa: E731
    lcl, lfc, el = v('lcl'), v('lfc'), v('el')
    if fixes:
        lcl, lfc, el = lcl - h, lfc - h, el - h
    env = {'mu_cape': v('mucape'), 'sb_cape': v('sbcape'), 'ml_cape': v('mlcape'), 'ml_cin': -np.abs(v('mlcin')),
           'mu_cin': -np.abs(v('mucin')), 'dcape': v('dcape'), 'ml_lcl_z': lcl, 'mu_lfc_z': lfc, 'mu_el_z': el,
           'freezing_level': F['freezing_level'], 'wbz': F['wet_bulb_zero'], 'pw': v('precipitable_water'),
           'lapse_700_500': v('lr_700_500'), 'shear_0_1km': v('shear_0_1km'), 'shear_0_6km': v('shear_0_6km'),
           'srh_0_1km': v('srh_0_1km'), 'srh_0_3km': v('srh_0_3km'), 'pbl_height': F['pbl_depth']}
    env = {k: np.where(valid, a, np.nan) for k, a in env.items() if a is not None}
    return {'sf': sf, 'env': env, 'R': R, 'valid': valid, 'seconds': round(time.time() - t0, 1), 'stage4_s': round(t4, 1)}


def weights_for(lead, sources, cycles):
    """NOVA-V5 weights: continuous-lead baseline x resolution credit x cycle freshness x
    verified skill, family-capped (v5_blend.blend_weights). Scalar per model; cells a model
    does not cover drop out inside the aggregation and the rest renormalise there."""
    w, prov = VB.blend_weights(lead, list(sources), cycles, hazard='environment', convective=True)
    return w, prov


def _init_worker(threads):
    import logging
    import warnings
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    try:
        import numba
        numba.set_num_threads(max(1, threads))
    except Exception:
        pass


def _task(args):
    key, f, h_mean, cycle, fh, valid_time, lon, fixes = args
    try:
        res = run_source(key, f, {'h_mean': h_mean}, run=cycle, fh=fh, valid_time=valid_time, lon=lon, fixes=fixes)
    except Exception as e:                           # one model failing must not lose the frame
        return key, None, repr(e)
    if res is None:
        return key, None, 'no usable columns'
    res.pop('R', None)                               # engine internals stay in the worker
    return key, res, ''


_POOL = {}


def pool(workers):
    """A persistent process pool: Numba kernels compile once per worker, not per frame."""
    import concurrent.futures as cf
    import os
    if _POOL.get('n') != workers:
        if _POOL.get('ex'):
            _POOL['ex'].shutdown()
        threads = max(1, (os.cpu_count() or 2) // workers)
        _POOL.update(n=workers, ex=cf.ProcessPoolExecutor(workers, initializer=_init_worker, initargs=(threads,)))
    return _POOL['ex']


def ensemble_spread(got):
    """Within-model spread from the ensembles (IFS ENS, AIFS ENS, GEFS, ICON-EPS). They
    publish members' CAPE and precipitation but no profiles, so they cannot run the V5
    engines; their members still say how uncertain a convective outcome is. Per system,
    the member fraction f with a convective signal (precipitation >= 0.5 mm/h with CAPE
    >= 150 J/kg; precipitation >= 1 mm/h where CAPE is not published) has Bernoulli
    spread sqrt(f(1-f)), halved onto V5's probability-spread scale (0 .. 0.25)."""
    spreads, used = [], []
    for k, g in got.items():
        m = g.get('members') if g else None
        if not m or 'precip' not in m:
            continue
        pr = np.asarray(m['precip'])
        cape = m.get('cape')
        ev = (pr >= 0.5) & (np.asarray(cape) >= 150) if cape is not None else (pr >= 1.0)
        f = ev.mean(0)
        sp = 0.5 * np.sqrt(f * (1 - f))
        spreads.append(np.where(np.asarray(g.get('valid', True), bool), sp, np.nan))
        used.append(k)
    if not spreads:
        return None, []
    st = np.stack(spreads)
    ok = np.isfinite(st)
    return np.where(ok.any(0), np.where(ok, st, 0).sum(0) / np.maximum(ok.sum(0), 1), np.nan), used


def run_frame(got, lead, cycles, terr, grid_v5, *, run, valid_time, fixes=True, log=print, workers=None):
    """got: Blender.at(vt). Returns (fields on the V5 grid, meta) or (None, reason).
    The models run side by side in `workers` processes (default: one per two cores)."""
    import os
    lon, _ = grid_v5.lonlat
    per = {}
    tasks = []
    for key in PROFILE_SOURCES:
        f = got.get(key)
        if not f or 'pl' not in f:
            continue
        fh = int(round((valid_time - cycles[key]).total_seconds() / 3600))
        tasks.append((key, f, terr['h_mean'], cycles[key], fh, valid_time, lon, fixes))
    workers = workers if workers is not None else max(1, min(len(tasks), (os.cpu_count() or 2) // 2))
    results = map(_task, tasks) if workers <= 1 else pool(workers).map(_task, tasks)
    for key, res, err in results:
        if res is None:
            log(f'  {key}: V5 chain failed: {err}')
            continue
        per[key] = res
        log(f'  {key}: V5 chain {res["seconds"]}s (Stage 4 {res["stage4_s"]}s)')
    if not per:
        return None, 'no model with a vertical profile at this time'
    w, prov = weights_for(lead, per, cycles)
    calib = 'uncalibrated'
    within, ens_used = ensemble_spread(got)
    agg = SV.aggregate([(k, None, r['sf']) for k, r in per.items()], w, lead_h=lead, calibration=calib,
                       within_extra=within)
    out = {'p_thunder': agg['probability'], 'p_thunder_uncal': agg['probability'],
           'confidence': agg['confidence'], 'uncertainty': agg['uncertainty']}
    names = {'lightning': 'p_lightning', 'hail': 'p_hail', 'severe_hail': 'p_hail_sig', 'severe_wind': 'p_wind_damaging',
             'downburst': 'p_downburst', 'heavy_rainfall': 'p_heavy_rain', 'tornado_environment': 'p_tornado_env'}
    for hz, k in names.items():
        out[k] = agg['hazards'][hz]['probability']
    out['p_severe'] = np.fmax.reduce([out['p_hail_sig'], out['p_wind_damaging'], out['p_tornado_env']])
    # pooled realisation (the initiation stage) with the same weights, for the initiation layer
    num = sum(agg['applied'][k] * np.nan_to_num(r['sf']['real_p']) for k, r in per.items())
    out['p_initiation'] = np.where(np.isfinite(agg['probability']), num, np.nan)
    # environment fields: the same applied weights, per cell
    keys = set().union(*[r['env'].keys() for r in per.values()])
    for name in keys:
        num = np.zeros(terr['h_mean'].shape)
        den = np.zeros(terr['h_mean'].shape)
        for k, r in per.items():
            a = r['env'].get(name)
            if a is None:
                continue
            ok = np.isfinite(a)
            wk = agg['applied'][k]
            num += np.where(ok, wk * a, 0)
            den += np.where(ok, wk, 0)
        out[name] = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
    # model fields every source carries (incl. surface-only models): same weights where present
    for name, src, f in (('t2', 't2', 1.0), ('td2', 'td2', 1.0), ('u10', 'u10', 1.0), ('v10', 'v10', 1.0),
                         ('mslp', 'mslp', 0.01), ('precip', 'precip', 1.0), ('tcc', 'tcc', None), ('gust_max', 'gust', 1.0)):
        num = np.zeros(terr['h_mean'].shape)
        den = np.zeros(terr['h_mean'].shape)
        for k, g in got.items():
            a = g.get('sfc', {}).get(src)
            if a is None:
                continue
            a = np.asarray(a, 'float64')
            if name == 'tcc' and np.nanmax(a) > 1.5:
                a = a / 100.0
            wk = agg['applied'].get(k, 0.05 * (MODELS.get(k, {}).get('kind') == 'det'))
            wk = np.where(np.isfinite(a), wk, 0)
            num += wk * np.nan_to_num(a)
            den += wk
        if np.any(den > 0):
            out[name] = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan) * (f or 1.0)
    # per-model V5 probability and precipitation, for verification -> skill -> weights
    out['_sources'] = {k: {'p_thunder': r['sf']['probability'], 'precip': got[k].get('sfc', {}).get('precip')}
                       for k, r in per.items()}
    if 'ukv' in got and 'lightning' in got['ukv'].get('sfc', {}):
        out['flash_density'] = np.where(got['ukv']['valid'], got['ukv']['sfc']['lightning'], np.nan)
    meta = {'sources': sorted(per), 'surface_only': sorted(k for k in got if k not in per and k not in ens_used),
            'ensembles_for_spread': sorted(ens_used),
            'weights_environment': {'final': {k: round(float(np.nanmean(np.where(agg['applied'][k] > 0, agg['applied'][k], np.nan))) * 100, 2)
                                              for k in per if np.any(agg['applied'][k] > 0)},
                                    'baseline': prov.get('baseline', {}), 'lead_h': lead},
            'source_seconds': {k: r['seconds'] for k, r in per.items()},
            'engine': 'TCM V5 (vectorised, verified against V5 per cell)', 'fixes': list(FIXES) if fixes else []}
    return out, meta
