"""Weather Regime Engine.

SCIENTIFIC AUDIT (section 59)
=============================

**Physical question.** What KIND of convective environment is present? Not
"will it storm" -- this engine predicts P(regime | atmospheric state) and
nothing about occurrence.

**Inputs.** Stage 4 instability per parcel, lapse rates, moisture structure,
shear, freezing level, boundary-layer depth, LCL, plus local solar hour and
terrain elevation.

**Mechanism.** Each regime is a named combination of environmental
ingredients. A profile's affinity for a regime is the geometric mean of its
membership in each ingredient, so a regime scores highly only when ALL of its
defining features are present, and any missing one pulls it down.

**Why affinities and not a classification.** A single label is wrong about
the British atmosphere more often than it is right. A Spanish plume arriving
ahead of a cold front over the Pennines on a July afternoon is
simultaneously plume, frontal, surface-based and orographic, and forcing it
into one box discards the three facts that most affect what happens. So
affinities are independent, need not sum to 1, and each is computed without
reference to the others.

**Limitations.** Five of the twelve regimes are defined by things a single
column cannot see -- a coastline, a convergence line, a horizontal
temperature gradient. Those report as unavailable with that as the reason
rather than being guessed from vertical structure. The engine is weakest in
transitional situations, which is exactly when a forecaster most wants it,
and `regime_ambiguity` says so explicitly.

**Data requirements.** Any model with a thermodynamic profile and a
hodograph. Regimes needing terrain or horizontal gradients require those
fields to be ingested.

**Uncertainty.** Two sources, reported separately: input incompleteness
(how many defining features were available) and genuine physical ambiguity
(several regimes scoring similarly, which is a real state of the atmosphere
rather than a fault).

**Validation.** Eventually against forecaster-labelled case archives and
against observed storm mode. No such archive exists yet, so the engine is
tested here against constructed profiles whose regime is unambiguous by
construction.
"""
from __future__ import annotations

import numpy as np

from .base import Engine, EngineContext, register
from .result import EngineResult, EngineStatus, ScoreKind
from .transfer import Factor, Rule, Shape, Transfer, compose

_UK_CLIMO = (
    "UK convective climatology: 500 J/kg is a notable summer day over "
    "England, 1500 J/kg an exceptional one. Anchors set an order of "
    "magnitude below continental values deliberately."
)

# ---------------------------------------------------------------------------
# Transfers. Each is anchored, reasoned and referenced.
# ---------------------------------------------------------------------------

T_SBCAPE_HIGH = Transfer(
    name="sbcape_high", feature="sbcape", unit="J/kg", shape=Shape.LOGISTIC,
    low=200.0, high=1500.0,
    reasoning=_UK_CLIMO + " 200 J/kg is about the least that supports a "
              "shower with any depth; 1500 is a strong UK day.",
    reference="Met Office operational practice; Hand et al. (2004), "
              "Meteorol. Appl. 11, 15-31 (UK severe convective climatology)",
    limitations="CAPE alone says nothing about whether a parcel can reach "
                "its LFC. Deliberately paired with a CIN and an LCL factor "
                "in every regime that uses it.",
)

T_MUCAPE_HIGH = Transfer(
    name="mucape_high", feature="mucape", unit="J/kg", shape=Shape.LOGISTIC,
    low=200.0, high=1800.0,
    reasoning="As for SBCAPE, with a slightly higher upper anchor: the "
              "most-unstable parcel is by construction at least as buoyant, "
              "so the same anchor would saturate too readily.",
    reference=_UK_CLIMO,
)

T_CAPE_MODEST = Transfer(
    name="cape_modest", feature="mucape", unit="J/kg", shape=Shape.BAND,
    low=100.0, high=800.0, margin=600.0, margin_low=100.0,
    reasoning="The low-CAPE/high-shear regime is DEFINED by modest "
              "instability. A band, not a ramp: 3000 J/kg disqualifies the "
              "regime as surely as 20 J/kg does, and a ramp would score the "
              "most unstable profiles highest for a regime about weak "
              "instability. The margins are ASYMMETRIC on purpose -- below "
              "100 J/kg there is no convection to organise at all, so the "
              "membership must reach zero AT zero CAPE, whereas above "
              "800 J/kg the atmosphere is merely in a different convective "
              "regime and the fall-off is gentler.",
    reference="Sherburn & Parker (2014), Wea. Forecasting 29, 854-877 "
              "(high-shear low-CAPE environments)",
    limitations="Says nothing about whether the modest CAPE is realisable; "
                "pair with an initiation assessment.",
)

