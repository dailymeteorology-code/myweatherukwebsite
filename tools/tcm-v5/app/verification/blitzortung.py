"""Observed lightning from the Blitzortung worker.

The worker at `LIGHTNING_API_URL` exposes `/strikes`, a **rolling buffer of
roughly the last thirty seconds** of detections (measured: 63 strikes spanning
28 s). It is a live feed, not an archive, and that shapes everything here:

  * It can drive the live observed-lightning layer immediately.
  * It cannot answer "what happened at 15Z yesterday" -- nothing stored it.
    So the provider ACCUMULATES: every poll appends new strikes to an
    append-only archive on disk, and verification reads that.

The rule this module exists to protect:

    **An hour that was never polled has no observation. It does not have
    zero strikes.**

Absence of data and absence of lightning are completely different facts, and
conflating them would tell verification that every unpolled hour was a
correctly forecast quiet hour -- inflating skill scores and poisoning training
with fabricated negatives. The archive therefore records which hours were
actually COVERED, and `fetch` raises for any hour that was not.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from ..registry import UK_IRELAND
from .observations import (
    ObservationField,
    ObservationProvider,
    ObservationsUnavailable,
)

log = logging.getLogger(__name__)

#: A poll is assumed to cover this much time either side. The buffer holds
#: ~30 s, so polling more often than this leaves no gap.
POLL_COVERAGE_S = 30.0

#: Strikes closer than this in time and space are the same detection arriving
#: from two poll cycles.
DEDUPE_TIME_MS = 500
DEDUPE_DEGREES = 0.01


@dataclass(frozen=True, slots=True)
class Strike:
    lat: float
    lon: float
    time_ms: int
    amplitude: float = 0.0

    @property
    def when(self) -> datetime:
        return datetime.fromtimestamp(self.time_ms / 1000, tz=timezone.utc)

    def key(self) -> tuple:
        return (
            round(self.time_ms / DEDUPE_TIME_MS),
            round(self.lat / DEDUPE_DEGREES),
            round(self.lon / DEDUPE_DEGREES),
        )

    def to_dict(self) -> dict:
        return {
            "lat": self.lat, "lon": self.lon,
            "time": self.time_ms, "amp": self.amplitude,
        }


def in_region(strike: Strike) -> bool:
    return UK_IRELAND.contains(strike.lon, strike.lat)


def parse(payload: dict) -> list[Strike]:
    out = []
    for raw in payload.get("strikes", []):
        try:
            out.append(Strike(
                lat=float(raw["lat"]), lon=float(raw["lon"]),
                time_ms=int(raw["time"]), amplitude=float(raw.get("amp", 0)),
            ))
        except (KeyError, TypeError, ValueError):
            continue
    return out


class StrikeArchive:
    """Append-only strike store, one file per UTC hour, with coverage.

    Coverage is the point. A file that does not exist means the hour was
    never observed; a file that exists with no strikes means the hour was
    observed and was quiet. Verification must be able to tell those apart.
    """

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _hour_path(self, when: datetime) -> Path:
        stamp = when.astimezone(timezone.utc).strftime("%Y%m%dT%H")
        return self.root / f"{stamp}.jsonl"

    def _coverage_path(self, when: datetime) -> Path:
        return self._hour_path(when).with_suffix(".coverage.json")

    def append(self, strikes: list[Strike], polled_at: datetime) -> int:
        """Store new strikes and record that this moment was observed."""
        by_hour: dict[Path, list[Strike]] = {}
        for strike in strikes:
            by_hour.setdefault(self._hour_path(strike.when), []).append(strike)

        added = 0
        for path, group in by_hour.items():
            existing = {s.key() for s in self._read(path)}
            fresh = [s for s in group if s.key() not in existing]
            if fresh:
                with open(path, "a", encoding="utf-8") as fh:
                    for strike in fresh:
                        fh.write(json.dumps(strike.to_dict()) + "\n")
                added += len(fresh)

        self._record_coverage(polled_at)
        return added

    def record_span(self, start: datetime, end: datetime) -> int:
        """Record that a whole TIME RANGE was observed, not just an instant.

        The feed was assumed to be a ~30 second rolling buffer, so every poll
        credited itself with 30 seconds of coverage at the poll time. It is
        not: the worker retains hours (5.78 h when measured on 2026-08-29), so
        a single poll actually observes that entire span. Recording only the
        instant left hours we genuinely had data for marked as never polled,
        and an unpolled hour raises rather than reading as quiet -- so real
        observations were being reported as gaps.

        Returns the number of hour-buckets touched.
        """
        touched = 0
        cursor = start.replace(minute=0, second=0, microsecond=0)
        while cursor <= end:
            hour_start = cursor
            hour_end = cursor + timedelta(hours=1)
            covered = (
                min(end, hour_end) - max(start, hour_start)
            ).total_seconds()
            if covered > 0:
                self._merge_coverage(hour_start, covered, start, end)
                touched += 1
            cursor = hour_end
        return touched

    def _merge_coverage(self, hour: datetime, seconds: float,
                        start: datetime, end: datetime) -> None:
        path = self._coverage_path(hour)
        record = {"polls": [], "seconds_covered": 0.0, "spans": []}
        if path.exists():
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        record.setdefault("spans", [])
        record.setdefault("polls", [])
        record["spans"].append([start.isoformat(), end.isoformat()])
        # Coverage is the union of observed spans clipped to this hour, so
        # overlapping polls of the same buffer do not count twice.
        record["seconds_covered"] = min(
            max(float(record.get("seconds_covered", 0.0)), seconds), 3600.0
        )
        strikes = self._hour_path(hour)
        if not strikes.exists():
            strikes.touch()
        tmp = path.with_suffix(f".{os.getpid()}.part")
        tmp.write_text(json.dumps(record), encoding="utf-8")
        os.replace(tmp, path)

    def _record_coverage(self, polled_at: datetime) -> None:
        path = self._coverage_path(polled_at)
        record = {"polls": [], "seconds_covered": 0.0}
        if path.exists():
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        record["polls"].append(polled_at.isoformat())
        record["seconds_covered"] = len(record["polls"]) * POLL_COVERAGE_S
        # Touch the strike file so "observed and quiet" is distinguishable
        # from "never observed".
        strikes = self._hour_path(polled_at)
        if not strikes.exists():
            strikes.touch()
        tmp = path.with_suffix(f".{os.getpid()}.part")
        tmp.write_text(json.dumps(record), encoding="utf-8")
        os.replace(tmp, path)

    def _read(self, path: Path) -> list[Strike]:
        if not path.exists():
            return []
        out = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
                out.append(Strike(
                    raw["lat"], raw["lon"], raw["time"], raw.get("amp", 0.0)
                ))
            except (json.JSONDecodeError, KeyError):
                continue
        return out

    def strikes_in_hour(self, when: datetime) -> list[Strike]:
        return self._read(self._hour_path(when))

    def coverage(self, when: datetime) -> dict:
        """How much of an hour was actually observed."""
        path = self._coverage_path(when)
        if not path.exists():
            return {
                "observed": False, "polls": 0, "seconds_covered": 0.0,
                "fraction": 0.0,
            }
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {
                "observed": False, "polls": 0, "seconds_covered": 0.0,
                "fraction": 0.0,
            }
        seconds = float(record.get("seconds_covered", 0.0))
        return {
            "observed": True,
            "polls": len(record.get("polls", [])),
            "seconds_covered": seconds,
            "fraction": min(seconds / 3600.0, 1.0),
        }

    def recent(self, minutes: int, now: datetime | None = None) -> dict:
        """Strikes over the last `minutes`, with the coverage behind them.

        Coverage travels with the strikes because a count on its own cannot
        be read: zero strikes from an observed window means a quiet sky,
        zero from an unpolled one means nothing was watching. The caller is
        given both and must not present the second as the first.
        """
        now = now or datetime.now(timezone.utc)
        start = now - timedelta(minutes=minutes)

        strikes: list[Strike] = []
        covered = 0.0
        hours_seen = 0
        hours_observed = 0
        cursor = start.replace(minute=0, second=0, microsecond=0)
        while cursor <= now:
            hours_seen += 1
            cover = self.coverage(cursor)
            if cover["observed"]:
                hours_observed += 1
                covered += cover["seconds_covered"]
            strikes.extend(
                s for s in self.strikes_in_hour(cursor) if s.when >= start
            )
            cursor += timedelta(hours=1)

        window_seconds = (now - start).total_seconds()
        return {
            "strikes": strikes,
            "window_minutes": minutes,
            "from": start.isoformat(),
            "to": now.isoformat(),
            "hours_touched": hours_seen,
            "hours_observed": hours_observed,
            "observed": hours_observed > 0,
            # Capped at 1: the archive stores whole hours, so a window that
            # starts mid-hour can carry more covered seconds than it spans.
            "coverage_fraction": (
                min(covered / window_seconds, 1.0) if window_seconds else 0.0
            ),
        }

    def strikes_on_day(self, day: date, now: datetime | None = None) -> dict:
        """Every archived strike for one UTC day, with the gaps named.

        Coverage travels with the strikes, per hour, because "all the strikes
        today" is a claim about completeness and this archive is usually not
        complete: the feed is live, so an hour nobody polled has NO
        observation rather than zero strikes. Handing back a bare list would
        present a night the machine was asleep as a quiet night.
        """
        now = now or datetime.now(timezone.utc)
        start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)

        strikes: list[Strike] = []
        observed: list[str] = []
        missing: list[str] = []
        covered = 0.0

        for hour in range(24):
            when = start + timedelta(hours=hour)
            if when > now:
                break                      # the future is not a gap
            cover = self.coverage(when)
            stamp = f"{when:%H}Z"
            if cover["observed"]:
                observed.append(stamp)
                covered += cover["seconds_covered"]
            else:
                missing.append(stamp)
            strikes.extend(self.strikes_in_hour(when))

        strikes.sort(key=lambda s: s.time_ms)
        elapsed_hours = max(
            1, min(24, int((min(now, start + timedelta(days=1)) - start)
                           .total_seconds() // 3600) + 1)
        )
        return {
            "date": day.isoformat(),
            "strikes": strikes,
            "count": len(strikes),
            "hours_observed": observed,
            "hours_missing": missing,
            "coverage_fraction": round(
                min(covered / (elapsed_hours * 3600.0), 1.0), 3
            ),
            "complete": not missing,
        }

    def hours_available(self) -> list[str]:
        return sorted(
            p.stem for p in self.root.glob("*.jsonl") if p.stat().st_size >= 0
        )


def grid_strikes(strikes: list[Strike]) -> np.ndarray:
    """Count strikes per TCM analysis cell."""
    from pyproj import Transformer

    from ..grid import tcm_grid

    grid = tcm_grid()
    counts = np.zeros(grid.shape, dtype="float32")
    if not strikes:
        return counts

    transformer = Transformer.from_crs("EPSG:4326", grid.projection,
                                       always_xy=True)
    lons = np.array([s.lon for s in strikes])
    lats = np.array([s.lat for s in strikes])
    x, y = transformer.transform(lons, lats)
    col = np.round((x - grid.x0) / grid.spacing_m - 0.5).astype(int)
    row = np.round((y - grid.y0) / grid.spacing_m - 0.5).astype(int)
    inside = (row >= 0) & (row < grid.ny) & (col >= 0) & (col < grid.nx)
    np.add.at(counts, (row[inside], col[inside]), 1.0)
    return counts


class BlitzortungObservations(ObservationProvider):
    """Observed strikes from the Blitzortung worker."""

    name = "blitzortung"

    def __init__(self, url: str, archive_root: Path, timeout: float = 30.0):
        self.url = url.rstrip("/")
        self.archive = StrikeArchive(archive_root)
        self.timeout = timeout
        self.last_poll: datetime | None = None
        self.last_error: str | None = None

    @property
    def available(self) -> bool:
        return bool(self.url)

    def status(self) -> dict:
        hours = self.archive.hours_available()
        return {
            "provider": self.name,
            "available": self.available,
            "url": self.url,
            "archived_hours": len(hours),
            "first_hour": hours[0] if hours else None,
            "last_hour": hours[-1] if hours else None,
            "last_poll": self.last_poll.isoformat() if self.last_poll else None,
            "last_error": self.last_error,
            "reason": (
                "" if hours else
                "connected, but no hour has been archived yet -- the feed is "
                "a ~30 second rolling buffer, so verification data only "
                "accumulates from the moment polling starts"
            ),
            "note": (
                "An hour that was never polled has NO observation; it does "
                "not have zero strikes. Coverage is recorded per hour and "
                "unobserved hours raise rather than reading as quiet."
            ),
        }

    def poll(self) -> dict:
        """Fetch the live buffer and append anything new to the archive."""
        import httpx

        polled_at = datetime.now(timezone.utc)
        try:
            response = httpx.get(f"{self.url}/strikes", timeout=self.timeout)
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:              # network, JSON, HTTP
            self.last_error = str(exc)
            log.warning("blitzortung poll failed: %s", exc)
            return {"ok": False, "error": str(exc), "added": 0}

        strikes = parse(payload)
        regional = [s for s in strikes if in_region(s)]
        added = self.archive.append(regional, polled_at)

        # Credit coverage over the buffer's ACTUAL span, not the poll instant.
        # The worker retains hours of strikes, so one poll observes all of it;
        # crediting only the instant marked genuinely observed hours as gaps.
        # The span comes from the payload itself -- the global strike times,
        # before the regional filter, because a quiet UK inside a busy Europe
        # is still an observation of the UK.
        hours_touched = 0
        span_from = span_to = None
        if strikes:
            times = sorted(s.when for s in strikes)
            span_from, span_to = times[0], times[-1]
            hours_touched = self.archive.record_span(span_from, span_to)
        else:
            self.archive._record_coverage(polled_at)

        self.last_poll = polled_at
        self.last_error = None
        return {
            "ok": True,
            "polled_at": polled_at.isoformat(),
            "received": len(strikes),
            "in_region": len(regional),
            "added": added,
            "buffer_from": span_from.isoformat() if span_from else None,
            "buffer_to": span_to.isoformat() if span_to else None,
            "buffer_hours": (
                round((span_to - span_from).total_seconds() / 3600, 2)
                if span_from else 0.0
            ),
            "hours_covered": hours_touched,
        }

    def fetch(
        self, parameter: str, valid_time: datetime, window_hours: float = 1.0
    ) -> ObservationField:
        if parameter != "lightning_flash_density_1h":
            raise ObservationsUnavailable(
                f"{self.name} observes lightning only, not {parameter}"
            )
        coverage = self.archive.coverage(valid_time)
        if not coverage["observed"]:
            raise ObservationsUnavailable(
                f"{valid_time:%Y-%m-%d %HZ} was never polled, so there is no "
                "observation for it. An unobserved hour is not a quiet hour."
            )

        strikes = self.archive.strikes_in_hour(valid_time)
        return ObservationField(
            parameter=parameter,
            valid_time=valid_time,
            values=grid_strikes(strikes),
            source=f"{self.name} ({coverage['fraction']:.0%} of the hour "
                   f"observed over {coverage['polls']} polls)",
            window_hours=window_hours,
        )
