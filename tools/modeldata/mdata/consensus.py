"""MWUK (named MWUK Consensus until 16 Nov 2026): the middle of every model's forecast (16 Nov 2026, at the user's request: "a
consensus map, the median of all models", with "an agreement / spread layer").

Members. The nine single models that cover the whole of the UK and Ireland: the Met Office UKV and
Global, ECMWF IFS and AIFS, NOAA GFS and AIGFS, DWD ICON-EU, Canada's GDPS and Meteo-France's ARPEGE.
Blends and ensemble means are left out (they would count a model twice, or a smoothed one), and so are
the models that cover only part of the map (AROME, HARMONIE), whose edges would show as seams.

Runs. A Consensus run is named by a main hour (00, 06, 12 or 18 UTC). It is listed once at least
three members have a whole run of that hour and six or more have one no more than 12 hours older:
each member gives its newest whole run of that hour or before that reaches two days or more, so a slow
model takes part with its last run. Who takes part is fixed the first time the run is listed
(DATA/consensus.json), so its frames never mix two sets of models.

Tails (17 Nov 2026, the user: "if you can extend the range of the model, please do"). Some members' runs
end early at some hours: the ECMWF IFS's 06 and 18 UTC runs at six days (its 00 and 12 UTC runs at
fifteen), the Met Office Global's 06 and 18 UTC runs at two and a half (its 00 and 12 UTC runs at
seven), most UKV runs at T+54 (its 03 and 15 UTC runs at T+120). After the IFS dropped out only AIFS,
GFS and AIGFS were left past GDPS's ten days, and the runs stopped there. A member whose run ends early
now carries on with its newest longer run no more than 12 hours older (_tails), for the valid times its
main run does not reach only, so it counts once at every step. MWUK reaches T+360 with four members.
A run listed before tails were kept uses them only past the last step it had (`tfrom`), so the frames
already made keep their members.

Steps. Every three hours to T+120, then every six to T+360, while at least four members reach that
far; a member with no step at that valid time is drawn between its two nearest steps.

Layers, on the UKV's 2 km grid (the global models drawn up onto it smoothly):
  * precip_rate, t2, mslp, wind10, gust10, tcc, t850, z500 and (17 Nov 2026, the user: "any more
    variables you can add to the MWUK model") every layer most members give: the dew point, the ground
    and sea temperature, wind chill, temperature at 925, 700 and 500 hPa, humidity at 850 and 700 hPa,
    the 850 hPa height, the 1000-500 hPa thickness, wind at 925, 850, 700, 500, 300 and 250 hPa, vertical
    motion at 700 hPa, vorticity at 500 hPa, low, medium and high cloud, visibility, sunshine (downward
    solar radiation), CAPE and precipitable water: the median of the members that give it (MEDIAN);
  * precip_total, snow_total: the median of each member's total since this run's own time (TOTALS:
    a member's run can start up to 12 hours earlier); snow_acc is snow_total in cm at 10:1;
  * wdir10: the direction of the members' mean wind;
  * rain_agree: the share of the members giving rain there (0.2 mm/h or more);
  * t2_spread, mslp_spread: how far apart the members are (their standard deviation);
  * ptype: the precipitation rate's median (precip_rate) in the kind the members give where it falls
    (16 Nov 2026, at the user's request: ConsensusModel._ptype).
The layers made from those (mdata/recipes.py: wet-bulb, humidity, humidex, cloud base, frost risk,
the 850 hPa dew point and wet-bulb potential temperature, lapse rates, Total Totals, K-index, 6 and 24
hour totals...) come by themselves, as for every model (models.py add_recipes).
A member's layers that are not made yet are made first: those on this grid here, those on the wide
grid each in a process of its own (a process works on one grid, mdata/common.py).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import DATA, GRID, GRIDS, ROOT, STATIC, frames_root, grid_of, lonlat, read_frame, smooth_sample, write_json

try:
    from .common import _cubic_kernel                  # numba's smooth sampler (_up_at: some cells only)
except ImportError:
    _cubic_kernel = None

MEMBERS = ('ukv', 'icon', 'mo_global', 'ifs', 'aifs', 'gfs', 'aigfs', 'gdps', 'arpege')
MEDIAN = ['precip_rate', 't2', 'mslp', 'wind10', 'gust10', 'tcc', 't850', 'z500',
          # 17 Nov 2026: every layer five or more of the nine give (the recipes made from them come by themselves)
          'td2', 'tskin', 'windchill', 't925', 't700', 't500', 'rh850', 'rh700', 'z850', 'thick',
          'wind925', 'wind850', 'wind700', 'wind500', 'wind300', 'wind250', 'w700', 'vort500',
          'lcc', 'mcc', 'hcc', 'vis', 'sw_down', 'cape_mu', 'pw']
TOTALS = ['precip_total', 'snow_total']                # running totals: each member's since this run's own time
VARS = MEDIAN + TOTALS + ['snow_acc', 'ptype', 'wdir10', 'rain_agree', 't2_spread', 'mslp_spread']
SRC_OF = {'rain_agree': ['precip_rate'], 't2_spread': ['t2'], 'mslp_spread': ['mslp'], 'wdir10': ['wind10', 'wdir10'],
          'ptype': ['ptype']}          # the eight members with a type (not AIGFS); its rate is precip_rate's, all nine
RAIN = 0.2                     # mm/h: a member gives rain there
MIN_MEMBERS = 4                # a step is listed while at least this many members reach it
MIN_NOW = 3                    # and made while at least this many have a frame there
MIN_TYPED = 2                  # ptype: its rate from those, its kind while two give one (few do past T+144)
STATE = DATA / 'consensus.json'
LEADS = list(range(0, 121, 3)) + list(range(126, 361, 6))   # to T+360 (16 Nov 2026): GFS, IFS, AIFS and AIGFS reach it

SOURCE_CONS = ('MWUK: the median of nine models (Met Office UKV and Global, ECMWF IFS and AIFS, NOAA GFS and AIGFS, '
               'DWD ICON-EU, ECCC GDPS, Meteo-France ARPEGE), on the UKV 2 km grid')
VARIABLES_CONS = {
    'rain_agree': dict(label='Models showing rain', unit='%', group='Precipitation', lo=0, hi=100),
}

_LOCK = threading.Lock()
_POOL = ThreadPoolExecutor(6, thread_name_prefix='consensus-member')   # members' layers being made here, a few at once
_JOBS = {}                                                             # (model, run iso, var) -> its Future
_COMBINE = threading.Semaphore(3)                                      # nine full fields at once is ~40 MB: a few steps at a time


def _utc(s):
    return datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(timezone.utc)


def _choose(models, R):
    """Each member's run for a Consensus run R, from the catalogue's entries: its newest whole run of
    R's hour or before, reaching two days or more, no more than 12 hours older than R."""
    by = {m['id']: m for m in models}
    out = {}
    for mid in MEMBERS:
        best = None
        for r in by.get(mid, {}).get('runs', []):
            t = _utc(r['run'])
            if t > R or R - t > timedelta(hours=12) or not r.get('complete') or not r.get('steps') or max(r['steps']) < 48:
                continue
            if best is None or t > best[0]:
                best = (t, r['steps'])
        if best:
            out[mid] = best
    return out


