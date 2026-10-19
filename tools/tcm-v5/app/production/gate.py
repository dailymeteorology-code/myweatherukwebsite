"""The publication gate: nothing malformed reaches a user.

Step 12 of the Stage 10 order, sections 51 to 54 and 59 to 64.

Section 53 states the consequence of failing:

    do not publish corrupted output, preserve the failed run, record the
    error, alert, and retain the previous valid forecast if the product
    architecture requires continuity

and section 54 adds the constraint that makes that fallback safe: a
previous forecast served for continuity must carry its ORIGINAL cycle
timestamp and never appear to be the latest cycle.

DIAGNOSTIC TRIGGERS, NOT CORRECTIONS
------------------------------------
Section 59 is careful about this and it is easy to get wrong. A check that
finds thunderstorm probability at 100% across the whole UK has found a
symptom, not a value to fix. Nothing in this module modifies a forecast --
`validate` returns a verdict and the orchestrator refuses to publish. A gate
that quietly clipped bad values would hide the bug that produced them, and
section 61 says so directly: do not blindly clip invalid values, trace the
underlying problem.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone

import numpy as np

from . import access as AX

log = logging.getLogger(__name__)

GATE_VERSION = "stage10.1"

#: A probability field this uniform across the whole domain is a symptom.
#: Not a correction threshold: it triggers investigation, and the forecast
#: is refused rather than adjusted.
UNIFORM_SUSPICION = 0.99

#: Fraction of points that must share a value before the field is called
#: suspiciously uniform.
UNIFORM_FRACTION = 0.95


@dataclass(slots=True)
class Check:
    """One gate check."""

    name: str
    passed: bool
    detail: str
    #: A failed BLOCKING check stops publication. A failed advisory one is
    #: recorded and published with the warning attached.
    blocking: bool = True

    def to_dict(self) -> dict:
        return {
            "check": self.name, "passed": self.passed,
            "blocking": self.blocking, "detail": self.detail,
        }


def validate(manifest, context: dict) -> dict:
    """Run every pre-publication check. Sections 51 and 59 to 64."""
    forecasts = context.get("forecasts") or []
    checks: list[Check] = []

    checks.append(_check_forecasts_exist(forecasts))
    checks.extend(_check_probabilities(forecasts))
    checks.extend(_check_hazard_nesting(forecasts))
    checks.append(_check_confidence(forecasts, manifest))
    checks.extend(_check_temporal(forecasts, manifest))
    checks.append(_check_uniformity(forecasts))
    checks.append(_check_hazards_differ(forecasts))
    checks.append(_check_weights(manifest))
    checks.append(_check_ensemble(manifest))
    checks.append(_check_versions(manifest))
    checks.append(_check_products(context, manifest))
    checks.append(_check_degraded_recorded(manifest))

    failures = [c for c in checks if c.blocking and not c.passed]
    warnings = [c.detail for c in checks if not c.blocking and not c.passed]

    passed = not failures
    verdict = (
        "every pre-publication check passed"
        if passed else
        f"REFUSED: {len(failures)} blocking check(s) failed"
    )
    if passed and warnings:
        verdict += f", with {len(warnings)} advisory warning(s)"

    if not passed:
        log.error(
            "publication gate refused %s: %s",
            manifest.forecast_id, "; ".join(c.name for c in failures),
        )

    return {
        "passed": passed,
        "verdict": verdict,
        "checks": [c.to_dict() for c in checks],
        "failures": [c.detail for c in failures],
        "warnings": warnings,
        "version": GATE_VERSION,
        "note": (
            "this gate REFUSES a forecast; it never repairs one. Section "
            "61: do not blindly clip invalid values, trace the underlying "
            "problem"
        ),
    }


# --------------------------------------------------------------------------
# The checks
# --------------------------------------------------------------------------

def _check_forecasts_exist(forecasts: list) -> Check:
    return Check(
        name="forecast_exists", passed=bool(forecasts),
        detail=(
            f"{len(forecasts)} point forecast(s)" if forecasts else
            "no forecast was produced, so there is nothing to publish"
        ),
    )


def _check_probabilities(forecasts: list) -> list[Check]:
    """Section 61. In range, no NaN, and traced rather than clipped."""
    out_of_range: list[str] = []
    not_finite: list[str] = []

    for forecast in forecasts:
        for label, value in AX.all_probabilities(forecast):
            if value is None:
                continue
            if not np.isfinite(value):
                not_finite.append(label)
            elif not (0.0 <= value <= 1.0):
                out_of_range.append(f"{label}={value}")

    return [
        Check(
            name="probabilities_in_range", passed=not out_of_range,
            detail=(
                "every probability lies in [0, 1]" if not out_of_range else
                f"{len(out_of_range)} probability/ies outside [0, 1]: "
                f"{out_of_range[:5]}. NOT clipped -- the cause must be found"
            ),
        ),
        Check(
            name="probabilities_finite", passed=not not_finite,
            detail=(
                "no NaN or infinite probability" if not not_finite else
                f"{len(not_finite)} non-finite probability/ies: "
                f"{not_finite[:5]}"
            ),
        ),
    ]


def _check_hazard_nesting(forecasts: list) -> list[Check]:
    """Section 61. A hazard cannot exceed the storm it is conditional on."""
    violations: list[str] = []
    for forecast in forecasts:
        storm = AX.probability(forecast)
        if storm is None:
            continue
        for name, hazard in (getattr(forecast, "hazards", {}) or {}).items():
            value = getattr(hazard, "probability", None)
            if value is not None and value > storm + 1e-9:
                violations.append(
                    f"{name}={value:.5f} exceeds thunderstorm={storm:.5f}"
                )
    return [Check(
        name="hazard_nesting", passed=not violations,
        detail=(
            "every hazard probability is at or below its thunderstorm "
            "probability, as the conditional structure requires"
            if not violations else
            f"{len(violations)} nesting violation(s): {violations[:3]}. "
            f"P(hazard) = P(storm) x P(hazard|storm) makes this "
            f"arithmetically impossible, so an input is wrong"
        ),
    )]


def _check_confidence(forecasts: list, manifest) -> Check:
    """Section 59: confidence at 100% despite missing models is a symptom."""
    if not manifest.degraded:
        return Check(
            name="confidence_reflects_degradation", passed=True,
            detail="the cycle is not degraded, so no constraint applies",
        )
    overconfident = [
        f for f in forecasts
        if (AX.confidence(f) or 0) > 0.85
    ]
    return Check(
        name="confidence_reflects_degradation", passed=not overconfident,
        detail=(
            "confidence is bounded appropriately for a degraded cycle"
            if not overconfident else
            f"{len(overconfident)} forecast(s) claim confidence above 0.85 "
            f"despite the cycle running degraded on "
            f"{len(manifest.degraded_because)} count(s)"
        ),
    )


def _check_temporal(forecasts: list, manifest) -> list[Check]:
    """Section 64. Do not publish T+6 as T+5."""
    mismatched: list[str] = []
    duplicates: list[str] = []
    seen: set[tuple] = set()

    for forecast in forecasts:
        run, valid = forecast.run, forecast.valid_time
        hour = forecast.forecast_hour
        if run and valid and hour is not None:
            expected = run + timedelta(hours=int(hour))
            if abs((valid - expected).total_seconds()) > 60:
                mismatched.append(
                    f"T+{hour} from {run:%HZ} should be valid "
                    f"{expected:%Y-%m-%d %HZ}, not {valid:%Y-%m-%d %HZ}"
                )
        key = (forecast.latitude, forecast.longitude, hour)
        if key in seen:
            duplicates.append(str(key))
        seen.add(key)

    checks = [Check(
        name="lead_time_matches_valid_time", passed=not mismatched,
        detail=(
            "every forecast's valid time equals its run plus its lead time"
            if not mismatched else
            f"{len(mismatched)} temporal mismatch(es): {mismatched[:3]}"
        ),
    )]
    checks.append(Check(
        name="no_duplicate_times", passed=not duplicates,
        detail=(
            "no location and lead time appears twice"
            if not duplicates else
            f"{len(duplicates)} duplicate location/lead pair(s)"
        ),
    ))

    if forecasts:
        cycles = {f.run for f in forecasts}
        checks.append(Check(
            name="single_cycle", passed=len(cycles) <= 1,
            detail=(
                f"every forecast belongs to cycle {manifest.cycle:%Y-%m-%d %HZ}"
                if len(cycles) <= 1 else
                f"forecasts from {len(cycles)} different cycles are mixed "
                f"in one publication"
            ),
        ))
    return checks


def _check_uniformity(forecasts: list) -> Check:
    """Section 59. 100% across the whole UK is a data failure, not weather."""
    values = [
        p for p in (AX.probability(f) for f in forecasts) if p is not None
    ]
    if len(values) < 5:
        return Check(
            name="not_suspiciously_uniform", passed=True,
            detail="too few points to judge uniformity",
        )
    array = np.array(values)
    high = float((array >= UNIFORM_SUSPICION).mean())
    identical = float(
        (np.abs(array - array[0]) < 1e-9).mean()
    )
    suspicious = high >= UNIFORM_FRACTION or (
        identical >= UNIFORM_FRACTION and array[0] > 0
    )
    return Check(
        name="not_suspiciously_uniform", passed=not suspicious,
        detail=(
            f"the probability field varies across the domain "
            f"({array.min():.4f} to {array.max():.4f})"
            if not suspicious else
            f"{high:.0%} of points are at or above {UNIFORM_SUSPICION} or "
            f"{identical:.0%} are identical. This is the signature of a "
            f"data or code failure, not of weather, and the forecast is "
            f"refused rather than adjusted"
        ),
    )


def _check_hazards_differ(forecasts: list) -> Check:
    """Section 59. Every hazard identical to the storm probability means
    the conditional structure has collapsed."""
    collapsed = 0
    checked = 0
    for forecast in forecasts:
        storm = AX.probability(forecast)
        values = [
            h["probability"] for h in AX.hazards(forecast).values()
            if h["probability"] is not None
        ]
        if storm is None or len(values) < 3 or storm <= 0:
            continue
        checked += 1
        if all(abs(v - storm) < 1e-9 for v in values):
            collapsed += 1
    return Check(
        name="hazards_are_conditional", passed=collapsed == 0,
        detail=(
            f"hazards differ from the storm probability across "
            f"{checked} forecast(s)"
            if collapsed == 0 else
            f"{collapsed} forecast(s) have every hazard exactly equal to "
            f"the thunderstorm probability, which means the conditional "
            f"P(hazard|storm) collapsed to 1"
        ),
    )


def _check_weights(manifest) -> Check:
    """Section 60. Ineligible models must carry no operational weight."""
    problems: list[str] = []
    total = 0.0
    for model, entry in manifest.models.items():
        if entry.weight is None:
            continue
        total += entry.weight
        if not entry.state.usable and entry.weight > 0:
            problems.append(
                f"{model} is {entry.state.value} and carries weight "
                f"{entry.weight}"
            )
    if total > 0 and abs(total - 1.0) > 0.01:
        problems.append(f"weights sum to {total:.4f}, not 1")
    return Check(
        name="model_weights_sane", passed=not problems,
        detail=(
            "no unusable model carries weight and the weights normalise"
            if not problems else "; ".join(problems)
        ),
    )


def _check_ensemble(manifest) -> Check:
    """Section 62. Missing members are not zero-probability members."""
    incomplete = [
        f"{m}: {len(e.members)}/{e.expected_members}"
        for m, e in manifest.models.items()
        if e.expected_members and not e.ensemble_complete and e.state.usable
    ]
    return Check(
        name="ensemble_membership_recorded", passed=True, blocking=False,
        detail=(
            "every ensemble is complete" if not incomplete else
            f"incomplete ensembles: {incomplete}. The missing members are "
            f"absent, NOT counted as forecasting no storms"
        ) if incomplete else "every ensemble is complete or none is expected",
    )


def _check_versions(manifest) -> Check:
    """Section 65. No ambiguous software state."""
    versions = manifest.versions.to_dict()
    missing = [
        k for k, v in versions.items()
        if k not in ("configuration", "code") and not v
    ]
    unknown = [k for k, v in versions.items() if v == "unknown"]
    problems = []
    if missing:
        problems.append(f"missing version(s): {missing}")
    if unknown:
        problems.append(f"unreadable version(s): {unknown}")
    return Check(
        name="versions_complete", passed=not problems,
        detail=(
            "every component version is recorded"
            if not problems else "; ".join(problems)
        ),
    )


def _check_products(context: dict, manifest) -> Check:
    """Section 51. The required layers must exist and agree."""
    products = manifest.products or {}
    if not products:
        return Check(
            name="products_present", passed=False,
            detail="no products were generated",
        )
    consistency = products.get("consistency") or {}
    layers = products.get("layers") or {}
    missing_required = [
        layer for layer in products.get("layers", {}).get("required", [])
        if layer in (layers.get("missing") or [])
    ]
    problems = []
    if missing_required:
        problems.append(f"required layer(s) missing: {missing_required}")
    if consistency and not consistency.get("consistent", True):
        problems.append(
            f"layer inconsistency: {consistency.get('problems')}"
        )
    return Check(
        name="products_present", passed=not problems,
        detail=(
            f"{len(products)} product group(s), layers consistent"
            if not problems else "; ".join(problems)
        ),
    )


def _check_degraded_recorded(manifest) -> Check:
    """Section 8. A degraded cycle must say so in its own record."""
    if not manifest.degraded:
        return Check(
            name="degraded_state_recorded", passed=True,
            detail="the cycle is not degraded",
        )
    return Check(
        name="degraded_state_recorded",
        passed=bool(manifest.degraded_because),
        detail=(
            f"degraded for {len(manifest.degraded_because)} recorded "
            f"reason(s)"
            if manifest.degraded_because else
            "the cycle is marked degraded with no reason recorded"
        ),
    )


# --------------------------------------------------------------------------
# Section 54 -- the continuity fallback
# --------------------------------------------------------------------------

def previous_valid_forecast() -> dict | None:
    """The last published forecast, labelled as what it is.

    Section 54: never make an older forecast appear to be the latest cycle.
    The returned record carries its ORIGINAL cycle timestamp, an explicit
    `is_current: False`, and its age -- so a consumer that displays it
    cannot accidentally present it as fresh.
    """
    from . import manifest as MF

    record = MF.latest_published()
    if record is None:
        return None

    try:
        cycle = datetime.fromisoformat(record["cycle"])
    except (KeyError, ValueError):
        return None
    age = datetime.now(timezone.utc) - cycle

    return {
        "is_current": False,
        "label": "previous valid forecast",
        "forecast_id": record.get("forecast_id"),
        "cycle": record.get("cycle"),
        "age_hours": round(age.total_seconds() / 3600, 1),
        "status": record.get("status"),
        "products": record.get("products", {}),
        "warning": (
            f"this is the {cycle:%Y-%m-%d %HZ} forecast, "
            f"{age.total_seconds() / 3600:.0f} hours old. The current cycle "
            f"did not pass the publication gate. It is served for "
            f"continuity and is NOT the latest forecast"
        ),
    }
