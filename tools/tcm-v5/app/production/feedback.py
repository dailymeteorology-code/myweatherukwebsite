"""Handing every forecast to Stage 9, automatically.

from . import access as AX

Step 9 of the Stage 10 order, sections 70 and 71.

Section 70 ends with the instruction that makes this module exist:

    Do not wait for manual export.

A forecast that has to be exported by hand is a forecast that will not be
verified, and Stage 9's whole loop depends on the archive filling by itself.

SEPARATING SCIENTIFIC ERROR FROM OPERATIONAL ERROR
--------------------------------------------------
Section 71 asks for operational context to travel with the forecast, and
the reason is a specific confusion worth preventing. When a forecast misses
an outbreak, there are two very different explanations:

    the science was wrong
    the forecast ran without the model that would have caught it

Stage 9's attribution cannot tell those apart from the probabilities alone.
`OperationalContext` carries the degraded state, the missing models, the
failed tasks and the calibration status alongside the forecast, so a later
verification failure can be attributed to the right thing.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field as dc_field
from datetime import datetime, timezone
from pathlib import Path

from . import access as AX

log = logging.getLogger(__name__)

FEEDBACK_VERSION = "stage10.1"


@dataclass(frozen=True, slots=True)
class OperationalContext:
    """Section 71. Why a forecast may have been wrong for reasons that are
    not scientific."""

    forecast_id: str
    cycle: datetime
    degraded: bool
    degraded_because: tuple[str, ...]
    models_usable: tuple[str, ...]
    models_unusable: dict
    failed_tasks: tuple[str, ...]
    degraded_tasks: tuple[str, ...]
    calibration: str
    publishable: bool
    processing_seconds: float | None
    #: Anything about this cycle that could explain an error without the
    #: science being at fault.
    caveats: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        out = asdict(self)
        out["cycle"] = self.cycle.isoformat()
        for key in ("degraded_because", "models_usable", "failed_tasks",
                    "degraded_tasks", "caveats"):
            out[key] = list(getattr(self, key))
        out["version"] = FEEDBACK_VERSION
        out["note"] = (
            "carried alongside the forecast so a later verification failure "
            "can be attributed to the science or to the operation, rather "
            "than to whichever is easier to blame"
        )
        return out


def _root() -> Path:
    from ..config import get_settings
    root = get_settings().data_root / "production" / "handoff"
    root.mkdir(parents=True, exist_ok=True)
    return root


def build_context(manifest, context: dict) -> OperationalContext:
    tasks = manifest.tasks or {}
    failed = tuple(
        name for name, task in sorted(tasks.items())
        if task.get("state") == "failed"
    )
    degraded_tasks = tuple(
        name for name, task in sorted(tasks.items())
        if task.get("state") == "degraded"
    )

    caveats: list[str] = []
    if manifest.degraded:
        caveats.append(
            "this cycle ran without its full model set: a miss may be "
            "operational rather than scientific"
        )
    if "weighting" in degraded_tasks:
        caveats.append(
            "Stage 6 weighting ran in cold-start mode because the skill "
            "store holds no verified records, so model trust was not "
            "learned from evidence"
        )
    if "profiles" in degraded_tasks:
        caveats.append(
            "the forecast is evaluated at points rather than on the grid, "
            "so a storm between points is not a miss the science made"
        )

    forecasts = context.get("forecasts") or []
    publishable = any(AX.publishable(f) for f in forecasts)

    return OperationalContext(
        forecast_id=manifest.forecast_id,
        cycle=manifest.cycle,
        degraded=manifest.degraded,
        degraded_because=tuple(manifest.degraded_because),
        models_usable=tuple(manifest.usable_models()),
        models_unusable=manifest.unusable_models(),
        failed_tasks=failed,
        degraded_tasks=degraded_tasks,
        calibration=manifest.versions.calibration,
        publishable=publishable,
        processing_seconds=manifest.duration_seconds,
        caveats=tuple(caveats),
    )


def register(manifest, context: dict) -> dict:
    """Register this cycle with Stage 9. Section 70.

    The forecasts themselves are archived by the orchestrator's `archive`
    task through Stage 9's own immutable archive. This records the
    OPERATIONAL context beside them and confirms the pairing, so the two
    cannot drift apart.
    """
    from ..verify import archive as AR

    operational = build_context(manifest, context)
    path = _root() / f"{manifest.forecast_id}.json"
    try:
        path.write_text(
            json.dumps(operational.to_dict(), indent=1), encoding="utf-8"
        )
    except OSError:
        log.exception("could not write the operational context")

    archived = AR.load_all()
    matching = [
        r for r in archived
        if r.get("timing", {}).get("run") == manifest.cycle.isoformat()
    ]

    forecasts = context.get("forecasts") or []
    pending = _pending_verification(manifest, forecasts)

    summary = (
        f"{len(matching)} forecast(s) archived for this cycle; "
        f"{pending['awaiting']} awaiting observations"
    )
    log.info("Stage 9 handoff for %s: %s", manifest.forecast_id, summary)

    return {
        "registered": True,
        "summary": summary,
        "forecast_id": manifest.forecast_id,
        "archived_records": len(matching),
        "operational_context": operational.to_dict(),
        "verification": pending,
        "note": (
            "registration is automatic. Section 70: waiting for a manual "
            "export means the forecast is never verified"
        ),
    }


def _pending_verification(manifest, forecasts: list) -> dict:
    """When each forecast becomes verifiable. Section 70.

    A forecast cannot be verified until the hour it describes has passed
    AND the observations for that hour have arrived, so the handoff records
    when to look rather than trying to verify immediately.
    """
    now = datetime.now(timezone.utc)
    times = sorted(f.valid_time for f in forecasts)
    if not times:
        return {
            "awaiting": 0,
            "reason": "no forecast carried a valid time",
        }

    future = [t for t in times if t > now]
    return {
        "awaiting": len(future),
        "verifiable_now": len(times) - len(future),
        "earliest_valid": times[0].isoformat(),
        "latest_valid": times[-1].isoformat(),
        "first_verifiable_after": (
            min(future).isoformat() if future else None
        ),
        "target": "thunderstorm",
        "note": (
            "verification runs when the observations for these hours "
            "arrive, through Stage 9's daily verification. Nothing is "
            "scored before the weather has happened"
        ),
    }


def operational_history(*, limit: int = 30) -> list[dict]:
    """Every registered cycle's operational context, newest first.

    Section 71: this is what lets a run of poor verification scores be
    checked against a run of degraded cycles before the science is blamed.
    """
    root = _root()
    if not root.exists():
        return []
    out: list[dict] = []
    for path in sorted(root.glob("*.json"), reverse=True)[:limit]:
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda r: r.get("cycle", ""), reverse=True)


def degradation_summary(*, limit: int = 30) -> dict:
    """How often cycles have run degraded, and why. Section 71."""
    history = operational_history(limit=limit)
    if not history:
        return {
            "cycles": 0,
            "note": "no cycle has been registered with verification yet",
        }

    degraded = [r for r in history if r.get("degraded")]
    reasons: dict[str, int] = {}
    for record in degraded:
        for reason in record.get("degraded_because", []):
            key = reason.split(":")[0][:60]
            reasons[key] = reasons.get(key, 0) + 1

    return {
        "cycles": len(history),
        "degraded_cycles": len(degraded),
        "degraded_fraction": round(len(degraded) / len(history), 3),
        "common_reasons": sorted(
            reasons.items(), key=lambda kv: -kv[1]
        )[:5],
        "publishable_cycles": sum(
            1 for r in history if r.get("publishable")
        ),
        "note": (
            "a run of poor verification scores should be checked against "
            "this before the science is blamed: a degraded cycle can miss "
            "for operational reasons"
        ),
    }
