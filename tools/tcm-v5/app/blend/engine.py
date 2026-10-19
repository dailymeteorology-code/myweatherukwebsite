"""The blend engine: turn several models into one field, and explain it.

`blend()` is the only way a multi-model field is produced. It returns a
`BlendResult` carrying the blended values, the per-model contributions, the
confidence, and a machine-readable explanation -- never a bare array, because
a blended number without its blend is not interpretable.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from enum import Enum

import numpy as np

from ..derived.ensemble import EnsembleSummary, Reliability, agreement_score
from ..grid import Field, tcm_grid
from ..meta import FieldMeta, MemberKind
from ..params import ParamGroup, get as get_param
from ..registry import ModelSpec, get as get_model
from .weights import (
    ModelContribution,
    agreement_weights,
    consensus_agreement,
    lead_decay,
    normalise,
    suitability,
)

log = logging.getLogger(__name__)


class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

    @classmethod
    def from_score(cls, score: float) -> "Confidence":
        if score >= 0.66:
            return cls.HIGH
        if score >= 0.4:
            return cls.MEDIUM
        return cls.LOW


@dataclass(slots=True)
class BlendInput:
    """One model's offering for a blend."""

    model: ModelSpec
    field: Field
    #: Present when the model is an ensemble; drives the confidence term.
    ensemble: EnsembleSummary | None = None

    @property
    def effective_resolution_m(self) -> float:
        return self.field.meta.effective_resolution_m


@dataclass(slots=True)
class BlendResult:
    parameter: str
    group: ParamGroup
    valid_time: datetime
    forecast_hour: int
    values: np.ndarray
    meta: FieldMeta

    contributions: list[ModelContribution]
    model_agreement: float
    confidence: Confidence
    confidence_score: float
    main_uncertainty: str
    regime: str = "unknown"
    skill_trained: bool = False
    computed_at: datetime = dc_field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @property
    def contributing_models(self) -> list[str]:
        return [c.model_id for c in self.contributions if c.eligible]

    @property
    def is_multi_model(self) -> bool:
        return len(self.contributing_models) > 1

    def as_field(self) -> Field:
        return Field(self.values, self.meta)

    def to_dict(self) -> dict:
        return {
            "parameter": self.parameter,
            "group": self.group.value,
            "valid_time": self.valid_time.isoformat(),
            "forecast_hour": self.forecast_hour,
            "computed_at": self.computed_at.isoformat(),
            "blend": [c.to_dict() for c in self.contributions],
            # A single model cannot agree with anything. Reporting 100% would
            # read as corroboration where none exists.
            "model_agreement_percent": (
                round(self.model_agreement * 100, 1)
                if self.is_multi_model else None
            ),
            "is_multi_model": self.is_multi_model,
            "confidence": self.confidence.value,
            "confidence_score": round(self.confidence_score, 3),
            "main_uncertainty": self.main_uncertainty,
            "contributing_models": self.contributing_models,
            "regime": self.regime,
            "blend_is_trained": self.skill_trained,
            "effective_resolution_m": self.meta.effective_resolution_m,
            "resolution_note": self.meta.resolution_label,
        }


def _eligibility(
    item: BlendInput, parameter: str, forecast_hour: int
) -> tuple[bool, str]:
    m = item.model
    if parameter not in m.parameters:
        return False, f"{m.id} does not supply {parameter}"
    if forecast_hour > m.max_forecast_hour:
        return False, (
            f"{m.id} reaches only T+{m.max_forecast_hour}, "
            f"this is T+{forecast_hour}"
        )
    if item.field.values.shape != tcm_grid().shape:
        return False, f"{m.id} field is not on the TCM grid"
    return True, ""


def _blended_meta(
    inputs: list[BlendInput], contributions: list[ModelContribution],
    parameter: str,
) -> FieldMeta:
    """Provenance for a blended field.

    The effective resolution of a blend is the WEIGHTED-COARSEST of its
    contributors, not the finest. Blending a 25 km model into a 2 km field
    does not leave a 2 km field: it leaves something in between, and claiming
    2 km would be exactly the misrepresentation the platform forbids. TCM
    reports the weighted mean effective resolution, which degrades honestly
    as coarse models take more of the blend.
    """
    eligible = [c for c in contributions if c.eligible and c.mean_weight > 0]
    total = sum(c.mean_weight for c in eligible) or 1.0
    weighted_res = sum(
        c.effective_resolution_m * c.mean_weight for c in eligible
    ) / total

    base = inputs[0].field.meta
    from dataclasses import replace

    return replace(
        base,
        provider="tcm_blend",
        model="tcm_blend",
        parameter=parameter,
        member_kind=MemberKind.ENSEMBLE_STAT,
        member=None,
        native_resolution_m=float(weighted_res),
        native_grid="tcm adaptive blend",
        source_uri="",
        extra={
            "statistic": "adaptive_blend",
            "components": {
                c.model_id: round(c.mean_weight, 4) for c in eligible
            },
            "weighted_effective_resolution_m": float(weighted_res),
            "finest_component_m": min(
                (c.effective_resolution_m for c in eligible), default=0.0
            ),
            "coarsest_component_m": max(
                (c.effective_resolution_m for c in eligible), default=0.0
            ),
        },
    )


