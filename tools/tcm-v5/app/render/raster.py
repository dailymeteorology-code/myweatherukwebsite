"""Field rendering: TCM grid -> georeferenced PNG.

The analysis grid is Lambert azimuthal equal area, which no web map speaks,
so a field is resampled onto a regular lon/lat mesh and returned with its
bounds. Any client -- Leaflet, a GIS, or the bundled viewer -- can then place
it correctly.

One rendering rule matters as much as any of the forecast rules:

    **A coarse field must not be rendered to look sharp.**

Bilinear resampling of a 56 km field onto a fine image produces smooth,
detailed-looking gradients that imply structure the model never resolved.
Rendering therefore picks its resampling from the field's OWN effective
resolution: fields at or near the analysis resolution are interpolated
smoothly, and coarse fields are drawn with nearest-neighbour so their real
cell size stays visible. The effective resolution travels with the image in
the response headers either way.
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass

import numpy as np

from ..crs import WGS84
from ..grid import Field, regrid
from ..meta import GridSpec
from ..registry import UK_IRELAND

log = logging.getLogger(__name__)

#: Output mesh for rendering, in degrees. About 1 km in latitude, which
#: resolves the 2 km analysis grid without inventing detail.
RENDER_SPACING_DEG = 0.01

#: A field coarser than this is drawn with nearest-neighbour so its true cell
#: size remains visible rather than being smoothed into false detail.
SMOOTH_RENDER_LIMIT_M = 4000.0


@dataclass(frozen=True, slots=True)
class ColourStop:
    value: float
    rgba: tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class Scale:
    """A named colour scale, defined by stops and interpolated between them."""

    name: str
    stops: tuple[ColourStop, ...]
    units: str
    description: str
    #: Values at or below this are fully transparent.
    transparent_below: float | None = None

    def apply(self, values: np.ndarray) -> np.ndarray:
        """Map values to an RGBA image."""
        stops = sorted(self.stops, key=lambda s: s.value)
        positions = np.array([s.value for s in stops], dtype="float64")
        colours = np.array([s.rgba for s in stops], dtype="float64")

        flat = values.astype("float64").ravel()
        out = np.zeros((flat.size, 4), dtype="float64")
        for channel in range(4):
            out[:, channel] = np.interp(
                flat, positions, colours[:, channel]
            )

        rgba = out.reshape(*values.shape, 4)
        # NaN is "no data", never a colour.
        rgba[~np.isfinite(values)] = 0
        if self.transparent_below is not None:
            rgba[np.isfinite(values) & (values <= self.transparent_below), 3] = 0
        return rgba.astype("uint8")


def _stops(*pairs) -> tuple[ColourStop, ...]:
    return tuple(ColourStop(v, c) for v, c in pairs)


SCALES: dict[str, Scale] = {
    "risk": Scale(
        name="risk",
        units="index 0-100",
        description="TCM thunderstorm risk index",
        transparent_below=5.0,
        stops=_stops(
            (0, (255, 255, 255, 0)),
            (5, (120, 190, 120, 90)),
            (20, (245, 220, 90, 170)),
            (40, (240, 150, 50, 200)),
            (65, (220, 60, 40, 225)),
            (100, (150, 20, 90, 240)),
        ),
    ),
    "probability": Scale(
        name="probability",
        units="fraction 0-1",
        description="Ensemble probability",
        transparent_below=0.0,
        stops=_stops(
            (0.0, (255, 255, 255, 0)),
            (0.2, (180, 210, 240, 140)),
            (0.4, (110, 165, 225, 180)),
            (0.6, (60, 115, 200, 205)),
            (0.8, (35, 70, 165, 225)),
            (1.0, (20, 35, 120, 240)),
        ),
    ),
    "precip_rate": Scale(
        name="precip_rate",
        units="mm/h",
        description="Rainfall rate",
        transparent_below=0.2,
        # Convective thresholds, not synoptic ones: 2 mm/h is a shower, 20 is
        # a downpour, 50+ is the sort of rate that floods a road in minutes.
        stops=_stops(
            (0.0, (255, 255, 255, 0)),
            (0.5, (170, 215, 240, 120)),
            (2.0, (90, 170, 220, 175)),
            (5.0, (70, 190, 120, 200)),
            (10.0, (240, 215, 70, 220)),
            (20.0, (240, 140, 45, 235)),
            (50.0, (215, 45, 35, 250)),
        ),
    ),
    "strike_count": Scale(
        name="strike_count",
        units="strikes per 2 km cell",
        description="Observed lightning strikes (Blitzortung)",
        # Strictly above zero: a cell with no detected strike must stay clear,
        # so an observed layer never paints an area it has no strike for.
        transparent_below=0.5,
        # Deliberately unlike every forecast scale. Observed lightning is a
        # different kind of statement from a predicted field and must not be
        # mistakable for one at a glance.
        stops=_stops(
            (0, (255, 255, 255, 0)),
            (1, (255, 245, 170, 200)),
            (3, (255, 205, 70, 225)),
            (8, (255, 140, 30, 240)),
            (20, (235, 60, 40, 250)),
            (50, (170, 20, 60, 255)),
        ),
    ),
    "cape": Scale(
        name="cape",
        units="J/kg",
        description="Convective available potential energy",
        transparent_below=50.0,
        stops=_stops(
            (0, (255, 255, 255, 0)),
            (100, (200, 230, 200, 110)),
            (400, (250, 235, 120, 175)),
            (800, (245, 160, 60, 205)),
            (1500, (225, 70, 45, 230)),
            (3000, (140, 20, 80, 240)),
        ),
    ),
    "rainfall": Scale(
        name="rainfall",
        units="mm",
        description="Accumulated rainfall",
        transparent_below=0.2,
        stops=_stops(
            (0, (255, 255, 255, 0)),
            (1, (190, 225, 200, 140)),
            (5, (100, 190, 150, 190)),
            (10, (70, 140, 210, 210)),
            (25, (80, 70, 190, 230)),
            (50, (140, 40, 150, 240)),
            (100, (90, 15, 70, 245)),
        ),
    ),
    "flash_density": Scale(
        name="flash_density",
        units="flashes/km2/h (scaling unconfirmed)",
        description="Forecast lightning flash density",
        transparent_below=0.0,
        stops=_stops(
            (0.0, (255, 255, 255, 0)),
            (0.2, (255, 240, 150, 160)),
            (0.5, (255, 190, 60, 200)),
            (0.8, (250, 110, 40, 225)),
            (1.0, (215, 40, 30, 240)),
        ),
    ),
}


def get_scale(name: str) -> Scale:
    try:
        return SCALES[name]
    except KeyError:
        raise KeyError(
            f"unknown colour scale {name!r}; known: {sorted(SCALES)}"
        ) from None


def render_grid(spacing_deg: float = RENDER_SPACING_DEG) -> GridSpec:
    """The lon/lat mesh images are produced on."""
    nx = int(round((UK_IRELAND.lon_max - UK_IRELAND.lon_min) / spacing_deg))
    ny = int(round((UK_IRELAND.lat_max - UK_IRELAND.lat_min) / spacing_deg))
    return GridSpec(
        name=f"render_{spacing_deg:g}deg",
        projection=WGS84,
        nx=nx, ny=ny,
        spacing_m=spacing_deg * 111_320.0,
        x0=UK_IRELAND.lon_min, y0=UK_IRELAND.lat_min,
        crs_units="degrees", spacing_deg=spacing_deg,
    )


def resampling_for(effective_resolution_m: float) -> str:
    """Nearest for coarse fields, bilinear for analysis-resolution ones."""
    return (
        "bilinear" if effective_resolution_m <= SMOOTH_RENDER_LIMIT_M
        else "nearest"
    )


@dataclass(slots=True)
class RenderedImage:
    png: bytes
    bounds: tuple[float, float, float, float]   # west, south, east, north
    width: int
    height: int
    scale: Scale
    effective_resolution_m: float
    resampling: str
    value_min: float | None
    value_max: float | None

    def headers(self) -> dict[str, str]:
        return {
            "X-TCM-Effective-Resolution-M": str(self.effective_resolution_m),
            "X-TCM-Resampling": self.resampling,
            "X-TCM-Bounds": ",".join(f"{b:.4f}" for b in self.bounds),
            "X-TCM-Scale": self.scale.name,
        }


def render(
    field: Field,
    scale_name: str,
    spacing_deg: float = RENDER_SPACING_DEG,
    vmin: float | None = None,
    vmax: float | None = None,
) -> RenderedImage:
    """Render a field to a georeferenced PNG.

    `vmin`/`vmax` rescale the data onto the scale's own 0..1 or 0..100 range
    where the physical units do not match it -- flash density, whose absolute
    scaling is unconfirmed, is rendered by relative magnitude only.
    """
    from PIL import Image

    scale = get_scale(scale_name)
    target = render_grid(spacing_deg)
    effective = field.meta.effective_resolution_m
    method = resampling_for(effective)

    moved = regrid(field, target, method)
    values = moved.values

    finite = values[np.isfinite(values)]
    observed_min = float(finite.min()) if finite.size else None
    observed_max = float(finite.max()) if finite.size else None

    if vmin is not None or vmax is not None:
        low = vmin if vmin is not None else (observed_min or 0.0)
        high = vmax if vmax is not None else (observed_max or 1.0)
        if high > low:
            top = max(s.value for s in scale.stops)
            values = (values - low) / (high - low) * top

    rgba = scale.apply(values)
    # Image rows run north to south; the grid runs south to north.
    image = Image.fromarray(np.flipud(rgba), mode="RGBA")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)

    return RenderedImage(
        png=buffer.getvalue(),
        bounds=(
            UK_IRELAND.lon_min, UK_IRELAND.lat_min,
            UK_IRELAND.lon_max, UK_IRELAND.lat_max,
        ),
        width=target.nx,
        height=target.ny,
        scale=scale,
        effective_resolution_m=effective,
        resampling=method,
        value_min=observed_min,
        value_max=observed_max,
    )


def render_array(
    values: np.ndarray,
    meta,
    scale_name: str,
    **kwargs,
) -> RenderedImage:
    """Render a bare array that carries a field's metadata."""
    return render(Field(values, meta), scale_name, **kwargs)
