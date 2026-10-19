"""Updraft Potential Engine.

SCIENTIFIC AUDIT (section 59)
=============================

**Physical question.** How strong could updraughts become in this
environment, and how well could they persist?

**Inputs.** Representative CAPE from the thermodynamic engine, storm depth,
mid-level lapse rate, the entrainment engine's dilution potential, cloud
depth, freezing level.

**Mechanism.** Two distinct quantities, deliberately never merged:

1. *Theoretical maximum updraught.* Parcel theory gives

       w_max = sqrt(2 * CAPE)

   directly, by equating the buoyant work done on a parcel to its kinetic
   energy. This is an exact consequence of the CAPE definition, not a fitted
   relation. It is also a substantial OVERESTIMATE of anything observed --
   typically by a factor of about two -- because it neglects entrainment,
   condensate loading and the perturbation pressure gradient that opposes
   ascent. It is reported in m/s, plainly labelled as an upper bound, and
   never presented as a forecast updraught speed.

2. *Updraught potential*, the engine's score: a bounded measure combining the
   buoyancy available, the depth over which it acts, and how much of it
   survives dilution.

**Why entrainment enters here.** The thermodynamic engine deliberately does
not discount CAPE for dry air; it reports undiluted potential. This engine is
where that discount is applied, once, in a traceable place, using the
entrainment engine's own output rather than a second private calculation of
mid-level humidity.

**Persistence.** Reported as SUPPORTING DIAGNOSTICS, not as a trained
persistence prediction. More CAPE does not mean longer-lived updraughts --
that depends on forcing persistence, storm-relative flow, cold-pool
behaviour and boundary evolution, most of which need a time sequence this
engine does not have. The distinction is stated on the result rather than
resolved by assumption.

**Limitations.** Parcel theory throughout. No condensate loading, no
perturbation pressure gradient, no updraught width. Environmental potential,
not storm-scale prediction.

**Data requirements.** Thermodynamic profile with humidity. Better with the
entrainment engine available; degrades explicitly without it.

**Uncertainty.** Rises with dilution potential (a diluted updraught is less
predictable from environment alone) and with missing storm depth.

**Validation.** Against radar-derived vertical velocity and echo-top height,
never against storm reports, which would conflate updraught strength with
storm occurrence.
"""
from __future__ import annotations

import math

from .base import Engine, EngineContext, register
from .result import Contribution, EngineResult, EngineStatus, ScoreKind
from .transfer import Factor, Rule, Shape, Transfer, compose

T_BUOYANCY = Transfer(
    name="buoyancy_available", feature="representative_cape", unit="J/kg",
    shape=Shape.LOGISTIC, low=250.0, high=2000.0,
    reasoning="Buoyant energy sets the ceiling on updraught kinetic energy "
              "through w_max = sqrt(2*CAPE). 250 J/kg gives a theoretical "
              "22 m/s and a real updraught nearer 10; 2000 J/kg gives a "
              "theoretical 63 m/s and a strong UK storm.",
    reference="Parcel theory; Doswell & Blanchard (1998), Wea. Forecasting "
              "13, 1148-1164",
    limitations="Undiluted. The dilution factor in this same composition is "
                "what accounts for that.",
)

T_DEPTH_FOR_ACCELERATION = Transfer(
    name="acceleration_depth", feature="storm_depth", unit="m",
    shape=Shape.LOGISTIC, low=2000.0, high=8000.0,
    reasoning="An updraught accelerates over the depth of the positively "
              "buoyant layer, so the same CAPE in a deeper layer produces a "
              "faster core. Below about 2 km there is no room to accelerate "
              "however buoyant the parcel.",
    reference="Blanchard (1998), Wea. Forecasting 13, 870-877",
)

