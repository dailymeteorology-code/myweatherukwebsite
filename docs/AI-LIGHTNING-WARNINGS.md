# AI lightning warnings

Experimental, automatically generated Yellow / Amber / Red lightning warnings on
the Lightning page. Replaces the old in-browser "storm warnings", which every
visitor's browser computed separately from its own strike feed.

**Not official warnings.** Every surface says so.

## What runs where

| Piece | File | Notes |
|---|---|---|
| Lightning ingest | `server/aiw/ingest.js` | Blitzortung, 3 parallel sockets, validated + de-duplicated. Provider-adapter interface for adding feeds. |
| Strike archive | `server/aiw/store.js` | `server/data/aiw/strikes/YYYY-MM-DD/HH.csv` — restart recovery + verification. Training reads the site's fuller archive (`server/lightning`, on D:, gaps filled by the GitHub capture). Kept 90 days (`AIW_ARCHIVE_DAYS`). |
| Model atmosphere | `server/aiw/env.js`, `gfs_env.py` | NOAA GFS 0.25° from AWS open data (newest run covering each hour, regridded to 0.5° and kept on D: one file per hour): CAPE, lifted index, CIN, 700 hPa steering wind, 10 m–500 hPa shear, convective precipitation. The same hour files feed training. |
| Nowcast | `server/aiw/nowcast.js` | DBSCAN cells → tracks → motion (track history + cross-correlation + steering wind) → per-lead probability rasters (+5…+30 min). |
| Storm systems | `server/aiw/systems.js` | Cells whose risk areas touch are merged — one warning per threat. |
| Model | `server/aiw/model.js` | Baseline (advected persistence) until a trained logistic model passes the gate. |
| Decisions + lifecycle | `server/aiw/warnings.js` | Severity criteria, hysteresis, polygons, 30-min track, expiry, merge/no-overlap, events, announcements, verification log. |
| Criteria | `server/aiw/config.js` | Every threshold; editable in the admin panel (validated, audited). |
| Text | `server/aiw/describe.js` | Descriptions + spoken text from structured engine output only — no LLM, cannot invent places, times or intensity. |
| Gazetteer | `server/aiw/geo.js`, `server/data/geo/` | GeoNames cities >15k (CC BY 4.0): places, county, region, country, continent, time zone, population. Rebuild: `node server/data/geo/build-gazetteer.mjs`. |
| Cycle | `server/aiw/engine.js` | Once a minute on the server, single-flight. |
| API | `server/aiw/api.js` | `/api/aiw/*` public + `/api/aiw/admin/*` (admin role, audited). SSE stream at `/api/aiw/stream`. |
| Training | `server/aiw/train.js` | See below. |
| Frontend | `src/components/aiw/*` | Map layer, slider, legend, Issued Warnings Centre, detail view, voice + pop-ups, admin panel. Wired in `src/pages/TCM.jsx`. |

Data: `server/data/aiw/state.json` (active warnings, events, announcements,
config, audit, model registry); finished warnings move to
`server/data/aiw/warnings/warnings-YYYY-MM.ndjson`; events / announcements /
audit are also appended to monthly NDJSON logs there.

## Severity

Decided by `decide()` from measured evidence — strike count and rate, peak
probability, core density, trend, population in the area and in the 30-minute
path, time until it arrives, confidence, network coverage. Never from text.

- Escalation needs `escalateCycles` consecutive minutes; downgrade needs
  `downgradeCycles` minutes below the lower (exit) criteria — no flicker.
- Red needs at least medium confidence, else it is held at Amber (and says so).
- Partial-coverage regions are capped at `partialCoverageCap` (Amber).
- No coverage → no warnings; the site says "not covered" rather than "none".
- Lightning feed down → nothing issued, nothing extended; warnings expire on
  their clock and are marked "data delayed".

## Training

```
node server/aiw/train.js                # research run on the last 7 days, writes data/aiw/models/
node server/aiw/train.js --days 14      # a longer stretch
node server/aiw/train.js --deploy       # deploys only if it passes the gate
```

Trains on the site's lightning archive (`D:/MyWeatherUK-data/lightning/bz`, see
`server/lightning`): every Blitzortung strike the server heard, plus what the GitHub
capture (`.github/workflows/lightning.yml`) recorded while the PC was off. Replays it
through the live code, labels each grid point by whether a strike actually fell
within 8 km at each lead, splits **chronologically** (70/30 with a 35-min gap), fits
weighted logistic regression, and scores model vs persistence vs baseline (Brier,
skill, POD/FAR/CSI, reliability, per lead, per region). Lightning and quiet grid
points are both sampled (2% and 0.1% by default) and weighted by the inverse rate,
so memory stays bounded and probabilities stay calibrated. The model sees the
storm's own history and the GFS atmosphere: CAPE, lifted index, 10 m–500 hPa shear
and convective rain, fetched for every past hour exactly as the live engine sees
them. **Gate:** ≥24 h archived, ≥2,000 test lightning samples, beats both
references on Brier score, and — at the threshold where it covers as much lightning
as the baseline does at the configured area probability — raises no more false
alarms. The server retrains daily at ~03:30; the admin panel can run it on demand.

**Thresholds per model.** The baseline is over-confident (it says 85% where lightning
follows about a third of the time), so the configured `areaProbability` (0.40) and
`corridorProbability` (0.20) mean something else on a calibrated model. Training
sweeps thresholds on the held-out period and stores, with each model, the ones that
catch at least as much lightning as the baseline does at the configured values
(`thresholds` in the model file). While that model is active the engine uses them
(`getLiveConfig` in config.js); the admin settings still show and edit the configured
values, which apply to the baseline.

## Testing

`npm test` (includes `server/aiw/aiw.test.js`: decisions, hysteresis,
duplicate prevention + overlap merging, expiry, outages, pause, test warnings,
geometry, validation, tracking, the learner, metrics, text).

Test warnings: admin panel → Test warning. `TEST-` ids, "This is a test" in
speech, hidden from the public list by default.

## Not integrated (inputs the brief lists that the project doesn't have)

- **Radar reflectivity** — RainViewer is imagery only; would need a tile-decoding adapter.
- **Satellite / cloud-top** — no source in the project.
- **Historical lightning before 10 Oct 2026** — Blitzortung's archive needs a
  participant account; the system records its own from now on.
- **Background push notifications** while the site is closed — would need a
  push service; voice and pop-ups work only while the page is open (stated in the UI).
