"""The six hazard engines.

SHARED ARCHITECTURE
===================

Every hazard here is built as a genuine conditional:

    P(hazard) = P(storm develops) * P(hazard | storm develops)

The second term is the engine's OWN environmental modelling and is computed
from ingredients specific to that hazard. It is never a copy of the
thunderstorm probability with a multiplier on it -- that shortcut is what
makes a system report high hail probability simply because it reported high
storm probability, and it is what section 42 forbids.

Both terms are reported. `conditional_score` is what the engine actually
knows about the hazard given a storm; `score` folds in initiation. The
distinction matters in both directions:

  * A low storm probability with a high conditional score is a real and
    dangerous state -- few storms expected, but any that form could be
    severe. Reporting only the product would hide it, so the conditional
    survives on every result.
  * A high storm probability does NOT raise the conditional. Storms are
    likely; whether they hail is a separate question with separate physics.

DEPENDENCIES
------------
Hazard engines consume environmental and convective engines. Nothing here
feeds back into them -- the dependency graph is acyclic and enforced by
`topological_order`, so a hazard engine cannot become an input to the
thermodynamic engine by accident.

SHARED INPUTS ARE NOT DOUBLE EVIDENCE
--------------------------------------
CAPE appears in the thermodynamic, updraught and hail engines. That is
correct -- it is genuinely relevant to all three -- but it means their
outputs are correlated and must not later be summed as independent evidence.
Every result declares its `input_diagnostics` and `input_engines` precisely
so the aggregation stage can see the overlap.
"""
from __future__ import annotations

from .base import Engine, EngineContext, register
from .result import Contribution, EngineResult, EngineStatus, ScoreKind
from .transfer import Factor, Rule, Shape, Transfer, compose, pass_through


class HazardEngine(Engine):
    """Shared conditional machinery for a hazard.

    Subclasses supply `ingredients()`; this class composes them into a
    conditional score and folds in initiation to give the unconditional one.
    """

    score_kind = ScoreKind.UNCALIBRATED_PROBABILITY
    #: The minimum number of hazard-specific ingredients required.
    minimum_factors = 2
    #: Composition rule for the conditional score.
    rule = Rule.INGREDIENTS

    def ingredients(self, context: EngineContext, features) -> list[Factor]:
        raise NotImplementedError

    def hazard_explanation(self, composition, features, context) -> list[str]:
        return []

    def hazard_extra(self, composition, features, context) -> dict:
        return {}

    def evaluate(self, context: EngineContext) -> EngineResult:
        features = context.features.get("set")
        if features is None:
            return self._insufficient("no shared feature set was built")

        factors = self.ingredients(context, features)
        composition = compose(
            self.rule, factors, minimum_factors=self.minimum_factors
        )
        if composition is None:
            return self._insufficient(
                f"fewer than {self.minimum_factors} of the ingredients this "
                f"hazard requires could be evaluated",
                missing=tuple(
                    f.transfer.feature for f in factors
                    if f.membership is None
                ),
            )

        conditional = composition.value

        # -- fold in initiation, if it produced anything ---------------------
        initiation = context.result("convective_initiation")
        storm_probability = None
        if initiation is not None and initiation.status.has_score:
            storm_probability = initiation.score

        flags: list[str] = []
        status = EngineStatus.AVAILABLE
        if storm_probability is None:
            score = conditional
            status = EngineStatus.LOW_CONFIDENCE
            flags.append(
                "no initiation estimate available, so the reported score is "
                "the CONDITIONAL probability given a storm, not an "
                "unconditional hazard probability"
            )
        else:
            score = conditional * storm_probability

        if composition.missing:
            if status is EngineStatus.AVAILABLE:
                status = EngineStatus.DEGRADED
            flags.append(f"missing: {', '.join(composition.missing)}")

        completeness = len(composition.factors) / max(len(factors), 1)
        initiation_confidence = (
            initiation.confidence
            if initiation is not None and initiation.confidence is not None
            else 0.3
        )
        confidence = round(completeness * initiation_confidence, 3)
        initiation_uncertainty = (
            initiation.uncertainty
            if initiation is not None and initiation.uncertainty is not None
            else 0.6
        )
        uncertainty = round(
            min(1.0, 0.4 * (1.0 - completeness) + 0.6 * initiation_uncertainty),
            3,
        )

        contributions = list(composition.contributions)
        contributions.append(Contribution(
            feature="storm_probability", value=storm_probability,
            unit="probability", transformed=storm_probability,
            influence=0.0,
            direction="limiting" if (storm_probability or 1.0) < 0.4
            else "supporting",
            note="from the initiation engine; multiplies the conditional "
                 "score. NOT part of this hazard's own environmental "
                 "assessment",
        ))

        explanation = list(
            self.hazard_explanation(composition, features, context)
        )
        if storm_probability is not None and storm_probability < 0.25 \
                and conditional > 0.6:
            explanation.append(
                f"few storms expected ({storm_probability:.2f}), but any that "
                f"form would be in a favourable environment for this hazard "
                f"({conditional:.2f} conditional) -- a low unconditional "
                f"score here is not the same as a benign environment"
            )

        extra = {
            "conditional_score": round(conditional, 4),
            "conditional_meaning": (
                f"P({self.name} | a storm develops), from this engine's own "
                f"ingredients"
            ),
            "storm_probability": storm_probability,
            "unconditional_is_product": storm_probability is not None,
            "independence_note": (
                "this hazard has its own environmental modelling and is NOT "
                "a rescaled thunderstorm probability"
            ),
        }
        extra.update(self.hazard_extra(composition, features, context))

        return self._result(
            score=round(min(1.0, max(0.0, score)), 4),
            status=status,
            confidence=confidence,
            uncertainty=uncertainty,
            contributions=tuple(contributions),
            quality_flags=tuple(flags),
            explanation=tuple(explanation),
            reason="; ".join(flags[:1]) if status is not EngineStatus.AVAILABLE
            else "",
            extra=extra,
        )


