"""Observations: ingestion, quality control and provenance.

Steps 2 and 3 of the Stage 9 order, sections 8, 9, 10, 57, 80 and 95.

THE ASYMMETRY THAT MATTERS MOST
-------------------------------
Section 9 asks for observations to carry a quality status. For lightning
there is one distinction that governs everything downstream, and getting it
wrong silently destroys the verification:

    A DETECTED STRIKE IS EVIDENCE. AN UNDETECTED HOUR IS NOT.

If the network was listening for 390 seconds of a 3600-second hour and heard
nothing, that hour is NOT a verified null. It is an hour we did not observe.
Counting it as "no thunderstorm" would credit every forecast of zero with a
hit it never earned, and on a domain that is quiet 99% of the time that
single mistake would make almost any forecast look skilful.

So coverage controls the NEGATIVE case only:

    strikes > 0                      -> event occurred, VALID
                                        (coverage is irrelevant; you cannot
                                        detect a strike that did not happen)
    strikes = 0, coverage adequate   -> event did not occur, VALID
    strikes = 0, coverage inadequate -> UNKNOWN, excluded from verification

Partial coverage can only ever produce a false negative, never a false
positive, and the data model says so.

OBSERVATIONS ARE TARGETS, NOT PREDICTORS
----------------------------------------
Section 80. Every observation records `available_at` -- when it could first
have been known -- separately from `valid_time`, the moment it describes. A
lightning strike at 18:00 is a legitimate verification target for an 18:00
forecast issued at 12:00, and an illegitimate PREDICTOR for it. The learning
pipeline in `learning.py` enforces that with `available_at`; this module's
job is to record it truthfully.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

#: Bumped when a change alters what an observation record would contain.
OBSERVATION_VERSION = "stage9.1"

#: Fraction of an hour that must have been observed before an hour with no
#: detections can be called a verified null. 0.9 is a judgement and it is
#: declared as one: it trades sample size against the risk of counting an
#: unobserved hour as a quiet one. `QualityControl.min_coverage` makes it
#: adjustable and every verification result records the value used.
MIN_COVERAGE_FOR_NULL = 0.9

#: Bounds outside which a lightning fix is not in the TCM domain. Generous
#: on purpose: the domain extends well past the coast and clipping tightly
#: would discard real offshore convection.
DOMAIN_LON = (-15.0, 6.0)
DOMAIN_LAT = (46.0, 63.0)


class ObsQuality(str, Enum):
    """Section 9's required statuses."""

    VALID = "valid"
    SUSPECT = "suspect"
    DEGRADED = "quality_degraded"
    MISSING = "missing"
    REJECTED = "rejected"

    @property
    def usable(self) -> bool:
        """Whether this observation may enter a verification statistic."""
        return self in (ObsQuality.VALID, ObsQuality.DEGRADED)


class ObsSource(str, Enum):
    """Where an observation came from. Section 8: not equally reliable."""

    LIGHTNING_NETWORK = "lightning_network"
    RADAR = "radar"
    SURFACE_STATION = "surface_station"
    RAIN_GAUGE = "rain_gauge"
    SATELLITE = "satellite"
    RADIOSONDE = "radiosonde"
    SEVERE_REPORT = "severe_weather_report"
    MODEL_ANALYSIS = "model_analysis"


#: How much each source can be trusted as ground truth, and why. Section 8
#: forbids treating every source as equally reliable; this is the record of
#: that, and it is descriptive rather than a weight -- nothing multiplies by
#: these values.
SOURCE_NOTES: dict[ObsSource, str] = {
    ObsSource.LIGHTNING_NETWORK: (
        "detection efficiency varies with range from the sensor network and "
        "with stroke polarity and peak current. Absence of a detection is "
        "weaker evidence than presence of one"
    ),
    ObsSource.RADAR: (
        "beam blocking, attenuation, bright band and anaprop all produce "
        "artefacts; coverage falls with range and with terrain"
    ),
    ObsSource.SURFACE_STATION: (
        "a point measurement verifying an area forecast. Station density is "
        "far below the convective scale"
    ),
    ObsSource.RAIN_GAUGE: (
        "point measurement; convective rainfall gradients are far sharper "
        "than the gauge network resolves"
    ),
    ObsSource.SEVERE_REPORT: (
        "population-dependent. Absence of a report is NOT absence of the "
        "event, which section 16 states explicitly for hail"
    ),
    ObsSource.SATELLITE: "indirect; cloud top rather than surface event",
    ObsSource.RADIOSONDE: "sparse in space and time, but directly measured",
    ObsSource.MODEL_ANALYSIS: (
        "not an observation. An analysis contains model information and "
        "must never be used to verify that same model"
    ),
}


