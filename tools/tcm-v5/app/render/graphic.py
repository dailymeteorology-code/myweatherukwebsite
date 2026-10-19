"""The projection the MyWeatherUK storm-outlook graphics are drawn on.

Ported from `StormOutlookGraphicTool.jsx`, and kept byte-for-byte identical to
it, because the whole point is that strikes and risk areas produced here land
exactly where that tool's map puts them.

It is **Web Mercator in latitude, linear in longitude**, over a fixed box:

    lon -10.8 .. 2.5      lat 49.5 .. 61.0      302 x 458

Two things follow from that, and both have bitten already:

  * It is NOT equirectangular. The Overlay Studio's default assumption --
    longitude linear in x, latitude linear in y -- is right for this
    platform's own PNG exports, which are rendered on a lon/lat mesh, and
    WRONG for these graphics. At 61 N the two disagree by tens of kilometres,
    which is the difference between a strike over Orkney and one in the sea.
  * The bounding box is not this platform's. TCM renders over
    lon -11.0 .. 2.5, lat 49.5 .. 61.0; the graphic tool uses lonMin -10.8.
    The 0.2 degrees matter at this scale, so the two are kept separate rather
    than "close enough".

The source file carries a warning worth repeating: these bounds also drive the
tool's own inclusion test, and a previous tighter box silently dropped a
thousand strikes in the Channel and the East Anglia margins. If the graphic
tool's bounds change, change these to match.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

#: The graphic's map box. Identical to MAP_BBOX in StormOutlookGraphicTool.jsx.
LON_MIN, LON_MAX = -10.8, 2.5
LAT_MIN, LAT_MAX = 49.5, 61.0

#: The graphic's drawing space, in the tool's own units.
VIEW_W, VIEW_H = 302, 458


def merc_y(lat: float) -> float:
    """Web Mercator northing for a latitude, in radians of projected space."""
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


Y_TOP = merc_y(LAT_MAX)
Y_BOT = merc_y(LAT_MIN)


def project(lon: float, lat: float,
            width: float = VIEW_W, height: float = VIEW_H) -> tuple[float, float]:
    """Longitude and latitude to pixels in a graphic of this size."""
    x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * width
    y = ((Y_TOP - merc_y(lat)) / (Y_TOP - Y_BOT)) * height
    return x, y


@dataclass(frozen=True, slots=True)
class Projection:
    """Everything a client needs to place a point on the graphic itself."""

    lon_min: float = LON_MIN
    lon_max: float = LON_MAX
    lat_min: float = LAT_MIN
    lat_max: float = LAT_MAX
    view_w: int = VIEW_W
    view_h: int = VIEW_H

    def to_dict(self) -> dict:
        return {
            "kind": "web_mercator_y_linear_x",
            "lon_min": self.lon_min, "lon_max": self.lon_max,
            "lat_min": self.lat_min, "lat_max": self.lat_max,
            "view_w": self.view_w, "view_h": self.view_h,
            "y_top": Y_TOP, "y_bot": Y_BOT,
            "formula": {
                "x": "(lon - lon_min) / (lon_max - lon_min) * width",
                "y": "(y_top - mercY(lat)) / (y_top - y_bot) * height",
                "mercY": "log(tan(pi/4 + radians(lat)/2))",
            },
            "note": (
                "The MyWeatherUK storm-outlook graphic projection. Mercator "
                "in latitude, linear in longitude. NOT the same as this "
                "platform's PNG exports, which are equirectangular over "
                "lon -11.0..2.5 -- do not mix the two."
            ),
        }
