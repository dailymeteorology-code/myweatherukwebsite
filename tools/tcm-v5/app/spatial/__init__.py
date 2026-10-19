"""Stage 8: UK-specific spatial, terrain, coastal and mesoscale intelligence.

Stage 8 makes TCM understand that a 2 km cell is not an isolated point. It
produces PHYSICAL QUANTITIES -- metres per second of orographic ascent,
kelvin of land-sea contrast, per-second convergence, metres to the coast --
and feeds them to the engines that already exist. It contains no scoring
machinery of its own, which is what makes section 1's ban on arbitrary
regional multipliers structural rather than a matter of discipline.
"""
from __future__ import annotations

from .feature import (
    Lineage, Provenance, Quality, SpatialFeature, check_forecast_safe,
    combine_lineage, unavailable, worst,
)
from .static import Geography, TerrainSource, load as load_geography

__all__ = [
    "Geography", "Lineage", "Provenance", "Quality", "SpatialFeature",
    "TerrainSource", "check_forecast_safe", "combine_lineage",
    "load_geography", "unavailable", "worst",
]