@dataclass(frozen=True, slots=True)
class ObsProvenance:
    """Section 10. Everything needed to audit an observation."""

    source: ObsSource
    dataset: str
    #: Version of the observation dataset, for section 58's requirement that
    #: a verification result records which data it used.
    dataset_version: str
    #: When the observation could FIRST have been known. Distinct from the
    #: time it describes -- see the module docstring.
    available_at: datetime | None = None
    retrieved_at: datetime | None = None
    station_id: str | None = None
    units: str = ""
    processing_version: str = OBSERVATION_VERSION
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "source": self.source.value,
            "dataset": self.dataset,
            "dataset_version": self.dataset_version,
            "available_at": (
                self.available_at.isoformat() if self.available_at else None
            ),
            "retrieved_at": (
                self.retrieved_at.isoformat() if self.retrieved_at else None
            ),
            "station_id": self.station_id,
            "units": self.units,
            "processing_version": self.processing_version,
            "source_limitations": SOURCE_NOTES.get(self.source, ""),
            "notes": self.notes or None,
        }


@dataclass(frozen=True, slots=True)
class Strike:
    """One lightning fix."""

    time: datetime
    lon: float
    lat: float
    amplitude: float | None = None


@dataclass(slots=True)
class ObservedHour:
    """What was observed in one hour, and how much of it we actually saw.

    `coverage` is the fraction of the hour the network was reporting. It is
    the single most important field here: see the module docstring on why an
    uncovered quiet hour is not a quiet hour.
    """

    valid_time: datetime
    strikes: list[Strike]
    coverage: float
    provenance: ObsProvenance
    quality: ObsQuality = ObsQuality.VALID
    reason: str = ""

    @property
    def count(self) -> int:
        return len(self.strikes)

    @property
    def event_observed(self) -> bool | None:
        """Did a thunderstorm occur somewhere in the domain this hour?

        None means "we do not know", which is a third answer that must not
        be collapsed into False.
        """
        if self.count > 0:
            return True
        if self.quality.usable:
            return False
        return None

    def to_dict(self) -> dict:
        return {
            "valid_time": self.valid_time.isoformat(),
            "strikes": self.count,
            "coverage": round(self.coverage, 4),
            "quality": self.quality.value,
            "reason": self.reason or None,
            "event_observed": self.event_observed,
            "provenance": self.provenance.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class QualityControl:
    """Section 9's checks, as configuration so a run can record what it used."""

    min_coverage: float = MIN_COVERAGE_FOR_NULL
    domain_lon: tuple[float, float] = DOMAIN_LON
    domain_lat: tuple[float, float] = DOMAIN_LAT
    #: Strikes closer together than this in time AND space are treated as
    #: duplicates. Lightning networks report multiple strokes of one flash;
    #: the event definition counts flashes, not strokes.
    duplicate_seconds: float = 1.0
    duplicate_km: float = 2.0
    version: str = OBSERVATION_VERSION

    def to_dict(self) -> dict:
        return {
            "min_coverage_for_null": self.min_coverage,
            "domain_lon": list(self.domain_lon),
            "domain_lat": list(self.domain_lat),
            "duplicate_seconds": self.duplicate_seconds,
            "duplicate_km": self.duplicate_km,
            "version": self.version,
        }


@dataclass(slots=True)
class QCReport:
    """What quality control did to a set of observations."""

    read: int = 0
    kept: int = 0
    out_of_domain: int = 0
    bad_timestamp: int = 0
    duplicates: int = 0
    malformed: int = 0
    hours_valid: int = 0
    hours_degraded: int = 0
    hours_unknown: int = 0
    notes: list[str] = dc_field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "strikes_read": self.read,
            "strikes_kept": self.kept,
            "rejected": {
                "out_of_domain": self.out_of_domain,
                "bad_timestamp": self.bad_timestamp,
                "duplicates": self.duplicates,
                "malformed": self.malformed,
            },
            "hours": {
                "valid": self.hours_valid,
                "degraded": self.hours_degraded,
                "unknown_excluded": self.hours_unknown,
            },
            "notes": self.notes,
        }


