"""TCM FROST: MyWeatherUK's snow model for the UK and Ireland.

Every six hours it takes every model run on AWS that reaches the UK (the UKV at 2 km, Met Office
Global, ECMWF IFS and AIFS, NOAA GFS, and the IFS, AIFS and GEFS ensembles, member by member),
brings each to 2 km over real terrain, works out the snow each would bring, and blends them into
the chance of snow, the risk, and the amount expected to fall, out to ten days.

    python -m frost.run --cycle 2026111312        one run
    python -m frost.route                          which cycle is due (GitHub Actions)

See ENGINE.md beside this package for the method.
"""
