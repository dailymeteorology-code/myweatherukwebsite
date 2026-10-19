"""Storm Organisation Engine.

SCIENTIFIC AUDIT (section 59)
=============================

**Physical question.** IF convection develops, what organisational mode does
the environment favour? The conditional is the whole point: this engine says
nothing about whether storms form, and its output must never be read as a
storm forecast.

**Inputs.** Bulk shear over 0-1, 0-3 and 0-6 km, storm-relative helicity,
effective SRH, storm-relative inflow, the Bulk Richardson Number, CAPE per
parcel, LCL, and the regime engine's elevated affinity.

**Mechanism.** Modes are scored as independent affinities, exactly as regimes
are. Each mode is a combination of shear, instability and -- for elevated
convection -- parcel origin. A hybrid environment scores on several modes at
once, which is honest: the classic transitions (multicell to linear, linear
to supercell embedded in a line) pass through genuinely mixed states, and a
forced single label discards the fact that both are possible.

**Storm motion.** Taken from the Stage 4 storm-relative framework, which
computes ONE Bunkers estimate per column. This engine does not compute its
own: several contradictory storm motions inside different engines is exactly
the failure the architecture is meant to prevent. Every helicity-dependent
mode inherits that motion and records it.

**Terminology.** The supercell class is `supercell_favourable`. It names an
environment, not an event. The same discipline applies to every mode: these
are environmental affinities, and the word "favourable" is in the class name
so it cannot be lost downstream.

**Limitations.** Environmental only -- no storm-scale dynamics, no cold-pool
feedback, no upscale growth. Linear organisation in particular depends on a
forcing boundary the engine cannot see, so its affinity reflects only the
shear structure that would SUPPORT a line if one formed.

**Data requirements.** A hodograph to 6 km. Without wind, only the elevated
and pulse modes are diagnosable and the engine says so.

**Uncertainty.** Rises when modes score similarly (a genuinely mixed
environment), when the hodograph is shallow, and when the storm motion is a
Bunkers estimate rather than an observation -- which, at forecast range, it
always is.

**Validation.** Against radar-classified storm mode, conditioned on storms
having occurred. Unconditional validation would measure initiation skill
instead, which this engine does not attempt.
"""
from __future__ import annotations

from .base import Engine, EngineContext, register
from .result import EngineResult, EngineStatus, ScoreKind
from .transfer import Factor, Rule, Shape, Transfer, compose

T_SHEAR_DEEP_SUPERCELL = Transfer(
    name="shear_deep_supercell", feature="shear_0_6km", unit="m/s",
    shape=Shape.LOGISTIC, low=15.0, high=25.0,
    reasoning="Supercell environments are conventionally separated near "
              "20 m/s of 0-6 km bulk shear; below about 15 m/s mesocyclone "
              "maintenance is rare, above 25 m/s it is common given "
              "sufficient buoyancy.",
    reference="Weisman & Klemp (1982), Mon. Wea. Rev. 110, 504-520; "
              "Thompson et al. (2003), Wea. Forecasting 18, 1243-1261",
)

T_SHEAR_DEEP_WEAK = Transfer(
    name="shear_deep_weak", feature="shear_0_6km", unit="m/s",
    shape=Shape.INVERSE_LOGISTIC, low=6.0, high=14.0,
    reasoning="Pulse and single-cell convection is DEFINED by weak deep "
              "shear: with less than about 10 m/s the updraught and its "
              "downdraught occupy the same space and the cell collapses on "
              "itself within an hour.",
    reference="Byers & Braham (1949), The Thunderstorm; Weisman & Klemp "
              "(1982)",
)

T_SHEAR_MULTICELL = Transfer(
    name="shear_multicell", feature="shear_0_6km", unit="m/s",
    shape=Shape.BAND, low=10.0, high=20.0, margin=8.0, margin_low=6.0,
    reasoning="Multicell organisation occupies the middle ground: enough "
              "shear to displace the downdraught from the updraught and "
              "allow new cells on the gust front, not enough for a "
              "persistent rotating updraught.",
    reference="Weisman & Klemp (1982); Markowski & Richardson (2010), "
              "Mesoscale Meteorology in Midlatitudes",
)

T_SHEAR_LOW_LINEAR = Transfer(
    name="shear_low_linear", feature="shear_0_3km", unit="m/s",
    shape=Shape.LOGISTIC, low=8.0, high=18.0,
    reasoning="Quasi-linear systems require substantial low-to-mid-level "
              "shear perpendicular to the line to balance the cold pool and "
              "keep the leading edge upright.",
    reference="Rotunno, Klemp & Weisman (1988), J. Atmos. Sci. 45, 463-485 "
              "(RKW theory)",
    limitations="RKW balance depends on cold-pool strength, which this "
                "engine cannot see; shear alone is a partial statement.",
)

