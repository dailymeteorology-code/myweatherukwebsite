"""Automatic outlook generation.

The spec's constraint on this module is absolute:

    The text generation system MUST NOT invent weather data. It must only
    describe values and conclusions produced by the TCM forecast engine.

That is enforced structurally rather than by discipline. Every sentence is a
`Statement`, and a `Statement` cannot be constructed without the diagnostic
values that justify it. `Outlook.audit()` returns every sentence paired with
its evidence, so any claim in the text can be traced back to a number the
engine actually computed. There is no free-text path and no language model
anywhere in here: the outlook is a rendering of the diagnostics, not a
retelling of them.

Two further rules follow from the platform's own limits:

  * **Nothing is said about storm placement beyond the storm-scale limit.**
    Past the last lead time with a convection-permitting model, the outlook
    describes the convective ENVIRONMENT and says so. Claiming to know where
    storms will form on day 4 from a 56 km model would be invention by
    another route.

  * **Missing ingredients are stated in the text, not just the metadata.**
    A forecaster reading the outlook needs to know that it was written
    without convective inhibition or shear.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from typing import Any

import numpy as np

from ..horizon import ForecastScale, coverage_for
from .lightning import LightningProducts
from .regions import describe_areas, regions_above
from .risk import ConvectiveRisk, RiskLevel

log = logging.getLogger(__name__)

#: Risk index above which an area is worth naming in the outlook.
AREA_THRESHOLD = 20.0
#: Index above which the headline calls it a thunderstorm risk at all.
HEADLINE_THRESHOLD = 5.0


@dataclass(frozen=True, slots=True)
class Statement:
    """One sentence, and the diagnostics that justify it.

    Constructing a Statement requires evidence. That is the mechanism by
    which the outlook cannot assert anything the engine did not compute.
    """

    text: str
    evidence: dict[str, Any]
    topic: str = "general"

    def __post_init__(self) -> None:
        if not self.evidence:
            raise ValueError(
                f"statement {self.text!r} has no supporting diagnostics; "
                "every sentence in an outlook must be traceable to a value "
                "the forecast engine produced"
            )


@dataclass(slots=True)
class Outlook:
    issued_at: datetime
    valid_from: datetime
    valid_to: datetime
    headline: Statement
    statements: list[Statement] = dc_field(default_factory=list)
    #: Structured summary the UI can render without parsing prose.
    summary: dict[str, Any] = dc_field(default_factory=dict)

    def text(self) -> str:
        lines = [self.headline.text]
        lines.extend(s.text for s in self.statements)
        return "\n\n".join(lines)

    def audit(self) -> list[dict]:
        """Every sentence with the values behind it."""
        return [
            {"topic": s.topic, "text": s.text, "evidence": s.evidence}
            for s in [self.headline, *self.statements]
        ]

    def to_dict(self) -> dict:
        return {
            "issued_at": self.issued_at.isoformat(),
            "valid_from": self.valid_from.isoformat(),
            "valid_to": self.valid_to.isoformat(),
            "headline": self.headline.text,
            "text": self.text(),
            "statements": [s.text for s in self.statements],
            "summary": self.summary,
            "audit": self.audit(),
            "generation": {
                "method": "deterministic rendering of forecast diagnostics",
                "language_model_used": False,
                "note": (
                    "Every sentence is derived from values computed by the "
                    "TCM forecast engine and is listed in `audit` with the "
                    "diagnostics that justify it. No weather information is "
                    "introduced by the text generator."
                ),
            },
        }


def _level_phrase(level: RiskLevel) -> str:
    """Wording for each canonical band.

    Derived from the band's own display name so adding a band to the scale
    cannot leave this dict silently missing a key -- which is exactly what
    happened when the platform's eight-band scale replaced TCM's five.
    """
    if level is RiskLevel.NONE:
        return "No meaningful thunderstorm risk"
    article = "An" if level.display_name[0].lower() in "aeiou" else "A"
    return f"{article} {level.display_name.lower()} thunderstorm risk"


def _timing_phrase(risks: list[ConvectiveRisk]) -> tuple[str, dict]:
    """When the risk peaks, from the per-hour indices only."""
    scored = [
        (r.forecast_hour, r.peak_index, r.valid_time, r.severity,
         r.area_fraction)
        for r in risks
    ]
    peak_hour, peak_index, peak_valid, _, peak_area = max(
        scored, key=lambda t: t[3]
    )
    active = [t for t in scored if t[4] > 0]
    evidence = {
        "peak_forecast_hour": peak_hour,
        "peak_index": round(peak_index, 1),
        "peak_valid_time": peak_valid.isoformat(),
        "hours_above_threshold": [t[0] for t in active],
        "threshold": AREA_THRESHOLD,
    }
    if not active:
        return (
            f"The risk stays below the {AREA_THRESHOLD:.0f} index threshold "
            f"throughout, peaking at {peak_index:.0f} around "
            f"{peak_valid:%H%MZ on %d %b}.",
            evidence,
        )
    first, last = active[0], active[-1]
    if first[0] == last[0]:
        return (
            f"The risk is focused on {first[2]:%H%MZ on %d %b}, when the "
            f"index reaches {first[1]:.0f}.",
            evidence,
        )
    return (
        f"The risk runs from around {first[2]:%H%MZ on %d %b} to "
        f"{last[2]:%H%MZ on %d %b}, peaking at {peak_index:.0f} near "
        f"{peak_valid:%H%MZ}.",
        evidence,
    )


def _daily_statements(risks: list[ConvectiveRisk]) -> list[Statement]:
    """One timing sentence per forecast day.

    A single global peak is close to useless across a multi-day outlook: a
    forecaster asking "what happens today" should not have to infer it from a
    window that also covers tomorrow. Days are split on the VALID time, and
    each day is ranked by severity for the same reason the headline is --
    the index saturates, so the daily maximum cannot order anything.
    """
    by_day: dict[str, list[ConvectiveRisk]] = {}
    for risk in risks:
        by_day.setdefault(risk.valid_time.strftime("%Y-%m-%d"), []).append(risk)

    out: list[Statement] = []
    for day in sorted(by_day):
        hours = by_day[day]
        best = max(hours, key=lambda r: r.severity)
        areas = regions_above(best.thunderstorm_risk_index, AREA_THRESHOLD)
        active = [r for r in hours if r.area_fraction > 0]

        if not active or best.area_fraction <= 0:
            out.append(Statement(
                topic="daily",
                text=(
                    f"{best.valid_time:%A %d %b}: no notable thunderstorm "
                    "risk in the guidance."
                ),
                evidence={
                    "day": day, "peak_forecast_hour": best.forecast_hour,
                    "area_fraction": round(best.area_fraction, 4),
                    "severity": round(best.severity, 2),
                },
            ))
            continue

        window = (
            f"from {active[0].valid_time:%H%MZ} to "
            f"{active[-1].valid_time:%H%MZ}"
            if len(active) > 1 else f"around {active[0].valid_time:%H%MZ}"
        )
        where = (
            f" Most widespread over {describe_areas(areas)}." if areas else ""
        )
        out.append(Statement(
            topic="daily",
            text=(
                f"{best.valid_time:%A %d %b}: risk present {window}, most "
                f"active around {best.valid_time:%H%MZ} when "
                f"{best.area_fraction * 100:.0f}% of the area is at or above "
                f"the index-{AREA_THRESHOLD:.0f} threshold.{where}"
            ),
            evidence={
                "day": day,
                "peak_forecast_hour": best.forecast_hour,
                "peak_valid_time": best.valid_time.isoformat(),
                # The band, so a reader (or the plain-English rendering) can
                # say what the day MEANS without re-deriving it from the
                # index. Without it every day read as a generic "storms are
                # most likely", whatever the level.
                "level": best.level.value,
                "peak_index": round(best.peak_index, 1),
                "area_fraction": round(best.area_fraction, 4),
                "severity": round(best.severity, 2),
                "areas": areas,
                "hours_active": [r.forecast_hour for r in active],
            },
        ))
    return out


def _hazard_statements(peak: ConvectiveRisk) -> list[Statement]:
    out: list[Statement] = []

    if peak.hail_index is not None:
        areas = regions_above(peak.hail_index, AREA_THRESHOLD)
        max_hail = float(np.nanmax(peak.hail_index))
        if areas:
            out.append(Statement(
                topic="hail",
                text=(
                    f"Hail is indicated over {describe_areas(areas)}, with a "
                    f"hail index peaking at {max_hail:.0f}."
                ),
                evidence={"hail_index_max": round(max_hail, 1),
                          "areas": areas},
            ))
        else:
            out.append(Statement(
                topic="hail",
                text=(
                    f"No significant hail signal; the hail index peaks at "
                    f"{max_hail:.0f}."
                ),
                evidence={"hail_index_max": round(max_hail, 1), "areas": []},
            ))
    else:
        out.append(Statement(
            topic="hail",
            text=(
                "Hail cannot be assessed: no hail field is available in the "
                "current model orders."
            ),
            evidence={"hail_index": None,
                      "missing": "hail_fall_rate_max_1h"},
        ))

    if peak.heavy_rain_index is not None:
        areas = regions_above(peak.heavy_rain_index, 50.0)
        max_rain = float(np.nanmax(peak.heavy_rain_index))
        text = (
            f"Heavy-rain potential is greatest over {describe_areas(areas)}, "
            f"index {max_rain:.0f}."
            if areas else
            f"Heavy-rain potential is limited, index peaking at {max_rain:.0f}."
        )
        out.append(Statement(
            topic="rainfall", text=text,
            evidence={"heavy_rain_index_max": round(max_rain, 1),
                      "areas": areas, "threshold": 50.0},
        ))
    else:
        out.append(Statement(
            topic="rainfall",
            text=(
                "Rainfall intensity cannot be assessed: no precipitation "
                "field is available in the current model orders."
            ),
            evidence={"heavy_rain_index": None,
                      "missing": "precip_rate_max_1h"},
        ))

    return out


def _lightning_statement(products: LightningProducts | None) -> Statement:
    if products is None:
        return Statement(
            topic="lightning",
            text="Lightning guidance is unavailable for this period.",
            evidence={"layers": None},
        )

    tcm = products.layers.get("tcm_predicted")
    ukv = products.layers.get("ukv_predicted")
    observed = products.layers.get("observed")

    evidence: dict[str, Any] = {
        "observed_available": bool(observed and observed.available),
    }
    parts: list[str] = []

    if tcm is not None and tcm.available and tcm.probability is not None:
        probability = float(np.nanmax(tcm.probability)) * 100
        areas = regions_above(tcm.probability, 0.3)
        evidence["tcm_probability_max_percent"] = round(probability, 1)
        evidence["tcm_members"] = tcm.n_members
        evidence["tcm_areas"] = areas
        if probability > 0:
            parts.append(
                f"{probability:.0f}% of MOGREPS-UK members "
                f"({tcm.n_members} in this cycle) produce lightning"
                + (f", over {describe_areas(areas)}" if areas else "")
            )
        else:
            parts.append("no ensemble member produces lightning")

    if ukv is not None and ukv.available and ukv.density is not None:
        areas = regions_above(ukv.density, 1e-8)
        fraction = float(np.mean(np.nan_to_num(ukv.density) > 0)) * 100
        evidence["ukv_flash_area_percent"] = round(fraction, 2)
        evidence["ukv_areas"] = areas
        if areas:
            parts.append(
                f"UKV places flashes over {describe_areas(areas)} "
                f"({fraction:.2f}% of the area)"
            )
        else:
            parts.append("UKV forecasts no flashes")

    if not parts:
        return Statement(
            topic="lightning",
            text="No lightning guidance is stored for this period.",
            evidence=evidence or {"layers": "none stored"},
        )

    text = "Lightning: " + "; ".join(parts) + "."
    if not evidence["observed_available"]:
        text += (
            " No observed-strike feed is configured, so none of this has been "
            "checked against reality."
        )
    return Statement(topic="lightning", text=text, evidence=evidence)


def _confidence_statement(
    peak: ConvectiveRisk, scale: ForecastScale
) -> Statement:
    missing = peak.missing_ingredients
    evidence = {
        "completeness": round(peak.completeness, 2),
        "missing_ingredients": missing,
        "ensemble_members": peak.ensemble_members,
        "ensemble_reliability": (
            peak.ensemble_reliability.value
            if peak.ensemble_reliability else None
        ),
        "forecast_scale": scale.value,
    }
    bits = [
        f"This outlook was built from {peak.completeness:.0%} of the "
        "ingredients the risk engine looks for"
    ]
    if missing:
        bits.append("missing " + ", ".join(missing))
    text = "; ".join(bits) + "."

    if peak.ensemble_members:
        text += (
            f" Probabilities come from {peak.ensemble_members} ensemble "
            "members, so they are coarse."
        )
    if scale is ForecastScale.ENVIRONMENT:
        text += (
            " At this range no convection-permitting model is available, so "
            "this describes how favourable the atmosphere is rather than "
            "where storms will occur."
        )
    return Statement(topic="confidence", text=text, evidence=evidence)


def select_peak(
    risks: list[ConvectiveRisk],
) -> tuple[ConvectiveRisk, list[ConvectiveRisk]]:
    """The headline lead time, and the hours it was chosen from.

    Risk indices computed from different ingredient sets are not comparable.
    A lead time holding only CAPE can out-score one holding CAPE, CIN and
    lightning simply because the gate had less to work with, and the outlook
    would then headline the hour it knows LEAST about -- observed live, where
    T+1 at 12% completeness outranked every hour that had lightning. So the
    peak is chosen only among the best-observed hours.

    This is THE definition of the outlook's peak. It lives here so callers
    cannot disagree with it: fetching lightning for a different "peak" than
    the text describes is exactly the bug this replaced.
    """
    if not risks:
        raise ValueError("no risk diagnostics to choose a peak from")
    ordered = sorted(risks, key=lambda r: r.forecast_hour)
    best = max(r.completeness for r in ordered)
    comparable = [r for r in ordered if r.completeness >= best - 1e-6]
    if len(comparable) < len(ordered):
        log.info(
            "outlook: %d of %d lead times have the best completeness (%.0f%%); "
            "peak selected among those",
            len(comparable), len(ordered), best * 100,
        )
    # Ranked by severity, NOT peak_index: the index saturates, so on an
    # unstable day every lead time reports the same maximum and "the peak"
    # becomes whichever hour happens to be first in the list.
    return max(comparable, key=lambda r: r.severity), comparable


def generate(
    risks: list[ConvectiveRisk],
    lightning: LightningProducts | None = None,
    issued_at: datetime | None = None,
) -> Outlook:
    """Render an outlook from forecast diagnostics.

    `risks` must be the per-lead-time output of the risk engine. Nothing else
    is consulted: if a fact is not in these objects, it does not appear in
    the text.
    """
    if not risks:
        raise ValueError("cannot write an outlook with no risk diagnostics")

    ordered = sorted(risks, key=lambda r: r.forecast_hour)
    peak, comparable = select_peak(ordered)
    scale = coverage_for(peak.forecast_hour).scale

    # --- headline ---------------------------------------------------------
    areas = regions_above(peak.thunderstorm_risk_index, AREA_THRESHOLD)
    level = peak.level
    if peak.peak_index < HEADLINE_THRESHOLD:
        headline_text = (
            f"{_level_phrase(level)} across the UK and Ireland through "
            f"{ordered[-1].valid_time:%d %b}."
        )
    elif areas:
        headline_text = (
            f"{_level_phrase(level)} over {describe_areas(areas)}, "
            f"peaking around {peak.valid_time:%H%MZ on %d %b}."
        )
    else:
        headline_text = (
            f"{_level_phrase(level)}, index {peak.peak_index:.0f}, "
            f"peaking around {peak.valid_time:%H%MZ on %d %b}."
        )

    headline = Statement(
        topic="headline",
        text=headline_text,
        evidence={
            "peak_index": round(peak.peak_index, 1),
            "level": level.value,
            "areas": areas,
            "peak_forecast_hour": peak.forecast_hour,
            "peak_valid_time": peak.valid_time.isoformat(),
            "index_is_calibrated": False,
        },
    )

    statements: list[Statement] = []

    timing_text, timing_evidence = _timing_phrase(comparable)
    statements.append(Statement(
        topic="timing", text=timing_text, evidence=timing_evidence
    ))
    statements.extend(_daily_statements(comparable))

    statements.append(Statement(
        topic="regime",
        text=(
            f"The convective regime is {peak.regime.regime.value}: "
            f"{peak.regime.regime.description}."
        ),
        evidence={
            "regime": peak.regime.regime.value,
            "fractions": peak.regime.fractions,
            "ingredients_used": list(peak.regime.ingredients),
        },
    ))

    statements.append(_lightning_statement(lightning))
    statements.extend(_hazard_statements(peak))
    statements.append(_confidence_statement(peak, scale))

    summary = {
        "peak_index": round(peak.peak_index, 1),
        "level": level.value,
        "regime": peak.regime.regime.value,
        "areas": areas,
        "peak_forecast_hour": peak.forecast_hour,
        "completeness": round(peak.completeness, 2),
        "missing_ingredients": peak.missing_ingredients,
        "forecast_scale": scale.value,
        "index_is_calibrated": False,
        "lead_times_considered": [r.forecast_hour for r in comparable],
        "lead_times_excluded_for_lower_completeness": [
            r.forecast_hour for r in ordered if r not in comparable
        ],
    }

    return Outlook(
        issued_at=issued_at or datetime.now(ordered[0].valid_time.tzinfo),
        valid_from=ordered[0].valid_time,
        valid_to=ordered[-1].valid_time,
        headline=headline,
        statements=statements,
        summary=summary,
    )
