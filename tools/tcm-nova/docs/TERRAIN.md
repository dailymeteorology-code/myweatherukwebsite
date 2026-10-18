# TCM NOVA — terrain integration

## 1 What NOVA is (architecture assessment, spec §6)

NOVA's Main Run is a **post-processing / deterministic downscaling system**. It blends parent-model fields, recomputes column diagnostics on a 2 km grid and turns them into hazard probabilities. It is **not** a physical model and **not** an AI downscaler (AI is prohibited on the Main Run).

So, per spec §6.2: terrain here **cannot** change the upstream atmospheric dynamics, and NOVA does not claim it does. Terrain enters in three honest ways:

1. **Vertical columns sit on NOVA's terrain.** Surface pressure comes hypsometrically from the blended 3-D state at the cell's mean height. Levels below ground are removed, never extrapolated. Screen T and Td are lapse-adjusted by the difference between NOVA terrain and the terrain at the source's resolution (−6.5 and −1.8 K/km). This is deterministic, and it's what most changes CAPE/CIN over hills.
2. **Flow-dependent terrain diagnostics** are computed every frame from the blended 0–1 km wind and 0–2 km stability.
3. **Physically bounded modulation of the thunderstorm probability.** It can raise *or* lower it, and only where the column can support deep convection.

Hyper-Short stage 1 is kinematic and doesn't use terrain yet. Stage 2's dynamical core will (HYPER_SHORT.md).

## 2 Science summary (with sources)

- **Forced ascent.** Flow up a slope gives w ≈ **V**·∇h at the surface (Smith 1979, *Adv. Geophys.* 21). It decays with height and is limited by stability.
  - With mountain Froude number Fr = U/(N H) < 1, low-level flow is blocked and splits around the barrier rather than rising over it (Smith 1989; Pierrehumbert & Wyman 1985).
  - NOVA computes Fr per cell (`froude`). Where Fr < 1 it removes the terrain-normal wind (flow splitting) and scales ascent by Fr (`w_oro_eff`).
- **Lift isn't initiation.** Orographic ascent must overcome CIN and reach the LFC with enough moisture. Many upslope days produce only stratiform orographic cloud (Kirshbaum et al. 2018, *Atmosphere* 9: "Moist orographic convection: physical mechanisms and links to surface-exchange processes").
  - So NOVA multiplies the terrain term by an environment factor `env = s(MUCAPE) · s(CIN)`. Over a ridge with no CAPE the term is zero: **no artificial hotspots** (tested: `test_terrain_cannot_create_storms_without_model_signal`).
- **Thermal circulations.** Daytime anabatic slope flow and convergence over ridges and heated high ground are well documented (Banta 1990, *AMS Meteor. Monogr.* 23; Demko & Geerts 2010). For GB, the Pennines, Welsh uplands and Highlands commonly see afternoon convergence-line initiation (e.g. COPE campaign, SW England: Leon et al. 2016, *BAMS*).
  - These need time-dependent heating. NOVA uses slope insolation (`slope_insolation`) and the T2-vs-convective-temperature term; static terrain is never used as a substitute.
- **Lee effects.** Descent, warming and drying in the lee suppress initiation, while lee convergence can trigger it downstream.
  - NOVA treats negative `w_oro` as suppression (`oro_down`, tested in `test_terrain_lee_reduces_probability`).
  - Lee convergence is captured only through `terrain_convergence` (flow splitting).
  - Gravity-wave diagnostics are **not** emitted: a credible wave diagnostic needs the full profile of N and U (Scorer parameter) and wavelengths near the grid scale.
- **Hazards.**
  - Terrain-channelled low-level flow can locally raise SRH (Markowski & Dotzek 2011) and hail melting depends on terrain-raised surface height. NOVA's columns already use the true surface height, so WBZ AGL and melting are terrain-aware.
  - Repeated rainfall over catchments needs storm motion and terrain: training probability uses the Corfidi vector. Flash-flood probability is **withheld** until hydrology is ingested.

## 3 DEM comparison

| Dataset | Res. | Type | Vertical | Coverage | Licence (commercial use) | Used |
|---|---|---|---|---|---|---|
| **Copernicus GLO-90** | 3″ (~90 m) | DSM | EGM2008; abs. vertical accuracy ~<4 m (90 % LE, product handbook) | global, seamless across borders | free incl. commercial, attribution | ✔ (from AWS `copernicus-dem-90m`, AWS-only rule) |
| Copernicus GLO-30 | 1″ | DSM | as above | global | same; a few tiles restricted | candidate for 500 m grids |
| OS Terrain 50 | 50 m | DTM (bare earth) | ODN; ±4 m RMSE | GB only | OGL v3 (free, commercial) | candidate GB-only check |
| OS Terrain 5 | 5 m | DTM | ±2.5 m | GB only | paid (PSGA/commercial) | not needed at 1.5–2 km |
| EU-DEM v1.1 | 25 m | DSM hybrid | | EEA39 | free, attribution | superseded by Copernicus DEM |

