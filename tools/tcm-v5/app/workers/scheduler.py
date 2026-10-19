"""Scheduled model runs and observation polling.

TCM ingests on a schedule, not on demand. Two reasons, and the second is the
important one:

  * A page load must never trigger a fetch. Ingesting a cycle takes minutes
    and thousands of requests against a metered API; doing that because
    somebody opened the map would make the site unusable and burn the quota.
  * Forecast products must be *reproducible*. A run ingested at a fixed time
    from a fixed cycle can be re-derived; one assembled piecemeal as users
    happen to browse cannot.

So the API only ever reads what is already on disk. If a lead time has not
been ingested, the endpoint says so rather than going and getting it.

**03:00 and 15:00 local time** are chosen to sit after the Met Office 00Z and
12Z cycles have finished publishing. Observation polling runs continuously
and separately: the Blitzortung feed is a ~30 second rolling buffer, so it
has to be sampled far more often than the models are.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime, timezone

log = logging.getLogger(__name__)

#: Hours (local time) at which a full ingest runs.
INGEST_HOURS = (3, 15)

#: How often the live strike buffer is sampled.
#:
#: RETENTION IS SHORT, AND SHORTER THAN IT WAS.
#:
#: This was recorded as ~5.78 h, measured on 2026-08-29, on the strength of
#: which a missed period was assumed to self-heal on the next poll. Measured
#: again on 2026-08-30 the buffer spanned 18:25:22Z to 18:51:45Z --
#: 0.44 HOURS. A poll returned 2079 strikes covering 26 minutes, of which 44
#: were new.
#:
#: The consequence is operational, not cosmetic: any interruption longer than
#: about half an hour is a PERMANENT hole. Those strikes cannot be recovered
#: from the provider afterwards by any means this platform has, so an hour
#: nobody polled has no observation and never will.
#:
#: A poll every 60 s therefore has to be understood as the thing that
#: prevents data loss, not merely as a refresh. It also keeps the worker
#: awake -- a sleeping worker loses its buffer entirely.
OBSERVATION_POLL_SECONDS = 60

_scheduler = None
_last_run: dict[str, str] = {}

#: Live readiness, so the viewer can show a startup screen instead of hanging
#: on "Loading…" for the ~100 seconds a warm takes. Every field is either
#: measured or explicitly unknown -- the estimate comes from how long the LAST
#: warm actually took on this machine, never from a guess.
_state: dict = {
    "phase": "starting",
    "detail": "starting up",
    "started_at": None,
    "steps_done": 0,
    "steps_total": 0,
    # True once a warm has completed, i.e. the site can answer.
    #
    # This is SEPARATE from the phase, because the two answer different
    # questions. A catch-up ingest sets the phase to "ingesting" while the
    # previous cycle is still being served perfectly well -- and readiness
    # keyed on phase alone put the full-screen startup panel back up and
    # locked the user out of a working site for the length of a download.
    "can_serve": False,
}


def _timing_path():
    from ..config import get_settings

    return get_settings().data_root / "warm-timing.json"


def _remembered_seconds() -> float | None:
    """How long the last warm took, or None the very first time."""
    import json

    path = _timing_path()
    if not path.exists():
        return None
    try:
        return float(json.loads(path.read_text("utf-8"))["seconds"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _remember_seconds(seconds: float) -> None:
    import json

    path = _timing_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"seconds": round(seconds, 1)}), "utf-8")
    except OSError:
        log.debug("could not record warm timing", exc_info=True)


def readiness() -> dict:
    """Whether the site can serve a forecast yet, and how long until it can.

    `expected_seconds` is measured, not assumed: it is the duration of the
    previous warm on this machine. The first ever start has nothing to
    measure and says so rather than inventing a number.
    """
    phase = _state["phase"]
    serving = bool(_state.get("can_serve"))
    started = _state.get("started_at")
    elapsed = (
        (datetime.now(timezone.utc) - started).total_seconds()
        if started else 0.0
    )
    expected = _state.get("expected_seconds")

    remaining = None
    if phase != "ready" and expected:
        remaining = max(expected - elapsed, 0.0)

    return {
        # Can the site answer at all? Once it can, it stays usable even while
        # a new cycle downloads in the background.
        "ready": serving or phase == "ready",
        # Is something running? The viewer shows this as a quiet banner
        # rather than a blocking screen.
        "busy": phase not in ("ready",),
        "phase": phase,
        "detail": _state.get("detail", ""),
        "elapsed_seconds": round(elapsed, 1),
        "expected_seconds": round(expected, 1) if expected else None,
        "remaining_seconds": round(remaining, 1) if remaining is not None else None,
        "steps_done": _state.get("steps_done", 0),
        "steps_total": _state.get("steps_total", 0),
        "note": (
            "Products are rebuilt after every run and at startup. The site "
            "serves nothing stale meanwhile; it simply is not ready yet."
        ),
    }


async def run_ingest(reason: str = "scheduled") -> dict:
    """Ingest the latest cycle of every provisioned model."""
    from ..pipeline.ingest import ingest_run
    from ..registry import MODELS

    started = datetime.now(timezone.utc)
    results: dict[str, str] = {}

    _state.update({
        "phase": "ingesting", "detail": "fetching the latest model cycle",
        "started_at": started, "steps_done": 0, "steps_total": 0,
        "expected_seconds": None,      # a real ingest has no useful estimate
    })
    for model in MODELS.values():
        if not model.is_provisioned:
            continue
        _state["detail"] = f"fetching {model.display_name}"
        try:
            report = await ingest_run(model.id, concurrency=3)
            results[model.id] = report.summary()
            log.info("scheduled ingest: %s", report.summary())
        except Exception as exc:                      # keep going
            results[model.id] = f"failed: {exc}"
            log.exception("scheduled ingest failed for %s", model.id)

    # NOT clear_all(). Every cache key is scoped to the run it was computed
    # from (see RunCache.get_or_compute), so a new cycle cannot collide with
    # the old one's entries and clearing is unnecessary for correctness.
    #
    # It is also actively harmful. The old run's products are exactly what
    # the site serves while the new cycle downloads and rebuilds, and
    # throwing them away left every request recomputing from scratch --
    # measured at ten minutes of "Loading..." on a full cycle. The LRU cap
    # retires the stale entries on its own.
    #
    # Rebuild the new cycle's products instead, so the first visitor after a
    # run reads rather than computes.
    warm_products()

    # AFTER the live products are rebuilt. The Stage 10 orchestrator runs in
    # shadow (see PRODUCTION_MODE): it archives a forecast and hands it to
    # Stage 9 verification without touching what the site serves, and it
    # cannot delay or break the ingest above.
    production = run_production_cycle(reason)

    # Section 70. Observations for earlier cycles have arrived by now, so
    # this is where the loop closes: archive -> matching -> verification.
    verify_archived_forecasts(reason)

    finished = datetime.now(timezone.utc)
    _last_run.update({
        "reason": reason,
        "started": started.isoformat(),
        "finished": finished.isoformat(),
        "seconds": str(round((finished - started).total_seconds(), 1)),
        "production": production.get("status", "not run"),
        **results,
    })
    return _last_run


#: Whether the Stage 10 orchestrator replaces the live forecast, or runs
#: beside it.
#:
#: SHADOW. Sections 66 and 67 of the Stage 10 order require a new
#: forecasting version to run on the same inputs, archive its outputs and be
#: verified, WITHOUT replacing what users see, until it has been compared
#: against the incumbent. Two further reasons make shadow the only honest
#: setting today:
#:
#:   * nothing the new pipeline produces is publishable. No calibrator has
#:     been fitted, so every probability is UNCALIBRATED and Stage 7 marks
#:     it unpublishable. Serving it would be publishing a number that has
#:     never been checked against an observation.
#:   * the chain is evaluated at 20 points, not on the 2 km grid. The live
#:     products are gridded, and swapping in a point forecast would quietly
#:     reduce what the site covers.
#:
#: Shadow running is NOT idle. It fills the Stage 9 forecast archive with
#: real operational forecasts recorded BEFORE their outcomes are known,
#: which is the one thing that cannot be created retrospectively and the
#: precondition for ever fitting a calibrator.
PRODUCTION_MODE = "shadow"

#: Last orchestrated cycle, for `status()`.
_last_production: dict = {}

#: Last verification of archived forecasts.
_last_verification: dict = {}


def _cycle_to_forecast() -> "datetime | None":
    """The most recent cycle whose critical model is actually stored.

    NOT the nominal clock cycle. The scheduler ingests whatever the provider
    has published, which lags the cycle time by an hour or more, so asking
    for "the latest cycle" gets one that has not arrived and the
    orchestrator correctly refuses it.

    Forecasting the newest STORED cycle is a different thing from using
    stale data. The manifest, the products and every archived record carry
    that cycle's own timestamp, so a 00Z forecast is published as the 00Z
    forecast. What section 9 forbids -- and what the orchestrator refused
    when this function did not exist -- is forecasting 12Z using 00Z data.
    """
    from ..pipeline.ingest import stored_runs
    from ..production import readiness

    critical = readiness.Rules().critical_models
    if not critical:
        return None
    try:
        runs = stored_runs(critical[0])
    except Exception:                              # noqa: BLE001
        log.exception("could not list stored runs for %s", critical[0])
        return None
    return max(runs) if runs else None


def run_production_cycle(reason: str = "after ingest") -> dict:
    """Run the Stage 10 orchestrator on the cycle just ingested.

    Runs AFTER `warm_products` on purpose: the live site's products are
    rebuilt first, so a slow or failing orchestrator cannot delay what
    users see.

    Never raises. A production-layer failure must not take down the ingest
    that feeds the live site, so everything is caught and recorded.
    """
    global _last_production

    started = datetime.now(timezone.utc)
    try:
        from ..production import orchestrator, readiness

        cycle = _cycle_to_forecast()
        if cycle is None:
            _last_production = {
                "reason": reason,
                "mode": PRODUCTION_MODE,
                "status": "skipped",
                "detail": (
                    "no cycle of the critical model is stored, so there is "
                    "nothing to forecast. This is an absence of data, not a "
                    "forecast of no thunderstorms"
                ),
                "started": started.isoformat(),
            }
            log.warning("production cycle skipped: no UKV data stored")
            return _last_production

        result = orchestrator.run_cycle(cycle)
        manifest = result.manifest

        # In shadow the cycle is archived and handed to verification, but
        # never marked PUBLISHED: nothing here reaches the live site.
        if PRODUCTION_MODE == "shadow":
            from ..production import manifest as manifest_module

            if manifest.status is manifest_module.CycleStatus.PUBLISHED:
                manifest.status = manifest_module.CycleStatus.READY
                manifest.notes.append(
                    "SHADOW: this cycle passed the publication gate and was "
                    "archived, but is not served. The live site continues to "
                    "serve its existing products"
                )
                manifest_module.save(manifest)

        _last_production = {
            "reason": reason,
            "mode": PRODUCTION_MODE,
            "forecast_id": manifest.forecast_id,
            "cycle": manifest.cycle.isoformat(),
            "status": manifest.status.value,
            "degraded": manifest.degraded,
            "stopped_at": result.stopped_at,
            "seconds": round(
                (datetime.now(timezone.utc) - started).total_seconds(), 1
            ),
            "started": started.isoformat(),
        }
        log.info(
            "production cycle (%s): %s %s in %ss",
            PRODUCTION_MODE, manifest.forecast_id, manifest.status.value,
            _last_production["seconds"],
        )
    except Exception as exc:                      # noqa: BLE001
        # A failed orchestration is recorded and does not propagate: the
        # ingest and the live products have already succeeded by this point
        # and must not be undone by the shadow pipeline.
        _last_production = {
            "reason": reason,
            "mode": PRODUCTION_MODE,
            "status": "failed",
            "error": repr(exc),
            "seconds": round(
                (datetime.now(timezone.utc) - started).total_seconds(), 1
            ),
            "started": started.isoformat(),
            "note": (
                "the production layer failed; the ingest and the live "
                "products were unaffected"
            ),
        }
        log.exception("production cycle failed")
    return _last_production



def verify_archived_forecasts(reason: str = "scheduled") -> dict:
    """Verify archived forecasts whose observations have now arrived.

    Section 70 of the Stage 10 order: the forecast archive feeds observation
    matching, verification and the skill database WITHOUT waiting for a
    manual export. The handoff at forecast time registers the forecast; this
    is the other half, and it runs on a schedule because the observations
    arrive hours after the forecast does.

    Only forecasts whose valid hour has PASSED and whose hour was observed
    well enough to judge are scored. A forecast for a future hour is not a
    miss, and an unobserved hour is not a quiet one.

    Never raises: verification is downstream of everything and must not
    disturb the ingest or the live site.
    """
    global _last_verification

    started = datetime.now(timezone.utc)
    try:
        from ..verify import points

        pairs, collection = points.collect()
        result = points.verify(pairs, source="tcm/production")
        readiness_to_calibrate = points.calibration_readiness(pairs)

        _last_verification = {
            "reason": reason,
            "started": started.isoformat(),
            "seconds": round(
                (datetime.now(timezone.utc) - started).total_seconds(), 1
            ),
            "collection": collection,
            "verified_pairs": len(pairs),
            "scores": (
                {k: v["value"] for k, v in result["scores"].items()}
                if result.get("available") else None
            ),
            "reason_unavailable": (
                None if result.get("available") else result.get("reason")
            ),
            "calibration_ready": readiness_to_calibrate["ready"],
            "calibration_needs": readiness_to_calibrate["needs"],
        }
        if readiness_to_calibrate["ready"]:
            # Worth saying loudly: this is the condition that has blocked
            # publishable probabilities since Stage 7.
            log.warning(
                "CALIBRATION IS NOW POSSIBLE: %d verified pair(s) across %d "
                "episode(s). Fitting one would make probabilities "
                "publishable for the first time",
                len(pairs), readiness_to_calibrate["episodes"],
            )
        else:
            log.info(
                "verification: %d pair(s); calibration still blocked (%s)",
                len(pairs),
                "; ".join(readiness_to_calibrate["needs"])[:120],
            )
    except Exception as exc:                      # noqa: BLE001
        _last_verification = {
            "reason": reason,
            "status": "failed",
            "error": repr(exc),
            "started": started.isoformat(),
        }
        log.exception("archived-forecast verification failed")
    return _last_verification


def warm_products(reason: str = "after ingest") -> dict:
    """Precompute the products a page load needs, so it only reads.

    Deliberately narrow: the day summaries and the whole-day rasters, which
    are what the site requests before it can draw anything. Per-hour images
    stay lazy -- there are hundreds of them across every layer and lead time,
    and the animation prefetches the ones it actually needs.
    """
    from ..forecast import service

    # A warm follows an ingest, so any memoised "latest run" was resolved
    # before the fields that were just written. Clear it, or the rebuild
    # summarises the previous cycle.
    service.clear_run_cache()

    started = datetime.now(timezone.utc)
    days = 0
    rasters = 0
    _state.update({
        "phase": "warming", "detail": "rebuilding the land mask",
        "started_at": started, "steps_done": 0, "steps_total": 0,
        "expected_seconds": _remembered_seconds(),
    })

    # Fold the new cycle into the land mask FIRST: the region names and every
    # headline statistic are computed over it, and it only ever improves with
    # more cycles.
    try:
        from ..forecast import landmask
        from ..forecast.regions import forecast_area, region_masks

        landmask.refresh()
        landmask._reset_cache()
        region_masks.cache_clear()
        forecast_area.cache_clear()
    except Exception:
        log.exception("refreshing the land mask failed")

    try:
        _state["detail"] = "summarising the forecast days"
        summaries = service.daily_risk()
        days = len(summaries)
        _state["steps_total"] = days
        for day in summaries:
            _state["detail"] = f"drawing {day.get('label', day['date'])}"
            try:
                # Warm the IMAGE, not just the array: the page requests the
                # PNG, and rendering it is the expensive half.
                _warm_day_png(day["date"])
                rasters += 1
                _state["steps_done"] = rasters
            except (LookupError, ValueError) as exc:
                log.info("no whole-day field for %s: %s", day["date"], exc)
    except Exception:
        log.exception("warming forecast products failed")

    # The page also asks for the layer list and the outlook before it can
    # draw anything, and both walk every lead time. Warmed here so the first
    # visitor after a run reads rather than computes.
    for label, build in (
        ("layer list", lambda: __import__(
            "app.api.routes.render", fromlist=["x"])._hazard_layer_entries()),
        ("outlook", service.generate_outlook),
    ):
        try:
            _state["detail"] = f"building the {label}"
            build()
        except Exception:
            log.info("could not warm the %s", label, exc_info=True)

    seconds = (datetime.now(timezone.utc) - started).total_seconds()
    _remember_seconds(seconds)
    _state.update({
        "phase": "ready", "detail": "ready", "can_serve": True,
        "steps_done": rasters, "steps_total": max(days, rasters),
    })
    log.info(
        "warmed %d day summaries and %d whole-day fields in %.1fs (%s)",
        days, rasters, seconds, reason,
    )
    return {"days": days, "rasters": rasters, "seconds": round(seconds, 1)}


async def catch_up() -> dict:
    """Ingest the newest published cycle if it is not already on disk.

    The scheduled runs fire at 03:00 and 15:00, which only helps if the
    machine is awake then. APScheduler's misfire grace covers an hour; past
    that a missed run is simply gone, and the site would keep serving a stale
    cycle indefinitely with no indication that a newer one exists.

    So on every startup the newest cycle the provider offers is compared with
    the newest on disk, and a missing one is fetched. This is what makes an
    overnight shutdown self-healing rather than a permanent gap.
    """
    from ..pipeline.ingest import stored_runs
    from ..providers import base as providers
    from ..registry import MODELS

    behind = []
    for model in MODELS.values():
        if not model.is_provisioned:
            continue
        # Only close gaps in models already being maintained. A model with no
        # stored run was never in the pipeline, so there is no gap to close --
        # and bootstrapping one here would quietly start downloading a whole
        # new source, which for the metered Open-Meteo models means burning a
        # daily quota nobody asked to spend.
        if not stored_runs(model.id):
            log.debug("catch-up: skipping %s, never ingested", model.id)
            continue
        try:
            adapter = providers.get(model.provider)
            latest = await adapter.latest_run(model)
        except Exception as exc:
            log.info("catch-up: cannot ask %s for its latest run: %s",
                     model.id, exc)
            continue
        stored = stored_runs(model.id)
        if latest and stored and latest > stored[-1]:
            behind.append((model.id, latest, stored[-1]))

    if not behind:
        log.info("catch-up: every provisioned model is on its latest cycle")
        return {"caught_up": False, "reason": "already current"}

    for model_id, latest, have in behind:
        log.info(
            "catch-up: %s has %s, latest is %s -- ingesting",
            model_id, f"{have:%Y-%m-%d %HZ}", f"{latest:%Y-%m-%d %HZ}",
        )
    return await run_ingest(reason="catch-up after downtime")


def _warm_day_png(day: str) -> None:
    """Build and cache the whole-day raster exactly as the route does."""
    from ..api.routes.risk import render_day

    render_day(day)


def poll_observations() -> None:
    """Sample the live strike buffer into the archive."""
    from ..verification.observations import get_provider

    provider = get_provider()
    if hasattr(provider, "poll"):
        try:
            provider.poll()
        except Exception:                              # never kill the loop
            log.debug("observation poll failed", exc_info=True)


def start() -> None:
    """Install the schedule. Safe to call once at startup."""
    global _scheduler

    if _scheduler is not None:
        return
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    _scheduler = AsyncIOScheduler()
    for hour in INGEST_HOURS:
        _scheduler.add_job(
            run_ingest, CronTrigger(hour=hour, minute=0),
            id=f"ingest-{hour:02d}", replace_existing=True,
            kwargs={"reason": f"scheduled {hour:02d}:00"},
            misfire_grace_time=3600,
        )
    _scheduler.add_job(
        poll_observations,
        IntervalTrigger(seconds=OBSERVATION_POLL_SECONDS),
        id="observations", replace_existing=True,
        max_instances=1, misfire_grace_time=60,
    )
    _scheduler.start()
    # A restart also empties the caches, so warm once on the way up. In a
    # background thread: a 38 s blocking startup would look like a hang, and
    # the server can serve everything else meanwhile.
    threading.Thread(
        target=_startup_work, name="tcm-startup", daemon=True,
    ).start()
    log.info(
        "scheduler started: ingest at %s local, observations every %ds",
        ", ".join(f"{h:02d}:00" for h in INGEST_HOURS),
        OBSERVATION_POLL_SECONDS,
    )


def _startup_work() -> None:
    """Everything that must happen after a restart, in order.

    Observations FIRST and immediately: the strike feed is the only source
    here that cannot be recovered later, and a single poll backfills the
    whole buffer the worker is holding (measured at 5.8 hours).
    """
    try:
        poll_observations()
    except Exception:
        log.exception("startup observation backfill failed")

    warm_products("at startup")

    # Then close any gap left by the machine being off. Done last because it
    # can download for several minutes, and the site should be usable first.
    try:
        asyncio.run(catch_up())
    except Exception:
        log.exception("catch-up after downtime failed")


def shutdown() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def status() -> dict:
    jobs = []
    if _scheduler is not None:
        for job in _scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "next_run": (
                    job.next_run_time.isoformat() if job.next_run_time else None
                ),
            })
    return {
        "running": _scheduler is not None,
        "ingest_hours_local": list(INGEST_HOURS),
        "observation_poll_seconds": OBSERVATION_POLL_SECONDS,
        "jobs": jobs,
        "last_ingest": _last_run or None,
        "production_mode": PRODUCTION_MODE,
        "last_production_cycle": _last_production or None,
        "last_verification": _last_verification or None,
        "note": (
            "Ingest runs on a schedule only. Page loads read what is "
            "already on disk and never trigger a fetch. The Stage 10 "
            "orchestrator runs in SHADOW after each ingest: it archives a "
            "forecast and hands it to verification without changing what "
            "the site serves."
        ),
    }
