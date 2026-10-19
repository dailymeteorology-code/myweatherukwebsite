"""TCM Hyper-Short run: hourly, 1.5 km, 24 h at 30-min frames; radar + lightning nowcast
(engine2) blended with TCM V5 on the latest UKV.

    python -m nova.hyper.run [--init 2026-10-18T16:00]
"""
from __future__ import annotations

import argparse
import json
import math
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
from . import engine2 as E2
from . import obs
from .ukv_env import ENV_FIELDS, UKVEnvironment

UNAVAILABLE = {
    'hydrometeor mixing ratios': 'UKV does not publish them on AWS, and Hyper-Short may only use UKV',
}


def hour_init(now=None):
    now = now or datetime.now(timezone.utc)
    return now.replace(minute=0, second=0, microsecond=0)


def _ukv_skill(E0, radar, dx_m):
    """UKV's skill right now: FSS of its precipitation against the radar analysis (1 mm/h,
    on the TAU_SCALE_KM neighbourhood the nowcast's own predictability is measured on), over
    the radar's coverage. None when neither has rain."""
    if not E0 or 'ukv_precip' not in E0:
        return None
    seen = np.isfinite(radar)
    return E2.fss(np.where(seen, np.nan_to_num(E0['ukv_precip']), 0), np.where(seen, radar, 0), 1.0,
                  max(3, int(round(E2.TAU_SCALE_KM * 1000 / dx_m))))