**Why GLO-90.** It's one seamless global product (no border discontinuities for Europe expansion), it's on AWS, and it's licensed for commercial use.

Its DSM canopy bias (~10–20 m in forest and towns) is two orders of magnitude below the resolved-terrain signal at 1.5–2 km cells.

90 m spacing gives ~500 samples per 2 km cell, enough for robust sub-grid statistics. 30 m would add nothing at these grid spacings.

A 30 m DEM does **not** make a 2 km forecast a 30 m forecast. The terrain, atmospheric-grid and physics resolutions are different things, and only the coarsest one governs what's resolved.

**Required attribution:** © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

## 4 Pipeline (`terrain.py`)

1. Download each 1° COG tile once (cached on `D:/TCM-NOVA/cache/dem`; sea tiles are recorded as absent).
2. Read the native geographic grid, transform every 90 m sample to the target grid CRS, and accumulate per-cell **count, mean, variance, min, max, land fraction, mean |∇h|, mean ∂h/∂x, ∂h/∂y**. This is area-conservative and never naïvely averaged: ridges keep their max, valleys their min.
3. Derived static fields:
   - `h_mean` (resolved terrain, used for columns)
   - `h_dyn` (Gaussian σ = 1Δ, for flow diagnostics only; removes 2Δx noise)
   - sub-grid `h_std`, `h_min`/`h_max`/`h_range`, `subgrid_slope`
   - slope, aspect, curvature, profile and plan curvature, TRI ruggedness
   - TPI, local mean/max/min at **6, 20 and 50 km**:
     - 6 km resolves valley and ridge pairs at 2 km grids
     - 20 km matches Pennine and Welsh-upland barrier widths
     - 50 km represents regional exposure like the Highlands
   - landform class, distance to high ground / coast / ridge / valley, orographic z0
4. Four representations are kept apart, as required: dynamics (`h_dyn`), resolved (`h_mean`), sub-grid statistics, and display (the basemap's own).
5. Saved as versioned `.npz` plus provenance JSON (dataset, datum, licence, tile list hash, parameters). Built once per grid; forecasts only load it.

Checks:
- Ben Nevis cell max **1341 m** (true summit 1345 m).
- GB land area plausible after masking COP-DEM's 0 m water.
- Tile-seam test (`test_terrain_tiles_have_no_seams`).

## 5 Feature inventory used per frame (`flow_diagnostics`)

| Diagnostic | Definition | Units | Used for |
|---|---|---|---|
| `w_oro` | u ∂h/∂x + v ∂h/∂y on `h_dyn`, grid-relative winds (rotated by grid convergence), BNG metres | m/s | ascent/descent term. **Not** model w |
| `w_oro_eff` | w_oro × min(Fr,1) | m/s | stability-limited ascent |
| `froude`, `blocked` | U/(N·relief₂₀ₖₘ), N from 0–2 km θv | – | blocking / splitting |
| `upslope_wind`, `downslope_wind`, `terrain_normal_wind`, `terrain_parallel_wind` | projections on ∇h | m/s | display / diagnostics |
| `upwind_height_max`, `upwind_gain`, `upwind_obstruction` | terrain sampled 5/10/20 km upwind | m | exposure / shelter |
| `windward_exposure` | tanh(gain/150 m) | –1..1 | windward vs lee |
| `terrain_convergence` | −∇·V after flow splitting | s⁻¹ | terrain-relative convergence potential |
| `valley_alignment` | cos(wind − valley axis) in valley cells | 0..1 | channelling |
| `slope_insolation` | cos incidence on slope (no horizon shading) | 0..1 | differential heating |

Outputs exposed on the page: `w_oro`, `windward_exposure`, `p_ci_orographic` (the terrain-attributable part of initiation) and `terrain_modulation`. They're all labelled "terrain diagnostic", separate from NWP fields and from probabilities.

## 6 Experiments A–F (spec §10): status

**Not run yet.** They need a historical archive of parent forecasts plus radar and lightning for several seasons, and none exists locally. NOVA starts archiving per-source fields from its first run (`sources/` per run).

`hazards.compute` already isolates the terrain term (`terrain_modulation`), so experiments B–F are switches on that term:
- A: factor = 1
- B: elevation-only columns
- C: plus static features
- D: plus `w_oro`/Froude
- E: plus environment interaction (current)
- F: plus multi-scale TPI

`verify.py` provides the metrics (FSS, Brier/BSS, POD/FAR/CSI), stratified by lead. Stratification by landform class and windward/lee is the next addition.

**No improvement from terrain is claimed.**

## 7 Deploying / extending

- GB: built.
- Ireland and Europe: add a grid in `config.GRIDS` (LAEA EPSG:3035 for Europe), widen `LAT_RANGE`/`LON_RANGE`, run `terrain.build(<grid>)`. GLO-90 is seamless, so there are no border artefacts.
