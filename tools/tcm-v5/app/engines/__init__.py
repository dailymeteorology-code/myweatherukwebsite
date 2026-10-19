"""Stage 5: independent specialist convective forecasting engines.

Importing this package registers every engine. The import order below is
NOT the execution order -- `base.topological_order()` derives that from each
engine's declared dependencies, so adding an engine or changing what it
consumes cannot silently produce a wrong ordering here.
"""
from . import result, transfer, features, base            # noqa: F401
from . import regime, thermodynamic, entrainment          # noqa: F401
from . import initiation, updraft, organisation           # noqa: F401
from . import hazards                                     # noqa: F401
from . import pipeline                                    # noqa: F401

from .base import REGISTRY, EngineContext, run_all, topological_order
from .pipeline import (
    SpecialistForecast, engine_catalogue, run_for_parameters,
    run_for_profile, run_members,
)
from .result import EngineResult, EngineSet, EngineStatus, ScoreKind

__all__ = [
    "REGISTRY", "EngineContext", "EngineResult", "EngineSet", "EngineStatus",
    "ScoreKind", "SpecialistForecast", "engine_catalogue",
    "run_for_parameters", "run_for_profile", "run_members", "run_all",
    "topological_order",
]
