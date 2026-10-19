"""Entrainment / Dilution Engine.

SCIENTIFIC AUDIT (section 59)
=============================

**Physical question.** How strongly will environmental air dilute a
developing updraught and weaken it below what undiluted parcel theory
promises?

This matters more over the UK than almost anywhere. British soundings
routinely show respectable CAPE beneath a dry mid-level layer, and the
resulting convection is shallow, ragged and short-lived. Every CAPE-based
number in the platform is an undiluted upper bound; this engine is how much
of that bound is realistic.

**Inputs.** Mid-level mean and MINIMUM relative humidity, low-level humidity,
the low-to-mid mixing-ratio contrast, cloud-base height, storm depth.

**Mechanism.** Dilution is driven by the SATURATION DEFICIT of the air being
entrained and by how much cloud depth is exposed to it. Two stages:

1. *The dryness driver*, from the mean and the MINIMUM mid-level relative
   humidity, combined by the DOMINANT rule -- the maximum. These are
   correlated restatements of one fact, so the strongest governs and the
   other adds no independent evidence. Combining them by noisy-OR, as this
   engine first did, treats each as fresh confirmation and compounds two
   moderately dry indicators into near-certainty.
2. *Exposure*, from storm depth: a deeper cloud spends longer in the dry
   layer. Dryness and exposure are genuinely different quantities and both
   are needed, so they combine as INGREDIENTS.

**Why not "mid-level RH < X = bad".** Two profiles with identical 700-500 hPa
mean RH behave completely differently if one is uniformly 50% and the other
is 80% over 20%. The MINIMUM is carried precisely so that structure survives
into the answer.

**Why the mixing-ratio contrast is context, not a driver.** It was tried as
one and removed. Mid-level mixing ratio is small at low temperature whatever
the humidity, so the absolute low-to-mid difference scales with
BOUNDARY-LAYER moisture and reads around 10 g/kg on any moist British day.
Under a DOMINANT rule it therefore dominated, and reported strong dilution
for a profile whose mid-levels were 59% saturated. It is still reported,
with re-anchored bounds, as context.

**Limitations.** An environmental diagnostic, not a plume model. It cannot
know updraught width, and dilution depends strongly on it: a 10 km updraught
core entrains proportionally far less than a 2 km one. It therefore describes
the environment's CAPACITY to dilute, not the dilution a particular storm
experiences. Stage 4 deliberately declined to combine these quantities for
the same reason, and this engine states the same limitation rather than
quietly resolving it.

**Data requirements.** A humidity profile through the mid-troposphere. Where
that is absent the engine returns INSUFFICIENT_DATA rather than assuming a
moist column, because assuming moist would silently remove the single
commonest suppression mechanism in UK convection.

**Uncertainty.** High when the profile is coarse (nine levels resolve a dry
layer poorly), and when cloud depth is unknown so the exposure is unknown.

**Validation.** Against observed storm depth relative to the environmental
EL, and against radar-observed cloud tops falling short of the theoretical
equilibrium level.
"""
from __future__ import annotations

from .base import Engine, EngineContext, register
from .result import EngineResult, EngineStatus, ScoreKind
from .transfer import Factor, Rule, Shape, Transfer, compose, pass_through

T_MID_DRYNESS = Transfer(
    name="mid_level_dryness", feature="mid_level_rh", unit="%",
    shape=Shape.INVERSE_LOGISTIC, low=30.0, high=70.0,
    reasoning="Mean 700-500 hPa relative humidity, inverted so that DRY "
              "scores high on dilution potential. Above about 70% the "
              "mid-troposphere is near-saturated and entrained air barely "
              "dilutes; below about 30% it is markedly dry and evaporative "
              "cooling of entrained air substantially erodes buoyancy.",
    reference="Gilmore & Wicker (1998), Mon. Wea. Rev. 126, 943-958",
    limitations="A layer mean; see the minimum-RH factor for structure.",
)

T_DRIEST_LAYER = Transfer(
    name="driest_layer", feature="mid_level_min_rh", unit="%",
    shape=Shape.INVERSE_LOGISTIC, low=15.0, high=55.0,
    reasoning="The driest point found in the mid-levels. Carried separately "
              "from the mean because a thin very dry layer does damage a "
              "layer mean conceals -- two profiles with the same mean RH "
              "behave quite differently if one is uniformly 50% and the "
              "other is 80% over 20%.",
    reference="Gilmore & Wicker (1998); James & Markowski (2010), Mon. Wea. "
              "Rev. 138, 140-161",
)

