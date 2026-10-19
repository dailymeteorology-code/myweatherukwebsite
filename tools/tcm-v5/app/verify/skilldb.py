"""The skill databases: what performed well, where, when and at what.

Steps 7 and 8 of the Stage 9 order, sections 34 to 44, 83 and 97.

Two stores with the same shape:

    ModelSkill   how each NWP source performed, which Stage 6 consumes
    TCMSkill     how TCM itself performed, which answers "did V5.1 improve
                 on V5.0"

THERE IS NO BEST MODEL
----------------------
Section 97. A ranking is meaningless without the variable, region, lead
time, season, regime, metric and sample size it was computed under, so a
`SkillRecord` carries all of them and `rank` refuses to produce a list
unless the query pins them down. "UKV is the best model" is not a statement
this module can express.

EVERY NUMBER CARRIES ITS SAMPLE
-------------------------------
Section 36 states the rule plainly: do not present skill = 0.82 without
indicating whether it came from 12 samples or 100,000. Every record stores
the raw count, the EFFECTIVE count after correlation, the event count and
the date range, and `to_dict` emits all four. There is no way to read a
value out of this store without them.

STAGE 6 OWNS THE WEIGHTING
--------------------------
This module supplies history. It does not compute weights, and it does not
decide eligibility. `for_stage6` hands over records in the shape Stage 6's
own store expects, and stops there.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

SKILLDB_VERSION = "stage9.1"

#: Dimensions a skill record is keyed by. Section 35.
DIMENSIONS = (
    "source", "variable", "task", "region", "season", "regime",
    "lead_bucket", "valid_hour_bucket",
)

#: Lead-time buckets, in hours. Chosen to separate the regimes of forecast
#: behaviour rather than to be round: nowcast range, the first diurnal
#: cycle, the second, and beyond -- section 39 warns against assuming a
#: smooth degradation curve, so the buckets do not assume one either.
LEAD_BUCKETS = ((0, 6), (6, 12), (12, 24), (24, 48), (48, 999))


def lead_bucket(hours: int) -> str:
    for lo, hi in LEAD_BUCKETS:
        if lo <= hours < hi:
            return f"T+{lo}-{hi}"
    return "unknown"


def season_of(when: datetime) -> str:
    """Meteorological seasons. Section 40."""
    return {
        12: "winter", 1: "winter", 2: "winter",
        3: "spring", 4: "spring", 5: "spring",
        6: "summer", 7: "summer", 8: "summer",
        9: "autumn", 10: "autumn", 11: "autumn",
    }[when.month]


def hour_bucket(when: datetime) -> str:
    """Time of day. Convection has a strong diurnal cycle, so a skill
    number pooled across it hides more than it shows."""
    hour = when.hour
    if 3 <= hour < 9:
        return "morning"
    if 9 <= hour < 15:
        return "midday"
    if 15 <= hour < 21:
        return "afternoon"
    return "night"


@dataclass(frozen=True, slots=True)
class SkillKey:
    """What a skill record is about. Section 35."""

    source: str
    variable: str
    task: str = "occurrence"
    region: str = "all"
    season: str = "all"
    regime: str = "all"
    lead_bucket: str = "all"
    valid_hour_bucket: str = "all"

    def as_tuple(self) -> tuple:
        return tuple(getattr(self, name) for name in DIMENSIONS)

    def to_dict(self) -> dict:
        return {name: getattr(self, name) for name in DIMENSIONS}

    @property
    def storage_key(self) -> str:
        return "|".join(self.as_tuple())


@dataclass(frozen=True, slots=True)
class SkillRecord:
    """One measured skill value, with everything needed to read it."""

    key: SkillKey
    metric: str
    value: float
    #: Sample. Section 36 requires all of these.
    n: int
    n_effective: float | None
    n_events: int
    first_valid: datetime | None
    last_valid: datetime | None
    #: Section 37's uncertainty around the estimate.
    interval: tuple[float, float] | None = None
    #: Spatially separate storm areas behind this score. For a rare event
    #: this, not the event-cell count, is the number of independent cases.
    independent_events: int | None = None
    baseline: str | None = None
    #: Section 58: which verification produced this.
    verification_version: str = ""
    observation_version: str = ""
    computed_at: datetime | None = None

    @property
    def trustworthy(self) -> bool:
        """Whether this record should influence anything.

        Deliberately strict. Stage 6 shrinks towards a parent when a sample
        is thin, and this flag tells it which records are thin.
        """
        if self.n_events < 30:
            return False
        if self.n_effective is not None and self.n_effective < 30:
            return False
        # The one that actually bites on convective data. A day with 400
        # event cells arranged in two storm clusters carries two
        # independent cases, and no weighting should rest on two.
        if self.independent_events is not None and self.independent_events < 10:
            return False
        return True

    def to_dict(self) -> dict:
        return {
            **self.key.to_dict(),
            "metric": self.metric,
            "value": round(self.value, 6),
            "baseline": self.baseline,
            "n": self.n,
            "n_effective": (
                round(self.n_effective, 1)
                if self.n_effective is not None else None
            ),
            "n_events": self.n_events,
            "independent_events": self.independent_events,
            "period": {
                "from": (
                    self.first_valid.isoformat() if self.first_valid else None
                ),
                "to": (
                    self.last_valid.isoformat() if self.last_valid else None
                ),
            },
            "interval_95": (
                [round(v, 6) for v in self.interval] if self.interval
                else None
            ),
            "trustworthy": self.trustworthy,
            "caveat": (
                None if self.trustworthy else
                f"{self.n_events} event cells in "
                f"{self.independent_events} separate storm cluster(s): this "
                f"is a description of a few cases, not a skill estimate, and "
                f"nothing should be weighted by it"
            ),
            "verification_version": self.verification_version,
            "observation_version": self.observation_version,
            "computed_at": (
                self.computed_at.isoformat() if self.computed_at else None
            ),
        }


@dataclass(frozen=True, slots=True)
class TCMSkillKey:
    """What a TCM-level skill record is about. Section 44.

    Distinct from  because the question is different. An NWP
    record asks "how good is this model here"; a TCM record asks "did
    version 5.1 beat version 5.0", and that needs the VERSIONS of every
    component that could have changed the answer -- otherwise an
    improvement in the engines and a change in the calibration are
    indistinguishable in the history.
    """

    tcm_version: str
    variable: str
    forecast_engine_version: str = ""
    calibration_version: str = ""
    spatial_version: str = ""
    region: str = "all"
    season: str = "all"
    regime: str = "all"
    lead_bucket: str = "all"
    #: Probability band, so section 64's reliability-by-bin survives into
    #: the stored history rather than being recomputed each time.
    probability_bin: str = "all"

    def to_dict(self) -> dict:
        return {
            name: getattr(self, name)
            for name in TCM_DIMENSIONS
        }

    @property
    def storage_key(self) -> str:
        return "|".join(str(getattr(self, n)) for n in TCM_DIMENSIONS)

    def as_skill_key(self) -> "SkillKey":
        """The generic key, so one store type can hold both."""
        return SkillKey(
            source=f"tcm/{self.tcm_version}", variable=self.variable,
            region=self.region, season=self.season, regime=self.regime,
            lead_bucket=self.lead_bucket,
        )


#: Dimensions of a TCM-level record. Section 44.
TCM_DIMENSIONS = (
    "tcm_version", "forecast_engine_version", "calibration_version",
    "spatial_version", "variable", "region", "season", "regime",
    "lead_bucket", "probability_bin",
)


def version_comparison(
    store: "SkillStore", metric: str, variable: str,
    a: str, b: str, **conditions,
) -> dict:
    """Did TCM version b beat version a? Section 70.

    Refuses unless both versions were scored under IDENTICAL conditions.
    Section 70 is explicit that comparing two versions under different
    verification conditions and calling the difference an improvement is
    not a comparison, and the refusal is what makes that structural.
    """
    rows = {}
    for version in (a, b):
        found = store.query(
            metric=metric, variable=variable,
            source=f"tcm/{version}", **conditions,
        )
        rows[version] = found

    missing = [v for v, found in rows.items() if not found]
    if missing:
        return {
            "comparable": False,
            "reason": (
                f"no records for TCM version(s) {missing} under these "
                f"conditions, so the comparison cannot be made"
            ),
        }

    def one(found):
        return min(found, key=lambda r: r.last_valid or r.first_valid)

    left, right = one(rows[a]), one(rows[b])
    differing = []
    if left.observation_version != right.observation_version:
        differing.append(
            f"observation dataset: {left.observation_version} vs "
            f"{right.observation_version}"
        )
    if left.verification_version != right.verification_version:
        differing.append(
            f"verification method: {left.verification_version} vs "
            f"{right.verification_version}"
        )
    if differing:
        return {
            "comparable": False,
            "reason": (
                "the two versions were scored under different conditions ("
                + "; ".join(differing) + "), so the difference between them "
                "is not evidence about the forecasts"
            ),
        }

    higher_better = metric in ("roc_auc", "pr_auc", "brier_skill_score")
    improved = (
        right.value > left.value if higher_better else right.value < left.value
    )
    trustworthy = left.trustworthy and right.trustworthy
    return {
        "comparable": True,
        "metric": metric,
        a: left.to_dict(),
        b: right.to_dict(),
        "difference": round(right.value - left.value, 6),
        "improved": improved,
        "verdict": (
            f"{b} scores {'better' if improved else 'worse'} than {a}"
            + (
                "" if trustworthy else
                ", but at least one version rests on too few independent "
                "storms for the difference to mean anything"
            )
        ),
    }


class SkillStore:
    """A queryable store of skill records. Sections 83 and 44."""

    def __init__(self, name: str, records: list[SkillRecord] | None = None):
        self.name = name
        self.records: list[SkillRecord] = list(records or [])

    # -- writing -----------------------------------------------------------

    def add(self, record: SkillRecord) -> None:
        self.records.append(record)

    def add_from_verification(
        self, result, *, source: str, key: SkillKey | None = None,
    ) -> list[SkillRecord]:
        """Fold a `VerificationResult` into the store."""
        from .run import VerificationResult
        assert isinstance(result, VerificationResult)

        key = key or SkillKey(source=source, variable=result.conditions.target)
        now = datetime.now(timezone.utc)
        added: list[SkillRecord] = []
        for name, score in result.scores.items():
            if not score.available:
                continue
            record = SkillRecord(
                key=key, metric=name, value=float(score.value),
                n=score.n, n_effective=score.n_effective,
                n_events=score.n_events,
                first_valid=result.valid_from, last_valid=result.valid_to,
                interval=score.interval,
                independent_events=result.sample.get("independent_events"),
                verification_version=result.conditions.verification_version,
                observation_version=result.conditions.observation_version,
                computed_at=now,
            )
            self.add(record)
            added.append(record)
        for name, score in result.skill_vs.items():
            if not score.available:
                continue
            record = SkillRecord(
                key=key, metric="brier_skill_score", value=float(score.value),
                n=score.n, n_effective=score.n_effective,
                n_events=score.n_events,
                first_valid=result.valid_from, last_valid=result.valid_to,
                baseline=name,
                independent_events=result.sample.get("independent_events"),
                verification_version=result.conditions.verification_version,
                observation_version=result.conditions.observation_version,
                computed_at=now,
            )
            self.add(record)
            added.append(record)
        return added

    # -- querying ----------------------------------------------------------

    def query(self, **filters) -> list[SkillRecord]:
        """Records matching the given dimensions.

        A dimension not supplied is not constrained, so `query(source="ukv")`
        returns every UKV record across every region and season.

        The value "all" also means unconstrained rather than matching the
        literal string, because "all" is what a dimension holds when the
        record was not stratified by it. Querying season="all" against a
        store whose records are stamped "summer" would otherwise return
        nothing, which reads as "no skill" rather than "wrong question".
        The conditions actually applied are echoed in `rank`'s output, so
        pooling is visible rather than silent.
        """
        unknown = set(filters) - set(DIMENSIONS) - {"metric", "baseline"}
        if unknown:
            raise ValueError(
                f"unknown skill dimension(s): {sorted(unknown)}. Valid "
                f"dimensions are {list(DIMENSIONS)} plus metric and baseline"
            )
        out = []
        for record in self.records:
            if any(
                value != "all" and getattr(record.key, name) != value
                for name, value in filters.items()
                if name in DIMENSIONS
            ):
                continue
            if "metric" in filters and record.metric != filters["metric"]:
                continue
            if "baseline" in filters and record.baseline != filters["baseline"]:
                continue
            out.append(record)
        return out

    def rank(
        self, *, metric: str, variable: str, region: str = "all",
        season: str = "all", regime: str = "all", lead_bucket: str = "all",
        higher_is_better: bool | None = None,
    ) -> dict:
        """Rank sources under FULLY SPECIFIED conditions. Section 97.

        Every dimension is a required or defaulted argument, so a ranking
        cannot be produced without stating what it is a ranking of. The
        result carries those conditions and every entry carries its sample.
        """
        if higher_is_better is None:
            higher_is_better = metric in (
                "roc_auc", "pr_auc", "brier_skill_score", "correlation", "csi",
            )
        found = self.query(
            metric=metric, variable=variable, region=region, season=season,
            regime=regime, lead_bucket=lead_bucket,
        )
        ordered = sorted(
            found, key=lambda r: r.value, reverse=higher_is_better
        )
        untrustworthy = [r.key.source for r in ordered if not r.trustworthy]
        return {
            "conditions": {
                "metric": metric, "variable": variable, "region": region,
                "season": season, "regime": regime,
                "lead_bucket": lead_bucket,
                "higher_is_better": higher_is_better,
            },
            "ranking": [
                {"rank": i + 1, **r.to_dict()}
                for i, r in enumerate(ordered)
            ],
            "note": (
                "this ranking is valid ONLY under the conditions above. "
                "There is no universal best model, and a ranking quoted "
                "without its variable, region, lead time, season, regime "
                "and sample size means nothing"
            ),
            "warning": (
                f"sources with samples too small to rank: "
                f"{sorted(set(untrustworthy))}"
                if untrustworthy else None
            ),
        }

    def summary(self) -> dict:
        by_metric: dict[str, int] = {}
        by_source: dict[str, int] = {}
        for record in self.records:
            by_metric[record.metric] = by_metric.get(record.metric, 0) + 1
            by_source[record.key.source] = (
                by_source.get(record.key.source, 0) + 1
            )
        trustworthy = sum(1 for r in self.records if r.trustworthy)
        return {
            "store": self.name,
            "records": len(self.records),
            "trustworthy_records": trustworthy,
            "by_metric": by_metric,
            "by_source": by_source,
            "version": SKILLDB_VERSION,
            "note": (
                f"{len(self.records) - trustworthy} of {len(self.records)} "
                f"records rest on too few events to be used for weighting"
            ) if len(self.records) != trustworthy else None,
        }

    # -- persistence -------------------------------------------------------

    def save(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "store": self.name,
            "version": SKILLDB_VERSION,
            "records": [r.to_dict() for r in self.records],
        }, indent=1), encoding="utf-8")
        return path

    def for_stage6(self) -> list[dict]:
        """Records in the shape Stage 6 consumes. Section 41.

        Only trustworthy records are handed over. Stage 6 already shrinks
        thin samples towards a parent, but passing it a record built on
        three events would have it shrink something that should never have
        been offered.
        """
        return [
            {
                "model": r.key.source,
                "variable": r.key.variable,
                "region": r.key.region,
                "season": r.key.season,
                "regime": r.key.regime,
                "lead_bucket": r.key.lead_bucket,
                "metric": r.metric,
                "value": r.value,
                "n": r.n,
                "n_effective": r.n_effective,
                "n_events": r.n_events,
                "valid_from": (
                    r.first_valid.isoformat() if r.first_valid else None
                ),
                "valid_to": r.last_valid.isoformat() if r.last_valid else None,
            }
            for r in self.records if r.trustworthy
        ]


# --------------------------------------------------------------------------
# Drift -- sections 42, 43, 56, 66
# --------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class DriftFinding:
    """A detected change in behaviour, and what it might mean."""

    subject: str
    metric: str
    before: float
    after: float
    change: float
    n_before: int
    n_after: int
    significant: bool
    likely_cause: str
    verdict: str

    def to_dict(self) -> dict:
        return {
            "subject": self.subject, "metric": self.metric,
            "before": round(self.before, 6), "after": round(self.after, 6),
            "change": round(self.change, 6),
            "n_before": self.n_before, "n_after": self.n_after,
            "significant": self.significant,
            "likely_cause": self.likely_cause,
            "verdict": self.verdict,
        }


def detect_drift(
    records: list[SkillRecord], *, metric: str, min_each_side: int = 5,
    observation_coverage_changed: bool = False,
) -> list[DriftFinding]:
    """Split a metric's history in half and test for a shift. Section 43.

    Deliberately conservative. Section 43 says not to retire or reweight a
    model on one anomalous period, so a finding here is a flag for
    investigation and never an action -- nothing in this module changes a
    weight.

    Section 57 is enforced through `observation_coverage_changed`: when the
    observing system changed across the period, a shift in the statistics
    is not evidence about the model, and the verdict says so instead of
    blaming the forecast.
    """
    series = sorted(
        [r for r in records if r.metric == metric and r.last_valid],
        key=lambda r: r.last_valid,
    )
    if len(series) < 2 * min_each_side:
        return []

    half = len(series) // 2
    before = np.array([r.value for r in series[:half]])
    after = np.array([r.value for r in series[half:]])
    change = float(after.mean() - before.mean())

    # A shift is significant when it exceeds the pooled spread. Not a
    # t-test: the records are not independent draws, and pretending they
    # are would manufacture significance.
    spread = float(np.sqrt(before.var() + after.var()) or 0.0)
    significant = abs(change) > max(2.0 * spread, 1e-9)

    if observation_coverage_changed:
        cause = "observing system"
        verdict = (
            "the observation coverage changed across this period, so a "
            "shift in the statistics is not evidence about the forecast "
            "model. Section 57: check observation continuity before "
            "concluding anything about skill"
        )
    elif not significant:
        cause = "noise"
        verdict = "within the spread of the series; not a detected shift"
    else:
        cause = "forecast model or its inputs"
        verdict = (
            "a shift larger than the series spread. This is a flag for "
            "investigation, NOT grounds to retire or reweight anything: "
            "section 43 requires statistical evidence and a minimum sample "
            "before acting"
        )

    return [DriftFinding(
        subject=series[0].key.source, metric=metric,
        before=float(before.mean()), after=float(after.mean()),
        change=change, n_before=len(before), n_after=len(after),
        significant=significant, likely_cause=cause, verdict=verdict,
    )]


def probability_drift(
    distribution_before: dict, distribution_after: dict
) -> dict:
    """Has the shape of the forecast distribution changed? Section 56.

    A system that historically issued mostly low probabilities and suddenly
    issues 80-100% everywhere has broken, not improved, and this catches it
    without needing any observations at all -- which matters because it can
    fire before the verification data arrives.
    """
    keys = sorted(set(distribution_before) | set(distribution_after))
    total_before = sum(distribution_before.get(k, 0) for k in keys) or 1
    total_after = sum(distribution_after.get(k, 0) for k in keys) or 1

    rows = []
    total_variation = 0.0
    for key in keys:
        p = distribution_before.get(key, 0) / total_before
        q = distribution_after.get(key, 0) / total_after
        total_variation += abs(p - q)
        rows.append({
            "bin": key, "before": round(p, 5), "after": round(q, 5),
            "change": round(q - p, 5),
        })
    total_variation *= 0.5

    return {
        "bins": rows,
        "total_variation_distance": round(total_variation, 5),
        "alert": total_variation > 0.25,
        "verdict": (
            "the forecast probability distribution has changed shape "
            "substantially. This can be calibration failure, an input "
            "failure, a weighting failure or a code regression -- it is a "
            "reason to investigate, and it needs no observations to detect"
            if total_variation > 0.25 else
            "the forecast distribution is broadly unchanged"
        ),
    }
