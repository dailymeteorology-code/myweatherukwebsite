"""The adaptive blend: how much each model is worth, right now, right here.

The central principle of TCM V5 is that the blend is part of the forecast.
There are no fixed weights anywhere in this module -- every weight is derived,
per run, from five factors, and every factor is recorded so the result can be
explained rather than asserted.

    eligibility   hard gate. Does this model cover this cell, hold this
                  parameter, and reach this lead time? Zero if not.
    suitability   is this model the right TOOL for this parameter group?
                  2 km convective-scale detail matters enormously for storm
                  initiation and barely at all for mean-sea-level pressure.
    lead decay    a convective-scale model's advantage is largest at short
                  range and erodes with lead time.
    agreement     models near the multi-model consensus are upweighted, so a
                  lone outlier does not drag the blend. Computed PER CELL,
                  which is what makes the blend vary geographically.
    confidence    ensembles contribute their own spread; a tight ensemble
                  earns more weight than a wildly divergent one.

Weights are arrays over the grid, not scalars. A model that covers only
southern England (AROME) therefore contributes there and nowhere else,
automatically, without anybody remembering to special-case it.
"""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from ..params import ParamGroup, get as get_param
from ..registry import ModelSpec

# How much spatial detail each blend group actually rewards.
#
# A group with a high value is one where resolution is decisive: convective
# initiation genuinely depends on 2 km detail. A group with a low value is one
# where a global model is perfectly adequate: the position of a surface low is
# not better resolved by a 2 km model than a 10 km one.
RESOLUTION_SENSITIVITY: dict[ParamGroup, float] = {
    ParamGroup.INITIATION: 1.0,
    ParamGroup.LIGHTNING: 0.9,
    ParamGroup.HAIL: 0.9,
    ParamGroup.PRECIPITATION: 0.8,
    ParamGroup.ORGANISATION: 0.6,
    ParamGroup.FLOODING: 0.6,
    ParamGroup.INSTABILITY: 0.5,
    ParamGroup.WIND: 0.4,
    ParamGroup.BASIC: 0.3,
    ParamGroup.SYNOPTIC: 0.15,
}

#: Resolution at which a model is considered fully adequate for a
#: resolution-sensitive group. Finer than this earns no further bonus.
REFERENCE_RESOLUTION_M = 2000.0

#: Lead time beyond which convective-scale advantage has largely gone.
CONVECTIVE_ADVANTAGE_HALF_LIFE_H = 36.0


@dataclass(slots=True)
class ModelContribution:
    """One model's part in a blend, with the reasoning that produced it."""

    model_id: str
    display_name: str
    effective_resolution_m: float

    eligible: bool
    reason_ineligible: str = ""

    suitability: float = 0.0
    lead_decay: float = 1.0
    confidence: float = 1.0
    #: Learned skill multiplier from the training store. 1.0 when untrained.
    skill: float = 1.0
    skill_trained: bool = False
    skill_reason: str = "untrained"
    #: Mean over cells where the model contributes at all.
    mean_agreement: float = 0.0
    #: Final normalised weight, averaged over contributing cells.
    mean_weight: float = 0.0
    #: Fraction of the analysis grid where this model contributes.
    coverage: float = 0.0
    #: Per-cell weights, normalised across models. Kept for the blend itself.
    weight_field: np.ndarray | None = dc_field(default=None, repr=False)

    def to_dict(self) -> dict:
        return {
            "model": self.model_id,
            "display_name": self.display_name,
            "weight_percent": round(self.mean_weight * 100, 1),
            "coverage_percent": round(self.coverage * 100, 1),
            "effective_resolution_m": self.effective_resolution_m,
            "eligible": self.eligible,
            "reason_ineligible": self.reason_ineligible,
            "factors": {
                "suitability": round(self.suitability, 3),
                "lead_decay": round(self.lead_decay, 3),
                "confidence": round(self.confidence, 3),
                "agreement": round(self.mean_agreement, 3),
                "learned_skill": round(self.skill, 3),
            },
            "skill": {
                "trained": self.skill_trained,
                "factor": round(self.skill, 3),
                "reason": self.skill_reason,
            },
        }


def suitability(model: ModelSpec, group: ParamGroup) -> float:
    """How well suited a model is to a parameter group, from 0 to 1.

    Combines the resolution the model ACTUALLY delivers with whether the
    registry lists this group among its strengths. Resolution is read from
    `delivered_resolution_m`, so ECMWF is judged on the 25 km we receive, not
    the 9 km it runs at.
    """
    sensitivity = RESOLUTION_SENSITIVITY.get(group, 0.5)

    # Resolution score: 1.0 at or below the reference, decaying as the model
    # gets coarser, and the decay is steeper for resolution-sensitive groups.
    ratio = max(model.delivered_resolution_m, 1.0) / REFERENCE_RESOLUTION_M
    resolution_score = 1.0 / (1.0 + sensitivity * max(ratio - 1.0, 0.0))

    # A model the registry calls strong for this group keeps its full score;
    # one that is merely adequate is discounted but not excluded.
    strength = 1.0 if group in model.strengths else 0.55

    return float(np.clip(resolution_score * strength, 0.0, 1.0))


