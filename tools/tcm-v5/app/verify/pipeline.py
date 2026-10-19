"""The whole loop, run end to end.

Sections 72, 83, 84, 85 and 89 of the Stage 9 order.

    FORECAST -> ARCHIVE -> OBSERVATION -> VERIFICATION -> SKILL DATABASE
    -> TRAINING DATASET -> CANDIDATE -> BACKTEST -> CHALLENGER
    -> APPROVAL -> VERSIONED DEPLOYMENT

This module runs that chain up to CHALLENGER and stops, because the last
two arrows belong to a person. Section 101.

`daily_verification` is section 85's operational report. `dashboard` is
section 84's queryable summary. Neither modifies anything: they read the
archive, read the observations, compute, and return.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone

import numpy as np

from . import attribution as A
from . import baselines as B
from . import calibrate as CAL
from . import matching as MT
from . import metrics as M
from . import observations as OBS
from . import run as RUN
from . import skilldb as SKILL

log = logging.getLogger(__name__)

PIPELINE_VERSION = "stage9.1"


@dataclass(slots=True)
class LoopResult:
    """One pass of the feedback loop."""

    verification: RUN.VerificationResult | None = None
    calibration: dict = dc_field(default_factory=dict)
    attribution: dict = dc_field(default_factory=dict)
    skill_records: list = dc_field(default_factory=list)
    ablation: dict = dc_field(default_factory=dict)
    coverage: dict = dc_field(default_factory=dict)
    blocked: list[str] = dc_field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "verification": (
                self.verification.to_dict() if self.verification else None
            ),
            "calibration": self.calibration,
            "attribution": self.attribution,
            "skill_records": len(self.skill_records),
            "ablation": self.ablation,
            "observation_coverage": self.coverage,
            "blocked": self.blocked,
            "version": PIPELINE_VERSION,
            "note": (
                "this loop ends at CHALLENGER. Promotion to champion "
                "requires an explicit human approval through "
                "governance.Registry.promote, which refuses without a named "
                "approver"
            ),
        }


def run_loop(
    fields: list[MT.MatchedField], *, source: str, target: str,
    event_definition: str, policy: MT.MatchPolicy | None = None,
    qc: OBS.QualityControl | None = None,
    store: SKILL.SkillStore | None = None,
    skill_key: SKILL.SkillKey | None = None,
    engine_scores: dict | None = None,
) -> LoopResult:
    """Verify, calibrate, attribute and record. Sections 72 and 85."""
    result = LoopResult()
    if not fields:
        result.blocked.append(
            "no matched forecast/observation pairs: nothing to verify"
        )
        return result

    result.verification = RUN.verify(
        fields, forecast_source=source, target=target,
        event_definition=event_definition, policy=policy, qc=qc,
    )
    result.coverage = result.verification.coverage

    result.calibration = CAL.compare_methods(fields, target=target)
    result.attribution = A.report(fields, engine_scores=engine_scores)

    if store is not None:
        key = skill_key or SKILL.SkillKey(source=source, variable=target)
        result.skill_records = store.add_from_verification(
            result.verification, source=source, key=key
        )
    return result


def ablate(
    fields: list[MT.MatchedField], variants: dict[str, list[MT.MatchedField]],
    *, target: str,
) -> dict:
    """Section 89. Does each layer still earn its place?

    `variants` maps a name to the same period forecast WITHOUT one
    component. Each is scored against the identical observations, and the
    comparison uses `metrics.compare`, which refuses to call an overlapping
    difference an improvement.
    """
    def score(group: list[MT.MatchedField]) -> M.Score:
        usable = [f for f in group if f.n_usable > 0]
        if not usable:
            return M.Score(
                metric="brier_score", value=None, target=target, n=0,
                reason="no usable pairs",
            )
        forecast = np.concatenate([f.pairs()[0] for f in usable])
        observed = np.concatenate([f.pairs()[1] for f in usable])
        sample = MT.effective_sample(usable)
        return M.brier_score(
            forecast, observed, target=target,
            n_effective=sample.get("effective_cells"),
        )

    def arrays(group: list[MT.MatchedField]):
        usable = [f for f in group if f.n_usable > 0]
        if not usable:
            return None, None, None
        return (
            np.concatenate([f.pairs()[0] for f in usable]),
            np.concatenate([f.pairs()[1] for f in usable]),
            MT.effective_sample(usable).get("effective_cells"),
        )

    full = score(fields)
    full_f, full_o, full_n = arrays(fields)
    rows = {}
    for name, variant in variants.items():
        without = score(variant)
        var_f, var_o, _ = arrays(variant)
        # PAIRED where the two variants really do cover the same cases,
        # which in an ablation they normally do: the variant differs by one
        # component, not by which cells were forecast. The paired interval
        # is the correct one because the two error series are correlated
        # near 1, and the unpaired overlap screen would call a component
        # inert that is not.
        paired = (
            full_f is not None and var_f is not None
            and full_f.size == var_f.size
            and np.array_equal(full_o, var_o)
        )
        if paired:
            rows[name] = M.compare_paired(
                full_f, var_f, full_o,
                statistic=lambda f, o: float(np.mean((f - o) ** 2)),
                label_a="with", label_b="without",
                metric="brier_score", target=target, n_effective=full_n,
            )
        else:
            rows[name] = M.compare(
                full, without, label_a="with", label_b="without"
            )
            rows[name]["paired"] = False
            rows[name]["pairing_note"] = (
                "the variant does not cover the same cases as the full "
                "forecast, so the comparison falls back to the conservative "
                "unpaired screen"
            )

    inert = [
        name for name, row in rows.items()
        if row.get("comparable") and abs(row.get("difference", 0)) < 1e-12
    ]
    return {
        "full": full.to_dict(),
        "without": rows,
        "inert_components": inert,
        "verdict": (
            f"{', '.join(inert)} changed nothing measurable and should be "
            f"justified or removed"
            if inert else
            "every ablated component changed the result"
        ),
        "caveat": (
            "a change is not an improvement. Whether the difference is "
            "beneficial needs enough independent episodes to distinguish, "
            "which `metrics.compare` reports on"
        ),
    }


def daily_verification(
    day: datetime, *, model: str = "ukv",
    parameter: str = "lightning_flash_density_1h",
) -> dict:
    """Section 85's operational report for one day.

    Reads what is stored, verifies what can be verified, and says plainly
    what could not. It changes nothing: section 85 ends "do not
    automatically modify production models from these statistics".
    """
    from ..grid import grid_lonlat, tcm_grid
    from ..pipeline.ingest import load_field, stored_runs

    start = day.astimezone(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = start + timedelta(days=1)
    lons, lats = grid_lonlat(tcm_grid())

    forecasts: dict[datetime, np.ndarray] = {}
    for cycle in stored_runs(model):
        for fh in range(0, 55):
            valid = cycle + timedelta(hours=fh)
            if not (start <= valid < end):
                continue
            field = load_field(model, cycle, parameter, fh)
            if field is not None:
                # A later run supersedes an earlier one for the same valid
                # time, which is what an operational system would use.
                existing = forecasts.get(valid)
                if existing is None or cycle >= start:
                    forecasts[valid] = field.values

    hours, qc_report = OBS.load_range(start, end)
    if not forecasts:
        return {
            "day": start.date().isoformat(),
            "available": False,
            "reason": f"no stored {parameter} forecasts valid on this day",
            "observations": OBS.coverage_summary(hours),
        }

    matched, skipped = MT.align(forecasts, hours, lons, lats)
    result = run_loop(
        matched, source=f"{model}/{parameter}",
        target="lightning within 10 km in the hour",
        event_definition=(
            "at least one detected flash within 10 km of the cell centre "
            "during the hour"
        ),
    )
    payload = result.to_dict()
    payload.update({
        "day": start.date().isoformat(),
        "available": bool(matched),
        "forecast_hours": len(forecasts),
        "matched_hours": len(matched),
        "skipped": skipped,
        "observation_qc": qc_report.to_dict(),
        "observations": OBS.coverage_summary(hours),
        "action_taken": (
            "none. Section 85: these statistics feed the controlled "
            "learning pipeline and do not modify any production model"
        ),
    })
    return payload


def dashboard(store: SKILL.SkillStore) -> dict:
    """Section 84's summary, from whatever the skill store holds."""
    summary = store.summary()
    metrics_present = sorted({r.metric for r in store.records})
    variables = sorted({r.key.variable for r in store.records})

    rankings = {}
    for variable in variables:
        for metric in ("brier_score", "roc_auc"):
            if metric not in metrics_present:
                continue
            rankings[f"{variable}|{metric}"] = store.rank(
                metric=metric, variable=variable
            )

    return {
        "store": summary,
        "metrics_available": metrics_present,
        "variables": variables,
        "rankings": rankings,
        "dimensions": list(SKILL.DIMENSIONS),
        "version": PIPELINE_VERSION,
        "note": (
            "every ranking here is valid only under the conditions it "
            "names. Section 97: there is no universal best model"
        ),
    }
