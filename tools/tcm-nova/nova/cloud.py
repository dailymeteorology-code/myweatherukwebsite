"""Run NOVA jobs on GitHub Actions and publish their results as GitHub Release assets.

    python -m nova.cloud fetch-static          # terrain etc. from release nova-static (build + upload if missing)
    python -m nova.cloud fetch-state           # skill / calibration / NOVA-AI / learning pairs
    python -m nova.cloud publish main|hyper    # tar the newest run(s) and upload, prune old assets
    python -m nova.cloud publish-state         # upload skill / calibration / NOVA-AI / pairs / reports
    python -m nova.cloud fetch-runs main|hyper --day YYYY-MM-DD   # runs valid on a day (for learning)
    python -m nova.cloud lightning             # archive LEELA strikes per UK day (release nova-lightning)

Releases (tags) used, all in this public repo:
    nova-static     terrain-*.npz/json, pseudo-adiabat table, ICON-EPS mapping   (rarely changes)
    nova-main       <run_id>.tar.gz  (+ <run_id>.sources.tar.gz)                   latest 8 runs
    nova-hyper      <run_id>.tar.gz                                                latest 36 runs
    nova-state      skill.json, calibration.json, nova_ai.json, pairs.tar.gz, reports.tar.gz
    nova-lightning  YYYY-MM-DD.json   (UK & Ireland strikes per UK calendar day)
Uses the `gh` CLI that GitHub runners provide, authenticated by GITHUB_TOKEN.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tarfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import CACHE, DATA
from .io_aws import log

KEEP = {'nova-main': 8, 'nova-hyper': 36}


def gh(*args, check=True, capture=False):
    r = subprocess.run(['gh', *args], check=check, text=True, capture_output=capture)
    return r.stdout if capture else r.returncode


def ensure_release(tag, title):
    """Create the release if missing. Parallel jobs may race to create it: a failed create is
    fine as long as the release exists afterwards."""
    if gh('release', 'view', tag, check=False) == 0:
        return
    gh('release', 'create', tag, '--title', title, '--notes', f'{title} — published automatically by the TCM NOVA workflow.',
       '--latest=false', check=False)
    if gh('release', 'view', tag, check=False) != 0:
        raise RuntimeError(f'could not create release {tag}')


def assets(tag):
    out = gh('release', 'view', tag, '--json', 'assets', check=False, capture=True) or '{}'
    try:
        return json.loads(out).get('assets', [])
    except Exception:
        return []


def download(tag, pattern, dest):
    Path(dest).mkdir(parents=True, exist_ok=True)
    return gh('release', 'download', tag, '--pattern', pattern, '--dir', str(dest), '--clobber', check=False) == 0


def upload(tag, *files, required=True):
    rc = gh('release', 'upload', tag, *map(str, files), '--clobber', check=False)
    if rc != 0 and required:
        raise RuntimeError(f'upload to {tag} failed: {[str(f) for f in files]}')


def fetch_static():
    ensure_release('nova-static', 'TCM NOVA static data')
    ok = download('nova-static', 'gb*-terrain-*', DATA / 'terrain')
    download('nova-static', 'pseudoadiabat_*.npy', CACHE)
    download('nova-static', 'icon_eu_eps_map_*.npz', CACHE)
    from . import terrain
    from . import v5_blend  # noqa: F401  (registers the V5 grid)
    need = [g for g in ('gb2km', 'gb1p5km', 'gb_v5laea2km') if not (DATA / 'terrain' / f'{g}-{terrain.TERRAIN_VERSION}.npz').exists()]
    for g in need:
        log(f'cloud: building terrain {g}')
        p = terrain.build(g)
        upload('nova-static', p, p.with_suffix('.json'), required=False)     # a parallel job may have uploaded it
    from . import thermo
    thermo._table()
    for f in CACHE.glob('pseudoadiabat_*.npy'):
        if not ok:
            upload('nova-static', f, required=False)


def publish(product):
    tag = f'nova-{product}'
    ensure_release(tag, f'TCM NOVA {product} runs')
    have = {a['name'] for a in assets(tag)}
    runs = sorted(p for p in (DATA / product).glob(f'{product}-*') if p.is_dir() and not p.name.endswith('.partial'))
    for rd in runs[-2:]:
        name = f'{rd.name}.tar.gz'
        if name in have:
            continue
        tgz = DATA / name
        with tarfile.open(tgz, 'w:gz', compresslevel=1) as t:
            t.add(rd, arcname=rd.name, filter=lambda ti: None if '/sources' in ti.name.replace('\\', '/') else ti)
        upload(tag, tgz)
        tgz.unlink()
        if (rd / 'sources').exists():
            stg = DATA / f'{rd.name}.sources.tar.gz'
            with tarfile.open(stg, 'w:gz', compresslevel=1) as t:
                t.add(rd / 'sources', arcname=f'{rd.name}/sources')
            upload(tag, stg)
            stg.unlink()
        log(f'cloud: published {name}')
    latest = DATA / product / 'latest.json'
    if latest.exists():
        upload(tag, latest)
    prune(tag)


def prune(tag):
    names = sorted(a['name'] for a in assets(tag) if a['name'].endswith('.tar.gz') and not a['name'].endswith('.sources.tar.gz'))
    for n in names[:-KEEP.get(tag, 10)]:
        for victim in (n, n.replace('.tar.gz', '.sources.tar.gz')):
            gh('release', 'delete-asset', tag, victim, '--yes', check=False)


def fetch_state():
    ensure_release('nova-state', 'TCM NOVA learning state')
    download('nova-state', '*.json', DATA)
    for arch in ('pairs.tar.gz', 'reports.tar.gz'):
        if download('nova-state', arch, DATA / '_dl'):
            with tarfile.open(DATA / '_dl' / arch) as t:
                t.extractall(DATA / 'learning', filter='data')


def publish_state():
    ensure_release('nova-state', 'TCM NOVA learning state')
    files = [DATA / f for f in ('skill.json', 'calibration.json', 'nova_ai.json') if (DATA / f).exists()]
    for sub in ('pairs', 'reports'):
        d = DATA / 'learning' / sub
        if d.exists():
            tgz = DATA / f'{sub}.tar.gz'
            with tarfile.open(tgz, 'w:gz') as t:
                t.add(d, arcname=sub)
            files.append(tgz)
    if (DATA / 'learning' / 'latest.json').exists():
        files.append(DATA / 'learning' / 'latest.json')
    if files:
        upload('nova-state', *files)


def fetch_runs(product, day):
    """Download the runs whose frames fall on `day` (UK) so the learning job can verify them."""
    tag = f'nova-{product}'
    d0 = datetime.fromisoformat(day).replace(tzinfo=ZoneInfo('Europe/London'))
    lo, hi = (d0 - timedelta(days=4 if product == 'main' else 1)), d0 + timedelta(days=1)
    for a in assets(tag):
        n = a['name']
        if not n.endswith('.tar.gz'):
            continue
        try:
            init = datetime.strptime(n.split('-')[1][:14], '%Y%m%dT%H%MZ').replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if lo <= init <= hi:
            if download(tag, n, DATA / '_dl'):
                with tarfile.open(DATA / '_dl' / n) as t:
                    t.extractall(DATA / product, filter='data')


def lightning():
    """Archive LEELA (48 h) per UK calendar day, merged with what is already archived."""
    from .hyper import obs
    ensure_release('nova-lightning', 'TCM NOVA lightning archive')
    now = datetime.now(timezone.utc)
    strikes, _ = obs.lightning(now, 2880)
    tz = ZoneInfo('Europe/London')
    by_day = {}
    for t, la, lo in strikes:
        if 49.0 <= la <= 61.5 and -11.5 <= lo <= 2.5:
            by_day.setdefault(t.astimezone(tz).date().isoformat(), set()).add((int(t.timestamp() * 1000), round(la, 4), round(lo, 4)))
    out = DATA / 'lightning'
    out.mkdir(parents=True, exist_ok=True)
    for day, s in by_day.items():
        f = out / f'{day}.json'
        download('nova-lightning', f'{day}.json', out)
        if f.exists():
            try:
                s |= {tuple(x) for x in json.loads(f.read_text())['strikes']}
            except Exception:
                pass
        rows = sorted(s)
        f.write_text(json.dumps({'day': day, 'source': 'Met Office LEELA, archived by TCM NOVA', 'count': len(rows),
                                 'fields': ['time_ms', 'lat', 'lon'], 'strikes': rows}))
        upload('nova-lightning', f)
        log(f'cloud: lightning {day}: {len(rows)} strikes')



def publish_ukvenv(cycle_iso):
    """Upload Hyper-Short's V5 UKV environment for one cycle, then point latest.json at it."""
    tag = 'nova-ukvenv'
    ensure_release(tag, 'TCM NOVA Hyper-Short UKV environment (TCM V5)')
    cyc = datetime.fromisoformat(cycle_iso.replace('Z', '+00:00')).astimezone(timezone.utc)
    d = CACHE / 'ukvenv' / f'{cyc:%Y%m%dT%H%MZ}'
    files = sorted(d.glob('*.npz')) if d.exists() else []
    if not files:
        raise RuntimeError(f'no environment files for {cyc:%Y%m%dT%H%MZ}')
    staged = []
    for f in files:
        t = d / f'{d.name}_{f.name}'
        t.write_bytes(f.read_bytes())
        staged.append(t)
    upload(tag, *staged)
    for t in staged:
        t.unlink()
    latest = d / 'latest.json'
    latest.write_text(json.dumps({'cycle': cyc.isoformat(), 'hours': len(files)}))
    upload(tag, latest)
    keep = sorted({a['name'].split('_')[0] for a in assets(tag) if a['name'].endswith('.npz')})[-2:]
    for a in assets(tag):
        n = a['name']
        if n.endswith('.npz') and n.split('_')[0] not in keep:
            gh('release', 'delete-asset', tag, n, '--yes', check=False)
    log(f'cloud: published UKV environment {d.name} ({len(files)} hours)')


