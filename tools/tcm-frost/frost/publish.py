"""Publish a TCM FROST run as a GitHub Release asset (release 'tcm-frost'), and drop the runs the
site no longer keeps (older than 48 h). The site mirrors the release (server/tcmFrost.js).

    python -m frost.publish --cycle YYYYmmddHH --out DIR
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import tarfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import KEEP_H
from .route import RELEASE


def gh(*args, check=True):
    return subprocess.run(['gh', *args], capture_output=True, text=True, check=check)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cycle', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    cycle = datetime.strptime(a.cycle, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    tag = f'{cycle:%Y%m%dT%H%M}Z'
    run = Path(a.out) / tag
    if not (run / 'manifest.json').exists():
        raise SystemExit(f'no run at {run}')
    asset = Path(a.out) / f'frost-{a.cycle}.tar.gz'
    with tarfile.open(asset, 'w:gz', compresslevel=6) as t:
        t.add(run, arcname=tag)
    if gh('release', 'view', RELEASE, check=False).returncode:
        gh('release', 'create', RELEASE, '--title', 'TCM FROST',
           '--notes', 'TCM FROST snow model runs (UK and Ireland, 2 km, 10 days). One asset per 6-hourly run; the last 48 h are kept.')
    gh('release', 'upload', RELEASE, str(asset), '--clobber')
    print(f'published {asset.name} ({asset.stat().st_size / 1e6:.1f} MB)')
    cut = datetime.now(timezone.utc) - timedelta(hours=KEEP_H + 6)
    assets = json.loads(gh('release', 'view', RELEASE, '--json', 'assets').stdout).get('assets', [])
    for x in assets:
        m = re.fullmatch(r'frost-(\d{10})\.tar\.gz', x['name'])
        if m and datetime.strptime(m[1], '%Y%m%d%H').replace(tzinfo=timezone.utc) < cut:
            gh('release', 'delete-asset', RELEASE, x['name'], '-y', check=False)
            print(f'dropped {x["name"]}')


if __name__ == '__main__':
    main()
