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
from .models import ACCUM, DIFFERENCED, MODELS, STEP_VARS, VARIABLES, _utc


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
    if var == 'wx':
        derived(model, run_s, var, steps, d, status)
        status['state'] = 'complete'
        status['seconds'] = round(time.time() - status['started'], 1)
        write_json(d / 'status.json', status)
        return
    accum = var in ACCUM and model in ('ukv', 'mo_global')
    diff = (model, var) in DIFFERENCED
    need_all = accum or diff                       # these need every raw step, even if frames exist
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