T_LAPSE_ACCELERATION = Transfer(
    name="lapse_acceleration", feature="lr_700_500", unit="K/km",
    shape=Shape.LOGISTIC, low=5.5, high=7.5,
    reasoning="Steeper mid-level lapse rates increase the parcel's excess "
              "temperature as it rises, concentrating buoyancy where the "
              "updraught is already fast.",
    reference="Standard parcel reasoning; Met Office convective guidance",
)

T_DILUTION_SURVIVAL = Transfer(
    name="dilution_survival", feature="dilution_potential",
    unit="dimensionless", shape=Shape.INVERSE_RAMP, low=0.1, high=0.9,
    reasoning="How much of the undiluted potential survives entrainment. "
              "Inverted from the entrainment engine's score, which runs high "
              "for STRONG dilution. Linear rather than logistic because the "
              "input is already a bounded membership and a second sigmoid "
              "would compress the middle without physical justification.",
    reference="Gilmore & Wicker (1998), Mon. Wea. Rev. 126, 943-958",
)

#: Theoretical-to-observed updraught ratio. Widely reported as roughly a
#: factor of two; used ONLY to annotate the theoretical maximum, never to
#: compute the score.
OBSERVED_FRACTION_NOTE = (
    "observed peak updraughts are typically around half the parcel-theory "
    "maximum, because of entrainment, condensate loading and the "
    "perturbation pressure gradient"
)


