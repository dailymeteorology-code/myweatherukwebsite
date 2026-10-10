# AI lightning warnings

Experimental, automatically generated Yellow / Amber / Red lightning warnings on
the Lightning page. Replaces the old in-browser "storm warnings", which every
visitor's browser computed separately from its own strike feed.

**Not official warnings.** Every surface says so.

## What runs where

| Piece | File | Notes |
|---|---|---|
| Lightning ingest | `server/aiw/ingest.js` | Blitzortung, 3 parallel sockets, validated + de-duplicated. Provider-adapter interface for adding feeds. |
| Strike archive | `server/aiw/store.js` | `server/data/aiw/strikes/YYYY-MM-DD/HH.csv` — training + verification data. Kept 90 days (`AIW_ARCHIVE_DAYS`). |
| Model atmosphere | `server/aiw/env.js` | Open-Meteo (no key): CAPE, lifted index, CIN, 700 hPa steering wind, 0–6 km shear, showers. Cached per 0.5° tile per hour. |
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
node server/aiw/train.js                # research run, writes data/aiw/models/
node server/aiw/train.js --deploy       # deploys only if it passes the gate
```

Replays the archive through the live code, labels each grid point by whether a
strike actually fell within 8 km at each lead, splits **chronologically**
(70/30 with a 35-min gap), fits weighted logistic regression, and scores model
vs persistence vs baseline (Brier, skill, POD/FAR/CSI, reliability, per lead,
per region). **Gate:** ≥24 h archived, ≥2,000 test lightning samples, beats
both references. The server retrains daily at ~03:30 once there is a day of
data; the admin panel can run it on demand.

**Status at build time:** the archive began on 10 Oct 2026 — there is not yet
enough data to train, so the engine runs the baseline and every warning says so.

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