def _reaches(t, st, vt):
    """Does a run made at t with these steps reach the valid time vt?"""
    return bool(st) and st[0] <= (vt - t).total_seconds() / 3600 <= st[-1]


def _tails(models, R, main):
    """Each member's longer run, where its main run ends early (the module's Tails): its newest whole run
    older than the main one, no more than 12 hours older than R, reaching at least half a day further."""
    by = {m['id']: m for m in models}
    out = {}
    for mid, (t0, st0) in main.items():
        end0 = t0 + timedelta(hours=max(st0))
        best = None
        for r in by.get(mid, {}).get('runs', []):
            t = _utc(r['run'])
            if t >= t0 or R - t > timedelta(hours=12) or not r.get('complete') or not r.get('steps'):
                continue
            if t + timedelta(hours=max(r['steps'])) - end0 < timedelta(hours=12):
                continue
            if best is None or t > best[0]:
                best = (t, r['steps'])
        if best:
            out[mid] = best
    return out


def _steps(R, chosen, tails=None, tfrom=-1):
    """The leads a run has: those at least MIN_MEMBERS members reach, a member by its main run or, past the
    lead tfrom, by its tail run where the main one does not reach (once either way)."""
    tails = tails or {}
    out = []
    for h in LEADS:
        vt = R + timedelta(hours=h)
        n = sum(1 for m, (t, st) in chosen.items()
                if _reaches(t, st, vt) or (h > tfrom and m in tails and _reaches(*tails[m], vt)))
        if n >= MIN_MEMBERS:
            out.append(h)
    return out


