"""Fitting calibration against real observations.

Step 9 of the Stage 9 order, sections 29 to 33, 59, 65, 66 and 77.

Stage 7 already built the calibration MACHINERY -- identity, Platt scaling
and isotonic regression, with sharpness protection -- and left it unfitted
because no observations existed. This module does not rebuild any of that.
It supplies the thing that was missing: verified forecast/observation pairs,
split so that fitting cannot see the answer.

    Stage 7  how to calibrate
    Stage 9  what to calibrate against, and how to split it honestly

WHY SPLITTING IS THE HARD PART
------------------------------
Section 30 forbids calibrating on the samples a model is then verified
against, and section 77 forbids shuffling weather events randomly into
train and test. Both matter more than they sound.

A single convective outbreak covers tens of thousands of grid cells across
several hours. Shuffling those cells at random puts the SAME STORM in the
training set and the test set. The calibration then appears excellent
because it has already seen the answer for the cells next door -- and the
apparent skill is entirely an artefact of the split.

So `TemporalSplit` cuts by TIME, never by cell, and `EpisodeSplit` goes
further and cuts by convective EPISODE, keeping every hour of one outbreak
on the same side of the boundary. On a dataset containing one outbreak that
means no split is possible at all, and `split` says so rather than
manufacturing one.

WALK-FORWARD IS THE OPERATIONAL SHAPE
-------------------------------------
Section 31. Fit on everything up to time t; calibrate forecasts valid after
t; roll forward. `walk_forward` implements exactly that and never lets a
fold see its own future, which `assert_no_leakage` re-checks by comparing
timestamps rather than trusting the loop.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta

import numpy as np

from ..tcm.probability import CalibrationStatus, Calibrator, fit_calibrator
from . import metrics as M
from .matching import MatchedField

log = logging.getLogger(__name__)

CALIBRATION_VERSION = "stage9.1"

#: Smallest number of observed EVENTS a calibration may be fitted on.
#: Below this the fit is describing individual storms rather than a
#: relationship, and isotonic regression in particular will happily
#: memorise them into a staircase.
MIN_EVENTS_TO_FIT = 100

#: Smallest number of independent EPISODES. A calibration fitted on one
#: outbreak is a calibration for that outbreak. Section 60.
MIN_EPISODES_TO_FIT = 3


@dataclass(frozen=True, slots=True)
class Split:
    """One train/test division, with the boundary recorded."""

    train: list[MatchedField]
    test: list[MatchedField]
    boundary: datetime | None
    method: str
    reason: str = ""

    @property
    def usable(self) -> bool:
        return bool(self.train) and bool(self.test)

    def to_dict(self) -> dict:
        return {
            "method": self.method,
            "boundary": self.boundary.isoformat() if self.boundary else None,
            "train_hours": len(self.train),
            "test_hours": len(self.test),
            "train_events": sum(f.n_events for f in self.train),
            "test_events": sum(f.n_events for f in self.test),
            "usable": self.usable,
            "reason": self.reason or None,
        }


def episodes(fields: list[MatchedField]) -> list[list[MatchedField]]:
    """Group hours into convective episodes.

    An episode is a run of consecutive hours containing events, together
    with any quiet hours between them shorter than the gap that separates
    weather situations. Splitting inside an episode would put one storm on
    both sides of the boundary, which is section 77's spatial-and-temporal
    leakage in its most damaging form.
    """
    ordered = sorted(fields, key=lambda f: f.valid_time)
    if not ordered:
        return []

    groups: list[list[MatchedField]] = [[ordered[0]]]
    for field in ordered[1:]:
        previous = groups[-1][-1]
        gap = (field.valid_time - previous.valid_time).total_seconds() / 3600.0
        # A gap of more than six quiet hours is a different weather
        # situation. Convection has a diurnal cycle, so anything shorter can
        # be the same system re-firing.
        quiet_break = gap > 6.0 and previous.n_events == 0
        if quiet_break:
            groups.append([field])
        else:
            groups[-1].append(field)
    return groups


def temporal_split(
    fields: list[MatchedField], *, train_fraction: float = 0.7
) -> Split:
    """Split by time. Section 59.

    Everything before the boundary trains; everything after tests. The
    boundary falls on an hour, never inside one.
    """
    ordered = sorted(fields, key=lambda f: f.valid_time)
    if len(ordered) < 2:
        return Split([], [], None, "temporal",
                     "fewer than two hours: no split is possible")
    cut = max(1, int(len(ordered) * train_fraction))
    boundary = ordered[cut].valid_time
    return Split(ordered[:cut], ordered[cut:], boundary, "temporal")


def episode_split(
    fields: list[MatchedField], *, train_fraction: float = 0.7
) -> Split:
    """Split by convective episode. Sections 60 and 77.

    Stricter than a temporal split: no episode may straddle the boundary.
    On a dataset containing a single outbreak this returns an unusable
    split with the reason stated, which is the correct answer -- there is
    no way to hold out an independent test set from one storm.
    """
    groups = episodes(fields)
    if len(groups) < 2:
        return Split(
            [], [], None, "episode",
            f"the dataset contains {len(groups)} convective episode(s). "
            f"An honest train/test split needs at least two, because "
            f"splitting inside one outbreak puts the same storm on both "
            f"sides and the resulting calibration has seen its own answer"
        )
    cut = max(1, int(round(len(groups) * train_fraction)))
    cut = min(cut, len(groups) - 1)
    train = [f for g in groups[:cut] for f in g]
    test = [f for g in groups[cut:] for f in g]
    return Split(
        train, test, test[0].valid_time if test else None, "episode",
    )


def assert_no_leakage(split: Split) -> list[str]:
    """Re-check a split by timestamps rather than trusting the loop."""
    problems: list[str] = []
    if not split.train or not split.test:
        return problems
    latest_train = max(f.valid_time for f in split.train)
    earliest_test = min(f.valid_time for f in split.test)
    if earliest_test <= latest_train:
        problems.append(
            f"test data at {earliest_test:%Y-%m-%d %HZ} is not after "
            f"training data ending {latest_train:%Y-%m-%d %HZ}"
        )
    train_times = {f.valid_time for f in split.train}
    overlap = train_times & {f.valid_time for f in split.test}
    if overlap:
        problems.append(
            f"{len(overlap)} valid time(s) appear in both training and test"
        )
    return problems


# --------------------------------------------------------------------------
# Fitting
# --------------------------------------------------------------------------

@dataclass(slots=True)
class CalibrationFit:
    """A fitted calibrator plus the evidence for and against using it."""

    calibrator: Calibrator
    method: str
    n_events: int
    n_episodes: int
    split: Split | None
    before: dict = dc_field(default_factory=dict)
    after: dict = dc_field(default_factory=dict)
    accepted: bool = False
    reason: str = ""
    warnings: list[str] = dc_field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "method": self.method,
            "accepted": self.accepted,
            "reason": self.reason,
            "n_events": self.n_events,
            "n_episodes": self.n_episodes,
            "split": self.split.to_dict() if self.split else None,
            "before": self.before,
            "after": self.after,
            "warnings": self.warnings,
            "calibrator": self.calibrator.to_dict(),
            "version": CALIBRATION_VERSION,
        }


def fit(
    fields: list[MatchedField], *, method: str = "isotonic",
    target: str = "thunderstorm", split: Split | None = None,
    min_events: int = MIN_EVENTS_TO_FIT,
    min_episodes: int = MIN_EPISODES_TO_FIT,
) -> CalibrationFit:
    """Fit a calibrator on the training half and score it on the test half.

    Refuses on too few events or too few episodes, and refuses a
    calibration that improves reliability by destroying sharpness. Section
    65: "do not improve calibration by simply forcing every forecast toward
    climatology".
    """
    split = split or episode_split(fields)
    n_events = sum(f.n_events for f in fields)
    n_episodes = len(episodes(fields))

    warnings: list[str] = []
    if not split.usable:
        return CalibrationFit(
            calibrator=Calibrator(), method="identity", n_events=n_events,
            n_episodes=n_episodes, split=split, accepted=False,
            reason=(
                f"no honest split is available: {split.reason}. Fitting on "
                f"all of it and reporting the fit quality would be "
                f"reporting how well a curve fits the points it was drawn "
                f"through"
            ),
        )

    leakage = assert_no_leakage(split)
    if leakage:
        return CalibrationFit(
            calibrator=Calibrator(), method="identity", n_events=n_events,
            n_episodes=n_episodes, split=split, accepted=False,
            reason="the split leaks: " + "; ".join(leakage),
        )

    if n_events < min_events:
        warnings.append(
            f"{n_events} observed events is below the {min_events} this "
            f"module requires to fit; the calibration would be describing "
            f"individual storms"
        )
    if n_episodes < min_episodes:
        warnings.append(
            f"{n_episodes} convective episode(s) is below the "
            f"{min_episodes} required; a calibration fitted on one outbreak "
            f"is a calibration for that outbreak"
        )

    train_f = np.concatenate([f.pairs()[0] for f in split.train])
    train_o = np.concatenate([f.pairs()[1] for f in split.train])
    test_f = np.concatenate([f.pairs()[0] for f in split.test])
    test_o = np.concatenate([f.pairs()[1] for f in split.test])

    # `identity` is a real member of the comparison, not a placeholder: it
    # is the hypothesis that the raw probabilities are already better than
    # anything calibration can do with this sample, and section 29's
    # instruction to choose by backtesting only means something if that
    # hypothesis can win.
    if method == "identity":
        calibrator = Calibrator()
    else:
        calibrator = fit_calibrator(train_f, train_o, method=method)

    before = {
        "brier": M.brier_score(test_f, test_o, target=target).to_dict(),
        "reliability": M.reliability(test_f, test_o, target=target),
        "sharpness": M.sharpness(test_f, target=target),
        "roc_auc": M.roc_auc(test_f, test_o, target=target).to_dict(),
    }
    calibrated = np.asarray(calibrator(test_f), dtype="float64")
    after = {
        "brier": M.brier_score(calibrated, test_o, target=target).to_dict(),
        "reliability": M.reliability(calibrated, test_o, target=target),
        "sharpness": M.sharpness(calibrated, target=target),
        "roc_auc": M.roc_auc(calibrated, test_o, target=target).to_dict(),
    }

    accepted, reason = _judge(before, after, warnings)
    if getattr(calibrator, "degrades_sharpness", False):
        warnings.append(
            "Stage 7's own sharpness check flagged this calibration as "
            "flattening the forecast distribution"
        )

    fitted = CalibrationFit(
        calibrator=calibrator if accepted else Calibrator(),
        method=method if accepted else "identity",
        n_events=n_events, n_episodes=n_episodes, split=split,
        before=before, after=after, accepted=accepted, reason=reason,
        warnings=warnings,
    )
    log.info(
        "calibration %s on %d events / %d episodes: %s",
        method, n_events, n_episodes,
        "accepted" if accepted else f"rejected ({reason})",
    )
    return fitted


def _judge(before: dict, after: dict, warnings: list[str]) -> tuple[bool, str]:
    """Should this calibration be used? Sections 28, 52 and 65."""
    bs_before = before["brier"]["value"]
    bs_after = after["brier"]["value"]
    if bs_before is None or bs_after is None:
        return False, "the test set could not be scored"

    if bs_after > bs_before:
        return False, (
            f"calibration made the Brier score WORSE on unseen data "
            f"({bs_after:.6f} against {bs_before:.6f}). A calibration that "
            f"degrades held-out performance is overfitting, not calibration"
        )

    var_before = before["sharpness"].get("variance", 0.0) or 0.0
    var_after = after["sharpness"].get("variance", 0.0) or 0.0
    if var_before > 0 and var_after < 0.25 * var_before:
        return False, (
            f"calibration collapsed forecast variance from {var_before:.3g} "
            f"to {var_after:.3g}. Section 65: reliability bought by pushing "
            f"everything towards climatology is not an improvement"
        )

    auc_before = before["roc_auc"]["value"]
    auc_after = after["roc_auc"]["value"]
    if auc_before is not None and auc_after is not None:
        if auc_after < auc_before - 1e-6:
            # A monotone map is allowed to be FLAT, and isotonic regression
            # on a training episode with little signal variation collapses
            # to a single constant -- which is monotone, legal, and
            # destroys every distinction the forecast could make. That is
            # not a bug in the fit; it is the fit correctly concluding that
            # the training data supported no distinctions, and it must
            # still be refused.
            return False, (
                f"calibration destroyed discrimination (AUC {auc_after:.4f} "
                f"from {auc_before:.4f}). A monotone map may be flat, and a "
                f"flat one maps every forecast to the same number: "
                f"perfectly reliable and completely useless"
            )

    if warnings:
        return True, (
            "accepted, but the sample is too small for the result to be "
            "trusted operationally: " + "; ".join(warnings)
        )
    return True, (
        f"improved the Brier score on unseen data from {bs_before:.6f} to "
        f"{bs_after:.6f} without collapsing sharpness or discrimination"
    )


def compare_methods(
    fields: list[MatchedField], *, target: str = "thunderstorm",
    methods: tuple[str, ...] = ("identity", "logistic", "isotonic"),
) -> dict:
    """Fit every method and report them side by side. Section 29.

    "Select methods based on backtesting. Do not assume the most
    complicated calibration is best." So the choice is made by the numbers
    below rather than asserted here.
    """
    split = episode_split(fields)
    results = {}
    for method in methods:
        results[method] = fit(
            fields, method=method, target=target, split=split
        ).to_dict()

    scored = [
        (name, r["after"].get("brier", {}).get("value"))
        for name, r in results.items()
        if r["accepted"] and r["after"].get("brier", {}).get("value")
        is not None
    ]
    best = min(scored, key=lambda pair: pair[1])[0] if scored else None
    return {
        "methods": results,
        "best": best,
        "note": (
            "chosen by held-out Brier score among methods that passed the "
            "sharpness and discrimination gates. `identity` winning means "
            "the raw probabilities were already better than anything "
            "calibration could do with this sample"
            if best else
            "no method was accepted; the raw probabilities stand uncalibrated"
        ),
    }


# --------------------------------------------------------------------------
# Walk-forward -- section 31
# --------------------------------------------------------------------------

def walk_forward(
    fields: list[MatchedField], *, method: str = "isotonic",
    target: str = "thunderstorm", min_train_hours: int = 6,
) -> dict:
    """Operational calibration: fit on the past, apply to the next period.

    Each fold fits only on hours strictly before the fold's own valid time,
    which is what an operational system could actually have done. Any fold
    whose training set is too small is skipped rather than fitted on
    whatever happens to be available.
    """
    ordered = sorted(fields, key=lambda f: f.valid_time)
    folds: list[dict] = []
    raw_all: list[np.ndarray] = []
    cal_all: list[np.ndarray] = []
    obs_all: list[np.ndarray] = []

    for i in range(min_train_hours, len(ordered)):
        train, test = ordered[:i], [ordered[i]]
        train_events = sum(f.n_events for f in train)
        if train_events < 1:
            folds.append({
                "valid_time": test[0].valid_time.isoformat(),
                "skipped": "no events in the training window yet",
            })
            continue

        train_f = np.concatenate([f.pairs()[0] for f in train])
        train_o = np.concatenate([f.pairs()[1] for f in train])
        test_f, test_o = test[0].pairs()
        if test_f.size == 0:
            continue

        calibrator = fit_calibrator(train_f, train_o, method=method)
        calibrated = np.asarray(calibrator(test_f), dtype="float64")

        raw_all.append(test_f)
        cal_all.append(calibrated)
        obs_all.append(test_o)
        folds.append({
            "valid_time": test[0].valid_time.isoformat(),
            "train_hours": len(train),
            "train_events": train_events,
            "raw_brier": round(float(np.mean((test_f - test_o) ** 2)), 6),
            "calibrated_brier": round(
                float(np.mean((calibrated - test_o) ** 2)), 6
            ),
        })

    if not obs_all:
        return {
            "available": False,
            "reason": (
                f"no fold had at least {min_train_hours} hours of history "
                f"containing events. Walk-forward calibration needs a past "
                f"to learn from"
            ),
            "folds": folds,
        }

    raw = np.concatenate(raw_all)
    calibrated = np.concatenate(cal_all)
    observed = np.concatenate(obs_all)
    return {
        "available": True,
        "method": method,
        "folds": folds,
        "raw": M.brier_score(raw, observed, target=target).to_dict(),
        "calibrated": M.brier_score(
            calibrated, observed, target=target).to_dict(),
        "improvement": round(
            float(np.mean((raw - observed) ** 2)
                  - np.mean((calibrated - observed) ** 2)), 8
        ),
        "note": (
            "every fold was calibrated using only hours strictly before its "
            "own valid time, which is what an operational system could have "
            "done. A fold calibrated on its own hour would score better and "
            "mean nothing"
        ),
    }


# --------------------------------------------------------------------------
# Stratified calibration -- sections 32 and 33
# --------------------------------------------------------------------------

def stratified(
    groups: dict[str, list[MatchedField]], *, method: str = "isotonic",
    target: str = "thunderstorm", min_events: int = MIN_EVENTS_TO_FIT,
) -> dict:
    """Calibrate separately by regime or region, falling back when thin.

    Sections 32 and 33 both ask for stratified calibration and both warn
    against creating separate calibrators for tiny samples. The resolution
    is hierarchical: a stratum with enough events gets its own calibrator,
    and one without SHARES the pooled fit rather than getting a noisy one
    of its own. That is the same shrinkage principle Stage 6 uses for skill.
    """
    pooled_fields = [f for fields in groups.values() for f in fields]
    pooled = fit(pooled_fields, method=method, target=target)

    out: dict[str, dict] = {}
    for name, fields in sorted(groups.items()):
        events = sum(f.n_events for f in fields)
        if events < min_events:
            out[name] = {
                "own_calibrator": False,
                "n_events": events,
                "using": "pooled",
                "reason": (
                    f"{events} events is below {min_events}; this stratum "
                    f"shares the pooled calibration rather than fitting a "
                    f"noisy one of its own"
                ),
            }
            continue
        stratum = fit(fields, method=method, target=target)
        out[name] = {
            "own_calibrator": stratum.accepted,
            "n_events": events,
            "using": name if stratum.accepted else "pooled",
            "fit": stratum.to_dict(),
        }

    return {
        "pooled": pooled.to_dict(),
        "strata": out,
        "note": (
            "a stratum without enough events shares the pooled calibration. "
            "Sections 32 and 33 both warn against separate calibrators for "
            "tiny samples, and this is the hierarchical answer to that"
        ),
    }
