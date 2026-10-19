"""When may a forecast begin, and what may it run without?

Steps 3 and 4 of the Stage 10 order, sections 4, 6, 7, 8, 9 and 24.

Two questions, deliberately separated:

    DETECTION   which models have arrived, and in what state
    READINESS   whether that is enough to forecast at all

Section 7 warns against starting simply because one model turned up.
Section 8 requires degraded operation to be possible AND explicit. The
resolution is a rule set that names which models are CRITICAL and which are
merely helpful, evaluated into a decision that says what it is proceeding
without.

WHY DELAYED AND UNAVAILABLE ARE DIFFERENT
-----------------------------------------
Section 4 asks for asynchronous availability to be handled properly, and
the distinction that matters operationally is between "not here yet" and
"not coming". A PENDING model is worth waiting for; a DELAYED one has
passed its window and the cycle must decide whether to proceed without it.
`ArrivalWindow` holds the expected timing for each model so that decision
is made against a stated expectation rather than a guess.

DEGRADED IS NOT THE SAME AS LESS LIKELY
---------------------------------------
Section 8 ends with a rule that is easy to get wrong: do not simply reduce
probability because data are missing. Missing models make the forecast less
CERTAIN, not the weather less likely. So a degraded cycle lowers confidence
through Stage 7's own confidence machinery and leaves the probability
alone -- and `Decision` carries no probability adjustment of any kind,
because there is nowhere for one to go.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timedelta, timezone

from .manifest import CycleManifest, ModelEntry, ModelState

log = logging.getLogger(__name__)

READINESS_VERSION = "stage10.1"


@dataclass(frozen=True, slots=True)
class ArrivalWindow:
    """When a model's run is expected, relative to its cycle time.

    Measured from the DataHub's observed behaviour rather than assumed:
    UKV publishes T+0 within about 75 minutes of its cycle and completes
    the long lead times by about 3 hours. A model still absent after
    `deadline` is DELAYED rather than PENDING.
    """

    model_id: str
    expected_after: timedelta
    deadline: timedelta
    #: Whether the forecast can run at all without this model.
    critical: bool = False
    #: Ensemble members expected, 0 for a deterministic model.
    expected_members: int = 0

    def state_for(
        self, now: datetime, cycle: datetime, *, present: bool,
        complete: bool,
    ) -> tuple[ModelState, str]:
        """Classify a model from what is on disk and how late it is."""
        age = now - cycle
        if present and complete:
            return ModelState.AVAILABLE, ""
        if present:
            return ModelState.PARTIAL, (
                f"some fields arrived and some did not, {age.total_seconds() / 3600:.1f} h "
                f"after the {cycle:%HZ} cycle"
            )
        if age < self.expected_after:
            return ModelState.PENDING, (
                f"not published yet; not expected until "
                f"{self.expected_after.total_seconds() / 3600:.1f} h after "
                f"the cycle"
            )
        if age < self.deadline:
            return ModelState.PENDING, (
                f"not published yet, {age.total_seconds() / 3600:.1f} h "
                f"after the cycle; still inside its normal window"
            )
        return ModelState.DELAYED, (
            f"still absent {age.total_seconds() / 3600:.1f} h after the "
            f"cycle, past its {self.deadline.total_seconds() / 3600:.1f} h "
            f"deadline"
        )


#: Expected arrival windows. UKV is the only critical model: it is the only
#: 2 km source, and the TCM grid IS the UKV grid, so without it there is no
#: forecast to make rather than a coarser one.
WINDOWS: dict[str, ArrivalWindow] = {
    "ukv": ArrivalWindow(
        "ukv", timedelta(minutes=75), timedelta(hours=4), critical=True),
    "mogreps_g": ArrivalWindow(
        "mogreps_g", timedelta(hours=3), timedelta(hours=7),
        expected_members=18),
    "mogreps_uk": ArrivalWindow(
        "mogreps_uk", timedelta(hours=2), timedelta(hours=6),
        expected_members=12),
    "ukmo_global": ArrivalWindow(
        "ukmo_global", timedelta(hours=3), timedelta(hours=7)),
    "ifs_hres": ArrivalWindow(
        "ifs_hres", timedelta(hours=5), timedelta(hours=9)),
    "icon_eu": ArrivalWindow(
        "icon_eu", timedelta(hours=3), timedelta(hours=7)),
    "arpege": ArrivalWindow(
        "arpege", timedelta(hours=4), timedelta(hours=8)),
}

#: Fields without which a profile cannot be reconstructed at all. Not a
#: preference: Stage 3 needs temperature and humidity on pressure levels to
#: build a column, and Stage 4's parcel ascent needs the surface state.
CRITICAL_FIELDS = (
    "temperature_2m", "pressure_surface",
)

#: Minimum fraction of the expected field set a model must have before it
#: is called PARTIAL rather than effectively absent.
MIN_COMPLETENESS = 0.5


@dataclass(frozen=True, slots=True)
class Rules:
    """Section 7's readiness rules, as configuration rather than code."""

    #: Models without which no forecast may run.
    critical_models: tuple[str, ...] = ("ukv",)
    #: How many usable models are needed at all.
    minimum_models: int = 1
    #: Fraction of a model's fields needed for it to count as usable.
    minimum_completeness: float = MIN_COMPLETENESS
    #: Whether an ensemble is required. False: a deterministic forecast is
    #: a real forecast, it simply has less to say about spread.
    require_ensemble: bool = False
    version: str = READINESS_VERSION

    def to_dict(self) -> dict:
        return {
            "critical_models": list(self.critical_models),
            "minimum_models": self.minimum_models,
            "minimum_completeness": self.minimum_completeness,
            "require_ensemble": self.require_ensemble,
            "version": self.version,
        }


