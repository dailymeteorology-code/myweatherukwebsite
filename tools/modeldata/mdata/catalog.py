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


def frost_entry():
    """TCM FROST, MyWeatherUK's snow model: its mirrored runs (server/tcmFrost.js), as a model."""
    import os
    from pathlib import Path
    root = Path(os.environ.get('FROST_DATA') or ('D:/MyWeatherUK-data/frost' if Path('D:/').exists() else DATA.parent / 'frost')) / 'runs'
    runs = []
    for d in sorted(root.glob('*Z'), reverse=True) if root.exists() else []:
        try:
            m = json.loads((d / 'manifest.json').read_text())
        except Exception:
            continue
        runs.append({'run': m['run'], 'steps': m['leads'], 'complete': True, 'members': m.get('members')})
    if not runs:
        return None
    return {'id': 'frost', 'label': 'TCM FROST', 'res_km': 2.0, 'grid': 'uk',
            'source': 'TCM FROST, MyWeatherUK snow model: UKV, MO Global, IFS, AIFS, GFS + IFS ENS, AIFS ENS, GEFS',
            'variables': ['snow_risk', 'snow_chance', 'snow_expected', 'snow_24h'], 'runs': runs}


def prune_icon_raw(keep_hours=30, cap_gb=40.0):
    """ICON-EU's fetched files (models.ICON._msg): runs older than `keep_hours` go (DWD itself keeps
    about a day), then the oldest runs until the whole is under `cap_gb`; half-written files go too."""
    import shutil
    from .models import ICON_RAW
    if not ICON_RAW.exists():
        return
    now = datetime.now(timezone.utc)
    runs = []
    for p in ICON_RAW.iterdir():
        if p.is_dir() and len(p.name) == 10 and p.name.isdigit():
            age = (now - datetime.strptime(p.name, '%Y%m%d%H').replace(tzinfo=timezone.utc)).total_seconds() / 3600
            if age > keep_hours:
                shutil.rmtree(p, ignore_errors=True)
            else:
                runs.append(p)
        elif p.name.endswith('.tmp') and time.time() - p.stat().st_mtime > 3600:
            p.unlink(missing_ok=True)
    import os
    # scandir: on Windows each entry's size comes with the directory listing, no file is opened
    sizes = {p: sum(e.stat().st_size for e in os.scandir(p) if e.is_file()) for p in runs}
    total = sum(sizes.values())
    for p in sorted(runs, key=lambda x: x.name):                 # oldest first, never the newest run
        if total <= cap_gb * 1e9 or p == max(runs, key=lambda x: x.name):
            break
        shutil.rmtree(p, ignore_errors=True)
        total -= sizes[p]
    for p in runs:
        if p.exists():
            for f in p.glob('*.tmp'):
                if time.time() - f.stat().st_mtime > 3600:
                    f.unlink(missing_ok=True)


def mix_entry(models):
    """MWUK Mix, MyWeatherUK's UKV + ICON-EU blend (mdata/mix.py): its runs paired from the UKV's and
    ICON's entries."""
    from .mix import MixModel, pairs
    by = {m['id']: m for m in models}
    if not by.get('ukv', {}).get('runs') or not by.get('icon', {}).get('runs'):
        return None
    m = MixModel()
    return {'id': 'mix', 'label': m.label, 'res_km': m.res_km, 'grid': grid_of('mix'), 'source': SOURCES['mix'], 'variables': m.variables,
            'runs': pairs(by['ukv']['runs'], by['icon']['runs'])}


def prune(keep_hours=36):
    """Frames of runs older than `keep_hours` (relative to the newest run of that model)."""
    import shutil
    try:
        prune_icon_raw()
    except Exception:
        pass
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
        models = list(ex.map(model_entry, [m for m in MODELS.values() if m.id not in ('mix', 'consensus')]))
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
    frost = frost_entry()
    if frost:
        models.append(frost)
    mix = mix_entry(models)
    if mix:
        models.append(mix)
    try:                                                  # MWUK Consensus: its runs from its members' (mdata/consensus.py)
        from .consensus import catalog_entry as consensus_entry
        cons = consensus_entry([m for m in models if m['id'] != 'mix'])
        if cons:
            if 'consensus' in MODELS:
                cons['variables'] = list(MODELS['consensus'].variables)
            models.append(cons)
    except Exception as e:                                # noqa: BLE001
        print('consensus listing failed:', e)
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
