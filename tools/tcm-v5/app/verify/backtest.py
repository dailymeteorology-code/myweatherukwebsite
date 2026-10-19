"""Backtesting across seasons, regions, regimes, lead times and event types.

Step 15 of the Stage 9 order, sections 35, 38 to 41, 62, 63, 64 and 87.

An overall skill number hides exactly the thing worth knowing. Section 87
makes the point directly: a system that performs well nationally and badly
on elevated nocturnal convection has a specific weakness, and the national
mean is where that weakness goes to hide.

So every verification here is STRATIFIED, and each stratum reports its own
sample. That second half matters more than the first: slicing a small
dataset produces many strata, most of them containing almost nothing, and a
stratified report without sample sizes is a machine for generating spurious
findings.

WHAT A STRATUM MUST CARRY TO BE READ
------------------------------------
Every row reports its independent storm count alongside its score, and
`_verdict` refuses to characterise a stratum below a threshold. On the
archive as it stands almost every stratum is refused, and that is the
correct output rather than a failure of the code.

CASE STUDIES ARE NOT A SUBSTITUTE FOR STATISTICS
------------------------------------------------
Section 62 asks for a curated case archive and says plainly that it should
support scientific debugging rather than replace statistical verification.
`case_studies` therefore selects cases by their VERIFICATION OUTCOME --
biggest miss, biggest false alarm, best hit -- so the archive is a window
onto the statistics rather than a separate anecdote collection.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime

import numpy as np

from . import attribution as ATTR
from . import metrics as M
from . import run as RUN
from . import skilldb as SKILL
from .matching import MatchedField, effective_sample

log = logging.getLogger(__name__)

BACKTEST_VERSION = "stage9.1"

#: Independent storm clusters a stratum needs before its score is
#: characterised at all. Ten is the same bar `SkillRecord.trustworthy`
#: uses, kept identical so the two cannot disagree about the same data.
MIN_CLUSTERS_TO_JUDGE = 10


@dataclass(slots=True)
class Stratum:
    """One slice of the verification, with its own sample."""

    dimension: str
    value: str
    n_hours: int
    n_cells: int
    n_events: int
    independent_events: int
    scores: dict[str, M.Score] = dc_field(default_factory=dict)
    base_rate: float | None = None
    verdict: str = ""

    @property
    def judgeable(self) -> bool:
        return self.independent_events >= MIN_CLUSTERS_TO_JUDGE

    def to_dict(self) -> dict:
        return {
            "dimension": self.dimension,
            "value": self.value,
            "hours": self.n_hours,
            "cells": self.n_cells,
            "event_cells": self.n_events,
            "independent_events": self.independent_events,
            "base_rate": (
                round(self.base_rate, 6) if self.base_rate is not None
                else None
            ),
            "scores": {k: v.to_dict() for k, v in self.scores.items()},
            "judgeable": self.judgeable,
            "verdict": self.verdict,
        }


def _score(fields: list[MatchedField], target: str) -> dict[str, M.Score]:
    usable = [f for f in fields if f.n_usable > 0]
    if not usable:
        return {}
    forecast = np.concatenate([f.pairs()[0] for f in usable])
    observed = np.concatenate([f.pairs()[1] for f in usable])
    n_effective = effective_sample(usable).get("effective_cells")
    return {
        "brier_score": M.brier_score(
            forecast, observed, target=target, n_effective=n_effective),
        "roc_auc": M.roc_auc(
            forecast, observed, target=target, n_effective=n_effective),
        "pr_auc": M.pr_auc(
            forecast, observed, target=target, n_effective=n_effective),
    }


def _verdict(stratum: Stratum) -> str:
    if stratum.n_hours == 0:
        return "no data in this stratum"
    if not stratum.judgeable:
        return (
            f"NOT JUDGEABLE: {stratum.independent_events} independent storm "
            f"cluster(s). Any apparent difference from another stratum is "
            f"noise, and stratifying a small dataset until every slice looks "
            f"different is how spurious findings are made"
        )
    auc = stratum.scores.get("roc_auc")
    if auc is None or not auc.available:
        return (
            f"{stratum.independent_events} independent storms, but "
            f"discrimination could not be computed (the stratum has only "
            f"one outcome)"
        )
    if auc.value > 0.7:
        quality = "useful discrimination"
    elif auc.value > 0.55:
        quality = "weak but real discrimination"
    else:
        quality = "no useful discrimination"
    return (
        f"{quality} (AUC {auc.value:.3f}) on {stratum.independent_events} "
        f"independent storms"
    )


# --------------------------------------------------------------------------
# Stratification
# --------------------------------------------------------------------------

def by_lead_time(
    fields: list[MatchedField], leads: dict[datetime, int], *, target: str,
) -> list[Stratum]:
    """Section 39. Where does skill degrade, and how?

    `leads` maps a valid time to the forecast hour it came from. Section 39
    warns against forcing a linear degradation curve, so the buckets are
    reported independently and no curve is fitted to them.
    """
    groups: dict[str, list[MatchedField]] = {}
    for field in fields:
        hours = leads.get(field.valid_time)
        if hours is None:
            continue
        groups.setdefault(SKILL.lead_bucket(hours), []).append(field)
    return _build("lead_time", groups, target)


def by_time_of_day(
    fields: list[MatchedField], *, target: str
) -> list[Stratum]:
    """Section 35. Convection has a strong diurnal cycle, and a score
    pooled across it describes an average day that never happens."""
    groups: dict[str, list[MatchedField]] = {}
    for field in fields:
        groups.setdefault(
            SKILL.hour_bucket(field.valid_time), []
        ).append(field)
    return _build("time_of_day", groups, target)


def by_season(fields: list[MatchedField], *, target: str) -> list[Stratum]:
    """Section 40."""
    groups: dict[str, list[MatchedField]] = {}
    for field in fields:
        groups.setdefault(
            SKILL.season_of(field.valid_time), []
        ).append(field)
    return _build("season", groups, target)


def by_region(
    fields: list[MatchedField], region_masks: dict[str, np.ndarray], *,
    target: str,
) -> list[Stratum]:
    """Section 38. Skill varies with terrain, coast and model resolution.

    Regions are applied as CELL masks rather than by splitting the hours,
    because one hour covers every region at once.
    """
    out: list[Stratum] = []
    for name, mask in sorted(region_masks.items()):
        restricted: list[MatchedField] = []
        for field in fields:
            if mask.shape != field.forecast.shape:
                continue
            usable = field.usable & mask
            if not usable.any():
                continue
            restricted.append(MatchedField(
                valid_time=field.valid_time, forecast=field.forecast,
                observed=field.observed, usable=usable, policy=field.policy,
                observation_quality=field.observation_quality,
                coverage=field.coverage, flash_count=field.flash_count,
            ))
        out.append(_stratum("region", name, restricted, target))
    return out


def by_regime(
    fields: list[MatchedField], regimes: dict[datetime, str], *, target: str,
) -> list[Stratum]:
    """Section 41. Skill by the Stage 5 convective regime.

    `regimes` maps a valid time to the dominant regime identified AT
    FORECAST TIME. Section 79: a regime derived from how the event turned
    out would predict the outcome, so the caller must supply the
    forecast-time label and nothing here re-derives it from the outcome.
    """
    groups: dict[str, list[MatchedField]] = {}
    for field in fields:
        groups.setdefault(
            regimes.get(field.valid_time, "unclassified"), []
        ).append(field)
    return _build("regime", groups, target)


def by_probability_bin(
    fields: list[MatchedField], *, target: str, n_bins: int = 10
) -> list[Stratum]:
    """Section 64. Observed frequency in each forecast-probability band.

    Reported as strata rather than only as a reliability diagram, so a bin
    carries the same sample discipline as every other slice.
    """
    usable = [f for f in fields if f.n_usable > 0]
    if not usable:
        return []
    forecast = np.concatenate([f.pairs()[0] for f in usable])
    observed = np.concatenate([f.pairs()[1] for f in usable])
    edges = np.linspace(0.0, 1.0, n_bins + 1)

    out: list[Stratum] = []
    for i in range(n_bins):
        lo, hi = float(edges[i]), float(edges[i + 1])
        inside = (forecast >= lo) & (
            forecast < hi if i < n_bins - 1 else forecast <= hi
        )
        count = int(inside.sum())
        events = int(observed[inside].sum()) if count else 0
        stratum = Stratum(
            dimension="probability_bin", value=f"{lo:.0%}-{hi:.0%}",
            n_hours=len(usable), n_cells=count, n_events=events,
            # A probability bin is not a spatial region, so storm clusters
            # cannot be counted within it; the event count stands in and
            # the threshold is applied to that instead.
            independent_events=events,
            base_rate=(
                float(observed[inside].mean()) if count else None
            ),
        )
        if count:
            stratum.verdict = (
                f"mean forecast {float(forecast[inside].mean()):.3f}, "
                f"observed {stratum.base_rate:.3f} over {count} cells"
                + (
                    "" if count >= 30 else
                    " -- too few cases for this bin to say anything"
                )
            )
        else:
            stratum.verdict = "no forecasts fell in this bin"
        out.append(stratum)
    return out


def _build(
    dimension: str, groups: dict[str, list[MatchedField]], target: str
) -> list[Stratum]:
    return [
        _stratum(dimension, name, fields, target)
        for name, fields in sorted(groups.items())
    ]


def _stratum(
    dimension: str, value: str, fields: list[MatchedField], target: str
) -> Stratum:
    usable = [f for f in fields if f.n_usable > 0]
    sample = effective_sample(usable) if usable else {}
    observed = (
        np.concatenate([f.pairs()[1] for f in usable]) if usable
        else np.array([])
    )
    stratum = Stratum(
        dimension=dimension, value=value, n_hours=len(usable),
        n_cells=int(sample.get("raw_cells", 0)),
        n_events=int(observed.sum()) if observed.size else 0,
        independent_events=int(sample.get("independent_events", 0)),
        scores=_score(usable, target),
        base_rate=float(observed.mean()) if observed.size else None,
    )
    stratum.verdict = _verdict(stratum)
    return stratum


# --------------------------------------------------------------------------
# Section 62 -- case studies chosen by outcome
# --------------------------------------------------------------------------

@dataclass(slots=True)
class CaseStudy:
    """One hour worth looking at, and why it was selected."""

    valid_time: datetime
    selected_as: str
    diagnosis: dict
    attribution: dict
    coverage: float
    observation_quality: str

    def to_dict(self) -> dict:
        return {
            "valid_time": self.valid_time.isoformat(),
            "selected_as": self.selected_as,
            "observation_coverage": round(self.coverage, 3),
            "observation_quality": self.observation_quality,
            "diagnosis": self.diagnosis,
            "attribution": self.attribution,
        }


def case_studies(
    fields: list[MatchedField], *, threshold: float = 0.1, per_kind: int = 2
) -> list[CaseStudy]:
    """Curate cases by verification outcome. Section 62.

    Selected from the statistics rather than chosen by eye, so the archive
    cannot drift into a collection of memorable days that happen to support
    a belief.
    """
    diagnoses = [ATTR.diagnose(f, threshold=threshold) for f in fields]
    by_time = {d.valid_time: d for d in diagnoses}

    def pick(outcome: ATTR.Outcome, key, label: str) -> list[CaseStudy]:
        chosen = sorted(
            [d for d in diagnoses if d.outcome is outcome],
            key=key, reverse=True,
        )[:per_kind]
        out = []
        for diagnosis in chosen:
            field = next(
                f for f in fields if f.valid_time == diagnosis.valid_time
            )
            out.append(CaseStudy(
                valid_time=diagnosis.valid_time, selected_as=label,
                diagnosis=diagnosis.to_dict(),
                attribution=ATTR.attribute(
                    diagnosis, neighbouring_hours=diagnoses
                ).to_dict(),
                coverage=field.coverage,
                observation_quality=field.observation_quality.value,
            ))
        return out

    cases: list[CaseStudy] = []
    cases += pick(
        ATTR.Outcome.MISS, lambda d: d.observed_area_cells,
        "largest missed event")
    cases += pick(
        ATTR.Outcome.FALSE_ALARM, lambda d: d.forecast_area_cells,
        "largest false alarm")
    cases += pick(
        ATTR.Outcome.HIT, lambda d: d.jaccard or 0.0,
        "best overlap")
    displaced = sorted(
        [d for d in diagnoses
         if d.displacement_m is not None and d.overlap_cells == 0],
        key=lambda d: d.displacement_m or 0.0, reverse=True,
    )[:per_kind]
    for diagnosis in displaced:
        field = next(f for f in fields if f.valid_time == diagnosis.valid_time)
        cases.append(CaseStudy(
            valid_time=diagnosis.valid_time,
            selected_as="largest displacement",
            diagnosis=diagnosis.to_dict(),
            attribution=ATTR.attribute(
                diagnosis, neighbouring_hours=diagnoses).to_dict(),
            coverage=field.coverage,
            observation_quality=field.observation_quality.value,
        ))
    return cases


# --------------------------------------------------------------------------
# Section 63 -- spatial error diagnostics
# --------------------------------------------------------------------------

def error_maps(fields: list[MatchedField]) -> dict:
    """Where the errors are, as fields rather than as numbers. Section 63.

    Summed over the period so a persistent regional bias shows up. Returned
    as statistics and cell counts rather than whole arrays: the arrays are
    on the caller's grid and the renderer already knows how to draw them.
    """
    usable = [f for f in fields if f.n_usable > 0]
    if not usable:
        return {"available": False, "reason": "no usable hours"}

    shape = usable[0].forecast.shape
    bias = np.zeros(shape)
    misses = np.zeros(shape)
    false_alarms = np.zeros(shape)
    counted = np.zeros(shape)

    for field in usable:
        if field.forecast.shape != shape:
            continue
        mask = field.usable
        forecast = np.where(mask, np.nan_to_num(field.forecast), 0.0)
        observed = np.where(mask, np.nan_to_num(field.observed), 0.0)
        bias += forecast - observed
        misses += ((observed > 0.5) & (forecast < 0.1) & mask).astype(float)
        false_alarms += (
            (observed <= 0.5) & (forecast >= 0.1) & mask
        ).astype(float)
        counted += mask.astype(float)

    with np.errstate(invalid="ignore", divide="ignore"):
        mean_bias = np.where(counted > 0, bias / counted, np.nan)

    finite = mean_bias[np.isfinite(mean_bias)]
    return {
        "available": True,
        "hours": len(usable),
        "mean_bias": {
            "min": round(float(finite.min()), 6) if finite.size else None,
            "max": round(float(finite.max()), 6) if finite.size else None,
            "mean": round(float(finite.mean()), 6) if finite.size else None,
            "note": (
                "forecast minus observed, averaged over the period. A "
                "persistent positive area is systematic overforecasting "
                "there, which a single national number cannot show"
            ),
        },
        "missed_event_cells": int(misses.sum()),
        "false_alarm_cells": int(false_alarms.sum()),
        "cells_with_any_miss": int((misses > 0).sum()),
        "cells_with_any_false_alarm": int((false_alarms > 0).sum()),
        "fields": {
            "mean_bias": mean_bias,
            "miss_count": misses,
            "false_alarm_count": false_alarms,
        },
    }


# --------------------------------------------------------------------------
# The whole backtest
# --------------------------------------------------------------------------

def run(
    fields: list[MatchedField], *, target: str, source: str,
    event_definition: str,
    leads: dict[datetime, int] | None = None,
    regimes: dict[datetime, str] | None = None,
    region_masks: dict[str, np.ndarray] | None = None,
) -> dict:
    """Step 15: verify across every dimension the data supports."""
    overall = RUN.verify(
        fields, forecast_source=source, target=target,
        event_definition=event_definition,
    )

    strata: dict[str, list[dict]] = {}
    strata["time_of_day"] = [
        s.to_dict() for s in by_time_of_day(fields, target=target)
    ]
    strata["season"] = [
        s.to_dict() for s in by_season(fields, target=target)
    ]
    strata["probability_bin"] = [
        s.to_dict() for s in by_probability_bin(fields, target=target)
    ]
    if leads:
        strata["lead_time"] = [
            s.to_dict() for s in by_lead_time(fields, leads, target=target)
        ]
    if regimes:
        strata["regime"] = [
            s.to_dict() for s in by_regime(fields, regimes, target=target)
        ]
    if region_masks:
        strata["region"] = [
            s.to_dict()
            for s in by_region(fields, region_masks, target=target)
        ]

    judgeable = {
        dimension: [r["value"] for r in rows if r["judgeable"]]
        for dimension, rows in strata.items()
    }
    total_judgeable = sum(len(v) for v in judgeable.values())
    total_strata = sum(len(v) for v in strata.values())

    maps = error_maps(fields)
    maps.pop("fields", None)

    return {
        "version": BACKTEST_VERSION,
        "overall": overall.to_dict(),
        "strata": strata,
        "judgeable_strata": judgeable,
        "coverage_of_the_backtest": {
            "strata_computed": total_strata,
            "strata_judgeable": total_judgeable,
            "verdict": (
                f"{total_judgeable} of {total_strata} strata carry enough "
                f"independent storms to be characterised"
                + (
                    ". Section 87 asks which weaknesses to prioritise; with "
                    "this sample the honest answer is that no stratified "
                    "conclusion is supportable and the priority is more "
                    "verification data"
                    if total_judgeable <= 1 else ""
                )
            ),
        },
        "case_studies": [c.to_dict() for c in case_studies(fields)],
        "error_maps": maps,
        "note": (
            "an overall score hides the weakness worth finding. Every "
            "stratum here reports its own independent-storm count, and one "
            "below the threshold is refused rather than characterised"
        ),
    }
