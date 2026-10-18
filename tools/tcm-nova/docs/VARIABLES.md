# TCM NOVA — variable inventory

Every variable in the supplied inventory, classified and given an honest status.

**Class**: **P** prognostic state (comes from a model or the analysis) · **D** diagnostic (derived from the state) · **T** process tendency · **O** observational input · **F** forecast target/output · **C** coordinate/config · **V** verification.
**Tier** (requirement 7): **M** mandatory baseline · **A** improves accuracy · **X** optional advanced.
**Status**:
- **✔ impl**: computed or ingested in code now. Where it says *stored*, it's written to every Main Run frame.
- **◐ src**: available only where a source publishes it. It's used inside the pipeline but not every source has it.
- **✘ n/a**: not obtainable from any AWS-published source or keyless observation feed, so it isn't produced. It's never faked (requirement 5).

Units are SI unless noted. Grids are BNG 2 km (Main) and 1.5 km (Hyper). Times are UTC, with Europe/London shown for display. Missing data is NaN, never 0.

Column diagnostics use `thermo.py` / `diagnostics.py` on every 2 km column of the blended 3-D state (requirement 3). Hazard probabilities in `hazards.py` are conditional on a model or ensemble convective signal (requirement 6).

## 1 Core atmospheric state
| Variable | Class/Tier | Status / source / method |
|---|---|---|
| T, q (via RH or q), u, v, Z, p | P/M | ✔ impl. Blended profile on 19 p-levels from UKV (33 levels, 2 km), IFS, AIFS and GFS. Log-p interpolation, no extrapolation through the ground. |
| θ, Tv, θv, qv (r), RH, Td, ρ, e, es | D/M | ✔ impl `thermo.build_columns`. Bolton (1980) es, ρ = p/(Rd Tv). |
| Φ = gZ | D/M | ✔ impl (Z m, Φ = 9.80665 Z). |
| ω (pressure vertical velocity) | P/A | ◐ src: IFS, AIFS and GFS publish ω. Blended; `omega_700` stored. |
| w | D/A | ◐ derived as w ≈ −ω/(ρg) where ω exists. Not a resolved storm updraft. |
| Wind speed / direction | D/M | ✔ impl at every level. |
| Mass continuity, kinetic and internal energy | D/X | ◐ divergence fields computed (continuity check). KE = ½(u²+v²) is derivable but not stored. Internal energy cvT isn't used: no prognostic integration on the Main Run. |

## 2 Coordinates and dimensions
Latitude and longitude, model altitude/level, pressure level, grid spacing, time step, init/valid/lead time, domain bounds, terrain elevation and land-sea mask are all ✔ impl (`config.py`, `grid.py`, manifests, `terrain.py`).

Main Run has no integration time step because it's a blend. The Hyper engine's internal step is 5 min.

## 3 Moisture
✔ impl from the blended columns:
- specific humidity, mixing ratio, RH and dew point at every level
- dew-point depression (850 stored)
- surface and 2 m dew point
- low, mid and upper PW (sfc–850, 850–500, 500–200 hPa) and total PW = integrated water vapour
- layer PW
- saturation and actual vapour pressure
- wet-bulb temperature (Normand) and wet-bulb-zero height
- moisture advection (`qadv_850`)
- moisture-flux convergence (`mfc_sfc`)
- horizontal moisture gradients (via advection) and vertical moisture gradient (profile)
- boundary-layer moisture convergence
- dry-air intrusion (`rh_700_500`)
- moisture deficit (`rh_subcloud`, DD)
- moisture transport (q·V)

◐ src: latent heat flux / evapotranspiration (GFS LHTFL, UKV sensible only); soil evaporation.

✘ n/a: an evaporation rate separate from the latent heat flux, and plant transpiration as its own field. No AWS source splits these.

