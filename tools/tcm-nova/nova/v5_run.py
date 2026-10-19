"""TCM NOVA runs powered by TCM V5.

  Main Run    every model on AWS/DWD, downscaled to 2 km and blended (v5_blend), then V5
              Stages 3-8 on the blend. 3-hourly to 4 days, plus whole-day summaries.
  Hyper-Short the latest UKV only (v5_bridge.ingest), hourly to T+3.

V5 output is remapped to the NOVA grid and written with NOVA's RunWriter: same run ids,
manifest, storage and publishing, so the page, cloud sync and archive are unchanged.

    python -m nova.v5_run --product main [--init ISO] [--leads 0-24] [--chunk]
    python -m nova.v5_run --product main --init ISO --assemble     (merge chunks, publish)
The chunked form is how GitHub runs it: four jobs compute lead ranges in parallel and a
final job assembles and publishes the run.
"""
from __future__ import annotations

import argparse
import warnings
import json
import logging
import os
import shutil
import time
import traceback
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from . import store
from .config import LEVELS, MAIN
from .grid import Grid
from .sources import UKV, log
from . import v5_bridge as B

ENGINE_VERSION = 'nova-v5-1.1'
LONDON = ZoneInfo('Europe/London')

HAZARD_FIELDS = {'lightning': 'p_lightning', 'hail': 'p_hail', 'severe_hail': 'p_hail_sig',
                 'severe_wind': 'p_wind_damaging', 'downburst': 'p_downburst',
                 'heavy_rainfall': 'p_heavy_rain', 'tornado_environment': 'p_tornado_env'}
PARAM_FIELDS = {'mucape': 'mu_cape', 'sbcape': 'sb_cape', 'mlcape': 'ml_cape', 'mlcin': 'ml_cin', 'mucin': 'mu_cin',
                'dcape': 'dcape', 'lr_700_500': 'lapse_700_500', 'precipitable_water': 'pw',
                'wet_bulb_zero': 'wbz', 'freezing_level': 'freezing_level', 'shear_0_1km': 'shear_0_1km',
                'shear_0_6km': 'shear_0_6km', 'srh_0_1km': 'srh_0_1km', 'srh_0_3km': 'srh_0_3km',
                'pbl_depth': 'pbl_height', 'lcl': 'ml_lcl_z', 'lfc': 'mu_lfc_z', 'el': 'mu_el_z'}
# fields summarised over each whole UK day: maximum (probabilities, intensities) or total
DAY_MAX = ['p_thunder', 'p_lightning', 'p_hail', 'p_hail_sig', 'p_wind_damaging', 'p_downburst', 'p_tornado_env',
           'p_heavy_rain', 'p_severe', 'flash_density', 'gust_max', 'mu_cape', 'dcape', 'shear_0_6km', 'srh_0_1km',
           'precip', 'pw', 'lapse_700_500']
DAY_MIN = ['ml_cin']


def _store_value(run, fh, name):
    from app.pipeline.ingest import load_field
    f = load_field('ukv', run, name, fh)
    return None if f is None else f.values


def frame_fields(run, fh, gf, params, grid):
    S = gf.stride
    out = {'p_thunder': B.to_nova(gf.probability, grid, S),
           'p_thunder_uncal': B.to_nova(gf.raw_probability, grid, S),
           'confidence': B.to_nova(gf.confidence, grid, S)}
    for h, k in HAZARD_FIELDS.items():
        if h in gf.hazards:
            out[k] = B.to_nova(gf.hazards[h], grid, S)
    if 'p_hail_sig' in out and 'p_hail' in out:            # V5 nesting can slip by rounding
        out['p_hail_sig'] = np.minimum(out['p_hail_sig'], out['p_hail'])
    sev = [out[k] for k in ('p_hail_sig', 'p_wind_damaging', 'p_tornado_env') if k in out]
    if sev:
        out['p_severe'] = np.fmax.reduce(sev)
    for p, k in PARAM_FIELDS.items():
        v = params.value(p)
        if v is not None:
            v = B.to_nova(v, grid)
            out[k] = -np.abs(v) if k.endswith('_cin') else v          # NOVA shows CIN negative
    for v5n, k, f in (('precip_rate', 'precip', 3600.0), ('lightning_flash_density_1h', 'flash_density', 1.0),
                      ('temperature_2m', 't2', 1.0), ('dewpoint_2m', 'td2', 1.0), ('u_wind_10m', 'u10', 1.0),
                      ('v_wind_10m', 'v10', 1.0), ('pressure_msl', 'mslp', 0.01), ('total_cloud_cover', 'tcc', 0.01),
                      ('wind_gust_10m', 'gust_max', 1.0)):
        a = _store_value(run, fh, v5n)
        if a is not None:
            out[k] = B.to_nova(a, grid) * f
    for k, a in list(out.items()):
        if k.startswith('p_') or k == 'confidence':
            out[k] = np.clip(np.nan_to_num(a), 0, 1).astype(np.float32)
    return out


