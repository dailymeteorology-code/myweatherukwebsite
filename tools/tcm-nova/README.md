# TCM NOVA

MyWeatherUK's thunderstorm model. It has two separate products.

| | TCM Main Run | TCM Hyper-Short |
|---|---|---|
| Grid | 2 km, British National Grid | 1.5 km, BNG |
| Runs | 03:00 / 09:00 / 15:00 / 21:00 Europe/London | every hour |
| Range | 120 h at 3 h (configurable) | 24 h at 30 min (49 frames) |
| Inputs | 8 AWS-published models: UKV, MO Global, IFS, IFS ENS, AIFS, AIFS ENS, GFS, GEFS | radar and lightning observations only |
| Method | deterministic multi-model blend, then downscaling (no AI) | observation analysis plus TCM stage-1 kinematic engine |
| Code | `nova/main_run.py` | `nova/hyper/` |

## Docs

- `docs/MODELS.md`: model research, weights and ensemble strategy
- `docs/VARIABLES.md`: every requested variable, classified, with its status
- `docs/TERRAIN.md`: terrain science, DEM choice, pipeline and features
- `docs/DOWNSCALING.md`: Main Run method, configuration and how to run it
- `docs/HYPER_SHORT.md`: what Hyper-Short does now, and the staged plan for a 3-D engine

## Data

Runs, terrain and caches live on `D:/TCM-NOVA` (override with `NOVA_DATA` / `NOVA_CACHE`).

The website (`server/tcmNova.js`) schedules the jobs and serves `/api/nova/{main|hyper}/…`.

## Tests

- Python: `PYTHONPATH=. ../../../ukv-platform/.venv/Scripts/python.exe -m pytest -q tests`
- Node: `node --test server/tcmNova.test.js` (run from the site root)