def fetch_ukvenv():
    """Download the newest published V5 UKV environment into the cache Hyper-Short reads."""
    tag = 'nova-ukvenv'
    tmp = CACHE / '_ukvenv'
    if not download(tag, 'latest.json', tmp):
        log('cloud: no published UKV environment yet')
        return
    cyc = datetime.fromisoformat(json.loads((tmp / 'latest.json').read_text())['cycle'])
    name = f'{cyc:%Y%m%dT%H%MZ}'
    download(tag, f'{name}_*.npz', tmp)
    d = CACHE / 'ukvenv' / name
    d.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in tmp.glob(f'{name}_*.npz'):
        os.replace(f, d / f.name.split('_', 1)[1])
        n += 1
    log(f'cloud: UKV environment {name}: {n} hours')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['fetch-static', 'fetch-state', 'publish', 'publish-state', 'fetch-runs', 'lightning', 'publish-ukvenv', 'fetch-ukvenv'])
    ap.add_argument('product', nargs='?')
    ap.add_argument('--day')
    a = ap.parse_args()
    {'fetch-static': fetch_static, 'fetch-state': fetch_state, 'publish-state': publish_state, 'lightning': lightning,
     'publish': lambda: publish(a.product), 'fetch-runs': lambda: fetch_runs(a.product, a.day),
     'publish-ukvenv': lambda: publish_ukvenv(a.product), 'fetch-ukvenv': fetch_ukvenv}[a.cmd]()