# ===========================================================================
# Lightning
# ===========================================================================

T_MIXED_PHASE_DEPTH = Transfer(
    name="mixed_phase_depth", feature="cold_cloud_depth", unit="m",
    shape=Shape.LOGISTIC, low=1000.0, high=4000.0,
    reasoning="Charge separation in the non-inductive mechanism requires "
              "graupel, ice crystals and supercooled water coexisting, which "
              "happens in the cloud above the freezing level. A deeper "
              "glaciated layer means more of the cloud is in that regime. "
              "Below about 1 km of cold cloud, electrification is rare.",
    reference="Takahashi (1978), J. Atmos. Sci. 35, 1536-1548; Saunders "
              "(1993), J. Appl. Meteor. 32, 642-655",
    limitations="Cold cloud depth is a proxy for the -10 to -25 C band; the "
                "profile does not resolve those isotherms directly.",
)

T_UPDRAFT_FOR_CHARGE = Transfer(
    name="updraft_for_charge", feature="updraft_potential",
    unit="dimensionless", shape=Shape.LOGISTIC, low=0.2, high=0.7,
    reasoning="Electrification requires an updraught strong enough to loft "
              "supercooled water into the mixed-phase region and keep "
              "graupel and ice in relative motion. Weak updraughts glaciate "
              "quietly and do not electrify.",
    reference="Deierling & Petersen (2008), J. Geophys. Res. 113, D16210 "
              "(updraught volume and lightning)",
)

T_STORM_DEPTH_LIGHTNING = Transfer(
    name="storm_depth_lightning", feature="storm_depth", unit="m",
    shape=Shape.LOGISTIC, low=3000.0, high=8000.0,
    reasoning="Cloud depth is the strongest single environmental "
              "discriminator between showers and thunderstorms over the UK. "
              "Shallow convection, however vigorous, rarely produces "
              "lightning.",
    reference="Met Office ATDnet climatology; Price & Rind (1992), J. "
              "Geophys. Res. 97, 9919-9933 (cloud-top height and flash rate)",
)


class LightningEngine(HazardEngine):
    """Estimates lightning likelihood given a convective environment.

    SCIENTIFIC AUDIT. **Question:** will convection here be electrically
    active, as distinct from merely present? **Mechanism:** non-inductive
    charge separation needs a deep mixed-phase layer and an updraught strong
    enough to maintain graupel/ice separation, so the ingredients are cold
    cloud depth, updraught potential and total storm depth -- NOT CAPE, which
    enters only through the updraught engine. **Limitations:** environmental,
    not a flash-rate model; the profile does not resolve the -10 to -25 C
    band directly. **Data:** needs a freezing level and an EL. **Uncertainty:**
    inherits the updraught engine's, plus profile resolution. **Validation:**
    against ATDnet strikes within a radius and time window of the forecast
    point.
    """

    name = "lightning"
    version = "1.0"
    question = (
        "Will convection here be electrically active? Not the same as "
        "whether convection occurs."
    )
    consumes_diagnostics = (
        "cold_cloud_depth", "freezing_level", "el", "lfc", "cloud_depth",
    )
    consumes_engines = ("updraft", "convective_initiation")

    def ingredients(self, context, features):
        updraft = context.result("updraft")
        updraft_score = (
            updraft.score if updraft is not None and updraft.status.has_score
            else None
        )
        return [
            Factor(T_MIXED_PHASE_DEPTH, features.get("cold_cloud_depth")),
            Factor(T_UPDRAFT_FOR_CHARGE, updraft_score),
            Factor(T_STORM_DEPTH_LIGHTNING, features.get("storm_depth")),
        ]

    def hazard_explanation(self, composition, features, context):
        out = []
        cold = features.get("cold_cloud_depth")
        if cold is not None:
            if cold < 1000:
                out.append(
                    f"only {cold:.0f} m of cloud above the freezing level: "
                    f"too little mixed-phase depth to electrify reliably"
                )
            else:
                out.append(
                    f"{cold:.0f} m of glaciated cloud supports charge "
                    f"separation"
                )
        limiting = composition.limiting
        if limiting is not None and limiting.membership < 0.4:
            out.append(f"limited by {limiting.transfer.feature}")
        return out

    def hazard_extra(self, composition, features, context):
        return {
            "cold_cloud_depth_m": features.get("cold_cloud_depth"),
            "freezing_level_m": features.get("freezing_level"),
        }


