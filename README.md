# MyWeatherUK — self-hosted

The whole MyWeatherUK site running on your own PC, with no Base44 runtime
dependency. All 30 pages, all 300-odd components, and all 21 Base44 edge
functions.

```bash
npm install
npm run build
npm start           # http://localhost:8787
```

First boot prints an admin email and a generated password — copy them, or set
`ADMIN_PASSWORD` in `.env` first (`cp .env.example .env`).

For development with hot reload:

```bash
npm run dev         # API on :8787, Vite on :5173 — open :5173
```

---

## How it works

**Every application file is a byte-identical copy of the Base44 export.** Only
two files in `src/` are rewritten:

| File | Why |
|---|---|
| `src/api/base44Client.js` | Reimplements the `@base44/sdk` call surface against the local server |
| `src/lib/AuthContext.jsx` | The original imported the SDK's axios client to ask Base44's cloud whether the app required auth; self-hosted there is no such gatekeeper |

Everything else — every page, component, hook and lib — is untouched. That is
the point of the design: when you export a fresh copy of a component from
Base44, you drop the file straight in and it works. Re-copy the file rather
than hand-patching it.

The same rule covers the backend. `server/base44-functions/` holds byte-identical
copies of the export's `base44/functions/*/entry.ts`, and they run **unmodified**
under Node. They are plain ES modules despite the `.ts` extension, and they only
touch two things Node lacks: the `npm:@base44/sdk` import specifier and the
`Deno` global. `server/denoAdapter.js` rewrites that one specifier, installs a
`Deno` shim whose `serve()` captures the handler instead of binding a port, and
calls it with an ordinary `Request`.

```
src/api/base44Client.js  ──HTTP──▶  server/index.js
                                      ├── server/db.js            JSON store
                                      ├── server/auth.js          local accounts
                                      ├── server/integrations.js  InvokeLLM / SendEmail
                                      └── server/denoAdapter.js   ──▶ server/base44-functions/*
                                                                       (unmodified Base44 code)
```

## What the server provides

| Endpoint | Replaces |
|---|---|
| `/api/entities/*` | Base44 entity CRUD. Collections are created on demand |
| `/api/events` | Server-Sent Events, so `entity.subscribe()` still works |
| `/api/auth/*` | Hosted auth — register, 6-digit verify, login, reset |
| `/api/functions/*` | The 21 edge functions |
| `/api/integrations/*` | `InvokeLLM`, `SendEmail` |
| `/api/upload` | `integrations.Core.UploadFile`, stored in `server/uploads/` |

Data lives in `server/data/db.json`, seeded from `seed.json` on first run.
Delete `db.json` and restart to reset.

## Backups

Everything that can't be rebuilt from source is `server/data/db.json` (content,
settings, accounts) and `server/uploads/` (uploaded images), plus `.env` for
your keys. A backup is a timestamped folder under `backups/` holding copies of
those and a `manifest.json` saying what's in it — no archive format, so you can
open any backup and read it.

**The server backs itself up on every boot and then every 24 hours**, keeping
the most recent 20. A backup you have to remember to take is one you won't have
when you need it.

```bash
npm run backup            # take one now
npm run backup:list       # what you have
node server/backup.js restore 2026-09-06T10-57-54
```

Restoring takes a `pre-restore` snapshot of the current state first, so a
restore is itself undoable. Safety snapshots are never auto-pruned. Restart the
server afterwards.

Tuning: `BACKUP_INTERVAL_HOURS` (0 disables the timer), `BACKUP_KEEP`,
`BACKUP_INCLUDE_ENV=false` or `--no-env` to leave secrets out.

Backups sit inside the OneDrive folder, so they sync off this machine too —
useful, but it means a backup is only as private as your OneDrive, and `.env`
holds API keys.

### One thing to know about OneDrive

This project lives under `OneDrive/`, and OneDrive's sync client briefly locks
files while it uploads them. That made the database's atomic write-then-rename
fail with `EPERM` and **silently lose writes**. `server/db.js` now retries the
rename with a short backoff and falls back to writing in place, so a sync lock
can't cost you data. If you ever move the project out of OneDrive, none of that
does any harm.

## Accounts

**You are signed in as the admin automatically — there is no login step.** The
server hands the browser a real session token for `ADMIN_EMAIL` on first load,
so admin controls are there from the moment the page opens. This is on by
default because Google sign-in can't work self-hosted and a password prompt to
reach your own admin panel on localhost protects nothing.

Pressing **Log out** still works and stays logged out until you sign in again —
the browser remembers the choice so it isn't undone on the next reload.

Set `AUTO_LOGIN=false` in `.env` to require a password instead. **Do that before
exposing this server beyond localhost**: with auto-login on, anyone who can
reach the port is an admin.

