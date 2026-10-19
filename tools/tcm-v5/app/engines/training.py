"""Training contracts for the specialist engines.

NOTHING IS TRAINED HERE. This module defines what a later stage would need in
order to replace or augment a rule-based engine with a fitted model: the
target, the features, the splits, and the leakage rules. Building the
interface before the model is deliberate -- a model fitted against a badly
specified target is worse than no model, because it looks like progress.

WHY THE TARGET DEFINITION IS THE HARD PART
-------------------------------------------
Every engine here could be trained against "did it thunder", and every one
so trained would collapse into the same model. The initiation engine would
learn storm maturity, the organisation engine would learn initiation, and
the tornado engine would learn that tornadoes are rare. Each `TrainingSpec`
below therefore states its target precisely and, where the obvious target is
wrong, says so.

LEAKAGE
-------
The rules in `LeakageRules` are not generic ML hygiene; they are specific to
operational forecasting, where the commonest mistakes are subtle:

  * using an ANALYSIS valid at the forecast time as a predictor, when only a
    forecast was available at issue time
  * training on reanalysis fields that assimilated the very observations
    used as the target
  * splitting randomly in space and time, so a cell 2 km and 10 minutes away
    from a training case appears in validation -- which inflates skill
    enormously for convection, where that neighbour is nearly the same event
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from enum import Enum


class TargetSource(str, Enum):
    LIGHTNING_NETWORK = "lightning_network"
    RADAR = "radar"
    SATELLITE = "satellite"
    SURFACE_OBSERVATIONS = "surface_observations"
    STORM_REPORTS = "storm_reports"
    RAINFALL_ANALYSIS = "rainfall_analysis"
    FORECASTER_LABELS = "forecaster_labels"


class SplitStrategy(str, Enum):
    #: Whole days or events held out. The minimum defensible split for
    #: convection, since cases within a day are strongly correlated.
    TEMPORAL_BLOCK = "temporal_block"
    #: Whole regions held out, to test spatial transfer.
    SPATIAL_BLOCK = "spatial_block"
    #: Both, which is what an operational claim of skill requires.
    SPATIOTEMPORAL_BLOCK = "spatiotemporal_block"
    #: Held out by regime, to test whether skill transfers between them.
    REGIME_BLOCK = "regime_block"


@dataclass(frozen=True, slots=True)
class LeakageRules:
    """What must not enter the features. Defaults are the strict answers."""

    #: Only fields available AT ISSUE TIME may be predictors. An analysis
    #: valid at the forecast time was not available when the forecast was
    #: made, and using it produces skill that cannot be reproduced live.
    forecast_time_information_only: bool = True
    #: Reanalysis that assimilated the target observations is excluded.
    exclude_assimilated_reanalysis: bool = True
    #: Later revisions of an observation must not be used as though the
    #: revised value had been known at forecast time.
    use_first_published_observations: bool = True
    #: Neighbouring cells in space and time belong to the same fold.
    block_neighbours: bool = True
    #: Minimum separation between train and validation, in km and hours.
    spatial_buffer_km: float = 50.0
    temporal_buffer_hours: float = 24.0

    def to_dict(self) -> dict:
        return {
            "forecast_time_information_only":
                self.forecast_time_information_only,
            "exclude_assimilated_reanalysis":
                self.exclude_assimilated_reanalysis,
            "use_first_published_observations":
                self.use_first_published_observations,
            "block_neighbours": self.block_neighbours,
            "spatial_buffer_km": self.spatial_buffer_km,
            "temporal_buffer_hours": self.temporal_buffer_hours,
        }


@dataclass(frozen=True, slots=True)
class TrainingSpec:
    """What training one engine would require."""

    engine: str
    #: What the model would predict, precisely.
    target: str
    target_sources: tuple[TargetSource, ...]
    #: How the target is constructed from the observations.
    target_construction: str
    #: Stage 4 diagnostics and shared features that would be candidates.
    candidate_features: tuple[str, ...]
    split: SplitStrategy
    #: Whether the target is conditional on something else occurring.
    conditional_on: str = ""
    #: Targets that look reasonable and are wrong, with why.
    wrong_targets: tuple[str, ...] = ()
    #: What makes this one hard.
    difficulties: tuple[str, ...] = ()
    #: Minimum sample the engine would need to be worth fitting.
    minimum_events: int = 0
    leakage: LeakageRules = dc_field(default_factory=LeakageRules)
    #: How a fitted model would be calibrated -- in the LATER stage.
    calibration_note: str = (
        "calibration is a later stage; a fitted model here would still emit "
        "an UNCALIBRATED probability until verified against observed "
        "frequencies"
    )

    def to_dict(self) -> dict:
        return {
            "engine": self.engine,
            "target": self.target,
            "target_sources": [s.value for s in self.target_sources],
            "target_construction": self.target_construction,
            "conditional_on": self.conditional_on or None,
            "candidate_features": list(self.candidate_features),
            "split": self.split.value,
            "wrong_targets": list(self.wrong_targets),
            "difficulties": list(self.difficulties),
            "minimum_events": self.minimum_events,
            "leakage_rules": self.leakage.to_dict(),
            "calibration_note": self.calibration_note,
        }


_STRICT = SplitStrategy.SPATIOTEMPORAL_BLOCK

SPECS: dict[str, TrainingSpec] = {
    "weather_regime": TrainingSpec(
        engine="weather_regime",
        target="regime membership, as a multi-LABEL problem",
        target_sources=(TargetSource.FORECASTER_LABELS, TargetSource.RADAR),
        target_construction=(
            "forecaster-assigned regime labels for archived cases, allowing "
            "MULTIPLE labels per case. Multi-class would force the "
            "exclusivity the engine exists to avoid"
        ),
        candidate_features=(
            "sbcape", "mucape", "sbcin", "lr_700_500", "lr_0_3km",
            "shear_0_6km", "freezing_level", "precipitable_water",
            "lcl_above_pbl", "local_solar_hour",
        ),
        split=SplitStrategy.REGIME_BLOCK,
        wrong_targets=(
            "observed storm mode -- that is the organisation engine's target, "
            "and conflating them would make regime a storm-mode predictor",
        ),
        difficulties=(
            "labels are subjective and no UK archive of them exists",
            "regimes overlap by design, so accuracy is the wrong metric",
        ),
        minimum_events=500,
    ),
    "convective_initiation": TrainingSpec(
        engine="convective_initiation",
        target="convection initiated within the grid cell and hour",
        target_sources=(TargetSource.RADAR, TargetSource.LIGHTNING_NETWORK,
                        TargetSource.SATELLITE),
        target_construction=(
            "FIRST radar echo above a reflectivity threshold, or first "
            "lightning strike, in a cell with none in the preceding hour. "
            "The 'first' is essential -- otherwise mature storms advecting "
            "into the cell count as initiations"
        ),
        candidate_features=(
            "mucape", "sbcin", "lcl_above_pbl", "boundary_layer_mixing_ratio",
            "convergence", "frontogenesis", "vertical_velocity",
            "elevation", "local_solar_hour", "pbl_depth",
        ),
        split=_STRICT,
        wrong_targets=(
            "lightning at any time during the day -- this learns storm "
            "occurrence, not initiation, and would reward a model that "
            "ignores timing entirely",
            "model precipitation exceeding a threshold -- that trains "
            "against another model, not against the atmosphere",
        ),
        difficulties=(
            "initiation is spatially sparse and temporally sharp; the class "
            "imbalance is severe",
            "the forcing features that matter most are the ones a "
            "single-column evaluation lacks",
        ),
        minimum_events=2000,
    ),
    "lightning": TrainingSpec(
        engine="lightning",
        target="one or more strikes in the cell and hour",
        target_sources=(TargetSource.LIGHTNING_NETWORK,),
        target_construction=(
            "ATDnet or equivalent strikes within the cell and hour. Detection "
            "efficiency varies with range and must be accounted for, or the "
            "model learns the network's geometry"
        ),
        conditional_on="convection occurring",
        candidate_features=(
            "cold_cloud_depth", "storm_depth", "updraft_potential",
            "freezing_level", "mucape",
        ),
        split=_STRICT,
        difficulties=(
            "detection efficiency is not uniform across the domain",
            "flash rate is highly skewed; occurrence and rate need separate "
            "models",
        ),
        minimum_events=5000,
    ),
    "hail": TrainingSpec(
        engine="hail",
        target="hail at the surface; SEPARATELY, hail of 2 cm or more",
        target_sources=(TargetSource.STORM_REPORTS, TargetSource.RADAR),
        target_construction=(
            "TORRO and public reports, supplemented by dual-polarisation "
            "hail signatures. Two separate binary targets, not one graded "
            "one -- 'any hail' and 'significant hail' have different physics "
            "and very different base rates"
        ),
        conditional_on="convection occurring",
        candidate_features=(
            "cold_cloud_depth", "wet_bulb_zero", "freezing_level",
            "lr_700_500", "updraft_potential", "supercell_affinity",
        ),
        split=_STRICT,
        difficulties=(
            "reports are population-biased: hail over the Pennines is under-"
            "reported relative to hail over Birmingham, and a model trained "
            "naively learns population density",
            "the wet-bulb-zero window is inherited from US practice and is "
            "the first thing UK training should re-fit",
        ),
        minimum_events=800,
    ),
    "severe_wind": TrainingSpec(
        engine="severe_wind",
        target="convective gust at or above a damaging threshold",
        target_sources=(TargetSource.SURFACE_OBSERVATIONS,
                        TargetSource.STORM_REPORTS),
        target_construction=(
            "observed gusts attributable to convection, which requires "
            "separating them from synoptic gales -- by far the hardest part "
            "of this target over the UK, where the two coincide in autumn "
            "and winter"
        ),
        conditional_on="convection occurring",
        candidate_features=(
            "dcape", "lr_0_3km", "shear_0_6km", "low_level_rh",
            "linear_affinity",
        ),
        split=_STRICT,
        wrong_targets=(
            "all observed gusts above a threshold -- most UK severe gusts "
            "are synoptic, and a model trained on them predicts winter "
            "storms, not convection",
        ),
        difficulties=(
            "anemometer coverage is sparse relative to the scale of a "
            "downdraught footprint",
        ),
        minimum_events=600,
    ),
    "downburst": TrainingSpec(
        engine="downburst",
        target="a downburst signature: divergent outflow at the surface",
        target_sources=(TargetSource.RADAR, TargetSource.STORM_REPORTS),
        target_construction=(
            "radar-detected low-level divergence signatures, since surface "
            "observations rarely sit inside a downburst footprint"
        ),
        conditional_on="convection occurring",
        candidate_features=(
            "dcape", "low_level_rh", "sub_cloud_depth", "lr_0_3km",
        ),
        split=_STRICT,
        difficulties=(
            "very few confirmed UK cases; this engine may never have enough "
            "data to fit and may remain rule-based indefinitely",
        ),
        minimum_events=200,
    ),
    "tornado_environment": TrainingSpec(
        engine="tornado_environment",
        target="ENVIRONMENTAL favourability, not occurrence",
        target_sources=(TargetSource.STORM_REPORTS,),
        target_construction=(
            "TORRO database events, used to fit the ENVIRONMENT in which "
            "tornadoes occurred against environments in which convection "
            "occurred without them. Fitting occurrence directly would "
            "produce a model dominated by the base rate"
        ),
        conditional_on="convection occurring",
        candidate_features=(
            "shear_0_1km", "srh_0_1km", "lcl", "mlcape",
            "supercell_affinity", "boundary_layer_mixing_ratio",
        ),
        split=_STRICT,
        wrong_targets=(
            "tornado occurrence as a raw binary -- the base rate is so low "
            "that a model predicting 'no' everywhere scores almost "
            "perfectly, and the resulting probabilities are useless",
        ),
        difficulties=(
            "UK tornadoes are frequently non-supercellular, so the archive "
            "contains a mechanism the features do not describe",
            "reporting is strongly population-biased",
        ),
        minimum_events=300,
    ),
    "heavy_rainfall": TrainingSpec(
        engine="heavy_rainfall",
        target="rainfall RATE above a threshold in the cell and hour",
        target_sources=(TargetSource.RAINFALL_ANALYSIS, TargetSource.RADAR),
        target_construction=(
            "radar-gauge merged analysis at sub-hourly resolution. Rate, not "
            "accumulation, because accumulation confounds intensity with "
            "duration and the engine models them separately"
        ),
        conditional_on="convection occurring",
        candidate_features=(
            "precipitable_water", "warm_cloud_depth",
            "boundary_layer_mixing_ratio", "storm_motion_speed",
        ),
        split=_STRICT,
        difficulties=(
            "radar underestimates convective rainfall rate without gauge "
            "adjustment",
            "training and cell repetition are not in the feature set at all",
        ),
        minimum_events=3000,
    ),
}


def spec_for(engine: str) -> TrainingSpec | None:
    return SPECS.get(engine)


def coverage() -> dict:
    """Which engines have a training contract, and which do not.

    The environmental engines (thermodynamic, entrainment, updraft,
    organisation) deliberately have none: they predict environmental
    quantities with no direct observational counterpart. "How
    thermodynamically supportive was the atmosphere" is not observable, so
    there is nothing to fit against. They would be validated indirectly --
    against storm depth, echo tops and radar-classified mode -- rather than
    trained.
    """
    from .base import REGISTRY

    specified = set(SPECS)
    return {
        "engines": len(REGISTRY),
        "with_training_spec": sorted(specified),
        "without_training_spec": sorted(set(REGISTRY) - specified),
        "why_some_have_none": (
            "the environmental engines predict quantities with no direct "
            "observational counterpart. They are validated indirectly, "
            "against storm depth and radar-classified mode, rather than "
            "trained against a target that does not exist"
        ),
        "nothing_is_trained": True,
        "specs": {name: spec.to_dict() for name, spec in SPECS.items()},
    }
