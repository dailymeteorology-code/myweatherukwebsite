"""Region map for region-aware calibration and verification: England, Wales, Scotland,
Ireland (the island: Northern Ireland + Republic) and sea.

Boundaries are hand-placed approximations (border lines to ~5–10 km), not survey
boundaries — adequate for stratifying a 2 km thunderstorm calibration, which needs
"which climate/terrain regime is this cell in", not legal borders. Land/sea comes from
the DEM land fraction.
"""
from __future__ import annotations

import numpy as np
from matplotlib.path import Path
from pyproj import Transformer

from .grid import Grid

REGIONS = ['england', 'wales', 'scotland', 'ireland', 'sea']
IRELAND = [(-10.9, 51.2), (-6.0, 51.85), (-5.95, 52.3), (-5.35, 54.0), (-5.35, 54.75), (-5.95, 55.3),
           (-7.3, 55.5), (-8.6, 55.3), (-10.6, 54.3), (-10.9, 51.2)]
# England–Scotland border (Solway -> Berwick) in BNG metres, with a flat western extension
# along the Solway so the Isle of Man and Cumbria are not counted as Scotland.
BORDER = [(-300e3, 520e3), (250e3, 540e3), (320e3, 567e3), (360e3, 600e3), (399e3, 653e3), (800e3, 653e3)]
# England–Wales border (Dee -> Severn), BNG metres; Wales lies west of it.
WALES_EAST = [(330e3, 395e3), (338e3, 360e3), (325e3, 300e3), (330e3, 250e3), (355e3, 200e3), (330e3, 160e3)]


def region_map(grid: Grid, land_frac):
    lon, lat = grid.lonlat
    X, Y = grid.xy
    land = land_frac >= 0.5
    pts = np.c_[lon.ravel(), lat.ravel()]
    ire = Path(IRELAND).contains_points(pts).reshape(grid.shape)
    bx, by = np.array(BORDER).T
    scot = Y > np.interp(X, bx, by)
    wy, wx = np.array(WALES_EAST)[::-1, 1], np.array(WALES_EAST)[::-1, 0]
    wales_edge = np.interp(Y, wy, wx)
    wales = (X < wales_edge) & (Y > 160e3) & (Y < 400e3) & (X > 150e3)
    out = np.full(grid.shape, REGIONS.index('england'), np.int8)
    out[wales] = REGIONS.index('wales')
    out[scot] = REGIONS.index('scotland')
    out[ire] = REGIONS.index('ireland')
    out[~land] = REGIONS.index('sea')
    return out
