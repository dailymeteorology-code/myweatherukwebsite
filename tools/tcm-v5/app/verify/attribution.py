"""When TCM is wrong, why was it wrong?

Sections 46, 47, 62, 63, 86, 87, 88 and 94 of the Stage 9 order.

Section 46 asks for the failure to be attributed to a subsystem. That is
harder than it sounds and the honest version has to admit its limits: with
one forecast and one observation you can very often say WHAT went wrong --
displaced, mistimed, missed entirely -- and only sometimes say WHICH
subsystem caused it.

So this module separates the two:

    DIAGNOSIS      what the error looks like. Measurable from the forecast
                   and the observation alone, and reliable.
    ATTRIBUTION    which subsystem is responsible. Requires evidence from
                   the subsystems, and returns UNATTRIBUTED when there
                   is none rather than guessing.

An attribution system that always names a culprit is worse than one that
sometimes shrugs, because a confident wrong attribution sends development
effort at the wrong subsystem.

THE TAXONOMY
------------
Section 47's codes, adapted to what this platform can actually distinguish.
Two of the spec's suggestions have been merged and one added:

  * E06 timing and E05 placement are kept separate, because they have
    different remedies and Stage 8 addresses only one of them.
  * E11 verification uncertainty is here and is used: on a domain with
    partial lightning coverage, "the observation may be wrong" is a real
    and common explanation, and omitting it would push those cases onto
    an innocent subsystem.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

import numpy as np

from .matching import MatchedField

log = logging.getLogger(__name__)

ATTRIBUTION_VERSION = "stage9.1"


class ErrorCode(str, Enum):
    """Section 47's taxonomy."""

    E01_DATA = "E01_data_failure"
    E02_PROFILE = "E02_profile_error"
    E03_THERMODYNAMIC = "E03_thermodynamic_error"
    E04_INITIATION = "E04_initiation_error"
    E05_PLACEMENT = "E05_spatial_placement_error"
    E06_TIMING = "E06_timing_error"
    E07_INTENSITY = "E07_intensity_error"
    E08_HAZARD = "E08_hazard_classification_error"
    E09_WEIGHTING = "E09_model_weighting_error"
    E10_CALIBRATION = "E10_calibration_error"
    E11_VERIFICATION = "E11_verification_uncertainty"
    UNATTRIBUTED = "unattributed"


ERROR_MEANINGS: dict[ErrorCode, str] = {
    ErrorCode.E01_DATA: "a required input was missing or corrupt",
    ErrorCode.E02_PROFILE: "the reconstructed atmospheric column was wrong",
    ErrorCode.E03_THERMODYNAMIC: (
        "instability or inhibition was wrong even though the profile was "
        "sound"
    ),
    ErrorCode.E04_INITIATION: (
        "the environment was right but convection did not start, or started "
        "where none was forecast. The commonest UK failure"
    ),
    ErrorCode.E05_PLACEMENT: (
        "storms occurred, but not where they were forecast. Distinguishable "
        "from a complete miss by neighbourhood scoring"
    ),
    ErrorCode.E06_TIMING: (
        "storms occurred where forecast but in a different hour"
    ),
    ErrorCode.E07_INTENSITY: "occurrence right, magnitude wrong",
    ErrorCode.E08_HAZARD: (
        "the storm was forecast but the hazard mix was wrong"
    ),
    ErrorCode.E09_WEIGHTING: (
        "the multi-model combination was worse than one of its members"
    ),
    ErrorCode.E10_CALIBRATION: (
        "the ordering was right and the probabilities were not"
    ),
    ErrorCode.E11_VERIFICATION: (
        "the observation may not support the judgement being made"
    ),
    ErrorCode.UNATTRIBUTED: (
        "an error occurred and the available evidence does not identify a "
        "subsystem. This is an honest answer, not a gap"
    ),
}


class Outcome(str, Enum):
    HIT = "hit"
    MISS = "miss"
    FALSE_ALARM = "false_alarm"
    CORRECT_NULL = "correct_null"
    UNVERIFIABLE = "unverifiable"


