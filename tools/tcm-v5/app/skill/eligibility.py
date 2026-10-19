"""Whether a model may contribute at all, and why not when it may not.

Eligibility is a GATE, evaluated before any skill is considered. A model with
an excellent historical record but a six-hour-stale run contributes nothing,
and no amount of skill should rescue it.

Every ineligibility carries a reason (section 47). "Weight 0.0" with no
explanation is indistinguishable from a bug, and on an operational system
somebody will eventually assume it is one.

WHAT THIS DOES NOT DO
---------------------
It does not reimplement quality control. Stage 2 and Stage 3 already decide
whether a field decoded, whether levels are missing and how much
interpolation a profile depends on; section 64 says consume that metadata,
so this reads it.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta
from enum import Enum

from .identity import ModelIdentity


class Ineligible(str, Enum):
    """Why a model cannot contribute. Ordered roughly by how hard it is."""

    UNAVAILABLE = "unavailable"
    STALE = "stale"
    MISSING_VARIABLE = "missing_variable"
    OUTSIDE_DOMAIN = "outside_domain"
    BEYOND_HORIZON = "beyond_horizon"
    INSUFFICIENT_VERTICAL = "insufficient_vertical"
    FAILED_QUALITY_CONTROL = "failed_quality_control"
    TOO_COARSE = "too_coarse"


@dataclass(frozen=True, slots=True)
class Eligibility:
    """Whether one model may contribute to one task, and why."""

    model: ModelIdentity
    eligible: bool
    reasons: tuple[tuple[Ineligible, str], ...] = ()
    #: How suitable the model is where it IS eligible, in [0, 1]. NOT skill:
    #: this is about fitness for the task, and a perfectly suitable model can
    #: still be a poor forecaster.
    suitability: float = 1.0
    notes: tuple[str, ...] = ()

    @property
    def blocking(self) -> str:
        return "; ".join(f"{code.value}: {why}" for code, why in self.reasons)

    def to_dict(self) -> dict:
        return {
            "model": self.model.key,
            "eligible": self.eligible,
            "suitability": round(self.suitability, 4),
            "reasons": [
                {"code": code.value, "detail": why}
                for code, why in self.reasons
            ],
            "notes": list(self.notes),
        }


@dataclass(slots=True)
class TaskRequirements:
    """What a forecasting task needs from a model.

    Built from the Stage 5 engine's declared inputs, so requirements are not
    restated here and cannot drift from what the engines actually consume.
    """

    variables: tuple[str, ...] = ()
    #: Minimum vertical levels for the task to be meaningful.
    min_levels: int = 0
    #: Coarser than this and the model cannot represent the phenomenon.
    #: None means resolution does not gate the task.
    max_resolution_m: float | None = None
    #: How old a run may be before it stops being operationally useful.
    max_age: timedelta = timedelta(hours=12)
    #: Minimum Stage 2/3 quality score.
    min_data_quality: float = 0.5

    def to_dict(self) -> dict:
        return {
            "variables": list(self.variables),
            "min_levels": self.min_levels,
            "max_resolution_m": self.max_resolution_m,
            "max_age_hours": self.max_age.total_seconds() / 3600.0,
            "min_data_quality": self.min_data_quality,
        }


def requirements_for_engine(engine_name: str) -> TaskRequirements:
    """What a Stage 5 engine needs, read from the engine itself.

    Deliberately derived rather than tabulated: a table restating each
    engine's inputs would silently go stale the moment an engine changed
    what it consumes.
    """
    from ..engines.base import REGISTRY

    engine = REGISTRY.get(engine_name)
    if engine is None:
        return TaskRequirements()

    variables = tuple(engine.consumes_diagnostics)
    # An engine reading pressure-level diagnostics needs a profile; one
    # reading only surface quantities does not.
    needs_profile = any(
        name in variables
        for name in ("mucape", "sbcape", "mlcape", "lfc", "el", "lr_700_500",
                     "srh_0_3km", "shear_0_6km", "entrainment_indicators")
    )
    return TaskRequirements(
        variables=variables,
        min_levels=6 if needs_profile else 0,
    )


def assess(
    model: ModelIdentity,
    requirements: TaskRequirements,
    *,
    available_variables: set[str],
    run_time: datetime | None,
    now: datetime,
    forecast_hour: float,
    max_forecast_hour: float | None = None,
    levels: int | None = None,
    data_quality: float | None = None,
    in_domain: bool = True,
    failed_qc: tuple[str, ...] = (),
) -> Eligibility:
    """Decide whether `model` may contribute, and how suitable it is."""
    reasons: list[tuple[Ineligible, str]] = []
    notes: list[str] = []

    if run_time is None:
        reasons.append((
            Ineligible.UNAVAILABLE,
            "no run is stored for this model",
        ))
    else:
        age = now - run_time
        if age > requirements.max_age:
            reasons.append((
                Ineligible.STALE,
                f"the newest run is {age.total_seconds()/3600:.1f} h old, "
                f"beyond the {requirements.max_age.total_seconds()/3600:.0f} h "
                f"this task accepts. Historical skill cannot rescue a stale "
                f"forecast",
            ))

    if not in_domain:
        reasons.append((
            Ineligible.OUTSIDE_DOMAIN,
            "the requested point is outside this model's domain",
        ))

    if max_forecast_hour is not None and forecast_hour > max_forecast_hour:
        reasons.append((
            Ineligible.BEYOND_HORIZON,
            f"T+{forecast_hour:.0f} is beyond this model's "
            f"T+{max_forecast_hour:.0f} horizon",
        ))

    missing = [v for v in requirements.variables if v not in available_variables]
    if missing:
        # Missing SOME variables degrades suitability; missing all of them
        # blocks. A model contributing four of six useful diagnostics is
        # worth having, at reduced weight.
        if len(missing) == len(requirements.variables):
            reasons.append((
                Ineligible.MISSING_VARIABLE,
                f"none of the {len(missing)} variables this task needs are "
                f"available",
            ))
        else:
            notes.append(
                f"{len(missing)} of {len(requirements.variables)} task "
                f"variables unavailable: {', '.join(sorted(missing)[:4])}"
            )

    if requirements.min_levels and levels is not None \
            and levels < requirements.min_levels:
        reasons.append((
            Ineligible.INSUFFICIENT_VERTICAL,
            f"{levels} vertical levels against the {requirements.min_levels} "
            f"this task needs; a diagnostic that depends on vertical "
            f"structure cannot be trusted from a profile that lacks it",
        ))

    if failed_qc:
        reasons.append((
            Ineligible.FAILED_QUALITY_CONTROL,
            f"failed Stage 2/3 quality control: {', '.join(failed_qc[:3])}",
        ))

    if requirements.max_resolution_m is not None \
            and model.resolution_m is not None \
            and model.resolution_m > requirements.max_resolution_m:
        reasons.append((
            Ineligible.TOO_COARSE,
            f"{model.resolution_m/1000:.0f} km resolution cannot represent "
            f"a phenomenon this task resolves at "
            f"{requirements.max_resolution_m/1000:.0f} km",
        ))

    # -- suitability, for models that pass the gates ----------------------
    suitability = 1.0
    if requirements.variables:
        present = len(requirements.variables) - len(missing)
        suitability *= present / len(requirements.variables)
    if data_quality is not None:
        if data_quality < requirements.min_data_quality:
            reasons.append((
                Ineligible.FAILED_QUALITY_CONTROL,
                f"data quality {data_quality:.2f} below the "
                f"{requirements.min_data_quality:.2f} this task requires",
            ))
        else:
            suitability *= data_quality
    if run_time is not None and not reasons:
        age_hours = (now - run_time).total_seconds() / 3600.0
        max_hours = requirements.max_age.total_seconds() / 3600.0
        if age_hours > max_hours * 0.5:
            notes.append(
                f"run is {age_hours:.1f} h old, past half its useful life"
            )

    return Eligibility(
        model=model, eligible=not reasons, reasons=tuple(reasons),
        suitability=round(max(0.0, min(1.0, suitability)), 4),
        notes=tuple(notes),
    )


def summarise(results: list[Eligibility]) -> dict:
    """What happened to the whole field of models.

    Section 48: when a model drops out, the system must record which one and
    why -- not silently renormalise and carry on as though the remaining
    models covered the same ground.
    """
    eligible = [e for e in results if e.eligible]
    excluded = [e for e in results if not e.eligible]
    by_reason: dict[str, list[str]] = {}
    for entry in excluded:
        for code, _ in entry.reasons:
            by_reason.setdefault(code.value, []).append(entry.model.key)

    return {
        "considered": len(results),
        "eligible": [e.model.key for e in eligible],
        "excluded": {
            e.model.key: e.blocking for e in excluded
        },
        "excluded_by_reason": by_reason,
        "note": (
            "an excluded model is not merely renormalised away: it may have "
            "carried information no remaining model provides, and the "
            "aggregation stage is told which and why"
        ),
    }
