"""TCM NOVA runs powered by TCM V5.

  Main Run    every model on AWS/DWD, downscaled to 2 km and blended (v5_blend), then V5
              Stages 3-8 on the blend. 3-hourly to 4 days, plus whole-day summaries.
  Hyper-Short the latest UKV only (v5_bridge.ingest), hourly to T+3.

V5 output is remapped to the NOVA grid and written with NOVA's RunWriter: same run ids,
manifest, storage and publishing, so the page, cloud sync and archive are unchanged.

    python -m nova.v5_run --product main [--init ISO] [--leads 0-24] [--chunk]
    python -m nova.v5_run --product main --init ISO --assemble [--collect CHUNKS --own LEADS]
The chunked form is how GitHub runs it: 17 jobs compute lead times in parallel, and the
one-lead job then gathers the others' frames as they finish (--collect), merges and
publishes the run.
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
from .calibrate import calibrate_field

from route_ci import MAIN_ENGINE as ENGINE_VERSION   # one definition, shared with the scheduler
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
           'precip', 'pw', 'lapse_700_500', 'p_initiation', 'uncertainty']
DAY_MIN = ['ml_cin']


def to_nova_fields(fields, grid):
    """V5 LAEA arrays -> the NOVA grid (bilinear), probabilities clipped to [0, 1]."""
    out = {}
    for k, a in fields.items():
        if a is None:
            continue
        v = B.to_nova(np.asarray(a, dtype='float64'), grid)
        if k.startswith('p_') or k in ('confidence', 'uncertainty'):
            v = np.clip(np.nan_to_num(v), 0, 1)
        out[k] = v.astype(np.float32)
    return out


def save_sources(writer_dir, lead_min, srcs, grid):
    """Each model's own V5 thunderstorm probability and precipitation at 10 km, for the
    nightly verification that sets the skill-based weights."""
    from .grid import block_mean
    from .verify import COARSE
    d = writer_dir / 'sources' / str(lead_min)
    d.mkdir(parents=True, exist_ok=True)
    for k, v in srcs.items():
        for name, suffix in (('p_thunder', '.pthunder.bin'), ('precip', '.bin')):
            a = v.get(name)
            if a is None:
                continue
            a = B.to_nova(np.asarray(a, dtype='float64'), grid)
            c = block_mean(np.nan_to_num(a), COARSE) if name == 'precip' else block_mean(a, COARSE)
            (d / f'{k}{suffix}').write_bytes(zlib.compress(np.asarray(c, np.float16).tobytes(), 6))


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
        'method': ('TCM V5 physics, run separately on every model that publishes a vertical profile (UKV, ICON-D2, '
                   'ICON-EU, ECMWF IFS, ECMWF AIFS, NOAA GFS), each first downscaled by code to the 2 km grid: bilinear '
                   'from its native grid, log-p vertical interpolation inside its own levels, screen temperature and '
                   'dew point corrected to the 90 m Copernicus DEM, surface pressure, hodograph and boundary-layer '
                   'depth derived on the 2 km terrain. V5 Stage 4 (parcels, DCAPE, shear, moisture) compiled and '
                   'bit-identical to V5; the twelve V5 engines and the V5 probability chain vectorised and verified '
                   'against V5 cell by cell. Models combined by V5 linear pooling with the NOVA-V5 weights '
                   '(continuous-lead baseline, resolution credit, cycle freshness, verified skill, family caps); '
                   'hazards pooled with the same weights and nested under the thunderstorm probability.'
                   if blend else 'TCM V5 physics on the latest Met Office UKV 2 km (AWS).'),
        'v5_fixes': __import__('nova.v5x.pipeline', fromlist=['FIXES']).FIXES,
        'v5_stride': stride, 'sources': src_labels, 'unavailable': {},
        'calibration': 'uncalibrated (TCM V5 links; NOVA learning recalibrates once V5 verification pairs exist)',
    }, **(extra or {}))


def _peak_mem_mb():
    """This process's peak resident memory (Linux runners; None elsewhere)."""
    try:
        import resource
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
    except Exception:
        return None


