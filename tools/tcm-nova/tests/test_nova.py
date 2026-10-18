"""TCM NOVA automated tests (offline: no network, synthetic data).

    cd tools/tcm-nova && python -m pytest -q
"""
import ast
import json
import pathlib
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def tmp_data(tmp_path, monkeypatch):
    import nova.config as cfg
    import nova.store as st
    import nova.weights as W
    monkeypatch.setattr(cfg, 'DATA', tmp_path)
    monkeypatch.setattr(st, 'DATA', tmp_path)
    monkeypatch.setattr(W, 'SKILL_FILE', tmp_path / 'skill.json')
    return tmp_path


# 1-2 grids ------------------------------------------------------------------
def test_main_grid_is_2000m():
    from nova.config import MAIN
    from nova.grid import Grid
    g = Grid.get(MAIN['grid'])
    assert g.dx == 2000.0 and g.meta()['cell_area_km2'] == 4.0
    X, _ = g.xy
    assert np.allclose(np.diff(X[0]), 2000.0)


def test_hyper_grid_is_1500m():
    from nova.config import HYPER
    from nova.grid import Grid
    g = Grid.get(HYPER['grid'])
    assert g.dx == 1500.0 and g.meta()['cell_area_km2'] == 2.25


def test_grid_lonlat_hits_known_point():
    from nova.grid import Grid
    g = Grid.get('gb2km')
    lon, lat = g.lonlat
    # BNG (530000, 180000) is central London
    iy, ix = 180000 // 2000, 530000 // 2000
    assert abs(lat[iy, ix] - 51.50) < 0.05 and abs(lon[iy, ix] + 0.13) < 0.08


# 3-5 schedules (Python side; the Node scheduler is tested in server/tcmNova.test.js)
@pytest.mark.parametrize('now,expect_local', [
    ('2026-10-18T14:30:00+00:00', '15:00'),      # BST: 15:30 local -> 15:00 cycle
    ('2026-12-01T14:30:00+00:00', '09:00'),      # GMT: 14:30 local -> 09:00 cycle
    ('2026-03-29T02:30:00+00:00', '03:00'),      # spring-forward day: 03:30 BST -> 03:00 BST cycle
    ('2026-10-25T01:30:00+00:00', '21:00'),      # fall-back day: 01:30 GMT -> previous 21:00
])
def test_main_cycle_init_dst(now, expect_local):
    from zoneinfo import ZoneInfo
    from nova.main_run import cycle_init
    t = cycle_init(datetime.fromisoformat(now))
    assert t.astimezone(ZoneInfo('Europe/London')).strftime('%H:%M') == expect_local


def test_main_cycles_configured():
    from nova.config import MAIN
    assert MAIN['cycles_local'] == ['03:00', '09:00', '15:00', '21:00']


# 6-8 hyper horizon / frames ---------------------------------------------------
def test_hyper_produces_49_half_hour_frames():
    from nova.hyper import engine
    rain = np.zeros((60, 60), np.float32)
    rain[20:30, 20:30] = 10
    leads = [l for l, *_ in engine.integrate(rain, rain * 0, np.zeros_like(rain), np.zeros_like(rain), 1500, 1440, 30)]
    assert leads == list(range(0, 1441, 30)) and len(leads) == 49


def test_hyper_advection_moves_and_decays():
    from nova.hyper import engine
    rain = np.zeros((40, 80), np.float32)
    rain[18:22, 10:14] = 20
    u = np.full_like(rain, 1 / 300.0)                    # 1 cell per 5 min eastwards
    out = {l: r for l, r, _ in engine.integrate(rain, rain * 0, u, rain * 0, 1500, 60, 30)}
    c0 = np.average(np.arange(80), weights=out[0].sum(0))
    c60 = np.average(np.arange(80), weights=out[60].sum(0) + 1e-9)
    assert 10 < c60 - c0 < 14                            # ~12 cells in 60 min
    assert out[60].sum() < out[0].sum()                  # Lagrangian decay, no new rain


