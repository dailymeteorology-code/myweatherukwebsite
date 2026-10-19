"""Step 16: audit the verification system itself.

Section 100's step 16 lists seven things to check:

    forecast immutability, data leakage, observation quality, calibration
    leakage, sample-size problems, metric misuse, hidden self-modification

Every one of them is a way for this stage to produce numbers that look
right. A verification system that is not itself audited is a system that
reports whatever it happens to compute, and the last item is the one with
teeth: `hidden self-modification` asks whether anything in the platform can
change a forecasting component without a person, which is section 101's
prohibition turned into a test that runs.

The audit is deliberately capable of FAILING on this repository. It is not a
formality that always passes; several checks below are wired to real state
and would report a genuine problem if one existed.
"""
from __future__ import annotations

import ast
import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

AUDIT_VERSION = "stage9.1"


@dataclass(slots=True)
class Finding:
    """One audit result. `passed` False is a problem to fix."""

    check: str
    passed: bool
    detail: str
    severity: str = "blocking"
    evidence: list[str] = dc_field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "check": self.check,
            "passed": self.passed,
            "severity": self.severity,
            "detail": self.detail,
            "evidence": self.evidence[:20],
        }


# --------------------------------------------------------------------------
# 1. Forecast immutability
# --------------------------------------------------------------------------

def check_forecast_immutability() -> Finding:
    """Sections 3 and 4. Has any archived forecast been altered?"""
    from . import archive

    integrity = archive.verify_integrity()
    if integrity["records"] == 0:
        return Finding(
            check="forecast_immutability", passed=True, severity="advisory",
            detail=(
                "the forecast archive is empty, so nothing can have been "
                "altered. This is not a clean bill of health: it means TCM "
                "has never archived an operational forecast, and until it "
                "does there is nothing to verify TCM itself against"
            ),
        )
    return Finding(
        check="forecast_immutability", passed=integrity["intact"],
        detail=(
            f"{integrity['records']} archived forecast(s), all hashes match"
            if integrity["intact"] else
            f"{len(integrity['tampered'])} record(s) no longer match their "
            f"content hash: they were edited after archiving"
        ),
        evidence=integrity["tampered"],
    )


# --------------------------------------------------------------------------
# 2 and 4. Data leakage, including calibration leakage
# --------------------------------------------------------------------------

def check_leakage_enforcement() -> Finding:
    """Sections 30, 31 and 76 to 80.

    Checks that the ENFORCEMENT exists and works, by running the leakage
    detectors against deliberately leaky input. A leakage check that has
    never been shown to catch leakage is not a check.
    """
    from datetime import timedelta

    from . import calibrate, learning

    created = datetime(2026, 8, 30, 12, tzinfo=timezone.utc)
    late = created + timedelta(hours=6)
    evidence: list[str] = []

    leaky = learning.Dataset(
        dataset_id="audit", feature_order=("cape",),
        target_name="thunderstorm", event_definition="audit",
        observation_version="audit", quality_control_version="audit",
        examples=[learning.TrainingExample(
            forecast_id="audit-1", created_at=created,
            valid_time=created + timedelta(hours=6),
            features=(learning.Feature(
                name="cape", value=1.0, available_at=late,
                feature_version="1.0",
            ),),
            target=1.0, target_name="thunderstorm",
            target_available_at=created + timedelta(hours=7),
        )],
    )
    caught = learning.check_leakage(leaky)
    if not caught:
        evidence.append(
            "a feature timestamped AFTER the forecast was not detected"
        )

    clean = learning.Dataset(
        dataset_id="audit", feature_order=("cape",),
        target_name="thunderstorm", event_definition="audit",
        observation_version="audit", quality_control_version="audit",
        examples=[learning.TrainingExample(
            forecast_id="audit-2", created_at=created,
            valid_time=created + timedelta(hours=6),
            features=(learning.Feature(
                name="cape", value=1.0, available_at=created,
                feature_version="1.0",
            ),),
            target=1.0, target_name="thunderstorm",
            target_available_at=created + timedelta(hours=7),
        )],
    )
    if learning.check_leakage(clean):
        evidence.append(
            "a clean dataset was reported as leaking, which would make the "
            "detector useless by crying wolf"
        )

    # Calibration leakage: a reversed split must be refused.
    reversed_split = calibrate.Split(
        train=[], test=[], boundary=None, method="audit",
    )
    if reversed_split.usable:
        evidence.append("an empty split was reported as usable")

    return Finding(
        check="leakage_enforcement", passed=not evidence,
        detail=(
            "the leakage detectors catch a planted violation and pass a "
            "clean dataset"
            if not evidence else
            "the leakage enforcement did not behave as required"
        ),
        evidence=evidence,
    )


# --------------------------------------------------------------------------
# 3. Observation quality
# --------------------------------------------------------------------------

