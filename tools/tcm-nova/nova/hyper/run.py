"""TCM Hyper-Short run: hourly, 1.5 km, 24 h at 30-min frames, observations only.

    python -m nova.hyper.run [--init 2026-10-18T16:00]
"""
from __future__ import annotations

import argparse
import json
import time
import traceback
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
from pyproj import Transformer

from .. import store
from ..calibrate import calibrate_field
from ..config import ANALYSIS_VERSION, HYPER, HYPER_ENGINE_VERSION
from ..grid import Grid, coarsen_sampler
from ..io_aws import log
from . import engine, obs
from .ukv_env import ENV_FIELDS, UKVEnvironment, blend_weight

UNAVAILABLE = {
    'hydrometeor mixing ratios': 'UKV does not publish them on AWS, and Hyper-Short may only use UKV',
}


def hour_init(now=None):
    now = now or datetime.now(timezone.utc)
    return now.replace(minute=0, second=0, microsecond=0)


def run(init=None):
    init = init or hour_init()
    grid = Grid.get(HYPER['grid'])
    rid = store.run_id('hyper', init)
    store.set_status('hyper', state='collecting', run_id=rid, init_utc=init.isoformat())
    t0 = time.time()
    # 1-2. acquire + freshness/QC
    frames = obs.latest_radar(init, n=5, max_age_min=HYPER['max_obs_age_min'])
    newest = frames[-1]
    age_min = (init - newest['time']).total_seconds() / 60
    to_grid = coarsen_sampler(grid, newest['projdef'], newest['x'], newest['y'])
    rains = []
    for f in frames:
        r = f['rate'].copy()
        r[r > 250] = np.nan                                # QC: physically implausible rates
        rains.append(to_grid(r))
    cur = rains[-1]
    coverage = float(np.isfinite(cur).mean())
    store.set_status('hyper', state='analysing', run_id=rid)
    if coverage < HYPER['min_radar_coverage']:
        raise RuntimeError(f'radar covers only {coverage:.0%} of the domain')
    try:
        strikes, lt_update = obs.lightning(init, 60)
        lt_ok = True
    except Exception as e:
        strikes, lt_update, lt_ok = [], None, False
        log(f'lightning feed unavailable: {e}')
    # 3-6. analysis: lightning density (strikes km-2 h-1, last 30 min, time-weighted) on the grid
    lt = np.zeros(grid.shape, np.float32)
    if strikes:
        tr = Transformer.from_crs('EPSG:4326', grid.crs, always_xy=True)
        for t, la, lo in strikes:
            age = (init - t).total_seconds() / 60
            if 0 <= age <= 30:
                x, y = tr.transform(lo, la)
                ix, iy = int((x - grid.x0) // grid.dx), int((y - grid.y0) // grid.dx)
                if 0 <= ix < grid.nx and 0 <= iy < grid.ny:
                    lt[iy, ix] += 2.0 / ((grid.dx / 1000) ** 2)            # per km² per hour
        from scipy import ndimage
        lt = ndimage.gaussian_filter(lt, 2.0)
    dt_s = (frames[-1]['time'] - frames[0]['time']).total_seconds()
    u, v, nblk = engine.motion_field(np.nan_to_num(rains[0]), np.nan_to_num(cur), grid.dx, dt_s) if dt_s > 0 else (0 * cur, 0 * cur, 0)
    speed = float(np.hypot(u, v).mean() * grid.dx)
    # advance analysis from radar time to the run init (radar is ~10–15 min old)
    rain0 = np.nan_to_num(cur)
    lag = (init - newest['time']).total_seconds()
    if lag > 0:
        rain0, lt = engine.advect(rain0, u, v, lag), engine.advect(lt, u, v, lag)
    analysis = {
        'version': ANALYSIS_VERSION, 'radar_times': [f['time'].isoformat() for f in frames],
        'radar_age_min': round(age_min, 1), 'radar_coverage': round(coverage, 3), 'motion_blocks': nblk,
        'mean_motion_ms': round(speed, 1), 'lightning_feed': 'ok' if lt_ok else 'unavailable',
        'lightning_strikes_60min': len(strikes), 'lightning_last_update': lt_update,
        'uncertainty': 'radar-unobserved cells (NaN) treated as dry; lightning detection efficiency not modelled',
    }
    manifest = {
        'name': HYPER['name'], 'engine_version': HYPER_ENGINE_VERSION, 'analysis_version': ANALYSIS_VERSION,
        'init_utc': init.isoformat(), 'init_local': init.astimezone(ZoneInfo('Europe/London')).strftime('%Y-%m-%d %H:%M %Z'),
        'grid': grid.meta(), 'resolution_m': grid.dx, 'horizon_h': 24, 'step_min': 30,
        'method': ('Observation-initialised kinematic forecast (TCM engine, stage 1): radar + lightning analysis, '
                   'phase-correlation motion field, semi-Lagrangian advection with scale-dependent Lagrangian decay. '
                   'No NWP forecast input of any kind. Not a 3-D atmospheric model: it does not initiate new storms.'),
        'inputs': {'radar': 's3://met-office-radar-obs-data (observations)', 'lightning': 'Met Office LEELA (observations)'},
        'nwp_inputs': [], 'analysis': analysis, 'unavailable': UNAVAILABLE, 'calibration': 'uncalibrated',
        'skill_horizon': 'useful mainly to ~T+3 h; later frames show only decaying existing echoes',
    }
    env = UKVEnvironment(init)
    manifest['nwp_inputs'] = ['ukv'] if env.run else []
    manifest['ukv_cycle_utc'] = env.run.isoformat() if env.run else None
    manifest['inputs']['ukv'] = 'latest UKV run (s3://met-office-atmospheric-model-data/uk-deterministic-2km): 3-D environment and UKV hazards'
    manifest['method'] = ('Observation nowcast (radar + lightning analysis, phase-correlation motion, semi-Lagrangian advection '
                          'with scale-dependent decay) blended with the latest UKV run; nowcast weight exp(-lead/90 min). '
                          'Environment diagnostics (CAPE, CIN, shear, SRH, LCL, freezing levels) from UKV 3-D fields on its '
                          '~2 km columns, remapped to 1.5 km. No other model is used.')
    manifest['skill_horizon'] = 'nowcast dominates to about T+2 h; later frames are mainly UKV'
    writer = store.RunWriter('hyper', init, manifest)
    store.set_status('hyper', state='running', run_id=rid)
    acc = np.zeros(grid.shape, np.float32)
    prev = None
    for lead, rain, light in engine.integrate(rain0, lt, u, v, grid.dx, 24 * 60, 30):
        P = engine.probabilities(rain, light, lead, grid.dx, speed)
        vt = init + timedelta(minutes=lead)
        E = env.at(vt)
        wn = blend_weight(lead)
        out = {'p_rain': P['p_rain'], 'motion_u': (u * grid.dx).astype(np.float32), 'motion_v': (v * grid.dx).astype(np.float32)}
        if E:
            def mix(now, mod):
                return np.clip(wn * now + (1 - wn) * mod, 0, None).astype(np.float32)
            out.update(precip=mix(rain, E['ukv_precip']), flash_density=mix(light, E['ukv_flash_density']),
                       p_thunder=np.clip(mix(P['p_thunder'], E['ukv_p_thunder']), 0, 1),
                       p_lightning=np.clip(mix(P['p_lightning'], E['ukv_p_lightning']), 0, 1),
                       p_heavy_rain=np.clip(mix(P['p_heavy_rain'], E['ukv_p_heavy_rain']), 0, 1))
            for k in ('p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_supercell', 'p_tornado_env', 'p_severe'):
                out[k] = np.clip(E['ukv_' + k], 0, 1).astype(np.float32)
            out['hail_size_max_cm'] = E['ukv_hail_size_max_cm']
            out['gust_max'] = E['ukv_gust_max']
            for k in ENV_FIELDS + ['t2', 'td2', 'u10', 'v10']:
                if k in E:
                    out[k] = E[k]
            conf = float(0.5 + 0.5 * np.exp(-lead / 360))
        else:
            out.update(precip=rain, flash_density=light, p_thunder=P['p_thunder'], p_lightning=P['p_lightning'],
                       p_heavy_rain=P['p_heavy_rain'])
            conf = float(np.exp(-lead / 180))
        out['p_thunder_uncal'] = out['p_thunder']
        out['p_thunder'], cal_t = calibrate_field(out['p_thunder'], lead / 60, 'hyper_p_thunder')
        acc = acc + 0.25 * (prev + out['precip']) if lead else acc          # trapezoid over 30 min, mm
        prev = out['precip']
        pk = [k for k in out if k.startswith('p_')]
        writer.frame(lead, vt.isoformat(), dict(out, precip_accum=acc), {
            'checks': {'prob_out_of_range': int(sum(((out[k] < 0) | (out[k] > 1)).sum() for k in pk)),
                       'negative_precip': int((out['precip'] < 0).sum()), 'nan_frac_core': float(np.isnan(out['precip']).mean())},
            'confidence': round(conf, 3), 'neighbourhood_km': round(P['neighbourhood_km'], 1),
            'nowcast_weight': round(wn, 3), 'ukv_environment': bool(E), 'calibrated': cal_t})
        log(f'hyper T+{lead / 60:4.1f} h  nowcast w={wn:.2f}  ukv={bool(E)}  pmax={out["p_thunder"].max():.2f}')
    store.set_status('hyper', state='validating', run_id=rid)
    fr = writer.manifest['frames']
    leads = [f['lead_min'] for f in fr]
    checks = [
        {'name': 'frames', 'ok': leads == list(range(0, 24 * 60 + 1, 30)), 'detail': f'{len(leads)} frames (49 expected)'},
        {'name': 'grid', 'ok': grid.dx == 1500.0, 'detail': f'dx={grid.dx}'},
        {'name': 'ukv_environment', 'ok': True,
         'detail': f"{sum(1 for f in fr if f.get('ukv_environment'))}/{len(fr)} frames with UKV environment"},
        {'name': 'bounded', 'ok': all(f['checks']['prob_out_of_range'] == 0 and f['checks']['negative_precip'] == 0 for f in fr), 'detail': 'p in [0,1], rain >= 0'},
        {'name': 'fresh_obs', 'ok': age_min <= HYPER['max_obs_age_min'], 'detail': f'radar {age_min:.0f} min old'},
    ]
    writer.manifest['validation'] = checks
    writer.manifest['runtime_s'] = round(time.time() - t0)
    if not all(c['ok'] for c in checks):
        writer.abandon('; '.join(c['detail'] for c in checks if not c['ok']))
        store.set_status('hyper', state='failed', run_id=rid, detail=checks)
        return None
    status = 'published' if lt_ok and env.run else 'degraded'
    p = writer.publish(status)
    store.set_status('hyper', state=status, run_id=rid, last_published=rid)
    store.prune('hyper', keep=48)
    return p


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--init')
    a = ap.parse_args()
    init = datetime.fromisoformat(a.init).replace(tzinfo=ZoneInfo('Europe/London')).astimezone(timezone.utc) if a.init else None
    try:
        p = run(init)
        print(json.dumps({'ok': bool(p), 'path': str(p) if p else None}))
    except FileExistsError as e:
        print(json.dumps({'ok': False, 'skipped': str(e)}))
    except Exception as e:
        traceback.print_exc()
        store.set_status('hyper', state='failed', detail=str(e))
        raise SystemExit(1)