def _manifest(product, init, horizon_h, stride, cycles, extra=None):
    grid = Grid.get(MAIN['grid'])
    src_labels = {}
    from .config import MODELS
    for k, v in cycles.items():
        src_labels[k] = {'label': MODELS[k]['label'], 'cycle_utc': v.isoformat(), 'kind': MODELS[k]['kind'], 'aws': True}
    blend = product != 'hyper'
    return dict({
        'name': MAIN['name'] if product != 'hyper' else 'TCM Hyper-Short', 'engine_version': ENGINE_VERSION,
        'engine': 'TCM V5', 'init_utc': init.isoformat(),
        'init_local': init.astimezone(LONDON).strftime('%Y-%m-%d %H:%M %Z'),
        'grid': grid.meta(), 'resolution_m': grid.dx, 'horizon_h': horizon_h, 'step_h': 1 if product == 'hyper' else 3,
        'method': (('Every available model (UKV, Met Office Global, ECMWF IFS/AIFS + ensembles, DWD ICON-EU + EPS, '
                    'NOAA GFS/GEFS) downscaled to the 2 km grid (bilinear, log-p, terrain-corrected against the '
                    '90 m Copernicus DEM) and blended with the NOVA-V5 weighting (continuous lead baseline, '
                    'resolution credit, cycle freshness, verified skill, family caps, per-cell consensus). '
                    if blend else 'Latest Met Office UKV 2 km from AWS. ') +
                   'TCM V5 physics on that state: V5 profile builder (no extrapolation, below-ground levels masked), '
                   'V5 gridded convective parameters, V5 spatial intelligence, and the V5 per-cell engine chain, '
                   f'TCM probability and hazard models, evaluated every {stride} cells ({2 * stride} km) and remapped '
                   'bilinearly to this grid.'),
        'v5_stride': stride, 'sources': src_labels, 'unavailable': {},
        'calibration': 'TCM V5 (per-frame calibration recorded)',
    }, **(extra or {}))


