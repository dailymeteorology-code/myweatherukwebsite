"""Which runs exist right now, for every model -> catalog.json (refreshed by the server).

    python -m mdata.catalog
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import time
import warnings
from datetime import datetime, timezone

from .common import DATA, GRIDS, frames_root, grid_meta, grid_of, write_json
from .models import MODELS, SOURCES, VARIABLES


def complete(m, r, steps, runs):
    """Is the run fully published? Models with a fixed schedule: every step of it is there. The UKV:
    T+120 from 03Z and 15Z, T+54 every three hours, T+12 otherwise. Met Office Global: as far as the
    other runs at that hour reach, or (with none listed) eight hours old, as it publishes slowly."""
    if not steps:
        return False
    if m.id == 'ukv':
        return steps[-1] >= (120 if r.hour in (3, 15) else 54 if r.hour % 3 == 0 else 12)
    if hasattr(m, 'schedule'):
        try:
            return steps[-1] >= m.schedule(r)[-1]
        except Exception:
            pass
    peers = [s[-1] for rr, s in runs if rr != r and rr.hour == r.hour and s]
    if peers:
        return steps[-1] >= max(peers)
    return (datetime.now(timezone.utc) - r).total_seconds() >= 8 * 3600


def model_entry(m):
    try:
        runs = m.runs()
    except Exception as e:
        return {'id': m.id, 'error': str(e)[:200], 'runs': []}
    return {'id': m.id, 'label': m.label, 'res_km': m.res_km, 'grid': grid_of(m.id), 'source': SOURCES[m.id], 'variables': m.variables,
            'runs': [dict({'run': r.isoformat(), 'steps': s, 'complete': complete(m, r, s, runs)},
                          **({'kept': True} if r in getattr(m, 'kept_runs', ()) else {}))
                     for r, s in runs]}


def prune(keep_hours=36):
    """Frames of runs older than `keep_hours` (relative to the newest run of that model)."""
    import shutil
    model_dirs = []
    for g in GRIDS:                                        # every grid keeps its own frames
        root = frames_root(g)
        model_dirs += [m for m in root.glob('*') if m.name != 'ens'] + list((root / 'ens').glob('*'))
    for md in model_dirs:
        runs = sorted(p for p in md.iterdir() if p.is_dir() and len(p.name) == 14)
        if not runs:
            continue
        newest = datetime.strptime(runs[-1].name, '%Y%m%dT%H%MZ')
        for p in runs:
            if (newest - datetime.strptime(p.name, '%Y%m%dT%H%MZ')).total_seconds() > keep_hours * 3600:
                shutil.rmtree(p, ignore_errors=True)


def main():
    logging.disable(logging.WARNING)
    warnings.filterwarnings('ignore')
    t = time.time()
    old = {}
    try:
        old = {m['id']: m for m in json.loads((DATA / 'catalog.json').read_text())['models']}
    except Exception:
        pass
    from . import ens
    with cf.ThreadPoolExecutor(len(MODELS) + 1) as ex:
        ens_fut = ex.submit(ens.catalog_entries)
        models = list(ex.map(model_entry, MODELS.values()))
        ensembles = ens_fut.result()
    # a model whose listing failed this time keeps its last good runs
    models = [m if m['runs'] or m['id'] not in old else dict(old[m['id']], stale=True) for m in models]
    old_ens = {}
    try:
        old_ens = {m['id']: m for m in json.loads((DATA / 'catalog.json').read_text()).get('ensembles', [])}
    except Exception:
        pass
    ensembles = [m if m['runs'] or m['id'] not in old_ens else dict(old_ens[m['id']], stale=True) for m in ensembles]
    ensembles = [dict(m, grid=grid_of(m['id'])) for m in ensembles]
    write_json(DATA / 'catalog.json', {
        'generated': datetime.now(timezone.utc).isoformat(), 'grid': grid_meta('uk'), 'grids': {g: grid_meta(g) for g in GRIDS},
        'variables': VARIABLES, 'models': models, 'ensembles': ensembles, 'ens_fields': ens.FIELDS})
    try:
        prune()
    except Exception:
        pass
    print(f'catalog: {[(m["id"], len(m["runs"])) for m in models + ensembles]} in {time.time() - t:.0f} s')


if __name__ == '__main__':
    main()