def test_motion_field_recovers_shift():
    from nova.hyper import engine
    rng = np.random.default_rng(1)
    a = (rng.random((128, 128)) > 0.8).astype(np.float32) * 5
    from scipy import ndimage
    a = ndimage.gaussian_filter(a, 2) * 10
    b = np.roll(a, 3, axis=1)
    u, v, n = engine.motion_field(a, b, 1500, 900, block_km=96)
    assert n >= 3 and abs(np.median(u) * 900 - 3) < 0.6 and abs(np.median(v) * 900) < 0.6


# 9 & 18 storage separation / no overwrite -------------------------------------
def test_storage_namespaces_and_no_overwrite(tmp_data):
    from nova import store
    init = datetime(2026, 10, 18, 14, tzinfo=timezone.utc)
    for prod in ('main', 'hyper'):
        w = store.RunWriter(prod, init, {'init_utc': init.isoformat()})
        w.frame(0, init.isoformat(), {'p_thunder': np.zeros((2, 2), np.float32)}, {'checks': {}})
        w.publish('published')
    assert (tmp_data / 'main' / 'main-20261018T1400Z').is_dir()
    assert (tmp_data / 'hyper' / 'hyper-20261018T1400Z').is_dir()
    assert json.loads((tmp_data / 'main' / 'latest.json').read_text())['run_id'].startswith('main-')
    with pytest.raises(FileExistsError):
        store.RunWriter('hyper', init, {'init_utc': init.isoformat()})


def test_partial_run_is_not_published(tmp_data):
    from nova import store
    init = datetime(2026, 10, 18, 15, tzinfo=timezone.utc)
    w = store.RunWriter('hyper', init, {'init_utc': init.isoformat()})
    w.abandon('test')
    assert not (tmp_data / 'hyper' / 'latest.json').exists()
    assert not (tmp_data / 'hyper' / 'hyper-20261018T1500Z').exists()


def test_frame_roundtrip(tmp_data):
    from nova import store
    init = datetime(2026, 10, 18, 16, tzinfo=timezone.utc)
    w = store.RunWriter('main', init, {'init_utc': init.isoformat()})
    a = np.linspace(0, 1, 12, dtype=np.float32).reshape(3, 4)
    w.frame(180, init.isoformat(), {'p_thunder': a, 'organisation': np.ones((3, 4), np.int8)}, {'checks': {}})
    w.publish('published')
    b = store.read_frame('main', 'main-20261018T1600Z', 180, 'p_thunder', (3, 4))
    assert np.allclose(a, b.astype(np.float32), atol=1e-3)


# 12 lineage: Hyper-Short uses observations + the latest UKV, and NO other model --------
def test_hyper_lineage_is_obs_plus_ukv_only():
    allowed = {'sources': {'UKV'}, 'main_run': {'environment', 'prepare'}}
    banned_strings = ('ecmwf-forecasts', 'noaa-gfs', 'noaa-gefs', 'open-meteo', 'opendata.dwd.de', 'global-deterministic',
                      'READERS', 'ICONEU', 'GFS(', 'ECMWF(', 'GEFS(', 'MOGlobal')
    for f in (ROOT / 'nova' / 'hyper').glob('*.py'):
        src = f.read_text(encoding='utf8')
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.ImportFrom):
                mod = (node.module or '').split('.')[-1]
                if mod in allowed:
                    names = {a.name for a in node.names}
                    assert names <= allowed[mod], f'{f.name} imports {names - allowed[mod]} from {mod}'
                assert mod not in ('sources_dwd', 'weights'), f'{f.name} imports {mod}'
        code = '\n'.join(l for l in src.splitlines() if not l.strip().startswith('#'))
        for b in banned_strings:
            assert b not in code, f'{f.name} references {b}'