# --------------------------------------------------------------------------
# The lightning archive
# --------------------------------------------------------------------------

def _archive_root() -> Path:
    from ..config import get_settings
    return get_settings().data_root / "observations" / "lightning"


def _parse_hour(stem: str) -> datetime | None:
    try:
        return datetime.strptime(stem, "%Y%m%dT%H").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def available_hours(root: Path | None = None) -> list[datetime]:
    """Every hour the lightning archive holds, in order."""
    root = root or _archive_root()
    if not root.exists():
        return []
    hours = [
        h for h in (_parse_hour(p.stem) for p in root.glob("*.jsonl"))
        if h is not None
    ]
    return sorted(hours)


def load_hour(
    hour: datetime, *, qc: QualityControl | None = None,
    root: Path | None = None, report: QCReport | None = None,
) -> ObservedHour:
    """Read and quality-control one hour of lightning observations."""
    qc = qc or QualityControl()
    root = root or _archive_root()
    hour = hour.astimezone(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )
    stem = hour.strftime("%Y%m%dT%H")
    path = root / f"{stem}.jsonl"
    coverage_path = root / f"{stem}.coverage.json"

    provenance = ObsProvenance(
        source=ObsSource.LIGHTNING_NETWORK,
        dataset="blitzortung_archive",
        dataset_version=OBSERVATION_VERSION,
        # A strike is detected and published within seconds, so it is known
        # essentially at its own valid time. The one-minute allowance covers
        # network propagation and is deliberately generous: treating an
        # observation as available EARLIER than it was would be the
        # dangerous direction.
        available_at=hour + timedelta(hours=1, minutes=1),
        units="flash count",
    )

    if not path.exists():
        if report:
            report.hours_unknown += 1
        return ObservedHour(
            valid_time=hour, strikes=[], coverage=0.0,
            provenance=provenance, quality=ObsQuality.MISSING,
            reason=(
                f"no observation file for {stem}. This is an hour that was "
                f"not observed, NOT an hour with no lightning"
            ),
        )

    coverage = 0.0
    if coverage_path.exists():
        try:
            payload = json.loads(coverage_path.read_text())
            coverage = float(payload.get("seconds_covered", 0.0)) / 3600.0
        except (ValueError, OSError, TypeError):
            coverage = 0.0
    coverage = min(max(coverage, 0.0), 1.0)

    strikes: list[Strike] = []
    window_start, window_end = hour, hour + timedelta(hours=1)
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        if report:
            report.read += 1
        try:
            record = json.loads(line)
            lon = float(record["lon"])
            lat = float(record["lat"])
            raw_time = record["time"]
        except (ValueError, KeyError, TypeError):
            if report:
                report.malformed += 1
            continue

        # Blitzortung timestamps are milliseconds since the epoch in this
        # archive, but nanoseconds in the live feed. Both appear in the
        # wild, so the magnitude decides -- a nanosecond value is ~1e18 and
        # would otherwise parse as a date 30 million years hence.
        try:
            stamp = float(raw_time)
            if stamp > 1e17:
                stamp /= 1e9
            elif stamp > 1e11:
                stamp /= 1e3
            when = datetime.fromtimestamp(stamp, tz=timezone.utc)
        except (ValueError, OSError, OverflowError):
            if report:
                report.bad_timestamp += 1
            continue

        if not (window_start <= when < window_end):
            if report:
                report.bad_timestamp += 1
            continue
        if not (qc.domain_lon[0] <= lon <= qc.domain_lon[1]):
            if report:
                report.out_of_domain += 1
            continue
        if not (qc.domain_lat[0] <= lat <= qc.domain_lat[1]):
            if report:
                report.out_of_domain += 1
            continue

        amplitude = record.get("amp")
        strikes.append(Strike(
            time=when, lon=lon, lat=lat,
            amplitude=float(amplitude) if amplitude not in (None, "") else None,
        ))

    strikes, duplicates = _deduplicate(strikes, qc)
    if report:
        report.duplicates += duplicates
        report.kept += len(strikes)

    quality, reason = _grade(len(strikes), coverage, qc)
    if report:
        if quality is ObsQuality.VALID:
            report.hours_valid += 1
        elif quality is ObsQuality.DEGRADED:
            report.hours_degraded += 1
        else:
            report.hours_unknown += 1

    return ObservedHour(
        valid_time=hour, strikes=strikes, coverage=coverage,
        provenance=provenance, quality=quality, reason=reason,
    )


