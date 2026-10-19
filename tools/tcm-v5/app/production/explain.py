"""Turning the forecast into meteorological English.

Sections 34 to 38, 79 and 80 of the Stage 10 order.

Two rules pull in opposite directions and both must hold:

    section 36   do not expose implementation jargon
    section 36   do not oversimplify the science into false certainty

The resolution is that every sentence is generated from a recorded
diagnostic, and the phrase used depends on the VALUE of that diagnostic
rather than on a template chosen by hand. A statement that instability is
increasing exists because a CAPE difference was computed and exceeded a
stated floor; nothing here can say it otherwise.

TRACEABILITY IS THE POINT
-------------------------
Section 38: a developer must be able to determine why a statement was
generated. Every `Statement` carries the features it was built from, their
values, and the rule that fired. `explain()` returns those alongside the
prose, so the sentence and its evidence cannot drift apart.

WHAT THIS REFUSES TO DO
-----------------------
Section 34 ends with "do not invent causes". A driver is only named when its
diagnostic is present AND its value supports the claim. Where the forecast
is driven by something not measured -- which on this platform includes most
forcing at most points -- the explanation says the driver is unknown rather
than reaching for a plausible one.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field

from . import access as AX

log = logging.getLogger(__name__)

EXPLAIN_VERSION = "stage10.1"

#: Probability bands used only for WORDING. The scientific probability
#: stays continuous; section 43 keeps presentation separate from science,
#: and this is the presentation side of that line.
BANDS: tuple[tuple[float, str], ...] = (
    (0.60, "high"),
    (0.35, "significant"),
    (0.15, "moderate"),
    (0.05, "low but non-zero"),
    (0.00, "very low"),
)


def band(probability: float) -> str:
    for threshold, label in BANDS:
        if probability >= threshold:
            return label
    return "very low"


@dataclass(slots=True)
class Statement:
    """One sentence, and the evidence that produced it. Section 38."""

    topic: str
    text: str
    #: Diagnostic names and values the sentence rests on.
    evidence: dict = dc_field(default_factory=dict)
    #: Which rule fired, so the code path can be found.
    rule: str = ""
    confidence_note: str = ""

    def to_dict(self) -> dict:
        return {
            "topic": self.topic,
            "text": self.text,
            "evidence": self.evidence,
            "rule": self.rule,
            "version": EXPLAIN_VERSION,
        }


#: Drivers the explanation may name, with the feature that evidences each
#: and the wording. A driver absent from this table cannot be mentioned.
DRIVERS: tuple[tuple[str, str, str, str], ...] = (
    # (feature, direction, threshold-description, wording)
    ("thermodynamic", "high", "instability", "substantial instability"),
    ("updraft", "high", "updraught strength", "strong updraught potential"),
    ("convective_initiation", "high", "forcing",
     "focused low-level convergence"),
    ("organisation", "high", "shear and organisation",
     "sufficient shear for organised storms"),
    ("entrainment", "low", "mid-level dryness",
     "a moist profile that limits entrainment"),
)

SUPPRESSORS: tuple[tuple[str, str, str], ...] = (
    ("convective_initiation", "low",
     "no clear trigger to lift parcels to their level of free convection"),
    ("thermodynamic", "low", "limited instability"),
    ("entrainment", "high",
     "dry mid-levels that would erode a developing updraught"),
)

#: Above and below these an engine score is worth mentioning. Chosen so a
#: middling score is not described as either a driver or a suppressor:
#: 0.6 and 0.3 leave a deliberate band where the honest answer is that the
#: ingredient is neither helping nor hindering much.
DRIVER_FLOOR = 0.6
SUPPRESSOR_CEILING = 0.3


def describe_point(forecast, *, place: str = "") -> list[Statement]:
    """Explain one point forecast. Sections 35 and 37."""
    statements: list[Statement] = []
    probability = AX.probability(forecast)
    where = f" at {place}" if place else ""

    if probability is None:
        return [Statement(
            topic="headline",
            text=(
                f"No thunderstorm forecast could be produced{where}: "
                f"{forecast.reason or 'the required data were not available'}. "
                f"This is an inability to forecast, not a forecast of no "
                f"thunderstorms."
            ),
            rule="unavailable",
            evidence={"probability": None},
        )]

    statements.append(Statement(
        topic="headline",
        text=(
            f"Thunderstorm potential{where} is {band(probability)} "
            f"({probability:.0%})."
        ),
        rule="probability_band",
        evidence={"probability": round(probability, 4)},
    ))

    # Stage 7 already writes its own explanation and its own limiting
    # factors. Section 2 says not to rewrite what earlier stages produce, so
    # they are used verbatim where they exist, and the rules below only fill
    # in where they do not.
    for line in AX.explanation(forecast):
        statements.append(Statement(
            topic="drivers", text=line, rule="stage7_explanation",
            evidence={"source": "Stage 7"},
        ))
    for line in AX.limiting(forecast):
        statements.append(Statement(
            topic="limiting", text=line, rule="stage7_limiting",
            evidence={"source": "Stage 7"},
        ))

    scores = AX.engine_scores(forecast)

    drivers = [
        (feature, wording, scores[feature])
        for feature, direction, _label, wording in DRIVERS
        if feature in scores and (
            scores[feature] >= DRIVER_FLOOR if direction == "high"
            else scores[feature] <= SUPPRESSOR_CEILING
        )
    ]
    if drivers and not AX.explanation(forecast):
        names = _join([wording for _f, wording, _v in drivers])
        statements.append(Statement(
            topic="drivers",
            text=f"The main supporting factors are {names}.",
            rule="engine_scores_above_floor",
            evidence={f: round(v, 3) for f, _w, v in drivers},
        ))

    suppressors = [
        (feature, wording, scores[feature])
        for feature, direction, wording in SUPPRESSORS
        if feature in scores and (
            scores[feature] <= SUPPRESSOR_CEILING if direction == "low"
            else scores[feature] >= DRIVER_FLOOR
        )
    ]
    if suppressors and not AX.limiting(forecast):
        names = _join([wording for _f, wording, _v in suppressors])
        statements.append(Statement(
            topic="limiting",
            text=f"Development is limited by {names}.",
            rule="engine_scores_below_ceiling",
            evidence={f: round(v, 3) for f, _w, v in suppressors},
        ))

    if not drivers and not suppressors and not AX.explanation(forecast):
        statements.append(Statement(
            topic="drivers",
            text=(
                "No single ingredient dominates this forecast: the "
                "available diagnostics are all middling, which is itself "
                "the reason confidence is limited."
            ),
            rule="no_dominant_ingredient",
            evidence={k: round(v, 3) for k, v in sorted(scores.items())},
        ))

    statements.extend(_confidence_statements(forecast))
    statements.extend(_hazard_statements(forecast))
    return statements


def _confidence_statements(forecast) -> list[Statement]:
    out: list[Statement] = []
    value = AX.confidence(forecast)
    if value is None:
        return out
    confidence = forecast.confidence

    if value >= 0.6:
        wording = "Confidence in this assessment is reasonable"
    elif value >= 0.35:
        wording = "Confidence is moderate"
    else:
        wording = "Confidence is low"

    reasons = list(getattr(confidence, "limitations", ()) or ())
    text = wording + "."
    if reasons:
        text = f"{wording}, mainly because {reasons[0].rstrip('.')}."

    out.append(Statement(
        topic="confidence", text=text, rule="confidence_band",
        evidence={
            "confidence": round(value, 3),
            "uncertainty": AX.uncertainty(forecast),
        },
    ))

    if not AX.publishable(forecast):
        out.append(Statement(
            topic="caveat",
            text=(
                "These probabilities have not been calibrated against "
                "observations, so they describe the structure of the "
                "forecast rather than a verified likelihood."
            ),
            rule="uncalibrated",
            evidence={
                "calibration": AX.calibration(forecast),
                # Section 27: the raw value is preserved beside the
                # calibrated one, so the caveat can point at what it is
                # caveating.
                "raw_probability": AX.raw_probability(forecast),
            },
        ))
    return out


def _hazard_statements(forecast) -> list[Statement]:
    notable = []
    for name, values in sorted(AX.hazards(forecast).items()):
        conditional = values["conditional"]
        probability = values["probability"]
        if conditional is None or probability is None:
            continue
        if conditional >= 0.5:
            notable.append((name, conditional, probability))

    if not notable:
        return []

    words = _join([
        f"{name.replace('_', ' ')} ({conditional:.0%} if a storm forms)"
        for name, conditional, _p in notable[:3]
    ])
    return [Statement(
        topic="hazards",
        text=(
            f"Any storms that do form would be capable of {words}."
        ),
        rule="conditional_hazard_above_half",
        evidence={
            name: {"conditional": round(c, 3), "unconditional": round(p, 4)}
            for name, c, p in notable
        },
    )]


def describe_change(comparison: dict) -> list[Statement]:
    """Explain what moved since the last cycle. Section 34."""
    if not comparison.get("available"):
        return [Statement(
            topic="change",
            text=(
                "This is the first archived forecast, so there is nothing "
                "to compare it against."
            ),
            rule="no_reference",
            evidence={"reason": comparison.get("reason", "")},
        )]

    if not comparison.get("comparable", True):
        return [Statement(
            topic="change",
            text=(
                "The previous forecast was produced by a different software "
                "version, so the difference between them is not a "
                "meteorological change and is not described here."
            ),
            rule="incomparable_versions",
            evidence={"why": comparison.get("incomparable_because", "")},
        )]

    spatial = comparison.get("spatial") or {}
    if not spatial.get("available"):
        return [Statement(
            topic="change",
            text=(
                "The previous cycle stored no comparable field, so only "
                "model weighting could be compared."
            ),
            rule="no_previous_field",
            evidence={"reason": spatial.get("reason", "")},
        )]

    changed = spatial.get("locations_changed", 0)
    total = spatial.get("locations_compared", 0)
    if changed == 0:
        return [Statement(
            topic="change",
            text=(
                f"The forecast is essentially unchanged from the previous "
                f"cycle: none of the {total} locations moved by more than "
                f"the noise floor."
            ),
            rule="no_significant_change",
            evidence=spatial,
        )]

    increased = spatial.get("increased_at") or []
    decreased = spatial.get("decreased_at") or []
    parts = []
    if increased:
        parts.append(f"increased around {_join(increased[:3])}")
    if decreased:
        parts.append(f"decreased around {_join(decreased[:3])}")

    return [Statement(
        topic="change",
        text=(
            f"Compared with the previous cycle, thunderstorm probability "
            f"has {' and '.join(parts)}, with {changed} of {total} "
            f"locations changing materially."
        ),
        rule="spatial_change",
        evidence=spatial,
    )]


def summary(
    forecasts: list, *, comparison: dict | None = None,
    manifest=None,
) -> dict:
    """Section 79. A concise summary of the whole cycle.

    Built from the actual final fields. Where the forecast is quiet it says
    so plainly rather than reaching for something to report.
    """
    scored = [(f, AX.probability(f)) for f in forecasts]
    usable = [(f, p) for f, p in scored if p is not None]
    if not usable:
        return {
            "available": False,
            "text": (
                "No forecast could be produced for this cycle. This is an "
                "inability to forecast, not a forecast of no thunderstorms."
            ),
            "statements": [],
        }

    peak_forecast, peak = max(usable, key=lambda pair: pair[1])
    statements: list[Statement] = []

    place = _nearest_point(peak_forecast)
    when = peak_forecast.valid_time
    when_text = f" around {when:%H}Z on {when:%d %b}" if when else ""

    if peak < 0.05:
        statements.append(Statement(
            topic="headline",
            text=(
                f"No significant thunderstorm risk is indicated across the "
                f"UK and Ireland in this cycle; the highest probability "
                f"anywhere is {peak:.0%}{when_text}."
            ),
            rule="quiet_cycle",
            evidence={"peak_probability": round(peak, 4)},
        ))
    else:
        statements.append(Statement(
            topic="headline",
            text=(
                f"Thunderstorm potential is {band(peak)}, highest near "
                f"{place}{when_text} at {peak:.0%}."
            ),
            rule="peak_probability",
            evidence={
                "peak_probability": round(peak, 4),
                "location": place,
                "valid_time": when.isoformat() if when else None,
            },
        ))
        statements.extend(
            s for s in describe_point(peak_forecast)
            if s.topic in ("drivers", "limiting", "hazards")
        )

    statements.extend(_confidence_statements(peak_forecast))
    if comparison is not None:
        statements.extend(describe_change(comparison))

    if manifest is not None and getattr(manifest, "degraded", False):
        statements.append(Statement(
            topic="operational",
            text=(
                "This forecast ran with less than the full set of models, "
                "which lowers confidence in it. It does not make storms "
                "less likely."
            ),
            rule="degraded_cycle",
            evidence={"degraded_because": list(manifest.degraded_because)},
        ))

    return {
        "available": True,
        "text": " ".join(s.text for s in statements),
        "statements": [s.to_dict() for s in statements],
        "version": EXPLAIN_VERSION,
        "note": (
            "every sentence is generated from a recorded diagnostic and "
            "carries the values it rests on. Nothing here names a cause "
            "that was not measured"
        ),
    }


def _nearest_point(forecast) -> str:
    """The named point this forecast belongs to."""
    from .points import POINTS

    lat, lon = forecast.latitude, forecast.longitude
    if lat is None or lon is None:
        return "the forecast area"
    best = min(
        POINTS,
        key=lambda p: (p.lat - lat) ** 2 + (p.lon - lon) ** 2,
    )
    return best.name


def _join(items: list[str]) -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]
