"""One TCM FROST run.

    python -m frost.run --cycle 2026111312 [--out DIR] [--sources ukv,ifs,...] [--horizon 240]
                        [--members N] [--workers 4]

Phase 1, each source in its own process (ecCodes is not thread-safe): its run for the cycle (the
cycle's own, or the newest before it, weighted down for its age), read step by step in order with
the next step fetched while this one is worked, and every member's snow (cm) on every 2 km land
cell for every output period (frost.physics). Saved as a float16 cube (members, leads, cells).

Phase 2, the blend (frost.blend), period by period: the chance of snow, the 24-hour risk, the
amount expected since the start and in the last 24 h; then each day's totals and chances. Written
in Model Data's frame format (frost.output).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import shutil
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .config import CHANCE_CM, DATA, DAY_THRESHOLDS, ENC, ENGINE, HORIZON_H, LEADS, RISK_RULES, SOURCES

UKV_LONG = 'ukv_long'


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def tag_of(t):
    return f'{t:%Y%m%dT%H%M}Z'


# ── which run of each source ─────────────────────────────────────────────────────────────────────
def plan(cycle, keys, horizon):
    from .grid import Cells
    from .sources import READERS
    cells = Cells()
    jobs = []
    for key in keys:
        src = READERS[key](cells)
        for run in src.runs_before(cycle, back_h=18):
            try:
                sched = src.schedule(run)
                if not sched:
                    continue
                lag = int((cycle - run).total_seconds() // 3600)
                if src.available(run, min(max(sched), horizon + lag)):
                    jobs.append({'name': key, 'key': key, 'run': run.isoformat(), 'lag': lag})
                    break
            except Exception as e:
                log(f'{key} {run:%d %HZ}: {type(e).__name__}: {e}')
        if key == 'ukv':                             # beyond the cycle's T+54: the newest run to T+120 (03Z/15Z)
            for run in src.runs_before(cycle, back_h=15):
                if run.hour in (3, 15):
                    try:
                        if max(src.schedule(run) or [0]) >= 120:
                            jobs.append({'name': UKV_LONG, 'key': 'ukv', 'run': run.isoformat(), 'lag': int((cycle - run).total_seconds() // 3600)})
                            break
                    except Exception:
                        pass
    return jobs


# ── phase 1: one source's members ───────────────────────────────────────────────────────────────
def member_job(job, leads, work, max_members=None):
    from .grid import Cells
    from .physics import snowfall
    from .sources import READERS
    t0 = time.time()
    cells = Cells()
    src = READERS[job['key']](cells)
    run, lag = datetime.fromisoformat(job['run']), job['lag']
    last = max(leads) + lag
    sched = sorted(s for s in src.schedule(run) if s <= last + 6)
    if not sched:
        return {**job, 'error': 'no steps'}
    targets = [lag] + [L + lag for L in leads]
    M = src.members if not max_members else min(src.members, max_members)
    zc = cells.ground(src.cfg['res_km'])
    cube = np.full((M, len(leads), cells.n), np.nan, np.float16)

    def stream():
        with cf.ThreadPoolExecutor(1) as ex:             # one ahead, strictly in order (totals chain)
            fut = ex.submit(src.fetch, run, sched[0])
            for i, s in enumerate(sched):
                try:
                    data = fut.result()
                except Exception as e:
                    log(f"{job['name']} T+{s}: {type(e).__name__}: {e}")
                    data = None
                if i + 1 < len(sched):
                    fut = ex.submit(src.fetch, run, sched[i + 1])
                yield s, data
    it = stream()
    a = b = None                                          # the native steps either side

    def state(h):
        nonlocal a, b
        while b is None or b[0] < h:
            a = b
            try:
                b = next(it)
            except StopIteration:
                return None
        if b[0] == h:
            return b[1]
        if a is None or a[1] is None or b[1] is None:
            return None
        f = (h - a[0]) / (b[0] - a[0])
        out = {}
        for k in ('tp', 'sf', 't2', 'td2', 't850'):
            va, vb = a[1].get(k), b[1].get(k)
            out[k] = None if va is None or vb is None else va + (vb - va) * f
        out['fs'] = b[1].get('fs')
        return out

    s0 = state(targets[0])
    for i, h in enumerate(targets[1:]):
        s1 = state(h)
        if s0 is not None and s1 is not None:
            p = (s1['tp'] - s0['tp'])[:M]
            s = (s1['sf'] - s0['sf'])[:M] if s1.get('sf') is not None and s0.get('sf') is not None else None
            mean = lambda k: None if s0.get(k) is None or s1.get(k) is None else (0.5 * (s0[k] + s1[k]))[:M]   # noqa: E731
            fs = s1['fs'][:M] if s1.get('fs') is not None else None
            cm, _, _ = snowfall(p, s, fs, mean('t2'), mean('td2'), mean('t850'), cells.z, zc, downscale=job['key'] != 'ukv')
            cube[:, i, :] = cm
        s0 = s1
    path = Path(work) / f"{job['name']}.npy"
    np.save(path, cube)
    have = np.isfinite(cube[0, :, 0]).tolist()
    log(f"{job['name']} {run:%d %HZ} (+{lag} h): {M} members, {sum(have)}/{len(leads)} periods, {time.time() - t0:.0f} s")
    return {**job, 'members': M, 'have': have, 'path': str(path)}


# ── phase 2: the blend ──────────────────────────────────────────────────────────────────────────
def blend_all(cycle, jobs, leads, out):
    from .blend import chance, pmm, risk, weight
    from .grid import Cells
    from .output import encode, write_frame, write_point, write_status
    cells = Cells()
    n = cells.n
    run_iso, rtag = cycle.isoformat(), tag_of(cycle)
    cubes = [(j, np.load(j['path'], mmap_mode='r')) for j in jobs if j.get('path')]
    acc = [np.zeros((c.shape[0], n), np.float32) for _, c in cubes]
    hist = [{0: np.zeros((c.shape[0], n), np.float16)} for _, c in cubes]     # each lead's totals, 24 h back
    snaps = {}                                                                # day boundaries -> totals
    series = np.zeros((n, len(leads), 3), np.uint8)
    valid = []
    for i, L in enumerate(leads):
        vt = cycle + timedelta(hours=L)
        valid.append(vt.isoformat())
        X, A, S24, W = [], [], [], []
        for k, (j, cube) in enumerate(cubes):
            win = np.asarray(cube[:, i, :], np.float32)
            ok = np.isfinite(win).all(1)
            acc[k] += np.nan_to_num(win)
            hist[k][L] = acc[k].astype(np.float16)
            back = max((h for h in hist[k] if h <= L - 24), default=0)
            s24 = acc[k] - hist[k][back].astype(np.float32)
            for h in [h for h in hist[k] if h < L - 24 and h != back]:
                del hist[k][h]
            if not ok.any():
                continue
            w = weight(j['key'], L, j['lag']) * (0.8 if j['name'] == UKV_LONG else 1.0)
            X.append(win[ok]); A.append(acc[k][ok]); S24.append(s24[ok]); W.append(np.full(ok.sum(), w))
        if not X:
            log(f'T+{L}: no members'); continue
        X, A, S24, W = np.vstack(X), np.vstack(A), np.vstack(S24), np.concatenate(W)
        maps = {
            'snow_chance': chance(X, W, CHANCE_CM) * 100.0,
            'snow_risk': risk(S24, W).astype(np.float32),
            'snow_expected': pmm(A, W),
            'snow_24h': pmm(S24, W),
        }
        meta = {'model': 'frost', 'run': run_iso, 'step': L, 'valid': vt.isoformat()}
        for var, v in maps.items():
            write_frame(out / var / f'{L}.bin', cells.full(v), ENC[var], {**meta, 'var': var})
        series[:, i, 0] = encode(maps['snow_expected'], ENC['snow_expected'])
        series[:, i, 1] = np.rint(np.nan_to_num(maps['snow_chance'])).astype(np.uint8)
        series[:, i, 2] = maps['snow_risk'].astype(np.uint8)
        if vt.hour == 0 or i == len(leads) - 1:
            snaps[vt] = [a.copy() for a in acc]
        if i % 10 == 0:
            log(f"T+{L}: {len(W)} members, most snow expected {maps['snow_expected'].max():.1f} cm, "
                f"highest chance {np.nanmax(maps['snow_chance']):.0f}%, highest risk {int(maps['snow_risk'].max())}")
    for var in ('snow_chance', 'snow_risk', 'snow_expected', 'snow_24h'):
        write_status(out / var, run_iso, var, leads)

    # each day (UTC, = the UK's in the snow season): its own snow, from the totals at its ends
    bounds = [cycle] + sorted(snaps)
    zero = [np.zeros_like(a) for a in acc]
    day_names, days = [], []
    for t0, t1 in zip(bounds[:-1], bounds[1:]):
        d0 = snaps.get(t0, zero)
        d1 = snaps[t1]
        S, W = [], []
        mid = t0 + (t1 - t0) / 2
        for k, (j, cube) in enumerate(cubes):
            lo = max(0, next((i for i, L in enumerate(leads) if cycle + timedelta(hours=L) > t0), 0))
            hi = max(i for i, L in enumerate(leads) if cycle + timedelta(hours=L) <= t1)
            ok = np.isfinite(np.asarray(cube[:, lo:hi + 1, 0], np.float32)).all(1)
            if not ok.any():
                continue
            S.append((d1[k] - d0[k])[ok]); W.append(np.full(ok.sum(), weight(j['key'], (mid - cycle).total_seconds() / 3600, j['lag'])))
        if not S:
            continue
        S, W = np.vstack(S), np.concatenate(W)
        name = f'{(t1 - timedelta(seconds=1)):%Y-%m-%d}'
        day_names.append(name)
        lv = np.zeros(n, np.uint8)
        for level, rules in RISK_RULES:
            hit = np.zeros(n, bool)
            for cm, p in rules:
                hit |= np.nan_to_num(chance(S, W, cm)) >= p
            lv = np.where((lv == 0) & hit, level, lv)
        cols = [encode(pmm(S, W), ENC['snow_24h'])] + [np.rint(100 * np.nan_to_num(chance(S, W, c))).astype(np.uint8) for c in DAY_THRESHOLDS] + [lv]
        days.append(np.stack(cols, 1))
    days = np.stack(days, 1) if days else np.zeros((n, 0, 6), np.uint8)
    write_point(out / '_point.bin', cells.idx, leads, series, days, day_names, valid)
    return day_names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cycle', required=True, help='YYYYmmddHH, a 00/06/12/18Z cycle')
    ap.add_argument('--out', default=None)
    ap.add_argument('--sources', default=','.join(SOURCES))
    ap.add_argument('--horizon', type=int, default=HORIZON_H)
    ap.add_argument('--members', type=int, default=None, help='cap each ensemble (testing)')
    ap.add_argument('--workers', type=int, default=min(4, os.cpu_count() or 2))
    a = ap.parse_args()
    t0 = time.time()
    cycle = datetime.strptime(a.cycle, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    leads = [L for L in LEADS if L <= a.horizon]
    base = Path(a.out) if a.out else DATA / 'runs'
    out = base / tag_of(cycle)
    work = base / f'_work_{tag_of(cycle)}'
    shutil.rmtree(out, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    keys = [k for k in a.sources.split(',') if k in SOURCES]
    jobs = plan(cycle, keys, a.horizon)
    log(f'cycle {cycle:%d %b %HZ}: ' + ', '.join(f"{j['name']} {datetime.fromisoformat(j['run']):%d %HZ}" for j in jobs))
    done = []
    with cf.ProcessPoolExecutor(a.workers) as ex:
        futs = {ex.submit(member_job, j, leads, str(work), a.members): j for j in jobs}
        for f in cf.as_completed(futs):
            try:
                done.append(f.result())
            except Exception:
                log(f"{futs[f]['name']} failed:\n{traceback.format_exc()}")
    done = [d for d in done if d.get('path')]
    if not done:
        log('no source could be read'); sys.exit(2)
    t1 = time.time()
    days = blend_all(cycle, done, leads, out)
    manifest = {
        'engine': ENGINE, 'model': 'frost', 'run': cycle.isoformat(), 'created': datetime.now(timezone.utc).isoformat(),
        'leads': leads, 'valid': [(cycle + timedelta(hours=L)).isoformat() for L in leads], 'days': days,
        'sources': [{'name': d['name'], 'key': d['key'], 'label': SOURCES[d['key']]['label'] + (' (long run)' if d['name'] == UKV_LONG else ''),
                     'run': d['run'], 'lag_h': d['lag'], 'members': d['members'], 'periods': int(sum(d['have']))} for d in sorted(done, key=lambda d: d['name'])],
        'members': int(sum(d['members'] for d in done)),
        'seconds': {'members': round(t1 - t0), 'blend': round(time.time() - t1)},
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=1))
    shutil.rmtree(work, ignore_errors=True)
    log(f"done: {manifest['members']} members from {len(done)} sources, {len(days)} days, {time.time() - t0:.0f} s -> {out}")


if __name__ == '__main__':
    main()