T_CIN_WEAK = Transfer(
    name="cin_weak", feature="sbcin", unit="J/kg", shape=Shape.INVERSE_LOGISTIC,
    low=-10.0, high=-75.0,
    reasoning="Surface-based convection needs the cap broken. Around "
              "-25 J/kg is routinely overcome by afternoon heating; beyond "
              "about -75 J/kg surface parcels rarely reach the LFC without "
              "substantial mesoscale lift.",
    reference="Colby (1984), Mon. Wea. Rev. 112, 2239-2252; SPC mesoanalysis "
              "convention",
    limitations="CIN alone cannot say whether the cap breaks -- that needs "
                "heating and lift, which the initiation engine supplies. "
                "Here it only distinguishes surface-based from capped.",
)

T_CIN_STRONG = Transfer(
    name="cin_strong", feature="sbcin", unit="J/kg", shape=Shape.RAMP,
    low=-30.0, high=-150.0,
    reasoning="A capping inversion is a DEFINING feature of the plume and "
              "elevated regimes, not a fault. Strong inhibition at the "
              "surface is what allows instability to accumulate and what "
              "forces convection to be elevated.",
    reference="Carlson & Ludlam (1968), Tellus 20, 203-226 (the elevated "
              "mixed layer and its inversion)",
)

T_LAPSE_MID_STEEP = Transfer(
    name="lapse_mid_steep", feature="lr_700_500", unit="K/km",
    shape=Shape.LOGISTIC, low=6.0, high=8.0,
    reasoning="Mid-level lapse rates above about 7 K/km indicate an elevated "
              "mixed layer advected from a heated plateau -- the Iberian "
              "Meseta for UK plume events. 8 K/km approaches dry adiabatic "
              "and is near the physical ceiling for a deep layer.",
    reference="Carlson & Ludlam (1968); Lewis & Gray (2010), Weather 65, "
              "6-11 (Spanish plume events over the UK)",
)

T_LAPSE_LOW_STEEP = Transfer(
    name="lapse_low_steep", feature="lr_0_3km", unit="K/km",
    shape=Shape.LOGISTIC, low=6.5, high=8.5,
    reasoning="Steep low-level lapse rates are the signature of cold air "
              "over a relatively warm surface -- the post-frontal and "
              "maritime showery regimes. Approaching the dry adiabatic "
              "9.8 K/km through the lowest 3 km indicates vigorous surface "
              "heating from below.",
    reference="Standard airmass-convection reasoning; ICAO standard "
              "atmosphere 6.5 K/km as the neutral reference",
)

T_SHEAR_DEEP_STRONG = Transfer(
    name="shear_deep_strong", feature="shear_0_6km", unit="m/s",
    shape=Shape.LOGISTIC, low=10.0, high=20.0,
    reasoning="0-6 km bulk shear near 20 m/s is the conventional threshold "
              "separating organised multicell and supercell environments "
              "from disorganised ones; below about 10 m/s storms are "
              "effectively unorganised.",
    reference="Weisman & Klemp (1982), Mon. Wea. Rev. 110, 504-520; "
              "Thompson et al. (2003), Wea. Forecasting 18, 1243-1261",
)

T_FREEZING_HIGH = Transfer(
    name="freezing_high", feature="freezing_level", unit="m",
    shape=Shape.LOGISTIC, low=2400.0, high=3600.0,
    reasoning="A high freezing level accompanies the warm mid-level airmass "
              "of a plume event and marks a deep warm cloud layer. Around "
              "3500 m is high for the UK.",
    reference="Lewis & Gray (2010); UK radiosonde climatology",
)

T_FREEZING_LOW = Transfer(
    name="freezing_low", feature="freezing_level", unit="m",
    shape=Shape.INVERSE_LOGISTIC, low=1200.0, high=2600.0,
    reasoning="A low freezing level is characteristic of the cold "
              "post-frontal and maritime airmasses in which shallow showers, "
              "graupel and thunder-with-hail occur in the cool season.",
    reference="UK cool-season convective climatology",
)

T_PW_HIGH = Transfer(
    name="pw_high", feature="precipitable_water", unit="kg/m2",
    shape=Shape.LOGISTIC, low=18.0, high=32.0,
    reasoning="UK summer precipitable water is typically 15-25 mm; above "
              "about 30 mm is a moist, tropical-origin airmass of the kind "
              "that accompanies plume and heavy-rainfall events.",
    reference="UK radiosonde climatology; Lewis & Gray (2010)",
)

