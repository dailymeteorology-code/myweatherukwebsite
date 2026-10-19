"""TCM V5 as NOVA's engine.

NOVA's page, grids, storage, cloud sync and UI stay as they are; the physics that makes
the map is TCM V5's (ukv-platform/backend): V5's profile builder (Stage 3), gridded
parameters (Stage 4), spatial intelligence (Stage 8) and the per-cell engine chain,
TCM probability and hazards (Stages 5-7, `tcm.gridchain.run_grid`).

V5 was fed by the Met Office DataHub, which has stopped. Here it is fed from the same
keyless AWS UKV bucket NOVA uses: each frame is read from AWS, put on V5's own 2 km LAEA
grid (the UKV native grid, so no regridding) and written into a V5 field store on D:
under V5's names and units, then V5 runs unmodified on it. The V5 result is remapped
(bilinear) onto NOVA's British National Grid and published as an ordinary NOVA run.
"""
from __future__ import annotations

import concurrent.futures as cf
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .config import DATA
from .grid import Grid, projected_sampler
from .sources import UKV, _uv, log

V5_ROOT = Path(os.environ.get('NOVA_V5_STORE', str(DATA.parent / 'v5')))
os.environ['DATA_ROOT'] = str(V5_ROOT)                     # V5 Settings.data_root -> D:
_VENDORED = Path(__file__).resolve().parents[2] / 'tcm-v5'          # tools/tcm-v5 (in the site repo)
_BACKEND = Path(os.environ.get('NOVA_V5_BACKEND', _VENDORED if (_VENDORED / 'app').exists()
                               else Path(__file__).resolve().parents[4] / 'ukv-platform' / 'backend'))
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.grid import TCM_PROJECTION, grid_coords, tcm_grid          # noqa: E402
from app.meta import FieldMeta                                       # noqa: E402
from app.grid import Field                                           # noqa: E402
from app.pipeline.ingest import store_field                          # noqa: E402

V5_GRID = tcm_grid()
# The same mesh as NOVA's Grid type, so NOVA's AWS readers sample straight onto it.
NOVA_V5_GRID = Grid('v5_tcm_laea_2km', TCM_PROJECTION, V5_GRID.x0, V5_GRID.y0, V5_GRID.spacing_m,
                    V5_GRID.nx, V5_GRID.ny)
PROVIDER = 'metoffice_aws'
PL = (1000, 925, 850, 700, 500, 400, 300, 250, 200)
HL = (10, 50, 100, 250, 500, 1000, 2000, 3000, 4000, 5000, 6000)


def _es(T, ice):
    Tc = T - 273.15
    return np.where(ice, 6.112 * np.exp(22.46 * Tc / (Tc + 272.62)), 6.112 * np.exp(17.67 * Tc / (Tc + 243.5)))


class _Writer:
    def __init__(self, run, fh):
        self.run, self.fh, self.n = run, fh, 0
        self.vt = run + timedelta(hours=fh)

    def put(self, name, values, units, level_type='surface', level=None, src=''):
        if values is None:
            return
        meta = FieldMeta(provider=PROVIDER, model='ukv', parameter=name, units=units, level_type=level_type,
                         level=level, run=self.run, forecast_hour=self.fh, valid_time=self.vt,
                         native_resolution_m=2000.0, native_grid='455x639 Lambert azimuthal equal area, GB and Eire',
                         native_projection=TCM_PROJECTION, grid=V5_GRID, source_uri=src,
                         retrieved_at=datetime.now(timezone.utc))
        store_field(Field(np.asarray(values, np.float32), meta), V5_ROOT / 'fields')
        self.n += 1