# ===========================================================================
# Hail
# ===========================================================================

T_HAIL_GROWTH_DEPTH = Transfer(
    name="hail_growth_depth", feature="cold_cloud_depth", unit="m",
    shape=Shape.LOGISTIC, low=1500.0, high=5000.0,
    reasoning="Hail grows by accretion of supercooled water in the cloud "
              "above the freezing level. A deep glaciated layer gives a long "
              "growth path; a shallow one cannot produce stones that survive "
              "the fall.",
    reference="Browning (1977), in Hail: A Review; Nelson (1983), J. Atmos. "
              "Sci. 40, 1965-1983",
)

T_WBZ_SURVIVAL = Transfer(
    name="wet_bulb_zero_survival", feature="wet_bulb_zero", unit="m",
    shape=Shape.BAND, low=1500.0, high=3200.0, margin=1200.0,
    margin_low=1000.0,
    reasoning="A BAND, not a ramp. Too high a wet-bulb zero and hail melts "
              "during a long warm descent; too low and the storm has too "
              "little warm cloud to grow large stones in the first place. "
              "Operational hail forecasting has used a wet-bulb zero window "
              "of roughly 1.5-3.2 km for decades.",
    reference="Miller (1972), AWS TR 200; Edwards & Thompson (1998), Wea. "
              "Forecasting 13, 277-285",
    limitations="Derived from US practice; the UK window may differ and this "
                "is a candidate for regional retuning once verification "
                "data exist.",
)

T_UPDRAFT_FOR_HAIL = Transfer(
    name="updraft_for_hail", feature="updraft_potential",
    unit="dimensionless", shape=Shape.LOGISTIC, low=0.3, high=0.8,
    reasoning="Stone size is limited by the updraught that can suspend it. "
              "Hail growth requires an updraught able to hold a stone in the "
              "growth region long enough to accrete.",
    reference="Nelson (1983); Browning (1977)",
)

T_MID_LAPSE_HAIL = Transfer(
    name="mid_lapse_hail", feature="lr_700_500", unit="K/km",
    shape=Shape.LOGISTIC, low=6.0, high=7.5,
    reasoning="Steep mid-level lapse rates place more of the buoyancy in the "
              "hail growth layer and increase the supercooled water content "
              "available for accretion.",
    reference="Johnson & Sugden (2014), E-J. Severe Storms Meteor. 9, 1-42",
)

T_ORGANISATION_FOR_HAIL = Transfer(
    name="organisation_for_hail", feature="supercell_affinity",
    unit="dimensionless", shape=Shape.RAMP, low=0.15, high=0.75,
    reasoning="Organised and especially rotating storms sustain updraughts "
              "long enough for repeated growth cycles, which is what "
              "separates ordinary hail from significant hail.",
    reference="Blair et al. (2011), Wea. Forecasting 26, 908-917",
)


T_MULTICELL_FOR_HAIL = Transfer(
    name="multicell_for_hail", feature="organised_multicell_affinity",
    unit="dimensionless", shape=Shape.RAMP, low=0.35, high=0.95,
    reasoning="Organised multicell systems can sustain hail growth, but less "
              "reliably than supercells: new cells replace old ones rather "
              "than one updraught persisting, so a given affinity indicates "
              "weaker support. The anchors sit HIGHER than the supercell "
              "transfer's for exactly that reason -- the difference in "
              "support is expressed as a difference in anchors, which is "
              "auditable, rather than as a bare multiplier, which is not.",
    reference="Blair et al. (2011), Wea. Forecasting 26, 908-917",
)

T_SUSTAINED_ORGANISATION = pass_through(
    "sustained_updraft_organisation",
    note="the stronger of the supercell and organised-multicell indications "
         "of a sustained updraught, each on its own documented scale.",
    reference="Blair et al. (2011)",
)


