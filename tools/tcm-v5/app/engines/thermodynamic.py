"""Thermodynamic Potential Engine.

SCIENTIFIC AUDIT (section 59)
=============================

**Physical question.** How thermodynamically supportive is this atmosphere
for DEEP convection, for the parcel that actually matters here? Explicitly
NOT "will a storm initiate" -- a profile can be exceptionally supportive and
produce nothing all day for want of a trigger. Initiation is a separate
engine and this one must never be read as a substitute.

**Inputs.** SBCAPE/MLCAPE/MUCAPE and their CIN, LCL, LFC, EL, storm depth,
mid-level lapse rate, precipitable water, freezing level, plus the regime
engine's affinities to choose the representative parcel.

**Mechanism.** Three steps.

1. *Choose the parcel by regime, not by size.* Taking the largest CAPE is the
   standard mistake: MUCAPE is by construction the largest and describes a
   parcel that may sit 200 hPa above a capped surface. On a surface-based
   afternoon the surface parcel is the physically representative one even
   though MUCAPE is larger.
2. *Score depth-weighted buoyancy.* CAPE alone is ambiguous -- 1000 J/kg
   spread through 10 km behaves nothing like 1000 J/kg concentrated in 3 km
   (Blanchard 1998). Storm depth enters as its own ingredient.
3. *Treat CIN as a barrier, not a penalty.* CIN is reported as a separate
   `barrier` quantity and NOT subtracted from the potential, because whether
   a cap matters depends on forcing, which this engine cannot see. A capped
   3000 J/kg profile is thermodynamically superb and may still do nothing;
   collapsing those two facts into one number destroys both.

**Limitations.** Undiluted parcel theory throughout, so it systematically
overstates what a real entraining updraught achieves -- the entrainment
engine exists to say by how much. Says nothing about timing or trigger. On a
nine-level profile the CAPE itself is a lower bound.

**Data requirements.** A thermodynamic profile with humidity. Works without
wind.

**Uncertainty.** Rises when parcels disagree about the character of the
atmosphere (large MUCAPE with negligible SBCAPE), when the profile is coarse,
and when the regime is ambiguous so the parcel choice itself is uncertain.

**Validation.** Against observed storm depth and echo tops, once an archive
exists. Not against thunderstorm occurrence -- that would be validating the
wrong quantity, and would push the engine towards becoming an initiation
forecast.
"""
from __future__ import annotations

from .base import Engine, EngineContext, register
from .result import Contribution, EngineResult, EngineStatus, ScoreKind
from .transfer import Factor, Rule, Shape, Transfer, compose

T_CAPE_DEPTH = Transfer(
    name="cape_representative", feature="representative_cape", unit="J/kg",
    shape=Shape.LOGISTIC, low=150.0, high=1600.0,
    reasoning="Buoyant energy available to the representative parcel. "
              "Anchored to UK values: 150 J/kg is about the least that "
              "yields a shower with depth, 1600 J/kg a strong UK day.",
    reference="Hand et al. (2004), Meteorol. Appl. 11, 15-31; Met Office "
              "operational practice",
    limitations="Undiluted; a real entraining updraught realises less.",
)

T_STORM_DEPTH = Transfer(
    name="storm_depth", feature="storm_depth", unit="m",
    shape=Shape.LOGISTIC, low=2500.0, high=8000.0,
    reasoning="Depth from LFC to EL. Below about 3 km the cloud cannot "
              "reach the mixed-phase layer and produces showers rather than "
              "thunderstorms; 8 km is a deep UK storm. Included separately "
              "from CAPE because equal CAPE spread through different depths "
              "produces very different storms (Blanchard 1998).",
    reference="Blanchard (1998), Wea. Forecasting 13, 870-877",
)

T_LAPSE_DEEP = Transfer(
    name="lapse_deep", feature="lr_700_500", unit="K/km",
    shape=Shape.LOGISTIC, low=5.5, high=7.5,
    reasoning="Mid-level lapse rate governs how buoyancy is distributed with "
              "height and how quickly a parcel's excess temperature grows. "
              "6.5 K/km is the standard-atmosphere value; above 7 K/km is "
              "steep for the UK.",
    reference="ICAO standard atmosphere; Met Office convective guidance",
)

