"""Operational forecast production.

Stage 10. The orchestrator, the cycle manifests, health, products and the
publication state.

Section 47 keeps the public forecast separate from the internal detail, and
section 48 says not to force the scientific complexity into the public API.
So the routes are split:

    /api/production/forecast    what a user needs
    /api/production/cycle/...   what an operator needs
    /api/production/health      whether the platform is working
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from ...production import deploy as DEPLOY
from ...production import feedback as FEEDBACK
from ...production import gate as GATE
from ...production import health as HEALTH
from ...production import manifest as MANIFEST
from ...production import points as POINTS
from ...production import readiness as READINESS
from ...production import tasks as TASKS

router = APIRouter(tags=["production"])


@router.get("/production")
def contract() -> dict:
    """What the production layer guarantees."""
    return {
        "stage": 10,
        "version": MANIFEST.PRODUCTION_VERSION,
        "purpose": (
            "turn the Stage 2-9 scientific system into a reliable "
            "operational forecasting service: detect cycles, run the "
            "dependency graph, validate, publish, archive and hand off to "
            "verification"
        ),
        "guarantees": [
            "NEVER FABRICATE: a model that did not arrive is recorded as "
            "not having arrived, with the reason. It is never replaced by "
            "another model, by zeros, or by its own previous run",
            "a degraded cycle lowers CONFIDENCE, not probability: missing "
            "models make the answer less certain, not the weather less "
            "likely",
            "a forecast that fails the publication gate is not published, "
            "and is not repaired to make it publishable",
            "the previous forecast may be served for continuity, always "
            "labelled with its ORIGINAL cycle timestamp and never as the "
            "latest",
            "every cycle carries a manifest naming every component version, "
            "so no forecast has an ambiguous software state",
            "a rerun reuses what already completed rather than producing a "
            "second inconsistent forecast",
            "two workers cannot run the same cycle at once",
            "every forecast is registered with Stage 9 verification "
            "automatically",
        ],
        "dependency_graph": [
            {
                "task": t.name, "depends_on": list(t.depends_on),
                "critical": t.critical, "description": t.description,
            }
            for t in TASKS.GRAPH
        ],
        "execution_waves": TASKS.execution_order(),
        "graph_problems": TASKS.validate_graph() or None,
        "coverage": POINTS.describe(),
        "readiness_rules": READINESS.Rules().to_dict(),
    }


@router.get("/production/health")
def health() -> dict:
    """Section 23. Is TCM V5 operational right now?"""
    return HEALTH.health()


@router.get("/production/metrics")
def metrics(limit: int = Query(20, ge=1, le=200)) -> dict:
    """Section 22 and 76. Cycle timing, bottleneck and failure rates."""
    return HEALTH.metrics(limit=limit)


@router.get("/production/cycles")
def cycles(limit: int = Query(20, ge=1, le=200)) -> dict:
    """Section 69. Forecast history, newest first, nothing overwritten."""
    history = MANIFEST.history(limit=limit)
    return {
        "cycles": [
            {
                "forecast_id": m.get("forecast_id"),
                "cycle": m.get("cycle"),
                "status": m.get("status"),
                "degraded": m.get("degraded"),
                "models_usable": m.get("models_usable"),
                "duration_seconds": (
                    m.get("timing", {}).get("duration_seconds")
                ),
                "version_key": m.get("version_key"),
            }
            for m in history
        ],
        "count": len(history),
        "note": (
            "a later forecast never overwrites an earlier one. Two cycles "
            "with the same time and different version keys are different "
            "forecasts and both are kept"
        ),
    }


@router.get("/production/cycle/{forecast_id}")
def cycle(forecast_id: str) -> dict:
    """One cycle's full manifest. Section 17: reproducibility."""
    record = MANIFEST.load(forecast_id)
    if record is None:
        raise HTTPException(404, f"no manifest for {forecast_id}")
    return record


@router.get("/production/forecast")
def forecast() -> dict:
    """Section 47 and 78. The public forecast product.

    Serves the latest PUBLISHED cycle. When none exists it says so rather
    than serving something older as though it were current.
    """
    record = MANIFEST.latest_published()
    if record is None:
        fallback = GATE.previous_valid_forecast()
        if fallback is None:
            return {
                "available": False,
                "reason": (
                    "no forecast cycle has been published. This is an "
                    "absence of a forecast, not a forecast of no "
                    "thunderstorms"
                ),
            }
        return {"available": True, **fallback}

    products = record.get("products", {})
    summary = products.get("summary", {})
    cycle_time = record.get("cycle")
    age = None
    try:
        age = round(
            (
                datetime.now(timezone.utc)
                - datetime.fromisoformat(cycle_time)
            ).total_seconds() / 3600, 1
        )
    except (TypeError, ValueError):
        pass

    return {
        "available": True,
        "is_current": True,
        "forecast_cycle": cycle_time,
        "age_hours": age,
        "forecast_id": record.get("forecast_id"),
        "degraded": record.get("degraded"),
        "summary": summary.get("text", ""),
        "points": products.get("point_series", {}).get("payload", {}),
        "frames": products.get("animation_frames", {}).get("frames", []),
        "calibration": record.get("versions", {}).get("calibration"),
        "publishable": any(
            entry.get("publishable")
            for series in (
                products.get("point_series", {}).get("payload", {})
                .get("points", {}).values()
            )
            for entry in series
        ) if products.get("point_series") else False,
        "caveat": (
            "these probabilities are UNCALIBRATED: no calibrator has been "
            "fitted against observations, so they describe the structure of "
            "the forecast rather than a verified likelihood"
        ),
    }


@router.get("/production/readiness")
def readiness(cycle: str | None = Query(None)) -> dict:
    """Sections 4, 7 and 8. Could a forecast run right now, and how?"""
    if cycle:
        try:
            when = datetime.fromisoformat(
                cycle.replace("Z", "+00:00")
            ).astimezone(timezone.utc)
        except ValueError:
            raise HTTPException(400, f"could not parse {cycle!r}") from None
    else:
        when = READINESS.next_cycles()[0]

    from ...registry import MODELS
    manifest = MANIFEST.build(
        when,
        expected_models={
            m: getattr(spec, "provider", "unknown")
            for m, spec in MODELS.items()
        },
    )
    READINESS.detect(manifest)
    decision = READINESS.evaluate(manifest)
    return {
        "cycle": when.isoformat(),
        "decision": decision.to_dict(),
        "models": manifest.by_state(),
        "detail": {
            m: e.to_dict() for m, e in sorted(manifest.models.items())
        },
    }


@router.get("/production/deployment")
def deployment() -> dict:
    """Sections 65 to 68 and 72. Versions, shadow, rollback, changelog."""
    return DEPLOY.Releases().describe()


@router.get("/production/operational-feedback")
def operational_feedback(limit: int = Query(30, ge=1, le=200)) -> dict:
    """Section 71. Operational context for Stage 9.

    Lets a run of poor verification scores be checked against a run of
    degraded cycles before the science is blamed.
    """
    return {
        "degradation": FEEDBACK.degradation_summary(limit=limit),
        "history": FEEDBACK.operational_history(limit=limit),
    }