@dataclass(slots=True)
class Decision:
    """Whether to run, in what mode, and what is being given up.

    Carries no probability adjustment, and there is deliberately nowhere to
    put one. Section 8: missing data make a forecast less certain, not the
    weather less likely.
    """

    proceed: bool
    degraded: bool
    reasons: list[str] = dc_field(default_factory=list)
    missing: list[str] = dc_field(default_factory=list)
    usable: list[str] = dc_field(default_factory=list)
    #: What the forecast will not be able to say because of what is missing.
    limitations: list[str] = dc_field(default_factory=list)
    wait_until: datetime | None = None

    def to_dict(self) -> dict:
        return {
            "proceed": self.proceed,
            "degraded": self.degraded,
            "usable_models": self.usable,
            "missing_models": self.missing,
            "reasons": self.reasons,
            "limitations": self.limitations,
            "wait_until": (
                self.wait_until.isoformat() if self.wait_until else None
            ),
            "note": (
                "a degraded forecast lowers CONFIDENCE, not probability. "
                "Missing models make the answer less certain; they do not "
                "make thunderstorms less likely"
            ),
        }


def evaluate(
    manifest: CycleManifest, *, rules: Rules | None = None,
    now: datetime | None = None,
) -> Decision:
    """Decide whether this cycle may proceed. Sections 7 and 8."""
    rules = rules or Rules()
    now = now or datetime.now(timezone.utc)

    usable = manifest.usable_models()
    missing = sorted(
        m for m, e in manifest.models.items() if not e.state.usable
    )
    decision = Decision(
        proceed=False, degraded=False, usable=usable, missing=missing
    )

    # -- critical models ---------------------------------------------------
    for model_id in rules.critical_models:
        entry = manifest.models.get(model_id)
        if entry is None:
            decision.reasons.append(
                f"{model_id} is required and is not even expected in this "
                f"cycle's manifest"
            )
            return decision
        if not entry.state.usable:
            decision.reasons.append(
                f"{model_id} is CRITICAL and is {entry.state.value}: "
                f"{entry.reason}"
            )
            window = WINDOWS.get(model_id)
            if window and entry.state is ModelState.PENDING:
                decision.wait_until = manifest.cycle + window.deadline
                decision.reasons.append(
                    f"it is still inside its arrival window; waiting until "
                    f"{decision.wait_until:%H:%M}Z is the correct action "
                    f"rather than forecasting without it"
                )
            return decision

    if len(usable) < rules.minimum_models:
        decision.reasons.append(
            f"only {len(usable)} usable model(s); {rules.minimum_models} "
            f"required"
        )
        return decision

    decision.proceed = True
    decision.reasons.append(
        f"{len(usable)} usable model(s) including every critical one"
    )

    # -- degradation -------------------------------------------------------
    for model_id, entry in sorted(manifest.models.items()):
        if entry.state.usable:
            if entry.state is ModelState.PARTIAL:
                decision.degraded = True
                decision.reasons.append(
                    f"{model_id} is PARTIAL "
                    f"({entry.completeness:.0%} of its fields)"
                )
            if entry.expected_members and not entry.ensemble_complete:
                decision.degraded = True
                decision.reasons.append(
                    f"{model_id} has {len(entry.members)} of "
                    f"{entry.expected_members} ensemble members"
                )
                decision.limitations.append(
                    f"ensemble spread from {model_id} rests on "
                    f"{len(entry.members)} members and is correspondingly "
                    f"less reliable -- it is NOT treated as though the "
                    f"missing members forecast nothing"
                )
            continue

        decision.degraded = True
        decision.reasons.append(
            f"{model_id} is {entry.state.value}: {entry.reason}"
        )

    if not any(
        e.expected_members and e.state.usable for e in manifest.models.values()
    ):
        decision.limitations.append(
            "no ensemble is available, so the forecast has no within-model "
            "spread and its uncertainty rests on multi-model disagreement "
            "alone"
        )
        if rules.require_ensemble:
            decision.proceed = False
            decision.reasons.append(
                "an ensemble is required by the configured rules and none "
                "is available"
            )

    if len(usable) == 1:
        decision.limitations.append(
            "a single model provides no multi-model agreement, so Stage 6 "
            "weighting has nothing to weigh and the confidence reflects one "
            "solution rather than a consensus"
        )

    if decision.degraded:
        log.warning(
            "cycle %s will run DEGRADED: %s",
            manifest.forecast_id, "; ".join(decision.reasons[-3:]),
        )
    return decision


