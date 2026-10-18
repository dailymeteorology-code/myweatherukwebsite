"""TCM NOVA configuration: grids, schedules, model registry and the baseline weight table.

Everything a run needs to know that is not data lives here, so changing a schedule,
a horizon or a weight never means editing pipeline code.
"""
from __future__ import annotations

import os
from pathlib import Path

ENGINE_VERSION = 'nova-1.0.0'
HYPER_ENGINE_VERSION = 'nova-hyper-0.1.0'      # stage-1 kinematic engine, see docs/HYPER_SHORT.md
ANALYSIS_VERSION = 'nova-obsan-0.1.0'

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
# Everything bulky (runs, terrain, DEM tiles) lives on the external drive: C: is nearly full.
_EXT = Path('D:/TCM-NOVA')
DATA = Path(os.environ.get('NOVA_DATA', _EXT / 'data' if _EXT.parent.exists() else REPO / 'server' / 'data' / 'tcm-nova'))
CACHE = Path(os.environ.get('NOVA_CACHE', _EXT / 'cache' if _EXT.parent.exists() else ROOT / '.cache'))

TZ = 'Europe/London'

# ── grids ────────────────────────────────────────────────────────────────────
# British National Grid (EPSG:27700): metres, so grid spacing is a real 2 000 m /
# 1 500 m and cell edges are identical from cycle to cycle. Domain covers Great
# Britain incl. Scilly, Shetland and the surrounding sea (cells over sea are kept:
# storms form there too). Europe will get its own LAEA (EPSG:3035) grid entry.
GRIDS = {
    'gb2km':   {'crs': 'EPSG:27700', 'x0': 0.0, 'y0': 0.0, 'dx': 2000.0, 'nx': 350, 'ny': 625},
    'gb1p5km': {'crs': 'EPSG:27700', 'x0': 0.0, 'y0': 0.0, 'dx': 1500.0, 'nx': 467, 'ny': 834},
}

# ── products ─────────────────────────────────────────────────────────────────
MAIN = {
    'product': 'main',
    'name': 'TCM Main Run',
    'grid': 'gb2km',
    'cycles_local': ['03:00', '09:00', '15:00', '21:00'],      # Europe/London wall clock
    'horizon_h': int(os.environ.get('NOVA_MAIN_HORIZON_H', 96)),       # 4 days
    'step_h': 3,
    'method': 'deterministic multi-model blend + deterministic downscaling (no AI/ML)',
}
HYPER = {
    'product': 'hyper',
    'name': 'TCM Hyper-Short',
    'grid': 'gb1p5km',
    'every_minutes': 60,
    'horizon_h': 24,
    'step_min': 30,
    'max_obs_age_min': 45,
    'min_radar_coverage': 0.6,
}

# ── pressure levels used for every vertically resolved diagnostic (hPa) ─────
LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200]