T_SRH_ROTATION = Transfer(
    name="srh_rotation", feature="srh_0_3km", unit="m2/s2",
    shape=Shape.LOGISTIC, low=75.0, high=250.0,
    reasoning="Storm-relative helicity measures the streamwise vorticity a "
              "storm can tilt into a rotating updraught. 150 m2/s2 is a "
              "conventional supercell threshold; 250 is strongly supportive.",
    reference="Davies-Jones et al. (1990); Thompson et al. (2003)",
    limitations="Depends entirely on the assumed storm motion, which is an "
                "estimate at forecast range.",
)

T_BRN_SUPERCELL = Transfer(
    name="brn_supercell", feature="bulk_richardson_number",
    unit="dimensionless", shape=Shape.BAND, low=10.0, high=45.0,
    margin=40.0, margin_low=8.0,
    reasoning="Weisman & Klemp found supercells in a BRN window roughly "
              "10-45: below it shear overwhelms buoyancy and updraughts are "
              "torn apart, above it buoyancy dominates and cells are "
              "unorganised. A band, because both ends are unfavourable.",
    reference="Weisman & Klemp (1982), Mon. Wea. Rev. 110, 504-520",
    limitations="Sensitive to which CAPE is used in the numerator; the "
                "Stage 4 BRN documents its own choice.",
)

T_CAPE_FOR_ORGANISATION = Transfer(
    name="cape_for_organisation", feature="mucape", unit="J/kg",
    shape=Shape.LOGISTIC, low=250.0, high=1500.0,
    reasoning="Organised modes need an updraught strong enough to interact "
              "with the shear. Below about 250 J/kg over the UK, shear "
              "disrupts convection rather than organising it.",
    reference="Thompson et al. (2003); UK convective climatology",
)

T_CAPE_PULSE = Transfer(
    name="cape_pulse", feature="mucape", unit="J/kg",
    shape=Shape.LOGISTIC, low=100.0, high=700.0,
    reasoning="Pulse convection needs only modest buoyancy; the anchors are "
              "lower than for organised modes because a single cell requires "
              "no interaction with shear to exist.",
    reference="Byers & Braham (1949)",
)

T_INFLOW = Transfer(
    name="storm_relative_inflow", feature="storm_relative_inflow_1km",
    unit="m/s", shape=Shape.LOGISTIC, low=6.0, high=16.0,
    reasoning="Storm-relative inflow at 1 km governs how much low-level air "
              "an organised storm can ingest. Weak inflow starves a "
              "persistent updraught however favourable the shear.",
    reference="Thompson et al. (2007), Wea. Forecasting 22, 102-115",
)

T_ELEVATED_ORIGIN = Transfer(
    name="elevated_origin", feature="elevated_affinity",
    unit="dimensionless", shape=Shape.RAMP, low=0.2, high=0.7,
    reasoning="Elevated convection is a distinct organisational mode: rooted "
              "above the boundary layer, insulated from surface friction and "
              "from the cold pool, so it neither organises nor decays the way "
              "surface-based convection does. Taken from the regime engine "
              "rather than recomputed.",
    reference="Corfidi et al. (2008), Wea. Forecasting 23, 1280-1303",
)