class HailEngine(HazardEngine):
    """Estimates hail likelihood, and significant hail separately.

    SCIENTIFIC AUDIT. **Question:** will convection here produce hail at the
    surface, and could it be large? **Mechanism:** growth by accretion above
    the freezing level, survival governed by the wet-bulb-zero height, size
    limited by updraught strength and by how long an organised storm sustains
    it. **Limitations:** no explicit hail growth trajectory model; the
    wet-bulb-zero window is inherited from US operational practice and needs
    UK verification. **Data:** freezing level, wet-bulb zero, EL.
    **Uncertainty:** high -- hail is among the least well predicted
    convective hazards from environment alone. **Validation:** against
    reports and radar-derived hail signatures, separately for any hail and
    for significant hail.
    """

    name = "hail"
    version = "1.0"
    question = "Will convection here produce hail at the surface?"
    consumes_diagnostics = (
        "cold_cloud_depth", "wet_bulb_zero", "freezing_level", "lr_700_500",
        "el",
    )
    consumes_engines = ("updraft", "storm_organisation",
                        "convective_initiation")

    def ingredients(self, context, features):
        updraft = context.result("updraft")
        updraft_score = (
            updraft.score if updraft is not None and updraft.status.has_score
            else None
        )
        return [
            Factor(T_HAIL_GROWTH_DEPTH, features.get("cold_cloud_depth")),
            Factor(T_WBZ_SURVIVAL, features.get("wet_bulb_zero")),
            Factor(T_UPDRAFT_FOR_HAIL, updraft_score),
            Factor(T_MID_LAPSE_HAIL, features.get("lr_700_500")),
        ]

    def hazard_extra(self, composition, features, context):
        """Significant hail as a SEPARATE conditional, not a rescaling.

        Large hail needs everything ordinary hail needs plus a sustained,
        organised updraught. It is therefore computed with its own ingredient
        list rather than by multiplying the hail score by a constant, which
        would make significant hail a fixed fraction of hail everywhere and
        would say nothing about organisation.
        """
        organisation = context.result("storm_organisation")
        organisation_factor = None
        if organisation is not None and organisation.status.has_score:
            # An earlier version wrote max(supercell, multicell * 0.6),
            # asserting without justification that organised multicell counts
            # 60% as much. The claim is real -- a multicell sustains an
            # updraught less reliably than a supercell -- but it belongs in
            # the ANCHORS of a documented transfer, not in a bare
            # coefficient. Two transfers on separate scales, combined by
            # DOMINANT, say the same thing auditably.
            organisation_factor = compose(Rule.DOMINANT, [
                Factor(T_ORGANISATION_FOR_HAIL,
                       organisation.classes.get("supercell_favourable")),
                Factor(T_MULTICELL_FOR_HAIL,
                       organisation.classes.get("organised_multicell")),
            ], minimum_factors=1)
        supercell = (
            organisation_factor.value if organisation_factor else None
        )
        updraft = context.result("updraft")
        updraft_score = (
            updraft.score if updraft is not None and updraft.status.has_score
            else None
        )

        significant = compose(Rule.INGREDIENTS, [
            Factor(T_HAIL_GROWTH_DEPTH, features.get("cold_cloud_depth")),
            Factor(T_UPDRAFT_FOR_HAIL, updraft_score),
            Factor(T_SUSTAINED_ORGANISATION, None, membership=supercell)
            if supercell is not None
            else Factor(T_SUSTAINED_ORGANISATION, None),
            Factor(T_WBZ_SURVIVAL, features.get("wet_bulb_zero")),
        ], minimum_factors=3)

        return {
            "significant_hail": {
                "conditional_score": (
                    round(significant.value, 4) if significant else None
                ),
                "available": significant is not None,
                "reason": (
                    None if significant else
                    "needs at least three of: glaciated depth, updraught "
                    "potential, organisation affinity, wet-bulb zero"
                ),
                "note": (
                    "computed from its OWN ingredients, including storm "
                    "organisation, rather than as a fixed fraction of the "
                    "hail score"
                ),
                "missing": list(significant.missing) if significant else [],
            },
            "wet_bulb_zero_m": features.get("wet_bulb_zero"),
            "freezing_level_m": features.get("freezing_level"),
            "cold_cloud_depth_m": features.get("cold_cloud_depth"),
        }

    def hazard_explanation(self, composition, features, context):
        out = []
        wbz = features.get("wet_bulb_zero")
        if wbz is not None:
            if wbz > 3200:
                out.append(
                    f"wet-bulb zero at {wbz:.0f} m is high: stones face a "
                    f"long warm descent and are likely to melt"
                )
            elif wbz < 1500:
                out.append(
                    f"wet-bulb zero at {wbz:.0f} m is low: little warm cloud "
                    f"in which to grow large stones"
                )
            else:
                out.append(
                    f"wet-bulb zero at {wbz:.0f} m is within the window that "
                    f"favours hail reaching the surface"
                )
        return out


# ===========================================================================
# Severe wind
# ===========================================================================

T_DCAPE_WIND = Transfer(
    name="dcape_wind", feature="dcape", unit="J/kg",
    shape=Shape.LOGISTIC, low=300.0, high=900.0,
    reasoning="Downdraught CAPE measures the energy available to accelerate "
              "a saturated downdraught to the surface. 900 J/kg is a "
              "strongly favourable value for damaging outflow.",
    reference="Emanuel (1994), Atmospheric Convection; Gilmore & Wicker "
              "(1998)",
    limitations="Assumes a saturated descent, so it is an upper bound; "
                "Stage 4 flags this on the DCAPE itself.",
)

T_DEEP_FLOW_MOMENTUM = Transfer(
    name="deep_flow_momentum", feature="shear_0_6km", unit="m/s",
    shape=Shape.LOGISTIC, low=12.0, high=25.0,
    reasoning="Strong flow through the storm depth provides momentum for a "
              "downdraught to transport to the surface. This is the "
              "momentum-transfer mechanism, physically distinct from "
              "evaporative cooling.",
    reference="Johns & Doswell (1992), Wea. Forecasting 7, 588-612",
    limitations="Shear is used as a proxy for the deep-layer wind speed "
                "itself, which the column carries but which is not currently "
                "exposed as a single feature.",
)

T_LOW_LAPSE_WIND = Transfer(
    name="low_lapse_wind", feature="lr_0_3km", unit="K/km",
    shape=Shape.LOGISTIC, low=6.5, high=8.5,
    reasoning="Steep low-level lapse rates let a descending parcel remain "
              "negatively buoyant all the way down, which is what allows "
              "downdraught momentum to reach the surface rather than being "
              "arrested aloft.",
    reference="Wakimoto (1985), Mon. Wea. Rev. 113, 1131-1143",
)

