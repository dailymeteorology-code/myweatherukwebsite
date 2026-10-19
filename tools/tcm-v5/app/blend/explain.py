"""Why is the blend what it is, and why did it change?

Everything here is derived from `BlendResult` fields. Nothing invents a
meteorological claim: the explainer describes weights, agreement and
resolution, and stops. Statements about the weather itself belong to the
outlook generator, which reads the forecast diagnostics, not this module.
"""
from __future__ import annotations

from dataclasses import dataclass

from .engine import BlendResult

#: A weight change smaller than this is noise, not news.
MATERIAL_WEIGHT_CHANGE = 0.05


@dataclass(frozen=True, slots=True)
class BlendChange:
    model_id: str
    display_name: str
    previous: float
    current: float

    @property
    def delta(self) -> float:
        return self.current - self.previous

    @property
    def direction(self) -> str:
        return "increased" if self.delta > 0 else "decreased"

    def to_dict(self) -> dict:
        return {
            "model": self.model_id,
            "display_name": self.display_name,
            "previous_percent": round(self.previous * 100, 1),
            "current_percent": round(self.current * 100, 1),
            "delta_percent": round(self.delta * 100, 1),
            "direction": self.direction,
        }


def why_this_blend(result: BlendResult) -> dict:
    """Structured account of the current weights."""
    eligible = [c for c in result.contributions if c.eligible]
    excluded = [c for c in result.contributions if not c.eligible]
    ranked = sorted(eligible, key=lambda c: c.mean_weight, reverse=True)

    # Per-model agreement compares each model against the others. With only
    # two models that comparison is vacuous -- both are equidistant from their
    # own median -- so the driver text must not claim either is "close to the
    # consensus". There is no consensus to be close to.
    consensus_is_meaningful = len(eligible) >= 3

    drivers = []
    for c in ranked:
        bits = []
        if c.suitability >= 0.8:
            bits.append(
                f"well suited to {result.group.value} at "
                f"{c.effective_resolution_m / 1000:g} km"
            )
        elif c.suitability <= 0.4:
            bits.append(
                f"limited for {result.group.value} at "
                f"{c.effective_resolution_m / 1000:g} km"
            )
        if c.lead_decay < 0.85:
            bits.append(
                f"convective-scale advantage reduced at T+{result.forecast_hour}"
            )
        if consensus_is_meaningful:
            if c.mean_agreement >= 0.8:
                bits.append("close to the multi-model consensus")
            elif c.mean_agreement <= 0.5:
                bits.append("an outlier against the other models")
        if c.confidence <= 0.5:
            bits.append("wide ensemble spread")
        if c.coverage < 0.99:
            bits.append(f"covers {c.coverage:.0%} of the analysis area")
        drivers.append({
            "model": c.model_id,
            "weight_percent": round(c.mean_weight * 100, 1),
            "because": bits or ["no distinguishing factor"],
        })

    return {
        "parameter": result.parameter,
        "group": result.group.value,
        "forecast_hour": result.forecast_hour,
        "valid_time": result.valid_time.isoformat(),
        "weights": [c.to_dict() for c in ranked],
        "drivers": drivers,
        "excluded": [
            {"model": c.model_id, "reason": c.reason_ineligible}
            for c in excluded
        ],
        "model_agreement_percent": round(result.model_agreement * 100, 1),
        "confidence": result.confidence.value,
        "main_uncertainty": result.main_uncertainty,
        "model_count": len(eligible),
        "consensus_is_meaningful": consensus_is_meaningful,
        "consensus_caveat": (
            ""
            if consensus_is_meaningful
            else (
                f"{len(eligible)} model(s) in this blend: there is no "
                "multi-model consensus to measure an outlier against, so "
                "weights come from model suitability rather than agreement."
            )
        ),
        "method": (
            "Weights are recomputed for every forecast cycle from model "
            "suitability for this parameter group, lead-time decay of "
            "convective-scale advantage, per-cell agreement with the "
            "multi-model consensus, and ensemble spread. No fixed weights are "
            "used anywhere."
        ),
    }


def why_it_changed(current: BlendResult, previous: BlendResult) -> dict:
    """Compare two blends of the same parameter and say what moved."""
    if current.parameter != previous.parameter:
        raise ValueError(
            "cannot compare blends of different parameters: "
            f"{previous.parameter} vs {current.parameter}"
        )

    prev = {c.model_id: c for c in previous.contributions}
    changes: list[BlendChange] = []
    for c in current.contributions:
        before = prev.get(c.model_id)
        p = before.mean_weight if before else 0.0
        if abs(c.mean_weight - p) >= MATERIAL_WEIGHT_CHANGE:
            changes.append(BlendChange(
                model_id=c.model_id, display_name=c.display_name,
                previous=p, current=c.mean_weight,
            ))
    changes.sort(key=lambda c: abs(c.delta), reverse=True)

    reasons: list[str] = []
    agreement_delta = current.model_agreement - previous.model_agreement
    if abs(agreement_delta) >= 0.05:
        reasons.append(
            f"model agreement {'rose' if agreement_delta > 0 else 'fell'} "
            f"from {previous.model_agreement:.0%} to "
            f"{current.model_agreement:.0%}"
        )
    if current.forecast_hour != previous.forecast_hour:
        reasons.append(
            f"lead time changed from T+{previous.forecast_hour} to "
            f"T+{current.forecast_hour}, altering convective-scale weighting"
        )

    now_eligible = {c.model_id for c in current.contributions if c.eligible}
    was_eligible = {c.model_id for c in previous.contributions if c.eligible}
    for gone in sorted(was_eligible - now_eligible):
        reasons.append(f"{gone} is no longer available for this parameter")
    for arrived in sorted(now_eligible - was_eligible):
        reasons.append(f"{arrived} became available for this parameter")

    for change in changes:
        contribution = next(
            c for c in current.contributions if c.model_id == change.model_id
        )
        if contribution.mean_agreement <= 0.5:
            reasons.append(
                f"{change.model_id} moved away from the consensus, so its "
                "weight was reduced"
            )
        elif change.delta > 0 and contribution.mean_agreement >= 0.8:
            reasons.append(
                f"{change.model_id} moved closer to the consensus, so its "
                "weight was increased"
            )

    if not reasons and not changes:
        reasons.append("no material change; the blend is stable")

    return {
        "parameter": current.parameter,
        "from": {
            "forecast_hour": previous.forecast_hour,
            "valid_time": previous.valid_time.isoformat(),
            "computed_at": previous.computed_at.isoformat(),
        },
        "to": {
            "forecast_hour": current.forecast_hour,
            "valid_time": current.valid_time.isoformat(),
            "computed_at": current.computed_at.isoformat(),
        },
        "changes": [c.to_dict() for c in changes],
        "reasons": reasons,
        "confidence_before": previous.confidence.value,
        "confidence_after": current.confidence.value,
        "material_threshold_percent": MATERIAL_WEIGHT_CHANGE * 100,
    }
