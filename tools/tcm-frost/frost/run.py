"""One TCM FROST run.

    python -m frost.run --cycle 2026111312 [--out DIR] [--sources ukv,ifs,...] [--horizon 240]
                        [--members N] [--workers 4]

Phase 1, each source in its own process (ecCodes is not thread-safe): its run for the cycle (the
cycle's own, or the newest before it, weighted down for its age), read step by step in order with
the next step fetched while this one is worked, and every member's snow (cm) on every 2 km land
cell for every output period (frost.physics). Saved as a float16 cube (members, leads, cells).
Where that run stops short of ten days, the newest longer run of the same model carries it on
(config.LONG).

Phase 2, the blend (frost.blend), period by period: the chance of snow, the 24-hour risk, the
amount expected since the start and in the last 24 h; then each day's totals and chances. Written
in Model Data's frame format (frost.output). A member counts towards a total only where it has
every period the total spans, so a run that starts late or misses a step never reads as less snow.

Everything the run says goes into <run>/log.txt, which is published with it.
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

from .config import CHANCE_CM, DATA, DAY_THRESHOLDS, ENC, ENGINE, HORIZON_H, LEADS, LONG, RISK_RULES, SOURCES

UKV_LONG = 'ukv_long'
LOG = []


def log(*a):
    line = ' '.join(str(x) for x in (time.strftime('%H:%M:%S'),) + a)
    LOG.append(line)
    print(line, flush=True)


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
        reach = None
        for run in src.runs_before(cycle, back_h=18):
            try:
                sched = src.schedule(run)
                if not sched:
                    continue
                lag = int((cycle - run).total_seconds() // 3600)
                if src.available(run, min(max(sched), horizon + lag)):
                    jobs.append({'name': key, 'key': key, 'run': run.isoformat(), 'lag': lag})
                    reach = max(sched) - lag
                    break
            except Exception as e:
                log(f'{key} {run:%d %HZ}: {type(e).__name__}: {e}')
        if key not in LONG or (reach is not None and reach >= horizon):
            continue
        hours = LONG[key]
        for back in range(1, 16):
            run = cycle - timedelta(hours=back)
            if run.hour not in hours:
                continue
            try:
                sched = src.schedule(run)
                if not sched or max(sched) - back <= (reach or 0):
                    continue
                if src.available(run, min(max(sched), horizon + back)):
                    jobs.append({'name': f'{key}_long', 'key': key, 'run': run.isoformat(), 'lag': back,
                                 'from_lead': 0 if key == 'ukv' else (reach or 0)})
                    break
            except Exception as e:
                log(f'{key} long {run:%d %HZ}: {type(e).__name__}: {e}')
    return jobs


# ── phase 1: one source's members ───────────────────────────────────────────────────────────────
def member_job(job, leads, work, max_members=None):
    from .grid import Cells
    from .physics import snowfall
    from .sources import READERS
    t0 = time.time()
    notes = []
    cells = Cells()
    src = READERS[job['key']](cells)
    run, lag = datetime.fromisoformat(job['run']), job['lag']
    F = job.get('from_lead', 0)
    # a long run is read from the day before where it is needed (its 24-hour totals need that day)
    first = max([0] + [L for L in leads if L <= F - 24]) if F else 0
    want = [L for L in leads if L > first]
    last = max(leads) + lag
    every = sorted(src.schedule(run))
    lo = max([s for s in every if s <= first + lag] or every[:1] or [0])
    sched = [s for s in every if lo <= s <= last + 6]
    if not sched:
        return {**job, 'error': 'no steps'}
    targets = [first + lag] + [L + lag for L in want]
    row = {L: i for i, L in enumerate(leads)}
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
                    msg = f"{job['name']} T+{s}: {type(e).__name__}: {str(e)[:200]}"
                    log(msg)
                    if len(notes) < 40:
                        notes.append(msg)
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
    for L, h in zip(want, targets[1:]):
        s1 = state(h)
        if s0 is not None and s1 is not None:
            p = (s1['tp'] - s0['tp'])[:M]
            s = (s1['sf'] - s0['sf'])[:M] if s1.get('sf') is not None and s0.get('sf') is not None else None
            mean = lambda k: None if s0.get(k) is None or s1.get(k) is None else (0.5 * (s0[k] + s1[k]))[:M]   # noqa: E731
            fs = s1['fs'][:M] if s1.get('fs') is not None else None
            cm, _, _ = snowfall(p, s, fs, mean('t2'), mean('td2'), mean('t850'), cells.z, zc, downscale=job['key'] != 'ukv')
            cube[:, row[L], :] = cm
        s0 = s1
    path = Path(work) / f"{job['name']}.npy"
    np.save(path, cube)
    have = np.isfinite(cube[0]).any(1).tolist()
    notes += [f"{job['name']} {e}" for e in getattr(src, 'errors', [])][:40]
    log(f"{job['name']} {run:%d %HZ} (+{lag} h): {M} members, {sum(have)}/{len(leads)} periods, {time.time() - t0:.0f} s")
    return {**job, 'members': M, 'have': have, 'path': str(path), 'notes': notes}


# ── phase 2: the blend ──────────────────────────────────────────────────────────────────────────
def blend_all(cycle, jobs, leads, out):
    from .blend import chance, pmm, risk, weight
    from .grid import Cells
    from .output import encode, write_frame, write_point, write_status
    cells = Cells()
    n = cells.n
    run_iso = cycle.isoformat()
    cubes = [(j, np.load(j['path'], mmap_mode='r')) for j in jobs if j.get('path')]
    acc = [np.zeros((c.shape[0], n), np.float32) for _, c in cubes]
    full = [np.ones(c.shape[0], bool) for _, c in cubes]                         # members with every period so far
    hist = [{0: np.zeros((c.shape[0], n), np.float16)} for _, c in cubes]     # each lead's totals, 24 h back
    oks = [{} for _ in cubes]                                                   # each lead's members with data
    snaps = {}                                                                # day boundaries -> totals
    series = np.zeros((n, len(leads), 3), np.uint8)
    valid = []
    # a long run carries on its model's short one: its totals since the run began are the short
    # run's to where it stopped, then the long run's own snow after that (member by member)
    names = [j['name'] for j, _ in cubes]
    short_of = {k: names.index(j['key']) for k, (j, _) in enumerate(cubes) if j.get('from_lead', 0) and j['key'] in names}
    seam = {k: max([L for L in leads if L <= cubes[k][0]['from_lead']] or [0]) for k in short_of}
    stitch = {}                                                               # long k -> [short totals at the seam, its own there, complete since]
    for i, L in enumerate(leads):
        vt = cycle + timedelta(hours=L)
        valid.append(vt.isoformat())
        X, WX, A, WA, S24, W24 = [], [], [], [], [], []
        now = []
        for k, (j, cube) in enumerate(cubes):
            win = np.asarray(cube[:, i, :], np.float32)
            ok = np.isfinite(win).all(1)
            acc[k] += np.nan_to_num(win)
            full[k] &= ok
            oks[k][L] = ok
            hist[k][L] = acc[k].astype(np.float16)
            back = max((h for h in hist[k] if h <= L - 24), default=0)
            s24 = acc[k] - hist[k][back].astype(np.float32)
            ok24 = ok.copy()
            for h, o in oks[k].items():
                if back < h < L:
                    ok24 &= o
            for h in [h for h in hist[k] if h < L - 24 and h != back]:
                del hist[k][h]
            for h in [h for h in oks[k] if h <= back]:
                del oks[k][h]
            now.append((win, ok, s24, ok24))
        for k, ks in short_of.items():
            if L == seam[k]:
                stitch[k] = [np.where(full[ks][:, None], acc[ks], np.nan), acc[k].copy(), np.ones(len(acc[k]), bool)]
        for k, (j, cube) in enumerate(cubes):
            win, ok, s24, ok24 = now[k]
            if L <= j.get('from_lead', 0) or not ok.any():
                continue                                  # a long run counts only where the short one has stopped
            w = weight(j['key'], L, j['lag']) * (0.8 if j['name'] == UKV_LONG else 1.0)
            X.append(win[ok]); WX.append(np.full(ok.sum(), w))
            if ok24.any():
                S24.append(s24[ok24]); W24.append(np.full(ok24.sum(), w))
            if k in stitch:
                base, at_seam, since = stitch[k]
                since &= ok
                m = min(len(base), len(acc[k]))
                tot = base[:m] + (acc[k][:m] - at_seam[:m])
                good = since[:m] & np.isfinite(tot).all(1)
                if good.any():
                    A.append(tot[good]); WA.append(np.full(good.sum(), w))
            elif full[k].any():
                A.append(acc[k][full[k]]); WA.append(np.full(full[k].sum(), w))
        if not X:
            log(f'T+{L}: no members'); continue
        X, WX = np.vstack(X), np.concatenate(WX)
        maps = {'snow_chance': chance(X, WX, CHANCE_CM) * 100.0}
        if S24:
            S24, W24 = np.vstack(S24), np.concatenate(W24)
            maps['snow_risk'] = risk(S24, W24).astype(np.float32)
            maps['snow_24h'] = pmm(S24, W24)
        if A:
            A, WA = np.vstack(A), np.concatenate(WA)
            maps['snow_expected'] = pmm(A, WA)
        meta = {'model': 'frost', 'run': run_iso, 'step': L, 'valid': vt.isoformat()}
        for var, v in maps.items():
            write_frame(out / var / f'{L}.bin', cells.full(v), ENC[var], {**meta, 'var': var})
        series[:, i, 0] = encode(maps['snow_expected'], ENC['snow_expected']) if 'snow_expected' in maps else 255
        series[:, i, 1] = np.rint(np.nan_to_num(maps['snow_chance'])).astype(np.uint8)
        series[:, i, 2] = maps['snow_risk'].astype(np.uint8) if 'snow_risk' in maps else 0
        if vt.hour == 0 or i == len(leads) - 1:
            snaps[vt] = [a.copy() for a in acc]
        if i % 10 == 0:
            log(f"T+{L}: {len(WX)} members, most snow expected {maps.get('snow_expected', np.zeros(1)).max():.1f} cm, "
                f"highest chance {np.nanmax(maps['snow_chance']):.0f}%, highest risk {int(maps.get('snow_risk', np.zeros(1)).max())}")
    for var in ('snow_chance', 'snow_risk', 'snow_expected', 'snow_24h'):
        have = sorted(int(p.stem) for p in (out / var).glob('*.bin')) if (out / var).exists() else []
        if have:
            write_status(out / var, run_iso, var, have)

    # each day (UTC, = the UK's in the snow season): its own snow, from the totals at its ends;
    # a member counts if it has every period of the day
    bounds = [cycle] + sorted(snaps)
    zero = [np.zeros_like(a) for a in acc]
    day_names, days = [], []
    for t0, t1 in zip(bounds[:-1], bounds[1:]):
        d0 = snaps.get(t0, zero)
        d1 = snaps[t1]
        S, W = [], []
        mid = t0 + (t1 - t0) / 2
        span = [i for i, L in enumerate(leads) if t0 < cycle + timedelta(hours=L) <= t1]
        if not span:
            continue
        for k, (j, cube) in enumerate(cubes):
            if leads[span[0]] <= j.get('from_lead', 0):
                continue
            ok = np.isfinite(np.asarray(cube[:, span[0]:span[-1] + 1, :], np.float32)).all((1, 2))
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
    out.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    keys = [k for k in a.sources.split(',') if k in SOURCES]
    jobs = plan(cycle, keys, a.horizon)
    log(f'{ENGINE}, cycle {cycle:%d %b %HZ}: ' + ', '.join(f"{j['name']} {datetime.fromisoformat(j['run']):%d %HZ}"
                                                          + (f" from T+{j['from_lead']}" if j.get('from_lead') else '') for j in jobs))
    done, failed = [], []
    with cf.ProcessPoolExecutor(a.workers) as ex:
        futs = {ex.submit(member_job, j, leads, str(work), a.members): j for j in jobs}
        for f in cf.as_completed(futs):
            try:
                d = f.result()
                for line in d.get('notes', []):
                    log('  ' + line)
                done.append(d)
            except Exception:
                tb = traceback.format_exc()
                log(f"{futs[f]['name']} failed:\n{tb}")
                failed.append({'name': futs[f]['name'], 'error': tb[-600:]})
    done = [d for d in done if d.get('path')]
    if not done:
        log('no source could be read')
        (out / 'log.txt').write_text('\n'.join(LOG))
        sys.exit(2)
    t1 = time.time()
    days = blend_all(cycle, done, leads, out)
    manifest = {
        'engine': ENGINE, 'model': 'frost', 'run': cycle.isoformat(), 'created': datetime.now(timezone.utc).isoformat(),
        'leads': leads, 'valid': [(cycle + timedelta(hours=L)).isoformat() for L in leads], 'days': days,
        'sources': [{'name': d['name'], 'key': d['key'], 'label': SOURCES[d['key']]['label'] + (' (longer run)' if d['name'].endswith('_long') else ''),
                     'run': d['run'], 'lag_h': d['lag'], 'from_lead': d.get('from_lead', 0), 'members': d['members'],
                     'periods': int(sum(d['have'])), 'problems': len(d.get('notes', []))} for d in sorted(done, key=lambda d: d['name'])],
        'failed': failed,
        'members': int(sum(d['members'] for d in done if not d['name'].endswith('_long') or d['key'] == 'ukv')),
        'seconds': {'members': round(t1 - t0), 'blend': round(time.time() - t1)},
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=1))
    shutil.rmtree(work, ignore_errors=True)
    log(f"done: {manifest['members']} members from {len(done)} sources, {len(days)} days, {time.time() - t0:.0f} s -> {out}")
    (out / 'log.txt').write_text('\n'.join(LOG))


if __name__ == '__main__':
    main()
