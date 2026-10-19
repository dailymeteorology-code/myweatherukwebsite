"""TCM V5 backend entrypoint.

Runs as a plain Python process:

    ukv-platform> .venv\\Scripts\\python.exe -m uvicorn app.main:app --app-dir backend --reload

No container runtime, no database server, no message broker. Model data comes
from the Met Office Weather DataHub over HTTPS using the atmospheric API key,
and everything derived from it lives under `ukv-platform/data`.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import (
    animation, blend, capabilities, catalogue, engines, export, fields,
    ingest, lightning, outlook, parameters, profiles, rainfall, render, risk,
    production, skill, spatial, tcm, verification, verify,
)
from .horizon import horizon_summary
from .config import get_settings
from .providers import base as providers

# Importing an adapter module registers it. Keep these imports: they are the
# only thing that populates the provider registry.
from .providers.metoffice import datahub as _datahub  # noqa: F401

log = logging.getLogger("tcm")


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    _configure_logging(settings.log_level)
    settings.data_root.mkdir(parents=True, exist_ok=True)
    settings.raw_dir.mkdir(parents=True, exist_ok=True)
    settings.field_dir.mkdir(parents=True, exist_ok=True)
    log.info("TCM V5 backend starting; data root %s", settings.data_root)
    log.info("providers registered: %s", ", ".join(sorted(providers.registered())))
    if not settings.metoffice_atmospheric_api_key:
        log.warning("METOFFICE_ATMOSPHERIC_API_KEY is not set -- UKV ingest will fail")

    from .workers import scheduler

    scheduler.start()
    yield
    scheduler.shutdown()
    for adapter in providers.registered().values():
        await adapter.close()
    log.info("TCM V5 backend stopped")


app = FastAPI(
    title="TCM V5",
    version="3.0.0-stage1",
    summary="Adaptive multi-model convective forecasting for the UK and Ireland",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalogue.router, prefix="/api")
app.include_router(capabilities.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(parameters.router, prefix="/api")
app.include_router(engines.router, prefix="/api")
app.include_router(skill.router, prefix="/api")
app.include_router(spatial.router, prefix="/api")
app.include_router(tcm.router, prefix="/api")
app.include_router(verify.router, prefix="/api")
app.include_router(production.router, prefix="/api")
app.include_router(fields.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(blend.router, prefix="/api")
app.include_router(risk.router, prefix="/api")
app.include_router(lightning.router, prefix="/api")
app.include_router(outlook.router, prefix="/api")
app.include_router(render.router, prefix="/api")
app.include_router(animation.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(rainfall.router, prefix="/api")
app.include_router(verification.router, prefix="/api")


# Brand assets and anything else the viewer needs. Mounted rather than
# inlined so a logo can be replaced by dropping in a new file.
_ASSETS = Path(__file__).resolve().parents[2] / "frontend" / "assets"
if _ASSETS.is_dir():
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")


@app.get("/", include_in_schema=False)
def viewer():
    """Serve the bundled map viewer."""
    from fastapi.responses import FileResponse, JSONResponse

    page = Path(__file__).resolve().parents[2] / "frontend" / "index.html"
    if not page.exists():
        return JSONResponse(
            {"detail": "viewer not installed", "api_docs": "/docs"},
            status_code=404,
        )
    return FileResponse(page, media_type="text/html")


@app.get("/graphic", include_in_schema=False)
def graphic_studio():
    """The storm-outlook graphic maker."""
    from fastapi.responses import FileResponse, JSONResponse

    page = Path(__file__).resolve().parents[2] / "frontend" / "graphic.html"
    if not page.exists():
        return JSONResponse({"detail": "graphic studio not installed"}, 404)
    return FileResponse(page, media_type="text/html")


@app.get("/api/graphic/projection", tags=["system"])
def graphic_projection() -> dict:
    """The projection the storm-outlook graphics are drawn on.

    Published so anything placing a point on one of these graphics -- strikes,
    risk areas, labels -- uses the SAME mapping the graphic's own coastline
    was drawn with, instead of assuming this platform's equirectangular
    exports.
    """
    from .render.graphic import Projection

    return Projection().to_dict()


@app.get("/overlay", include_in_schema=False)
def overlay_studio():
    """Compose observed strikes onto your own graphic."""
    from fastapi.responses import FileResponse, JSONResponse

    page = Path(__file__).resolve().parents[2] / "frontend" / "overlay.html"
    if not page.exists():
        return JSONResponse({"detail": "overlay studio not installed"}, 404)
    return FileResponse(page, media_type="text/html")


@app.get("/api/readiness", tags=["system"])
def readiness() -> dict:
    """Whether the site can serve a forecast yet, and how long until it can.

    The viewer polls this so a restart shows a progress screen rather than
    hanging on "Loading…" for the ~100 seconds a rebuild takes.
    """
    from .workers import scheduler

    return scheduler.readiness()


@app.get("/api/horizon", tags=["system"])
def horizon(parameter: str | None = None) -> dict:
    """The 4-day forecast horizon and what covers each lead time."""
    return horizon_summary(parameter)


@app.get("/api/training/status", tags=["system"])
def training_status() -> dict:
    """Whether the adaptive blend is running trained or neutral."""
    from .training.skill import get_store

    return get_store().status()


@app.get("/api/schedule", tags=["system"])
def schedule() -> dict:
    """When the model runs, and when it last ran."""
    from .workers import scheduler

    return scheduler.status()


@app.post("/api/schedule/run-now", tags=["system"])
async def run_now() -> dict:
    """Trigger an ingest by hand. Normally the schedule does this."""
    from .workers import scheduler

    return await scheduler.run_ingest(reason="manual")


@app.get("/health", tags=["system"])
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "version": app.version,
        "data_mode": settings.data_mode,
        "runtime": "native",
        "data_root": str(settings.data_root),
        "providers": sorted(providers.registered()),
        "credentials": {
            # Presence only -- never the values.
            "metoffice_atmospheric": bool(settings.metoffice_atmospheric_api_key),
            "metoffice_order_id": bool(settings.metoffice_order_id),
            "metoffice_nswws": bool(settings.metoffice_nswws_api_key),
            "lightning_provider": settings.lightning_provider,
        },
    }