T_MOISTURE_CONTRAST = Transfer(
    name="moisture_contrast", feature="low_to_mid_moisture_contrast",
    unit="g/kg", shape=Shape.LOGISTIC, low=6.0, high=16.0,
    reasoning="The low-to-mid mixing-ratio difference is the gradient across "
              "which mixing acts. Re-anchored after the original 2-8 g/kg "
              "window was found to saturate on ordinary UK profiles: a "
              "routine moist boundary layer gives about 10 g/kg of contrast "
              "simply because mid-level mixing ratio is small at low "
              "temperature. 16 g/kg is genuinely large for the UK.",
    reference="James & Markowski (2010), Mon. Wea. Rev. 138, 140-161",
    limitations="Reported as CONTEXT, not used as a dilution driver. The "
                "absolute contrast scales with boundary-layer moisture, so a "
                "moist day always shows a large one whether or not the "
                "mid-levels are dry; saturation deficit (RH) is the "
                "physically correct driver and is what the engine uses.",
)

T_EXPOSURE = Transfer(
    name="dilution_exposure", feature="storm_depth", unit="m",
    shape=Shape.LOGISTIC, low=2000.0, high=7000.0,
    reasoning="A deeper cloud spends longer traversing the dry layer and "
              "presents more surface to it, so exposure to dilution rises "
              "with depth. Included so that a shallow cumulus in a dry "
              "environment is not judged as diluted as a deep tower in the "
              "same environment.",
    reference="Standard entraining-plume reasoning; Squires (1958), "
              "Tellus 10, 372-380",
    limitations="Depth is a poor proxy for the width that actually governs "
                "the entrainment rate.",
)

T_DRYNESS_DRIVER = pass_through(
    "mid_level_dryness_driver",
    note="the strongest of the correlated mid-level moisture measures, "
         "already composed by the DOMINANT rule.",
    reference="Gilmore & Wicker (1998), Mon. Wea. Rev. 126, 943-958",
)

#: Bands used only for the human-readable label. The numeric score is the
#: score; these exist so an explanation can say "strong dilution" without a
#: reader inventing their own cut-offs.
LABELS = (
    (0.30, "weak dilution"),
    (0.60, "moderate dilution"),
    (1.01, "strong dilution"),
)