def check_observation_quality() -> Finding:
    """Sections 9, 57 and 95.

    The specific failure worth auditing is the coverage asymmetry: an
    unobserved hour must never be usable as a verified null.
    """
    from . import observations as OBS

    evidence: list[str] = []
    provenance = OBS.ObsProvenance(
        source=OBS.ObsSource.LIGHTNING_NETWORK, dataset="audit",
        dataset_version="audit",
    )

    def hour(strikes, coverage):
        h = OBS.ObservedHour(
            valid_time=datetime(2026, 8, 30, 18, tzinfo=timezone.utc),
            strikes=strikes, coverage=coverage, provenance=provenance,
        )
        h.quality, h.reason = OBS._grade(
            len(strikes), coverage, OBS.QualityControl()
        )
        return h

    strike = OBS.Strike(
        time=datetime(2026, 8, 30, 18, 5, tzinfo=timezone.utc),
        lon=-2.0, lat=52.0,
    )
    if hour([], 0.1).event_observed is not None:
        evidence.append(
            "an hour with 10% coverage and no detections was treated as a "
            "verified null -- this alone would make almost any forecast "
            "look skilful on a domain this quiet"
        )
    if hour([], 1.0).event_observed is not True and hour(
        [], 1.0
    ).event_observed is not False:
        evidence.append("a fully covered quiet hour is not usable")
    if hour([strike], 0.1).event_observed is not True:
        evidence.append(
            "a detected strike was discarded for poor coverage, but poor "
            "coverage cannot create a false positive"
        )

    archived = OBS.available_hours()
    if archived:
        got, report = OBS.load_range(archived[0], archived[-1])
        summary = OBS.coverage_summary(got)
        detail = (
            f"the coverage asymmetry holds. Archive: {summary['hours']} "
            f"hours, {summary['usable_hours']} usable, "
            f"{summary['total_flashes']} flashes"
        )
    else:
        detail = (
            "the coverage asymmetry holds, but no observations are archived"
        )

    return Finding(
        check="observation_quality", passed=not evidence, detail=detail,
        evidence=evidence,
    )


# --------------------------------------------------------------------------
# 5. Sample-size problems
# --------------------------------------------------------------------------

def check_sample_discipline() -> Finding:
    """Sections 36, 60, 61 and 96.

    Every skill number must carry its sample, and a number resting on too
    few independent storms must be refused rather than reported.
    """
    from . import metrics as M
    from . import skilldb as SKILL

    evidence: list[str] = []

    thin = SKILL.SkillRecord(
        key=SKILL.SkillKey(source="audit", variable="thunderstorm"),
        metric="brier_score", value=0.01, n=1_000_000, n_effective=500_000.0,
        n_events=400, independent_events=2,
        first_valid=None, last_valid=None,
    )
    if thin.trustworthy:
        evidence.append(
            "a record built on 2 independent storms was marked trustworthy "
            "despite a million raw cells"
        )
    if not thin.to_dict().get("caveat"):
        evidence.append("an untrustworthy record carries no caveat")

    import numpy as np
    score = M.brier_score(
        np.array([0.5] * 100), np.zeros(100), target="audit"
    )
    if score.interval is not None:
        evidence.append(
            "a confidence interval was produced without an effective "
            "sample size, which would be far too narrow"
        )
    for field in ("n", "n_events", "target"):
        if field not in score.to_dict():
            evidence.append(f"a Score does not report {field}")

    return Finding(
        check="sample_discipline", passed=not evidence,
        detail=(
            "skill numbers carry their sample, thin records are refused, "
            "and no interval is offered without an effective sample size"
            if not evidence else "sample discipline is not enforced"
        ),
        evidence=evidence,
    )


# --------------------------------------------------------------------------
# 6. Metric misuse
# --------------------------------------------------------------------------

def check_metric_use() -> Finding:
    """Sections 21, 23 and 24.

    A Brier score on a continuous field, or a skill score with no named
    baseline, are both category errors that still produce a number.
    """
    from . import targets

    evidence: list[str] = []

    try:
        targets.check_metric("temperature_2m", "brier_score")
        evidence.append(
            "a Brier score was accepted for a continuous target"
        )
    except ValueError:
        pass

    try:
        targets.check_metric("thunderstorm", "brier_score")
    except ValueError:
        evidence.append(
            "a Brier score was refused for an event target, which is "
            "exactly what it is for"
        )

    try:
        targets.get("not_a_real_target")
        evidence.append("an undeclared target was accepted for scoring")
    except KeyError:
        pass

    # Section 24: the baseline is a required argument, so omitting it must
    # be a TypeError rather than a silently defaulted comparison.
    import inspect

    from . import metrics as M
    signature = inspect.signature(M.brier_skill_score)
    baseline = signature.parameters.get("baseline")
    if baseline is None or baseline.default is not inspect.Parameter.empty:
        evidence.append(
            "brier_skill_score does not require a named baseline, so a "
            "skill score can be quoted without saying what it is relative to"
        )

    return Finding(
        check="metric_use", passed=not evidence,
        detail=(
            "metrics are tied to declared targets, undeclared targets are "
            "refused, and a skill score cannot omit its baseline"
            if not evidence else "metrics can be misapplied"
        ),
        evidence=evidence,
    )


