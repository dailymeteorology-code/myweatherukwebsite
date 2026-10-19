"""The verification record: forecasts matched to observations, in time.

THE ONE RULE THAT MATTERS
-------------------------
A weight generated for a forecast issued at time T may use only verification
that was AVAILABLE at T.

This sounds obvious and is the easiest thing in an adaptive system to get
wrong, because nothing fails when you get it wrong -- the backtest simply
looks better than the system can ever be. Every record therefore carries
`available_at`, distinct from `valid_time` and from `observed_at`:

    valid_time    when the forecast was for
    observed_at   when the observation was taken
    available_at  when the observation reached us and could have been learned
                  from

`available_at` is later than `observed_at`, sometimes by hours (gauge
networks, storm reports) and sometimes by weeks (quality-controlled
archives). Using `observed_at` as the cutoff is a subtle leak that inflates
apparent skill.

`SkillQuery.as_of` is a required argument. There is no default, because a
default would be used.

MATCHING
--------
`match()` refuses to pair a forecast with an observation whose valid time
does not correspond, and refuses to pair across a location tolerance it was
not given. Both refusals return a reason rather than a silent drop, because
a verification set that quietly halved is far more dangerous than one that
failed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta
from enum import Enum

import numpy as np

from .identity import ModelIdentity
from .metrics import ForecastKind

log = logging.getLogger(__name__)


class ObservationSource(str, Enum):
    """Where an observation came from. NOT all equally reliable."""

    SURFACE_STATION = "surface_station"
    RADIOSONDE = "radiosonde"
    RADAR = "radar"
    LIGHTNING_NETWORK = "lightning_network"
    RAIN_GAUGE = "rain_gauge"
    SATELLITE = "satellite"
    STORM_REPORT = "storm_report"
    #: An analysis, usable only with care -- see `ObservationRecord`.
    ANALYSIS = "analysis"


class ObservationQuality(str, Enum):
    GOOD = "good"
    #: Usable but with a known limitation recorded in `quality_notes`.
    SUSPECT = "suspect"
    #: Failed QC. Must never enter a skill calculation.
    REJECTED = "rejected"

    @property
    def usable(self) -> bool:
        return self is not ObservationQuality.REJECTED


#: How much each source can be trusted, before its own QC. Not a weight in a
#: sum -- it decides which observations may verify which quantities, and
#: gates the confidence attached to skill learned from them.
SOURCE_RELIABILITY: dict[ObservationSource, float] = {
    ObservationSource.RADIOSONDE: 1.00,
    ObservationSource.SURFACE_STATION: 0.95,
    ObservationSource.LIGHTNING_NETWORK: 0.90,
    ObservationSource.RADAR: 0.80,
    ObservationSource.RAIN_GAUGE: 0.85,
    ObservationSource.SATELLITE: 0.75,
    #: Population-biased and inconsistently reported. Usable for rare events
    #: because nothing else sees them, but never as though it were a
    #: measurement network.
    ObservationSource.STORM_REPORT: 0.50,
    #: An analysis is a model product. Using one to verify a model that fed
    #: it is circular, and the check lives in `ObservationRecord`.
    ObservationSource.ANALYSIS: 0.60,
}


@dataclass(frozen=True, slots=True)
class ObservationRecord:
    """One quality-controlled observation."""

    variable: str
    value: float
    observed_at: datetime
    #: When this became known to the platform. NOT `observed_at`.
    available_at: datetime
    latitude: float
    longitude: float
    source: ObservationSource
    quality: ObservationQuality = ObservationQuality.GOOD
    quality_notes: tuple[str, ...] = ()
    station_id: str = ""
    #: For an ANALYSIS source: which models fed it. Verifying one of those
    #: against it is circular and `is_circular_for` says so.
    assimilated_models: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.available_at < self.observed_at:
            raise ValueError(
                f"{self.variable}: available_at {self.available_at} precedes "
                f"observed_at {self.observed_at}. An observation cannot be "
                f"known before it is taken, and this ordering is what the "
                f"whole leakage guard rests on."
            )
        if self.quality is ObservationQuality.REJECTED \
                and not self.quality_notes:
            raise ValueError(
                f"{self.variable}: rejected without a reason"
            )

    def is_circular_for(self, model: ModelIdentity) -> bool:
        """True when verifying this model against this observation is
        circular -- the model's own output helped produce it."""
        if self.source is not ObservationSource.ANALYSIS:
            return False
        return (
            model.model in self.assimilated_models
            or model.system_key in self.assimilated_models
        )

    @property
    def source_reliability(self) -> float:
        return SOURCE_RELIABILITY.get(self.source, 0.5)

    def to_dict(self) -> dict:
        return {
            "variable": self.variable,
            "value": self.value,
            "observed_at": self.observed_at.isoformat(),
            "available_at": self.available_at.isoformat(),
            "latitude": self.latitude, "longitude": self.longitude,
            "source": self.source.value,
            "quality": self.quality.value,
            "quality_notes": list(self.quality_notes),
            "station_id": self.station_id or None,
        }