def catalog_entry(models, save=True):
    """The Consensus's catalogue entry from the members' entries (the last day's runs, newest first),
    who takes part in each run fixed the first time it is listed."""
    try:
        state = json.loads(STATE.read_text())
    except Exception:
        state = {}
    now = datetime.now(timezone.utc)
    base = now.replace(minute=0, second=0, microsecond=0)
    base -= timedelta(hours=base.hour % 6)
    runs = []
    for k in range(5):
        R = base - timedelta(hours=6 * k)
        key = R.isoformat()
        if key not in state:
            chosen = _choose(models, R)
            if len(chosen) < 6 or sum(1 for t, _ in chosen.values() if t == R) < 3:
                continue
            tails = _tails(models, R, chosen)
            state[key] = {'members': {m: t.isoformat() for m, (t, _) in chosen.items()},
                          'msteps': {m: st for m, (_, st) in chosen.items()},
                          'tails': {m: t.isoformat() for m, (t, _) in tails.items()},
                          'tsteps': {m: st for m, (_, st) in tails.items()}, 'tfrom': -1, 'listed': now.isoformat()}
        s = state[key]
        main = {m: (_utc(t), s['msteps'][m]) for m, t in s['members'].items()}
        if 'tails' not in s:
            # listed before tails were kept: its tails only past the last step it had, so the frames already
            # made keep their members (17 Nov 2026)
            old = _steps(R, main)
            tails = _tails(models, R, main)
            s.update({'tails': {m: t.isoformat() for m, (t, _) in tails.items()},
                      'tsteps': {m: st for m, (_, st) in tails.items()}, 'tfrom': max(old) if old else -1})
        tails = {m: (_utc(t), s['tsteps'][m]) for m, t in s['tails'].items()}
        steps = _steps(R, main, tails, s['tfrom'])
        if steps:
            runs.append({'run': key, 'steps': steps, 'complete': True, 'members': s['members'],
                         'tails': s['tails'], 'tfrom': s['tfrom']})
    if save:
        write_json(STATE, {k: v for k, v in state.items() if now - _utc(k) <= timedelta(hours=48)})
    if not runs:
        return None
    return {'id': 'consensus', 'label': 'MWUK', 'res_km': 2.0, 'grid': grid_of('consensus'), 'source': SOURCE_CONS,
            'variables': VARS, 'runs': runs}


def _subjob(mid, run_s, var, first):
    """A wide-grid member's layer. Asked of the site's server when this runs in one of its workers (MDATA_SERVER:
    server/mdWorkers.js, 17 Nov 2026), which makes it on a worker of that grid, and waited for; otherwise made
    by a process of its own on that grid, as before (each spent ~50 s starting up on this PC)."""
    srv = os.environ.get('MDATA_SERVER')
    if srv:
        import urllib.request
        from .job import CANCEL
        tag = f'{run_s[0:4]}{run_s[5:7]}{run_s[8:10]}T{run_s[11:13]}{run_s[14:16]}Z'
        bg = '&bg=1' if os.environ.get('MDATA_LANE') == 'background' else ''   # the warming's: made as the warming's
        url = f'{srv}/api/modeldata/frames/{mid}/{tag}/{var}/status?first={max(0, int(first or 0))}{bg}'
        t0 = moved = time.time()
        done = -1
        while time.time() - t0 < 1800 and time.time() - moved < 300 and not CANCEL.is_set():   # given up after 5 min with no new frame
            try:
                with urllib.request.urlopen(url, timeout=20) as r:
                    st = json.loads(r.read())
                if st.get('state') == 'complete' and not st.get('queued'):
                    return
                if len(st.get('done') or []) > done:
                    done, moved = len(st.get('done') or []), time.time()
            except Exception:
                pass
            time.sleep(2)
        return
    env = dict(os.environ, MDATA_GRID=grid_of(mid), MDATA_THREADS='6')
    args = [sys.executable, '-m', 'mdata.job', mid, run_s, var] + ([str(int(first))] if first is not None else [])
    subprocess.run(args, cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1800, check=False)


