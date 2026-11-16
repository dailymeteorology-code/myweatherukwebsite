"""Storm replays (16 Nov 2026, at the user's request: "replays of famous storms from the GFS archive"): the
NOAA GFS run from just before each of the UK's big storms since 2021, from the AWS open-data archive
(noaa-gfs-bdp-pds keeps every run), as a model whose runs are the storms. Every value is what GFS
forecast at the time, every three hours to three days ahead: what the forecasters were looking at.
"""
from __future__ import annotations

from datetime import datetime

from .models import GFS

# (the run: half a day to a day before the worst, the storm, what it did)
EVENTS = [
    ('2021-11-26T00:00:00+00:00', 'Storm Arwen', 'A northerly gale: 98 mph at Brizlee Wood, Northumberland; trees down and homes without power for days.'),
    ('2022-02-18T00:00:00+00:00', 'Storm Eunice', 'Red warnings for south-west England and London: 122 mph at the Needles, the strongest gust on record in England.'),
    ('2023-10-19T00:00:00+00:00', 'Storm Babet', 'Days of rain from the east: a red warning for Angus and Aberdeenshire, rivers flooding across Scotland and the Midlands.'),
    ('2023-11-01T12:00:00+00:00', 'Storm Ciarán', 'A deep low up the Channel: over 100 mph in the Channel Islands, damaging gusts along the south coast.'),
    ('2024-01-21T00:00:00+00:00', 'Storm Isha', 'Gales across the whole of the UK and Ireland: 99 mph at Brizlee Wood, amber warnings everywhere.'),
    ('2024-11-23T00:00:00+00:00', 'Storm Bert', 'Snow in the north at first, then heavy rain and flooding in south Wales and the Welsh borders.'),
    ('2024-12-06T12:00:00+00:00', 'Storm Darragh', 'Red warning for south Wales and the Bristol Channel coasts: 96 mph at Berry Head, nearly two million homes without power.'),
    ('2025-01-23T12:00:00+00:00', 'Storm Éowyn', 'Red warnings for Northern Ireland and central Scotland; 114 mph in Ireland, the strongest gust on record there.'),
]
STEPS = list(range(0, 73, 3))


class Replay(GFS):
    id, label, res_km = 'replay', 'Storm replays (NOAA GFS archive)', 25.0
    NO_RECIPES = True                                     # the storm's own layers only, a short list
    # the storm's own layers: its pressure and gusts (and the worst gust so far, its footprint), its rain,
    # what fell and how much, the jet that drove it, and the cold air behind it
    variables = ['mslp', 'gust10', 'gust_peak', 'wind10', 'wdir10', 'precip_rate', 'precip_total', 'ptype', 'refc', 't2', 'tcc',
                 't850', 'z500', 'wind250', 'cape_sb', 'snow_depth']
    names = {datetime.fromisoformat(r).isoformat(): (n, note) for r, n, note in EVENTS}

    def runs(self, n=None):
        out = [(datetime.fromisoformat(r), list(STEPS)) for r, _, _ in EVENTS]
        out.sort(key=lambda x: x[0], reverse=True)
        return out[:n] if n else out

    def schedule(self, run):
        return list(STEPS)


SOURCE_REPLAY = 'NOAA GFS 0.25°: the runs from just before famous storms, from the AWS open-data archive (noaa-gfs-bdp-pds)'
