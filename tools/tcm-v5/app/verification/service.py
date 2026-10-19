"""Verification service: what can be scored today, and what cannot."""
from __future__ import annotations

import logging
from datetime import datetime

import numpy as np

from ..pipeline.ingest import load_field, stored_inventory, stored_runs
from .consistency import ConsistencyReport, compare_runs
from .observations import get_provider

log = logging.getLogger(__name__)


def status() -> dict:
    """What verification can currently do."""
    provider = get_provider()
    runs = stored_runs("ukv")
    return {
        "observations": provider.status(),
        "stored_runs": [r.isoformat() for r in runs],
        "run_count": len(runs),
        "can_score_against_observations": provider.available,
        "can_measure_run_consistency": len(runs) >= 2,
        "note": (
            "Skill scores need observations. Run-to-run consistency needs "
            "only two cycles and is available whenever they exist, but it "
            "measures change, not correctness."
        ),
    }


def _run_fields(model_id: str, run: datetime, parameter: str) -> dict:
    inventory = stored_inventory(model_id, run)
    hours = sorted(set(inventory.get(parameter, [])))
    fields = {}
    for hour in hours:
        field = load_field(model_id, run, parameter, hour)
        if field is not None:
            fields[hour] = field.values
    return fields


def run_consistency(
    parameter: str = "cape_mixed_layer",
    model_id: str = "ukv",
    threshold: float = 200.0,
) -> ConsistencyReport:
    """Compare the two most recent stored cycles on valid time."""
    runs = stored_runs(model_id)
    if len(runs) < 2:
        raise LookupError(
            f"{model_id} has {len(runs)} stored run(s); consistency needs two"
        )
    older, newer = runs[-2], runs[-1]
    older_fields = _run_fields(model_id, older, parameter)
    newer_fields = _run_fields(model_id, newer, parameter)
    if not older_fields or not newer_fields:
        raise LookupError(
            f"{parameter} is not stored for both {older:%d %b %HZ} and "
            f"{newer:%d %b %HZ}"
        )

    report = compare_runs(
        older_fields, newer_fields, older, newer, parameter, threshold
    )
    if not report.pairs:
        raise LookupError(
            "the two runs share no valid time for this parameter; ingest "
            "overlapping lead times"
        )
    return report


def verify_against_observations(parameter: str, valid_time: datetime) -> dict:
    """Score a forecast against what happened. Requires observations."""
    from .observations import ObservationsUnavailable

    provider = get_provider()
    try:
        provider.fetch(parameter, valid_time)
    except ObservationsUnavailable as exc:
        return {
            "scored": False,
            "reason": str(exc),
            "provider": provider.status(),
        }
    raise NotImplementedError(
        "an observation provider is configured but the scoring path is not "
        "implemented; wire it here once a real adapter exists"
    )