def _main_uncertainty(
    contributions: list[ModelContribution],
    model_agreement: float,
    ensembles: list[EnsembleSummary],
    group: ParamGroup,
) -> str:
    """Name the dominant source of doubt, from the diagnostics only."""
    eligible = [c for c in contributions if c.eligible]
    if not eligible:
        return "no model covers this parameter and lead time"
    if len(eligible) == 1:
        return (
            f"single-model forecast ({eligible[0].display_name}); no "
            "cross-model check is available"
        )

    weak_ensemble = [
        e for e in ensembles if not e.reliability.tails_are_meaningful
    ]
    if model_agreement < 0.45:
        return "models disagree materially on the solution"
    if weak_ensemble:
        e = weak_ensemble[0]
        return (
            f"ensemble size ({e.n_members} members) limits how well the "
            "range of outcomes can be quantified"
        )
    if group in (ParamGroup.INITIATION, ParamGroup.LIGHTNING):
        return "storm initiation timing and placement"
    return "model spread within the blend"


def blend(
    inputs: list[BlendInput],
    parameter: str,
    forecast_hour: int,
    regime: "ConvectiveRegime | None" = None,
) -> BlendResult:
    """Combine several models into one adaptively weighted field.

    `regime` selects which learned-skill bucket applies. Skill is neutral
    until the store has been trained, so an untrained platform blends exactly
    as it did before this term existed -- and says so in the explanation.
    """
    from ..training.regime import ConvectiveRegime
    from ..training.skill import get_store

    if not inputs:
        raise ValueError("blend() needs at least one model input")

    spec = get_param(parameter)
    group = spec.group
    regime = regime or ConvectiveRegime.UNKNOWN
    skill_store = get_store()

    contributions: list[ModelContribution] = []
    usable: list[BlendInput] = []

    for item in inputs:
        ok, why = _eligibility(item, parameter, forecast_hour)
        contribution = ModelContribution(
            model_id=item.model.id,
            display_name=item.model.display_name,
            effective_resolution_m=item.effective_resolution_m,
            eligible=ok,
            reason_ineligible=why,
        )
        if ok:
            contribution.suitability = suitability(item.model, group)
            contribution.lead_decay = lead_decay(item.model, group, forecast_hour)
            contribution.confidence = (
                agreement_score(item.ensemble) if item.ensemble else 0.8
            )
            contribution.skill = skill_store.factor(
                item.model.id, group, regime, forecast_hour
            )
            explanation = skill_store.explain(
                item.model.id, group, regime, forecast_hour
            )
            contribution.skill_trained = explanation["trained"]
            contribution.skill_reason = explanation["reason"]
            usable.append(item)
        contributions.append(contribution)

    if not usable:
        raise ValueError(
            f"no eligible model for {parameter} at T+{forecast_hour}: "
            + "; ".join(c.reason_ineligible for c in contributions)
        )

    stack = np.stack([i.field.values for i in usable]).astype("float32")

    # Per-cell agreement, then the scalar factors, then normalise.
    agree = agreement_weights(stack)
    eligible_contribs = [c for c in contributions if c.eligible]
    scalars = np.array([
        max(c.suitability * c.lead_decay * c.confidence * c.skill, 1e-6)
        for c in eligible_contribs
    ], dtype="float32")

    raw = agree * scalars[:, None, None]
    # A model has no opinion where it has no data.
    raw = np.where(np.isfinite(stack), raw, np.nan)
    weights = normalise(raw)

    blended = np.nansum(
        np.where(np.isfinite(stack), stack * weights, 0.0), axis=0
    ).astype("float32")
    # Cells with no contributor are NaN, not zero.
    any_contributor = np.any(np.isfinite(stack) & np.isfinite(weights), axis=0)
    blended = np.where(any_contributor, blended, np.nan)

    grid_cells = float(blended.size)
    for c, w, col in zip(eligible_contribs, weights, agree):
        finite = np.isfinite(w)
        c.weight_field = w
        c.coverage = float(finite.sum() / grid_cells)
        c.mean_weight = float(np.nanmean(w)) if finite.any() else 0.0
        c.mean_agreement = float(np.nanmean(np.where(finite, col, np.nan))) \
            if finite.any() else 0.0

    # Model agreement is measured against the field's own variability, not
    # against the per-cell weighting kernel -- see consensus_agreement().
    model_agreement = consensus_agreement(stack)

    ensembles = [i.ensemble for i in usable if i.ensemble is not None]
    ensemble_conf = (
        float(np.mean([agreement_score(e) for e in ensembles]))
        if ensembles else 0.6
    )
    n_models = len(usable)
    breadth = min(n_models / 3.0, 1.0)
    confidence_score = float(
        0.45 * model_agreement + 0.35 * ensemble_conf + 0.20 * breadth
    )
    confidence = Confidence.from_score(confidence_score)
    if n_models < 2 and confidence is Confidence.HIGH:
        # One model agreeing with itself is not corroboration. Without a
        # cross-model check, confidence is capped however clean the field
        # looks -- the blend simply has no second opinion to appeal to.
        confidence = Confidence.MEDIUM

    meta = _blended_meta(usable, contributions, parameter)
    result = BlendResult(
        parameter=parameter,
        group=group,
        valid_time=usable[0].field.meta.valid_time,
        forecast_hour=forecast_hour,
        values=blended,
        meta=meta,
        contributions=contributions,
        model_agreement=model_agreement,
        confidence=confidence,
        confidence_score=confidence_score,
        main_uncertainty=_main_uncertainty(
            contributions, model_agreement, ensembles, group
        ),
        regime=regime.value,
        skill_trained=any(c.skill_trained for c in eligible_contribs),
    )
    log.info(
        "blended %s T+%d from %s (agreement %.0f%%, confidence %s)",
        parameter, forecast_hour,
        ", ".join(f"{c.model_id} {c.mean_weight:.0%}" for c in eligible_contribs),
        model_agreement * 100, result.confidence.value,
    )
    return result
