"""Is TCM V5 operational right now?

Step 13 of the Stage 10 order, sections 21 to 24, 55 to 58 and 76 to 77.

Section 23 asks for the system to be able to answer one question, and it is
worth stating as the question rather than as a list of checks:

    Is TCM V5 operational right now?

The honest answer has more than two values. A platform whose provider is
down but whose cache is warm is degraded, not broken, and a platform that
has published nothing for two days because the weather was quiet is fine.
`Health` therefore reports a state, the evidence, and what a person should
do about it.

ALERTS NAME THE SUBSYSTEM
-------------------------
Section 58: an alert should identify the subsystem responsible where
possible, and section 55 adds that provider failures must not be concealed.
Every `Alert` carries a `subsystem` and a `likely_cause` chosen from
DATA or FORECAST, because "the forecast is wrong" and "the data never
arrived" need different people and different fixes.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone
from enum import Enum

log = logging.getLogger(__name__)

HEALTH_VERSION = "stage10.1"


class State(str, Enum):
    OK = "ok"
    DEGRADED = "degraded"
    FAILED = "failed"
    UNKNOWN = "unknown"


class Cause(str, Enum):
    """Section 55 and 58. What kind of problem this is."""

    DATA = "data"
    FORECAST = "forecast"
    STORAGE = "storage"
    CONFIGURATION = "configuration"
    UNKNOWN = "unknown"


@dataclass(slots=True)
class Component:
    """One thing that can be healthy or not."""

    name: str
    state: State
    detail: str
    latency_ms: float | None = None
    cause: Cause = Cause.UNKNOWN

    def to_dict(self) -> dict:
        return {
            "component": self.name, "state": self.state.value,
            "detail": self.detail,
            "latency_ms": (
                round(self.latency_ms, 1)
                if self.latency_ms is not None else None
            ),
            "likely_cause": self.cause.value,
        }


@dataclass(slots=True)
class Alert:
    """Section 58. Something an operator should look at."""

    subsystem: str
    severity: str
    message: str
    cause: Cause
    action: str = ""

    def to_dict(self) -> dict:
        return {
            "subsystem": self.subsystem, "severity": self.severity,
            "message": self.message, "likely_cause": self.cause.value,
            "suggested_action": self.action or None,
        }


# --------------------------------------------------------------------------
# Component checks
# --------------------------------------------------------------------------

def check_storage() -> Component:
    from ..config import get_settings

    started = time.perf_counter()
    try:
        root = get_settings().data_root
        probe = root / ".health"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception as exc:            # noqa: BLE001
        return Component(
            "storage", State.FAILED,
            f"the data root is not writable: {exc!r}",
            cause=Cause.STORAGE,
        )

    latency = (time.perf_counter() - started) * 1000
    try:
        import shutil
        usage = shutil.disk_usage(root)
        free_gb = usage.free / 1e9
        used_fraction = usage.used / usage.total
    except Exception:            # noqa: BLE001
        return Component(
            "storage", State.OK, "writable; free space unknown",
            latency_ms=latency, cause=Cause.STORAGE,
        )

    if free_gb < 2:
        state, detail = State.FAILED, (
            f"only {free_gb:.1f} GB free: an ingest will fail"
        )
    elif free_gb < 10:
        state, detail = State.DEGRADED, (
            f"{free_gb:.1f} GB free, {used_fraction:.0%} used"
        )
    else:
        state, detail = State.OK, (
            f"{free_gb:.0f} GB free, {used_fraction:.0%} used"
        )
    return Component("storage", state, detail, latency_ms=latency,
                     cause=Cause.STORAGE)


#: Credentials the platform needs, and what stops working without each.
#: Named explicitly rather than guessed at: an earlier version of this
#: check looked for `metoffice_api_key`, which does not exist, and
#: therefore reported the platform as failed while ingestion was working.
CREDENTIALS: tuple[tuple[str, str, bool], ...] = (
    ("metoffice_atmospheric_api_key",
     "NWP ingestion: without it no model data can be fetched at all", True),
    ("metoffice_nswws_api_key",
     "warnings feed", False),
    ("lightning_api_key",
     "live lightning; the archive on disk is unaffected", False),
)


def check_credentials() -> Component:
    from ..config import get_settings

    settings = get_settings()
    missing_critical: list[str] = []
    missing_optional: list[str] = []
    present: list[str] = []

    for name, purpose, critical in CREDENTIALS:
        if getattr(settings, name, None):
            present.append(name)
        elif critical:
            missing_critical.append(f"{name} ({purpose})")
        else:
            missing_optional.append(f"{name} ({purpose})")

    if missing_critical:
        return Component(
            "credentials", State.FAILED,
            "missing critical credential(s): " + "; ".join(missing_critical),
            cause=Cause.CONFIGURATION,
        )
    detail = f"{len(present)} credential(s) configured"
    if missing_optional:
        return Component(
            "credentials", State.DEGRADED,
            f"{detail}; missing optional: " + "; ".join(missing_optional),
            cause=Cause.CONFIGURATION,
        )
    return Component(
        "credentials", State.OK,
        f"{detail}. Not validated here: only a live call can show whether "
        f"a key still works",
        cause=Cause.CONFIGURATION,
    )


def check_model_availability(*, model_id: str = "ukv") -> Component:
    """Section 24. Is the data we need actually here, and how old is it?"""
    from ..pipeline.ingest import stored_runs

    try:
        runs = stored_runs(model_id)
    except Exception as exc:            # noqa: BLE001
        return Component(
            f"model:{model_id}", State.FAILED,
            f"could not read the store: {exc!r}", cause=Cause.STORAGE,
        )
    if not runs:
        return Component(
            f"model:{model_id}", State.FAILED,
            "no run of the critical model is stored", cause=Cause.DATA,
        )

    newest = max(runs)
    age = datetime.now(timezone.utc) - newest
    hours = age.total_seconds() / 3600
    # UKV runs 6-hourly, so anything under about 8 hours old is current.
    if hours <= 8:
        state, detail = State.OK, (
            f"newest run {newest:%Y-%m-%d %HZ}, {hours:.1f} h old"
        )
    elif hours <= 24:
        state, detail = State.DEGRADED, (
            f"newest run is {hours:.1f} h old; a cycle has been missed"
        )
    else:
        state, detail = State.FAILED, (
            f"newest run is {hours / 24:.1f} days old; ingestion has stopped"
        )
    return Component(f"model:{model_id}", state, detail, cause=Cause.DATA)


def check_observations() -> Component:
    """Stage 9 depends entirely on these."""
    from ..verify import observations as OBS

    hours = OBS.available_hours()
    if not hours:
        return Component(
            "observations", State.DEGRADED,
            "no lightning observations are archived, so no verification "
            "and no calibration are possible",
            cause=Cause.DATA,
        )
    age = datetime.now(timezone.utc) - hours[-1]
    hours_old = age.total_seconds() / 3600
    if hours_old <= 3:
        state = State.OK
    elif hours_old <= 24:
        state = State.DEGRADED
    else:
        state = State.FAILED
    return Component(
        "observations", state,
        f"{len(hours)} archived hour(s), newest {hours_old:.1f} h old",
        cause=Cause.DATA,
    )


def check_forecast_freshness() -> Component:
    """Section 24. Do not silently serve an old forecast as current."""
    from . import manifest as MF

    latest = MF.latest_published()
    if latest is None:
        return Component(
            "forecast", State.DEGRADED,
            "no cycle has been published yet",
            cause=Cause.FORECAST,
        )
    try:
        cycle = datetime.fromisoformat(latest["cycle"])
    except (KeyError, ValueError):
        return Component(
            "forecast", State.UNKNOWN,
            "the latest manifest has no readable cycle time",
            cause=Cause.FORECAST,
        )
    hours = (datetime.now(timezone.utc) - cycle).total_seconds() / 3600
    if hours <= 8:
        state, detail = State.OK, f"published {cycle:%Y-%m-%d %HZ}"
    elif hours <= 24:
        state, detail = State.DEGRADED, (
            f"the newest published forecast is {hours:.1f} h old"
        )
    else:
        state, detail = State.FAILED, (
            f"the newest published forecast is {hours / 24:.1f} days old"
        )
    return Component("forecast", state, detail, cause=Cause.FORECAST)


def check_calibration() -> Component:
    """A forecast that cannot be published is worth surfacing."""
    return Component(
        "calibration", State.DEGRADED,
        "no calibrator has been fitted against observations, so every "
        "probability is UNCALIBRATED and marked unpublishable. This is a "
        "known state, not a fault",
        cause=Cause.FORECAST,
    )


COMPONENTS = (
    check_storage, check_credentials, check_model_availability,
    check_observations, check_forecast_freshness, check_calibration,
)


# --------------------------------------------------------------------------
# The whole picture
# --------------------------------------------------------------------------

def health() -> dict:
    """Section 23. Is TCM V5 operational right now?"""
    components: list[Component] = []
    for check in COMPONENTS:
        try:
            components.append(check())
        except Exception as exc:            # noqa: BLE001
            log.exception("health check %s raised", check.__name__)
            components.append(Component(
                check.__name__, State.UNKNOWN,
                f"the check itself raised: {exc!r}",
            ))

    failed = [c for c in components if c.state is State.FAILED]
    degraded = [c for c in components if c.state is State.DEGRADED]

    if failed:
        overall = State.FAILED
        answer = (
            f"NO: {len(failed)} component(s) have failed "
            f"({', '.join(c.name for c in failed)})"
        )
    elif degraded:
        overall = State.DEGRADED
        answer = (
            f"PARTIALLY: every critical component is up, but "
            f"{len(degraded)} is degraded "
            f"({', '.join(c.name for c in degraded)})"
        )
    else:
        overall = State.OK
        answer = "YES: every component is healthy"

    return {
        "operational": overall is not State.FAILED,
        "state": overall.value,
        "answer": answer,
        "components": [c.to_dict() for c in components],
        "alerts": [a.to_dict() for a in alerts(components)],
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "version": HEALTH_VERSION,
    }


def alerts(components: list[Component] | None = None) -> list[Alert]:
    """Section 58. What an operator should act on, and who owns it."""
    if components is None:
        components = [check() for check in COMPONENTS]

    out: list[Alert] = []
    for component in components:
        if component.state is State.OK:
            continue
        severity = "critical" if component.state is State.FAILED else "warning"
        action = {
            Cause.DATA: (
                "check the provider and the ingest logs before suspecting "
                "the forecast: this is a data problem"
            ),
            Cause.STORAGE: "check disk space and the data root's permissions",
            Cause.CONFIGURATION: "check the environment configuration",
            Cause.FORECAST: "check the orchestrator's task records",
        }.get(component.cause, "investigate")
        out.append(Alert(
            subsystem=component.name, severity=severity,
            message=component.detail, cause=component.cause, action=action,
        ))
    return out


# --------------------------------------------------------------------------
# Metrics -- sections 22 and 76
# --------------------------------------------------------------------------

def metrics(*, limit: int = 20) -> dict:
    """Section 22. Operational numbers, from the manifests themselves."""
    from . import manifest as MF

    history = MF.history(limit=limit)
    if not history:
        return {
            "cycles": 0,
            "note": "no cycle has run through the orchestrator yet",
        }

    durations = [
        m.get("timing", {}).get("duration_seconds") for m in history
    ]
    durations = [d for d in durations if d is not None]

    statuses: dict[str, int] = {}
    for record in history:
        status = record.get("status", "unknown")
        statuses[status] = statuses.get(status, 0) + 1

    # Section 76: break the duration down so the bottleneck is visible
    # rather than guessed at.
    stage_totals: dict[str, list[float]] = {}
    reuse: dict[str, int] = {}
    failures: dict[str, int] = {}
    for record in history:
        for name, task in (record.get("tasks") or {}).items():
            seconds = task.get("duration_seconds")
            if seconds is not None:
                stage_totals.setdefault(name, []).append(seconds)
            if task.get("reused"):
                reuse[name] = reuse.get(name, 0) + 1
            if task.get("state") == "failed":
                failures[name] = failures.get(name, 0) + 1

    by_stage = {
        name: {
            "mean_seconds": round(sum(values) / len(values), 2),
            "max_seconds": round(max(values), 2),
            "runs": len(values),
        }
        for name, values in sorted(stage_totals.items())
    }
    bottleneck = max(
        by_stage.items(), key=lambda kv: kv[1]["mean_seconds"], default=None
    )

    degraded = sum(1 for m in history if m.get("degraded"))
    return {
        "cycles": len(history),
        "status_counts": statuses,
        "degraded_cycles": degraded,
        "degraded_fraction": round(degraded / len(history), 3),
        "duration_seconds": {
            "mean": round(sum(durations) / len(durations), 1)
            if durations else None,
            "max": round(max(durations), 1) if durations else None,
            "min": round(min(durations), 1) if durations else None,
        },
        "by_stage": by_stage,
        "bottleneck": (
            {"stage": bottleneck[0], **bottleneck[1]} if bottleneck else None
        ),
        "task_reuse_counts": reuse,
        "task_failure_counts": failures,
        "note": (
            "section 76: the breakdown identifies the actual bottleneck. "
            "Optimising a stage that is not one is wasted effort"
        ),
        "version": HEALTH_VERSION,
    }