def _grade(
    count: int, coverage: float, qc: QualityControl
) -> tuple[ObsQuality, str]:
    """Apply the coverage asymmetry. See the module docstring."""
    if count > 0:
        if coverage >= qc.min_coverage:
            return ObsQuality.VALID, ""
        return ObsQuality.DEGRADED, (
            f"only {coverage:.0%} of the hour was observed, so the flash "
            f"COUNT is an undercount. The event itself is still confirmed: "
            f"a detected strike cannot be a false positive of poor coverage"
        )
    if coverage >= qc.min_coverage:
        return ObsQuality.VALID, ""
    return ObsQuality.MISSING, (
        f"no strikes detected, but only {coverage:.0%} of the hour was "
        f"observed and {qc.min_coverage:.0%} is required to call an hour "
        f"quiet. This is an UNOBSERVED hour, not a verified null, and "
        f"counting it as one would credit every zero forecast with a hit "
        f"it did not earn"
    )


def _deduplicate(
    strikes: list[Strike], qc: QualityControl
) -> tuple[list[Strike], int]:
    """Collapse multiple strokes of one flash.

    The Stage 7 event counts FLASHES. A network reporting each return
    stroke separately would inflate a single flash into five, which matters
    for any density-based comparison even though it cannot change a binary
    occurrence.
    """
    if not strikes:
        return [], 0
    ordered = sorted(strikes, key=lambda s: s.time)
    kept: list[Strike] = [ordered[0]]
    removed = 0
    for strike in ordered[1:]:
        previous = kept[-1]
        gap = (strike.time - previous.time).total_seconds()
        if gap <= qc.duplicate_seconds:
            # Rough local metric: 1 degree of latitude is ~111 km.
            dy = (strike.lat - previous.lat) * 111.0
            dx = (
                (strike.lon - previous.lon) * 111.0
                * np.cos(np.radians(strike.lat))
            )
            if float(np.hypot(dx, dy)) <= qc.duplicate_km:
                removed += 1
                continue
        kept.append(strike)
    return kept, removed


def load_range(
    start: datetime, end: datetime, *, qc: QualityControl | None = None,
    root: Path | None = None,
) -> tuple[list[ObservedHour], QCReport]:
    """Every hour in a window, quality controlled, with a report."""
    qc = qc or QualityControl()
    report = QCReport()
    hours: list[ObservedHour] = []
    cursor = start.astimezone(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )
    while cursor < end:
        hours.append(load_hour(cursor, qc=qc, root=root, report=report))
        cursor += timedelta(hours=1)

    usable = sum(1 for h in hours if h.quality.usable)
    if usable == 0 and hours:
        report.notes.append(
            "no hour in this window is usable for verification. Every hour "
            "is either missing or too sparsely covered to call quiet"
        )
    if report.hours_unknown:
        report.notes.append(
            f"{report.hours_unknown} hour(s) excluded as unobserved rather "
            f"than counted as quiet. Section 57: a change in observation "
            f"coverage must not be read as a change in forecast skill"
        )
    log.info(
        "lightning observations %s..%s: %d hours, %d usable, %d strikes",
        start, end, len(hours), usable, report.kept,
    )
    return hours, report


def coverage_summary(hours: list[ObservedHour]) -> dict:
    """Section 57: the state of the observing system, reported alongside
    any skill number computed from it."""
    if not hours:
        return {"hours": 0}
    coverages = np.array([h.coverage for h in hours])
    usable = [h for h in hours if h.quality.usable]
    return {
        "hours": len(hours),
        "usable_hours": len(usable),
        "excluded_hours": len(hours) - len(usable),
        "mean_coverage": round(float(coverages.mean()), 4),
        "fully_covered_hours": int((coverages >= 0.99).sum()),
        "total_flashes": sum(h.count for h in hours),
        "hours_with_flashes": sum(1 for h in hours if h.count > 0),
        "first": hours[0].valid_time.isoformat(),
        "last": hours[-1].valid_time.isoformat(),
        "warning": (
            "verification statistics computed over a window whose "
            "observing coverage changed are not comparable with statistics "
            "from another window. Coverage is reported so the comparison "
            "can be refused rather than made accidentally"
        ),
    }