def ingest(run: datetime, fh: int, src: UKV | None = None) -> int:
    """Read one UKV frame from AWS into the V5 field store. Returns fields written."""
    src = src or UKV()
    vt = run + timedelta(hours=fh)
    g = NOVA_V5_GRID
    w = _Writer(run, fh)

    def rd(name):
        try:
            a, lev, _ = src.field(run, vt, name, g)
            return a, lev
        except Exception as e:
            log(f'v5 ingest {name} T+{fh}: {e}')
            return None, None
    names = ['temperature_on_pressure_levels', 'relative_humidity_on_pressure_levels',
             'geopotential_height_on_pressure_levels', 'wind_speed_on_pressure_levels',
             'wind_direction_on_pressure_levels', 'wet_bulb_potential_temperature_on_pressure_levels',
             'temperature_on_height_levels', 'wind_speed_on_height_levels', 'wind_direction_on_height_levels',
             'pressure_at_surface', 'pressure_at_mean_sea_level', 'temperature_at_screen_level',
             'temperature_of_dew_point_at_screen_level', 'relative_humidity_at_screen_level',
             'height_of_orography', 'landsea_mask', 'wind_speed_at_10m', 'wind_direction_at_10m',
             'CAPE_surface', 'CAPE_most_unstable_below_500hPa', 'height_AGL_at_freezing_level',
             'precipitation_rate', 'precipitation_accumulation-PT01H', 'lightning_flash_accumulation-PT01H',
             'hail_fall_rate', 'cloud_amount_of_total_cloud', 'wind_gust_at_10m']
    with cf.ThreadPoolExecutor(8) as ex:
        got = dict(zip(names, ex.map(rd, names)))
    a = lambda n: got[n][0]                                  # noqa: E731

    # --- pressure levels --------------------------------------------------
    T, plev = got['temperature_on_pressure_levels']
    if T is None:
        raise RuntimeError(f'UKV T+{fh} has no pressure-level temperature on AWS')
    plev = np.asarray(plev, float)
    plev = plev / 100.0 if plev.max() > 2000 else plev
    rh = a('relative_humidity_on_pressure_levels')
    if rh is not None:
        # AWS UKV RH is a fraction relative to ICE below 0 C; V5 wants % over water.
        ice = T < 273.15
        e = np.clip(np.nan_to_num(rh), 0, 1.6) * _es(T, ice)
        rh = np.clip(100.0 * e / _es(T, np.zeros_like(ice)), 0, 100)
    ws, wd = a('wind_speed_on_pressure_levels'), a('wind_direction_on_pressure_levels')
    u = v = None
    if ws is not None and wd is not None:
        u, v = _uv(ws, wd)
    Z, wbpt = a('geopotential_height_on_pressure_levels'), a('wet_bulb_potential_temperature_on_pressure_levels')

    def hpa(lev):
        lev = np.asarray(lev if lev is not None else plev, float)
        return lev / 100.0 if lev.max() > 2000 else lev
    wl = hpa(got['wind_speed_on_pressure_levels'][1])
    for stem, arr, units, levs in (('temperature', T, 'K', plev), ('relative_humidity', rh, '%', plev),
                                   ('geopotential_height', Z, 'gpm', hpa(got['geopotential_height_on_pressure_levels'][1])),
                                   ('u_wind', u, 'm/s', wl), ('v_wind', v, 'm/s', wl), ('wind_speed', ws, 'm/s', wl),
                                   ('wet_bulb_potential_temperature', wbpt, 'K',
                                    hpa(got['wet_bulb_potential_temperature_on_pressure_levels'][1]))):
        if arr is None or arr.ndim != 3:
            continue
        for i, p in enumerate(levs[:arr.shape[0]]):
            if int(round(p)) in PL:
                w.put(f'{stem}_{int(round(p))}', arr[i], units, 'isobaric', float(int(round(p))))

    # --- height levels ----------------------------------------------------
    Th, hlev = got['temperature_on_height_levels']
    hs, hd = a('wind_speed_on_height_levels'), a('wind_direction_on_height_levels')
    hu = hv = None
    if hs is not None and hd is not None:
        hu, hv = _uv(hs, hd)
    wl = got['wind_speed_on_height_levels'][1]
    for stem, arr, lev in (('temperature', Th, hlev), ('u_wind', hu, wl), ('v_wind', hv, wl), ('wind_speed', hs, wl)):
        if arr is None or arr.ndim != 3 or lev is None:
            continue
        for i, h in enumerate(np.asarray(lev, float)[:arr.shape[0]]):
            h = int(round(h))
            if h in HL:
                lab = '10m' if h == 10 else f'agl_{h}'
                w.put(f'{stem}_{lab}', arr[i], 'K' if stem == 'temperature' else 'm/s', 'agl', float(h))

    # --- surface ----------------------------------------------------------
    s10, d10 = a('wind_speed_at_10m'), a('wind_direction_at_10m')
    if s10 is not None and d10 is not None:
        u10, v10 = _uv(s10, d10)
        w.put('u_wind_10m', u10, 'm/s', 'agl', 10.0)
        w.put('v_wind_10m', v10, 'm/s', 'agl', 10.0)
        w.put('wind_speed_10m', s10, 'm/s', 'agl', 10.0)
    rh2 = a('relative_humidity_at_screen_level')
    pr, acc = a('precipitation_rate'), a('precipitation_accumulation-PT01H')
    lf = a('lightning_flash_accumulation-PT01H')
    tcc = a('cloud_amount_of_total_cloud')
    for name, arr, units, lt, lv in (
            ('pressure_surface', a('pressure_at_surface'), 'Pa', 'surface', None),
            ('pressure_msl', a('pressure_at_mean_sea_level'), 'Pa', 'meansea', None),
            ('temperature_2m', a('temperature_at_screen_level'), 'K', 'agl', 1.5),
            ('dewpoint_2m', a('temperature_of_dew_point_at_screen_level'), 'K', 'agl', 1.5),
            ('relative_humidity_2m', None if rh2 is None else np.clip(rh2 * 100, 0, 100), '%', 'agl', 1.5),
            ('terrain_height', a('height_of_orography'), 'm', 'surface', None),
            ('land_cover', a('landsea_mask'), '1', 'surface', None),
            ('cape_surface', a('CAPE_surface'), 'J/kg', 'surface', None),
            ('cape_most_unstable', a('CAPE_most_unstable_below_500hPa'), 'J/kg', 'surface', None),
            ('freezing_level_height', a('height_AGL_at_freezing_level'), 'm', 'surface', None),
            ('precip_rate', pr, 'kg m**-2 s**-1', 'surface', None),          # AWS is kg m-2 s-1 already
            ('precip_accum_1h', None if acc is None else acc * 1000.0, 'kg m**-2', 'surface', None),
            ('lightning_flash_density_1h', None if lf is None else lf * 1e6, 'flashes/km2/h', 'surface', None),
            ('hail_fall_rate', a('hail_fall_rate'), 'kg/m2/s', 'surface', None),
            ('total_cloud_cover', None if tcc is None else tcc * 100, '%', 'surface', None),
            ('wind_gust_10m', a('wind_gust_at_10m'), 'm/s', 'agl', 10.0)):
        w.put(name, arr, units, lt, lv)
    return w.n


