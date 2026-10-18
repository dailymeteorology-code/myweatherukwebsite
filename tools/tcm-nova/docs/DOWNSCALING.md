# TCM Main Run: deterministic downscaling (no AI/ML)

There's no learned component anywhere in `nova/`. `tests/test_nova.py::test_no_machine_learning_dependencies` fails if one is ever imported.

| Step | Code | Method | Why |
|---|---|---|---|
| 1 Validate & standardise | `main_run.prepare`, `sources.py` | Every reader converts to SI on read (precip → mm/h mean over the interval; IFS tp in m and AIFS tp in kg m⁻² are both detected from the GRIB `units` key; UKV lightning m⁻² → km⁻²; hail m → mm). Range checks: fields >1 % out of range are dropped and flagged in the frame's `source_flags`. Provenance (source, cycle, valid time) goes in the manifest and frame metadata. | No unit is guessed downstream |
| 2 Horizontal remap | `grid.py` | Bilinear for continuous state (T, q, Z, p, u, v), from LAEA (UKV) or regular lat/lon (GRIB) to BNG. Cells outside a source domain are flagged invalid, not clamped. Area-conservative block statistics for finer-than-target inputs (radar 1 km, DEM 90 m). Winds are rotated earth → grid-relative by the BNG grid-convergence angle. | Bilinear doesn't create new extrema in smooth fields. Conservation matters for rates. |
| 3 Vertical | `vertical_interp`, `thermo.build_columns` | Linear in ln p onto 19 common levels, only inside each source's own level range. Columns are rebuilt per cell with the surface inserted at NOVA's terrain height and underground levels removed. | No extrapolation through the ground |
| 4 Blend | `weights.py`, `main_run.frame` | Weighted mean with per-cell renormalisation. NaN means missing, never 0. Ensembles are kept as probabilities, not merged into the mean profile. Temporal linear interpolation between a source's native steps only *between* steps (never beyond the last). | |
| 5 Bias | — | Framework only. Not applied until ≥30 verified cycles per variable, season and lead window. The manifest says `bias_correction: none applied`. | Requirement: only with an adequate record |
| 6 Terrain | `terrain.py`, `prepare` | Hypsometric surface pressure from the blended 3-D state. T2/Td2 lapse correction by Δh to the source's effective orography. Flow diagnostics (TERRAIN.md). | |
| 7 Consistency | `main_run.frame`, `validate` | Supersaturation >5 % clipped (fraction recorded). Probabilities bounded to [0,1]. Negative precip counted. Z monotonicity fraction recorded. Core-field NaN fraction <20 %. Run publishes only if ≥80 % of frames pass. | |

## What the 2 km grid really resolves

Only UKV contributes genuinely ~2 km structure. The other seven sources are 9–31 km fields interpolated onto 2 km.

NOVA's 2 km detail beyond UKV comes from:
- the terrain-aware columns
- terrain diagnostics
- the hazard neighbourhood logic

None of it comes from resolved storm dynamics. This is stated in every manifest's `method` field.

A physical regional engine can be inserted later: `main_run.frame()` takes a dict of per-source fields and returns blended fields, so a convection-permitting integration can become one more "source".

## Running

- Scheduler: the website server starts `python -m nova.main_run --init <local time>` at 03:00, 09:00, 15:00 and 21:00 Europe/London.
- Manual run: `cd tools/tcm-nova && PYTHONPATH=. <venv python> -m nova.main_run --init 2026-10-18T15:00 --horizon 120`
- Environment: `NOVA_DATA` (default `D:/TCM-NOVA/data`), `NOVA_CACHE` (`D:/TCM-NOVA/cache`), `NOVA_MAIN_HORIZON_H`, `NOVA_SCHEDULE=off` to disable the scheduler, `NOVA_PYTHON`.
- Python dependencies (venv at `ukv-platform/.venv`): numpy, scipy, pyproj, eccodes, netCDF4, h5py, tifffile, imagecodecs.
