"""Verification, calibration, skill and governance.

Stage 9. The feedback loop: what TCM predicted, what happened, how well it
did, and what evidence supports changing anything.

Every route here READS. None of them changes a forecasting component, and
`/api/verify` says so as its first guarantee. Section 101.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from ...verify import archive as ARCH
from ...verify import attribution as ATTR
from ...verify import audit as AUDIT
from ...verify import backtest as BT
from ...verify import governance as GOV
from ...verify import learning as LEARN
from ...verify import observations as OBS
from ...verify import pipeline as PIPE
from ...verify import skilldb as SKILL
from ...verify import targets as TARGETS

router = APIRouter(tags=["verify"])


@router.get("/verify")
def contract() -> dict:
    """What Stage 9 does, and what it refuses to do."""
    return {
        "stage": 9,
        "version": PIPE.PIPELINE_VERSION,
        "purpose": (
            "measure TCM against reality: archive forecasts before their "
            "outcome is known, ingest and quality-control observations, "
            "match them, score them, calibrate, and feed controlled "
            "candidate improvements"
        ),
        "guarantees": [
            "NOTHING here modifies a forecasting component. Promotion to "
            "champion requires an explicit named human approver and refuses "
            "without one",
            "archived forecasts are immutable: storing over one raises, and "
            "every record carries a content hash that is re-checkable",
            "an unobserved hour is never counted as a quiet hour -- partial "
            "lightning coverage can only produce false negatives, so it "
            "controls the negative case only",
            "no skill number is emitted without its sample size, event "
            "count and effective sample size after correlation",
            "Brier skill scores always name their baseline; two computed "
            "against different baselines are not comparable",
            "observations are targets, never predictors: every training "
            "feature carries the time it became available and the audit "
            "fails on any that postdate the forecast",
            "there is no universal best model: a ranking is only returned "
            "under fully specified conditions",
        ],
        "loop": [
            "forecast", "archive", "observation", "verification",
            "skill database", "training dataset", "candidate", "backtest",
            "challenger", "human approval", "versioned deployment",
        ],
        "loop_stops_at": (
            "challenger. The last two steps are a person's, not this "
            "system's"
        ),
        "error_taxonomy": {
            code.value: meaning
            for code, meaning in ATTR.ERROR_MEANINGS.items()
        },
    }


@router.get("/verify/observations")
def observations(
    hours: int = Query(48, ge=1, le=720),
    until: str | None = Query(None, description="ISO time; default now"),
) -> dict:
    """The observation archive and its quality control."""
    end = (
        datetime.fromisoformat(until.replace("Z", "+00:00")) if until
        else datetime.now(timezone.utc)
    )
    available = OBS.available_hours()
    if not available:
        return {
            "available": False,
            "reason": (
                "no lightning observations are archived. Every verification "
                "in this stage depends on them"
            ),
        }
    end = min(end, available[-1] + timedelta(hours=1))
    start = end - timedelta(hours=hours)
    got, report = OBS.load_range(start, end)
    return {
        "available": True,
        "summary": OBS.coverage_summary(got),
        "quality_control": report.to_dict(),
        "policy": OBS.QualityControl().to_dict(),
        "hours": [h.to_dict() for h in got if h.count or not h.quality.usable],
        "note": (
            "hours with no flashes AND full coverage are omitted from the "
            "listing for brevity; they are included in the summary and in "
            "every verification"
        ),
    }


@router.get("/verify/archive")
def archive_status() -> dict:
    """The forecast archive, and whether it has been tampered with."""
    records = ARCH.load_all()
    integrity = ARCH.verify_integrity()
    return {
        "records": len(records),
        "integrity": integrity,
        "schema_version": ARCH.SCHEMA_VERSION,
        "archive_version": ARCH.ARCHIVE_VERSION,
        "note": (
            "a forecast must be archived BEFORE its outcome is known. An "
            "empty archive means TCM has not yet run operationally, and "
            "nothing can be verified against forecasts that were never "
            "recorded"
        ) if not records else None,
        "latest": sorted(
            (
                {
                    "forecast_id": r.get("forecast_id"),
                    "valid_time": r.get("timing", {}).get("valid_time"),
                    "thunderstorm": r.get("thunderstorm"),
                    "calibration": r.get("calibration_status"),
                    "publishable": r.get("publishable"),
                    "revision": r.get("revision"),
                }
                for r in records
            ),
            key=lambda r: r.get("valid_time") or "",
            reverse=True,
        )[:20],
    }


@router.get("/verify/daily/{day}")
def daily(
    day: str,
    model: str = Query("ukv"),
    parameter: str = Query("lightning_flash_density_1h"),
) -> dict:
    """Section 85's operational verification for one day."""
    try:
        when = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(
            400, f"could not parse {day!r}; use YYYY-MM-DD"
        ) from None
    return PIPE.daily_verification(when, model=model, parameter=parameter)


