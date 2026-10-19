"""A plain-English rendering of the outlook.

The detailed outlook is written for someone who knows what most-unstable CAPE,
a percentile and a 0-100 ranking index are. Most readers do not, and a
forecast somebody cannot read is not a forecast. This module restates the SAME
outlook in everyday words.

Two rules govern it, and they are the whole design:

  * **It adds nothing.** Every sentence is derived from the evidence already
    attached to the detailed outlook's statements. There is no second pass
    over the model data and no new number, so the simple version can never
    disagree with the detailed one, and the spec's rule that the text
    generator must not invent weather data holds for it automatically.
  * **It drops precision rather than rounding it.** "Index 68 over 10.4% of
    the area" becomes "thunderstorms are likely in places". Omitting a figure
    is honest; restating it as a probability the ensemble cannot support is
    not, so the simple text never quotes odds.

Jargon is removed rather than explained: no index values, no percentiles, no
ingredient names, no model names.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

#: What each band means to somebody deciding whether to take a coat.
#: Deliberately about LIKELIHOOD and COVERAGE, never about a number.
LEVEL_WORDS: dict[str, str] = {
    "none": "No thunderstorms are expected",
    "very_low": "Thunderstorms are very unlikely",
    "low": "An isolated thunderstorm is possible, but unlikely",
    "marginal": "An isolated thunderstorm is possible",
    "slight": "A few thunderstorms are possible",
    "moderate": "Thunderstorms are likely in places",
    "high": "Thunderstorms are likely and could be widespread",
    "severe": "A significant thunderstorm outbreak is expected",
}

#: Plain advice, per band. Only from "slight" upward: telling somebody to take
#: care on a day when nothing will happen teaches them to ignore the warning.
LEVEL_ADVICE: dict[str, str] = {
    "slight": "Most places will stay dry, but where a storm does form it "
              "could bring a sudden downpour.",
    "moderate": "If a storm reaches you, expect heavy rain, frequent "
                "lightning and possibly some surface water flooding.",
    "high": "Storms could bring travel disruption and localised flooding. "
            "Worth checking again through the day.",
    "severe": "Storms could be disruptive: torrential downpours, flooding "
              "and frequent lightning are all possible.",
}


def _time_of_day(hour: int) -> str:
    if 5 <= hour < 12:
        return "in the morning"
    if 12 <= hour < 18:
        return "in the afternoon"
    if 18 <= hour < 22:
        return "in the evening"
    return "overnight"


def _day_word(when: datetime, now: datetime) -> str:
    days = (when.date() - now.date()).days
    if days <= 0:
        return "today"
    if days == 1:
        return "tomorrow"
    return f"on {when:%A}"


def _upper_first(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


def _areas(names: list[str], limit: int = 3) -> str:
    shown = list(names[:limit])
    if not shown:
        return ""
    if len(shown) == 1:
        return shown[0]
    if len(shown) == 2:
        return f"{shown[0]} and {shown[1]}"
    return ", ".join(shown[:-1]) + f" and {shown[-1]}"


def _evidence(outlook, topic: str) -> dict[str, Any]:
    """Evidence for one topic of the detailed outlook, or an empty dict."""
    for statement in [outlook.headline, *outlook.statements]:
        if statement.topic == topic:
            return statement.evidence or {}
    return {}


def _every(outlook, topic: str) -> list[dict[str, Any]]:
    return [s.evidence or {} for s in outlook.statements if s.topic == topic]


def simplify(outlook, now: datetime | None = None) -> dict:
    """Restate a detailed outlook in everyday language."""
    now = now or datetime.now(timezone.utc)
    head = _evidence(outlook, "headline")
    level = str(head.get("level", "none"))
    areas = [str(a) for a in (head.get("areas") or [])]
    quiet = level in ("none", "very_low")

    lines: list[str] = []

    # --- what, when, where ------------------------------------------------
    sentence = LEVEL_WORDS.get(level, LEVEL_WORDS["none"])
    stamp = head.get("peak_valid_time")
    if stamp and not quiet:
        when = datetime.fromisoformat(str(stamp))
        sentence += f" {_day_word(when, now)}, most likely {_time_of_day(when.hour)}"
    if areas and not quiet:
        sentence += f", mainly across {_areas(areas)}"
    lines.append(sentence + ".")

    if not quiet and (advice := LEVEL_ADVICE.get(level)):
        lines.append(advice)

    # --- day by day -------------------------------------------------------
    for day in _every(outlook, "daily"):
        stamp = day.get("peak_valid_time")
        if not stamp:
            continue
        when = datetime.fromisoformat(str(stamp))
        words = LEVEL_WORDS.get(str(day.get("level")))
        if words is None:
            # No band on the daily statement, so say only what IS known.
            words = "Storms are most likely"
        where = _areas([str(a) for a in (day.get("areas") or [])], 2)
        line = (
            # NOT str.capitalize(): it lowercases the rest of the string,
            # which turned "on Monday" into "on monday".
            f"{_upper_first(_day_word(when, now))}: "
            f"{words[0].lower()}{words[1:]}"
            f", mainly {_time_of_day(when.hour)}"
        )
        lines.append(line + (f", across {where}." if where else "."))

    # --- hazards, only where the detailed outlook actually found one -------
    hazards: list[str] = []
    rain = _evidence(outlook, "rainfall")
    if rain.get("areas"):
        hazards.append(
            "heavy rain is most likely over "
            + _areas([str(a) for a in rain["areas"]], 2)
        )
    hail = _evidence(outlook, "hail")
    if hail.get("areas"):
        hazards.append(
            "hail is possible over " + _areas([str(a) for a in hail["areas"]], 2)
        )
    if hazards:
        joined = "; ".join(hazards)
        lines.append(_upper_first(joined) + ".")

    # --- how sure we are --------------------------------------------------
    # In words. The underlying figures are a completeness fraction and a
    # member count, neither of which means anything to a general reader.
    confidence = _evidence(outlook, "confidence")
    completeness = float(confidence.get("completeness") or 0.0)
    members = int(confidence.get("ensemble_members") or 0)
    if quiet:
        certainty = "There is little to place on the map today."
    elif completeness >= 0.85 and members >= 3:
        certainty = (
            "The general picture is reasonably clear, but exactly where "
            "individual storms form cannot be pinned down in advance."
        )
    elif completeness >= 0.6:
        certainty = (
            "Treat the detail with caution: some of the information this "
            "forecast normally uses is missing, and storm locations are "
            "always uncertain."
        )
    else:
        certainty = (
            "Confidence is low. Much of the information this forecast "
            "normally uses is unavailable, so treat it as a rough guide."
        )
    lines.append(certainty)

    return {
        "text": "\n\n".join(lines),
        "level": level,
        "level_words": LEVEL_WORDS.get(level, ""),
        "areas": areas[:3],
        "derived_from": "the detailed outlook's own evidence; no new data",
        "note": (
            "A plain-language restatement of the detailed outlook. It carries "
            "no information the detailed version does not, and omits figures "
            "rather than rounding them into false certainty."
        ),
    }