@dataclass(slots=True)
class Diagnosis:
    """What the error looks like, measured from forecast and observation."""

    valid_time: datetime
    outcome: Outcome
    forecast_area_cells: int
    observed_area_cells: int
    overlap_cells: int
    #: Distance between the forecast and observed centroids, metres. None
    #: when either has no area.
    displacement_m: float | None
    #: Overlap as a fraction of the union. 0 for a complete miss.
    jaccard: float | None
    #: Forecast area over observed area. Above 1 is overforecasting.
    area_ratio: float | None
    max_forecast: float
    notes: list[str] = dc_field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "valid_time": self.valid_time.isoformat(),
            "outcome": self.outcome.value,
            "forecast_area_cells": self.forecast_area_cells,
            "observed_area_cells": self.observed_area_cells,
            "overlap_cells": self.overlap_cells,
            "displacement_km": (
                round(self.displacement_m / 1000.0, 1)
                if self.displacement_m is not None else None
            ),
            "jaccard": (
                round(self.jaccard, 4) if self.jaccard is not None else None
            ),
            "area_ratio": (
                round(self.area_ratio, 3) if self.area_ratio is not None
                else None
            ),
            "max_forecast_probability": round(self.max_forecast, 6),
            "notes": self.notes,
        }


def diagnose(
    field: MatchedField, *, threshold: float = 0.1,
    spacing_m: float = 2000.0,
) -> Diagnosis:
    """Describe one hour's error. Sections 63 and 93."""
    forecast = np.where(field.usable, field.forecast, np.nan)
    observed = np.where(field.usable, field.observed, np.nan)

    warned = np.nan_to_num(forecast) >= threshold
    occurred = np.nan_to_num(observed) > 0.5
    overlap = warned & occurred

    notes: list[str] = []
    if field.n_usable == 0:
        return Diagnosis(
            valid_time=field.valid_time, outcome=Outcome.UNVERIFIABLE,
            forecast_area_cells=0, observed_area_cells=0, overlap_cells=0,
            displacement_m=None, jaccard=None, area_ratio=None,
            max_forecast=0.0,
            notes=["no cell had both a forecast and a usable observation"],
        )

    if occurred.any() and warned.any():
        outcome = Outcome.HIT if overlap.any() else Outcome.FALSE_ALARM
        if not overlap.any():
            notes.append(
                "storms occurred and a warning was issued, but they did not "
                "coincide: this is simultaneously a miss and a false alarm, "
                "and is reported as displacement rather than as either"
            )
            outcome = Outcome.MISS
    elif occurred.any():
        outcome = Outcome.MISS
    elif warned.any():
        outcome = Outcome.FALSE_ALARM
    else:
        outcome = Outcome.CORRECT_NULL

    displacement = None
    if warned.any() and occurred.any():
        fy, fx = np.nonzero(warned)
        oy, ox = np.nonzero(occurred)
        displacement = float(np.hypot(
            (fy.mean() - oy.mean()) * spacing_m,
            (fx.mean() - ox.mean()) * spacing_m,
        ))

    union = int((warned | occurred).sum())
    jaccard = int(overlap.sum()) / union if union else None
    area_ratio = (
        int(warned.sum()) / int(occurred.sum()) if occurred.any() else None
    )

    if field.observation_quality.value != "valid":
        notes.append(
            f"observation quality is {field.observation_quality.value}: "
            f"{field.coverage:.0%} coverage. Section 95: this error may be "
            f"partly in the verification rather than the forecast"
        )

    return Diagnosis(
        valid_time=field.valid_time, outcome=outcome,
        forecast_area_cells=int(warned.sum()),
        observed_area_cells=int(occurred.sum()),
        overlap_cells=int(overlap.sum()), displacement_m=displacement,
        jaccard=jaccard, area_ratio=area_ratio,
        max_forecast=float(np.nanmax(np.nan_to_num(forecast))),
        notes=notes,
    )


