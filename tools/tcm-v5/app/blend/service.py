"""Assemble blends and ensemble summaries from what is actually in the store.

This layer never fetches. If a model is not on disk it simply does not take
part, and the blend records why -- so a blend produced during an outage is
visibly a narrower blend rather than a silently different one.
"""
from __future__ import annotations

import logging
from datetime import datetime

from ..derived.ensemble import EnsembleSummary, summarise
from ..grid import Field
from ..pipeline.ingest import (
    load_field,
    stored_inventory,
    stored_members,
    stored_runs,
)
from ..registry import MODELS, ModelSpec
from .engine import BlendInput, BlendResult, blend

log = logging.getLogger(__name__)


def members_on_disk(
    model: ModelSpec, run: datetime, parameter: str, forecast_hour: int,
) -> list[Field]:
    """Every stored member of one parameter, in member order.

    Member numbers are read from the store, never assumed: MOGREPS-UK uses
    20, 21, 22, and a pooled time-lagged ensemble will use whatever the
    contributing cycles delivered.
    """
    numbers = stored_members(model.id, run, parameter, forecast_hour)
    found: list[Field] = []
    for member in numbers:
        f = load_field(model.id, run, parameter, forecast_hour, member)
        if f is not None:
            found.append(f)
    return found


def load_model_input(
    model: ModelSpec, run: datetime, parameter: str, forecast_hour: int,
) -> BlendInput | None:
    """One model's contribution, collapsing an ensemble to its median.

    The ensemble summary travels with the input so the blend engine can use
    the spread as a confidence term, and so percentiles remain available to
    the caller without a second pass over the members.
    """
    if parameter not in model.parameters:
        return None

    if model.is_ensemble:
        members = members_on_disk(model, run, parameter, forecast_hour)
        if not members:
            return None
        summary = summarise(members)
        median_field = summary.percentiles[50].as_field()
        return BlendInput(model=model, field=median_field, ensemble=summary)

    field = load_field(model.id, run, parameter, forecast_hour)
    if field is None:
        return None
    return BlendInput(model=model, field=field)


def available_inputs(
    parameter: str, forecast_hour: int, runs: dict[str, datetime] | None = None,
) -> list[BlendInput]:
    """Gather every model that can contribute, using its latest stored run."""
    inputs: list[BlendInput] = []
    for model in MODELS.values():
        run = (runs or {}).get(model.id)
        if run is None:
            stored = stored_runs(model.id)
            if not stored:
                continue
            run = stored[-1]
        item = load_model_input(model, run, parameter, forecast_hour)
        if item is not None:
            inputs.append(item)
    return inputs


def blend_parameter(
    parameter: str, forecast_hour: int,
    runs: dict[str, datetime] | None = None,
) -> BlendResult:
    """The adaptive blend for one parameter and lead time."""
    inputs = available_inputs(parameter, forecast_hour, runs)
    if not inputs:
        raise LookupError(
            f"no stored model data for {parameter} at T+{forecast_hour}; "
            "ingest a cycle first"
        )
    return blend(inputs, parameter, forecast_hour)


def ensemble_summary(
    model_id: str, parameter: str, forecast_hour: int,
    run: datetime | None = None,
) -> EnsembleSummary:
    """Percentiles and spread for one ensemble model."""
    model = MODELS[model_id]
    if not model.is_ensemble:
        raise ValueError(f"{model_id} is deterministic; it has no percentiles")
    if run is None:
        stored = stored_runs(model_id)
        if not stored:
            raise LookupError(f"no stored runs for {model_id}")
        run = stored[-1]
    members = members_on_disk(model, run, parameter, forecast_hour)
    if not members:
        raise LookupError(
            f"no stored members for {model_id}/{parameter} at T+{forecast_hour}"
        )
    return summarise(members)


def blendable_parameters() -> dict[str, list[str]]:
    """Which parameters more than one stored model can offer.

    Useful for the UI: a "blend" of one model is a passthrough, and the
    interface should say so rather than implying multi-model consensus.
    """
    by_parameter: dict[str, list[str]] = {}
    for model in MODELS.values():
        runs = stored_runs(model.id)
        if not runs:
            continue
        inventory = stored_inventory(model.id, runs[-1])
        for parameter in inventory:
            by_parameter.setdefault(parameter, []).append(model.id)
    return {k: sorted(v) for k, v in sorted(by_parameter.items())}