The rest of the account system is fully built and works whenever you want it —
real local accounts with scrypt-hashed passwords and session tokens. The
register flow still asks for the emailed 6-digit code the Register page
expects; with no SMTP configured, **the code is printed to the server
console** instead. Same for password-reset links. That is deliberate — a
verification code you can't receive would lock you out of your own site.

The first account created on a fresh install gets the `admin` role.

**Google sign-in does not work self-hosted** and reports that clearly when
pressed. It needs an OAuth client registered with Google and a public callback
URL, neither of which exists on a local box. Use email and password.

## Configuration

Everything in `.env` is optional; the site runs with none of it. See
`.env.example` for the full list. The ones that change behaviour most:

- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the account created on first boot
- `MET_OFFICE_DATAHUB_API_KEY`, `XWEATHER_CLIENT_ID`/`_SECRET` — without these,
  the functions that need them return their own "not configured" responses and
  the app falls back to Open-Meteo, which needs no key
- `ANTHROPIC_API_KEY` — enables `InvokeLLM` (the AI forecast fallback). Unset =
  feature off, everything else unaffected
- `SMTP_*` — enables outbound email

### The warnings function is overridden

`getMetOfficeWarnings` is the one function that does **not** run the Base44
original by default. The original sends the scraped Met Office page to an LLM
to turn into JSON, which needs a key and can invent a warning that was never
issued. `server/functions/getMetOfficeWarnings.js` parses the same page
deterministically and falls back to the RSS feed, so it needs no key at all.
Set `USE_ORIGINAL_WARNINGS=true` to run the export's version instead.

Caveat: that parser has never met a real warning — none were in force when it
was written, so its HTML fixture is reconstructed from the live page's CSS
class names. Verify it against a real warning when one appears.
`npm test` covers the parser.

## Updating to a newer Base44 export

The export gives you *code*. Content lives in the Base44 cloud and comes down
separately (next section).

When you download a fresh export from the Base44 dashboard, unzip it over
`myweatheruk/`, then:

```bash
cp -r ../myweatheruk/src ./src-new     # then swap it in, keeping the two files below
```

In practice the whole update is: replace `src/`, restore the two rewritten
files (`src/api/base44Client.js`, `src/lib/AuthContext.jsx`), re-copy
`base44/functions/*` into `server/base44-functions/` and `base44/entities/*`
into `server/schemas/`, then `npm run build`. Nothing else needs touching —
that is what the byte-identical rule buys you. Check `npm ls` afterwards in
case the export added a dependency.

Watch for renamed pages: the 6 Sept export renamed `LocationWeather.jsx` to
`LocationForecast.jsx` but still registers it in `pages.config.js` under the
key `LocationWeather`, so the route is `/LocationWeather`. The route key, not
the filename, decides the URL.

## Bringing your live content across

Entity *schemas* come across in the export (`server/schemas/`), but entity
*data* — site settings, graphics, outlooks, archives, verification history —
lives in the Base44 cloud. `server/sync-from-live.js` copies it down from the
app's public entity API (read-only; it never signs in and never writes back):

```bash
npm run sync -- --dry-run        # report what it would pull, write nothing
npm run sync -- --mirror-images  # pull it in, and download images locally
```

`LightningStrike` is excluded by default — it can run to hundreds of thousands
of rows. Pull it explicitly with `--entities=LightningStrike` if you want it.
Your local accounts and sessions are never touched.

The seed sets up a working shell: a `SiteSettings` record, the three
`PublishedFeatures` flags, and empty collections for everything else.

## Known limits

- **Built from the export dated 6 September 2026** (`myweatheruk/`). The
  previous 3–5 July export is kept at `myweatheruk-export-2026-07-05/`.
  Anything changed on the live site since 6 Sept is not here — take a fresh
  export and re-run the update below.
- Images are hot-linked to `media.base44.com` in a handful of components
  (TCM hero, storm-graphic backgrounds). They still load, but they are an
  external dependency; download and re-point them if you want to be fully
  self-contained.
- `sendOutlookEmailAlert` used a Base44-brokered Gmail connection. It reports
  "Gmail not connected" unless you put an OAuth token in `GMAIL_ACCESS_TOKEN`.
- `RelayStatusPanel` still points at a `base44.app` ingest URL that no longer
  resolves to anything you own.
- Stripe subscription pages render but have no payment backend behind them.

## Layout

```
src/                    the app — byte-identical to the export bar two files
server/
  index.js              API server
  db.js                 JSON datastore
  auth.js               local accounts
  base44Server.js       server-side @base44/sdk stand-in
  denoAdapter.js        runs the edge functions under Node
  integrations.js       InvokeLLM / SendEmail
  base44-functions/     the 21 originals, unmodified
  functions/            local overrides (warnings parser + its tests)
  schemas/              entity schemas from the export, for reference
  data/                 seed.json and the live db.json
.previous-home-build/   the earlier home-page-only build, kept for reference
```
