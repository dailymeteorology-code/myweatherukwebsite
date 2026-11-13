"""Which TCM FROST cycle to run now (GitHub Actions): the newest cycle, from 18Z yesterday onwards,
that every source has published (8.5 h after its time: the ECMWF ensemble is last, ~8 h 15 min
for 00Z and 12Z) and that is not yet in the release. Printed for $GITHUB_OUTPUT:

    cycle=YYYYmmddHH      (nothing when all are done)
    more=N                how many more are waiting after it (the workflow starts itself again)

GitHub fires scheduled runs irregularly, so nothing here depends on which trigger fired: a run
that never started is simply picked up by the next.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta, timezone

READY_H = 8.5
RELEASE = 'tcm-frost'


def published():
    r = subprocess.run(['gh', 'release', 'view', RELEASE, '--json', 'assets'], capture_output=True, text=True)
    if r.returncode:
        return set()
    return {a['name'] for a in json.loads(r.stdout).get('assets', [])}


def due(now=None, have=None):
    now = now or datetime.now(timezone.utc)
    have = published() if have is None else have
    start = (now - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    t = now.replace(minute=0, second=0, microsecond=0)
    t -= timedelta(hours=t.hour % 6)
    out = []
    while t >= start:
        if t + timedelta(hours=READY_H) <= now and f'frost-{t:%Y%m%d%H}.tar.gz' not in have:
            out.append(t)
        t -= timedelta(hours=6)
    return out


def main():
    d = due()
    if d:
        print(f'cycle={d[0]:%Y%m%d%H}')
        print(f'more={len(d) - 1}')


if __name__ == '__main__':
    main()
