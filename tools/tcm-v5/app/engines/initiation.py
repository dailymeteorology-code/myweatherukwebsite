"""Convective Initiation Engine.

SCIENTIFIC AUDIT (section 59)
=============================

**Physical question.** Will convection actually START here, at this time?
Not "is the atmosphere unstable" -- the distinction this engine exists to
enforce. Most of the CAPE that appears over Britain in a summer never
produces a storm, because nothing lifts a parcel to its LFC.

**Inputs.** Instability and inhibition for the representative parcel, the LCL
relative to the boundary-layer top, boundary-layer moisture, local solar hour
as a heating proxy, terrain elevation, and -- where a gridded evaluation
supplies them -- convergence, vertical velocity and frontogenesis.

**Mechanism.** Initiation needs a parcel to reach its LFC. That requires ALL
of: something to lift (forcing), instability once lifted, a cap that can be
overcome, and a cloud base thermals can actually reach. These are combined as
INGREDIENTS -- a geometric mean, in which any one going to zero takes the
result to zero -- because they are not substitutes for one another. No amount
of instability lifts a parcel.

**The forcing problem, stated plainly.** Convergence, vertical velocity and
frontogenesis are horizontal-field quantities. A single-column evaluation
cannot see them, and this engine will not pretend otherwise. With no forcing
information it:

  * excludes forcing from the composition rather than assuming a neutral
    value, which would be an assumption that average lift is present
  * caps the score at `NO_FORCING_CEILING`, because the strongest statement
    defensible without knowing whether anything is lifting is "the
    environment could support initiation if something triggers it"
  * reports LOW_CONFIDENCE and says exactly why

This is the direct implementation of the brief's rule that a high-CAPE,
zero-forcing environment must not produce a near-certain initiation forecast.

**Limitations.** Mesoscale boundaries -- sea breezes, outflow, convergence
lines -- initiate a large share of UK convection and are invisible to a
column. Terrain enters only as elevation, not as upslope flow, because that
needs wind direction relative to a slope. The engine will systematically miss
boundary-forced initiation and says so.

**Data requirements.** Thermodynamic profile with humidity for the capability
part; a gridded evaluation with wind for the forcing part.

**Uncertainty.** Dominated by forcing availability. Also rises when the cap
is near the threshold where heating could plausibly break it, since a small
temperature error then flips the answer.

**Validation.** Against observed initiation from radar first echo and
lightning first strike, with the forecast valid time matched to observation
time. The target must be initiation, NOT lightning occurrence later in the
day, or the engine learns storm maturity instead.
"""
from __future__ import annotations

from .base import Engine, EngineContext, register
from .result import Contribution, EngineResult, EngineStatus, ScoreKind
from .transfer import Factor, Rule, Shape, Transfer, compose, pass_through

T_INSTABILITY_PRESENT = Transfer(
    name="instability_present", feature="mucape", unit="J/kg",
    shape=Shape.LOGISTIC, low=50.0, high=600.0,
    reasoning="Enough buoyancy that a lifted parcel keeps rising. The "
              "anchors are deliberately LOW: initiation needs only that "
              "convection can begin, not that it becomes severe. 50 J/kg "
              "supports shallow convection; by 600 J/kg instability has "
              "stopped being the limiting factor.",
    reference="Met Office operational practice; UK shower climatology",
    limitations="Says nothing about depth or intensity -- those are the "
                "thermodynamic and updraught engines' questions.",
)

T_CAP_BREAKABLE = Transfer(
    name="cap_breakable", feature="sbcin", unit="J/kg",
    shape=Shape.INVERSE_LOGISTIC, low=-15.0, high=-100.0,
    reasoning="Whether surface heating can plausibly erode the inhibition. "
              "Up to about -25 J/kg an ordinary afternoon removes the cap; "
              "beyond about -100 J/kg it survives the day unless strong "
              "mesoscale lift intervenes.",
    reference="Colby (1984), Mon. Wea. Rev. 112, 2239-2252",
    limitations="A static view of a dynamic process. Proper treatment needs "
                "CIN at successive times, which `cin_erosion` reports when "
                "two lead times are supplied.",
)

