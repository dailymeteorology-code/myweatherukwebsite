"""TCM NOVA Main Run: 2 km GB grid, four cycles a day, deterministic downscaling.

    python -m nova.main_run [--init 2026-10-18T15:00] [--horizon 120]

Pipeline per valid time (docs/DOWNSCALING.md has the full rationale):
  1 validate + standardise source fields       5 bias adjustment (only with a record)
  2 horizontal remap per variable class         6 terrain-aware corrections + diagnostics
  3 vertical interpolation in log-p, no         7 physical-consistency checks
    extrapolation through the ground            8 hazards, storage, publish
  4 weighted multi-model blend (dynamic weights)

What this is NOT: a convection-permitting integration on the 2 km grid. Only UKV is a
genuine ~2 km model; everything else is remapped coarser guidance. The manifest's
`method` field says exactly that.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import math
import time
import traceback
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
from scipy import ndimage

from . import diagnostics as dg
from . import microphysics as mp
from . import hazards as hz
from . import store, terrain, verify
from . import thermo as th
from . import weights as W
from .config import ENGINE_VERSION, LEVELS, MAIN, MODELS
from .grid import Grid, earth_to_grid_wind
from .io_aws import log
from .sources import READERS

NATIVE_STEP = {'icon_d2': 1, 'icon_eu': 1, 'icon_eps': 3, 'ukv': 1, 'mo_global': 1, 'ifs': 3, 'aifs': 6, 'ifs_ens': 3, 'aifs_ens': 6, 'gfs': 1, 'gefs': 3}
RANGES = {'t': (170, 335), 'q': (0, 0.04), 'rh': (0, 110), 'u': (-150, 150), 'v': (-150, 150), 'z': (-700, 17000),
          't2': (220, 325), 'td2': (210, 310), 'precip': (0, 500), 'gust': (0, 90), 'mslp': (87000, 109000)}
STORE_FIELDS = [
    'p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_supercell', 'p_tornado_env',
    'p_heavy_rain', 'p_training', 'p_severe', 'p_mcs', 'p_initiation', 'p_ci_orographic', 'confidence', 'flash_density',
    'hail_size_max_cm', 'gust_max', 'organisation', 'intensity_class', 'precip', 'precip_accum', 'precip_3h',
    'mu_cape', 'sb_cape', 'ml_cape', 'ml_cin', 'mu_cin', 'dcape', 'ml_lcl_z', 'mu_lfc_z', 'mu_el_z', 'lifted_index',
    'k_index', 'total_totals', 'lapse_700_500', 'freezing_level', 'wbz', 'pw', 'shear_0_1km', 'shear_0_6km',
    'srh_0_1km', 'srh_0_3km', 'esrh', 'scp', 'stp', 'storm_u', 'storm_v', 't2', 'td2', 'u10', 'v10', 'mslp',
    'conv_10m', 'mfc_sfc', 'w_oro', 'upslope_wind', 'windward_exposure', 'froude', 'terrain_modulation',
    'pbl_height', 'source_disagreement', 'frontogenesis_850', 'tadv_850', 'qvec_conv_700', 'llj_speed', 'omega_700',
    'qc_path', 'qi_path', 'qr_path', 'qs_path', 'qg_path', 'qc_max_gm3', 'qi_max_gm3', 'qg_max_gm3', 'slw_max_gm3', 'slw_path',
    'droplet_re_um', 'ice_re_um', 'rain_fall_speed_max', 'charging_index', 'lpi', 'htop_con', 'hbas_con', 'tcc', 'cbh',
    'p_thunder_raw', 'p_thunder_uncal', 'p_lightning_uncal', 'mixed_phase_depth',
]


def cycle_init(now_utc=None, cycles=None):
    """Latest scheduled Main Run initialisation at or before now (Europe/London wall clock)."""
    tz = ZoneInfo('Europe/London')
    now = (now_utc or datetime.now(timezone.utc)).astimezone(tz)
    cycles = cycles or MAIN['cycles_local']
    best = None
    for dd in (0, -1):
        day = (now + timedelta(days=dd)).date()
        for c in cycles:
            h, m = map(int, c.split(':'))
            t = datetime(day.year, day.month, day.day, h, m, tzinfo=tz)
            if t <= now and (best is None or t > best):
                best = t
    return best.astimezone(timezone.utc)


class SourceCache:
    """Fetch each source's native steps once; linear interpolation in time between
    bracketing native steps (never beyond the last one)."""
    def __init__(self, key, reader, run, grid, terr):
        self.key, self.reader, self.run, self.grid, self.terr = key, reader, run, grid, terr
        self.cache = {}

    def native(self, vt):
        if vt not in self.cache:
            if len(self.cache) > 3:
                self.cache.pop(min(self.cache))
            step = NATIVE_STEP[self.key]
            try:
                f = self.reader.frame(self.run, vt, self.grid, step if step > 1 else 1)
            except Exception as e:
                log(f'{self.key} {vt:%m-%d %HZ} failed: {e}')
                f = None
            self.cache[vt] = prepare(self.key, f, self.grid, self.terr) if f else None
        return self.cache[vt]

    def at(self, vt):
        step = NATIVE_STEP[self.key]
        h = (vt - self.run).total_seconds() / 3600
        if h < 0 or h > MODELS[self.key]['max_lead_h']:
            return None
        if self.key in ('ifs', 'ifs_ens') and h > 144:
            step = 6
        lo = self.run + timedelta(hours=math.floor(h / step) * step)
        if lo == vt:
            return self.native(vt)
        hi = lo + timedelta(hours=step)
        a, b = self.native(lo), self.native(hi)
        if a is None or b is None:
            return None
        f = (vt - lo).total_seconds() / (hi - lo).total_seconds()
        return _lerp(a, b, f)


def _lerp(a, b, f):
    if isinstance(a, dict):
        return {k: _lerp(a[k], b[k], f) for k in a if k in b}
    if isinstance(a, np.ndarray) and a.dtype.kind == 'f' and a.shape == b.shape:
        return (a * (1 - f) + b * f).astype(np.float32)
    return a


def prepare(key, f, grid, terr):
    """Validate units/ranges, rotate winds to grid-relative, interpolate the profile to
    LEVELS in log-p (within the source's own range only) and apply the deterministic
    terrain height correction to screen-level temperature/dew point."""
    flags = []
    for k, (lo, hi) in RANGES.items():
        a = f.get('sfc', {}).get(k)
        if a is not None:
            bad = np.isfinite(a) & ((a < lo) | (a > hi))
            if bad.mean() > 0.01:
                flags.append(f'{k} out of range in {bad.mean():.1%} of cells — field dropped')
                f['sfc'].pop(k)
            else:
                a[bad] = np.nan
    gamma = grid.grid_convergence
    sfc = f.get('sfc', {})
    if 'u10' in sfc and 'v10' in sfc:
        sfc['u10'], sfc['v10'] = earth_to_grid_wind(sfc['u10'], sfc['v10'], gamma)
    # terrain correction: the source's orography is a smoothed version of ours at its own resolution
    res = MODELS[key]['res_km'] * 1000
    dh = terr['h_mean'] - ndimage.gaussian_filter(terr['h_mean'], max(res / grid.dx / 2, 0.5))
    if 't2' in sfc:
        sfc['t2'] = sfc['t2'] - 0.0065 * dh
    if 'td2' in sfc:
        sfc['td2'] = sfc['td2'] - 0.0018 * dh
        if 't2' in sfc:
            sfc['td2'] = np.minimum(sfc['td2'], sfc['t2'])
    pl = f.get('pl')
    if pl is not None:
        if 'q' not in pl and 'rh' in pl:
            pl['q'] = th.q_from_rh(pl['rh'], pl['t'], pl['levels'][:, None, None])
        pl['u'], pl['v'] = earth_to_grid_wind(pl['u'], pl['v'], gamma)
        f['pl'] = vertical_interp(pl)
    f['flags'] = flags
    f['state'] = 'remapped'
    return f


def vertical_interp(pl):
    src = np.asarray(pl['levels'], float)
    order = np.argsort(src)                                # ascending p for np.interp-like logic
    lp_src = np.log(src[order])
    out = {}
    for k in ('t', 'q', 'u', 'v', 'z', 'w', 'qc', 'qi', 'qr', 'qs', 'qg'):
        if k not in pl:
            continue
        a = pl[k][order]
        res = np.full((len(LEVELS),) + a.shape[1:], np.nan, np.float32)
        for i, p in enumerate(LEVELS):
            lp = math.log(p)
            if lp < lp_src[0] - 1e-6 or lp > lp_src[-1] + 1e-6:
                continue                                    # outside the source's levels: no extrapolation
            j = int(np.clip(np.searchsorted(lp_src, lp) - 1, 0, len(lp_src) - 2))
            w = (lp - lp_src[j]) / (lp_src[j + 1] - lp_src[j])
            res[i] = a[j] * (1 - w) + a[j + 1] * w
        out[k] = res
    return out


def wmean(items, shape):
    """NaN-aware weighted mean of [(weight_array, value_array)] — missing never counts as 0."""
    num = np.zeros(shape, np.float64)
    den = np.zeros(shape, np.float64)
    for w, a in items:
        ok = np.isfinite(a)
        num += np.where(ok, w * a, 0)
        den += np.where(ok, w, 0)
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(den > 0, num / den, np.nan).astype(np.float32)


def run(init=None, horizon_h=None, grid_name=None, sources=None, product='main', leads=None):
    init = init or cycle_init()
    horizon_h = horizon_h or MAIN['horizon_h']
    grid = Grid.get(grid_name or MAIN['grid'])
    rid = store.run_id(product, init)
    store.set_status(product, state='collecting', run_id=rid, init_utc=init.isoformat())
    t_start = time.time()
    if product == 'main':
        try:                                 # score older runs first so this run's weights use the newest skill
            verify.run_verification(init)
        except Exception as e:
            log(f'verification skipped: {e}')
    terr = terrain.load(grid.name)
    lon, lat = grid.lonlat
    readers = {k: READERS[k]() for k in (sources or READERS)}
    runs, unavailable = {}, {}
    for k, r in readers.items():
        # prefer a cycle that reaches as far as possible (UKV alternates short and long runs)
        rr = r.find_run(init, need_lead_h=min(horizon_h, 54)) if k in ('ukv', 'icon_eu') else None
        rr = rr or r.find_run(init)
        if rr:
            runs[k] = rr
        else:
            unavailable[k] = 'no cycle available on AWS at initialisation'
    for k, m in MODELS.items():
        if not m['aws']:
            unavailable[k] = 'not published on AWS (AWS-only data policy)'
    log('source cycles:', {k: f'{v:%d %HZ}' for k, v in runs.items()})
    caches = {k: SourceCache(k, readers[k], runs[k], grid, terr) for k in runs}
    manifest = {
        'name': MAIN['name'], 'engine_version': ENGINE_VERSION, 'init_utc': init.isoformat(),
        'init_local': init.astimezone(ZoneInfo('Europe/London')).strftime('%Y-%m-%d %H:%M %Z'),
        'grid': grid.meta(), 'resolution_m': grid.dx, 'horizon_h': horizon_h, 'step_h': MAIN['step_h'],
        'method': ('Deterministic downscaling of a weighted multi-model blend onto a 2 km grid: bilinear/conservative '
                   'remapping per variable, log-p vertical interpolation without below-ground extrapolation, terrain '
                   'height corrections and terrain–flow diagnostics, column parcel diagnostics. No AI/ML. Not a '
                   'convection-permitting integration: only UKV resolves ~2 km scales; other sources are remapped.'),
        'sources': {k: {'label': MODELS[k]['label'], 'cycle_utc': v.isoformat(), 'kind': MODELS[k]['kind'],
                        'aws': MODELS[k]['aws']} for k, v in runs.items()},
        'unavailable': unavailable, 'calibration': 'pending', 'terrain': terrain.TERRAIN_VERSION,
        'bias_correction': 'none applied (no verification record of sufficient length yet)',
    }
    writer = store.RunWriter(product, init, manifest)
    store.set_status(product, state='running', run_id=rid)
    acc = np.zeros(grid.shape, np.float32)
    prev_p = None
    peak = {}
    degraded = []
    leads = leads or list(range(0, horizon_h + 1, MAIN['step_h']))
    n_frames = len(leads)
    for lead in leads:
        vt = init + timedelta(hours=lead)
        with cf.ThreadPoolExecutor(len(caches) or 1) as ex:
            got = dict(zip(caches, ex.map(lambda c: c.at(vt), caches.values())))
        got = {k: v for k, v in got.items() if v}
        if not any('pl' in v for v in got.values()):
            degraded.append(f'T+{lead}: no source with a vertical profile — frame skipped')
            log(degraded[-1])
            continue
        try:
            fields, meta = frame(grid, terr, lat, got, lead, vt, acc, prev_p)
        except Exception as e:
            traceback.print_exc()
            degraded.append(f'T+{lead}: {e}')
            continue
        acc = fields['precip_accum']
        prev_p = fields['p_thunder']
        for k in ('p_thunder', 'p_lightning', 'p_hail', 'p_wind_damaging', 'p_severe', 'p_heavy_rain'):
            peak.setdefault(k, np.zeros(grid.shape, np.float32))
            peak[k] = np.maximum(peak[k], fields[k])
        writer.frame(lead * 60, vt.isoformat(), {k: fields[k] for k in STORE_FIELDS if k in fields}, meta)
        if (lead <= 24 and product == 'main') or product == 'hindcast':
            verify.save_source_fields(writer.dir, lead * 60, got, grid)
        log(f'T+{lead:3d} {vt:%a %HZ} sources={sorted(got)} pmax={fields["p_thunder"].max():.2f}')
    # run-level hazard timing: arrival, duration, footprint
    if peak:
        d = writer.dir / 'summary'
        d.mkdir(exist_ok=True)
        import zlib
        for k, a in peak.items():
            (d / f'max_{k}.bin').write_bytes(zlib.compress(a.astype(np.float16).tobytes(), 6))
    store.set_status(product, state='validating', run_id=rid)
    ok, checks = validate(writer.manifest, n_frames)
    writer.manifest['validation'] = checks
    writer.manifest['degraded_because'] = degraded + [f'{k}: {v}' for k, v in unavailable.items() if MODELS[k]['aws']]
    writer.manifest['runtime_s'] = round(time.time() - t_start)
    writer.manifest['peaks'] = {k: round(float(a.max()), 3) for k, a in peak.items()}
    if not ok:
        writer.abandon('; '.join(c['detail'] for c in checks if not c['ok']))
        store.set_status(product, state='failed', run_id=rid, detail=checks)
        return None
    status = 'degraded' if degraded or len(runs) < 4 else 'published'
    if product == 'hindcast':
        writer.manifest['hindcast'] = True
    cal = [f.get('calibrated') for f in writer.manifest['frames'] if f.get('valid')]
    if any(c == 'nova-ai' for c in cal):
        writer.manifest['calibration'] = ('NOVA-AI: region- and terrain-aware neural calibration trained on hindcasts + nightly '
                                          f'verification (see nova_ai.json); {sum(1 for c in cal if c)}/{len(cal)} frames calibrated')
    elif any(cal):
        writer.manifest['calibration'] = ('isotonic reliability calibration from hindcasts (see calibration.json); '
                                          f'{sum(1 for c in cal if c)}/{len(cal)} frames calibrated')
    else:
        writer.manifest['calibration'] = 'uncalibrated'
    path = writer.publish(status)
    store.set_status(product, state=status, run_id=rid, last_published=rid)
    store.prune(product, keep=8 if product == 'main' else 400)
    return path


def frame(grid, terr, lat, got, lead, vt, acc, prev_p):
    shape = grid.shape
    w_env, prov_env = W.dynamic(lead, [k for k, v in got.items() if 'pl' in v or 'sfc' in v], 'environment')
    w_init, prov_init = W.dynamic(lead, list(got), 'initiation')
    w_pr, _ = W.dynamic(lead, [k for k, v in got.items() if 'precip' in v.get('sfc', {})], 'precip')
    valid = {k: v['valid'] for k, v in got.items()}
    cw_env = W.cell_weights({k: w_env[k] for k in w_env if 'pl' in got[k]}, valid)
    cw_sfc = W.cell_weights(w_env, valid)
    cw_init = W.cell_weights(w_init, valid)
    cw_pr = W.cell_weights(w_pr, valid)
    # blended profile on LEVELS
    prof = {}
    for var in ('t', 'q', 'u', 'v', 'z', 'w', 'qc', 'qi', 'qr', 'qs', 'qg'):
        items = [(cw_env[k][None], got[k]['pl'][var]) for k in cw_env if var in got[k]['pl']]
        if items:
            prof[var] = wmean(items, (len(LEVELS),) + shape)
    sfc = {}
    for var in ('t2', 'td2', 'u10', 'v10', 'gust', 'mslp', 'skt', 'soilw', 'shf', 'lhf', 'swdown', 'lwdown', 'cbh', 'tcc', 'pw_src',
                'tqc', 'tqi', 'tqr', 'tqs', 'htop_con', 'hbas_con'):
        items = [(cw_sfc[k], got[k]['sfc'][var]) for k in cw_sfc if var in got[k].get('sfc', {})]
        if items:
            sfc[var] = wmean(items, shape)
    items = [(cw_pr[k], got[k]['sfc']['precip']) for k in cw_pr if 'precip' in got[k].get('sfc', {})]
    ens = {k: hz.ensemble_probs(v['members'], np.zeros(shape, np.float32)) for k, v in got.items() if 'members' in v}
    ens_pr = [(np.full(shape, w_pr.get(k, 0) or w_env.get(k, 0), np.float32) * valid[k], e['precip_mean']) for k, e in ens.items()]
    sfc['precip'] = wmean(items + [x for x in ens_pr if x[0].max() > 0], shape) if items or ens_pr else np.zeros(shape, np.float32)
    for var in ('lightning', 'hail'):                   # UKV-only explicit fields, inside UKV's domain
        if 'ukv' in got and var in got['ukv']['sfc']:
            sfc[var] = np.where(valid['ukv'], got['ukv']['sfc'][var], np.nan)
    if 'icon_eu' in got and 'lightning_lpi' in got['icon_eu']['sfc']:
        sfc['lpi'] = got['icon_eu']['sfc']['lightning_lpi']
    # surface pressure on NOVA terrain from the blended 3-D state (hypsometric), never extrapolating the profile
    h = terr['h_mean']
    z = prof['z']
    lnp = np.log(np.asarray(LEVELS, float))[:, None, None] * np.ones_like(z)
    ps = np.full(shape, np.nan, np.float32)
    for k in range(len(LEVELS) - 1):
        z0, z1 = z[k], z[k + 1]
        hit = np.isnan(ps) & np.isfinite(z0) & np.isfinite(z1) & (z0 <= h) & (z1 > h)
        f = np.where(hit, (h - z0) / np.where(z1 == z0, 1, z1 - z0), 0)
        ps = np.where(hit, np.exp(lnp[k] + f * (lnp[k + 1] - lnp[k])), ps)
    z1000, t1000 = z[0], prof['t'][0]
    below = np.isnan(ps) & np.isfinite(z1000) & (h < z1000)
    ps = np.where(below, 1000 * np.exp(9.80665 * (z1000 - h) / (287.04 * np.nan_to_num(t1000, nan=285))), ps)
    if 'mslp' in sfc:
        ps = np.where(np.isnan(ps), sfc['mslp'] / 100 * np.exp(-9.80665 * h / (287.04 * 285)), ps)
    t2 = sfc.get('t2', prof['t'][0])
    td2 = np.minimum(sfc.get('td2', t2 - 5), t2)
    q2 = th.q_from_rh(100 * th.es_hpa(td2) / th.es_hpa(t2), t2, ps)
    D = env_columns(prof, ps, t2, q2, h, sfc['u10'], sfc['v10'], shape)
    lev = {p: LEVELS.index(p) for p in (925, 850, 700, 500, 300, 250)}
    G = dg.grid_diagnostics({
        'u10': sfc['u10'], 'v10': sfc['v10'], 'q2': q2,
        **{f'u{p}': prof['u'][i] for p, i in lev.items()}, **{f'v{p}': prof['v'][i] for p, i in lev.items()},
        't850': prof['t'][lev[850]], 'q850': prof['q'][lev[850]], 't700': prof['t'][lev[700]], 'z700': prof['z'][lev[700]],
        't500': prof['t'][lev[500]], 't300': prof['t'][lev[300]], 'z500': prof['z'][lev[500]], 'mslp': sfc.get('mslp', ps * 100),
    }, lat, grid.dx)
    # terrain–flow diagnostics with the 0–1 km mean wind and 0–2 km stability
    u01 = np.nanmean(prof['u'][:3], 0)
    v01 = np.nanmean(prof['v'][:3], 0)
    u01 = np.where(np.isfinite(u01), u01, sfc['u10'])
    v01 = np.where(np.isfinite(v01), v01, sfc['v10'])
    flow = terrain.flow_diagnostics(terr, grid, u01, v01, D['bv_freq_0_2km'])
    signals = {}
    for k, v in got.items():
        if 'sfc' in v and 'precip' in v['sfc']:
            sig = hz.model_signal(v['sfc'], D['mu_cape'])
            if sig is not None:
                signals[k] = np.where(valid[k], sig, np.nan)
    M = mp.compute(prof, LEVELS, terr['land_frac'], sfc)
    F = dict(sfc, conv_10m=G['conv_10m'], q2=q2)
    if 'charging_index' in M:
        F['charging_index'] = M['charging_index']
    H = hz.compute(F, D, terr, flow, {k: np.nan_to_num(v) for k, v in signals.items()}, ens,
                   cw_init, cw_pr, grid.dx, lead, prev_p)
    pr = np.nan_to_num(np.clip(sfc['precip'], 0, None))
    from .calibrate import calibrate_field
    H['p_thunder_uncal'], H['p_lightning_uncal'] = H['p_thunder'], H['p_lightning']
    H['p_thunder'], cal_t = calibrate_field(H['p_thunder'], lead, 'p_thunder')
    from . import ai_cal
    from .regions import region_map
    p_ai, used_ai = ai_cal.apply_grid(H['p_thunder_uncal'], lead, {k: D[k] if k in D else flow.get(k, H.get(k)) for k in ai_cal.ENV_FIELDS
                                                                    if k in D or k in flow or k in H},
                                      ai_cal.static_fields(terr, region_map(grid, terr['land_frac'])), 'main')
    if used_ai:
        H['p_thunder'], cal_t = p_ai, 'nova-ai'
    H['p_lightning'], _ = calibrate_field(H['p_lightning'], lead, 'p_lightning')
    out = dict(D, **G, **flow, **H, **M)
    if 'lpi' in sfc:
        out['lpi'] = sfc['lpi']
    for k in ('htop_con', 'hbas_con', 'tcc', 'cbh'):
        if k in sfc:
            out[k] = sfc[k]
    out.update(t2=t2, td2=td2, u10=sfc['u10'], v10=sfc['v10'], mslp=sfc.get('mslp', ps * 100) / 100.0, precip=pr,  # mslp in hPa
               precip_3h=pr * 3, precip_accum=acc + pr * 3)
    # physical-consistency checks on the frame
    qs = th.mixing_ratio(th.es_hpa(prof['t']), np.asarray(LEVELS, float)[:, None, None])
    checks = {
        'supersaturation_frac': float(np.nanmean(prof['q'] > 1.05 * qs)),
        'negative_precip': int((sfc['precip'] < -1e-6).sum()),
        'prob_out_of_range': int(sum(((out[k] < 0) | (out[k] > 1)).sum() for k in out if k.startswith('p_'))),
        'z_nonmonotonic_frac': float(np.nanmean(np.diff(prof['z'], axis=0) <= 0)),
        'nan_frac_core': float(np.isnan(out['mu_cape']).mean()),
    }
    if checks['supersaturation_frac'] > 0:
        prof['q'] = np.minimum(prof['q'], 1.05 * qs)
    meta = {'sources': sorted(got), 'weights_environment': prov_env, 'weights_initiation': prov_init.get('final'),
            'source_flags': {k: v.get('flags', []) for k, v in got.items() if v.get('flags')},
            'ensembles': sorted(ens), 'checks': checks, 'field_state': 'blended + terrain-adjusted', 'calibrated': cal_t}
    return out, meta


def env_columns(prof, ps, t2, q2, h, u10, v10, shape, chunk_rows=80):
    """Column diagnostics in row chunks so memory stays bounded on a 16 GB machine."""
    parts = []
    for r0 in range(0, shape[0], chunk_rows):
        r1 = min(shape[0], r0 + chunk_rows)
        sub = (r1 - r0, shape[1])
        n = sub[0] * sub[1]
        R = lambda a: a[:, r0:r1].reshape(len(LEVELS), n)
        S = lambda a: a[r0:r1].ravel()
        C = th.build_columns(np.asarray(LEVELS, float), R(prof['t']), R(prof['q']), R(prof['u']), R(prof['v']), R(prof['z']),
                             S(ps), S(t2), S(q2), S(h), S(u10), S(v10), w=R(prof['w']) if 'w' in prof else None)
        parts.append(dg.column_diagnostics(C, sub))
        del C
    return {k: np.concatenate([p[k] for p in parts], 0) for k in parts[0]}


def environment(prof, sfc, terr, grid):
    """Surface pressure on NOVA terrain + screen-level moisture + column diagnostics.
    Shared by the Main Run and Hyper-Short (UKV environment)."""
    h = terr['h_mean']
    z = prof['z']
    lnp = np.log(np.asarray(LEVELS, float))
    ps = np.full(grid.shape, np.nan, np.float32)
    for k in range(len(LEVELS) - 1):
        z0, z1 = z[k], z[k + 1]
        hit = np.isnan(ps) & np.isfinite(z0) & np.isfinite(z1) & (z0 <= h) & (z1 > h)
        f = np.where(hit, (h - z0) / np.where(z1 == z0, 1, z1 - z0), 0)
        ps = np.where(hit, np.exp(lnp[k] + f * (lnp[k + 1] - lnp[k])), ps)
    below = np.isnan(ps) & np.isfinite(z[0]) & (h < z[0])
    ps = np.where(below, 1000 * np.exp(9.80665 * (z[0] - h) / (287.04 * np.nan_to_num(prof['t'][0], nan=285))), ps)
    if 'mslp' in sfc:
        ps = np.where(np.isnan(ps), sfc['mslp'] / 100 * np.exp(-9.80665 * h / (287.04 * 285)), ps)
    t2 = sfc.get('t2', prof['t'][0])
    td2 = np.minimum(sfc.get('td2', t2 - 5), t2)
    q2 = th.q_from_rh(100 * th.es_hpa(td2) / th.es_hpa(t2), t2, ps)
    D = env_columns(prof, ps, t2, q2, h, sfc['u10'], sfc['v10'], grid.shape)
    return D, ps, t2, td2, q2


def validate(manifest, n_expected):
    frames = [f for f in manifest['frames'] if f.get('valid')]
    checks = [
        {'name': 'frames_present', 'ok': len(frames) >= max(1, int(0.8 * n_expected)),
         'detail': f'{len(frames)}/{n_expected} frames'},
        {'name': 'first_frame', 'ok': bool(frames) and frames[0]['lead_min'] == 0, 'detail': 'T+0 present'},
        {'name': 'grid', 'ok': manifest['grid']['dx_m'] == 2000.0, 'detail': f"dx={manifest['grid']['dx_m']} m"},
        {'name': 'probabilities_bounded', 'ok': all(f['checks']['prob_out_of_range'] == 0 for f in frames), 'detail': 'all p in [0,1]'},
        {'name': 'core_fields_finite', 'ok': all(f['checks']['nan_frac_core'] < 0.2 for f in frames), 'detail': 'MUCAPE NaN < 20 %'},
    ]
    return all(c['ok'] for c in checks), checks


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--init')
    ap.add_argument('--horizon', type=int)
    ap.add_argument('--sources')
    a = ap.parse_args()
    init = datetime.fromisoformat(a.init).replace(tzinfo=ZoneInfo('Europe/London')).astimezone(timezone.utc) if a.init else None
    try:
        p = run(init, a.horizon, sources=a.sources.split(',') if a.sources else None)
        print(json.dumps({'ok': bool(p), 'path': str(p) if p else None}))
    except FileExistsError as e:
        print(json.dumps({'ok': False, 'skipped': str(e)}))
    except Exception as e:
        traceback.print_exc()
        store.set_status('main', state='failed', detail=str(e))
        raise SystemExit(1)