def run(init=None):
    init = init or hour_init()
    grid = Grid.get(HYPER['grid'])
    rid = store.run_id('hyper', init)
    store.set_status('hyper', state='collecting', run_id=rid, init_utc=init.isoformat())
    t0 = time.time()
    # 1. observations: the last 90 minutes of radar (7 composites, 15-min), QC'd and de-speckled
    frames = obs.latest_radar(init, n=7, max_age_min=HYPER['max_obs_age_min'])
    newest = frames[-1]
    age_min = (init - newest['time']).total_seconds() / 60
    to_grid = coarsen_sampler(grid, newest['projdef'], newest['x'], newest['y'])
    rains, prev = [], None
    for f in frames:
        r = f['rate'].copy()
        r[r > 250] = np.nan                                # QC: physically implausible rates
        r = E2.clean_radar(to_grid(r), prev)
        rains.append(r)
        prev = r
    times = [f['time'] for f in frames]
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
    tr = Transformer.from_crs('EPSG:4326', grid.crs, always_xy=True)
    lt, lt_trend = E2.lightning_analysis(strikes, init, grid, tr)
    # 2. the environment: TCM V5 on the latest UKV (steering wind, CAPE, UKV's own hazards)
    env = UKVEnvironment(init)
    E0 = env.at(init)
    steer_u = E0.get('ukv_steer_u') if E0 else None
    steer_v = E0.get('ukv_steer_v') if E0 else None
    # 3. motion: every radar pair + the whole sequence, steering wind where echoes are sparse
    u, v, minfo = E2.motion_multi(rains, times, grid.dx, steer_u, steer_v)
    speed = float(np.hypot(u, v).mean() * grid.dx)
    # 4. growth/decay trend and today's own predictability time, from the radar sequence
    g, tau_now = E2.growth_and_memory(rains, times, u, v, grid.dx)
    # 5. carry the analysis from radar time to the run init (radar is ~10-15 min old);
    #    the lightning analysis is already referenced to the init
    rain0 = np.nan_to_num(cur)
    lag_min = (init - newest['time']).total_seconds() / 60
    if lag_min > 0:
        rain0, g = E2.advance(rain0, u, v, lag_min), E2.advance(g, u, v, lag_min)
    # 6. lifetimes from the environment; a rising flash rate lengthens a storm's life
    tau_small, tau_light = E2.lifetimes(E0.get('mu_cape') if E0 else None)
    jump = np.clip(lt_trend / (lt + 0.05), -1, 1)
    tau_light = (np.asarray(tau_light, np.float32) * (1 + 0.4 * jump)).astype(np.float32)
    tau_small = (np.asarray(tau_small, np.float32) * (1 + 0.2 * np.clip(jump, 0, 1))).astype(np.float32)
    skill = _ukv_skill(E0, cur, grid.dx)
    s_used = skill if skill is not None else 0.5
    analysis = {
        'version': ANALYSIS_VERSION, 'radar_times': [t.isoformat() for t in times],
        'radar_age_min': round(age_min, 1), 'radar_coverage': round(coverage, 3),
        'motion_pairs': minfo['pairs'], 'motion_blocks': minfo['blocks'],
        'motion_steering_blend': minfo['steering'], 'radar_motion_fraction': minfo.get('radar_motion_fraction'),
        'mean_motion_ms': round(speed, 1), 'predictability_min': round(tau_now),
        'ukv_fss_now': None if skill is None else round(skill, 3),
        'lightning_feed': 'ok' if lt_ok else 'unavailable',
        'lightning_strikes_60min': len(strikes), 'lightning_last_update': lt_update,
        'uncertainty': 'radar-unobserved cells (NaN) treated as dry; lightning detection efficiency not modelled',
    }
    manifest = {
        'name': HYPER['name'], 'engine_version': HYPER_ENGINE_VERSION, 'analysis_version': ANALYSIS_VERSION,
        'init_utc': init.isoformat(), 'init_local': init.astimezone(ZoneInfo('Europe/London')).strftime('%Y-%m-%d %H:%M %Z'),
        'grid': grid.meta(), 'resolution_m': grid.dx, 'horizon_h': 24, 'step_min': 30,
        'inputs': {'radar': 's3://met-office-radar-obs-data (observations, 7 composites over 90 min)',
                   'lightning': 'Met Office LEELA (observations)',
                   'ukv': 'latest UKV run (s3://met-office-atmospheric-model-data/uk-deterministic-2km) through TCM V5'},
        'nwp_inputs': ['ukv'] if env.run else [], 'ukv_cycle_utc': env.run.isoformat() if env.run else None,
        'analysis': analysis, 'unavailable': UNAVAILABLE,
        'calibration': 'uncalibrated (new engine; NOVA learning recalibrates once its own verification pairs exist)',
        'method': ('TCM Hyper-Short 2. Observation nowcast: the last 90 min of radar (7 composites, de-speckled) and '
                   'recency-weighted LEELA lightning; motion from every radar pair and the whole sequence, blended '
                   'towards the TCM V5 850-500 hPa steering wind where echoes are sparse; backward-trajectory '
                   'extrapolation that samples the analysis once per output time (no cumulative smoothing); measured '
                   'Lagrangian growth/decay; storm lifetimes from V5 MUCAPE and the lightning trend; a 16-member '
                   'ensemble (speed, direction, growth) for probabilities to T+6 h. Blended with TCM V5 on the latest '
                   'UKV using STEPS skill weights: the hand-over comes where the nowcast\'s measured correlation falls '
                   'to UKV\'s current skill against the radar. No machine learning, no other model.'),
        'skill_horizon': (f'nowcast and UKV weigh equally at about T+{-tau_now * math.log(min(max(s_used, 0.15), 0.9)) / 60:.1f} h today '
                          f'(radar predictability {tau_now:.0f} min, UKV FSS {s_used:.2f}); later frames are mainly UKV'),
    }
    writer = store.RunWriter('hyper', init, manifest)
    store.set_status('hyper', state='running', run_id=rid)
    acc = np.zeros(grid.shape, np.float32)
    prev = None
    motion = {'motion_u': (u * grid.dx).astype(np.float32), 'motion_v': (v * grid.dx).astype(np.float32)}
    seed = int(init.timestamp() // 3600)
    stream = E2.nowcast(rain0, lt, u, v, g, tau_small, tau_light, grid.dx, range(0, 24 * 60 + 1, 30), seed=seed,
                        extra={'lightning_jump': (np.clip(lt_trend, 0, None), 30.0)})
    for lead, rain, light, members, carried in stream:
        P = E2.probabilities(members, rain, light, lead, grid.dx, speed)
        vt = init + timedelta(minutes=lead)
        E = env.at(vt) if lead else E0
        wn = E2.blend_weight(lead, tau_now, s_used) if E else 1.0
        out = dict(motion, lightning_jump=carried['lightning_jump'])
        if E:
            def mix(now, mod):
                return np.clip(wn * now + (1 - wn) * np.nan_to_num(mod), 0, None).astype(np.float32)
            z = np.zeros(grid.shape, np.float32)
            ukv_rain = np.nan_to_num(E.get('ukv_precip', z))
            out.update(precip=mix(rain, ukv_rain), flash_density=mix(light, E.get('ukv_flash_density', z)),
                       p_rain=np.clip(mix(P['p_rain'], (ukv_rain >= 1.0).astype(np.float32)), 0, 1),
                       p_thunder=np.clip(mix(P['p_thunder'], E.get('ukv_p_thunder', z)), 0, 1),
                       p_lightning=np.clip(mix(P['p_lightning'], E.get('ukv_p_lightning', z)), 0, 1),
                       p_heavy_rain=np.clip(mix(P['p_heavy_rain'], E.get('ukv_p_heavy_rain', z)), 0, 1))
            for k in ('p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_tornado_env', 'p_severe', 'p_initiation'):
                if 'ukv_' + k in E:
                    out[k] = np.clip(np.nan_to_num(E['ukv_' + k]), 0, 1).astype(np.float32)
            if 'ukv_gust_max' in E:
                out['gust_max'] = E['ukv_gust_max']
            for k in ENV_FIELDS + ['t2', 'td2', 'u10', 'v10']:
                if k in E:
                    out[k] = E[k]
            ukv_conf = float(np.nanmean(E['ukv_confidence'])) if 'ukv_confidence' in E else 0.5
            conf = float(wn * math.exp(-lead / (2 * tau_now)) + (1 - wn) * ukv_conf)
        else:
            out.update(precip=rain, flash_density=light, p_rain=P['p_rain'], p_thunder=P['p_thunder'],
                       p_lightning=P['p_lightning'], p_heavy_rain=P['p_heavy_rain'])
            conf = float(math.exp(-lead / (2 * tau_now)))
        out['p_thunder_uncal'] = out['p_thunder']
        out['p_thunder'], used = calibrate_field(out['p_thunder'], lead / 60, 'hyper_p_thunder')   # new-era curves only
        cal_t = 'isotonic (V5 era)' if used else 'uncalibrated'
        acc = acc + 0.25 * (prev + out['precip']) if lead else acc          # trapezoid over 30 min, mm
        prev = out['precip']
        pk = [k for k in out if k.startswith('p_')]
        writer.frame(lead, vt.isoformat(), dict(out, precip_accum=acc), {
            'checks': {'prob_out_of_range': int(sum(((out[k] < 0) | (out[k] > 1)).sum() for k in pk)),
                       'negative_precip': int((out['precip'] < 0).sum()), 'nan_frac_core': float(np.isnan(out['precip']).mean())},
            'confidence': round(conf, 3), 'neighbourhood_km': round(P['neighbourhood_km'], 1),
            'nowcast_weight': round(wn, 3), 'ensemble_members': len(members) if members else 1,
            'ukv_environment': bool(E), 'calibrated': cal_t})
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
