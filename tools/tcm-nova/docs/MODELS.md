# TCM NOVA — model research, weighting and ensemble strategy

> **Labelling.** Every weight below is **provisional**, meaning expert-set. None is yet *evidence-based* or *empirically calibrated*. The baseline table is the one supplied, unchanged.
>
> No accuracy percentages are claimed for any model. There's no public, directly comparable verification of these systems for **severe convective hazards over GB**, so none is quoted.
>
> Configuration facts come from operator documentation as understood at the research date (Oct 2026). Items marked *(verify)* should be re-checked against the operator's current page before any external publication.

## Deliverable 1: inventory

| # | System | Grid / members | Cycles & length | GB coverage | Access used by NOVA | Role |
|---|---|---|---|---|---|---|
| 1 | **UKV** (MetUM RA3) | 1.5 km inner, variable to 4 km. Open data on 2 km LAEA, 70 levels; 33 p-levels published | hourly; long runs to T+120 *(verify)* | full | ✔ AWS `met-office-atmospheric-model-data/uk-deterministic-2km` | short-range convective guidance, the only explicit lightning and hail source, profiles |
| 2 | MOGREPS-UK | 2.2 km, 18 members, hourly time-lagged | to T+126 | full | ✘ **not on AWS** (DataHub, paid) | renormalised away |
| 3 | MO Global (GM) | ~10 km | 4×/day to T+168 | full | ✔ AWS `global-deterministic-10km` (surface/convective fields only; global p-level files ~200 MB each are not pulled) | synoptic, MU CAPE/CIN, convective rain |
| 4 | MOGREPS-G | ~20 km, 18 members ×4 lagged | to T+198 | full | ✘ not on AWS | renormalised away |
| 5 | **ECMWF IFS HRES** (Cy49r1 *(verify)*) | 9 km O1280, open data at 0.25° | 00/12 to 240 h, 06/18 to 90 h | full | ✔ AWS `ecmwf-forecasts …/ifs/0p25/oper` | profiles, MUCAPE, ω, precipitation |
| 6 | **IFS ENS** | 50 perturbed (open feed has no control) at 0.25° | 00/12 to 360 h | full | ✔ `…/ifs/0p25/enfo`, tp + mucape per member | probabilities, spread |
| 7 | **AIFS Single** | ~0.25°, 13 p-levels, no CAPE | 4×/day to 360 h | full | ✔ `…/aifs-single` | supplementary large scale (AI) |
| 8 | **AIFS ENS** | 50 members ~31 km *(verify)* | 00/06/12/18 | full | ✔ `…/aifs-ens`, tp per member | supplementary probabilities (AI) |
| 9 | ICON Global | 13 km | 4×/day | full | ✘ not on AWS (DWD opendata) | — |
| 10 | ICON-EU | 6.5 km | 8×/day to 120 h | full | ✘ not on AWS | renormalised away |
| 11 | ICON-D2 | 2.2 km | 8×/day to 48 h | **does not cover most of GB** (central Europe domain) | ✘ | Europe expansion only |
| 12 | ICON-EPS / EU nest | 40 members, 26.5 / 13.2 km | | full | ✘ not on AWS | renormalised away |
| 13 | ICON-D2-EPS | 20 members, 2.2 km | | no GB coverage | ✘ | Europe expansion only |
| 14 | AROME (France) | 1.3 km | hourly | edges of SE England only | ✘ | France profile |
| 15 | PEAROME | 25 members, 2.5 km *(verify)* | | France | ✘ | France profile |
| 16 | ARPEGE | variable 5–24 km | 4×/day | full | ✘ not on AWS | renormalised away |
| 17 | PEARP | 35 members | | full | ✘ not on AWS | renormalised away |
| 18 | HARMONIE-AROME (Met Éireann) | 2.5 km, 65 levels | | Ireland + W GB | ✘ not on AWS. DMI's DINI HARMONIE **is** on AWS but isn't in the supplied table | Ireland profile candidate |
| 19 | IREPS | HARMONIE ensemble | | Ireland | ✘ | Ireland profile |
| 20–22 | HRRR / RAP / NAM | 3 / 13 / 12 km | | **North America only** | — | **zero weight** in GB/Europe |
| 23 | **GFS** | 0.25° (~13 km FV3), 41 p-levels | 4×/day to 384 h | full | ✔ AWS `noaa-gfs-bdp-pds` | independent global profiles, CAPE/CIN |
| 24 | **GEFS** | 30 perturbed (+control), 0.5° open data | 4×/day | full | ✔ AWS `noaa-gefs-pds/pgrb2ap5`, APCP + CAPE per member | independent ensemble |
| 25 | COSMO | superseded by ICON at DWD (2021–23) | — | — | — | **zero weight**: obsolete or duplicate |
| 26 | WRF | a framework, not a forecast | — | — | — | **zero weight** until a defined, verified configuration exists |

**Data rule.** The user's rule is AWS only, never Open-Meteo. Of the 14 rows in the baseline table, **8 are reachable**: UKV, MO Global, IFS, IFS ENS, AIFS, AIFS ENS, GFS and GEFS.

The other 6 (MOGREPS-UK, MOGREPS-G, ICON-EU, ICON-EPS, ARPEGE and PEARP) aren't published on AWS. They're excluded and their weight renormalised, exactly as the table's own rule requires for unavailable models.

Every manifest lists them under `unavailable` with the reason. Each run marks itself **degraded** when a reachable source is missing.

## Effective baseline after renormalisation (8 AWS sources, before family caps)