def test_blend_weight_hands_over_to_ukv():
    from nova.hyper.ukv_env import blend_weight, env_hours
    assert blend_weight(0) == 1.0 and blend_weight(90) < 0.4 and blend_weight(360) < 0.02
    assert env_hours()[0] == 0 and env_hours()[-1] == 24


# 15 no AI / ML anywhere in the downscaling and engines -------------------------
def test_no_machine_learning_dependencies():
    banned = {'torch', 'tensorflow', 'keras', 'sklearn', 'xgboost', 'lightgbm', 'jax', 'onnxruntime', 'transformers'}
    for f in (ROOT / 'nova').rglob('*.py'):
        for node in ast.walk(ast.parse(f.read_text(encoding='utf8'))):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] + ([node.module] if isinstance(node, ast.ImportFrom) and node.module else [])
                assert not any(n.split('.')[0] in banned for n in names), f'{f.name}: {names}'


# 16 remapping / units -----------------------------------------------------------
def test_vertical_interp_never_extrapolates():
    from nova.main_run import vertical_interp
    from nova.config import LEVELS
    pl = {'levels': np.array([1000, 850, 700, 500.]), 't': np.array([290, 280, 270, 250.])[:, None, None] * np.ones((4, 2, 2)),
          'q': np.zeros((4, 2, 2)), 'u': np.zeros((4, 2, 2)), 'v': np.zeros((4, 2, 2)), 'z': np.array([100, 1500, 3000, 5600.])[:, None, None] * np.ones((4, 2, 2))}
    out = vertical_interp(pl)
    i300 = LEVELS.index(300)
    assert np.isnan(out['t'][i300]).all()                         # above the source's top: missing, not invented
    i925 = LEVELS.index(925)
    assert 280 < out['t'][i925][0, 0] < 290


def test_bilinear_flags_outside_domain():
    from nova.grid import Grid, regular_sampler
    g = Grid.get('gb2km')
    s = regular_sampler(g, np.arange(50, 55.01, 0.25), np.arange(-5, 0.01, 0.25))
    assert 0 < s.valid.mean() < 1                                 # partial coverage is reported, not clamped


def test_columns_drop_underground_levels():
    from nova import thermo as th
    lev = np.array([1000, 925, 850, 700, 500.])
    z = np.array([100, 750, 1450, 3000, 5600.])[:, None]
    T = np.array([288, 284, 280, 270, 252.])[:, None]
    q = np.full((5, 1), 0.005)
    C = th.build_columns(lev, T, q, z * 0, z * 0, z, np.array([880.]), np.array([283.]), np.array([0.005]), np.array([1200.]), np.zeros(1), np.zeros(1))
    p = C['p'][:, 0]
    assert p[0] == 880 and p[1] == 850 and np.all(np.diff(p[np.isfinite(p)]) < 0)


# thermodynamics sanity -------------------------------------------------------
def _sounding(t_sfc=301, rh_low=70):
    from nova import thermo as th
    lev = np.array([1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200.])
    z = (288.15 / 0.0065) * (1 - (lev / 1013.25) ** 0.1903)
    T = np.maximum(np.where(z < 3000, t_sfc - 0.008 * z, t_sfc - 24 - 0.0065 * (z - 3000)), 215)
    q = th.q_from_rh(np.where(z < 1500, rh_low, 40), T, lev)
    return th.build_columns(lev, T[:, None], q[:, None], np.zeros((19, 1)), np.zeros((19, 1)), z[:, None], np.array([1013.]),
                            np.array([t_sfc + 1.]), np.array([q[0]]), np.array([0.]), np.zeros(1), np.zeros(1))


def test_cape_positive_for_unstable_and_zero_for_stable():
    from nova import thermo as th
    sb, ml, mu = th.parcels(_sounding())
    assert 1000 < mu['cape'][0] < 5000 and mu['cin'][0] <= 0
    sb2, _, mu2 = th.parcels(_sounding(t_sfc=285, rh_low=40))
    assert mu2['cape'][0] < mu['cape'][0]