def lead_decay(model: ModelSpec, group: ParamGroup, forecast_hour: int) -> float:
    """Erosion of convective-scale advantage with lead time.

    Only applies where resolution matters. A synoptic blend does not care that
    it is day 4; a convective-initiation blend cares a great deal.
    """
    sensitivity = RESOLUTION_SENSITIVITY.get(group, 0.5)
    if sensitivity < 0.4 or model.delivered_resolution_m > 5000.0:
        return 1.0
    decay = 0.5 ** (forecast_hour / CONVECTIVE_ADVANTAGE_HALF_LIFE_H)
    # Never falls below half: a 2 km model at day 3 is diminished, not useless.
    return float(0.5 + 0.5 * decay)


def agreement_weights(stack: np.ndarray) -> np.ndarray:
    """Per-cell agreement weight for each model in `stack`.

    Distance from the across-model median, scaled by a robust across-model
    spread, then mapped through a smooth kernel. A model sitting on the
    consensus scores near 1; a far outlier is damped but never silenced --
    the outlier is sometimes right, and TCM records disagreement rather than
    deleting it.
    """
    if stack.shape[0] == 1:
        return np.ones_like(stack)

    with np.errstate(invalid="ignore"):
        median = np.nanmedian(stack, axis=0)
        deviation = np.abs(stack - median)
        # Median absolute deviation across models, per cell.
        mad = np.nanmedian(deviation, axis=0)

    # A floor prevents division blowing up where every model agrees exactly.
    finite = mad[np.isfinite(mad) & (mad > 0)]
    floor = float(np.median(finite)) if finite.size else 1.0
    scale = np.where(np.isfinite(mad) & (mad > 0), mad, floor)
    scale = np.where(scale > 0, scale, 1.0)

    z = np.divide(
        deviation, scale,
        out=np.zeros_like(deviation), where=np.isfinite(deviation),
    )
    # Cauchy-like kernel: gentle, heavy-tailed, never reaches zero.
    return (1.0 / (1.0 + 0.5 * np.square(z))).astype("float32")


def consensus_agreement(stack: np.ndarray) -> float:
    """How closely the models agree overall, from 0 to 1.

    This is deliberately NOT the mean of `agreement_weights`. Those weights
    measure how close each model is to the consensus *relative to the other
    models*, which is the right basis for weighting but is blind with two
    models: both are always exactly equidistant from their own median, so the
    figure is pinned at a constant however far apart they are. With only UKV
    and MOGREPS-UK in the blend today, that would report the same agreement
    for near-identical and wildly divergent forecasts.

    So agreement is measured against the field's OWN variability instead:
    across-model spread divided by the spatial spread of the consensus field.
    Two models differing by 0.1 K on a field that varies by 10 K across the
    country agree closely; two differing by 8 K do not.
    """
    if stack.shape[0] < 2:
        return 1.0

    with np.errstate(invalid="ignore"):
        spread = np.nanstd(stack, axis=0)
        centre = np.nanmean(stack, axis=0)

    finite_centre = centre[np.isfinite(centre)]
    finite_spread = spread[np.isfinite(spread)]
    if finite_centre.size == 0 or finite_spread.size == 0:
        return 0.0

    # Robust spatial scale of the field itself.
    q75, q25 = np.percentile(finite_centre, [75, 25])
    scale = float(q75 - q25)
    if scale <= 0:
        # A spatially uniform field: fall back to its magnitude, so that
        # "both models say exactly 288 K everywhere" reads as full agreement.
        scale = float(abs(np.median(finite_centre))) or 1.0

    ratio = float(np.mean(finite_spread)) / scale
    return float(np.clip(1.0 / (1.0 + 2.0 * ratio), 0.0, 1.0))


def normalise(weights: np.ndarray) -> np.ndarray:
    """Normalise per-cell weights across the model axis to sum to 1.

    Cells where no model contributes are left as NaN rather than being given
    an arbitrary uniform weight -- TCM has no forecast there and says so.
    """
    total = np.nansum(weights, axis=0)
    good = total > 0
    out = np.full_like(weights, np.nan)
    np.divide(weights, total, out=out, where=good[None, :, :])
    return out