# ── model registry ──────────────────────────────────────────────────────────
# aws: where the data actually comes from. None = not published on AWS, so the
# source is ineligible (the user's rule: AWS only, never Open-Meteo) and its weight
# is renormalised away. family: models from one centre share errors and are capped.
MODELS = {
    'ukv':        dict(label='UKV deterministic',               family='metoffice', kind='det', res_km=2.0,  aws='met-office-atmospheric-model-data/uk-deterministic-2km', max_lead_h=120, profile=True),
    'mogreps_uk': dict(label='MOGREPS-UK ensemble',             family='metoffice', kind='ens', res_km=2.2,  aws=None, max_lead_h=126),
    'mo_global':  dict(label='Met Office Global deterministic', family='metoffice', kind='det', res_km=10.0, aws='met-office-atmospheric-model-data/global-deterministic-10km', max_lead_h=168),
    'mogreps_g':  dict(label='MOGREPS-G ensemble',              family='metoffice', kind='ens', res_km=20.0, aws=None, max_lead_h=198),
    'ifs':        dict(label='ECMWF IFS HRES',                  family='ecmwf',     kind='det', res_km=9.0,  aws='ecmwf-forecasts/ifs/0p25/oper', max_lead_h=144, profile=True),
    'ifs_ens':    dict(label='ECMWF IFS ENS',                   family='ecmwf',     kind='ens', res_km=9.0,  aws='ecmwf-forecasts/ifs/0p25/enfo', max_lead_h=360, members=50),
    'aifs':       dict(label='ECMWF AIFS Single',               family='ecmwf',     kind='det', res_km=28.0, aws='ecmwf-forecasts/aifs-single/0p25/oper', max_lead_h=360, profile=True, ai=True),
    'aifs_ens':   dict(label='ECMWF AIFS ENS',                  family='ecmwf',     kind='ens', res_km=31.0, aws='ecmwf-forecasts/aifs-ens/0p25/enfo', max_lead_h=360, members=50, ai=True),
    'icon_eu':    dict(label='DWD ICON-EU deterministic',       family='dwd',       kind='det', res_km=6.5,  aws='opendata.dwd.de/weather/nwp/icon-eu', max_lead_h=120, profile=True),
    'icon_eps':   dict(label='DWD ICON-EU-EPS (EU nest)',       family='dwd',       kind='ens', res_km=13.2, aws='opendata.dwd.de/weather/nwp/icon-eu-eps', max_lead_h=120, members=40),
    'gfs':        dict(label='NOAA GFS deterministic',          family='noaa',      kind='det', res_km=13.0, aws='noaa-gfs-bdp-pds', max_lead_h=384, profile=True),
    'gefs':       dict(label='NOAA GEFS ensemble',              family='noaa',      kind='ens', res_km=25.0, aws='noaa-gefs-pds/pgrb2ap5', max_lead_h=384, members=30),
    'arpege':     dict(label='Météo-France ARPEGE',             family='mf',        kind='det', res_km=10.0, aws=None, max_lead_h=102),
    'pearp':      dict(label='Météo-France PEARP',              family='mf',        kind='ens', res_km=10.0, aws=None, max_lead_h=108),
}

# Baseline weights, % per lead window, exactly as supplied (provisional, expert-set,
# NOT accuracy claims). Rows sum to 100 per window before eligibility renormalisation.
WINDOWS = [(0, 6), (6, 24), (24, 72), (72, 120)]
BASELINE = {
    'ukv':        [20, 16, 4, 1],
    'mogreps_uk': [20, 16, 7, 4],
    'mo_global':  [2, 3, 6, 8],
    'mogreps_g':  [3, 4, 7, 9],
    'ifs':        [9, 10, 10, 9],
    'ifs_ens':    [14, 16, 18, 20],
    'aifs':       [1, 2, 3, 4],
    'aifs_ens':   [3, 5, 7, 8],
    'icon_eu':    [6, 7, 7, 6],
    'icon_eps':   [7, 8, 7, 8],
    'gfs':        [2, 2, 5, 5],
    'gefs':       [5, 4, 8, 9],
    'arpege':     [3, 3, 6, 4],
    'pearp':      [5, 4, 5, 5],
}

# Initial-development family caps (fraction of the renormalised blend). Not a
# substitute for verification: they only stop one centre dominating while the
# skill record is too short to say whether its systems add independent information.
FAMILY_CAP = {'metoffice': 0.55, 'ecmwf': 0.55, 'noaa': 0.30, 'dwd': 0.30, 'mf': 0.30}

# Dynamic (skill-based) weighting: weight = baseline^(1-a) * skill^a, a = n/(n+N0).
SKILL_SHRINK_N0 = 20          # verified cycles before skill carries half the say
SKILL_MIN_SAMPLES = 3

# Hazard-specific emphasis on top of the lead-window weights (multipliers, renormalised).
HAZARD_EMPHASIS = {
    'initiation':  {'icon_eu': 1.1, 'ukv': 1.4, 'ifs_ens': 1.1, 'gefs': 0.8, 'aifs': 0.6, 'aifs_ens': 0.7},
    'precip':      {'ukv': 1.5, 'mo_global': 0.9, 'aifs': 0.7, 'aifs_ens': 0.7},
    'lightning':   {'ukv': 1.6, 'icon_eu': 1.3},        # explicit lightning (UKV) and LPI (ICON-EU)
    'hail':        {'ukv': 1.4, 'aifs': 0.5, 'aifs_ens': 0.5},
    'wind':        {'ukv': 1.2, 'ifs': 1.1},
    'supercell':   {'ifs': 1.1, 'ifs_ens': 1.2, 'aifs': 0.6},
    'environment': {},
}

UA = {'User-Agent': 'MyWeatherUK-TCM-NOVA/1.0 (+dailymeteorology)'}
