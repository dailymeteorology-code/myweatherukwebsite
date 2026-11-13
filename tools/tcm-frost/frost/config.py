"""TCM FROST settings: the grid, the lead times, the sources and their weights, the thresholds."""
from __future__ import annotations

import os
from pathlib import Path

ENGINE = 'tcm-frost-1.1.0'
HERE = Path(__file__).resolve().parent
STATIC = HERE.parent / 'static'
DATA = Path(os.environ.get('FROST_DATA') or ('D:/MyWeatherUK-data/frost' if Path('D:/').exists() else '/tmp/frost'))

# Model Data's 2 km grid (the UKV's own: Lambert azimuthal equal-area), so the maps need no
# reprojection on the site. Row 0 = north.
GRID = dict(lat0=54.9, lon0=-2.5, nx=1042, ny=970, dx=2000.0, x0=-1158000.0, y_top=902000.0)
PROJ = (f"+proj=laea +lat_0={GRID['lat0']} +lon_0={GRID['lon0']} +x_0=0 +y_0=0 "
        "+ellps=WGS84 +units=m +no_defs")

CYCLES = (0, 6, 12, 18)
HORIZON_H = 240                                    # ten days
# the output steps: every 3 h for five days, every 6 h to ten (what the ensembles publish)
LEADS = list(range(3, 121, 3)) + list(range(126, HORIZON_H + 1, 6))
KEEP_H = 48                                        # runs kept on the site
# runs published before this (UTC) are made again by the cloud, newest first, while they are still
# kept: move it on when an engine change should redo the runs already on the site
REBUILD_BEFORE = '2026-11-13T19:50:00Z'            # 1.1.0: the Met Office Global read, longer runs, stitched totals

# Each source: its kind, nominal resolution (for its terrain), how far it reaches, and its weight
# by lead time as (lead h, weight per MEMBER) knots, linear between. The UKV, at 2 km, carries the
# first day or two (it resolves the hills and the showers); the ensembles carry the spread later.
SOURCES = {
    'ukv':       dict(kind='det', res_km=2.0,  label='Met Office UKV 2 km',        w=[(0, 14.0), (24, 12.0), (54, 6.0), (120, 2.5)]),
    'mo_global': dict(kind='det', res_km=10.0, label='Met Office Global 10 km',    w=[(0, 3.0), (72, 3.0), (168, 2.0)]),
    'ifs':       dict(kind='det', res_km=12.0, label='ECMWF IFS 9 km (0.25°)',     w=[(0, 4.0), (240, 3.0)]),
    'aifs':      dict(kind='det', res_km=25.0, label='ECMWF AIFS (0.25°)',         w=[(0, 3.0), (240, 2.5)]),
    'gfs':       dict(kind='det', res_km=25.0, label='NOAA GFS (0.25°)',           w=[(0, 2.0), (240, 1.5)]),
    'ifs_ens':   dict(kind='ens', res_km=18.0, label='ECMWF IFS ENS, 50 members',  w=[(0, 0.25), (240, 0.30)]),
    'aifs_ens':  dict(kind='ens', res_km=28.0, label='ECMWF AIFS ENS, 50 members', w=[(0, 0.18), (240, 0.25)]),
    'gefs':      dict(kind='ens', res_km=50.0, label='NOAA GEFS, 30 members',      w=[(0, 0.15), (240, 0.20)]),
}
LAG_PENALTY = 0.75                                 # a source run 6 h older than the cycle counts this much
# Runs that stop short (the 06Z and 18Z runs: IFS at 90 h, IFS ENS at 144 h, the Met Office Global at
# 69 h; the UKV at 54 h but for its 03Z and 15Z runs): the newest run at these hours that reaches
# further carries the model on from where the short one stops (the UKV's long run is also a member
# throughout, a run three hours older than the cycle's own)
LONG = {'ukv': (3, 15), 'mo_global': (0, 12), 'ifs': (0, 12), 'ifs_ens': (0, 12)}

# what counts
CHANCE_CM = 0.2                                    # snow falling in a period: at least this much
RISK_RULES = [                                     # (level, [(cm in 24 h, chance at least), ...]): any one holds
    (4, [(10.0, 0.30), (5.0, 0.70)]),              # severe
    (3, [(5.0, 0.30), (2.0, 0.65)]),               # high
    (2, [(1.0, 0.30), (2.0, 0.15)]),               # moderate
    (1, [(0.2, 0.25)]),                            # low
]
RISK_NAMES = ['None', 'Low', 'Moderate', 'High', 'Severe']
DAY_THRESHOLDS = (0.2, 1.0, 5.0, 10.0)             # each day's chance of at least this much (cm)

# frame encodings (Model Data's format: one byte a cell, 255 no data)
ENC = {
    'snow_expected':    dict(lo=0, hi=150, scale='sqrt'),   # cm since the run began
    'snow_24h':    dict(lo=0, hi=100, scale='sqrt'),   # cm in the 24 h to this time
    'snow_chance': dict(lo=0, hi=100),                 # % chance of snow in the period
    'snow_risk':   dict(lo=0, hi=254),                 # 0-4: the byte is the level
}
