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

## Training and nightly learning

**Historical training:** `python -m nova.calibrate train 2026-07-01 2026-10-12 --every 10`

- Runs 4-day hindcasts from archived AWS forecasts into `hindcast/`, with every source's fields saved.
- Trains per-source skill (FSS against radar), which drives the dynamic model weights.
- Fits isotonic calibration curves per lead window, validated leave-one-day-out.

**Nightly learning:** `python -m nova.learn`. The server runs it at 00:00 Europe/London.

1. Verifies the day's Main Run and Hyper-Short frames against radar convective cores and LEELA lightning.
2. Diagnoses hits, misses and false alarms by environment and terrain, plus peak timing error.
3. Retrains skill, then refits calibration on the hindcasts plus the last 60 days of live pairs. A curve is only applied if the cross-validated Brier score improves.
4. Writes `learning/reports/<day>.json`, which the page shows on its Learning tab.

Claude writes the narrative analysis when `ANTHROPIC_API_KEY` is set. It never changes model settings; only the statistics do.

## NOVA-AI (the calibration network)

`nova/ai_cal.py` is TCM NOVA's own small neural network, written in numpy. No outside AI service is involved.

**What it does.** It learns the probability that a thunderstorm is observed, given:
- the raw forecast and its lead time
- the environment: CAPE, CIN, shear, orographic ascent and how much the models disagree
- the topography: height, slope, distance to the coast and landform
- the **region** (England, Wales, Scotland, Ireland or sea), so each nation's terrain and climate gets its own correction

**Training.** It's trained on hindcasts plus the nightly verification record, and validated on whole held-out days.

**When it's used.** Only when it beats both the raw forecast and the isotonic curves. It then takes priority in both the Main Run and Hyper-Short. Every report lists its Brier score per region.

**Grids.** These now cover all of Ireland (x0 = −230 km), with terrain version 1.1.0.
