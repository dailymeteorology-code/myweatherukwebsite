# Weather Scenarios

`/WeatherScenarios` — *Explore every season of UK weather.* A searchable,
filterable reference to the weather the UK can produce, month by month and
region by region. It is about **climatology and possibility, not forecasts**;
the *Live model scenarios* tab shows a week-ahead ensemble forecast.

## What is on the page

| View (`?view=`) | What it shows |
|---|---|
| `overview` | Introduction, live counts from the database, seasonal hazards for a chosen month, categories, the 12-month grid |
| `months` (`&m=jan`) | Twelve month cards; each month's full catalogue grouped by frequency, 1991–2020 averages (UK + region), neighbour comparison, regional notes, prev/next |
| `library` | Search (synonym-aware) + multi-select filters: month, season, category, region, frequency, severity, temperature, precipitation, circulation, record type; sorting; progressive loading |
| `matrix` | Every scenario × month, filterable; names open scenarios, cells open months |
| `regions` (`&r=`) | Leaflet map of 15 regions (real ONS boundaries); local factors, district climate, relevant scenarios |
| `compare` (`&cmp=a,b`) | 2–4 scenarios side by side, generated from the records |
| `seasons` | Four overviews composed from their months |
| `history` | Verified events, filterable by year, month, category, region |
| `about` | Methodology, frequency definitions, QC checklist, diagrams, all references |
| `live` | Week-ahead scenarios from 100 ECMWF, GFS and UKMO ensemble members, downloadable as a JPG (a forecast view) |
| `admin` | Editors only (role `admin`) |

Any view can open a scenario with `&s=<id>`; every scenario therefore has a shareable link.

## Data model

Authored, committed data lives in `server/scenarios/data/`:

- `taxonomy.js` — categories, record kinds, frequency codes, severity, filter vocabularies, seasons, the 15 regions (with geographic factors and their Met Office climate districts) and region groups.
- `scenarios/*.js` — one file per category; each record:

```js
{
  id, name, aka: [], cat, also: [], kind, sev, temp, precip: [], circ: [],
  months: 'CCPU-------P',           // Jan→Dec: C common, P plausible, U uncommon, R rare, - outside its season
  monthNotes: { jan: '…' },
  summary, body: ['paragraph', …],
  regions: [[regionOrGroup, 'high'|'moderate'|'low', 'why'], …],
  setup: { essential: [], favourable: [], pressure, airmass, jet, temperature, moisture, instability, shear, fronts, orography, other },
  outcomes: [], alternatives, duration,
  impacts: { people, transport, aviation, infrastructure, property, agriculture, rivers, coast, power },
  signals: [[signal, whatItTells, limitation]],
  frequency: 'qualitative statement',
  stats: [{ text, source, period, scope }],
  climate: { observed, projected, uncertainty, sources: [] },
  safety: [[text, sourceId]],
  related: [ids], sources: [ids], diagram: 'key',
}
```

- `events.js` — historical events (id, dates, regions, categories, linked scenarios, summary, observations, sources).
- `sources.js` — every cited source (id, title, publisher, URL, kind).
- `months.js` — month-specific editorial text and the season framings.
- `server/data/scenarios/climate-1991-2020.json` — generated averages.
- `server/data/scenarios/regions.geo.json` — generated boundaries.

`server/scenarios/store.js` validates everything and normalises it into
separate tables — **scenarios, month links, region links, ingredients,
impacts, safety, relations, events, event links, frequency** — exposed at
`GET /api/scenarios/tables`. Relations are made symmetric so links never
dead-end. Invalid records are excluded and listed in the admin report.

Admin edits are stored in `server/data/scenarios-local/overrides.json`
(git-ignored: live data, and its audit log contains admin emails).

## API

Public: `GET /api/scenarios/catalogue` (light index, gzip + ETag),
`/item/:id`, `/regions.geo.json`, `/tables`.
Admin (role `admin`, audited): `/admin/overview`, `/admin/record/:id`,
`POST /admin/scenario` (new id only; saved unpublished), `PUT /admin/scenario/:id`,
`DELETE /admin/scenario/:id` (revert), `POST /admin/status/:id`
(`{published, verified}`), `PUT /admin/event/:id`, `PUT /admin/source/:id`,
`POST /admin/check-links`.