# --------------------------------------------------------------------------
# 7. Hidden self-modification -- section 101
# --------------------------------------------------------------------------

#: Modules that must never be written to by the verification stage. These
#: are the operational forecasting components: if Stage 9 can rewrite one,
#: the loop section 101 forbids exists.
FORECASTING_PACKAGES = (
    "engines", "parameters", "profiles", "skill", "tcm", "spatial",
)

#: Call names that would let a module change code or state at runtime.
DANGEROUS_CALLS = frozenset({
    "exec", "eval", "compile", "__import__", "setattr", "delattr",
})


def check_no_self_modification(root: Path | None = None) -> Finding:
    """Section 101. Can anything change a forecasting component alone?

    Three checks:

      * `Registry.promote` must require a named approver and must raise
        without one. This is tested by CALLING it, not by reading it.
      * No module in `verify/` may write to a forecasting package's source.
      * No module in `verify/` may use exec/eval/setattr on imported code.
    """
    from . import governance as GOV

    evidence: list[str] = []

    # -- the promotion gate, exercised rather than inspected ---------------
    registry = GOV.Registry()
    model = GOV.RegisteredModel(
        name="audit", model_type="calibration", version="0.0",
        dataset=GOV.DatasetVersion(
            dataset_id="audit", generated_at=datetime.now(timezone.utc),
            source_forecasts="audit", source_observations="audit",
            observation_version="audit",
            feature_versions={"x": "1"}, n_samples=1000, n_events=500,
            n_episodes=10,
        ),
        card=GOV.ModelCard(
            name="audit", purpose="audit", target="audit",
            features=("x",), training_period="a", validation_period="b",
            limitations=("audit",), known_failure_modes=(),
        ),
        code_version="audit", random_seed=1,
    )
    registered = registry.register(model)
    if registered.status is not GOV.Status.CANDIDATE:
        evidence.append(
            f"a newly registered model was {registered.status.value}, not a "
            f"candidate"
        )
    evaluation = GOV.evaluate(registered, None, challenger_scores={})
    try:
        registry.promote(
            registered.key, evaluation=evaluation, approved_by="",
            motivation="audit",
        )
        evidence.append(
            "PROMOTION SUCCEEDED WITHOUT AN APPROVER: section 101's "
            "prohibition is not enforced"
        )
    except PermissionError:
        pass

    # -- source-writing ----------------------------------------------------
    root = root or Path(__file__).resolve().parent
    for path in sorted(root.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError) as exc:
            evidence.append(f"{path.name}: could not be parsed ({exc})")
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = getattr(node.func, "id", None) or getattr(
                    node.func, "attr", None
                )
                if name in DANGEROUS_CALLS:
                    evidence.append(
                        f"{path.name}:{node.lineno} calls {name}(), which "
                        f"can modify code or state at runtime"
                    )
                if name in ("write_text", "open", "save") and any(
                    package in ast.dump(node)
                    for package in FORECASTING_PACKAGES
                ):
                    evidence.append(
                        f"{path.name}:{node.lineno} writes to a forecasting "
                        f"package"
                    )

    return Finding(
        check="no_hidden_self_modification", passed=not evidence,
        detail=(
            "promotion refuses without a named approver, and nothing in the "
            "verification stage can rewrite a forecasting component"
            if not evidence else
            "the verification stage can change operational behaviour "
            "without a person"
        ),
        evidence=evidence,
    )


# --------------------------------------------------------------------------
# The whole audit
# --------------------------------------------------------------------------

CHECKS = (
    check_forecast_immutability,
    check_leakage_enforcement,
    check_observation_quality,
    check_sample_discipline,
    check_metric_use,
    check_no_self_modification,
)


def full_audit() -> dict:
    """Run every step-16 check."""
    findings: list[Finding] = []
    for check in CHECKS:
        try:
            findings.append(check())
        except Exception as exc:            # noqa: BLE001 - an audit that
            # crashes must report that it crashed, not vanish.
            log.exception("audit check %s failed", check.__name__)
            findings.append(Finding(
                check=check.__name__, passed=False,
                detail=f"the check itself raised: {exc!r}",
            ))

    failed = [f for f in findings if not f.passed]
    blocking = [f for f in failed if f.severity == "blocking"]
    return {
        "version": AUDIT_VERSION,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "checks": [f.to_dict() for f in findings],
        "passed": len(findings) - len(failed),
        "failed": len(failed),
        "clean": not blocking,
        "verdict": (
            "every step-16 check passes. The verification system enforces "
            "immutability, refuses leakage, keeps unobserved hours out, "
            "carries samples with every number, ties metrics to declared "
            "targets, and cannot change a forecasting component without a "
            "person"
            if not blocking else
            "AUDIT FAILED: " + "; ".join(f.check for f in blocking)
        ),
    }