@router.get("/verify/skill")
def skill(
    metric: str = Query("brier_score"),
    variable: str = Query("lightning within 10 km in the hour"),
    region: str = Query("all"),
    season: str = Query("all"),
    regime: str = Query("all"),
    lead_bucket: str = Query("all"),
    days: int = Query(7, ge=1, le=90),
) -> dict:
    """Section 83's query layer, rebuilt from the archive on demand.

    The store is not persisted between calls yet: with no operational
    forecast archive there is nothing durable to accumulate. Rebuilding it
    per request is honest about that and gives the same answer.
    """
    store = SKILL.SkillStore("nwp_skill")
    available = OBS.available_hours()
    if not available:
        return {
            "available": False,
            "reason": "no observations are archived, so no skill exists",
        }

    from ...grid import grid_lonlat, tcm_grid
    from ...pipeline.ingest import load_field, stored_runs
    from ...verify import matching as MT
    from ...verify import run as RUN

    lons, lats = grid_lonlat(tcm_grid())
    last = available[-1]
    for offset in range(days):
        day = (last - timedelta(days=offset)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        end = day + timedelta(days=1)

        forecasts: dict[datetime, np.ndarray] = {}
        for cycle in stored_runs("ukv"):
            for fh in range(0, 55):
                valid = cycle + timedelta(hours=fh)
                if day <= valid < end:
                    field = load_field(
                        "ukv", cycle, "lightning_flash_density_1h", fh
                    )
                    if field is not None:
                        forecasts[valid] = field.values
        if not forecasts:
            continue

        hours_obs, _ = OBS.load_range(day, end)
        matched, _ = MT.align(forecasts, hours_obs, lons, lats)
        if not matched:
            continue

        result = RUN.verify(
            matched, forecast_source="ukv/lightning_flash_density_1h",
            target="lightning within 10 km in the hour",
            event_definition=(
                "at least one detected flash within 10 km of the cell "
                "centre during the hour"
            ),
        )
        store.add_from_verification(
            result, source="ukv",
            key=SKILL.SkillKey(
                source="ukv",
                variable="lightning within 10 km in the hour",
                season=SKILL.season_of(day),
            ),
        )

    return {
        "available": bool(store.records),
        "query": {
            "metric": metric, "variable": variable, "region": region,
            "season": season, "regime": regime, "lead_bucket": lead_bucket,
        },
        "ranking": store.rank(
            metric=metric, variable=variable, region=region, season=season,
            regime=regime, lead_bucket=lead_bucket,
        ) if store.records else None,
        "summary": store.summary(),
        "reason": (
            None if store.records else
            "the skill store is empty. It is populated from verified "
            "operational forecasts, and TCM has not yet run operationally "
            "with an archive in place"
        ),
    }


@router.get("/verify/governance")
def governance() -> dict:
    """The model registry and the promotion policy. Sections 50 to 53."""
    registry = GOV.Registry()
    return {
        **registry.describe(),
        "gates": [
            "no_data_leakage", "sufficient_sample", "reproducible",
            "documented", "brier_score_not_worse", "roc_auc_not_worse",
            "calibration_error_not_worse", "no_slice_regression",
        ],
        "promotion_policy": (
            "Registry.promote requires a named approver and raises "
            "PermissionError without one. It also refuses any challenger "
            "that failed a blocking gate. There is no code path in this "
            "platform that deploys a learned model automatically"
        ),
        "note": (
            "the registry is empty: no learned component has been trained, "
            "because the verification data to train one on does not yet "
            "exist"
        ),
    }


@router.get("/verify/leakage-policy")
def leakage_policy() -> dict:
    """Sections 76 to 80, stated as the rules the code enforces."""
    return {
        "absolute_rule": (
            "when constructing a historical training example, only "
            "information available at the original forecast creation time "
            "may be a predictor. Observations are targets, not predictors"
        ),
        "enforced_by": {
            "temporal": (
                "every Feature carries available_at with no default; the "
                "audit fails on any feature postdating the forecast"
            ),
            "spatial_and_event": (
                "splits are made by convective EPISODE, never by cell. "
                "Splitting inside one outbreak puts the same storm on both "
                "sides"
            ),
            "regime": (
                "a regime feature is checked like any other, so a label "
                "derived from the outcome cannot predict the outcome"
            ),
            "structural": (
                "TrainingExample separates features from target. There is "
                "no container that holds both, so an observation cannot "
                "become a predictor by being put in the wrong dictionary"
            ),
        },
        "checks": [
            "temporal_feature_leakage", "target_available_too_early",
            "valid_before_created", "mixed_feature_versions",
            "episode_leakage", "temporal_split_leakage",
            "duplicate_examples", "regime_leakage",
        ],
        "version": LEARN.LEARNING_VERSION,
    }


@router.get("/verify/targets")
def targets() -> dict:
    """Every declared verification target, and what blocks the rest.

    Section 21: nothing may be scored that is not declared here. Listing
    the blocked targets alongside the one that works turns "TCM is
    unverified" into a list of named datasets.
    """
    return TARGETS.describe()


@router.get("/verify/audit")
def audit() -> dict:
    """Step 16: audit the verification system itself.

    Immutability, leakage, observation quality, sample discipline, metric
    use, and whether anything can change a forecasting component without a
    person. Capable of failing, and exercised rather than inspected.
    """
    return AUDIT.full_audit()


@router.get("/verify/dashboard")
def dashboard(days: int = Query(7, ge=1, le=90)) -> dict:
    """Section 84's summary, across every dimension the data supports."""
    from datetime import timedelta

    from ...grid import grid_lonlat, tcm_grid
    from ...pipeline.ingest import load_field, stored_runs
    from ...verify import matching as MT
    from ...verify import run as RUN

    available = OBS.available_hours()
    if not available:
        return {
            "available": False,
            "reason": "no observations are archived, so no skill exists",
            "targets": TARGETS.describe()["counts"],
        }

    store = SKILL.SkillStore("nwp_skill")
    lons, lats = grid_lonlat(tcm_grid())
    last = available[-1]
    for offset in range(days):
        day = (last - timedelta(days=offset)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        end = day + timedelta(days=1)
        forecasts: dict[datetime, np.ndarray] = {}
        for cycle in stored_runs("ukv"):
            for fh in range(0, 55):
                valid = cycle + timedelta(hours=fh)
                if day <= valid < end:
                    field = load_field(
                        "ukv", cycle, "lightning_flash_density_1h", fh
                    )
                    if field is not None:
                        forecasts[valid] = field.values
        if not forecasts:
            continue
        hours_obs, _ = OBS.load_range(day, end)
        matched, _ = MT.align(forecasts, hours_obs, lons, lats)
        if not matched:
            continue
        result = RUN.verify(
            matched, forecast_source="ukv/lightning_flash_density_1h",
            target="lightning within 10 km in the hour",
            event_definition=(
                "at least one detected flash within 10 km of the cell "
                "centre during the hour"
            ),
        )
        store.add_from_verification(
            result, source="ukv",
            key=SKILL.SkillKey(
                source="ukv",
                variable="lightning within 10 km in the hour",
                season=SKILL.season_of(day),
            ),
        )

    return {
        "available": bool(store.records),
        **PIPE.dashboard(store),
        "targets": TARGETS.describe()["counts"],
        "audit": {
            "clean": AUDIT.full_audit()["clean"],
            "note": "full detail at /api/verify/audit",
        },
    }


@router.get("/verify/backtest/{day}")
def backtest_day(day: str, model: str = Query("ukv")) -> dict:
    """Step 15: verify one day across every dimension the data supports.

    Section 87: an overall score hides the weakness worth finding, so every
    stratum reports its own independent-storm count and one below the
    threshold is refused rather than characterised.
    """
    from datetime import timedelta

    import numpy as np
    from scipy.ndimage import maximum_filter

    from ...forecast import regions
    from ...grid import grid_lonlat, tcm_grid
    from ...pipeline.ingest import load_field, stored_runs
    from ...verify import matching as MT

    try:
        start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(
            400, f"could not parse {day!r}; use YYYY-MM-DD"
        ) from None
    end = start + timedelta(days=1)

    lons, lats = grid_lonlat(tcm_grid())
    cells = 5
    yy, xx = np.mgrid[-cells:cells + 1, -cells:cells + 1]
    disc = (xx * xx + yy * yy) <= cells * cells

    # Newest run wins for each valid time, which is what an operational
    # system would have used.
    chosen: dict[datetime, int] = {}
    for cycle in stored_runs(model):
        for fh in range(0, 55):
            valid = cycle + timedelta(hours=fh)
            if start <= valid < end:
                if valid not in chosen or fh < chosen[valid]:
                    chosen[valid] = fh

    fields, leads = [], {}
    for valid, fh in sorted(chosen.items()):
        cycle = valid - timedelta(hours=fh)
        field = load_field(model, cycle, "lightning_flash_density_1h", fh)
        if field is None:
            continue
        hours_obs, _ = OBS.load_range(valid, valid + timedelta(hours=1))
        if not hours_obs or hours_obs[0].event_observed is None:
            continue
        matched = MT.match(
            field.values, hours_obs[0], lons, lats,
            forecast_valid_time=valid,
        )
        fields.append(MT.MatchedField(
            valid_time=valid,
            forecast=maximum_filter(
                np.nan_to_num(matched.forecast), footprint=disc
            ),
            observed=matched.observed, usable=matched.usable,
            policy=matched.policy,
            observation_quality=matched.observation_quality,
            coverage=matched.coverage, flash_count=matched.flash_count,
        ))
        leads[valid] = fh

    if not fields:
        return {
            "day": start.date().isoformat(),
            "available": False,
            "reason": (
                "no hour on this day has both a stored forecast and an "
                "observation good enough to verify against"
            ),
        }

    report = BT.run(
        fields, target="lightning within 10 km in the hour",
        source=f"{model}/lightning_flash_density_1h",
        event_definition=(
            "at least one detected flash within 10 km of the cell centre "
            "during the hour"
        ),
        leads=leads, region_masks=regions.region_masks(),
    )
    report["day"] = start.date().isoformat()
    report["available"] = True
    return report


@router.get("/verify/forecasts")
def archived_forecasts() -> dict:
    """Section 70's second half: verify the archive as observations arrive.

    The handoff at forecast time registers a forecast. This scores it, once
    the hour it describes has passed AND been observed well enough to judge.
    Both conditions are required: a future hour is not a miss, and an
    unobserved hour is not a quiet one.
    """
    from ...verify import points

    pairs, collection = points.collect()
    return {
        "collection": collection,
        "verification": points.verify(pairs, source="tcm/production"),
        "calibration_readiness": points.calibration_readiness(pairs),
        "pairs": [p.to_dict() for p in pairs[:100]],
        "note": (
            "this runs automatically after every scheduled ingest. Nothing "
            "waits for a manual export"
        ),
    }