class OrganisationEngine(Engine):
    """Estimates which storm mode the environment favours, given convection.

    See the module docstring for the full scientific audit.
    """

    name = "storm_organisation"
    version = "1.0"
    score_kind = ScoreKind.CLASS_AFFINITY
    question = (
        "IF convection develops, what organisational mode does the "
        "environment favour? Says nothing about whether it develops."
    )
    consumes_diagnostics = (
        "mucape", "mlcape", "shear_0_1km", "shear_0_3km", "shear_0_6km",
        "srh_0_1km", "srh_0_3km", "effective_srh", "storm_relative_flow",
        "bulk_richardson_number", "lcl",
    )
    consumes_engines = ("weather_regime",)

    AMBIGUITY_BAND = 0.15

    def evaluate(self, context: EngineContext) -> EngineResult:
        features = context.features.get("set")
        if features is None:
            return self._insufficient("no shared feature set was built")

        mucape = features.get("mucape")
        if mucape is None:
            return self._insufficient(
                "no CAPE, so there is no convection whose mode could be "
                "assessed",
                missing=("mucape",),
            )

        regime = context.result("weather_regime")
        elevated_affinity = None
        if regime is not None and regime.status.has_score:
            elevated_affinity = max(
                regime.classes.get("elevated", 0.0),
                regime.classes.get("nocturnal", 0.0),
            )

        modes = {
            "pulse_single_cell": [
                Factor(T_SHEAR_DEEP_WEAK, features.get("shear_0_6km")),
                Factor(T_CAPE_PULSE, mucape),
            ],
            "multicell": [
                Factor(T_SHEAR_MULTICELL, features.get("shear_0_6km")),
                Factor(T_CAPE_FOR_ORGANISATION, mucape),
            ],
            "organised_multicell": [
                Factor(T_SHEAR_MULTICELL, features.get("shear_0_6km")),
                Factor(T_CAPE_FOR_ORGANISATION, mucape),
                Factor(T_INFLOW, features.get("storm_relative_inflow_1km")),
            ],
            "linear_qlcs": [
                Factor(T_SHEAR_LOW_LINEAR, features.get("shear_0_3km")),
                Factor(T_CAPE_FOR_ORGANISATION, mucape),
            ],
            "supercell_favourable": [
                Factor(T_SHEAR_DEEP_SUPERCELL, features.get("shear_0_6km")),
                Factor(T_SRH_ROTATION, features.get("srh_0_3km")),
                Factor(T_CAPE_FOR_ORGANISATION, mucape),
                Factor(T_BRN_SUPERCELL,
                       features.get("bulk_richardson_number")),
            ],
            "elevated": [
                Factor(T_ELEVATED_ORIGIN, elevated_affinity),
                Factor(T_CAPE_FOR_ORGANISATION, mucape),
            ],
        }

        affinities: dict[str, float] = {}
        compositions = {}
        unavailable: dict[str, str] = {}
        for mode, factors in modes.items():
            composition = compose(Rule.INGREDIENTS, factors,
                                  minimum_factors=2)
            if composition is None:
                unavailable[mode] = (
                    "fewer than two defining features available (missing: "
                    + ", ".join(
                        f.transfer.feature for f in factors
                        if f.membership is None
                    ) + ")"
                )
                continue
            affinities[mode] = round(composition.value, 4)
            compositions[mode] = composition

        if not affinities:
            return self._insufficient(
                "no organisational mode could be evaluated; a hodograph to "
                "6 km is required for all but the elevated mode",
                missing=features.missing("shear_0_6km", "srh_0_3km"),
            )

        ranked = sorted(affinities.items(), key=lambda kv: -kv[1])
        leader, leading_value = ranked[0]
        close = [
            n for n, v in ranked[1:]
            if leading_value - v <= self.AMBIGUITY_BAND and v > 0.2
        ]
        ambiguity = round(min(1.0, len(close) / 3.0), 3) if close else 0.0

        evaluated = sum(len(c.factors) for c in compositions.values())
        requested = sum(len(v) for v in modes.values())
        completeness = evaluated / requested if requested else 0.0

        # The storm motion every helicity-dependent mode inherited.
        motion = context.parameters.get("storm_relative_flow")
        motion_method = ""
        if motion.status.has_value:
            motion_method = motion.extra.get("storm_motion", {}).get(
                "method", ""
            )

        confidence = round(completeness * (1.0 - 0.35 * ambiguity), 3)
        uncertainty = round(
            min(1.0, 0.5 * (1.0 - completeness) + 0.4 * ambiguity
                + (0.15 if motion_method.startswith("bunkers") else 0.0)),
            3,
        )

        status = EngineStatus.AVAILABLE
        flags: list[str] = [
            "CONDITIONAL on convection occurring; this engine says nothing "
            "about whether storms develop",
        ]
        if completeness < 0.7:
            status = EngineStatus.DEGRADED
            flags.append(
                f"only {completeness:.0%} of the defining features across "
                f"all modes were available"
            )
        if ambiguity > 0.3:
            flags.append(
                f"{len(close)} mode(s) within {self.AMBIGUITY_BAND} of the "
                f"leader -- a genuinely mixed environment"
            )
        if motion_method.startswith("bunkers"):
            flags.append(
                "helicity-dependent modes rest on an estimated Bunkers storm "
                "motion, not an observed one"
            )

        return self._result(
            score=leading_value,
            status=status,
            classes=affinities,
            confidence=confidence,
            uncertainty=uncertainty,
            contributions=compositions[leader].contributions,
            quality_flags=tuple(flags),
            explanation=tuple(
                self._explain(ranked, compositions, close, features)
            ),
            reason="; ".join(flags[1:2]) if status is not EngineStatus.AVAILABLE
            else "",
            extra={
                "favoured_mode": leader,
                "ambiguous_with": close,
                "mode_ambiguity": ambiguity,
                "not_evaluable": unavailable,
                "feature_completeness": round(completeness, 3),
                "storm_motion_method": motion_method or None,
                "affinities_do_not_sum_to_one": True,
                "conditional_on": "convection occurring",
                "terminology_note": (
                    "'supercell_favourable' names an ENVIRONMENT, not an "
                    "event; the same holds for every mode here"
                ),
            },
        )

    def _explain(self, ranked, compositions, close, features) -> list[str]:
        leader, value = ranked[0]
        readable = leader.replace("_", " ")
        out = [f"if storms form, {readable} is favoured ({value:.2f})"]
        composition = compositions[leader]
        supporting = [
            c for c in composition.contributions if c.direction == "supporting"
        ]
        if supporting:
            out.append(
                "supported by " + ", ".join(
                    f"{c.feature} {c.value:.0f}" if c.value is not None
                    else c.feature for c in supporting[:3]
                )
            )
        limiting = composition.limiting
        if limiting is not None and limiting.membership < 0.4:
            out.append(
                f"limited by {limiting.transfer.feature}"
                + (f" ({limiting.value:.0f} {limiting.transfer.unit})"
                   if limiting.value is not None else "")
            )
        if close:
            out.append(
                "also plausible: " + ", ".join(
                    c.replace("_", " ") for c in close
                )
            )
        return out


ENGINE = register(OrganisationEngine())