T_ELEVATED_SEPARATION = Transfer(
    name="elevated_separation", feature="mucape_minus_sbcape", unit="J/kg",
    shape=Shape.LOGISTIC, low=100.0, high=800.0,
    reasoning="Convection is elevated when the most-unstable parcel is well "
              "above the surface AND substantially more buoyant than a "
              "surface parcel. The DIFFERENCE is the discriminator: a large "
              "MUCAPE with equal SBCAPE is simply surface-based.",
    reference="Corfidi et al. (2008), Wea. Forecasting 23, 1280-1303 "
              "(elevated convection)",
)

T_LCL_LOW = Transfer(
    name="lcl_low", feature="lcl", unit="m", shape=Shape.INVERSE_LOGISTIC,
    low=800.0, high=2000.0,
    reasoning="A low cloud base indicates a moist boundary layer and short "
              "sub-cloud evaporation path. Above about 2000 m the sub-cloud "
              "layer is deep and dry.",
    reference="Craven et al. (2002), Natl. Wea. Dig. 26, 13-20 (LCL "
              "climatology by storm type)",
)

T_LCL_BELOW_PBL = Transfer(
    name="lcl_below_pbl", feature="lcl_above_pbl", unit="m",
    shape=Shape.INVERSE_LOGISTIC, low=-200.0, high=600.0,
    reasoning="Surface-based convection requires thermals to reach "
              "saturation before losing their buoyancy at the top of the "
              "mixed layer. An LCL above the boundary-layer top is the "
              "commonest reason a promising UK sounding produces nothing.",
    reference="Standard mixed-layer reasoning; Stull (1988), An "
              "Introduction to Boundary Layer Meteorology",
)

T_DAYTIME = Transfer(
    name="daytime_heating", feature="local_solar_hour", unit="h",
    shape=Shape.BAND, low=11.0, high=18.0, margin=4.0,
    reasoning="Surface-driven convection peaks in the hours after maximum "
              "heating, typically 13-17 local solar time over UK land. The "
              "band is deliberately wide and the margin generous: this is a "
              "weak prior, not a gate.",
    reference="UK lightning climatology diurnal cycle (Met Office ATDnet)",
    limitations="A weak indicator only. Strongly forced and elevated "
                "convection occurs at any hour, which is why no regime uses "
                "this as its sole discriminator.",
)

T_NIGHT = Transfer(
    name="nocturnal", feature="local_solar_hour", unit="h",
    shape=Shape.BAND, low=22.0, high=30.0, margin=3.0,
    reasoning="The nocturnal window, expressed on a 22-30 h axis so it does "
              "not wrap at midnight; the caller maps hours below 12 onto "
              "+24. Nocturnal UK convection is usually elevated and often "
              "associated with a low-level jet.",
    reference="Corfidi et al. (2008); UK ATDnet nocturnal lightning maxima",
)

T_ELEVATION_HIGH = Transfer(
    name="elevation_high", feature="elevation", unit="m",
    shape=Shape.LOGISTIC, low=150.0, high=600.0,
    reasoning="Orographic enhancement over UK terrain becomes significant "
              "over the higher ground of Wales, the Pennines and the "
              "Highlands. 600 m is high for Britain.",
    reference="UK orographic convection studies; Met Office terrain "
              "climatology",
    limitations="Elevation alone is not orographic forcing -- upslope flow "
                "is required, and that needs a wind direction relative to "
                "terrain slope which a single column does not have.",
)

T_MIDLEVEL_MOIST = Transfer(
    name="midlevel_moist", feature="mid_level_rh", unit="%",
    shape=Shape.LOGISTIC, low=40.0, high=75.0,
    reasoning="Deep saturation through the mid-troposphere is characteristic "
              "of frontal and strongly forced convection, as distinct from "
              "the dry mid-levels of airmass and plume regimes.",
    reference="Standard frontal analysis",
)


# ---------------------------------------------------------------------------
# Regime definitions
# ---------------------------------------------------------------------------

class _NeedsGrid(Exception):
    """Raised internally for regimes a single column cannot diagnose."""


#: Regimes that CANNOT be diagnosed from one column, with what they need.
#: Recorded rather than guessed: inventing a sea-breeze affinity from
#: vertical structure alone would be fabrication.
GEOGRAPHIC_REGIMES: dict[str, str] = {
    "sea_breeze": (
        "needs distance to coastline and the land-sea temperature contrast; "
        "a single column cannot see a coast"
    ),
    "convergence_line": (
        "needs horizontal wind convergence, which requires neighbouring grid "
        "cells"
    ),
    "frontal": (
        "needs horizontal temperature gradient and frontogenesis, which "
        "require neighbouring grid cells"
    ),
    "strongly_forced_synoptic": (
        "needs large-scale vertical motion and geopotential gradients, which "
        "require neighbouring grid cells"
    ),
    "post_frontal": (
        "needs cold advection, which requires neighbouring grid cells; the "
        "airmass signature alone is shared with the maritime regime"
    ),
}