T_ORGANISATION_FOR_WIND = Transfer(
    name="organisation_for_wind", feature="linear_affinity",
    unit="dimensionless", shape=Shape.RAMP, low=0.2, high=0.75,
    reasoning="Linear and organised multicell systems produce the strongest "
              "and most widespread convective wind damage, through merged "
              "cold pools and a sustained rear-inflow jet. Isolated pulse "
              "cells produce brief, localised gusts.",
    reference="Johns & Doswell (1992); Rotunno, Klemp & Weisman (1988)",
)


T_EVAPORATIVE_MECHANISM = pass_through(
    "evaporative_downdraft_mechanism",
    note="composed from DCAPE and the low-level lapse rate.",
    reference="Wakimoto (1985), Mon. Wea. Rev. 113, 1131-1143",
)

T_MOMENTUM_MECHANISM = pass_through(
    "momentum_transfer_mechanism",
    note="composed from deep-layer flow and organisational mode.",
    reference="Johns & Doswell (1992), Wea. Forecasting 7, 588-612",
)


class SevereWindEngine(HazardEngine):
    """Estimates damaging convective surface wind, by mechanism.

    SCIENTIFIC AUDIT. **Question:** will convection here produce damaging
    surface wind? **Mechanism:** two physically distinct routes are scored
    separately -- evaporatively driven downdraughts (DCAPE, dry sub-cloud
    air, steep low-level lapse rates) and momentum transfer from strong
    deep-layer flow -- then combined as ALTERNATIVES, because either alone
    suffices. This is why the engine is not simply proportional to shear.
    **Limitations:** no cold-pool model, no explicit gust parametrisation.
    **Data:** DCAPE and a hodograph. **Uncertainty:** high; the mechanisms
    have different predictability. **Validation:** against observed gusts
    attributable to convection, ideally separated by mechanism.
    """

    name = "severe_wind"
    version = "1.0"
    #: The two MECHANISMS are genuinely independent physical routes, so
    #: noisy-OR is right for combining them. Their INPUTS are not
    #: independent, so each mechanism is composed from its own ingredients
    #: FIRST and only the two mechanism scores meet the noisy-OR. Passing
    #: four correlated inputs straight to noisy-OR saturated the result at
    #: 1.000 on ordinary profiles.
    rule = Rule.ALTERNATIVES
    minimum_factors = 1
    question = "Will convection here produce damaging surface wind?"
    consumes_diagnostics = ("dcape", "lr_0_3km", "shear_0_6km",
                            "entrainment_indicators")
    consumes_engines = ("storm_organisation", "convective_initiation",
                        "entrainment")

    def _mechanisms(self, context, features):
        """Each mechanism composed from its own ingredients."""
        organisation = context.result("storm_organisation")
        linear = None
        if organisation is not None and organisation.status.has_score:
            linear = max(
                organisation.classes.get("linear_qlcs", 0.0),
                organisation.classes.get("organised_multicell", 0.0),
            )
        evaporative = compose(Rule.INGREDIENTS, [
            Factor(T_DCAPE_WIND, features.get("dcape")),
            Factor(T_LOW_LAPSE_WIND, features.get("lr_0_3km")),
        ], minimum_factors=1)
        momentum = compose(Rule.INGREDIENTS, [
            Factor(T_DEEP_FLOW_MOMENTUM, features.get("shear_0_6km")),
            Factor(T_ORGANISATION_FOR_WIND, linear),
        ], minimum_factors=1)
        return evaporative, momentum

    def ingredients(self, context, features):
        evaporative, momentum = self._mechanisms(context, features)
        factors = []
        if evaporative is not None:
            factors.append(Factor(
                T_EVAPORATIVE_MECHANISM, None, membership=evaporative.value
            ))
        if momentum is not None:
            factors.append(Factor(
                T_MOMENTUM_MECHANISM, None, membership=momentum.value
            ))
        return factors

    def hazard_extra(self, composition, features, context):
        """The two mechanisms, scored separately.

        Reported apart because they have different predictability and
        different mitigations, and because a single number cannot say whether
        the threat is a brief wet microburst or a sustained squall line.
        """
        evaporative, momentum = self._mechanisms(context, features)
        return {
            "mechanisms": {
                "evaporative_downdraft": (
                    round(evaporative.value, 4) if evaporative else None
                ),
                "momentum_transfer": (
                    round(momentum.value, 4) if momentum else None
                ),
            },
            "mechanism_note": (
                "scored separately and combined as ALTERNATIVES: either "
                "mechanism alone can produce damaging wind, so the engine is "
                "deliberately NOT proportional to shear"
            ),
            "dcape_j_kg": features.get("dcape"),
        }

    def hazard_explanation(self, composition, features, context):
        driver = max(
            (f for f in composition.factors), key=lambda f: f.membership,
            default=None,
        )
        if driver is None:
            return []
        return [
            f"strongest contributor: {driver.transfer.feature}"
            + (f" ({driver.value:.0f} {driver.transfer.unit})"
               if driver.value is not None else "")
        ]


