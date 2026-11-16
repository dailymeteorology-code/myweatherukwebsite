"""The night sky as map layers (16 Nov 2026, at the user's request: "stargazing plus aurora chance ... done
in both model data page and location weather page"): recipes from any model's cloud cover and the time.

    stargaze  0-10: how dark (the sun 6 to 12 degrees down and below), how clear (the model's total
              cloud) and how much the moon washes out the sky (its brightness and height)
    aurora    0-100 %: a rough guide: NOAA SWPC's planetary K-index forecast (3 days, every 3 hours)
              against each place's geomagnetic latitude (the aurora reaches about 66.5 - 2 Kp degrees),
              where it is dark and clear. Beyond the Kp forecast the layer has no value.

The sun and the moon: the low-precision formulas of Astronomical Algorithms as SunCalc uses them (to
about a degree), worked out for every cell of the grid.
"""
from __future__ import annotations

import json
import time
import urllib.request
from datetime import datetime, timezone

import numpy as np

from .common import DATA, lonlat

J2000 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
R = np.pi / 180
KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'
KP_FILE = DATA / 'kp_forecast.json'
POLE = (80.8, -72.7)                       # the geomagnetic (dipole) north pole, IGRF 2025


def _days(when):
    return (when - J2000).total_seconds() / 86400.0


def _sun_eq(d):
    m = R * ((357.5291 + 0.98560028 * d) % 360)
    c = R * (1.9148 * np.sin(m) + 0.02 * np.sin(2 * m) + 0.0003 * np.sin(3 * m))
    lam = m + c + R * 102.9372 + np.pi
    e = R * 23.4397
    return np.arctan2(np.sin(lam) * np.cos(e), np.cos(lam)), np.arcsin(np.sin(e) * np.sin(lam)), lam


def _moon_eq(d):
    L, M, F = R * (218.316 + 13.176396 * d), R * (134.963 + 13.064993 * d), R * (93.272 + 13.229350 * d)
    lon, lat = L + R * 6.289 * np.sin(M), R * 5.128 * np.sin(F)
    e = R * 23.4397
    ra = np.arctan2(np.sin(lon) * np.cos(e) - np.tan(lat) * np.sin(e), np.cos(lon))
    dec = np.arcsin(np.sin(lat) * np.cos(e) + np.cos(lat) * np.sin(e) * np.sin(lon))
    return ra, dec, lon, lat


def _alt(ra, dec, d, lon, lat):
    """Altitude (degrees) of a body at ra/dec over each place (lon/lat degrees)."""
    theta = R * (280.16 + 360.9856235 * d) + R * lon       # sidereal time at each longitude
    h = theta - ra
    phi = R * lat
    return np.degrees(np.arcsin(np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.cos(h)))


def sky(when):
    """(sun altitude, moon altitude) grids in degrees, and the moon's lit fraction, at a time."""
    lon, lat = lonlat()
    d = _days(when)
    sra, sdec, slam = _sun_eq(d)
    mra, mdec, mlon, mlat = _moon_eq(d)
    elong = np.arccos(np.cos(mlat) * np.cos(mlon - slam))
    lit = float((1 - np.cos(elong)) / 2)                  # the lit fraction: 0 new, 1 full
    return _alt(sra, sdec, d, lon, lat), _alt(mra, mdec, d, lon, lat), lit


def _dark(sun):
    return np.clip((-sun - 6.0) / 6.0, 0, 1)                # nothing until the sun is 6 degrees down, fully dark at 12


def _clear(tcc):
    return np.clip(1 - np.nan_to_num(tcc, nan=100.0) / 100.0, 0, 1) ** 1.5


def stargaze(tcc, vt=None):
    sun, moon, lit = sky(vt)
    glare = 1 - 0.6 * lit * np.clip(moon / 20.0, 0, 1)
    return (10.0 * _dark(sun) * _clear(tcc) * glare).astype(np.float32)


stargaze.wants_time = True


def kp_at(when):
    """NOAA SWPC's planetary K index for the 3-hour block holding `when` (observed, estimated or
    predicted), kept on D: for three hours; None beyond the forecast."""
    rows = None
    try:
        if KP_FILE.exists() and time.time() - KP_FILE.stat().st_mtime < 3 * 3600:
            rows = json.loads(KP_FILE.read_text())
    except Exception:                                     # noqa: BLE001
        rows = None
    if rows is None:
        with urllib.request.urlopen(urllib.request.Request(KP_URL, headers={'User-Agent': 'MyWeatherUK-modeldata/1.0'}), timeout=30) as r:
            rows = json.loads(r.read().decode())
        KP_FILE.parent.mkdir(parents=True, exist_ok=True)
        KP_FILE.write_text(json.dumps(rows))
    for row in rows:                                       # {time_tag, kp, observed, noaa_scale} (older files: [time_tag, kp, ...] after a header row)
        try:
            tag, kp = (row['time_tag'], row['kp']) if isinstance(row, dict) else (row[0], row[1])
            t0 = datetime.fromisoformat(str(tag).replace(' ', 'T')).replace(tzinfo=timezone.utc)
            if 0 <= (when - t0).total_seconds() < 3 * 3600:
                return float(kp)
        except (ValueError, KeyError, IndexError, TypeError):
            continue
    return None


def aurora(tcc, vt=None):
    kp = kp_at(vt)
    if kp is None:
        raise KeyError('beyond the Kp forecast')
    lon, lat = lonlat()
    plat, plon = R * POLE[0], R * POLE[1]
    gm = np.degrees(np.arcsin(np.sin(R * lat) * np.sin(plat) + np.cos(R * lat) * np.cos(plat) * np.cos(R * lon - plon)))
    edge = 66.5 - 2.0 * kp
    reach = np.clip((gm - edge) / 4.0 + 0.5, 0, 1)
    sun, _, _ = sky(vt)
    return (100.0 * reach * _dark(sun) * _clear(tcc)).astype(np.float32)


aurora.wants_time = True

SKY_RECIPES = {
    'stargaze': (('tcc',), stargaze, dict(label='Stargazing (clear, dark sky)', unit='/10', group='Cloud & visibility', lo=0, hi=10)),
    'aurora': (('tcc',), aurora, dict(label='Aurora chance (rough guide)', unit='%', group='Cloud & visibility', lo=0, hi=100)),
}