def _regime_factors(context: EngineContext, features) -> dict[str, list[Factor]]:
    """The ingredient list for each column-diagnosable regime."""
    f = features.get
    hour = context.local_hour
    night_hour = None
    if hour is not None:
        # Map onto a 22-30 axis so the nocturnal band does not wrap midnight.
        night_hour = hour + 24.0 if hour < 12.0 else hour

    mucape = f("mucape")
    sbcape = f("sbcape")
    separation = (
        mucape - sbcape if mucape is not None and sbcape is not None else None
    )

    return {
        "high_cape_surface_based": [
            Factor(T_SBCAPE_HIGH, sbcape),
            Factor(T_CIN_WEAK, f("sbcin")),
            Factor(T_LCL_BELOW_PBL, f("lcl_above_pbl")),
            Factor(T_DAYTIME, hour),
        ],
        "low_cape_high_shear": [
            Factor(T_CAPE_MODEST, mucape),
            Factor(T_SHEAR_DEEP_STRONG, f("shear_0_6km")),
        ],
        "elevated": [
            Factor(T_ELEVATED_SEPARATION, separation),
            Factor(T_CIN_STRONG, f("sbcin")),
            Factor(T_MUCAPE_HIGH, mucape),
        ],
        "spanish_plume": [
            Factor(T_LAPSE_MID_STEEP, f("lr_700_500")),
            Factor(T_MUCAPE_HIGH, mucape),
            Factor(T_CIN_STRONG, f("sbcin")),
            Factor(T_FREEZING_HIGH, f("freezing_level")),
            Factor(T_PW_HIGH, f("precipitable_water")),
        ],
        "maritime": [
            Factor(T_LAPSE_LOW_STEEP, f("lr_0_3km")),
            Factor(T_FREEZING_LOW, f("freezing_level")),
            Factor(T_LCL_LOW, f("lcl")),
            Factor(T_CAPE_MODEST, mucape),
        ],
        "orographic": [
            Factor(T_ELEVATION_HIGH, f("elevation")),
            Factor(T_MUCAPE_HIGH, mucape),
            Factor(T_LCL_LOW, f("lcl")),
        ],
        "nocturnal": [
            Factor(T_NIGHT, night_hour),
            Factor(T_ELEVATED_SEPARATION, separation),
            Factor(T_MUCAPE_HIGH, mucape),
        ],
    }