## Sources and methodology

- Explanations follow Met Office explainers (`weather.metoffice.gov.uk/learn-about/weather/…`).
- Historical events come only from Met Office National Climate Information
  Centre case studies (the *Past UK weather events* archive) or Met Office case
  studies. Every figure quoted in an event appears in its source.
- Records and extremes: Met Office *UK climate extremes*.
- Monthly averages: mean of 1991–2020 from the Met Office HadUK-Grid areal
  series (`npm run scenarios:build-climate` regenerates them).
- Boundaries: ONS LAD Dec 2024 BUC + LAD→Region lookup
  (`npm run scenarios:build-regions`). Scotland's four-way split is our own
  grouping of council areas (documented in the build script).
- Safety lines match the wording of the linked official guidance.
- No percentages or recurrence periods are invented; where a source gives one
  (e.g. the Met Office 1-in-200-year estimate for 1987-strength winds over
  south-east England) it is quoted with the source.
- Where no verified example or statistic exists, the field is left empty and
  the page says so.

## Frequency classification

C *Seasonally common*, P *Plausible*, U *Uncommon*, R *Rare or exceptional*,
`-` *Outside its season* — explicitly **not** "impossible". These are
qualitative climatological categories (how often something has happened in a
month), never forecast probabilities. Definitions are shown on the page.

## Adding or changing content

1. Prefer editing the authored files for permanent content; use the admin
   panel for corrections and drafts (new scenarios start unpublished).
2. Follow the QC checklist on the *Methods & sources* tab.
3. `npm test` — structure, references, filters, matrix, links between records, permissions.
4. `npm run scenarios:check-links` — every source URL must resolve.

## Known limits

- The scenario library is a structured synthesis, not a complete enumeration of every atmospheric state.
- 85 of the 203 scenarios have no linked historical example yet; none are invented.
- Regional relevance is a classification with reasons, not a statistical climatology.
- No verified UK supercell or strong-tornado climatology is cited, so those records give no frequency figure.

## Live model scenarios (week ahead)

The *Live model scenarios* tab shows three scenarios for the next seven days,
one from each deterministic global model: **ECMWF IFS, NOAA GFS and the Met
Office global model (UKMO 10 km)**, from the Open-Meteo forecast API in a
single request (225 grid points, 48–62°N, 14°W–7°E).

- **Variables (daily):** max and min temperature, precipitation total, max
  10 m wind speed (mph), dominant wind direction, and mean sea-level pressure
  (for isobars, highs/lows and the flow over the UK).
- **Likelihood** (`server/scenarios/live/ensemble.mjs`): each model's 7-day
  mean pressure pattern is compared with the other two (RMS difference over
  the grid; agreement falls to zero at 8 hPa). Weight = 1 + its agreement with
  each other model, normalised and rounded to 100. The model the others back
  most is *Most likely*. This is a consensus measure, not a calibrated
  probability, and the graphic says so.
- **Each scenario shows:** pressure map with isobars and H/L, 7-day rain
  shading, headline and summary built from the numbers, average highs/lows
  with anomaly against UK 1991–2020, UK-average rain, peak wind, a 7-day
  strip, and agreement with the other two models. The UKMO run is a day
  shorter, so its last day can show *no data*.
- **Graphic** (`src/components/scenarios/LiveScenarios.jsx`): 2400×1960
  canvas with the real logo; *Download JPG* saves exactly that image.
- **Schedule — works with the PC off:** `.github/workflows/live-scenarios.yml`
  runs on GitHub at 06:00 UK time daily (two UTC crons; only the one that is
  06:00 UK time builds) and force-pushes `live-scenarios.json` to the
  `live-data` branch. Run it by hand from the Actions tab (*Run workflow*).
- **Self-hosted server** (`server/scenarios/live/index.js`): reads the GitHub
  copy on start-up and every 30 minutes, builds itself at 06:00 if running,
  and on start-up if nothing is newer than 24 h. Newest wins.
  `GET /api/scenarios/live`. Manual build: `node server/scenarios/live/run.mjs`.
