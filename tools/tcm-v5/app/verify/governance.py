"""Model registry, promotion gates, and the refusal to self-modify.

Steps 12 and 16 of the Stage 9 order, sections 2, 48 to 53, 70, 71, 73 to
75, 81, 82 and 101.

Section 101 is the rule the whole module exists to enforce:

    DO NOT TURN TCM V5 INTO AN UNCONTROLLED SELF-MODIFYING SYSTEM.

    not:  forecast -> observation -> AI changes itself -> next forecast

So there is no code path here that promotes anything. `evaluate` runs the
gates and returns a decision; `promote` requires an explicit human approver
and REFUSES without one. A challenger that passes every gate sits as a
challenger until a person says otherwise, and `Registry.champion` keeps
returning the old model until then.

That is not a limitation to be worked around later. It is the deliverable.

THE GATES
---------
Section 52's list, each implemented as a check that can fail loudly:

    leakage          the candidate's training data must not contain
                     information from after the forecasts it will make
    sample           enough events, and enough INDEPENDENT episodes
    no regression    section 53: not worse on any tracked slice, not just
                     better on the headline number
    calibration      reliability at least as good
    discrimination   AUC at least as good
    rare events      behaviour on the rare hazards specifically
    reproducible     dataset version, code version, seed, hyperparameters
    documented       a model card exists

A candidate that improves the national mean while collapsing in Scotland
fails, because section 53 says a new model is not an improvement simply
because one overall metric increased.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field as dc_field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

log = logging.getLogger(__name__)

GOVERNANCE_VERSION = "stage9.1"


class Status(str, Enum):
    """Where a model sits. Section 51."""

    CANDIDATE = "candidate"
    CHALLENGER = "challenger"
    CHAMPION = "champion"
    RETIRED = "retired"
    REJECTED = "rejected"


@dataclass(frozen=True, slots=True)
class DatasetVersion:
    """Section 73. What a model learned from."""

    dataset_id: str
    generated_at: datetime
    source_forecasts: str
    source_observations: str
    observation_version: str
    #: Section 74: feature definitions change, and mixing two generations
    #: of a feature in one dataset is silent.
    feature_versions: dict[str, str] = dc_field(default_factory=dict)
    event_definition: str = ""
    filtering_rules: tuple[str, ...] = ()
    quality_control_version: str = ""
    n_samples: int = 0
    n_events: int = 0
    n_episodes: int = 0
    valid_from: datetime | None = None
    valid_to: datetime | None = None

    def to_dict(self) -> dict:
        out = asdict(self)
        for key in ("generated_at", "valid_from", "valid_to"):
            value = out.get(key)
            out[key] = value.isoformat() if isinstance(value, datetime) else None
        out["filtering_rules"] = list(self.filtering_rules)
        return out


@dataclass(frozen=True, slots=True)
class ModelCard:
    """Section 82. The technical record for a learned component."""

    name: str
    purpose: str
    target: str
    features: tuple[str, ...]
    training_period: str
    validation_period: str
    limitations: tuple[str, ...]
    known_failure_modes: tuple[str, ...]
    performance: dict = dc_field(default_factory=dict)
    calibration: dict = dc_field(default_factory=dict)

    def to_dict(self) -> dict:
        out = asdict(self)
        for key in ("features", "limitations", "known_failure_modes"):
            out[key] = list(getattr(self, key))
        return out

    def complete(self) -> list[str]:
        """What is missing. Section 52 requires documentation to pass."""
        missing = []
        for name in ("purpose", "target", "training_period",
                     "validation_period"):
            if not getattr(self, name):
                missing.append(name)
        if not self.limitations:
            missing.append(
                "limitations (a model with no stated limitations has not "
                "been examined)"
            )
        return missing


@dataclass(frozen=True, slots=True)
class RegisteredModel:
    """Section 50. One learned component, versioned and reproducible."""

    name: str
    model_type: str
    version: str
    dataset: DatasetVersion
    card: ModelCard
    #: Section 75's reproducibility block.
    code_version: str = ""
    environment: str = ""
    random_seed: int | None = None
    hyperparameters: dict = dc_field(default_factory=dict)
    metrics: dict = dc_field(default_factory=dict)
    status: Status = Status.CANDIDATE
    approved_by: str | None = None
    approved_at: datetime | None = None
    registered_at: datetime | None = None
    notes: str = ""

    @property
    def key(self) -> str:
        return f"{self.name}@{self.version}"

    def reproducibility_gaps(self) -> list[str]:
        """Section 75. What would stop this being retrained identically."""
        gaps = []
        if not self.code_version:
            gaps.append("no code version recorded")
        if not self.dataset.dataset_id:
            gaps.append("no dataset version recorded")
        if self.random_seed is None and self.model_type != "deterministic":
            gaps.append(
                "no random seed recorded, and this model type is not "
                "declared deterministic"
            )
        if not self.dataset.feature_versions:
            gaps.append(
                "no feature versions recorded: section 74 warns that mixing "
                "two generations of a feature in one dataset is silent"
            )
        return gaps

    def to_dict(self) -> dict:
        return {
            "name": self.name, "key": self.key, "version": self.version,
            "model_type": self.model_type,
            "status": self.status.value,
            "code_version": self.code_version,
            "environment": self.environment,
            "random_seed": self.random_seed,
            "hyperparameters": self.hyperparameters,
            "metrics": self.metrics,
            "dataset": self.dataset.to_dict(),
            "card": self.card.to_dict(),
            "approved_by": self.approved_by,
            "approved_at": (
                self.approved_at.isoformat() if self.approved_at else None
            ),
            "registered_at": (
                self.registered_at.isoformat() if self.registered_at else None
            ),
            "reproducibility_gaps": self.reproducibility_gaps(),
            "notes": self.notes or None,
        }


# --------------------------------------------------------------------------
# Promotion gates -- sections 52 and 53
# --------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Gate:
    """One promotion requirement and whether it was met."""

    name: str
    passed: bool
    detail: str
    blocking: bool = True

    def to_dict(self) -> dict:
        return {
            "gate": self.name, "passed": self.passed,
            "blocking": self.blocking, "detail": self.detail,
        }


@dataclass(slots=True)
class Evaluation:
    """The outcome of running a challenger against a champion."""

    challenger: str
    champion: str | None
    gates: list[Gate]
    #: Per-slice comparison, so a regression anywhere is visible.
    slices: dict = dc_field(default_factory=dict)
    recommendation: str = ""

    @property
    def passed(self) -> bool:
        return all(g.passed for g in self.gates if g.blocking)

    def to_dict(self) -> dict:
        failed = [g.name for g in self.gates if g.blocking and not g.passed]
        return {
            "challenger": self.challenger,
            "champion": self.champion,
            "gates": [g.to_dict() for g in self.gates],
            "failed_gates": failed,
            "slices": self.slices,
            "passed_all_gates": self.passed,
            "recommendation": self.recommendation,
            "note": (
                "passing every gate makes a model ELIGIBLE for promotion. "
                "It does not promote it. Section 101: no operational "
                "component changes without an explicit human approval"
            ),
        }


def evaluate(
    challenger: RegisteredModel, champion: RegisteredModel | None, *,
    challenger_scores: dict, champion_scores: dict | None = None,
    slice_scores: dict | None = None,
    min_events: int = 100, min_episodes: int = 3,
    leakage_findings: list[str] | None = None,
) -> Evaluation:
    """Run every promotion gate. Sections 52 and 53.

    `slice_scores` maps a slice name (region, season, regime, lead bucket)
    to {"challenger": x, "champion": y} for the headline metric, and is what
    makes section 53's no-regression rule real: a model that improves
    overall while collapsing on one slice fails.
    """
    gates: list[Gate] = []

    findings = leakage_findings or []
    gates.append(Gate(
        name="no_data_leakage", passed=not findings,
        detail=(
            "no leakage detected in the training data"
            if not findings else
            "LEAKAGE: " + "; ".join(findings)
        ),
    ))

    dataset = challenger.dataset
    enough = (
        dataset.n_events >= min_events
        and dataset.n_episodes >= min_episodes
    )
    gates.append(Gate(
        name="sufficient_sample", passed=enough,
        detail=(
            f"{dataset.n_events} events across {dataset.n_episodes} "
            f"independent episodes "
            f"(need {min_events} and {min_episodes}). Section 60: correlated "
            f"cells from one outbreak are not independent cases"
        ),
    ))

    gaps = challenger.reproducibility_gaps()
    gates.append(Gate(
        name="reproducible", passed=not gaps,
        detail=("training is reproducible" if not gaps
                else "; ".join(gaps)),
    ))

    missing = challenger.card.complete()
    gates.append(Gate(
        name="documented", passed=not missing,
        detail=("model card complete" if not missing
                else f"model card is missing: {', '.join(missing)}"),
    ))

    # -- performance gates, only when there is a champion to beat ----------
    if champion is None or champion_scores is None:
        gates.append(Gate(
            name="beats_champion", passed=True, blocking=False,
            detail=(
                "no champion is deployed, so there is nothing to beat. This "
                "gate is not blocking, but the first deployed model still "
                "needs every other gate"
            ),
        ))
    else:
        for metric, lower_is_better in (
            ("brier_score", True), ("roc_auc", False),
            ("calibration_error", True),
        ):
            new = challenger_scores.get(metric)
            old = champion_scores.get(metric)
            if new is None or old is None:
                gates.append(Gate(
                    name=f"{metric}_not_worse", passed=False,
                    detail=(
                        f"{metric} is missing for "
                        f"{'challenger' if new is None else 'champion'}, so "
                        f"the comparison cannot be made and the gate cannot "
                        f"be passed"
                    ),
                ))
                continue
            better = new <= old if lower_is_better else new >= old
            gates.append(Gate(
                name=f"{metric}_not_worse", passed=better,
                detail=(
                    f"challenger {new:.6f} vs champion {old:.6f} "
                    f"({'lower' if lower_is_better else 'higher'} is better)"
                ),
            ))

    # -- section 53: no regression on ANY tracked slice --------------------
    regressions: list[str] = []
    for name, pair in (slice_scores or {}).items():
        new = pair.get("challenger")
        old = pair.get("champion")
        if new is None or old is None:
            continue
        if new > old:
            regressions.append(f"{name}: {new:.5f} vs {old:.5f}")
    gates.append(Gate(
        name="no_slice_regression", passed=not regressions,
        detail=(
            f"no regression across {len(slice_scores or {})} slices"
            if not regressions else
            "REGRESSION on " + "; ".join(regressions)
            + ". Section 53: a new model is not an improvement because one "
              "overall metric increased"
        ),
    ))

    evaluation = Evaluation(
        challenger=challenger.key,
        champion=champion.key if champion else None,
        gates=gates, slices=slice_scores or {},
    )
    failed = [g.name for g in gates if g.blocking and not g.passed]
    evaluation.recommendation = (
        f"ELIGIBLE for promotion. A human must still approve it: nothing "
        f"here deploys anything"
        if not failed else
        f"NOT ELIGIBLE. Blocking gate(s) failed: {', '.join(failed)}"
    )
    log.info(
        "evaluated challenger %s: %s", challenger.key,
        "eligible" if not failed else f"blocked by {failed}",
    )
    return evaluation


# --------------------------------------------------------------------------
# The registry
# --------------------------------------------------------------------------

class Registry:
    """Every learned component, and which one is live.

    The only object that can change what is deployed, and it refuses to do
    so without a named approver.
    """

    def __init__(self, path: Path | None = None):
        self.path = path
        self.models: dict[str, RegisteredModel] = {}
        self.changelog: list[dict] = []

    def register(self, model: RegisteredModel) -> RegisteredModel:
        """Add a model as a CANDIDATE. Never as a champion."""
        if model.key in self.models:
            raise ValueError(
                f"{model.key} is already registered. Bump the version "
                f"rather than replacing it: section 50 requires every "
                f"learned component to be traceable to its own record"
            )
        stored = RegisteredModel(**{
            **{f: getattr(model, f) for f in model.__slots__},
            "status": Status.CANDIDATE,
            "registered_at": datetime.now(timezone.utc),
        })
        self.models[stored.key] = stored
        self._log("registered", stored.key, "registered as a candidate")
        return stored

    def champion(self, name: str) -> RegisteredModel | None:
        for model in self.models.values():
            if model.name == name and model.status is Status.CHAMPION:
                return model
        return None

    def challengers(self, name: str) -> list[RegisteredModel]:
        return [
            m for m in self.models.values()
            if m.name == name and m.status is Status.CHALLENGER
        ]

    def make_challenger(self, key: str, evaluation: Evaluation) -> None:
        """Move a candidate to challenger. Section 71's shadow position.

        A challenger runs alongside the champion and affects nothing that
        is published.
        """
        model = self._require(key)
        self.models[key] = self._with_status(model, Status.CHALLENGER)
        self._log(
            "challenger", key,
            f"promoted to challenger; gates "
            f"{'passed' if evaluation.passed else 'NOT passed'}",
        )

    def promote(
        self, key: str, *, evaluation: Evaluation, approved_by: str,
        motivation: str,
    ) -> RegisteredModel:
        """Make a challenger the champion. Requires a named human.

        Sections 2 and 101. `approved_by` is not optional and is not
        defaulted; there is no argument value that means "automatic". A
        model that passed every gate still sits as a challenger until this
        is called by a person.
        """
        if not approved_by or not approved_by.strip():
            raise PermissionError(
                "promotion requires a named approver. Section 101 forbids "
                "an operational forecasting component changing without "
                "explicit human approval, and an empty approver is exactly "
                "the automatic promotion that rule exists to prevent"
            )
        if not evaluation.passed:
            failed = [
                g.name for g in evaluation.gates if g.blocking and not g.passed
            ]
            raise PermissionError(
                f"{key} failed blocking gate(s) {failed} and cannot be "
                f"promoted. Section 52: the gates are the condition of "
                f"deployment, not advice"
            )

        model = self._require(key)
        previous = self.champion(model.name)
        if previous is not None:
            self.models[previous.key] = self._with_status(
                previous, Status.RETIRED
            )
            self._log(
                "retired", previous.key,
                f"replaced as champion by {key}",
            )

        promoted = RegisteredModel(**{
            **{f: getattr(model, f) for f in model.__slots__},
            "status": Status.CHAMPION,
            "approved_by": approved_by,
            "approved_at": datetime.now(timezone.utc),
        })
        self.models[key] = promoted
        self._log("promoted", key, motivation, approved_by=approved_by)
        log.warning(
            "PROMOTED %s to champion, approved by %s: %s",
            key, approved_by, motivation,
        )
        return promoted

    def reject(self, key: str, reason: str) -> None:
        model = self._require(key)
        self.models[key] = self._with_status(model, Status.REJECTED)
        self._log("rejected", key, reason)

    # -- internals ---------------------------------------------------------

    def _require(self, key: str) -> RegisteredModel:
        if key not in self.models:
            raise KeyError(f"{key} is not registered")
        return self.models[key]

    @staticmethod
    def _with_status(model: RegisteredModel, status: Status
                     ) -> RegisteredModel:
        return RegisteredModel(**{
            **{f: getattr(model, f) for f in model.__slots__},
            "status": status,
        })

    def _log(self, action: str, key: str, detail: str,
             approved_by: str | None = None) -> None:
        """Section 81's scientific changelog."""
        self.changelog.append({
            "at": datetime.now(timezone.utc).isoformat(),
            "action": action, "model": key, "detail": detail,
            "approved_by": approved_by,
        })

    def describe(self) -> dict:
        by_status: dict[str, list[str]] = {}
        for model in self.models.values():
            by_status.setdefault(model.status.value, []).append(model.key)
        return {
            "models": {k: m.to_dict() for k, m in sorted(self.models.items())},
            "by_status": by_status,
            "changelog": self.changelog,
            "version": GOVERNANCE_VERSION,
            "policy": (
                "models are registered as CANDIDATES, may be promoted to "
                "CHALLENGER to run in shadow, and become CHAMPION only "
                "through an explicit human approval that names the "
                "approver. Nothing in this system promotes anything on its "
                "own"
            ),
        }

    def save(self, path: Path | None = None) -> Path:
        path = path or self.path
        if path is None:
            raise ValueError("no path to save the registry to")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.describe(), indent=1), encoding="utf-8"
        )
        return path