class ConsensusModel:
    id, label, res_km = 'consensus', 'MWUK', 2.0
    variables = VARS

    def __init__(self):
        self._entries, self._msteps = {}, {}
        self._frac = None
        self._flock = threading.Lock()

    def runs(self, n=None):
        return []                                      # listed by catalog_entry, from the members' entries

    def entry(self, run):
        """A Consensus run's catalogue entry (or, before the catalogue lists it, worked out the same way)."""
        key = run.isoformat()
        if key not in self._entries:
            cat = json.loads((DATA / 'catalog.json').read_text())
            r = None
            for m in cat['models']:
                if m['id'] == 'consensus':
                    r = next((x for x in m['runs'] if _utc(x['run']) == run), None)
            if r is None:
                e = catalog_entry(cat['models'], save=False)
                r = next((x for x in (e or {}).get('runs', []) if _utc(x['run']) == run), None)
            if r is None:
                raise KeyError(f'MWUK has no run {key}')
            self._entries[key] = r
        return self._entries[key]

    def steps(self, run):
        return self.entry(run)['steps']

    def schedule(self, run):
        return self.steps(run)

    def members(self, run, var, h=None):
        """(model, its run) of each member that gives this layer's sources: the main runs first, then the
        tails (the module's Tails), those only past the run's tfrom when a lead h is given. A member can be
        here twice: the callers take its first that has a value (_first)."""
        from .models import MODELS
        srcs = SRC_OF.get(var, [var])
        e = self.entry(run)
        gives = lambda m: all(s in MODELS[m].variables for s in srcs)             # noqa: E731
        out = [(m, _utc(t)) for m, t in e['members'].items() if gives(m)]
        if h is None or h > e.get('tfrom', -1):
            out += [(m, _utc(t)) for m, t in (e.get('tails') or {}).items() if gives(m)]
        return out

    @staticmethod
    def _first(mems, get):
        """Each member's value from its first entry that has one (its main run, else its tail): get(mid, mrun)
        raising for a run that does not reach, or a frame not there."""
        seen, out = set(), []
        for mid, mrun in mems:
            if mid in seen:
                continue
            try:
                v = get(mid, mrun)
            except Exception:
                continue
            seen.add(mid)
            out.append(v)
        return out

    def prepare(self, run, var, first=None):
        """Start making the members' layers this needs that are not made yet, each from the step on screen.
        Returns at once: each Consensus step waits only for its own member frames (_member)."""
        from .job import main as make_frames
        if var == 'ptype':                                 # its rate is the precip_rate layer's: those members too
            self.prepare(run, 'precip_rate', first)
        e = self.entry(run)
        tails = {m: _utc(t) for m, t in (e.get('tails') or {}).items()}
        jobs = []
        for mid, mrun in self.members(run, var):
            if tails.get(mid) == mrun:
                # a tail is wanted only past its main run's end: made from there (that step, on its own run)
                main = _utc(e['members'][mid])
                past = (main - mrun).total_seconds() / 3600 + max(self._mstep_list(mid, main))
                first_here = max(past, (int(first) if first is not None else 0) + (run - mrun).total_seconds() / 3600)
            else:
                first_here = None if first is None else int(first) + int((run - mrun).total_seconds() // 3600)
            for v in SRC_OF.get(var, [var]):
                st = frames_root(grid_of(mid)) / mid / f'{mrun:%Y%m%dT%H%MZ}' / v / 'status.json'
                try:                                       # complete, and not made before its run grew (16 Nov 2026: the
                    s = json.loads(st.read_text())         # UKV's ptype made at T+20 was never finished for the Consensus)
                    done = s.get('state') == 'complete' and len(s.get('steps') or []) >= len(self._mstep_list(mid, mrun))
                except Exception:
                    done = False
                if not done:
                    jobs.append((mid, mrun.isoformat(), v, None if first_here is None else int(first_here)))
        with _LOCK:
            for mid, mrun_s, v, f in jobs:
                key = (mid, mrun_s, v)
                if key in _JOBS and not _JOBS[key].done():
                    continue
                if grid_of(mid) == GRID:
                    _JOBS[key] = _POOL.submit(make_frames, mid, mrun_s, v, f, 6)
                else:
                    _JOBS[key] = _POOL.submit(_subjob, mid, mrun_s, v, f)

    def _mstep_list(self, mid, mrun):
        k = (mid, mrun)
        if k not in self._msteps:
            from .job import steps_for
            self._msteps[k] = steps_for(mid, mrun)
        return self._msteps[k]

    @staticmethod
    def _read(p):
        """A frame, read again a moment later if it cannot be read whole (one written in place, mdata/mix.py)."""
        for i in range(6):
            try:
                return read_frame(p)[0]
            except Exception:
                if i == 5:
                    raise
                time.sleep(0.3 * (i + 1))

    def _wait(self, mid, mrun, var, p):
        """While that member layer is being made here, wait for one of its frames."""
        fut = _JOBS.get((mid, mrun.isoformat(), var))
        while fut is not None and not fut.done() and not p.exists():
            time.sleep(0.25)

    def _frac_eu(self):
        """Where each of this grid's cells falls on the wide grid (fractional rows and columns)."""
        with self._flock:
            if self._frac is None:
                f = STATIC / 'frac_from_eu.npz'
                if f.exists():
                    z = np.load(f)
                    fj, fi = z['fj'], z['fi']
                else:
                    from pyproj import Transformer
                    g = GRIDS['eu']
                    tr = Transformer.from_crs('EPSG:4326', f"+proj=laea +lat_0={g['lat0']} +lon_0={g['lon0']} +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs", always_xy=True)
                    lon, lat = lonlat()
                    x, y = tr.transform(lon, lat)
                    fi = ((np.asarray(x) - g['x0']) / g['dx']).ravel()
                    fj = ((g['y_top'] - np.asarray(y)) / g['dx']).ravel()
                    STATIC.mkdir(parents=True, exist_ok=True)
                    np.savez_compressed(f, fj=fj, fi=fi)
                self._frac = (fj, fi, False)
        return self._frac

    def _up(self, a):
        """A wide-grid (10 km) field drawn up onto this grid smoothly (cubic, never overshooting)."""
        frac = self._frac_eu()
        ok = np.isfinite(a)
        out = smooth_sample(np.where(ok, a, np.nanmean(a) if ok.any() else 0.0), frac).astype(np.float32)
        if not ok.all():
            out[smooth_sample(ok.astype(np.float32), frac) < 0.5] = np.nan
        return out

    def _up_at(self, a, idx):
        """A wide-grid field drawn up as _up, at some of this grid's cells only (flat indices); NaN as 0."""
        fj, fi, wrap = self._frac_eu()
        a = np.ascontiguousarray(np.nan_to_num(a), np.float64)
        if _cubic_kernel is not None:
            return _cubic_kernel(a, fj[idx], fi[idx], wrap)
        from scipy import ndimage
        return ndimage.map_coordinates(a, [fj[idx], fi[idx]], order=1, mode='nearest').astype(np.float32)

    def _member(self, mid, mrun, var, lead):
        """A member's field at a lead (hours) on this grid: between its two nearest steps where it has
        none there (a direction: the nearer one), and a wide-grid model's drawn up onto the 2 km grid."""
        d = frames_root(grid_of(mid)) / mid / f'{mrun:%Y%m%dT%H%MZ}' / var
        st = self._mstep_list(mid, mrun)
        lo = max((s for s in st if s <= lead + 1e-6), default=None)
        hi = min((s for s in st if s >= lead - 1e-6), default=None)
        if lo is None or hi is None:
            raise KeyError(f'{mid} does not reach T+{lead}')
        pl, ph = d / f'{lo}.bin', d / f'{hi}.bin'
        self._wait(mid, mrun, var, pl)
        if not pl.exists():
            raise FileNotFoundError(f'{mid} {var} has no T+{lo}')
        a = self._read(pl)
        if hi != lo:
            if var == 'wdir10':
                if hi - lead < lead - lo:
                    self._wait(mid, mrun, var, ph)
                    a = self._read(ph) if ph.exists() else a
            else:
                self._wait(mid, mrun, var, ph)
                if not ph.exists():
                    raise FileNotFoundError(f'{mid} {var} has no T+{hi}')
                t = (lead - lo) / (hi - lo)
                a = a + t * (self._read(ph) - a)
        if grid_of(mid) != GRID:
            if var == 'wdir10':
                raise ValueError('a direction is made from its components')
            a = self._up(a)
        return a

    def _kinds(self, mid, mrun, lead, idx):
        """A member's precipitation type at a lead, at some of this grid's cells (flat indices): (wet, ice,
        share), from its ptype frame at its nearest step (a kind between two kinds means nothing). share
        is how frozen what falls is: rain 0, sleet a half, snow 1 (NaN where dry or ice). A wide-grid
        member's is drawn up smoothly, as each kind's part of the cell, so its edges are not 10 km squares."""
        d = frames_root(grid_of(mid)) / mid / f'{mrun:%Y%m%dT%H%MZ}' / 'ptype'
        st = self._mstep_list(mid, mrun)
        lo = max((s for s in st if s <= lead + 1e-6), default=None)
        hi = min((s for s in st if s >= lead - 1e-6), default=None)
        if lo is None or hi is None:
            raise KeyError(f'{mid} does not reach T+{lead}')
        near = hi if hi - lead < lead - lo else lo
        p = d / f'{near}.bin'
        self._wait(mid, mrun, 'ptype', p)
        if not p.exists():
            raise FileNotFoundError(f'{mid} ptype has no T+{near}')
        b = self._read(p)
        if grid_of(mid) == GRID:
            b = b.ravel()[idx]
        code = np.where(np.isfinite(b), np.rint(b), 0).astype(np.int32)
        wet = code > 0
        kind = np.where(wet, (code - 1) // 63, -1)             # derived.typed_rate: 0 rain, 1 sleet, 2 snow, 3 ice
        ice = kind == 3
        frozen = np.select([kind == 2, kind == 1], [1.0, 0.5], 0.0)
        if grid_of(mid) == GRID:
            return wet, ice, np.where(wet & ~ice, frozen, np.nan)
        W, I = self._up_at(wet, idx), self._up_at(ice, idx)
        S = self._up_at(np.where(wet & ~ice, frozen, 0.0), idx)
        w = W >= 0.5
        i = w & (I >= 0.5 * W)
        N = W - I                                              # the part where it is not ice
        with np.errstate(all='ignore'):
            return w, i, np.where(w & ~i & (N > 1e-3), np.clip(S / N, 0, 1), np.nan)

    def _ptype(self, run, h, prev_h=None):
        """Precipitation type (16 Nov 2026, at the user's request): the Consensus's own rate (its
        precip_rate, so the two maps agree) in the kind its members give where it falls. Of the members
        with something falling there: ice (freezing rain, ice pellets, hail) where at least two, and half
        or more of them, give ice; otherwise the middle of how frozen theirs is, snow from 0.7 and sleet
        from 0.3 as in every model's own (derived.SNOW_SHARE, SLEET_SHARE). A wet cell none of them has
        wet (at the edges, where their rates and types round differently) takes the nearest kind."""
        from .derived import RT_LO, SLEET_SHARE, SNOW_SHARE, typed_rate
        own = frames_root(GRID) / self.id / f'{run:%Y%m%dT%H%MZ}' / 'precip_rate' / f'{h}.bin'
        rate = None
        if own.exists():                                   # its precip_rate frame when made: the same numbers
            try:
                rate = self._read(own)
            except Exception:
                rate = None
        if rate is None:
            rate = self.field(run, h, 'precip_rate', prev_h)
        idx = np.flatnonzero(np.nan_to_num(rate) >= RT_LO)
        code = np.ones(rate.shape, np.int32)
        if idx.size:
            vt = run + timedelta(hours=h)
            got = self._first(self.members(run, 'ptype', h),
                              lambda mid, mrun: self._kinds(mid, mrun, (vt - mrun).total_seconds() / 3600, idx))
            if len(got) < MIN_TYPED:
                raise KeyError(f'MWUK: {len(got)} members with a type at T+{h}')
            with _COMBINE:
                n_wet = np.sum([g[0] for g in got], 0)
                n_ice = np.sum([g[1] for g in got], 0)
                S = np.sort(np.stack([g[2] for g in got]), 0)   # the voters' shares first, NaN last
                n = np.isfinite(S).sum(0)
                a = np.take_along_axis(S, np.maximum((n - 1) // 2, 0)[None], 0)[0]
                b = np.take_along_axis(S, np.minimum(n // 2, len(S) - 1)[None], 0)[0]
                share = np.where(n > 0, (a + b) / 2, np.nan)    # their median
                c = np.select([(n_ice >= 2) & (2 * n_ice >= n_wet), share >= SNOW_SHARE, share >= SLEET_SHARE], [3, 5, 7], 1)
                gap = n_wet == 0
                if gap.any() and not gap.all():
                    from scipy import ndimage
                    lone = np.ones(rate.shape, bool)
                    lone.flat[idx[~gap]] = False
                    kinds = np.ones(rate.shape, np.int32)
                    kinds.flat[idx] = c
                    jj, ii = ndimage.distance_transform_edt(lone, return_distances=False, return_indices=True)
                    c[gap] = kinds[jj.flat[idx[gap]], ii.flat[idx[gap]]]
                code.flat[idx] = c
        return typed_rate(rate, code)

    def field(self, run, h, var, prev_h, prev_raw=None):
        if var == 'ptype':
            return self._ptype(run, h, prev_h)
        vt = run + timedelta(hours=h)
        mems = self.members(run, var, h)
        lead = lambda mrun: (vt - mrun).total_seconds() / 3600     # noqa: E731
        if var == 'wdir10':
            def wind(mid, mrun):
                s = self._member(mid, mrun, 'wind10', lead(mrun))
                if grid_of(mid) == GRID:
                    dr = np.radians(self._member(mid, mrun, 'wdir10', lead(mrun)))
                    return -s * np.sin(dr), -s * np.cos(dr)
                # a wide-grid member: its components drawn up, not its angle
                d = frames_root(grid_of(mid)) / mid / f'{mrun:%Y%m%dT%H%MZ}'
                st = self._mstep_list(mid, mrun)
                near = min(st, key=lambda x: abs(x - lead(mrun)))
                sw, dw = self._read(d / 'wind10' / f'{near}.bin'), np.radians(self._read(d / 'wdir10' / f'{near}.bin'))
                return self._up(-sw * np.sin(dw)), self._up(-sw * np.cos(dw))
            uv = self._first(mems, wind)
            us, vs = [u for u, _ in uv], [v for _, v in uv]
            if len(us) < MIN_NOW:
                raise KeyError(f'MWUK: {len(us)} members at T+{h}')
            with np.errstate(all='ignore'):
                uu, vv = np.nanmean(us, 0), np.nanmean(vs, 0)
            return np.mod(np.degrees(np.arctan2(-uu, -vv)), 360.0).astype(np.float32)
        src = SRC_OF.get(var, [var])[0]
        if var in TOTALS:
            # a running total: each member's since this run's own time (its run can start up to 12 hours earlier)
            def get(mid, mrun):
                a = self._member(mid, mrun, src, lead(mrun))
                since = (run - mrun).total_seconds() / 3600
                if since > 1e-6:
                    a = a - self._member(mid, mrun, src, since)
                return np.maximum(a, 0)
        else:
            def get(mid, mrun):
                return self._member(mid, mrun, src, lead(mrun))
        stack = self._first(mems, get)
        if len(stack) < MIN_NOW:
            raise KeyError(f'MWUK: {len(stack)} members at T+{h}')
        with _COMBINE:
            A = np.stack(stack)
            with np.errstate(all='ignore'):
                if var == 'rain_agree':
                    n = np.isfinite(A).sum(0)
                    out = 100.0 * (A >= RAIN).sum(0) / np.maximum(n, 1)
                    out[n < MIN_NOW] = np.nan
                elif var in ('t2_spread', 'mslp_spread'):
                    out = np.nanstd(A, 0)
                else:
                    out = np.nanmedian(A, 0) if np.isnan(A).any() else np.median(A, 0)
            return out.astype(np.float32)
