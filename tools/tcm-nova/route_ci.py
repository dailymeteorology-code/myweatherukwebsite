"""What is due now? Run by the GitHub 'route' job every 10 minutes (stdlib only).

GitHub drops or delays a large share of scheduled triggers (on 19 Oct 2026 only 13 of
~30 fired), so jobs are NOT keyed to which cron fired. Every trigger asks the published
state instead -- the latest run in each release and any run already in progress -- and
starts whatever is missing. A dropped trigger is then simply caught by the next one.

Writes GitHub step outputs: main, main_init, main_chunks, main_publisher, hyper, hyper_init,
ukv_env, ukv_env_cycle, ukv_env_chunks, learning, learning_day.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

REPO = os.environ.get('GITHUB_REPOSITORY', 'dailymeteorology-code/myweatherukwebsite')
LONDON = ZoneInfo('Europe/London')
MAIN_CYCLES = (3, 9, 15, 21)                 # UK wall clock
#: Bump when the Main Run engine changes: the current cycle is then re-run with it.
MAIN_ENGINE = 'nova-v5-2.2'
MAIN_LEADS = list(range(0, 97, 3))
MAIN_JOBS = 17
UKV_BUCKET = 'https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com'
HYPER_ENV_HOURS = list(range(0, 13)) + list(range(15, 25, 3))
ENV_JOBS = 6


def latest(tag):
    url = f'https://github.com/{REPO}/releases/download/{tag}/latest.json'
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def run_init(run_id):
    """'main-20261019T0200Z' -> datetime."""
    try:
        return datetime.strptime(run_id.split('-', 1)[1], '%Y%m%dT%H%MZ').replace(tzinfo=timezone.utc)
    except Exception:
        return None


def main_cycle(now):
    loc = now.astimezone(LONDON)
    best = None
    for dd in (0, -1):
        day = (loc + timedelta(days=dd)).date()
        for h in MAIN_CYCLES:
            t = datetime(day.year, day.month, day.day, h, tzinfo=LONDON)
            if t <= loc and (best is None or t > best):
                best = t
    return best.astimezone(timezone.utc)


_ACTIVE_JOBS = None


def active_jobs():
    """Names of the jobs not yet completed in OTHER runs of this workflow that are queued or
    running. Listed once per route (the route is on the Main Run's critical path)."""
    global _ACTIVE_JOBS
    if _ACTIVE_JOBS is not None:
        return _ACTIVE_JOBS
    me = os.environ.get('GITHUB_RUN_ID')
    try:
        runs = json.loads(subprocess.run(
            ['gh', 'api', f'repos/{REPO}/actions/workflows/nova.yml/runs?per_page=30'],
            capture_output=True, text=True, timeout=60).stdout or '{}').get('workflow_runs', [])
    except Exception:
        runs = []
    names = []
    for r in runs:
        if str(r['id']) == me or r['status'] not in ('queued', 'in_progress', 'waiting', 'pending'):
            continue
        try:
            jobs = json.loads(subprocess.run(['gh', 'api', f'repos/{REPO}/actions/runs/{r["id"]}/jobs?per_page=100'],
                                             capture_output=True, text=True, timeout=60).stdout or '{}').get('jobs', [])
        except Exception:
            continue
        names += [j['name'] for j in jobs if j['status'] != 'completed']
    _ACTIVE_JOBS = names
    return names


def in_progress(job_prefix):
    """True if another run of this workflow has a job starting with `job_prefix` that is
    queued or running (so a second trigger never starts the same work twice)."""
    return any(n.startswith(job_prefix) for n in active_jobs())


def latest_ukv_cycle(now, reach_h=27):
    """Newest UKV cycle on AWS that reaches `reach_h` hours past the current hour (most
    hourly cycles stop at T+12; only some run to T+54 and beyond)."""
    t = now.replace(minute=0, second=0, microsecond=0)
    for k in range(1, 13):
        c = t - timedelta(hours=k)
        vt = t + timedelta(hours=reach_h)
        lead = int((vt - c).total_seconds() // 3600)
        url = (f'{UKV_BUCKET}/uk-deterministic-2km/{c:%Y%m%dT%H%MZ}/{vt:%Y%m%dT%H%MZ}-PT{lead:04d}H00M-'
               f'temperature_on_pressure_levels.nc')
        try:
            urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=20)
            return c
        except Exception:
            continue
    return None


def chunks(items, n):
    n = max(1, min(n, len(items)))
    out = [[] for _ in range(n)]
    for i, x in enumerate(items):
        out[i % n].append(x)
    return [','.join(str(v) for v in c) for c in out if c]


def decide(now, force=''):
    out = {'main': 'false', 'hyper': 'false', 'ukv_env': 'false', 'learning': 'false'}
    # Main Run
    cyc = main_cycle(now)
    lm = latest('nova-main')
    have = run_init(lm.get('run_id', ''))
    if have is not None and have >= cyc and lm.get('engine') != MAIN_ENGINE:
        have = None                                  # made by an older engine: redo this cycle
    out['main_init'] = cyc.isoformat()
    mc = chunks(MAIN_LEADS, MAIN_JOBS)
    out['main_chunks'] = json.dumps(mc)
    # the chunk with the fewest leads finishes first, so it gathers the others and publishes
    out['main_publisher'] = min(reversed(mc), key=lambda c: len(c.split(',')))
    if force == 'main' or ((have is None or have < cyc) and not in_progress('main')):
        out['main'] = 'true'
    # UKV V5 environment for Hyper-Short: as soon as a newer UKV cycle is on AWS
    ukv = latest_ukv_cycle(now)
    env_have = latest('nova-ukvenv').get('cycle')
    if ukv is not None:
        out['ukv_env_cycle'] = ukv.isoformat()
        hour = now.replace(minute=0, second=0, microsecond=0)
        # every valid hour the next three hourly Hyper-Short runs can ask for (hour .. hour+26)
        first = int((hour - ukv).total_seconds() // 3600)
        hours = list(range(first, first + 27))   # the cycle reaches first + 27 (checked)
        out['ukv_env_chunks'] = json.dumps(chunks(hours, ENV_JOBS))
        if force == 'ukv_env' or (env_have != ukv.isoformat() and not in_progress('ukv-env')):
            out['ukv_env'] = 'true'
    # Hyper-Short: once per UTC hour
    hour = now.replace(minute=0, second=0, microsecond=0)
    hh = run_init(latest('nova-hyper').get('run_id', ''))
    out['hyper_init'] = hour.isoformat()
    if force == 'hyper' or ((hh is None or hh < hour) and not in_progress('hyper')):
        out['hyper'] = 'true'
    # Nightly learning (yesterday, UK day), from 00:20 UK time
    loc = now.astimezone(LONDON)
    yday = (loc - timedelta(days=1)).date().isoformat()
    st = latest('nova-state')
    if force == 'learning' or (loc.hour * 60 + loc.minute >= 20 and st.get('day', '') < yday
                               and not in_progress('learning')):
        out['learning'] = 'true'
        out['learning_day'] = yday
    return out


if __name__ == '__main__':
    force = sys.argv[1] if len(sys.argv) > 1 else ''
    res = decide(datetime.now(timezone.utc), '' if force in ('', 'auto') else force)
    print(json.dumps(res, indent=1), file=sys.stderr)
    gh = os.environ.get('GITHUB_OUTPUT')
    if gh:
        with open(gh, 'a') as f:
            for k, v in res.items():
                f.write(f'{k}={v}\n')