T_MOISTURE_DEPTH = Transfer(
    name="column_moisture", feature="precipitable_water", unit="kg/m2",
    shape=Shape.LOGISTIC, low=12.0, high=28.0,
    reasoning="A deep moist column supports sustained condensation and "
              "resists dilution. UK summer values run 15-25 mm.",
    reference="UK radiosonde climatology",
    limitations="A column total; it cannot distinguish a moist boundary "
                "layer under dry mid-levels from a uniformly moist column. "
                "The entrainment engine makes that distinction.",
)

T_CIN_BARRIER = Transfer(
    name="cin_barrier", feature="representative_cin", unit="J/kg",
    shape=Shape.RAMP, low=-10.0, high=-125.0,
    reasoning="How much of a barrier the cap presents, as a magnitude in its "
              "own right. Around -25 J/kg is routinely eroded by afternoon "
              "heating; -125 J/kg requires substantial mesoscale lift. "
              "Reported SEPARATELY and never subtracted from the potential.",
    reference="Colby (1984), Mon. Wea. Rev. 112, 2239-2252",
)


class ThermodynamicEngine(Engine):
    """Quantifies thermodynamic support for deep convection.

    See the module docstring for the full scientific audit.
    """

    name = "thermodynamic"
    version = "1.0"
    score_kind = ScoreKind.POTENTIAL
    question = (
        "How thermodynamically supportive is this atmosphere for deep "
        "convection? Not whether convection will initiate."
    )
    consumes_diagnostics = (
        "sbcape", "mlcape", "mucape", "sbcin", "mlcin", "mucin",
        "lcl", "lfc", "el", "lr_700_500", "precipitable_water",
        "freezing_level",
    )
    consumes_engines = ("weather_regime",)

    #: Above this regime affinity, the elevated parcel is representative.
    ELEVATED_AFFINITY = 0.5

    def evaluate(self, context: EngineContext) -> EngineResult:
        features = context.features.get("set")
        if features is None:
            return self._insufficient("no shared feature set was built")

        parcel, cape, cin, why = self._choose_parcel(context, features)
        if cape is None:
            return self._insufficient(
                "no parcel has usable CAPE, so there is no thermodynamic "
                "potential to assess",
                missing=features.missing("sbcape", "mlcape", "mucape"),
            )

        factors = [
            Factor(T_CAPE_DEPTH, cape),
            Factor(T_STORM_DEPTH, features.get("storm_depth")),
            Factor(T_LAPSE_DEEP, features.get("lr_700_500")),
            Factor(T_MOISTURE_DEPTH, features.get("precipitable_water")),
        ]
        composition = compose(Rule.INGREDIENTS, factors, minimum_factors=2)
        if composition is None:
            return self._insufficient(
                "fewer than two thermodynamic ingredients could be evaluated",
                missing=composition.missing if composition else (),
            )

        # -- the barrier, kept separate --------------------------------------
        barrier = T_CIN_BARRIER(cin) if cin is not None else None

        # -- parcel disagreement --------------------------------------------
        sbcape = features.get("sbcape")
        mucape = features.get("mucape")
        disagreement = 0.0
        if sbcape is not None and mucape is not None and mucape > 50.0:
            disagreement = round(
                min(1.0, max(0.0, (mucape - sbcape) / mucape)), 3
            )

        regime = context.result("weather_regime")
        regime_ambiguity = 0.0
        if regime is not None and regime.status.has_score:
            regime_ambiguity = float(
                regime.extra.get("regime_ambiguity", 0.0)
            )

        completeness = len(composition.factors) / len(factors)
        confidence = round(completeness * (1.0 - 0.3 * regime_ambiguity), 3)
        uncertainty = round(
            min(1.0, 0.5 * (1.0 - completeness) + 0.4 * disagreement
                + 0.3 * regime_ambiguity),
            3,
        )

        status = EngineStatus.AVAILABLE
        flags: list[str] = []
        if composition.missing:
            status = EngineStatus.DEGRADED
            flags.append(f"missing: {', '.join(composition.missing)}")
        if disagreement > 0.6:
            flags.append(
                f"the parcels disagree strongly: MUCAPE {mucape:.0f} against "
                f"SBCAPE {sbcape:.0f} J/kg. The atmosphere is unstable aloft "
                f"but not from the surface, so the representative parcel "
                f"choice materially changes this answer"
            )

        contributions = list(composition.contributions)
        if barrier is not None:
            contributions.append(Contribution(
                feature="representative_cin", value=cin, unit="J/kg",
                transformed=round(barrier, 4), influence=0.0,
                direction="neutral",
                note="reported as a separate barrier; deliberately NOT "
                     "subtracted from the potential, because whether a cap "
                     "matters depends on forcing this engine cannot see",
            ))

        return self._result(
            score=round(composition.value, 4),
            status=status,
            confidence=confidence,
            uncertainty=uncertainty,
            contributions=tuple(contributions),
            quality_flags=tuple(flags),
            explanation=tuple(self._explain(
                composition, parcel, cape, cin, barrier, why, disagreement
            )),
            reason="; ".join(flags) if status is not EngineStatus.AVAILABLE
            else "",
            extra={
                "dominant_parcel": parcel,
                "parcel_selection_reason": why,
                "representative_cape_j_kg": round(cape, 1),
                "representative_cin_j_kg": (
                    round(cin, 1) if cin is not None else None
                ),
                "cin_barrier": (
                    round(barrier, 3) if barrier is not None else None
                ),
                "cin_note": (
                    "a barrier magnitude in [0,1], NOT a penalty applied to "
                    "the score. High potential with a high barrier is a real "
                    "and important state"
                ),
                "parcel_disagreement": disagreement,
                "all_parcels": {
                    p: {
                        "cape": features.get(f"{p}cape"),
                        "cin": features.get(f"{p}cin"),
                    }
                    for p in ("sb", "ml", "mu")
                },
                "storm_depth_m": features.get("storm_depth"),
            },
        )

    def _choose_parcel(self, context, features):
        """Pick the physically representative parcel, by regime.

        NOT by largest CAPE. MUCAPE is the largest by construction, so
        choosing on size always chooses MU and would describe an elevated
        parcel on a straightforwardly surface-based afternoon.
        """
        regime = context.result("weather_regime")
        affinities = {}
        if regime is not None and regime.status.has_score:
            affinities = regime.classes

        elevated = max(
            affinities.get("elevated", 0.0),
            affinities.get("spanish_plume", 0.0),
            affinities.get("nocturnal", 0.0),
        )
        surface = affinities.get("high_cape_surface_based", 0.0)

        order: list[tuple[str, str]]
        if elevated >= self.ELEVATED_AFFINITY and elevated > surface:
            order = [
                ("mu", f"elevated/plume/nocturnal regime affinity "
                       f"{elevated:.2f} exceeds surface-based {surface:.2f}, "
                       f"so the most-unstable parcel is representative"),
                ("ml", "fallback: most-unstable parcel unavailable"),
                ("sb", "fallback: only the surface parcel is available"),
            ]
        elif surface >= self.ELEVATED_AFFINITY:
            order = [
                ("sb", f"surface-based regime affinity {surface:.2f}, so the "
                       f"surface parcel is representative even where MUCAPE "
                       f"is larger"),
                ("ml", "fallback: surface parcel unavailable"),
                ("mu", "fallback: only the most-unstable parcel is available"),
            ]
        else:
            order = [
                ("ml", "no regime is clearly dominant, so the mixed-layer "
                       "parcel is used as the least assumption-laden choice: "
                       "it neither presumes a surface origin nor selects the "
                       "single most buoyant layer"),
                ("mu", "fallback: mixed-layer parcel unavailable"),
                ("sb", "fallback: only the surface parcel is available"),
            ]

        for parcel, why in order:
            cape = features.get(f"{parcel}cape")
            if cape is not None:
                return parcel, cape, features.get(f"{parcel}cin"), why
        return None, None, None, "no parcel had usable CAPE"

    def _explain(self, composition, parcel, cape, cin, barrier, why,
                 disagreement) -> list[str]:
        out = [
            f"{parcel.upper()} parcel selected: {why}",
            f"representative CAPE {cape:.0f} J/kg",
        ]
        limiting = composition.limiting
        if limiting is not None and limiting.membership < 0.4:
            value = limiting.value
            out.append(
                f"limited by {limiting.transfer.feature}"
                + (f" ({value:.0f} {limiting.transfer.unit})"
                   if value is not None else "")
            )
        if barrier is not None and barrier > 0.5:
            out.append(
                f"a substantial cap ({cin:.0f} J/kg) stands between the "
                f"surface and this potential; whether it breaks is the "
                f"initiation engine's question, not this one's"
            )
        if disagreement > 0.6:
            out.append(
                "instability is largely elevated rather than surface-based"
            )
        return out


ENGINE = register(ThermodynamicEngine())