class UpdraftEngine(Engine):
    """Estimates environmental potential for strong convective updraughts.

    See the module docstring for the full scientific audit.
    """

    name = "updraft"
    version = "1.0"
    score_kind = ScoreKind.POTENTIAL
    question = (
        "How strong could updraughts become in this environment? An "
        "environmental upper bound, not a storm-scale prediction."
    )
    consumes_diagnostics = (
        "sbcape", "mlcape", "mucape", "lfc", "el", "lr_700_500",
        "cloud_depth", "freezing_level",
    )
    consumes_engines = ("thermodynamic", "entrainment")

    def evaluate(self, context: EngineContext) -> EngineResult:
        features = context.features.get("set")
        if features is None:
            return self._insufficient("no shared feature set was built")

        thermo = context.result("thermodynamic")
        cape = None
        parcel = None
        if thermo is not None and thermo.status.has_score:
            cape = thermo.extra.get("representative_cape_j_kg")
            parcel = thermo.extra.get("dominant_parcel")
        if cape is None:
            cape = features.get("mucape")
            parcel = "mu"
        if cape is None:
            return self._insufficient(
                "no representative CAPE, so no updraught potential",
                missing=("mucape",),
            )

        # -- the theoretical maximum, from parcel theory ----------------------
        w_max = math.sqrt(2.0 * max(cape, 0.0))

        # -- dilution, taken from the entrainment engine ---------------------
        entrainment = context.result("entrainment")
        dilution = None
        if entrainment is not None and entrainment.status.has_score:
            dilution = entrainment.score

        factors = [
            Factor(T_BUOYANCY, cape),
            Factor(T_DEPTH_FOR_ACCELERATION, features.get("storm_depth")),
            Factor(T_LAPSE_ACCELERATION, features.get("lr_700_500")),
        ]
        if dilution is not None:
            factors.append(Factor(T_DILUTION_SURVIVAL, dilution))

        composition = compose(Rule.INGREDIENTS, factors, minimum_factors=2)
        if composition is None:
            return self._insufficient(
                "fewer than two updraught ingredients could be evaluated",
                missing=features.missing("storm_depth", "lr_700_500"),
            )

        completeness = len(composition.factors) / len(factors)
        status = EngineStatus.AVAILABLE
        flags: list[str] = []
        if dilution is None:
            status = EngineStatus.DEGRADED
            flags.append(
                "the entrainment engine produced no result, so this "
                "potential is UNDILUTED and overstates what a real updraught "
                "would achieve"
            )
        if composition.missing:
            status = EngineStatus.DEGRADED
            flags.append(f"missing: {', '.join(composition.missing)}")

        confidence = round(
            completeness * (1.0 if dilution is not None else 0.6), 3
        )
        uncertainty = round(
            min(1.0, 0.4 * (1.0 - completeness)
                + 0.4 * (dilution if dilution is not None else 0.5)),
            3,
        )

        contributions = list(composition.contributions)
        contributions.append(Contribution(
            feature="theoretical_max_updraft", value=round(w_max, 1),
            unit="m/s", transformed=None, influence=0.0,
            direction="neutral",
            note=f"sqrt(2*CAPE) from parcel theory. An UPPER BOUND, not a "
                 f"forecast: {OBSERVED_FRACTION_NOTE}",
        ))

        return self._result(
            score=round(composition.value, 4),
            status=status,
            confidence=confidence,
            uncertainty=uncertainty,
            contributions=tuple(contributions),
            quality_flags=tuple(flags),
            explanation=tuple(self._explain(
                composition, cape, w_max, dilution, parcel
            )),
            reason="; ".join(flags[:1]) if status is not EngineStatus.AVAILABLE
            else "",
            extra={
                "theoretical_max_updraft_m_s": round(w_max, 1),
                "theoretical_max_note": (
                    "w_max = sqrt(2*CAPE), an exact consequence of the CAPE "
                    "definition and a substantial overestimate of any "
                    "observed updraught. " + OBSERVED_FRACTION_NOTE
                ),
                "representative_cape_j_kg": round(cape, 1),
                "parcel": parcel,
                "dilution_potential": dilution,
                "dilution_applied": dilution is not None,
                "persistence": self._persistence(context, features),
            },
        )

    def _persistence(self, context: EngineContext, features) -> dict:
        """Diagnostics bearing on updraught persistence -- NOT a prediction.

        Deliberately not a score. Persistence depends on forcing continuity,
        cold-pool behaviour, storm-relative flow and environmental recovery,
        and reducing them to one number here would assert a model of storm
        maintenance that nothing has established.
        """
        return {
            "is_a_prediction": False,
            "note": (
                "supporting diagnostics only. More CAPE does NOT mean "
                "longer-lived updraughts; persistence needs forcing "
                "continuity and a time sequence this engine does not have"
            ),
            "storm_relative_inflow_1km_m_s": features.get(
                "storm_relative_inflow_1km"
            ),
            "storm_relative_anvil_flow_m_s": features.get(
                "storm_relative_anvil_flow"
            ),
            "shear_0_6km_m_s": features.get("shear_0_6km"),
            "dilution_potential": (
                context.result("entrainment").score
                if context.result("entrainment") is not None
                and context.result("entrainment").status.has_score else None
            ),
            "boundary_layer_mixing_ratio_g_kg": features.get(
                "boundary_layer_mixing_ratio"
            ),
            "missing_for_a_real_persistence_model": [
                "CAPE and CIN at successive lead times",
                "forcing evolution",
                "cold-pool intensity",
            ],
        }

    def _explain(self, composition, cape, w_max, dilution, parcel):
        out = [
            f"{parcel.upper() if parcel else 'representative'} parcel CAPE "
            f"{cape:.0f} J/kg gives a parcel-theory maximum of {w_max:.0f} "
            f"m/s -- an upper bound, roughly twice what is observed"
        ]
        limiting = composition.limiting
        if limiting is not None and limiting.membership < 0.4:
            out.append(
                f"limited by {limiting.transfer.feature}"
                + (f" ({limiting.value:.0f} {limiting.transfer.unit})"
                   if limiting.value is not None else "")
            )
        if dilution is not None and dilution > 0.6:
            out.append(
                f"strong environmental dilution ({dilution:.2f}) will erode "
                f"much of this buoyancy"
            )
        elif dilution is not None and dilution < 0.3:
            out.append(
                f"weak dilution ({dilution:.2f}): a moist column lets the "
                f"updraught retain most of its buoyancy"
            )
        return out


ENGINE = register(UpdraftEngine())