# ---------------------------------------------------------------------------
# V5 chain for one frame


def run_v5(run: datetime, fh: int, *, stride=3, workers=None, pressure_levels=None):
    """Stages 3-8 of V5 on the stored frame. Returns (GridForecast, GriddedParameters, cube)."""
    from app.grid import grid_lonlat
    from app.parameters.gridparams import compute_grid
    from app.pipeline.ingest import load_field
    from app.profiles.build import build_profile
    from app.spatial import intelligence as SI
    from app.spatial import static as SS
    from app.tcm.gridchain import run_grid

    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    kw = {'pressure_levels': tuple(float(p) for p in pressure_levels)} if pressure_levels else {}
    cube = build_profile('ukv', run, fh, provider=PROVIDER, grid_id=V5_GRID.name, **kw)
    params = compute_grid(cube)
    if params is None:
        return None, None, cube

    def fld(n):
        f = load_field('ukv', run, n, fh)
        return None if f is None else f.values
    spatial = None
    try:
        geo = SS.load('ukv', refresh=True)
        if fld('u_wind_10m') is not None:
            spatial = SI.build(geo, SI.AtmosphericInputs(
                u=fld('u_wind_10m'), v=fld('v_wind_10m'), temperature=fld('temperature_2m'),
                theta_e=fld('wet_bulb_potential_temperature_850'), boundary_layer_depth=fld('boundary_layer_height'),
                cape=fld('cape_surface'), cin=fld('cin'), wind_level='10m'),
                model='ukv', run=run, valid_time=run + timedelta(hours=fh), lonlat=grid_lonlat(V5_GRID))
    except Exception as e:                               # spatial is an input to Stage 7, not a requirement
        log(f'v5 spatial skipped T+{fh}: {e}')
    gf = run_grid(cube, spatial=spatial, parameters=params, stride=stride, workers=workers)
    return gf, params, cube


# ---------------------------------------------------------------------------
# V5 grid -> NOVA grid

_SAMPLERS = {}


def to_nova(a, nova_grid: Grid, stride=1):
    """Bilinear remap of a V5 LAEA field (row 0 = south) onto a NOVA grid. With a stride,
    only every `stride`-th V5 cell carries a value; the remap is done from that sub-grid."""
    a = np.asarray(a, np.float32)
    key = (nova_grid.name, stride)
    if key not in _SAMPLERS:
        xs, ys = grid_coords(V5_GRID)
        _SAMPLERS[key] = projected_sampler(nova_grid, TCM_PROJECTION, xs[::stride], ys[::stride])
    return _SAMPLERS[key](a[::stride, ::stride])


if __name__ == '__main__':                                 # timing probe: python -m nova.v5_bridge <run> <fh>
    run = datetime.strptime(sys.argv[1], '%Y%m%dT%H').replace(tzinfo=timezone.utc)
    fh = int(sys.argv[2])
    t = time.time()
    n = ingest(run, fh)
    log(f'ingested {n} fields in {time.time() - t:.0f}s')
    t = time.time()
    gf, params, cube = run_v5(run, fh, stride=int(sys.argv[3]) if len(sys.argv) > 3 else 3)
    log(f'V5 chain {time.time() - t:.0f}s')
    if gf is not None:
        print(gf.describe())
        print({k: float(np.nanmax(v)) for k, v in gf.hazards.items()}, float(np.nanmax(gf.probability)))
