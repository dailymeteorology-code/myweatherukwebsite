"""Derived convective diagnostics.

Some of the most important quantities for thunderstorm forecasting are not
served by any provider: deep-layer shear and mid-level lapse rate have to be
computed from fields that are. This module does that, and applies one rule
that is easy to get wrong:

**A derived field is only as good as its coarsest input.** Bulk shear built
from UKV's 10 m wind at 2 km and ICON-EU's 500 hPa wind at 56 km is a 56 km
field. It is not 2 km data because half of it came from a 2 km model, and
presenting it as such would be exactly the misrepresentation the platform
forbids. `derive()` therefore sets `native_resolution_m` to the coarsest
contributing input and records every source in `extra.derived_from`.

Inputs may come from different models. That is deliberate -- it is the whole
point of a multi-model platform that the best available source for each
ingredient is used -- but it means a derived field can mix resolutions, and
the mixing is recorded rather than smoothed over.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import numpy as np

from ..grid import Field
from ..meta import FieldMeta, MemberKind
from ..params import get as get_param
from ..training.regime import bulk_shear, lapse_rate_850_500

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class DerivedSpec:
    """How to compute one derived parameter."""

    name: str
    inputs: tuple[str, ...]
    compute: Callable[..., np.ndarray]
    description: str
    #: Honest note about what the derivation approximates.
    caveat: str = ""


DERIVED: dict[str, DerivedSpec] = {}


def _register(spec: DerivedSpec) -> DerivedSpec:
    DERIVED[spec.name] = spec
    return spec


_register(DerivedSpec(
    name="shear_bulk_0_6km",
    inputs=(
        "wind_speed_10m", "wind_direction_10m",
        "wind_speed_500", "wind_direction_500",
    ),
    compute=bulk_shear,
    description="Vector wind difference between 10 m and 500 hPa",
    caveat=(
        "A PROXY for 0-6 km bulk shear: 500 hPa sits near 5.5 km in these "
        "airmasses. The true quantity needs winds on many levels, which none "
        "of the current feeds provide. Adequate for distinguishing sheared "
        "from unsheared regimes; not a substitute for a real hodograph."
    ),
))

_register(DerivedSpec(
    name="lapse_rate_850_500",
    inputs=("temperature_850", "temperature_500"),
    compute=lapse_rate_850_500,
    description="Mid-level lapse rate between 850 and 500 hPa",
    caveat=(
        "Uses a fixed 4.1 km standard-atmosphere thickness for the 850-500 "
        "hPa layer. The real thickness varies with the temperature of the "
        "layer itself, so this is accurate to a few tenths of a K/km."
    ),
))


def derive(name: str, inputs: dict[str, Field]) -> Field:
    """Compute a derived field from already-loaded inputs.

    Raises rather than guessing when an input is missing: a shear field
    computed from a fabricated 500 hPa wind would be worse than no shear
    field, because the risk engine would treat it as real.
    """
    try:
        spec = DERIVED[name]
    except KeyError:
        raise KeyError(
            f"{name!r} is not a derived parameter; known: {sorted(DERIVED)}"
        ) from None

    missing = [i for i in spec.inputs if i not in inputs or inputs[i] is None]
    if missing:
        raise LookupError(
            f"cannot derive {name}: missing {', '.join(missing)}"
        )

    ordered = [inputs[i] for i in spec.inputs]
    shapes = {f.values.shape for f in ordered}
    if len(shapes) != 1:
        raise ValueError(
            f"cannot derive {name}: inputs have different shapes {shapes}"
        )

    values = spec.compute(*[f.values for f in ordered]).astype("float32")

    # The derived field is only as good as its coarsest input.
    coarsest = max(f.meta.effective_resolution_m for f in ordered)
    reference = ordered[0]
    sources = {
        parameter: {
            "model": inputs[parameter].meta.model,
            "resolution_m": inputs[parameter].meta.effective_resolution_m,
        }
        for parameter in spec.inputs
    }
    models = sorted({f.meta.model for f in ordered})

    from dataclasses import replace

    meta = replace(
        reference.meta,
        provider="tcm_derived",
        model="+".join(models),
        parameter=name,
        units=get_param(name).units,
        member_kind=MemberKind.DETERMINISTIC,
        member=None,
        native_resolution_m=coarsest,
        native_grid=f"derived from {', '.join(models)}",
        source_uri="",
        retrieved_at=datetime.now(timezone.utc),
        extra={
            "derived": True,
            "derived_from": sources,
            "contributing_models": models,
            "coarsest_input_m": coarsest,
            "caveat": spec.caveat,
        },
    )
    log.info(
        "derived %s from %s at %.0f m (coarsest input)",
        name, ", ".join(models), coarsest,
    )
    return Field(values, meta)


def derivable_from(available: set[str]) -> list[str]:
    """Which derived parameters the available inputs can support."""
    return [
        name for name, spec in DERIVED.items()
        if all(i in available for i in spec.inputs)
    ]


def requirements(name: str) -> tuple[str, ...]:
    return DERIVED[name].inputs