@dataclass(frozen=True, slots=True)
class ForecastRecord:
    """One forecast value, as issued."""

    model: ModelIdentity
    variable: str
    value: float
    #: The model cycle. Everything the forecast could have known predates it.
    issued_at: datetime
    valid_time: datetime
    latitude: float
    longitude: float
    #: The Stage 5 regime affinities AT FORECAST TIME. Section 16: the
    #: regime used to condition skill must come from the forecast, never
    #: from an after-the-fact analysis of what actually happened.
    regime: str = ""
    regime_confidence: float | None = None
    #: Stage 2/3 quality metadata, consumed rather than recomputed.
    data_quality: float | None = None
    interpolated: bool = False

    @property
    def lead_hours(self) -> float:
        return (self.valid_time - self.issued_at).total_seconds() / 3600.0

    def to_dict(self) -> dict:
        return {
            "model": self.model.key,
            "variable": self.variable,
            "value": self.value,
            "issued_at": self.issued_at.isoformat(),
            "valid_time": self.valid_time.isoformat(),
            "lead_hours": round(self.lead_hours, 2),
            "latitude": self.latitude, "longitude": self.longitude,
            "regime": self.regime or None,
            "data_quality": self.data_quality,
        }


@dataclass(frozen=True, slots=True)
class VerificationPair:
    """A forecast matched to the observation that verifies it."""

    forecast: ForecastRecord
    observation: ObservationRecord
    #: Distance between forecast point and observation, km.
    separation_km: float
    #: Difference between valid time and observation time, minutes.
    time_offset_minutes: float

    @property
    def error(self) -> float:
        return self.forecast.value - self.observation.value

    @property
    def available_at(self) -> datetime:
        """When this pair could first have been learned from."""
        return self.observation.available_at

    def known_by(self, when: datetime) -> bool:
        """Could a forecast issued at `when` have used this evidence?"""
        return self.available_at <= when

    def to_dict(self) -> dict:
        return {
            "forecast": self.forecast.to_dict(),
            "observation": self.observation.to_dict(),
            "separation_km": round(self.separation_km, 2),
            "time_offset_minutes": round(self.time_offset_minutes, 1),
            "error": round(self.error, 6),
            "available_at": self.available_at.isoformat(),
        }


EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    """Great-circle distance, km."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return float(2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a)))


@dataclass(slots=True)
class MatchReport:
    """Why pairs were made and why others were not.

    A verification set that quietly halved is more dangerous than one that
    failed outright, so every rejection is counted by reason.
    """

    paired: int = 0
    rejected: dict[str, int] = dc_field(default_factory=dict)

    def reject(self, reason: str) -> None:
        self.rejected[reason] = self.rejected.get(reason, 0) + 1

    @property
    def considered(self) -> int:
        return self.paired + sum(self.rejected.values())

    @property
    def pair_rate(self) -> float:
        return self.paired / self.considered if self.considered else 0.0

    def to_dict(self) -> dict:
        return {
            "paired": self.paired,
            "considered": self.considered,
            "pair_rate": round(self.pair_rate, 4),
            "rejected": dict(
                sorted(self.rejected.items(), key=lambda kv: -kv[1])
            ),
        }


def match(
    forecasts: list[ForecastRecord],
    observations: list[ObservationRecord],
    *,
    max_separation_km: float,
    max_time_offset_minutes: float,
    report: MatchReport | None = None,
) -> tuple[list[VerificationPair], MatchReport]:
    """Pair forecasts with the observations that verify them.

    Both tolerances are REQUIRED. A default would silently decide how far a
    forecast may be from its observation, which is a scientific choice
    specific to the variable: 50 km is generous for temperature and
    meaningless for a convective gust.

    Each forecast takes its NEAREST valid observation, and each observation
    is used at most once per model, so one dense station cluster cannot
    dominate a skill estimate.
    """
    report = report if report is not None else MatchReport()
    pairs: list[VerificationPair] = []

    by_variable: dict[str, list[ObservationRecord]] = {}
    for observation in observations:
        by_variable.setdefault(observation.variable, []).append(observation)

    used: set[tuple[str, int]] = set()

    for forecast in forecasts:
        candidates = by_variable.get(forecast.variable, [])
        if not candidates:
            report.reject(f"no observations for {forecast.variable}")
            continue

        best = None
        best_distance = float("inf")
        for index, observation in enumerate(candidates):
            if not observation.quality.usable:
                continue
            if observation.is_circular_for(forecast.model):
                continue
            offset = abs(
                (observation.observed_at - forecast.valid_time)
                .total_seconds() / 60.0
            )
            if offset > max_time_offset_minutes:
                continue
            distance = haversine_km(
                forecast.latitude, forecast.longitude,
                observation.latitude, observation.longitude,
            )
            if distance > max_separation_km:
                continue
            if (forecast.model.key, index) in used:
                continue
            if distance < best_distance:
                best, best_distance = (index, observation, offset), distance

        if best is None:
            report.reject(
                _why_unmatched(forecast, candidates, max_separation_km,
                               max_time_offset_minutes)
            )
            continue

        index, observation, offset = best
        used.add((forecast.model.key, index))
        pairs.append(VerificationPair(
            forecast=forecast, observation=observation,
            separation_km=best_distance, time_offset_minutes=offset,
        ))
        report.paired += 1

    return pairs, report


def _why_unmatched(forecast, candidates, max_km, max_minutes) -> str:
    """The most specific reason a forecast found no observation."""
    usable = [o for o in candidates if o.quality.usable]
    if not usable:
        return "all candidate observations failed quality control"
    if any(o.is_circular_for(forecast.model) for o in candidates):
        return (
            "the only candidate observations are analyses that assimilated "
            "this model, which would be circular"
        )
    in_time = [
        o for o in usable
        if abs((o.observed_at - forecast.valid_time).total_seconds() / 60.0)
        <= max_minutes
    ]
    if not in_time:
        return f"no observation within {max_minutes:.0f} minutes"
    return f"no observation within {max_km:.0f} km"


@dataclass(frozen=True, slots=True)
class SkillQuery:
    """What slice of history to learn skill from.

    `as_of` has NO DEFAULT. A default would be used, and using the wrong one
    silently makes every backtest optimistic.
    """

    as_of: datetime
    model: ModelIdentity | None = None
    variable: str = ""
    kind: ForecastKind = ForecastKind.CONTINUOUS
    #: Inclusive lead-time band, hours.
    lead_band: tuple[float, float] | None = None
    region: str = ""
    season: str = ""
    regime: str = ""
    #: How far back to look. None means the whole record.
    window: timedelta | None = None
    #: Minimum observation-source reliability to admit.
    min_source_reliability: float = 0.0

    def admits(self, pair: VerificationPair) -> bool:
        """Whether a pair belongs in this query.

        The `as_of` test comes first and is absolute.
        """
        if not pair.known_by(self.as_of):
            return False
        if self.window is not None and \
                pair.available_at < self.as_of - self.window:
            return False
        if self.model is not None and pair.forecast.model.key != \
                self.model.key:
            return False
        if self.variable and pair.forecast.variable != self.variable:
            return False
        if self.lead_band is not None:
            low, high = self.lead_band
            if not (low <= pair.forecast.lead_hours <= high):
                return False
        if self.regime and pair.forecast.regime != self.regime:
            return False
        if pair.observation.source_reliability < self.min_source_reliability:
            return False
        return True

    def to_dict(self) -> dict:
        return {
            "as_of": self.as_of.isoformat(),
            "model": self.model.key if self.model else None,
            "variable": self.variable or None,
            "kind": self.kind.value,
            "lead_band": list(self.lead_band) if self.lead_band else None,
            "region": self.region or None,
            "season": self.season or None,
            "regime": self.regime or None,
            "window_days": (
                self.window.days if self.window is not None else None
            ),
        }


def season_of(when: datetime) -> str:
    """Meteorological season. Convection differs completely between them."""
    return {
        12: "winter", 1: "winter", 2: "winter",
        3: "spring", 4: "spring", 5: "spring",
        6: "summer", 7: "summer", 8: "summer",
        9: "autumn", 10: "autumn", 11: "autumn",
    }[when.month]


def lead_band_of(lead_hours: float) -> tuple[float, float]:
    """The standard lead band a lead time falls in.

    Bands rather than raw hours because skill changes smoothly and hourly
    resolution would fragment the sample for no benefit. The boundaries
    follow how convective predictability actually degrades: nowcast range,
    where the model still remembers its initial state; short range, where
    convection is resolved but placement is not; and beyond, where only the
    airmass is forecastable.
    """
    for low, high in ((0.0, 6.0), (6.0, 12.0), (12.0, 24.0), (24.0, 48.0),
                      (48.0, 96.0)):
        if low <= lead_hours < high:
            return (low, high)
    return (96.0, 240.0)