class EntrainmentEngine(Engine):
    """Estimates how much environmental air will dilute an updraught.

    See the module docstring for the full scientific audit.
    """

    name = "entrainment"
    version = "1.0"
    score_kind = ScoreKind.POTENTIAL
    question = (
        "How strongly will environmental air dilute a developing updraught? "
        "High score means STRONG dilution, i.e. unfavourable for storms."
    )
    consumes_diagnostics = (
        "entrainment_indicators", "lfc", "el", "lcl",
    )

    def evaluate(self, context: EngineContext) -> EngineResult:
        features = context.features.get("set")
        if features is None:
            return self._insufficient("no shared feature set was built")

        if not features.available("mid_level_rh"):
            return self._insufficient(
                "no mid-tropospheric humidity, so dilution potential cannot "
                "be assessed. Assuming a moist column would silently remove "
                "the commonest suppression mechanism in UK convection",
                missing=("mid_level_rh",),
            )

        # Two stages, because the inputs are not all of a kind.
        #
        # The three moisture measures are CORRELATED restatements of one
        # thing -- how dry the mid-troposphere is. Combining them with
        # noisy-OR treats each as fresh evidence and compounds three
        # moderately dry indicators into certainty; on a routine profile it
        # returned 1.000, which then drove the updraught engine to zero.
        # DOMINANT is the right rule: the strongest indication of dryness
        # governs, and the others add no independent information.
        # RELATIVE humidity, not the absolute mixing-ratio contrast. The
        # contrast was tried as a driver and had to be removed: mid-level
        # mixing ratio is small at low temperature whatever the humidity, so
        # the absolute low-to-mid difference scales with BOUNDARY-LAYER
        # moisture and reads ~10 g/kg on any moist day. Under a DOMINANT
        # rule it therefore dominated, and reported strong dilution for a
        # profile whose mid-levels were 59% saturated. Saturation deficit is
        # what actually drives evaporative cooling of entrained air, and RH
        # measures it directly. The contrast is still reported below, as
        # context rather than as a driver.
        dryness_factors = [
            Factor(T_MID_DRYNESS, features.get("mid_level_rh")),
            Factor(T_DRIEST_LAYER, features.get("mid_level_min_rh")),
        ]
        dryness = compose(Rule.DOMINANT, dryness_factors, minimum_factors=1)
        if dryness is None:
            return self._insufficient(
                "no usable measure of mid-level dryness",
                missing=features.missing(
                    "mid_level_rh", "mid_level_min_rh",
                    "low_to_mid_moisture_contrast",
                ),
            )

        # Exposure is a genuinely different quantity: how much of the cloud
        # meets that dry air. Dryness and exposure are both needed for
        # dilution to matter, so they combine as INGREDIENTS.
        factors = [
            Factor(T_DRYNESS_DRIVER, None, membership=dryness.value),
            Factor(T_EXPOSURE, features.get("storm_depth")),
        ]
        composition = compose(Rule.INGREDIENTS, factors, minimum_factors=1)
        if composition is None:
            return self._insufficient(
                "dilution could not be composed",
                missing=("storm_depth",),
            )
        # Keep the underlying moisture factors visible in the contributions,
        # not just the composed driver.
        composition.factors = dryness.factors + [
            f for f in composition.factors
            if f.transfer is not T_DRYNESS_DRIVER
        ]

        score = round(composition.value, 4)
        label = next(name for cut, name in LABELS if score < cut)

        completeness = len(composition.factors) / (len(dryness_factors) + 1)
        contrast = features.get("low_to_mid_moisture_contrast")
        # The profile's vertical resolution matters more here than almost
        # anywhere: a dry layer thinner than the level spacing is invisible.
        levels = context.parameters.column_quality.get("levels", 0)
        resolution_penalty = 0.0 if levels >= 12 else (0.3 if levels >= 8
                                                      else 0.5)
        confidence = round(
            max(0.0, completeness * (1.0 - resolution_penalty)), 3
        )
        uncertainty = round(
            min(1.0, 0.5 * (1.0 - completeness) + resolution_penalty), 3
        )

        status = EngineStatus.AVAILABLE
        flags: list[str] = []
        if composition.missing:
            status = EngineStatus.DEGRADED
            flags.append(f"missing: {', '.join(composition.missing)}")
        if levels < 12:
            flags.append(
                f"{levels} vertical levels: a dry layer thinner than the "
                f"level spacing is invisible to this engine, so dilution may "
                f"be understated"
            )
        flags.append(
            "an environmental capacity to dilute, NOT the dilution a "
            "particular storm experiences -- that depends on updraught width, "
            "which is unknown here"
        )

        strongest = composition.limiting
        # For ALTERNATIVES the interesting factor is the STRONGEST, not the
        # weakest, so it is found explicitly rather than reusing `limiting`.
        driver = max(composition.factors, key=lambda f: f.membership)

        explanation = [f"{label} ({score:.2f})"]
        if driver.value is not None:
            explanation.append(
                f"driven mainly by {driver.transfer.feature} "
                f"{driver.value:.1f} {driver.transfer.unit}"
            )
        if features.get("mid_level_min_rh") is not None:
            explanation.append(
                f"driest mid-level humidity "
                f"{features.get('mid_level_min_rh'):.0f}%"
            )
        if score > 0.6:
            explanation.append(
                "undiluted CAPE substantially overstates what an updraught "
                "will achieve here"
            )

        return self._result(
            score=score,
            status=status,
            confidence=confidence,
            uncertainty=uncertainty,
            contributions=composition.contributions,
            quality_flags=tuple(flags),
            explanation=tuple(explanation),
            reason="; ".join(flags[:1]) if status is not EngineStatus.AVAILABLE
            else "",
            extra={
                "dilution_label": label,
                "label_bands": {
                    "weak": "< 0.30", "moderate": "0.30-0.60",
                    "strong": "> 0.60",
                },
                "strongest_driver": driver.transfer.feature,
                "mid_level_rh_percent": features.get("mid_level_rh"),
                "mid_level_min_rh_percent": features.get("mid_level_min_rh"),
                "low_level_rh_percent": features.get("low_level_rh"),
                "moisture_contrast_g_kg": contrast,
                "moisture_contrast_membership": (
                    round(T_MOISTURE_CONTRAST(contrast), 4)
                    if contrast is not None else None
                ),
                "moisture_contrast_role": (
                    "context only, NOT a dilution driver: the absolute "
                    "contrast scales with boundary-layer moisture and reads "
                    "high on any moist day regardless of mid-level dryness"
                ),
                "vertical_levels": levels,
                "direction_note": (
                    "HIGH score means STRONG dilution and is UNFAVOURABLE "
                    "for convection -- the opposite sense to the "
                    "thermodynamic engine"
                ),
            },
        )


ENGINE = register(EntrainmentEngine())