@dataclass(slots=True)
class Attribution:
    """Which subsystem, and on what evidence."""

    diagnosis: Diagnosis
    codes: list[ErrorCode]
    evidence: list[str]
    confidence: str
    unattributed_reason: str = ""

    def to_dict(self) -> dict:
        return {
            "diagnosis": self.diagnosis.to_dict(),
            "codes": [
                {"code": c.value, "meaning": ERROR_MEANINGS[c]}
                for c in self.codes
            ],
            "evidence": self.evidence,
            "confidence": self.confidence,
            "unattributed_reason": self.unattributed_reason or None,
        }


def attribute(
    diagnosis: Diagnosis, *,
    neighbouring_hours: list[Diagnosis] | None = None,
    engine_scores: dict[str, float | None] | None = None,
    displacement_tolerance_m: float = 50_000.0,
) -> Attribution:
    """Name the subsystem responsible, or admit it cannot be named.

    Evidence is required for every code assigned. Where none exists the
    result is UNATTRIBUTED with the reason, which is the honest answer for
    most single cases and is far more useful than a confident guess.
    """
    codes: list[ErrorCode] = []
    evidence: list[str] = []

    if diagnosis.outcome is Outcome.UNVERIFIABLE:
        return Attribution(
            diagnosis=diagnosis, codes=[ErrorCode.E11_VERIFICATION],
            evidence=["no usable observation for this hour"],
            confidence="certain",
        )

    if diagnosis.outcome is Outcome.CORRECT_NULL:
        return Attribution(
            diagnosis=diagnosis, codes=[], evidence=["nothing went wrong"],
            confidence="certain",
        )

    for note in diagnosis.notes:
        if "observation quality" in note:
            codes.append(ErrorCode.E11_VERIFICATION)
            evidence.append(note)

    # TIMING: the storm appears in an adjacent hour instead. This is
    # measurable, and section 94 is explicit that a correct storm in the
    # wrong hour is a meaningful and distinct error.
    if neighbouring_hours:
        for other in neighbouring_hours:
            gap = abs(
                (other.valid_time - diagnosis.valid_time).total_seconds()
            ) / 3600.0
            if gap == 0 or gap > 2:
                continue
            if (
                diagnosis.outcome is Outcome.MISS
                and other.outcome is Outcome.FALSE_ALARM
            ) or (
                diagnosis.outcome is Outcome.FALSE_ALARM
                and other.outcome is Outcome.MISS
            ):
                codes.append(ErrorCode.E06_TIMING)
                evidence.append(
                    f"the opposite error occurs at "
                    f"{other.valid_time:%H}Z, {gap:.0f} h away: the storms "
                    f"were forecast, in the wrong hour"
                )
                break

    # PLACEMENT: both occurred, they overlap poorly, and the displacement
    # is within the range a mesoscale positioning error can explain.
    if (
        diagnosis.forecast_area_cells > 0
        and diagnosis.observed_area_cells > 0
        and diagnosis.displacement_m is not None
        and diagnosis.jaccard is not None and diagnosis.jaccard < 0.3
        and diagnosis.displacement_m <= displacement_tolerance_m
    ):
        codes.append(ErrorCode.E05_PLACEMENT)
        evidence.append(
            f"forecast and observed areas overlap by "
            f"{diagnosis.jaccard:.0%} with centroids "
            f"{diagnosis.displacement_m / 1000:.0f} km apart: the "
            f"convection was anticipated but positioned wrongly"
        )

    # INITIATION: storms occurred and nothing was forecast anywhere.
    if (
        diagnosis.outcome is Outcome.MISS
        and diagnosis.forecast_area_cells == 0
    ):
        if engine_scores and engine_scores.get("thermodynamic", 0) and (
            engine_scores.get("thermodynamic") or 0
        ) > 0.5:
            codes.append(ErrorCode.E04_INITIATION)
            evidence.append(
                f"the thermodynamic engine scored "
                f"{engine_scores['thermodynamic']:.2f}, so the environment "
                f"was recognised as supportive and the forecast still "
                f"placed no convection: the failure is in initiation, not "
                f"in the instability"
            )
        else:
            codes.append(ErrorCode.UNATTRIBUTED)
            evidence.append(
                "storms occurred with nothing forecast anywhere, and no "
                "engine output is available to say whether the environment "
                "was recognised"
            )

    # OVERFORECASTING an area that did contain storms is intensity or
    # placement, not a miss.
    if (
        diagnosis.area_ratio is not None and diagnosis.area_ratio > 3.0
        and diagnosis.overlap_cells > 0
    ):
        codes.append(ErrorCode.E07_INTENSITY)
        evidence.append(
            f"the warned area is {diagnosis.area_ratio:.1f} times the "
            f"observed area, with genuine overlap: the event was caught and "
            f"its extent overstated"
        )

    if not codes:
        return Attribution(
            diagnosis=diagnosis, codes=[ErrorCode.UNATTRIBUTED],
            evidence=[],
            confidence="none",
            unattributed_reason=(
                "the forecast was wrong and nothing in the available "
                "evidence identifies which subsystem caused it. Naming one "
                "anyway would send development effort at a guess"
            ),
        )

    unique: list[ErrorCode] = []
    for code in codes:
        if code not in unique:
            unique.append(code)

    # An UNATTRIBUTED result carries text explaining why nothing could be
    # named, and that text is not evidence FOR an attribution. Reporting it
    # as "supported by evidence" would make a shrug look like a finding.
    named = [c for c in unique if c is not ErrorCode.UNATTRIBUTED]
    return Attribution(
        diagnosis=diagnosis, codes=unique, evidence=evidence,
        confidence="supported by evidence" if (named and evidence) else "none",
        unattributed_reason=(
            "" if named else
            "the error is real and the available evidence does not identify "
            "a subsystem"
        ),
    )