# --------------------------------------------------------------------------
# Detection -- section 4
# --------------------------------------------------------------------------

def detect(
    manifest: CycleManifest, *, required_fields: tuple[str, ...] = (),
    now: datetime | None = None,
) -> CycleManifest:
    """Look at what is actually stored and set every model's state.

    Reads the ingest store rather than the provider: a model is available
    to THIS forecast when its data are on disk, not when the provider says
    they exist. That distinction matters during an outage, when a provider
    can advertise a run the platform never managed to download.
    """
    from ..pipeline.ingest import stored_inventory, stored_runs

    now = now or datetime.now(timezone.utc)
    fields = required_fields or CRITICAL_FIELDS

    for model_id, entry in manifest.models.items():
        window = WINDOWS.get(model_id) or ArrivalWindow(
            model_id, timedelta(hours=3), timedelta(hours=8)
        )
        try:
            runs = stored_runs(model_id)
        except Exception as exc:            # noqa: BLE001
            manifest.record(ModelEntry(
                model_id=model_id, provider=entry.provider,
                state=ModelState.FAILED,
                reason=f"could not read the store: {exc!r}",
                last_checked=now,
            ))
            continue

        matching = [r for r in runs if r == manifest.cycle]
        if not matching:
            newest = max(runs) if runs else None
            if newest is not None and newest < manifest.cycle:
                state, reason = window.state_for(
                    now, manifest.cycle, present=False, complete=False
                )
                if state is ModelState.DELAYED:
                    reason = (
                        f"{reason}. The newest stored run is "
                        f"{newest:%Y-%m-%d %HZ}, which is older than this "
                        f"cycle and must not be used in its place"
                    )
            else:
                state, reason = window.state_for(
                    now, manifest.cycle, present=False, complete=False
                )
            manifest.record(ModelEntry(
                model_id=model_id, provider=entry.provider, state=state,
                reason=reason, expected_members=window.expected_members,
                last_checked=now, first_seen=entry.first_seen,
            ))
            continue

        inventory = stored_inventory(model_id, manifest.cycle)
        parameters = inventory.get("parameters", inventory)
        present = set(parameters) if isinstance(parameters, dict) else set()
        missing = [f for f in fields if f not in present]

        members: tuple[int, ...] = ()
        if window.expected_members:
            try:
                from ..pipeline.ingest import stored_members
                members = tuple(sorted(
                    stored_members(model_id, manifest.cycle) or ()
                ))
            except Exception:            # noqa: BLE001
                members = ()

        complete = not missing
        state, reason = window.state_for(
            now, manifest.cycle, present=bool(present), complete=complete
        )
        if state is ModelState.PARTIAL and missing:
            reason = (
                f"missing required field(s) {missing}; "
                f"{len(present)} field(s) present"
            )
        manifest.record(ModelEntry(
            model_id=model_id, provider=entry.provider, state=state,
            run=manifest.cycle, members=members,
            expected_members=window.expected_members,
            fields_expected=max(len(fields), len(present)),
            fields_present=len(present), reason=reason,
            first_seen=entry.first_seen or now, last_checked=now,
        ))

    log.info(
        "cycle %s detection: %s",
        manifest.forecast_id, manifest.by_state(),
    )
    return manifest


def next_cycles(
    model_id: str = "ukv", *, count: int = 4, now: datetime | None = None
) -> list[datetime]:
    """The most recent cycle times that could be forecast, newest first.

    UKV runs four times a day. Listing them rather than assuming the latest
    is what lets the orchestrator catch up after an outage.
    """
    now = now or datetime.now(timezone.utc)
    hours = (0, 6, 12, 18)
    out: list[datetime] = []
    cursor = now.replace(minute=0, second=0, microsecond=0)
    while len(out) < count:
        if cursor.hour in hours:
            out.append(cursor)
        cursor -= timedelta(hours=1)
    return out