## 4–5 Cloud microphysics (liquid, ice, hail)
QCLOUD, QRAIN, QICE, QSNOW, QGRAUP, hail mixing ratio, and every number concentration, size distribution, effective radius, CCN/INP/aerosol, nucleation, deposition, sublimation, freezing, melting, riming, aggregation, accretion, autoconversion, collision-coalescence, sedimentation and fall-speed term: **✘ n/a**.

None of the AWS-published models (UKV, MO Global, IFS, AIFS, GFS, GEFS) put hydrometeor mixing ratios or microphysical process rates in their open-data files. NOVA's Main Run doesn't integrate microphysics, so it can't produce them honestly. They're the core of Hyper-Short stage 3 (docs/HYPER_SHORT.md).

What *is* used instead, and labelled as such:
- ◐ UKV `hail_fall_accumulation` (a model hail surface flux)
- ◐ UKV cloud base height and cloud amount
- ✔ supercooled/mixed-phase *depth* (−10 to −40 °C layer) and mixed-phase CAPE, as electrification and hail environment proxies
- ✔ parcel liquid-water loading isn't modelled; the 0.5 updraft factor documents that
- latent heating appears implicitly through the pseudo-adiabatic parcel

## 6 Radiation
- ◐ src: incoming SW and LW at the surface (UKV), and net SW and LW where GFS provides them.
- ✔ impl: solar zenith angle and slope insolation (`terrain.slope_insolation`).
- ✘ n/a: outgoing SW and LW at TOA, cloud radiative forcing, atmospheric heating rates, cloud optical depth, emissivity and albedo. These aren't in the AWS open subsets.

## 7 Boundary layer and turbulence
- ✔ impl: PBL height (θv parcel method), BL stability (0–2 km Brunt–Väisälä), mixing depth (= PBL height), BL T/q profile (columns), BL convergence (`conv_10m`), surface-layer shear (0–500 m), surface drag proxy (orographic z0).
- ◐ src: sensible heat flux (UKV, GFS) and latent heat flux (GFS).
- ✘ n/a: TKE, eddy diffusivity, turbulent fluxes beyond the surface fluxes, friction velocity and thermals. They're parameterisation internals that aren't published.

## 8 Land surface and lower boundary
- ✔ impl: T2, Td2/Q2, U10/V10, speed and direction, surface pressure (hypsometric on NOVA terrain), terrain elevation, slope, aspect and orographic forcing.
- ◐ src: skin temperature (UKV, GFS, IFS, AIFS), top-layer soil moisture (GFS SOILW, IFS/AIFS vsw), snow depth / SWE (UKV, GFS), SST (via skin T over sea).
- ✘ n/a for now: soil type, hydraulic properties, land cover, vegetation fraction and type, and albedo.
  - Static datasets for these (ESA WorldCover, SoilGrids) are listed as next-step ingestion in TERRAIN.md.
  - Sea-ice concentration is irrelevant for GB.

## 9 Thermodynamic instability
✔ impl and stored:
- SBCAPE / MLCAPE / MUCAPE and SBCIN / MLCIN / MUCIN
- DCAPE and 0–3 km CAPE (low-level CAPE)
- LI, Showalter, K Index, Total Totals
- lapse rates: 0–1 km, 0–3 km, 3–6 km, 700–500, 500–300; environmental lapse rate (profile)
- dry adiabatic (g/cp) and moist adiabatic (implicit in parcels)
- LCL, LFC and EL
- maximum parcel buoyancy and the buoyancy profile (in `lift`)
- CIN strength and capping inversion strength and depth
- convective temperature
- freezing level, WBZ, and the −10, −20, −30 and −40 °C heights
- melting-layer depth (FL − WBZ)

