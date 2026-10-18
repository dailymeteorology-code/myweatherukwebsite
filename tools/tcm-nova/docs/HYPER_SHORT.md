# TCM Hyper-Short: what exists, what doesn't, and the staged plan

> **Update 18 Oct 2026, by the user's instruction:** Hyper-Short now also uses the **latest UKV run**, and only UKV, for everything observations can't provide. The rest of this document describes the observation part.
>
> `hyper/ukv_env.py` computes the 3-D environment (CAPE/CIN/LCL/LFC/shear/SRH/DCAPE/freezing levels) and UKV hazard probabilities:
> - on UKV's own ~2 km columns, through the same code as the Main Run, then remapped to 1.5 km
> - hourly to T+12 and 3-hourly to T+24, time-interpolated between
>
> The observation nowcast and UKV are blended with nowcast weight exp(−lead/90 min). `test_hyper_lineage_is_obs_plus_ukv_only` enforces "observations + UKV, nothing else".

## Implemented (stage 1): `nova/hyper`

- **Schedule.** Every London clock hour, from `server/tcmNova.js`. DST-safe and tested; 24 runs a day including transition days.
- **Grid.** BNG 1.5 km (467 × 834).
- **Frames.** 49 frames, T+0 to T+24:00 every 30 min. The Node API rejects any lead beyond T+24 (HTTP 416).
- **Observation ingestion (`obs.py`)**, observations only:
  - Met Office 1 km radar composite: every 15 min, ~10 min latency, AWS.
  - LEELA lightning (last 48 h).
  - Freshness check: the newest radar must be ≤ 45 min old, or the run fails and the last valid run stays published.
  - Coverage check: ≥ 60 % of the domain.
  - QC: rates > 250 mm/h discarded.
- **Analysis.** Radar is conservatively remapped to 1.5 km. Lightning density (strikes/km²/h, last 30 min) is gridded. A motion field comes from phase correlation between composites 60 min apart, with sub-cell refinement. The analysis is advected from radar time to init time.
- **Engine.** Semi-Lagrangian advection, with large-scale rain (>20 km, e-folding 6 h) and small-scale convective structure (e-folding 45 min) decaying separately, and lightning (e-folding 40 min). Probabilities come from a neighbourhood that widens with lead and speed.
- **Lineage enforcement.** `tests/test_nova.py::test_hyper_has_no_nwp_lineage` parses every Hyper module and fails on any import of model readers or any model-bucket string. Each manifest lists `nwp_inputs: []`.
- **Honesty in the product.**
  - The manifest's `unavailable` names every field not produced.
  - `skill_horizon` says useful to ~T+3 h.
  - Frames after T+3 h carry `beyond_skill_horizon` and the page shows a notice.

**Measured on the first run** (16:00 BST 18 Oct 2026):
- radar 0 min old, 85 % coverage
- 170 motion blocks
- 49 frames in 220 s
- 43 MB on disk

## Why stage 1 is not a 24-hour NWP

Radar and lightning don't determine the 3-D temperature, humidity and wind. The keyless real-time feeds for those don't exist for GB:
- SYNOP/AWS: the Met Office DataPoint observations API is retired; DataHub obs is keyed.
- Radiosondes: no keyless real-time GB source.
- AMDAR: restricted.
- EUMETSAT satellite: registration.
- E-GVAP GNSS: not open.

Without them, an "independent 3-D solver" would have to invent its initial state. The brief prohibits that, and using a model background is also prohibited. So stage 1 forecasts what the observations determine, and says so. It can't create new storms; that's what stages 2–3 add.

## Stage 2: observation analysis in 3-D (no model background)

1. **Ingest:** surface stations (needs a DataHub *observations* key or WOW), radiosondes (Met Office DataHub / WMO GTS via a licensed feed), Mode-S EHS aircraft winds/temperatures (licensed), and EUMETSAT MTG FCI/IRS (registration; IRS gives temperature/humidity profiles).
2. **Background:** a climatological profile set (from historical radiosondes) plus persistence of NOVA's *own* previous Hyper-Short analysis. This is legal under the rule because it's NOVA's own analysis, not another model's forecast.
3. **Objective analysis:** 3-D Barnes / optimal interpolation with observation-error and representativeness covariances, plus analysis-error variance output (the "uncertainty where obs are sparse" requirement).
4. **Outputs:** T, q, u, v profiles, so CAPE/CIN/shear can be computed with the existing `thermo.py`.

## Stage 3: dynamical core

- Non-hydrostatic, compressible, terrain-following (Gal-Chen) equations on the 1.5 km grid.
- Split-explicit RK3 (Wicker & Skamarock 2002).
- Single-moment ice microphysics (Kessler warm rain + graupel), Smagorinsky/TKE turbulence, bulk surface fluxes, and a fast two-stream radiation scheme.
- Domain extended to ≈ 50°W–10°E with relaxation boundaries towards the *observed* analysis, held persistent. No external lateral boundary forecasts.

Expected limitation, stated up front: with persistent boundaries, systems entering from the Atlantic after ~6–12 h will be misrepresented. Skill must be measured by lead against persistence and the stage-1 kinematic forecast, and the product must report it.

## Verification plan

Per lead (0.5 h bins):
- radar FSS at 1/4/10 mm/h
- lightning Brier/BSS and POD/FAR/CSI
- comparison against persistence and against the stage-1 engine

Reported with sample sizes. No skill is claimed yet.
