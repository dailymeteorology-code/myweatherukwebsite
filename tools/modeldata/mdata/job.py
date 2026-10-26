"""Make every frame of one variable for one model run.

    python -m mdata.job ukv 2026-10-19T15:00Z precip_total

Downloads run in parallel; frames are written in step order as they are ready (running
totals and rate differences need the previous step). Frames already on disk are kept, so
an interrupted job resumes. Progress is in status.json next to the frames.
"""
from __future__ import annotations

import concurrent.futures as cf
import logging
import sys
import time
import traceback
import warnings
from datetime import timedelta

import numpy as np

from .common import FRAMES, write_frame, write_json, DATA
from .models import ACCUM, ALIASES, DIFFERENCED, MODELS, SNOW_CHAIN, STEP_VARS, VARIABLES, _utc


def run_dir(model, run, var):
    return FRAMES / model / f'{run:%Y%m%dT%H%MZ}' / var


def steps_for(model, run):
    import json
    try:
        cat = json.loads((DATA / 'catalog.json').read_text())
        for m in cat['models']:
            if m['id'] == model:
                for r in m['runs']:
                    if _utc(r['run']) == run:
                        return r['steps']
    except Exception:
        pass
    M = MODELS[model]
    return M.steps(run) if hasattr(M, 'steps') else M.schedule(run)


def derived(model, run_s, var, steps, d, status):
    """A field made from other variables' frames (mdata/derived.py): make those first (any
    already complete are reused), then combine them step by step."""
    import json
    from .common import read_frame
    from .derived import weather_type, wx_inputs
    M = MODELS[model]
    run = _utc(run_s)
    deps = wx_inputs(M.variables)
    for v in deps:
        try:
            done = json.loads((run_dir(model, run, v) / 'status.json').read_text()).get('state') == 'complete'
        except Exception:
            done = False
        if not done:
            main(model, run_s, v)
    for h in steps:
        if (d / f'{h}.bin').exists():
            status['done'].append(h)
            continue
        f = {}
        for v in deps:
            p = run_dir(model, run, v) / f'{h}.bin'
            if p.exists():
                f[v] = read_frame(p)[0]
        if 'precip_rate' not in f and 'tcc' not in f:
            status['missing'].append(h)
            continue
        f.setdefault('precip_rate', np.zeros_like(next(iter(f.values()))))
        vt = run + timedelta(hours=h)
        write_frame(d / f'{h}.bin', weather_type(f), VARIABLES[var],
                    {'model': model, 'run': run.isoformat(), 'var': var, 'step': h, 'valid': vt.isoformat()})
        status['done'].append(h)
        write_json(d / 'status.json', status)


def peak(model, run_s, var, steps, d, status):
    """The strongest gust at each point from the start of the run to each step: a running maximum
    of the model's own gusts, so played through, the map fills in with the worst the run brings up
    to the moment on screen. From the past hour's maximum gust where the model gives it (UKV, Met
    Office Global: it catches the peaks between steps), the gust otherwise (ECMWF's is the maximum
    since the previous post-processing step, GFS's the gust at the step).

    The source is made first if it is not complete. Every frame is recomputed from the source's
    frames in order (a run still arriving gains steps), and only those not yet on disk are written.
    A step the source lacks is left out rather than drawn without it."""
    import json
    from .common import read_frame
    M = MODELS[model]
    run = _utc(run_s)
    src = 'gust_max' if 'gust_max' in M.variables else 'gust10'
    try:
        done = json.loads((run_dir(model, run, src) / 'status.json').read_text()).get('state') == 'complete'
    except Exception:
        done = False
    if not done:
        main(model, run_s, src)
    status['source'] = src
    best = None
    for h in sorted(steps):
        p = run_dir(model, run, src) / f'{h}.bin'
        if not p.exists():
            status['missing'].append(h)
            continue
        g = read_frame(p)[0]
        best = g if best is None else np.fmax(best, g)
        if (d / f'{h}.bin').exists():
            status['done'].append(h)
            continue
        vt = run + timedelta(hours=h)
        write_frame(d / f'{h}.bin', best, VARIABLES[var],
                    {'model': model, 'run': run.isoformat(), 'var': var, 'step': h, 'valid': vt.isoformat(), 'source': src})
        status['done'].append(h)
        write_json(d / 'status.json', status)