class _Started:
    """Stands in for run_frame's process pool: a model whose V5 chain already started (as
    its data arrived) hands back that result; any other model is run now."""
    def __init__(self, started, pool):
        self.started, self.pool = started, pool

    def map(self, fn, tasks):
        futs = [self.started.get(t[0]) or self.pool.submit(fn, t) for t in tasks]
        return [f.result() for f in futs]


def _run_frame(PL, pool, W, started, got, lead, blender, init, vt):
    """pipeline.run_frame, collecting the V5 chains already started for this frame.
    (pipeline.py itself is left untouched: its hash keys the compiled-kernel cache.)"""
    if not pool:
        return PL.run_frame(got, lead, blender.cycles, blender.terr, blender.g, run=init, valid_time=vt, log=log)
    real = PL.pool
    PL.pool = lambda workers: _Started(started, pool)
    try:
        return PL.run_frame(got, lead, blender.cycles, blender.terr, blender.g, run=init, valid_time=vt, log=log,
                            workers=W)
    finally:
        PL.pool = real


def compute(product, init, leads, stride, workers, writer_dir: Path, cycles_out: dict, horizon_h=None):
    """The V5 engine for `leads`, writing NOVA frames into writer_dir. Returns frame metas."""
    from . import v5_blend as VB
    from .v5x import pipeline as PL
    grid = Grid.get(MAIN['grid'])
    tmp = store.RunWriter.__new__(store.RunWriter)            # frame writer only (no partial-dir reset)
    tmp.dir, tmp.manifest = writer_dir, {'frames': [], 'fields': {}}
    (writer_dir / 'frames').mkdir(parents=True, exist_ok=True)
    only = ('ukv',) if product == 'hyper' else None
    # cycles are chosen for the WHOLE run's horizon, not this chunk's last lead, so every
    # chunk of a run picks the same cycle of every model
    blender = VB.Blender(init, horizon_h or max(leads), only=only)
    cycles_out.update(blender.cycles)
    # Each model's V5 chain starts in the process pool the moment ITS data has arrived,
    # while slower models are still downloading (a frame used to wait for the slowest
    # download before any physics began). The pool's processes are forked here, before
    # any download thread exists.
    import os
    W = max(1, (os.cpu_count() or 2) // 2)          # run_frame's own default
    pool = PL.pool(W) if W > 1 else None
    if pool:
        pool.submit(int).result()
    lon = blender.g.lonlat[0]
    started = {}                                     # valid time -> {model: Future of its V5 chain}

    def fetch(vt):
        started[vt] = {}

        def on_source(k, f):
            if pool and k in PL.PROFILE_SOURCES and 'pl' in f:
                fh = int(round((vt - blender.cycles[k]).total_seconds() / 3600))
                started[vt][k] = pool.submit(PL._task, (k, f, blender.terr['h_mean'], blender.cycles[k], fh, vt, lon, True))
        return blender.at(vt, on_source=on_source)
    # the next frame's data downloads while this frame computes (fetching is network-bound,
    # the physics CPU-bound, so the two overlap almost completely)
    import concurrent.futures as cf
    ex = cf.ThreadPoolExecutor(1)
    nxt = ex.submit(fetch, init + timedelta(hours=leads[0])) if leads else None
    for i, lead in enumerate(leads):
        vt = init + timedelta(hours=lead)
        t0 = time.time()
        try:
            try:
                got = nxt.result()
            finally:            # one fetch at a time (SourceCache is not shared across threads)
                nxt = ex.submit(fetch, init + timedelta(hours=leads[i + 1])) if i + 1 < len(leads) else None
            t_fetch = time.time() - t0
            fields, meta = _run_frame(PL, pool, W, started.pop(vt, {}), got, lead, blender, init, vt)
            if fields is None:
                log(f'T+{lead}: {meta}')
                continue
            srcs = fields.pop('_sources', {})
            fields = to_nova_fields(fields, grid)
            fields['p_thunder_uncal'] = fields['p_thunder']
            fields['p_thunder'], cal = calibrate_field(fields['p_thunder'], lead, 'p_thunder')
            if lead <= 24 and product != 'hyper':
                save_sources(writer_dir, lead * 60, srcs, grid)
        except Exception:
            traceback.print_exc()
            continue
        fl = getattr(blender, 'fetch_log', {}).pop(vt, {})
        meta = dict(meta, calibrated='isotonic (V5 era)' if cal else 'uncalibrated', fetch_s=round(t_fetch, 1), seconds=round(time.time() - t0),
                    fetch_source_s=fl.get('seconds', {}), fetch_errors=fl.get('errors', {}),
                    fetch_http=fl.get('http', {}), fetch_locks=fl.get('locks', {}), peak_mem_mb=_peak_mem_mb())
        tmp.frame(lead * 60, vt.isoformat(), fields, meta)
        log(f'T+{lead:3d} {vt:%a %HZ} p_thunder max={fields["p_thunder"].max():.2f} '
            f'(waited {t_fetch:.0f}s for data, total {time.time() - t0:.0f}s, models {meta["sources"]})')
    ex.shutdown(wait=False)
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
    frames = compute(product, init, leads, stride, workers, d, cycles, horizon_h=horizon_h)
    if chunk:
        (d / f'chunk-{leads[0]}-{leads[-1]}.json').write_text(json.dumps(
            {'frames': frames, 'cycles': {k: v.isoformat() for k, v in cycles.items()}, 'seconds': round(time.time() - t0)},
            default=str))
        return d
    return finish(product, init, horizon_h, stride, d, frames, cycles, t0)


def assemble(product, init, horizon_h=None, stride=3, collect=None):
    """Merge the chunks and publish. collect=(chunks, own_leads): first gather the other
    chunks' artifacts from this workflow run as they finish (see cloud.collect_chunks)."""
    rid = store.run_id(product, init)
    d = store.DATA / product / (rid + '.partial')
    if collect:
        from .cloud import collect_chunks
        collect_chunks(collect[0], collect[1], store.DATA / product)
    frames, cycles = [], {}
    for c in d.glob('chunk-*.json'):
        j = json.loads(c.read_text())
        frames += j['frames']
        cycles.update({k: datetime.fromisoformat(v) for k, v in j['cycles'].items()})
        c.unlink()
    return finish(product, init, horizon_h or MAIN['horizon_h'], stride, d, frames, cycles, time.time())


def _leads(spec):
    """'0-21' (every 3 h) or '0,51,3' (explicit list)."""
    if ',' in spec or '-' not in spec:
        return sorted(int(x) for x in spec.split(',') if x.strip())
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
    ap.add_argument('--collect', help="with --assemble: the route's main_chunks JSON; gather the other chunks' "
                                      "artifacts from this workflow run first")
    ap.add_argument('--own', help='with --collect: this job\'s own leads (its frames are here already)')
    ap.add_argument('--print-init', action='store_true')
    a = ap.parse_args()
    init = datetime.fromisoformat(a.init).astimezone(timezone.utc) if a.init else None
    if a.print_init:
        from .main_run import cycle_init
        print((init or cycle_init()).isoformat())
    elif a.assemble:
        print(assemble(a.product, init, a.horizon, a.stride or 3,
                       collect=(json.loads(a.collect), a.own or '') if a.collect else None))
    else:
        if a.chunk and a.product == 'main':
            from .cloud import ensure_main_inputs
            ensure_main_inputs()
        print(run(a.product, init, a.horizon, a.stride, a.workers, _leads(a.leads) if a.leads else None, a.chunk))