# ===========================================================================
# Downburst
# ===========================================================================

T_DCAPE_DOWNBURST = Transfer(
    name="dcape_downburst", feature="dcape", unit="J/kg",
    shape=Shape.LOGISTIC, low=350.0, high=1000.0,
    reasoning="The energy available to a descending saturated parcel. Higher "
              "anchors than the severe-wind engine uses, because a downburst "
              "is specifically the concentrated, evaporatively driven case "
              "rather than any damaging wind.",
    reference="Emanuel (1994); Wakimoto (1985), Mon. Wea. Rev. 113, 1131-1143",
)

T_SUBCLOUD_DRYNESS = Transfer(
    name="subcloud_dryness", feature="low_level_rh", unit="%",
    shape=Shape.INVERSE_LOGISTIC, low=40.0, high=75.0,
    reasoning="Evaporation into a dry sub-cloud layer is what drives a "
              "downburst. A saturated sub-cloud layer cannot cool the "
              "descending air however much precipitation falls through it.",
    reference="Wakimoto (1985); Srivastava (1985), J. Atmos. Sci. 42, "
              "1004-1023",
)

T_DEEP_SUBCLOUD = Transfer(
    name="deep_subcloud_layer", feature="sub_cloud_depth", unit="m",
    shape=Shape.LOGISTIC, low=800.0, high=2500.0,
    reasoning="A deep sub-cloud layer gives a long path over which "
              "evaporation can cool the descending parcel and accelerate it. "
              "High cloud bases are a classic dry-microburst signature.",
    reference="Wakimoto (1985); Srivastava (1985)",
)


class DownburstEngine(HazardEngine):
    """Estimates concentrated downburst potential.

    SCIENTIFIC AUDIT. **Question:** will a concentrated, evaporatively driven
    downdraught reach the surface? Deliberately separate from the broader
    severe-wind engine, which also covers momentum transfer. **Mechanism:**
    precipitation falling into a deep dry sub-cloud layer evaporates, cooling
    the parcel and accelerating it downward; requires DCAPE, sub-cloud
    dryness and sub-cloud depth TOGETHER, hence INGREDIENTS rather than
    ALTERNATIVES. **Limitations:** no precipitation loading term, because the
    profile carries no hydrometeor flux; DCAPE assumes a saturated descent
    and is an upper bound. **Data:** DCAPE, low-level humidity, LCL.
    **Uncertainty:** high; reported explicitly when precipitation information
    is absent. **Validation:** against observed downburst events and radar
    divergence signatures.
    """

    name = "downburst"
    version = "1.0"
    minimum_factors = 2
    question = (
        "Will a concentrated, evaporatively driven downdraught reach the "
        "surface? Distinct from severe wind generally."
    )
    consumes_diagnostics = ("dcape", "lcl", "entrainment_indicators",
                            "lr_0_3km")
    consumes_engines = ("convective_initiation",)

    def ingredients(self, context, features):
        return [
            Factor(T_DCAPE_DOWNBURST, features.get("dcape")),
            Factor(T_SUBCLOUD_DRYNESS, features.get("low_level_rh")),
            Factor(T_DEEP_SUBCLOUD, features.get("sub_cloud_depth")),
            Factor(T_LOW_LAPSE_WIND, features.get("lr_0_3km")),
        ]

    def hazard_extra(self, composition, features, context):
        return {
            "precipitation_loading": {
                "available": False,
                "reason": (
                    "the profile carries no hydrometeor flux, so the "
                    "precipitation-loading contribution to downdraught "
                    "acceleration cannot be assessed. This engine therefore "
                    "covers the evaporative mechanism only"
                ),
            },
            "sub_cloud_depth_m": features.get("sub_cloud_depth"),
            "low_level_rh_percent": features.get("low_level_rh"),
            "dcape_j_kg": features.get("dcape"),
        }

    def hazard_explanation(self, composition, features, context):
        out = []
        rh = features.get("low_level_rh")
        depth = features.get("sub_cloud_depth")
        if rh is not None and depth is not None:
            if rh < 55 and depth > 1200:
                out.append(
                    f"a deep ({depth:.0f} m) and dry ({rh:.0f}%) sub-cloud "
                    f"layer strongly favours evaporative acceleration"
                )
            elif rh > 80:
                out.append(
                    f"the sub-cloud layer is nearly saturated ({rh:.0f}%), so "
                    f"evaporative cooling is limited whatever the DCAPE"
                )
        return out


# ===========================================================================
# Tornado environment
# ===========================================================================

T_LOW_LEVEL_SHEAR_TOR = Transfer(
    name="low_level_shear_tornado", feature="shear_0_1km", unit="m/s",
    shape=Shape.LOGISTIC, low=6.0, high=15.0,
    reasoning="0-1 km bulk shear is among the most robust environmental "
              "discriminators for tornadic against non-tornadic supercells; "
              "around 10 m/s marks a substantial increase in likelihood.",
    reference="Thompson et al. (2003), Wea. Forecasting 18, 1243-1261; "
              "Craven & Brooks (2004), Natl. Wea. Dig. 28, 13-24",
)