def test_lcl_matches_rule_of_thumb():
    from nova import thermo as th
    C = _sounding()
    sb, _, _ = th.parcels(C)
    spread = C['T'][0, 0] - C['Td'][0, 0]
    assert abs(sb['lcl_z'][0] - 125 * spread) < 250


def test_wet_bulb_between_dewpoint_and_temperature():
    from nova import thermo as th
    T, Td, p = np.array([300.]), np.array([285.]), np.array([1000.])
    tw = th.wet_bulb(T, Td, p)
    assert Td < tw < T


# weights ----------------------------------------------------------------------
def test_baseline_table_sums_to_100():
    from nova.config import BASELINE, WINDOWS
    for i in range(len(WINDOWS)):
        assert sum(v[i] for v in BASELINE.values()) == 100


@pytest.mark.parametrize('lead', [0, 5, 6, 23, 24, 71, 72, 120])
def test_weights_renormalise_and_sum_to_one(lead):
    from nova import weights as W
    w, prov = W.dynamic(lead, ['ukv', 'ifs', 'gfs', 'ifs_ens', 'gefs', 'aifs', 'aifs_ens', 'mo_global'], 'environment', skill={})
    assert abs(sum(w.values()) - 1) < 1e-9 and all(v >= 0 for v in w.values())
    assert 'icon_eu' in prov['ineligible'] and 'icon_eu' not in w
    fam = {}
    from nova.config import MODELS, FAMILY_CAP
    for m, v in w.items():
        fam[MODELS[m]['family']] = fam.get(MODELS[m]['family'], 0) + v
    for f, v in fam.items():
        assert v <= FAMILY_CAP[f] + 1e-6


def test_skill_shifts_weight_but_is_shrunk():
    from nova import weights as W
    skill = {'thunder': {'0': {'ukv': {'n': 100, 'fss': 0.8}, 'gfs': {'n': 100, 'fss': 0.2}}}}
    w0, _ = W.dynamic(3, ['ukv', 'gfs', 'ifs'], 'environment', skill={})
    w1, _ = W.dynamic(3, ['ukv', 'gfs', 'ifs'], 'environment', skill=skill)
    assert w1['ukv'] / w1['gfs'] > w0['ukv'] / w0['gfs']


def test_cell_weights_handle_partial_coverage():
    from nova import weights as W
    m1 = np.array([[True, False]])
    m2 = np.array([[True, True]])
    cw = W.cell_weights({'ukv': 0.7, 'gfs': 0.3}, {'ukv': m1, 'gfs': m2})
    assert np.allclose(cw['ukv'] + cw['gfs'], 1) and cw['gfs'][0, 1] == 1


# terrain ----------------------------------------------------------------------
def test_orographic_ascent_sign():
    from nova import terrain
    from nova.grid import Grid
    g = Grid('t', 'EPSG:27700', 0, 0, 2000.0, 60, 40)
    x = np.arange(60) * 2000.0
    h = np.tile(np.clip((x - 40000) * 0.02, 0, 600), (40, 1)).astype(np.float32)    # ridge rising eastwards
    T = terrain.derive_static(g, h, h * 0, h * 0, h, h, np.ones_like(h))
    flow = terrain.flow_diagnostics(T, g, np.full(h.shape, 10.0), np.zeros(h.shape), np.full(h.shape, 0.01))
    mid = flow['w_oro'][20, 30]
    assert mid > 0                                                                 # westerly onto rising ground
    flow2 = terrain.flow_diagnostics(T, g, np.full(h.shape, -10.0), np.zeros(h.shape), np.full(h.shape, 0.01))
    assert flow2['w_oro'][20, 30] < 0                                              # easterly = descent
    assert T['aspect_deg'][20, 30] == pytest.approx(270, abs=1)                    # slope faces west