| Source | 0–6 h | 6–24 h | 24–72 h | 72–120 h |
|---|---:|---:|---:|---:|
| UKV | 35.1 | 26.2 | 6.9 | 1.8 |
| MO Global | 3.5 | 4.9 | 10.3 | 14.3 |
| IFS HRES | 15.8 | 16.4 | 17.2 | 16.1 |
| IFS ENS | 24.6 | 26.2 | 31.0 | 35.7 |
| AIFS | 1.8 | 3.3 | 5.2 | 7.1 |
| AIFS ENS | 5.3 | 8.2 | 12.1 | 14.3 |
| GFS | 3.5 | 3.3 | 8.6 | 8.9 |
| GEFS | 8.8 | 6.6 | 13.8 | 16.1 |
| **Total** | 100 | 100 | 100 | 100 |

Family caps (initial development only): Met Office ≤55 %, ECMWF ≤55 %, NOAA ≤30 %.

The ECMWF family (IFS + ENS + AIFS + AIFS ENS) reaches 47–73 % after renormalisation, so the cap binds at 24–120 h. Its excess is redistributed proportionally to the Met Office and NOAA families. That is what the brief's "do not let one centre dominate through related systems" asks for. It's also exactly the kind of choice the skill record must later confirm or overturn.

## Dynamic per-run weighting (the "auto-determine" requirement)

`weights.dynamic()` runs for every frame, for each hazard:

1. Baseline weight for the lead window.
2. Eligibility: on AWS, cycle reaches the valid time (no extrapolation), and covers the cell (per-cell renormalisation at UKV's rotated domain edge).
3. Skill update. `verify.py` scores every source's saved 0–24 h precipitation against radar with FSS (1 mm/h, 30 km) before each run. Then:
   weight ∝ baseline^(1−a) · (baseline·FSS/mean FSS)^a, with a = n/(n+20).
   - With no record, a = 0: the baseline is used, honestly labelled.
   - After 20 verified cycles, skill has half the say.
   - Shrinkage stops a few lucky days from swinging the blend (requirement 8, overfitting).
   - Only runs that ended before the current initialisation are scored, so there's no leakage.
4. Hazard emphasis multipliers (`HAZARD_EMPHASIS`), for example UKV ×1.6 for lightning because it's the only explicit lightning source. These are **provisional** expert multipliers.
5. Family caps, then renormalise to exactly 100 %.

Every step is recorded in the frame metadata (`weights_environment`) and shown on the page's *Sources & method* tab.

## Deliverable 2: rankings (expert judgement, not demonstrated verification)

| Purpose | Ranking among AWS-reachable sources | Basis |
|---|---|---|
| Short-range initiation (0–24 h) | UKV > IFS ENS > IFS > GEFS > GFS > MO Global > AIFS ENS > AIFS | UKV is the only convection-permitting member. Ensembles carry placement uncertainty. |
| Convective precipitation | UKV > IFS ENS > IFS > MO Global > GEFS > GFS > AIFS(ENS) | AI models smooth intense rain (ECMWF's own AIFS severe-weather note) |
| Lightning | UKV (explicit) ≫ others (via CAPE × precip) | only explicit field |
| Hail | UKV hail field + profile-based estimate | no AWS source has hail mixing ratio |
| Damaging wind | UKV gust, IFS gust, profile DCAPE | |
| Supercell environment | IFS ≈ GFS ≈ UKV profiles; IFS ENS for uncertainty | shear and SRH are large-scale-controlled |
| 72–120 h environment | IFS ENS > GEFS > AIFS ENS > IFS > MO Global > GFS | ensembles dominate at range |

## Deliverable 4: hazard-specific weighting

The table weights × `HAZARD_EMPHASIS`. Initiation favours UKV and IFS ENS. Precipitation favours UKV. Lightning favours UKV. Hail favours UKV, with AI models down-weighted. Wind favours UKV and IFS. Supercell favours IFS and IFS ENS.

Observations (radar, lightning) are **not** blended as if they were models. They enter Hyper-Short as its initial state, and they verify the Main Run (section 6 of the brief).

## Deliverable 5: ensemble strategy

- **One weight per ensemble system**, split equally among its members (`hazards.ensemble_probs`).
- Members never outvote deterministic systems by number.
- Probabilities: thunder = P(member precip ≥ 0.5 mm/h ∧ member CAPE ≥ 150 J/kg).
  - AIFS ENS has no CAPE, so it uses member precip ≥ 1 mm/h × the blended environment.
  - Rain probabilities use ≥ 1, 5 and 10 mm/h.
- Mean and spread are kept: `precip_spread` and source disagreement feed `confidence`.
- **Time-lagged**: each source uses its newest cycle available at NOVA initialisation. Lagged cycles aren't double-counted (one cycle per system per run). Adding a lagged IFS ENS member set is a planned experiment, to be accepted only if verification shows a gain.
- Bias correction before combining: the framework is in place (`bias_correction` manifest field). It's **not applied** until verify.py has ≥ 30 cycles per variable, season and lead.

## Deliverable 7: recommendation

**GB now:** run the 8 AWS sources with the supplied baseline, renormalised and family-capped, with skill updating switched on (it already is) and probabilities labelled uncalibrated.

The biggest data gaps preventing a definitive weighting are:
- (a) MOGREPS-UK, which is likely the single most valuable missing source for 0–24 h probabilities. It needs Met Office DataHub access, i.e. a decision outside the AWS-only rule.
- (b) Any ICON or ARPEGE family, for independence.
- (c) A multi-season verification record.

**Europe path:**
1. Add a LAEA (EPSG:3035) grid entry.
2. Add DMI HARMONIE (already proven on AWS in `tools/storm-blend`) for Ireland and North Sea.
3. Add ICON-D2/D2-EPS (DWD opendata) and AROME/PEAROME (Météo-France) only when the data policy allows non-AWS sources, each with a regional weight profile. Their weight comes out of the regional-model allocation, not on top of it.
