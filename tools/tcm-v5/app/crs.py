"""Coordinate reference systems.

One spelling of each projection, in one place. `GridSpec.projection` is
compared as a STRING when deciding whether two grids are the same mesh, so two
equivalent-but-differently-written PROJ strings would make UKV look like it
needed regridding onto its own grid. Import from here; never retype a PROJ
string.

The UK LAEA parameters are those the Met Office encodes in the UKV GRIB2
(grid definition template 140), read back with eccodes:

    standardParallelInDegrees  = 54.9      -> +lat_0
    centralLongitudeInDegrees  = 357.5     -> +lon_0=-2.5
"""
from __future__ import annotations

#: Met Office UK Lambert azimuthal equal area, as used by UKV and MOGREPS-UK.
UK_LAEA_PROJ = (
    "+proj=laea +lat_0=54.9 +lon_0=-2.5 +x_0=0 +y_0=0 "
    "+ellps=WGS84 +datum=WGS84 +units=m +no_defs"
)

#: Plate carree / WGS84 lon-lat, used by the Open-Meteo and ECMWF feeds.
WGS84 = "EPSG:4326"