def compute(product, init, leads, stride, workers, writer_dir: Path, cycles_out: dict):
    """Run V5 for `leads`, writing NOVA frames into writer_dir. Returns frame metas."""
    grid = Grid.get(MAIN['grid'])
    tmp = store.RunWriter.__new__(store.RunWriter)            # frame writer only (no partial-dir reset)
    tmp.dir, tmp.manifest = writer_dir, {'frames': [], 'fields': {}}
    (writer_dir / 'frames').mkdir(parents=True, exist_ok=True)
    blender = None
    src = UKV()
    if product == 'hyper':
        cyc = src.find_run(init, need_lead_h=max(leads)) or src.find_run(init)
        cycles_out['ukv'] = cyc
    else:
        from . import v5_blend as VB
        blender = VB.Blender(init, max(leads))
        cycles_out.update(blender.cycles)
    for lead in leads:
        vt = init + timedelta(hours=lead)
        t0 = time.time()
        try:
            if blender:
                got = blender.at(vt)
                st = VB.blend(got, lead, blender.cycles, blender.g, blender.terr) if got else None
                if st is None:
                    log(f'T+{lead}: no source with a vertical profile')
                    continue
                prof, sfc, bmeta = st
                VB.write_store(init, lead, prof, sfc, blender.terr, ','.join(sorted(got)))
                run_for_v5, fh = init, lead
                levels = LEVELS
            else:
                fh = int((vt - cyc).total_seconds() // 3600)
                B.ingest(cyc, fh, src)
                run_for_v5, levels, bmeta = cyc, None, {'sources': ['ukv'], 'ukv_cycle': cyc.isoformat()}
            gf, params, _ = B.run_v5(run_for_v5, fh, stride=stride, workers=workers, pressure_levels=levels)
            if gf is None:
                log(f'T+{lead}: V5 found no usable column')
                continue
            fields = frame_fields(run_for_v5, fh, gf, params, grid)
        except Exception as e:
            if 'no pressure-level temperature' in str(e):
                log(f'T+{lead}: UKV cycle ends here')
                break
            traceback.print_exc()
            continue
        meta = dict(bmeta, calibrated=gf.calibration, v5_coverage=round(gf.coverage, 4), v5_cells=gf.produced,
                    v5_issues=gf.issues[:6], seconds=round(time.time() - t0))
        tmp.frame(lead * 60, vt.isoformat(), fields, meta)
        log(f'T+{lead:3d} {vt:%a %HZ} V5 pthunder max={fields["p_thunder"].max():.2f} ({time.time() - t0:.0f}s)')
        shutil.rmtree(B.V5_ROOT / 'fields' / 'ukv' / f'{run_for_v5:%Y%m%dT%H}', ignore_errors=True)
    return tmp.manifest['frames']


def _read(d: Path, lead_min, k, shape):
    p = d / 'frames' / str(lead_min) / f'{k}.bin'
    if not p.exists():
        return None
    raw = zlib.decompress(p.read_bytes())
    return np.frombuffer(raw, np.float16).reshape(shape).astype(np.float32)


def finish(product, init, horizon_h, stride, d: Path, frames, cycles, t0, extra=None):
    """Accumulations, whole-day summaries, manifest, publish."""
    grid = Grid.get(MAIN['grid'])
    shape = grid.shape
    frames = sorted(frames, key=lambda f: f['lead_min'])
    fields = {}
    for f in frames:
        for k, s in f['stats'].items():
            fields.setdefault(k, s['dtype'])
    # running precipitation total (each frame's rate held over its step)
    step = 1 if product == 'hyper' else 3
    acc = np.zeros(shape, np.float32)
    for f in frames:
        pr = _read(d, f['lead_min'], 'precip', shape)
        if pr is not None:
            acc = acc + np.nan_to_num(np.clip(pr, 0, None)) * step
        (d / 'frames' / str(f['lead_min']) / 'precip_accum.bin').write_bytes(
            zlib.compress(acc.astype(np.float16).tobytes(), 6))
        f['stats']['precip_accum'] = {'min': 0.0, 'max': float(acc.max()), 'nan_frac': 0.0, 'dtype': 'float16'}
    fields['precip_accum'] = 'float16'
    # whole-day summaries (UK local days) and run peaks
    days = {}
    for f in frames:
        day = datetime.fromisoformat(f['valid']).astimezone(LONDON).date().isoformat()
        days.setdefault(day, []).append(f['lead_min'])
    day_meta = []
    peak = {}
    for day, mins in sorted(days.items()):
        dd = d / 'days' / day
        dd.mkdir(parents=True, exist_ok=True)
        got, dstats = [], {}
        for k in DAY_MAX + DAY_MIN + ['precip_accum_day']:
            if k == 'precip_accum_day':
                arrs = [_read(d, m, 'precip', shape) for m in mins]
                arrs = [np.nan_to_num(np.clip(a, 0, None)) * step for a in arrs if a is not None]
                a = np.sum(arrs, 0) if arrs else None
            else:
                arrs = [a for a in (_read(d, m, k, shape) for m in mins) if a is not None]
                if not arrs:
                    continue
                st = np.stack(arrs)
                a = np.nanmin(st, 0) if k in DAY_MIN else np.nanmax(st, 0)
            if a is None:
                continue
            name = 'precip_accum' if k == 'precip_accum_day' else k
            (dd / f'{name}.bin').write_bytes(zlib.compress(np.asarray(a, np.float32).astype(np.float16).tobytes(), 6))
            got.append(name)
            fin = np.asarray(a)[np.isfinite(a)]
            dstats[name] = {'max': float(fin.max()) if fin.size else None, 'min': float(fin.min()) if fin.size else None}
            if name in ('p_thunder', 'p_lightning', 'p_hail', 'p_wind_damaging', 'p_severe', 'p_heavy_rain'):
                peak[name] = np.maximum(peak.get(name, 0), a)
        lo = datetime.fromisoformat(day)
        day_meta.append({'date': day, 'label': lo.strftime('%A %d %B'), 'lead_min': mins, 'fields': got, 'stats': dstats,
                         'complete': len(mins) >= (24 // step) - 1})
    if peak:
        sd = d / 'summary'
        sd.mkdir(exist_ok=True)
        for k, a in peak.items():
            (sd / f'max_{k}.bin').write_bytes(zlib.compress(a.astype(np.float16).tobytes(), 6))
    rid = store.run_id(product, init)
    man = _manifest(product, init, horizon_h, stride, cycles, extra)
    man.update(run_id=rid, product=product, frames=frames, fields=fields, days=day_meta,
               runtime_s=round(time.time() - t0), peaks={k: round(float(a.max()), 3) for k, a in peak.items()})
    if not frames:
        man['status'] = 'failed'
        store._write_json(d / 'manifest.json', man)
        store.set_status(product, state='failed', run_id=rid)
        return None
    n_expected = horizon_h // step + 1
    status = 'published' if len(frames) >= n_expected - 1 else 'degraded'
    if status == 'degraded':
        man['degraded_because'] = [f'{len(frames)} of {n_expected} frames produced']
    w = store.RunWriter.__new__(store.RunWriter)
    w.product, w.id, w.root, w.dir, w.final, w.manifest = product, rid, store.DATA / product, d, store.DATA / product / rid, man
    path = w.publish(status)
    store.set_status(product, state=status, run_id=rid, last_published=rid)
    store.prune(product, keep=8 if product == 'main' else 400)
    return path


def run(product='main', init=None, horizon_h=None, stride=None, workers=None, leads=None, chunk=False):
    from .main_run import cycle_init
    now = datetime.now(timezone.utc)
    if product == 'hyper':
        init = init or now.replace(minute=0, second=0, microsecond=0)
        horizon_h = horizon_h or 3
        stride = stride or 4
    else:
        init = init or cycle_init()
        horizon_h = horizon_h or MAIN['horizon_h']
        stride = stride or 3
    step = 1 if product == 'hyper' else 3
    leads = leads or list(range(0, horizon_h + 1, step))
    rid = store.run_id(product, init)
    if (store.DATA / product / rid).exists():
        log(f'{rid} already published')
        return None
    d = store.DATA / product / (rid + '.partial')
    if not chunk and d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True, exist_ok=True)
    store.set_status(product, state='running', run_id=rid, init_utc=init.isoformat())
    t0 = time.time()
    cycles = {}
    frames = compute(product, init, leads, stride, workers, d, cycles)
    if chunk:
        (d / f'chunk-{leads[0]}-{leads[-1]}.json').write_text(json.dumps(
            {'frames': frames, 'cycles': {k: v.isoformat() for k, v in cycles.items()}, 'seconds': round(time.time() - t0)},
            default=str))
        return d
    return finish(product, init, horizon_h, stride, d, frames, cycles, t0)


def assemble(product, init, horizon_h=None, stride=3):
    rid = store.run_id(product, init)
    d = store.DATA / product / (rid + '.partial')
    frames, cycles = [], {}
    for c in d.glob('chunk-*.json'):
        j = json.loads(c.read_text())
        frames += j['frames']
        cycles.update({k: datetime.fromisoformat(v) for k, v in j['cycles'].items()})
        c.unlink()
    return finish(product, init, horizon_h or MAIN['horizon_h'], stride, d, frames, cycles, time.time())


def _leads(spec):
    a, b = (int(x) for x in spec.split('-'))
    return list(range(a, b + 1, 3))


if __name__ == '__main__':
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore', category=RuntimeWarning)                       # V5 per-cell nesting notes would flood the log
    ap = argparse.ArgumentParser()
    ap.add_argument('--product', default='main')
    ap.add_argument('--init')
    ap.add_argument('--horizon', type=int)
    ap.add_argument('--stride', type=int)
    ap.add_argument('--workers', type=int)
    ap.add_argument('--leads')
    ap.add_argument('--chunk', action='store_true')
    ap.add_argument('--assemble', action='store_true')
    ap.add_argument('--print-init', action='store_true')
    a = ap.parse_args()
    init = datetime.fromisoformat(a.init).astimezone(timezone.utc) if a.init else None
    if a.print_init:
        from .main_run import cycle_init
        print((init or cycle_init()).isoformat())
    elif a.assemble:
        print(assemble(a.product, init, a.horizon, a.stride or 3))
    else:
        print(run(a.product, init, a.horizon, a.stride, a.workers, _leads(a.leads) if a.leads else None, a.chunk))
