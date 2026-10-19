"""What TCM means by "a thunderstorm".

Section 3 requires this to be defined BEFORE any probability is built,
because a probability model without a defined target is not a model of
anything. Section 1 adds the harder constraint: the definition must match
the observations that will eventually verify it, or the forecast is
unfalsifiable.

THE DEFINITION
--------------
A thunderstorm occurs in a cell and hour when AT LEAST ONE cloud-to-ground
or intra-cloud lightning discharge is detected within `radius_km` of the
cell centre during the hour.

Every clause is doing work:

**Lightning, not rain.** Section 2. Rainfall is not a thunderstorm proxy in
either direction: a slow-moving warm-rain shower can drop 20 mm without a
single flash, and a high-based summer storm over the Pennines can produce
fifty flashes and barely wet the ground. Defining the event by precipitation
would make the platform a rainfall forecaster wearing a thunderstorm label.

**One flash, not a rate.** A rate threshold sounds more meaningful and is
not: it makes the event definition depend on detection efficiency, which
varies across the domain with range from the sensor network. One flash is
the least detector-dependent statement available.

**A radius, not the cell.** A storm 3 km outside a 2 km cell is not a
forecast failure in any sense a user cares about. Verifying on exact cell
coincidence measures the placement of a 2 km grid against a chaotic system
and rewards nothing. `radius_km` defaults to 10 km, and section 64 requires
neighbourhood verification for the same reason.

**An hour, not an instant.** Convective cells last tens of minutes. An
instantaneous target would be almost entirely a timing forecast.

WHAT THE DEFINITION DELIBERATELY DOES NOT DO
---------------------------------------------
It does not require the storm to be surface-based, or deep, or long-lived,
or to have produced any hazard. Those are separate questions with separate
engines. Elevated nocturnal convection producing three flashes over the
North Sea is a thunderstorm under this definition, and should be: it is
electrically active deep convection, which is exactly what the primary
target names.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import Enum


class Evidence(str, Enum):
    """What observational evidence verifies the event."""

    #: A lightning detection network. The primary and preferred source.
    LIGHTNING = "lightning"
    #: Radar reflectivity above a convective threshold. A FALLBACK, and a
    #: weaker one: it detects deep convection, not electrification, and the
    #: two are not the same event.
    RADAR_CONVECTIVE = "radar_convective"


@dataclass(frozen=True, slots=True)
class ThunderstormEvent:
    """The operational definition of the primary forecast target."""

    #: Detections within this distance of the cell centre count.
    radius_km: float = 10.0
    #: The window a detection must fall in.
    window: timedelta = timedelta(hours=1)
    #: How many detections are required.
    minimum_flashes: int = 1
    evidence: Evidence = Evidence.LIGHTNING
    #: Detection efficiency is not uniform with range from the network, and
    #: a verification that ignores it learns the network's geometry. Recorded
    #: so a later verification pass can account for it.
    detection_efficiency_varies: bool = True

    @property
    def name(self) -> str:
        return "thunderstorm"

    def describe(self) -> str:
        return (
            f"at least {self.minimum_flashes} lightning discharge(s) "
            f"detected within {self.radius_km:.0f} km of the cell centre "
            f"during a {self.window.total_seconds() / 3600:.0f}-hour window"
        )

    def to_dict(self) -> dict:
        return {
            "event": self.name,
            "definition": self.describe(),
            "radius_km": self.radius_km,
            "window_hours": self.window.total_seconds() / 3600.0,
            "minimum_flashes": self.minimum_flashes,
            "evidence": self.evidence.value,
            "not_defined_by": (
                "precipitation. Rain is not a thunderstorm proxy in either "
                "direction, and defining the event by rainfall would make "
                "this a rainfall forecast wearing a thunderstorm label"
            ),
            "deliberately_not_required": [
                "surface-based convection -- elevated storms count",
                "a minimum depth, duration or intensity",
                "any hazard -- those are separate targets",
            ],
            "verification_caveats": [
                "detection efficiency varies with range from the network; a "
                "verification that ignores it learns the network geometry",
                "neighbourhood verification is required (section 64): a "
                "storm one cell away is not the same failure as a storm "
                "1000 km away",
            ],
        }


#: The platform's definition. One object, referenced everywhere, so the
#: forecast target and the verification target cannot drift apart.
THUNDERSTORM = ThunderstormEvent()


@dataclass(frozen=True, slots=True)
class HazardEvent:
    """A hazard target, and its relationship to the primary event."""

    name: str
    definition: str
    #: The Stage 5 engine that supplies the conditional.
    engine: str
    #: True when the hazard cannot occur without a thunderstorm under these
    #: definitions, so P(hazard) <= P(thunderstorm) is REQUIRED.
    requires_thunderstorm: bool
    #: The hazard this one is a strict subset of, if any.
    subset_of: str = ""
    verification: str = ""
    caveat: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "definition": self.definition,
            "engine": self.engine,
            "conditional_on_thunderstorm": self.requires_thunderstorm,
            "subset_of": self.subset_of or None,
            "verification": self.verification,
            "caveat": self.caveat or None,
        }


#: The hazard targets, and their event relationships.
#:
#: Section 55 warns against ASSUMING a hierarchy. Each relationship below is
#: stated deliberately, and two of them are not what a naive nesting would
#: give:
#:
#:   * lightning is NOT conditional on the thunderstorm event -- under this
#:     definition it IS the thunderstorm event, so its probability equals
#:     the primary probability rather than being a fraction of it
#:   * the tornado target is an ENVIRONMENT, not an occurrence, so it is not
#:     a subset of anything and must never be read as P(tornado)
HAZARDS: dict[str, HazardEvent] = {
    "lightning": HazardEvent(
        name="lightning",
        definition=(
            "identical to the thunderstorm event under this definition, "
            "since the event is defined BY lightning detection"
        ),
        engine="lightning",
        requires_thunderstorm=True,
        verification="lightning detection network",
        caveat=(
            "reported for completeness and to keep the output schema "
            "uniform. It is NOT independent evidence and must not be "
            "combined with the thunderstorm probability as though it were"
        ),
    ),
    "hail": HazardEvent(
        name="hail",
        definition="hail of any size reaching the surface in the cell/hour",
        engine="hail",
        requires_thunderstorm=True,
        verification="reports and dual-polarisation radar signatures",
        caveat=(
            "reports are population-biased: hail over the Pennines is "
            "under-reported relative to hail over Birmingham"
        ),
    ),
    "severe_hail": HazardEvent(
        name="severe_hail",
        definition="hail of 2 cm diameter or more reaching the surface",
        engine="hail",
        requires_thunderstorm=True,
        subset_of="hail",
        verification="reports, radar",
    ),
    "severe_wind": HazardEvent(
        name="severe_wind",
        definition="a convective gust at or above a damaging threshold",
        engine="severe_wind",
        requires_thunderstorm=True,
        verification="surface observations attributed to convection",
        caveat=(
            "separating convective from synoptic gusts is the hardest part "
            "of this target over the UK, where the two coincide in autumn"
        ),
    ),
    "downburst": HazardEvent(
        name="downburst",
        definition="a concentrated evaporatively driven downdraught reaching "
                   "the surface",
        engine="downburst",
        requires_thunderstorm=True,
        # NOT a subset of severe_wind: a downburst can produce a gust below
        # the severe threshold, and severe convective wind can arise from
        # momentum transfer with no downburst at all. Section 55 warns
        # against assuming the nesting, and this is the case it means.
        verification="radar low-level divergence signatures",
        caveat=(
            "deliberately NOT nested under severe_wind. A downburst can "
            "produce a sub-severe gust, and severe convective wind can come "
            "from momentum transfer without one"
        ),
    ),
    "heavy_rainfall": HazardEvent(
        name="heavy_rainfall",
        definition="convective rainfall rate above a high-impact threshold",
        engine="heavy_rainfall",
        requires_thunderstorm=True,
        verification="radar-gauge merged analysis at sub-hourly resolution",
        caveat=(
            "heavy convective rainfall also occurs WITHOUT lightning. This "
            "target is conditioned on the thunderstorm event, so it "
            "necessarily understates total heavy-rain risk"
        ),
    ),
    "tornado_environment": HazardEvent(
        name="tornado_environment",
        definition=(
            "an environment supportive of tornadic convection, GIVEN that "
            "convection occurs"
        ),
        engine="tornado_environment",
        requires_thunderstorm=True,
        verification=(
            "TORRO database events, used to characterise favourable "
            "ENVIRONMENTS rather than to fit occurrence"
        ),
        caveat=(
            "this is NOT P(tornado). Tornadogenesis depends on storm-scale "
            "processes no environmental diagnostic resolves, and the base "
            "rate is so low that an occurrence model would be dominated by "
            "it. Reading this as an occurrence probability is a misuse"
        ),
    ),
}


def nesting_constraints() -> list[tuple[str, str]]:
    """Pairs (a, b) for which P(a) <= P(b) is REQUIRED by the definitions.

    Only where the event definitions mathematically force it -- section 54.
    Notably absent: downburst under severe_wind, which is not a subset.
    """
    out: list[tuple[str, str]] = []
    for hazard in HAZARDS.values():
        if hazard.requires_thunderstorm:
            out.append((hazard.name, "thunderstorm"))
        if hazard.subset_of:
            out.append((hazard.name, hazard.subset_of))
    return out


def to_dict() -> dict:
    return {
        "primary": THUNDERSTORM.to_dict(),
        "hazards": {name: h.to_dict() for name, h in HAZARDS.items()},
        "nesting_constraints": [
            {"lesser": a, "not_greater_than": b}
            for a, b in nesting_constraints()
        ],
        "note": (
            "the hierarchy is DOCUMENTED, not assumed. Downburst is "
            "deliberately not nested under severe wind, and the tornado "
            "target is an environment rather than an occurrence"
        ),
    }
