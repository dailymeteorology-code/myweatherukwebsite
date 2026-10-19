"""Building training datasets that cannot see the future.

Steps 11 and 13 of the Stage 9 order, sections 48, 49, 59, 60, 72 to 80 and
88 to 91.

Section 76 is the one rule the spec calls absolute:

    When constructing a historical forecast-training example, only use
    information available at the original forecast creation time.
    Observations are targets, not predictors.

That is enforced structurally here. A `TrainingExample` has two separate
containers -- `features` and `target` -- and every feature carries the time
it became available. `check_leakage` compares each of those against the
forecast's creation time and fails on any feature that could not have been
known. There is no path that puts an observation into `features`, because
`build_dataset` only ever reads observations into `target`.

THE THREE LEAKAGES
------------------
Section 77, 78 and 79 name three distinct ways a split can cheat, and all
three are real on this data:

  TEMPORAL   a later forecast informing an earlier one. Caught by
             comparing available_at against created_at.
  SPATIAL    the same storm appearing in train and test through
             neighbouring cells. Caught by refusing to split within an
             episode -- see `calibrate.episode_split`.
  REGIME     labelling the forecast-time regime using knowledge of how the
             event turned out. Caught by requiring every regime feature to
             carry an availability time like any other feature, so
             "it became a supercell" cannot be a predictor of itself.

WHAT THIS MODULE DOES NOT DO
----------------------------
It does not train anything, and it does not deploy anything. Section 49:

    forecast archive -> training dataset -> model training -> validation
    -> approval -> deployment

This module builds the second box and stops. `governance.py` owns the last
two, and neither promotes without a person.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone

import numpy as np

log = logging.getLogger(__name__)

LEARNING_VERSION = "stage9.1"


@dataclass(frozen=True, slots=True)
class Feature:
    """One predictor, with the time it became knowable.

    `available_at` is not optional and has no default. Section 80 turns on
    exactly this distinction and a defaulted timestamp would let a caller
    forget it silently.
    """

    name: str
    value: float | None
    available_at: datetime
    #: Section 74: a feature's definition can change, and mixing two
    #: generations in one dataset is invisible without this.
    feature_version: str
    unit: str = ""
    source: str = ""


@dataclass(frozen=True, slots=True)
class TrainingExample:
    """One case: what was known, and what happened.

    The two are in separate fields on purpose. There is no container here
    that could hold both, so an observation cannot become a predictor by
    being put in the wrong dictionary.
    """

    forecast_id: str
    #: When the forecast was made. The leakage cutoff.
    created_at: datetime
    valid_time: datetime
    features: tuple[Feature, ...]
    #: The outcome. Known only after the fact, and never a predictor.
    target: float | None
    target_name: str
    target_available_at: datetime
    #: Grouping keys for leakage-safe splitting.
    episode_id: str = ""
    region: str = ""
    regime: str = ""
    lead_hours: int = 0

    def feature_vector(self, order: tuple[str, ...]) -> np.ndarray:
        by_name = {f.name: f for f in self.features}
        return np.array(
            [
                by_name[name].value if name in by_name
                and by_name[name].value is not None else np.nan
                for name in order
            ],
            dtype="float64",
        )


@dataclass(slots=True)
class Dataset:
    """A versioned training dataset. Section 73."""

    dataset_id: str
    examples: list[TrainingExample]
    feature_order: tuple[str, ...]
    target_name: str
    event_definition: str
    observation_version: str
    quality_control_version: str
    filtering_rules: tuple[str, ...] = ()
    generated_at: datetime | None = None
    feature_versions: dict[str, str] = dc_field(default_factory=dict)

    @property
    def n_events(self) -> int:
        return sum(
            1 for e in self.examples
            if e.target is not None and e.target > 0.5
        )

    @property
    def episodes(self) -> set[str]:
        return {e.episode_id for e in self.examples if e.episode_id}

    def matrices(self) -> tuple[np.ndarray, np.ndarray]:
        x = np.vstack([e.feature_vector(self.feature_order)
                       for e in self.examples])
        y = np.array(
            [np.nan if e.target is None else e.target for e in self.examples],
            dtype="float64",
        )
        return x, y

    def fingerprint(self) -> str:
        """A hash over the dataset's definition, not its bulk.

        Two datasets with the same fingerprint were built the same way from
        the same sources, which is what section 73 needs a model to be
        traceable to.
        """
        blob = json.dumps({
            "features": list(self.feature_order),
            "feature_versions": dict(sorted(self.feature_versions.items())),
            "target": self.target_name,
            "event_definition": self.event_definition,
            "observation_version": self.observation_version,
            "quality_control_version": self.quality_control_version,
            "filtering_rules": list(self.filtering_rules),
            "n_examples": len(self.examples),
            "n_events": self.n_events,
        }, sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()[:16]

    def to_version(self):
        """The `governance.DatasetVersion` describing this dataset."""
        from .governance import DatasetVersion

        times = [e.valid_time for e in self.examples]
        return DatasetVersion(
            dataset_id=self.dataset_id,
            generated_at=self.generated_at or datetime.now(timezone.utc),
            source_forecasts="tcm_forecast_archive",
            source_observations="lightning_archive",
            observation_version=self.observation_version,
            feature_versions=dict(self.feature_versions),
            event_definition=self.event_definition,
            filtering_rules=self.filtering_rules,
            quality_control_version=self.quality_control_version,
            n_samples=len(self.examples), n_events=self.n_events,
            n_episodes=len(self.episodes),
            valid_from=min(times) if times else None,
            valid_to=max(times) if times else None,
        )

    def describe(self) -> dict:
        return {
            "dataset_id": self.dataset_id,
            "fingerprint": self.fingerprint(),
            "n_examples": len(self.examples),
            "n_events": self.n_events,
            "n_episodes": len(self.episodes),
            "base_rate": (
                round(self.n_events / len(self.examples), 6)
                if self.examples else None
            ),
            "features": list(self.feature_order),
            "feature_versions": self.feature_versions,
            "target": self.target_name,
            "event_definition": self.event_definition,
            "observation_version": self.observation_version,
            "quality_control_version": self.quality_control_version,
            "filtering_rules": list(self.filtering_rules),
            "generated_at": (
                self.generated_at.isoformat() if self.generated_at else None
            ),
            "version": LEARNING_VERSION,
        }


# --------------------------------------------------------------------------
# Leakage -- sections 76 to 80
# --------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class LeakageFinding:
    kind: str
    detail: str
    example_id: str = ""

    def to_dict(self) -> dict:
        return {
            "kind": self.kind, "detail": self.detail,
            "example": self.example_id or None,
        }


def check_leakage(dataset: Dataset) -> list[LeakageFinding]:
    """Every way a training example could have seen the future.

    Section 76's rule is absolute, so this is deliberately unforgiving: a
    feature whose availability equals the creation time to the second is
    allowed, and one a single second later is not.
    """
    findings: list[LeakageFinding] = []

    for example in dataset.examples:
        for feature in example.features:
            if feature.available_at > example.created_at:
                findings.append(LeakageFinding(
                    kind="temporal_feature_leakage",
                    example_id=example.forecast_id,
                    detail=(
                        f"feature {feature.name!r} became available at "
                        f"{feature.available_at.isoformat()}, after the "
                        f"forecast was created at "
                        f"{example.created_at.isoformat()}. Section 76: "
                        f"only information available at forecast creation "
                        f"time may be a predictor"
                    ),
                ))
        if example.target_available_at <= example.created_at:
            findings.append(LeakageFinding(
                kind="target_available_too_early",
                example_id=example.forecast_id,
                detail=(
                    f"the target was available at "
                    f"{example.target_available_at.isoformat()}, at or "
                    f"before the forecast was created. Either the target is "
                    f"not an outcome of this forecast, or the timestamps "
                    f"are wrong -- both are reasons to refuse the example"
                ),
            ))
        if example.valid_time < example.created_at:
            findings.append(LeakageFinding(
                kind="valid_before_created",
                example_id=example.forecast_id,
                detail=(
                    "the valid time precedes the creation time: this is an "
                    "analysis, not a forecast"
                ),
            ))

    # Section 74: two versions of one feature inside a single dataset.
    versions: dict[str, set[str]] = {}
    for example in dataset.examples:
        for feature in example.features:
            versions.setdefault(feature.name, set()).add(
                feature.feature_version
            )
    for name, seen in versions.items():
        if len(seen) > 1:
            findings.append(LeakageFinding(
                kind="mixed_feature_versions",
                detail=(
                    f"feature {name!r} appears with versions "
                    f"{sorted(seen)} in one dataset. Section 74: do not "
                    f"silently mix two definitions of the same quantity"
                ),
            ))
    return findings


def check_split_leakage(
    train: list[TrainingExample], test: list[TrainingExample]
) -> list[LeakageFinding]:
    """Sections 77, 78 and 79: the ways a SPLIT can cheat."""
    findings: list[LeakageFinding] = []

    train_episodes = {e.episode_id for e in train if e.episode_id}
    test_episodes = {e.episode_id for e in test if e.episode_id}
    shared = train_episodes & test_episodes
    if shared:
        findings.append(LeakageFinding(
            kind="episode_leakage",
            detail=(
                f"{len(shared)} convective episode(s) appear in both "
                f"training and test: {sorted(shared)[:3]}. Section 77: the "
                f"same storm on both sides makes validation optimistic by "
                f"an amount nobody can estimate"
            ),
        ))

    if train and test:
        latest_train = max(e.valid_time for e in train)
        earliest_test = min(e.valid_time for e in test)
        if earliest_test <= latest_train:
            findings.append(LeakageFinding(
                kind="temporal_split_leakage",
                detail=(
                    f"test data at {earliest_test.isoformat()} is not after "
                    f"training data ending {latest_train.isoformat()}. "
                    f"Section 59 requires time-aware partitioning"
                ),
            ))

    train_ids = {e.forecast_id for e in train}
    duplicated = train_ids & {e.forecast_id for e in test}
    if duplicated:
        findings.append(LeakageFinding(
            kind="duplicate_examples",
            detail=(
                f"{len(duplicated)} forecast(s) appear in both partitions"
            ),
        ))
    return findings


def check_regime_leakage(dataset: Dataset) -> list[LeakageFinding]:
    """Section 79. A regime label must not know how the event turned out.

    The check is that any feature naming a regime became available at or
    before the forecast was created -- the same rule as every other
    feature. What makes regime leakage worth its own check is that it is
    the one people write by accident: labelling a case "supercell outbreak"
    from the outcome and then using that label as a predictor is a
    natural-feeling mistake that inflates skill enormously.
    """
    findings: list[LeakageFinding] = []
    for example in dataset.examples:
        for feature in example.features:
            if "regime" not in feature.name.lower():
                continue
            if feature.available_at > example.created_at:
                findings.append(LeakageFinding(
                    kind="regime_leakage",
                    example_id=example.forecast_id,
                    detail=(
                        f"regime feature {feature.name!r} was not available "
                        f"until {feature.available_at.isoformat()}, after "
                        f"the forecast. A regime derived from the outcome "
                        f"predicts the outcome"
                    ),
                ))
    return findings


def audit(
    dataset: Dataset, train: list[TrainingExample] | None = None,
    test: list[TrainingExample] | None = None,
) -> dict:
    """Step 13 and step 16: the full leakage audit."""
    findings = check_leakage(dataset) + check_regime_leakage(dataset)
    if train is not None and test is not None:
        findings += check_split_leakage(train, test)

    by_kind: dict[str, int] = {}
    for finding in findings:
        by_kind[finding.kind] = by_kind.get(finding.kind, 0) + 1

    return {
        "dataset": dataset.describe(),
        "clean": not findings,
        "n_findings": len(findings),
        "by_kind": by_kind,
        "findings": [f.to_dict() for f in findings[:50]],
        "verdict": (
            "no leakage detected. Every feature was available at forecast "
            "creation time, every target after it, and no episode spans the "
            "split"
            if not findings else
            "LEAKAGE DETECTED. Section 76 makes this absolute: a model "
            "trained on this dataset would report skill it does not have, "
            "and the promotion gate in governance.py will refuse it"
        ),
        "version": LEARNING_VERSION,
    }


# --------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------

def build_dataset(
    archived_forecasts: list[dict], observed_hours: list, *,
    dataset_id: str, feature_names: tuple[str, ...],
    feature_versions: dict[str, str],
    event_definition: str, observation_version: str,
    quality_control_version: str,
    target_name: str = "thunderstorm_occurred",
    filtering_rules: tuple[str, ...] = (),
) -> Dataset:
    """Turn archived forecasts and observations into training examples.

    Observations are read ONLY into `target`. There is no branch in this
    function that puts an observed quantity into `features`, which is what
    makes section 76's rule structural rather than a matter of care.

    A forecast whose hour was not observed well enough is dropped, not
    labelled zero -- the same coverage asymmetry `observations.py` applies.
    """
    by_hour = {h.valid_time: h for h in observed_hours}
    examples: list[TrainingExample] = []
    dropped = 0

    for record in archived_forecasts:
        timing = record.get("timing", {})
        try:
            created_at = datetime.fromisoformat(timing["created_at"])
            valid_time = datetime.fromisoformat(timing["valid_time"])
        except (KeyError, ValueError, TypeError):
            dropped += 1
            continue

        hour = by_hour.get(
            valid_time.astimezone(timezone.utc).replace(
                minute=0, second=0, microsecond=0
            )
        )
        if hour is None or hour.event_observed is None:
            dropped += 1
            continue

        pool: dict[str, float | None] = {}
        pool.update(record.get("engine_scores") or {})
        pool.update(record.get("spatial_features") or {})
        pool.update(record.get("regime_probabilities") or {})
        pool["thunderstorm_probability"] = record.get("thunderstorm")
        pool["confidence"] = record.get("confidence")
        pool["uncertainty"] = record.get("uncertainty")

        features = tuple(
            Feature(
                name=name,
                value=(
                    float(pool[name]) if pool.get(name) is not None else None
                ),
                # Every feature came out of the forecast, so it was known
                # when the forecast was made. Any feature sourced elsewhere
                # must carry its own time, and the audit will catch it.
                available_at=created_at,
                feature_version=feature_versions.get(name, "unversioned"),
                source="forecast_archive",
            )
            for name in feature_names if name in pool
        )

        examples.append(TrainingExample(
            forecast_id=record.get("forecast_id", ""),
            created_at=created_at, valid_time=valid_time,
            features=features,
            target=1.0 if hour.event_observed else 0.0,
            target_name=target_name,
            target_available_at=(
                hour.provenance.available_at or valid_time
            ),
            episode_id=valid_time.strftime("%Y%m%d"),
            lead_hours=int(timing.get("forecast_hour", 0)),
        ))

    log.info(
        "training dataset %s: %d examples, %d dropped for unusable "
        "observations", dataset_id, len(examples), dropped,
    )
    return Dataset(
        dataset_id=dataset_id, examples=examples,
        feature_order=feature_names, target_name=target_name,
        event_definition=event_definition,
        observation_version=observation_version,
        quality_control_version=quality_control_version,
        filtering_rules=filtering_rules + (
            f"dropped {dropped} forecast(s) whose hour was not observed "
            f"well enough to label",
        ),
        generated_at=datetime.now(timezone.utc),
        feature_versions=dict(feature_versions),
    )


# --------------------------------------------------------------------------
# Sections 90 and 91 -- is confidence doing anything?
# --------------------------------------------------------------------------

def confidence_is_informative(
    confidences: np.ndarray, errors: np.ndarray
) -> dict:
    """Section 90. Do high-confidence forecasts actually verify better?

    Splits at the median confidence and compares error. If the halves are
    indistinguishable, the confidence system is decoration and should be
    said to be.
    """
    confidence = np.asarray(confidences, dtype="float64")
    error = np.asarray(errors, dtype="float64")
    keep = np.isfinite(confidence) & np.isfinite(error)
    confidence, error = confidence[keep], error[keep]
    if confidence.size < 20 or confidence.std() == 0:
        return {
            "available": False,
            "reason": (
                "too few cases, or confidence never varies, so the question "
                "cannot be answered"
            ),
        }

    median = float(np.median(confidence))
    high = error[confidence >= median]
    low = error[confidence < median]
    if high.size == 0 or low.size == 0:
        return {"available": False, "reason": "the split produced one group"}

    difference = float(low.mean() - high.mean())
    informative = difference > 0
    return {
        "available": True,
        "median_confidence": round(median, 4),
        "high_confidence_error": round(float(high.mean()), 6),
        "low_confidence_error": round(float(low.mean()), 6),
        "difference": round(difference, 6),
        "informative": informative,
        "verdict": (
            "high-confidence forecasts verify better, so confidence carries "
            "information"
            if informative else
            "high-confidence forecasts do NOT verify better. The confidence "
            "field is not functioning as intended and should not be "
            "published as though it were"
        ),
    }


def uncertainty_is_informative(
    uncertainties: np.ndarray, errors: np.ndarray
) -> dict:
    """Section 91. Does predicted uncertainty track actual error?

    Measured by rank correlation, which asks only whether the ORDERING is
    right -- the appropriate question, because uncertainty and error are
    not in the same units and no linear relationship is expected.
    """
    uncertainty = np.asarray(uncertainties, dtype="float64")
    error = np.asarray(errors, dtype="float64")
    keep = np.isfinite(uncertainty) & np.isfinite(error)
    uncertainty, error = uncertainty[keep], error[keep]
    if uncertainty.size < 20 or uncertainty.std() == 0:
        return {
            "available": False,
            "reason": "too few cases, or uncertainty never varies",
        }

    def ranks(values: np.ndarray) -> np.ndarray:
        order = np.argsort(values, kind="mergesort")
        out = np.empty_like(values)
        out[order] = np.arange(values.size, dtype="float64")
        return out

    correlation = float(np.corrcoef(ranks(uncertainty), ranks(error))[0, 1])
    return {
        "available": True,
        "rank_correlation": round(correlation, 4),
        "n": int(uncertainty.size),
        "informative": correlation > 0.1,
        "verdict": (
            "predicted uncertainty ranks the difficult forecasts above the "
            "easy ones"
            if correlation > 0.1 else
            "predicted uncertainty does not distinguish difficult forecasts "
            "from easy ones. Section 91: this relationship must be measured "
            "rather than assumed, and here it does not hold"
        ),
    }