def report(
    fields: list[MatchedField], *, threshold: float = 0.1,
    engine_scores: dict[str, float | None] | None = None,
) -> dict:
    """Diagnose and attribute a whole verification period. Section 86."""
    diagnoses = [diagnose(f, threshold=threshold) for f in fields]
    attributions = [
        attribute(d, neighbouring_hours=diagnoses, engine_scores=engine_scores)
        for d in diagnoses
    ]

    counts: dict[str, int] = {}
    for attribution in attributions:
        for code in attribution.codes:
            counts[code.value] = counts.get(code.value, 0) + 1
    outcomes: dict[str, int] = {}
    for d in diagnoses:
        outcomes[d.outcome.value] = outcomes.get(d.outcome.value, 0) + 1

    worst = sorted(
        [d for d in diagnoses if d.outcome in (Outcome.MISS,
                                               Outcome.FALSE_ALARM)],
        key=lambda d: d.observed_area_cells + d.forecast_area_cells,
        reverse=True,
    )[:5]

    return {
        "hours": len(fields),
        "outcomes": outcomes,
        "error_codes": counts,
        "largest_errors": [d.to_dict() for d in worst],
        "attributions": [a.to_dict() for a in attributions],
        "priority": _priority(counts),
        "version": ATTRIBUTION_VERSION,
        "note": (
            "attribution requires evidence. UNATTRIBUTED means the error is "
            "real and its cause is not identifiable from what was recorded, "
            "which is a common and honest outcome for a single case"
        ),
    }


def _priority(counts: dict[str, int]) -> str:
    """Section 87: point development at the actual weakness."""
    if not counts:
        return "no errors to prioritise"
    ranked = sorted(counts.items(), key=lambda pair: pair[1], reverse=True)
    top, n = ranked[0]
    if top == ErrorCode.UNATTRIBUTED.value:
        return (
            f"{n} error(s) could not be attributed. The first improvement "
            f"is to the RECORD, not the forecast: archive the engine "
            f"outputs and spatial features with each forecast so the next "
            f"failure can be traced"
        )
    if top == ErrorCode.E11_VERIFICATION.value:
        return (
            f"{n} case(s) are limited by observation quality rather than by "
            f"the forecast. The first improvement is to the observing "
            f"coverage, and any skill conclusion drawn now is premature"
        )
    return (
        f"{ERROR_MEANINGS[ErrorCode(top)]} accounts for {n} case(s) and is "
        f"where effort would pay best on this sample"
    )