class WeatherRegimeEngine(Engine):
    """Identifies overlapping convective-regime affinities.

    See the module docstring for the full scientific audit.
    """

    name = "weather_regime"
    version = "1.0"
    score_kind = ScoreKind.CLASS_AFFINITY
    question = (
        "What kind of convective environment is present? Affinities across "
        "named regimes, deliberately not mutually exclusive."
    )
    consumes_diagnostics = (
        "sbcape", "mucape", "sbcin", "lcl", "pbl_depth", "lr_0_3km",
        "lr_700_500", "shear_0_6km", "freezing_level", "precipitable_water",
        "entrainment_indicators",
    )

    #: An affinity at or above this is worth naming as present.
    PRESENT = 0.45
    #: Regimes within this of the leader count as ambiguous with it.
    AMBIGUITY_BAND = 0.15

    def evaluate(self, context: EngineContext) -> EngineResult:
        features = context.features.get("set")
        if features is None:
            return self._insufficient("no shared feature set was built")

        affinities: dict[str, float] = {}
        compositions = {}
        unavailable: dict[str, str] = dict(GEOGRAPHIC_REGIMES)
        # Built once: the factor list is not free to construct and the
        # completeness figure below needs the same list, not a second one.
        wanted = _regime_factors(context, features)

        for regime, factors in wanted.items():
            composition = compose(Rule.INGREDIENTS, factors,
                                  minimum_factors=2)
            if composition is None:
                unavailable[regime] = (
                    f"fewer than two of its defining features were "
                    f"available (missing: "
                    f"{', '.join(f.transfer.feature for f in factors if f.membership is None)})"
                )
                continue
            affinities[regime] = round(composition.value, 4)
            compositions[regime] = composition

        if not affinities:
            return self._insufficient(
                "no regime could be evaluated: the profile supports fewer "
                "than two defining features for every regime",
                missing=features.missing("mucape", "sbcape", "lcl"),
            )

        ranked = sorted(affinities.items(), key=lambda kv: -kv[1])
        leader, leading_value = ranked[0]

        # -- ambiguity: a real property of the atmosphere, not a fault -------
        close = [
            name for name, value in ranked[1:]
            if leading_value - value <= self.AMBIGUITY_BAND and value > 0.2
        ]
        ambiguity = round(min(1.0, len(close) / 3.0), 3) if close else 0.0

        # -- completeness: how much of the definition we could actually see --
        evaluated = sum(len(c.factors) for c in compositions.values())
        requested = sum(len(v) for v in wanted.values())
        completeness = evaluated / requested if requested else 0.0

        # Confidence is about the ENGINE's trust in its own answer, so it
        # falls both when inputs were missing and when several regimes are
        # equally plausible. Uncertainty is reported separately and is NOT
        # 1 - confidence: the two move for different reasons.
        confidence = round(completeness * (1.0 - 0.4 * ambiguity), 3)
        uncertainty = round(
            min(1.0, 0.6 * (1.0 - completeness) + 0.5 * ambiguity), 3
        )

        status = EngineStatus.AVAILABLE
        flags: list[str] = []
        if completeness < 0.7:
            status = EngineStatus.DEGRADED
            flags.append(
                f"only {completeness:.0%} of the defining features across all "
                f"regimes were available"
            )
        if leading_value < self.PRESENT:
            status = EngineStatus.LOW_CONFIDENCE
            flags.append(
                f"no regime reaches {self.PRESENT:.2f}; this atmosphere does "
                f"not resemble any defined convective regime, which is a "
                f"common and legitimate state"
            )
        if ambiguity > 0.3:
            flags.append(
                f"{len(close)} regime(s) within {self.AMBIGUITY_BAND:.2f} of "
                f"the leader -- genuinely mixed, not a failure"
            )

        explanation = self._explain(ranked, compositions, close, unavailable)

        # Contributions come from the LEADING regime's composition, so the
        # named features are the ones that actually decided the label.
        contributions = compositions[leader].contributions

        return self._result(
            score=leading_value,
            status=status,
            classes=affinities,
            confidence=confidence,
            uncertainty=uncertainty,
            contributions=contributions,
            quality_flags=tuple(flags),
            explanation=tuple(explanation),
            reason="; ".join(flags) if status is not EngineStatus.AVAILABLE
            else "",
            extra={
                "leading_regime": leader,
                "present": [n for n, v in ranked if v >= self.PRESENT],
                "ambiguous_with": close,
                "regime_ambiguity": ambiguity,
                "feature_completeness": round(completeness, 3),
                "not_diagnosable": unavailable,
                "affinities_do_not_sum_to_one": True,
                "note": (
                    "affinities are independent memberships, not a "
                    "probability distribution over exclusive classes"
                ),
            },
        )

    def _explain(self, ranked, compositions, close, unavailable) -> list[str]:
        out: list[str] = []
        leader, value = ranked[0]
        readable = leader.replace("_", " ")
        if value >= self.PRESENT:
            composition = compositions[leader]
            supporting = [
                c for c in composition.contributions
                if c.direction == "supporting"
            ]
            if supporting:
                names = ", ".join(
                    f"{c.feature} {c.value:.0f}" if c.value is not None
                    else c.feature
                    for c in supporting[:3]
                )
                out.append(
                    f"{readable} affinity {value:.2f}, supported by {names}"
                )
            else:
                out.append(f"{readable} affinity {value:.2f}")
            limiting = composition.limiting
            if limiting is not None and limiting.membership < 0.4:
                out.append(
                    f"held back by {limiting.transfer.feature} "
                    f"({limiting.value:.0f} {limiting.transfer.unit})"
                    if limiting.value is not None else
                    f"held back by {limiting.transfer.feature}"
                )
        else:
            out.append(
                f"no regime is clearly present; the closest is {readable} at "
                f"{value:.2f}"
            )
        if close:
            out.append(
                "overlapping with " + ", ".join(
                    c.replace("_", " ") for c in close
                )
            )
        if unavailable:
            out.append(
                f"{len(unavailable)} regime(s) need horizontal or geographic "
                f"information a single column does not have"
            )
        return out


ENGINE = register(WeatherRegimeEngine())

#: Every regime the architecture defines, diagnosable or not. Exposed so the
#: later aggregation stage knows the full space rather than only what one
#: profile happened to support.
ALL_REGIMES: tuple[str, ...] = tuple(
    sorted(
        set(GEOGRAPHIC_REGIMES)
        | {
            "high_cape_surface_based", "low_cape_high_shear", "elevated",
            "spanish_plume", "maritime", "orographic", "nocturnal",
        }
    )
)