T_SRH_LOW_TOR = Transfer(
    name="srh_low_tornado", feature="srh_0_1km", unit="m2/s2",
    shape=Shape.LOGISTIC, low=50.0, high=150.0,
    reasoning="Low-level storm-relative helicity supplies the streamwise "
              "vorticity a storm tilts and stretches into a low-level "
              "mesocyclone. The 0-1 km layer discriminates better than the "
              "0-3 km layer for tornadoes specifically.",
    reference="Thompson et al. (2003); Markowski & Richardson (2010)",
)

T_LCL_TORNADO = Transfer(
    name="lcl_tornado", feature="lcl", unit="m",
    shape=Shape.INVERSE_LOGISTIC, low=800.0, high=1800.0,
    reasoning="A low cloud base means a moist boundary layer and less "
              "evaporative chilling of the rear-flank downdraught, which "
              "favours tornadogenesis. Tornadic supercells cluster at "
              "markedly lower LCLs than non-tornadic ones.",
    reference="Rasmussen & Blanchard (1998), Wea. Forecasting 13, 1148-1164; "
              "Craven et al. (2002)",
)

T_SUPERCELL_FOR_TORNADO = Transfer(
    name="supercell_for_tornado", feature="supercell_affinity",
    unit="dimensionless", shape=Shape.RAMP, low=0.15, high=0.7,
    reasoning="Most significant tornadoes come from supercells, so the "
              "organisation engine's supercell affinity is a required "
              "ingredient. UK tornadoes also occur along non-supercellular "
              "convergence lines, which this engine cannot see and which is "
              "stated as a limitation rather than approximated.",
    reference="Thompson et al. (2003); Mulder & Schultz (2015), Mon. Wea. "
              "Rev. 143, 2224-2240 (UK tornado climatology)",
)


class TornadoEnvironmentEngine(HazardEngine):
    """Estimates environmental favourability for tornadic convection.

    SCIENTIFIC AUDIT. **Question:** does the environment support
    tornado-producing convection? The output names an ENVIRONMENT, never an
    occurrence -- tornadogenesis depends on storm-scale processes no
    environmental diagnostic resolves. **Mechanism:** low-level shear and
    helicity supply vorticity, a low LCL limits downdraught chilling, and
    supercell organisation supplies the updraught to stretch it.
    **Limitations:** a large share of UK tornadoes form along
    non-supercellular convergence lines and in QLCS circulations, which a
    single column cannot see; this engine will systematically miss them.
    **Data:** hodograph to at least 1 km, LCL, organisation engine.
    **Uncertainty:** the highest of any engine here. **Validation:** against
    the TORRO database, as environmental favourability and never as
    occurrence probability.
    """

    name = "tornado_environment"
    version = "1.0"
    score_kind = ScoreKind.POTENTIAL
    question = (
        "Does the environment support tornadic convection? Favourability, "
        "explicitly not occurrence."
    )
    consumes_diagnostics = (
        "shear_0_1km", "srh_0_1km", "effective_srh", "lcl", "mlcape",
        "boundary_layer_moisture",
    )
    consumes_engines = ("storm_organisation", "convective_initiation")

    def ingredients(self, context, features):
        organisation = context.result("storm_organisation")
        supercell = None
        if organisation is not None and organisation.status.has_score:
            supercell = organisation.classes.get("supercell_favourable")
        return [
            Factor(T_LOW_LEVEL_SHEAR_TOR, features.get("shear_0_1km")),
            Factor(T_SRH_LOW_TOR, features.get("srh_0_1km")),
            Factor(T_LCL_TORNADO, features.get("lcl")),
            Factor(T_SUPERCELL_FOR_TORNADO, supercell),
        ]

    def hazard_extra(self, composition, features, context):
        return {
            "output_means": (
                "environmental favourability for tornado-supportive "
                "convection. NOT a probability that a tornado occurs"
            ),
            "known_blind_spot": (
                "non-supercellular tornadoes along convergence lines and "
                "within QLCS circulations account for a large share of UK "
                "events and are invisible to a single-column evaluation"
            ),
            "lcl_m": features.get("lcl"),
            "srh_0_1km": features.get("srh_0_1km"),
        }

    def hazard_explanation(self, composition, features, context):
        out = ["environmental favourability only, not an occurrence forecast"]
        lcl = features.get("lcl")
        if lcl is not None and lcl > 1800:
            out.append(
                f"a high cloud base ({lcl:.0f} m) argues against "
                f"tornadogenesis even where shear is favourable"
            )
        return out


# ===========================================================================
# Heavy convective rainfall
# ===========================================================================

T_PW_RAIN = Transfer(
    name="pw_rain", feature="precipitable_water", unit="kg/m2",
    shape=Shape.LOGISTIC, low=18.0, high=34.0,
    reasoning="Column moisture sets the reservoir available to rain out. "
              "Above about 30 mm over the UK is a notably moist airmass and "
              "accompanies most flash-flood events.",
    reference="Doswell et al. (1996), Wea. Forecasting 11, 560-581 (flash "
              "flood ingredients); UK radiosonde climatology",
)

