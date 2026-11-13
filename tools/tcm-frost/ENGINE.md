# TCM FROST — the method

MyWeatherUK's snow model for the UK and Ireland: the chance of snow, the risk, and the amount
expected to fall, on a 2 km grid, out to ten days, every six hours.

## Inputs (all public open data from AWS and ECMWF's Google Cloud copy; never Open-Meteo)

| Source | Members | Resolution | Reach | Snow from |
|---|---|---|---|---|
| Met Office UKV (the cycle's run, to T+54) | 1 | 2 km | 54 h | its own snowfall rate |
| Met Office UKV (newest 03Z/15Z run) | 1 | 2 km | 120 h | its own snowfall rate |
| Met Office Global | 1 | 10 km | 168 h | its own snowfall rate |
| ECMWF IFS | 1 | 0.25° | 240 h (06/18Z: 90 h) | its snowfall (`sf`) |
| ECMWF AIFS | 1 | 0.25° | 240 h | its snowfall (`sf`) |
| NOAA GFS | 1 | 0.25° | 240 h | its frozen percentage (`CPOFP`) |
| ECMWF IFS ENS | 50 | 0.25° | 240 h (06/18Z: 144 h) | each member's snowfall |
| ECMWF AIFS ENS | 50 | 0.25° | 240 h | each member's snowfall |
| NOAA GEFS | 30 | 0.5° | 240 h | each member's snow flag |

A source whose run for the cycle is not out yet is taken from its run before, weighted down
(×0.75 per six hours of age).

## Bringing each member to 2 km (frost/physics.py)

Everything is worked on the 81,756 land cells of the UK and Ireland on Model Data's 2 km grid
(the UKV's own), with each cell's height the mean of the 250 m Copernicus DEM inside it. A model's
own ground is that DEM smoothed to its resolution.

1. **Temperature** goes from the model's ground to the real one with the model's own lapse rate
   between the screen and 850 hPa (3–9.8 K/km; 6.5 where it has no 850 hPa temperature). The dew
   point keeps its depression.
2. **Phase**: the model's own frozen share of what falls is kept at its own ground and moved by
   exactly as much as the wet bulb's share changes with the height difference (all snow at
   −0.2 °C, all rain from +1.2 °C wet bulb, the site's radar typing). A warm nose aloft that
   the model has is kept; its snow line follows the real hills.
3. **Precipitation** on hills the model smoothed away: +5 % per 100 m (−30 % to +60 %).
4. **Depth**: water to snow by a temperature-dependent ratio, about 7:1 near 0 °C, 12:1 at
   −5 °C, up to 18:1 in very cold air.

The UKV is already on this grid: its snow is used as it is.

## Blending (frost/blend.py)

Each member's weight by lead time is in `config.SOURCES`: the UKV leads the first day or two,
the ensembles carry the spread later.

- **Chance of snow**: the weighted share of members giving at least 0.2 cm in the period.
- **Expected amount**: the probability-matched mean of the members' totals since the run began
  (and in the last 24 h): the mean's pattern with the members' own amounts.
- **Risk** (none / low / moderate / high / severe) from the chances of 24-hour totals:
  low ≥25 % of 0.2 cm; moderate ≥30 % of 1 cm (or ≥15 % of 2 cm); high ≥30 % of 5 cm
  (or ≥65 % of 2 cm); severe ≥30 % of 10 cm (or ≥70 % of 5 cm).
- **Days**: each day's expected amount, the chances of 0.2 / 1 / 5 / 10 cm, and its risk.

## Outputs

Model Data frames (`snow_chance`, `snow_risk`, `snow_acc`, `snow_24h`; 3-hourly to T+120,
6-hourly to T+240), a point cube for the Location page, and a manifest. Runs on GitHub Actions
(`.github/workflows/frost.yml`), published as Release assets (`tcm-frost`), mirrored by the
site (`server/tcmFrost.js`), 48 h kept.

## Honesty

The model is not yet calibrated against observed snow: its chances are the members' own,
weighted. Verification against snow-depth reports is the next step before any claim of skill.