## 10 Wind, shear and kinematics
✔ impl:
- wind at every level, the hodograph (u,v on 16 heights per column), and speed and directional shear
- bulk shear 0–1, 0–3, 0–6 and 0–8 km, and effective bulk shear (EBWD)
- Bunkers storm motion, storm-relative wind and inflow (speed and direction)
- SRH 0–1, 0–3 and effective; effective inflow layer base, top and depth
- horizontal vorticity (0–500 m) and vertical / relative / absolute vorticity (10 m, 925, 850, 500, 300, 250 hPa)
- isobaric PV approximation; convergence and divergence (10 m, 925, 850, 300, 250 hPa)
- LLJ speed and height; mid (500) and upper (250) wind
- Corfidi upshear vector
- ◐ ω where published

✘ n/a: **updraft helicity**, a storm-scale model output that isn't published on AWS. Vertical momentum transport needs a convective model.

## 11 Initiation and lifting
- ✔ impl:
  - surface convergence and low-level moisture convergence
  - large-scale vertical motion (ω700)
  - CI probability (`p_initiation`) and CIN removal (via the `env` term)
  - differential heating (Tc vs T2, slope insolation)
  - orographic uplift (`w_oro`, `w_oro_eff`) and terrain-induced flow (Froude blocking, terrain convergence)
  - frontogenesis 850, warm/cold air advection (`tadv_850`), moisture advection
  - vorticity advection 500, upper-level divergence and Q-vector convergence 700
- ◐ jet-streak forcing (250 hPa wind and divergence fields).
- ✘ n/a as discrete objects: front, dryline and outflow-boundary *positions*, sea/land-breeze circulation, and gust-front position. Object detection on the gridded fronts (|∇θ| × frontogenesis) is a planned addition; no position is shown until it's verified.

## 12 Updrafts and downdrafts
- ✔ impl as **environment estimates, labelled as estimates**:
  - parcel-theory updraft bound √(2 MUCAPE) and the loaded/entraining updraft estimate (×0.5)
  - downdraft estimate 0.4√(2 DCAPE)
  - evaporative cooling potential (DCAPE, sub-cloud RH)
  - convective gust estimate and maximum gust
- ✘ n/a: explicit updraft and downdraft velocities, accelerations, mass flux, width and depth; updraft liquid and ice content; cold-pool depth and density. These need a storm-resolving model integration.

## 13 Cloud structure and evolution
- ◐ cloud base (UKV) and cloud fraction (UKV).
- ✔ cloud-top height ≈ EL and cloud depth ≈ EL − LCL, both parcel estimates.
- ✔ storm motion, direction and speed (Bunkers).
- ✔ organisation type (`organisation`) and convective coverage.
- ✔ initiation, peak and dissipation time, from the run's frame series. They're shown via the timeline.
- ✘ n/a: cell objects (area, diameter, lifetime, merger, regeneration, spacing), cloud-top cooling, echo top and stratiform fraction. A storm-object tracker over the Hyper-Short field is stage 2.

## 14 Supercell / tornado environment
- ✔ SCP, STP (effective layer), EHI 0–1 and 0–3, BRN, BRN shear, low/deep SRH, EBWD, low-level CAPE and LCL, effective inflow depth, near-surface horizontal vorticity, storm-relative inflow, supercell probability and tornado-environment probability.
- ✘ n/a: updraft helicity, mesocyclone strength, depth and persistence, and tornado *occurrence* probability. NOVA forecasts the environment only, and the UI says so.

## 15 Hail
- ✔ hail occurrence probability, significant hail probability (≥4 cm), maximum hail size estimate (terminal-velocity balance plus melting) and hailstone survival. Every ingredient listed (CAPE, lapse rate, FL, WBZ, isotherm heights, updraft estimate) is used.
- ◐ UKV hail fall accumulation.
- ✘ n/a: hail and graupel mixing ratios and size distributions, and the swath (needs a storm tracker).

## 16 Damaging wind
✔ DCAPE, downdraft estimate, sub-cloud lapse rate and RH, moisture deficit, convective gust, maximum gust, damaging-wind probability and downburst probability.

✘ n/a: mass flux, loading, and melting/sublimation cooling terms. Cold-pool strength is only a proxy, via DCAPE.