def test_flat_terrain_gives_no_terrain_signal():
    from nova import terrain
    from nova.grid import Grid
    g = Grid('t', 'EPSG:27700', 0, 0, 2000.0, 30, 30)
    h = np.full((30, 30), 120.0, np.float32)
    T = terrain.derive_static(g, h, h * 0, h * 0, h, h, np.ones_like(h))
    flow = terrain.flow_diagnostics(T, g, np.full(h.shape, 15.0), np.full(h.shape, 5.0), np.full(h.shape, 0.01))
    assert np.abs(flow['w_oro']).max() < 1e-6 and np.abs(flow['windward_exposure']).max() < 1e-3


def test_terrain_tiles_have_no_seams():
    """Built terrain (if present) must not jump at 1° tile edges."""
    import nova.config as cfg
    p = pathlib.Path('D:/TCM-NOVA/data/terrain/gb2km-terrain-1.0.0.npz')
    if not p.exists():
        pytest.skip('terrain not built on this machine')
    h = np.load(p)['h_mean']
    from nova.grid import Grid
    lon, lat = Grid.get('gb2km').lonlat
    edge = np.abs(lat - np.round(lat)) < 0.01
    d = np.abs(np.diff(h, axis=0))
    assert np.median(d[edge[:-1]]) < 3 * np.median(d) + 5


# hazards: no hotspots from terrain alone --------------------------------------
def test_terrain_cannot_create_storms_without_model_signal():
    from nova import hazards as hz
    shp = (40, 40)
    z = np.zeros(shp, np.float32)
    D = {k: z + v for k, v in dict(mu_cape=1500, ml_cin=-10, omega_700=-1, convective_temperature=280, pbl_height=1500, mu_cape_mixed_phase=600,
                                   mu_el_z=10000, shear_0_6km=20, wbz=2500, lapse_700_500=7, dcape=900, mean_wind_u=10, mean_wind_v=0,
                                   ml_lcl_z=1200, scp=3, stp=1, pw=30, corfidi_upshear=5).items()}
    flow = {'w_oro': z + 0.8, 'w_oro_eff': z + 0.8}
    H = hz.compute({'t2': z + 300, 'conv_10m': z + 1e-4}, D, {}, flow, {'gfs': z.copy()}, {}, {'gfs': z + 1}, {}, 2000, 3)
    assert H['p_thunder'].max() == 0                                              # no model signal -> no storm
    H2 = hz.compute({'t2': z + 300, 'conv_10m': z + 1e-4}, D, {}, flow, {'gfs': z + 0.4}, {}, {'gfs': z + 1}, {}, 2000, 3)
    for k, v in H2.items():
        if k.startswith('p_'):
            assert v.min() >= 0 and v.max() <= 1


def test_terrain_lee_reduces_probability():
    from nova import hazards as hz
    shp = (30, 30)
    z = np.zeros(shp, np.float32)
    D = {k: z + v for k, v in dict(mu_cape=1000, ml_cin=-20, omega_700=0, convective_temperature=310, pbl_height=1500, mu_cape_mixed_phase=300,
                                   mu_el_z=9000, shear_0_6km=10, wbz=2500, lapse_700_500=6.5, dcape=500, mean_wind_u=5, mean_wind_v=0,
                                   ml_lcl_z=1000, scp=0, stp=0, pw=25, corfidi_upshear=10).items()}
    up = hz.compute({'conv_10m': z}, D, {}, {'w_oro': z + 0.5}, {'gfs': z + 0.3}, {}, {'gfs': z + 1}, {}, 2000, 3)
    dn = hz.compute({'conv_10m': z}, D, {}, {'w_oro': z - 0.5}, {'gfs': z + 0.3}, {}, {'gfs': z + 1}, {}, 2000, 3)
    assert up['p_thunder'].mean() > dn['p_thunder'].mean()
