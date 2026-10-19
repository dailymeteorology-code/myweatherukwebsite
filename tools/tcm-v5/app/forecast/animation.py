"""Forecast animation.

An animation is a list of frames, each a lead time plus the layer images that
make it up. The server does not encode a video: it plans the sequence and
renders the frames, and the client swaps images. That keeps every frame a
live, individually addressable product -- the same PNG the map serves -- so
an animation can never drift out of step with the map beneath it, and no
ffmpeg dependency is introduced into a platform that otherwise runs on a
Python process and a data directory.

Two things the planner refuses to do:

  * **Never mix lead times within a frame.** Every layer in a frame is drawn
    for the same valid time. A composite that quietly fell back to a
    neighbouring hour for a missing layer would animate lightning from 15Z
    over risk from 18Z.

  * **Never silently skip a gap.** Lead times that cannot be drawn are
    reported in `missing`, so a sequence that jumps from 12Z to 21Z says so
    rather than appearing to be a smooth run.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum

log = logging.getLogger(__name__)

#: Default milliseconds per frame.
DEFAULT_FRAME_MS = 450


class AnimationMode(str, Enum):
    """The named animations from the specification."""

    RISK = "risk"
    PRECIPITATION = "precipitation"
    LIGHTNING = "lightning"
    ROLLING_24H = "rolling_24h"
    COMPOSITE = "composite"

    @property
    def layers(self) -> tuple[str, ...]:
        return {
            AnimationMode.RISK: ("risk",),
            AnimationMode.PRECIPITATION: ("precipitation",),
            AnimationMode.LIGHTNING: ("tcm_lightning", "ukv_lightning"),
            AnimationMode.ROLLING_24H: ("rolling_24h",),
            AnimationMode.COMPOSITE: (
                "risk", "precipitation", "tcm_lightning", "ukv_lightning",
            ),
        }[self]

    @property
    def required(self) -> tuple[str, ...]:
        """Layers without which a frame is meaningless.

        Everything else the mode names is drawn when present and skipped when
        not. Requiring ALL of them made the composite only as long as its
        rarest layer -- 44 frames of a possible 80, because MOGREPS-UK
        lightning exists only at even hours beyond T+24 -- and dropping the
        frame did nothing to protect valid times, since every layer in a
        frame is the same lead time anyway.

        An empty tuple means "at least one of the mode's layers".
        """
        return {
            AnimationMode.RISK: ("risk",),
            AnimationMode.PRECIPITATION: ("precipitation",),
            AnimationMode.LIGHTNING: (),          # either product will do
            AnimationMode.ROLLING_24H: ("rolling_24h",),
            AnimationMode.COMPOSITE: ("risk",),   # the rest are a bonus
        }[self]

    @property
    def label(self) -> str:
        return {
            AnimationMode.RISK: "TCM risk",
            AnimationMode.PRECIPITATION: "Precipitation",
            AnimationMode.LIGHTNING: "Lightning",
            AnimationMode.ROLLING_24H: "Rolling 24 h rainfall",
            AnimationMode.COMPOSITE: "Composite",
        }[self]


@dataclass(slots=True)
class Frame:
    forecast_hour: int
    valid_time: datetime
    label: str
    level: str
    area_percent: float
    #: layer id -> image URL. Every entry is for THIS valid time.
    images: dict[str, str] = dc_field(default_factory=dict)
    #: Optional layers the mode wanted that this lead time does not have.
    #: Carried per frame so a composite can say which of its parts are
    #: present, instead of the reader assuming all of them always are.
    layers_absent: list[str] = dc_field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "forecast_hour": self.forecast_hour,
            "valid_time": self.valid_time.isoformat(),
            "label": self.label,
            "level": self.level,
            "area_percent": self.area_percent,
            "images": self.images,
            "layers_present": sorted(self.images),
            "layers_absent": self.layers_absent,
        }


@dataclass(slots=True)
class Animation:
    mode: AnimationMode
    frames: list[Frame]
    missing: list[dict]
    frame_ms: int = DEFAULT_FRAME_MS
    day: str | None = None

    @property
    def is_continuous(self) -> bool:
        """True when no lead time inside the span had to be dropped."""
        return not self.missing

    def to_dict(self) -> dict:
        return {
            "mode": self.mode.value,
            "label": self.mode.label,
            "layers": list(self.mode.layers),
            "day": self.day,
            "frame_ms": self.frame_ms,
            "frame_count": len(self.frames),
            "frames": [f.to_dict() for f in self.frames],
            "missing": self.missing,
            "is_continuous": self.is_continuous,
            "note": (
                "Every layer in a frame is drawn for the same valid time. "
                "Lead times that could not be drawn are listed in `missing` "
                "rather than skipped silently."
            ),
        }


#: Layer id -> URL template. Mirrors /api/layers.
LAYER_URLS: dict[str, str] = {
    "risk": "/api/render/risk/{hour}.png",
    "tcm_lightning": "/api/render/lightning/{hour}/tcm.png",
    "ukv_lightning": "/api/render/lightning/{hour}/ukv.png",
    # scale=precip_rate, NOT rainfall: the field is a RATE in kg m-2 s-1 and
    # the rainfall scale is an accumulation in mm whose first stop is 1 mm, so
    # every cell fell off the bottom of it and the animation drew a blank map.
    "precipitation": (
        "/api/render/field/{hour}/precip_rate_max_1h.png?scale=precip_rate"
    ),
    "rolling_24h": "/api/render/rolling24/{hour}.png",
}


def plan(
    mode: AnimationMode,
    hours: list[int],
    risks_by_hour: dict[int, object],
    available_layers: dict[int, set[str]],
    day: str | None = None,
    frame_ms: int = DEFAULT_FRAME_MS,
) -> Animation:
    """Build the frame list for an animation.

    `available_layers` says which layers can actually be drawn at each lead
    time. A frame is only emitted when EVERY layer the mode asks for is
    available, so a composite never mixes valid times; lead times that fall
    short are reported instead.
    """
    frames: list[Frame] = []
    missing: list[dict] = []

    for hour in sorted(hours):
        risk = risks_by_hour.get(hour)
        if risk is None:
            missing.append({
                "forecast_hour": hour, "reason": "no risk diagnostics"
            })
            continue

        have = available_layers.get(hour, set())
        wanted = set(mode.layers)
        absent = sorted(wanted - have)
        required = set(mode.required)

        if required:
            short = sorted(required - have)
        else:
            # "at least one" -- the mode is meaningless only when none of its
            # layers can be drawn.
            short = sorted(wanted) if not (wanted & have) else []

        if short:
            missing.append({
                "forecast_hour": hour,
                "reason": "required layers unavailable: " + ", ".join(short),
            })
            continue

        frames.append(Frame(
            forecast_hour=hour,
            valid_time=risk.valid_time,
            label=risk.valid_time.strftime("%a %d %b %H%MZ"),
            level=risk.level.value,
            area_percent=round(risk.area_fraction * 100, 1),
            images={
                layer: LAYER_URLS[layer].format(hour=hour)
                for layer in mode.layers
                if layer in LAYER_URLS and layer in have
            },
            layers_absent=absent,
        ))

    return Animation(
        mode=mode, frames=frames, missing=missing,
        frame_ms=frame_ms, day=day,
    )
