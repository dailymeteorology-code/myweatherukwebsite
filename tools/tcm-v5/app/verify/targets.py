"""What is being verified, and against what.

Step 5 of the Stage 9 order, sections 14 to 20.

Section 21 forbids calculating metrics blindly and requires every metric to
be tied to a clear forecast target and event definition. This module is the
register of those targets. Nothing may be scored that is not declared here,
which makes "what exactly was measured?" a question with a written answer.

DECLARING A TARGET WE CANNOT MEASURE IS THE POINT
-------------------------------------------------
Most of these targets have no observations connected. Listing them anyway,
each with the specific data that would unblock it, is more useful than
listing only the one that works: it turns "TCM is unverified" from a vague
admission into a list of five named datasets.

`available()` returns only the targets that can actually be scored today.
`blocked()` returns the rest with their reasons, and the API publishes both.

THE TWO TRAPS THIS REGISTER EXISTS TO AVOID
-------------------------------------------
Section 14: rainfall is not a thunderstorm. The observed event must be
lightning, and `THUNDERSTORM.observation` says so.

Section 19: a tornado-supportive ENVIRONMENT and an observed tornado are
different targets and must not meet inside one metric. Stage 7 forecasts the
environment; verifying it against occurrence reports would score a forecast
against something it never claimed. `TORNADO_ENVIRONMENT` is declared with
`verifiable=False` and a reason, rather than quietly scored against the
wrong thing.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from enum import Enum

from .observations import ObsSource

log = logging.getLogger(__name__)

TARGETS_VERSION = "stage9.1"


class TargetKind(str, Enum):
    """What sort of quantity is being verified. Section 21.

    The kind decides which metrics are meaningful: a Brier score on a
    continuous field is a category error, and section 23 says so directly.
    """

    #: A binary occurrence. Brier, BSS, ROC-AUC, PR-AUC, POD/FAR/CSI.
    EVENT = "event"
    #: A continuous field. Bias, MAE, RMSE, correlation.
    CONTINUOUS = "continuous"
    #: An environmental classification, NOT an occurrence. Section 19.
    ENVIRONMENT = "environment"


#: Metrics that are meaningful for each kind. `metrics_for` enforces it, so
#: a Brier score cannot be requested for a temperature field.
METRICS_BY_KIND: dict[TargetKind, tuple[str, ...]] = {
    TargetKind.EVENT: (
        "brier_score", "brier_skill_score", "roc_auc", "pr_auc",
        "reliability", "sharpness", "pod", "far", "csi",
    ),
    TargetKind.CONTINUOUS: ("bias", "mae", "rmse", "correlation"),
    TargetKind.ENVIRONMENT: ("roc_auc", "pr_auc", "reliability"),
}


@dataclass(frozen=True, slots=True)
class Target:
    """One thing TCM forecasts, and how it would be verified."""

    name: str
    kind: TargetKind
    #: What is forecast, in words a forecaster would recognise.
    forecast_quantity: str
    #: The event or field as it would be OBSERVED. For an event this is the
    #: operational definition and must match Stage 7's.
    observation: str
    #: Which observing system supplies it.
    source: ObsSource
    unit: str = "1"
    #: Whether the observations are connected today.
    verifiable: bool = False
    #: What is missing, or what makes the target unscoreable in principle.
    blocked_by: str = ""
    #: Limitations that survive even when the data arrives. Section 95.
    caveats: tuple[str, ...] = ()
    #: Threshold defining the event, fixed BEFORE verification. Section 17
    #: forbids changing it after seeing results.
    threshold: str = ""

    def metrics(self) -> tuple[str, ...]:
        return METRICS_BY_KIND[self.kind]

    def to_dict(self) -> dict:
        return {
            "target": self.name,
            "kind": self.kind.value,
            "forecast_quantity": self.forecast_quantity,
            "observed_as": self.observation,
            "observation_source": self.source.value,
            "unit": self.unit,
            "threshold": self.threshold or None,
            "verifiable_today": self.verifiable,
            "blocked_by": self.blocked_by or None,
            "applicable_metrics": list(self.metrics()),
            "caveats": list(self.caveats),
        }


# --------------------------------------------------------------------------
# Section 14 and 15 -- the one target that can be scored
# --------------------------------------------------------------------------

THUNDERSTORM = Target(
    name="thunderstorm",
    kind=TargetKind.EVENT,
    forecast_quantity="probability of a thunderstorm",
    observation=(
        "at least one detected lightning flash within 10 km of the cell "
        "centre during the hour"
    ),
    source=ObsSource.LIGHTNING_NETWORK,
    verifiable=True,
    threshold="1 flash within 10 km in 1 hour",
    caveats=(
        "detection efficiency falls with range from the sensor network, so "
        "a quiet hour in a poorly covered area is not a verified null -- "
        "which is why observation coverage gates the negative case",
        "rainfall is NOT used and must never be: a warm-rain shower drops "
        "20 mm without a flash, and a high-based storm flashes fifty times "
        "and barely wets the ground",
    ),
)

LIGHTNING_DENSITY = Target(
    name="lightning_density",
    kind=TargetKind.CONTINUOUS,
    forecast_quantity="flash density",
    observation="detected flashes per cell per hour",
    source=ObsSource.LIGHTNING_NETWORK,
    unit="flashes/hour",
    verifiable=False,
    blocked_by=(
        "occurrence is verifiable but COUNTS are not: an hour with partial "
        "coverage undercounts by an unknown factor, and 9 of the 31 "
        "archived hours are partially covered. Verifying density would "
        "score the forecast against a systematic undercount"
    ),
    caveats=(
        "would need either full-coverage hours only, or a detection- "
        "efficiency model to correct the counts",
    ),
)


# --------------------------------------------------------------------------
# Sections 16 to 18 -- hazards with no observations connected
# --------------------------------------------------------------------------

HAIL = Target(
    name="hail",
    kind=TargetKind.EVENT,
    forecast_quantity="probability of hail at the surface",
    observation="a verified hail report or a radar hail signature",
    source=ObsSource.SEVERE_REPORT,
    verifiable=False,
    blocked_by="no hail report archive and no radar feed are connected",
    threshold="any hail reaching the surface",
    caveats=(
        "section 16: absence of a report is NOT absence of hail. Reports "
        "are population-dependent, so an unreported rural hailstorm looks "
        "identical to no hailstorm and every skill number computed from "
        "reports is biased towards populated areas",
        "verification would need to treat a null as UNKNOWN over sparsely "
        "populated ground, in the same way lightning coverage does",
    ),
)

SEVERE_HAIL = Target(
    name="severe_hail",
    kind=TargetKind.EVENT,
    forecast_quantity="probability of hail 2 cm or larger",
    observation="a verified report of hail 2 cm or larger",
    source=ObsSource.SEVERE_REPORT,
    verifiable=False,
    blocked_by="no hail report archive is connected",
    threshold="2 cm maximum diameter, fixed before any verification",
    caveats=(
        "rarer than hail and therefore worse affected by reporting bias",
        "section 61: multi-year samples and interval estimates are "
        "mandatory for a target this rare",
    ),
)

SEVERE_WIND = Target(
    name="severe_wind",
    kind=TargetKind.EVENT,
    forecast_quantity="probability of a severe convective wind gust",
    observation="a station gust at or above the threshold",
    source=ObsSource.SURFACE_STATION,
    unit="m/s",
    verifiable=False,
    blocked_by="no surface station archive is connected",
    threshold=(
        "25 m/s (48 kt) maximum gust, declared here BEFORE verification. "
        "Section 17 forbids moving it after seeing results"
    ),
    caveats=(
        "the station network is far coarser than a convective gust "
        "footprint, so a real downburst between stations is unobserved",
        "separating a CONVECTIVE gust from a synoptic one needs the storm "
        "context, not just the wind speed",
    ),
)

HEAVY_RAINFALL = Target(
    name="heavy_rainfall",
    kind=TargetKind.EVENT,
    forecast_quantity="probability of heavy convective rainfall",
    observation="gauge or radar-derived accumulation above the threshold",
    source=ObsSource.RAIN_GAUGE,
    unit="mm/h",
    verifiable=False,
    blocked_by="no gauge archive and no radar feed are connected",
    threshold="20 mm in one hour, declared before verification",
    caveats=(
        "section 18: CONVECTIVE rainfall must be separated from all "
        "rainfall, or a frontal band verifies a convective forecast",
        "gauges are points and convective rainfall gradients are sharper "
        "than the network resolves",
    ),
)

DOWNBURST = Target(
    name="downburst",
    kind=TargetKind.EVENT,
    forecast_quantity="probability of a downburst",
    observation="a damage survey or a radar divergence signature",
    source=ObsSource.SEVERE_REPORT,
    verifiable=False,
    blocked_by="no damage survey archive and no radar feed are connected",
    caveats=(
        "a downburst can produce a sub-severe gust, so it is NOT a subset "
        "of severe wind and must not be verified against that threshold",
    ),
)


# --------------------------------------------------------------------------
# Section 19 -- the target that must not be scored against occurrence
# --------------------------------------------------------------------------

TORNADO_ENVIRONMENT = Target(
    name="tornado_environment",
    kind=TargetKind.ENVIRONMENT,
    forecast_quantity=(
        "how supportive the environment is of tornadogenesis, given a storm"
    ),
    observation=(
        "an environmental classification from observed soundings or a "
        "trusted analysis -- NOT tornado occurrence"
    ),
    source=ObsSource.RADIOSONDE,
    verifiable=False,
    blocked_by=(
        "there is no environmental-classification dataset, and the "
        "available alternative is the wrong target"
    ),
    caveats=(
        "SECTION 19: environmental favourability and observed occurrence "
        "are different targets and must never meet inside one metric. "
        "Verifying this against tornado reports would score the forecast "
        "against something it never claimed -- most tornado-supportive "
        "environments correctly produce no tornado, and counting those as "
        "false alarms would be measuring the wrong thing",
        "UK tornado reports are sparse and largely non-supercellular, so "
        "they would not verify this quantity even if they were plentiful",
    ),
)


# --------------------------------------------------------------------------
# Section 20 -- continuous fields
# --------------------------------------------------------------------------

def _continuous(name, quantity, unit, source, blocked, *caveats) -> Target:
    return Target(
        name=name, kind=TargetKind.CONTINUOUS, forecast_quantity=quantity,
        observation=f"measured {quantity}", source=source, unit=unit,
        verifiable=False, blocked_by=blocked, caveats=tuple(caveats),
    )


_NO_STATIONS = "no surface station archive is connected"
_NO_SONDES = "no radiosonde archive is connected"

#: Why the obvious shortcut is not taken. This is worth stating once,
#: because it is the tempting mistake and it is invisible in the output.
_ANALYSIS_WARNING = (
    "a model ANALYSIS cannot verify that same model: it contains the "
    "model's own information, and the resulting score measures internal "
    "consistency rather than accuracy. With only UKV ingested there is no "
    "independent analysis to use, so this target stays blocked rather than "
    "being scored against UKV's own T+0"
)

TEMPERATURE = _continuous(
    "temperature_2m", "screen temperature", "K",
    ObsSource.SURFACE_STATION, _NO_STATIONS, _ANALYSIS_WARNING)
DEWPOINT = _continuous(
    "dewpoint_2m", "screen dew point", "K",
    ObsSource.SURFACE_STATION, _NO_STATIONS, _ANALYSIS_WARNING)
WIND_10M = _continuous(
    "wind_10m", "10 m wind", "m/s",
    ObsSource.SURFACE_STATION, _NO_STATIONS, _ANALYSIS_WARNING)
PRECIPITATION = _continuous(
    "precipitation", "hourly precipitation accumulation", "mm",
    ObsSource.RAIN_GAUGE, "no gauge archive is connected")
CAPE = _continuous(
    "cape", "surface-based CAPE", "J/kg", ObsSource.RADIOSONDE, _NO_SONDES,
    "CAPE is DERIVED from a sounding, not measured, so verifying it "
    "compares two parcel calculations. The comparison is still worth "
    "making, but the reference is not ground truth",
    "UK radiosonde launches are twice daily at a handful of sites, which "
    "will rarely coincide with a convective environment of interest")
CIN = _continuous(
    "cin", "convective inhibition", "J/kg", ObsSource.RADIOSONDE, _NO_SONDES,
    "even more sensitive to the parcel definition than CAPE: a small "
    "difference in the mixed-layer depth changes it substantially")
SHEAR = _continuous(
    "shear_0_6km", "0-6 km bulk shear", "m/s",
    ObsSource.RADIOSONDE, _NO_SONDES)
BOUNDARY_LAYER = _continuous(
    "boundary_layer_height", "boundary-layer depth", "m",
    ObsSource.RADIOSONDE, _NO_SONDES,
    "the model's boundary layer is defined by its own turbulence scheme, "
    "so a sonde-derived depth is a different quantity computed a different "
    "way rather than the same one measured")


#: Every declared target, in the order they matter.
TARGETS: dict[str, Target] = {
    t.name: t for t in (
        THUNDERSTORM, LIGHTNING_DENSITY,
        HAIL, SEVERE_HAIL, SEVERE_WIND, HEAVY_RAINFALL, DOWNBURST,
        TORNADO_ENVIRONMENT,
        TEMPERATURE, DEWPOINT, WIND_10M, PRECIPITATION,
        CAPE, CIN, SHEAR, BOUNDARY_LAYER,
    )
}


def get(name: str) -> Target:
    if name not in TARGETS:
        raise KeyError(
            f"{name!r} is not a declared verification target. Section 21: "
            f"nothing may be scored that is not declared. Known targets: "
            f"{sorted(TARGETS)}"
        )
    return TARGETS[name]


def available() -> list[Target]:
    """Targets that can be scored today."""
    return [t for t in TARGETS.values() if t.verifiable]


def blocked() -> list[Target]:
    """Targets that cannot, each with what is missing."""
    return [t for t in TARGETS.values() if not t.verifiable]


def metrics_for(target_name: str) -> tuple[str, ...]:
    """Which metrics are meaningful for this target. Section 23.

    A Brier score on a continuous field is a category error, and asking for
    one raises rather than returning a number.
    """
    return get(target_name).metrics()


def check_metric(target_name: str, metric: str) -> None:
    """Raise if this metric is meaningless for this target."""
    target = get(target_name)
    if metric not in target.metrics():
        raise ValueError(
            f"{metric!r} is not meaningful for {target_name!r}, which is a "
            f"{target.kind.value} target. Section 21 forbids calculating "
            f"metrics blindly; applicable metrics are {list(target.metrics())}"
        )


def describe() -> dict:
    """The whole register, for the API and for the audit."""
    unblocking: dict[str, list[str]] = {}
    for target in blocked():
        if target.blocked_by:
            unblocking.setdefault(target.blocked_by, []).append(target.name)

    return {
        "version": TARGETS_VERSION,
        "verifiable": [t.to_dict() for t in available()],
        "blocked": [t.to_dict() for t in blocked()],
        "counts": {
            "declared": len(TARGETS),
            "verifiable": len(available()),
            "blocked": len(blocked()),
        },
        "what_would_unblock_what": [
            {"needs": need, "unblocks": sorted(names)}
            for need, names in sorted(
                unblocking.items(), key=lambda kv: -len(kv[1])
            )
        ],
        "note": (
            "targets with no observations are declared anyway. Listing them "
            "turns 'TCM is unverified' from an admission into a list of "
            "named datasets, each of which unblocks specific targets"
        ),
    }