def alias(model, run_s, var, steps, d, status):
    """A copy of another variable's frames in its own units (snow_acc: the snowfall total, read as cm
    of fresh snow at the usual 10:1, so its numbers are the same). When the source is not complete it
    is made alongside, and each of its frames is copied as soon as it is written, so the map fills in
    step by step rather than after the whole run."""
    import json
    import threading
    from .common import read_frame
    run = _utc(run_s)
    src = ALIASES[var]
    sdir = run_dir(model, run, src)
    try:
        done = json.loads((sdir / 'status.json').read_text()).get('state') == 'complete'
    except Exception:
        done = False
    maker = None
    if not done:
        maker = threading.Thread(target=main, args=(model, run_s, src), daemon=True)
        maker.start()
    status['source'] = src
    left = sorted(steps)

    def copy_ready():
        nonlocal left
        rest = []
        for h in left:
            if (d / f'{h}.bin').exists():
                status['done'].append(h)
                continue
            p = sdir / f'{h}.bin'
            if not p.exists():
                rest.append(h)
                continue
            vt = run + timedelta(hours=h)
            write_frame(d / f'{h}.bin', read_frame(p)[0], VARIABLES[var],
                        {'model': model, 'run': run.isoformat(), 'var': var, 'step': h, 'valid': vt.isoformat(), 'source': src})
            status['done'].append(h)
            write_json(d / 'status.json', status)
        left = rest

    while maker is not None and maker.is_alive():
        copy_ready()
        maker.join(2.0)
    copy_ready()
    status['missing'].extend(left)


def main(model, run_s, var, first=None):
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    M = MODELS[model]
    run = _utc(run_s)
    enc = VARIABLES[var]
    steps = steps_for(model, run)
    d = run_dir(model, run, var)
    d.mkdir(parents=True, exist_ok=True)
    status = {'model': model, 'run': run.isoformat(), 'var': var, 'steps': steps, 'done': [], 'missing': [],
              'state': 'running', 'started': time.time()}
    write_json(d / 'status.json', status)
    if var in ('wx', 'gust_peak') or var in ALIASES:
        (derived if var == 'wx' else peak if var == 'gust_peak' else alias)(model, run_s, var, steps, d, status)
        status['state'] = 'complete'
        status['seconds'] = round(time.time() - status['started'], 1)
        write_json(d / 'status.json', status)
        return
    accum = var in ACCUM and model in ('ukv', 'mo_global')
    diff = (model, var) in DIFFERENCED
    chain = (model, var) in SNOW_CHAIN
    need_all = accum or diff or chain              # these need every raw step, even if frames exist
    prev = {s: (steps[i - 1] if i else None) for i, s in enumerate(steps)}
    order = steps
    if first is not None and not need_all:          # the step on screen first, then outwards
        f = int(first)
        order = sorted(steps, key=lambda s: (abs(s - f), s))

    def fetch(h):
        if not need_all and (d / f'{h}.bin').exists():
            return h, 'have'
        try:
            return h, M.field(run, h, var, prev[h])
        except Exception as e:
            return h, e

    total, acc_h, last_raw, last_h = None, None, None, None
    with cf.ThreadPoolExecutor(16) as ex:           # downloads are latency-bound: many in flight
        for h, a in ex.map(fetch, order):
            vt = run + timedelta(hours=h)
            meta = {'model': model, 'run': run.isoformat(), 'var': var, 'step': h, 'valid': vt.isoformat()}
            if isinstance(a, str):
                status['done'].append(h)
                continue
            if isinstance(a, Exception):
                status['missing'].append(h)        # not published at this step (a running total carries on)
                if diff:
                    last_raw, last_h = None, None
                write_json(d / 'status.json', status)
                continue
            if chain:                              # snowfall: each step's new precipitation times its frozen share
                apcp, frac = a['apcp'], a['frac']
                total = (total if total is not None else np.zeros_like(apcp)) + \
                    np.maximum(apcp - (last_raw if last_raw is not None else 0.0), 0) * frac
                last_raw = apcp
                write_frame(d / f'{h}.bin', total, enc, meta)
                status['done'].append(h)
                write_json(d / 'status.json', status)
                continue
            cov = None
            if isinstance(a, tuple):
                a, cov = a
            out = a
            if accum:
                if h == steps[0]:
                    total, acc_h = a, h
                elif total is not None and h - acc_h == cov:
                    total, acc_h = total + a, h
                else:                              # the accumulation does not join up: no frame here
                    status['missing'].append(h)
                    continue
                out = total
            elif cov not in (None, 0, 1) and var not in STEP_VARS:
                status['missing'].append(h)        # a 'past hour' field that is really 3-hourly
                continue
            if diff:
                raw = a
                if last_raw is None or last_h is None:
                    out = np.full_like(raw, np.nan) if h else np.zeros_like(raw)
                else:
                    dt = h - last_h
                    delta = np.maximum(raw - last_raw, 0) if var == 'precip_rate' else (raw - last_raw)
                    out = delta * 1000.0 / dt if var == 'precip_rate' else delta / (dt * 3600.0)
                last_raw, last_h = raw, h
            write_frame(d / f'{h}.bin', out, enc, meta)
            status['done'].append(h)
            write_json(d / 'status.json', status)
    status['state'] = 'complete'
    status['seconds'] = round(time.time() - status['started'], 1)
    write_json(d / 'status.json', status)
    print(f'{model} {run:%d %HZ} {var}: {len(status["done"])} frames, {len(status["missing"])} missing, {status["seconds"]} s')


if __name__ == '__main__':
    try:
        main(*sys.argv[1:5])
    except Exception:
        traceback.print_exc()
        sys.exit(1)