## 17 Heavy rainfall and flash flood
- ✔ precipitation rate (3 h mean), 3 h accumulation, running accumulation (6/12/24 h by differencing), PW, MFC, training probability (Corfidi), heavy-rain probability (deterministic plus ensemble ≥10 mm/h).
- ◐ antecedent soil moisture (top layer).
- ✘ on Main Run: 5, 15 and 30 min and hourly accumulations, because the frames are 3-hourly. Hyper-Short has 30 min accumulations ✔.
- ✘ n/a: infiltration capacity, drainage and flash-flood thresholds. Flash-flood **probability is not shown** until hydrological data are ingested (requirement 8.3 of the terrain spec: never from terrain alone).

## 18 Lightning and electrification
- ✔ lightning probability, flash-rate estimate (Price & Rind 1992 from EL height), flash density and mixed-phase depth.
- ◐ UKV explicit lightning.
- ✔ O: LEELA strikes (Hyper-Short, verification).
- ✘ n/a: charge structure, charge density, E-field, potential, and ice–graupel collision rate. No electrification scheme exists.

## 19 MCS / organisation
✔ coverage, multicell/supercell/linear classes, MCS probability and cold-pool proxy.

✘ n/a: line orientation and propagation, rear-inflow jet and bow-echo potential. These need an object tracker (stage 2).

## 20 Large-scale environment
- ✔ MSLP, surface pressure, Z/T/q/wind on all levels, gradients (`z500_grad`, `mslp_grad`, θ gradient), convergence and divergence, vertical motion, jet speed (250), PV, vorticity advection, temperature and moisture advection, Q-vector forcing.
- ✘ n/a as objects: trough, ridge, cyclone and front locations.

## 21 Radar / satellite / obs
- ✔ O: radar rain rate (1 km composite), lightning locations and rates.
- ✘ not wired (keyless real-time access not available):
  - radial velocity, dual-pol, echo tops and rotation (single-site data needs a licence)
  - satellite (EUMETSAT registration)
  - stations, sondes and aircraft (see HYPER_SHORT.md)
  - GNSS-IWV, gauges and soil-moisture observations

## 22 Data assimilation / initialisation
- **Main Run**: parent-model forecast fields ✔ and boundary conditions (the parents) ✔. No DA cycle: NOVA blends, it doesn't assimilate.
- **Hyper**: radar and lightning inputs ✔, observation QC flags (range, freshness, coverage) ✔, uncertainty notes ✔. No background field, by rule.
- Analysis increments and 3-D initial fields: ✘ (stage 2 of HYPER_SHORT.md).

## 23 Ensemble and uncertainty
- ✔ ensemble mean precip and CAPE, spread, and thunder / heavy-rain probabilities from IFS ENS (50), AIFS ENS (50) and GEFS (30).
- ✔ source disagreement, confidence, and probability of exceeding thresholds.
- Ensemble T, q and wind means: ✘. Only surface precip and CAPE members are downloaded, to keep each run tractable; more can be added in `sources.ECMWFEns.params`.
- Calibration error: ✔ via verify.py once a record exists.

## 24 Numerical modelling
Documented in DOWNSCALING.md: grid, vertical levels, remapping schemes, stability checks and conservation checks.

Physics schemes (microphysics, radiation, PBL, LSM, convection) are those of the **parent models**. NOVA doesn't run its own; manifests say so.

## 25 Outputs
Everything in the list is ✔ except:
- "Thunderstorm cell location / lifetime": ✘, needs a tracker.
- "Flash-flood potential": ✘, withheld pending hydrology.
- Hazard arrival, duration and footprint are visible via the frame series. The run-maximum fields are stored under `summary/`.

## 26 Verification
verify.py computes:
- FSS per source
- Brier, BSS, POD, FAR and CSI for p_thunder against lightning
- reliability inputs (per-frame p vs event)

ETS, ROC and spread-skill are the next additions. No accuracy is claimed until there's a record (requirement 10).