T_CLOUD_BASE_REACHABLE = Transfer(
    name="cloud_base_reachable", feature="lcl_above_pbl", unit="m",
    shape=Shape.INVERSE_LOGISTIC, low=-300.0, high=500.0,
    reasoning="Surface thermals must reach saturation before losing buoyancy "
              "at the top of the mixed layer. An LCL well above the "
              "boundary-layer top means thermals top out dry -- fair-weather "
              "cumulus at best. This is among the commonest reasons a "
              "promising UK sounding produces nothing at all.",
    reference="Stull (1988), An Introduction to Boundary Layer Meteorology; "
              "standard mixed-layer reasoning",
)

T_BL_MOISTURE = Transfer(
    name="boundary_layer_moisture", feature="boundary_layer_mixing_ratio",
    unit="g/kg", shape=Shape.LOGISTIC, low=5.0, high=11.0,
    reasoning="Boundary-layer mixing ratio governs how much water is "
              "available to condense and how low the cloud base sits. Around "
              "5 g/kg is dry for a convective UK boundary layer; 11 g/kg is "
              "moist.",
    reference="UK summer boundary-layer climatology",
)

T_HEATING = Transfer(
    name="diurnal_heating", feature="local_solar_hour", unit="h",
    shape=Shape.BAND, low=12.0, high=17.0, margin=5.0, margin_low=6.0,
    reasoning="Surface heating is the default UK trigger, peaking in the "
              "hours after solar noon. A weak, wide prior deliberately: it "
              "must not gate out the strongly forced and elevated cases that "
              "initiate at any hour, so the margins are generous and this "
              "factor is marked not-required.",
    reference="Met Office ATDnet UK lightning diurnal climatology",
    limitations="Irrelevant for elevated and frontal initiation. Marked "
                "`required=False` so it can lower a score but never zero it.",
)

T_CONVERGENCE = Transfer(
    name="low_level_convergence", feature="convergence", unit="s-1",
    shape=Shape.LOGISTIC, low=1e-5, high=1e-4,
    reasoning="Low-level mass convergence lifts parcels directly. 1e-4 /s is "
              "strong mesoscale convergence, of the order found on sea-breeze "
              "fronts and well-defined convergence lines; 1e-5 /s is weak but "
              "detectable.",
    reference="Banacos & Schultz (2005), Wea. Forecasting 20, 351-366",
)

T_ELEVATION_TRIGGER = Transfer(
    name="terrain_trigger", feature="elevation", unit="m",
    shape=Shape.LOGISTIC, low=100.0, high=500.0,
    reasoning="Elevated terrain heats faster than the surrounding lowlands "
              "and forces mechanical ascent, making high ground a favoured "
              "initiation site over Britain.",
    reference="UK orographic convection studies",
    limitations="Elevation is not upslope flow. Without wind direction "
                "relative to the slope this is a weak proxy, so it is "
                "marked not-required.",
)


T_TRIGGER_PROXY = pass_through(
    "trigger_proxy",
    note="the stronger of the diurnal-heating and terrain proxies, used as "
         "the trigger ingredient only when no measured forcing exists.",
    reference="Met Office ATDnet diurnal climatology; UK orographic "
              "convection studies",
)


