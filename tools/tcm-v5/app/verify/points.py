"""Verifying archived POINT forecasts against observations.

Section 70's second half. Stage 9's `matching.py` pairs a forecast GRID with
an observed grid, which is the right shape for a gridded forecast. The
production forecast is evaluated at points, so it needs the point analogue:

    was there a flash within the event radius of THIS point during THIS hour?

Everything else is unchanged and deliberately so -- the same event
definition, the same coverage asymmetry, the same refusal to count an
unobserved hour as a quiet one. A point verification that quietly relaxed
any of those would be measuring something else.

WHY THIS IS SEPARATE FROM THE GRID MATCHER
------------------------------------------
It would be possible to build a one-cell grid per point and reuse the
existing matcher. That is worse: the grid matcher's spatial dilation, its
effective-sample estimate and its correlation-length calculation are all
about a field, and running them over a single cell produces numbers that
look like the grid ones and mean something different. The point case is a
genuinely different measurement and says so.

THE INDEPENDENCE PROBLEM IS WORSE HERE, NOT BETTER
--------------------------------------------------
Twenty points across the UK at one valid time are not twenty independent
cases: an outbreak covers several of them at once. Section 60 applies with
full force, and `episodes` counts distinct convective situations rather
than forecast-hours, so a skill number from this source cannot be quoted
against the raw pair count.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone

import numpy as np

from . import observations as OBS

log = logging.getLogger(__name__)

POINT_VERIFICATION_VERSION = "stage9.2"

#: Event radius, metres. The Stage 7 thunderstorm definition, imported
#: rather than restated so the two cannot drift apart.
def _event_radius_m() -> float:
    from ..tcm import event as tcm_event
    return float(tcm_event.THUNDERSTORM.radius_km) * 1000.0


@dataclass(slots=True)
class PointPair:
    """One archived forecast matched to what happened."""

    forecast_id: str
    valid_time: datetime
    latitude: float
    longitude: float
    forecast_hour: int
    probability: float
    #: 1.0 if a flash fell within the radius, 0.0 if none did and the hour
    #: was observed well enough to say so. Never None -- an unusable hour
    #: does not produce a pair at all.
    observed: float
    nearest_flash_km: float | None
    coverage: float
    observation_quality: str
    calibration: str
    engine_scores: dict = dc_field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "forecast_id": self.forecast_id,
            "valid_time": self.valid_time.isoformat(),
            "location": {"lat": self.latitude, "lon": self.longitude},
            "forecast_hour": self.forecast_hour,
            "probability": round(self.probability, 6),
            "observed": self.observed,
            "nearest_flash_km": (
                round(self.nearest_flash_km, 1)
                if self.nearest_flash_km is not None else None
            ),
            "observation_coverage": round(self.coverage, 3),
            "observation_quality": self.observation_quality,
            "calibration": self.calibration,
        }


def _distance_km(lat1, lon1, lat2, lon2) -> np.ndarray:
    """Great-circle distance, in kilometres.

    A flat approximation is fine over 10 km but the flashes can be hundreds
    of kilometres away and the nearest-flash distance is reported, so the
    proper formula is used rather than one that is only right near zero.
    """
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(np.asarray(lon2) - lon1)
    a = (
        np.sin(dp / 2.0) ** 2
        + np.cos(p1) * np.cos(p2) * np.sin(dl / 2.0) ** 2
    )
    return 2.0 * r * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def match_point(
    record: dict, hour: OBS.ObservedHour, *, radius_m: float | None = None
) -> PointPair | None:
    """Pair one archived forecast with its hour, or None if it cannot be.

    Returns None when the forecast has no probability, or when the hour was
    not observed well enough to judge it. Both are absences rather than
    outcomes, and inventing a pair for either is exactly what would make a
    quiet domain look well forecast.
    """
    probability = record.get("thunderstorm")
    if probability is None:
        return None
    if hour.event_observed is None:
        return None

    location = record.get("location") or {}
    lat, lon = location.get("latitude"), location.get("longitude")
    if lat is None or lon is None:
        return None

    radius_km = (radius_m or _event_radius_m()) / 1000.0
    nearest = None
    observed = 0.0
    if hour.strikes:
        distances = _distance_km(
            lat, lon,
            np.array([s.lat for s in hour.strikes]),
            np.array([s.lon for s in hour.strikes]),
        )
        nearest = float(distances.min())
        observed = 1.0 if nearest <= radius_km else 0.0

    timing = record.get("timing") or {}
    return PointPair(
        forecast_id=record.get("forecast_id", ""),
        valid_time=hour.valid_time,
        latitude=float(lat), longitude=float(lon),
        forecast_hour=int(timing.get("forecast_hour", 0)),
        probability=float(probability),
        observed=observed,
        nearest_flash_km=nearest,
        coverage=hour.coverage,
        observation_quality=hour.quality.value,
        calibration=record.get("calibration_status", "unknown"),
        engine_scores=record.get("engine_scores") or {},
    )


def collect(
    *, since: datetime | None = None, until: datetime | None = None,
    qc: OBS.QualityControl | None = None,
) -> tuple[list[PointPair], dict]:
    """Every archived forecast that can now be verified.

    Only forecasts whose valid hour has PASSED and whose observations have
    arrived. A forecast for a future hour is not a miss; it has not
    happened yet.
    """
    from . import archive

    now = datetime.now(timezone.utc)
    until = until or now
    records = archive.load_all()

    report = {
        "archived": len(records),
        "no_probability": 0,
        "still_in_the_future": 0,
        "unobserved_hour": 0,
        "verified": 0,
    }

    by_hour: dict[datetime, list[dict]] = {}
    for record in records:
        if record.get("thunderstorm") is None:
            report["no_probability"] += 1
            continue
        try:
            valid = datetime.fromisoformat(record["timing"]["valid_time"])
        except (KeyError, ValueError, TypeError):
            continue
        if valid > until:
            report["still_in_the_future"] += 1
            continue
        if since is not None and valid < since:
            continue
        by_hour.setdefault(
            valid.astimezone(timezone.utc).replace(
                minute=0, second=0, microsecond=0
            ), []
        ).append(record)

    pairs: list[PointPair] = []
    for valid, group in sorted(by_hour.items()):
        hour = OBS.load_hour(valid, qc=qc)
        if hour.event_observed is None:
            report["unobserved_hour"] += len(group)
            continue
        for record in group:
            pair = match_point(record, hour)
            if pair is not None:
                pairs.append(pair)

    report["verified"] = len(pairs)
    report["hours"] = len(by_hour)
    log.info(
        "point verification: %d pair(s) from %d archived forecast(s)",
        len(pairs), len(records),
    )
    return pairs, report


def episodes(pairs: list[PointPair]) -> int:
    """Distinct convective situations, not forecast-hours. Section 60.

    Twenty points at one valid time are not twenty independent cases: one
    outbreak covers several at once. Consecutive hours containing events are
    one episode.
    """
    by_hour: dict[datetime, bool] = {}
    for pair in pairs:
        by_hour[pair.valid_time] = (
            by_hour.get(pair.valid_time, False) or pair.observed > 0.5
        )
    count = 0
    active = False
    for _hour, has_event in sorted(by_hour.items()):
        if has_event and not active:
            count += 1
        active = has_event
    return count


def verify(pairs: list[PointPair], *, source: str = "tcm") -> dict:
    """Score the matched pairs. Sections 21 to 28."""
    from . import metrics as M

    if not pairs:
        return {
            "available": False,
            "reason": (
                "no archived forecast can be verified yet: either none has "
                "a probability, or the hours they describe have not "
                "happened or were not observed. This is an absence of "
                "verification, not a verification of zero skill"
            ),
        }

    forecast = np.array([p.probability for p in pairs])
    observed = np.array([p.observed for p in pairs])
    n_episodes = episodes(pairs)
    events = int(observed.sum())

    # The effective sample is the EPISODE count, not the pair count: the
    # points within one outbreak are not independent draws.
    effective = float(max(n_episodes, 1))

    target = "thunderstorm at a point"
    scores = {
        "brier_score": M.brier_score(
            forecast, observed, target=target, n_effective=effective),
        "roc_auc": M.roc_auc(
            forecast, observed, target=target, n_effective=effective),
        "pr_auc": M.pr_auc(
            forecast, observed, target=target, n_effective=effective),
    }
    climatology = np.full_like(forecast, float(observed.mean()))
    zero = np.zeros_like(forecast)

    return {
        "available": True,
        "source": source,
        "version": POINT_VERIFICATION_VERSION,
        "pairs": len(pairs),
        "events": events,
        "episodes": n_episodes,
        "base_rate": round(float(observed.mean()), 6),
        "period": {
            "from": min(p.valid_time for p in pairs).isoformat(),
            "to": max(p.valid_time for p in pairs).isoformat(),
        },
        "scores": {k: v.to_dict() for k, v in scores.items()},
        "skill_vs": {
            name: M.brier_skill_score(
                forecast, observed, reference, baseline=name, target=target,
                n_effective=effective,
            ).to_dict()
            for name, reference in (
                ("climatology", climatology), ("always_zero", zero)
            )
        },
        "reliability": M.reliability(forecast, observed, target=target),
        "sharpness": M.sharpness(forecast, target=target),
        "warning": (
            f"{n_episodes} distinct convective episode(s) behind "
            f"{len(pairs)} pairs. Section 60: points within one outbreak are "
            f"not independent cases, and no skill conclusion rests on this"
        ),
    }


def calibration_readiness(pairs: list[PointPair]) -> dict:
    """Can a calibrator be fitted yet? Sections 29 to 32.

    The single question standing between this platform and a publishable
    probability. Answered against the thresholds `calibrate.py` actually
    enforces, so the answer here and the refusal there cannot disagree.
    """
    from . import calibrate as CAL

    events = int(sum(p.observed for p in pairs))
    n_episodes = episodes(pairs)

    blockers: list[str] = []
    if events < CAL.MIN_EVENTS_TO_FIT:
        blockers.append(
            f"{events} observed event(s); {CAL.MIN_EVENTS_TO_FIT} needed "
            f"before a fit describes a relationship rather than individual "
            f"storms"
        )
    if n_episodes < CAL.MIN_EPISODES_TO_FIT:
        blockers.append(
            f"{n_episodes} convective episode(s); "
            f"{CAL.MIN_EPISODES_TO_FIT} needed. A calibration fitted on one "
            f"outbreak is a calibration for that outbreak"
        )
    if n_episodes < 2:
        blockers.append(
            "no honest train/test split is possible: splitting inside one "
            "episode puts the same storm on both sides"
        )

    return {
        "ready": not blockers,
        "pairs": len(pairs),
        "events": events,
        "episodes": n_episodes,
        "needs": blockers,
        "verdict": (
            "enough verified data exists to attempt a calibration fit. It "
            "still has to pass the sharpness and discrimination gates"
            if not blockers else
            "not enough verified data to fit a calibration, so every "
            "probability remains UNCALIBRATED and unpublishable"
        ),
        "note": (
            "this is the one gap between the platform and a publishable "
            "probability. Every scheduled shadow cycle adds forecasts, and "
            "every convective day adds events"
        ),
    }