T_WARM_CLOUD_RAIN = Transfer(
    name="warm_cloud_rain", feature="warm_cloud_depth", unit="m",
    shape=Shape.LOGISTIC, low=1500.0, high=3500.0,
    reasoning="A deep warm cloud layer raises precipitation efficiency: "
              "collision-coalescence produces rain that falls without the "
              "losses of the ice phase. This is the single most useful "
              "environmental discriminator for high rainfall rates.",
    reference="Doswell et al. (1996); Market et al. (2003), Wea. Forecasting "
              "18, 1041-1050",
)

T_SLOW_STORM_MOTION = Transfer(
    name="slow_storm_motion", feature="storm_motion_speed", unit="m/s",
    shape=Shape.INVERSE_LOGISTIC, low=6.0, high=18.0,
    reasoning="Rainfall total at a point is rate multiplied by duration, and "
              "duration is governed by how fast the storm moves. A slow or "
              "near-stationary cell produces far more accumulation than an "
              "intense fast-moving one -- which is why total model "
              "precipitation alone is a poor guide.",
    reference="Doswell et al. (1996); Chappell (1986), in Mesoscale "
              "Meteorology and Forecasting",
)

T_INFLOW_MOISTURE = Transfer(
    name="inflow_moisture", feature="boundary_layer_mixing_ratio",
    unit="g/kg", shape=Shape.LOGISTIC, low=7.0, high=13.0,
    reasoning="Boundary-layer mixing ratio sets how much water the inflow "
              "delivers to the updraught per unit mass, and therefore the "
              "rainfall rate a given updraught can sustain.",
    reference="Doswell et al. (1996)",
)


class HeavyRainEngine(HazardEngine):
    """Estimates intense convective rainfall potential.

    SCIENTIFIC AUDIT. **Question:** will convection here produce
    high-intensity rainfall? **Mechanism:** the ingredients framework of
    Doswell et al. (1996) -- rainfall equals rate times duration. Rate comes
    from column moisture, inflow moisture and warm-cloud depth (precipitation
    efficiency); duration comes from storm motion. **Why not model
    precipitation:** total modelled rainfall is a poor guide because it
    smooths over the slow-moving and training cells that cause flooding, and
    convective-scale placement is not skilful at forecast range.
    **Limitations:** training and cell repetition require a boundary and a
    time sequence and are NOT assessed -- reported as a known gap rather than
    approximated. **Data:** PW, warm-cloud depth, storm motion.
    **Uncertainty:** high for accumulation, moderate for rate.
    **Validation:** against radar-gauge rainfall analyses at sub-hourly
    resolution.
    """

    name = "heavy_rainfall"
    version = "1.0"
    question = (
        "Will convection here produce high-intensity rainfall? Rate and "
        "duration, not modelled precipitation totals."
    )
    consumes_diagnostics = (
        "precipitable_water", "warm_cloud_depth", "boundary_layer_moisture",
        "storm_relative_flow", "lcl", "freezing_level",
    )
    consumes_engines = ("updraft", "convective_initiation")

    def ingredients(self, context, features):
        motion_speed = None
        motion = context.parameters.get("storm_motion_right")
        if motion.status.has_value:
            motion_speed = motion.extra.get("speed_m_s")
        return [
            Factor(T_PW_RAIN, features.get("precipitable_water")),
            Factor(T_WARM_CLOUD_RAIN, features.get("warm_cloud_depth")),
            Factor(T_INFLOW_MOISTURE,
                   features.get("boundary_layer_mixing_ratio")),
            Factor(T_SLOW_STORM_MOTION, motion_speed),
        ]

    def hazard_extra(self, composition, features, context):
        motion = context.parameters.get("storm_motion_right")
        speed = motion.extra.get("speed_m_s") if motion.status.has_value \
            else None
        return {
            "storm_motion_speed_m_s": speed,
            "warm_cloud_depth_m": features.get("warm_cloud_depth"),
            "precipitable_water_kg_m2": features.get("precipitable_water"),
            "training_potential": {
                "available": False,
                "reason": (
                    "training and cell repetition need a forcing boundary and "
                    "a sequence of lead times; neither is available to a "
                    "single-column, single-time evaluation. This is a known "
                    "gap, not an approximation"
                ),
            },
            "note": (
                "assesses rainfall RATE and duration from ingredients, not "
                "modelled precipitation totals, which smooth over the "
                "slow-moving cells that cause flooding"
            ),
        }

    def hazard_explanation(self, composition, features, context):
        out = []
        warm = features.get("warm_cloud_depth")
        if warm is not None and warm > 2500:
            out.append(
                f"a deep warm cloud layer ({warm:.0f} m) gives high "
                f"precipitation efficiency"
            )
        motion = context.parameters.get("storm_motion_right")
        if motion.status.has_value:
            speed = motion.extra.get("speed_m_s")
            if speed is not None and speed < 7:
                out.append(
                    f"slow estimated storm motion ({speed:.1f} m/s) favours "
                    f"high accumulations at a point"
                )
        return out


ENGINE_LIGHTNING = register(LightningEngine())
ENGINE_HAIL = register(HailEngine())
ENGINE_SEVERE_WIND = register(SevereWindEngine())
ENGINE_DOWNBURST = register(DownburstEngine())
ENGINE_TORNADO = register(TornadoEnvironmentEngine())
ENGINE_HEAVY_RAIN = register(HeavyRainEngine())