class InitiationEngine(Engine):
    """Estimates whether convection will actually begin.

    See the module docstring for the full scientific audit.
    """

    name = "convective_initiation"
    version = "1.0"
    score_kind = ScoreKind.UNCALIBRATED_PROBABILITY
    question = (
        "Will convection initiate here and now? Deliberately not "
        "'is the atmosphere unstable'."
    )
    consumes_diagnostics = (
        "mucape", "sbcape", "sbcin", "lcl", "pbl_depth",
        "boundary_layer_moisture", "convergence", "vertical_velocity",
        "frontogenesis",
    )
    consumes_engines = ("weather_regime", "thermodynamic")

    #: The most this engine will claim without any forcing information.
    #: Without knowing whether anything is lifting, the strongest defensible
    #: statement is "capable, given a trigger" -- not a confident forecast.
    NO_FORCING_CEILING = 0.45

    def evaluate(self, context: EngineContext) -> EngineResult:
        features = context.features.get("set")
        if features is None:
            return self._insufficient("no shared feature set was built")

        mucape = features.get("mucape")
        if mucape is None:
            return self._insufficient(
                "no CAPE for any parcel, so there is nothing to initiate",
                missing=("mucape",),
            )

        core = [
            Factor(T_INSTABILITY_PRESENT, mucape),
            Factor(T_CAP_BREAKABLE, features.get("sbcin")),
            Factor(T_CLOUD_BASE_REACHABLE, features.get("lcl_above_pbl")),
            Factor(T_BL_MOISTURE,
                   features.get("boundary_layer_mixing_ratio")),
        ]

        # -- forcing, or an honest absence -----------------------------------
        convergence = features.get("convergence")
        has_forcing = convergence is not None
        forcing_factors = []
        if has_forcing:
            forcing_factors.append(Factor(T_CONVERGENCE, convergence))

        # Weak, non-required contextual factors. They may lower a score but
        # must never drive it to zero, so they are composed separately and
        # applied as a soft modifier rather than as ingredients.
        context_factors = [
            Factor(T_HEATING, context.local_hour, required=False),
            Factor(T_ELEVATION_TRIGGER, features.get("elevation"),
                   required=False),
        ]

        # With no measured forcing, the diurnal and terrain proxies are the
        # only trigger evidence there is, so they enter the composition AS AN
        # INGREDIENT rather than scaling the result afterwards. An earlier
        # version multiplied the score by (0.4 + 0.6 * support), which is
        # precisely the kind of unexplained coefficient section 46 forbids:
        # nothing justified either number. As an ingredient the proxy is
        # treated like every other necessary condition, with no free
        # parameters at all.
        #
        # DOMINANT across the proxies, not noisy-OR: heating and terrain are
        # alternative expressions of "something is plausibly lifting here",
        # and the stronger one governs.
        support = compose(Rule.DOMINANT, context_factors, minimum_factors=1)
        trigger_factors = []
        if not has_forcing and support is not None:
            trigger_factors.append(Factor(
                T_TRIGGER_PROXY, None, membership=support.value
            ))

        composition = compose(
            Rule.INGREDIENTS,
            core + forcing_factors + trigger_factors,
            minimum_factors=2,
        )
        if composition is None:
            return self._insufficient(
                "fewer than two initiation ingredients could be evaluated",
                missing=features.missing(
                    "mucape", "sbcin", "lcl_above_pbl",
                    "boundary_layer_mixing_ratio",
                ),
            )

        score = composition.value

        flags: list[str] = []
        status = EngineStatus.AVAILABLE
        ceiling_applied = False

        if not has_forcing:
            ceiling_applied = score > self.NO_FORCING_CEILING
            score = min(score, self.NO_FORCING_CEILING)
            status = EngineStatus.LOW_CONFIDENCE
            flags.append(
                f"no forcing information: convergence, vertical velocity and "
                f"frontogenesis are horizontal-field quantities and this is a "
                f"point evaluation. The score is capped at "
                f"{self.NO_FORCING_CEILING} because without knowing whether "
                f"anything is lifting, the strongest defensible statement is "
                f"'capable given a trigger', not a forecast"
            )
            flags.append(
                "mesoscale boundaries (sea breezes, outflow, convergence "
                "lines) initiate much UK convection and are invisible here"
            )

        if composition.missing:
            status = EngineStatus.DEGRADED if status is EngineStatus.AVAILABLE \
                else status
            flags.append(f"missing: {', '.join(composition.missing)}")

        completeness = len(composition.factors) / len(
            core + forcing_factors + trigger_factors
        )
        cap_uncertainty = self._cap_sensitivity(features.get("sbcin"))
        confidence = round(
            completeness * (1.0 if has_forcing else 0.35), 3
        )
        uncertainty = round(
            min(1.0, 0.4 * (1.0 - completeness)
                + (0.0 if has_forcing else 0.5) + 0.3 * cap_uncertainty),
            3,
        )

        contributions = list(composition.contributions)
        for factor in context_factors:
            if factor.membership is not None:
                contributions.append(Contribution(
                    feature=factor.transfer.feature,
                    value=factor.value,
                    unit=factor.transfer.unit,
                    transformed=round(factor.membership, 4),
                    influence=0.0,
                    direction=("supporting" if factor.membership > 0.6
                               else "limiting" if factor.membership < 0.4
                               else "neutral"),
                    note="contextual trigger proxy; can lower the score but "
                         "never zero it",
                ))
        if not has_forcing:
            contributions.append(Contribution(
                feature="forcing", value=None, unit="s-1",
                transformed=None, influence=0.0, direction="limiting",
                note="unavailable: needs a gridded evaluation",
            ))

        return self._result(
            score=round(min(1.0, max(0.0, score)), 4),
            status=status,
            confidence=confidence,
            uncertainty=uncertainty,
            contributions=tuple(contributions),
            quality_flags=tuple(flags),
            explanation=tuple(self._explain(
                composition, features, has_forcing, ceiling_applied,
                context.local_hour,
            )),
            reason="; ".join(flags[:1]) if status is not EngineStatus.AVAILABLE
            else "",
            extra={
                "forcing_available": has_forcing,
                "ceiling_applied": ceiling_applied,
                "no_forcing_ceiling": self.NO_FORCING_CEILING,
                "capability_without_forcing": round(composition.value, 4),
                "capability_note": (
                    "what the thermodynamic and boundary-layer structure "
                    "would allow IF something lifted a parcel; not a forecast"
                ),
                "timing": self._timing(context, features),
                "local_solar_hour": context.local_hour,
            },
        )

    @staticmethod
    def _cap_sensitivity(cin: float | None) -> float:
        """How close the cap is to the value where a small error flips it.

        Around -50 J/kg a degree of surface temperature error decides whether
        the cap breaks, so the answer is least reliable there -- not at the
        extremes, where it is robust in both directions.
        """
        if cin is None:
            return 0.5
        distance = abs(abs(cin) - 50.0)
        return round(max(0.0, 1.0 - distance / 50.0), 3)

    def _timing(self, context: EngineContext, features) -> dict:
        """Initiation timing, where the data support it.

        A single lead time cannot give a window. Rather than inventing one
        from the diurnal cycle -- which would produce the same answer for a
        capped and an uncapped profile -- this reports what would be needed.
        """
        return {
            "available": False,
            "reason": (
                "timing needs CIN and boundary-layer temperature at "
                "successive lead times; this is a single-time evaluation"
            ),
            "requires": [
                "sbcin at two or more lead times",
                "boundary_layer_temperature at the same times",
                "forcing evolution",
            ],
            "current_cin_j_kg": features.get("sbcin"),
            "local_solar_hour": context.local_hour,
        }

    def _explain(self, composition, features, has_forcing, ceiling,
                 hour) -> list[str]:
        out: list[str] = []
        limiting = composition.limiting
        if limiting is not None and limiting.membership < 0.4:
            value = limiting.value
            out.append(
                f"limited by {limiting.transfer.feature}"
                + (f" ({value:.0f} {limiting.transfer.unit})"
                   if value is not None else "")
            )
        cin = features.get("sbcin")
        if cin is not None and cin < -75:
            out.append(
                f"a substantial cap ({cin:.0f} J/kg) must be removed before "
                f"surface parcels can rise"
            )
        gap = features.get("lcl_above_pbl")
        if gap is not None and gap > 300:
            out.append(
                f"cloud base sits {gap:.0f} m above the top of the mixed "
                f"layer, so surface thermals cannot reach saturation"
            )
        if not has_forcing:
            out.append(
                "no forcing data: this is a statement about capability, not "
                "a forecast that convection will begin"
            )
            if ceiling:
                out.append(
                    f"the environment would score higher with a known "
                    f"trigger; capped at {self.NO_FORCING_CEILING}"
                )
        if hour is not None and (hour < 8 or hour > 20):
            out.append(
                f"outside the diurnal heating window (local solar hour "
                f"{hour:.1f}), so surface-driven initiation is unlikely"
            )
        return out


ENGINE = register(InitiationEngine())
